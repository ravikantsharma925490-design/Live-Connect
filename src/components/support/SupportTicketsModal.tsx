import React, { useCallback, useEffect, useState } from 'react';
import { X, LifeBuoy, Send, Loader2, MessageSquare, CheckCircle2, Clock } from 'lucide-react';
import { getAuthHeaders } from '@/src/lib/authHeader';
import { cn } from '@/src/lib/utils';

interface TicketReply {
  id: string;
  ticketId: string;
  senderId: string;
  senderRole: 'user' | 'admin';
  senderName: string;
  message: string;
  createdAt: string;
}

interface SupportTicketItem {
  id: string;
  userId: string;
  category: string;
  subject: string;
  message: string;
  status: 'open' | 'closed';
  createdAt: string;
  updatedAt: string;
  replies: TicketReply[];
}

interface SupportTicketsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const TICKET_CATEGORIES = [
  { id: 'problem', label: 'Report a Problem / Bug' },
  { id: 'complaint', label: 'Complaint' },
  { id: 'account', label: 'Account & Safety Help' },
  { id: 'feedback', label: 'Feedback & Suggestion' },
];

export const SupportTicketsModal: React.FC<SupportTicketsModalProps> = ({ isOpen, onClose }) => {
  const [view, setView] = useState<'list' | 'new' | 'detail'>('list');
  const [tickets, setTickets] = useState<SupportTicketItem[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New ticket form
  const [category, setCategory] = useState('problem');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Follow-up reply
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/support/tickets', { headers });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Could not load support tickets.');
      setTickets(Array.isArray(data?.tickets) ? data.tickets : []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load support tickets.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void loadTickets();
  }, [isOpen, loadTickets]);

  if (!isOpen) return null;

  const selectedTicket = tickets.find((t) => t.id === selectedTicketId) || null;

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/support/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          category,
          subject: subject.trim(),
          message: message.trim(),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Could not submit ticket.');
      setSubject('');
      setMessage('');
      await loadTickets();
      if (data?.ticket?.id) {
        setSelectedTicketId(data.ticket.id);
        setView('detail');
      } else {
        setView('list');
      }
    } catch (err: any) {
      setError(err?.message || 'Could not submit support ticket.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket || !replyText.trim()) return;
    setSendingReply(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/support/tickets/${encodeURIComponent(selectedTicket.id)}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ message: replyText.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Could not send reply.');
      setReplyText('');
      await loadTickets();
    } catch (err: any) {
      setError(err?.message || 'Could not send reply.');
    } finally {
      setSendingReply(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between bg-neutral-50/70 dark:bg-neutral-800/40 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            {view !== 'list' && (
              <button
                type="button"
                onClick={() => {
                  setView('list');
                  setError(null);
                }}
                className="px-2.5 py-1 rounded-xl bg-neutral-200/80 dark:bg-neutral-800 text-xs font-bold text-neutral-700 dark:text-neutral-200 cursor-pointer"
              >
                Back
              </button>
            )}
            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <LifeBuoy className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-neutral-900 dark:text-neutral-100 truncate">
                {view === 'new'
                  ? 'New Support Ticket'
                  : view === 'detail' && selectedTicket
                    ? selectedTicket.subject
                    : 'Support & Feedback'}
              </h3>
              <p className="text-[11px] text-neutral-500 truncate">
                Submit a complaint, feedback, or problem & track admin replies
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-200/60 dark:hover:bg-neutral-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-700 dark:text-rose-300">
              {error}
            </div>
          )}

          {view === 'list' && (
            <>
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-400">
                  Your Tickets ({tickets.length})
                </h4>
                <button
                  type="button"
                  onClick={() => setView('new')}
                  className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold cursor-pointer"
                >
                  + New Ticket
                </button>
              </div>

              {loading && tickets.length === 0 ? (
                <div className="py-10 flex justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                </div>
              ) : tickets.length === 0 ? (
                <div className="py-10 text-center space-y-2 rounded-2xl border border-dashed border-neutral-200 dark:border-neutral-800">
                  <MessageSquare className="w-7 h-7 text-neutral-400 mx-auto" />
                  <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                    No support tickets yet
                  </p>
                  <p className="text-[11px] text-neutral-500 max-w-xs mx-auto">
                    Have a question, complaint, or bug to report? Open a ticket and our support team will reply here.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {tickets.map((t) => {
                    const lastReply = t.replies?.[t.replies.length - 1];
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          setSelectedTicketId(t.id);
                          setView('detail');
                        }}
                        className="w-full p-3.5 rounded-2xl bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-800 hover:border-blue-400 dark:hover:border-blue-700 text-start transition-colors cursor-pointer space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-neutral-900 dark:text-neutral-100 truncate">
                            {t.subject}
                          </span>
                          <span
                            className={cn(
                              'px-2 py-0.5 rounded-md text-[10px] font-bold shrink-0 uppercase',
                              t.status === 'open'
                                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300'
                            )}
                          >
                            {t.status}
                          </span>
                        </div>
                        <p className="text-xs text-neutral-500 line-clamp-2">
                          {lastReply ? `${lastReply.senderRole === 'admin' ? 'Support: ' : 'You: '}${lastReply.message}` : t.message}
                        </p>
                        <div className="flex items-center gap-2 text-[10px] text-neutral-400">
                          <span className="capitalize">{t.category}</span>
                          <span>·</span>
                          <span>{new Date(t.updatedAt).toLocaleDateString()}</span>
                          {t.replies.length > 0 && (
                            <>
                              <span>·</span>
                              <span>{t.replies.length} repl{t.replies.length === 1 ? 'y' : 'ies'}</span>
                            </>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {view === 'new' && (
            <form onSubmit={handleCreateTicket} className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300">
                  Category
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-2xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-xs font-medium text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                >
                  {TICKET_CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300">
                  Subject <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  maxLength={140}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Briefly summarize your issue or feedback"
                  className="w-full px-3.5 py-2.5 rounded-2xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-xs text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300">
                  Message <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={4}
                  required
                  maxLength={2000}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Describe your complaint, feedback, or problem in detail..."
                  className="w-full px-3.5 py-2.5 rounded-2xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-xs text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-none"
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setView('list')}
                  className="px-4 py-2 rounded-xl border border-neutral-200 dark:border-neutral-700 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !subject.trim() || !message.trim()}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  <span>Submit Ticket</span>
                </button>
              </div>
            </form>
          )}

          {view === 'detail' && selectedTicket && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2 text-[11px] text-neutral-500">
                <span className="inline-flex items-center gap-1 capitalize">
                  <Clock className="w-3 h-3" />
                  {selectedTicket.category} · {new Date(selectedTicket.createdAt).toLocaleString()}
                </span>
                <span
                  className={cn(
                    'px-2 py-0.5 rounded-md text-[10px] font-bold uppercase inline-flex items-center gap-1',
                    selectedTicket.status === 'open'
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300'
                  )}
                >
                  {selectedTicket.status === 'closed' && <CheckCircle2 className="w-3 h-3" />}
                  {selectedTicket.status}
                </span>
              </div>

              {/* Original message */}
              <div className="p-3.5 rounded-2xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200/70 dark:border-blue-900/50 space-y-1">
                <p className="text-[11px] font-bold text-blue-700 dark:text-blue-300">You</p>
                <p className="text-xs text-neutral-800 dark:text-neutral-200 whitespace-pre-wrap">
                  {selectedTicket.message}
                </p>
              </div>

              {/* Thread */}
              {selectedTicket.replies.map((r) => (
                <div
                  key={r.id}
                  className={cn(
                    'p-3.5 rounded-2xl border space-y-1',
                    r.senderRole === 'admin'
                      ? 'bg-emerald-50/70 dark:bg-emerald-950/25 border-emerald-200/70 dark:border-emerald-900/50'
                      : 'bg-neutral-50 dark:bg-neutral-800/60 border-neutral-200 dark:border-neutral-700/70'
                  )}
                >
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span
                      className={cn(
                        'font-bold',
                        r.senderRole === 'admin'
                          ? 'text-emerald-700 dark:text-emerald-300'
                          : 'text-neutral-700 dark:text-neutral-300'
                      )}
                    >
                      {r.senderRole === 'admin' ? `${r.senderName || 'Support Team'} (Staff)` : 'You'}
                    </span>
                    <span className="text-neutral-400 text-[10px]">
                      {new Date(r.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-xs text-neutral-800 dark:text-neutral-200 whitespace-pre-wrap">
                    {r.message}
                  </p>
                </div>
              ))}

              {selectedTicket.status === 'open' ? (
                <form onSubmit={handleSendReply} className="space-y-2 pt-2 border-t border-neutral-200 dark:border-neutral-800">
                  <textarea
                    rows={2}
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Write a follow-up reply..."
                    className="w-full px-3.5 py-2 rounded-2xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-xs text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-none"
                  />
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={sendingReply || !replyText.trim()}
                      className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                    >
                      {sendingReply ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                      <span>Send Reply</span>
                    </button>
                  </div>
                </form>
              ) : (
                <p className="text-[11px] text-center text-neutral-500 py-2">
                  This ticket is closed. Open a new ticket if you need further assistance.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
