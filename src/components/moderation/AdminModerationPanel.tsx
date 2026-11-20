import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Search,
  Shield,
  AlertTriangle,
  Ban,
  RotateCcw,
  Clock,
  CheckCircle2,
  XCircle,
  FileText,
  Mail,
  Loader2,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import { AccountStatus, AppealRecord, AuditLogRecord, BanHistoryRecord } from '@/src/types';
import { cn } from '@/src/lib/utils';
import { UserAvatar } from '../ui/UserAvatar';
import { ModerationTemplatesModal } from './ModerationTemplatesModal';

interface AdminModerationPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

interface AdminUserRow {
  id: string;
  email: string;
  phone?: string | null;
  status: AccountStatus;
  strike_count: number;
  ban_reason?: string | null;
  rule_broken?: string | null;
  rule_label?: string | null;
  ban_until?: string | null;
  restricted_until?: string | null;
  role: string;
  username?: string;
  display_name?: string;
  avatar_url?: string | null;
  is_online?: boolean;
  created_at?: string;
}

interface AdminUserDetail {
  user: any;
  profile: any;
  bans: BanHistoryRecord[];
  appeals: AppealRecord[];
  reports: any[];
  auditLogs: AuditLogRecord[];
}

const RULE_OPTIONS = [
  { value: 'community_guidelines', label: 'Community Guidelines' },
  { value: 'spam', label: 'Spam & Unsolicited Messaging' },
  { value: 'harassment', label: 'Harassment or Bullying' },
  { value: 'hate_speech', label: 'Hate Speech' },
  { value: 'impersonation', label: 'Impersonation' },
  { value: 'scam', label: 'Scam / Fraud (Zero Tolerance)' },
  { value: 'threats', label: 'Violent Threats (Zero Tolerance)' },
  { value: 'terrorism', label: 'Terrorism / Extremism (Zero Tolerance)' },
  { value: 'child_abuse', label: 'Child Exploitation (Zero Tolerance)' },
];

const STATUS_FILTER_TABS = ['all', 'active', 'restricted', 'suspended', 'disabled', 'deactivated'] as const;

