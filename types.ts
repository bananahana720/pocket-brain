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
  scope?: 'account' | 'device';
  connectedAt?: number;
  updatedAt?: number;
}

export interface Note {
  id: string;
  content: string;
  createdAt: number;
  updatedAt?: number;
  version?: number;
  deletedAt?: number;
  lastModifiedByDeviceId?: string;
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

export interface SyncOp {
  requestId: string;
  op: 'upsert' | 'delete';
  noteId: string;
  baseVersion: number;
  note?: Note;
  clientChangedFields?: string[];
  baseNote?: Partial<Note>;
  autoMergeAttempted?: boolean;
}

export interface SyncConflict {
  requestId: string;
  noteId: string;
  baseVersion: number;
  currentVersion: number;
  serverNote: Note;
  changedFields: string[];
}

export interface SyncPushRequest {
  operations: SyncOp[];
}

export interface SyncPushResponse {
  applied: Array<{
    requestId: string;
    note: Note;
    cursor: number;
  }>;
  conflicts: SyncConflict[];
  nextCursor: number;
}

export interface SyncPullResponse {
  changes: Array<{ cursor: number; op: 'upsert' | 'delete'; note: Note; requestId: string }>;
  nextCursor: number;
  resetRequired?: boolean;
  resetReason?: 'CURSOR_TOO_OLD';
  oldestAvailableCursor?: number;
  latestCursor?: number;
}

export interface SyncCursor {
  value: number;
}

export interface DeviceSession {
  id: string;
  label: string;
  platform: string;
  lastSeenAt: number;
  revokedAt?: number | null;
  createdAt: number;
}

export interface SyncBootstrapState {
  imported: number;
  alreadyBootstrapped: boolean;
  cursor: number;
}
