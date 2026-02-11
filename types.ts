export enum NoteType {
  NOTE = 'NOTE',
  TASK = 'TASK',
  IDEA = 'IDEA',
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