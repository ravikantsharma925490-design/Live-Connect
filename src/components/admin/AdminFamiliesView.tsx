import React, { useCallback, useEffect, useState } from 'react';
import {
  Search,
  RefreshCw,
  Home,
  Crown,
  Shield,
  Users,
  PauseCircle,
  PlayCircle,
  Trash2,
  UserMinus,
  ArrowRightLeft,
  X,
  Loader2,
} from 'lucide-react';
import { adminApi } from '@/src/lib/admin/adminApi';
import { cn } from '@/src/lib/utils';

export const AdminFamiliesView: React.FC = () => {
  const [query, setQuery] = useState('');
  const [families, setFamilies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Selected family modal
  const [selectedFamily, setSelectedFamily] = useState<any | null>(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [members, setMembers] = useState<any[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [suspendReason, setSuspendReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const loadFamilies = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.getFamilies(query.trim() || undefined);
      setFamilies(res.families || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load families.');
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    const t = setTimeout(() => {
      void loadFamilies();
    }, 200);
    return () => clearTimeout(t);
  }, [loadFamilies]);

  const loadMembers = useCallback(async (familyId: string, q?: string) => {
    setMembersLoading(true);
    try {
      const res = await adminApi.getFamilyMembers(familyId, q?.trim() || undefined);
      setMembers(res.members || []);
    } catch (err: any) {
      setError(err?.message || 'Could not load Family members.');
    } finally {
      setMembersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedFamily?.id) return;
    const t = setTimeout(() => {
      void loadMembers(selectedFamily.id, memberSearch);
    }, 180);
    return () => clearTimeout(t);
  }, [selectedFamily?.id, memberSearch, loadMembers]);

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((prev) => (prev === msg ? null : prev)), 3000);
  };

  const handleToggleSuspend = async (fam: any) => {
    setBusy('suspend');
    try {
      const next = !fam.isSuspended;
      await adminApi.suspendFamily(
        fam.id,
        next,
        next ? suspendReason.trim() || 'Suspended by Super Admin' : undefined
      );
      notify(next ? 'Family suspended.' : 'Family unsuspended.');
      setSelectedFamily((prev: any) => (prev ? { ...prev, isSuspended: next } : null));
      await loadFamilies();
    } catch (err: any) {
      setError(err?.message || 'Failed to update Family suspension.');
    } finally {
      setBusy(null);
    }
  };

  const handleDeleteFamily = async (fam: any) => {
    setBusy('delete');
    try {
      await adminApi.deleteFamily(fam.id, 'Deleted by Super Admin');
      setSelectedFamily(null);
      notify('Family permanently deleted.');
      await loadFamilies();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete Family.');
    } finally {
      setBusy(null);
    }
  };

  const handleRemoveMember = async (member: any) => {
    if (!selectedFamily) return;
    setBusy(`rem_${member.userId}`);
    try {
      await adminApi.removeFamilyMember(selectedFamily.id, member.userId);
      notify(`Removed ${member.displayName} from Family.`);
      await loadMembers(selectedFamily.id, memberSearch);
      await loadFamilies();
    } catch (err: any) {
      setError(err?.message || 'Failed to remove member.');
    } finally {
      setBusy(null);
    }
  };

  const handleTransferOwner = async (member: any) => {
    if (!selectedFamily) return;
    setBusy(`owner_${member.userId}`);
    try {
      await adminApi.transferFamilyOwner(selectedFamily.id, member.userId);
      notify(`Ownership transferred to ${member.displayName}.`);
      setSelectedFamily((prev: any) => (prev ? { ...prev, ownerId: member.userId } : null));
      await loadMembers(selectedFamily.id, memberSearch);
      await loadFamilies();
    } catch (err: any) {
      setError(err?.message || 'Failed to transfer ownership.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Family Management ({families.length})
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Inspect groups, manage members, transfer ownership, suspend, or delete
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadFamilies()}
          className="self-start sm:self-auto px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
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

      <div className="relative max-w-md">
        <Search className="w-4 h-4 text-slate-400 absolute start-3.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search families by name or owner..."
          className="w-full ps-10 pr-3.5 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs"
        />
      </div>

      <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
        {loading && families.length === 0 ? (
          <div className="py-12 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
          </div>
        ) : families.length === 0 ? (
          <p className="py-12 text-center text-xs text-slate-400">No Family groups found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 bg-slate-50/70 dark:bg-slate-950/40">
                  <th className="py-2.5 px-4 text-start font-semibold">Family</th>
                  <th className="py-2.5 px-3 text-start font-semibold hidden md:table-cell">Owner</th>
                  <th className="py-2.5 px-3 text-end font-semibold">Members</th>
                  <th className="py-2.5 px-3 text-end font-semibold hidden sm:table-cell">Admins</th>
                  <th className="py-2.5 px-3 text-start font-semibold">Status</th>
                  <th className="py-2.5 px-4 text-end font-semibold">Manage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {families.map((f) => (
                  <tr
                    key={f.id}
                    onClick={() => {
                      setSelectedFamily(f);
                      setMemberSearch('');
                      setSuspendReason(f.suspendedReason || '');
                    }}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 cursor-pointer"
                  >
                    <td className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">
                      <div className="flex items-center gap-2">
                        <Home className="w-4 h-4 text-blue-500 shrink-0" />
                        <span className="truncate max-w-[200px]">{f.name}</span>
                      </div>
                    </td>
                    <td className="py-3 px-3 hidden md:table-cell text-slate-500">
                      {f.ownerName} <span className="font-mono text-[11px]">(@{f.ownerUsername})</span>
                    </td>
                    <td className="py-3 px-3 text-end tabular-nums font-semibold">
                      {Number(f.memberCount || 0).toLocaleString()}
                    </td>
                    <td className="py-3 px-3 text-end tabular-nums hidden sm:table-cell">
                      {f.adminsCount ?? 0}
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={cn(
                          'px-2 py-0.5 rounded-md text-[10px] font-bold uppercase',
                          f.isSuspended
                            ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                            : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        )}
                      >
                        {f.isSuspended ? 'Suspended' : 'Active'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-end">
                      <button
                        type="button"
                        className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] font-semibold cursor-pointer"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Family Detail Modal */}
      {selectedFamily && (
        <div
          onClick={() => setSelectedFamily(null)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm animate-in fade-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
          >
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {selectedFamily.name}
                </h3>
                <p className="text-[11px] text-slate-500">
                  {Number(selectedFamily.memberCount || 0).toLocaleString()} members · Owner: {selectedFamily.ownerName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedFamily(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Controls */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-3">
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={suspendReason}
                    onChange={(e) => setSuspendReason(e.target.value)}
                    placeholder="Suspension reason (optional)"
                    className="flex-1 px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs"
                  />
                  <button
                    type="button"
                    disabled={busy === 'suspend'}
                    onClick={() => void handleToggleSuspend(selectedFamily)}
                    className={cn(
                      'px-3.5 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer shrink-0',
                      selectedFamily.isSuspended
                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                        : 'bg-amber-600 hover:bg-amber-700 text-white'
                    )}
                  >
                    {selectedFamily.isSuspended ? (
                      <>
                        <PlayCircle className="w-3.5 h-3.5" />
                        <span>Unsuspend Family</span>
                      </>
                    ) : (
                      <>
                        <PauseCircle className="w-3.5 h-3.5" />
                        <span>Suspend Family</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    disabled={busy === 'delete'}
                    onClick={() => void handleDeleteFamily(selectedFamily)}
                    className="px-3.5 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Family</span>
                  </button>
                </div>
              </div>

              {/* Members Search */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5" />
                    <span>Members</span>
                  </h4>
                  <input
                    type="text"
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    placeholder="Filter members..."
                    className="w-48 px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
                  />
                </div>

                {membersLoading ? (
                  <div className="py-8 flex justify-center">
                    <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                  </div>
                ) : members.length === 0 ? (
                  <p className="py-6 text-center text-xs text-slate-400">No members found.</p>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                    {members.map((m) => (
                      <div
                        key={m.userId}
                        className="px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
                            <span className="truncate">{m.displayName}</span>
                            {m.role === 'owner' && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 text-[10px] font-bold">
                                <Crown className="w-2.5 h-2.5" /> Owner
                              </span>
                            )}
                            {m.role === 'admin' && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-700 dark:text-blue-300 text-[10px] font-bold">
                                <Shield className="w-2.5 h-2.5" /> Admin
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] font-mono text-slate-400">@{m.username}</p>
                        </div>

                        {m.role !== 'owner' && (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              disabled={Boolean(busy)}
                              onClick={() => void handleTransferOwner(m)}
                              title="Make Owner"
                              className="px-2 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 text-[10.5px] font-semibold flex items-center gap-1 cursor-pointer"
                            >
                              <ArrowRightLeft className="w-3 h-3" />
                              <span>Make Owner</span>
                            </button>
                            <button
                              type="button"
                              disabled={Boolean(busy)}
                              onClick={() => void handleRemoveMember(m)}
                              title="Remove Member"
                              className="px-2 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-700 dark:text-rose-300 text-[10.5px] font-semibold flex items-center gap-1 cursor-pointer"
                            >
                              <UserMinus className="w-3 h-3" />
                              <span>Remove</span>
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
