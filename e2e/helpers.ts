import { Page } from '@playwright/test';

const STORAGE_KEY = 'pocketbrain_notes';
const STORAGE_SHADOW_KEY = 'pocketbrain_notes_shadow';
const STORAGE_SCOPE_META_KEY = 'pocketbrain_storage_scope_v1';
const DEV_AUTH_STORAGE_KEY = 'pb_dev_auth_user_id';
const ANON_STORAGE_SCOPE = '__anon__';

export function resolveStorageScope(userId: string | null): string {
  if (!userId) return ANON_STORAGE_SCOPE;
  const trimmed = userId.trim();
  return trimmed.length > 0 ? trimmed : ANON_STORAGE_SCOPE;
}

export function getScopedStorageKey(base: string, scope: string): string {
  return `${base}::${scope}`;
}

/** Navigate to the app with optional pre-seeded notes */
export async function gotoWithNotes(page: Page, notes?: object[]) {
  await page.goto('/');

  await page.evaluate(
    ({ storageKey, shadowKey, scopeKey, devAuthKey, anonScope, data }) => {
      const activeUserId = window.localStorage.getItem(devAuthKey);
      const scope = typeof activeUserId === 'string' && activeUserId.trim().length > 0 ? activeUserId.trim() : anonScope;
      const scopedStorageKey = `${storageKey}::${scope}`;
      const scopedShadowKey = `${shadowKey}::${scope}`;

      window.localStorage.setItem(scopeKey, scope);
      if (Array.isArray(data)) {
        const serialized = JSON.stringify(data);
        window.localStorage.setItem(scopedStorageKey, serialized);
        window.localStorage.setItem(scopedShadowKey, serialized);
        if (scope === anonScope) {
          window.localStorage.setItem(storageKey, serialized);
          window.localStorage.setItem(shadowKey, serialized);
        }
      } else {
        window.localStorage.removeItem(scopedStorageKey);
        window.localStorage.removeItem(scopedShadowKey);
        if (scope === anonScope) {
          window.localStorage.removeItem(storageKey);
          window.localStorage.removeItem(shadowKey);
        }
      }
    },
    {
      storageKey: STORAGE_KEY,
      shadowKey: STORAGE_SHADOW_KEY,
      scopeKey: STORAGE_SCOPE_META_KEY,
      devAuthKey: DEV_AUTH_STORAGE_KEY,
      anonScope: ANON_STORAGE_SCOPE,
      data: notes,
    }
  );
  await page.reload();

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

export async function configureCaptureSaveHooks(
  page: Page,
  options: { delayMs?: number }
) {
  await page.evaluate(({ delayMs }) => {
    (window as any).__PB_CAPTURE_SAVE_DELAY_MS = delayMs ?? 0;
  }, options);
}

/** Open the three-dot context menu on the first (or only) note card */
export async function openNoteMenu(page: Page) {
  await page.locator('.lucide-ellipsis-vertical').first().locator('xpath=ancestor::button').click();
}
