import React, { useState, useEffect, useCallback, useRef } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut as fbSignOut, User as FirebaseUser } from 'firebase/auth';
import {
  LayoutDashboard,
  Users,
  Flag,
  Home,
  Scale,
  LifeBuoy,
  BadgeCheck,
  ShieldBan,
  UserCog,
  FileText,
  Settings,
  Sun,
  Moon,
  LogOut,
  Menu,
  X,
  Lock,
  KeyRound,
  Loader2,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react';
import { auth, googleProvider } from '@/src/lib/firebase/client';
import {
  adminApi,
  AdminAuthState,
  AdminApiError,
  reauthenticateGoogleFresh,
  setStoredAdminSessionToken,
} from '@/src/lib/admin/adminApi';
import { AdminDashboardView } from './AdminDashboardView';
import { AdminUsersView } from './AdminUsersView';
import { AdminReportsView } from './AdminReportsView';
import { AdminFamiliesView } from './AdminFamiliesView';
import { AdminAppealsView } from './AdminAppealsView';
import { AdminTicketsView } from './AdminTicketsView';
import { AdminGovernanceView } from './AdminGovernanceView';
import { AdminOfficialChatView } from './AdminOfficialChatView';
import { cn } from '@/src/lib/utils';

type AdminTab =
  | 'dashboard'
  | 'users'
  | 'reports'
  | 'families'
  | 'appeals'
  | 'tickets'
  | 'official_chat'
  | 'banned_words'
  | 'roles'
  | 'logs'
  | 'settings';

interface NavItem {
  id: AdminTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: Array<'super_admin' | 'moderator' | 'support'>;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['super_admin'] },
  { id: 'users', label: 'Users', icon: Users, roles: ['super_admin', 'moderator', 'support'] },
  { id: 'reports', label: 'Reports', icon: Flag, roles: ['super_admin', 'moderator'] },
  { id: 'families', label: 'Families', icon: Home, roles: ['super_admin'] },
  { id: 'appeals', label: 'Ban Appeals', icon: Scale, roles: ['super_admin', 'moderator'] },
  { id: 'tickets', label: 'Support Tickets', icon: LifeBuoy, roles: ['super_admin', 'support'] },
  { id: 'official_chat', label: 'Official Chat', icon: BadgeCheck, roles: ['super_admin', 'moderator'] },
  { id: 'banned_words', label: 'Banned Words', icon: ShieldBan, roles: ['super_admin'] },
  { id: 'roles', label: 'Admin Roles', icon: UserCog, roles: ['super_admin'] },
  { id: 'logs', label: 'Activity Logs', icon: FileText, roles: ['super_admin'] },
  { id: 'settings', label: 'Settings & PIN', icon: Settings, roles: ['super_admin'] },
];

