// src/api/middleware/validate.ts
// Zod schema validation middleware for Fastify routes

import type { FastifyRequest, FastifyReply } from 'fastify';
import { ZodError, ZodSchema } from 'zod';
import { AppError } from '../../core/errors.js';

/**
 * Create a Fastify preHandler that validates request body against a Zod schema.
 * Fail-closed: any validation error results in a 400 response.
 */
export function validateBody<T>(schema: ZodSchema<T>) {
  return async function validateBodyHandler(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const result = schema.safeParse(request.body);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }));
      throw new AppError('VALIDATION_ERROR', 'Request body validation failed', 400, true, { details });
    }
    // Replace the body with the validated output (strips extra keys)
    request.body = result.data;
  };
}

/**
 * Create a Fastify preHandler that validates query parameters against a Zod schema.
 */
export function validateQuery<T>(schema: ZodSchema<T>) {
  return async function validateQueryHandler(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const result = schema.safeParse(request.query);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }));
      throw new AppError('VALIDATION_ERROR', 'Query parameter validation failed', 400, true, { details });
    }
    request.query = result.data as Record<string, unknown>;
  };
}

/**
 * Create a Fastify preHandler that validates URL parameters against a Zod schema.
 */
export function validateParams<T>(schema: ZodSchema<T>) {
  return async function validateParamsHandler(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const result = schema.safeParse(request.params);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }));
      throw new AppError('VALIDATION_ERROR', 'Path parameter validation failed', 400, true, { details });
    }
    request.params = result.data as Record<string, unknown>;
  };
}

/**
 * Format ZodError into a user-friendly error response.
 * Useful when Zod errors are caught in route handlers directly.
 */
export function formatZodError(error: ZodError): { details: Array<{ path: string; message: string }> } {
  return {
    details: error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    })),
  };
}