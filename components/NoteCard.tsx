import React, { useState, useRef, useEffect } from 'react';
import { Note, NoteType } from '../types';
import { Edit2, Check, Clock, MoreVertical, Trash2, Copy, RefreshCw, CheckSquare, Square, Pin, Archive, Calendar, AlertCircle, Share2 } from 'lucide-react';
import { trackEvent } from '../utils/analytics';

interface NoteCardProps {
  note: Note;
  onUpdate: (id: string, content: string) => void;
  onDelete: (id: string) => void;
  onCopy: (content: string) => void;
  onToggleComplete: (id: string) => void;
  onReanalyze: (id: string) => void;
  onTagClick?: (tag: string) => void;
  onPin: (id: string) => void;
  onArchive: (id: string) => void;
  onSetDueDate: (id: string, date: number | undefined) => void;
  onSetPriority: (id: string, priority: 'urgent' | 'normal' | 'low' | undefined) => void;
}

function formatNoteForSharing(note: Note): string {
  const typeEmoji = note.type === 'TASK' ? '✅' : note.type === 'IDEA' ? '💡' : '📝';
  const header = note.title || (note.content.length > 50 ? note.content.slice(0, 50) + '...' : note.content);
  const tags = note.tags?.length ? '\n' + note.tags.map(t => `#${t}`).join(' ') : '';
  const appUrl = window.location.origin + window.location.pathname;

  return `${typeEmoji} ${header}\n\n${note.content}${tags}\n\n---\nCaptured with PocketBrain\n${appUrl}`;
}

