import fs from 'node:fs/promises';
import net from 'node:net';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { STREAM_TICKET_COOKIE_NAME } from '../src/auth/streamTicket.js';

const CHAOS_ENABLED = process.env.RUN_CHAOS_TESTS === '1';
const SERVER_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SQL_SCHEMA_URL = new URL('../drizzle/0000_initial.sql', import.meta.url);
const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/pocketbrain_test';
const CHAOS_USER_ID = 'chaos-user-sync';
const REDIS_UNAVAILABLE_URL = 'redis://127.0.0.1:6399';

interface RunningServer {
  baseUrl: string;
  process: ChildProcessWithoutNullStreams;
  getLogs: () => string;
}

interface HttpResult<T = unknown> {
  status: number;
  body: T | null;
  text: string;
  headers: Headers;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseCookie(headerValue: string | null, cookieName: string): string | null {
  if (!headerValue) return null;
  const marker = `${cookieName}=`;
  const markerIndex = headerValue.indexOf(marker);
  if (markerIndex < 0) return null;
  const valueStart = markerIndex + marker.length;
  const valueSlice = headerValue.slice(valueStart);
  return valueSlice.split(';')[0] || null;
}

async function probeDatabase(): Promise<{ available: true } | { available: false; reason: string }> {
  const client = new Client({ connectionString: DATABASE_URL });
  try {
    await client.connect();
    await client.query('select 1');
    return { available: true };
  } catch (error) {
    const details = error as { message?: unknown; code?: unknown; errno?: unknown };
    const message =
      typeof details?.message === 'string' && details.message.trim()
        ? details.message.trim()
        : typeof details?.code === 'string'
        ? details.code
        : typeof details?.errno === 'string' || typeof details?.errno === 'number'
        ? String(details.errno)
        : 'unknown error';
    return { available: false, reason: `database unavailable (${message})` };
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function probeLoopbackBinding(): Promise<{ available: true } | { available: false; reason: string }> {
  return new Promise(resolve => {
    const probe = net.createServer();
    probe.once('error', error => {
      const details = error as NodeJS.ErrnoException;
      resolve({
        available: false,
        reason: `loopback bind unavailable (${details.code || details.message})`,
      });
    });

    probe.listen(0, '127.0.0.1', () => {
      probe.close(() => resolve({ available: true }));
    });
  });
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (!address || typeof address === 'string') {
        probe.close(() => reject(new Error('Failed to resolve free port')));
        return;
      }
      const port = address.port;
      probe.close(err => {
        if (err) {
          reject(err);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function readJson<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text.trim()) return null;
  return JSON.parse(text) as T;
}

async function requestJson<T = unknown>(url: string, init?: RequestInit): Promise<HttpResult<T>> {
  const response = await fetch(url, init);
  const text = await response.text();
  let body: T | null = null;
  if (text.trim()) {
    body = JSON.parse(text) as T;
  }
  return {
    status: response.status,
    body,
    text,
    headers: response.headers,
  };
}

async function waitForHealthyStart(port: number, processRef: ChildProcessWithoutNullStreams, getLogs: () => string): Promise<void> {
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    if (processRef.exitCode !== null) {
      throw new Error(`Server exited before readiness check. Logs:\n${getLogs()}`);
    }

    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      const payload = await readJson<{ ok?: boolean }>(response);
      if (response.status === 200 && payload?.ok) {
        return;
      }
    } catch {
      // Retry while process boots.
    }

    await sleep(200);
  }

  throw new Error(`Server did not start within timeout. Logs:\n${getLogs()}`);
}

async function startServer(args: { requireRedisForReady: boolean }): Promise<RunningServer> {
  const port = await getFreePort();
  let logs = '';

  const processRef = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: SERVER_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      SERVER_HOST: '127.0.0.1',
      SERVER_PORT: String(port),
      DATABASE_URL,
      REDIS_URL: REDIS_UNAVAILABLE_URL,
      CORS_ORIGIN: '*',
      TRUST_PROXY: 'true',
      LOG_LEVEL: 'error',
      KEY_ENCRYPTION_SECRET: '0123456789abcdef0123456789abcdef',
      STREAM_TICKET_SECRET: 'fedcba9876543210fedcba9876543210',
      STREAM_TICKET_TTL_SECONDS: '60',
      AUTH_DEV_USER_ID: CHAOS_USER_ID,
      ALLOW_INSECURE_DEV_AUTH: 'true',
      REQUIRE_REDIS_FOR_READY: args.requireRedisForReady ? 'true' : 'false',
      CLERK_SECRET_KEY: 'sk_test_server',
      CLERK_PUBLISHABLE_KEY: 'pk_test_server',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  processRef.stdout.on('data', chunk => {
    logs += String(chunk);
  });
  processRef.stderr.on('data', chunk => {
    logs += String(chunk);
  });

  await waitForHealthyStart(port, processRef, () => logs);
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    process: processRef,
    getLogs: () => logs,
  };
}

async function stopServer(server: RunningServer): Promise<void> {
  if (server.process.exitCode !== null) return;

  await new Promise<void>(resolve => {
    const timeout = setTimeout(() => {
      server.process.kill('SIGKILL');
    }, 5_000);

    server.process.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });

    server.process.kill('SIGTERM');
  });
}

