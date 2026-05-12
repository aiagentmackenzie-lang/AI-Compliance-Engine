// src/infra/parserWorker.ts
// Dedicated parser worker entry point for sandboxed document processing
// This runs in an isolated container with minimal privileges

import { Worker, Job } from 'bullmq';
import { logger } from '../core/logger.js';
import { parseDocument } from '../ai/docParser.js';
import type { ComplianceDocument } from '../ai/types.js';

interface ParserJobData {
  documentId: string;
  tenantId: string;
  filePath: string;
  mimeType: string;
  principalId: string;
  correlationId: string;
  fileBufferBase64: string;
}

async function processParserJob(job: Job<ParserJobData>): Promise<void> {
  const { documentId, tenantId, mimeType, principalId, correlationId, fileBufferBase64 } = job.data;

  logger.info({ jobId: job.id, documentId, mimeType, correlationId }, 'Processing document parse job');

  const fileBuffer = Buffer.from(fileBufferBase64, 'base64');
  const principal = { id: principalId, tenantId, correlationId };

  // Fetch document metadata from DB
  const { db } = await import('./db.js');
  const result = await db.query(
    'SELECT * FROM compliance_documents WHERE id = $1 AND tenant_id = $2',
    [documentId, tenantId],
  );

  if (result.rows.length === 0) {
    throw new Error(`Document not found: ${documentId}`);
  }

  const doc = result.rows[0] as ComplianceDocument;

  try {
    const chunks = await parseDocument(doc, fileBuffer, mimeType, { principal });
    logger.info({ documentId, chunkCount: chunks.length, correlationId }, 'Document parsed successfully');

    // Queue embedding job for the parsed chunks
    const { queueEmbedding } = await import('./queue.js');
    await queueEmbedding({
      chunkIds: chunks.map((c) => c.id),
      tenantId,
      correlationId,
    });

    logger.info({ documentId, correlationId }, 'Embedding job queued');
  } catch (err) {
    logger.error({ err, documentId, correlationId }, 'Document parsing failed');
    throw err;
  }
}

async function startParserWorker(): Promise<void> {
  logger.info('Starting parser worker...');

  const redisConnection = {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  };

  const parserWorker = new Worker<ParserJobData>('document-processing', processParserJob, {
    connection: redisConnection,
    concurrency: 1, // Parse one document at a time for safety
  });

  parserWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, 'Parser job failed');
  });

  parserWorker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Parser job completed');
  });

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down parser worker...');
    await parserWorker.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  logger.info('Parser worker started');
}

startParserWorker().catch((err) => {
  logger.error({ err }, 'Failed to start parser worker');
  process.exit(1);
});