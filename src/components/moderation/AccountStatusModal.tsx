import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Download,
  Mail,
  FileWarning,
  Loader2,
  AlertCircle,
  Power,
} from 'lucide-react';
import { AccountModerationState, AppealRecord, BanHistoryRecord } from '@/src/types';
import { cn } from '@/src/lib/utils';
import { AppealFlowModal } from './AppealFlowModal';
import { ModerationTemplatesModal } from './ModerationTemplatesModal';
import { useLanguage } from '@/src/lib/LanguageContext';

interface AccountStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSignOut?: () => void | Promise<void>;
}

interface AccountStatusPayload {
  account: AccountModerationState;
  history: BanHistoryRecord[];
  appeals: AppealRecord[];
  permissions: {
    canLogin: boolean;
    canSendMessages: boolean;
    canStartCalls: boolean;
    canFollowUsers: boolean;
    profileVisibleToOthers: boolean;
    appearsInSearch: boolean;
    canSubmitAppeal: boolean;
    canDownloadData: boolean;
  };
}

const STRIKE_TIERS = [
  { step: 0, label: 'Good Standing' },
  { step: 1, label: 'Warning' },
  { step: 2, label: 'Restricted' },
  { step: 3, label: 'Suspended' },
  { step: 4, label: 'Disabled' },
];

