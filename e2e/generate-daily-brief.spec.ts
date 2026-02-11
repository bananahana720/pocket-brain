import { test, expect } from '@playwright/test';
import { generateDailyBrief } from '../services/geminiService';
import { NoteType, type Note } from '../types';

test.describe('generateDailyBrief', () => {
  test('returns null when there are no notes relevant to today', async () => {
    const staleNote: Note = {
      id: 'stale-note',
      content: 'Old note content',
      createdAt: Date.now() - 3 * 86400000,
      isProcessed: true,
      type: NoteType.NOTE,
    };

    await expect(generateDailyBrief([staleNote])).resolves.toBeNull();
  });
});
