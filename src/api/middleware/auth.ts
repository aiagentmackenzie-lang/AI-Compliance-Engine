// src/api/middleware/auth.ts
// OIDC JWT verification via JWKS + RBAC

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { jwtVerify, createRemoteJWKSet } from 'jose';
import { config } from '../../core/config.js';
import { AppError } from '../../core/errors.js';
import { logger } from '../../core/logger.js';

// JWT payload structure
interface JwtPayload {
  sub: string;
  tenantId: string;
  roles: string[];
  exp: number;
  iat: number;
  iss?: string;
  aud?: string | string[];
}

// Extended request type with user info
declare module 'fastify' {
  interface FastifyRequest {
    user?: JwtPayload;
    principal: {
      id: string;
      tenantId: string;
      correlationId: string;
      roles: string[];
    };
  }
}

// ─── JWKS cache ────────────────────────────────────────────────
let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS(): ReturnType<typeof createRemoteJWKSet> {
  if (!jwksCache) {
    const issuerUrl = config.OIDC_ISSUER_URL.replace(/\/+$/, '');
    const jwksUrl = new URL(`${issuerUrl}/.well-known/jwks.json`);
    jwksCache = createRemoteJWKSet(jwksUrl);
  }
  return jwksCache;
}

// ─── JWT verification ──────────────────────────────────────────
async function verifyToken(token: string): Promise<JwtPayload> {
  try {
    const jwks = getJWKS();
    const { payload } = await jwtVerify(token, jwks, {
      issuer: config.OIDC_ISSUER_URL.replace(/\/+$/, ''),
      algorithms: ['RS256'],
    });

    const claims = payload as Record<string, unknown>;

    // Validate required claims
    if (!claims.sub || typeof claims.sub !== 'string') {
      throw new AppError('UNAUTHORIZED', 'Missing or invalid sub claim', 401);
    }
    if (!claims.tenantId || typeof claims.tenantId !== 'string') {
      throw new AppError('UNAUTHORIZED', 'Missing or invalid tenantId claim', 401);
    }
    if (!Array.isArray(claims.roles)) {
      throw new AppError('UNAUTHORIZED', 'Missing or invalid roles claim', 401);
    }

    const jwtPayload: JwtPayload = {
      sub: claims.sub as string,
      tenantId: claims.tenantId as string,
      roles: claims.roles as string[],
      exp: typeof claims.exp === 'number' ? claims.exp : 0,
      iat: typeof claims.iat === 'number' ? claims.iat : 0,
      iss: typeof claims.iss === 'string' ? claims.iss : undefined,
      aud: claims.aud as string | string[] | undefined,
    };

    logger.debug({ sub: jwtPayload.sub, tenantId: jwtPayload.tenantId }, 'JWT verified successfully');
    return jwtPayload;
  } catch (err) {
    if (err instanceof AppError) throw err;

    // jose throws specific errors we can map
    if (err instanceof Error) {
      if (err.message.includes('exp') || err.message.includes('expired')) {
        throw new AppError('UNAUTHORIZED', 'Token expired', 401);
      }
      if (err.message.includes('issuer')) {
        throw new AppError('UNAUTHORIZED', 'Invalid token issuer', 401);
      }
    }

    logger.debug({ err }, 'JWT verification failed');
    throw new AppError('UNAUTHORIZED', 'Invalid or unverifiable token', 401);
  }
}

// Auth plugin
export const authPlugin: FastifyPluginAsync = fp(async (fastify) => {
  // Pre-handler to extract and verify JWT
  fastify.addHook('onRequest', async (request: FastifyRequest) => {
    // Skip auth for health endpoints
    if (request.url.startsWith('/health')) {
      request.principal = {
        id: 'anonymous',
        tenantId: 'public',
        correlationId: request.id as string,
        roles: [],
      };
      return;
    }

    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError('UNAUTHORIZED', 'Missing or invalid authorization header', 401);
    }

    const token = authHeader.slice(7);
    const payload = await verifyToken(token);

    request.user = payload;
    request.principal = {
      id: payload.sub,
      tenantId: payload.tenantId,
      correlationId: request.id as string,
      roles: payload.roles || [],
    };
  });
});

// Role-based access control middleware factory
export function requireRoles(...allowedRoles: string[]) {
  return async function requireRolesHandler(request: FastifyRequest, _reply: FastifyReply) {
    const { principal } = request;

    if (!principal) {
      throw new AppError('UNAUTHORIZED', 'Authentication required', 401);
    }

    // Check if user has any of the required roles
    const hasRole = principal.roles.some(role =>
      allowedRoles.includes(role) || role === 'admin'
    );

    if (!hasRole) {
      throw new AppError('FORBIDDEN', 'Insufficient permissions', 403);
    }
  };
}

// Specific role helpers
export const requireSecurityEngineer = requireRoles('security_engineer');
export const requireComplianceAuditor = requireRoles('compliance_auditor', 'security_engineer');
export const requireSystemCollector = requireRoles('system_collector');