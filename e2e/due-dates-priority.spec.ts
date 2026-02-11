import { test, expect } from '@playwright/test';
import { gotoWithNotes, makeTask, openNoteMenu } from './helpers';

test.describe('Due dates & Priority', () => {
  test('overdue task shows Overdue badge', async ({ page }) => {
    const yesterday = Date.now() - 2 * 86400000;
    const task = makeTask({ title: 'Overdue Task', dueDate: yesterday });
    await gotoWithNotes(page, [task]);
    await expect(page.getByText('Overdue', { exact: true })).toBeVisible();
  });

  test('task due today shows Due today badge', async ({ page }) => {
    const now = new Date();
    const todayNoon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12).getTime();
    const task = makeTask({ title: 'Today Task', dueDate: todayNoon });
    await gotoWithNotes(page, [task]);
    await expect(page.getByText('Due today')).toBeVisible();
  });

  test('urgent priority shows left border', async ({ page }) => {
    const task = makeTask({ title: 'Urgent Task', priority: 'urgent' });
    await gotoWithNotes(page, [task]);
    const card = page.locator('.border-l-rose-500');
    await expect(card).toBeVisible();
  });

  test('set due date via menu', async ({ page }) => {
    const task = makeTask({ title: 'Date Task' });
    await gotoWithNotes(page, [task]);

    await openNoteMenu(page);
    await page.getByRole('button', { name: 'Set due date' }).click();

    const dateInput = page.locator('input[type="date"]');
    await expect(dateInput).toBeVisible();
  });

  test('set priority via menu', async ({ page }) => {
    const task = makeTask({ title: 'Priority Task' });
    await gotoWithNotes(page, [task]);

    await openNoteMenu(page);
    await page.getByRole('button', { name: 'Set priority' }).click();

    await expect(page.getByText('Priority:')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Urgent' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Normal' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Low' })).toBeVisible();
  });

  test('clear due date removes badge', async ({ page }) => {
    const tomorrow = Date.now() + 86400000;
    const task = makeTask({ title: 'Clear Date', dueDate: tomorrow });
    await gotoWithNotes(page, [task]);

    await page.getByRole('button', { name: 'clear' }).click();
    await expect(page.getByText('Tomorrow')).not.toBeVisible();
  });
});
