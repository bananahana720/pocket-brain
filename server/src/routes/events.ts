import type { FastifyInstance } from 'fastify';
import { subscribeSyncEvents } from '../realtime/hub.js';

function writeSseChunk(raw: NodeJS.WritableStream, payload: string): void {
  raw.write(payload);
}

export async function registerEventRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v2/events', async (request, reply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-store');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no');

    writeSseChunk(reply.raw, `event: ready\ndata: ${JSON.stringify({ connectedAt: Date.now() })}\n\n`);

    const heartbeat = setInterval(() => {
      writeSseChunk(reply.raw, `event: heartbeat\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
    }, 20_000);

    const unsubscribe = subscribeSyncEvents(event => {
      if (event.userId !== request.appUserId) return;
      writeSseChunk(reply.raw, `event: sync\ndata: ${JSON.stringify({ cursor: event.cursor, ts: event.emittedAt })}\n\n`);
    });

    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };

    request.raw.on('close', cleanup);
    request.raw.on('error', cleanup);

    return reply;
  });
}
