import React, { useEffect, useState } from 'react';
import { X, Link2, Users, Loader2, ShieldCheck, CheckCircle2, AlertCircle } from 'lucide-react';
import { Family, Profile } from '@/src/types';
import { extractFamilyInviteCode } from '@/src/lib/family/constants';
import { lookupFamilyByInviteCode } from '@/src/lib/family/familyService';
import { UserAvatar } from '../ui/UserAvatar';
import { useLanguage } from '@/src/lib/LanguageContext';

interface JoinFamilyModalProps {
  isOpen: boolean;
  currentUser: Profile | null;
  initialInviteCode?: string | null;
  onClose: () => void;
  onConfirmJoin: (code: string) => Promise<{ status: 'active' | 'pending'; familyId: string; familyName?: string }>;
  onOpenFamily?: (familyId: string) => void;
}

export const JoinFamilyModal: React.FC<JoinFamilyModalProps> = ({
  isOpen,
  currentUser,
  initialInviteCode,
  onClose,
  onConfirmJoin,
  onOpenFamily,
}) => {
  const { t } = useLanguage();
  const [rawInput, setRawInput] = useState(initialInviteCode || '');
  const [lookingUp, setLookingUp] = useState(false);
  const [joining, setJoining] = useState(false);
  const [preview, setPreview] = useState<{
    code: string;
    family: Pick<Family, 'id' | 'name' | 'photoUrl' | 'memberCount' | 'maxMembers' | 'joinApprovalRequired'>;
    membershipStatus: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultNotice, setResultNotice] = useState<{
    status: 'active' | 'pending';
    familyId: string;
    familyName?: string;
  } | null>(null);

  const runLookup = async (inputStr: string) => {
    const code = extractFamilyInviteCode(inputStr);
    if (!code || !currentUser?.id) {
      setError('Please enter a valid Family invite link or code.');
      return;
    }
    setLookingUp(true);
    setError(null);
    setPreview(null);
    setResultNotice(null);
    try {
      const data = await lookupFamilyByInviteCode(currentUser.id, code);
      setPreview({ code, ...data });
    } catch (err: any) {
      setError(err?.message || 'Invite link is invalid, reset, or disabled.');
    } finally {
      setLookingUp(false);
    }
  };

  useEffect(() => {
    if (!isOpen) {
      setPreview(null);
      setError(null);
      setResultNotice(null);
      return;
    }
    if (initialInviteCode) {
      setRawInput(initialInviteCode);
      void runLookup(initialInviteCode);
    } else {
      setRawInput('');
    }
  }, [isOpen, initialInviteCode]);

  if (!isOpen) return null;

  const handleJoin = async () => {
    if (!preview) return;
    setJoining(true);
    setError(null);
    try {
      const res = await onConfirmJoin(preview.code);
      setResultNotice(res);
      if (res.status === 'active') {
        onOpenFamily?.(res.familyId);
        onClose();
      }
    } catch (err: any) {
      setError(err?.message || 'Unable to join Family.');
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 w-full max-w-md rounded-3xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-800/40">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-600/10 text-blue-600 dark:text-blue-400">
              <Link2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-neutral-900 dark:text-neutral-100">
                {preview ? 'Join Family?' : 'Join with Invite Link'}
              </h3>
              <p className="text-[11px] text-neutral-500">
                Paste a Family invite link or code
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

        <div className="p-5 space-y-4">
          {!initialInviteCode && !resultNotice && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void runLookup(rawInput);
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                value={rawInput}
                onChange={(e) => setRawInput(e.target.value)}
                placeholder="Paste ?joinFamily=... link or code"
                className="flex-1 px-3.5 py-2.5 rounded-2xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-xs text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
              <button
                type="submit"
                disabled={lookingUp || !rawInput.trim()}
                className="px-4 py-2.5 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold disabled:opacity-50 cursor-pointer shrink-0"
              >
                {lookingUp ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Check'}
              </button>
            </form>
          )}

          {lookingUp && (
            <div className="py-8 flex flex-col items-center justify-center gap-2 text-xs text-neutral-500">
              <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
              <span>Checking Family invite...</span>
            </div>
          )}

          {error && (
            <div className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 flex items-start gap-2.5 text-xs text-rose-700 dark:text-rose-300">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
              <span>{error}</span>
            </div>
          )}

          {resultNotice?.status === 'pending' && (
            <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 space-y-2 text-center">
              <CheckCircle2 className="w-8 h-8 text-amber-500 mx-auto" />
              <h4 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
                Waiting for approval
              </h4>
              <p className="text-xs text-neutral-600 dark:text-neutral-300">
                Your request to join <strong>{resultNotice.familyName || 'this Family'}</strong> was sent. You will get access once the Owner or an Admin approves it.
              </p>
              <button
                type="button"
                onClick={onClose}
                className="mt-2 px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold cursor-pointer"
              >
                Got it
              </button>
            </div>
          )}

          {preview && !resultNotice && (
            <div className="p-4 rounded-2xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700/70 space-y-4">
              <div className="flex items-center gap-3.5">
                <UserAvatar
                  src={preview.family.photoUrl}
                  name={preview.family.name}
                  id={preview.family.id}
                  className="w-14 h-14 rounded-2xl shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <h4 className="text-base font-extrabold text-neutral-900 dark:text-neutral-100 truncate">
                    {preview.family.name}
                  </h4>
                  <p className="text-xs text-neutral-500 flex items-center gap-1.5 mt-0.5">
                    <Users className="w-3.5 h-3.5" />
                    <span>
                      {preview.family.memberCount.toLocaleString()} / {preview.family.maxMembers.toLocaleString()} members
                    </span>
                  </p>
                </div>
              </div>

              {preview.membershipStatus === 'removed' ? (
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-700 dark:text-rose-300">
                  You were removed from this Family and cannot rejoin until the Owner or an Admin allows you again.
                </div>
              ) : preview.membershipStatus === 'active' ? (
                <div className="flex items-center justify-between gap-2 pt-1">
                  <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                    You are already in this Family.
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      onOpenFamily?.(preview.family.id);
                      onClose();
                    }}
                    className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold cursor-pointer"
                  >
                    Open Family
                  </button>
                </div>
              ) : preview.membershipStatus === 'pending' ? (
                <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-xs text-amber-700 dark:text-amber-300">
                  Your join request is already pending approval.
                </div>
              ) : (
                <>
                  {preview.family.joinApprovalRequired && (
                    <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 flex items-start gap-2 text-xs text-blue-700 dark:text-blue-300">
                      <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>
                        Join Approval is enabled. Your request will be reviewed by the Family Owner or Admins before you can view chats.
                      </span>
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={onClose}
                      className="px-4 py-2 rounded-xl border border-neutral-300 dark:border-neutral-700 text-xs font-semibold text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
                    >
                      {t('action.cancel', 'Cancel')}
                    </button>
                    <button
                      type="button"
                      onClick={handleJoin}
                      disabled={joining}
                      className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-md shadow-blue-500/20 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                    >
                      {joining && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      <span>{preview.family.joinApprovalRequired ? 'Request to Join' : 'Join Family'}</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