export const AdminModerationPanel: React.FC<AdminModerationPanelProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'users' | 'appeals' | 'logs'>('users');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [userDetail, setUserDetail] = useState<AdminUserDetail | null>(null);
  const [appeals, setAppeals] = useState<any[]>([]);
  const [appealFilter, setAppealFilter] = useState<string>('pending');
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Moderation form fields
  const [modReason, setModReason] = useState('');
  const [modRule, setModRule] = useState('community_guidelines');
  const [modDays, setModDays] = useState(7);
  const [appealNotes, setAppealNotes] = useState<Record<string, string>>({});
  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false);

  const getToken = () =>
    typeof window !== 'undefined' ? localStorage.getItem('liveconnect_session_token') || '' : '';

  const fetchUsers = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set('q', searchQuery.trim());
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const res = await fetch(`/api/admin/users?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load users');
      setUsers(Array.isArray(json.users) ? json.users : []);
    } catch (err: any) {
      setError(err?.message || 'Unable to load users.');
    } finally {
      setLoading(false);
    }
  }, [searchQuery, statusFilter]);

  const fetchUserDetail = useCallback(async (userId: string) => {
    const token = getToken();
    if (!token) return;
    setDetailLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load user details');
      setUserDetail(json);
    } catch (err: any) {
      setError(err?.message || 'Unable to load user details.');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const fetchAppeals = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/appeals?status=${encodeURIComponent(appealFilter)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load appeal queue');
      setAppeals(Array.isArray(json.appeals) ? json.appeals : []);
    } catch (err: any) {
      setError(err?.message || 'Unable to load appeals.');
    } finally {
      setLoading(false);
    }
  }, [appealFilter]);

  const fetchAuditLogs = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/audit-logs?limit=100', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load audit logs');
      setAuditLogs(Array.isArray(json.logs) ? json.logs : []);
    } catch (err: any) {
      setError(err?.message || 'Unable to load audit logs.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setFeedback(null);
    if (activeTab === 'users') void fetchUsers();
    else if (activeTab === 'appeals') void fetchAppeals();
    else if (activeTab === 'logs') void fetchAuditLogs();
  }, [isOpen, activeTab, fetchUsers, fetchAppeals, fetchAuditLogs]);

  if (!isOpen) return null;

  const handleModerate = async (
    action: 'warn' | 'restrict' | 'suspend' | 'permanent_ban' | 'restore'
  ) => {
    if (!selectedUserId) return;
    const token = getToken();
    if (!token) return;

    setActionBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await fetch('/api/admin/moderate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          targetUserId: selectedUserId,
          action,
          reason: modReason.trim() || undefined,
          ruleBroken: modRule,
          durationDays: action === 'suspend' || action === 'restrict' ? modDays : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Moderation action failed');

      setFeedback(`Action "${action.replace('_', ' ')}" applied -> Status: ${json.statusApplied}`);
      setModReason('');
      await Promise.all([fetchUserDetail(selectedUserId), fetchUsers()]);
    } catch (err: any) {
      setError(err?.message || 'Moderation action failed.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleReviewAppeal = async (appealId: string, decision: 'approved' | 'rejected') => {
    const token = getToken();
    if (!token) return;
    setActionBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await fetch(`/api/admin/appeals/${encodeURIComponent(appealId)}/review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          decision,
          note: appealNotes[appealId]?.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Appeal review failed');

      setFeedback(
        decision === 'approved'
          ? 'Appeal approved — account restored and strike count reduced.'
          : 'Appeal rejected — enforcement upheld.'
      );
      await fetchAppeals();
    } catch (err: any) {
      setError(err?.message || 'Appeal review failed.');
    } finally {
      setActionBusy(false);
    }
  };

  const statusTone = (st?: string) => {
    switch (st) {
      case 'disabled':
        return 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300';
      case 'suspended':
        return 'bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300';
      case 'restricted':
        return 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300';
      case 'deactivated':
        return 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300';
      default:
        return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/65 backdrop-blur-xs animate-in fade-in font-sans">
      <div className="w-full max-w-5xl rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-2xl overflow-hidden flex flex-col h-[92vh] text-neutral-900 dark:text-neutral-100">
        {/* Header */}
        <div className="px-5 py-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#0095F6]/10 text-[#0095F6] flex items-center justify-center">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold">Trust & Safety Moderation Console</h2>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Role-protected user enforcement, strike ladder, appeals & audit logs
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsTemplatesOpen(true)}
              className="hidden sm:inline-flex min-h-[40px] px-3 py-1.5 rounded-xl bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-xs font-semibold items-center gap-1.5 cursor-pointer"
            >
              <Mail className="w-3.5 h-3.5 text-[#0095F6]" />
              <span>Templates</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Admin Panel"
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="px-5 py-2.5 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950/40 flex items-center gap-2 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('users')}
            className={cn(
              'min-h-[40px] px-4 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer shrink-0',
              activeTab === 'users'
                ? 'bg-[#0095F6] text-white'
                : 'bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300'
            )}
          >
            Users & Strikes
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('appeals')}
            className={cn(
              'min-h-[40px] px-4 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer shrink-0',
              activeTab === 'appeals'
                ? 'bg-[#0095F6] text-white'
                : 'bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300'
            )}
          >
            Appeal Queue
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('logs')}
            className={cn(
              'min-h-[40px] px-4 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer shrink-0',
              activeTab === 'logs'
                ? 'bg-[#0095F6] text-white'
                : 'bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300'
            )}
          >
            Audit Logs
          </button>
        </div>

        {/* Alerts */}
        {(error || feedback) && (
          <div className="px-5 pt-3 space-y-2">
            {error && (
              <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 flex items-center gap-2 text-xs text-red-700 dark:text-red-300">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            {feedback && (
              <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-300 font-semibold">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{feedback}</span>
              </div>
            )}
          </div>
        )}

        {/* Main Workspace */}
        <div className="flex-1 overflow-y-auto p-5">
          {activeTab === 'users' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 h-full">
              {/* Left: Users Search & Table */}
              <div className="lg:col-span-6 space-y-3">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search username, email, or user ID..."
                      className="w-full min-h-[42px] pl-10 pr-3 rounded-xl bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-xs focus:outline-none focus:border-[#0095F6]"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {STATUS_FILTER_TABS.map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setStatusFilter(st)}
                      className={cn(
                        'px-2.5 py-1 rounded-lg text-[11px] font-semibold capitalize cursor-pointer transition-colors',
                        statusFilter === st
                          ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
                          : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400'
                      )}
                    >
                      {st}
                    </button>
                  ))}
                </div>

                {loading ? (
                  <div className="py-10 flex items-center justify-center gap-2 text-xs text-neutral-500">
                    <Loader2 className="w-4 h-4 animate-spin text-[#0095F6]" />
                    <span>Loading accounts...</span>
                  </div>
                ) : users.length === 0 ? (
                  <div className="py-10 text-center text-xs text-neutral-500 border border-neutral-200 dark:border-neutral-800 rounded-xl">
                    No matching users found.
                  </div>
                ) : (
                  <div className="divide-y divide-neutral-100 dark:divide-neutral-800 border border-neutral-200 dark:border-neutral-800 rounded-xl overflow-hidden">
                    {users.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => {
                          setSelectedUserId(u.id);
                          void fetchUserDetail(u.id);
                        }}
                        className={cn(
                          'w-full p-3.5 flex items-center justify-between gap-3 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors cursor-pointer',
                          selectedUserId === u.id && 'bg-[#0095F6]/5 dark:bg-[#0095F6]/10'
                        )}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <UserAvatar
                            src={u.avatar_url || null}
                            name={u.display_name || u.username || u.email}
                            id={u.id}
                            className="w-10 h-10 rounded-full shrink-0"
                          />
                          <div className="min-w-0">
                            <p className="text-xs font-bold truncate">
                              {u.display_name || u.username || 'User'}{' '}
                              {u.role !== 'user' && (
                                <span className="font-mono text-[10px] text-[#0095F6] uppercase">
                                  ({u.role})
                                </span>
                              )}
                            </p>
                            <p className="text-[11px] text-neutral-500 truncate">
                              @{u.username || 'user'} • {u.email}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[11px] font-mono text-neutral-500">
                            {u.strike_count}⚡
                          </span>
                          <span
                            className={cn(
                              'px-2 py-0.5 rounded-md text-[11px] font-bold capitalize',
                              statusTone(u.status)
                            )}
                          >
                            {u.status}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Right: User Detail & Enforcement Actions */}
              <div className="lg:col-span-6">
                {!selectedUserId ? (
                  <div className="h-full min-h-[260px] rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 flex flex-col items-center justify-center p-6 text-center text-xs text-neutral-500 space-y-1.5">
                    <Shield className="w-7 h-7 text-neutral-400" />
                    <p className="font-semibold text-neutral-700 dark:text-neutral-300">
                      Select a user to inspect history & apply actions
                    </p>
                    <p>You can warn, restrict, suspend, permanently ban, or restore accounts.</p>
                  </div>
                ) : detailLoading ? (
                  <div className="py-12 flex items-center justify-center gap-2 text-xs text-neutral-500">
                    <Loader2 className="w-4 h-4 animate-spin text-[#0095F6]" />
                    <span>Loading user moderation dossier...</span>
                  </div>
                ) : userDetail ? (
                  <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-4 space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <h4 className="text-sm font-bold truncate">
                          {userDetail.profile?.display_name || userDetail.user?.email}
                        </h4>
                        <p className="text-xs text-neutral-500 truncate">
                          @{userDetail.profile?.username || 'unknown'} • {userDetail.user?.email}
                        </p>
                      </div>
                      <span
                        className={cn(
                          'px-2.5 py-1 rounded-md text-xs font-bold capitalize',
                          statusTone(userDetail.user?.status)
                        )}
                      >
                        {userDetail.user?.status} ({userDetail.user?.strike_count || 0} strikes)
                      </span>
                    </div>

                    {userDetail.user?.role === 'admin' ? (
                      <div className="p-3 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-xs font-semibold text-neutral-600 dark:text-neutral-300">
                        Protected Admin Account — Admins cannot warn, restrict, suspend, or ban other admins.
                      </div>
                    ) : (
                      <div className="space-y-3 p-3.5 rounded-xl bg-neutral-50 dark:bg-neutral-800/40 border border-neutral-200 dark:border-neutral-800">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          <div>
                            <label className="block text-[11px] font-bold text-neutral-500 mb-1">
                              Policy / Rule Broken
                            </label>
                            <select
                              value={modRule}
                              onChange={(e) => setModRule(e.target.value)}
                              className="w-full min-h-[38px] px-2.5 rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-xs"
                            >
                              {RULE_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="block text-[11px] font-bold text-neutral-500 mb-1">
                              Suspension / Restriction Days
                            </label>
                            <input
                              type="number"
                              min={1}
                              max={30}
                              value={modDays}
                              onChange={(e) => setModDays(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
                              className="w-full min-h-[38px] px-2.5 rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-xs font-mono"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-neutral-500 mb-1">
                            Moderator Reason / Notice to User
                          </label>
                          <input
                            type="text"
                            value={modReason}
                            onChange={(e) => setModReason(e.target.value)}
                            placeholder="Explain policy violation or restoration note..."
                            className="w-full min-h-[38px] px-3 rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-xs"
                          />
                        </div>

                        <div className="flex flex-wrap gap-2 pt-1">
                          <button
                            type="button"
                            disabled={actionBusy}
                            onClick={() => handleModerate('warn')}
                            className="min-h-[38px] px-3 py-1.5 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-900 text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                          >
                            <AlertTriangle className="w-3.5 h-3.5" />
                            <span>Warn</span>
                          </button>

                          <button
                            type="button"
                            disabled={actionBusy}
                            onClick={() => handleModerate('restrict')}
                            className="min-h-[38px] px-3 py-1.5 rounded-lg bg-orange-100 hover:bg-orange-200 text-orange-900 text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                          >
                            <Clock className="w-3.5 h-3.5" />
                            <span>Restrict ({modDays}d)</span>
                          </button>

                          <button
                            type="button"
                            disabled={actionBusy}
                            onClick={() => handleModerate('suspend')}
                            className="min-h-[38px] px-3 py-1.5 rounded-lg bg-red-100 hover:bg-red-200 text-red-900 text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                          >
                            <Shield className="w-3.5 h-3.5" />
                            <span>Suspend ({modDays}d)</span>
                          </button>

                          <button
                            type="button"
                            disabled={actionBusy}
                            onClick={() => handleModerate('permanent_ban')}
                            className="min-h-[38px] px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                          >
                            <Ban className="w-3.5 h-3.5" />
                            <span>Perm Ban</span>
                          </button>

                          <button
                            type="button"
                            disabled={actionBusy}
                            onClick={() => handleModerate('restore')}
                            className="min-h-[38px] px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Restore</span>
                          </button>
                        </div>
                      </div>
                    )}

                    {/* History & Reports */}
                    <div className="space-y-2">
                      <h5 className="text-xs font-bold uppercase tracking-wider text-neutral-500">
                        Status & Strike History ({userDetail.bans.length})
                      </h5>
                      {userDetail.bans.length === 0 ? (
                        <p className="text-xs text-neutral-500">Clean standing — no prior enforcement actions.</p>
                      ) : (
                        <div className="space-y-1.5 max-h-48 overflow-y-auto">
                          {userDetail.bans.map((b) => (
                            <div
                              key={b.id}
                              className="p-2.5 rounded-lg bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-800 text-xs space-y-0.5"
                            >
                              <div className="flex justify-between font-bold capitalize">
                                <span>
                                  {b.action.replace('_', ' ')} ({b.rule_label || b.rule_broken})
                                </span>
                                <span className="font-mono text-neutral-500">Strike {b.strike_number}</span>
                              </div>
                              <p className="text-neutral-600 dark:text-neutral-300">{b.reason}</p>
                              <p className="text-[10px] text-neutral-400">
                                {new Date(b.created_at).toLocaleString()}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {userDetail.reports.length > 0 && (
                      <div className="space-y-1.5">
                        <h5 className="text-xs font-bold uppercase tracking-wider text-neutral-500">
                          User Reports ({userDetail.reports.length})
                        </h5>
                        <div className="space-y-1 max-h-28 overflow-y-auto">
                          {userDetail.reports.map((r: any) => (
                            <div
                              key={r.id}
                              className="p-2 rounded-lg bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-800 text-xs"
                            >
                              <span className="font-bold">{r.category}:</span> {r.description}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {activeTab === 'appeals' && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {(['pending', 'approved', 'rejected', 'all'] as const).map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setAppealFilter(st)}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-xs font-bold capitalize cursor-pointer',
                      appealFilter === st
                        ? 'bg-[#0095F6] text-white'
                        : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300'
                    )}
                  >
                    {st}
                  </button>
                ))}
              </div>

              {loading ? (
                <div className="py-12 flex items-center justify-center gap-2 text-xs text-neutral-500">
                  <Loader2 className="w-4 h-4 animate-spin text-[#0095F6]" />
                  <span>Loading appeals queue...</span>
                </div>
              ) : appeals.length === 0 ? (
                <div className="py-12 text-center border border-neutral-200 dark:border-neutral-800 rounded-xl text-xs text-neutral-500">
                  No appeals matching filter "{appealFilter}".
                </div>
              ) : (
                <div className="space-y-3">
                  {appeals.map((ap) => (
                    <div
                      key={ap.id}
                      className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/40 space-y-3"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <UserAvatar
                            src={ap.user?.avatar_url}
                            name={ap.user?.display_name || ap.user?.username}
                            id={ap.user_id}
                            className="w-9 h-9 rounded-full"
                          />
                          <div>
                            <p className="text-xs font-bold">
                              {ap.user?.display_name} (@{ap.user?.username})
                            </p>
                            <p className="text-[11px] text-neutral-500">
                              {ap.user?.email} • {ap.user?.strike_count} strikes • {ap.user?.rule_broken || 'policy'}
                            </p>
                          </div>
                        </div>
                        <span
                          className={cn(
                            'px-2.5 py-1 rounded-md text-xs font-bold capitalize self-start sm:self-auto',
                            ap.status === 'approved'
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                              : ap.status === 'rejected'
                                ? 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                                : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                          )}
                        >
                          {ap.status}
                        </span>
                      </div>

                      <div className="p-3 rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-xs space-y-1.5">
                        <p className="font-semibold text-neutral-700 dark:text-neutral-200">
                          User Appeal Statement:
                        </p>
                        <p className="text-neutral-600 dark:text-neutral-300 leading-relaxed">
                          {ap.reason}
                        </p>
                        {ap.verification_doc_url && (
                          <div className="pt-1.5 flex items-center gap-2">
                            <img
                              src={ap.verification_doc_url}
                              alt="Uploaded Verification"
                              className="h-20 rounded-lg border border-neutral-200 dark:border-neutral-700 object-cover"
                            />
                            <span className="text-[11px] text-[#0095F6] flex items-center gap-1 font-semibold">
                              <ExternalLink className="w-3 h-3" />
                              {ap.verification_doc_name || 'Verification Image'}
                            </span>
                          </div>
                        )}
                      </div>

                      {ap.status === 'pending' ? (
                        <div className="flex flex-col sm:flex-row gap-2">
                          <input
                            type="text"
                            value={appealNotes[ap.id] || ''}
                            onChange={(e) =>
                              setAppealNotes((prev) => ({ ...prev, [ap.id]: e.target.value }))
                            }
                            placeholder="Optional decision note sent to user..."
                            className="flex-1 min-h-[40px] px-3 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-xs"
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={actionBusy}
                              onClick={() => handleReviewAppeal(ap.id, 'approved')}
                              className="min-h-[40px] px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                            >
                              <CheckCircle2 className="w-4 h-4" />
                              <span>Approve & Restore</span>
                            </button>
                            <button
                              type="button"
                              disabled={actionBusy}
                              onClick={() => handleReviewAppeal(ap.id, 'rejected')}
                              className="min-h-[40px] px-3.5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                            >
                              <XCircle className="w-4 h-4" />
                              <span>Reject</span>
                            </button>
                          </div>
                        </div>
                      ) : ap.admin_note ? (
                        <p className="text-xs text-neutral-500">
                          <span className="font-semibold">Decision note:</span> {ap.admin_note}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'logs' && (
            <div className="space-y-3">
              {loading ? (
                <div className="py-12 flex items-center justify-center gap-2 text-xs text-neutral-500">
                  <Loader2 className="w-4 h-4 animate-spin text-[#0095F6]" />
                  <span>Loading audit logs...</span>
                </div>
              ) : auditLogs.length === 0 ? (
                <div className="py-12 text-center border border-neutral-200 dark:border-neutral-800 rounded-xl text-xs text-neutral-500">
                  No audit events recorded yet.
                </div>
              ) : (
                <div className="divide-y divide-neutral-100 dark:divide-neutral-800 border border-neutral-200 dark:border-neutral-800 rounded-xl overflow-hidden">
                  {auditLogs.map((log) => (
                    <div key={log.id} className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex items-center gap-2 font-bold">
                          <FileText className="w-3.5 h-3.5 text-[#0095F6] shrink-0" />
                          <span className="capitalize">{String(log.action).replace(/_/g, ' ')}</span>
                          <span className="text-neutral-400 font-normal">•</span>
                          <span className="font-mono text-neutral-600 dark:text-neutral-300 truncate">
                            target: @{log.target_username || log.target_user_id}
                          </span>
                        </div>
                        {log.reason && (
                          <p className="text-neutral-600 dark:text-neutral-400 truncate">{log.reason}</p>
                        )}
                      </div>
                      <div className="text-[11px] text-neutral-400 shrink-0 sm:text-right">
                        <div>by @{log.admin_username || log.admin_id}</div>
                        <div>{new Date(log.created_at).toLocaleString()}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <ModerationTemplatesModal
        isOpen={isTemplatesOpen}
        onClose={() => setIsTemplatesOpen(false)}
      />
    </div>
  );
};
