import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldAlert,
  Ban,
  Download,
  LogOut,
  Clock,
  CheckCircle2,
  XCircle,
  Moon,
  Sun,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import { AppealRecord } from '@/src/types';
import { AppealFlowModal } from '@/src/components/moderation/AppealFlowModal';
import { cn } from '@/src/lib/utils';
import { useLanguage } from '@/src/lib/LanguageContext';

export interface BannedScreenProps {
  bannedUntil?: string | null;
  status?: string;
  banReason?: string | null;
  ruleLabel?: string | null;
  scheduledDeletionAt?: string | null;
  strikeCount?: number;
  appealToken?: string | null;
  onSignOut?: () => void | Promise<void>;
}

function formatCountdown(targetIso: string | null | undefined, nowMs: number): string | null {
  if (!targetIso) return null;
  const diff = new Date(targetIso).getTime() - nowMs;
  if (Number.isNaN(diff) || diff <= 0) return '00d 00h 00m 00s';

  const totalSec = Math.floor(diff / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${days}d ${pad(hours)}h ${pad(mins)}m ${pad(secs)}s`;
}

export function BannedScreen({
  bannedUntil = null,
  status = 'suspended',
  banReason = 'Violation of LiveConnect Community Guidelines',
  ruleLabel = 'Community Guidelines',
  scheduledDeletionAt = null,
  strikeCount = 0,
  appealToken = null,
  onSignOut,
}: BannedScreenProps) {
  const { t } = useLanguage();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isAppealOpen, setIsAppealOpen] = useState(false);
  const [latestAppeal, setLatestAppeal] = useState<AppealRecord | null>(null);
  const [downloadingData, setDownloadingData] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof document !== 'undefined') {
      return document.documentElement.classList.contains('dark');
    }
    return false;
  });

  const isPermanent = status === 'disabled';

  const resolveToken = useCallback(() => {
    if (appealToken) return appealToken;
    if (typeof window === 'undefined') return '';
    return (
      localStorage.getItem('liveconnect_appeal_token') ||
      localStorage.getItem('liveconnect_session_token') ||
      ''
    );
  }, [appealToken]);

  const fetchLatestAppeal = useCallback(async () => {
    const tok = resolveToken();
    if (!tok) return;
    try {
      const res = await fetch('/api/appeals/me', {
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (res.ok) {
        const data = await res.json();
        const rows = Array.isArray(data.appeals) ? data.appeals : [];
        setLatestAppeal(rows[0] || null);
      }
    } catch {}
  }, [resolveToken]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    void fetchLatestAppeal();
  }, [fetchLatestAppeal]);

  const toggleTheme = () => {
    const root = document.documentElement;
    if (root.classList.contains('dark')) {
      root.classList.remove('dark');
      localStorage.setItem('theme', 'light');
      setIsDark(false);
    } else {
      root.classList.add('dark');
      localStorage.setItem('theme', 'dark');
      setIsDark(true);
    }
  };

  const handleDownloadData = async () => {
    setActionError(null);
    const tok = resolveToken();
    if (!tok) {
      setActionError('Unable to export data without an active appeal session.');
      return;
    }
    setDownloadingData(true);
    try {
      const res = await fetch('/api/account/export-data', {
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to export account data');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `liveconnect-account-data-${Date.now()}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setActionError(err?.message || 'Failed to download account data.');
    } finally {
      setDownloadingData(false);
    }
  };

  const handleLogout = async () => {
    if (onSignOut) {
      await onSignOut();
      return;
    }
    if (typeof window !== 'undefined') {
      localStorage.removeItem('liveconnect_appeal_token');
      localStorage.removeItem('liveconnect_session_token');
      window.location.href = '/';
    }
  };

  const countdown = isPermanent
    ? formatCountdown(scheduledDeletionAt, nowMs)
    : formatCountdown(bannedUntil, nowMs);

  const formattedDate = bannedUntil
    ? new Date(bannedUntil).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : scheduledDeletionAt
      ? new Date(scheduledDeletionAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
      : null;

  return (
    <div className="min-h-screen-safe w-full flex flex-col items-center justify-center p-4 bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 font-sans relative">
      {/* Top Right Theme Switcher */}
      <div className="absolute top-4 end-4">
        <button
          type="button"
          onClick={toggleTheme}
          aria-label="Toggle Light/Dark theme"
          className="min-w-[44px] min-h-[44px] px-3 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 flex items-center gap-2 text-xs font-semibold text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer shadow-xs"
        >
          {isDark ? <Sun className="w-4 h-4 text-amber-500" /> : <Moon className="w-4 h-4 text-[#0095F6]" />}
          <span>{isDark ? 'Light' : 'Dark'}</span>
        </button>
      </div>

      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-xl p-6 md:p-8 space-y-6">
        {/* Big Warning / Ban Icon */}
        <div className="text-center space-y-3">
          <div
            className={cn(
              'w-16 h-16 mx-auto rounded-2xl flex items-center justify-center border',
              isPermanent
                ? 'bg-red-500/10 border-red-500/25 text-red-600 dark:text-red-400'
                : 'bg-amber-500/10 border-amber-500/25 text-amber-600 dark:text-amber-400'
            )}
          >
            {isPermanent ? <Ban className="w-8 h-8" /> : <ShieldAlert className="w-8 h-8" />}
          </div>

          <h1 className="text-xl md:text-2xl font-bold tracking-tight">
            {isPermanent
              ? 'Your account has been permanently disabled'
              : 'Your account has been suspended'}
          </h1>

          <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">
            {isPermanent
              ? 'Your profile and messages are hidden, and all active sessions have been signed out across your devices.'
              : 'Access is temporarily paused while your account is suspended. Your messages and profile data are preserved.'}
          </p>
        </div>

        {/* Reason & Policy Card */}
        <div className="rounded-xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-800 p-4 space-y-3 text-xs">
          <div className="flex items-start justify-between gap-3">
            <span className="text-neutral-500 dark:text-neutral-400 font-semibold shrink-0">
              Rule Broken
            </span>
            <span className="font-bold text-right text-neutral-900 dark:text-neutral-100">
              {ruleLabel || 'Community Guidelines'}
            </span>
          </div>

          <div className="h-px bg-neutral-200 dark:bg-neutral-700" />

          <div className="space-y-1">
            <span className="text-neutral-500 dark:text-neutral-400 font-semibold block">
              Reason
            </span>
            <p className="text-sm text-neutral-800 dark:text-neutral-200 font-medium leading-relaxed">
              {banReason || 'Repeated violations of LiveConnect safety standards.'}
            </p>
          </div>

          <div className="h-px bg-neutral-200 dark:bg-neutral-700" />

          <div className="flex items-center justify-between gap-3">
            <span className="text-neutral-500 dark:text-neutral-400 font-semibold">Strikes Recorded</span>
            <span className="font-mono font-bold text-red-600 dark:text-red-400">
              {Math.max(1, strikeCount)} / 3
            </span>
          </div>
        </div>

        {/* Countdown Box */}
        {(countdown || formattedDate) && (
          <div className="rounded-xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-800 p-4 text-center space-y-1.5">
            <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 flex items-center justify-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-[#0095F6]" />
              <span>
                {isPermanent
                  ? 'Scheduled data deletion if unappealed'
                  : 'Suspension ends automatically in'}
              </span>
            </p>
            {countdown && (
              <p className="text-xl font-mono font-bold tracking-tight text-neutral-900 dark:text-white">
                {countdown}
              </p>
            )}
            {formattedDate && (
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                {isPermanent ? `Deletion date: ${formattedDate}` : `Ends ${formattedDate}`}
              </p>
            )}
          </div>
        )}

        {/* Latest Appeal Status Summary */}
        {latestAppeal && (
          <div className="rounded-xl p-3.5 border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/40 flex items-start gap-2.5 text-xs">
            {latestAppeal.status === 'approved' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
            ) : latestAppeal.status === 'rejected' ? (
              <XCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            ) : (
              <Clock className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            )}
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="font-bold capitalize">Appeal Status: {latestAppeal.status}</p>
              <p className="text-neutral-500 dark:text-neutral-400 truncate">
                {latestAppeal.admin_note ||
                  (latestAppeal.status === 'pending'
                    ? 'Review in progress (48-hour decision window)'
                    : latestAppeal.reason)}
              </p>
            </div>
          </div>
        )}

        {actionError && (
          <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 flex items-center gap-2 text-xs text-red-700 dark:text-red-300">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{actionError}</span>
          </div>
        )}

        {/* Actions */}
        <div className="space-y-2.5">
          <button
            type="button"
            onClick={() => setIsAppealOpen(true)}
            className="w-full min-h-[44px] py-3 px-4 rounded-xl bg-[#0095F6] hover:bg-[#0081d6] text-white font-bold text-sm transition-colors cursor-pointer flex items-center justify-center gap-2"
          >
            <span>{latestAppeal ? 'View Appeal / Request Review' : 'Request Review'}</span>
          </button>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={handleDownloadData}
              disabled={downloadingData}
              className="min-h-[44px] py-2.5 px-3.5 rounded-xl bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-100 font-semibold text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {downloadingData ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              <span>Download Your Data</span>
            </button>

            <button
              type="button"
              onClick={handleLogout}
              className="min-h-[44px] py-2.5 px-3.5 rounded-xl border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300 font-semibold text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>{t('action.logOut')}</span>
            </button>
          </div>
        </div>
      </div>

      <AppealFlowModal
        isOpen={isAppealOpen}
        onClose={() => setIsAppealOpen(false)}
        authToken={resolveToken()}
        banReason={banReason}
        ruleLabel={ruleLabel}
        accountStatus={status}
        onAppealSubmitted={fetchLatestAppeal}
      />
    </div>
  );
}
