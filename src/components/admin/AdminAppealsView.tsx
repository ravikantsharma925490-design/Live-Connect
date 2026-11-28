import React, { useCallback, useEffect, useState } from 'react';
import { Scale, RefreshCw, CheckCircle2, XCircle, Loader2, X } from 'lucide-react';
import { adminApi } from '@/src/lib/admin/adminApi';
import { cn } from '@/src/lib/utils';

export const AdminAppealsView: React.FC = () => {
  const [statusFilter, setStatusFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [appeals, setAppeals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<any | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const loadAppeals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.getAppeals(statusFilter);
      setAppeals(res.appeals || []);
    } catch (err: any) {
      setError(err?.message || 'Could not load ban appeals.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void loadAppeals();
  }, [loadAppeals]);

  const handleReview = async (decision: 'approved' | 'rejected') => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.reviewAppeal(selected.id, decision, note.trim() || undefined);
      setSelected(null);
      setNote('');
      await loadAppeals();
    } catch (err: any) {
      setError(err?.message || 'Failed to submit appeal decision.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Ban Appeals ({appeals.length})
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Approve to unban immediately or reject with a reply message
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-medium"
          >
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="all">All Appeals</option>
          </select>
          <button
            type="button"
            onClick={() => void loadAppeals()}
            className="px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800/70">
        {loading && appeals.length === 0 ? (
          <div className="py-12 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
          </div>
        ) : appeals.length === 0 ? (
          <p className="py-12 text-center text-xs text-slate-400">No ban appeals in this view.</p>
        ) : (
          appeals.map((a) => (
            <div
              key={a.id}
              onClick={() => {
                setSelected(a);
                setNote(a.admin_note || '');
              }}
              className="p-4 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Scale className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                    {a.user?.display_name || a.user?.username || a.user_id}
                  </span>
                  <span className="text-[11px] font-mono text-slate-400">
                    @{a.user?.username || 'user'}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2">{a.reason}</p>
                <p className="text-[11px] text-slate-400">
                  Submitted {new Date(a.created_at).toLocaleString()}
                  {a.user?.ban_reason ? ` · Ban reason: ${a.user.ban_reason}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className={cn(
                    'px-2 py-0.5 rounded-md text-[10px] font-bold uppercase',
                    a.status === 'pending'
                      ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                      : a.status === 'approved'
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                  )}
                >
                  {a.status}
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] font-semibold">
                  Review
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {selected && (
        <div
          onClick={() => setSelected(null)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm animate-in fade-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col"
          >
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Review Ban Appeal</h3>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div>
                <p className="font-bold text-slate-900 dark:text-slate-100">
                  {selected.user?.display_name || 'User'} (@{selected.user?.username || selected.user_id})
                </p>
                {selected.user?.ban_reason && (
                  <p className="text-slate-500 mt-0.5">Original ban reason: {selected.user.ban_reason}</p>
                )}
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-1">
                <p className="text-[11px] font-semibold text-slate-400">User&apos;s Appeal Explanation</p>
                <p className="text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{selected.reason}</p>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                  Reply / Decision Note
                </label>
                <textarea
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Write a reply for the user..."
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs resize-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleReview('rejected')}
                  className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  <span>Reject</span>
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleReview('approved')}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Approve & Unban</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
