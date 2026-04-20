// src/infra/queue.ts
// BullMQ job queues for background processing

import { Queue, Job } from 'bullmq';
import { config } from '../core/config.js';
import { logger } from '../core/logger.js';

// Redis connection config
const redisConnection = {
  url: config.REDIS_URL,
};

// Job queues
export const documentQueue = new Queue('document-processing', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});

export const evaluationQueue = new Queue('evaluations', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'fixed',
      delay: 5000,
    },
    removeOnComplete: 50,
    removeOnFail: 20,
  },
});

export const embeddingQueue = new Queue('embeddings', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: 200,
    removeOnFail: 50,
  },
});

// Job types
export interface DocumentJobData {
  documentId: string;
  tenantId: string;
  filePath: string;
  mimeType: string;
  principalId: string;
  correlationId: string;
}

export interface EvaluationJobData {
  evaluationId: string;
  tenantId: string;
  systemId: string;
  framework: string;
  principalId: string;
  correlationId: string;
}

export interface EmbeddingJobData {
  chunkIds: string[];
  tenantId: string;
  correlationId: string;
}

// Add job to document queue
export async function queueDocumentProcessing(
  data: DocumentJobData,
): Promise<Job<DocumentJobData>> {
  const job = await documentQueue.add('process-document', data, {
    jobId: `doc-${data.documentId}`,
  });
  logger.info({ jobId: job.id, documentId: data.documentId }, 'Document job queued');
  return job;
}

// Add job to evaluation queue
export async function queueEvaluation(
  data: EvaluationJobData,
): Promise<Job<EvaluationJobData>> {
  const job = await evaluationQueue.add('run-evaluation', data, {
    jobId: `eval-${data.evaluationId}`,
  });
  logger.info({ jobId: job.id, evaluationId: data.evaluationId }, 'Evaluation job queued');
  return job;
}

// Add job to embedding queue
export async function queueEmbedding(
  data: EmbeddingJobData,
): Promise<Job<EmbeddingJobData>> {
  const job = await embeddingQueue.add('generate-embeddings', data);
  logger.info({ jobId: job.id, chunkCount: data.chunkIds.length }, 'Embedding job queued');
  return job;
}

// Queue health check
export async function checkQueueHealth(): Promise<{ healthy: boolean; queues: string[] }> {
  try {
    const queues = [documentQueue, evaluationQueue, embeddingQueue];
    const queueNames: string[] = [];
    
    for (const queue of queues) {
      await queue.getJobCounts();
      queueNames.push(queue.name);
    }
    
    return { healthy: true, queues: queueNames };
  } catch (err) {
    logger.error({ err }, 'Queue health check failed');
    return { healthy: false, queues: [] };
  }
}

// Graceful shutdown
export async function closeQueues(): Promise<void> {
  await documentQueue.close();
  await evaluationQueue.close();
  await embeddingQueue.close();
  logger.info('Queues closed');
}
