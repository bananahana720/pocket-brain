import React from 'react';
import { X, Settings, Download, Trash2, Database, PieChart, FileText, CheckSquare, Lightbulb } from 'lucide-react';
import { Note, NoteType } from '../types';

interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  notes: Note[];
  onExport: () => void;
  onClearData: () => void;
}

const Drawer: React.FC<DrawerProps> = ({ isOpen, onClose, notes, onExport, onClearData }) => {
  if (!isOpen) return null;

  const stats = {
    total: notes.length,
    notes: notes.filter(n => n.type === NoteType.NOTE).length,
    tasks: notes.filter(n => n.type === NoteType.TASK).length,
    ideas: notes.filter(n => n.type === NoteType.IDEA).length,
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-start">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-zinc-900/20 backdrop-blur-sm animate-fade-in" 
        onClick={onClose}
      />
      
      {/* Panel */}
      <div className="relative w-[80%] max-w-xs bg-white h-full shadow-2xl border-r border-zinc-200 p-6 flex flex-col animate-slide-right">
        <div className="flex items-center justify-between mb-8">
            <h2 className="text-xl font-bold text-zinc-800 tracking-tight">Menu</h2>
            <button onClick={onClose} className="p-2 -mr-2 rounded-full hover:bg-zinc-100 text-zinc-500">
                <X className="w-5 h-5" />
            </button>
        </div>

        {/* Stats */}
        <div className="space-y-6 mb-8">
            <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Overview</h3>
            <div className="grid grid-cols-2 gap-3">
                <div className="bg-zinc-50 p-3 rounded-xl border border-zinc-100">
                    <div className="flex items-center gap-2 text-zinc-500 mb-1">
                        <FileText className="w-3.5 h-3.5" />
                        <span className="text-[10px] font-medium uppercase">Notes</span>
                    </div>
                    <span className="text-xl font-bold text-zinc-800">{stats.notes}</span>
                </div>
                <div className="bg-emerald-50/50 p-3 rounded-xl border border-emerald-100/50">
                    <div className="flex items-center gap-2 text-emerald-600 mb-1">
                        <CheckSquare className="w-3.5 h-3.5" />
                        <span className="text-[10px] font-medium uppercase">Tasks</span>
                    </div>
                    <span className="text-xl font-bold text-emerald-800">{stats.tasks}</span>
                </div>
                <div className="bg-amber-50/50 p-3 rounded-xl border border-amber-100/50">
                    <div className="flex items-center gap-2 text-amber-600 mb-1">
                        <Lightbulb className="w-3.5 h-3.5" />
                        <span className="text-[10px] font-medium uppercase">Ideas</span>
                    </div>
                    <span className="text-xl font-bold text-amber-800">{stats.ideas}</span>
                </div>
                <div className="bg-brand-50/50 p-3 rounded-xl border border-brand-100/50">
                    <div className="flex items-center gap-2 text-brand-600 mb-1">
                        <PieChart className="w-3.5 h-3.5" />
                        <span className="text-[10px] font-medium uppercase">Total</span>
                    </div>
                    <span className="text-xl font-bold text-brand-800">{stats.total}</span>
                </div>
            </div>
        </div>

        <hr className="border-zinc-100 mb-8" />

        {/* Data Actions */}
        <div className="space-y-2">
            <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-4">Data Management</h3>
            
            <button 
                onClick={() => { onExport(); onClose(); }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-zinc-50 text-zinc-700 font-medium text-sm transition-colors text-left"
            >
                <Download className="w-4 h-4" />
                Export JSON
            </button>

            <button 
                onClick={() => { 
                    if(confirm('Are you sure you want to delete all notes? This cannot be undone.')) {
                        onClearData();
                        onClose();
                    }
                }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-rose-50 text-rose-600 font-medium text-sm transition-colors text-left"
            >
                <Trash2 className="w-4 h-4" />
                Clear All Data
            </button>
        </div>

        <div className="mt-auto text-center">
            <p className="text-[10px] text-zinc-400">PocketBrain v1.1.0</p>
        </div>
      </div>
    </div>
  );
};

export default Drawer;