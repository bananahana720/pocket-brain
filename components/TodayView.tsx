import React, { useMemo } from 'react';
import { Note } from '../types';
import { AlertTriangle, Clock, Plus, Share2, Sparkles } from 'lucide-react';
import NoteCard from './NoteCard';

interface TodayViewProps {
  notes: Note[];
  onUpdate: (id: string, content: string) => void;
  onDelete: (id: string) => void;
  onCopy: (content: string) => void;
  onToggleComplete: (id: string) => void;
  onReanalyze: (id: string) => void;
  onPin: (id: string) => void;
  onArchive: (id: string) => void;
  onSetDueDate: (id: string, date: number | undefined) => void;
  onSetPriority: (id: string, priority: 'urgent' | 'normal' | 'low' | undefined) => void;
  onTagClick: (tag: string) => void;
  relatedNotesByNoteId?: Map<string, Array<{ noteId: string; title: string; score: number; reasonLabel: string }>>;
  onOpenRelatedNote?: (noteId: string) => void;
  aiBrief: string | null;
  isLoadingBrief: boolean;
  onShareBrief: (brief: string, stats: { overdue: number; dueToday: number; capturedToday: number }) => void;
}

const TodayView: React.FC<TodayViewProps> = ({
  notes,
  onUpdate,
  onDelete,
  onCopy,
  onToggleComplete,
  onReanalyze,
  onPin,
  onArchive,
  onSetDueDate,
  onSetPriority,
  onTagClick,
  relatedNotesByNoteId,
  onOpenRelatedNote,
  aiBrief,
  isLoadingBrief,
  onShareBrief,
}) => {
  const { overdueNotes, dueTodayNotes, capturedTodayNotes } = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();

    const overdue: Note[] = [];
    const dueToday: Note[] = [];
    const capturedToday: Note[] = [];

    for (const note of notes) {
      if (note.isArchived) continue;

      if (note.createdAt >= startOfToday && note.createdAt < endOfToday) {
        capturedToday.push(note);
      }

      if (note.isCompleted || !note.dueDate) continue;
      if (note.dueDate < startOfToday) {
        overdue.push(note);
      } else if (note.dueDate < endOfToday) {
        dueToday.push(note);
      }
    }

    return {
      overdueNotes: overdue,
      dueTodayNotes: dueToday,
      capturedTodayNotes: capturedToday,
    };
  }, [notes]);

  const hasOverdue = overdueNotes.length > 0;
  const hasDueToday = dueTodayNotes.length > 0;
  const hasCapturedToday = capturedTodayNotes.length > 0;
  const hasBrief = aiBrief || isLoadingBrief;
  const allEmpty = !hasOverdue && !hasDueToday && !hasCapturedToday && !hasBrief;

  const renderNoteCards = (sectionNotes: Note[]) =>
    sectionNotes.map(note => (
      <NoteCard
        key={note.id}
        note={note}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onCopy={onCopy}
        onToggleComplete={onToggleComplete}
        onReanalyze={onReanalyze}
        onTagClick={onTagClick}
        onPin={onPin}
        onArchive={onArchive}
        onSetDueDate={onSetDueDate}
        onSetPriority={onSetPriority}
        relatedNotes={relatedNotesByNoteId?.get(note.id) || []}
        onOpenRelatedNote={onOpenRelatedNote}
      />
    ));

  if (allEmpty) {
    return (
      <div className="flex flex-col items-center justify-center py-20 mission-muted animate-fade-in">
        <div className="mission-note p-6 rounded-3xl border mb-6">
          <Sparkles className="w-12 h-12 text-emerald-300 dark:text-emerald-500" />
        </div>
        <h3 className="font-display text-3xl leading-none text-zinc-700 dark:text-zinc-200 mb-2">All clear for today!</h3>
        <p className="text-sm mission-muted text-center max-w-xs leading-relaxed">
          No overdue tasks, nothing due today, and no new captures yet. Enjoy your day.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Overdue Section */}
      {hasOverdue && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-rose-500" />
            <h2 className="font-display text-2xl leading-none text-rose-600 dark:text-rose-400">
              Overdue
            </h2>
            <span className="text-[10px] font-semibold text-rose-400 dark:text-rose-500 bg-rose-50 dark:bg-rose-900/30 px-2 py-0.5 rounded-full">
              {overdueNotes.length}
            </span>
          </div>
          <div className="space-y-4">
            {renderNoteCards(overdueNotes)}
          </div>
        </section>
      )}

      {/* Due Today Section */}
      {hasDueToday && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4 text-amber-500" />
            <h2 className="font-display text-2xl leading-none text-amber-600 dark:text-amber-400">
              Due Today
            </h2>
            <span className="text-[10px] font-semibold text-amber-400 dark:text-amber-500 bg-amber-50 dark:bg-amber-900/30 px-2 py-0.5 rounded-full">
              {dueTodayNotes.length}
            </span>
          </div>
          <div className="space-y-4">
            {renderNoteCards(dueTodayNotes)}
          </div>
        </section>
      )}

      {/* Captured Today Section */}
      {hasCapturedToday && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Plus className="w-4 h-4 text-blue-500" />
            <h2 className="font-display text-2xl leading-none text-blue-600 dark:text-blue-400">
              Captured Today
            </h2>
            <span className="text-[10px] font-semibold text-blue-400 dark:text-blue-500 bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded-full">
              {capturedTodayNotes.length}
            </span>
          </div>
          <div className="space-y-4">
            {renderNoteCards(capturedTodayNotes)}
          </div>
        </section>
      )}

      {/* AI Daily Brief Section */}
      {hasBrief && (
        <section>
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-cyan-500" />
              <h2 className="font-display text-2xl leading-none text-cyan-600 dark:text-cyan-400">
                AI Daily Brief
              </h2>
            </div>
            <button
              onClick={() => {
                if (!aiBrief) return;
                onShareBrief(aiBrief, {
                  overdue: overdueNotes.length,
                  dueToday: dueTodayNotes.length,
                  capturedToday: capturedTodayNotes.length,
                });
              }}
              disabled={!aiBrief || isLoadingBrief}
              className="mission-tag-chip inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-md border border-cyan-200 dark:border-cyan-800 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-50 dark:hover:bg-cyan-900/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="Share brief"
              aria-label="Share brief"
            >
              <Share2 className="w-3.5 h-3.5" />
              Share
            </button>
          </div>
          <div className="mission-note rounded-2xl p-5 border border-cyan-100 dark:border-zinc-700 shadow-sm">
            {isLoadingBrief ? (
              <div className="space-y-2">
                <div className="h-4 bg-cyan-50 dark:bg-cyan-900/30 rounded w-3/4 animate-pulse"></div>
                <div className="h-4 bg-cyan-50 dark:bg-cyan-900/30 rounded w-1/2 animate-pulse delay-75"></div>
                <div className="h-4 bg-cyan-50 dark:bg-cyan-900/30 rounded w-2/3 animate-pulse delay-150"></div>
              </div>
            ) : (
              <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">{aiBrief}</p>
            )}
          </div>
        </section>
      )}
    </div>
  );
};

export default React.memo(TodayView);
