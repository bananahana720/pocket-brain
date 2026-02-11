import { test, expect } from '@playwright/test';
import { gotoWithNotes, makeNote, createNoteViaUI, openNoteMenu } from './helpers';

test.describe('Notes CRUD', () => {
  test('create a note via textarea + Cmd+Enter', async ({ page }) => {
    await gotoWithNotes(page);
    await createNoteViaUI(page, 'My first test note here');
    await expect(page.getByText('Note captured')).toBeVisible();
    await expect(page.getByText('My first test note here')).toBeVisible();
    await expect(page.getByText('Your mind is clear')).not.toBeVisible();
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
    await expect(page.getByText('Persistent note content')).toBeVisible();

    await page.reload();
    await expect(page.getByText('Persistent note content')).toBeVisible();
  });
});
