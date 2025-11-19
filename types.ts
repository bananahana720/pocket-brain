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
}

export interface AIAnalysisResult {
  title: string;
  tags: string[];
  type: NoteType;
  content?: string;
}

export interface SearchResult {
  answer: string;
  relevantNoteIds: string[];
}