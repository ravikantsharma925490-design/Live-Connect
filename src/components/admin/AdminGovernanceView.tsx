import React, { useEffect, useState, useCallback } from 'react';
import {
  ShieldBan,
  Plus,
  Trash2,
  Edit3,
  Check,
  X,
  FileText,
  Search,
  RefreshCw,
  Wrench,
  AlertTriangle,
  KeyRound,
  UserCog,
  Crown,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import { adminApi, reauthenticateGoogleFresh } from '@/src/lib/admin/adminApi';
import { cn } from '@/src/lib/utils';

export type GovernanceSection = 'banned_words' | 'logs' | 'roles' | 'settings';

interface AdminGovernanceViewProps {
  section: GovernanceSection;
  currentEmail?: string;
}

const LOG_ACTION_OPTIONS = [
  { value: '', label: 'All Actions' },
  { value: 'pin_setup', label: 'PIN Setup' },
  { value: 'pin_verified', label: 'PIN Verified' },
  { value: 'pin_changed', label: 'PIN Changed' },
  { value: 'pin_locked', label: 'PIN Lockout' },
  { value: 'user_warn', label: 'User Warned' },
  { value: 'user_suspend', label: 'User Suspended' },
  { value: 'user_permanent_ban', label: 'User Banned' },
  { value: 'user_restore', label: 'User Unbanned' },
  { value: 'user_force_logout', label: 'Force Logout' },
  { value: 'user_verify', label: 'Verified Badge' },
  { value: 'user_delete', label: 'User Deleted' },
  { value: 'report_resolved', label: 'Report Resolved' },
  { value: 'report_rejected', label: 'Report Rejected' },
  { value: 'family_suspend', label: 'Family Suspended' },
  { value: 'family_unsuspend', label: 'Family Unsuspended' },
  { value: 'family_delete', label: 'Family Deleted' },
  { value: 'family_member_removed', label: 'Member Removed' },
  { value: 'family_owner_transferred', label: 'Owner Transferred' },
  { value: 'appeal_approved', label: 'Appeal Approved' },
  { value: 'appeal_rejected', label: 'Appeal Rejected' },
  { value: 'official_chat_sent', label: 'Official Chat Sent' },
  { value: 'official_chat_deleted', label: 'Official Chat Deleted' },
  { value: 'official_chat_access_updated', label: 'Official Chat Access' },
  { value: 'banned_word_added', label: 'Word Added' },
  { value: 'banned_word_updated', label: 'Word Updated' },
  { value: 'banned_word_deleted', label: 'Word Deleted' },
  { value: 'role_assigned', label: 'Role Assigned' },
  { value: 'maintenance_updated', label: 'Maintenance Updated' },
  { value: 'warning_settings_updated', label: 'Warning Rules Updated' },
  { value: 'ticket_replied', label: 'Ticket Replied' },
  { value: 'ticket_status_updated', label: 'Ticket Status Updated' },
];

export const AdminGovernanceView: React.FC<AdminGovernanceViewProps> = ({
  section,
  currentEmail,
}) => {
  // Feedback banner
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const flash = (kind: 'ok' | 'err', text: string) => {
    setNotice({ kind, text });
    setTimeout(() => setNotice(null), 4000);
  };

  // ==================== BANNED WORDS ====================
  const [words, setWords] = useState<any[]>([]);
  const [wordsLoading, setWordsLoading] = useState(false);
  const [newWord, setNewWord] = useState('');
  const [newMatchMode, setNewMatchMode] = useState<'substring' | 'exact'>('substring');
  const [newAction, setNewAction] = useState<'block' | 'flag'>('block');
  const [wordSaving, setWordSaving] = useState(false);
  const [editingWordId, setEditingWordId] = useState<string | null>(null);
  const [editWordText, setEditWordText] = useState('');
  const [editMatchMode, setEditMatchMode] = useState<'substring' | 'exact'>('substring');
  const [editAction, setEditAction] = useState<'block' | 'flag'>('block');

  const loadWords = useCallback(async () => {
    setWordsLoading(true);
    try {
      const res = await adminApi.getBannedWords();
      setWords(res.words || []);
    } catch (err: any) {
      flash('err', err?.message || 'Failed to load banned words.');
    } finally {
      setWordsLoading(false);
    }
  }, []);

  const handleAddWord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWord.trim()) return;
    setWordSaving(true);
    try {
      await adminApi.createBannedWord(newWord.trim(), newMatchMode, newAction);
      setNewWord('');
      flash('ok', 'Word rule added.');
      await loadWords();
    } catch (err: any) {
      flash('err', err?.message || 'Could not add word.');
    } finally {
      setWordSaving(false);
    }
  };

  const handleSaveEditWord = async (wordId: string) => {
    if (!editWordText.trim()) return;
    setWordSaving(true);
    try {
      await adminApi.updateBannedWord(wordId, {
        word: editWordText.trim(),
        matchMode: editMatchMode,
        action: editAction,
      });
      setEditingWordId(null);
      flash('ok', 'Word rule updated.');
      await loadWords();
    } catch (err: any) {
      flash('err', err?.message || 'Could not update word.');
    } finally {
      setWordSaving(false);
    }
  };

  const handleDeleteWord = async (wordId: string) => {
    setWordSaving(true);
    try {
      await adminApi.deleteBannedWord(wordId);
      flash('ok', 'Word rule removed.');
      await loadWords();
    } catch (err: any) {
      flash('err', err?.message || 'Could not remove word.');
    } finally {
      setWordSaving(false);
    }
  };

  // ==================== ACTIVITY LOGS ====================
  const [logs, setLogs] = useState<any[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logQuery, setLogQuery] = useState('');
  const [logActionFilter, setLogActionFilter] = useState('');

  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const res = await adminApi.getLogs({ q: logQuery.trim(), action: logActionFilter });
      setLogs(res.logs || []);
    } catch (err: any) {
      flash('err', err?.message || 'Failed to load activity logs.');
    } finally {
      setLogsLoading(false);
    }
  }, [logQuery, logActionFilter]);

  // ==================== ADMIN ROLES ====================
  const [admins, setAdmins] = useState<any[]>([]);
  const [superAdminEmail, setSuperAdminEmail] = useState('');
  const [rolesLoading, setRolesLoading] = useState(false);
  const [roleIdentifier, setRoleIdentifier] = useState('');
  const [roleChoice, setRoleChoice] = useState<'moderator' | 'support'>('moderator');
  const [roleBusy, setRoleBusy] = useState(false);

  const loadRoles = useCallback(async () => {
    setRolesLoading(true);
    try {
      const res = await adminApi.getRoles();
      setAdmins(res.admins || []);
      setSuperAdminEmail(res.superAdminEmail || '');
    } catch (err: any) {
      flash('err', err?.message || 'Failed to load admin roles.');
    } finally {
      setRolesLoading(false);
    }
  }, []);

  const handleAssignRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roleIdentifier.trim()) return;
    setRoleBusy(true);
    try {
      await adminApi.assignRole({ identifier: roleIdentifier.trim(), role: roleChoice });
      setRoleIdentifier('');
      flash('ok', `Assigned ${roleChoice} role.`);
      await loadRoles();
    } catch (err: any) {
      flash('err', err?.message || 'Could not assign role.');
    } finally {
      setRoleBusy(false);
    }
  };

  const handleDemoteRole = async (userId: string) => {
    setRoleBusy(true);
    try {
      await adminApi.assignRole({ userId, role: 'none' });
      flash('ok', 'Admin role removed.');
      await loadRoles();
    } catch (err: any) {
      flash('err', err?.message || 'Could not remove role.');
    } finally {
      setRoleBusy(false);
    }
  };

  // ==================== SETTINGS & CHANGE PIN ====================
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState('');
  const [warningThreshold, setWarningThreshold] = useState(3);
  const [warningAutoAction, setWarningAutoAction] = useState<'suspend' | 'ban'>('suspend');
  const [warningSuspendDays, setWarningSuspendDays] = useState(7);
  const [settingsBusy, setSettingsBusy] = useState<string | null>(null);

  const [reauthedForPin, setReauthedForPin] = useState(false);
  const [reauthBusy, setReauthBusy] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [confirmNewPin, setConfirmNewPin] = useState('');
  const [pinBusy, setPinBusy] = useState(false);

  const loadSettings = useCallback(async () => {
    setSettingsLoading(true);
    try {
      const s = await adminApi.getSettings();
      setMaintenanceMode(Boolean(s.maintenanceMode));
      setMaintenanceMessage(String(s.maintenanceMessage || ''));
      setWarningThreshold(Number(s.warningThreshold || 3));
      setWarningAutoAction(s.warningAutoAction === 'ban' ? 'ban' : 'suspend');
      setWarningSuspendDays(Number(s.warningSuspendDays || 7));
    } catch (err: any) {
      flash('err', err?.message || 'Failed to load settings.');
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  const handleSaveMaintenance = async () => {
    setSettingsBusy('maintenance');
    try {
      await adminApi.updateMaintenance(maintenanceMode, maintenanceMessage);
      flash('ok', maintenanceMode ? 'Maintenance mode enabled.' : 'Maintenance mode disabled.');
    } catch (err: any) {
      flash('err', err?.message || 'Failed to save maintenance mode.');
    } finally {
      setSettingsBusy(null);
    }
  };

  const handleSaveWarningRules = async (e: React.FormEvent) => {
    e.preventDefault();
    setSettingsBusy('warnings');
    try {
      await adminApi.updateWarningSettings({
        warningThreshold: Math.max(1, Number(warningThreshold) || 3),
        warningAutoAction,
        warningSuspendDays: Math.max(1, Number(warningSuspendDays) || 7),
      });
      flash('ok', 'Warning auto-escalation rules saved.');
    } catch (err: any) {
      flash('err', err?.message || 'Failed to save warning rules.');
    } finally {
      setSettingsBusy(null);
    }
  };

  const handleGoogleReauth = async () => {
    setReauthBusy(true);
    try {
      await reauthenticateGoogleFresh();
      setReauthedForPin(true);
      flash('ok', 'Google verification confirmed. Enter your new 6-digit PIN.');
    } catch (err: any) {
      flash('err', err?.message || 'Google re-authentication failed or was cancelled.');
    } finally {
      setReauthBusy(false);
    }
  };

  const handleSubmitChangePin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(newPin)) {
      flash('err', 'PIN must be exactly 6 numeric digits.');
      return;
    }
    if (newPin !== confirmNewPin) {
      flash('err', 'PIN confirmation does not match.');
      return;
    }
    setPinBusy(true);
    try {
      await adminApi.changePin(newPin, confirmNewPin, 'change');
      setNewPin('');
      setConfirmNewPin('');
      setReauthedForPin(false);
      flash('ok', 'Admin PIN changed successfully.');
    } catch (err: any) {
      flash('err', err?.message || 'Could not update PIN.');
    } finally {
      setPinBusy(false);
    }
  };

  // Load section data when section changes
  useEffect(() => {
    if (section === 'banned_words') void loadWords();
    if (section === 'logs') void loadLogs();
    if (section === 'roles') void loadRoles();
    if (section === 'settings') void loadSettings();
  }, [section, loadWords, loadLogs, loadRoles, loadSettings]);

  return (
    <div className="space-y-5">
      {notice && (
        <div
          className={cn(
            'px-4 py-2.5 rounded-lg border text-sm font-medium',
            notice.kind === 'ok'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300'
              : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300'
          )}
        >
          {notice.text}
        </div>
      )}

      {/* ==================== BANNED WORDS ==================== */}
      {section === 'banned_words' && (
        <div className="space-y-5">
          <form
            onSubmit={handleAddWord}
            className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-5"
          >
            <div className="flex items-center gap-2 mb-3">
              <ShieldBan className="w-4 h-4 text-rose-600 dark:text-rose-400" />
              <h2 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
                Add Banned or Flagged Word
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <input
                type="text"
                value={newWord}
                onChange={(e) => setNewWord(e.target.value)}
                required
                placeholder="Enter word or phrase..."
                className="sm:col-span-5 px-3 py-2 rounded-lg bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
              <select
                value={newMatchMode}
                onChange={(e) => setNewMatchMode(e.target.value as 'substring' | 'exact')}
                className="sm:col-span-3 px-3 py-2 rounded-lg bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 text-sm text-neutral-900 dark:text-neutral-100"
              >
                <option value="substring">Contains (Substring)</option>
                <option value="exact">Exact Word</option>
              </select>
              <select
                value={newAction}
                onChange={(e) => setNewAction(e.target.value as 'block' | 'flag')}
                className="sm:col-span-2 px-3 py-2 rounded-lg bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 text-sm text-neutral-900 dark:text-neutral-100"
              >
                <option value="block">Block</option>
                <option value="flag">Flag</option>
              </select>
              <button
                type="submit"
                disabled={wordSaving}
                className="sm:col-span-2 py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Add</span>
              </button>
            </div>
          </form>

          <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
                Active Word Rules ({words.length})
              </h3>
              <button
                type="button"
                onClick={() => void loadWords()}
                className="text-xs font-semibold text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 inline-flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className={cn('w-3.5 h-3.5', wordsLoading && 'animate-spin')} />
                Refresh
              </button>
            </div>
            {words.length === 0 ? (
              <p className="text-sm text-neutral-500 py-8 text-center">No banned words configured.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 dark:border-neutral-800 text-xs uppercase text-neutral-500">
                      <th className="py-2.5 px-5 font-semibold">Word / Phrase</th>
                      <th className="py-2.5 px-4 font-semibold">Match Mode</th>
                      <th className="py-2.5 px-4 font-semibold">Action</th>
                      <th className="py-2.5 px-5 font-semibold text-right">Controls</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
                    {words.map((w) => {
                      const isEditing = editingWordId === w.id;
                      return (
                        <tr key={w.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/40">
                          <td className="py-3 px-5 font-medium text-neutral-900 dark:text-neutral-100">
                            {isEditing ? (
                              <input
                                type="text"
                                value={editWordText}
                                onChange={(e) => setEditWordText(e.target.value)}
                                className="px-2.5 py-1 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-sm w-full max-w-xs"
                              />
                            ) : (
                              w.word
                            )}
                          </td>
                          <td className="py-3 px-4 text-neutral-600 dark:text-neutral-300">
                            {isEditing ? (
                              <select
                                value={editMatchMode}
                                onChange={(e) => setEditMatchMode(e.target.value as 'substring' | 'exact')}
                                className="px-2 py-1 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-xs"
                              >
                                <option value="substring">Substring</option>
                                <option value="exact">Exact Word</option>
                              </select>
                            ) : (
                              <span className="capitalize">{w.matchMode || w.match_mode}</span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            {isEditing ? (
                              <select
                                value={editAction}
                                onChange={(e) => setEditAction(e.target.value as 'block' | 'flag')}
                                className="px-2 py-1 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-xs"
                              >
                                <option value="block">Block</option>
                                <option value="flag">Flag</option>
                              </select>
                            ) : (
                              <span
                                className={cn(
                                  'px-2 py-0.5 rounded text-xs font-semibold uppercase',
                                  w.action === 'block'
                                    ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300'
                                    : 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300'
                                )}
                              >
                                {w.action}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-5 text-right">
                            {isEditing ? (
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => void handleSaveEditWord(w.id)}
                                  className="p-1.5 rounded bg-emerald-600 text-white cursor-pointer"
                                  title="Save"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingWordId(null)}
                                  className="p-1.5 rounded bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-200 cursor-pointer"
                                  title="Cancel"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingWordId(w.id);
                                    setEditWordText(w.word);
                                    setEditMatchMode((w.matchMode || w.match_mode) === 'exact' ? 'exact' : 'substring');
                                    setEditAction(w.action === 'flag' ? 'flag' : 'block');
                                  }}
                                  className="p-1.5 rounded text-neutral-500 hover:text-blue-600 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
                                  title="Edit"
                                >
                                  <Edit3 className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteWord(w.id)}
                                  className="p-1.5 rounded text-neutral-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                                  title="Delete"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== ACTIVITY LOGS (IMMUTABLE) ==================== */}
      {section === 'logs' && (
        <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-neutral-200 dark:border-neutral-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <h2 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
                Immutable Activity Audit Logs
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={logQuery}
                  onChange={(e) => setLogQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void loadLogs()}
                  placeholder="Search admin, target, detail..."
                  className="pl-8 pr-3 py-1.5 rounded-lg bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 text-xs text-neutral-900 dark:text-neutral-100 w-52"
                />
              </div>
              <select
                value={logActionFilter}
                onChange={(e) => setLogActionFilter(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 text-xs text-neutral-900 dark:text-neutral-100"
              >
                {LOG_ACTION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void loadLogs()}
                className="px-3 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-xs font-semibold text-neutral-700 dark:text-neutral-200 inline-flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className={cn('w-3.5 h-3.5', logsLoading && 'animate-spin')} />
                Filter
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-neutral-200 dark:border-neutral-800 text-neutral-500 uppercase">
                  <th className="py-2.5 px-4 font-semibold">Timestamp</th>
                  <th className="py-2.5 px-4 font-semibold">Admin</th>
                  <th className="py-2.5 px-4 font-semibold">Action</th>
                  <th className="py-2.5 px-4 font-semibold">Target</th>
                  <th className="py-2.5 px-4 font-semibold">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-neutral-500">
                      {logsLoading ? 'Loading audit trail...' : 'No matching activity logs.'}
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/40">
                      <td className="py-2.5 px-4 text-neutral-500 tabular-nums whitespace-nowrap">
                        {new Date(log.createdAt || log.created_at).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-4 font-medium text-neutral-900 dark:text-neutral-100">
                        {log.admin_email || log.actorEmail || log.actor_email || log.admin_id || log.actorId || 'System'}
                      </td>
                      <td className="py-2.5 px-4">
                        <span className="px-2 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 font-mono text-[11px]">
                          {log.action}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-neutral-600 dark:text-neutral-300 font-mono">
                        {log.targetType ? `${log.targetType}: ` : ''}
                        {log.target_label || log.targetId || log.target_user_id || log.target_id || '—'}
                      </td>
                      <td className="py-2.5 px-4 text-neutral-600 dark:text-neutral-300 max-w-md truncate">
                        {log.reason || log.note || log.details || '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ==================== ADMIN ROLES ==================== */}
      {section === 'roles' && (
        <div className="space-y-5">
          <form
            onSubmit={handleAssignRole}
            className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-5"
          >
            <div className="flex items-center gap-2 mb-3">
              <UserCog className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <h2 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
                Assign Moderator or Support Role
              </h2>
            </div>
            <p className="text-xs text-neutral-500 mb-3">
              Moderators can manage Reports, Users (ban/warn/suspend), and Ban Appeals. Support can view Users and reply to Support Tickets. Only Super Admin has full access.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <input
                type="text"
                value={roleIdentifier}
                onChange={(e) => setRoleIdentifier(e.target.value)}
                required
                placeholder="User email, @username, or UID"
                className="sm:col-span-6 px-3 py-2 rounded-lg bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 text-sm text-neutral-900 dark:text-neutral-100"
              />
              <select
                value={roleChoice}
                onChange={(e) => setRoleChoice(e.target.value as 'moderator' | 'support')}
                className="sm:col-span-3 px-3 py-2 rounded-lg bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 text-sm text-neutral-900 dark:text-neutral-100"
              >
                <option value="moderator">Moderator</option>
                <option value="support">Support</option>
              </select>
              <button
                type="submit"
                disabled={roleBusy}
                className="sm:col-span-3 py-2 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {roleBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                <span>Assign Role</span>
              </button>
            </div>
          </form>

          <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
                Admin Team ({admins.length})
              </h3>
              <button
                type="button"
                onClick={() => void loadRoles()}
                className="text-xs font-semibold text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 inline-flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className={cn('w-3.5 h-3.5', rolesLoading && 'animate-spin')} />
                Refresh
              </button>
            </div>
            <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {admins.map((admin) => {
                const isPrimarySuper =
                  (admin.email || '').toLowerCase() === (superAdminEmail || currentEmail || '').toLowerCase() &&
                  admin.adminRole === 'super_admin';
                return (
                  <div
                    key={admin.userId || admin.id}
                    className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-3"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                          {admin.displayName || admin.username || admin.email}
                        </p>
                        <span
                          className={cn(
                            'px-2 py-0.5 rounded text-xs font-semibold inline-flex items-center gap-1',
                            admin.adminRole === 'super_admin'
                              ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300'
                              : admin.adminRole === 'moderator'
                              ? 'bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
                              : 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                          )}
                        >
                          {admin.adminRole === 'super_admin' && <Crown className="w-3 h-3" />}
                          {admin.adminRole === 'super_admin'
                            ? 'Super Admin'
                            : admin.adminRole === 'moderator'
                            ? 'Moderator'
                            : 'Support'}
                        </span>
                      </div>
                      <p className="text-xs text-neutral-500 mt-0.5">
                        {admin.email || '—'} • @{admin.username || admin.userId}
                      </p>
                    </div>
                    {!isPrimarySuper && (
                      <button
                        type="button"
                        disabled={roleBusy}
                        onClick={() => void handleDemoteRole(admin.userId || admin.id)}
                        className="px-3 py-1.5 rounded-lg border border-rose-200 dark:border-rose-900/60 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs font-semibold cursor-pointer"
                      >
                        Remove Admin
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ==================== SETTINGS & SECURITY ==================== */}
      {section === 'settings' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Maintenance Mode */}
          <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wrench className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <h2 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
                  Maintenance Mode
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setMaintenanceMode((v) => !v)}
                className={cn(
                  'w-11 h-6 rounded-full p-0.5 transition-colors flex items-center cursor-pointer',
                  maintenanceMode ? 'bg-amber-600 justify-end' : 'bg-neutral-300 dark:bg-neutral-700 justify-start'
                )}
              >
                <span className="w-5 h-5 rounded-full bg-white shadow-xs" />
              </button>
            </div>
            <p className="text-xs text-neutral-500">
              When active, normal users see the maintenance screen while staff continue accessing /admin normally.
            </p>
            <div>
              <label className="block text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-1">
                Custom Maintenance Message
              </label>
              <textarea
                rows={3}
                value={maintenanceMessage}
                onChange={(e) => setMaintenanceMessage(e.target.value)}
                disabled={settingsLoading}
                className="w-full px-3 py-2 rounded-lg bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 text-sm text-neutral-900 dark:text-neutral-100 resize-none"
              />
            </div>
            <button
              type="button"
              disabled={settingsBusy === 'maintenance'}
              onClick={() => void handleSaveMaintenance()}
              className="px-4 py-2 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-sm font-semibold cursor-pointer inline-flex items-center gap-2"
            >
              {settingsBusy === 'maintenance' && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>Save Maintenance Settings</span>
            </button>
          </div>

          {/* Warning Auto-Escalation */}
          <form
            onSubmit={handleSaveWarningRules}
            className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 space-y-4"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
              <h2 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
                Warning Auto-Escalation
              </h2>
            </div>
            <p className="text-xs text-neutral-500">
              Automatically suspend or permanently ban a user once they reach N warnings.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-1">
                  Warnings Limit (N)
                </label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={warningThreshold}
                  onChange={(e) => setWarningThreshold(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 text-sm tabular-nums text-neutral-900 dark:text-neutral-100"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-1">
                  Auto Action
                </label>
                <select
                  value={warningAutoAction}
                  onChange={(e) => setWarningAutoAction(e.target.value as 'suspend' | 'ban')}
                  className="w-full px-3 py-2 rounded-lg bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 text-sm text-neutral-900 dark:text-neutral-100"
                >
                  <option value="suspend">Auto Suspend</option>
                  <option value="ban">Permanent Ban</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-1">
                  Suspend Days
                </label>
                <input
                  type="number"
                  min={1}
                  max={365}
                  disabled={warningAutoAction === 'ban'}
                  value={warningSuspendDays}
                  onChange={(e) => setWarningSuspendDays(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 text-sm tabular-nums text-neutral-900 dark:text-neutral-100 disabled:opacity-50"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={settingsBusy === 'warnings'}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold cursor-pointer inline-flex items-center gap-2"
            >
              {settingsBusy === 'warnings' && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>Save Warning Rules</span>
            </button>
          </form>

          {/* Change 6-digit PIN (Google Re-auth required) */}
          <div className="lg:col-span-2 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <h2 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
                Change 6-Digit Security PIN
              </h2>
            </div>
            <p className="text-xs text-neutral-500">
              For security, changing your Admin PIN requires re-authenticating with Google first.
            </p>

            {!reauthedForPin ? (
              <button
                type="button"
                disabled={reauthBusy}
                onClick={() => void handleGoogleReauth()}
                className="px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-sm font-semibold inline-flex items-center gap-2 cursor-pointer"
              >
                {reauthBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                <span>Re-authenticate with Google</span>
              </button>
            ) : (
              <form onSubmit={handleSubmitChangePin} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                <div>
                  <label className="block text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-1">
                    New 6-Digit PIN
                  </label>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    value={newPin}
                    onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="••••••"
                    required
                    className="w-full px-3 py-2 rounded-lg bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 text-sm tracking-widest tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-1">
                    Confirm 6-Digit PIN
                  </label>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    value={confirmNewPin}
                    onChange={(e) => setConfirmNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="••••••"
                    required
                    className="w-full px-3 py-2 rounded-lg bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 text-sm tracking-widest tabular-nums"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={pinBusy}
                    className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold cursor-pointer inline-flex items-center gap-1.5"
                  >
                    {pinBusy && <Loader2 className="w-4 h-4 animate-spin" />}
                    <span>Update PIN</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setReauthedForPin(false);
                      setNewPin('');
                      setConfirmNewPin('');
                    }}
                    className="px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 text-xs font-semibold cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
