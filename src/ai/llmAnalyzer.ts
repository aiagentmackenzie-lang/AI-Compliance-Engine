// src/ai/llmAnalyzer.ts
// Structured LLM analysis with Zod-validated JSON output

import { z } from 'zod';
import type { AiAnalysisResult, SystemState } from './types.js';
import { AiAnalysisResultSchema } from './types.js';
import type { RetrievedContext } from './retriever.js';
import { getPromptTemplate } from './promptTemplates.js';
import { secretsClient } from '../infra/secretsClient.js';
import { writeAuditEvent } from '../infra/audit.js';
import { AppError } from '../core/errors.js';
import { logger } from '../core/logger.js';
import crypto from 'node:crypto';

interface AnalysisOptions {
  principal: { id: string; tenantId: string; correlationId: string };
  modelId?: string;
  promptVersion?: string;
}

interface LlmCallResult {
  rawOutput: string;
  modelId: string;
  promptHash: string;
  promptVersion: string;
  latencyMs: number;
}

export async function analyzeCompliance(
  context: RetrievedContext,
  systemState: SystemState,
  options: AnalysisOptions,
): Promise<{ result: AiAnalysisResult; llmMeta: LlmCallResult }> {
  const { principal } = options;
  const modelId = options.modelId ?? 'gpt-4o-2024-08-06';
  const promptVersion = options.promptVersion ?? '1.0.0';

  // ── Build structured prompt ─────────────────────────────────
  const template = getPromptTemplate(promptVersion);
  const renderedPrompt = template.render({
    policyContext: context.contextText,
    systemState: sanitizeSystemState(systemState),
  });
  const promptHash = crypto.createHash('sha256').update(renderedPrompt).digest('hex');

  // ── Call the reasoning model ────────────────────────────────
  const apiKey = await secretsClient.get('REASONING_MODEL_API_KEY');
  const startMs = Date.now();

  let rawOutput: string;
  try {
    rawOutput = await callReasoningModel(renderedPrompt, modelId, apiKey);
  } catch (err) {
    logger.error({ err, modelId, correlationId: principal.correlationId }, 'LLM call failed');
    throw new AppError('LLM_UNAVAILABLE', 'Reasoning model returned an error', 502);
  }

  const latencyMs = Date.now() - startMs;

  // ── Parse and validate output ───────────────────────────────
  // Fail closed: any non-conforming output is rejected entirely.
  let parsed: unknown;
  try {
    // Strip any markdown code fences the model may have added despite instructions
    const stripped = rawOutput
      .replace(/^```(?:json)?\n?/m, '')
      .replace(/\n?```$/m, '')
      .trim();
    parsed = JSON.parse(stripped);
  } catch {
    logger.warn(
      { promptHash, correlationId: principal.correlationId },
      'LLM returned non-JSON output',
    );
    throw new AppError('LLM_INVALID_OUTPUT', 'Model output was not valid JSON', 500);
  }

  let result: AiAnalysisResult;
  try {
    result = AiAnalysisResultSchema.parse(parsed);
  } catch (err) {
    if (err instanceof z.ZodError) {
      logger.warn({ issues: err.issues, promptHash }, 'LLM output failed schema validation');
    }
    throw new AppError(
      'LLM_SCHEMA_VIOLATION',
      'Model output did not conform to expected schema',
      500,
    );
  }

  // ── Attach chunk traceability to each violation ─────────────
  for (const violation of result.violations) {
    violation.retrievedChunkIds = context.chunks.map((c) => c.id);
  }

  const llmMeta: LlmCallResult = {
    rawOutput,
    modelId,
    promptHash,
    promptVersion,
    latencyMs,
  };

  await writeAuditEvent({
    eventType: 'AI_ANALYSIS_COMPLETED',
    tenantId: principal.tenantId,
    principalId: principal.id,
    correlationId: principal.correlationId,
    resourceType: 'AiAnalysis',
    resourceId: promptHash,
    outcome: 'SUCCESS',
    metadata: {
      modelId,
      promptVersion,
      promptHash,
      violationCount: result.violations.length,
      latencyMs,
    },
  });

  return { result, llmMeta };
}

// Remove values that should not appear in the prompt for security or privacy reasons.
// Keep only the fields relevant to the analysis query — do not dump the entire state object.
function sanitizeSystemState(state: SystemState): Partial<SystemState> {
  // Future: add field-level redaction based on tenant data classification policy
  const { snapshotAt, snapshotVersion, platform } = state;
  return {
    snapshotAt,
    snapshotVersion,
    platform,
    awsS3Buckets: state.awsS3Buckets,
    iamRoles: state.iamRoles,
    linuxHosts: state.linuxHosts,
  };
}

async function callReasoningModel(
  prompt: string,
  modelId: string,
  apiKey: string,
): Promise<string> {
  const provider = process.env.REASONING_PROVIDER ?? 'openai';
  
  if (provider === 'openai') {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: 'user', content: prompt },
        ],
        temperature: 0, // Deterministic output
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      choices: { message: { content: string } }[];
    };

    return data.choices[0]?.message?.content ?? '';
  }

  if (provider === 'ollama') {
    const baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        options: { temperature: 0 },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as { message: { content: string } };
    return data.message?.content ?? '';
  }

  throw new Error(`Unknown reasoning provider: ${provider}`);
}
