import { test, expect } from '@playwright/test';
import { gotoWithNotes, makeNote } from './helpers';

const openGraphFromHeader = async (page: import('@playwright/test').Page) => {
  await page.locator('button[title="Graph view"]').click();
  await expect(page.getByTestId('thought-graph-view')).toBeVisible();
};

test.describe('Thought Graph', () => {
  test('graph view opens from header and drawer', async ({ page }) => {
    const now = Date.now();
    await gotoWithNotes(page, [
      makeNote({ id: 'g1', title: 'Graph A', tags: ['alpha'], createdAt: now }),
      makeNote({ id: 'g2', title: 'Graph B', tags: ['alpha'], createdAt: now - 1000 }),
    ]);

    await openGraphFromHeader(page);

    await page.locator('button[title="Graph view"]').click();
    await page.locator('.lucide-menu').locator('xpath=ancestor::button').click();
    await page.getByRole('button', { name: 'Thought Graph Open' }).click();
    await expect(page.getByTestId('thought-graph-view')).toBeVisible();
  });

  test('shared tags create edges and backlinks', async ({ page }) => {
    const now = Date.now();
    await gotoWithNotes(page, [
      makeNote({ id: 't1', title: 'Alpha Plan', content: 'Main note', tags: ['project'], createdAt: now }),
      makeNote({ id: 't2', title: 'Beta Plan', content: 'Linked note', tags: ['project'], createdAt: now - 1000 }),
    ]);

    await expect(page.getByText('Backlinks').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Beta Plan/ })).toBeVisible();

    await openGraphFromHeader(page);
    await expect(page.getByTestId('graph-stats')).toContainText('1 edges');
  });

  test('shared entities can create links without shared tags', async ({ page }) => {
    const now = Date.now();
    await gotoWithNotes(page, [
      makeNote({
        id: 'e1',
        title: 'Apollo NASA timeline',
        content: 'Review NASA Apollo launch dependencies',
        tags: [],
        createdAt: now,
      }),
      makeNote({
        id: 'e2',
        title: 'Apollo NASA budget',
        content: 'NASA Apollo budget options for Q4',
        tags: [],
        createdAt: now - 1000,
      }),
      makeNote({
        id: 'e3',
        title: 'Kitchen shopping',
        content: 'buy groceries and detergent',
        tags: [],
        createdAt: now - 2000,
      }),
    ]);

    await expect(page.getByText('Backlinks').first()).toBeVisible();
    await expect(page.getByText(/Shared entity:/).first()).toBeVisible();
  });

  test('backlink click opens graph and focuses target note', async ({ page }) => {
    const now = Date.now();
    await gotoWithNotes(page, [
      makeNote({ id: 'b1', title: 'Source Node', content: 'Start', tags: ['mesh'], createdAt: now }),
      makeNote({ id: 'b2', title: 'Target Node', content: 'Goal', tags: ['mesh'], createdAt: now - 1000 }),
    ]);

    const sourceCard = page
      .getByRole('heading', { name: 'Source Node' })
      .locator('xpath=ancestor::div[contains(@class,"rounded-2xl")]')
      .first();

    await sourceCard.getByRole('button', { name: /Target Node/ }).click();

    await expect(page.getByTestId('thought-graph-view')).toBeVisible();
    await expect(page.getByTestId('graph-focused-title')).toHaveText('Target Node');
  });

  test('archived notes are excluded by default and can be included', async ({ page }) => {
    const now = Date.now();
    await gotoWithNotes(page, [
      makeNote({ id: 'a1', title: 'Active One', tags: ['cluster'], createdAt: now }),
      makeNote({ id: 'a2', title: 'Active Two', tags: ['cluster'], createdAt: now - 1000 }),
      makeNote({ id: 'a3', title: 'Archived Three', tags: ['cluster'], isArchived: true, createdAt: now - 2000 }),
    ]);

    await openGraphFromHeader(page);
    await expect(page.getByTestId('graph-stats')).toContainText('2 nodes');

    await page.getByTestId('graph-include-archived').check();
    await expect(page.getByTestId('graph-stats')).toContainText('3 nodes');
  });

  test('archived-only graph can be expanded via include archived toggle', async ({ page }) => {
    const now = Date.now();
    await gotoWithNotes(page, [
      makeNote({ id: 'ao1', title: 'Archived One', tags: ['cluster'], isArchived: true, createdAt: now }),
      makeNote({ id: 'ao2', title: 'Archived Two', tags: ['cluster'], isArchived: true, createdAt: now - 1000 }),
    ]);

    await openGraphFromHeader(page);
    await expect(page.getByTestId('graph-stats')).toContainText('0 nodes');

    await page.getByTestId('graph-include-archived').check();
    await expect(page.getByTestId('graph-stats')).toContainText('2 nodes');
  });

  test('increasing min edge score hides weaker edges', async ({ page }) => {
    const now = Date.now();
    await gotoWithNotes(page, [
      makeNote({ id: 's1', title: 'Score One', tags: ['threshold'], createdAt: now }),
      makeNote({ id: 's2', title: 'Score Two', tags: ['threshold'], createdAt: now - 1000 }),
    ]);

    await openGraphFromHeader(page);
    await expect(page.getByTestId('graph-stats')).toContainText('1 edges');

    await page.getByTestId('graph-min-score').evaluate(el => {
      const input = el as HTMLInputElement;
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      nativeSetter?.call(input, '8');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await expect(page.getByTestId('graph-stats')).toContainText('0 edges');
  });
});
