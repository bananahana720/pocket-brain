import { afterEach, describe, expect, it, vi } from 'vitest';

const BASE_ENV = { ...process.env };

function setEnv(overrides: Record<string, string | undefined>) {
  process.env = {
    ...BASE_ENV,
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/pocketbrain_test',
    REDIS_URL: 'redis://localhost:6379',
    KEY_ENCRYPTION_SECRET: '0123456789abcdef0123456789abcdef',
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
    });

    const module = await import('../src/config/env.js');
    expect(module.env.ALLOW_INSECURE_DEV_AUTH).toBe(false);
    expect(module.env.TRUST_PROXY).toBe(false);
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
});
