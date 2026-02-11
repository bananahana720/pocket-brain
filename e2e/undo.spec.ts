import { test, expect } from '@playwright/test';
import { gotoWithNotes, makeNote, openNoteMenu } from './helpers';

test.describe('Undo system', () => {
  test('undo delete via toast button', async ({ page }) => {
    const note = makeNote({ title: 'Undo Delete', content: 'Bring me back' });
    await gotoWithNotes(page, [note]);

    await openNoteMenu(page);
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Bring me back')).not.toBeVisible();

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByText('Action undone').first()).toBeVisible();
    await expect(page.getByText('Bring me back')).toBeVisible();
  });

  test('undo delete via Ctrl+Z keyboard shortcut', async ({ page }) => {
    const note = makeNote({ title: 'KB Undo', content: 'Keyboard undo' });
    await gotoWithNotes(page, [note]);

    await openNoteMenu(page);
    await page.getByRole('button', { name: 'Delete' }).click();

    // Click header to ensure no input is focused
    await page.locator('h1').click();
    await page.keyboard.press('Meta+z');
    await expect(page.getByText('Action undone').first()).toBeVisible();
    await expect(page.getByText('Keyboard undo')).toBeVisible();
  });
});
