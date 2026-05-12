// src/infra/worker.ts
// BullMQ worker entry point for background processing

import { Worker, Job } from 'bullmq';
import { config } from '../core/config.js';
import { logger } from '../core/logger.js';
import { analyzeCompliance } from '../ai/llmAnalyzer.js';
import { generateRules } from '../ai/ruleGenerator.js';
import { findRelevantSections } from '../ai/retriever.js';
import { embedAndIndexChunks } from '../ai/embedding.js';
import { evaluateRules, type EvaluationResult } from '../compliance/engine.js';
import { generateReport } from '../compliance/evaluationReport.js';
import { createRule, getActiveRules } from '../compliance/ruleStore.js';
import { db } from '../infra/db.js';
import { writeAuditEvent } from '../infra/audit.js';
import type { DocumentJobData, EvaluationJobData, EmbeddingJobData } from './queue.js';

// Redis connection config
const redisConnection = {
  url: config.REDIS_URL,
};

// ─── Document processing worker ────────────────────────────────
async function processDocumentJob(job: Job<DocumentJobData>): Promise<void> {
  const { documentId, tenantId, correlationId } = job.data;

  logger.info({ jobId: job.id, documentId, correlationId }, 'Processing document job');

  // Fetch document metadata from DB
  const result = await db.query(
    'SELECT * FROM compliance_documents WHERE id = $1 AND tenant_id = $2',
    [documentId, tenantId],
  );

  if (result.rows.length === 0) {
    logger.error({ documentId, tenantId }, 'Document not found for processing');
    return;
  }

  // Mark document as processed
  logger.info({ documentId }, 'Document job completed');
}

// ─── Evaluation worker ─────────────────────────────────────────
async function processEvaluationJob(job: Job<EvaluationJobData>): Promise<void> {
  const { evaluationId, tenantId, systemId, framework, principalId, correlationId } = job.data;
  const principal = { id: principalId, tenantId, correlationId };

  logger.info({ jobId: job.id, evaluationId, correlationId }, 'Processing evaluation job');

  try {
    // Update status to IN_PROGRESS
    await db.query(
      'UPDATE evaluations SET status = $1, started_at = NOW() WHERE id = $2',
      ['IN_PROGRESS', evaluationId],
    );

    // Fetch the evaluation record for system state
    const evalResult = await db.query(
      'SELECT * FROM evaluations WHERE id = $1 AND tenant_id = $2',
      [evaluationId, tenantId],
    );

    if (evalResult.rows.length === 0) {
      logger.error({ evaluationId }, 'Evaluation not found');
      return;
    }

    const evaluation = evalResult.rows[0];
    const systemState = JSON.parse(evaluation.system_state);
    const frameworkVersion = evaluation.framework_version || '1.0.0';

    // Get active rules
    const rules = await getActiveRules(tenantId, framework);

    // If no rules exist, run AI analysis to propose rules
    if (rules.length === 0) {
      logger.info({ evaluationId }, 'No active rules found, running AI analysis');

      const context = await findRelevantSections({
        query: `Compliance requirements for ${framework} on ${systemState.platform}`,
        framework,
        principal,
      });

      const { result: analysisResult, llmMeta } = await analyzeCompliance(
        context,
        systemState,
        { principal },
      );

      if (analysisResult.violations.length > 0) {
        const generatedRules = await generateRules(analysisResult.violations, {
          documentIds: context.chunks.map((c) => c.documentId),
          chunkIds: context.chunks.map((c) => c.id),
          modelId: llmMeta.modelId,
          promptVersion: llmMeta.promptVersion,
          promptHash: llmMeta.promptHash,
          retrievalParams: { query: context.queryHash },
          principal,
        });

        for (const rule of generatedRules) {
          await createRule(rule, principal);
        }
      }
    }

    // Re-fetch active rules (now including any just proposed — they need approval first)
    const activeRules = await getActiveRules(tenantId, framework);
    const evaluationResult: EvaluationResult = evaluateRules(activeRules, systemState);

    // Generate report
    const report = generateReport(
      evaluationId,
      systemId,
      framework,
      frameworkVersion,
      systemState,
      evaluationResult,
    );

    // Store results
    await db.query(
      `UPDATE evaluations SET status = $1, overall_risk = $2, violations = $3,
       passed_rules = $4, failed_rules = $5, completed_at = NOW()
       WHERE id = $6`,
      [
        'COMPLETED',
        report.overallRisk,
        JSON.stringify(report.findings),
        report.summary.passed,
        report.summary.failed,
        evaluationId,
      ],
    );

    await writeAuditEvent({
      eventType: 'EVALUATION_COMPLETED',
      tenantId,
      principalId,
      correlationId,
      resourceType: 'Evaluation',
      resourceId: evaluationId,
      outcome: 'SUCCESS',
      metadata: { overallRisk: report.overallRisk, passed: report.summary.passed, failed: report.summary.failed },
    });

    logger.info({ evaluationId, overallRisk: report.overallRisk }, 'Evaluation completed');
  } catch (err) {
    logger.error({ err, evaluationId }, 'Evaluation job failed');

    await db.query(
      'UPDATE evaluations SET status = $1 WHERE id = $2',
      ['FAILED', evaluationId],
    );

    throw err; // Re-throw so BullMQ marks the job as failed for retry
  }
}

// ─── Embedding worker ──────────────────────────────────────────
async function processEmbeddingJob(job: Job<EmbeddingJobData>): Promise<void> {
  const { chunkIds, tenantId, correlationId } = job.data;

  logger.info({ jobId: job.id, chunkCount: chunkIds.length, correlationId }, 'Processing embedding job');

  // Fetch chunks from DB
  const result = await db.query(
    'SELECT * FROM document_chunks WHERE id = ANY($1) AND tenant_id = $2',
    [chunkIds, tenantId],
  );

  if (result.rows.length === 0) {
    logger.warn({ chunkIds, tenantId }, 'No chunks found for embedding');
    return;
  }

  const chunks = result.rows.map((row) => ({
    id: row.id,
    documentId: row.document_id,
    tenantId: row.tenant_id,
    chunkIndex: row.chunk_index,
    text: row.text,
    sectionRef: row.section_ref ?? undefined,
    tags: row.tags,
  }));

  await embedAndIndexChunks(chunks, correlationId);

  logger.info({ chunkCount: chunks.length, correlationId }, 'Embedding job completed');
}

// ─── Start workers ──────────────────────────────────────────────
async function startWorkers(): Promise<void> {
  logger.info('Starting background workers...');

  const documentWorker = new Worker<DocumentJobData>('document-processing', processDocumentJob, {
    connection: redisConnection,
    concurrency: 2,
  });

  const evaluationWorker = new Worker<EvaluationJobData>('evaluations', processEvaluationJob, {
    connection: redisConnection,
    concurrency: 1,
  });

  const embeddingWorker = new Worker<EmbeddingJobData>('embeddings', processEmbeddingJob, {
    connection: redisConnection,
    concurrency: 5,
  });

  for (const worker of [documentWorker, evaluationWorker, embeddingWorker]) {
    worker.on('failed', (job, err) => {
      logger.error({ jobId: job?.id, err: err.message }, 'Job failed');
    });

    worker.on('completed', (job) => {
      logger.info({ jobId: job.id }, 'Job completed');
    });
  }

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down workers...');
    await documentWorker.close();
    await evaluationWorker.close();
    await embeddingWorker.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  logger.info('Background workers started');
}

startWorkers().catch((err) => {
  logger.error({ err }, 'Failed to start workers');
  process.exit(1);
});