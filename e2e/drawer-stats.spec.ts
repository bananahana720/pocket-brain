import { test, expect } from '@playwright/test';
import { gotoWithNotes, makeNote, makeTask } from './helpers';

const openDrawer = async (page: import('@playwright/test').Page) => {
  await page.locator('.lucide-menu').locator('xpath=ancestor::button').click();
  await expect(page.getByRole('heading', { name: 'Menu' })).toBeVisible();
};

test.describe('Drawer & Stats', () => {
  test('drawer opens and shows menu', async ({ page }) => {
    await gotoWithNotes(page);
    await openDrawer(page);
    await expect(page.getByText('Activity')).toBeVisible();
    await expect(page.getByText('Overview')).toBeVisible();
  });

  test('drawer shows correct note counts', async ({ page }) => {
    const notes = [
      makeNote({ id: '1', type: 'NOTE' }),
      makeNote({ id: '2', type: 'NOTE' }),
      makeTask({ id: '3' }),
      makeNote({ id: '4', type: 'IDEA' }),
    ];
    await gotoWithNotes(page, notes);
    await openDrawer(page);

    // The "Total" stat should show 4
    const totalStat = page.locator('.grid-cols-4 >> text=Total').locator('..');
    await expect(totalStat.locator('span').first()).toHaveText('4');
  });

  test('drawer shows task completion rate', async ({ page }) => {
    const notes = [
      makeTask({ id: '1', isCompleted: true }),
      makeTask({ id: '2', isCompleted: false }),
    ];
    await gotoWithNotes(page, notes);
    await openDrawer(page);

    await expect(page.getByText('Task completion')).toBeVisible();
    await expect(page.getByText('50%')).toBeVisible();
  });

  test('drawer shows top tags', async ({ page }) => {
    const notes = [
      makeNote({ id: '1', tags: ['react', 'frontend'] }),
      makeNote({ id: '2', tags: ['react', 'typescript'] }),
      makeNote({ id: '3', tags: ['react'] }),
    ];
    await gotoWithNotes(page, notes);
    await openDrawer(page);

    await expect(page.getByText('#react').first()).toBeVisible();
  });

  test('drawer close button works', async ({ page }) => {
    await gotoWithNotes(page);
    await openDrawer(page);

    await page.locator('.lucide-x').first().locator('xpath=ancestor::button').click();
    await expect(page.getByRole('heading', { name: 'Menu' })).not.toBeVisible();
  });

  test('drawer close via backdrop click', async ({ page }) => {
    await gotoWithNotes(page);
    await openDrawer(page);

    // Click the backdrop overlay
    await page.locator('.backdrop-blur-sm').click({ force: true });
    await expect(page.getByRole('heading', { name: 'Menu' })).not.toBeVisible();
  });
});
