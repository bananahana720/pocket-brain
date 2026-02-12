import { and, eq } from 'drizzle-orm';
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { db } from '../db/client.js';
import { aiProviderKeys } from '../db/schema.js';
import { env } from '../config/env.js';

type Provider = 'gemini' | 'openrouter';

function getAesKey(): Buffer {
  return createHash('sha256').update(env.KEY_ENCRYPTION_SECRET).digest();
}

function encrypt(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getAesKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return JSON.stringify({
    iv: iv.toString('base64'),
    data: encrypted.toString('base64'),
    tag: tag.toString('base64'),
  });
}

function decrypt(payload: string): string {
  const parsed = JSON.parse(payload) as { iv: string; data: string; tag: string };
  const decipher = createDecipheriv(
    'aes-256-gcm',
    getAesKey(),
    Buffer.from(parsed.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(parsed.data, 'base64')),
    decipher.final(),
  ]);

  return plaintext.toString('utf8');
}

export async function getAiKeyStatus(userId: string): Promise<{
  connected: boolean;
  provider?: Provider;
  updatedAt?: number;
  connectedAt?: number;
}> {
  const row = await db.query.aiProviderKeys.findFirst({
    where: eq(aiProviderKeys.userId, userId),
  });

  if (!row) {
    return { connected: false };
  }

  return {
    connected: true,
    provider: row.provider,
    updatedAt: row.updatedAt,
    connectedAt: row.createdAt,
  };
}

export async function connectAiKey(userId: string, provider: Provider, apiKey: string): Promise<{
  connected: true;
  provider: Provider;
  connectedAt: number;
  updatedAt: number;
}> {
  const now = Date.now();
  const encryptedApiKey = encrypt(apiKey);

  await db
    .insert(aiProviderKeys)
    .values({
      userId,
      provider,
      encryptedApiKey,
      encryptedKeyVersion: 'v1',
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: aiProviderKeys.userId,
      set: {
        provider,
        encryptedApiKey,
        encryptedKeyVersion: 'v1',
        updatedAt: now,
      },
    });

  const persisted = await db.query.aiProviderKeys.findFirst({ where: eq(aiProviderKeys.userId, userId) });

  return {
    connected: true,
    provider,
    connectedAt: persisted?.createdAt || now,
    updatedAt: now,
  };
}

export async function disconnectAiKey(userId: string): Promise<void> {
  await db.delete(aiProviderKeys).where(eq(aiProviderKeys.userId, userId));
}

export async function getAiProviderCredentials(userId: string): Promise<{ provider: Provider; apiKey: string } | null> {
  const row = await db.query.aiProviderKeys.findFirst({
    where: and(eq(aiProviderKeys.userId, userId)),
  });

  if (!row) return null;

  return {
    provider: row.provider,
    apiKey: decrypt(row.encryptedApiKey),
  };
}
