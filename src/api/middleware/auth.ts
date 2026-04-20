// src/api/middleware/auth.ts
// OIDC JWT verification + RBAC

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../../core/errors.js';

// JWT payload structure
interface JwtPayload {
  sub: string;
  tenantId: string;
  roles: string[];
  exp: number;
  iat: number;
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

// Verify JWT token (simplified - in production use a proper JWKS library)
async function verifyToken(token: string): Promise<JwtPayload> {
  // In production, this should:
  // 1. Fetch JWKS from OIDC_ISSUER_URL
  // 2. Verify signature
  // 3. Check expiration
  // 4. Validate claims (issuer, audience, etc.)

  // For now, simple base64 decode (NOT FOR PRODUCTION)
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new AppError('UNAUTHORIZED', 'Invalid JWT format', 401);
  }
  
  const payloadPart = parts[1];
  if (!payloadPart) {
    throw new AppError('UNAUTHORIZED', 'Invalid JWT format', 401);
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64').toString()) as JwtPayload;

    // Check expiration
    if (payload.exp && Date.now() >= payload.exp * 1000) {
      throw new AppError('UNAUTHORIZED', 'Token expired', 401);
    }

    return payload;
  } catch {
    throw new AppError('UNAUTHORIZED', 'Invalid token', 401);
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
