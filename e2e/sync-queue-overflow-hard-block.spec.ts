import { test, expect, Route } from '@playwright/test';
import { createNoteViaUI, gotoWithNotes } from './helpers';

function json(route: Route, payload: unknown, status = 200, headers?: Record<string, string>) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers,
    body: JSON.stringify(payload),
  });
}

test.describe('sync queue overflow hard block', () => {
  test('hard-blocks only after overflow cap is exhausted', async ({ page }) => {
    let markBootstrapLoaded = () => {};
    const bootstrapLoaded = new Promise<void>(resolve => {
      markBootstrapLoaded = resolve;
    });
    let bootstrapResolved = false;

    await page.addInitScript(() => {
      window.localStorage.setItem('pb_dev_auth_user_id', 'e2e-overflow-hard-block-user');
      (window as any).__PB_SYNC_QUEUE_HARD_CAP = 1;
      (window as any).__PB_SYNC_QUEUE_OVERFLOW_CAP = 1;
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

      if (pathname === '/api/v2/sync/bootstrap' && request.method() === 'POST') {
        return json(route, {
          imported: 0,
          alreadyBootstrapped: true,
          cursor: 0,
        });
      }

      if (pathname === '/api/v2/sync/push' && request.method() === 'POST') {
        return json(
          route,
          {
            error: {
              code: 'SERVICE_UNAVAILABLE',
              cause: 'circuit_open',
              message: 'simulated sync outage',
              retryable: true,
            },
          },
          503,
          {
            'Retry-After': '1',
          }
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
    await bootstrapLoaded;
    await expect(page.getByText('Your mind is clear')).toBeVisible();

    await createNoteViaUI(page, 'Overflow note 1');
    await expect(page.getByText('Overflow note 1')).toBeVisible({ timeout: 10_000 });

    await createNoteViaUI(page, 'Overflow note 2');
    await expect(page.getByText('Overflow note 2')).toBeVisible({ timeout: 10_000 });

    let blockedAt: number | null = null;
    for (let i = 3; i <= 8; i += 1) {
      const label = `Overflow note ${i}`;
      await createNoteViaUI(page, label);

      try {
        await page.getByText(/Sync queue reached hard cap/i).first().waitFor({ state: 'visible', timeout: 1500 });
        blockedAt = i;
        await expect(page.locator('main').getByText(label)).not.toBeVisible();
        break;
      } catch {
        await expect(page.getByText(label)).toBeVisible({ timeout: 10_000 });
      }
    }

    expect(blockedAt).not.toBeNull();
  });
});
