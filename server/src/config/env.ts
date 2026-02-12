import { z } from 'zod';

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
  TRUST_PROXY: z.coerce.boolean().default(true),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  AUTH_DEV_USER_ID: z.string().default('dev-user-local'),
  ALLOW_INSECURE_DEV_AUTH: z.coerce.boolean().optional(),
  SYNC_BATCH_LIMIT: z.coerce.number().int().min(1).max(500).default(100),
  SYNC_PULL_LIMIT: z.coerce.number().int().min(1).max(2000).default(500),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const formatted = parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('\n');
  throw new Error(`Invalid environment:\n${formatted}`);
}

const allowInsecureDevAuth = parsed.data.ALLOW_INSECURE_DEV_AUTH ?? parsed.data.NODE_ENV !== 'production';

if (parsed.data.NODE_ENV === 'production' && allowInsecureDevAuth) {
  throw new Error('Invalid environment:\nALLOW_INSECURE_DEV_AUTH must be false in production.');
}

export const env = {
  ...parsed.data,
  ALLOW_INSECURE_DEV_AUTH: allowInsecureDevAuth,
};
export type AppEnv = typeof env;
