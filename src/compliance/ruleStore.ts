// src/compliance/ruleStore.ts
// Rule CRUD with approval workflow

import type { EngineRule, RuleStatus } from '../ai/types.js';
import { db } from '../infra/db.js';
import { logger } from '../core/logger.js';
import { AppError } from '../core/errors.js';
import { writeAuditEvent } from '../infra/audit.js';

interface Principal {
  id: string;
  tenantId: string;
  correlationId: string;
}

// Get rules by tenant with optional filters
export async function getRules(
  tenantId: string,
  filters?: {
    status?: RuleStatus;
    framework?: string;
    severity?: string;
  },
): Promise<EngineRule[]> {
  let sql = 'SELECT * FROM engine_rules WHERE tenant_id = $1';
  const params: (string | string[])[] = [tenantId];
  let paramIndex = 1;

  if (filters?.status) {
    paramIndex++;
    sql += ` AND status = $${paramIndex}`;
    params.push(filters.status);
  }

  if (filters?.severity) {
    paramIndex++;
    sql += ` AND severity = $${paramIndex}`;
    params.push(filters.severity);
  }

  sql += ' ORDER BY created_at DESC';

  const result = await db.query<EngineRule>(sql, params);
  return result.rows;
}

// Get a single rule by ID
export async function getRuleById(
  ruleId: string,
  tenantId: string,
): Promise<EngineRule | null> {
  const result = await db.query<EngineRule>(
    'SELECT * FROM engine_rules WHERE id = $1 AND tenant_id = $2',
    [ruleId, tenantId],
  );
  return result.rows[0] ?? null;
}

