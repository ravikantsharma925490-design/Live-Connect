import { useState, useEffect, useCallback } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut as firebaseSignOut,
  User as FirebaseUser,
} from 'firebase/auth';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { AuthSession, AuthUser, Profile } from '@/src/types';
import {
  auth,
  db,
  googleProvider,
  isFirebaseSessionActive,
} from '@/src/lib/firebase/client';
import {
  fetchPublicProfileFs,
  fetchPrivateUserInfoFs,
  checkUsernameAvailabilityFs,
  suggestUniqueUsernameFs,
  createOnboardingUserDocsFs,
  updateUserProfileDocsFs,
} from '@/src/lib/firebase/services';

export const SESSION_STORAGE_KEY = 'liveconnect_session_token';

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

function mapFirebaseUserToAuthUser(fbUser: FirebaseUser, privEmail?: string | null, privPhone?: string | null): AuthUser {
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
  const [loading, setLoading] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return !localStorage.getItem('liveconnect_cached_user');
  });
  const [authError, setAuthError] = useState<string | null>(null);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [onboardingUser, setOnboardingUser] = useState<AuthUser | null>(null);
  const [profileCheckPending, setProfileCheckPending] = useState(false);
  const [bannedUntilDate, setBannedUntilDate] = useState<string | null>(null);

  const updateProfileState = useCallback((newProf: Profile | null) => {
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

  const clearAuthState = useCallback(() => {
    setStoredToken(null);
    setSession(null);
    updateUserState(null);
    updateProfileState(null);
    setNeedsOnboarding(false);
    setOnboardingUser(null);
  }, [updateProfileState, updateUserState]);

  const applyServerAuthPayload = useCallback(
    (data: {
      session?: AuthSession | null;
      user?: AuthUser | null;
      profile?: Profile | null;
      needsOnboarding?: boolean;
      banned?: boolean;
      bannedUntil?: string | null;
    }) => {
      if (data.banned) {
        clearAuthState();
        setBannedUntilDate(data.bannedUntil || null);
        return;
      }

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
      setAuthError(null);
    },
    [clearAuthState, updateProfileState, updateUserState]
  );

  const resolveFirebaseUser = useCallback(
    async (fbUser: FirebaseUser) => {
      setProfileCheckPending(true);
      try {
        const privInfo = await fetchPrivateUserInfoFs(fbUser.uid).catch(() => null);
        if (privInfo?.bannedUntil && new Date(privInfo.bannedUntil).getTime() > Date.now()) {
          await firebaseSignOut(auth).catch(() => {});
          clearAuthState();
          setBannedUntilDate(privInfo.bannedUntil);
          return;
        }

        const mappedUser = mapFirebaseUserToAuthUser(fbUser, privInfo?.email, privInfo?.phoneNumber);
        const token = await fbUser.getIdToken().catch(() => fbUser.uid);
        setSession({ access_token: token });
        updateUserState(mappedUser);

        const publicProf = await fetchPublicProfileFs(fbUser.uid).catch(() => null);
        if (publicProf) {
          const mergedProf: Profile = {
            ...publicProf,
            email: privInfo?.email ?? fbUser.email ?? null,
            phone_number: privInfo?.phoneNumber ?? fbUser.phoneNumber ?? null,
          };
          updateProfileState(mergedProf);
          setNeedsOnboarding(false);
          setOnboardingUser(null);

          updateDoc(doc(db, 'public_profiles', fbUser.uid), {
            isOnline: true,
            lastSeen: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }).catch(() => {});
        } else {
          updateProfileState(null);
          setNeedsOnboarding(true);
          setOnboardingUser(mappedUser);
        }
        setAuthError(null);
      } catch (err: any) {
        console.warn('Error resolving Firebase user:', err?.message);
      } finally {
        setProfileCheckPending(false);
        setLoading(false);
      }
    },
    [clearAuthState, updateProfileState, updateUserState]
  );

  const refreshProfile = useCallback(async () => {
    if (auth.currentUser) {
      await resolveFirebaseUser(auth.currentUser);
      return;
    }

    const token = getStoredToken();
    if (!token) {
      clearAuthState();
      setLoading(false);
      return;
    }

    setProfileCheckPending(true);
    try {
      const res = await fetch('/api/auth/session', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        clearAuthState();
        return;
      }
      const data = await res.json();
      if (!data.session || !data.user) {
        if (data.banned) {
          clearAuthState();
          setBannedUntilDate(data.bannedUntil || null);
        } else {
          clearAuthState();
        }
        return;
      }
      applyServerAuthPayload(data);
    } catch (err: any) {
      console.warn('Error refreshing session:', err?.message);
    } finally {
      setProfileCheckPending(false);
      setLoading(false);
    }
  }, [applyServerAuthPayload, clearAuthState, resolveFirebaseUser]);

  useEffect(() => {
    const safetyTimer = setTimeout(() => {
      setLoading(false);
    }, 1500);

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
        const token = getStoredToken();
        if (token) {
          await refreshProfile();
        } else {
          clearAuthState();
          setLoading(false);
        }
      }
    });

    const banCheckInterval = setInterval(async () => {
      if (auth.currentUser) {
        try {
          const privInfo = await fetchPrivateUserInfoFs(auth.currentUser.uid);
          if (privInfo?.bannedUntil && new Date(privInfo.bannedUntil).getTime() > Date.now()) {
            await firebaseSignOut(auth).catch(() => {});
            clearAuthState();
            setBannedUntilDate(privInfo.bannedUntil);
          }
        } catch {}
        return;
      }

      const currentToken = getStoredToken();
      if (!currentToken) return;
      try {
        const banStatus = await fetch('/api/auth/check-ban-status', {
          headers: { Authorization: `Bearer ${currentToken}` },
        }).then((r) => r.json());

        if (banStatus?.banned) {
          clearAuthState();
          setBannedUntilDate(banStatus.bannedUntil || null);
        }
      } catch {}
    }, 60000);

    return () => {
      clearTimeout(safetyTimer);
      clearInterval(banCheckInterval);
      unsubscribe();
    };
  }, [clearAuthState, refreshProfile, resolveFirebaseUser]);

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
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
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

  const signUp = async (
    email: string,
    password: string,
    displayName: string,
    username: string,
    country?: string
  ) => {
    setAuthError(null);
    const cleanEmail = email.trim().toLowerCase();
    const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');

    if (cleanUsername.length < 3) {
      const msg = 'Username must be at least 3 characters (letters, numbers, underscores only).';
      setAuthError(msg);
      throw new Error(msg);
    }
    if (password.length < 6) {
      const msg = 'Password must be at least 6 characters.';
      setAuthError(msg);
      throw new Error(msg);
    }

    const res = await fetch('/api/auth/create-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: cleanEmail,
        password,
        displayName: displayName.trim() || cleanUsername,
        username: cleanUsername,
        country: country || 'India',
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      const msg = data.error || 'Failed to create account';
      setAuthError(msg);
      throw new Error(msg);
    }

    return {
      needsOtp: Boolean(data.needsOtp),
      email: cleanEmail,
      emailSent: Boolean(data.emailSent),
      otpCode: data.emailSent ? undefined : data.otpCode,
      session: data.session,
      user: data.user,
      profile: data.profile,
    };
  };

  const verifySignupOtp = async (email: string, otpCode: string) => {
    setAuthError(null);
    const res = await fetch('/api/auth/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim().toLowerCase(), otpCode: otpCode.trim() }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      const msg = data.error || 'Invalid verification code';
      setAuthError(msg);
      throw new Error(msg);
    }
    if (data.session && data.user) {
      applyServerAuthPayload({
        session: data.session,
        user: data.user,
        profile: data.profile,
        needsOnboarding: !data.profile,
      });
    }
    return data;
  };

  const sendLoginOtp = async (email: string) => {
    setAuthError(null);
    const res = await fetch('/api/auth/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim().toLowerCase(), type: 'login' }),
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data.error || 'Failed to send verification code';
      setAuthError(msg);
      throw new Error(msg);
    }
    return data;
  };

  const signIn = async (email: string, password: string) => {
    setAuthError(null);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      if (data.banned) {
        setBannedUntilDate(data.bannedUntil || null);
      }
      const msg = data.error || 'Failed to sign in';
      setAuthError(msg);
      throw new Error(msg);
    }

    applyServerAuthPayload(data);
    return data;
  };

  const signInWithGoogle = async (payload?: { credential?: string; accessToken?: string }) => {
    setAuthError(null);

    // Primary path: Firebase Google Sign-In
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

    // Legacy GIS token fallback
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      if (data.banned) {
        setBannedUntilDate(data.bannedUntil || null);
      }
      const msg = data.error || 'Failed to sign in with Google';
      setAuthError(msg);
      throw new Error(msg);
    }

    applyServerAuthPayload(data);
    return data;
  };

  const loginWithTruecaller = async (payload: { user: AuthUser; profile: Profile | null; session?: AuthSession }) => {
    setAuthError(null);
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

    const token = getStoredToken();
    if (token) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        });
      } catch {}
    }
    clearAuthState();
  };

  const resetPassword = async (email: string) => {
    setAuthError(null);
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim().toLowerCase() }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      const msg = data.error || 'Failed to send password reset code';
      setAuthError(msg);
      throw new Error(msg);
    }
    return data;
  };

  const verifyResetPassword = async (email: string, otpCode: string, newPassword: string) => {
    setAuthError(null);
    const res = await fetch('/api/auth/verify-reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: email.trim().toLowerCase(),
        otpCode: otpCode.trim(),
        newPassword,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      const msg = data.error || 'Failed to reset password';
      setAuthError(msg);
      throw new Error(msg);
    }
    return data;
  };

  const updatePassword = async (newPassword: string) => {
    setAuthError(null);
    const token = getStoredToken();
    const res = await fetch('/api/auth/update-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ newPassword }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      const msg = data.error || 'Failed to update password';
      setAuthError(msg);
      throw new Error(msg);
    }
    setIsPasswordRecovery(false);
  };

  const updateProfile = async (updates: Partial<Profile>) => {
    if (!user) return null;

    if (isFirebaseSessionActive(user.id)) {
      try {
        const updatedPublic = await updateUserProfileDocsFs(user.id, profile, updates);
        const mergedProfile: Profile = {
          ...updatedPublic,
          email: updates.email !== undefined ? updates.email : profile?.email ?? user.email ?? null,
          phone_number:
            updates.phone_number !== undefined ? updates.phone_number : profile?.phone_number ?? null,
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
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ userId: user.id, updates }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
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
    signUp,
    verifySignupOtp,
    signIn,
    signInWithGoogle,
    loginWithTruecaller,
    sendLoginOtp,
    signOut,
    resetPassword,
    verifyResetPassword,
    updatePassword,
    isPasswordRecovery,
    setIsPasswordRecovery,
    needsOnboarding,
    onboardingUser,
    profileCheckPending,
    bannedUntilDate,
    completeOnboarding,
    updateProfile,
    refreshProfile,
  };
}
