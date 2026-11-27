import { auth } from '@/src/lib/firebase/client';

const SESSION_STORAGE_KEY = 'liveconnect_session_token';

/**
 * Returns HTTP Authorization header for the active session
 * (Firebase ID token when signed in via Firebase, or SQLite session token otherwise).
 */
export async function getAuthHeaders(forceRefresh = false): Promise<Record<string, string>> {
  try {
    if (auth.currentUser) {
      const idToken = await auth.currentUser.getIdToken(forceRefresh);
      if (idToken) {
        return { Authorization: `Bearer ${idToken}` };
      }
    }
  } catch {
    // Fallback to local SQLite session token if Firebase token retrieval fails
  }

  if (typeof window !== 'undefined') {
    const token = localStorage.getItem(SESSION_STORAGE_KEY);
    if (token) {
      return { Authorization: `Bearer ${token}` };
    }
  }

  return {};
}
