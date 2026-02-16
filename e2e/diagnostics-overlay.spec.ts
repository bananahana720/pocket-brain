import { test, expect } from '@playwright/test';
import { gotoWithNotes } from './helpers';

test.describe('Diagnostics overlay', () => {
  test('does not block UI interactions', async ({ page }) => {
    await gotoWithNotes(page);

    const diagnosticsPanel = page.getByTestId('diagnostics-panel');
    await expect(diagnosticsPanel).toBeVisible();
    await expect(diagnosticsPanel).toHaveCSS('pointer-events', 'none');

    await page.locator('.lucide-menu').locator('xpath=ancestor::button').click();
    await expect(page.getByText('Menu')).toBeVisible();
    await page.getByText('Light Mode').click();
    await expect(page.getByText('Dark Mode')).toBeVisible();
  });
});
