import { test, expect } from '@playwright/test';
import { gotoWithNotes } from './helpers';

test.describe('Dark mode', () => {
  test('toggle dark mode via drawer', async ({ page }) => {
    await gotoWithNotes(page);

    // Open drawer
    await page.locator('.lucide-menu').locator('xpath=ancestor::button').click();
    await expect(page.getByText('Menu')).toBeVisible();
    await expect(page.getByText('Light Mode')).toBeVisible();

    // Toggle
    await page.getByText('Light Mode').click();
    await expect(page.getByText('Dark Mode')).toBeVisible();

    const htmlClass = await page.locator('html').getAttribute('class');
    expect(htmlClass).toContain('dark');
  });

  test('dark mode persists after reload', async ({ page }) => {
    await gotoWithNotes(page);

    // Toggle to dark
    await page.locator('.lucide-menu').locator('xpath=ancestor::button').click();
    await page.getByText('Light Mode').click();

    // Close drawer
    await page.locator('.lucide-x').first().locator('xpath=ancestor::button').click();
    await page.reload();

    const htmlClass = await page.locator('html').getAttribute('class');
    expect(htmlClass).toContain('dark');
  });
});
