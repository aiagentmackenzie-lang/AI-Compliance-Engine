// src/ai/retriever.ts
// ACL-enforced similarity search with context assembly

import type { DocumentChunk } from './types.js';
import { vectorStore } from '../infra/vectorStore.js';
import { embedQuery } from './embedding.js';
import { writeAuditEvent } from '../infra/audit.js';
import crypto from 'node:crypto';

export interface RetrievalParams {
  query: string;
  framework?: string;
  tags?: string[];
  maxResults?: number;
  minSimilarity?: number;  // 0.0–1.0; chunks below this threshold are excluded
  principal: {
    id: string;
    tenantId: string;
    correlationId: string;
  };
}

export interface RetrievedContext {
  chunks: DocumentChunk[];
  contextText: string;           // assembled policy context for prompt injection
  queryHash: string;             // SHA-256 of the query (for audit; never the raw query)
}

export async function findRelevantSections(
  params: RetrievalParams,
): Promise<RetrievedContext> {
  const {
    query,
    framework,
    tags,
    maxResults = 8,
    minSimilarity = 0.72,
    principal,
  } = params;

  const queryEmbedding = await embedQuery(query);
  const queryHash = crypto.createHash('sha256').update(query).digest('hex');

  const filter: Record<string, unknown> = {};
  if (framework || tags?.length) {
    const tagFilters: string[] = [];
    if (framework) tagFilters.push(framework.toLowerCase());
    if (tags) tagFilters.push(...tags);
    
    if (tagFilters.length > 0) {
      filter['metadata.tags'] = { $containsAny: tagFilters };
    }
  }

  const rawResults = await vectorStore.query({
    tenantId: principal.tenantId, // ACL enforcement at query time — mandatory
    embedding: queryEmbedding,
    topK: maxResults * 2,         // over-fetch then filter by similarity threshold
    filter: Object.keys(filter).length > 0 ? filter : undefined,
  });

  // Apply similarity threshold to eliminate low-quality matches
  const filtered = rawResults
    .filter((r) => r.score >= minSimilarity)
    .slice(0, maxResults);

  const chunks: DocumentChunk[] = filtered.map((r) => ({
    id: r.id,
    documentId: r.metadata.documentId,
    tenantId: principal.tenantId,
    chunkIndex: r.metadata.chunkIndex,
    text: r.metadata.text,
    sectionRef: r.metadata.sectionRef ?? undefined,
    tags: r.metadata.tags,
  }));

  // Assemble context text with section references for grounding
  const contextText = chunks
    .map((c) => `[${c.sectionRef ?? c.id}]\n${c.text}`)
    .join('\n\n---\n\n');

  await writeAuditEvent({
    eventType: 'RETRIEVAL_PERFORMED',
    tenantId: principal.tenantId,
    principalId: principal.id,
    correlationId: principal.correlationId,
    resourceType: 'VectorStore',
    resourceId: `query:${queryHash}`,
    outcome: 'SUCCESS',
    metadata: {
      queryHash,            // never log the raw query — it may contain sensitive terms
      framework: framework ?? null,
      chunkCount: chunks.length,
      minSimilarity,
    },
  });

  return { chunks, contextText, queryHash };
}
