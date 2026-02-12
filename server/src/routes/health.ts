import type { FastifyInstance } from 'fastify';
import { checkDatabaseReady, checkRedisReady } from '../db/client.js';

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ ok: true, service: 'pocketbrain-server', ts: Date.now() }));

  app.get('/ready', async (_request, reply) => {
    const [databaseOk, redisState] = await Promise.all([checkDatabaseReady(), checkRedisReady()]);
    const payload = {
      ok: databaseOk,
      service: 'pocketbrain-server',
      ts: Date.now(),
      dependencies: {
        database: {
          ok: databaseOk,
        },
        redis: redisState,
      },
    };

    if (!databaseOk) {
      reply.code(503).send(payload);
      return;
    }

    return payload;
  });
}
