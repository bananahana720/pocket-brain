import { z } from 'zod';

const TRUE_ENV_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_ENV_VALUES = new Set(['0', 'false', 'no', 'off']);

export function parseBooleanEnvValue(value: unknown): unknown {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return value;

  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (TRUE_ENV_VALUES.has(normalized)) return true;
  if (FALSE_ENV_VALUES.has(normalized)) return false;
  return value;
}

const booleanFromEnv = z.preprocess(parseBooleanEnvValue, z.boolean());
const optionalBooleanFromEnv = z.preprocess(parseBooleanEnvValue, z.boolean().optional());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SERVER_PORT: z.coerce.number().int().min(1).max(65535).default(8788),
  SERVER_HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  CLERK_SECRET_KEY: z.string().optional(),
  CLERK_PUBLISHABLE_KEY: z.string().optional(),
  KEY_ENCRYPTION_SECRET: z.string().min(16),
  CORS_ORIGIN: z.string().default('*'),
  TRUST_PROXY: booleanFromEnv.default(true),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  AUTH_DEV_USER_ID: z.string().default('dev-user-local'),
  ALLOW_INSECURE_DEV_AUTH: optionalBooleanFromEnv,
  STREAM_TICKET_SECRET: z.string().optional(),
  STREAM_TICKET_TTL_SECONDS: z.coerce.number().int().min(15).max(900).default(60),
  MAINTENANCE_INTERVAL_MS: z.coerce.number().int().min(60_000).default(600_000),
  TOMBSTONE_RETENTION_MS: z.coerce.number().int().min(24 * 60 * 60 * 1000).default(30 * 24 * 60 * 60 * 1000),
  NOTE_CHANGES_RETENTION_MS: z.coerce.number().int().min(24 * 60 * 60 * 1000).default(30 * 24 * 60 * 60 * 1000),
  SYNC_BATCH_LIMIT: z.coerce.number().int().min(1).max(500).default(100),
  SYNC_PULL_LIMIT: z.coerce.number().int().min(1).max(2000).default(500),
  REQUIRE_REDIS_FOR_READY: optionalBooleanFromEnv,
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const formatted = parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('\n');
  throw new Error(`Invalid environment:\n${formatted}`);
}

const allowInsecureDevAuth = parsed.data.ALLOW_INSECURE_DEV_AUTH ?? parsed.data.NODE_ENV !== 'production';
const streamTicketSecret = (parsed.data.STREAM_TICKET_SECRET || parsed.data.KEY_ENCRYPTION_SECRET).trim();
const requireRedisForReady = parsed.data.REQUIRE_REDIS_FOR_READY ?? parsed.data.NODE_ENV === 'production';

if (parsed.data.NODE_ENV === 'production' && allowInsecureDevAuth) {
  throw new Error('Invalid environment:\nALLOW_INSECURE_DEV_AUTH must be false in production.');
}

if (!allowInsecureDevAuth && !parsed.data.CLERK_SECRET_KEY) {
  throw new Error('Invalid environment:\nCLERK_SECRET_KEY is required when ALLOW_INSECURE_DEV_AUTH is false.');
}

if (streamTicketSecret.length < 16) {
  throw new Error('Invalid environment:\nSTREAM_TICKET_SECRET must be at least 16 characters.');
}

export const env = {
  ...parsed.data,
  ALLOW_INSECURE_DEV_AUTH: allowInsecureDevAuth,
  STREAM_TICKET_SECRET: streamTicketSecret,
  REQUIRE_REDIS_FOR_READY: requireRedisForReady,
};
export type AppEnv = typeof env;
