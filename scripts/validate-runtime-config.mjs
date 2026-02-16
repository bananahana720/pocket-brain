#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SERVER_ENV_PATH = path.join(ROOT, 'server', '.env');
const WRANGLER_PATH = path.join(ROOT, 'worker', 'wrangler.toml');
const ROOT_ENV_PATH = path.join(ROOT, '.env');

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

const PRODUCTION_SECRET_PLACEHOLDERS = new Set([
  'replace-with-32-byte-secret',
  'replace-with-separate-stream-ticket-secret',
  '0123456789abcdef0123456789abcdef',
  'fedcba9876543210fedcba9876543210',
]);

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

function stripTomlInlineComment(value) {
  let result = '';
  let inDouble = false;
  let inSingle = false;
  let escaped = false;

  for (const char of value) {
    if (inDouble && !escaped && char === '\\') {
      result += char;
      escaped = true;
      continue;
    }

    if (!escaped) {
      if (char === '"' && !inSingle) {
        inDouble = !inDouble;
        result += char;
        continue;
      }

      if (char === "'" && !inDouble) {
        inSingle = !inSingle;
        result += char;
        continue;
      }
    }

    if (char === '#' && !inDouble && !inSingle) {
      break;
    }

    result += char;
    escaped = false;
  }

  return result.trimEnd();
}

function getBracketDelta(value) {
  let delta = 0;
  let inDouble = false;
  let inSingle = false;
  let escaped = false;

  for (const char of value) {
    if (inDouble && !escaped && char === '\\') {
      escaped = true;
      continue;
    }

    if (!escaped) {
      if (char === '"' && !inSingle) {
        inDouble = !inDouble;
        continue;
      }

      if (char === "'" && !inDouble) {
        inSingle = !inSingle;
        continue;
      }
    }

    if (!inDouble && !inSingle) {
      if (char === '[') delta += 1;
      if (char === ']') delta -= 1;
    }

    escaped = false;
  }

  return delta;
}

function hasDeclaredRoutes(routesExpression) {
  const trimmed = String(routesExpression || '').trim();
  if (!trimmed.startsWith('[')) {
    return false;
  }

  const closingIndex = trimmed.lastIndexOf(']');
  if (closingIndex < 0) {
    return false;
  }

  const inner = trimmed.slice(1, closingIndex).replace(/[\s,]/g, '');
  return inner.length > 0;
}