const NoteCard: React.FC<NoteCardProps> = ({ note, onUpdate, onDelete, onCopy, onToggleComplete, onReanalyze, onTagClick, onPin, onArchive, onSetDueDate, onSetPriority }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showPriorityPicker, setShowPriorityPicker] = useState(false);
  const [content, setContent] = useState(note.content);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  
  const dateStr = new Date(note.createdAt).toLocaleDateString('en-US', { 
    weekday: 'short', 
    hour: 'numeric', 
    minute:'numeric' 
  });

  useEffect(() => {
    setContent(note.content);
  }, [note.content]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [isEditing]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSave = () => {
    if (content.trim() !== note.content) {
      onUpdate(note.id, content);
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setContent(note.content);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      handleSave();
    }
    if (e.key === 'Escape') {
      handleCancel();
    }
  };

  const handleShare = async () => {
    const text = formatNoteForSharing(note);

    trackEvent('note_share_clicked', {
      noteType: note.type || 'NOTE',
      hasTitle: !!note.title,
      tagCount: note.tags?.length || 0,
    });

    if (navigator.share) {
      try {
        await navigator.share({
          title: note.title || 'PocketBrain Note',
          text,
        });
        trackEvent('note_share_completed', { method: 'native', noteType: note.type || 'NOTE' });
        setShareStatus('Shared!');
        setTimeout(() => setShareStatus(null), 2000);
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
      }
    }

    try {
      await navigator.clipboard.writeText(text);
      trackEvent('note_share_completed', { method: 'clipboard', noteType: note.type || 'NOTE' });
      setShareStatus('Copied!');
      setTimeout(() => setShareStatus(null), 2000);
    } catch {
      setShareStatus('Failed');
      setTimeout(() => setShareStatus(null), 2000);
    }
  };

  const shareState =
    shareStatus === 'Failed' ? 'error' : shareStatus ? 'success' : 'idle';

  const getTypeBadge = () => {
    switch (note.type) {
      case NoteType.TASK: 
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-800">
            TASK
          </span>
        );
      case NoteType.IDEA: 
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 border border-amber-100 dark:border-amber-800">
            IDEA
          </span>
        );
      default: 
        return null;
    }
  };

  const getDueDateBadge = () => {
    if (!note.dueDate) return null;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dueDate = new Date(note.dueDate);
    const dueDateDay = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
    const diffDays = Math.round((dueDateDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    let label: string;
    let colorClass: string;
    if (diffDays < 0) {
      label = 'Overdue';
      colorClass = 'bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 border-rose-100 dark:border-rose-800';
    } else if (diffDays === 0) {
      label = 'Due today';
      colorClass = 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 border-amber-100 dark:border-amber-800';
    } else if (diffDays === 1) {
      label = 'Tomorrow';
      colorClass = 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border-blue-100 dark:border-blue-800';
    } else {
      label = dueDateDay.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      colorClass = 'bg-zinc-50 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400 border-zinc-100 dark:border-zinc-600';
    }

    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${colorClass}`}>
        <Calendar className="w-2.5 h-2.5" />
        {label}
      </span>
    );
  };

  const getPriorityBorder = () => {
    switch (note.priority) {
      case 'urgent': return 'border-l-4 border-l-rose-500';
      case 'normal': return 'border-l-4 border-l-amber-400';
      case 'low': return 'border-l-4 border-l-zinc-300';
      default: return '';
    }
  };

  return (
    <div className={`group relative bg-white dark:bg-zinc-800 rounded-2xl p-5 border transition-all duration-200 animate-slide-up ${getPriorityBorder()} ${
        note.isCompleted
        ? 'opacity-60 shadow-none border-zinc-100 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-800/50'
        : 'shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)] border-zinc-100 dark:border-zinc-700 hover:shadow-md hover:border-zinc-200 dark:hover:border-zinc-600'
    }`}>
      {/* Header */}
      <div className="flex justify-between items-start mb-3 relative">
        <div className="flex items-center gap-2 overflow-hidden">
          {note.isProcessed ? (
            getTypeBadge()
          ) : (
            <div className="w-16 h-4 bg-zinc-100 dark:bg-zinc-700 rounded-full animate-pulse" />
          )}
          <h3 className={`font-bold text-sm tracking-tight truncate ${
              note.isCompleted ? 'text-zinc-400 line-through' : 'text-zinc-800 dark:text-zinc-100'
            } ${!note.title ? 'text-zinc-400 italic' : ''}`}>
            {note.title || 'Processing...'}
          </h3>
        </div>
        
        <div className="flex items-center gap-2 pl-2 shrink-0">
            {/* Checkbox for Tasks */}
            {note.type === NoteType.TASK && !isEditing && (
                <button 
                    onClick={() => onToggleComplete(note.id)}
                    className={`p-1 rounded-md transition-colors ${
                        note.isCompleted 
                        ? 'text-emerald-500 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30'
                        : 'text-zinc-300 dark:text-zinc-600 hover:text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-700'
                    }`}
                >
                    {note.isCompleted ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                </button>
            )}

            {/* Pin button */}
            {!isEditing && (
                <button
                    onClick={() => onPin(note.id)}
                    className={`p-1 rounded-md transition-colors ${
                        note.isPinned
                        ? 'text-violet-500 hover:text-violet-600 hover:bg-violet-50'
                        : 'text-zinc-300 hover:text-zinc-500 hover:bg-zinc-100 opacity-0 group-hover:opacity-100'
                    }`}
                    title={note.isPinned ? 'Unpin' : 'Pin'}
                >
                    <Pin className={`w-3.5 h-3.5 ${note.isPinned ? 'fill-current' : ''}`} />
                </button>
            )}

            {/* Share button */}
            {!isEditing && (
                <button
                    onClick={handleShare}
                    className={`p-1 rounded-md transition-colors ${
                        shareState === 'success'
                        ? 'text-emerald-500'
                        : shareState === 'error'
                        ? 'text-rose-500'
                        : 'text-zinc-300 hover:text-zinc-500 hover:bg-zinc-100 opacity-0 group-hover:opacity-100'
                    }`}
                    title={shareStatus || 'Share'}
                >
                    {shareState === 'success' ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : shareState === 'error' ? (
                      <AlertCircle className="w-3.5 h-3.5" />
                    ) : (
                      <Share2 className="w-3.5 h-3.5" />
                    )}
                </button>
            )}

            <div className="flex items-center text-[10px] font-medium text-zinc-400">
                <Clock className="w-3 h-3 mr-1" />
                {dateStr}
            </div>

            {/* Actions */}
            {!isEditing && (
                <div className="relative" ref={menuRef}>
                    <button 
                        onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
                        className="p-1.5 -mr-2 rounded-full text-zinc-300 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
                    >
                        <MoreVertical className="w-4 h-4" />
                    </button>
                    
                    {/* Dropdown Menu */}
                    {showMenu && (
                        <div className="absolute right-0 top-full mt-1 w-44 bg-white dark:bg-zinc-800 rounded-xl shadow-xl border border-zinc-100 dark:border-zinc-700 z-20 overflow-hidden animate-fade-in">
                            <button
                                onClick={() => { setIsEditing(true); setShowMenu(false); }}
                                className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700 hover:text-zinc-900 dark:hover:text-zinc-100 text-left"
                            >
                                <Edit2 className="w-3.5 h-3.5" /> Edit
                            </button>
                            <button
                                onClick={() => { onReanalyze(note.id); setShowMenu(false); }}
                                className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700 hover:text-zinc-900 dark:hover:text-zinc-100 text-left"
                            >
                                <RefreshCw className="w-3.5 h-3.5" /> Re-analyze
                            </button>
                            <button
                                onClick={() => { onCopy(note.content); setShowMenu(false); }}
                                className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700 hover:text-zinc-900 dark:hover:text-zinc-100 text-left"
                            >
                                <Copy className="w-3.5 h-3.5" /> Copy
                            </button>
                            {note.isPinned && (
                                <button
                                    onClick={() => { onPin(note.id); setShowMenu(false); }}
                                    className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700 hover:text-zinc-900 dark:hover:text-zinc-100 text-left"
                                >
                                    <Pin className="w-3.5 h-3.5" /> Unpin
                                </button>
                            )}
                            <div className="h-px bg-zinc-100 dark:bg-zinc-700 my-0.5" />
                            <button
                                onClick={() => { setShowDatePicker(true); setShowMenu(false); }}
                                className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700 hover:text-zinc-900 dark:hover:text-zinc-100 text-left"
                            >
                                <Calendar className="w-3.5 h-3.5" /> {note.dueDate ? 'Change due date' : 'Set due date'}
                            </button>
                            <button
                                onClick={() => { setShowPriorityPicker(true); setShowMenu(false); }}
                                className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700 hover:text-zinc-900 dark:hover:text-zinc-100 text-left"
                            >
                                <AlertCircle className="w-3.5 h-3.5" /> Set priority
                            </button>
                            <div className="h-px bg-zinc-100 dark:bg-zinc-700 my-0.5" />
                            <button
                                onClick={() => { onArchive(note.id); setShowMenu(false); }}
                                className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700 hover:text-zinc-900 dark:hover:text-zinc-100 text-left"
                            >
                                <Archive className="w-3.5 h-3.5" /> {note.isArchived ? 'Unarchive' : 'Archive'}
                            </button>
                            <button
                                onClick={() => { onDelete(note.id); setShowMenu(false); }}
                                className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-medium text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/30 text-left"
                            >
                                <Trash2 className="w-3.5 h-3.5" /> Delete
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
      </div>
      
      {/* Due date badge */}
      {note.dueDate && !isEditing && (
        <div className="flex items-center gap-2 mb-3">
          {getDueDateBadge()}
          <button
            onClick={() => onSetDueDate(note.id, undefined)}
            className="text-[10px] text-zinc-400 hover:text-rose-500"
          >
            clear
          </button>
        </div>
      )}

      {/* Inline date picker */}
      {showDatePicker && (
        <div className="flex items-center gap-2 mb-3 animate-fade-in">
          <input
            type="date"
            autoFocus
            defaultValue={note.dueDate ? new Date(note.dueDate).toISOString().split('T')[0] : ''}
            onChange={(e) => {
              if (e.target.value) {
                const [year, month, day] = e.target.value.split('-').map(Number);
                onSetDueDate(note.id, new Date(year, month - 1, day).getTime());
              }
              setShowDatePicker(false);
            }}
            onBlur={() => setShowDatePicker(false)}
            className="text-xs border border-zinc-200 rounded-lg px-2 py-1 outline-none focus:border-brand-300"
          />
        </div>
      )}

      {/* Inline priority picker */}
      {showPriorityPicker && (
        <div className="flex items-center gap-2 mb-3 animate-fade-in">
          <span className="text-[10px] font-medium text-zinc-500 mr-1">Priority:</span>
          {([
            { value: 'urgent' as const, color: 'bg-rose-500', label: 'Urgent' },
            { value: 'normal' as const, color: 'bg-amber-400', label: 'Normal' },
            { value: 'low' as const, color: 'bg-zinc-300', label: 'Low' },
          ]).map(p => (
            <button
              key={p.value}
              onClick={() => {
                onSetPriority(note.id, note.priority === p.value ? undefined : p.value);
                setShowPriorityPicker(false);
              }}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-semibold border transition-colors ${
                note.priority === p.value
                  ? 'border-zinc-300 bg-zinc-100'
                  : 'border-zinc-100 hover:bg-zinc-50'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${p.color}`} />
              {p.label}
            </button>
          ))}
          {note.priority && (
            <button
              onClick={() => { onSetPriority(note.id, undefined); setShowPriorityPicker(false); }}
              className="text-[10px] text-zinc-400 hover:text-rose-500 ml-1"
            >
              clear
            </button>
          )}
        </div>
      )}

      {/* Content */}
      <div className="relative">
        {isEditing ? (
          <div className="animate-fade-in">
              <textarea
                  ref={textareaRef}
                  value={content}
                  onChange={(e) => {
                      setContent(e.target.value);
                      e.target.style.height = 'auto';
                      e.target.style.height = e.target.scrollHeight + 'px';
                  }}
                  onKeyDown={handleKeyDown}
                  className="w-full p-3 -ml-3 bg-zinc-50 dark:bg-zinc-900 border border-brand-200 dark:border-brand-700 rounded-xl text-sm leading-relaxed text-zinc-800 dark:text-zinc-100 focus:ring-2 focus:ring-brand-500/20 outline-none resize-none min-h-[100px]"
              />
              <div className="flex justify-end gap-2 mt-3">
                  <button 
                      onClick={handleCancel}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                  >
                      Cancel
                  </button>
                  <button 
                      onClick={handleSave}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-600 hover:bg-brand-700 text-white transition-colors shadow-sm flex items-center gap-1"
                  >
                      <Check className="w-3 h-3" /> Save
                  </button>
              </div>
          </div>
        ) : (
          <div onClick={() => setIsEditing(true)} className="cursor-pointer group/text">
            <p className={`text-sm leading-relaxed whitespace-pre-wrap transition-all ${
                note.isCompleted 
                ? 'text-zinc-400 line-through decoration-zinc-300'
                : 'text-zinc-600 dark:text-zinc-300 group-hover/text:text-zinc-900 dark:group-hover/text:text-zinc-100'
            }`}>
                {note.content}
            </p>
          </div>
        )}
      </div>

      {/* Tags */}
      {note.tags && note.tags.length > 0 && !isEditing && (
        <div className="flex flex-wrap gap-1.5 mt-4 pt-3 border-t border-dashed border-zinc-100 dark:border-zinc-700">
          {note.tags.map((tag, idx) => (
            <span
              key={idx}
              onClick={() => onTagClick?.(tag)}
              className={`text-[10px] font-medium transition-all cursor-pointer hover:scale-105 ${
                note.isCompleted ? 'text-zinc-300' : 'text-zinc-400 hover:text-brand-600'
              }`}
            >
              #{tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export default NoteCard;
