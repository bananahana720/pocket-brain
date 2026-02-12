import { test, expect } from '@playwright/test';
import { gotoWithNotes } from './helpers';

test.describe('Input modes', () => {
  test('task quick action changes placeholder', async ({ page }) => {
    await gotoWithNotes(page);
    // Use exact: true to distinguish "Task" quick action from "Tasks" filter
    await page.getByRole('button', { name: 'Task', exact: true }).click();
    await expect(page.locator('textarea')).toHaveAttribute('placeholder', 'Creating a Task...');
  });

  test('idea quick action changes placeholder', async ({ page }) => {
    await gotoWithNotes(page);
    await page.getByRole('button', { name: 'Idea', exact: true }).click();
    await expect(page.locator('textarea')).toHaveAttribute('placeholder', 'Creating an Idea...');
  });

  test('batch mode changes placeholder', async ({ page }) => {
    await gotoWithNotes(page);
    await page.getByRole('button', { name: 'Batch' }).click();
    await expect(page.locator('textarea')).toHaveAttribute('placeholder', 'Dump multiple thoughts here, AI will split them...');
  });

  test('save button is disabled when input is empty', async ({ page }) => {
    await gotoWithNotes(page);
    const disabledBtn = page.locator('button[disabled]').filter({ has: page.locator('.lucide-send') });
    await expect(disabledBtn).toBeVisible();
  });

  test('save button becomes active with sufficient text', async ({ page }) => {
    await gotoWithNotes(page);
    await page.locator('textarea').fill('Enough text to enable');
    const saveBtn = page.locator('button[title="Save (⌘+Enter)"]');
    await expect(saveBtn).toBeVisible();
    await expect(saveBtn).toBeEnabled();
  });

  test('input clears after saving', async ({ page }) => {
    await gotoWithNotes(page);
    const textarea = page.locator('.fixed.bottom-0 textarea');
    await textarea.fill('Note to clear after save');
    await textarea.press('Meta+Enter');
    await expect(textarea).toHaveValue('');
  });

  test('clean draft keeps text in editor and does not submit', async ({ page }) => {
    await gotoWithNotes(page);
    const textarea = page.locator('.fixed.bottom-0 textarea');
    await textarea.fill('this is a rough thought to clean before submit');
    await page.getByTitle('Clean draft for review').click();
    await expect(textarea).toHaveValue(/rough thought/);
    await expect(page.getByText('Your mind is clear')).toBeVisible();
  });
});
