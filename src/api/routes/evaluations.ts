// src/api/routes/evaluations.ts
// POST /evaluations, GET /evaluations/:id, GET /evaluations

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import crypto from 'node:crypto';
import { SystemStateSchema } from '../../ai/types.js';
import { findRelevantSections } from '../../ai/retriever.js';
import { analyzeCompliance } from '../../ai/llmAnalyzer.js';
import { generateRules } from '../../ai/ruleGenerator.js';
import { createRule, getActiveRules } from '../../compliance/ruleStore.js';
import { evaluateRules } from '../../compliance/engine.js';
import { generateReport } from '../../compliance/evaluationReport.js';
import { AppError } from '../../core/errors.js';
import { writeAuditEvent } from '../../infra/audit.js';
import { logger } from '../../core/logger.js';
import { db } from '../../infra/db.js';
import { queueEvaluation } from '../../infra/queue.js';
import { requireSecurityEngineer, requireComplianceAuditor } from '../middleware/auth.js';

const CreateEvaluationSchema = z.object({
  systemId: z.string(),
  framework: z.string(),
  frameworkVersion: z.string(),
  systemState: SystemStateSchema,
});

const ListEvaluationsQuerySchema = z.object({
  status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED']).optional(),
  limit: z.string().transform(Number).default('20'),
  offset: z.string().transform(Number).default('0'),
});

export async function evaluationsRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /evaluations - Trigger a compliance evaluation
  fastify.post('/', {
    preHandler: [requireSecurityEngineer],
  }, async (request, reply) => {
    const { principal } = request;
    const body = CreateEvaluationSchema.parse(request.body);
    
    const evaluationId = `eval-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    
    // Store evaluation record
    await db.query(
      `INSERT INTO evaluations (id, tenant_id, system_id, framework, framework_version, system_state, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', NOW())`,
      [evaluationId, principal.tenantId, body.systemId, body.framework, body.frameworkVersion, JSON.stringify(body.systemState)]
    );
    
    await writeAuditEvent({
      eventType: 'EVALUATION_STARTED',
      tenantId: principal.tenantId,
      principalId: principal.id,
      correlationId: principal.correlationId,
      resourceType: 'Evaluation',
      resourceId: evaluationId,
      outcome: 'SUCCESS',
      metadata: { systemId: body.systemId, framework: body.framework },
    });
    
    // Run evaluation via BullMQ queue (replaces setImmediate)
    try {
      await queueEvaluation({
        evaluationId,
        tenantId: principal.tenantId,
        systemId: body.systemId,
        framework: body.framework,
        principalId: principal.id,
        correlationId: principal.correlationId,
      });
      
      logger.info({ evaluationId }, 'Evaluation queued');
    } catch (err) {
      // If queueing fails, fall back to inline processing with error handling
      logger.warn({ err, evaluationId }, 'Queue unavailable, processing inline');
      
      setImmediate(async () => {
        try {
          await runEvaluation(evaluationId, principal, body);
        } catch (processErr) {
          logger.error({ err: processErr, evaluationId }, 'Evaluation failed (inline)');
          await db.query(
            'UPDATE evaluations SET status = $1 WHERE id = $2',
            ['FAILED', evaluationId]
          );
        }
      });
    }
    
    return reply.status(202).send({
      evaluationId,
      status: 'PENDING',
      estimatedCompletionSeconds: 45,
    });
  });

  // GET /evaluations/:id - Get evaluation results
  fastify.get('/:id', {
    preHandler: [requireComplianceAuditor],
  }, async (request, reply) => {
    const { principal } = request;
    const { id } = request.params as { id: string };
    
    const result = await db.query(
      'SELECT * FROM evaluations WHERE id = $1 AND tenant_id = $2',
      [id, principal.tenantId]
    );
    
    if (result.rows.length === 0) {
      throw new AppError('NOT_FOUND', `Evaluation not found: ${id}`, 404);
    }
    
    const evaluation = result.rows[0];
    
    return reply.send({
      evaluationId: evaluation.id,
      status: evaluation.status,
      systemId: evaluation.system_id,
      framework: evaluation.framework,
      overallRisk: evaluation.overall_risk,
      violations: evaluation.violations,
      passedRules: evaluation.passed_rules,
      failedRules: evaluation.failed_rules,
      completedAt: evaluation.completed_at,
    });
  });

  // GET /evaluations - List evaluations with pagination
  fastify.get('/', {
    preHandler: [requireComplianceAuditor],
  }, async (request, reply) => {
    const { principal } = request;
    const query = ListEvaluationsQuerySchema.parse(request.query);
    
    let sql = 'SELECT * FROM evaluations WHERE tenant_id = $1';
    const params: (string | number)[] = [principal.tenantId];
    let paramIndex = 1;
    
    if (query.status) {
      paramIndex++;
      sql += ` AND status = $${paramIndex}`;
      params.push(query.status);
    }
    
    // Get total count
    const countSql = `SELECT COUNT(*) FROM (${sql}) AS filtered`;
    const countResult = await db.query<{ count: string }>(countSql, params);
    const total = parseInt(countResult.rows[0]?.count ?? '0', 10);
    
    // Add pagination
    paramIndex++;
    sql += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
    params.push(query.limit);
    paramIndex++;
    sql += ` OFFSET $${paramIndex}`;
    params.push(query.offset);
    
    const result = await db.query(sql, params);
    
    return reply.send({
      evaluations: result.rows,
      total,
      limit: query.limit,
      offset: query.offset,
    });
  });
}

