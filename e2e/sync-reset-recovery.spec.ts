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

test.describe('sync reset recovery', () => {
  test('keeps pending local edits visible when sync cursor reset is required', async ({ page }) => {
    const now = Date.now();
    const serverNote: SyncNote = {
      id: 'server-note-1',
      content: 'Server snapshot note',
      createdAt: now - 5_000,
      updatedAt: now - 5_000,
      version: 10,
      type: 'NOTE',
      isProcessed: true,
      isCompleted: false,
      isArchived: false,
      isPinned: false,
    };

    let shouldForceReset = false;
    let currentCursor = 120;

    await page.addInitScript(() => {
      window.localStorage.setItem('pb_dev_auth_user_id', 'e2e-reset-user');
    });

    await page.route('**/api/v2/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const { pathname } = url;

      if (pathname === '/api/v2/notes' && request.method() === 'GET') {
        return json(route, {
          notes: [serverNote],
          cursor: currentCursor,
        });
      }

      if (pathname === '/api/v2/sync/pull' && request.method() === 'GET') {
        if (shouldForceReset) {
          return json(route, {
            changes: [],
            nextCursor: currentCursor,
            resetRequired: true,
            resetReason: 'CURSOR_TOO_OLD',
            oldestAvailableCursor: 100,
            latestCursor: currentCursor,
          });
        }

        return json(route, {
          changes: [],
          nextCursor: currentCursor,
        });
      }

      if (pathname === '/api/v2/sync/push' && request.method() === 'POST') {
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
    await expect(page.getByText('Server snapshot note')).toBeVisible();

    await createNoteViaUI(page, 'Local pending note survives reset');
    await expect(page.getByText('Local pending note survives reset')).toBeVisible();

    await page.context().setOffline(true);
    await expect(page.getByTitle('Sync status: Offline')).toBeVisible();

    shouldForceReset = true;
    currentCursor = 150;
    await page.context().setOffline(false);

    await expect(page.getByText('Server snapshot note')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Local pending note survives reset')).toBeVisible({ timeout: 10_000 });
  });
});
