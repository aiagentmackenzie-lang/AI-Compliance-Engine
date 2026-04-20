// src/infra/vectorStore.ts
// pgvector wrapper with tenant isolation

import { db } from './db.js';
import { logger } from '../core/logger.js';
import { AppError } from '../core/errors.js';

export interface VectorMetadata {
  documentId: string;
  chunkIndex: number;
  text: string;
  sectionRef?: string | null;
  tags: string[];
}

export interface VectorUpsertItem {
  id: string;
  tenantId: string;
  embedding: number[];
  metadata: VectorMetadata;
}

export interface VectorQueryResult {
  id: string;
  score: number;
  metadata: VectorMetadata;
}

export interface VectorQueryParams {
  tenantId: string;
  embedding: number[];
  topK: number;
  filter?: Record<string, unknown> | undefined;
}

// Upsert a document chunk with its embedding
export async function upsert(item: VectorUpsertItem): Promise<void> {
  const { id, tenantId, embedding, metadata } = item;
  
  try {
    await db.query(
      `INSERT INTO document_chunks (id, tenant_id, document_id, chunk_index, text, section_ref, tags, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector)
       ON CONFLICT (id) DO UPDATE SET
         text = EXCLUDED.text,
         section_ref = EXCLUDED.section_ref,
         tags = EXCLUDED.tags,
         embedding = EXCLUDED.embedding`,
      [
        id,
        tenantId,
        metadata.documentId,
        metadata.chunkIndex,
        metadata.text,
        metadata.sectionRef ?? null,
        metadata.tags,
        JSON.stringify(embedding),
      ]
    );
    
    logger.debug({ chunkId: id, tenantId }, 'Vector upsert successful');
  } catch (err) {
    logger.error({ err, chunkId: id, tenantId }, 'Vector upsert failed');
    throw new AppError('VECTOR_STORE_ERROR', 'Failed to store embedding', 500, false);
  }
}

// Query similar vectors with tenant isolation
export async function query(params: VectorQueryParams): Promise<VectorQueryResult[]> {
  const { tenantId, embedding, topK, filter } = params;
  
  try {
    // Build the filter clause if tags are provided
    let filterClause = '';
    const filterParams: (string | string[])[] = [];
    
    if (filter?.['metadata.tags']) {
      const tagFilter = filter['metadata.tags'] as { $contains?: string; $containsAny?: string[] };
      
      if (tagFilter.$contains) {
        filterClause = 'AND $3::text = ANY(tags)';
        filterParams.push(tagFilter.$contains);
      } else if (tagFilter.$containsAny) {
        filterClause = 'AND tags && $3::text[]';
        filterParams.push(tagFilter.$containsAny);
      }
    }
    
    const sql = `
      SELECT 
        id,
        document_id as "documentId",
        chunk_index as "chunkIndex",
        text,
        section_ref as "sectionRef",
        tags,
        1 - (embedding <=> $1::vector) as score
      FROM document_chunks
      WHERE tenant_id = $2 ${filterClause}
      ORDER BY embedding <=> $1::vector
      LIMIT ${topK}
    `;
    
    const result = await db.query(
      sql,
      [JSON.stringify(embedding), tenantId, ...filterParams]
    );
    
    return result.rows.map(row => ({
      id: row.id,
      score: row.score,
      metadata: {
        documentId: row.documentId,
        chunkIndex: row.chunkIndex,
        text: row.text,
        sectionRef: row.sectionRef,
        tags: row.tags,
      },
    }));
  } catch (err) {
    logger.error({ err, tenantId }, 'Vector query failed');
    throw new AppError('VECTOR_STORE_ERROR', 'Failed to query embeddings', 500, false);
  }
}

// Delete vectors for a document
export async function deleteByDocumentId(documentId: string, tenantId: string): Promise<void> {
  try {
    await db.query(
      'DELETE FROM document_chunks WHERE document_id = $1 AND tenant_id = $2',
      [documentId, tenantId]
    );
    
    logger.debug({ documentId, tenantId }, 'Deleted document vectors');
  } catch (err) {
    logger.error({ err, documentId, tenantId }, 'Failed to delete document vectors');
    throw new AppError('VECTOR_STORE_ERROR', 'Failed to delete embeddings', 500, false);
  }
}

// Health check
export async function ping(): Promise<{ healthy: boolean }> {
  try {
    await db.query('SELECT 1');
    return { healthy: true };
  } catch {
    return { healthy: false };
  }
}

export const vectorStore = {
  upsert,
  query,
  deleteByDocumentId,
  ping,
};
