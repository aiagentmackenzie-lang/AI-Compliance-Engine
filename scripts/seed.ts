#!/usr/bin/env node
// scripts/seed.ts
// Database seeding script for development

import crypto from 'node:crypto';
import { db, closeDatabase } from '../src/infra/db.js';
import { logger } from '../src/core/logger.js';

async function seed(): Promise<void> {
  logger.info('Seeding database...');
  
  const tenantId = crypto.randomUUID();
  const principalId = crypto.randomUUID();
  
  try {
    // Create test tenant (using audit_events as a simple way to store tenant info)
    await db.query(
      `INSERT INTO audit_events (event_type, tenant_id, principal_id, correlation_id, resource_type, resource_id, outcome, metadata, timestamp)
       VALUES ('DOCUMENT_UPLOADED', $1, $2, $3, 'Tenant', $1, 'SUCCESS', '{"seed": true}', NOW())`,
      [tenantId, principalId, crypto.randomUUID()]
    );
    
    logger.info({ tenantId, principalId }, 'Database seeded with test data');
  } catch (err) {
    logger.error({ err }, 'Seeding failed');
    process.exit(1);
  } finally {
    await closeDatabase();
  }
}

seed();
