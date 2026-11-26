import React, { useState, useEffect } from 'react';
import {
  X,
  Flag,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  Loader2,
  ShieldCheck,
  MessageSquareWarning,
} from 'lucide-react';
import {
  Profile,
  ReportedMessageContext,
  UserReportCategory,
  UserReportSource,
} from '@/src/types';
import { cn, formatMessagePreview, formatTime } from '@/src/lib/utils';
import { UserAvatar } from '@/src/components/ui/UserAvatar';
import {
  USER_REPORT_CATEGORIES,
  getReportCategoryMeta,
  submitUserReport,
} from '@/src/lib/reportCategories';
import { useLanguage } from '@/src/lib/LanguageContext';

interface ReportUserModalProps {
  isOpen: boolean;
  currentUserId?: string | null;
  targetUser: Profile | null;
  source?: UserReportSource;
  conversationId?: string | null;
  reportedMessage?: ReportedMessageContext | null;
  isAlreadyBlocked?: boolean;
  onBlockUser?: (user: Profile) => Promise<boolean>;
  onClose: () => void;
}

export const ReportUserModal: React.FC<ReportUserModalProps> = ({
  isOpen,
  currentUserId,
  targetUser,
  source = 'profile' as UserReportSource,
  conversationId,
  reportedMessage = null,
  isAlreadyBlocked = false,
  onBlockUser,
  onClose,
}) => {
  const { t } = useLanguage();
  const [selectedCategory, setSelectedCategory] = useState<UserReportCategory | null>(null);
  const [details, setDetails] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedResult, setSubmittedResult] = useState<{
    reportId: string;
    duplicate?: boolean;
    blockedNow?: boolean;
  } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setSelectedCategory(null);
      setDetails('');
      setAlsoBlock(false);
      setError(null);
      setSubmittedResult(null);
    }
  }, [isOpen, targetUser?.id, reportedMessage?.id]);

  if (!isOpen || !targetUser) return null;

  const isSelf = Boolean(currentUserId && targetUser.id === currentUserId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUserId || isSelf || submitting) return;
    if (!selectedCategory) {
      setError('Please select a reason for reporting.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const result = await submitUserReport({
        reporterId: currentUserId,
        targetUser,
        category: selectedCategory,
        details: details.trim() || undefined,
        source,
        conversationId: conversationId || null,
        alsoBlocked: !isAlreadyBlocked && alsoBlock,
        reportedMessage: reportedMessage || null,
      });

      let blockedNow = false;
      if (!isAlreadyBlocked && alsoBlock && onBlockUser) {
        const blockOk = await onBlockUser(targetUser).catch(() => false);
        blockedNow = Boolean(blockOk);
      }

      setSubmittedResult({
        reportId: result.reportId,
        duplicate: result.duplicate,
        blockedNow,
      });
    } catch (err: any) {
      setError(err?.message || 'Unable to submit report right now. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const selectedMeta = selectedCategory ? getReportCategoryMeta(selectedCategory) : null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90dvh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 px-5 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-800/40 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center">
              <Flag className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-neutral-900 dark:text-neutral-100">
                {reportedMessage ? 'Report Message' : t('title.reportAccount')}
              </h3>
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                {reportedMessage
                  ? 'This specific message will be included for Trust & Safety review'
                  : 'Reports are confidential and reviewed by Trust & Safety'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={t('action.close')}
            className="p-1.5 rounded-xl hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        {submittedResult ? (
          <div className="p-6 text-center space-y-4 overflow-y-auto">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8" />
            </div>

            <div className="space-y-1.5">
              <h4 className="text-lg font-extrabold text-neutral-900 dark:text-neutral-100">
                {submittedResult.duplicate ? 'Report Already Submitted' : 'Thank You for Reporting'}
              </h4>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 max-w-sm mx-auto leading-relaxed">
                {submittedResult.duplicate
                  ? reportedMessage
                    ? `You have already reported this message from @${targetUser.username}. Our safety team is reviewing it.`
                    : `You already have an open report against @${targetUser.username}. Our safety team is reviewing it.`
                  : reportedMessage
                  ? `Your message report against @${targetUser.username} has been received and added to our moderation queue.`
                  : `Your report against @${targetUser.username} has been received and added to our moderation queue.`}
              </p>
            </div>

            <div className="p-3.5 rounded-2xl bg-neutral-100 dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700/70 text-start space-y-1.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-neutral-500 dark:text-neutral-400">Report Reference</span>
                <span className="font-mono font-bold text-neutral-900 dark:text-neutral-100">
                  {submittedResult.reportId}
                </span>
              </div>
              {selectedMeta && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-neutral-500 dark:text-neutral-400">Reason</span>
                  <span className="font-semibold text-neutral-800 dark:text-neutral-200">
                    {selectedMeta.label}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <span className="text-neutral-500 dark:text-neutral-400">Reported ID</span>
                <span className="font-mono text-[11px] text-neutral-700 dark:text-neutral-300 truncate max-w-[200px]">
                  {targetUser.id}
                </span>
              </div>
              {submittedResult.blockedNow && (
                <div className="pt-1 flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-semibold">
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                  <span>@{targetUser.username} has also been blocked.</span>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="w-full py-2.5 px-5 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-md shadow-blue-500/20 transition-all cursor-pointer"
            >
              {t('action.done')}
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1">
            <div className="p-5 overflow-y-auto space-y-4">
              {/* Target User Summary Card */}
              <div className="p-3 rounded-2xl bg-neutral-100/80 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-800 flex items-center gap-3">
                <UserAvatar
                  src={targetUser.avatar_url || null}
                  name={targetUser.display_name}
                  id={targetUser.id}
                  className="w-11 h-11 rounded-2xl shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-neutral-900 dark:text-neutral-100 truncate">
                    {targetUser.display_name}
                  </p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 font-mono truncate">
                    @{targetUser.username} • ID: {targetUser.id}
                  </p>
                </div>
              </div>

              {/* Reported Message Context Preview */}
              {reportedMessage && (
                <div className="p-3 rounded-2xl bg-rose-50/70 dark:bg-rose-950/25 border border-rose-200/80 dark:border-rose-900/50 space-y-1">
                  <div className="flex items-center justify-between gap-2 text-[11px] font-bold text-rose-700 dark:text-rose-300">
                    <span className="flex items-center gap-1.5">
                      <MessageSquareWarning className="w-3.5 h-3.5 shrink-0" />
                      <span>Reported Message</span>
                    </span>
                    {reportedMessage.createdAt && (
                      <span className="font-normal opacity-75">
                        {formatTime(reportedMessage.createdAt)}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-neutral-800 dark:text-neutral-200 line-clamp-3 break-words bg-white/80 dark:bg-neutral-900/70 px-2.5 py-2 rounded-xl border border-rose-200/50 dark:border-rose-900/40">
                    {formatMessagePreview(reportedMessage.content) || 'Message content'}
                  </p>
                </div>
              )}

              {error && (
                <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 flex items-center gap-2 text-xs text-rose-600 dark:text-rose-400">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* All Report Categories */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300">
                  {reportedMessage
                    ? 'Why are you reporting this message?'
                    : 'Why are you reporting this account?'}
                </label>

                <div className="space-y-1.5">
                  {USER_REPORT_CATEGORIES.map((cat) => {
                    const isSelected = selectedCategory === cat.id;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => {
                          setSelectedCategory(cat.id);
                          setError(null);
                        }}
                        className={cn(
                          'w-full text-start p-3 rounded-2xl border transition-all flex items-start gap-3 cursor-pointer',
                          isSelected
                            ? 'border-rose-500 bg-rose-50/70 dark:bg-rose-950/30 shadow-xs'
                            : 'border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700 bg-white dark:bg-neutral-900'
                        )}
                      >
                        <div
                          className={cn(
                            'mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors',
                            isSelected
                              ? 'border-rose-600 bg-rose-600'
                              : 'border-neutral-300 dark:border-neutral-600'
                          )}
                        >
                          {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span
                              className={cn(
                                'text-xs font-bold',
                                isSelected
                                  ? 'text-rose-700 dark:text-rose-300'
                                  : 'text-neutral-900 dark:text-neutral-100'
                              )}
                            >
                              {cat.label}
                            </span>
                            {cat.severity === 'critical' && (
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20">
                                Zero Tolerance
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5 leading-snug">
                            {cat.description}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Additional Details */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-neutral-700 dark:text-neutral-300">
                    Additional Details (Optional)
                  </label>
                  <span className="text-[10px] font-mono text-neutral-400">
                    {details.length}/1000
                  </span>
                </div>
                <textarea
                  rows={3}
                  maxLength={1000}
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  placeholder="Provide any context, specific behavior, or message details that can help our moderators..."
                  className="w-full p-3 text-sm rounded-2xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-rose-500 resize-none"
                />
              </div>

              {/* Optional Block User Toggle */}
              {!isAlreadyBlocked && onBlockUser && !isSelf && (
                <label className="flex items-start gap-3 p-3 rounded-2xl bg-neutral-100/80 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700/70 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={alsoBlock}
                    onChange={(e) => setAlsoBlock(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded accent-rose-600 cursor-pointer"
                  />
                  <div className="min-w-0 flex-1">
                    <span className="text-xs font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-1.5">
                      <ShieldAlert className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                      <span>Also block @{targetUser.username}</span>
                    </span>
                    <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">
                      They won&apos;t be able to message, call, follow, or find your profile.
                    </p>
                  </div>
                </label>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 px-5 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-900 flex items-center justify-end gap-2.5 shrink-0">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="px-4 py-2.5 text-xs font-semibold text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200/70 dark:hover:bg-neutral-800 rounded-2xl transition-colors cursor-pointer"
              >
                {t('action.cancel')}
              </button>
              <button
                type="submit"
                disabled={!selectedCategory || submitting || isSelf}
                className="flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-2xl shadow-md shadow-rose-500/20 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>{t('action.sending')}</span>
                  </>
                ) : (
                  <>
                    <Flag className="w-3.5 h-3.5" />
                    <span>{t('action.report')}</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
