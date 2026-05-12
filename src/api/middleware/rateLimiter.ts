// src/api/middleware/rateLimiter.ts
// Per-tenant rate limiting

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { config } from '../../core/config.js';
import { AppError } from '../../core/errors.js';

// Simple in-memory rate limiter (use Redis in production)
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

function getRateLimitKey(request: FastifyRequest): string {
  // Use tenant ID if authenticated, otherwise IP
  const identifier = request.principal?.tenantId || request.ip;
  return `ratelimit:${identifier}:${request.url}`;
}

function checkRateLimit(key: string): { allowed: boolean; resetIn?: number } {
  const now = Date.now();
  const windowMs = config.RATE_LIMIT_WINDOW_MS;
  const maxRequests = config.RATE_LIMIT_REQUESTS;
  
  const entry = rateLimitMap.get(key);
  
  if (!entry || now > entry.resetAt) {
    // New window
    rateLimitMap.set(key, {
      count: 1,
      resetAt: now + windowMs,
    });
    return { allowed: true };
  }
  
  if (entry.count >= maxRequests) {
    // Rate limited
    return {
      allowed: false,
      resetIn: Math.ceil((entry.resetAt - now) / 1000),
    };
  }
  
  // Increment and allow
  entry.count++;
  return { allowed: true };
}

export const rateLimiter: FastifyPluginAsync = fp(async (fastify) => {
  fastify.addHook('onRequest', async (request, reply) => {
    // Skip rate limiting for health checks
    if (request.url.startsWith('/health')) {
      return;
    }
    
    const key = getRateLimitKey(request);
    const result = checkRateLimit(key);
    
    // Set rate limit headers
    reply.header('X-RateLimit-Limit', config.RATE_LIMIT_REQUESTS);
    
    if (!result.allowed) {
      reply.header('X-RateLimit-Reset', result.resetIn);
      throw new AppError(
        'RATE_LIMITED',
        `Rate limit exceeded. Try again in ${result.resetIn} seconds.`,
        429,
        true,
        { resetIn: result.resetIn },
      );
    }
    
    // Set remaining count header
    const entry = rateLimitMap.get(key);
    if (entry) {
      reply.header('X-RateLimit-Remaining', Math.max(0, config.RATE_LIMIT_REQUESTS - entry.count));
    }
  });
});
