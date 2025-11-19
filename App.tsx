import React, { useState, useEffect, useRef } from 'react';
import { Search, Sparkles, Menu, Zap, BrainCircuit } from 'lucide-react';
import { Note, NoteType } from './types';
import { analyzeNote, askMyNotes, processBatchEntry } from './services/geminiService';
import NoteCard from './components/NoteCard';
import InputArea, { InputAreaHandle } from './components/InputArea';
import Drawer from './components/Drawer';
import { ToastContainer, ToastMessage } from './components/Toast';

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

  const searchInputRef = useRef<HTMLInputElement>(null);
  const inputAreaRef = useRef<InputAreaHandle>(null);

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
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  }, [notes]);

  // --- Toast System ---
  const addToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    const id = Date.now().toString() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
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

  // --- Note Actions ---
  const handleAddNote = async (content: string) => {
    const newNote: Note = {
      id: Date.now().toString(),
      content,
      createdAt: Date.now(),
      isProcessed: false,
    };

    setNotes((prev) => [newNote, ...prev]);
    addToast('Note captured', 'success');

    // Background Processing
    processNoteAnalysis(newNote.id, content);
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
          isProcessed: true
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
    setNotes((prev) => prev.filter(n => n.id !== id));
    addToast('Note deleted', 'info');
  };

  const handleCopyNote = (content: string) => {
    navigator.clipboard.writeText(content);
    addToast('Copied to clipboard', 'success');
  };

  const handleToggleComplete = (id: string) => {
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
    if (filter !== 'ALL' && note.type !== filter) return false;
    if (!isAiSearch && searchQuery) {
      const lowerQ = searchQuery.toLowerCase();
      return (
        note.content.toLowerCase().includes(lowerQ) ||
        note.title?.toLowerCase().includes(lowerQ) ||
        note.tags?.some(t => t.toLowerCase().includes(lowerQ))
      );
    }
    return true;
  });

  return (
    <div className="min-h-screen bg-subtle relative overflow-hidden">
      
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <Drawer 
        isOpen={isDrawerOpen} 
        onClose={() => setIsDrawerOpen(false)}
        notes={notes}
        onExport={handleExportData}
        onClearData={handleClearData}
      />

      {/* Processing Overlay */}
      {isProcessingBatch && (
        <div className="fixed inset-0 z-[70] bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center animate-fade-in">
            <div className="bg-white p-6 rounded-2xl shadow-xl border border-violet-100 flex flex-col items-center">
                <BrainCircuit className="w-10 h-10 text-brand-600 animate-pulse mb-4" />
                <h3 className="text-lg font-bold text-zinc-800">Organizing thoughts...</h3>
                <p className="text-sm text-zinc-500 mt-2">Splitting your batch entry into atomic notes.</p>
            </div>
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-xl border-b border-zinc-200/50 pt-safe">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="bg-brand-600 text-white p-2 rounded-xl shadow-lg shadow-brand-600/20">
                <Zap className="w-4 h-4 fill-current" />
              </div>
              <h1 className="text-lg font-bold text-zinc-800 tracking-tight">PocketBrain</h1>
            </div>
            <button 
                onClick={() => setIsDrawerOpen(true)}
                className="p-2 -mr-2 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-full transition-colors"
            >
              <Menu className="w-5 h-5" />
            </button>
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
                      ? 'bg-white border-brand-200 text-brand-900 placeholder-brand-300 focus:ring-2 focus:ring-brand-500/20' 
                      : 'bg-zinc-50 border-zinc-200 text-zinc-800 placeholder-zinc-400 focus:bg-white focus:border-zinc-300 focus:shadow-md'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setIsAiSearch(!isAiSearch)}
                  className={`absolute right-2 top-1.5 bottom-1.5 px-3 rounded-lg text-[10px] font-bold tracking-wide uppercase transition-all flex items-center gap-1.5 ${
                    isAiSearch
                      ? 'bg-brand-100 text-brand-700 hover:bg-brand-200'
                      : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'
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
                      ? 'bg-zinc-900 text-white border-zinc-900 shadow-md'
                      : 'bg-white text-zinc-500 border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50'
                  }`}
                >
                  {t === 'ALL' ? 'All' : t.charAt(0) + t.slice(1).toLowerCase() + 's'}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 pb-40 space-y-6">
        {isAiSearch && (isAiThinking || aiAnswer) && (
          <div className="bg-white rounded-2xl p-6 shadow-lg shadow-brand-500/5 border border-brand-100 animate-fade-in">
            <div className="flex items-center gap-2 mb-3 text-brand-600 font-bold text-xs uppercase tracking-wider">
              <Sparkles className="w-4 h-4" />
              Insight
            </div>
            {isAiThinking ? (
               <div className="space-y-2">
                 <div className="h-4 bg-brand-50 rounded w-3/4 animate-pulse"></div>
                 <div className="h-4 bg-brand-50 rounded w-1/2 animate-pulse delay-75"></div>
               </div>
            ) : (
              <p className="text-zinc-700 text-sm leading-relaxed">{aiAnswer}</p>
            )}
          </div>
        )}

        {notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-zinc-400 animate-fade-in">
            <div className="bg-white p-6 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] mb-6">
              <Sparkles className="w-12 h-12 text-brand-200" />
            </div>
            <h3 className="text-lg font-semibold text-zinc-700 mb-2">Your mind is clear</h3>
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
              />
            ))}
            {filteredNotes.length === 0 && (
              <div className="text-center py-12">
                 <p className="text-zinc-400 text-sm">No notes found matching your criteria.</p>
                 <button onClick={() => {setFilter('ALL'); setSearchQuery('')}} className="mt-2 text-brand-600 text-xs font-medium hover:underline">Clear filters</button>
              </div>
            )}
          </div>
        )}
      </main>

      <InputArea ref={inputAreaRef} onSave={handleAddNote} onBatchSave={handleBatchNote} />
    </div>
  );
}

export default App;