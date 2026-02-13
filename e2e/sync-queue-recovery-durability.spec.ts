import { test, expect, Route } from '@playwright/test';
import { createNoteViaUI, gotoWithNotes } from './helpers';

type SyncNote = {
  id: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  version: number;
  type?: 'NOTE' | 'TASK' | 'IDEA';
  isProcessed?: boolean;
  isCompleted?: boolean;
  isArchived?: boolean;
  isPinned?: boolean;
  deletedAt?: number;
};

function json(route: Route, payload: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload),
  });
}

test.describe('sync queue recovery durability', () => {
  test('recovers from blocked queue, emits recovery signal, and preserves writes across reload', async ({ page }) => {
    let outageActive = true;
    let cursor = 0;
    const notesById = new Map<string, SyncNote>();
    let markBootstrapLoaded = () => {};
    const bootstrapLoaded = new Promise<void>(resolve => {
      markBootstrapLoaded = resolve;
    });
    let bootstrapResolved = false;

    await page.addInitScript(() => {
      window.localStorage.setItem('pb_dev_auth_user_id', 'e2e-queue-recovery-user');
      (window as Window & { __PB_SYNC_QUEUE_HARD_CAP?: number }).__PB_SYNC_QUEUE_HARD_CAP = 1;
    });

    await page.route('**/api/v2/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const { pathname } = url;

      if (pathname === '/api/v2/notes' && request.method() === 'GET') {
        if (!bootstrapResolved) {
          bootstrapResolved = true;
          markBootstrapLoaded();
        }
        return json(route, {
          notes: Array.from(notesById.values()),
          cursor,
        });
      }

      if (pathname === '/api/v2/sync/pull' && request.method() === 'GET') {
        return json(route, {
          changes: [],
          nextCursor: cursor,
        });
      }

      if (pathname === '/api/v2/sync/bootstrap' && request.method() === 'POST') {
        return json(route, {
          imported: 0,
          alreadyBootstrapped: true,
          cursor,
        });
      }

      if (pathname === '/api/v2/sync/push' && request.method() === 'POST') {
        if (outageActive) {
          return json(
            route,
            {
              error: {
                code: 'SERVICE_UNAVAILABLE',
                message: 'simulated sync outage',
                retryable: true,
              },
            },
            503
          );
        }

        const payload = request.postDataJSON() as
          | { operations?: Array<{ requestId: string; op: 'upsert' | 'delete'; noteId: string; note?: SyncNote }> }
          | undefined;
        const operations = Array.isArray(payload?.operations) ? payload.operations : [];
        const now = Date.now();

        const applied = operations.map(operation => {
          cursor += 1;
          if (operation.op === 'delete' || operation.note?.deletedAt) {
            const tombstone: SyncNote = {
              id: operation.noteId,
              content: operation.note?.content || '',
              createdAt: operation.note?.createdAt || now,
              updatedAt: now,
              version: Math.max(1, Number(operation.note?.version) || 1),
              deletedAt: now,
              isProcessed: true,
            };
            notesById.delete(operation.noteId);
            return {
              requestId: operation.requestId,
              note: tombstone,
              cursor,
            };
          }

          const incoming = operation.note;
          const persisted: SyncNote = {
            ...incoming,
            id: operation.noteId,
            content: incoming?.content || '',
            createdAt: incoming?.createdAt || now,
            updatedAt: now,
            version: Math.max(1, Number(incoming?.version) || 1),
            isProcessed: incoming?.isProcessed ?? true,
          };
          notesById.set(operation.noteId, persisted);
          return {
            requestId: operation.requestId,
            note: persisted,
            cursor,
          };
        });

        return json(route, {
          applied,
          conflicts: [],
          nextCursor: cursor,
        });
      }

      if (pathname === '/api/v2/devices' && request.method() === 'GET') {
        return json(route, {
          devices: [
            {
              id: 'device-e2e',
              label: 'Desktop Browser',
              platform: 'desktop-web',
              lastSeenAt: Date.now(),
              createdAt: Date.now() - 1000,
              revokedAt: null,
            },
          ],
          currentDeviceId: 'device-e2e',
        });
      }

      if (pathname === '/api/v2/events/ticket' && request.method() === 'POST') {
        return json(route, {
          ok: true,
          expiresAt: Date.now() + 60_000,
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
    });

    await gotoWithNotes(page);
    await bootstrapLoaded;
    await expect(page.getByText('Your mind is clear')).toBeVisible();

    await createNoteViaUI(page, 'First pending note survives outage');
    await expect(page.getByText('First pending note survives outage')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTitle('Sync status: Blocked')).toBeVisible({ timeout: 10_000 });

    await createNoteViaUI(page, 'Second note should be blocked');
    await expect(page.locator('main').getByText('Second note should be blocked')).not.toBeVisible();
    await expect(page.getByText('Sync queue is full (1/1).')).toBeVisible();

    outageActive = false;
    await page.context().setOffline(true);
    await expect(page.getByTitle('Sync status: Offline')).toBeVisible();
    await page.context().setOffline(false);

    await expect(page.getByText(/Sync queue recovered/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTitle('Sync status: Blocked')).not.toBeVisible();

    await createNoteViaUI(page, 'Write allowed after queue recovery');
    await expect(page.getByText('Write allowed after queue recovery')).toBeVisible({ timeout: 10_000 });

    await page.reload();
    await expect(page.getByText('First pending note survives outage')).toBeVisible({ timeout: 10_000 });
  });
});