export const AdminRoot: React.FC = () => {
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const saved = localStorage.getItem('theme');
    return saved ? saved === 'dark' : document.documentElement.classList.contains('dark');
  });

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [darkMode]);

  const [fbUser, setFbUser] = useState<FirebaseUser | null | undefined>(undefined);
  const [authState, setAuthState] = useState<AdminAuthState | null>(null);
  const [loadingState, setLoadingState] = useState(true);
  const [isNotFound, setIsNotFound] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [googleSigningIn, setGoogleSigningIn] = useState(false);

  // PIN states
  const [pinInput, setPinInput] = useState('');
  const [confirmPinInput, setConfirmPinInput] = useState('');
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [inactivityNotice, setInactivityNotice] = useState<string | null>(null);

  // Forgot PIN states
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotReauthed, setForgotReauthed] = useState(false);
  const [forgotReauthBusy, setForgotReauthBusy] = useState(false);

  // Lockout timer countdown
  const [lockSecondsLeft, setLockSecondsLeft] = useState(0);

  // Navigation
  const [activeTab, setActiveTab] = useState<AdminTab>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const lastActivityRef = useRef<number>(Date.now());
  const lastPingRef = useRef<number>(Date.now());

  const loadAdminAuthState = useCallback(async () => {
    setLoadingState(true);
    setAuthError(null);
    setIsNotFound(false);

    if (!auth.currentUser) {
      setAuthState(null);
      setLoadingState(false);
      return;
    }

    try {
      const state = await adminApi.getAuthState();
      setAuthState(state);
      // Choose allowed default tab for this admin role
      const allowedTabs = NAV_ITEMS.filter(
        (i) =>
          i.roles.includes(state.adminRole) &&
          (i.id !== 'official_chat' || Boolean(state.permissions?.officialChat))
      );
      if (allowedTabs.length > 0 && !allowedTabs.some((t) => t.id === activeTab)) {
        setActiveTab(allowedTabs[0].id);
      }
    } catch (err: any) {
      if (err instanceof AdminApiError && err.status === 404) {
        setIsNotFound(true);
        setAuthState(null);
      } else {
        setAuthError(err?.message || 'Unable to verify access.');
      }
    } finally {
      setLoadingState(false);
    }
  }, [activeTab]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFbUser(user);
      if (!user) {
        setStoredAdminSessionToken(null);
        setAuthState(null);
        setIsNotFound(false);
        setLoadingState(false);
      } else {
        void loadAdminAuthState();
      }
    });
    return () => unsub();
  }, [loadAdminAuthState]);

  // Countdown for 15-min lockout
  useEffect(() => {
    if (!authState?.pinLockedUntil) {
      setLockSecondsLeft(0);
      return;
    }
    const updateCountdown = () => {
      const ms = new Date(authState.pinLockedUntil!).getTime() - Date.now();
      if (ms <= 0) {
        setLockSecondsLeft(0);
        void loadAdminAuthState();
      } else {
        setLockSecondsLeft(Math.ceil(ms / 1000));
      }
    };
    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, [authState?.pinLockedUntil, loadAdminAuthState]);

  // Listen for server-triggered PIN expiration
  useEffect(() => {
    const handler = () => {
      setPinError(null);
      setInactivityNotice('Your admin PIN session expired. Please enter your 6-digit PIN.');
      void loadAdminAuthState();
    };
    window.addEventListener('liveconnect_admin_pin_expired', handler);
    return () => window.removeEventListener('liveconnect_admin_pin_expired', handler);
  }, [loadAdminAuthState]);

  // 15-minute inactivity auto-logout & 4-min activity heartbeat
  useEffect(() => {
    if (!authState?.pinSessionValid) return;

    const timeoutMs = Math.max(60, authState.idleTimeoutSeconds || 900) * 1000;
    lastActivityRef.current = Date.now();
    lastPingRef.current = Date.now();

    const markActivity = () => {
      lastActivityRef.current = Date.now();
    };

    const events = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'];
    events.forEach((ev) => window.addEventListener(ev, markActivity, { passive: true }));

    const interval = setInterval(() => {
      const now = Date.now();
      if (now - lastActivityRef.current >= timeoutMs) {
        void adminApi.logout().finally(() => {
          setInactivityNotice('Signed out due to 15 minutes of inactivity.');
          void loadAdminAuthState();
        });
        return;
      }
      if (now - lastPingRef.current >= 4 * 60 * 1000 && now - lastActivityRef.current < 5 * 60 * 1000) {
        lastPingRef.current = now;
        void adminApi.ping().catch(() => null);
      }
    }, 10_000);

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, markActivity));
      clearInterval(interval);
    };
  }, [authState?.pinSessionValid, authState?.idleTimeoutSeconds, loadAdminAuthState]);

  const handleGoogleSignIn = async () => {
    setGoogleSigningIn(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      setAuthError(err?.message || 'Google sign-in cancelled.');
    } finally {
      setGoogleSigningIn(false);
    }
  };

  const handleSetupPin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError(null);
    if (!/^\d{6}$/.test(pinInput)) {
      setPinError('PIN must be exactly 6 numeric digits.');
      return;
    }
    if (pinInput !== confirmPinInput) {
      setPinError('PINs do not match.');
      return;
    }
    setPinBusy(true);
    try {
      await adminApi.setupPin(pinInput, confirmPinInput);
      setPinInput('');
      setConfirmPinInput('');
      setInactivityNotice(null);
      await loadAdminAuthState();
    } catch (err: any) {
      setPinError(err?.message || 'Failed to save PIN.');
    } finally {
      setPinBusy(false);
    }
  };

  const handleVerifyPin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError(null);
    if (!/^\d{6}$/.test(pinInput)) {
      setPinError('Enter your 6-digit numeric PIN.');
      return;
    }
    setPinBusy(true);
    try {
      await adminApi.verifyPin(pinInput);
      setPinInput('');
      setInactivityNotice(null);
      await loadAdminAuthState();
    } catch (err: any) {
      setPinError(err?.message || 'Incorrect PIN.');
      if (err instanceof AdminApiError && (err.data?.pinLockedUntil || err.data?.remainingAttempts !== undefined)) {
        await loadAdminAuthState();
      }
    } finally {
      setPinBusy(false);
    }
  };

  const handleStartForgotPin = async () => {
    setPinError(null);
    setForgotReauthBusy(true);
    try {
      await reauthenticateGoogleFresh();
      setForgotReauthed(true);
    } catch (err: any) {
      setPinError(err?.message || 'Google re-authentication failed.');
    } finally {
      setForgotReauthBusy(false);
    }
  };

  const handleCompleteForgotPin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError(null);
    if (!/^\d{6}$/.test(pinInput)) {
      setPinError('New PIN must be exactly 6 numeric digits.');
      return;
    }
    if (pinInput !== confirmPinInput) {
      setPinError('PINs do not match.');
      return;
    }
    setPinBusy(true);
    try {
      await adminApi.changePin(pinInput, confirmPinInput, 'forgot');
      setPinInput('');
      setConfirmPinInput('');
      setForgotMode(false);
      setForgotReauthed(false);
      setInactivityNotice(null);
      await loadAdminAuthState();
    } catch (err: any) {
      setPinError(err?.message || 'Could not reset PIN.');
    } finally {
      setPinBusy(false);
    }
  };

  const handleSignOutAll = async () => {
    await adminApi.logout();
    try {
      await fbSignOut(auth);
    } catch {
      // ignore
    }
    setAuthState(null);
  };

  const formatCountdown = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  // ==================== 404 FOR NON-ADMINS ====================
  if (isNotFound) {
    return (
      <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 flex items-center justify-center p-6">
        <div className="max-w-sm w-full text-center space-y-4">
          <p className="text-5xl font-bold tracking-tight tabular-nums text-neutral-300 dark:text-neutral-700">
            404
          </p>
          <h1 className="text-lg font-bold">Page Not Found</h1>
          <p className="text-sm text-neutral-500">
            The requested page does not exist or is unavailable.
          </p>
          <a
            href="/"
            className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-sm font-semibold"
          >
            Go Home
          </a>
        </div>
      </div>
    );
  }

  // ==================== LOADING ====================
  if (fbUser === undefined || loadingState) {
    return (
      <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 flex items-center justify-center p-6">
        <div className="flex items-center gap-2.5 text-sm text-neutral-500">
          <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
          <span>Verifying session...</span>
        </div>
      </div>
    );
  }

  // ==================== GOOGLE SIGN-IN ====================
  if (!fbUser) {
    return (
      <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 flex items-center justify-center p-6">
        <div className="w-full max-w-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-900 flex items-center justify-center text-blue-600 dark:text-blue-400">
              <Lock className="w-5 h-5" />
            </div>
            <button
              type="button"
              onClick={() => setDarkMode((d) => !d)}
              className="p-2 rounded-lg border border-neutral-200 dark:border-neutral-800 text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 cursor-pointer"
              title="Toggle theme"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
          <div>
            <h1 className="text-lg font-bold">LiveConnect Console</h1>
            <p className="text-sm text-neutral-500 mt-1">
              Sign in with your authorized Google account to continue.
            </p>
          </div>
          {authError && (
            <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-700 dark:text-rose-300">
              {authError}
            </div>
          )}
          <button
            type="button"
            disabled={googleSigningIn}
            onClick={() => void handleGoogleSignIn()}
            className="w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer"
          >
            {googleSigningIn && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>Sign in with Google</span>
          </button>
        </div>
      </div>
    );
  }

  // ==================== AUTH ERROR FALLBACK ====================
  if (!authState) {
    return (
      <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 flex items-center justify-center p-6">
        <div className="w-full max-w-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-6 space-y-4">
          <p className="text-sm text-rose-600 dark:text-rose-400">
            {authError || 'Could not load console state.'}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadAdminAuthState()}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold cursor-pointer"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => void handleSignOutAll()}
              className="px-4 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 text-xs font-semibold cursor-pointer"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ==================== STEP 2: SET PIN OR ENTER 6-DIGIT PIN ====================
  if (authState.needsPinSetup || !authState.pinSessionValid) {
    const isLocked = lockSecondsLeft > 0;
    return (
      <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 flex items-center justify-center p-6">
        <div className="w-full max-w-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-900 flex items-center justify-center text-blue-600 dark:text-blue-400">
              <KeyRound className="w-5 h-5" />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setDarkMode((d) => !d)}
                className="p-2 rounded-lg border border-neutral-200 dark:border-neutral-800 text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 cursor-pointer"
                title="Toggle theme"
              >
                {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
              <button
                type="button"
                onClick={() => void handleSignOutAll()}
                className="px-2.5 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-800 text-xs font-semibold text-neutral-600 dark:text-neutral-300 cursor-pointer"
              >
                Sign Out
              </button>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider">
              {authState.adminRole.replace('_', ' ')} • {authState.email}
            </p>
            <h1 className="text-lg font-bold mt-1">
              {authState.needsPinSetup
                ? 'Set your 6-digit PIN'
                : forgotMode
                ? 'Reset your 6-digit PIN'
                : 'Enter your 6-digit PIN'}
            </h1>
            <p className="text-sm text-neutral-500 mt-1">
              {authState.needsPinSetup
                ? 'Create a 6-digit numeric PIN for two-step admin verification.'
                : forgotMode
                ? 'Re-verify your Google account to set a new 6-digit PIN.'
                : 'Enter your 6-digit numeric PIN to unlock the admin console.'}
            </p>
          </div>

          {inactivityNotice && (
            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-300">
              {inactivityNotice}
            </div>
          )}

          {pinError && (
            <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{pinError}</span>
            </div>
          )}

          {isLocked && !forgotMode ? (
            <div className="p-4 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 space-y-2 text-center">
              <p className="text-xs font-semibold text-rose-700 dark:text-rose-300">
                Too many incorrect PIN attempts
              </p>
              <p className="text-2xl font-bold tabular-nums text-rose-800 dark:text-rose-200">
                {formatCountdown(lockSecondsLeft)}
              </p>
              <p className="text-xs text-rose-600 dark:text-rose-400">
                PIN entry is locked for 15 minutes, or use Google recovery below.
              </p>
            </div>
          ) : authState.needsPinSetup ? (
            <form onSubmit={handleSetupPin} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-1">
                  Enter 6-digit PIN
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  autoFocus
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="••••••"
                  required
                  className="w-full px-3 py-2.5 rounded-lg bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 text-center text-lg tracking-[0.4em] tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-1">
                  Confirm 6-digit PIN
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  value={confirmPinInput}
                  onChange={(e) => setConfirmPinInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="••••••"
                  required
                  className="w-full px-3 py-2.5 rounded-lg bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 text-center text-lg tracking-[0.4em] tabular-nums"
                />
              </div>
              <button
                type="submit"
                disabled={pinBusy || pinInput.length !== 6 || confirmPinInput.length !== 6}
                className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                {pinBusy && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>Save PIN & Enter</span>
              </button>
            </form>
          ) : forgotMode ? (
            !forgotReauthed ? (
              <div className="space-y-3">
                <button
                  type="button"
                  disabled={forgotReauthBusy}
                  onClick={() => void handleStartForgotPin()}
                  className="w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 cursor-pointer"
                >
                  {forgotReauthBusy ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="w-4 h-4" />
                  )}
                  <span>Re-authenticate with Google</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setForgotMode(false);
                    setPinError(null);
                  }}
                  className="w-full py-2 text-xs font-semibold text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 cursor-pointer"
                >
                  Back to PIN Entry
                </button>
              </div>
            ) : (
              <form onSubmit={handleCompleteForgotPin} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-1">
                    New 6-digit PIN
                  </label>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    autoFocus
                    value={pinInput}
                    onChange={(e) => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="••••••"
                    required
                    className="w-full px-3 py-2.5 rounded-lg bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 text-center text-lg tracking-[0.4em] tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-1">
                    Confirm 6-digit PIN
                  </label>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    value={confirmPinInput}
                    onChange={(e) => setConfirmPinInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="••••••"
                    required
                    className="w-full px-3 py-2.5 rounded-lg bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 text-center text-lg tracking-[0.4em] tabular-nums"
                  />
                </div>
                <button
                  type="submit"
                  disabled={pinBusy || pinInput.length !== 6 || confirmPinInput.length !== 6}
                  className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 cursor-pointer"
                >
                  {pinBusy && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>Reset PIN & Unlock</span>
                </button>
              </form>
            )
          ) : (
            <form onSubmit={handleVerifyPin} className="space-y-3">
              <div>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  autoFocus
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="••••••"
                  required
                  className="w-full px-3 py-2.5 rounded-lg bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 text-center text-lg tracking-[0.4em] tabular-nums"
                />
                {authState.remainingAttempts < 5 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5 text-center tabular-nums">
                    {authState.remainingAttempts} attempt(s) remaining before 15m lock
                  </p>
                )}
              </div>
              <button
                type="submit"
                disabled={pinBusy || pinInput.length !== 6}
                className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                {pinBusy && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>Unlock Console</span>
              </button>
            </form>
          )}

          {!authState.needsPinSetup && !forgotMode && (
            <div className="text-center pt-1">
              <button
                type="button"
                onClick={() => {
                  setForgotMode(true);
                  setForgotReauthed(false);
                  setPinInput('');
                  setConfirmPinInput('');
                  setPinError(null);
                }}
                className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
              >
                Forgot PIN? Reset with Google
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ==================== AUTHENTICATED ADMIN SHELL ====================
  const visibleNavItems = NAV_ITEMS.filter(
    (item) =>
      item.roles.includes(authState.adminRole) &&
      (item.id !== 'official_chat' || Boolean(authState.permissions?.officialChat))
  );
  const currentTabItem = visibleNavItems.find((i) => i.id === activeTab) || visibleNavItems[0];
  const resolvedTab = currentTabItem.id;

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 flex">
      {/* Mobile Sidebar Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed lg:sticky top-0 left-0 z-50 h-screen w-60 bg-white dark:bg-neutral-900 border-r border-neutral-200 dark:border-neutral-800 flex flex-col transition-transform duration-200 lg:translate-x-0 shrink-0',
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="h-14 px-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-neutral-900 dark:text-neutral-100">LiveConnect</p>
            <p className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider">
              {authState.adminRole.replace('_', ' ')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className="p-1.5 rounded-lg text-neutral-500 lg:hidden cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = resolvedTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  setMobileMenuOpen(false);
                }}
                className={cn(
                  'w-full px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2.5 transition-colors cursor-pointer text-left',
                  active
                    ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-semibold'
                    : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-neutral-100'
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-neutral-200 dark:border-neutral-800 space-y-2">
          <div className="px-2 py-1">
            <p className="text-xs font-medium text-neutral-900 dark:text-neutral-100 truncate">
              {authState.email}
            </p>
            <p className="text-[11px] text-neutral-500">Auto-lock: 15m idle</p>
          </div>
          <button
            type="button"
            onClick={() => void handleSignOutAll()}
            className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs font-semibold text-neutral-700 dark:text-neutral-300 flex items-center justify-center gap-2 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 h-14 px-4 sm:px-6 bg-white/95 dark:bg-neutral-900/95 backdrop-blur border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="p-2 rounded-lg border border-neutral-200 dark:border-neutral-800 text-neutral-600 dark:text-neutral-300 lg:hidden cursor-pointer"
            >
              <Menu className="w-4 h-4" />
            </button>
            <h1 className="text-base font-bold text-neutral-900 dark:text-neutral-100">
              {currentTabItem.label}
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDarkMode((d) => !d)}
              className="p-2 rounded-lg border border-neutral-200 dark:border-neutral-800 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
              title={darkMode ? 'Light mode' : 'Dark mode'}
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto">
          {resolvedTab === 'dashboard' && <AdminDashboardView />}
          {resolvedTab === 'users' && (
            <AdminUsersView permissions={authState.permissions} />
          )}
          {resolvedTab === 'reports' && <AdminReportsView />}
          {resolvedTab === 'families' && <AdminFamiliesView />}
          {resolvedTab === 'appeals' && <AdminAppealsView />}
          {resolvedTab === 'tickets' && <AdminTicketsView />}
          {resolvedTab === 'official_chat' && (
            <AdminOfficialChatView
              isSuperAdmin={authState.adminRole === 'super_admin'}
              initialModeratorsEnabled={Boolean(authState.officialChatModeratorsEnabled)}
              onModeratorsToggleChanged={(enabled) =>
                setAuthState((prev) =>
                  prev
                    ? {
                        ...prev,
                        officialChatModeratorsEnabled: enabled,
                        permissions: {
                          ...prev.permissions,
                          officialChat: prev.adminRole === 'super_admin' || enabled,
                        },
                      }
                    : prev
                )
              }
            />
          )}
          {(resolvedTab === 'banned_words' ||
            resolvedTab === 'roles' ||
            resolvedTab === 'logs' ||
            resolvedTab === 'settings') && (
            <AdminGovernanceView section={resolvedTab} currentEmail={authState.email} />
          )}
        </main>
      </div>
    </div>
  );
};
