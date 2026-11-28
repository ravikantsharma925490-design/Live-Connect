import React, { useCallback, useEffect, useState } from 'react';
import {
  Flag,
  RefreshCw,
  Loader2,
  X,
  AlertTriangle,
  Trash2,
  Clock,
  Ban,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { adminApi } from '@/src/lib/admin/adminApi';
import { cn } from '@/src/lib/utils';

export const AdminReportsView: React.FC = () => {
  const [targetType, setTargetType] = useState<'all' | 'user' | 'message' | 'family'>('all');
  const [statusFilter, setStatusFilter] = useState<'pending' | 'resolved' | 'dismissed' | 'all'>('pending');
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<any | null>(null);
  const [note, setNote] = useState('');
  const [durationDays, setDurationDays] = useState('7');
  const [busy, setBusy] = useState(false);

  const loadReports = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.getReports({
        status: statusFilter,
        targetType,
      });
      setReports(res.reports || []);
    } catch (err: any) {
      setError(err?.message || 'Could not load reports.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, targetType]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  const handleResolve = async (
    action: 'warn_user' | 'delete_message' | 'suspend_user' | 'ban_user' | 'reject' | 'resolve'
  ) => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.resolveReport(selected.id, {
        action,
        note: note.trim() || undefined,
        durationDays: action === 'suspend_user' ? Number(durationDays || 7) : undefined,
      });
      setSelected(null);
      setNote('');
      await loadReports();
    } catch (err: any) {
      setError(err?.message || 'Could not resolve report.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Reports Management ({reports.length})
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Review reported messages, profiles, and Family groups
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadReports()}
          className="self-start sm:self-auto px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-semibold flex items-center gap-1.5 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          <span>Refresh</span>
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* Filter Bars */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="inline-flex rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1">
          {(['all', 'message', 'user', 'family'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTargetType(t)}
              className={cn(
                'px-3 py-1 rounded-lg text-xs font-semibold capitalize cursor-pointer',
                targetType === t
                  ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              )}
            >
              {t === 'all' ? 'All Types' : `${t}s`}
            </button>
          ))}
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
          className="px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-medium"
        >
          <option value="pending">Pending</option>
          <option value="resolved">Resolved</option>
          <option value="dismissed">Rejected</option>
          <option value="all">All Statuses</option>
        </select>
      </div>

      {/* Reports List */}
      <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800/70">
        {loading && reports.length === 0 ? (
          <div className="py-12 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
          </div>
        ) : reports.length === 0 ? (
          <p className="py-12 text-center text-xs text-slate-400">No reports in this queue.</p>
        ) : (
          reports.map((r) => (
            <div
              key={r.id}
              onClick={() => {
                setSelected(r);
                setNote(r.adminNote || '');
              }}
              className="p-4 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer transition-colors"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[10px] font-bold uppercase">
                    {r.targetType}
                  </span>
                  <span className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                    {r.targetType === 'family'
                      ? r.familyName || 'Reported Family'
                      : `${r.reportedDisplayName || r.reportedUsername || r.reportedUserId}`}
                  </span>
                  <span className="text-[11px] text-slate-400">
                    · Category: <strong className="text-slate-600 dark:text-slate-300">{r.category}</strong>
                  </span>
                </div>

                {r.reportedMessageContent && (
                  <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-1 font-mono bg-slate-50 dark:bg-slate-950/60 px-2.5 py-1 rounded-lg">
                    &ldquo;{r.reportedMessageContent}&rdquo;
                  </p>
                )}

                <p className="text-[11px] text-slate-400">
                  Reported by @{r.reporterUsername || r.reporterId} ·{' '}
                  {new Date(r.createdAt).toLocaleString()}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span
                  className={cn(
                    'px-2 py-0.5 rounded-md text-[10px] font-bold uppercase',
                    r.status === 'pending'
                      ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                      : r.status === 'resolved'
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                  )}
                >
                  {r.status}
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] font-semibold">
                  Review
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Report Review Modal */}
      {selected && (
        <div
          onClick={() => setSelected(null)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm animate-in fade-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[88vh]"
          >
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Flag className="w-4 h-4 text-amber-500" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Review Report</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
              <div className="space-y-1">
                <p className="text-slate-400">Target</p>
                <p className="font-bold text-slate-900 dark:text-slate-100">
                  {selected.targetType === 'family'
                    ? `Family: ${selected.familyName || selected.familyId}`
                    : `${selected.reportedDisplayName || 'User'} (@${selected.reportedUsername || selected.reportedUserId})`}
                </p>
                <p className="text-slate-500">
                  Category: {selected.category} · Source: {selected.source}
                </p>
              </div>

              {selected.reportedMessageContent && (
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-1">
                  <p className="text-[11px] font-semibold text-slate-400">Reported Message</p>
                  <p className="text-slate-800 dark:text-slate-200 whitespace-pre-wrap">
                    {selected.reportedMessageContent}
                  </p>
                </div>
              )}

              {selected.details && (
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-1">
                  <p className="text-[11px] font-semibold text-slate-400">Reporter Details</p>
                  <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{selected.details}</p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Suspend Duration (days)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={durationDays}
                    onChange={(e) => setDurationDays(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Admin Note
                  </label>
                  <input
                    type="text"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Reason or note..."
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleResolve('warn_user')}
                  className="px-3 py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-700 dark:text-amber-300 font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Warn User</span>
                </button>

                {selected.reportedMessageId && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleResolve('delete_message')}
                    className="px-3 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-700 dark:text-rose-300 font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Message</span>
                  </button>
                )}

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleResolve('suspend_user')}
                  className="px-3 py-2 rounded-xl bg-orange-500/15 hover:bg-orange-500/25 text-orange-700 dark:text-orange-300 font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>Suspend ({durationDays}d)</span>
                </button>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleResolve('ban_user')}
                  className="px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Ban className="w-3.5 h-3.5" />
                  <span>Ban Permanently</span>
                </button>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleResolve('resolve')}
                  className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Mark Resolved</span>
                </button>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleResolve('reject')}
                  className="px-3 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  <span>Reject Report</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
