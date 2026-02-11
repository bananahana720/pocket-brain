import { test, expect } from '@playwright/test';
import { gotoWithNotes } from './helpers';

test.describe('Smoke tests', () => {
  test('app loads and renders the header', async ({ page }) => {
    await gotoWithNotes(page);
    await expect(page.locator('h1')).toHaveText('PocketBrain');
  });

  test('shows empty state when no notes exist', async ({ page }) => {
    await gotoWithNotes(page);
    await expect(page.getByText('Your mind is clear')).toBeVisible();
  });

  test('search bar is present', async ({ page }) => {
    await gotoWithNotes(page);
    const search = page.locator('input[type="text"]');
    await expect(search).toBeVisible();
    await expect(search).toHaveAttribute('placeholder', 'Search your thoughts...');
  });

  test('filter tabs are visible', async ({ page }) => {
    await gotoWithNotes(page);
    await expect(page.getByRole('button', { name: 'All' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Notes' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tasks' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ideas' })).toBeVisible();
  });

  test('input area is visible at bottom', async ({ page }) => {
    await gotoWithNotes(page);
    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible();
    await expect(textarea).toHaveAttribute('placeholder', 'Capture a thought...');
  });
});
