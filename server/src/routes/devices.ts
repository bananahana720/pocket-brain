import type { FastifyInstance } from 'fastify';
import { listDevices, revokeDevice } from '../services/devices.js';

export async function registerDeviceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v2/devices', async request => {
    const items = await listDevices(request.appUserId);
    return {
      devices: items,
      currentDeviceId: request.deviceId,
    };
  });

  app.post('/api/v2/devices/:id/revoke', async (request, reply) => {
    const params = request.params as { id?: string };
    if (!params.id) {
      reply.code(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Missing device id',
          retryable: false,
        },
      });
      return;
    }

    const revoked = await revokeDevice(request.appUserId, params.id);
    if (!revoked) {
      reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message: 'Device not found',
          retryable: false,
        },
      });
      return;
    }

    return { ok: true, revokedDeviceId: params.id };
  });
}
