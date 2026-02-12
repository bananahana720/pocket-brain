import React from 'react';
import { SyncConflict } from '../types';

interface ConflictResolutionModalProps {
  conflicts: SyncConflict[];
  onKeepServer: (requestId: string) => void;
  onKeepLocal: (requestId: string) => void;
  onDismiss: (requestId: string) => void;
}

function previewText(value: string | undefined): string {
  if (!value) return '(empty)';
  const trimmed = value.trim();
  if (trimmed.length <= 80) return trimmed;
  return `${trimmed.slice(0, 77)}...`;
}

const ConflictResolutionModal: React.FC<ConflictResolutionModalProps> = ({
  conflicts,
  onKeepServer,
  onKeepLocal,
  onDismiss,
}) => {
  if (conflicts.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[95] bg-zinc-950/45 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="mission-modal-panel w-full max-w-2xl rounded-2xl border shadow-2xl p-5">
        <h3 className="font-display text-2xl leading-none text-zinc-800 dark:text-zinc-100">Sync conflicts detected</h3>
        <p className="text-xs mission-muted mt-2">Choose whether to keep server data or overwrite with this device copy.</p>

        <div className="mt-4 max-h-[55vh] overflow-y-auto space-y-3 pr-1">
          {conflicts.map(conflict => (
            <div key={conflict.requestId} className="rounded-xl border border-zinc-200/70 dark:border-zinc-700/70 p-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">Note ID: {conflict.noteId}</p>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
                    Base v{conflict.baseVersion} vs server v{conflict.currentVersion}
                  </p>
                </div>
                <button
                  onClick={() => onDismiss(conflict.requestId)}
                  className="text-[11px] px-2 py-1 rounded-md mission-tag-chip text-zinc-500 hover:text-zinc-700 dark:text-zinc-300"
                >
                  Dismiss
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                <div className="rounded-lg bg-zinc-100/60 dark:bg-zinc-900/50 p-2">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">Server copy</p>
                  <p className="text-xs mt-1 text-zinc-700 dark:text-zinc-200">{previewText(conflict.serverNote.content)}</p>
                </div>
                <div className="rounded-lg bg-zinc-100/60 dark:bg-zinc-900/50 p-2">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">Changed fields</p>
                  <p className="text-xs mt-1 text-zinc-700 dark:text-zinc-200">
                    {conflict.changedFields.length > 0 ? conflict.changedFields.join(', ') : 'content'}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => onKeepServer(conflict.requestId)}
                  className="rounded-md px-3 py-1.5 text-xs font-semibold mission-tag-chip text-zinc-700 dark:text-zinc-200"
                >
                  Keep server
                </button>
                <button
                  onClick={() => onKeepLocal(conflict.requestId)}
                  className="rounded-md px-3 py-1.5 text-xs font-semibold bg-brand-600 text-white hover:bg-brand-700"
                >
                  Keep local
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default React.memo(ConflictResolutionModal);
