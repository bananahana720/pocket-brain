import Fastify, { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerDeviceRoutes } from '../src/routes/devices.js';
import * as devicesService from '../src/services/devices.js';

describe('device routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify();
    app.addHook('preHandler', async request => {
      (request as any).appUserId = 'user-1';
      (request as any).deviceId = 'device-current';
    });

    await registerDeviceRoutes(app);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it('lists devices including current device id', async () => {
    vi.spyOn(devicesService, 'listDevices').mockResolvedValue([
      {
        id: 'device-current',
        label: 'Desktop Chrome',
        platform: 'desktop-web',
        lastSeenAt: Date.now(),
        revokedAt: null,
        createdAt: Date.now() - 1000,
      },
      {
        id: 'device-mobile',
        label: 'Mobile Safari',
        platform: 'mobile-web',
        lastSeenAt: Date.now() - 2000,
        revokedAt: null,
        createdAt: Date.now() - 5000,
      },
    ]);

    const response = await app.inject({ method: 'GET', url: '/api/v2/devices' });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.currentDeviceId).toBe('device-current');
    expect(payload.devices).toHaveLength(2);
  });

  it('revokes a device and returns success payload', async () => {
    const revokeSpy = vi.spyOn(devicesService, 'revokeDevice').mockResolvedValue(true);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/devices/device-mobile/revoke',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, revokedDeviceId: 'device-mobile' });
    expect(revokeSpy).toHaveBeenCalledWith('user-1', 'device-mobile');
  });

  it('returns 404 when revoke target does not exist', async () => {
    vi.spyOn(devicesService, 'revokeDevice').mockResolvedValue(false);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/devices/missing-device/revoke',
    });

    expect(response.statusCode).toBe(404);
    const payload = response.json();
    expect(payload.error.code).toBe('NOT_FOUND');
  });
});
