import { test, expect, BrowserContext, Route } from '@playwright/test';
import { createNoteViaUI, gotoWithNotes } from './helpers';

type SyncNote = {
  id: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  version: number;
  deletedAt?: number;
  title?: string;
  tags?: string[];
  type?: 'NOTE' | 'TASK' | 'IDEA';
  isProcessed?: boolean;
  isCompleted?: boolean;
  isArchived?: boolean;
  isPinned?: boolean;
  dueDate?: number;
  priority?: 'urgent' | 'normal' | 'low';
  analysisState?: 'pending' | 'complete' | 'failed';
  analysisVersion?: number;
  contentHash?: string;
  lastModifiedByDeviceId?: string;
};

type SyncOperation = {
  requestId: string;
  op: 'upsert' | 'delete';
  noteId: string;
  baseVersion: number;
  note?: SyncNote;
};

function json(route: Route, payload: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload),
  });
}

test.describe('sync multi-context', () => {
  test('propagates desktop/mobile updates and replays offline queued edits', async ({ browser }) => {
    const notes = new Map<string, SyncNote>();
    const changes: Array<{ cursor: number; op: 'upsert' | 'delete'; note: SyncNote; requestId: string }> = [];
    const seenDevices = new Set<string>();
    let cursor = 0;

    const handleApiRoute = async (route: Route) => {
      const request = route.request();
      const url = new URL(request.url());
      const { pathname } = url;
      const deviceId = request.headers()['x-device-id'] || `device-${seenDevices.size + 1}`;
      seenDevices.add(deviceId);

      if (pathname === '/api/v2/notes' && request.method() === 'GET') {
        const includeDeleted = url.searchParams.get('includeDeleted') !== 'false';
        const snapshot = Array.from(notes.values())
          .filter(note => includeDeleted || !note.deletedAt)
          .sort((a, b) => b.updatedAt - a.updatedAt);
        return json(route, { notes: snapshot, cursor });
      }

      if (pathname === '/api/v2/sync/pull' && request.method() === 'GET') {
        const fromCursor = Number(url.searchParams.get('cursor') || '0');
        const pending = changes.filter(change => change.cursor > fromCursor);
        return json(route, {
          changes: pending,
          nextCursor: pending.length > 0 ? pending[pending.length - 1].cursor : fromCursor,
        });
      }

      if (pathname === '/api/v2/sync/push' && request.method() === 'POST') {
        const payload = JSON.parse(request.postData() || '{}') as { operations?: SyncOperation[] };
        const operations = payload.operations || [];

        const applied: Array<{ requestId: string; note: SyncNote; cursor: number }> = [];
        const conflicts: Array<{
          requestId: string;
          noteId: string;
          baseVersion: number;
          currentVersion: number;
          serverNote: SyncNote;
          changedFields: string[];
        }> = [];

        for (const op of operations) {
          const current = notes.get(op.noteId);
          const currentVersion = current?.version || 0;
          if (op.baseVersion !== currentVersion) {
            conflicts.push({
              requestId: op.requestId,
              noteId: op.noteId,
              baseVersion: op.baseVersion,
              currentVersion,
              serverNote:
                current ||
                ({
                  id: op.noteId,
                  content: '',
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                  version: currentVersion,
                  deletedAt: Date.now(),
                } as SyncNote),
              changedFields: ['content'],
            });
            continue;
          }

          let persisted: SyncNote;
          if (op.op === 'delete') {
            const deletedAt = Date.now();
            persisted = {
              ...(current || {
                id: op.noteId,
                content: '',
                createdAt: deletedAt,
                type: 'NOTE',
              }),
              updatedAt: deletedAt,
              deletedAt,
              version: currentVersion + 1,
              lastModifiedByDeviceId: deviceId,
            };
          } else {
            const now = Date.now();
            persisted = {
              ...(op.note as SyncNote),
              id: op.noteId,
              updatedAt: now,
              createdAt: op.note?.createdAt || current?.createdAt || now,
              version: currentVersion + 1,
              lastModifiedByDeviceId: deviceId,
            };
          }

          notes.set(op.noteId, persisted);
          cursor += 1;
          const change = {
            cursor,
            op: persisted.deletedAt ? ('delete' as const) : ('upsert' as const),
            note: persisted,
            requestId: op.requestId,
          };
          changes.push(change);
          applied.push({
            requestId: op.requestId,
            note: persisted,
            cursor,
          });
        }

        return json(route, {
          applied,
          conflicts,
          nextCursor: cursor,
        });
      }

      if (pathname === '/api/v2/devices' && request.method() === 'GET') {
        const devices = Array.from(seenDevices.values()).map((id, index) => ({
          id,
          label: index === 0 ? 'Desktop Browser' : 'Mobile Browser',
          platform: index === 0 ? 'desktop-web' : 'mobile-web',
          lastSeenAt: Date.now(),
          createdAt: Date.now() - index * 1000,
          revokedAt: null,
        }));
        return json(route, {
          devices,
          currentDeviceId: deviceId,
        });
      }

      if (pathname === '/api/v2/events' && request.method() === 'GET') {
        return route.fulfill({
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
          body: ':\n\n',
        });
      }

      return route.fallback();
    };

    const desktopContext = await browser.newContext();
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    });

    await desktopContext.addInitScript(() => {
      window.localStorage.setItem('pb_dev_auth_user_id', 'e2e-sync-user');
    });
    await mobileContext.addInitScript(() => {
      window.localStorage.setItem('pb_dev_auth_user_id', 'e2e-sync-user');
    });

    await desktopContext.route('**/api/v2/**', handleApiRoute);
    await mobileContext.route('**/api/v2/**', handleApiRoute);

    const desktop = await desktopContext.newPage();
    const mobile = await mobileContext.newPage();

    try {
      await gotoWithNotes(desktop);
      await gotoWithNotes(mobile);

      await createNoteViaUI(desktop, 'Desktop sync note');
      await expect(desktop.getByText('Desktop sync note')).toBeVisible();

      await mobile.reload();
      await expect(mobile.getByText('Desktop sync note')).toBeVisible();

      await mobileContext.setOffline(true);
      await expect(mobile.getByTitle('Sync status: Offline')).toBeVisible();

      await createNoteViaUI(mobile, 'Mobile offline replay note');
      await expect(mobile.getByText('Mobile offline replay note')).toBeVisible();

      await mobileContext.setOffline(false);
      await expect(mobile.getByTitle('Sync status: Synced')).toBeVisible({ timeout: 10000 });

      await desktop.reload();
      await expect(desktop.getByText('Mobile offline replay note')).toBeVisible();
    } finally {
      await Promise.allSettled([desktopContext.close(), mobileContext.close()]);
    }
  });
});
