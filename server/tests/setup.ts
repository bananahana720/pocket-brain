process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/pocketbrain_test';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.KEY_ENCRYPTION_SECRET = process.env.KEY_ENCRYPTION_SECRET || '0123456789abcdef0123456789abcdef';
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
process.env.AUTH_DEV_USER_ID = process.env.AUTH_DEV_USER_ID || 'dev-user-test';
