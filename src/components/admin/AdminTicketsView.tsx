import React, { useCallback, useEffect, useState } from 'react';
import { LifeBuoy, RefreshCw, Send, Loader2, X, CheckCircle2 } from 'lucide-react';
import { adminApi } from '@/src/lib/admin/adminApi';
import { cn } from '@/src/lib/utils';

export const AdminTicketsView: React.FC = () => {
  const [statusFilter, setStatusFilter] = useState<'open' | 'closed' | 'all'>('open');
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<any | null>(null);
  const [replyText, setReplyText] = useState('');
  const [closeAfterReply, setCloseAfterReply] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.getTickets(statusFilter);
      const list = res.tickets || [];
      setTickets(list);
      if (selected) {
        const refreshed = list.find((t: any) => t.id === selected.id);
        if (refreshed) setSelected(refreshed);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load support tickets.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, selected?.id]);

  useEffect(() => {
    void loadTickets();
  }, [statusFilter]);

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !replyText.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await adminApi.replyTicket(selected.id, replyText.trim(), closeAfterReply);
      setReplyText('');
      setSelected(res.ticket);
      await loadTickets();
    } catch (err: any) {
      setError(err?.message || 'Failed to send reply.');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleStatus = async (ticket: any) => {
    setBusy(true);
    try {
      const next = ticket.status === 'open' ? 'closed' : 'open';
      const res = await adminApi.updateTicketStatus(ticket.id, next);
      setSelected(res.ticket);
      await loadTickets();
    } catch (err: any) {
      setError(err?.message || 'Could not update ticket status.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Support Tickets ({tickets.length})
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            View user complaints, feedback, and problems and reply in-app
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1">
            {(['open', 'closed', 'all'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={cn(
                  'px-3 py-1 rounded-lg text-xs font-semibold capitalize cursor-pointer',
                  statusFilter === st
                    ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                    : 'text-slate-500'
                )}
              >
                {st}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void loadTickets()}
            className="px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-semibold cursor-pointer"
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
        {loading && tickets.length === 0 ? (
          <div className="py-12 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
          </div>
        ) : tickets.length === 0 ? (
          <p className="py-12 text-center text-xs text-slate-400">No support tickets found.</p>
        ) : (
          tickets.map((t) => (
            <div
              key={t.id}
              onClick={() => setSelected(t)}
              className="p-4 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <LifeBuoy className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                  <span className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                    {t.subject}
                  </span>
                  <span className="text-[11px] text-slate-400 capitalize">· {t.category}</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-1">{t.message}</p>
                <p className="text-[11px] text-slate-400">
                  {t.userDisplayName} (@{t.userUsername}) · {new Date(t.updatedAt).toLocaleString()} ·{' '}
                  {(t.replies || []).length} replies
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className={cn(
                    'px-2 py-0.5 rounded-md text-[10px] font-bold uppercase',
                    t.status === 'open'
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                  )}
                >
                  {t.status}
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] font-semibold">
                  Open
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
            className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[88vh]"
          >
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                  {selected.subject}
                </h3>
                <p className="text-[11px] text-slate-500">
                  {selected.userDisplayName} (@{selected.userUsername}) · {selected.userEmail || selected.userId}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleToggleStatus(selected)}
                  className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-semibold cursor-pointer"
                >
                  {selected.status === 'open' ? 'Close Ticket' : 'Reopen'}
                </button>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-1">
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span className="font-bold text-slate-700 dark:text-slate-300">
                    {selected.userDisplayName}
                  </span>
                  <span>{new Date(selected.createdAt).toLocaleString()}</span>
                </div>
                <p className="text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{selected.message}</p>
              </div>

              {(selected.replies || []).map((r: any) => (
                <div
                  key={r.id}
                  className={cn(
                    'p-3 rounded-xl border space-y-1',
                    r.senderRole === 'admin'
                      ? 'bg-blue-50/70 dark:bg-blue-950/30 border-blue-200/70 dark:border-blue-900/50'
                      : 'bg-slate-50 dark:bg-slate-950/60 border-slate-200 dark:border-slate-800'
                  )}
                >
                  <div className="flex justify-between text-[11px]">
                    <span className="font-bold text-slate-800 dark:text-slate-200">
                      {r.senderRole === 'admin' ? `${r.senderName} (Staff)` : r.senderName}
                    </span>
                    <span className="text-slate-400">{new Date(r.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{r.message}</p>
                </div>
              ))}

              <form onSubmit={handleReply} className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
                <textarea
                  rows={3}
                  required
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Write an official reply to the user..."
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs resize-none"
                />
                <div className="flex items-center justify-between gap-2">
                  <label className="inline-flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={closeAfterReply}
                      onChange={(e) => setCloseAfterReply(e.target.checked)}
                      className="rounded border-slate-300"
                    />
                    <span>Close ticket after replying</span>
                  </label>
                  <button
                    type="submit"
                    disabled={busy || !replyText.trim()}
                    className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                    <span>Send Reply</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
