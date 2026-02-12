import crypto from 'node:crypto';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { env } from './config/env.js';
import { connectInfra, closeInfra } from './db/client.js';
import { requireAuth } from './auth/clerk.js';
import { consumeStreamTicket, StreamTicketError, STREAM_TICKET_COOKIE_NAME } from './auth/streamTicket.js';
import { ensureUser } from './services/users.js';
import { assertDeviceActive, upsertDevice } from './services/devices.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerSyncRoutes } from './routes/sync.js';
import { registerDeviceRoutes } from './routes/devices.js';
import { registerEventRoutes } from './routes/events.js';
import { registerAiAuthRoutes } from './routes/aiAuth.js';
import { initRealtimeHub } from './realtime/hub.js';
import { startMaintenanceLoop } from './services/maintenance.js';

const DEVICE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function resolveDeviceId(value: string | undefined): string {
  if (value && DEVICE_ID_PATTERN.test(value)) {
    return value;
  }
  return crypto.randomUUID();
}

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.query.shared_note',
          'res.headers.set-cookie',
        ],
        censor: '[REDACTED]',
      },
    },
    trustProxy: env.TRUST_PROXY,
    requestIdHeader: 'x-request-id',
  });

  await app.register(cors, {
    credentials: true,
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',').map(part => part.trim()),
  });

  await app.register(cookie);

  await app.register(rateLimit, {
    max: 180,
    timeWindow: '1 minute',
    skipOnError: true,
  });

  app.addHook('preHandler', async (request, reply) => {
    const routeUrl = request.routeOptions.url;
    if (routeUrl === '/health' || routeUrl === '/ready') return;

    let auth = request.auth;
    let forcedDeviceId: string | undefined;
    const isEventStreamRoute = routeUrl === '/api/v2/events';
    const rawStreamTicket = request.cookies?.[STREAM_TICKET_COOKIE_NAME];

    if (isEventStreamRoute) {
      if (!rawStreamTicket) {
        reply.code(401).send({
          error: {
            code: 'STREAM_TICKET_REQUIRED',
            message: 'Stream ticket required before opening events stream',
            retryable: false,
          },
        });
        return;
      }

      try {
        const claims = await consumeStreamTicket(rawStreamTicket);
        auth = {
          clerkUserId: claims.sub,
          tokenSub: claims.sub,
          authMode: 'clerk',
        };
        forcedDeviceId = claims.deviceId;
        reply.clearCookie(STREAM_TICKET_COOKIE_NAME, {
          path: '/api/v2/events',
        });
      } catch (error) {
        if (error instanceof StreamTicketError) {
          if (error.code === 'STREAM_TICKET_STORAGE_UNAVAILABLE') {
            request.log.error({ err: error }, 'stream ticket replay store unavailable');
          }
          reply.code(error.statusCode).send({
            error: {
              code: error.code,
              message: error.message,
              retryable: error.retryable,
            },
          });
          return;
        }
        throw error;
      }
    } else {
      await requireAuth(request, reply);
      if (reply.sent) return;
      auth = request.auth;
    }

    request.auth = auth;
    const user = await ensureUser(auth.clerkUserId);
    request.appUserId = user.id;

    const requestedDeviceId = request.headers['x-device-id'];
    const headerDeviceId = Array.isArray(requestedDeviceId)
      ? requestedDeviceId[0]
      : typeof requestedDeviceId === 'string'
        ? requestedDeviceId
        : undefined;

    request.deviceId = forcedDeviceId || resolveDeviceId(headerDeviceId);
    reply.header('x-device-id', request.deviceId);

    await upsertDevice({
      userId: request.appUserId,
      deviceId: request.deviceId,
      userAgent: request.headers['user-agent'],
    });

    try {
      await assertDeviceActive(request.appUserId, request.deviceId);
    } catch {
      reply.code(403).send({
        error: {
          code: 'DEVICE_REVOKED',
          message: 'This device session was revoked',
          retryable: false,
        },
      });
    }
  });

  await registerHealthRoutes(app);
  await registerSyncRoutes(app);
  await registerDeviceRoutes(app);
  await registerEventRoutes(app);
  await registerAiAuthRoutes(app);

  app.setErrorHandler((error, request, reply) => {
    if (reply.sent) return;

    request.log.error(error);

    reply.code(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        retryable: false,
      },
    });
  });

  return app;
}

async function start() {
  await connectInfra();
  await initRealtimeHub();

  const app = await buildServer();
  const stopMaintenance = startMaintenanceLoop(app.log);

  const close = async () => {
    stopMaintenance();
    await app.close();
    await closeInfra();
    process.exit(0);
  };

  process.on('SIGTERM', close);
  process.on('SIGINT', close);

  await app.listen({
    host: env.SERVER_HOST,
    port: env.SERVER_PORT,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
