import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { devices } from '../db/schema.js';

export interface DeviceDescriptor {
  id: string;
  label: string;
  platform: string;
  lastSeenAt: number;
  revokedAt?: number | null;
  createdAt: number;
}

function deriveLabel(userAgent: string | undefined): { label: string; platform: string } {
  if (!userAgent) {
    return { label: 'Unknown device', platform: 'unknown' };
  }

  const value = userAgent.toLowerCase();
  const isMobile = /android|iphone|ipad|mobile/.test(value);
  const platform = isMobile ? 'mobile-web' : 'desktop-web';

  if (value.includes('chrome')) return { label: isMobile ? 'Mobile Chrome' : 'Desktop Chrome', platform };
  if (value.includes('safari')) return { label: isMobile ? 'Mobile Safari' : 'Desktop Safari', platform };
  if (value.includes('firefox')) return { label: isMobile ? 'Mobile Firefox' : 'Desktop Firefox', platform };

  return { label: isMobile ? 'Mobile browser' : 'Desktop browser', platform };
}

export async function upsertDevice(args: {
  userId: string;
  deviceId: string;
  userAgent?: string;
}): Promise<void> {
  const now = Date.now();
  const descriptor = deriveLabel(args.userAgent);

  const existing = await db.query.devices.findFirst({
    where: and(eq(devices.userId, args.userId), eq(devices.id, args.deviceId)),
  });

  if (!existing) {
    await db.insert(devices).values({
      id: args.deviceId,
      userId: args.userId,
      label: descriptor.label,
      platform: descriptor.platform,
      lastSeenAt: now,
      createdAt: now,
      revokedAt: null,
    });
    return;
  }

  await db
    .update(devices)
    .set({
      label: existing.label || descriptor.label,
      platform: existing.platform || descriptor.platform,
      lastSeenAt: now,
    })
    .where(and(eq(devices.userId, args.userId), eq(devices.id, args.deviceId)));
}

export async function assertDeviceActive(userId: string, deviceId: string): Promise<void> {
  const row = await db.query.devices.findFirst({
    where: and(eq(devices.userId, userId), eq(devices.id, deviceId), isNull(devices.revokedAt)),
  });

  if (!row) {
    const error = new Error('Device revoked');
    (error as Error & { code?: string }).code = 'DEVICE_REVOKED';
    throw error;
  }
}

export async function listDevices(userId: string): Promise<DeviceDescriptor[]> {
  const rows = await db.query.devices.findMany({
    where: eq(devices.userId, userId),
    orderBy: (table, helpers) => [helpers.desc(table.lastSeenAt)],
  });

  return rows.map(row => ({
    id: row.id,
    label: row.label,
    platform: row.platform,
    lastSeenAt: row.lastSeenAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  }));
}

export async function revokeDevice(userId: string, deviceId: string): Promise<boolean> {
  const now = Date.now();
  const result = await db
    .update(devices)
    .set({ revokedAt: now })
    .where(and(eq(devices.userId, userId), eq(devices.id, deviceId), isNull(devices.revokedAt)))
    .returning({ id: devices.id });

  return result.length > 0;
}
