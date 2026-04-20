// src/infra/audit.ts
// Immutable audit logging with SIEM forwarding

import { z } from 'zod';
import { db } from './db.js';
import { logger } from '../core/logger.js';

export const AuditEventTypeSchema = z.enum([
  'DOCUMENT_UPLOADED',
  'DOCUMENT_PARSED',
  'EMBEDDING_CREATED',
  'RETRIEVAL_PERFORMED',
  'AI_ANALYSIS_COMPLETED',
  'RULE_GENERATED',
  'RULE_APPROVED',
  'RULE_REJECTED',
  'EVALUATION_STARTED',
  'EVALUATION_COMPLETED',
  'ACCESS_DENIED',
]);
export type AuditEventType = z.infer<typeof AuditEventTypeSchema>;

export const AuditEventSchema = z.object({
  id: z.string().uuid(),
  eventType: AuditEventTypeSchema,
  tenantId: z.string().uuid(),
  principalId: z.string().uuid(),
  correlationId: z.string().uuid(),
  resourceType: z.string(),
  resourceId: z.string(),
  outcome: z.enum(['SUCCESS', 'FAILURE', 'PARTIAL']),
  metadata: z.record(z.unknown()),
  timestamp: z.string().datetime(),
  sourceIp: z.string().optional(),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

// SIEM forwarder (async, non-blocking)
async function forwardToSiem(event: AuditEvent): Promise<void> {
  const siemUrl = process.env.SIEM_WEBHOOK_URL;
  if (!siemUrl) {
    return;
  }

  try {
    const response = await fetch(siemUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    });

    if (!response.ok) {
      logger.warn(
        { auditId: event.id, status: response.status },
        'SIEM forward returned non-OK status'
      );
    }
  } catch (err) {
    // Failure must not block the main flow
    logger.error({ err, auditId: event.id }, 'SIEM forward failed');
  }
}

// Write audit event (immutable, append-only)
export async function writeAuditEvent(
  event: Omit<AuditEvent, 'id' | 'timestamp'>
): Promise<AuditEvent> {
  const record: AuditEvent = {
    ...event,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  };

  try {
    await db.query(
      `INSERT INTO audit_events (
        id, event_type, tenant_id, principal_id, correlation_id,
        resource_type, resource_id, outcome, metadata, timestamp, source_ip
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        record.id,
        record.eventType,
        record.tenantId,
        record.principalId,
        record.correlationId,
        record.resourceType,
        record.resourceId,
        record.outcome,
        JSON.stringify(record.metadata),
        record.timestamp,
        record.sourceIp ?? null,
      ]
    );

    // Forward to SIEM asynchronously (non-blocking)
    forwardToSiem(record).catch((err) => {
      logger.error({ err, auditId: record.id }, 'SIEM forward promise rejected');
    });

    return record;
  } catch (err) {
    logger.error({ err, eventType: event.eventType }, 'Failed to write audit event');
    throw err;
  }
}

// Query audit events for a tenant (with time range)
export async function queryAuditEvents(
  tenantId: string,
  options: {
    eventTypes?: AuditEventType[];
    startTime?: Date;
    endTime?: Date;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ events: AuditEvent[]; total: number }> {
  const { eventTypes, startTime, endTime, limit = 100, offset = 0 } = options;

  let sql = `SELECT * FROM audit_events WHERE tenant_id = $1`;
  const params: (string | string[] | Date | number)[] = [tenantId];
  let paramIndex = 1;

  if (eventTypes && eventTypes.length > 0) {
    paramIndex++;
    sql += ` AND event_type = ANY($${paramIndex})`;
    params.push(eventTypes);
  }

  if (startTime) {
    paramIndex++;
    sql += ` AND timestamp >= $${paramIndex}`;
    params.push(startTime.toISOString());
  }

  if (endTime) {
    paramIndex++;
    sql += ` AND timestamp <= $${paramIndex}`;
    params.push(endTime.toISOString());
  }

  // Get total count
  const countResult = await db.query<{ count: string }>(
    `SELECT COUNT(*) FROM (${sql}) AS filtered`,
    params
  );
  const total = parseInt(countResult.rows[0]?.count ?? '0', 10);

  // Get paginated results
  paramIndex++;
  sql += ` ORDER BY timestamp DESC LIMIT $${paramIndex}`;
  params.push(limit);

  paramIndex++;
  sql += ` OFFSET $${paramIndex}`;
  params.push(offset);

  const result = await db.query<AuditEvent>(sql, params);

  return {
    events: result.rows,
    total,
  };
}
