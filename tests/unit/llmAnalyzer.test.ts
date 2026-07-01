import { describe, it, expect, vi } from 'vitest';
import { analyzeCompliance } from '../../src/ai/llmAnalyzer.js';
import * as auditModule from '../../src/infra/audit.js';

describe('LLM Analyzer', () => {
  const mockPrincipal = {
    id: 'user-123',
    tenantId: 'tenant-123',
    correlationId: 'corr-123',
  };

  const mockContext = {
    chunks: [
      { id: 'chunk-1', documentId: 'doc-1', tenantId: 'tenant-123', chunkIndex: 0, text: 'Policy text', tags: [] }
    ],
    contextText: '[chunk-1]\nPolicy text',
    queryHash: 'abc123',
  };

  const mockState = {
    platform: 'AWS' as const,
    snapshotAt: new Date().toISOString(),
    snapshotVersion: '1.0.0',
    awsS3Buckets: [
      {
        bucketName: 'test-bucket',
        region: 'us-east-1',
        publicAccessBlockEnabled: false,
        blockPublicAcls: false,
        blockPublicPolicy: false,
        ignorePublicAcls: false,
        restrictPublicBuckets: false,
        encryptionEnabled: true,
        versioningEnabled: true,
        mfaDeleteEnabled: false,
        loggingEnabled: false,
      }
    ]
  };

  it('should throw LLM_INVALID_OUTPUT when model returns non-JSON', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'This is not JSON' } }] }),
    } as Response);
    vi.spyOn(auditModule, 'writeAuditEvent').mockResolvedValue({} as any);

    await expect(
      analyzeCompliance(mockContext, mockState, { principal: mockPrincipal })
    ).rejects.toMatchObject({ code: 'LLM_INVALID_OUTPUT' });
  });

  it('should throw LLM_SCHEMA_VIOLATION when output violates schema', async () => {
    const invalidOutput = JSON.stringify({
      violations: [{ id: 123 }] // id should be string, not number
    });
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: invalidOutput } }] }),
    } as Response);
    vi.spyOn(auditModule, 'writeAuditEvent').mockResolvedValue({} as any);

    await expect(
      analyzeCompliance(mockContext, mockState, { principal: mockPrincipal })
    ).rejects.toMatchObject({ code: 'LLM_SCHEMA_VIOLATION' });
  });
});
