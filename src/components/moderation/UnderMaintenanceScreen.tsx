import React, { useState } from 'react';
import { Wrench, RefreshCw, LogOut, Loader2 } from 'lucide-react';

interface UnderMaintenanceScreenProps {
  message: string;
  hasUser: boolean;
  onRefresh: () => Promise<void> | void;
  onSignOut?: () => Promise<void> | void;
}

export const UnderMaintenanceScreen: React.FC<UnderMaintenanceScreenProps> = ({
  message,
  hasUser,
  onRefresh,
  onSignOut,
}) => {
  const [checking, setChecking] = useState(false);

  const handleCheck = async () => {
    setChecking(true);
    try {
      await onRefresh();
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="min-h-screen-safe w-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 p-7 text-center space-y-5 shadow-sm">
        <div className="w-12 h-12 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 flex items-center justify-center mx-auto">
          <Wrench className="w-6 h-6" />
        </div>

        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
            Scheduled Maintenance
          </p>
          <h1 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
            LiveConnect is under maintenance
          </h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-300 leading-relaxed">
            {message?.trim() ||
              'We are performing scheduled upgrades to keep LiveConnect fast and reliable. Please check back shortly.'}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 pt-2">
          <button
            type="button"
            disabled={checking}
            onClick={handleCheck}
            className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition-colors"
          >
            {checking ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            <span>Check Status</span>
          </button>

          {hasUser && onSignOut && (
            <button
              type="button"
              onClick={onSignOut}
              className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300 text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
