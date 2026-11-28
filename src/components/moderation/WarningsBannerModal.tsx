import React, { useState } from 'react';
import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import { UnreadWarningItem } from '@/src/lib/bannedWordsCheck';
import { getAuthHeaders } from '@/src/lib/authHeader';

interface WarningsBannerModalProps {
  warnings: UnreadWarningItem[];
  onAcknowledged: () => void;
}

export const WarningsBannerModal: React.FC<WarningsBannerModalProps> = ({
  warnings,
  onAcknowledged,
}) => {
  const [submitting, setSubmitting] = useState(false);

  if (!warnings || warnings.length === 0) return null;

  const handleAcknowledge = async () => {
    setSubmitting(true);
    try {
      const headers = await getAuthHeaders();
      await fetch('/api/app/warnings/ack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ warningIds: warnings.map((w) => w.id) }),
      });
    } catch {
      // Allow dismissing UI even on transient error; next poll will resync if needed
    } finally {
      setSubmitting(false);
      onAcknowledged();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="px-5 py-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
              Account Warning{warnings.length > 1 ? `s (${warnings.length})` : ''}
            </h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Please review this notice from LiveConnect moderation.
            </p>
          </div>
        </div>

        <div className="p-5 overflow-y-auto space-y-3">
          {warnings.map((w) => (
            <div
              key={w.id}
              className="p-3.5 rounded-xl bg-amber-50/60 dark:bg-amber-950/25 border border-amber-200/80 dark:border-amber-900/50 space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                <span>Warning #{w.strikeNumber || 1}</span>
                <span className="text-neutral-500 dark:text-neutral-400 font-normal">
                  {new Date(w.createdAt).toLocaleDateString()}
                </span>
              </div>
              <p className="text-xs text-neutral-800 dark:text-neutral-200 leading-relaxed font-medium">
                {w.reason}
              </p>
            </div>
          ))}

          <p className="text-[11px] text-neutral-500 dark:text-neutral-400 leading-relaxed">
            Repeated violations of our Community Guidelines may result in automatic account suspension or permanent ban.
          </p>
        </div>

        <div className="px-5 py-3.5 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50 flex justify-end">
          <button
            type="button"
            disabled={submitting}
            onClick={handleAcknowledge}
            className="px-4 py-2 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-xs font-bold flex items-center gap-1.5 cursor-pointer hover:opacity-90 disabled:opacity-60"
          >
            {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            <span>I Understand</span>
          </button>
        </div>
      </div>
    </div>
  );
};
