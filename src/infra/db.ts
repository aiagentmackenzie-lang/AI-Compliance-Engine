import type { QueryResultRow } from 'pg';
import pg from 'pg';
import { config } from '../core/config.js';
import { logger } from '../core/logger.js';
import { Errors } from '../core/errors.js';

const { Pool } = pg;

// PostgreSQL connection pool with pgvector support
export const db = new Pool({
  connectionString: config.DATABASE_URL,
  max: config.DATABASE_POOL_SIZE,
  // Connection timeout
  connectionTimeoutMillis: 10000,
  // Idle timeout
  idleTimeoutMillis: 30000,
  // SSL in production
  ssl: config.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Log pool events
db.on('connect', () => {
  logger.debug('New database connection established');
});

db.on('error', (err) => {
  logger.error({ err }, 'Unexpected database error');
});

// Query wrapper with tenant context enforcement
export async function queryWithTenant<T extends QueryResultRow>(
  sql: string,
  params: unknown[],
  tenantId: string,
): Promise<{ rows: T[]; rowCount: number }> {
  const client = await db.connect();
  
  try {
    // Set tenant context for RLS
    await client.query('SELECT set_tenant_context($1)', [tenantId]);
    
    // Execute the actual query
    const result = await client.query<T>(sql, params);
    
    return { rows: result.rows, rowCount: result.rowCount ?? 0 };
  } catch (err) {
    logger.error({ err, sql, tenantId }, 'Database query failed');
    throw Errors.database('Database query failed', { cause: err });
  } finally {
    client.release();
  }
}

// Query without tenant context (for system operations only)
export async function query<T extends QueryResultRow>(
  sql: string,
  params?: unknown[],
): Promise<{ rows: T[]; rowCount: number }> {
  try {
    const result = await db.query<T>(sql, params);
    return { rows: result.rows, rowCount: result.rowCount ?? 0 };
  } catch (err) {
    logger.error({ err, sql }, 'Database query failed');
    throw Errors.database('Database query failed', { cause: err });
  }
}

// Health check
export async function checkDatabaseHealth(): Promise<{ healthy: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    await query('SELECT 1');
    return { healthy: true, latencyMs: Date.now() - start };
  } catch {
    return { healthy: false, latencyMs: Date.now() - start };
  }
}

// Graceful shutdown
export async function closeDatabase(): Promise<void> {
  logger.info('Closing database connections');
  await db.end();
}
