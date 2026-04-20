// src/ai/embedding.ts
// Text embedding generation and batch processing

import type { DocumentChunk } from './types.js';
import { vectorStore } from '../infra/vectorStore.js';
import { secretsClient } from '../infra/secretsClient.js';
import { logger } from '../core/logger.js';
import { AppError } from '../core/errors.js';

// ── Configuration ───────────────────────────────────────────────
// Embedding model is intentionally separate from the reasoning model.
// This allows independent scaling, cost control, and lifecycle management.

const EMBEDDING_BATCH_SIZE = 64;
const EMBEDDING_DIMENSIONS = 1536; // adjust per model

interface EmbeddingClient {
  createEmbedding(inputs: string[]): Promise<{ embeddings: number[][] }>;
}

// Build embedding client based on provider
async function getEmbeddingClient(): Promise<EmbeddingClient> {
  const apiKey = await secretsClient.get('EMBEDDING_API_KEY');
  const model = process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small';
  const provider = process.env.EMBEDDING_PROVIDER ?? 'openai';
  
  if (provider === 'openai') {
    return buildOpenAIClient(apiKey, model);
  }
  
  if (provider === 'ollama') {
    return buildOllamaClient(apiKey, model);
  }
  
  throw new AppError('EMBEDDING_FAILED', `Unknown embedding provider: ${provider}`, 500);
}

function buildOpenAIClient(apiKey: string, model: string): EmbeddingClient {
  return {
    async createEmbedding(inputs: string[]): Promise<{ embeddings: number[][] }> {
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          input: inputs,
          encoding_format: 'float',
        }),
      });
      
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${error}`);
      }
      
      const data = await response.json() as {
        data: { embedding: number[] }[];
      };
      
      return {
        embeddings: data.data.map(d => d.embedding),
      };
    },
  };
}

function buildOllamaClient(_apiKey: string, model: string): EmbeddingClient {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
  
  return {
    async createEmbedding(inputs: string[]): Promise<{ embeddings: number[][] }> {
      const embeddings: number[][] = [];
      
      for (const input of inputs) {
        const response = await fetch(`${baseUrl}/api/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, prompt: input }),
        });
        
        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Ollama API error: ${response.status} - ${error}`);
        }
        
        const data = await response.json() as { embedding: number[] };
        embeddings.push(data.embedding);
      }
      
      return { embeddings };
    },
  };
}

export async function embedAndIndexChunks(
  chunks: DocumentChunk[],
  correlationId: string,
): Promise<void> {
  if (chunks.length === 0) return;

  const client = await getEmbeddingClient();

  // Process in batches to respect API rate limits
  for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBEDDING_BATCH_SIZE);
    const texts = batch.map((c) => c.text);

    let embeddings: number[][];
    try {
      const result = await client.createEmbedding(texts);
      embeddings = result.embeddings;
    } catch (err) {
      logger.error({ err, batchStart: i, correlationId }, 'Embedding API error');
      throw new AppError('EMBEDDING_FAILED', 'Failed to generate embeddings', 502);
    }

    if (embeddings.length !== batch.length) {
      throw new AppError(
        'EMBEDDING_COUNT_MISMATCH',
        'Embedding count does not match batch size',
        500,
      );
    }

    for (let j = 0; j < batch.length; j++) {
      const chunk = batch[j];
      const embedding = embeddings[j];

      if (!chunk || !embedding) {
        throw new AppError('EMBEDDING_FAILED', 'Chunk or embedding missing', 500);
      }

      // Validate embedding dimensions — reject mismatched models
      if (embedding.length !== EMBEDDING_DIMENSIONS) {
        throw new AppError(
          'EMBEDDING_DIMENSION_MISMATCH',
          `Expected ${EMBEDDING_DIMENSIONS} dimensions, got ${embedding.length}`,
          500,
        );
      }

      await vectorStore.upsert({
        id: chunk.id,
        tenantId: chunk.tenantId,
        embedding,
        metadata: {
          documentId: chunk.documentId,
          chunkIndex: chunk.chunkIndex,
          text: chunk.text,          // stored for retrieval (no re-fetch needed)
          sectionRef: chunk.sectionRef ?? null,
          tags: chunk.tags,
        },
      });
    }

    logger.info({ batchStart: i, batchEnd: i + batch.length - 1, correlationId }, 'Batch embedded');
  }
}

// Expose a single-text embedding for retrieval queries (no storage)
export async function embedQuery(query: string): Promise<number[]> {
  const client = await getEmbeddingClient();
  const result = await client.createEmbedding([query]);
  const embedding = result.embeddings[0];
  if (!embedding) {
    throw new AppError('EMBEDDING_FAILED', 'No embedding returned', 500);
  }
  return embedding;
}
