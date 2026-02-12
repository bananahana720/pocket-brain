import { test, expect } from '@playwright/test';
import { configureCaptureSaveHooks, gotoWithNotes, makeNote, createNoteViaUI, openNoteMenu } from './helpers';

test.describe('Notes CRUD', () => {
  test('create a note via textarea + Cmd+Enter', async ({ page }) => {
    await gotoWithNotes(page);
    await createNoteViaUI(page, 'My first test note here');
    await expect(page.getByText('Note captured')).toBeVisible();
    await expect(page.getByText('My first test note here')).toBeVisible();
    await expect(page.getByText('Your mind is clear')).not.toBeVisible();
  });

  test('capture appears immediately while write-through completes in background', async ({ page }) => {
    await gotoWithNotes(page);
    await configureCaptureSaveHooks(page, { delayMs: 650 });

    await createNoteViaUI(page, 'Write-through reliability note');

    await expect(page.getByTestId('capture-save-status')).toHaveCount(0);
    await expect(page.getByText('Note captured')).toBeVisible();
    await expect(page.getByText('Write-through reliability note')).toBeVisible();
  });

  test('displays seeded notes on load', async ({ page }) => {
    const note = makeNote({ title: 'Seeded Note', content: 'Seeded content' });
    await gotoWithNotes(page, [note]);
    await expect(page.getByText('Seeded Note')).toBeVisible();
    await expect(page.getByText('Seeded content')).toBeVisible();
  });

  test('edit a note inline', async ({ page }) => {
    const note = makeNote({ title: 'Edit Me', content: 'Original content' });
    await gotoWithNotes(page, [note]);

    // Click content to enter edit mode
    await page.getByText('Original content').click();
    const editTextarea = page.locator('main textarea');
    await expect(editTextarea).toBeVisible();
    await editTextarea.fill('Updated content');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText('Note updated')).toBeVisible();
    await expect(page.getByText('Updated content')).toBeVisible();
  });

  test('delete a note via menu', async ({ page }) => {
    const note = makeNote({ title: 'Delete Me', content: 'To be deleted' });
    await gotoWithNotes(page, [note]);

    await openNoteMenu(page);
    await page.getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByText('Note deleted')).toBeVisible();
    await expect(page.getByText('To be deleted')).not.toBeVisible();
  });

  test('menu actions remain clickable with content visibility optimization', async ({ page }) => {
    const note = makeNote({ title: 'Menu Visibility', content: 'Delete via menu' });
    await gotoWithNotes(page, [note]);

    const card = page
      .getByRole('heading', { name: 'Menu Visibility' })
      .locator('xpath=ancestor::div[contains(@class,"rounded-2xl")]')
      .first();

    await expect.poll(async () => card.evaluate(el => getComputedStyle(el).contentVisibility)).toBe('auto');

    await openNoteMenu(page);
    await expect(page.getByRole('button', { name: 'Delete' })).toBeVisible();
    await expect.poll(async () => card.evaluate(el => getComputedStyle(el).contentVisibility)).toBe('visible');

    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Note deleted')).toBeVisible();
  });

  test('copy note content via menu', async ({ page }) => {
    const note = makeNote({ content: 'Copy this text' });
    await gotoWithNotes(page, [note]);

    await openNoteMenu(page);
    await page.getByRole('button', { name: 'Copy' }).click();

    await expect(page.getByText('Copied to clipboard')).toBeVisible();
  });

  test('notes persist across page reloads', async ({ page }) => {
    await gotoWithNotes(page);
    await createNoteViaUI(page, 'Persistent note content');
    await expect(page.getByText('Note captured')).toBeVisible();
    await expect(page.getByText('Persistent note content')).toBeVisible();

    await page.reload();
    await expect(page.getByText('Persistent note content')).toBeVisible();
  });
});
