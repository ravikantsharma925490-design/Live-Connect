import React, { useCallback, useEffect, useState } from 'react';
import {
  Search,
  RefreshCw,
  BadgeCheck,
  ShieldAlert,
  Ban,
  Clock,
  CheckCircle2,
  LogOut,
  Trash2,
  X,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import { adminApi, AdminPermissions } from '@/src/lib/admin/adminApi';
import { VerifiedBadge } from '@/src/components/ui/VerifiedBadge';
import { UserAvatar } from '@/src/components/ui/UserAvatar';
import { cn } from '@/src/lib/utils';

interface AdminUsersViewProps {
  permissions: AdminPermissions;
}

export const AdminUsersView: React.FC<AdminUsersViewProps> = ({ permissions }) => {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [verifiedFilter, setVerifiedFilter] = useState('all');
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // User detail modal
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Action forms inside detail view
  const [actionMode, setActionMode] = useState<'none' | 'warn' | 'suspend' | 'ban' | 'delete'>('none');
  const [actionReason, setActionReason] = useState('');
  const [suspendDays, setSuspendDays] = useState('7');
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.getUsers({
        q: query.trim() || undefined,
        status: statusFilter !== 'all' ? statusFilter : undefined,
        verified: verifiedFilter !== 'all' ? verifiedFilter : undefined,
      });
      setUsers(res.users || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load users.');
    } finally {
      setLoading(false);
    }
  }, [query, statusFilter, verifiedFilter]);

  useEffect(() => {
    const t = setTimeout(() => {
      void fetchUsers();
    }, 200);
    return () => clearTimeout(t);
  }, [fetchUsers]);

  const openDetail = async (userId: string) => {
    setSelectedUserId(userId);
    setDetail(null);
    setActionMode('none');
    setActionReason('');
    setDetailLoading(true);
    try {
      const res = await adminApi.getUserDetail(userId);
      setDetail(res);
    } catch (err: any) {
      setError(err?.message || 'Could not load user details.');
      setSelectedUserId(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((prev) => (prev === msg ? null : prev)), 3000);
  };

  const handleModerationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserId || actionMode === 'none') return;
    setBusy('moderate');
    try {
      if (actionMode === 'delete') {
        await adminApi.deleteUser(selectedUserId, actionReason.trim() || 'Deleted by admin');
        setSelectedUserId(null);
        setDetail(null);
        notify('User account permanently deleted.');
        await fetchUsers();
        return;
      }

      const mappedAction =
        actionMode === 'ban' ? 'permanent_ban' : actionMode === 'suspend' ? 'suspend' : 'warn';
      await adminApi.moderateUser(selectedUserId, {
        action: mappedAction,
        reason: actionReason.trim() || 'Violation of Community Guidelines',
        durationDays: actionMode === 'suspend' ? Number(suspendDays || 7) : undefined,
      });
      setActionMode('none');
      setActionReason('');
      notify('Moderation action applied.');
      await openDetail(selectedUserId);
      await fetchUsers();
    } catch (err: any) {
      setError(err?.message || 'Moderation action failed.');
    } finally {
      setBusy(null);
    }
  };

  const handleRestoreUser = async () => {
    if (!selectedUserId) return;
    setBusy('restore');
    try {
      await adminApi.moderateUser(selectedUserId, {
        action: 'restore',
        reason: 'Unbanned / restored by staff',
      });
      notify('User account restored.');
      await openDetail(selectedUserId);
      await fetchUsers();
    } catch (err: any) {
      setError(err?.message || 'Failed to restore user.');
    } finally {
      setBusy(null);
    }
  };

  const handleToggleVerified = async () => {
    if (!selectedUserId || !detail?.user) return;
    const nextVal = !Boolean(detail.user.isVerified || detail.profile?.is_verified);
    setBusy('verify');
    try {
      await adminApi.toggleVerifyUser(selectedUserId, nextVal);
      notify(nextVal ? 'Verified badge granted.' : 'Verified badge removed.');
      await openDetail(selectedUserId);
      await fetchUsers();
    } catch (err: any) {
      setError(err?.message || 'Failed to update verified badge.');
    } finally {
      setBusy(null);
    }
  };

  const handleForceLogout = async () => {
    if (!selectedUserId) return;
    setBusy('logout');
    try {
      await adminApi.forceLogoutUser(selectedUserId, 'Forced session revocation by Super Admin');
      notify('User logged out from all devices.');
      await openDetail(selectedUserId);
    } catch (err: any) {
      setError(err?.message || 'Failed to force logout.');
    } finally {
      setBusy(null);
    }
  };

  const statusBadge = (status: string) => {
    if (status === 'active') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400';
    if (status === 'suspended') return 'bg-amber-500/10 text-amber-700 dark:text-amber-400';
    if (status === 'disabled') return 'bg-rose-500/10 text-rose-700 dark:text-rose-400';
    return 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300';
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Users ({users.length})
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Search by name, @username, email, or phone number
          </p>
        </div>
        <button
          type="button"
          onClick={() => void fetchUsers()}
          className="self-start sm:self-auto px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-semibold flex items-center gap-1.5 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          <span>Refresh</span>
        </button>
      </div>

      {toast && (
        <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
          {toast}
        </div>
      )}
      {error && (
        <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* Search & Filters */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5">
        <div className="md:col-span-2 relative">
          <Search className="w-4 h-4 text-slate-400 absolute start-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, @username, email, phone..."
            className="w-full ps-10 pr-3.5 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200"
        >
          <option value="all">All Statuses</option>
          <option value="active">Active</option>
          <option value="restricted">Restricted</option>
          <option value="suspended">Suspended</option>
          <option value="disabled">Banned</option>
        </select>

        <select
          value={verifiedFilter}
          onChange={(e) => setVerifiedFilter(e.target.value)}
          className="px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200"
        >
          <option value="all">All Verification</option>
          <option value="verified">Verified Only</option>
          <option value="unverified">Unverified Only</option>
        </select>
      </div>

      {/* Users Table */}
      <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
        {loading && users.length === 0 ? (
          <div className="py-12 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
          </div>
        ) : users.length === 0 ? (
          <p className="py-12 text-center text-xs text-slate-400">No users matched your filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/40">
                  <th className="py-2.5 px-4 text-start font-semibold">User</th>
                  <th className="py-2.5 px-3 text-start font-semibold hidden md:table-cell">Contact</th>
                  <th className="py-2.5 px-3 text-start font-semibold">Status</th>
                  <th className="py-2.5 px-3 text-end font-semibold hidden sm:table-cell">Warnings</th>
                  <th className="py-2.5 px-3 text-end font-semibold hidden lg:table-cell">Joined</th>
                  <th className="py-2.5 px-4 text-end font-semibold">Inspect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {users.map((u) => (
                  <tr
                    key={u.id}
                    onClick={() => void openDetail(u.id)}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 cursor-pointer transition-colors"
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <UserAvatar
                          src={u.avatarUrl}
                          name={u.displayName || u.username}
                          id={u.id}
                          className="w-8 h-8 rounded-lg shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1 font-semibold text-slate-900 dark:text-slate-100">
                            <span className="truncate max-w-[160px]">{u.displayName}</span>
                            {u.isVerified && <VerifiedBadge size="xs" />}
                          </div>
                          <div className="text-[11px] font-mono text-slate-400 truncate max-w-[160px]">
                            @{u.username}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-3 hidden md:table-cell text-slate-600 dark:text-slate-300">
                      <div className="truncate max-w-[200px]">{u.email || '—'}</div>
                      {u.phone && <div className="text-[11px] text-slate-400">{u.phone}</div>}
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={cn(
                          'inline-block px-2 py-0.5 rounded-md text-[10px] font-bold uppercase',
                          statusBadge(u.status)
                        )}
                      >
                        {u.status === 'disabled' ? 'banned' : u.status}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-end hidden sm:table-cell tabular-nums font-semibold text-slate-700 dark:text-slate-300">
                      {u.warningsCount ?? 0}
                    </td>
                    <td className="py-3 px-3 text-end hidden lg:table-cell text-slate-400 tabular-nums">
                      {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}
                    </td>
                    <td className="py-3 px-4 text-end">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void openDetail(u.id);
                        }}
                        className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-blue-600 hover:text-white text-[11px] font-semibold cursor-pointer transition-colors"
                      >
                        Manage
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* User Detail Modal */}
      {selectedUserId && (
        <div
          onClick={() => setSelectedUserId(null)}
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/65 backdrop-blur-sm animate-in fade-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
          >
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">User Details</h3>
              <button
                type="button"
                onClick={() => setSelectedUserId(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {detailLoading || !detail ? (
                <div className="py-12 flex justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                </div>
              ) : (
                <>
                  {/* Profile Summary */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
                    <div className="flex items-center gap-3.5 min-w-0">
                      <UserAvatar
                        src={detail.profile?.avatar_url}
                        name={detail.profile?.display_name || detail.user?.email || 'User'}
                        id={selectedUserId}
                        className="w-14 h-14 rounded-xl shrink-0"
                      />
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h4 className="text-base font-bold text-slate-900 dark:text-slate-100 truncate">
                            {detail.profile?.display_name || 'User'}
                          </h4>
                          {detail.user?.isVerified && <VerifiedBadge size="sm" />}
                          <span
                            className={cn(
                              'px-2 py-0.5 rounded-md text-[10px] font-bold uppercase',
                              statusBadge(detail.user?.status || 'active')
                            )}
                          >
                            {detail.user?.status === 'disabled' ? 'banned' : detail.user?.status}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate">
                          @{detail.profile?.username || 'user'} · {detail.user?.email || 'No email'}
                        </p>
                        <p className="text-[11px] text-slate-400 tabular-nums">
                          Joined {detail.user?.created_at ? new Date(detail.user.created_at).toLocaleDateString() : '—'}
                          {' · '}
                          Last active{' '}
                          {detail.user?.last_active_at || detail.profile?.last_seen
                            ? new Date(detail.user?.last_active_at || detail.profile?.last_seen).toLocaleString()
                            : '—'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Key Counters */}
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
                      <p className="text-[11px] text-slate-500">Warnings</p>
                      <p className="text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100">
                        {detail.warningsCount ?? 0}
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
                      <p className="text-[11px] text-slate-500">Families Joined</p>
                      <p className="text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100">
                        {(detail.familiesJoined || []).length}
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
                      <p className="text-[11px] text-slate-500">Reports Against</p>
                      <p className="text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100">
                        {(detail.reports || []).length}
                      </p>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-wrap gap-2">
                    {permissions.usersManage && (
                      <>
                        <button
                          type="button"
                          disabled={Boolean(busy)}
                          onClick={handleToggleVerified}
                          className="px-3 py-1.5 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-700 dark:text-sky-300 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                        >
                          <BadgeCheck className="w-3.5 h-3.5" />
                          <span>{detail.user?.isVerified ? 'Remove Verified' : 'Give Verified'}</span>
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(busy)}
                          onClick={handleForceLogout}
                          className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                          <span>Force Logout</span>
                        </button>
                      </>
                    )}

                    {(permissions.reports || permissions.usersManage) && (
                      <>
                        <button
                          type="button"
                          onClick={() => setActionMode('warn')}
                          className="px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                        >
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span>Warn</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setActionMode('suspend')}
                          className="px-3 py-1.5 rounded-lg bg-orange-500/10 hover:bg-orange-500/20 text-orange-700 dark:text-orange-300 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                        >
                          <Clock className="w-3.5 h-3.5" />
                          <span>Suspend</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setActionMode('ban')}
                          className="px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-700 dark:text-rose-300 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                        >
                          <Ban className="w-3.5 h-3.5" />
                          <span>Permanent Ban</span>
                        </button>
                        {detail.user?.status !== 'active' && (
                          <button
                            type="button"
                            disabled={Boolean(busy)}
                            onClick={handleRestoreUser}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Unban / Restore</span>
                          </button>
                        )}
                      </>
                    )}

                    {permissions.usersManage && (
                      <button
                        type="button"
                        onClick={() => setActionMode('delete')}
                        className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete Account</span>
                      </button>
                    )}
                  </div>

                  {/* Inline Action Form */}
                  {actionMode !== 'none' && (
                    <form
                      onSubmit={handleModerationSubmit}
                      className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                          {actionMode === 'warn'
                            ? 'Send Warning'
                            : actionMode === 'suspend'
                              ? 'Suspend Account'
                              : actionMode === 'ban'
                                ? 'Permanent Ban'
                                : 'Permanently Delete Account'}
                        </span>
                        <button
                          type="button"
                          onClick={() => setActionMode('none')}
                          className="text-xs text-slate-400 hover:text-slate-600 cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>

                      {actionMode === 'suspend' && (
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                            Suspension Days (auto-unsuspends after expiry)
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={365}
                            value={suspendDays}
                            onChange={(e) => setSuspendDays(e.target.value)}
                            className="w-32 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs tabular-nums"
                          />
                        </div>
                      )}

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                          Reason
                        </label>
                        <input
                          type="text"
                          required
                          value={actionReason}
                          onChange={(e) => setActionReason(e.target.value)}
                          placeholder="Explain the reason clearly..."
                          className="w-full px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs"
                        />
                      </div>

                      <div className="flex justify-end">
                        <button
                          type="submit"
                          disabled={busy === 'moderate'}
                          className={cn(
                            'px-4 py-2 rounded-lg text-white text-xs font-bold cursor-pointer disabled:opacity-50',
                            actionMode === 'delete' || actionMode === 'ban'
                              ? 'bg-rose-600 hover:bg-rose-700'
                              : 'bg-blue-600 hover:bg-blue-700'
                          )}
                        >
                          {busy === 'moderate' ? 'Applying...' : 'Confirm Action'}
                        </button>
                      </div>
                    </form>
                  )}

                  {/* Families Joined */}
                  {(detail.familiesJoined || []).length > 0 && (
                    <div className="space-y-2">
                      <h5 className="text-xs font-bold text-slate-700 dark:text-slate-300">
                        Families Joined
                      </h5>
                      <div className="flex flex-wrap gap-1.5">
                        {detail.familiesJoined.map((f: any) => (
                          <span
                            key={f.familyId}
                            className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] text-slate-700 dark:text-slate-200"
                          >
                            {f.familyName} · <span className="capitalize text-slate-500">{f.role}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Warnings History */}
                  {(detail.warnings || []).length > 0 && (
                    <div className="space-y-2">
                      <h5 className="text-xs font-bold text-slate-700 dark:text-slate-300">
                        Recent Warnings
                      </h5>
                      <div className="space-y-1.5">
                        {detail.warnings.slice(0, 8).map((w: any) => (
                          <div
                            key={w.id}
                            className="p-2.5 rounded-lg bg-amber-50/70 dark:bg-amber-950/25 border border-amber-200/60 dark:border-amber-900/50 text-xs flex items-center justify-between gap-2"
                          >
                            <span className="text-slate-800 dark:text-slate-200">
                              #{w.strikeNumber}: {w.reason}
                            </span>
                            <span className="text-[10px] text-slate-400 shrink-0 tabular-nums">
                              {new Date(w.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
