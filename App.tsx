import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Search, Sparkles, Menu, Zap, BrainCircuit, X, Archive, Calendar, WifiOff } from 'lucide-react';
import { AIAuthState, AIProvider, Note, NoteType, UndoAction } from './types';
import {
  AIServiceError,
  analyzeNote,
  askMyNotes,
  cleanupNoteDraft,
  connectAIProvider,
  disconnectAIProvider,
  generateDailyBrief,
  getAIAuthStatus,
  isProxyEnabled,
  processBatchEntry,
  transcribeAudio,
} from './services/geminiService';
import NoteCard from './components/NoteCard';
import InputArea, { InputAreaHandle } from './components/InputArea';
import TodayView from './components/TodayView';
import Drawer from './components/Drawer';
import ErrorBoundary from './components/ErrorBoundary';
import DiagnosticsPanel from './components/DiagnosticsPanel';
import { ToastContainer, ToastMessage, ToastAction } from './components/Toast';
import { ThemeProvider } from './contexts/ThemeContext';
import { trackEvent } from './utils/analytics';
import { hashContent } from './utils/hash';
import { useDebouncedValue } from './hooks/useDebouncedValue';
import { decodeSharedNotePayload, SharedNotePayload } from './utils/sharedNoteLink';
import {
  NoteOp,
  compactSnapshot,
  migrateFromLocalStorage,
  resetNotesStore,
  saveOps,
} from './storage/notesStore';
import {
  incrementMetric,
  recordAiErrorCode,
  recordAiLatency,
  recordPersistLatency,
} from './utils/telemetry';

const STORAGE_KEY = 'pocketbrain_notes';
const BACKUP_RECORDED_KEY = 'pocketbrain_last_backup_at';
const BACKUP_REMINDER_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const OP_COMPACT_THRESHOLD = 200;

const INITIAL_VISIBLE_NOTES = 60;
const VISIBLE_NOTES_STEP = 40;
const LARGE_DATASET_THRESHOLD = 500;
const VIRTUAL_ROW_HEIGHT = 210;
const VIRTUAL_OVERSCAN = 12;

interface AnalysisJob {
  noteId: string;
  content: string;
  version: number;
  contentHash: string;
  attempts: number;
}

function buildNoteSearchText(note: Note): string {
  return `${note.content} ${note.title || ''} ${(note.tags || []).join(' ')}`.toLowerCase();
}

function addNoteToIndexes(
  note: Note,
  searchTextIndex: Map<string, string>,
  tagIndex: Map<string, Set<string>>
): void {
  searchTextIndex.set(note.id, buildNoteSearchText(note));

  for (const tag of note.tags || []) {
    const key = tag.toLowerCase();
    if (!tagIndex.has(key)) {
      tagIndex.set(key, new Set());
    }
    tagIndex.get(key)!.add(note.id);
  }
}

function removeNoteFromIndexes(
  note: Note,
  searchTextIndex: Map<string, string>,
  tagIndex: Map<string, Set<string>>
): void {
  searchTextIndex.delete(note.id);

  for (const tag of note.tags || []) {
    const key = tag.toLowerCase();
    const ids = tagIndex.get(key);
    if (!ids) continue;
    ids.delete(note.id);
    if (ids.size === 0) {
      tagIndex.delete(key);
    }
  }
}

function buildOps(prevNotes: Note[], nextNotes: Note[]): NoteOp[] {
  const ops: NoteOp[] = [];

  const prevById = new Map(prevNotes.map(note => [note.id, note]));
  const nextById = new Map(nextNotes.map(note => [note.id, note]));

  for (const note of nextNotes) {
    const prev = prevById.get(note.id);
    if (!prev || prev !== note) {
      ops.push({ type: 'upsert', note });
    }
  }

  for (const note of prevNotes) {
    if (!nextById.has(note.id)) {
      ops.push({ type: 'delete', id: note.id });
    }
  }

  return ops;
}

function toAiMessage(error: unknown): {
  code: string;
  message: string;
  degradedMessage: string;
  retryable: boolean;
  deferUntilConnected: boolean;
} {
  if (error instanceof AIServiceError) {
    switch (error.code) {
      case 'AUTH_REQUIRED':
        return {
          code: error.code,
          message: 'Connect an AI key to use AI features.',
          degradedMessage: 'Capture-only mode — connect an AI key in Settings.',
          retryable: false,
          deferUntilConnected: true,
        };
      case 'AUTH_EXPIRED':
        return {
          code: error.code,
          message: 'AI session expired. Reconnect your key.',
          degradedMessage: 'Capture-only mode — AI session expired.',
          retryable: false,
          deferUntilConnected: true,
        };
      case 'RATE_LIMITED':
        return {
          code: error.code,
          message: 'AI rate-limited. Retrying shortly.',
          degradedMessage: 'AI degraded — provider is rate-limiting requests.',
          retryable: true,
          deferUntilConnected: false,
        };
      case 'TIMEOUT':
        return {
          code: error.code,
          message: 'AI request timed out. Retrying.',
          degradedMessage: 'AI degraded — provider timeout.',
          retryable: true,
          deferUntilConnected: false,
        };
      case 'NETWORK':
        return {
          code: error.code,
          message: 'Network issue contacting AI service.',
          degradedMessage: 'AI degraded — network issue.',
          retryable: true,
          deferUntilConnected: false,
        };
      case 'PROVIDER_UNAVAILABLE':
        return {
          code: error.code,
          message: 'AI provider unavailable right now.',
          degradedMessage: 'AI degraded — provider unavailable.',
          retryable: true,
          deferUntilConnected: false,
        };
      default:
        return {
          code: error.code,
          message: error.message || 'AI request failed.',
          degradedMessage: 'AI degraded — request failed.',
          retryable: error.retryable,
          deferUntilConnected: false,
        };
    }
  }

  return {
    code: 'UNKNOWN',
    message: 'Unexpected AI error.',
    degradedMessage: 'AI degraded — unexpected error.',
    retryable: false,
    deferUntilConnected: false,
  };
}

