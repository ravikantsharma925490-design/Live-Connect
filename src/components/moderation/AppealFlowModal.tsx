import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Upload,
  CheckCircle2,
  Clock,
  XCircle,
  AlertCircle,
  FileCheck2,
  Loader2,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { AppealRecord } from '@/src/types';
import { cn } from '@/src/lib/utils';

interface AppealFlowModalProps {
  isOpen: boolean;
  onClose: () => void;
  authToken?: string | null;
  banReason?: string | null;
  ruleLabel?: string | null;
  accountStatus?: string | null;
  onAppealSubmitted?: () => void;
}

export const AppealFlowModal: React.FC<AppealFlowModalProps> = ({
  isOpen,
  onClose,
  authToken,
  banReason,
  ruleLabel,
  accountStatus,
  onAppealSubmitted,
}) => {
  const [reason, setReason] = useState('');
  const [verificationDocUrl, setVerificationDocUrl] = useState<string | null>(null);
  const [verificationDocName, setVerificationDocName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appeals, setAppeals] = useState<AppealRecord[]>([]);

  const resolveToken = useCallback(() => {
    if (authToken) return authToken;
    if (typeof window === 'undefined') return '';
    return (
      localStorage.getItem('liveconnect_appeal_token') ||
      localStorage.getItem('liveconnect_session_token') ||
      ''
    );
  }, [authToken]);

  const fetchAppeals = useCallback(async () => {
    const token = resolveToken();
    if (!token) return;
    setLoadingHistory(true);
    try {
      const res = await fetch('/api/appeals/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setAppeals(Array.isArray(data.appeals) ? data.appeals : []);
      }
    } catch {
      // ignore
    } finally {
      setLoadingHistory(false);
    }
  }, [resolveToken]);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      void fetchAppeals();
    }
  }, [isOpen, fetchAppeals]);

  if (!isOpen) return null;

  const latestAppeal = appeals[0] || null;
  const hasPendingAppeal = appeals.some((a) => a.status === 'pending');

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);

    if (file.size > 5 * 1024 * 1024) {
      setError('Verification file must be under 5 MB.');
      return;
    }

    const token = resolveToken();
    if (!token) {
      setError('Session token missing. Please sign in again to submit verification.');
      return;
    }

    setUploading(true);
    try {
      const reader = new FileReader();
      const base64Data: string = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read selected file.'));
        reader.readAsDataURL(file);
      });

      const res = await fetch('/api/appeals/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          base64Data,
          mimeType: file.type || 'image/jpeg',
          fileName: file.name,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        throw new Error(data.error || 'Upload failed');
      }
      setVerificationDocUrl(data.url);
      setVerificationDocName(data.fileName || file.name);
    } catch (err: any) {
      setError(err?.message || 'Could not upload verification file.');
    } finally {
      setUploading(false);
    }
  };

  const handleSubmitAppeal = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmed = reason.trim();
    if (trimmed.length < 10) {
      setError('Please provide at least 10 characters explaining why this decision should be reviewed.');
      return;
    }

    const token = resolveToken();
    if (!token) {
      setError('Authentication token is missing. Please log in again.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/appeals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          reason: trimmed,
          verificationDocUrl,
          verificationDocName,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit appeal');
      }
      setReason('');
      setVerificationDocUrl(null);
      setVerificationDocName(null);
      await fetchAppeals();
      onAppealSubmitted?.();
    } catch (err: any) {
      setError(err?.message || 'Failed to submit appeal.');
    } finally {
      setSubmitting(false);
    }
  };

  const getStepState = (appeal: AppealRecord) => {
    const isReviewed = appeal.status === 'approved' || appeal.status === 'rejected';
    return {
      submitted: true,
      underReview: true,
      decision: isReviewed,
    };
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in font-sans">
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh] text-neutral-900 dark:text-neutral-100">
        {/* Header */}
        <div className="px-5 py-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between bg-white dark:bg-neutral-900">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#0095F6]/10 text-[#0095F6] flex items-center justify-center">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold leading-tight">Request Account Review</h3>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Decisions are typically completed within 48 hours
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close review modal"
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-5">
          {/* Context summary */}
          {(banReason || ruleLabel || accountStatus) && (
            <div className="p-3.5 rounded-xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-800 space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-neutral-500 dark:text-neutral-400">
                  Policy Referenced
                </span>
                <span className="font-bold text-neutral-900 dark:text-neutral-100">
                  {ruleLabel || 'Community Guidelines'}
                </span>
              </div>
              {banReason && (
                <p className="text-xs text-neutral-600 dark:text-neutral-300 leading-relaxed">
                  {banReason}
                </p>
              )}
            </div>
          )}

          {/* Error Banner */}
          {error && (
            <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/60 flex items-start gap-2.5 text-xs text-red-700 dark:text-red-300">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="flex-1 leading-relaxed">{error}</span>
            </div>
          )}

          {/* Status Tracker for latest appeal */}
          {loadingHistory ? (
            <div className="py-6 flex items-center justify-center gap-2 text-xs text-neutral-500">
              <Loader2 className="w-4 h-4 animate-spin text-[#0095F6]" />
              <span>Loading appeal status...</span>
            </div>
          ) : latestAppeal ? (
            <div className="p-4 rounded-xl bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-800 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                  Latest Appeal Tracker
                </span>
                <span
                  className={cn(
                    'text-xs font-bold px-2.5 py-1 rounded-md capitalize',
                    latestAppeal.status === 'approved'
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                      : latestAppeal.status === 'rejected'
                        ? 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                        : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                  )}
                >
                  {latestAppeal.status}
                </span>
              </div>

              {/* 3-step visual progress */}
              {(() => {
                const steps = getStepState(latestAppeal);
                return (
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="space-y-1.5">
                      <div className="mx-auto w-8 h-8 rounded-full bg-[#0095F6] text-white flex items-center justify-center">
                        <CheckCircle2 className="w-4 h-4" />
                      </div>
                      <p className="text-[11px] font-semibold">Submitted</p>
                    </div>

                    <div className="space-y-1.5">
                      <div
                        className={cn(
                          'mx-auto w-8 h-8 rounded-full flex items-center justify-center',
                          steps.decision
                            ? 'bg-[#0095F6] text-white'
                            : 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/40'
                        )}
                      >
                        <Clock className="w-4 h-4" />
                      </div>
                      <p className="text-[11px] font-semibold">In Review</p>
                    </div>

                    <div className="space-y-1.5">
                      <div
                        className={cn(
                          'mx-auto w-8 h-8 rounded-full flex items-center justify-center',
                          latestAppeal.status === 'approved'
                            ? 'bg-emerald-600 text-white'
                            : latestAppeal.status === 'rejected'
                              ? 'bg-red-600 text-white'
                              : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-400'
                        )}
                      >
                        {latestAppeal.status === 'rejected' ? (
                          <XCircle className="w-4 h-4" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4" />
                        )}
                      </div>
                      <p className="text-[11px] font-semibold">
                        {latestAppeal.status === 'approved'
                          ? 'Approved'
                          : latestAppeal.status === 'rejected'
                            ? 'Rejected'
                            : 'Decision'}
                      </p>
                    </div>
                  </div>
                );
              })()}

              <div className="text-xs text-neutral-600 dark:text-neutral-300 space-y-1 pt-1 border-t border-neutral-200 dark:border-neutral-700">
                <p>
                  <span className="font-semibold">Your statement:</span> {latestAppeal.reason}
                </p>
                {latestAppeal.admin_note && (
                  <p className="text-neutral-800 dark:text-neutral-200">
                    <span className="font-semibold">Reviewer note:</span> {latestAppeal.admin_note}
                  </p>
                )}
                <p className="text-[11px] text-neutral-500">
                  Submitted {new Date(latestAppeal.created_at).toLocaleString()}
                  {latestAppeal.status === 'pending' && latestAppeal.decision_due_at
                    ? ` • Expected decision by ${new Date(latestAppeal.decision_due_at).toLocaleDateString()}`
                    : ''}
                </p>
              </div>
            </div>
          ) : null}

          {/* Appeal Submission Form */}
          {hasPendingAppeal ? (
            <div className="p-4 rounded-xl bg-[#0095F6]/10 border border-[#0095F6]/25 text-xs text-neutral-800 dark:text-neutral-200 leading-relaxed">
              Your appeal is currently queued for review. Submitting another request is disabled while a review is active.
            </div>
          ) : (
            <form onSubmit={handleSubmitAppeal} className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300">
                  Why should this decision be reversed?
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={4}
                  maxLength={2000}
                  placeholder="Share context explaining why you believe this enforcement action was an error..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-sm text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:border-[#0095F6] resize-none"
                />
                <div className="flex justify-between text-[11px] text-neutral-500">
                  <span>Minimum 10 characters</span>
                  <span>{reason.length}/2000</span>
                </div>
              </div>

              {/* Optional ID / Selfie Upload */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300">
                  Identity / Selfie Verification (Optional)
                </label>

                {verificationDocUrl ? (
                  <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <FileCheck2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <span className="text-xs font-semibold truncate">
                        {verificationDocName || 'Verification document uploaded'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setVerificationDocUrl(null);
                        setVerificationDocName(null);
                      }}
                      className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-red-500 hover:bg-red-100 dark:hover:bg-red-900/40 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center gap-1.5 p-4 rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/40 hover:border-[#0095F6] transition-colors cursor-pointer">
                    {uploading ? (
                      <Loader2 className="w-5 h-5 animate-spin text-[#0095F6]" />
                    ) : (
                      <Upload className="w-5 h-5 text-neutral-500" />
                    )}
                    <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                      {uploading ? 'Uploading document...' : 'Upload selfie or photo ID (JPG, PNG, PDF)'}
                    </span>
                    <span className="text-[11px] text-neutral-500">Max 5 MB • Reviewed only by Trust & Safety</span>
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      onChange={handleFileChange}
                      disabled={uploading}
                      className="hidden"
                    />
                  </label>
                )}
              </div>

              <button
                type="submit"
                disabled={submitting || uploading || reason.trim().length < 10}
                className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-[#0095F6] hover:bg-[#0081d6] text-white font-bold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>{submitting ? 'Submitting Review Request...' : 'Submit Review Request'}</span>
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
