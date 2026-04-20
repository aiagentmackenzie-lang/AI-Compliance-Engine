import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findRelevantSections } from '../../src/ai/retriever.js';
import * as embeddingModule from '../../src/ai/embedding.js';
import * as vectorStoreModule from '../../src/infra/vectorStore.js';
import * as auditModule from '../../src/infra/audit.js';

describe('Retriever', () => {
  const mockPrincipal = {
    id: 'user-123',
    tenantId: 'tenant-123',
    correlationId: 'corr-123',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should return chunks filtered by similarity threshold', async () => {
    // Mock embedding
    vi.spyOn(embeddingModule, 'embedQuery').mockResolvedValue([0.1, 0.2, 0.3]);

    // Mock vector store query
    vi.spyOn(vectorStoreModule.vectorStore, 'query').mockResolvedValue([
      { id: 'chunk-1', score: 0.85, metadata: { documentId: 'doc-1', chunkIndex: 0, text: 'High relevance text', tags: [] } },
      { id: 'chunk-2', score: 0.60, metadata: { documentId: 'doc-1', chunkIndex: 1, text: 'Low relevance text', tags: [] } },
    ]);

    // Mock audit write
    vi.spyOn(auditModule, 'writeAuditEvent').mockResolvedValue({} as any);

    const result = await findRelevantSections({
      query: 'test query',
      principal: mockPrincipal,
      minSimilarity: 0.72,
    });

    // Should only return chunks above threshold
    expect(result.chunks.length).toBe(1);
    expect(result.chunks[0].id).toBe('chunk-1');
  });

  it('should hash query for audit logging', async () => {
    vi.spyOn(embeddingModule, 'embedQuery').mockResolvedValue([0.1]);
    vi.spyOn(vectorStoreModule.vectorStore, 'query').mockResolvedValue([]);
    const auditSpy = vi.spyOn(auditModule, 'writeAuditEvent').mockResolvedValue({} as any);

    await findRelevantSections({
      query: 'sensitive query with passwords',
      principal: mockPrincipal,
    });

    // Verify audit was called with hashed query
    const auditCall = auditSpy.mock.calls[0][0];
    expect(auditCall.metadata.queryHash).toBeDefined();
    expect(auditCall.metadata.queryHash).not.toContain('sensitive');
    expect(auditCall.metadata.queryHash).not.toContain('passwords');
  });
});