// Run the complete evaluation pipeline
async function runEvaluation(
  evaluationId: string,
  principal: { id: string; tenantId: string; correlationId: string },
  body: z.infer<typeof CreateEvaluationSchema>,
): Promise<void> {
  // Update status to IN_PROGRESS
  await db.query(
    'UPDATE evaluations SET status = $1, started_at = NOW() WHERE id = $2',
    ['IN_PROGRESS', evaluationId]
  );
  
  // Get active rules
  const rules = await getActiveRules(principal.tenantId, body.framework);
  
  // If no rules exist, run AI analysis to generate proposed rules
  if (rules.length === 0) {
    logger.info({ evaluationId }, 'No active rules found, running AI analysis');
    
    // Retrieve relevant policy sections
    const context = await findRelevantSections({
      query: `Compliance requirements for ${body.framework} on ${body.systemState.platform}`,
      framework: body.framework,
      principal,
    });
    
    // Run LLM analysis
    const { result: analysisResult, llmMeta } = await analyzeCompliance(
      context,
      body.systemState,
      { principal }
    );
    
    // Generate rules from violations
    if (analysisResult.violations.length > 0) {
      const generatedRules = await generateRules(analysisResult.violations, {
        documentIds: context.chunks.map(c => c.documentId),
        chunkIds: context.chunks.map(c => c.id),
        modelId: llmMeta.modelId,
        promptVersion: llmMeta.promptVersion,
        promptHash: llmMeta.promptHash,
        retrievalParams: { query: context.queryHash },
        principal,
      });
      
      // Store proposed rules (they need human approval)
      for (const rule of generatedRules) {
        await createRule(rule, principal);
      }
    }
  }
  
  // Re-fetch active rules (now including any that were just approved)
  const activeRules = await getActiveRules(principal.tenantId, body.framework);
  
  // Run evaluation
  const evaluationResult = evaluateRules(activeRules, body.systemState);
  
  // Generate report
  const report = generateReport(
    evaluationId,
    body.systemId,
    body.framework,
    body.frameworkVersion,
    body.systemState,
    evaluationResult
  );
  
  // Store results
  await db.query(
    `UPDATE evaluations SET status = $1, overall_risk = $2, violations = $3, 
     passed_rules = $4, failed_rules = $5, completed_at = NOW()
     WHERE id = $6`,
    [
      'COMPLETED',
      report.overallRisk,
      JSON.stringify(report.findings),
      report.summary.passed,
      report.summary.failed,
      evaluationId,
    ]
  );
  
  await writeAuditEvent({
    eventType: 'EVALUATION_COMPLETED',
    tenantId: principal.tenantId,
    principalId: principal.id,
    correlationId: principal.correlationId,
    resourceType: 'Evaluation',
    resourceId: evaluationId,
    outcome: 'SUCCESS',
    metadata: {
      overallRisk: report.overallRisk,
      passed: report.summary.passed,
      failed: report.summary.failed,
    },
  });
  
  logger.info({ evaluationId, overallRisk: report.overallRisk }, 'Evaluation completed');
}