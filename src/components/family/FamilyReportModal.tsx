import React, { useState } from 'react';
import { X, Flag, Loader2, Shield, CheckCircle2 } from 'lucide-react';
import { Family, FamilyMessage, Profile, UserReportCategory } from '@/src/types';
import { FAMILY_REPORT_OPTIONS } from '@/src/lib/family/constants';
import { submitUserReport } from '@/src/lib/reportCategories';
import { notifyFamilyAdminsOfReportFs } from '@/src/lib/family/familyService';
import { useLanguage } from '@/src/lib/LanguageContext';
import { cn } from '@/src/lib/utils';

interface FamilyReportModalProps {
  isOpen: boolean;
  currentUser: Profile | null;
  family: Family | null;
  message: FamilyMessage | null;
  targetType?: 'message' | 'family';
  onClose: () => void;
}

export const FamilyReportModal: React.FC<FamilyReportModalProps> = ({
  isOpen,
  currentUser,
  family,
  message,
  targetType,
  onClose,
}) => {
  const { t } = useLanguage();
  const [selectedCategory, setSelectedCategory] = useState<UserReportCategory>(FAMILY_REPORT_OPTIONS[0].id);
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isFamilyReport = targetType === 'family' || !message;
  if (!isOpen || !currentUser || !family || (!isFamilyReport && !message)) return null;

  const selectedLabel =
    FAMILY_REPORT_OPTIONS.find((opt) => opt.id === selectedCategory)?.label || selectedCategory;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const targetProfile: Profile = message
        ? {
            id: message.senderId,
            username: message.senderUsername || 'member',
            display_name: message.senderName,
            avatar_url: message.senderAvatar || null,
            bio: '',
            is_online: false,
            last_seen: message.createdAt,
            created_at: message.createdAt,
            updated_at: message.updatedAt,
          }
        : {
            id: family.ownerId,
            username: 'family_group',
            display_name: family.name,
            avatar_url: family.photoUrl || null,
            bio: '',
            is_online: false,
            last_seen: family.updatedAt,
            created_at: family.createdAt,
            updated_at: family.updatedAt,
          };

      await submitUserReport({
        reporterId: currentUser.id,
        targetUser: targetProfile,
        category: selectedCategory,
        details: details.trim(),
        source: isFamilyReport ? 'family_profile' : 'family_chat',
        targetType: isFamilyReport ? 'family' : 'message',
        conversationId: family.id,
        familyId: family.id,
        familyName: family.name,
        reportedMessage: message
          ? {
              id: message.id,
              content: message.content,
              createdAt: message.createdAt,
              mediaUrl: message.mediaUrl || null,
            }
          : null,
      });

      if (!isFamilyReport && message) {
        await notifyFamilyAdminsOfReportFs({
          reporterId: currentUser.id,
          family,
          reportedUserName: message.senderName,
          category: selectedLabel,
        });
      }

      setSubmitted(true);
      setTimeout(() => {
        setSubmitted(false);
        setDetails('');
        onClose();
      }, 1400);
    } catch (err: any) {
      setError(err?.message || 'Could not submit report.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 w-full max-w-md rounded-3xl shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-800/40">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
              <Flag className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-neutral-900 dark:text-neutral-100">
                {isFamilyReport ? 'Report Family Group' : 'Report Family Message'}
              </h3>
              <p className="text-[11px] text-neutral-500">
                {isFamilyReport
                  ? `${family.name} • App Moderation Review`
                  : `From ${message?.senderName} in ${family.name}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-200/70 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {submitted ? (
          <div className="p-8 flex flex-col items-center text-center gap-2.5">
            <CheckCircle2 className="w-10 h-10 text-emerald-500" />
            <h4 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
              Report Submitted
            </h4>
            <p className="text-xs text-neutral-500">
              {isFamilyReport
                ? 'LiveConnect moderation has received your Family report.'
                : 'Your Family Owner/Admins and app moderation team have been notified anonymously.'}
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            {error && (
              <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-700 dark:text-rose-300">
                {error}
              </div>
            )}

            {/* Message snapshot preview */}
            {!isFamilyReport && message && (
              <div className="p-3 rounded-2xl bg-neutral-100 dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700/70 text-xs text-neutral-700 dark:text-neutral-300 line-clamp-3">
                {message.content}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300">
                Reason
              </label>
              <div className="grid grid-cols-1 gap-1.5">
                {FAMILY_REPORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setSelectedCategory(opt.id)}
                    className={cn(
                      'px-3.5 py-2.5 rounded-2xl text-left text-xs font-semibold border transition-all cursor-pointer flex items-center justify-between',
                      selectedCategory === opt.id
                        ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-500 text-amber-800 dark:text-amber-300'
                        : 'bg-neutral-50 dark:bg-neutral-800/50 border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                    )}
                  >
                    <span>{opt.label}</span>
                    <span
                      className={cn(
                        'w-4 h-4 rounded-full border-2',
                        selectedCategory === opt.id
                          ? 'border-amber-500 bg-amber-500'
                          : 'border-neutral-300 dark:border-neutral-600'
                      )}
                    />
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300">
                Additional details <span className="text-neutral-400 font-normal">(optional)</span>
              </label>
              <textarea
                rows={2}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                maxLength={500}
                placeholder="Tell us what happened..."
                className="w-full px-3.5 py-2.5 rounded-2xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-xs text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-amber-500/40 resize-none"
              />
            </div>

            <div className="p-2.5 rounded-xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200/70 dark:border-blue-900/50 flex items-center gap-2 text-[11px] text-blue-700 dark:text-blue-300">
              <Shield className="w-3.5 h-3.5 shrink-0" />
              <span>Your name is kept hidden from the sender when reporting.</span>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl border border-neutral-300 dark:border-neutral-700 text-xs font-semibold text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
              >
                {t('action.cancel', 'Cancel')}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shadow-md shadow-amber-500/20 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
              >
                {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Submit Report</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
