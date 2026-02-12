import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { connectAiKey, disconnectAiKey, getAiKeyStatus } from '../services/aiKeys.js';

const connectSchema = z.object({
  provider: z.enum(['gemini', 'openrouter']),
  apiKey: z.string().min(8),
});

export async function registerAiAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/auth/status', async request => {
    const status = await getAiKeyStatus(request.appUserId);
    return {
      ...status,
      scope: 'account',
    };
  });

  app.post('/api/v1/auth/connect', async (request, reply) => {
    const parsed = connectSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: parsed.error.issues[0]?.message || 'Invalid payload',
          retryable: false,
        },
      });
      return;
    }

    const result = await connectAiKey(request.appUserId, parsed.data.provider, parsed.data.apiKey.trim());
    return {
      connected: true,
      provider: result.provider,
      connectedAt: result.connectedAt,
      updatedAt: result.updatedAt,
      scope: 'account',
    };
  });

  app.post('/api/v1/auth/disconnect', async request => {
    await disconnectAiKey(request.appUserId);
    return {
      connected: false,
      scope: 'account',
    };
  });
}
