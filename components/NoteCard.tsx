import React, { useState, useRef, useEffect } from 'react';
import { Note, NoteType } from '../types';
import { Edit2, Check, Clock, MoreVertical, Trash2, Copy, RefreshCw, CheckSquare, Square } from 'lucide-react';

interface NoteCardProps {
  note: Note;
  onUpdate: (id: string, content: string) => void;
  onDelete: (id: string) => void;
  onCopy: (content: string) => void;
  onToggleComplete: (id: string) => void;
  onReanalyze: (id: string) => void;
}

const NoteCard: React.FC<NoteCardProps> = ({ note, onUpdate, onDelete, onCopy, onToggleComplete, onReanalyze }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [content, setContent] = useState(note.content);
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

  const getTypeBadge = () => {
    switch (note.type) {
      case NoteType.TASK: 
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-600 border border-emerald-100">
            TASK
          </span>
        );
      case NoteType.IDEA: 
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-600 border border-amber-100">
            IDEA
          </span>
        );
      default: 
        return null;
    }
  };

  return (
    <div className={`group relative bg-white rounded-2xl p-5 border transition-all animate-slide-up ${
        note.isCompleted 
        ? 'opacity-60 shadow-none border-zinc-100 bg-zinc-50/50' 
        : 'shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)] border-zinc-100 hover:shadow-md hover:border-zinc-200'
    }`}>
      {/* Header */}
      <div className="flex justify-between items-start mb-3 relative">
        <div className="flex items-center gap-2 overflow-hidden">
          {note.isProcessed ? (
            getTypeBadge()
          ) : (
            <div className="w-16 h-4 bg-zinc-100 rounded-full animate-pulse" />
          )}
          <h3 className={`font-bold text-sm tracking-tight truncate ${
              note.isCompleted ? 'text-zinc-400 line-through' : 'text-zinc-800'
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
                        ? 'text-emerald-500 hover:text-emerald-600 hover:bg-emerald-50' 
                        : 'text-zinc-300 hover:text-zinc-500 hover:bg-zinc-100'
                    }`}
                >
                    {note.isCompleted ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
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
                        className="p-1.5 -mr-2 rounded-full text-zinc-300 hover:text-zinc-600 hover:bg-zinc-50 transition-colors"
                    >
                        <MoreVertical className="w-4 h-4" />
                    </button>
                    
                    {/* Dropdown Menu */}
                    {showMenu && (
                        <div className="absolute right-0 top-full mt-1 w-40 bg-white rounded-xl shadow-xl border border-zinc-100 z-20 overflow-hidden animate-fade-in">
                            <button 
                                onClick={() => { setIsEditing(true); setShowMenu(false); }}
                                className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 text-left"
                            >
                                <Edit2 className="w-3.5 h-3.5" /> Edit
                            </button>
                            <button 
                                onClick={() => { onReanalyze(note.id); setShowMenu(false); }}
                                className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 text-left"
                            >
                                <RefreshCw className="w-3.5 h-3.5" /> Re-analyze
                            </button>
                            <button 
                                onClick={() => { onCopy(note.content); setShowMenu(false); }}
                                className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 text-left"
                            >
                                <Copy className="w-3.5 h-3.5" /> Copy
                            </button>
                            <div className="h-px bg-zinc-100 my-0.5" />
                            <button 
                                onClick={() => { onDelete(note.id); setShowMenu(false); }}
                                className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-medium text-rose-500 hover:bg-rose-50 text-left"
                            >
                                <Trash2 className="w-3.5 h-3.5" /> Delete
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
      </div>
      
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
                  className="w-full p-3 -ml-3 bg-zinc-50 border border-brand-200 rounded-xl text-sm leading-relaxed text-zinc-800 focus:ring-2 focus:ring-brand-500/20 outline-none resize-none min-h-[100px]"
              />
              <div className="flex justify-end gap-2 mt-3">
                  <button 
                      onClick={handleCancel}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-500 hover:bg-zinc-100 transition-colors"
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
                : 'text-zinc-600 group-hover/text:text-zinc-900'
            }`}>
                {note.content}
            </p>
          </div>
        )}
      </div>

      {/* Tags */}
      {note.tags && note.tags.length > 0 && !isEditing && (
        <div className="flex flex-wrap gap-1.5 mt-4 pt-3 border-t border-dashed border-zinc-100">
          {note.tags.map((tag, idx) => (
            <span key={idx} className={`text-[10px] font-medium transition-colors cursor-default ${
                note.isCompleted ? 'text-zinc-300' : 'text-zinc-400 hover:text-brand-600'
            }`}>
              #{tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export default NoteCard;