// Create a new rule (typically PROPOSED from AI)
export async function createRule(
  rule: Omit<EngineRule, 'createdAt'>,
  principal: Principal,
): Promise<EngineRule> {
  const fullRule: EngineRule = {
    ...rule,
    createdAt: new Date().toISOString(),
  };

  try {
    await db.query(
      `INSERT INTO engine_rules (
        id, tenant_id, policy_reference, description, severity,
        remediation, condition, status, created_from_ai, lineage,
        created_at, approved_at, approved_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        fullRule.id,
        principal.tenantId,
        fullRule.policyReference,
        fullRule.description,
        fullRule.severity,
        fullRule.remediation,
        JSON.stringify(fullRule.condition),
        fullRule.status,
        fullRule.createdFromAi,
        JSON.stringify(fullRule.lineage),
        fullRule.createdAt,
        fullRule.approvedAt ?? null,
        fullRule.approvedBy ?? null,
      ],
    );

    logger.info({ ruleId: fullRule.id, status: fullRule.status }, 'Rule created');
    return fullRule;
  } catch (err) {
    logger.error({ err, ruleId: fullRule.id }, 'Failed to create rule');
    throw new AppError('DATABASE_ERROR', 'Failed to create rule', 500);
  }
}

// Approve a rule: PROPOSED -> ACTIVE
// CRITICAL: This requires a human principal ID and is DB-enforced
export async function approveRule(
  ruleId: string,
  approver: Principal,
): Promise<EngineRule> {
  const rule = await getRuleById(ruleId, approver.tenantId);

  if (!rule) {
    throw new AppError('NOT_FOUND', `Rule not found: ${ruleId}`, 404);
  }

  // State machine enforcement
  if (rule.status !== 'PROPOSED') {
    throw new AppError(
      'RULE_STATE_TRANSITION_INVALID',
      `Cannot approve rule with status ${rule.status}. Only PROPOSED rules can be approved.`,
      400,
    );
  }

  const approvedAt = new Date().toISOString();

  try {
    await db.query(
      `UPDATE engine_rules 
       SET status = 'ACTIVE', approved_at = $1, approved_by = $2 
       WHERE id = $3 AND tenant_id = $4 AND status = 'PROPOSED'`,
      [approvedAt, approver.id, ruleId, approver.tenantId],
    );

    // Verify the update succeeded
    const updated = await getRuleById(ruleId, approver.tenantId);
    if (!updated || updated.status !== 'ACTIVE') {
      throw new AppError('DATABASE_ERROR', 'Failed to approve rule', 500);
    }

    await writeAuditEvent({
      eventType: 'RULE_APPROVED',
      tenantId: approver.tenantId,
      principalId: approver.id,
      correlationId: approver.correlationId,
      resourceType: 'EngineRule',
      resourceId: ruleId,
      outcome: 'SUCCESS',
      metadata: {
        previousStatus: 'PROPOSED',
        newStatus: 'ACTIVE',
      },
    });

    logger.info({ ruleId, approvedBy: approver.id }, 'Rule approved');
    return updated;
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.error({ err, ruleId }, 'Failed to approve rule');
    throw new AppError('DATABASE_ERROR', 'Failed to approve rule', 500);
  }
}

// Reject a rule: PROPOSED -> REJECTED
export async function rejectRule(
  ruleId: string,
  rejecter: Principal,
  reason?: string,
): Promise<EngineRule> {
  const rule = await getRuleById(ruleId, rejecter.tenantId);

  if (!rule) {
    throw new AppError('NOT_FOUND', `Rule not found: ${ruleId}`, 404);
  }

  if (rule.status !== 'PROPOSED') {
    throw new AppError(
      'RULE_STATE_TRANSITION_INVALID',
      `Cannot reject rule with status ${rule.status}. Only PROPOSED rules can be rejected.`,
      400,
    );
  }

  try {
    await db.query(
      `UPDATE engine_rules 
       SET status = 'REJECTED' 
       WHERE id = $1 AND tenant_id = $2`,
      [ruleId, rejecter.tenantId],
    );

    const updated = await getRuleById(ruleId, rejecter.tenantId);
    if (!updated) {
      throw new AppError('DATABASE_ERROR', 'Failed to reject rule', 500);
    }

    await writeAuditEvent({
      eventType: 'RULE_REJECTED',
      tenantId: rejecter.tenantId,
      principalId: rejecter.id,
      correlationId: rejecter.correlationId,
      resourceType: 'EngineRule',
      resourceId: ruleId,
      outcome: 'SUCCESS',
      metadata: { reason },
    });

    logger.info({ ruleId, reason }, 'Rule rejected');
    return updated;
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.error({ err, ruleId }, 'Failed to reject rule');
    throw new AppError('DATABASE_ERROR', 'Failed to reject rule', 500);
  }
}

// Deprecate a rule: ACTIVE -> DEPRECATED
export async function deprecateRule(
  ruleId: string,
  deprecator: Principal,
  reason?: string,
): Promise<EngineRule> {
  const rule = await getRuleById(ruleId, deprecator.tenantId);

  if (!rule) {
    throw new AppError('NOT_FOUND', `Rule not found: ${ruleId}`, 404);
  }

  if (rule.status !== 'ACTIVE') {
    throw new AppError(
      'RULE_STATE_TRANSITION_INVALID',
      `Cannot deprecate rule with status ${rule.status}. Only ACTIVE rules can be deprecated.`,
      400,
    );
  }

  try {
    await db.query(
      `UPDATE engine_rules 
       SET status = 'DEPRECATED' 
       WHERE id = $1 AND tenant_id = $2`,
      [ruleId, deprecator.tenantId],
    );

    const updated = await getRuleById(ruleId, deprecator.tenantId);
    if (!updated) {
      throw new AppError('DATABASE_ERROR', 'Failed to deprecate rule', 500);
    }

    logger.info({ ruleId, reason }, 'Rule deprecated');
    return updated;
  } catch (err) {
    logger.error({ err, ruleId }, 'Failed to deprecate rule');
    throw new AppError('DATABASE_ERROR', 'Failed to deprecate rule', 500);
  }
}

// Get ACTIVE rules for evaluation
export async function getActiveRules(
  tenantId: string,
  framework?: string,
): Promise<EngineRule[]> {
  let sql = "SELECT * FROM engine_rules WHERE tenant_id = $1 AND status = 'ACTIVE'";
  const params: (string | string[])[] = [tenantId];
  let paramIndex = 1;

  // Filter by framework if lineage contains framework info
  if (framework) {
    paramIndex++;
    sql += ` AND lineage->'documentIds' @> (
      SELECT jsonb_agg(id) FROM compliance_documents 
      WHERE tenant_id = $1 AND framework = $${paramIndex}
    )`;
    params.push(framework);
  }

  sql += ' ORDER BY severity DESC, created_at ASC';

  const result = await db.query<EngineRule>(sql, params);
  return result.rows;
}
