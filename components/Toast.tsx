import React from 'react';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastMessage {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
  action?: ToastAction;
}

interface ToastContainerProps {
  toasts: ToastMessage[];
  removeToast: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, removeToast }) => {
  return (
    <div className="fixed top-safe left-1/2 transform -translate-x-1/2 z-[60] flex flex-col gap-2 w-full max-w-xs pointer-events-none pt-4">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="mission-toast pointer-events-auto flex items-center gap-3 text-white px-4 py-3 rounded-2xl shadow-xl shadow-zinc-900/20 backdrop-blur-md animate-fade-in text-sm font-medium border border-zinc-800 dark:border-zinc-600 transform transition-all"
          role="alert"
        >
          {toast.type === 'success' && <CheckCircle className="w-4 h-4 text-emerald-400" />}
          {toast.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-400" />}
          {toast.type === 'info' && <Info className="w-4 h-4 text-brand-400" />}
          
          <span className="flex-1">{toast.message}</span>

          {toast.action && (
            <button
              onClick={() => { toast.action!.onClick(); removeToast(toast.id); }}
              className="font-bold text-white underline cursor-pointer text-sm hover:text-zinc-200 transition-colors"
            >
              {toast.action.label}
            </button>
          )}

          <button
            onClick={() => removeToast(toast.id)}
            className="text-zinc-500 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
};
