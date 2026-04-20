// src/api/routes/health.ts
// Health and readiness endpoints

import type { FastifyInstance } from 'fastify';
import { checkDatabaseHealth } from '../../infra/db.js';
import { vectorStore } from '../../infra/vectorStore.js';

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  // Basic health check
  fastify.get('/', async (_request, reply) => {
    return reply.send({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    });
  });

  // Readiness check - verifies all dependencies
  fastify.get('/ready', async (_request, reply) => {
    const checks = await Promise.allSettled([
      checkDatabaseHealth(),
      vectorStore.ping(),
    ]);
    
    const dbCheck = checks[0] as PromiseSettledResult<{ healthy: boolean }>;
    const vectorCheck = checks[1] as PromiseSettledResult<{ healthy: boolean }>;
    
    const allHealthy = 
      dbCheck.status === 'fulfilled' && dbCheck.value?.healthy &&
      vectorCheck.status === 'fulfilled' && vectorCheck.value?.healthy;
    
    const response = {
      ready: allHealthy,
      checks: [
        { name: 'database', healthy: dbCheck.status === 'fulfilled' && dbCheck.value?.healthy },
        { name: 'vectorStore', healthy: vectorCheck.status === 'fulfilled' && vectorCheck.value?.healthy },
      ],
      timestamp: new Date().toISOString(),
    };
    
    return reply.status(allHealthy ? 200 : 503).send(response);
  });

  // Liveness check
  fastify.get('/live', async (_request, reply) => {
    return reply.send({
      alive: true,
      timestamp: new Date().toISOString(),
    });
  });
}