async function clearTables(): Promise<void> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query(`
      TRUNCATE TABLE
        sync_bootstrap,
        note_changes,
        idempotency_keys,
        ai_provider_keys,
        notes,
        devices,
        users
      RESTART IDENTITY CASCADE
    `);
  } finally {
    await client.end();
  }
}

async function ensureSchema(): Promise<void> {
  const schemaSql = await fs.readFile(SQL_SCHEMA_URL, 'utf8');
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query(schemaSql);
  } finally {
    await client.end();
  }
}

function authHeaders(deviceId: string): HeadersInit {
  return {
    'x-dev-user-id': CHAOS_USER_ID,
    'x-device-id': deviceId,
  };
}

if (!CHAOS_ENABLED) {
  describe('chaos multi-instance workflow', () => {
    it.skip('set RUN_CHAOS_TESTS=1 to run dedicated multi-instance chaos validation', () => {});
  });
} else {
  const dbProbe = await probeDatabase();
  const loopbackProbe = await probeLoopbackBinding();

  if (!dbProbe.available || !loopbackProbe.available) {
    const reason = !dbProbe.available ? dbProbe.reason : loopbackProbe.reason;
    console.warn(`[chaos-multi-instance.test] ${reason}; skipping chaos workflow test.`);
    describe('chaos multi-instance workflow', () => {
      it.skip(`auto-skip: ${reason}`, () => {});
    });
  } else {
    describe('chaos multi-instance workflow', () => {
      const runningServers: RunningServer[] = [];

      afterEach(async () => {
        while (runningServers.length > 0) {
          const server = runningServers.pop();
          if (server) {
            await stopServer(server);
          }
        }
      });

      it('keeps sync/events behavior with two instances while redis is degraded and validates readiness gating', async () => {
        await ensureSchema();
        await clearTables();

        const instanceA = await startServer({ requireRedisForReady: false });
        const instanceB = await startServer({ requireRedisForReady: false });
        runningServers.push(instanceA, instanceB);

        const readyA = await requestJson<{
          ok: boolean;
          dependencies: { realtime: { mode: string; degraded: boolean } };
        }>(`${instanceA.baseUrl}/ready`);
        const readyB = await requestJson<{
          ok: boolean;
          dependencies: { realtime: { mode: string; degraded: boolean } };
        }>(`${instanceB.baseUrl}/ready`);

        expect(readyA.status).toBe(200);
        expect(readyB.status).toBe(200);
        expect(readyA.body?.dependencies.realtime.mode).toBe('local-fallback');
        expect(readyB.body?.dependencies.realtime.mode).toBe('local-fallback');
        expect(readyA.body?.dependencies.realtime.degraded).toBe(true);
        expect(readyB.body?.dependencies.realtime.degraded).toBe(true);

        const ticketA = await requestJson<{ ok: boolean }>(`${instanceA.baseUrl}/api/v2/events/ticket`, {
          method: 'POST',
          headers: authHeaders('chaos-device-a'),
        });
        const ticketB = await requestJson<{ ok: boolean }>(`${instanceB.baseUrl}/api/v2/events/ticket`, {
          method: 'POST',
          headers: authHeaders('chaos-device-b'),
        });

        expect(ticketA.status).toBe(200);
        expect(ticketB.status).toBe(200);

        const streamCookieA = parseCookie(ticketA.headers.get('set-cookie'), STREAM_TICKET_COOKIE_NAME);
        const streamCookieB = parseCookie(ticketB.headers.get('set-cookie'), STREAM_TICKET_COOKIE_NAME);
        expect(streamCookieA).toBeTruthy();
        expect(streamCookieB).toBeTruthy();

        const streamA = await fetch(`${instanceA.baseUrl}/api/v2/events`, {
          method: 'GET',
          headers: {
            cookie: `${STREAM_TICKET_COOKIE_NAME}=${streamCookieA}`,
            'x-sse-test-close': '1',
          },
        });
        const streamB = await fetch(`${instanceB.baseUrl}/api/v2/events`, {
          method: 'GET',
          headers: {
            cookie: `${STREAM_TICKET_COOKIE_NAME}=${streamCookieB}`,
            'x-sse-test-close': '1',
          },
        });

        expect(streamA.status).toBe(200);
        expect(streamB.status).toBe(200);
        expect(await streamA.text()).toContain('event: ready');
        expect(await streamB.text()).toContain('event: ready');

        const now = Date.now();
        const push = await requestJson<{
          applied: Array<{ requestId: string; note: { id: string } }>;
          conflicts: unknown[];
          nextCursor: number;
        }>(`${instanceA.baseUrl}/api/v2/sync/push`, {
          method: 'POST',
          headers: {
            ...authHeaders('chaos-device-a'),
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            operations: [
              {
                requestId: 'chaos-push-0001',
                op: 'upsert',
                noteId: 'chaos-note-1',
                baseVersion: 0,
                note: {
                  id: 'chaos-note-1',
                  content: 'chaos note payload',
                  createdAt: now,
                  updatedAt: now,
                  version: 1,
                  type: 'NOTE',
                  isProcessed: true,
                  isCompleted: false,
                  isArchived: false,
                  isPinned: false,
                },
              },
            ],
          }),
        });

        expect(push.status).toBe(200);
        expect(push.body?.applied).toHaveLength(1);
        expect(push.body?.conflicts).toEqual([]);

        const pull = await requestJson<{
          changes: Array<{ note: { id: string } }>;
          nextCursor: number;
        }>(`${instanceB.baseUrl}/api/v2/sync/pull?cursor=0`, {
          method: 'GET',
          headers: {
            'x-dev-user-id': CHAOS_USER_ID,
            'x-device-id': 'chaos-device-b',
          },
        });

        expect(pull.status).toBe(200);
        expect((pull.body?.changes || []).some(change => change.note.id === 'chaos-note-1')).toBe(true);

        await Promise.all(runningServers.splice(0).map(stopServer));

        const strictA = await startServer({ requireRedisForReady: true });
        const strictB = await startServer({ requireRedisForReady: true });
        runningServers.push(strictA, strictB);

        const strictReadyA = await requestJson<{ ok: boolean }>(`${strictA.baseUrl}/ready`);
        const strictReadyB = await requestJson<{ ok: boolean }>(`${strictB.baseUrl}/ready`);

        expect(strictReadyA.status).toBe(503);
        expect(strictReadyB.status).toBe(503);
        expect(strictReadyA.body?.ok).toBe(false);
        expect(strictReadyB.body?.ok).toBe(false);
      }, 60_000);
    });
  }
}
