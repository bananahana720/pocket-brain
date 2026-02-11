import { test, expect } from '@playwright/test';
import { gotoWithNotes, makeNote, makeTask } from './helpers';

test.describe('Filters & Search', () => {
  const fixtures = () => [
    makeNote({ id: 'n1', title: 'My Note', content: 'Regular note', type: 'NOTE', tags: ['work'] }),
    makeTask({ id: 't1', title: 'My Task', content: 'Task content', tags: ['task', 'work'] }),
    makeNote({ id: 'i1', title: 'My Idea', content: 'Idea content', type: 'IDEA', tags: ['creative'] }),
  ];

  test('filter by type: Tasks', async ({ page }) => {
    await gotoWithNotes(page, fixtures());
    await page.getByRole('button', { name: 'Tasks' }).click();
    await expect(page.getByText('Task content')).toBeVisible();
    await expect(page.getByText('Regular note')).not.toBeVisible();
    await expect(page.getByText('Idea content')).not.toBeVisible();
  });

  test('filter by type: Ideas', async ({ page }) => {
    await gotoWithNotes(page, fixtures());
    await page.getByRole('button', { name: 'Ideas' }).click();
    await expect(page.getByText('Idea content')).toBeVisible();
    await expect(page.getByText('Regular note')).not.toBeVisible();
  });

  test('filter by type: Notes', async ({ page }) => {
    await gotoWithNotes(page, fixtures());
    await page.getByRole('button', { name: 'Notes' }).click();
    await expect(page.getByText('Regular note')).toBeVisible();
    await expect(page.getByText('Task content')).not.toBeVisible();
  });

  test('text search filters notes', async ({ page }) => {
    await gotoWithNotes(page, fixtures());
    const search = page.locator('input[type="text"]');
    await search.fill('Idea');
    await expect(page.getByText('Idea content')).toBeVisible();
    await expect(page.getByText('Regular note')).not.toBeVisible();
  });

  test('tag click filters by tag', async ({ page }) => {
    await gotoWithNotes(page, fixtures());
    // Click the #creative tag on the idea note
    await page.locator('main').getByText('#creative').click();
    await expect(page.getByText('Idea content')).toBeVisible();
    await expect(page.getByText('Regular note')).not.toBeVisible();
  });

  test('clear filters shows all notes', async ({ page }) => {
    await gotoWithNotes(page, fixtures());
    await page.getByRole('button', { name: 'Tasks' }).click();
    await expect(page.getByText('Regular note')).not.toBeVisible();

    await page.getByRole('button', { name: 'All' }).click();
    await expect(page.getByText('Regular note')).toBeVisible();
    await expect(page.getByText('Task content')).toBeVisible();
    await expect(page.getByText('Idea content')).toBeVisible();
  });
});
