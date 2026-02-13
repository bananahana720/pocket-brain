import { afterEach, describe, expect, it, vi } from 'vitest';

const BASE_ENV = { ...process.env };

function setEnv(overrides: Record<string, string | undefined>) {
  process.env = {
    ...BASE_ENV,
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/pocketbrain_test',
    REDIS_URL: 'redis://localhost:6379',
    KEY_ENCRYPTION_SECRET: 'server-test-key-0123456789abcdef',
    CORS_ORIGIN: '*',
    AUTH_DEV_USER_ID: 'dev-user-test',
    ...overrides,
  };
}

describe('env config parsing', () => {
  afterEach(() => {
    process.env = { ...BASE_ENV };
    vi.resetModules();
  });

  it('parses false-like string flags correctly in production', async () => {
    setEnv({
      NODE_ENV: 'production',
      ALLOW_INSECURE_DEV_AUTH: 'false',
      TRUST_PROXY: 'false',
      REQUIRE_REDIS_FOR_READY: 'true',
      CLERK_SECRET_KEY: 'sk_test_123',
      STREAM_TICKET_SECRET: 'server-stream-key-abcdef0123456789',
      CORS_ORIGIN: 'https://app.example.com',
    });

    const module = await import('../src/config/env.js');
    expect(module.env.ALLOW_INSECURE_DEV_AUTH).toBe(false);
    expect(module.env.TRUST_PROXY).toBe(false);
    expect(module.env.REQUIRE_REDIS_FOR_READY).toBe(true);
  });

  it('defaults REQUIRE_REDIS_FOR_READY to true in production', async () => {
    setEnv({
      NODE_ENV: 'production',
      ALLOW_INSECURE_DEV_AUTH: 'false',
      CLERK_SECRET_KEY: 'sk_test_123',
      STREAM_TICKET_SECRET: 'server-stream-key-abcdef0123456789',
      CORS_ORIGIN: 'https://app.example.com',
      REQUIRE_REDIS_FOR_READY: undefined,
    });

    const module = await import('../src/config/env.js');
    expect(module.env.REQUIRE_REDIS_FOR_READY).toBe(true);
  });

  it('defaults REQUIRE_REDIS_FOR_READY to false outside production', async () => {
    setEnv({
      NODE_ENV: 'test',
      REQUIRE_REDIS_FOR_READY: undefined,
    });

    const module = await import('../src/config/env.js');
    expect(module.env.REQUIRE_REDIS_FOR_READY).toBe(false);
  });

  it('uses 45-day note-change retention and current PG pool defaults', async () => {
    setEnv({
      NODE_ENV: 'test',
      NOTE_CHANGES_RETENTION_MS: undefined,
      PG_POOL_MAX: undefined,
      PG_POOL_IDLE_TIMEOUT_MS: undefined,
      PG_POOL_CONNECTION_TIMEOUT_MS: undefined,
    });

    const module = await import('../src/config/env.js');
    expect(module.env.NOTE_CHANGES_RETENTION_MS).toBe(45 * 24 * 60 * 60 * 1000);
    expect(module.env.PG_POOL_MAX).toBe(20);
    expect(module.env.PG_POOL_IDLE_TIMEOUT_MS).toBe(30_000);
    expect(module.env.PG_POOL_CONNECTION_TIMEOUT_MS).toBe(5_000);
  });

  it('fails closed in production when ALLOW_INSECURE_DEV_AUTH is true', async () => {
    setEnv({
      NODE_ENV: 'production',
      ALLOW_INSECURE_DEV_AUTH: 'true',
    });

    await expect(import('../src/config/env.js')).rejects.toThrow(
      'ALLOW_INSECURE_DEV_AUTH must be false in production.'
    );
  });

  it('rejects invalid boolean strings for TRUST_PROXY', async () => {
    setEnv({
      TRUST_PROXY: 'not-a-bool',
    });

    await expect(import('../src/config/env.js')).rejects.toThrow('Invalid environment:');
  });

  it('requires explicit non-wildcard CORS_ORIGIN in production', async () => {
    setEnv({
      NODE_ENV: 'production',
      ALLOW_INSECURE_DEV_AUTH: 'false',
      CLERK_SECRET_KEY: 'sk_test_123',
      STREAM_TICKET_SECRET: 'server-stream-key-abcdef0123456789',
      CORS_ORIGIN: '*',
    });

    await expect(import('../src/config/env.js')).rejects.toThrow(
      'CORS_ORIGIN must be explicit (no wildcard) in production.'
    );
  });

  it('requires STREAM_TICKET_SECRET to be explicit and distinct in production', async () => {
    setEnv({
      NODE_ENV: 'production',
      ALLOW_INSECURE_DEV_AUTH: 'false',
      CLERK_SECRET_KEY: 'sk_test_123',
      CORS_ORIGIN: 'https://app.example.com',
      STREAM_TICKET_SECRET: undefined,
    });

    await expect(import('../src/config/env.js')).rejects.toThrow(
      'STREAM_TICKET_SECRET must be explicitly set in production.'
    );
  });

  it('rejects production config when STREAM_TICKET_SECRET matches KEY_ENCRYPTION_SECRET', async () => {
    setEnv({
      NODE_ENV: 'production',
      ALLOW_INSECURE_DEV_AUTH: 'false',
      CLERK_SECRET_KEY: 'sk_test_123',
      CORS_ORIGIN: 'https://app.example.com',
      KEY_ENCRYPTION_SECRET: 'production-secret-0000111122223333',
      STREAM_TICKET_SECRET: 'production-secret-0000111122223333',
    });

    await expect(import('../src/config/env.js')).rejects.toThrow(
      'STREAM_TICKET_SECRET must differ from KEY_ENCRYPTION_SECRET in production.'
    );
  });

  it('rejects placeholder production secrets', async () => {
    setEnv({
      NODE_ENV: 'production',
      ALLOW_INSECURE_DEV_AUTH: 'false',
      CLERK_SECRET_KEY: 'sk_test_123',
      CORS_ORIGIN: 'https://app.example.com',
      KEY_ENCRYPTION_SECRET: 'replace-with-32-byte-secret',
      STREAM_TICKET_SECRET: 'replace-with-separate-stream-ticket-secret',
    });

    await expect(import('../src/config/env.js')).rejects.toThrow(
      'Encryption secrets look like placeholders; set real production secrets.'
    );
  });
});
