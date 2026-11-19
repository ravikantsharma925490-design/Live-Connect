import React, { useState, useEffect } from 'react';
import {
  MessageSquare,
  Mail,
  Lock,
  User as UserIcon,
  AtSign,
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useLanguage } from '@/src/lib/LanguageContext';
import { TermsAgreementModal } from '@/src/components/legal/TermsAgreementModal';
import { LegalModal } from '@/src/components/legal/LegalModal';
import { checkUsernameAvailability } from '@/src/hooks/useAuth';

interface AuthPageProps {
  onGoogleSignIn?: (payload?: { credential?: string; accessToken?: string }) => Promise<any>;
  onEmailSignIn?: (email: string, password: string) => Promise<any>;
  onSignUp?: (
    email: string,
    password: string,
    displayName: string,
    username: string,
    country?: string
  ) => Promise<any>;
  onVerifyOtp?: (email: string, otpCode: string) => Promise<any>;
  onResetPassword?: (email: string) => Promise<any>;
  onVerifyResetPassword?: (email: string, otpCode: string, newPassword: string) => Promise<any>;
  authError: string | null;
  clearError: () => void;
}

type AuthMode = 'signin' | 'signup' | 'verify_otp' | 'forgot' | 'reset_verify';

export const AuthPage: React.FC<AuthPageProps> = ({
  onGoogleSignIn,
  onEmailSignIn,
  onSignUp,
  onVerifyOtp,
  onResetPassword,
  onVerifyResetPassword,
  authError,
  clearError,
}) => {
  const { currentLanguage, openLanguageModal } = useLanguage();
  const [mode, setMode] = useState<AuthMode>('signin');
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  // Form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<{ available?: boolean; message?: string }>({});
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');

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

  // Live username check on signup
  useEffect(() => {
    if (mode !== 'signup') return;
    const clean = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!clean) {
      setUsernameStatus({});
      return;
    }
    if (clean.length < 3) {
      setUsernameStatus({ available: false, message: 'At least 3 characters required' });
      return;
    }
    const timer = setTimeout(async () => {
      const res = await checkUsernameAvailability(clean);
      setUsernameStatus(res);
    }, 350);
    return () => clearTimeout(timer);
  }, [username, mode]);

  const switchMode = (next: AuthMode) => {
    clearError();
    setLocalError(null);
    setInfoMessage(null);
    setMode(next);
  };

  const handleGoogleAuth = async () => {
    clearError();
    setLocalError(null);
    setInfoMessage(null);

    if (!agreedTerms) {
      setLocalError('Please agree to the Terms of Use and Privacy Policy to continue.');
      return;
    }

    setLoading(true);
    try {
      if (onGoogleSignIn) {
        await onGoogleSignIn();
      }
    } catch (err: any) {
      console.error('[Google Auth Error]:', err);
      setLocalError(err.message || 'Google Sign-in failed. You can also sign in with Email & Password.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setLocalError(null);
    setInfoMessage(null);

    if (!agreedTerms) {
      setLocalError('Please agree to the Terms of Use and Privacy Policy to continue.');
      return;
    }
    if (!email.trim() || !password) {
      setLocalError('Please enter both your email and password.');
      return;
    }

    setLoading(true);
    try {
      await onEmailSignIn?.(email, password);
    } catch (err: any) {
      setLocalError(err.message || 'Sign in failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setLocalError(null);
    setInfoMessage(null);

    if (!agreedTerms) {
      setLocalError('Please agree to the Terms of Use and Privacy Policy to continue.');
      return;
    }
    if (!displayName.trim() || !username.trim() || !email.trim() || !password) {
      setLocalError('Please complete all required fields.');
      return;
    }
    if (password.length < 6) {
      setLocalError('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);
    try {
      const result = await onSignUp?.(email, password, displayName, username);
      if (result?.needsOtp) {
        if (result.otpCode) {
          setInfoMessage(
            `Verification code generated: ${result.otpCode} (Enter below to verify your email)`
          );
          setOtpCode(result.otpCode);
        } else {
          setInfoMessage(`We sent a 6-digit verification code to ${email.trim().toLowerCase()}.`);
        }
        setMode('verify_otp');
      }
    } catch (err: any) {
      setLocalError(err.message || 'Could not create account.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setLocalError(null);
    if (!otpCode.trim()) {
      setLocalError('Please enter the 6-digit verification code.');
      return;
    }

    setLoading(true);
    try {
      await onVerifyOtp?.(email, otpCode);
    } catch (err: any) {
      setLocalError(err.message || 'Verification failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setLocalError(null);
    setInfoMessage(null);
    if (!email.trim()) {
      setLocalError('Please enter your registered email address.');
      return;
    }

    setLoading(true);
    try {
      const res = await onResetPassword?.(email);
      if (res?.otpCode) {
        setInfoMessage(`Reset verification code: ${res.otpCode}`);
        setOtpCode(res.otpCode);
      } else {
        setInfoMessage(`Password reset code sent to ${email.trim().toLowerCase()}.`);
      }
      setMode('reset_verify');
    } catch (err: any) {
      setLocalError(err.message || 'Could not send reset code.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetVerifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setLocalError(null);
    if (!otpCode.trim() || newPassword.length < 6) {
      setLocalError('Enter the verification code and a new password (at least 6 characters).');
      return;
    }

    setLoading(true);
    try {
      await onVerifyResetPassword?.(email, otpCode, newPassword);
      setInfoMessage('Password updated successfully! You can now sign in.');
      setPassword('');
      setNewPassword('');
      setOtpCode('');
      setMode('signin');
    } catch (err: any) {
      setLocalError(err.message || 'Password reset failed.');
    } finally {
      setLoading(false);
    }
  };

  const activeError = localError || authError;

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

      <div className="w-full max-w-sm rounded-3xl bg-neutral-900/85 border border-neutral-800 backdrop-blur-xl p-7 shadow-2xl space-y-5 relative z-10 text-white animate-in fade-in duration-300">
        {/* App Logo & Title */}
        <div className="text-center space-y-2.5">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center mx-auto shadow-lg shadow-blue-500/25 border border-white/10">
            <MessageSquare className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white">LiveConnect</h1>
            <p className="text-xs text-neutral-400 mt-0.5 font-medium">
              Free, Secure & Real-time HD Messaging & Calling
            </p>
          </div>
        </div>

        {/* Mode Switcher Tabs for Sign In / Create Account */}
        {(mode === 'signin' || mode === 'signup') && (
          <div className="grid grid-cols-2 p-1 rounded-xl bg-neutral-950/70 border border-neutral-800">
            <button
              type="button"
              onClick={() => switchMode('signin')}
              className={`py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                mode === 'signin'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => switchMode('signup')}
              className={`py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                mode === 'signup'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              Create Account
            </button>
          </div>
        )}

        {/* Info Banner */}
        {infoMessage && (
          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs leading-relaxed flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
            <span>{infoMessage}</span>
          </div>
        )}

        {/* Error Messages Banner */}
        {activeError && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs leading-relaxed">
            <div className="font-semibold">{activeError}</div>
          </div>
        )}

        {/* Sign In Form */}
        {mode === 'signin' && (
          <form onSubmit={handleSignInSubmit} className="space-y-3">
            <div className="relative">
              <Mail className="w-4 h-4 text-neutral-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email address"
                autoComplete="email"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-neutral-800/80 border border-neutral-700 text-sm text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="relative">
              <Lock className="w-4 h-4 text-neutral-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                autoComplete="current-password"
                className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-neutral-800/80 border border-neutral-700 text-sm text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white cursor-pointer"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => switchMode('forgot')}
                className="text-xs text-blue-400 hover:text-blue-300 font-medium cursor-pointer"
              >
                Forgot password?
              </button>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-bold shadow-lg shadow-blue-600/25 transition-all cursor-pointer"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        )}

        {/* Create Account Form */}
        {mode === 'signup' && (
          <form onSubmit={handleSignUpSubmit} className="space-y-3">
            <div className="relative">
              <UserIcon className="w-4 h-4 text-neutral-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Full Name"
                autoComplete="name"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-neutral-800/80 border border-neutral-700 text-sm text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <div className="relative">
                <AtSign className="w-4 h-4 text-neutral-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) =>
                    setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))
                  }
                  placeholder="username"
                  autoComplete="username"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-neutral-800/80 border border-neutral-700 text-sm text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              {usernameStatus.message && (
                <p
                  className={`text-[11px] mt-1 px-1 ${
                    usernameStatus.available ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {usernameStatus.message}
                </p>
              )}
            </div>

            <div className="relative">
              <Mail className="w-4 h-4 text-neutral-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email address"
                autoComplete="email"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-neutral-800/80 border border-neutral-700 text-sm text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="relative">
              <Lock className="w-4 h-4 text-neutral-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password (min 6 chars)"
                autoComplete="new-password"
                className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-neutral-800/80 border border-neutral-700 text-sm text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white cursor-pointer"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            <button
              type="submit"
              disabled={loading || usernameStatus.available === false}
              className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-bold shadow-lg shadow-blue-600/25 transition-all cursor-pointer"
            >
              {loading ? 'Creating account...' : 'Create Account'}
            </button>
          </form>
        )}

        {/* Verify Signup OTP Step */}
        {mode === 'verify_otp' && (
          <form onSubmit={handleVerifyOtpSubmit} className="space-y-3">
            <div className="relative">
              <KeyRound className="w-4 h-4 text-neutral-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value)}
                placeholder="6-digit verification code"
                maxLength={6}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-neutral-800/80 border border-neutral-700 text-sm text-white tracking-widest font-mono placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-bold transition-all cursor-pointer"
            >
              {loading ? 'Verifying...' : 'Verify & Continue'}
            </button>

            <button
              type="button"
              onClick={() => switchMode('signin')}
              className="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-neutral-400 hover:text-white cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to Sign In
            </button>
          </form>
        )}

        {/* Forgot Password Step 1 */}
        {mode === 'forgot' && (
          <form onSubmit={handleForgotSubmit} className="space-y-3">
            <p className="text-xs text-neutral-400 text-center">
              Enter your account email to receive a 6-digit password reset code.
            </p>
            <div className="relative">
              <Mail className="w-4 h-4 text-neutral-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Registered email address"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-neutral-800/80 border border-neutral-700 text-sm text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-bold transition-all cursor-pointer"
            >
              {loading ? 'Sending code...' : 'Send Reset Code'}
            </button>

            <button
              type="button"
              onClick={() => switchMode('signin')}
              className="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-neutral-400 hover:text-white cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to Sign In
            </button>
          </form>
        )}

        {/* Forgot Password Step 2 */}
        {mode === 'reset_verify' && (
          <form onSubmit={handleResetVerifySubmit} className="space-y-3">
            <div className="relative">
              <KeyRound className="w-4 h-4 text-neutral-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value)}
                placeholder="6-digit reset code"
                maxLength={6}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-neutral-800/80 border border-neutral-700 text-sm text-white tracking-widest font-mono placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="relative">
              <Lock className="w-4 h-4 text-neutral-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password (min 6 chars)"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-neutral-800/80 border border-neutral-700 text-sm text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-bold transition-all cursor-pointer"
            >
              {loading ? 'Updating...' : 'Reset Password'}
            </button>

            <button
              type="button"
              onClick={() => switchMode('signin')}
              className="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-neutral-400 hover:text-white cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to Sign In
            </button>
          </form>
        )}

        {/* Terms Checkbox & Google OAuth Option */}
        {(mode === 'signin' || mode === 'signup') && (
          <div className="space-y-3 pt-1">
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

            <div className="flex items-center gap-3 text-[11px] text-neutral-500">
              <div className="flex-1 h-px bg-neutral-800" />
              <span>or</span>
              <div className="flex-1 h-px bg-neutral-800" />
            </div>

            <button
              type="button"
              onClick={handleGoogleAuth}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 bg-white hover:bg-neutral-100 text-neutral-900 font-bold py-3 px-4 rounded-xl shadow-lg shadow-white/10 disabled:opacity-50 transition-all cursor-pointer hover:scale-[1.01] active:scale-[0.99]"
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
          </div>
        )}
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
