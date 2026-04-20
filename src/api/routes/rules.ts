// src/api/routes/rules.ts
// GET/POST /rules, POST /rules/:id/approve

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getRules, getRuleById, approveRule, rejectRule } from '../../compliance/ruleStore.js';
import { AppError } from '../../core/errors.js';
import { requireSecurityEngineer } from '../middleware/auth.js';

const ListRulesQuerySchema = z.object({
  status: z.enum(['PROPOSED', 'APPROVED', 'ACTIVE', 'DEPRECATED', 'REJECTED']).optional(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  framework: z.string().optional(),
});

const ApproveRuleBodySchema = z.object({
  reason: z.string().optional(),
});

const RejectRuleBodySchema = z.object({
  reason: z.string(),
});

export async function rulesRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /rules - List rules
  fastify.get('/', {
    preHandler: [requireSecurityEngineer],
  }, async (request, reply) => {
    const { principal } = request;
    const query = ListRulesQuerySchema.parse(request.query);
    
    const rules = await getRules(principal.tenantId, {
      status: query.status,
      severity: query.severity,
    });
    
    // Filter by framework if specified
    let filteredRules = rules;
    if (query.framework) {
      filteredRules = rules.filter(r => 
        r.policyReference.toLowerCase().includes(query.framework!.toLowerCase())
      );
    }
    
    return reply.send({
      rules: filteredRules,
      total: filteredRules.length,
    });
  });

  // GET /rules/:id - Get a specific rule
  fastify.get('/:id', {
    preHandler: [requireSecurityEngineer],
  }, async (request, reply) => {
    const { principal } = request;
    const { id } = request.params as { id: string };
    
    const rule = await getRuleById(id, principal.tenantId);
    
    if (!rule) {
      throw new AppError('NOT_FOUND', `Rule not found: ${id}`, 404);
    }
    
    return reply.send(rule);
  });

  // POST /rules/:id/approve - Approve a PROPOSED rule
  fastify.post('/:id/approve', {
    preHandler: [requireSecurityEngineer],
  }, async (request, reply) => {
    const { principal } = request;
    const { id } = request.params as { id: string };
    const body = ApproveRuleBodySchema.parse(request.body);
    
    const rule = await approveRule(id, principal);
    
    return reply.send({
      ruleId: rule.id,
      status: rule.status,
      approvedBy: rule.approvedBy,
      approvedAt: rule.approvedAt,
      reason: body.reason,
    });
  });

  // POST /rules/:id/reject - Reject a PROPOSED rule
  fastify.post('/:id/reject', {
    preHandler: [requireSecurityEngineer],
  }, async (request, reply) => {
    const { principal } = request;
    const { id } = request.params as { id: string };
    const body = RejectRuleBodySchema.parse(request.body);
    
    const rule = await rejectRule(id, principal, body.reason);
    
    return reply.send({
      ruleId: rule.id,
      status: rule.status,
      reason: body.reason,
    });
  });
}
