import { test, expect } from '@playwright/test';
import { gotoWithNotes, makeNote } from './helpers';

const clickTodayView = async (page: import('@playwright/test').Page) => {
  await page.locator('button[title="Today view"]').click();
};

const encodeSharedPayload = (payload: object) =>
  Buffer.from(JSON.stringify(payload), 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

test.describe('Daily Brief Sharing', () => {
  test('shares daily brief and tracks share click', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async () => {},
      });
    });

    const todayNote = makeNote({
      title: 'Fresh note',
      content: 'Created today',
      createdAt: Date.now(),
    });
    await gotoWithNotes(page, [todayNote]);

    await clickTodayView(page);

    const shareButton = page.getByRole('button', { name: 'Share brief' });
    await expect(shareButton).toBeEnabled({ timeout: 15000 });
    await shareButton.click();
    await expect(page.getByText('Daily brief shared')).toBeVisible();

    const hasShareClickEvent = await page.evaluate(() => {
      const raw = localStorage.getItem('pocketbrain_analytics_events');
      if (!raw) return false;
      const events = JSON.parse(raw) as Array<{ name?: string }>;
      return events.some(event => event.name === 'daily_brief_share_clicked');
    });
    expect(hasShareClickEvent).toBe(true);
  });

  test('tracks open when launched from shared brief link', async ({ page }) => {
    await page.goto('/?via=daily_brief_share');
    await page.locator('h1').waitFor();

    const hasOpenedEvent = await page.evaluate(() => {
      const raw = localStorage.getItem('pocketbrain_analytics_events');
      if (!raw) return false;
      const events = JSON.parse(raw) as Array<{ name?: string }>;
      return events.some(event => event.name === 'daily_brief_share_opened');
    });
    expect(hasOpenedEvent).toBe(true);

    const cleanedSearch = await page.evaluate(() => window.location.search);
    expect(cleanedSearch).toBe('');
  });

  test('imports note from shared note link and tracks conversion events', async ({ page }) => {
    const payload = encodeSharedPayload({
      content: 'Call design partner about onboarding copy.',
      title: 'Onboarding follow-up',
      type: 'TASK',
      tags: ['growth', 'shared'],
      priority: 'urgent',
    });

    await page.goto(`/?via=note_share&shared_note=${encodeURIComponent(payload)}`);
    await page.locator('h1').waitFor();

    await expect(page.getByText('Shared note received')).toBeVisible();
    await page.getByRole('button', { name: 'Import' }).click();
    await expect(page.getByText('Shared note imported')).toBeVisible();
    await expect(page.getByText('Onboarding follow-up')).toBeVisible();
    await expect(page.getByText('Call design partner about onboarding copy.')).toBeVisible();

    const hasOpenAndImportEvents = await page.evaluate(() => {
      const raw = localStorage.getItem('pocketbrain_analytics_events');
      if (!raw) return false;
      const events = JSON.parse(raw) as Array<{ name?: string }>;
      const hasOpened = events.some(event => event.name === 'note_share_opened');
      const hasImported = events.some(event => event.name === 'note_share_imported');
      return hasOpened && hasImported;
    });
    expect(hasOpenAndImportEvents).toBe(true);

    const cleanedSearch = await page.evaluate(() => window.location.search);
    expect(cleanedSearch).toBe('');
  });
});
