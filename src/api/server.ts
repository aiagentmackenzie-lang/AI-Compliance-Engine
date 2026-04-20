// src/api/server.ts
// Fastify app bootstrap

import Fastify from 'fastify';
import { config } from '../core/config.js';
import { logger } from '../core/logger.js';
import { fastifyErrorHandler } from '../core/errors.js';

// Import routes
import { healthRoutes } from './routes/health.js';
import { documentsRoutes } from './routes/documents.js';
import { evaluationsRoutes } from './routes/evaluations.js';
import { rulesRoutes } from './routes/rules.js';

// Import middleware
import { authPlugin } from './middleware/auth.js';
import { requestLogger } from './middleware/requestLogger.js';
import { rateLimiter } from './middleware/rateLimiter.js';

export async function buildServer() {
  const app = Fastify({
    logger: config.NODE_ENV === 'development',
    trustProxy: true,
  });

  // Register error handler
  app.setErrorHandler(fastifyErrorHandler);

  // Register request logging (adds correlation ID)
  app.addHook('onRequest', requestLogger);

  // Register rate limiter
  await app.register(rateLimiter);

  // Register auth plugin (OIDC/JWT)
  await app.register(authPlugin);

  // Register routes
  await app.register(healthRoutes, { prefix: '/health' });
  await app.register(documentsRoutes, { prefix: '/api/v1/documents' });
  await app.register(evaluationsRoutes, { prefix: '/api/v1/evaluations' });
  await app.register(rulesRoutes, { prefix: '/api/v1/rules' });

  return app;
}

export async function startServer() {
  const app = await buildServer();

  try {
    await app.listen({ port: config.PORT, host: config.HOST });
    logger.info(`Server listening on ${config.HOST}:${config.PORT}`);
  } catch (err) {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  }

  return app;
}

// Start server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}
