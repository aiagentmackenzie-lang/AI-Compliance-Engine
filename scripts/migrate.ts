#!/usr/bin/env node
// scripts/migrate.ts
// Database migration script

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

// Load env vars before anything else
config();
config({ path: '.env.test', override: false });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runMigrations(): Promise<void> {
  // Dynamic imports after env is loaded
  const { db, closeDatabase } = await import('../src/infra/db.js');
  const { logger } = await import('../src/core/logger.js');

  logger.info('Running database migrations...');
  
  try {
    // Read and execute migration file
    const migrationPath = join(__dirname, '..', 'infra', 'db', 'init', '001_initial_schema.sql');
    const sql = readFileSync(migrationPath, 'utf-8');
    
    // Split by semicolons and execute each statement
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    
    for (const statement of statements) {
      try {
        await db.query(statement);
        logger.debug('Executed migration statement');
      } catch (err) {
        // Ignore errors for "already exists" cases
        const errorMessage = err instanceof Error ? err.message : String(err);
        if (errorMessage.includes('already exists')) {
          logger.debug('Object already exists, skipping');
        } else {
          throw err;
        }
      }
    }
    
    logger.info('Migrations completed successfully');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    const { closeDatabase: closeDb } = await import('../src/infra/db.js');
    await closeDb();
  }
}

runMigrations();
