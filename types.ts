export enum NoteType {
  NOTE = 'NOTE',
  TASK = 'TASK',
  IDEA = 'IDEA',
}

export type AIProvider = 'gemini' | 'openrouter';

export interface AIAuthState {
  connected: boolean;
  provider?: AIProvider;
  expiresAt?: number;
}

export interface Note {
  id: string;
  content: string;
  createdAt: number;
  // AI Generated fields
  title?: string;
  tags?: string[];
  type?: NoteType;
  isProcessed: boolean;
  // Task specific
  isCompleted?: boolean;
  // Pin & Archive
  isPinned?: boolean;
  isArchived?: boolean;
  // Due dates & Priority
  dueDate?: number;  // timestamp
  priority?: 'urgent' | 'normal' | 'low';
  // AI processing metadata for race-safe async updates.
  analysisVersion?: number;
  contentHash?: string;
  analysisState?: 'pending' | 'complete' | 'failed';
  lastAnalyzedAt?: number;
}

export interface AIAnalysisResult {
  title: string;
  tags: string[];
  type: NoteType;
  content?: string;
  dueDate?: string;  // ISO date string from AI
  priority?: 'urgent' | 'normal' | 'low';
}

export interface UndoAction {
  type: 'DELETE' | 'ARCHIVE' | 'EDIT' | 'TOGGLE_COMPLETE';
  noteSnapshot: Note;
  timestamp: number;
}
