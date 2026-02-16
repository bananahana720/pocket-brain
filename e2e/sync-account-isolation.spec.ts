import { expect, test } from '@playwright/test';
import { createNoteViaUI, gotoWithNotes } from './helpers';

const DEV_AUTH_STORAGE_KEY = 'pb_dev_auth_user_id';
const USER_A = 'e2e-account-isolation-user-a';
const USER_B = 'e2e-account-isolation-user-b';

function buildScopedNotesKey(userId: string): string {
  return `pocketbrain_notes::${userId}`;
}

test.describe('sync account isolation', () => {
  test('does not rehydrate user A local notes after switching to user B in the same browser context', async ({ page }) => {
    const userANote = 'Isolation note from user A';
    const userBNote = 'Isolation note from user B';

    await page.route('**/api/v2/**', async route => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'sync disabled for local persistence isolation e2e',
            retryable: true,
          },
        }),
      });
    });

    await page.goto('/');
    await page.evaluate(({ key, value }) => {
      window.localStorage.setItem(key, value);
    }, { key: DEV_AUTH_STORAGE_KEY, value: USER_A });
    await gotoWithNotes(page);
    await createNoteViaUI(page, userANote);
    await expect(page.getByText(userANote)).toBeVisible();

    await expect
      .poll(async () => {
        return page.evaluate(({ key, text }) => {
          const raw = window.localStorage.getItem(key);
          return typeof raw === 'string' && raw.includes(text);
        }, { key: buildScopedNotesKey(USER_A), text: userANote });
      })
      .toBe(true);

    await page.evaluate(({ key, value }) => {
      window.localStorage.setItem(key, value);
    }, { key: DEV_AUTH_STORAGE_KEY, value: USER_B });
    await page.reload();
    await page.locator('h1').waitFor();

    await expect(page.getByText(userANote)).toHaveCount(0);

    await createNoteViaUI(page, userBNote);
    await expect(page.getByText(userBNote)).toBeVisible();
    await expect(page.getByText(userANote)).toHaveCount(0);

    await expect
      .poll(async () => {
        return page.evaluate(({ keyA, keyB, textA, textB }) => {
          const rawA = window.localStorage.getItem(keyA) || '';
          const rawB = window.localStorage.getItem(keyB) || '';
          return {
            userAStillHasA: rawA.includes(textA),
            userBHasBOnly: rawB.includes(textB) && !rawB.includes(textA),
          };
        }, {
          keyA: buildScopedNotesKey(USER_A),
          keyB: buildScopedNotesKey(USER_B),
          textA: userANote,
          textB: userBNote,
        });
      })
      .toEqual({
        userAStillHasA: true,
        userBHasBOnly: true,
      });
  });
});
