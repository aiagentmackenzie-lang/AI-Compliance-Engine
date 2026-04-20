// src/ai/ruleGenerator.ts
// AiViolation → EngineRule mapping with full lineage tracking

import type { AiViolation, EngineRule } from './types.js';
import { EngineRuleSchema } from './types.js';
import { writeAuditEvent } from '../infra/audit.js';
import { logger } from '../core/logger.js';
import crypto from 'node:crypto';

interface RuleGenerationOptions {
  documentIds: string[];
  chunkIds: string[];
  modelId: string;
  promptVersion: string;
  promptHash: string;
  retrievalParams: Record<string, unknown>;
  principal: { id: string; tenantId: string; correlationId: string };
}

export async function generateRules(
  violations: AiViolation[],
  options: RuleGenerationOptions,
): Promise<EngineRule[]> {
  const rules: EngineRule[] = violations.map((v) => {
    const rule: EngineRule = {
      id: v.id,
      policyReference: v.policyReference,
      description: v.description,
      severity: v.severity,
      remediation: v.remediation,
      condition: mapToEngineCondition(v),
      status: 'PROPOSED',          // NEVER auto-activate AI-generated rules
      createdFromAi: true,
      lineage: {
        documentIds: options.documentIds,
        chunkIds: options.chunkIds,
        modelId: options.modelId,
        promptVersion: options.promptVersion,
        promptHash: options.promptHash,
        retrievalParams: options.retrievalParams,
      },
      createdAt: new Date().toISOString(),
    };

    // Validate the generated rule against the schema before persisting
    const parsed = EngineRuleSchema.safeParse(rule);
    if (!parsed.success) {
      logger.warn(
        { violationId: v.id, issues: parsed.error.issues },
        'Generated rule failed schema validation',
      );
      throw new Error(`Rule generation produced invalid schema for violation ${v.id}`);
    }

    return parsed.data;
  });

  await writeAuditEvent({
    eventType: 'RULE_GENERATED',
    tenantId: options.principal.tenantId,
    principalId: options.principal.id,
    correlationId: options.principal.correlationId,
    resourceType: 'EngineRule',
    resourceId: `batch:${crypto.randomUUID()}`,
    outcome: 'SUCCESS',
    metadata: { ruleCount: rules.length, ruleIds: rules.map((r) => r.id) },
  });

  return rules;
}

// ── Condition mapping ──────────────────────────────────────────────
// Translates an AiViolation into a structured condition object that
// the compliance engine (or OPA) can evaluate deterministically.
// Add new condition types as new platforms and controls are supported.

export type ConditionType =
  | { type: 'S3_PUBLIC_ACCESS_FORBIDDEN'; buckets: string[] }
  | { type: 'IAM_ADMIN_ROLE_RESTRICTED'; roles: string[] }
  | { type: 'LINUX_SSH_PASSWORD_AUTH_DISABLED'; hosts: string[] }
  | { type: 'LINUX_AUDITD_ENABLED'; hosts: string[] }
  | { type: 'GENERIC'; assets: string[]; hint: string };

function mapToEngineCondition(v: AiViolation): ConditionType {
  const id = v.id.toLowerCase();
  const assets = v.affectedAssets;

  if (id.includes('s3') && id.includes('public')) {
    return { type: 'S3_PUBLIC_ACCESS_FORBIDDEN', buckets: assets };
  }
  if (id.includes('iam') && (id.includes('admin') || id.includes('privilege'))) {
    return { type: 'IAM_ADMIN_ROLE_RESTRICTED', roles: assets };
  }
  if (id.includes('ssh') && id.includes('password')) {
    return { type: 'LINUX_SSH_PASSWORD_AUTH_DISABLED', hosts: assets };
  }
  if (id.includes('auditd')) {
    return { type: 'LINUX_AUDITD_ENABLED', hosts: assets };
  }

  return { type: 'GENERIC', assets, hint: v.title };
}
