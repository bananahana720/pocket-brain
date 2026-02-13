#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SERVER_ENV_PATH = path.join(ROOT, 'server', '.env');
const WRANGLER_PATH = path.join(ROOT, 'worker', 'wrangler.toml');

function parseArgs(argv) {
  const result = {
    scope: 'all',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const part = argv[i];
    if (part === '--scope') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('--scope requires a value');
      }
      if (!['all', 'server', 'worker'].includes(value)) {
        throw new Error(`Unsupported --scope value: ${value}`);
      }
      result.scope = value;
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${part}`);
  }

  return result;
}

function parseBoolean(value) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return undefined;
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};

  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;

    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    parsed[key] = value;
  }

  return parsed;
}

function parseWranglerVars(filePath) {
  if (!fs.existsSync(filePath)) return {};

  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const parsed = {};
  let inVars = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) {
      inVars = trimmed === '[vars]';
      continue;
    }

    if (!inVars || !trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^([A-Z0-9_]+)\s*=\s*"([\s\S]*)"$/);
    if (!match) continue;

    parsed[match[1]] = match[2];
  }

  return parsed;
}

function isPlaceholderSecret(value) {
  if (!value) return true;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;
  return (
    normalized.includes('replace-with') ||
    normalized.includes('your-') ||
    normalized.includes('example')
  );
}

function isLoopbackHost(hostname) {
  const normalized = String(hostname || '').trim().toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '[::1]' || normalized === '::1';
}

function validateHttpsOrigin(value) {
  if (!value) {
    return { ok: false, reason: 'missing' };
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, reason: 'invalid' };
  }

  if (parsed.protocol !== 'https:' && !isLoopbackHost(parsed.hostname)) {
    return { ok: false, reason: 'insecure' };
  }

  return { ok: true, reason: 'ok' };
}

function validateServerConfig(errors) {
  const fromFile = parseEnvFile(SERVER_ENV_PATH);
  const config = {
    ...fromFile,
    ...process.env,
  };

  const nodeEnv = String(config.NODE_ENV || process.env.NODE_ENV || 'development').toLowerCase();
  const isProduction = nodeEnv === 'production';

  const allowInsecureDevAuth = parseBoolean(config.ALLOW_INSECURE_DEV_AUTH);
  if (isProduction && allowInsecureDevAuth !== false) {
    errors.push('server: ALLOW_INSECURE_DEV_AUTH must be false in production');
  }

  const requireRedisForReady = parseBoolean(config.REQUIRE_REDIS_FOR_READY);
  if (isProduction && requireRedisForReady === false) {
    errors.push('server: REQUIRE_REDIS_FOR_READY must be true in production');
  }

  const keySecret = String(config.KEY_ENCRYPTION_SECRET || '').trim();
  const hasKeySecret = !!keySecret;
  const keySecretMinLen = isProduction ? 32 : 16;
  if ((isProduction || hasKeySecret) && (isPlaceholderSecret(keySecret) || keySecret.length < keySecretMinLen)) {
    errors.push(
      `server: KEY_ENCRYPTION_SECRET must be set to a non-placeholder value with at least ${keySecretMinLen} chars`
    );
  }

  const streamSecret = String(config.STREAM_TICKET_SECRET || keySecret).trim();
  const hasStreamSecret = !!streamSecret;
  if ((isProduction || hasStreamSecret) && (isPlaceholderSecret(streamSecret) || streamSecret.length < 16)) {
    errors.push('server: STREAM_TICKET_SECRET must be set (or fallback secret must be valid) with at least 16 chars');
  }
}

function validateWorkerConfig(errors) {
  const wranglerVars = parseWranglerVars(WRANGLER_PATH);
  const config = {
    ...wranglerVars,
    ...process.env,
  };

  const nodeEnv = String(process.env.NODE_ENV || 'development').toLowerCase();
  const isProduction = nodeEnv === 'production';

  const allowInsecureDevAuth = parseBoolean(config.ALLOW_INSECURE_DEV_AUTH);
  if (isProduction && allowInsecureDevAuth === true) {
    errors.push('worker: ALLOW_INSECURE_DEV_AUTH must be false in production');
  }

  const clerkTuple = [
    String(config.CLERK_JWKS_URL || '').trim(),
    String(config.CLERK_ISSUER || '').trim(),
    String(config.CLERK_AUDIENCE || '').trim(),
  ];
  const clerkDefined = clerkTuple.filter(Boolean).length;
  if (clerkDefined > 0 && clerkDefined < 3) {
    errors.push('worker: CLERK_JWKS_URL, CLERK_ISSUER, and CLERK_AUDIENCE must be set together');
  }

  const keySecret = String(config.KEY_ENCRYPTION_SECRET || process.env.KEY_ENCRYPTION_SECRET || '').trim();
  const keySecretMinLen = isProduction ? 32 : 16;
  if ((isProduction || keySecret) && (isPlaceholderSecret(keySecret) || keySecret.length < keySecretMinLen)) {
    errors.push(
      `worker: KEY_ENCRYPTION_SECRET must be non-placeholder and at least ${keySecretMinLen} chars in ${
        isProduction ? 'production' : 'runtime env'
      }`
    );
  }

  const vpsOrigin = String(config.VPS_API_ORIGIN || '').trim();
  if (isProduction && !vpsOrigin) {
    errors.push('worker: VPS_API_ORIGIN must be set in production');
  }

  if (vpsOrigin) {
    const originValidation = validateHttpsOrigin(vpsOrigin);
    if (!originValidation.ok) {
      errors.push('worker: VPS_API_ORIGIN must be a valid absolute URL and use https:// outside loopback hosts');
    }
  }
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const errors = [];

    if (args.scope === 'all' || args.scope === 'server') {
      validateServerConfig(errors);
    }

    if (args.scope === 'all' || args.scope === 'worker') {
      validateWorkerConfig(errors);
    }

    if (errors.length > 0) {
      console.error('Runtime config validation failed:');
      for (const error of errors) {
        console.error(`- ${error}`);
      }
      process.exit(1);
    }

    console.log(`Runtime config validation passed for scope: ${args.scope}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Runtime config validation error: ${message}`);
    process.exit(1);
  }
}

main();
