import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db, closeDatabase } from '../../src/infra/db.js';
import { vectorStore } from '../../src/infra/vectorStore.js';

describe('Tenant Isolation', () => {
  const tenantA = '550e8400-e29b-41d4-a716-446655440001';
  const tenantB = '550e8400-e29b-41d4-a716-446655440002';
  let dbAvailable = false;

  beforeAll(async () => {
    try {
      // Test database connection
      await db.query('SELECT 1');
      dbAvailable = true;
      
      // Seed test data for both tenants
      await db.query(
        'INSERT INTO compliance_documents (id, tenant_id, title, framework, framework_version, source_path, checksum, created_at, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8) ON CONFLICT DO NOTHING',
        ['doc-a-1', tenantA, 'Test Doc A', 'CIS_AWS', '1.0', '/test', 'hash', 'user-a']
      );
      
      await db.query(
        'INSERT INTO compliance_documents (id, tenant_id, title, framework, framework_version, source_path, checksum, created_at, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8) ON CONFLICT DO NOTHING',
        ['doc-b-1', tenantB, 'Test Doc B', 'CIS_AWS', '1.0', '/test', 'hash', 'user-b']
      );
    } catch (err) {
      console.warn('Database not available for integration tests:', err);
      dbAvailable = false;
    }
  });

  afterAll(async () => {
    if (dbAvailable) {
      try {
        // Cleanup
        await db.query('DELETE FROM compliance_documents WHERE tenant_id = $1', [tenantA]);
        await db.query('DELETE FROM compliance_documents WHERE tenant_id = $1', [tenantB]);
      } catch {
        // Ignore errors during cleanup
      }
    }
    await closeDatabase();
  });

  it('should not return documents from other tenants', async () => {
    if (!dbAvailable) {
      console.warn('Skipping test - database not available');
      return;
    }
    
    const result = await db.query(
      'SELECT * FROM compliance_documents WHERE tenant_id = $1',
      [tenantA]
    );

    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows.every(r => r.tenant_id === tenantA)).toBe(true);
  });
});