export const AccountStatusModal: React.FC<AccountStatusModalProps> = ({
  isOpen,
  onClose,
  onSignOut,
}) => {
  const { t } = useLanguage();
  const [data, setData] = useState<AccountStatusPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAppealOpen, setIsAppealOpen] = useState(false);
  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [deactivating, setDeactivating] = useState(false);

  const getToken = () =>
    typeof window !== 'undefined' ? localStorage.getItem('liveconnect_session_token') || '' : '';

  const fetchAccountStatus = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setError('Sign in with a valid LiveConnect session to view live account status.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/account/status', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load account status');
      setData(json);
    } catch (err: any) {
      setError(err?.message || 'Unable to load account status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setConfirmDeactivate(false);
      void fetchAccountStatus();
    }
  }, [isOpen, fetchAccountStatus]);

  if (!isOpen) return null;

  const handleDownloadData = async () => {
    const token = getToken();
    if (!token) return;
    setDownloading(true);
    try {
      const res = await fetch('/api/account/export-data', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `liveconnect-data-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err?.message || 'Could not download account export.');
    } finally {
      setDownloading(false);
    }
  };

  const handleDeactivate = async () => {
    const token = getToken();
    if (!token) return;
    setDeactivating(true);
    try {
      const res = await fetch('/api/account/deactivate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reason: 'Voluntary temporary deactivation by user.' }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || 'Failed to deactivate account');
      }
      onClose();
      if (onSignOut) await onSignOut();
    } catch (err: any) {
      setError(err?.message || 'Failed to deactivate account.');
      setDeactivating(false);
    }
  };

  const strikeCount = Math.min(4, Math.max(0, data?.account?.strike_count || 0));
  const status = data?.account?.status || 'active';

  const permissionItems = data
    ? [
        { label: 'Sign in & browse account', allowed: data.permissions.canLogin },
        { label: 'Send direct messages', allowed: data.permissions.canSendMessages },
        { label: 'Start voice & video calls', allowed: data.permissions.canStartCalls },
        { label: 'Follow other users', allowed: data.permissions.canFollowUsers },
        { label: 'Profile visible to others', allowed: data.permissions.profileVisibleToOthers },
        { label: 'Listed in search & suggestions', allowed: data.permissions.appearsInSearch },
      ]
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in font-sans">
      <div className="w-full max-w-2xl rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-2xl overflow-hidden flex flex-col max-h-[92vh] text-neutral-900 dark:text-neutral-100">
        {/* Header */}
        <div className="px-5 py-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#0095F6]/10 text-[#0095F6] flex items-center justify-center">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold">{t('title.accountStatus')}</h3>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Warnings, community strikes, and feature access overview
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('action.close')}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-5">
          {loading ? (
            <div className="py-12 flex items-center justify-center gap-2 text-xs text-neutral-500">
              <Loader2 className="w-4 h-4 animate-spin text-[#0095F6]" />
              <span>Loading your account standing...</span>
            </div>
          ) : error ? (
            <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 flex items-center gap-2.5 text-xs text-red-700 dark:text-red-300">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span className="flex-1">{error}</span>
            </div>
          ) : data ? (
            <>
              {/* Standing Banner */}
              <div className="p-4 rounded-xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold capitalize">Current Status: {status}</span>
                    {status === 'active' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
                    )}
                  </div>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    {status === 'active' && strikeCount === 0
                      ? 'Your account meets all LiveConnect Community Guidelines.'
                      : status === 'restricted' && data.account.restricted_until
                        ? `Posting, DMs, and calls are restricted until ${new Date(data.account.restricted_until).toLocaleString()}.`
                        : data.account.ban_reason || 'Please follow Community Guidelines to maintain full access.'}
                  </p>
                </div>

                {data.permissions.canSubmitAppeal && (
                  <button
                    type="button"
                    onClick={() => setIsAppealOpen(true)}
                    className="min-h-[40px] px-4 py-2 rounded-xl bg-[#0095F6] hover:bg-[#0081d6] text-white font-bold text-xs shrink-0 cursor-pointer"
                  >
                    Request Review
                  </button>
                )}
              </div>

              {/* 4-Stage Strike Progress Bar */}
              <div className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold">Strike Enforcement Ladder</span>
                  <span className="font-mono font-bold text-[#0095F6]">
                    {data.account.strike_count} Strike{data.account.strike_count === 1 ? '' : 's'}
                  </span>
                </div>

                <div className="h-2.5 w-full rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all duration-300',
                      strikeCount === 0
                        ? 'w-[12%] bg-emerald-500'
                        : strikeCount === 1
                          ? 'w-[35%] bg-amber-400'
                          : strikeCount === 2
                            ? 'w-[62%] bg-orange-500'
                            : strikeCount === 3
                              ? 'w-[85%] bg-red-500'
                              : 'w-full bg-red-700'
                    )}
                  />
                </div>

                <div className="grid grid-cols-5 gap-1 text-center pt-1">
                  {STRIKE_TIERS.map((tier) => (
                    <div
                      key={tier.step}
                      className={cn(
                        'text-[11px] font-semibold',
                        strikeCount >= tier.step && tier.step > 0
                          ? 'text-neutral-900 dark:text-neutral-100'
                          : strikeCount === 0 && tier.step === 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-neutral-400 dark:text-neutral-500'
                      )}
                    >
                      {tier.label}
                    </div>
                  ))}
                </div>
              </div>

              {/* What is Allowed vs Restricted */}
              <div className="space-y-2.5">
                <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                  What Features You Can Use
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {permissionItems.map((item) => (
                    <div
                      key={item.label}
                      className="p-3 rounded-xl bg-neutral-50 dark:bg-neutral-800/40 border border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-2 text-xs"
                    >
                      <span className="font-medium">{item.label}</span>
                      {item.allowed ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-bold shrink-0">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Allowed
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400 font-bold shrink-0">
                          <XCircle className="w-3.5 h-3.5" />
                          Restricted
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Violations & Warnings History */}
              <div className="space-y-2.5">
                <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                  Violations & Moderation History
                </h4>
                {data.history.length === 0 ? (
                  <div className="p-6 rounded-xl border border-neutral-200 dark:border-neutral-800 text-center space-y-1.5">
                    <CheckCircle2 className="w-6 h-6 text-emerald-500 mx-auto" />
                    <p className="text-sm font-semibold">No policy violations recorded</p>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      Warnings, restrictions, or suspensions will appear here if issued.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {data.history.map((entry) => (
                      <div
                        key={entry.id}
                        className="p-3.5 rounded-xl bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-800 space-y-1.5 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold capitalize flex items-center gap-1.5">
                            <FileWarning className="w-3.5 h-3.5 text-amber-500" />
                            <span>
                              {entry.action.replace('_', ' ')} • {entry.rule_broken.replace('_', ' ')}
                            </span>
                          </span>
                          <span className="text-[11px] font-mono text-neutral-500">
                            Strike #{entry.strike_number}
                          </span>
                        </div>
                        <p className="text-neutral-600 dark:text-neutral-300 leading-relaxed">
                          {entry.reason}
                        </p>
                        <p className="text-[11px] text-neutral-400">
                          {new Date(entry.created_at).toLocaleString()}
                          {entry.expires_at ? ` • Ends ${new Date(entry.expires_at).toLocaleString()}` : ''}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Self Deactivation + Tools */}
              <div className="pt-2 border-t border-neutral-200 dark:border-neutral-800 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={handleDownloadData}
                    disabled={downloading}
                    className="min-h-[44px] px-4 py-2.5 rounded-xl bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                    <span>Download Your Data</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsTemplatesOpen(true)}
                    className="min-h-[44px] px-4 py-2.5 rounded-xl bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Mail className="w-4 h-4 text-[#0095F6]" />
                    <span>Email & Notification Templates</span>
                  </button>
                </div>

                {!confirmDeactivate ? (
                  <button
                    type="button"
                    onClick={() => setConfirmDeactivate(true)}
                    className="w-full min-h-[44px] px-4 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs font-semibold text-neutral-700 dark:text-neutral-300 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Power className="w-4 h-4" />
                    <span>Temporarily Deactivate Account</span>
                  </button>
                ) : (
                  <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 space-y-3 text-xs">
                    <p className="font-semibold text-neutral-900 dark:text-neutral-100">
                      Temporarily deactivate your account? Your profile will be hidden until you sign back in.
                    </p>
                    <div className="flex gap-2 justify-end">
                      <button
                        type="button"
                        onClick={() => setConfirmDeactivate(false)}
                        className="px-3.5 py-2 rounded-lg bg-neutral-200 dark:bg-neutral-800 font-semibold cursor-pointer"
                      >
                        {t('action.cancel')}
                      </button>
                      <button
                        type="button"
                        onClick={handleDeactivate}
                        disabled={deactivating}
                        className="px-3.5 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold cursor-pointer flex items-center gap-1.5"
                      >
                        {deactivating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        <span>Confirm Deactivate</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>

      <AppealFlowModal
        isOpen={isAppealOpen}
        onClose={() => setIsAppealOpen(false)}
        banReason={data?.account.ban_reason}
        ruleLabel={data?.account.rule_label}
        accountStatus={data?.account.status}
        onAppealSubmitted={fetchAccountStatus}
      />

      <ModerationTemplatesModal
        isOpen={isTemplatesOpen}
        onClose={() => setIsTemplatesOpen(false)}
      />
    </div>
  );
};
