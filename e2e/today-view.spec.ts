import { test, expect } from '@playwright/test';
import { gotoWithNotes, makeTask, makeNote } from './helpers';

const clickTodayView = async (page: import('@playwright/test').Page) => {
  await page.locator('button[title="Today view"]').click();
};

test.describe('Today View', () => {
  test('today view shows empty state when nothing due', async ({ page }) => {
    const note = makeNote({ title: 'Old Note', createdAt: Date.now() - 7 * 86400000 });
    await gotoWithNotes(page, [note]);

    await clickTodayView(page);
    // Wait for AI brief loading to complete (no API key = fast fail)
    await expect(page.getByText('All clear for today!')).toBeVisible({ timeout: 15000 });
  });

  test('today view shows overdue tasks', async ({ page }) => {
    const overdue = makeTask({
      title: 'Overdue Item',
      content: 'Past due',
      dueDate: Date.now() - 2 * 86400000,
    });
    await gotoWithNotes(page, [overdue]);

    await clickTodayView(page);
    const overdueSection = page.locator('section').filter({
      has: page.locator('h2', { hasText: /^Overdue$/ }),
    });
    await expect(overdueSection).toBeVisible();
    await expect(overdueSection.getByText('Past due')).toBeVisible();
  });

  test('today view shows notes captured today', async ({ page }) => {
    const todayNote = makeNote({
      title: 'Fresh Note',
      content: 'Made today',
      createdAt: Date.now(),
    });
    await gotoWithNotes(page, [todayNote]);

    await clickTodayView(page);
    await expect(page.getByText('Captured Today')).toBeVisible();
    await expect(page.getByText('Made today')).toBeVisible();
  });

  test('toggle between today view and all view', async ({ page }) => {
    await gotoWithNotes(page);

    await clickTodayView(page);
    await expect(page.getByText('All clear for today!')).toBeVisible({ timeout: 15000 });

    await clickTodayView(page);
    await expect(page.getByText('Your mind is clear')).toBeVisible();
  });
});
