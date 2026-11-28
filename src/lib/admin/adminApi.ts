import { reauthenticateWithPopup, signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from '@/src/lib/firebase/client';
import type { OfficialMessage } from '@/src/types';

export type AdminRole = 'super_admin' | 'moderator' | 'support';

export interface AdminPermissions {
  dashboard: boolean;
  analytics: boolean;
  usersView: boolean;
  usersManage: boolean;
  reports: boolean;
  families: boolean;
  logs: boolean;
  settings: boolean;
  appeals: boolean;
  officialChat: boolean;
  bannedWords: boolean;
  roles: boolean;
  tickets: boolean;
}

export interface AdminAuthState {
  userId: string;
  email: string;
  adminRole: AdminRole;
  permissions: AdminPermissions;
  officialChatModeratorsEnabled?: boolean;
  needsPinSetup: boolean;
  pinLockedUntil: string | null;
  remainingAttempts: number;
  pinSessionValid: boolean;
  pinSessionExpiresAt: string | null;
  idleTimeoutSeconds: number;
}

const ADMIN_SESSION_STORAGE_KEY = 'liveconnect_admin_session_token';

export function getStoredAdminSessionToken(): string {
  if (typeof window === 'undefined') return '';
  try {
    return sessionStorage.getItem(ADMIN_SESSION_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function setStoredAdminSessionToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (token) {
      sessionStorage.setItem(ADMIN_SESSION_STORAGE_KEY, token);
    } else {
      sessionStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
    }
  } catch {
    // ignore storage failures
  }
}

export class AdminApiError extends Error {
  status: number;
  code?: string;
  data?: any;
  constructor(message: string, status: number, code?: string, data?: any) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

async function getFirebaseIdToken(forceRefresh = false): Promise<string> {
  if (!auth.currentUser) return '';
  try {
    return await auth.currentUser.getIdToken(forceRefresh);
  } catch {
    return '';
  }
}

export async function reauthenticateGoogleFresh(): Promise<string> {
  if (auth.currentUser) {
    await reauthenticateWithPopup(auth.currentUser, googleProvider);
    return await auth.currentUser.getIdToken(true);
  }
  const res = await signInWithPopup(auth, googleProvider);
  return await res.user.getIdToken(true);
}

async function adminFetch<T>(
  path: string,
  options: RequestInit & { forceRefreshToken?: boolean } = {}
): Promise<T> {
  const { forceRefreshToken, headers: customHeaders, ...rest } = options;
  const idToken = await getFirebaseIdToken(Boolean(forceRefreshToken));
  const pinSession = getStoredAdminSessionToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    ...(pinSession ? { 'x-admin-session': pinSession } : {}),
    ...((customHeaders as Record<string, string>) || {}),
  };

  const res = await fetch(`/api/admin${path}`, {
    ...rest,
    headers,
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (data?.code === 'PIN_SESSION_EXPIRED') {
      setStoredAdminSessionToken(null);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('liveconnect_admin_pin_expired'));
      }
    }
    throw new AdminApiError(
      data?.error || (res.status === 404 ? 'Not found' : 'Admin request failed'),
      res.status,
      data?.code,
      data
    );
  }

  return data as T;
}

export const adminApi = {
  getAuthState: () => adminFetch<AdminAuthState>('/auth/state'),

  setupPin: async (pin: string, confirmPin: string) => {
    const res = await adminFetch<{
      success: boolean;
      adminSessionToken: string;
      expiresAt: string;
      adminRole: AdminRole;
    }>('/auth/pin/setup', {
      method: 'POST',
      body: JSON.stringify({ pin, confirmPin }),
    });
    if (res.adminSessionToken) {
      setStoredAdminSessionToken(res.adminSessionToken);
    }
    return res;
  },

  verifyPin: async (pin: string) => {
    const res = await adminFetch<{
      success: boolean;
      adminSessionToken: string;
      expiresAt: string;
      adminRole: AdminRole;
    }>('/auth/pin/verify', {
      method: 'POST',
      body: JSON.stringify({ pin }),
    });
    if (res.adminSessionToken) {
      setStoredAdminSessionToken(res.adminSessionToken);
    }
    return res;
  },

  changePin: async (newPin: string, confirmPin: string, mode: 'change' | 'forgot') => {
    const res = await adminFetch<{
      success: boolean;
      adminSessionToken: string;
      expiresAt: string;
    }>('/auth/pin/change', {
      method: 'POST',
      forceRefreshToken: true,
      body: JSON.stringify({ newPin, confirmPin, mode }),
    });
    if (res.adminSessionToken) {
      setStoredAdminSessionToken(res.adminSessionToken);
    }
    return res;
  },

  ping: () => adminFetch<{ ok: boolean; expiresAt: string }>('/auth/ping', { method: 'POST', body: '{}' }),

  logout: async () => {
    try {
      await adminFetch<{ success: boolean }>('/auth/logout', { method: 'POST', body: '{}' });
    } catch {
      // ignore
    } finally {
      setStoredAdminSessionToken(null);
    }
  },

  getDashboard: () =>
    adminFetch<{
      totalUsers: number;
      newUsersToday: number;
      onlineNow: number;
      messagesToday: number;
      audioCallsToday: number;
      videoCallsToday: number;
      totalFamilies: number;
      pendingReportsCount: number;
      pendingAppealsCount: number;
      openTicketsCount: number;
    }>('/dashboard'),

  getAnalytics: (range: 'daily' | 'weekly' | 'monthly') =>
    adminFetch<{
      range: 'daily' | 'weekly' | 'monthly';
      userGrowth: Array<{ label: string; count: number }>;
      topActiveUsers: Array<{
        userId: string;
        displayName: string;
        username: string;
        avatarUrl?: string | null;
        messageCount: number;
        callCount: number;
        totalActivity: number;
      }>;
      topActiveFamilies: Array<{
        familyId: string;
        name: string;
        memberCount: number;
        messageCount: number;
      }>;
      peakOnlineHours: Array<{ hour: number; label: string; count: number }>;
    }>(`/analytics?range=${encodeURIComponent(range)}`),

  getUsers: (params: { q?: string; status?: string; verified?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.status) qs.set('status', params.status);
    if (params.verified) qs.set('verified', params.verified);
    return adminFetch<{ users: any[] }>(`/users?${qs.toString()}`);
  },

  getUserDetail: (userId: string) => adminFetch<any>(`/users/${encodeURIComponent(userId)}`),

  forceLogoutUser: (userId: string, reason?: string) =>
    adminFetch<{ success: boolean }>(`/users/${encodeURIComponent(userId)}/force-logout`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  toggleVerifyUser: (userId: string, verified: boolean) =>
    adminFetch<{ success: boolean; isVerified: boolean }>(`/users/${encodeURIComponent(userId)}/verify`, {
      method: 'POST',
      body: JSON.stringify({ verified }),
    }),

  deleteUser: (userId: string, reason?: string) =>
    adminFetch<{ success: boolean }>(`/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      body: JSON.stringify({ reason }),
    }),

  moderateUser: (
    userId: string,
    payload: {
      action: 'warn' | 'restrict' | 'suspend' | 'permanent_ban' | 'ban' | 'restore';
      reason: string;
      ruleBroken?: string;
      durationDays?: number;
    }
  ) =>
    adminFetch<any>(`/users/${encodeURIComponent(userId)}/moderate`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getReports: (params: { status?: string; targetType?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.targetType) qs.set('targetType', params.targetType);
    return adminFetch<{ reports: any[] }>(`/reports?${qs.toString()}`);
  },

  resolveReport: (
    reportId: string,
    payload: {
      action: 'warn_user' | 'delete_message' | 'suspend_user' | 'ban_user' | 'reject' | 'resolve';
      note?: string;
      durationDays?: number;
    }
  ) =>
    adminFetch<{ success: boolean; status: string }>(`/reports/${encodeURIComponent(reportId)}/resolve`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getFamilies: (q?: string) =>
    adminFetch<{ families: any[] }>(`/families${q ? `?q=${encodeURIComponent(q)}` : ''}`),

  getFamilyMembers: (familyId: string, q?: string) =>
    adminFetch<{ members: any[] }>(
      `/families/${encodeURIComponent(familyId)}/members${q ? `?q=${encodeURIComponent(q)}` : ''}`
    ),

  suspendFamily: (familyId: string, suspend: boolean, reason?: string) =>
    adminFetch<{ success: boolean; isSuspended: boolean }>(
      `/families/${encodeURIComponent(familyId)}/suspend`,
      { method: 'POST', body: JSON.stringify({ suspend, reason }) }
    ),

  deleteFamily: (familyId: string, reason?: string) =>
    adminFetch<{ success: boolean }>(`/families/${encodeURIComponent(familyId)}`, {
      method: 'DELETE',
      body: JSON.stringify({ reason }),
    }),

  removeFamilyMember: (familyId: string, userId: string) =>
    adminFetch<{ success: boolean }>(
      `/families/${encodeURIComponent(familyId)}/members/${encodeURIComponent(userId)}`,
      { method: 'DELETE', body: '{}' }
    ),

  transferFamilyOwner: (familyId: string, newOwnerId: string) =>
    adminFetch<{ success: boolean }>(`/families/${encodeURIComponent(familyId)}/transfer-owner`, {
      method: 'POST',
      body: JSON.stringify({ newOwnerId }),
    }),

  getLogs: (params: { q?: string; action?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.action) qs.set('action', params.action);
    return adminFetch<{ logs: any[] }>(`/logs?${qs.toString()}`);
  },

  getSettings: () =>
    adminFetch<{
      maintenanceMode: boolean;
      maintenanceMessage: string;
      warningThreshold: number;
      warningAutoAction: 'suspend' | 'ban';
      warningSuspendDays: number;
      officialChatModeratorsEnabled?: boolean;
    }>('/settings'),

  updateMaintenance: (enabled: boolean, message: string) =>
    adminFetch<{ success: boolean; maintenanceMode: boolean; maintenanceMessage: string }>(
      '/settings/maintenance',
      { method: 'POST', body: JSON.stringify({ enabled, message }) }
    ),

  updateOfficialChatModerators: (enabled: boolean) =>
    adminFetch<{ success: boolean; officialChatModeratorsEnabled: boolean }>(
      '/settings/official-chat-moderators',
      { method: 'POST', body: JSON.stringify({ enabled }) }
    ),

  updateWarningSettings: (payload: {
    warningThreshold: number;
    warningAutoAction: 'suspend' | 'ban';
    warningSuspendDays: number;
  }) =>
    adminFetch<{ success: boolean }>('/settings/warnings', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getAppeals: (status?: string) =>
    adminFetch<{ appeals: any[] }>(`/appeals${status ? `?status=${encodeURIComponent(status)}` : ''}`),

  reviewAppeal: (appealId: string, decision: 'approved' | 'rejected', note?: string) =>
    adminFetch<{ success: boolean; status: string }>(`/appeals/${encodeURIComponent(appealId)}/review`, {
      method: 'POST',
      body: JSON.stringify({ decision, note }),
    }),

  getOfficialMessages: () =>
    adminFetch<{ messages: OfficialMessage[]; moderatorsEnabled: boolean }>('/official-chat'),

  sendOfficialMessage: (payload: { text: string; imageUrl?: string | null }) =>
    adminFetch<{ success: boolean; message: OfficialMessage; estimatedRecipients: number }>(
      '/official-chat',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  deleteOfficialMessage: (messageId: string) =>
    adminFetch<{ success: boolean; messageId: string }>(
      `/official-chat/${encodeURIComponent(messageId)}`,
      {
        method: 'DELETE',
        body: '{}',
      }
    ),

  uploadOfficialImage: async (file: File): Promise<{ url: string }> => {
    const idToken = await getFirebaseIdToken(false);
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Failed to read image file'));
      reader.readAsDataURL(file);
    });
    const commaIdx = dataUrl.indexOf(',');
    const base64Data = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
    const res = await fetch('/api/media/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify({
        base64Data,
        mimeType: file.type || 'image/jpeg',
        fileName: file.name || `official_${Date.now()}.jpg`,
        mediaType: 'image',
      }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.url) {
      throw new AdminApiError(json?.error || 'Failed to upload image', res.status);
    }
    return { url: json.url as string };
  },

  getBannedWords: () => adminFetch<{ words: any[] }>('/banned-words'),

  createBannedWord: (word: string, matchMode: 'substring' | 'exact', action: 'block' | 'flag') =>
    adminFetch<{ word: any }>('/banned-words', {
      method: 'POST',
      body: JSON.stringify({ word, matchMode, action }),
    }),

  updateBannedWord: (
    wordId: string,
    payload: { word?: string; matchMode?: 'substring' | 'exact'; action?: 'block' | 'flag' }
  ) =>
    adminFetch<{ word: any }>(`/banned-words/${encodeURIComponent(wordId)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  deleteBannedWord: (wordId: string) =>
    adminFetch<{ success: boolean }>(`/banned-words/${encodeURIComponent(wordId)}`, {
      method: 'DELETE',
      body: '{}',
    }),

  getRoles: () => adminFetch<{ admins: any[]; superAdminEmail: string }>('/roles'),

  assignRole: (payload: { userId?: string; identifier?: string; role: 'moderator' | 'support' | 'none' }) =>
    adminFetch<{ success: boolean; targetUser: any }>('/roles', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getTickets: (status?: string) =>
    adminFetch<{ tickets: any[] }>(`/tickets${status ? `?status=${encodeURIComponent(status)}` : ''}`),

  replyTicket: (ticketId: string, message: string, closeTicket?: boolean) =>
    adminFetch<{ ticket: any }>(`/tickets/${encodeURIComponent(ticketId)}/reply`, {
      method: 'POST',
      body: JSON.stringify({ message, closeTicket }),
    }),

  updateTicketStatus: (ticketId: string, status: 'open' | 'closed') =>
    adminFetch<{ ticket: any }>(`/tickets/${encodeURIComponent(ticketId)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
};
