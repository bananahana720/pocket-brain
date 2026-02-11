import React, { useState, useEffect, useRef } from 'react';
import { Search, Sparkles, Menu, Zap, BrainCircuit, X, Archive, Calendar, WifiOff } from 'lucide-react';
import { Note, NoteType, UndoAction } from './types';
import { analyzeNote, askMyNotes, processBatchEntry, generateDailyBrief } from './services/geminiService';
import NoteCard from './components/NoteCard';
import InputArea, { InputAreaHandle } from './components/InputArea';
import TodayView from './components/TodayView';
import Drawer from './components/Drawer';
import ErrorBoundary from './components/ErrorBoundary';
import { ToastContainer, ToastMessage, ToastAction } from './components/Toast';
import { ThemeProvider } from './contexts/ThemeContext';
import { trackEvent } from './utils/analytics';

const STORAGE_KEY = 'pocketbrain_notes';

function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
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

  const searchInputRef = useRef<HTMLInputElement>(null);
  const inputAreaRef = useRef<InputAreaHandle>(null);
  const handleUndoRef = useRef<() => void>(() => {});

  const hasLoadedRef = useRef(false);

  // --- Load/Save Logic ---
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setNotes(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse notes', e);
      }
    }
    const id = requestAnimationFrame(() => {
      hasLoadedRef.current = true;
    });
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (!hasLoadedRef.current) return;
    const serialized = JSON.stringify(notes);
    if (serialized === localStorage.getItem(STORAGE_KEY)) return;
    try {
      localStorage.setItem(STORAGE_KEY, serialized);
    } catch (e) {
      console.error('Failed to save notes', e);
      addToast('Storage full — some changes may not be saved', 'error');
    }
  }, [notes]);

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
    if (params.get('via') !== 'daily_brief_share') return;

    trackEvent('daily_brief_share_opened');
    addToast('Opened from a shared PocketBrain brief', 'info');

    params.delete('via');
    const query = params.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
    window.history.replaceState({}, '', nextUrl);
  }, []);

  // --- Toast System ---
  const addToast = (message: string, type: 'success' | 'error' | 'info' = 'success', action?: ToastAction) => {
    const id = Date.now().toString() + Math.random();
    setToasts(prev => [...prev, { id, message, type, action }]);
    setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, action ? 5000 : 3000);
  };

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

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
        if (isAiSearch) setIsAiSearch(false);
        if (isDrawerOpen) setIsDrawerOpen(false);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isAiSearch, isDrawerOpen]);

  // --- Undo System ---
  const pushUndo = (action: UndoAction) => {
    setUndoStack(prev => [...prev.slice(-9), action]);
  };

  const handleUndo = () => {
    setUndoStack(prev => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.type === 'DELETE') {
        setNotes(n => [last.noteSnapshot, ...n]);
      } else if (last.type === 'TOGGLE_COMPLETE' || last.type === 'ARCHIVE') {
        setNotes(n => n.map(note => note.id === last.noteSnapshot.id ? last.noteSnapshot : note));
      }
      addToast('Action undone', 'success');
      return prev.slice(0, -1);
    });
  };
  handleUndoRef.current = handleUndo;

  // --- Tag Filtering ---
  const handleTagClick = (tag: string) => {
    setActiveTag(prev => prev === tag ? null : tag);
  };

  // --- Note Actions ---
  const handleAddNote = async (content: string, presetType?: NoteType) => {
    const newNote: Note = {
      id: Date.now().toString(),
      content,
      createdAt: Date.now(),
      isProcessed: !!presetType,
      ...(presetType ? { type: presetType, title: content.slice(0, 50) } : {}),
    };

    setNotes((prev) => [newNote, ...prev]);
    addToast('Note captured', 'success');

    // Background Processing (skip if type was preset)
    if (!presetType) {
      processNoteAnalysis(newNote.id, content);
    }
  };

  // Handle "Magic Split" Batch Entry
  const handleBatchNote = async (content: string) => {
    setIsProcessingBatch(true);
    addToast('AI processing batch...', 'info');
    
    const results = await processBatchEntry(content);
    
    if (results.length === 0) {
        addToast('Failed to split notes. Saving as single note.', 'error');
        handleAddNote(content);
        setIsProcessingBatch(false);
        return;
    }

    const newNotes: Note[] = results.map(r => ({
        id: Date.now().toString() + Math.random().toString().slice(2,6),
        content: r.content as string || content, // Fallback
        createdAt: Date.now(),
        isProcessed: true,
        title: r.title,
        tags: r.tags,
        type: r.type
    }));

    setNotes((prev) => [...newNotes, ...prev]);
    addToast(`Created ${newNotes.length} notes from batch`, 'success');
    setIsProcessingBatch(false);
  };

  const processNoteAnalysis = async (noteId: string, content: string) => {
     const analysis = await analyzeNote(content);
    
    setNotes((prev) => prev.map(n => {
      if (n.id === noteId) {
        return {
          ...n,
          title: analysis?.title || 'Quick Note',
          tags: analysis?.tags || [],
          type: analysis?.type || NoteType.NOTE,
          isProcessed: true,
          ...(analysis?.dueDate ? { dueDate: new Date(analysis.dueDate).getTime() } : {}),
          ...(analysis?.priority ? { priority: analysis.priority } : {}),
        };
      }
      return n;
    }));
  };

  const handleUpdateNote = (id: string, newContent: string) => {
    setNotes((prev) => prev.map(n => {
      if (n.id === id) {
        return { ...n, content: newContent };
      }
      return n;
    }));
    addToast('Note updated', 'success');
  };

  const handleDeleteNote = (id: string) => {
    const note = notes.find(n => n.id === id);
    if (note) {
      pushUndo({ type: 'DELETE', noteSnapshot: { ...note }, timestamp: Date.now() });
    }
    setNotes((prev) => prev.filter(n => n.id !== id));
    // Dismiss any existing undo toasts before showing new one (LIFO undo)
    setToasts(prev => prev.filter(t => !t.action));
    addToast('Note deleted', 'info', { label: 'Undo', onClick: handleUndo });
  };

  const handleCopyNote = (content: string) => {
    navigator.clipboard.writeText(content);
    addToast('Copied to clipboard', 'success');
  };

  const handleToggleComplete = (id: string) => {
    const note = notes.find(n => n.id === id);
    if (note) {
      pushUndo({ type: 'TOGGLE_COMPLETE', noteSnapshot: { ...note }, timestamp: Date.now() });
    }
    setNotes((prev) => prev.map(n => {
        if (n.id === id) {
            return { ...n, isCompleted: !n.isCompleted };
        }
        return n;
    }));
  };

  const handleReanalyze = (id: string) => {
    const note = notes.find(n => n.id === id);
    if(note) {
        setNotes(prev => prev.map(n => n.id === id ? { ...n, isProcessed: false } : n));
        addToast('Re-analyzing...', 'info');
        processNoteAnalysis(id, note.content);
    }
  };

  // --- Pin & Archive ---
  const handlePinNote = (id: string) => {
    setNotes((prev) => prev.map(n => n.id === id ? { ...n, isPinned: !n.isPinned } : n));
  };

  const handleArchiveNote = (id: string) => {
    const note = notes.find(n => n.id === id);
    if (note) {
      pushUndo({ type: 'ARCHIVE', noteSnapshot: { ...note }, timestamp: Date.now() });
    }
    setNotes((prev) => prev.map(n => n.id === id ? { ...n, isArchived: !n.isArchived } : n));
    setToasts(prev => prev.filter(t => !t.action));
    addToast(note?.isArchived ? 'Note unarchived' : 'Note archived', 'info', { label: 'Undo', onClick: handleUndo });
  };

  // --- Due Dates & Priority ---
  const handleSetDueDate = (id: string, date: number | undefined) => {
    setNotes((prev) => prev.map(n => n.id === id ? { ...n, dueDate: date } : n));
  };

  const handleSetPriority = (id: string, priority: 'urgent' | 'normal' | 'low' | undefined) => {
    setNotes((prev) => prev.map(n => n.id === id ? { ...n, priority } : n));
  };

  // --- Today View ---
  const handleEnterTodayView = async () => {
    setViewMode('today');
    setIsLoadingBrief(true);
    setAiBrief(null);
    const brief = await generateDailyBrief(notes);
    setAiBrief(brief);
    setIsLoadingBrief(false);
  };

  const hasOverdueTasks = notes.some(n => {
    if (n.isArchived || n.isCompleted || !n.dueDate) return false;
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return n.dueDate < startOfToday;
  });

  const handleShareTodayBrief = async (
    brief: string,
    stats: { overdue: number; dueToday: number; capturedToday: number }
  ) => {
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
  };

  const handleExportData = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(notes, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "pocketbrain_backup.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
    addToast('Data exported', 'success');
  };

  const handleClearData = () => {
    setNotes([]);
    localStorage.removeItem(STORAGE_KEY);
    addToast('All data cleared', 'info');
  };

  // --- Import ---
  const handleImportNotes = (newNotes: Note[]) => {
    setNotes(prev => {
      const existingIds = new Set(prev.map(n => n.id));
      const unique = newNotes.filter(n => !existingIds.has(n.id));
      return [...prev, ...unique];
    });
  };

  // --- Search Logic ---
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    if (isAiSearch) {
      setIsAiThinking(true);
      setAiAnswer(null);
      const answer = await askMyNotes(searchQuery, notes);
      setAiAnswer(answer);
      setIsAiThinking(false);
    }
  };

  const filteredNotes = notes.filter(note => {
    // Archive filter: hide archived unless viewing archived
    if (!showArchived && note.isArchived) return false;
    if (showArchived && !note.isArchived) return false;
    if (filter !== 'ALL' && note.type !== filter) return false;
    if (activeTag && !note.tags?.some(t => t.toLowerCase() === activeTag.toLowerCase())) return false;
    if (!isAiSearch && searchQuery) {
      const lowerQ = searchQuery.toLowerCase();
      return (
        note.content.toLowerCase().includes(lowerQ) ||
        note.title?.toLowerCase().includes(lowerQ) ||
        note.tags?.some(t => t.toLowerCase().includes(lowerQ))
      );
    }
    return true;
  }).sort((a, b) => {
    // Pinned notes first
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    // For TASK filter: sort by due date (overdue first, then upcoming)
    if (filter === NoteType.TASK) {
      const now = Date.now();
      const aDue = a.dueDate ?? Infinity;
      const bDue = b.dueDate ?? Infinity;
      if (aDue !== bDue) return aDue - bDue;
    }
    return 0;
  });

  return (
    <ThemeProvider>
    <div className="min-h-screen bg-subtle dark:bg-zinc-900 relative overflow-hidden transition-colors duration-200">

      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <Drawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        notes={notes}
        onExport={handleExportData}
        onClearData={handleClearData}
        onTagClick={handleTagClick}
        onShowArchived={() => { setShowArchived(true); setIsDrawerOpen(false); }}
        showArchived={showArchived}
        onExitArchived={() => setShowArchived(false)}
        onImportNotes={handleImportNotes}
        addToast={addToast}
      />

      {/* Processing Overlay */}
      {isProcessingBatch && (
        <div className="fixed inset-0 z-[70] bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm flex flex-col items-center justify-center animate-fade-in">
            <div className="bg-white dark:bg-zinc-800 p-6 rounded-2xl shadow-xl border border-violet-100 dark:border-zinc-700 flex flex-col items-center">
                <BrainCircuit className="w-10 h-10 text-brand-600 animate-pulse mb-4" />
                <h3 className="text-lg font-bold text-zinc-800 dark:text-zinc-100">Organizing thoughts...</h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-2">Splitting your batch entry into atomic notes.</p>
            </div>
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl border-b border-zinc-200/50 dark:border-zinc-700/50 pt-safe transition-colors duration-200">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="bg-brand-600 text-white p-2 rounded-xl shadow-lg shadow-brand-600/20">
                <Zap className="w-4 h-4 fill-current" />
              </div>
              <h1 className="text-lg font-bold text-zinc-800 dark:text-zinc-100 tracking-tight">PocketBrain</h1>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  if (viewMode === 'today') {
                    setViewMode('all');
                  } else {
                    handleEnterTodayView();
                  }
                }}
                className={`relative p-2 rounded-full transition-colors flex items-center gap-1.5 ${
                  viewMode === 'today'
                    ? 'bg-brand-100 dark:bg-brand-900/50 text-brand-700 dark:text-brand-300'
                    : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
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
                  onClick={() => setIsDrawerOpen(true)}
                  className="p-2 -mr-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors"
              >
                <Menu className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="relative group">
             <div className={`absolute inset-0 rounded-xl transition-all duration-300 ${isAiSearch ? 'bg-brand-500/10 blur-md' : 'bg-transparent'}`} />
             <form onSubmit={handleSearch} className="relative flex items-center">
                <Search className={`absolute left-3.5 w-4 h-4 ${isAiSearch ? 'text-brand-600' : 'text-zinc-400'}`} />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    if(!e.target.value) setAiAnswer(null);
                  }}
                  placeholder={isAiSearch ? "Ask your second brain..." : "Search your thoughts..."}
                  className={`w-full pl-10 pr-20 py-3 rounded-xl text-sm font-medium transition-all outline-none border shadow-sm ${
                    isAiSearch
                      ? 'bg-white dark:bg-zinc-800 border-brand-200 dark:border-brand-700 text-brand-900 dark:text-brand-100 placeholder-brand-300 dark:placeholder-brand-500 focus:ring-2 focus:ring-brand-500/20'
                      : 'bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-100 placeholder-zinc-400 focus:bg-white dark:focus:bg-zinc-800 focus:border-zinc-300 dark:focus:border-zinc-600 focus:shadow-md'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setIsAiSearch(!isAiSearch)}
                  className={`absolute right-2 top-1.5 bottom-1.5 px-3 rounded-lg text-[10px] font-bold tracking-wide uppercase transition-all flex items-center gap-1.5 ${
                    isAiSearch
                      ? 'bg-brand-100 dark:bg-brand-900/50 text-brand-700 dark:text-brand-300 hover:bg-brand-200 dark:hover:bg-brand-900/70'
                      : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-600'
                  }`}
                >
                  <Sparkles className={`w-3 h-3 ${isAiSearch ? 'fill-brand-700' : ''}`} />
                  AI
                </button>
             </form>
          </div>

          {!isAiSearch && !aiAnswer && (
            <div className="flex gap-2 mt-4 overflow-x-auto no-scrollbar pb-1">
              {(['ALL', NoteType.NOTE, NoteType.TASK, NoteType.IDEA] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setFilter(t)}
                  className={`px-4 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all border ${
                    filter === t
                      ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 border-zinc-900 dark:border-zinc-100 shadow-md'
                      : 'bg-white dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-700'
                  }`}
                >
                  {t === 'ALL' ? 'All' : t.charAt(0) + t.slice(1).toLowerCase() + 's'}
                </button>
              ))}
            </div>
          )}

          {activeTag && (
            <div className="flex items-center gap-2 mt-3">
              <span className="inline-flex items-center gap-1.5 bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-400 rounded-full px-3 py-1 text-xs font-medium">
                #{activeTag}
                <button
                  onClick={() => setActiveTag(null)}
                  className="ml-0.5 hover:text-violet-900 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            </div>
          )}
        </div>
      </header>

      {/* Offline Banner */}
      {isOffline && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800/50 transition-colors">
          <div className="max-w-2xl mx-auto px-4 py-2 flex items-center gap-2 text-amber-700 dark:text-amber-400 text-xs font-medium">
            <WifiOff className="w-3.5 h-3.5" />
            Offline — notes saved locally
          </div>
        </div>
      )}

      <main className="max-w-2xl mx-auto px-4 py-6 pb-40 space-y-6">
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
              <div className="flex items-center justify-between bg-zinc-100 dark:bg-zinc-800 rounded-xl px-4 py-3 animate-fade-in">
                <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300 text-sm font-medium">
                  <Archive className="w-4 h-4" />
                  Viewing archived notes
                </div>
                <button
                  onClick={() => setShowArchived(false)}
                  className="text-xs font-medium text-brand-600 hover:underline"
                >
                  Back to notes
                </button>
              </div>
            )}

            {isAiSearch && (isAiThinking || aiAnswer) && (
              <div className="bg-white dark:bg-zinc-800 rounded-2xl p-6 shadow-lg shadow-brand-500/5 border border-brand-100 dark:border-zinc-700 animate-fade-in transition-colors duration-200">
                <div className="flex items-center gap-2 mb-3 text-brand-600 font-bold text-xs uppercase tracking-wider">
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
              <div className="flex flex-col items-center justify-center py-20 text-zinc-400 animate-fade-in">
                <div className="bg-white dark:bg-zinc-800 p-6 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.2)] mb-6">
                  <Sparkles className="w-12 h-12 text-brand-200 dark:text-brand-400" />
                </div>
                <h3 className="text-lg font-semibold text-zinc-700 dark:text-zinc-200 mb-2">Your mind is clear</h3>
                <p className="text-sm text-zinc-400 text-center max-w-xs leading-relaxed">
                  Capture ideas, tasks, and notes instantly.
                  <br/>Use <span className="text-violet-500 font-bold">Magic Batch</span> to split brain dumps.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredNotes.map(note => (
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
                {filteredNotes.length === 0 && (
                  <div className="text-center py-12">
                     <p className="text-zinc-400 text-sm">No notes found matching your criteria.</p>
                     <button onClick={() => {setFilter('ALL'); setSearchQuery(''); setActiveTag(null);}} className="mt-2 text-brand-600 text-xs font-medium hover:underline">Clear filters</button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
        </ErrorBoundary>
      </main>

      <ErrorBoundary>
        <InputArea ref={inputAreaRef} onSave={handleAddNote} onBatchSave={handleBatchNote} />
      </ErrorBoundary>
    </div>
    </ThemeProvider>
  );
}

export default App;
