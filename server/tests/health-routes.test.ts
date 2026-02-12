import Fastify, { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerHealthRoutes } from '../src/routes/health.js';
import * as dbClient from '../src/db/client.js';

describe('health routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify();
    await registerHealthRoutes(app);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it('returns ready when database is healthy', async () => {
    vi.spyOn(dbClient, 'checkDatabaseReady').mockResolvedValue(true);
    vi.spyOn(dbClient, 'checkRedisReady').mockResolvedValue({ ok: true, status: 'ready' });

    const response = await app.inject({
      method: 'GET',
      url: '/ready',
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.ok).toBe(true);
    expect(payload.dependencies.database.ok).toBe(true);
    expect(payload.dependencies.redis.ok).toBe(true);
  });

  it('returns 503 when database is unhealthy', async () => {
    vi.spyOn(dbClient, 'checkDatabaseReady').mockResolvedValue(false);
    vi.spyOn(dbClient, 'checkRedisReady').mockResolvedValue({ ok: false, status: 'end' });

    const response = await app.inject({
      method: 'GET',
      url: '/ready',
    });

    expect(response.statusCode).toBe(503);
    const payload = response.json();
    expect(payload.ok).toBe(false);
    expect(payload.dependencies.database.ok).toBe(false);
  });
});
