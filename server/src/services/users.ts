import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';

export async function ensureUser(clerkUserId: string): Promise<{ id: string; clerkUserId: string }> {
  const existing = await db.query.users.findFirst({ where: eq(users.clerkUserId, clerkUserId) });
  if (existing) {
    const now = Date.now();
    if (existing.updatedAt < now - 60_000) {
      await db.update(users).set({ updatedAt: now }).where(eq(users.id, existing.id));
    }
    return { id: existing.id, clerkUserId: existing.clerkUserId };
  }

  const now = Date.now();
  const [created] = await db
    .insert(users)
    .values({
      clerkUserId,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: users.id, clerkUserId: users.clerkUserId });

  return created;
}
