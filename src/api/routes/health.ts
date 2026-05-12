// src/api/routes/health.ts
// Health, readiness, and liveness endpoints

import type { FastifyInstance } from 'fastify';
import { checkDatabaseHealth } from '../../infra/db.js';
import { vectorStore } from '../../infra/vectorStore.js';
import { checkQueueHealth } from '../../infra/queue.js';

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
      checkQueueHealth(),
    ]);
    
    const dbCheck = checks[0] as PromiseSettledResult<{ healthy: boolean }>;
    const vectorCheck = checks[1] as PromiseSettledResult<{ healthy: boolean }>;
    const redisCheck = checks[2] as PromiseSettledResult<{ healthy: boolean; queues: string[] }>;
    
    const allHealthy = 
      dbCheck.status === 'fulfilled' && dbCheck.value?.healthy &&
      vectorCheck.status === 'fulfilled' && vectorCheck.value?.healthy &&
      redisCheck.status === 'fulfilled' && redisCheck.value?.healthy;
    
    const response = {
      ready: allHealthy,
      checks: [
        { name: 'database', healthy: dbCheck.status === 'fulfilled' && dbCheck.value?.healthy },
        { name: 'vectorStore', healthy: vectorCheck.status === 'fulfilled' && vectorCheck.value?.healthy },
        { name: 'redis', healthy: redisCheck.status === 'fulfilled' && redisCheck.value?.healthy },
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