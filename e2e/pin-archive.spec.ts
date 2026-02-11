import { test, expect } from '@playwright/test';
import { gotoWithNotes, makeNote, openNoteMenu } from './helpers';

test.describe('Pin & Archive', () => {
  test('pin a note moves it to top', async ({ page }) => {
    const notes = [
      makeNote({ id: 'a1', title: 'Note A', content: 'First' }),
      makeNote({ id: 'b2', title: 'Note B', content: 'Second' }),
    ];
    await gotoWithNotes(page, notes);

    // Hover on Note A to reveal pin, then click it
    const noteACard = page.locator('text=Note A').locator('xpath=ancestor::div[contains(@class,"rounded-2xl")]').first();
    await noteACard.hover();
    await noteACard.locator('button[title="Pin"]').click();

    // Note A should be first
    const titles = page.locator('main h3');
    await expect(titles.first()).toHaveText('Note A');
  });

  test('archive a note hides it from main view', async ({ page }) => {
    const note = makeNote({ title: 'Archive Me', content: 'Going away' });
    await gotoWithNotes(page, [note]);

    await openNoteMenu(page);
    await page.getByRole('button', { name: 'Archive' }).click();

    await expect(page.getByText('Note archived')).toBeVisible();
    await expect(page.getByText('Going away')).not.toBeVisible();
  });

  test('archived notes visible in archive view', async ({ page }) => {
    const note = makeNote({ title: 'Archived', content: 'In archive', isArchived: true });
    await gotoWithNotes(page, [note]);

    // Note should not be visible in main view
    await expect(page.getByText('In archive')).not.toBeVisible();

    // Open drawer → Archived
    await page.locator('.lucide-menu').locator('xpath=ancestor::button').click();
    await page.getByText('Archived').click();

    await expect(page.getByText('Viewing archived notes')).toBeVisible();
    await expect(page.getByText('In archive')).toBeVisible();
  });

  test('undo archive restores note', async ({ page }) => {
    const note = makeNote({ title: 'Undo Archive', content: 'Restore me' });
    await gotoWithNotes(page, [note]);

    await openNoteMenu(page);
    await page.getByRole('button', { name: 'Archive' }).click();

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByText('Action undone').first()).toBeVisible();
    await expect(page.getByText('Restore me')).toBeVisible();
  });
});
