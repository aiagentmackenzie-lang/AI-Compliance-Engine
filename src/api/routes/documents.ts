// src/api/routes/documents.ts
// POST /documents, GET /documents/:id

import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { z } from 'zod';
import crypto from 'node:crypto';
import type { ComplianceDocument } from '../../ai/types.js';
import { parseDocument } from '../../ai/docParser.js';
import { embedAndIndexChunks } from '../../ai/embedding.js';
import { AppError } from '../../core/errors.js';
import { writeAuditEvent } from '../../infra/audit.js';
import { logger } from '../../core/logger.js';
import { db } from '../../infra/db.js';
import { requireSecurityEngineer } from '../middleware/auth.js';

const UploadDocumentSchema = z.object({
  framework: z.enum([
    'CIS_AWS',
    'CIS_LINUX',
    'CIS_KUBERNETES',
    'NIST_CSF',
    'ISO_27001',
    'ISO_42001',
    'INTERNAL',
    'OTHER',
  ]),
  frameworkVersion: z.string().max(64),
  title: z.string().min(1).max(512),
  checksum: z.string().length(64), // SHA-256 hex
});

export async function documentsRoutes(fastify: FastifyInstance): Promise<void> {
  // Register multipart plugin for file uploads
  await fastify.register(multipart, {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB
    },
  });

  // POST /documents - Upload and parse a compliance document
  fastify.post('/', {
    preHandler: [requireSecurityEngineer],
  }, async (request, reply) => {
    const { principal } = request;
    
    // Parse multipart form data
    const parts = request.parts();
    let fileBuffer: Buffer | null = null;
    let mimeType = '';
    let metadata: { framework: string; frameworkVersion: string; title: string; checksum: string } | null = null;
    
    for await (const part of parts) {
      if (part.type === 'file') {
        fileBuffer = await part.toBuffer();
        mimeType = part.mimetype;
      } else if (part.fieldname === 'metadata') {
        const raw = typeof part.value === 'string' ? JSON.parse(part.value) : part.value;
        metadata = UploadDocumentSchema.parse(raw);
      }
    }
    
    if (!fileBuffer || !metadata) {
      throw new AppError('VALIDATION_ERROR', 'Missing file or metadata', 400);
    }
    
    // Verify checksum
    const actualChecksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    if (actualChecksum !== metadata.checksum) {
      throw new AppError('CHECKSUM_MISMATCH', 'File checksum does not match', 400);
    }
    
    // Create document record
    const document: ComplianceDocument = {
      id: crypto.randomUUID(),
      tenantId: principal.tenantId,
      title: metadata.title,
      framework: metadata.framework as ComplianceDocument['framework'],
      frameworkVersion: metadata.frameworkVersion,
      sourcePath: `uploads/${principal.tenantId}/${actualChecksum}`,
      checksum: actualChecksum,
      createdAt: new Date().toISOString(),
      createdBy: principal.id,
    };
    
    // Store document metadata
    await db.query(
      `INSERT INTO compliance_documents (id, tenant_id, title, framework, framework_version, source_path, checksum, created_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        document.id,
        document.tenantId,
        document.title,
        document.framework,
        document.frameworkVersion,
        document.sourcePath,
        document.checksum,
        document.createdAt,
        document.createdBy,
      ]
    );
    
    await writeAuditEvent({
      eventType: 'DOCUMENT_UPLOADED',
      tenantId: principal.tenantId,
      principalId: principal.id,
      correlationId: principal.correlationId,
      resourceType: 'ComplianceDocument',
      resourceId: document.id,
      outcome: 'SUCCESS',
      metadata: { size: fileBuffer.length, mimeType },
    });
    
    // Parse document in background
    // Note: In production, this should be queued via BullMQ
    setImmediate(async () => {
      try {
        const chunks = await parseDocument(document, fileBuffer!, mimeType, {
          principal: {
            id: principal.id,
            tenantId: principal.tenantId,
            correlationId: principal.correlationId,
          },
        });
        
        // Generate embeddings and index
        await embedAndIndexChunks(chunks, principal.correlationId);
        
        logger.info({ documentId: document.id, chunkCount: chunks.length }, 'Document processed');
      } catch (err) {
        logger.error({ err, documentId: document.id }, 'Failed to process document');
      }
    });
    
    return reply.status(202).send({
      documentId: document.id,
      status: 'PARSING',
      correlationId: principal.correlationId,
    });
  });

  // GET /documents/:id - Get document metadata
  fastify.get('/:id', {
    preHandler: [requireSecurityEngineer],
  }, async (request, reply) => {
    const { principal } = request;
    const { id } = request.params as { id: string };
    
    const result = await db.query<ComplianceDocument>(
      'SELECT * FROM compliance_documents WHERE id = $1 AND tenant_id = $2',
      [id, principal.tenantId]
    );
    
    if (result.rows.length === 0) {
      throw new AppError('NOT_FOUND', `Document not found: ${id}`, 404);
    }
    
    return reply.send(result.rows[0]);
  });

  // GET /documents - List documents
  fastify.get('/', {
    preHandler: [requireSecurityEngineer],
  }, async (request, reply) => {
    const { principal } = request;
    const { framework } = request.query as { framework?: string };
    
    let sql = 'SELECT * FROM compliance_documents WHERE tenant_id = $1';
    const params: (string | string[])[] = [principal.tenantId];
    
    if (framework) {
      sql += ' AND framework = $2';
      params.push(framework);
    }
    
    sql += ' ORDER BY created_at DESC';
    
    const result = await db.query<ComplianceDocument>(sql, params);
    
    return reply.send({
      documents: result.rows,
      total: result.rowCount,
    });
  });
}
