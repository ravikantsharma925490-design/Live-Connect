import { useState, useEffect, useCallback, useRef } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut as firebaseSignOut,
  User as FirebaseUser,
} from 'firebase/auth';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { AccountStatus, AuthSession, AuthUser, Profile } from '@/src/types';
import {
  auth,
  db,
  googleProvider,
  isFirebaseSessionActive,
  testConnection,
} from '@/src/lib/firebase/client';
import {
  fetchPublicProfileFs,
  fetchPrivateUserInfoFs,
  checkUsernameAvailabilityFs,
  suggestUniqueUsernameFs,
  createOnboardingUserDocsFs,
  updateUserProfileDocsFs,
} from '@/src/lib/firebase/services';
import { restGetDocument } from '@/src/lib/firebase/restFallback';
import { getClientDeviceId } from '@/src/lib/deviceId';
import { validateTextAgainstBannedWords } from '@/src/lib/bannedWordsCheck';

export const SESSION_STORAGE_KEY = 'liveconnect_session_token';
export const APPEAL_TOKEN_STORAGE_KEY = 'liveconnect_appeal_token';

export interface SuspensionInfo {
  status: Extract<AccountStatus, 'suspended' | 'disabled'> | string;
  banReason: string | null;
  ruleBroken: string | null;
  ruleLabel: string | null;
  banUntil: string | null;
  scheduledDeletionAt: string | null;
  strikeCount: number;
  appealToken: string | null;
  userId?: string;
  email?: string;
}

