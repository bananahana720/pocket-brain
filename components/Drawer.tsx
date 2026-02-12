import React, { useMemo, useRef, useState } from 'react';
import {
  X,
  Download,
  Trash2,
  Tag,
  Sun,
  Moon,
  Archive,
  Flame,
  Upload,
  ChevronDown,
  FileJson,
  FileText as FileMarkdown,
  Table,
  Shield,
  KeyRound,
  Link2,
  Unplug,
} from 'lucide-react';
import { AIAuthState, AIProvider, Note, NoteType } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import { exportAsMarkdown, exportAsCSV, validateImport } from '../utils/exporters';
import { createEncryptedBackupPayload } from '../utils/encryptedExport';

interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  notes: Note[];
  onExport: () => void;
  onClearData: () => void;
  onTagClick?: (tag: string) => void;
  onShowArchived: () => void;
  showArchived: boolean;
  onExitArchived: () => void;
  onImportNotes?: (notes: Note[]) => void;
  addToast?: (message: string, type: 'success' | 'error' | 'info') => void;
  aiAuth: AIAuthState;
  aiErrorMessage?: string | null;
  onConnectAI: (provider: AIProvider, apiKey: string) => Promise<void>;
  onDisconnectAI: () => Promise<void>;
  onBackupRecorded: () => void;
}

