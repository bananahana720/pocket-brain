import React from 'react';
import { AlertTriangle, CheckCircle2, CloudOff, RefreshCw, ShieldAlert } from 'lucide-react';
import { SyncStatus } from '../hooks/useSyncEngine';

interface SyncStatusBadgeProps {
  status: SyncStatus;
}

const statusConfig: Record<SyncStatus, { label: string; className: string; icon: React.ReactNode }> = {
  disabled: {
    label: 'Local only',
    className: 'text-zinc-500 border-zinc-300/60 bg-zinc-100/50 dark:text-zinc-300 dark:border-zinc-700/70 dark:bg-zinc-900/40',
    icon: <CloudOff className="w-3.5 h-3.5" />,
  },
  syncing: {
    label: 'Syncing',
    className: 'text-sky-700 border-sky-200 bg-sky-50 dark:text-sky-300 dark:border-sky-800/70 dark:bg-sky-900/30',
    icon: <RefreshCw className="w-3.5 h-3.5 animate-spin" />,
  },
  synced: {
    label: 'Synced',
    className: 'text-emerald-700 border-emerald-200 bg-emerald-50 dark:text-emerald-300 dark:border-emerald-800/70 dark:bg-emerald-900/30',
    icon: <CheckCircle2 className="w-3.5 h-3.5" />,
  },
  offline: {
    label: 'Offline',
    className: 'text-amber-700 border-amber-200 bg-amber-50 dark:text-amber-300 dark:border-amber-800/70 dark:bg-amber-900/30',
    icon: <CloudOff className="w-3.5 h-3.5" />,
  },
  conflict: {
    label: 'Conflict',
    className: 'text-rose-700 border-rose-200 bg-rose-50 dark:text-rose-300 dark:border-rose-800/70 dark:bg-rose-900/30',
    icon: <AlertTriangle className="w-3.5 h-3.5" />,
  },
  degraded: {
    label: 'Degraded',
    className: 'text-orange-700 border-orange-200 bg-orange-50 dark:text-orange-300 dark:border-orange-800/70 dark:bg-orange-900/30',
    icon: <ShieldAlert className="w-3.5 h-3.5" />,
  },
};

const SyncStatusBadge: React.FC<SyncStatusBadgeProps> = ({ status }) => {
  const config = statusConfig[status];

  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${config.className}`}
      title={`Sync status: ${config.label}`}
    >
      {config.icon}
      <span>{config.label}</span>
    </div>
  );
};

export default React.memo(SyncStatusBadge);
