// src/core/config.ts
// Type-safe environment configuration — no raw process.env access

import { z } from 'zod';

const ConfigSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('3000'),
  HOST: z.string().default('0.0.0.0'),
  
  // Database
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_SIZE: z.string().transform(Number).default('20'),
  
  // Vector store (pgvector)
  VECTOR_DIMENSIONS: z.string().transform(Number).default('1536'),
  
  // Security
  OIDC_ISSUER_URL: z.string().url(),
  OIDC_CLIENT_ID: z.string(),
  OIDC_CLIENT_SECRET: z.string(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  
  // AI Models
  EMBEDDING_API_KEY: z.string(),
  EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  EMBEDDING_DIMENSIONS: z.string().transform(Number).default('1536'),
  REASONING_MODEL_API_KEY: z.string(),
  REASONING_MODEL: z.string().default('gpt-4o-2024-08-06'),
  
  // Rate limiting
  RATE_LIMIT_REQUESTS: z.string().transform(Number).default('100'),
  RATE_LIMIT_WINDOW_MS: z.string().transform(Number).default('60000'),
  
  // Audit & Logging
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  SIEM_WEBHOOK_URL: z.string().url().optional().or(z.literal('')),
  
  // Queue
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  
  // File uploads
  MAX_FILE_SIZE_BYTES: z.string().transform(Number).default('52428800'), // 50MB
  ALLOWED_MIME_TYPES: z.string().default('application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
});

type Config = z.infer<typeof ConfigSchema>;

// Validate and parse environment variables
function loadConfig(): Config {
  const result = ConfigSchema.safeParse(process.env);
  
  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Environment configuration validation failed:\n${issues}`);
  }
  
  return result.data;
}

// Singleton config instance
export const config = loadConfig();

// Re-export for convenience
export type { Config };