function getStoredToken(): string {
  if (typeof window === 'undefined') return '';
  try {
    return localStorage.getItem(SESSION_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function setStoredToken(token: string | null) {
  if (typeof window === 'undefined') return;
  try {
    if (token) {
      localStorage.setItem(SESSION_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {}
}

function getStoredAppealToken(): string {
  if (typeof window === 'undefined') return '';
  try {
    return localStorage.getItem(APPEAL_TOKEN_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function setStoredAppealToken(token: string | null) {
  if (typeof window === 'undefined') return;
  try {
    if (token) {
      localStorage.setItem(APPEAL_TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(APPEAL_TOKEN_STORAGE_KEY);
    }
  } catch {}
}

function buildAuthHeaders(token?: string | null, extra?: Record<string, string>): Record<string, string> {
  return {
    'x-device-id': getClientDeviceId(),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(extra || {}),
  };
}

// Helper: check if a username is available (Firestore when Firebase-signed-in, SQLite API otherwise)
export async function checkUsernameAvailability(
  username: string,
  excludeUserId?: string
): Promise<{
  available: boolean;
  message?: string;
}> {
  const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (!cleanUsername || cleanUsername.length < 3) {
    return {
      available: false,
      message: 'Username must be at least 3 characters (letters, numbers, underscores only).',
    };
  }

  if (auth.currentUser) {
    try {
      return await checkUsernameAvailabilityFs(cleanUsername, excludeUserId || auth.currentUser.uid);
    } catch {
      // Fall through safely
    }
  }

  try {
    const res = await fetch('/api/auth/check-username', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: cleanUsername,
        excludeUserId,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data.available === 'boolean') {
        return {
          available: data.available,
          message: data.message,
        };
      }
    }
  } catch {
    // ignore
  }

  return { available: true };
}

// Helper: generate a guaranteed unique username suggestion
export async function generateUniqueUsernameSuggestion(baseHint?: string): Promise<string> {
  const cleanBase = (baseHint || 'user')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .substring(0, 10);
  const base = cleanBase.length >= 3 ? cleanBase : 'user';

  if (auth.currentUser) {
    try {
      return await suggestUniqueUsernameFs(base);
    } catch {
      // Fall through safely
    }
  }

  try {
    const res = await fetch('/api/auth/suggest-username', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseHint: base }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.username) return data.username;
    }
  } catch {
    // ignore
  }

  return `${base}_${Math.floor(1000 + Math.random() * 9000)}`;
}

function loadCachedUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('liveconnect_cached_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function loadCachedProfile(): Profile | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('liveconnect_cached_profile');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function mapFirebaseUserToAuthUser(
  fbUser: FirebaseUser,
  privEmail?: string | null,
  privPhone?: string | null
): AuthUser {
  return {
    id: fbUser.uid,
    email: fbUser.email || privEmail || undefined,
    phone: fbUser.phoneNumber || privPhone || undefined,
    email_confirmed: fbUser.emailVerified,
    user_metadata: {
      full_name: fbUser.displayName || '',
      name: fbUser.displayName || '',
      display_name: fbUser.displayName || '',
      avatar_url: fbUser.photoURL || '',
      picture: fbUser.photoURL || '',
    },
    created_at: fbUser.metadata?.creationTime || new Date().toISOString(),
  };
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(loadCachedUser);
  const [profile, setProfile] = useState<Profile | null>(loadCachedProfile);
  const [session, setSession] = useState<AuthSession | null>(() => {
    const tok = getStoredToken();
    const u = loadCachedUser();
    return tok && u ? { access_token: tok } : null;
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [onboardingUser, setOnboardingUser] = useState<AuthUser | null>(null);
  const [profileCheckPending, setProfileCheckPending] = useState(false);
  const [bannedUntilDate, setBannedUntilDate] = useState<string | null>(null);
  const [suspensionInfo, setSuspensionInfo] = useState<SuspensionInfo | null>(null);
  const [restoredNoticePending, setRestoredNoticePending] = useState(false);
  const profileRef = useRef<Profile | null>(profile);
  const suspensionInfoRef = useRef<SuspensionInfo | null>(suspensionInfo);
  suspensionInfoRef.current = suspensionInfo;

  const updateProfileState = useCallback((newProf: Profile | null) => {
    profileRef.current = newProf;
    setProfile(newProf);
    if (typeof window !== 'undefined') {
      try {
        if (newProf) {
          localStorage.setItem('liveconnect_cached_profile', JSON.stringify(newProf));
        } else {
          localStorage.removeItem('liveconnect_cached_profile');
        }
      } catch {}
    }
  }, []);

  const updateUserState = useCallback((newUser: AuthUser | null) => {
    setUser(newUser);
    if (typeof window !== 'undefined') {
      try {
        if (newUser) {
          localStorage.setItem('liveconnect_cached_user', JSON.stringify(newUser));
        } else {
          localStorage.removeItem('liveconnect_cached_user');
        }
      } catch {}
    }
  }, []);

  const clearAuthState = useCallback(
    (preserveAppeal = false) => {
      setStoredToken(null);
      if (!preserveAppeal) {
        setStoredAppealToken(null);
        setSuspensionInfo(null);
      }
      setSession(null);
      updateUserState(null);
      updateProfileState(null);
      setNeedsOnboarding(false);
      setOnboardingUser(null);
    },
    [updateProfileState, updateUserState]
  );

  const enterSuspensionState = useCallback(
    (payload: {
      accountStatus?: string;
      status?: string;
      banReason?: string | null;
      ruleBroken?: string | null;
      ruleLabel?: string | null;
      banUntil?: string | null;
      bannedUntil?: string | null;
      scheduledDeletionAt?: string | null;
      strikeCount?: number;
      appealSession?: AuthSession | null;
      appealToken?: string | null;
      user?: AuthUser | null;
    }) => {
      const nextAppealToken =
        payload.appealSession?.access_token || payload.appealToken || getStoredAppealToken() || null;
      if (nextAppealToken) {
        setStoredAppealToken(nextAppealToken);
      }
      clearAuthState(true);
      const until = payload.banUntil || payload.bannedUntil || null;
      setBannedUntilDate(until);
      setSuspensionInfo({
        status: payload.accountStatus || payload.status || 'suspended',
        banReason: payload.banReason || 'Violation of LiveConnect Community Guidelines',
        ruleBroken: payload.ruleBroken || 'community_guidelines',
        ruleLabel: payload.ruleLabel || 'Community Guidelines',
        banUntil: until,
        scheduledDeletionAt: payload.scheduledDeletionAt || null,
        strikeCount: Number(payload.strikeCount || 0),
        appealToken: nextAppealToken,
        userId: payload.user?.id,
        email: payload.user?.email,
      });
    },
    [clearAuthState]
  );

  const applyServerAuthPayload = useCallback(
    (data: {
      session?: AuthSession | null;
      user?: AuthUser | null;
      profile?: Profile | null;
      needsOnboarding?: boolean;
      banned?: boolean;
      bannedUntil?: string | null;
      banUntil?: string | null;
      accountStatus?: string;
      banReason?: string | null;
      ruleBroken?: string | null;
      ruleLabel?: string | null;
      scheduledDeletionAt?: string | null;
      strikeCount?: number;
      appealSession?: AuthSession | null;
      restoredNoticePending?: boolean;
    }) => {
      if (data.banned) {
        enterSuspensionState(data);
        return;
      }

      setStoredAppealToken(null);
      setSuspensionInfo(null);
      setBannedUntilDate(null);

      if (data.session?.access_token) {
        setStoredToken(data.session.access_token);
        setSession(data.session);
      }

      if (data.user) {
        updateUserState(data.user);
      }

      if (data.profile) {
        updateProfileState(data.profile);
        setNeedsOnboarding(false);
        setOnboardingUser(null);
      } else if (data.user) {
        updateProfileState(null);
        setNeedsOnboarding(Boolean(data.needsOnboarding ?? true));
        setOnboardingUser(data.user);
      }

      if (data.restoredNoticePending) {
        setRestoredNoticePending(true);
      }
      setAuthError(null);
    },
    [enterSuspensionState, updateProfileState, updateUserState]
  );

  const resolveFirebaseUser = useCallback(
    async (fbUser: FirebaseUser, options?: { silent?: boolean }) => {
      const hasSameUserProfile = Boolean(profileRef.current && profileRef.current.id === fbUser.uid);
      if (!options?.silent && !hasSameUserProfile) {
        setProfileCheckPending(true);
      }
      try {
        void testConnection();
        const token = await fbUser.getIdToken().catch(() => fbUser.uid);

        // Always verify SQLite live moderation status if backend knows this user
        try {
          const banRes = await fetch('/api/auth/check-ban-status', {
            headers: buildAuthHeaders(token),
          });
          if (banRes.status === 401) {
            const errBody = await banRes.json().catch(() => null);
            if (errBody?.code === 'FORCE_LOGOUT') {
              await firebaseSignOut(auth).catch(() => {});
              clearAuthState(false);
              return;
            }
          }
          if (banRes.ok) {
            const banData = await banRes.json();
            if (banData?.banned) {
              await firebaseSignOut(auth).catch(() => {});
              enterSuspensionState({
                ...banData,
                appealToken: token,
                user: { id: fbUser.uid, email: fbUser.email || undefined, user_metadata: {} },
              });
              return;
            }
            if (banData?.restoredNoticePending) {
              setRestoredNoticePending(true);
            }
          }
        } catch {}

        const privInfo = await fetchPrivateUserInfoFs(fbUser.uid).catch(() => null);
        if (privInfo?.forceLogoutAfter) {
          const tokenRes = await fbUser.getIdTokenResult().catch(() => null);
          const authMs = tokenRes?.authTime ? new Date(tokenRes.authTime).getTime() : 0;
          const forceMs = new Date(privInfo.forceLogoutAfter).getTime();
          if (Number.isFinite(forceMs) && (!authMs || authMs < forceMs)) {
            await firebaseSignOut(auth).catch(() => {});
            clearAuthState(false);
            return;
          }
        }

        if (privInfo?.bannedUntil && new Date(privInfo.bannedUntil).getTime() > Date.now()) {
          await firebaseSignOut(auth).catch(() => {});
          enterSuspensionState({
            accountStatus: 'suspended',
            banReason: 'Violation of LiveConnect Community Guidelines',
            bannedUntil: privInfo.bannedUntil,
            appealToken: token,
          });
          return;
        }

        const mappedUser = {
          ...mapFirebaseUserToAuthUser(fbUser, privInfo?.email, privInfo?.phoneNumber),
          admin_role: privInfo?.adminRole || 'none',
          is_verified: Boolean(privInfo?.isVerified),
        };
        setSession({ access_token: token });
        updateUserState(mappedUser);

        let publicProf: Profile | null = null;
        let profileFetchFailed = false;
        try {
          publicProf = await fetchPublicProfileFs(fbUser.uid);
        } catch {
          profileFetchFailed = true;
        }

        if (publicProf) {
          const mergedProf: Profile = {
            ...publicProf,
            email: privInfo?.email ?? fbUser.email ?? null,
            phone_number: privInfo?.phoneNumber ?? fbUser.phoneNumber ?? null,
            admin_role: privInfo?.adminRole || 'none',
            is_verified: Boolean(publicProf.is_verified || privInfo?.isVerified),
          };
          updateProfileState(mergedProf);
          setNeedsOnboarding(false);
          setOnboardingUser(null);
          setAuthError(null);

          updateDoc(doc(db, 'public_profiles', fbUser.uid), {
            isOnline: true,
            lastSeen: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }).catch(() => {});
        } else if (profileFetchFailed) {
          const cachedProf = loadCachedProfile();
          if (cachedProf && cachedProf.id === fbUser.uid) {
            updateProfileState(cachedProf);
            setNeedsOnboarding(false);
            setOnboardingUser(null);
            setAuthError(null);
          } else {
            updateProfileState(null);
            setNeedsOnboarding(false);
            setOnboardingUser(null);
            setAuthError('Could not connect to LiveConnect servers. Please check your internet connection and try again.');
          }
        } else {
          // Verify via REST before dropping an already-loaded profile to onboarding on transient cache misses
          let confirmedMissing = true;
          if (hasSameUserProfile && profileRef.current) {
            const restCheck = await restGetDocument(`public_profiles/${fbUser.uid}`).catch(() => null);
            if (!restCheck || restCheck.exists) {
              confirmedMissing = false;
              updateProfileState(profileRef.current);
              setNeedsOnboarding(false);
              setOnboardingUser(null);
              setAuthError(null);
            }
          }
          if (confirmedMissing) {
            updateProfileState(null);
            setNeedsOnboarding(true);
            setOnboardingUser(mappedUser);
            setAuthError(null);
          }
        }
      } catch (err: any) {
        console.warn('Error resolving Firebase user:', err?.message);
      } finally {
        setProfileCheckPending(false);
        setLoading(false);
      }
    },
    [enterSuspensionState, updateProfileState, updateUserState]
  );

  const refreshProfile = useCallback(async (options?: { silent?: boolean }) => {
    const isSilent = options?.silent ?? Boolean(profileRef.current);
    if (auth.currentUser) {
      await resolveFirebaseUser(auth.currentUser, { silent: isSilent });
      return;
    }

    const token = getStoredToken() || getStoredAppealToken();
    if (!token) {
      clearAuthState();
      setLoading(false);
      return;
    }

    if (!isSilent) {
      setProfileCheckPending(true);
    }
    try {
      const res = await fetch('/api/auth/session', {
        headers: buildAuthHeaders(token),
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          clearAuthState();
        }
        return;
      }
      const data = await res.json();
      if (data.banned) {
        enterSuspensionState({
          ...data,
          appealToken: token,
        });
        return;
      }
      if (!data.session || !data.user) {
        clearAuthState();
        return;
      }
      applyServerAuthPayload(data);
    } catch (err: any) {
      console.warn('Error refreshing session:', err?.message);
    } finally {
      setProfileCheckPending(false);
      setLoading(false);
    }
  }, [applyServerAuthPayload, clearAuthState, enterSuspensionState, resolveFirebaseUser]);

  const acknowledgeRestored = useCallback(async () => {
    setRestoredNoticePending(false);
    const token = getStoredToken() || session?.access_token;
    if (token) {
      await fetch('/api/account/acknowledge-restored', {
        method: 'POST',
        headers: buildAuthHeaders(token, { 'Content-Type': 'application/json' }),
      }).catch(() => {});
    }
  }, [session?.access_token]);

  useEffect(() => {
    const safetyTimer = setTimeout(() => {
      setLoading(false);
    }, 2500);

    getRedirectResult(auth)
      .then((res) => {
        if (res?.user) {
          void resolveFirebaseUser(res.user);
        }
      })
      .catch((err: any) => {
        if (err?.code && err.code !== 'auth/no-auth-event') {
          setAuthError(err.message || 'Google sign-in redirect did not complete.');
        }
      });

    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      clearTimeout(safetyTimer);
      if (fbUser) {
        await resolveFirebaseUser(fbUser);
      } else {
        const token = getStoredToken() || getStoredAppealToken();
        if (token) {
          await refreshProfile();
        } else {
          clearAuthState();
          setLoading(false);
        }
      }
    });

    // Live status check every 30s (immediate logout across devices + auto-restore detection)
    const banCheckInterval = setInterval(async () => {
      if (auth.currentUser) {
        try {
          const idToken = await auth.currentUser.getIdToken().catch(() => auth.currentUser?.uid || '');
          const rawBanRes = await fetch('/api/auth/check-ban-status', {
            headers: buildAuthHeaders(idToken),
          });
          if (rawBanRes.status === 401) {
            const errBody = await rawBanRes.json().catch(() => null);
            if (errBody?.code === 'FORCE_LOGOUT') {
              await firebaseSignOut(auth).catch(() => {});
              clearAuthState(false);
              return;
            }
          }
          const banRes = rawBanRes.ok ? await rawBanRes.json().catch(() => null) : null;

          if (banRes?.banned) {
            await firebaseSignOut(auth).catch(() => {});
            enterSuspensionState({ ...banRes, appealToken: idToken });
            return;
          }
          if (banRes?.restoredNoticePending) {
            setRestoredNoticePending(true);
          }

          const privInfo = await fetchPrivateUserInfoFs(auth.currentUser.uid).catch(() => null);
          if (privInfo?.forceLogoutAfter) {
            const tokenRes = await auth.currentUser.getIdTokenResult().catch(() => null);
            const authMs = tokenRes?.authTime ? new Date(tokenRes.authTime).getTime() : 0;
            const forceMs = new Date(privInfo.forceLogoutAfter).getTime();
            if (Number.isFinite(forceMs) && (!authMs || authMs < forceMs)) {
              await firebaseSignOut(auth).catch(() => {});
              clearAuthState(false);
              return;
            }
          }
          if (privInfo?.bannedUntil && new Date(privInfo.bannedUntil).getTime() > Date.now()) {
            await firebaseSignOut(auth).catch(() => {});
            enterSuspensionState({
              accountStatus: 'suspended',
              bannedUntil: privInfo.bannedUntil,
              appealToken: idToken,
            });
          }
        } catch {}
        return;
      }

      const currentToken = getStoredToken() || getStoredAppealToken();
      if (!currentToken) return;
      try {
        const res = await fetch('/api/auth/check-ban-status', {
          headers: buildAuthHeaders(currentToken),
        });
        if (res.status === 401) {
          // Session was revoked across all devices (e.g., suspended/banned)
          await refreshProfile();
          return;
        }
        const banStatus = await res.json();

        if (banStatus?.banned) {
          enterSuspensionState({ ...banStatus, appealToken: currentToken });
        } else if (!banStatus?.banned && suspensionInfoRef.current) {
          // Account was restored (or ban expired) while sitting on BannedScreen!
          await refreshProfile();
        } else if (banStatus?.restoredNoticePending) {
          setRestoredNoticePending(true);
        }
      } catch {}
    }, 30000);

    return () => {
      clearTimeout(safetyTimer);
      clearInterval(banCheckInterval);
      unsubscribe();
    };
  }, [clearAuthState, enterSuspensionState, refreshProfile, resolveFirebaseUser]);

  const completeOnboarding = async (details: {
    username: string;
    displayName: string;
    country?: string;
    bio?: string;
    gender: string;
    avatarUrl?: string;
  }) => {
    const targetUser = onboardingUser || user;
    if (!targetUser) throw new Error('No pending user to onboard');

    const resolvedAvatar =
      details.avatarUrl ||
      targetUser.user_metadata?.avatar_url ||
      targetUser.user_metadata?.picture ||
      undefined;

    if (isFirebaseSessionActive(targetUser.id)) {
      const savedProfile = await createOnboardingUserDocsFs(targetUser.id, targetUser.email, {
        ...details,
        avatarUrl: resolvedAvatar,
      });
      const fullProf: Profile = {
        ...savedProfile,
        email: targetUser.email || null,
      };
      updateProfileState(fullProf);
      updateUserState(targetUser);
      setNeedsOnboarding(false);
      setOnboardingUser(null);
      return;
    }

    const token = getStoredToken();
    const res = await fetch('/api/auth/complete-onboarding', {
      method: 'POST',
      headers: buildAuthHeaders(token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        userId: targetUser.id,
        username: details.username.trim().toLowerCase().replace(/[^a-z0-9_]/g, ''),
        displayName: details.displayName,
        country: details.country,
        bio: details.bio,
        gender: details.gender,
        avatarUrl: resolvedAvatar,
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to save profile');
    }

    if (data.profile) {
      updateProfileState(data.profile);
    }
    updateUserState(targetUser);
    setNeedsOnboarding(false);
    setOnboardingUser(null);
  };

  const signInWithGoogle = async (payload?: { credential?: string; accessToken?: string }) => {
    setAuthError(null);

    if (!payload?.credential && !payload?.accessToken) {
      try {
        const result = await signInWithPopup(auth, googleProvider);
        await resolveFirebaseUser(result.user);
        return { success: true, user: result.user };
      } catch (err: any) {
        const code = err?.code || '';
        const isInIframe = typeof window !== 'undefined' && window.self !== window.top;

        if (code === 'auth/popup-blocked') {
          if (!isInIframe) {
            try {
              await signInWithRedirect(auth, googleProvider);
              return { success: true, redirected: true };
            } catch (redirectErr: any) {
              const redirectMsg = redirectErr?.message || 'Google sign-in redirect failed.';
              setAuthError(redirectMsg);
              return { success: false, code, popupBlocked: true, error: redirectMsg };
            }
          }
          const msg =
            'Pop-up was blocked by your browser. Please allow pop-ups for this site or open LiveConnect in a new tab.';
          setAuthError(msg);
          return { success: false, code, popupBlocked: true, error: msg };
        }

        if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
          const msg = 'Google sign-in pop-up was closed before completing sign-in.';
          setAuthError(msg);
          return { success: false, code, cancelled: true, error: msg };
        }

        const msg = err?.message || 'Failed to sign in with Google.';
        setAuthError(msg);
        return { success: false, code, error: msg };
      }
    }

    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: buildAuthHeaders(null, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      if (data.banned) {
        enterSuspensionState(data);
        return { success: false, banned: true, error: data.error };
      }
      const msg = data.error || 'Failed to sign in with Google';
      setAuthError(msg);
      throw new Error(msg);
    }

    applyServerAuthPayload(data);
    return data;
  };

  const loginWithTruecaller = async (payload: {
    user?: AuthUser;
    profile?: Profile | null;
    session?: AuthSession;
    banned?: boolean;
    accountStatus?: string;
    banReason?: string | null;
    ruleBroken?: string | null;
    ruleLabel?: string | null;
    banUntil?: string | null;
    scheduledDeletionAt?: string | null;
    strikeCount?: number;
    appealSession?: AuthSession | null;
  }) => {
    setAuthError(null);
    if (payload.banned) {
      enterSuspensionState(payload);
      return { success: false, banned: true };
    }
    try {
      applyServerAuthPayload({
        session: payload.session,
        user: payload.user,
        profile: payload.profile,
        needsOnboarding: !payload.profile,
      });
      return { success: true };
    } catch (err: any) {
      setAuthError(err?.message || 'Failed to finish Truecaller login');
      throw err;
    }
  };

  const signOut = async () => {
    if (auth.currentUser) {
      const uid = auth.currentUser.uid;
      await updateDoc(doc(db, 'public_profiles', uid), {
        isOnline: false,
        lastSeen: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }).catch(() => {});
      await firebaseSignOut(auth).catch(() => {});
    }

    const token = getStoredToken() || getStoredAppealToken();
    if (token) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: buildAuthHeaders(token, { 'Content-Type': 'application/json' }),
        });
      } catch {}
    }
    clearAuthState(false);
    setBannedUntilDate(null);
    setRestoredNoticePending(false);
  };

  const updateProfile = async (updates: Partial<Profile>) => {
    if (!user) return null;

    const textToValidate = [updates.display_name, updates.username, updates.bio].filter(Boolean).join(' ');
    if (textToValidate.trim()) {
      const wordCheck = await validateTextAgainstBannedWords(textToValidate);
      if (wordCheck.blocked) {
        const msg = wordCheck.errorMessage || 'Your profile text contains a restricted word.';
        setAuthError(msg);
        throw new Error(msg);
      }
    }

    if (isFirebaseSessionActive(user.id)) {
      try {
        const updatedPublic = await updateUserProfileDocsFs(user.id, profile, updates);
        const mergedProfile: Profile = {
          ...updatedPublic,
          email: updates.email !== undefined ? updates.email : profile?.email ?? user.email ?? null,
          phone_number:
            updates.phone_number !== undefined ? updates.phone_number : profile?.phone_number ?? null,
          is_verified: profile?.is_verified ?? updatedPublic.is_verified,
          admin_role: profile?.admin_role ?? user.admin_role,
        };
        updateProfileState(mergedProfile);
        return mergedProfile;
      } catch (err: any) {
        setAuthError(err?.message || 'Failed to update profile');
        throw err;
      }
    }

    const token = getStoredToken();

    try {
      const res = await fetch('/api/auth/update-profile', {
        method: 'POST',
        headers: buildAuthHeaders(token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ userId: user.id, updates }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        if (data.code === 'ACCOUNT_SUSPENDED') {
          enterSuspensionState(data);
        }
        throw new Error(data.error || 'Failed to update profile');
      }

      if (data.profile) {
        updateProfileState(data.profile);
        return data.profile as Profile;
      }

      const mergedProfile: Profile = {
        ...(profile || {}),
        id: user.id,
        username: updates.username || profile?.username || 'user',
        display_name: updates.display_name || profile?.display_name || 'User',
        avatar_url: updates.avatar_url !== undefined ? updates.avatar_url : profile?.avatar_url || null,
        bio: updates.bio !== undefined ? updates.bio : profile?.bio || null,
        gender: updates.gender !== undefined ? updates.gender : profile?.gender || null,
        country: updates.country !== undefined ? updates.country : profile?.country || null,
        is_online: profile?.is_online ?? true,
        last_seen: new Date().toISOString(),
        created_at: profile?.created_at || user.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      updateProfileState(mergedProfile);
      return mergedProfile;
    } catch (err: any) {
      setAuthError(err.message || 'Failed to update profile');
      throw err;
    }
  };

  return {
    user,
    profile,
    session,
    loading,
    authError,
    setAuthError,
    signInWithGoogle,
    loginWithTruecaller,
    applyServerAuthPayload,
    signOut,
    needsOnboarding,
    onboardingUser,
    profileCheckPending,
    bannedUntilDate,
    suspensionInfo,
    restoredNoticePending,
    acknowledgeRestored,
    completeOnboarding,
    updateProfile,
    refreshProfile,
  };
}

