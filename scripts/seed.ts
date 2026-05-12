#!/usr/bin/env node
// scripts/seed.ts
// Database seeding script for development

import crypto from 'node:crypto';
import 'dotenv/config';
import { db, closeDatabase } from '../src/infra/db.js';
import { logger } from '../src/core/logger.js';

async function seed(): Promise<void> {
  logger.info('Seeding database...');
  
  const tenantId = crypto.randomUUID();
  const principalId = crypto.randomUUID();
  const correlationId = crypto.randomUUID();
  
  try {
    // Create a test compliance document
    await db.query(
      `INSERT INTO compliance_documents (id, tenant_id, title, framework, framework_version, source_path, checksum, created_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)`,
      [
        crypto.randomUUID(),
        tenantId,
        'CIS AWS Foundations Benchmark v2.0.0',
        'CIS_AWS',
        '2.0.0',
        `uploads/${tenantId}/seed-doc`,
        crypto.createHash('sha256').update('seed-document-content').digest('hex'),
        principalId,
      ]
    );
    
    // Create a test audit event to verify the audit trail works
    await db.query(
      `INSERT INTO audit_events (event_type, tenant_id, principal_id, correlation_id, resource_type, resource_id, outcome, metadata, timestamp)
       VALUES ('DOCUMENT_UPLOADED', $1, $2, $3, 'Tenant', $1, 'SUCCESS', '{"seed": true}', NOW())`,
      [tenantId, principalId, correlationId]
    );
    
    logger.info({ tenantId, principalId }, 'Database seeded with test data');
    logger.info(`Test tenant ID: ${tenantId}`);
    logger.info(`Test principal ID: ${principalId}`);
    logger.info('');
    logger.info('Use these values to create a test JWT token for API testing.');
  } catch (err) {
    logger.error({ err }, 'Seeding failed');
    process.exit(1);
  } finally {
    await closeDatabase();
  }
}

seed();