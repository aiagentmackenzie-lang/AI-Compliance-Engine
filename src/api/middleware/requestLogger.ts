// src/api/middleware/requestLogger.ts
// Correlation ID injection and request logging

import type { FastifyRequest, FastifyReply } from 'fastify';
import { createRequestLogger } from '../../core/logger.js';
import crypto from 'node:crypto';

const CORRELATION_ID_HEADER = 'x-correlation-id';

export async function requestLogger(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // Generate or extract correlation ID
  const correlationId =
    (request.headers[CORRELATION_ID_HEADER] as string) || crypto.randomUUID();

  // Add to request context
  request.id = correlationId;

  // Set response header
  reply.header(CORRELATION_ID_HEADER, correlationId);

  // Create request-scoped logger
  const requestLogger = createRequestLogger(
    correlationId,
    request.principal?.tenantId,
  );

  // Log request start
  requestLogger.info(
    {
      method: request.method,
      url: request.url,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    },
    'Request started',
  );

  // Hook into response to log completion (onSend hooks are registered on the route level)
  reply.raw.once('finish', () => {
    requestLogger.info(
      {
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
      },
      'Request completed',
    );
  });
}
