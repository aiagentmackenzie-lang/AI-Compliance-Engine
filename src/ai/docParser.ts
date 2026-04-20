// src/ai/docParser.ts
// Sandboxed PDF/DOCX extraction with chunking and metadata tagging

import type { DocumentChunk, ComplianceDocument, Framework } from './types.js';
import { AppError } from '../core/errors.js';
import { writeAuditEvent } from '../infra/audit.js';
import { logger } from '../core/logger.js';
import crypto from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_CHUNK_TOKENS = 800;
const CHUNK_OVERLAP_TOKENS = 80;
const CHARS_PER_TOKEN = 4;

interface ParseOptions {
  principal: { id: string; tenantId: string; correlationId: string };
}

export async function parseDocument(
  doc: ComplianceDocument,
  fileBuffer: Buffer,
  mimeType: string,
  options: ParseOptions,
): Promise<DocumentChunk[]> {
  // ── Input validation ──────────────────────────────────────────
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new AppError('INVALID_MIME_TYPE', `Rejected mime type: ${mimeType}`, 400);
  }
  if (fileBuffer.byteLength > MAX_FILE_SIZE_BYTES) {
    throw new AppError(
      'FILE_TOO_LARGE',
      `File exceeds ${MAX_FILE_SIZE_BYTES} bytes`,
      400,
    );
  }

  // ── Verify checksum integrity ─────────────────────────────────
  const actualChecksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');
  if (actualChecksum !== doc.checksum) {
    throw new AppError(
      'CHECKSUM_MISMATCH',
      'File checksum does not match declared checksum',
      400,
    );
  }

  logger.info(
    { docId: doc.id, mimeType, bytes: fileBuffer.byteLength },
    'Parsing document',
  );

  // ── Extract text (runs in isolated worker via worker_threads) ─
  const rawText = await extractTextInWorker(fileBuffer, mimeType);
  const cleanText = normalizeWhitespace(rawText);

  // ── Chunk by heading with overlap ────────────────────────────
  const rawChunks = chunkWithOverlap(cleanText, MAX_CHUNK_TOKENS, CHUNK_OVERLAP_TOKENS);

  const chunks: DocumentChunk[] = rawChunks.map((chunk, index) => ({
    id: `${doc.id}:${index}`,
    documentId: doc.id,
    tenantId: doc.tenantId,
    chunkIndex: index,
    text: chunk.text,
    sectionRef: chunk.sectionRef,
    tags: inferTags(chunk.text, doc.framework),
  }));

  await writeAuditEvent({
    eventType: 'DOCUMENT_PARSED',
    tenantId: options.principal.tenantId,
    principalId: options.principal.id,
    correlationId: options.principal.correlationId,
    resourceType: 'ComplianceDocument',
    resourceId: doc.id,
    outcome: 'SUCCESS',
    metadata: { chunkCount: chunks.length, bytes: fileBuffer.byteLength },
  });

  return chunks;
}

// ── Helpers ────────────────────────────────────────────────────────

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface RawChunk {
  text: string;
  sectionRef?: string;
}

function chunkWithOverlap(
  text: string,
  maxTokens: number,
  overlap: number,
): RawChunk[] {
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  const overlapChars = overlap * CHARS_PER_TOKEN;

  // Pattern for section headings: markdown headers or ALL CAPS headings
  const sectionPattern = /^(#+\s.+|(?:[A-Z][A-Z ]{3,})\n)/gm;
  const sections: RawChunk[] = [];
  let lastIndex = 0;
  let lastSectionRef: string | undefined;

  for (const match of text.matchAll(sectionPattern)) {
    if (match.index !== undefined && match.index > lastIndex) {
      const sectionText = text.slice(lastIndex, match.index).trim();
      if (sectionText) {
        sections.push({
          text: sectionText,
          sectionRef: lastSectionRef,
        });
      }
    }
    lastSectionRef = match[0].slice(0, 128).trim();
    lastIndex = match.index ?? lastIndex;
  }

  // Add final section
  const finalText = text.slice(lastIndex).trim();
  if (finalText) {
    sections.push({
      text: finalText,
      sectionRef: lastSectionRef,
    });
  }

  const chunks: RawChunk[] = [];
  for (const section of sections) {
    if (!section.text) continue;
    if (section.text.length <= maxChars) {
      chunks.push(section);
      continue;
    }
    // Split large sections with sliding window + overlap
    let start = 0;
    while (start < section.text.length) {
      const end = Math.min(start + maxChars, section.text.length);
      chunks.push({
        text: section.text.slice(start, end),
        sectionRef: section.sectionRef,
      });
      start += maxChars - overlapChars;
      if (start >= section.text.length) break;
    }
  }

  return chunks.filter((c) => c.text.length > 50);
}

const TAG_PATTERNS: Record<string, RegExp> = {
  iam: /\b(iam|role|permission|access key|policy|privilege)\b/i,
  s3: /\b(s3|bucket|object storage|blob)\b/i,
  encryption: /\b(encrypt|kms|tls|ssl|cipher|at\.rest|in\.transit)\b/i,
  logging: /\b(log|audit trail|cloudtrail|siem|monitoring)\b/i,
  network: /\b(vpc|firewall|security group|nsg|ingress|egress|port)\b/i,
  linux: /\b(linux|ubuntu|centos|sshd|auditd|sudoers|cron)\b/i,
  kubernetes: /\b(kubernetes|k8s|pod|namespace|rbac|admission)\b/i,
  password: /\b(password|mfa|multi\.factor|authentication|credential)\b/i,
};

function inferTags(text: string, framework: Framework): string[] {
  const tags: string[] = [framework.toLowerCase()];
  for (const [tag, pattern] of Object.entries(TAG_PATTERNS)) {
    if (pattern.test(text)) tags.push(tag);
  }
  return [...new Set(tags)];
}

// Worker isolation — parsing untrusted PDFs must never run in the main process
async function extractTextInWorker(buffer: Buffer, mimeType: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const workerPath = join(__dirname, 'docParser.worker.js');
    
    const worker = new Worker(workerPath, {
      workerData: {
        buffer: buffer.toString('base64'),
        mimeType,
      },
    });

    worker.on('message', (result) => {
      if (result.success) {
        resolve(result.text);
      } else {
        reject(new AppError('DOCUMENT_PARSE_ERROR', result.error, 500));
      }
    });

    worker.on('error', (err) => {
      logger.error({ err }, 'Worker thread error');
      reject(new AppError('DOCUMENT_PARSE_ERROR', 'Worker thread failed', 500));
    });

    worker.on('exit', (code) => {
      if (code !== 0) {
        reject(new AppError('DOCUMENT_PARSE_ERROR', `Worker exited with code ${code}`, 500));
      }
    });
  });
}
