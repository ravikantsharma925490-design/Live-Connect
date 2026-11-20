import React from 'react';
import { CheckCircle2, ShieldCheck } from 'lucide-react';

interface AccountRestoredModalProps {
  isOpen: boolean;
  strikeCount?: number;
  onContinue: () => void | Promise<void>;
}

export const AccountRestoredModal: React.FC<AccountRestoredModalProps> = ({
  isOpen,
  strikeCount = 0,
  onContinue,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-xs animate-in fade-in font-sans">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-2xl p-6 md:p-7 text-center space-y-5 text-neutral-900 dark:text-neutral-100">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="w-9 h-9" />
        </div>

        <div className="space-y-2">
          <h2 className="text-xl font-bold tracking-tight">Your account has been restored</h2>
          <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">
            Your profile, follower counts, search visibility, direct messages, and calls are active again.
          </p>
        </div>

        <div className="p-3.5 rounded-xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-800 flex items-center justify-between text-xs">
          <span className="flex items-center gap-2 font-semibold text-neutral-600 dark:text-neutral-300">
            <ShieldCheck className="w-4 h-4 text-[#0095F6]" />
            <span>Current Account Strikes</span>
          </span>
          <span className="font-mono font-bold text-neutral-900 dark:text-neutral-100">
            {strikeCount} / 3
          </span>
        </div>

        <button
          type="button"
          onClick={onContinue}
          className="w-full min-h-[44px] py-3 px-5 rounded-xl bg-[#0095F6] hover:bg-[#0081d6] text-white font-bold text-sm transition-colors cursor-pointer"
        >
          Continue
        </button>
      </div>
    </div>
  );
};
