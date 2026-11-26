import React, { useState } from 'react';
import { ExternalLink, ShieldCheck } from 'lucide-react';
import { useLanguage } from '@/src/lib/LanguageContext';
import { TermsAgreementModal } from '@/src/components/legal/TermsAgreementModal';
import { LegalModal } from '@/src/components/legal/LegalModal';

interface AuthPageProps {
  onGoogleSignIn?: (payload?: { credential?: string; accessToken?: string }) => Promise<any>;
  authError: string | null;
  clearError: () => void;
}

export const AuthPage: React.FC<AuthPageProps> = ({
  onGoogleSignIn,
  authError,
  clearError,
}) => {
  const { currentLanguage, openLanguageModal } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [popupBlocked, setPopupBlocked] = useState(false);

  // Terms & Privacy Agreement State
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [legalDocModal, setLegalDocModal] = useState<{
    isOpen: boolean;
    tab: 'terms' | 'privacy';
  }>({
    isOpen: false,
    tab: 'terms',
  });

  const handleGoogleAuth = async () => {
    clearError();
    setLocalError(null);
    setPopupBlocked(false);

    if (!agreedTerms) {
      setLocalError('Please agree to the Terms of Use and Privacy Policy to continue.');
      return;
    }

    setLoading(true);
    try {
      if (onGoogleSignIn) {
        const res = await onGoogleSignIn();
        if (res && res.success === false) {
          if (res.popupBlocked) {
            setPopupBlocked(true);
          }
          setLocalError(
            res.error || 'Google Sign-in could not be completed. Please try again.'
          );
        }
      }
    } catch (err: any) {
      const msg = err?.message || 'Google Sign-in failed. Please try again.';
      if (msg.toLowerCase().includes('pop-up') || msg.toLowerCase().includes('popup')) {
        setPopupBlocked(true);
      }
      setLocalError(msg);
    } finally {
      setLoading(false);
    }
  };

  const activeError = localError || authError;

  return (
    <div className="min-h-screen-safe w-full flex items-center justify-center p-4 bg-neutral-950 relative overflow-hidden">
      {/* Background Ambience */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-fuchsia-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/3 w-80 h-80 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Language Selector Top Right */}
      <div className="absolute top-4 right-4 z-20">
        <button
          type="button"
          onClick={openLanguageModal}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-neutral-900/90 border border-neutral-800 text-neutral-300 hover:text-white text-xs font-semibold backdrop-blur-md transition-all hover:border-neutral-700 cursor-pointer shadow-lg"
        >
          <span>{currentLanguage.flag}</span>
          <span>{currentLanguage.name}</span>
        </button>
      </div>

      <div className="w-full max-w-sm rounded-3xl bg-neutral-900/85 border border-neutral-800 backdrop-blur-xl p-7 shadow-2xl space-y-6 relative z-10 text-white animate-in fade-in duration-300">
        {/* App Logo & Title */}
        <div className="text-center space-y-3.5">
          <div className="relative mx-auto w-24 h-24 flex items-center justify-center">
            <div
              className="absolute -inset-3 rounded-full blur-2xl opacity-75 pointer-events-none"
              style={{
                background:
                  'radial-gradient(circle, rgba(217,70,239,0.42) 0%, rgba(59,130,246,0.34) 48%, rgba(34,211,238,0.28) 72%, transparent 85%)',
              }}
            />
            <div
              className="relative w-24 h-24 rounded-[22px] p-[1.5px] shadow-[0_0_28px_rgba(56,189,248,0.28),0_0_18px_rgba(192,38,211,0.22)]"
              style={{
                background:
                  'linear-gradient(135deg, rgba(232,121,249,0.75) 0%, rgba(99,102,241,0.5) 50%, rgba(34,211,238,0.8) 100%)',
              }}
            >
              <div className="w-full h-full rounded-[20.5px] overflow-hidden bg-[#050814]">
                <img
                  src="/assets/aistudio/Neon_LiveConnect_App_Icon_b1b5dd76.png"
                  alt="LiveConnect Logo"
                  className="w-full h-full object-cover select-none pointer-events-none"
                />
              </div>
            </div>
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight">
              <span className="text-white">Live</span>
              <span className="bg-gradient-to-r from-fuchsia-400 via-indigo-400 to-cyan-400 bg-clip-text text-transparent">
                Connect
              </span>
            </h1>
            <p className="text-xs text-neutral-400 mt-1 font-medium">
              Free, Secure & Real-time HD Messaging & Calling
            </p>
          </div>
        </div>

        {/* Error Messages Banner */}
        {activeError && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs leading-relaxed space-y-2">
            <div className="font-semibold">{activeError}</div>
            {popupBlocked && typeof window !== 'undefined' && (
              <div className="pt-1 flex flex-wrap items-center gap-2">
                <a
                  href={window.location.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-neutral-900 hover:bg-neutral-100 font-bold text-[11px] transition-colors"
                >
                  <span>Open in New Tab to Sign In</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}
          </div>
        )}

        {/* Terms Checkbox & Google Sign-In / Sign-Up */}
        <div className="space-y-4">
          <div className="p-3.5 rounded-2xl bg-neutral-800/50 border border-neutral-700/80 hover:border-neutral-600 transition-all">
            <label className="flex items-start gap-2.5 cursor-pointer group select-none">
              <input
                type="checkbox"
                checked={agreedTerms}
                onChange={(e) => setAgreedTerms(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-neutral-600 bg-neutral-900 text-blue-500 focus:ring-blue-500 focus:ring-offset-neutral-900 cursor-pointer transition-all"
              />
              <span className="text-xs text-neutral-300 group-hover:text-white leading-relaxed">
                I agree to the{' '}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setLegalDocModal({ isOpen: true, tab: 'terms' });
                  }}
                  className="text-blue-400 font-semibold underline hover:text-blue-300 cursor-pointer"
                >
                  Terms of Use
                </button>{' '}
                and{' '}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setLegalDocModal({ isOpen: true, tab: 'privacy' });
                  }}
                  className="text-blue-400 font-semibold underline hover:text-blue-300 cursor-pointer"
                >
                  Privacy Policy
                </button>
              </span>
            </label>
          </div>

          <button
            type="button"
            onClick={handleGoogleAuth}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 bg-white hover:bg-neutral-100 text-neutral-900 font-bold py-3.5 px-4 rounded-xl shadow-lg shadow-white/10 disabled:opacity-50 transition-all cursor-pointer hover:scale-[1.01] active:scale-[0.99]"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-neutral-800/30 border-t-neutral-800 rounded-full animate-spin" />
            ) : (
              <>
                <svg width="18" height="18" viewBox="0 0 48 48" className="shrink-0">
                  <path
                    fill="#FFC107"
                    d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12s5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24s8.955,20,20,20s20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"
                  />
                  <path
                    fill="#FF3D00"
                    d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"
                  />
                  <path
                    fill="#4CAF50"
                    d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"
                  />
                  <path
                    fill="#1976D2"
                    d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"
                  />
                </svg>
                <span className="text-sm font-bold">Continue with Google</span>
              </>
            )}
          </button>

          <div className="flex items-center justify-center gap-1.5 text-[11px] text-neutral-400">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>Sign in or create your account instantly with Google</span>
          </div>
        </div>
      </div>

      {/* Pop-up Agreement Modal */}
      <TermsAgreementModal
        isOpen={showTermsModal}
        onClose={() => setShowTermsModal(false)}
        onAgree={() => {
          setAgreedTerms(true);
          setShowTermsModal(false);
        }}
        onOpenLegalDoc={(tab) => setLegalDocModal({ isOpen: true, tab })}
      />

      {/* Detailed Legal Documents Viewer Modal */}
      <LegalModal
        isOpen={legalDocModal.isOpen}
        onClose={() => setLegalDocModal({ isOpen: false, tab: 'terms' })}
        initialTab={legalDocModal.tab}
        onAgreeAndContinue={() => {
          setAgreedTerms(true);
          setLegalDocModal({ isOpen: false, tab: 'terms' });
        }}
      />
    </div>
  );
};