const Drawer: React.FC<DrawerProps> = ({
  isOpen,
  onClose,
  notes,
  onExport,
  onClearData,
  onTagClick,
  onShowArchived,
  showArchived,
  onExitArchived,
  onImportNotes,
  addToast,
  aiAuth,
  aiErrorMessage,
  onConnectAI,
  onDisconnectAI,
  onBackupRecorded,
}) => {
  const { theme, toggle } = useTheme();
  const [showExportOptions, setShowExportOptions] = useState(false);
  const [isConnectingAI, setIsConnectingAI] = useState(false);
  const [isDisconnectingAI, setIsDisconnectingAI] = useState(false);
  const [provider, setProvider] = useState<AIProvider>('gemini');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    archivedCount,
    stats,
    streak,
    todayCaptured,
    completedTasks,
    totalTasks,
    completionRate,
    weekHeatmap,
    sortedTags,
    topTags,
  } = useMemo(() => {
    if (!isOpen) {
      return {
        archivedCount: 0,
        stats: { total: 0, notes: 0, tasks: 0, ideas: 0 },
        streak: 0,
        todayCaptured: 0,
        completedTasks: 0,
        totalTasks: 0,
        completionRate: 0,
        weekHeatmap: [] as { label: string; count: number }[],
        sortedTags: [] as [string, number][],
        topTags: [] as [string, number][],
      };
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const todayEnd = todayStart + 86400000;

    const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon...
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset);
    const mondayStart = monday.getTime();
    const nextMondayStart = mondayStart + (7 * 86400000);

    let archived = 0;
    let total = 0;
    let notesCount = 0;
    let tasks = 0;
    let ideas = 0;
    let capturedToday = 0;
    let completed = 0;
    let taskTotal = 0;

    const tagCounts: Record<string, number> = {};
    const daySet = new Set<string>();
    const weekCounts = [0, 0, 0, 0, 0, 0, 0];

    for (const note of notes) {
      const createdAt = note.createdAt;
      const created = new Date(createdAt);
      daySet.add(`${created.getFullYear()}-${created.getMonth()}-${created.getDate()}`);

      if (createdAt >= todayStart && createdAt < todayEnd) {
        capturedToday++;
      }

      if (createdAt >= mondayStart && createdAt < nextMondayStart) {
        const dayIndex = Math.floor((createdAt - mondayStart) / 86400000);
        if (dayIndex >= 0 && dayIndex < 7) weekCounts[dayIndex]++;
      }

      if (note.isArchived) {
        archived++;
      } else {
        total++;
        if (note.type === NoteType.NOTE) notesCount++;
        if (note.type === NoteType.TASK) tasks++;
        if (note.type === NoteType.IDEA) ideas++;
      }

      if (note.type === NoteType.TASK) {
        taskTotal++;
        if (note.isCompleted) completed++;
      }

      if (note.tags?.length) {
        for (const tag of note.tags) {
          tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        }
      }
    }

    let currentStreak = 0;
    const streakDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayKey = `${streakDay.getFullYear()}-${streakDay.getMonth()}-${streakDay.getDate()}`;
    if (!daySet.has(todayKey)) {
      streakDay.setDate(streakDay.getDate() - 1);
    }

    while (true) {
      const key = `${streakDay.getFullYear()}-${streakDay.getMonth()}-${streakDay.getDate()}`;
      if (!daySet.has(key)) break;
      currentStreak++;
      streakDay.setDate(streakDay.getDate() - 1);
    }

    const sorted = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]) as [string, number][];
    const labels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    const heatmap = labels.map((label, i) => ({ label, count: weekCounts[i] }));
    const rate = taskTotal > 0 ? Math.round((completed / taskTotal) * 100) : 0;

    return {
      archivedCount: archived,
      stats: { total, notes: notesCount, tasks, ideas },
      streak: currentStreak,
      todayCaptured: capturedToday,
      completedTasks: completed,
      totalTasks: taskTotal,
      completionRate: rate,
      weekHeatmap: heatmap,
      sortedTags: sorted,
      topTags: sorted.slice(0, 5),
    };
  }, [isOpen, notes]);

  if (!isOpen) return null;

  const getHeatmapColor = (count: number) => {
    if (count === 0) return 'bg-zinc-200 dark:bg-zinc-700';
    if (count <= 2) return 'bg-violet-200 dark:bg-violet-800';
    if (count <= 5) return 'bg-violet-400 dark:bg-violet-600';
    return 'bg-violet-600 dark:bg-violet-400';
  };

  // Export handlers
  const handleExportMarkdown = () => {
    const md = exportAsMarkdown(notes);
    downloadFile(md, 'pocketbrain_export.md', 'text/markdown');
    addToast?.('Exported as Markdown', 'success');
    onClose();
  };

  const handleExportCSV = () => {
    const csv = exportAsCSV(notes);
    downloadFile(csv, 'pocketbrain_export.csv', 'text/csv');
    addToast?.('Exported as CSV', 'success');
    onClose();
  };

  const downloadFile = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleConnectAI = async () => {
    const trimmed = apiKeyInput.trim();
    if (!trimmed) {
      addToast?.('Paste an API key first', 'error');
      return;
    }

    setIsConnectingAI(true);
    try {
      await onConnectAI(provider, trimmed);
      setApiKeyInput('');
      addToast?.('AI key connected securely', 'success');
    } catch {
      addToast?.('Unable to connect AI key', 'error');
    } finally {
      setIsConnectingAI(false);
    }
  };

  const handleDisconnectAI = async () => {
    setIsDisconnectingAI(true);
    try {
      await onDisconnectAI();
      addToast?.('AI key disconnected', 'info');
    } catch {
      addToast?.('Unable to disconnect AI key', 'error');
    } finally {
      setIsDisconnectingAI(false);
    }
  };

  const handleEncryptedExport = async () => {
    const passphrase = window.prompt('Set a passphrase for this encrypted backup:');
    if (!passphrase) return;
    if (passphrase.length < 8) {
      addToast?.('Use at least 8 characters for backup passphrase', 'error');
      return;
    }

    try {
      const payload = await createEncryptedBackupPayload(notes, passphrase);
      downloadFile(payload, 'pocketbrain_backup.encrypted.json', 'application/json');
      onBackupRecorded();
      addToast?.('Encrypted backup downloaded', 'success');
    } catch {
      addToast?.('Failed to create encrypted backup', 'error');
    }
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        const result = validateImport(data);
        if (result.valid && result.notes.length > 0) {
          onImportNotes?.(result.notes);
          addToast?.(`Imported ${result.notes.length} notes`, 'success');
          if (result.errors.length > 0) {
            addToast?.(`${result.errors.length} items skipped`, 'info');
          }
        } else {
          addToast?.('Invalid file: no valid notes found', 'error');
        }
      } catch {
        addToast?.('Invalid JSON file', 'error');
      }
      // Reset file input
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-start">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-zinc-900/20 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative w-[80%] max-w-xs bg-white dark:bg-zinc-900 h-full shadow-2xl border-r border-zinc-200 dark:border-zinc-700 p-6 flex flex-col animate-slide-right transition-colors duration-200 overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-zinc-800 dark:text-zinc-100 tracking-tight">Menu</h2>
            <button onClick={onClose} className="p-2 -mr-2 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                <X className="w-5 h-5" />
            </button>
        </div>

        {/* Theme Toggle */}
        <button
          onClick={toggle}
          className="flex items-center justify-between w-full px-4 py-3 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-100 dark:border-zinc-700 mb-6 transition-colors"
        >
          <div className="flex items-center gap-3">
            {theme === 'dark' ? <Moon className="w-4 h-4 text-brand-400" /> : <Sun className="w-4 h-4 text-amber-500" />}
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{theme === 'dark' ? 'Dark Mode' : 'Light Mode'}</span>
          </div>
          <div className={`w-10 h-6 rounded-full relative transition-colors ${theme === 'dark' ? 'bg-brand-600' : 'bg-zinc-300'}`}>
            <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${theme === 'dark' ? 'translate-x-5' : 'translate-x-1'}`} />
          </div>
        </button>

        {/* AI Security */}
        <div className="mb-6 rounded-xl border border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/80">
          <div className="mb-3 flex items-center gap-2">
            <Shield className="h-4 w-4 text-brand-500" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">AI Security</h3>
          </div>

          {aiAuth.connected ? (
            <div className="space-y-2">
              <p className="text-xs font-medium text-zinc-700 dark:text-zinc-200">
                Connected via {aiAuth.provider === 'openrouter' ? 'OpenRouter' : 'Gemini'}
              </p>
              {aiAuth.expiresAt && (
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Expires {new Date(aiAuth.expiresAt).toLocaleString()}
                </p>
              )}
              <button
                onClick={handleDisconnectAI}
                disabled={isDisconnectingAI}
                className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-700"
              >
                <Unplug className="h-3.5 w-3.5" />
                {isDisconnectingAI ? 'Disconnecting...' : 'Disconnect'}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex gap-2">
                {(['gemini', 'openrouter'] as AIProvider[]).map(p => (
                  <button
                    key={p}
                    onClick={() => setProvider(p)}
                    className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${
                      provider === p
                        ? 'bg-brand-600 text-white'
                        : 'bg-white text-zinc-600 hover:bg-zinc-100 dark:bg-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-600'
                    }`}
                  >
                    {p === 'openrouter' ? 'OpenRouter' : 'Gemini'}
                  </button>
                ))}
              </div>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-400" />
                <input
                  value={apiKeyInput}
                  onChange={e => setApiKeyInput(e.target.value)}
                  placeholder="Paste API key"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full rounded-lg border border-zinc-200 bg-white py-2 pl-8 pr-2 text-xs text-zinc-700 outline-none focus:border-brand-500 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </div>
              <button
                onClick={handleConnectAI}
                disabled={isConnectingAI}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
              >
                <Link2 className="h-3.5 w-3.5" />
                {isConnectingAI ? 'Connecting...' : 'Connect key securely'}
              </button>
              <p className="text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                Keys are sent once to the secure AI proxy and bound to an HttpOnly session.
              </p>
            </div>
          )}

          {aiErrorMessage && (
            <p className="mt-2 rounded-lg bg-rose-50 px-2 py-1 text-[10px] font-medium text-rose-600 dark:bg-rose-900/20 dark:text-rose-300">
              {aiErrorMessage}
            </p>
          )}
        </div>

        {/* Productivity Stats */}
        <div className="space-y-4 mb-6">
          <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Activity</h3>

          {/* Streak + Today row */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 bg-orange-50 dark:bg-orange-900/20 px-3 py-2 rounded-xl border border-orange-100 dark:border-orange-800/50">
              <Flame className="w-4 h-4 text-orange-500" />
              <span className="text-sm font-bold text-orange-700 dark:text-orange-400">{streak}</span>
              <span className="text-[10px] text-orange-500 dark:text-orange-400 font-medium">day streak</span>
            </div>
          </div>

          {/* Weekly Heatmap */}
          <div>
            <div className="grid grid-cols-7 gap-1.5">
              {weekHeatmap.map((day, i) => (
                <div key={i} className="flex flex-col items-center gap-1">
                  <div
                    className={`w-full aspect-square rounded-md ${getHeatmapColor(day.count)} transition-colors`}
                    title={`${day.count} notes`}
                  />
                  <span className="text-[9px] font-medium text-zinc-400 dark:text-zinc-500">{day.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Today stats */}
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            <span className="font-semibold text-zinc-700 dark:text-zinc-300">{todayCaptured}</span> captured today
            {totalTasks > 0 && (
              <> &middot; <span className="font-semibold text-zinc-700 dark:text-zinc-300">{completedTasks}</span> completed</>
            )}
          </p>

          {/* Completion rate */}
          {totalTasks > 0 && (
            <div>
              <div className="flex items-center justify-between text-[10px] font-medium text-zinc-500 dark:text-zinc-400 mb-1">
                <span>Task completion</span>
                <span>{completionRate}%</span>
              </div>
              <div className="w-full h-1.5 bg-zinc-100 dark:bg-zinc-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 dark:bg-emerald-400 rounded-full transition-all duration-500"
                  style={{ width: `${completionRate}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Overview stats (compact) */}
        <div className="mb-6">
            <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-3">Overview</h3>
            <div className="grid grid-cols-4 gap-2">
                <div className="bg-zinc-50 dark:bg-zinc-800 p-2 rounded-lg border border-zinc-100 dark:border-zinc-700 text-center">
                    <span className="text-lg font-bold text-zinc-800 dark:text-zinc-100 block">{stats.total}</span>
                    <span className="text-[9px] font-medium text-zinc-400 uppercase">Total</span>
                </div>
                <div className="bg-zinc-50 dark:bg-zinc-800 p-2 rounded-lg border border-zinc-100 dark:border-zinc-700 text-center">
                    <span className="text-lg font-bold text-zinc-800 dark:text-zinc-100 block">{stats.notes}</span>
                    <span className="text-[9px] font-medium text-zinc-400 uppercase">Notes</span>
                </div>
                <div className="bg-zinc-50 dark:bg-zinc-800 p-2 rounded-lg border border-zinc-100 dark:border-zinc-700 text-center">
                    <span className="text-lg font-bold text-emerald-700 dark:text-emerald-400 block">{stats.tasks}</span>
                    <span className="text-[9px] font-medium text-zinc-400 uppercase">Tasks</span>
                </div>
                <div className="bg-zinc-50 dark:bg-zinc-800 p-2 rounded-lg border border-zinc-100 dark:border-zinc-700 text-center">
                    <span className="text-lg font-bold text-amber-700 dark:text-amber-400 block">{stats.ideas}</span>
                    <span className="text-[9px] font-medium text-zinc-400 uppercase">Ideas</span>
                </div>
            </div>
        </div>

        <hr className="border-zinc-100 dark:border-zinc-700 mb-6" />

        {/* Top Tags */}
        {topTags.length > 0 && (
          <div className="mb-6">
            <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Tag className="w-3.5 h-3.5" /> Top Tags
            </h3>
            <div className="space-y-1.5">
              {topTags.map(([tag, count]) => (
                <button
                  key={tag}
                  onClick={() => { onTagClick?.(tag); onClose(); }}
                  className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg hover:bg-violet-50 dark:hover:bg-violet-900/20 text-sm transition-colors text-left"
                >
                  <span className="text-violet-700 dark:text-violet-400 font-medium">#{tag}</span>
                  <span className="text-[10px] font-bold text-zinc-400 bg-zinc-100 dark:bg-zinc-700 px-1.5 py-0.5 rounded-full">{count}</span>
                </button>
              ))}
            </div>
            {sortedTags.length > 5 && (
              <p className="text-[10px] text-zinc-400 mt-2 pl-3">+{sortedTags.length - 5} more tags</p>
            )}
          </div>
        )}

        {/* All Tags cloud (if more than top 5) */}
        {sortedTags.length > 5 && (
          <div className="mb-6">
            <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-3">All Tags</h3>
            <div className="flex flex-wrap gap-2">
              {sortedTags.map(([tag, count]) => (
                <button
                  key={tag}
                  onClick={() => { onTagClick?.(tag); onClose(); }}
                  className={`bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-900/50 rounded-full px-2.5 py-1 font-medium transition-colors ${
                    count >= 11 ? 'text-base' : count >= 4 ? 'text-sm' : 'text-xs'
                  }`}
                >
                  {tag} ({count})
                </button>
              ))}
            </div>
          </div>
        )}

        {/* If 5 or fewer tags, show them as the original cloud */}
        {sortedTags.length > 0 && sortedTags.length <= 5 && (
          <div className="mb-6">
            <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Tag className="w-3.5 h-3.5" /> All Tags
            </h3>
            <div className="flex flex-wrap gap-2">
              {sortedTags.map(([tag, count]) => (
                <button
                  key={tag}
                  onClick={() => { onTagClick?.(tag); onClose(); }}
                  className={`bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-900/50 rounded-full px-2.5 py-1 font-medium transition-colors ${
                    count >= 11 ? 'text-base' : count >= 4 ? 'text-sm' : 'text-xs'
                  }`}
                >
                  {tag} ({count})
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Archive */}
        <button
          onClick={onShowArchived}
          className="w-full flex items-center justify-between px-4 py-3 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-medium text-sm transition-colors text-left mb-6"
        >
          <div className="flex items-center gap-3">
            <Archive className="w-4 h-4" />
            Archived
          </div>
          {archivedCount > 0 && (
            <span className="bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 text-[10px] font-bold px-2 py-0.5 rounded-full">
              {archivedCount}
            </span>
          )}
        </button>

        {/* Data Actions */}
        <div className="space-y-2">
            <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-4">Data Management</h3>

            {/* Export dropdown */}
            <button
                onClick={() => setShowExportOptions(!showExportOptions)}
                className="w-full flex items-center justify-between px-4 py-3 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-medium text-sm transition-colors text-left"
            >
                <div className="flex items-center gap-3">
                  <Download className="w-4 h-4" />
                  Export
                </div>
                <ChevronDown className={`w-4 h-4 text-zinc-400 transition-transform ${showExportOptions ? 'rotate-180' : ''}`} />
            </button>

            {showExportOptions && (
              <div className="ml-4 space-y-1 animate-fade-in">
                <button
                  onClick={() => { onExport(); onClose(); }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-xs font-medium transition-colors text-left"
                >
                  <FileJson className="w-3.5 h-3.5" /> JSON
                </button>
                <button
                  onClick={handleEncryptedExport}
                  className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-xs font-medium transition-colors text-left"
                >
                  <Shield className="w-3.5 h-3.5" /> Encrypted Backup
                </button>
                <button
                  onClick={handleExportMarkdown}
                  className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-xs font-medium transition-colors text-left"
                >
                  <FileMarkdown className="w-3.5 h-3.5" /> Markdown
                </button>
                <button
                  onClick={handleExportCSV}
                  className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-xs font-medium transition-colors text-left"
                >
                  <Table className="w-3.5 h-3.5" /> CSV
                </button>
              </div>
            )}

            {/* Import */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleImport}
              className="hidden"
            />
            <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-medium text-sm transition-colors text-left"
            >
                <Upload className="w-4 h-4" />
                Import JSON
            </button>

            <button
                onClick={() => {
                    if(confirm('Are you sure you want to delete all notes? This cannot be undone.')) {
                        onClearData();
                        onClose();
                    }
                }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-900/20 text-rose-600 font-medium text-sm transition-colors text-left"
            >
                <Trash2 className="w-4 h-4" />
                Clear All Data
            </button>
        </div>

        <div className="mt-auto pt-6 text-center">
            <p className="text-[10px] text-zinc-400">PocketBrain v1.2.0</p>
        </div>
      </div>
    </div>
  );
};

export default React.memo(Drawer);