function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 120);
  const [isAiSearch, setIsAiSearch] = useState(false);
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [filter, setFilter] = useState<NoteType | 'ALL'>('ALL');
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);

  // UI State
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [viewMode, setViewMode] = useState<'all' | 'today'>('all');
  const [aiBrief, setAiBrief] = useState<string | null>(null);
  const [isLoadingBrief, setIsLoadingBrief] = useState(false);
  const [visibleNotesCount, setVisibleNotesCount] = useState(INITIAL_VISIBLE_NOTES);
  const [virtualRange, setVirtualRange] = useState({ start: 0, end: 0 });
  const [aiAuth, setAiAuth] = useState<AIAuthState>({ connected: false });
  const [aiErrorMessage, setAiErrorMessage] = useState<string | null>(null);
  const [aiDegradedMessage, setAiDegradedMessage] = useState<string | null>(null);
  const [sharedNotePayload, setSharedNotePayload] = useState<SharedNotePayload | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const inputAreaRef = useRef<InputAreaHandle>(null);
  const handleUndoRef = useRef<() => void>(() => {});
  const notesRef = useRef<Note[]>([]);
  const isAiSearchRef = useRef(false);
  const isDrawerOpenRef = useRef(false);
  const searchTextIndexRef = useRef<Map<string, string>>(new Map());
  const tagIndexRef = useRef<Map<string, Set<string>>>(new Map());
  const indexedNotesRef = useRef<Note[]>([]);

  const hasLoadedRef = useRef(false);
  const previousNotesRef = useRef<Note[]>([]);
  const persistChainRef = useRef<Promise<void>>(Promise.resolve());
  const analysisControllersRef = useRef<Map<string, AbortController>>(new Map());
  const pendingAnalysisRef = useRef<AnalysisJob[]>([]);
  const deferredAnalysisRef = useRef<AnalysisJob[]>([]);
  const transientReplayQueueRef = useRef<AnalysisJob[]>([]);
  const processingAnalysisRef = useRef(false);
  const backupReminderShownRef = useRef(false);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const notesListRef = useRef<HTMLDivElement>(null);
  const virtualRangeRafRef = useRef<number | null>(null);

  // --- Toast System ---
  const addToast = useCallback(
    (message: string, type: 'success' | 'error' | 'info' = 'success', action?: ToastAction) => {
      const id = Date.now().toString() + Math.random();
      setToasts(prev => [...prev, { id, message, type, action }]);
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, action ? 5000 : 3000);
    },
    []
  );

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const refreshAiAuth = useCallback(async () => {
    try {
      const status = await getAIAuthStatus();
      setAiAuth(status);
      if (!status.connected && isProxyEnabled()) {
        setAiDegradedMessage('Capture-only mode — connect an AI key in Settings.');
      }
    } catch {
      setAiAuth({ connected: false });
      if (isProxyEnabled()) {
        setAiDegradedMessage('Capture-only mode — AI auth service unavailable.');
      }
    }
  }, []);

  const cancelAnalysisForNote = useCallback((noteId: string) => {
    const controller = analysisControllersRef.current.get(noteId);
    if (controller) {
      controller.abort();
      analysisControllersRef.current.delete(noteId);
    }
    pendingAnalysisRef.current = pendingAnalysisRef.current.filter(job => job.noteId !== noteId);
    deferredAnalysisRef.current = deferredAnalysisRef.current.filter(job => job.noteId !== noteId);
    transientReplayQueueRef.current = transientReplayQueueRef.current.filter(job => job.noteId !== noteId);
  }, []);

  const runAnalysisQueue = useCallback(() => {
    if (processingAnalysisRef.current) return;
    const job = pendingAnalysisRef.current.shift();
    if (!job) return;

    processingAnalysisRef.current = true;

    const controller = new AbortController();
    analysisControllersRef.current.set(job.noteId, controller);

    const startedAt = performance.now();
    incrementMetric('ai_requests');

    analyzeNote(job.content, { signal: controller.signal })
      .then(analysis => {
        recordAiLatency(performance.now() - startedAt);
        setAiErrorMessage(null);
        setAiDegradedMessage(null);

        setNotes(prev =>
          prev.map(note => {
            if (note.id !== job.noteId) return note;
            if (note.analysisVersion !== job.version || note.contentHash !== job.contentHash) {
              incrementMetric('stale_analysis_drops');
              return note;
            }

            return {
              ...note,
              title: analysis?.title || 'Quick Note',
              tags: analysis?.tags || [],
              type: analysis?.type || NoteType.NOTE,
              isProcessed: true,
              analysisState: 'complete',
              lastAnalyzedAt: Date.now(),
              ...(analysis?.dueDate ? { dueDate: new Date(analysis.dueDate).getTime() } : {}),
              ...(analysis?.priority ? { priority: analysis.priority } : {}),
            };
          })
        );
      })
      .catch(error => {
        if (controller.signal.aborted) return;

        const mapped = toAiMessage(error);
        incrementMetric('ai_failures');
        recordAiErrorCode(mapped.code);

        setAiErrorMessage(mapped.message);
        setAiDegradedMessage(mapped.degradedMessage);

        setNotes(prev =>
          prev.map(note => {
            if (note.id !== job.noteId) return note;
            if (note.analysisVersion !== job.version || note.contentHash !== job.contentHash) {
              incrementMetric('stale_analysis_drops');
              return note;
            }
            return {
              ...note,
              analysisState: 'failed',
            };
          })
        );

        const retriedJob: AnalysisJob = { ...job, attempts: job.attempts + 1 };

        if (mapped.deferUntilConnected) {
          deferredAnalysisRef.current.push(retriedJob);
          return;
        }

        if (mapped.retryable && job.attempts < 2) {
          window.setTimeout(() => {
            pendingAnalysisRef.current.push(retriedJob);
            runAnalysisQueue();
          }, 350 * Math.pow(2, job.attempts));
        } else if (mapped.retryable) {
          transientReplayQueueRef.current.push(retriedJob);
        }
      })
      .finally(() => {
        analysisControllersRef.current.delete(job.noteId);
        processingAnalysisRef.current = false;
        runAnalysisQueue();
      });
  }, []);

  const enqueueAnalysis = useCallback(
    (job: AnalysisJob) => {
      pendingAnalysisRef.current.push(job);
      runAnalysisQueue();
    },
    [runAnalysisQueue]
  );

  const recordBackupCompletion = useCallback(() => {
    localStorage.setItem(BACKUP_RECORDED_KEY, String(Date.now()));
  }, []);

  // --- Load/Save Logic (IndexedDB + migration) ---
  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        let loaded = await migrateFromLocalStorage(STORAGE_KEY);
        if (!loaded.length) {
          const localFallback = localStorage.getItem(STORAGE_KEY);
          if (localFallback) {
            loaded = JSON.parse(localFallback) as Note[];
          }
        }

        if (cancelled) return;
        setNotes(loaded);
        previousNotesRef.current = loaded;
      } catch (error) {
        console.error('Failed to load notes from IndexedDB', error);
        addToast('Unable to load saved notes', 'error');
      } finally {
        if (!cancelled) {
          hasLoadedRef.current = true;
        }
      }
    };

    bootstrap();

    return () => {
      cancelled = true;
    };
  }, [addToast]);

  useEffect(() => {
    if (!hasLoadedRef.current) return;

    const prev = previousNotesRef.current;
    const next = notes;
    const ops = buildOps(prev, next);

    previousNotesRef.current = next;
    if (ops.length === 0) return;

    persistChainRef.current = persistChainRef.current
      .then(async () => {
        const started = performance.now();
        const { opCount } = await saveOps(ops);
        incrementMetric('persist_writes');
        recordPersistLatency(performance.now() - started);

        if (opCount >= OP_COMPACT_THRESHOLD) {
          await compactSnapshot(next);
        }
      })
      .catch(error => {
        console.error('Failed to persist notes', error);
        incrementMetric('persist_failures');
        addToast('Storage issue — some changes may not be saved', 'error');
      });
  }, [notes, addToast]);

  // --- Offline Detection ---
  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const via = params.get('via');
    if (!via) return;

    let shouldCleanUrl = false;

    if (via === 'daily_brief_share') {
      trackEvent('daily_brief_share_opened');
      addToast('Opened from a shared PocketBrain brief', 'info');
      shouldCleanUrl = true;
    }

    if (via === 'note_share') {
      const encoded = params.get('shared_note');
      const shared = encoded ? decodeSharedNotePayload(encoded) : null;
      if (shared) {
        setSharedNotePayload(shared);
        trackEvent('note_share_opened', {
          noteType: shared.type || NoteType.NOTE,
          tagCount: shared.tags?.length || 0,
          hasDueDate: !!shared.dueDate,
        });
        addToast('Shared note ready to import', 'info');
      } else {
        addToast('Shared note link is invalid', 'error');
      }
      shouldCleanUrl = true;
    }

    if (!shouldCleanUrl) return;
    params.delete('via');
    params.delete('shared_note');
    const query = params.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
    window.history.replaceState({}, '', nextUrl);
  }, [addToast]);

  useEffect(() => {
    refreshAiAuth();
    const interval = window.setInterval(refreshAiAuth, 5 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [refreshAiAuth]);

  useEffect(() => {
    if (!aiAuth.connected || deferredAnalysisRef.current.length === 0) return;
    pendingAnalysisRef.current.push(...deferredAnalysisRef.current.splice(0, deferredAnalysisRef.current.length));
    runAnalysisQueue();
  }, [aiAuth.connected, runAnalysisQueue]);

  useEffect(() => {
    if (isOffline) return;
    if (transientReplayQueueRef.current.length === 0) return;
    pendingAnalysisRef.current.push(...transientReplayQueueRef.current.splice(0, transientReplayQueueRef.current.length));
    runAnalysisQueue();
  }, [isOffline, runAnalysisQueue]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (isOffline) return;
      if (transientReplayQueueRef.current.length === 0) return;
      pendingAnalysisRef.current.push(...transientReplayQueueRef.current.splice(0, transientReplayQueueRef.current.length));
      runAnalysisQueue();
    }, 60_000);

    return () => window.clearInterval(interval);
  }, [isOffline, runAnalysisQueue]);

  useEffect(() => {
    if (backupReminderShownRef.current) return;
    if (!hasLoadedRef.current) return;
    if (notes.length === 0) return;

    const raw = localStorage.getItem(BACKUP_RECORDED_KEY);
    const lastBackup = raw ? Number(raw) : 0;
    if (!lastBackup || Date.now() - lastBackup > BACKUP_REMINDER_INTERVAL_MS) {
      backupReminderShownRef.current = true;
      addToast('Backup reminder: create an encrypted export from Menu > Export', 'info', {
        label: 'Open',
        onClick: () => setIsDrawerOpen(true),
      });
    }
  }, [notes.length, addToast]);

  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  useEffect(() => {
    const prevNotes = indexedNotesRef.current;

    if (prevNotes.length === 0 && notes.length === 0) {
      return;
    }

    const prevById = new Map(prevNotes.map(note => [note.id, note]));
    const nextById = new Map(notes.map(note => [note.id, note]));

    for (const prevNote of prevNotes) {
      if (!nextById.has(prevNote.id)) {
        removeNoteFromIndexes(prevNote, searchTextIndexRef.current, tagIndexRef.current);
      }
    }

    for (const nextNote of notes) {
      const prevNote = prevById.get(nextNote.id);
      if (!prevNote) {
        addNoteToIndexes(nextNote, searchTextIndexRef.current, tagIndexRef.current);
        continue;
      }

      if (prevNote !== nextNote) {
        removeNoteFromIndexes(prevNote, searchTextIndexRef.current, tagIndexRef.current);
        addNoteToIndexes(nextNote, searchTextIndexRef.current, tagIndexRef.current);
      }
    }

    indexedNotesRef.current = notes;
  }, [notes]);

  useEffect(() => {
    isAiSearchRef.current = isAiSearch;
  }, [isAiSearch]);

  useEffect(() => {
    isDrawerOpenRef.current = isDrawerOpen;
  }, [isDrawerOpen]);

  // --- Global Keyboard Shortcuts ---
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'i') {
        e.preventDefault();
        inputAreaRef.current?.focus();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        const active = document.activeElement;
        const isInInput = active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement;
        if (!isInInput) {
          e.preventDefault();
          handleUndoRef.current();
        }
      }
      if (e.key === 'Escape') {
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        if (isAiSearchRef.current) setIsAiSearch(false);
        if (isDrawerOpenRef.current) setIsDrawerOpen(false);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // --- Undo System ---
  const pushUndo = useCallback((action: UndoAction) => {
    setUndoStack(prev => [...prev.slice(-9), action]);
  }, []);

  const handleUndo = useCallback(() => {
    setUndoStack(prev => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.type === 'DELETE') {
        setNotes(n => [last.noteSnapshot, ...n]);
      } else if (last.type === 'TOGGLE_COMPLETE' || last.type === 'ARCHIVE') {
        setNotes(n => n.map(note => (note.id === last.noteSnapshot.id ? last.noteSnapshot : note)));
      }
      addToast('Action undone', 'success');
      return prev.slice(0, -1);
    });
  }, [addToast]);

  useEffect(() => {
    handleUndoRef.current = handleUndo;
  }, [handleUndo]);

  // --- Tag Filtering ---
  const handleTagClick = useCallback((tag: string) => {
    setActiveTag(prev => (prev === tag ? null : tag));
  }, []);

  // --- Note Actions ---
  const handleAddNote = useCallback(
    (content: string, presetType?: NoteType) => {
      const id = `${Date.now()}${Math.random().toString().slice(2, 6)}`;
      const now = Date.now();
      const contentSignature = hashContent(content);
      const analysisVersion = presetType ? 0 : 1;

      const newNote: Note = {
        id,
        content,
        createdAt: now,
        isProcessed: !!presetType,
        analysisVersion,
        contentHash: contentSignature,
        analysisState: presetType ? 'complete' : 'pending',
        ...(presetType ? { type: presetType, title: content.slice(0, 50) } : {}),
      };

      setNotes(prev => [newNote, ...prev]);
      addToast('Note captured', 'success');

      if (!presetType) {
        enqueueAnalysis({
          noteId: id,
          content,
          version: analysisVersion,
          contentHash: contentSignature,
          attempts: 0,
        });
      }
    },
    [addToast, enqueueAnalysis]
  );

  const handleImportSharedNote = useCallback(() => {
    if (!sharedNotePayload) return;

    const now = Date.now();
    const content = sharedNotePayload.content;
    const importedType = sharedNotePayload.type || NoteType.NOTE;
    const importedNote: Note = {
      id: `${now}${Math.random().toString().slice(2, 6)}`,
      content,
      createdAt: now,
      isProcessed: true,
      title: sharedNotePayload.title || content.slice(0, 50),
      tags: sharedNotePayload.tags || [],
      type: importedType,
      isCompleted: false,
      analysisVersion: 0,
      contentHash: hashContent(content),
      analysisState: 'complete',
      lastAnalyzedAt: now,
      ...(sharedNotePayload.dueDate ? { dueDate: sharedNotePayload.dueDate } : {}),
      ...(sharedNotePayload.priority ? { priority: sharedNotePayload.priority } : {}),
    };

    setNotes(prev => [importedNote, ...prev]);
    setShowArchived(false);
    setViewMode('all');
    setSharedNotePayload(null);
    trackEvent('note_share_imported', {
      noteType: importedType,
      tagCount: importedNote.tags?.length || 0,
      hasDueDate: !!importedNote.dueDate,
    });
    addToast('Shared note imported', 'success');
  }, [addToast, sharedNotePayload]);

  const handleBatchNote = useCallback(
    async (content: string) => {
      setIsProcessingBatch(true);
      addToast('AI processing batch...', 'info');

      try {
        const startedAt = performance.now();
        incrementMetric('ai_requests');
        const results = await processBatchEntry(content);
        recordAiLatency(performance.now() - startedAt);

        if (results.length === 0) {
          addToast('Failed to split notes. Saving as single note.', 'error');
          handleAddNote(content);
          return;
        }

        const now = Date.now();
        const newNotes: Note[] = results.map((result, idx) => ({
          id: `${now}${idx}${Math.random().toString().slice(2, 6)}`,
          content: (result.content as string) || content,
          createdAt: now,
          isProcessed: true,
          title: result.title,
          tags: result.tags,
          type: result.type,
          analysisVersion: 1,
          contentHash: hashContent((result.content as string) || content),
          analysisState: 'complete',
          lastAnalyzedAt: Date.now(),
        }));

        setNotes(prev => [...newNotes, ...prev]);
        setAiErrorMessage(null);
        setAiDegradedMessage(null);
        addToast(`Created ${newNotes.length} notes from batch`, 'success');
      } catch (error) {
        const mapped = toAiMessage(error);
        incrementMetric('ai_failures');
        recordAiErrorCode(mapped.code);
        setAiErrorMessage(mapped.message);
        setAiDegradedMessage(mapped.degradedMessage);
        addToast('Batch AI unavailable. Saved as single note instead.', 'error');
        handleAddNote(content);
      } finally {
        setIsProcessingBatch(false);
      }
    },
    [addToast, handleAddNote]
  );

  const handleCleanupDraft = useCallback(
    async (content: string, mode: 'single' | 'batch') => {
      try {
        const startedAt = performance.now();
        incrementMetric('ai_requests');
        const result = await cleanupNoteDraft(content, mode);
        recordAiLatency(performance.now() - startedAt);
        setAiErrorMessage(null);
        setAiDegradedMessage(null);
        if (mode === 'batch') {
          const itemCount = result.items?.length || 0;
          addToast(
            itemCount > 0
              ? `Prepared ${itemCount} cleaned lines for review`
              : 'Draft cleaned and ready for review',
            'success'
          );
        } else {
          addToast('Draft cleaned and ready for review', 'success');
        }
        return result;
      } catch (error) {
        const mapped = toAiMessage(error);
        incrementMetric('ai_failures');
        recordAiErrorCode(mapped.code);
        setAiErrorMessage(mapped.message);
        setAiDegradedMessage(mapped.degradedMessage);
        addToast('AI clean-up unavailable. Keeping your original draft.', 'error');
        throw error;
      }
    },
    [addToast]
  );

  const handleTranscribeAudio = useCallback(
    async (audio: Blob) => {
      try {
        const startedAt = performance.now();
        incrementMetric('ai_requests');
        const transcript = await transcribeAudio(audio, { language: 'en-US' });
        recordAiLatency(performance.now() - startedAt);
        setAiErrorMessage(null);
        setAiDegradedMessage(null);
        return transcript;
      } catch (error) {
        const mapped = toAiMessage(error);
        incrementMetric('ai_failures');
        recordAiErrorCode(mapped.code);
        setAiErrorMessage(mapped.message);
        setAiDegradedMessage(mapped.degradedMessage);
        addToast('AI transcription is unavailable right now.', 'error');
        throw error;
      }
    },
    [addToast]
  );

  const handleUpdateNote = useCallback(
    (id: string, newContent: string) => {
      const existing = notesRef.current.find(note => note.id === id);
      if (!existing) return;

      cancelAnalysisForNote(id);

      const nextVersion = (existing.analysisVersion || 0) + 1;
      const nextHash = hashContent(newContent);

      setNotes(prev =>
        prev.map(note =>
          note.id === id
            ? {
                ...note,
                content: newContent,
                isProcessed: false,
                analysisVersion: nextVersion,
                contentHash: nextHash,
                analysisState: 'pending',
              }
            : note
        )
      );

      enqueueAnalysis({
        noteId: id,
        content: newContent,
        version: nextVersion,
        contentHash: nextHash,
        attempts: 0,
      });

      addToast('Note updated', 'success');
    },
    [cancelAnalysisForNote, enqueueAnalysis, addToast]
  );

  const handleDeleteNote = useCallback(
    (id: string) => {
      cancelAnalysisForNote(id);
      const note = notesRef.current.find(n => n.id === id);
      if (note) {
        pushUndo({ type: 'DELETE', noteSnapshot: { ...note }, timestamp: Date.now() });
      }
      setNotes(prev => prev.filter(n => n.id !== id));
      setToasts(prev => prev.filter(t => !t.action));
      addToast('Note deleted', 'info', { label: 'Undo', onClick: handleUndo });
    },
    [cancelAnalysisForNote, pushUndo, addToast, handleUndo]
  );

  const handleCopyNote = useCallback(
    (content: string) => {
      navigator.clipboard.writeText(content);
      addToast('Copied to clipboard', 'success');
    },
    [addToast]
  );

  const handleToggleComplete = useCallback(
    (id: string) => {
      const note = notesRef.current.find(n => n.id === id);
      if (note) {
        pushUndo({ type: 'TOGGLE_COMPLETE', noteSnapshot: { ...note }, timestamp: Date.now() });
      }
      setNotes(prev => prev.map(n => (n.id === id ? { ...n, isCompleted: !n.isCompleted } : n)));
    },
    [pushUndo]
  );

  const handleReanalyze = useCallback(
    (id: string) => {
      const note = notesRef.current.find(n => n.id === id);
      if (!note) return;

      cancelAnalysisForNote(id);

      const version = (note.analysisVersion || 0) + 1;
      const signature = hashContent(note.content);

      setNotes(prev =>
        prev.map(n =>
          n.id === id
            ? {
                ...n,
                isProcessed: false,
                analysisVersion: version,
                contentHash: signature,
                analysisState: 'pending',
              }
            : n
        )
      );
      addToast('Re-analyzing...', 'info');
      enqueueAnalysis({ noteId: id, content: note.content, version, contentHash: signature, attempts: 0 });
    },
    [cancelAnalysisForNote, addToast, enqueueAnalysis]
  );

  const handlePinNote = useCallback((id: string) => {
    setNotes(prev => prev.map(n => (n.id === id ? { ...n, isPinned: !n.isPinned } : n)));
  }, []);

  const handleArchiveNote = useCallback(
    (id: string) => {
      const note = notesRef.current.find(n => n.id === id);
      if (note) {
        pushUndo({ type: 'ARCHIVE', noteSnapshot: { ...note }, timestamp: Date.now() });
      }
      setNotes(prev => prev.map(n => (n.id === id ? { ...n, isArchived: !n.isArchived } : n)));
      setToasts(prev => prev.filter(t => !t.action));
      addToast(note?.isArchived ? 'Note unarchived' : 'Note archived', 'info', { label: 'Undo', onClick: handleUndo });
    },
    [pushUndo, addToast, handleUndo]
  );

  const handleSetDueDate = useCallback((id: string, date: number | undefined) => {
    setNotes(prev => prev.map(n => (n.id === id ? { ...n, dueDate: date } : n)));
  }, []);

  const handleSetPriority = useCallback((id: string, priority: 'urgent' | 'normal' | 'low' | undefined) => {
    setNotes(prev => prev.map(n => (n.id === id ? { ...n, priority } : n)));
  }, []);

  const handleEnterTodayView = useCallback(async () => {
    setViewMode('today');
    setIsLoadingBrief(true);
    setAiBrief(null);
    try {
      const brief = await generateDailyBrief(notes);
      setAiBrief(brief);
      setAiErrorMessage(null);
      setAiDegradedMessage(null);
    } catch (error) {
      const mapped = toAiMessage(error);
      setAiErrorMessage(mapped.message);
      setAiDegradedMessage(mapped.degradedMessage);
      setAiBrief('AI briefing unavailable right now.');
    } finally {
      setIsLoadingBrief(false);
    }
  }, [notes]);

  const hasOverdueTasks = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return notes.some(n => {
      if (n.isArchived || n.isCompleted || !n.dueDate) return false;
      return n.dueDate < startOfToday;
    });
  }, [notes]);

  const handleShareTodayBrief = useCallback(
    async (brief: string, stats: { overdue: number; dueToday: number; capturedToday: number }) => {
      const shareUrl = `${window.location.origin}${window.location.pathname}?via=daily_brief_share`;
      const summary = `Overdue: ${stats.overdue} | Due today: ${stats.dueToday} | Captured today: ${stats.capturedToday}`;
      const shareText = `My PocketBrain daily brief:\n${brief}\n\n${summary}\n\nTry PocketBrain: ${shareUrl}`;

      trackEvent('daily_brief_share_clicked', stats);

      if (navigator.share) {
        try {
          await navigator.share({
            title: 'My PocketBrain Daily Brief',
            text: shareText,
            url: shareUrl,
          });
          addToast('Daily brief shared', 'success');
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') {
            addToast('Share canceled', 'info');
            return;
          }
        }
      }

      try {
        await navigator.clipboard.writeText(shareText);
        addToast('Brief copied — ready to paste', 'success');
      } catch {
        addToast('Unable to share brief on this device', 'error');
      }
    },
    [addToast]
  );

  const handleExportData = useCallback(() => {
    const dataStr = `data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify(notes, null, 2))}`;
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute('href', dataStr);
    downloadAnchorNode.setAttribute('download', 'pocketbrain_backup.json');
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
    addToast('Data exported', 'success');
  }, [notes, addToast]);

  const handleClearData = useCallback(() => {
    setNotes([]);
    localStorage.removeItem(STORAGE_KEY);
    previousNotesRef.current = [];
    resetNotesStore().catch(error => console.error('Failed to clear IndexedDB store', error));
    addToast('All data cleared', 'info');
  }, [addToast]);

  const handleImportNotes = useCallback((newNotes: Note[]) => {
    setNotes(prev => {
      const existingIds = new Set(prev.map(n => n.id));
      const unique = newNotes.filter(n => !existingIds.has(n.id));
      return [...prev, ...unique];
    });
  }, []);

  const handleSearch = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!searchQuery.trim()) return;

      if (isAiSearch) {
        setIsAiThinking(true);
        setAiAnswer(null);
        try {
          const answer = await askMyNotes(searchQuery, notes);
          setAiAnswer(answer);
          setAiErrorMessage(null);
          setAiDegradedMessage(null);
        } catch (error) {
          const mapped = toAiMessage(error);
          setAiErrorMessage(mapped.message);
          setAiDegradedMessage(mapped.degradedMessage);
          setAiAnswer('AI search is temporarily unavailable.');
        } finally {
          setIsAiThinking(false);
        }
      }
    },
    [searchQuery, isAiSearch, notes]
  );

  const filteredNotes = useMemo(() => {
    const activeTagLower = activeTag?.toLowerCase() || null;
    const lowerQ = !isAiSearch && debouncedSearchQuery ? debouncedSearchQuery.toLowerCase() : null;
    const activeTagSet = activeTagLower ? tagIndexRef.current.get(activeTagLower) : null;
    const result: Note[] = [];
    let sawPinned = false;
    let sawUnpinned = false;

    for (const note of notes) {
      if (!showArchived && note.isArchived) continue;
      if (showArchived && !note.isArchived) continue;
      if (filter !== 'ALL' && note.type !== filter) continue;

      if (activeTagLower) {
        const matchesTagIndex = !!activeTagSet?.has(note.id);
        if (!matchesTagIndex) {
          const hasTag = (note.tags || []).some(tag => tag.toLowerCase() === activeTagLower);
          if (!hasTag) continue;
        }
      }

      if (lowerQ) {
        const searchText = searchTextIndexRef.current.get(note.id) || buildNoteSearchText(note);
        if (!searchText.includes(lowerQ)) continue;
      }

      result.push(note);
      if (note.isPinned) sawPinned = true;
      else sawUnpinned = true;
    }

    const needsPinSort = sawPinned && sawUnpinned;
    const needsTaskSort = filter === NoteType.TASK;
    if (!needsPinSort && !needsTaskSort) {
      return result;
    }

    return result.sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      if (filter === NoteType.TASK) {
        const aDue = a.dueDate ?? Infinity;
        const bDue = b.dueDate ?? Infinity;
        if (aDue !== bDue) return aDue - bDue;
      }
      return 0;
    });
  }, [notes, showArchived, filter, activeTag, isAiSearch, debouncedSearchQuery]);

  const isVirtualized = viewMode === 'all' && filteredNotes.length > LARGE_DATASET_THRESHOLD;

  const visibleNotes = useMemo(() => {
    if (isVirtualized) {
      const fallbackEnd = Math.min(filteredNotes.length, 40);
      const start = virtualRange.start;
      const end = virtualRange.end > 0 ? virtualRange.end : fallbackEnd;
      return filteredNotes.slice(start, end);
    }
    return filteredNotes.slice(0, visibleNotesCount);
  }, [isVirtualized, filteredNotes, virtualRange, visibleNotesCount]);

  const virtualTopSpacing = isVirtualized ? virtualRange.start * VIRTUAL_ROW_HEIGHT : 0;
  const virtualBottomSpacing = isVirtualized
    ? Math.max(0, (filteredNotes.length - (virtualRange.end || visibleNotes.length)) * VIRTUAL_ROW_HEIGHT)
    : 0;

  const hasMoreVisibleNotes = !isVirtualized && visibleNotesCount < filteredNotes.length;

  useEffect(() => {
    setVisibleNotesCount(INITIAL_VISIBLE_NOTES);
  }, [filter, activeTag, debouncedSearchQuery, showArchived, isAiSearch, viewMode]);

  useEffect(() => {
    if (isVirtualized) return;
    setVisibleNotesCount(prev => Math.min(prev, Math.max(filteredNotes.length, INITIAL_VISIBLE_NOTES)));
  }, [filteredNotes.length, isVirtualized]);

  useEffect(() => {
    if (!isVirtualized) {
      setVirtualRange({ start: 0, end: 0 });
      return;
    }

    const updateRange = () => {
      const listElement = notesListRef.current;
      if (!listElement) return;

      const listTop = listElement.getBoundingClientRect().top + window.scrollY;
      const viewportTop = window.scrollY;
      const relativeTop = Math.max(0, viewportTop - listTop);

      const start = Math.max(0, Math.floor(relativeTop / VIRTUAL_ROW_HEIGHT) - VIRTUAL_OVERSCAN);
      const visibleRows = Math.ceil(window.innerHeight / VIRTUAL_ROW_HEIGHT) + VIRTUAL_OVERSCAN * 2;
      const end = Math.min(filteredNotes.length, start + visibleRows);

      setVirtualRange(prev => (prev.start === start && prev.end === end ? prev : { start, end }));
    };

    const scheduleUpdateRange = () => {
      if (virtualRangeRafRef.current !== null) return;
      virtualRangeRafRef.current = window.requestAnimationFrame(() => {
        virtualRangeRafRef.current = null;
        updateRange();
      });
    };

    updateRange();
    window.addEventListener('scroll', scheduleUpdateRange, { passive: true });
    window.addEventListener('resize', scheduleUpdateRange);

    return () => {
      if (virtualRangeRafRef.current !== null) {
        window.cancelAnimationFrame(virtualRangeRafRef.current);
        virtualRangeRafRef.current = null;
      }
      window.removeEventListener('scroll', scheduleUpdateRange);
      window.removeEventListener('resize', scheduleUpdateRange);
    };
  }, [isVirtualized, filteredNotes.length]);

  useEffect(() => {
    if (isVirtualized) return;
    if (viewMode !== 'all') return;
    if (!hasMoreVisibleNotes) return;
    const sentinel = loadMoreRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      entries => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        setVisibleNotesCount(prev => Math.min(prev + VISIBLE_NOTES_STEP, filteredNotes.length));
      },
      { root: null, rootMargin: '800px 0px', threshold: 0.01 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMoreVisibleNotes, filteredNotes.length, viewMode, isVirtualized]);

  const handleOpenDrawer = useCallback(() => setIsDrawerOpen(true), []);
  const handleCloseDrawer = useCallback(() => setIsDrawerOpen(false), []);
  const handleShowArchived = useCallback(() => {
    setShowArchived(true);
    setIsDrawerOpen(false);
  }, []);
  const handleExitArchived = useCallback(() => setShowArchived(false), []);

  const handleSearchInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    if (!e.target.value) setAiAnswer(null);
  }, []);

  const handleToggleAiSearch = useCallback(() => {
    setIsAiSearch(prev => !prev);
  }, []);

  const handleTodayToggle = useCallback(() => {
    if (viewMode === 'today') {
      setViewMode('all');
      return;
    }
    handleEnterTodayView();
  }, [viewMode, handleEnterTodayView]);

  const handleClearFilters = useCallback(() => {
    setFilter('ALL');
    setSearchQuery('');
    setActiveTag(null);
  }, []);

  const handleConnectAI = useCallback(
    async (provider: AIProvider, apiKey: string) => {
      const status = await connectAIProvider(provider, apiKey);
      setAiAuth(status);
      setAiErrorMessage(null);
      setAiDegradedMessage(null);
      pendingAnalysisRef.current.push(...deferredAnalysisRef.current.splice(0, deferredAnalysisRef.current.length));
      runAnalysisQueue();
    },
    [runAnalysisQueue]
  );

  const handleDisconnectAI = useCallback(async () => {
    const status = await disconnectAIProvider();
    setAiAuth(status);
    setAiDegradedMessage('Capture-only mode — AI key disconnected.');
  }, []);

  const sharedNotePreview = useMemo(() => {
    if (!sharedNotePayload) return '';
    if (sharedNotePayload.title) return sharedNotePayload.title;
    if (sharedNotePayload.content.length <= 80) return sharedNotePayload.content;
    return `${sharedNotePayload.content.slice(0, 77)}...`;
  }, [sharedNotePayload]);

  return (
    <ThemeProvider>
      <div className="mission-shell min-h-screen relative overflow-hidden transition-colors duration-300">
        <ToastContainer toasts={toasts} removeToast={removeToast} />

        <Drawer
          isOpen={isDrawerOpen}
          onClose={handleCloseDrawer}
          notes={notes}
          onExport={handleExportData}
          onClearData={handleClearData}
          onTagClick={handleTagClick}
          onShowArchived={handleShowArchived}
          showArchived={showArchived}
          onExitArchived={handleExitArchived}
          onImportNotes={handleImportNotes}
          addToast={addToast}
          aiAuth={aiAuth}
          aiErrorMessage={aiErrorMessage}
          onConnectAI={handleConnectAI}
          onDisconnectAI={handleDisconnectAI}
          onBackupRecorded={recordBackupCompletion}
        />

        {isProcessingBatch && (
          <div className="fixed inset-0 z-[70] bg-zinc-950/35 backdrop-blur-sm flex flex-col items-center justify-center animate-fade-in">
            <div className="mission-modal-panel p-6 rounded-2xl shadow-xl border flex flex-col items-center">
              <BrainCircuit className="w-10 h-10 text-brand-600 animate-pulse mb-4" />
              <h3 className="font-display text-2xl leading-none text-zinc-800 dark:text-zinc-100">Organizing thoughts...</h3>
              <p className="text-sm mission-muted mt-2">Splitting your batch entry into atomic notes.</p>
            </div>
          </div>
        )}

        <header className="mission-header sticky top-0 z-40 backdrop-blur-xl border-b pt-safe transition-colors duration-200">
          <div className="mission-signal-sweep" />
          <div className="max-w-3xl mx-auto px-4 py-3 relative">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <div className="bg-brand-600 text-zinc-950 p-2 rounded-md shadow-lg shadow-brand-600/30 border border-brand-300/40">
                  <Zap className="w-4 h-4 fill-current" />
                </div>
                <div>
                  <h1 className="font-display text-3xl leading-none text-zinc-800 dark:text-zinc-100">PocketBrain</h1>
                  <p className="text-[10px] uppercase tracking-[0.2em] mission-muted">Personal Mission Console</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={handleTodayToggle}
                  className={`relative px-3 py-2 rounded-md transition-colors flex items-center gap-1.5 border ${
                    viewMode === 'today'
                      ? 'bg-brand-100/60 dark:bg-brand-900/40 border-brand-300/60 text-brand-700 dark:text-brand-300'
                      : 'mission-tag-chip mission-muted hover:text-zinc-700 dark:hover:text-zinc-100'
                  }`}
                  title="Today view"
                >
                  <Calendar className="w-4 h-4" />
                  <span className="text-xs font-semibold hidden sm:inline">Today</span>
                  {hasOverdueTasks && viewMode !== 'today' && (
                    <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-rose-500 rounded-full border-2 border-white dark:border-zinc-900" />
                  )}
                </button>
                <button
                  onClick={handleOpenDrawer}
                  className="p-2 -mr-2 mission-muted hover:text-zinc-700 dark:hover:text-zinc-100 mission-tag-chip rounded-md transition-colors"
                >
                  <Menu className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="relative group">
              <div className={`absolute inset-0 rounded-lg transition-all duration-300 ${isAiSearch ? 'bg-brand-500/10 blur-md' : 'bg-transparent'}`} />
              <form onSubmit={handleSearch} className="relative flex items-center">
                <Search className={`absolute left-3.5 w-4 h-4 ${isAiSearch ? 'text-brand-600' : 'text-zinc-400'}`} />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={handleSearchInputChange}
                  placeholder={isAiSearch ? 'Ask your second brain...' : 'Search your thoughts...'}
                  className={`w-full pl-10 pr-20 py-3 rounded-lg text-sm font-medium transition-all outline-none border shadow-sm ${
                    isAiSearch
                      ? 'mission-note border-brand-300/50 text-brand-900 dark:text-brand-100 placeholder-brand-400 dark:placeholder-brand-500 focus:ring-2 focus:ring-brand-500/20'
                      : 'mission-note border-zinc-300/40 dark:border-zinc-700/70 text-zinc-800 dark:text-zinc-100 placeholder-zinc-500 focus:border-brand-300/50 focus:shadow-md'
                  }`}
                />
                <button
                  type="button"
                  onClick={handleToggleAiSearch}
                  className={`absolute right-2 top-1.5 bottom-1.5 px-3 rounded-md text-[10px] font-semibold tracking-[0.16em] uppercase transition-all flex items-center gap-1.5 ${
                    isAiSearch
                      ? 'bg-brand-100 dark:bg-brand-900/50 text-brand-700 dark:text-brand-300 hover:bg-brand-200 dark:hover:bg-brand-900/70'
                      : 'mission-tag-chip mission-muted hover:text-zinc-700 dark:hover:text-zinc-200'
                  }`}
                >
                  <Sparkles className={`w-3 h-3 ${isAiSearch ? 'fill-brand-700' : ''}`} />
                  AI
                </button>
              </form>
            </div>

            {!isAiSearch && !aiAnswer && (
              <div className="flex gap-2 mt-4 overflow-x-auto no-scrollbar pb-1">
                {(['ALL', NoteType.NOTE, NoteType.TASK, NoteType.IDEA] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setFilter(t)}
                    className={`px-4 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-all border ${
                      filter === t
                        ? 'bg-brand-500 text-zinc-950 border-brand-300 shadow-md shadow-brand-500/20'
                        : 'mission-tag-chip mission-muted hover:text-zinc-700 dark:hover:text-zinc-200'
                    }`}
                  >
                    {t === 'ALL' ? 'All' : t.charAt(0) + t.slice(1).toLowerCase() + 's'}
                  </button>
                ))}
              </div>
            )}

            {activeTag && (
              <div className="flex items-center gap-2 mt-3">
                <span className="mission-tag-chip inline-flex items-center gap-1.5 text-cyan-700 dark:text-cyan-400 rounded-md px-3 py-1 text-xs font-medium">
                  #{activeTag}
                  <button onClick={() => setActiveTag(null)} className="ml-0.5 hover:text-cyan-900 transition-colors">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              </div>
            )}
          </div>
        </header>

        {isOffline && (
          <div className="bg-amber-50/80 dark:bg-amber-900/25 border-b border-amber-200/80 dark:border-amber-800/50 transition-colors">
            <div className="max-w-3xl mx-auto px-4 py-2 flex items-center gap-2 text-amber-700 dark:text-amber-300 text-xs font-medium uppercase tracking-wide">
              <WifiOff className="w-3.5 h-3.5" />
              Offline — notes saved locally
            </div>
          </div>
        )}

        {aiDegradedMessage && (
          <div className="bg-rose-50/80 dark:bg-rose-900/25 border-b border-rose-200/80 dark:border-rose-800/60 transition-colors">
            <div className="max-w-3xl mx-auto px-4 py-2 text-xs font-medium text-rose-700 dark:text-rose-300 uppercase tracking-wide">
              {aiDegradedMessage}
            </div>
          </div>
        )}

        {sharedNotePayload && (
          <div className="bg-emerald-50/80 dark:bg-emerald-900/25 border-b border-emerald-200/80 dark:border-emerald-800/40 transition-colors">
            <div className="max-w-3xl mx-auto px-4 py-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">Shared note received</p>
                <p className="text-xs text-emerald-700/80 dark:text-emerald-300/80 truncate">{sharedNotePreview}</p>
              </div>
              <div className="shrink-0 flex items-center gap-2">
                <button
                  onClick={handleImportSharedNote}
                  className="px-3 py-1 text-[11px] font-semibold rounded-full bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                >
                  Import
                </button>
                <button
                  onClick={() => setSharedNotePayload(null)}
                  className="px-2 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300 hover:underline"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        <main className="max-w-3xl mx-auto px-4 py-6 pb-40 space-y-6">
          <ErrorBoundary>
            {viewMode === 'today' ? (
              <TodayView
                notes={notes}
                onUpdate={handleUpdateNote}
                onDelete={handleDeleteNote}
                onCopy={handleCopyNote}
                onToggleComplete={handleToggleComplete}
                onReanalyze={handleReanalyze}
                onPin={handlePinNote}
                onArchive={handleArchiveNote}
                onSetDueDate={handleSetDueDate}
                onSetPriority={handleSetPriority}
                onTagClick={handleTagClick}
                aiBrief={aiBrief}
                isLoadingBrief={isLoadingBrief}
                onShareBrief={handleShareTodayBrief}
              />
            ) : (
              <>
                {showArchived && (
                  <div className="mission-note flex items-center justify-between rounded-xl px-4 py-3 animate-fade-in border">
                    <div className="flex items-center gap-2 mission-muted text-sm font-medium">
                      <Archive className="w-4 h-4" />
                      Viewing archived notes
                    </div>
                    <button onClick={handleExitArchived} className="text-xs font-medium text-brand-600 hover:underline uppercase tracking-wide">
                      Back to notes
                    </button>
                  </div>
                )}

                {isAiSearch && (isAiThinking || aiAnswer) && (
                  <div className="mission-note rounded-2xl p-6 shadow-lg shadow-brand-500/5 border animate-fade-in transition-colors duration-200">
                    <div className="font-display flex items-center gap-2 mb-3 text-brand-600 text-sm tracking-wider">
                      <Sparkles className="w-4 h-4" />
                      Insight
                    </div>
                    {isAiThinking ? (
                      <div className="space-y-2">
                        <div className="h-4 bg-brand-50 dark:bg-brand-900/30 rounded w-3/4 animate-pulse"></div>
                        <div className="h-4 bg-brand-50 dark:bg-brand-900/30 rounded w-1/2 animate-pulse delay-75"></div>
                      </div>
                    ) : (
                      <p className="text-zinc-700 dark:text-zinc-300 text-sm leading-relaxed">{aiAnswer}</p>
                    )}
                  </div>
                )}

                {notes.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 mission-muted animate-fade-in">
                    <div className="mission-note p-6 rounded-3xl border mb-6">
                      <Sparkles className="w-12 h-12 text-brand-200 dark:text-brand-400" />
                    </div>
                    <h3 className="font-display text-3xl leading-none text-zinc-700 dark:text-zinc-200 mb-2">Your mind is clear</h3>
                    <p className="text-sm mission-muted text-center max-w-xs leading-relaxed">
                      Capture ideas, tasks, and notes instantly.
                      <br />
                      Use <span className="text-cyan-500 font-semibold">Magic Batch</span> to split brain dumps.
                    </p>
                  </div>
                ) : (
                  <div ref={notesListRef} className="space-y-4">
                    {isVirtualized && virtualTopSpacing > 0 && (
                      <div style={{ height: `${virtualTopSpacing}px` }} aria-hidden="true" />
                    )}

                    {visibleNotes.map(note => (
                      <NoteCard
                        key={note.id}
                        note={note}
                        onUpdate={handleUpdateNote}
                        onDelete={handleDeleteNote}
                        onCopy={handleCopyNote}
                        onToggleComplete={handleToggleComplete}
                        onReanalyze={handleReanalyze}
                        onTagClick={handleTagClick}
                        onPin={handlePinNote}
                        onArchive={handleArchiveNote}
                        onSetDueDate={handleSetDueDate}
                        onSetPriority={handleSetPriority}
                      />
                    ))}

                    {isVirtualized && virtualBottomSpacing > 0 && (
                      <div style={{ height: `${virtualBottomSpacing}px` }} aria-hidden="true" />
                    )}

                    {hasMoreVisibleNotes && (
                      <div ref={loadMoreRef} className="py-3 text-center">
                        <span className="text-[11px] font-medium mission-muted uppercase tracking-wide">Loading more notes...</span>
                      </div>
                    )}

                    {filteredNotes.length === 0 && (
                      <div className="text-center py-12">
                        <p className="mission-muted text-sm">No notes found matching your criteria.</p>
                        <button onClick={handleClearFilters} className="mt-2 text-brand-600 text-xs font-medium hover:underline uppercase tracking-wide">
                          Clear filters
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </ErrorBoundary>
        </main>

        <ErrorBoundary>
          <InputArea
            ref={inputAreaRef}
            onSave={handleAddNote}
            onBatchSave={handleBatchNote}
            onCleanupDraft={handleCleanupDraft}
            onTranscribe={isProxyEnabled() && aiAuth.connected && aiAuth.provider === 'gemini' ? handleTranscribeAudio : undefined}
          />
        </ErrorBoundary>

        {import.meta.env.DEV && <DiagnosticsPanel />}
      </div>
    </ThemeProvider>
  );
}

export default App;