function parseWranglerConfig(filePath) {
  if (!fs.existsSync(filePath)) {
    return {
      vars: {},
      workersDev: undefined,
      routesDeclared: false,
    };
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const parsedVars = {};
  let workersDev;
  let routesExpression = '';
  let inVars = false;
  let seenSection = false;
  let routeBracketDepth = 0;
  let capturingRoutes = false;

  for (const line of lines) {
    const cleaned = stripTomlInlineComment(line);
    const trimmed = cleaned.trim();

    if (!trimmed) continue;

    if (capturingRoutes) {
      routesExpression += `\n${trimmed}`;
      routeBracketDepth += getBracketDelta(trimmed);
      if (routeBracketDepth <= 0) {
        capturingRoutes = false;
      }
      continue;
    }

    if (trimmed.startsWith('[')) {
      seenSection = true;
      inVars = trimmed === '[vars]';
      continue;
    }

    if (!inVars) {
      if (seenSection) {
        continue;
      }

      const workersDevMatch = trimmed.match(/^workers_dev\s*=\s*(.+)$/);
      if (workersDevMatch) {
        workersDev = parseBoolean(workersDevMatch[1].trim());
        continue;
      }

      const routesMatch = trimmed.match(/^routes\s*=\s*(.+)$/);
      if (routesMatch) {
        routesExpression = routesMatch[1].trim();
        routeBracketDepth = getBracketDelta(routesExpression);
        if (routeBracketDepth > 0) {
          capturingRoutes = true;
        }
        continue;
      }

      continue;
    }

    const match = trimmed.match(/^([A-Z0-9_]+)\s*=\s*"([\s\S]*)"$/);
    if (!match) continue;

    parsedVars[match[1]] = match[2];
  }

  return {
    vars: parsedVars,
    workersDev,
    routesDeclared: hasDeclaredRoutes(routesExpression),
  };
}

function isPlaceholderSecret(value) {
  if (!value) return true;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;
  if (PRODUCTION_SECRET_PLACEHOLDERS.has(normalized)) return true;
  return (
    normalized.includes('replace-with') ||
    normalized.includes('your-') ||
    normalized.includes('example')
  );
}

function isPlaceholderClerkKey(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return true;
  return (
    normalized.startsWith('sk_test_') ||
    normalized.startsWith('pk_test_') ||
    normalized.includes('replace-with') ||
    normalized.includes('your-') ||
    normalized.includes('example')
  );
}

function parseCorsOrigins(rawValue) {
  return String(rawValue || '')
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
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

  const streamTicketTtlRaw = String(config.STREAM_TICKET_TTL_SECONDS || '').trim();
  if (streamTicketTtlRaw) {
    const parsedTtl = Number(streamTicketTtlRaw);
    if (!Number.isInteger(parsedTtl) || parsedTtl < 15 || parsedTtl > 900) {
      errors.push('server: STREAM_TICKET_TTL_SECONDS must be an integer between 15 and 900');
    }
  }

  if (isProduction) {
    const clerkSecretKey = String(config.CLERK_SECRET_KEY || '').trim();
    if (isPlaceholderClerkKey(clerkSecretKey)) {
      errors.push('server: CLERK_SECRET_KEY must be a non-placeholder production key (no test key patterns)');
    }

    const clerkPublishableKey = String(config.CLERK_PUBLISHABLE_KEY || '').trim();
    if (clerkPublishableKey && isPlaceholderClerkKey(clerkPublishableKey)) {
      errors.push('server: CLERK_PUBLISHABLE_KEY must be a non-placeholder production key when set');
    }

    const corsOrigins = parseCorsOrigins(config.CORS_ORIGIN || '*');
    if (corsOrigins.length === 0 || corsOrigins.includes('*')) {
      errors.push('server: CORS_ORIGIN must be explicit (no wildcard) in production');
    }

    const explicitStreamSecret = String(config.STREAM_TICKET_SECRET || '').trim();
    if (!explicitStreamSecret) {
      errors.push('server: STREAM_TICKET_SECRET must be explicitly set in production');
    }

    if (streamSecret && keySecret && streamSecret === keySecret) {
      errors.push('server: STREAM_TICKET_SECRET must differ from KEY_ENCRYPTION_SECRET in production');
    }

    if (parseBoolean(config.ALLOW_LEGACY_SSE_QUERY_TOKEN) === true) {
      errors.push('server: ALLOW_LEGACY_SSE_QUERY_TOKEN must be false in production');
    }
  }
}

function validateWorkerConfig(errors) {
  const wranglerConfig = parseWranglerConfig(WRANGLER_PATH);
  const rootEnv = parseEnvFile(ROOT_ENV_PATH);
  const config = {
    ...wranglerConfig.vars,
    ...rootEnv,
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
  const [clerkJwksUrl, clerkIssuer] = clerkTuple;
  const clerkDefined = clerkTuple.filter(Boolean).length;
  if (clerkDefined > 0 && clerkDefined < 3) {
    errors.push('worker: CLERK_JWKS_URL, CLERK_ISSUER, and CLERK_AUDIENCE must be set together');
  }
  if (isProduction && allowInsecureDevAuth !== true && clerkDefined === 0) {
    errors.push(
      'worker: CLERK_JWKS_URL, CLERK_ISSUER, and CLERK_AUDIENCE are required in production unless ALLOW_INSECURE_DEV_AUTH=true'
    );
  }
  if (clerkDefined === 3) {
    const jwksValidation = validateHttpsOrigin(clerkJwksUrl);
    if (!jwksValidation.ok) {
      errors.push('worker: CLERK_JWKS_URL must be a valid absolute URL and use https:// outside loopback hosts');
    }

    const issuerValidation = validateHttpsOrigin(clerkIssuer);
    if (!issuerValidation.ok) {
      errors.push('worker: CLERK_ISSUER must be a valid absolute URL and use https:// outside loopback hosts');
    }
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

  const previousKeySecret = String(config.KEY_ENCRYPTION_SECRET_PREV || '').trim();
  if (previousKeySecret) {
    if (isPlaceholderSecret(previousKeySecret) || previousKeySecret.length < keySecretMinLen) {
      errors.push(
        `worker: KEY_ENCRYPTION_SECRET_PREV must be non-placeholder and at least ${keySecretMinLen} chars when set`
      );
    }
    if (keySecret && previousKeySecret === keySecret) {
      errors.push('worker: KEY_ENCRYPTION_SECRET_PREV must differ from KEY_ENCRYPTION_SECRET when set');
    }
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

  const workerRouteMode = String(config.WORKER_ROUTE_MODE || '').trim().toLowerCase();
  if (isProduction && !wranglerConfig.routesDeclared && workerRouteMode !== 'dashboard') {
    const workersDevState = wranglerConfig.workersDev === undefined ? 'unset' : String(wranglerConfig.workersDev);
    errors.push(
      `worker: no routes are declared in worker/wrangler.toml (workers_dev=${workersDevState}). ` +
        'Declare top-level routes in worker/wrangler.toml or set WORKER_ROUTE_MODE=dashboard to acknowledge ' +
        'Cloudflare Dashboard-managed routes.'
    );
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
