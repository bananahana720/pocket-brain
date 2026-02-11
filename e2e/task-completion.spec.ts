import { test, expect } from '@playwright/test';
import { gotoWithNotes, makeTask } from './helpers';

test.describe('Task completion', () => {
  test('toggle task complete shows checkbox', async ({ page }) => {
    const task = makeTask({ title: 'Complete Me', isCompleted: false });
    await gotoWithNotes(page, [task]);

    // Click the unchecked square
    await page.locator('main .lucide-square').locator('xpath=ancestor::button').click();
    // Should now show checked square
    await expect(page.locator('main .lucide-square-check-big')).toBeVisible();
  });

  test('completed task has reduced opacity', async ({ page }) => {
    const task = makeTask({ title: 'Done Task', isCompleted: true });
    await gotoWithNotes(page, [task]);
    await expect(page.locator('.opacity-60')).toBeVisible();
  });

  test('undo task completion restores state', async ({ page }) => {
    const task = makeTask({ title: 'Undo Complete', isCompleted: false });
    await gotoWithNotes(page, [task]);

    // Complete the task
    await page.locator('main .lucide-square').locator('xpath=ancestor::button').click();
    await expect(page.locator('main .lucide-square-check-big')).toBeVisible();

    // Undo via Ctrl+Z — click body first to ensure no input is focused
    await page.locator('h1').click();
    await page.keyboard.press('Meta+z');
    await expect(page.getByText('Action undone').first()).toBeVisible();
  });
});
