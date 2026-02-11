import { Page } from '@playwright/test';

const STORAGE_KEY = 'pocketbrain_notes';

/** Navigate to the app with optional pre-seeded notes */
export async function gotoWithNotes(page: Page, notes?: object[]) {
  await page.goto('/');
  if (notes) {
    await page.evaluate(({ key, data }) => {
      localStorage.setItem(key, JSON.stringify(data));
    }, { key: STORAGE_KEY, data: notes });
    await page.reload();
  } else {
    await page.evaluate((key) => {
      localStorage.removeItem(key);
    }, STORAGE_KEY);
    await page.reload();
  }
  // Wait for app to render
  await page.locator('h1').waitFor();
}

/** Create a basic note fixture */
export function makeNote(overrides: Record<string, unknown> = {}) {
  const id = String(Date.now()) + String(Math.random()).slice(2, 8);
  return {
    id,
    content: 'Test note content',
    createdAt: Date.now(),
    isProcessed: true,
    title: 'Test Note',
    tags: ['test'],
    type: 'NOTE',
    ...overrides,
  };
}

/** Create a task fixture */
export function makeTask(overrides: Record<string, unknown> = {}) {
  return makeNote({
    type: 'TASK',
    title: 'Test Task',
    content: 'Test task content',
    tags: ['task'],
    ...overrides,
  });
}

/** Type into the main input textarea and submit via Cmd+Enter */
export async function createNoteViaUI(page: Page, text: string) {
  const textarea = page.locator('.fixed.bottom-0 textarea');
  await textarea.fill(text);
  await textarea.press('Meta+Enter');
}

/** Open the three-dot context menu on the first (or only) note card */
export async function openNoteMenu(page: Page) {
  await page.locator('.lucide-ellipsis-vertical').first().locator('xpath=ancestor::button').click();
}
