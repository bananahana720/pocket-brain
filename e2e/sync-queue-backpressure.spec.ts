import { test, expect, Route } from '@playwright/test';
import { createNoteViaUI, gotoWithNotes } from './helpers';

function json(route: Route, payload: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload),
  });
}

test.describe('sync queue backpressure', () => {
  test('blocks new note mutations when sync queue reaches hard cap', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('pb_dev_auth_user_id', 'e2e-block-user');
      (window as any).__PB_SYNC_QUEUE_HARD_CAP = 1;
    });

    await page.route('**/api/v2/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const { pathname } = url;

      if (pathname === '/api/v2/notes' && request.method() === 'GET') {
        return json(route, {
          notes: [],
          cursor: 0,
        });
      }

      if (pathname === '/api/v2/sync/pull' && request.method() === 'GET') {
        return json(route, {
          changes: [],
          nextCursor: 0,
        });
      }

      if (pathname === '/api/v2/sync/push' && request.method() === 'POST') {
        return json(route, {
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'simulated sync outage',
            retryable: true,
          },
        }, 503);
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

    await createNoteViaUI(page, 'First pending note');
    await expect(page.getByText('First pending note')).toBeVisible();
    await expect(page.getByTitle('Sync status: Blocked')).toBeVisible({ timeout: 10_000 });

    await createNoteViaUI(page, 'Second note should be blocked');

    await expect(page.locator('main').getByText('Second note should be blocked')).not.toBeVisible();
    await expect(page.getByText('Sync queue is full (1/1).')).toBeVisible();
  });
});
