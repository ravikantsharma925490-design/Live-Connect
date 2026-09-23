import React, { useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { useLanguage } from '@/src/lib/LanguageContext';
import { TermsAgreementModal } from '@/src/components/legal/TermsAgreementModal';
import { LegalModal } from '@/src/components/legal/LegalModal';

interface AuthPageProps {
  onGoogleSignIn?: () => Promise<any>;
  onOpenConfig?: () => void;
  authError: string | null;
  clearError: () => void;
}

export const AuthPage: React.FC<AuthPageProps> = ({
  onGoogleSignIn,
  onOpenConfig,
  authError,
  clearError,
}) => {
  const { currentLanguage, openLanguageModal } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);

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
    setGoogleError(null);

    if (!agreedTerms) {
      setGoogleError('Please agree to the Terms of Use and Privacy Policy to continue.');
      return;
    }

    setLoading(true);
    try {
      if (onGoogleSignIn) {
        await onGoogleSignIn();
      } else {
        const supabase = (await import('@/src/lib/supabase/client')).getSupabase();
        if (!supabase) throw new Error('Database client unavailable');
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        const isInIframe = typeof window !== 'undefined' && window.self !== window.top;

        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: `${origin}/`,
            skipBrowserRedirect: isInIframe,
          },
        });

        if (error) throw error;
        if (isInIframe && data?.url) {
          window.open(data.url, '_blank', 'width=500,height=600');
        }
      }
    } catch (err: any) {
      console.error('[Google Auth Error]:', err);
      setGoogleError(err.message || 'Google Sign-in failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const activeError = googleError || authError;

  return (
    <div className="min-h-screen-safe w-full flex items-center justify-center p-4 bg-neutral-950 relative overflow-hidden">
      {/* Background Ambience */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/3 w-80 h-80 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />

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

      <div className="w-full max-w-sm rounded-3xl bg-neutral-900/80 border border-neutral-800 backdrop-blur-xl p-8 shadow-2xl space-y-6 relative z-10 text-white animate-in fade-in duration-300">
        
        {/* App Logo & Title */}
        <div className="text-center space-y-3">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center mx-auto shadow-lg shadow-blue-500/25 border border-white/10">
            <MessageSquare className="w-8 h-8 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white">LiveConnect</h1>
            <p className="text-xs text-neutral-400 mt-1 font-medium">
              Free, Secure & Real-time HD Messaging & Calling
            </p>
          </div>
        </div>

        {/* Error Messages Banner */}
        {activeError && (
          <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs leading-relaxed animate-in fade-in space-y-2">
            <div className="font-semibold text-sm">{activeError}</div>
            {onOpenConfig && (activeError.toLowerCase().includes('relation') ||
              activeError.toLowerCase().includes('function') ||
              activeError.toLowerCase().includes('trigger') ||
              activeError.toLowerCase().includes('column')) && (
              <button
                type="button"
                onClick={onOpenConfig}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/30 hover:bg-blue-600/50 border border-blue-500/40 text-blue-200 text-xs font-semibold transition-all cursor-pointer"
              >
                ⚙️ Open SQL Schema & Fix Guide
              </button>
            )}
          </div>
        )}

        {/* Content Box */}
        <div className="space-y-4">
          {/* Terms Checkbox */}
          <div className="p-3 rounded-2xl bg-neutral-800/50 border border-neutral-700/80 hover:border-neutral-600 transition-all">
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

          {/* Google Single Auth Button */}
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
                <svg width="20" height="20" viewBox="0 0 48 48" className="shrink-0">
                  <path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12s5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24s8.955,20,20,20s20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"/>
                  <path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"/>
                  <path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"/>
                  <path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"/>
                </svg>
                <span className="text-sm font-bold">
                  Continue with Google
                </span>
              </>
            )}
          </button>
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
