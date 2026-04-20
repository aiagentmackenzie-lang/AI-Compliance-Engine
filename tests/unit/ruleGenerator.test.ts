import { describe, it, expect, vi } from 'vitest';
import { generateRules, ConditionType } from '../../src/ai/ruleGenerator.js';
import { AiViolation } from '../../src/ai/types.js';
import * as auditModule from '../../src/infra/audit.js';

describe('Rule Generator', () => {
  const mockPrincipal = {
    id: 'user-123',
    tenantId: 'tenant-123',
    correlationId: 'corr-123',
  };

  const mockViolation: AiViolation = {
    id: 'cis-aws-s3-public-access-2-1-1',
    policyReference: 'CIS AWS 2.1.1',
    retrievedChunkIds: ['doc-12345:0'],
    title: 'S3 Public Access',
    description: 'S3 bucket has public access enabled',
    severity: 'HIGH',
    reasoning: 'BlockPublicPolicy is false',
    remediation: 'Enable BlockPublicPolicy',
    affectedAssets: ['my-bucket'],
    confidence: 'HIGH',
  };

  it('should set status to PROPOSED, never ACTIVE', async () => {
    vi.spyOn(auditModule, 'writeAuditEvent').mockResolvedValue({} as any);

    const rules = await generateRules([mockViolation], {
      documentIds: ['550e8400-e29b-41d4-a716-446655440000'],
      chunkIds: ['doc-12345:0'],
      modelId: 'gpt-4',
      promptVersion: '1.0.0',
      promptHash: 'abc123',
      retrievalParams: {},
      principal: mockPrincipal,
    });

    expect(rules.length).toBe(1);
    expect(rules[0].status).toBe('PROPOSED');
    expect(rules[0].status).not.toBe('ACTIVE');
  });

  it('should populate full lineage on each rule', async () => {
    vi.spyOn(auditModule, 'writeAuditEvent').mockResolvedValue({} as any);

    const rules = await generateRules([mockViolation], {
      documentIds: ['550e8400-e29b-41d4-a716-446655440000'],
      chunkIds: ['doc-12345:0'],
      modelId: 'gpt-4',
      promptVersion: '1.0.0',
      promptHash: 'abc123',
      retrievalParams: { query: 'test' },
      principal: mockPrincipal,
    });

    expect(rules[0].lineage.documentIds).toEqual(['550e8400-e29b-41d4-a716-446655440000']);
    expect(rules[0].lineage.chunkIds).toEqual(['doc-12345:0']);
    expect(rules[0].lineage.modelId).toBe('gpt-4');
    expect(rules[0].lineage.promptVersion).toBe('1.0.0');
    expect(rules[0].lineage.promptHash).toBe('abc123');
  });

  it('should map S3 violations to S3_PUBLIC_ACCESS_FORBIDDEN condition', async () => {
    vi.spyOn(auditModule, 'writeAuditEvent').mockResolvedValue({} as any);

    const rules = await generateRules([mockViolation], {
      documentIds: ['550e8400-e29b-41d4-a716-446655440000'],
      chunkIds: ['doc-12345:0'],
      modelId: 'gpt-4',
      promptVersion: '1.0.0',
      promptHash: 'abc123',
      retrievalParams: {},
      principal: mockPrincipal,
    });

    const condition = rules[0].condition as ConditionType;
    expect(condition.type).toBe('S3_PUBLIC_ACCESS_FORBIDDEN');
  });
});
