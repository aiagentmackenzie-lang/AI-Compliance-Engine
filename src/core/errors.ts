// src/core/errors.ts
// Typed error classes for consistent error handling

export type ErrorCode = 
  | 'INTERNAL_ERROR'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'INVALID_MIME_TYPE'
  | 'FILE_TOO_LARGE'
  | 'CHECKSUM_MISMATCH'
  | 'EMBEDDING_FAILED'
  | 'EMBEDDING_COUNT_MISMATCH'
  | 'EMBEDDING_DIMENSION_MISMATCH'
  | 'LLM_UNAVAILABLE'
  | 'LLM_INVALID_OUTPUT'
  | 'LLM_SCHEMA_VIOLATION'
  | 'TENANT_ISOLATION_VIOLATION'
  | 'RULE_STATE_TRANSITION_INVALID'
  | 'DATABASE_ERROR'
  | 'VECTOR_STORE_ERROR'
  | 'SECRETS_CLIENT_ERROR'
  | 'DOCUMENT_PARSE_ERROR';

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    statusCode: number = 500,
    isOperational: boolean = true,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      ...(this.details !== undefined ? { details: this.details } : {}),
    };
  }
}

// Convenience factory methods for common errors
export const Errors = {
  validation: (message: string, details?: Record<string, unknown>) =>
    new AppError('VALIDATION_ERROR', message, 400, true, details),
  
  notFound: (resource: string, id: string) =>
    new AppError('NOT_FOUND', `${resource} not found: ${id}`, 404, true),
  
  unauthorized: (message: string = 'Unauthorized') =>
    new AppError('UNAUTHORIZED', message, 401, true),
  
  forbidden: (message: string = 'Forbidden') =>
    new AppError('FORBIDDEN', message, 403, true),

  rateLimited: (message: string, resetIn?: number) =>
    new AppError('RATE_LIMITED', message, 429, true, resetIn !== undefined ? { resetIn } : undefined),
  
  database: (message: string, details?: Record<string, unknown>) =>
    new AppError('DATABASE_ERROR', message, 500, false, details),
  
  embedding: (message: string, code: ErrorCode = 'EMBEDDING_FAILED') =>
    new AppError(code, message, 502, false),
  
  llm: (message: string, code: ErrorCode = 'LLM_UNAVAILABLE') =>
    new AppError(code, message, 502, false),
  
  internal: (message: string = 'Internal server error') =>
    new AppError('INTERNAL_ERROR', message, 500, false),
} as const;

// Error handler for Fastify
export function fastifyErrorHandler(error: Error, _request: unknown, reply: unknown) {
  const fastifyReply = reply as { 
    code: (n: number) => { send: (o: unknown) => void }; 
    send: (o: unknown) => void 
  };
  
  if (error instanceof AppError) {
    fastifyReply.code(error.statusCode).send({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
    });
    return;
  }

  // Unknown error - don't leak details
  const codeMethod = fastifyReply.code(500);
  codeMethod.send({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    },
  });
}
