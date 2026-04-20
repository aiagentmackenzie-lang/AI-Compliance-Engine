// src/core/logger.ts
// Structured JSON logging with Pino

import pino from 'pino';
import { config } from './config';

// Redaction patterns for sensitive data
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
  '*.secret',
  '*.apiKey',
  '*.api_key',
  '*.EMBEDDING_API_KEY',
  '*.REASONING_MODEL_API_KEY',
  '*.OIDC_CLIENT_SECRET',
  '*.JWT_SECRET',
];

export const logger = pino({
  level: config.LOG_LEVEL,
  base: {
    service: 'ai-compliance-engine',
    version: '1.0.0',
  },
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
  },
  formatters: {
    level: (label) => ({ level: label.toUpperCase() }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

// Child logger factory for request context
export function createRequestLogger(correlationId: string, tenantId?: string) {
  return logger.child({
    correlationId,
    ...(tenantId && { tenantId }),
  });
}

// Audit logger specifically for compliance events
export function createAuditLogger(correlationId: string, tenantId: string, principalId: string) {
  return logger.child({
    correlationId,
    tenantId,
    principalId,
    logType: 'audit',
  });
}
