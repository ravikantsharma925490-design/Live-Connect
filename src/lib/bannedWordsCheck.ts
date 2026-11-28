import { getAuthHeaders } from '@/src/lib/authHeader';

export interface BannedWordRule {
  id: string;
  word: string;
  matchMode: 'substring' | 'exact';
  action: 'block' | 'flag';
}

export interface UnreadWarningItem {
  id: string;
  reason: string;
  ruleBroken: string;
  strikeNumber: number;
  createdAt: string;
}

export interface AppConfigSnapshot {
  maintenanceMode: boolean;
  maintenanceMessage: string;
  bannedWords: BannedWordRule[];
  adminRole: 'none' | 'super_admin' | 'moderator' | 'support';
  unreadWarnings: UnreadWarningItem[];
  unreadAnnouncements: Array<{
    id: string;
    title: string;
    message: string;
    createdAt: string;
  }>;
  forceLogout?: boolean;
}

let cachedWords: BannedWordRule[] = [];
let lastFetchedAt = 0;

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function matchBannedWordsLocally(
  text: string,
  words: BannedWordRule[]
): {
  blocked: boolean;
  flagged: boolean;
  matchedWords: Array<{ word: string; action: 'block' | 'flag' }>;
} {
  const input = String(text || '');
  if (!input.trim() || !Array.isArray(words) || words.length === 0) {
    return { blocked: false, flagged: false, matchedWords: [] };
  }
  const lower = input.toLowerCase();
  const matched: Array<{ word: string; action: 'block' | 'flag' }> = [];

  for (const rule of words) {
    const w = String(rule.word || '').trim().toLowerCase();
    if (!w) continue;
    let isMatch = false;
    if (rule.matchMode === 'exact') {
      const rx = new RegExp(`(^|[^a-z0-9_])${escapeRegExp(w)}([^a-z0-9_]|$)`, 'i');
      isMatch = rx.test(lower);
    } else {
      isMatch = lower.includes(w);
    }
    if (isMatch) {
      matched.push({ word: rule.word, action: rule.action === 'flag' ? 'flag' : 'block' });
    }
  }

  return {
    blocked: matched.some((m) => m.action === 'block'),
    flagged: matched.some((m) => m.action === 'flag'),
    matchedWords: matched,
  };
}

export async function fetchAppConfigSnapshot(includeAuth = true): Promise<AppConfigSnapshot | null> {
  try {
    const headers = includeAuth ? await getAuthHeaders().catch(() => ({})) : {};
    const res = await fetch('/api/app/config', {
      headers: { ...headers },
    });
    const data = await res.json().catch(() => null);
    if (res.status === 401 && data?.code === 'FORCE_LOGOUT') {
      return {
        maintenanceMode: false,
        maintenanceMessage: '',
        bannedWords: cachedWords,
        adminRole: 'none',
        unreadWarnings: [],
        unreadAnnouncements: [],
        forceLogout: true,
      };
    }
    if (!res.ok || !data) return null;
    if (Array.isArray(data.bannedWords)) {
      cachedWords = data.bannedWords;
      lastFetchedAt = Date.now();
    }
    return {
      maintenanceMode: Boolean(data.maintenanceMode),
      maintenanceMessage: String(data.maintenanceMessage || ''),
      bannedWords: Array.isArray(data.bannedWords) ? data.bannedWords : [],
      adminRole: data.adminRole || (data.isAdminStaff ? 'moderator' : 'none'),
      unreadWarnings: Array.isArray(data.unreadWarnings) ? data.unreadWarnings : [],
      unreadAnnouncements: Array.isArray(data.unreadAnnouncements)
        ? data.unreadAnnouncements
        : Array.isArray(data.recentAnnouncements)
          ? data.recentAnnouncements
          : [],
      forceLogout: Boolean(data.forceLogout || data.forceLoggedOut),
    };
  } catch {
    return null;
  }
}

export async function validateTextAgainstBannedWords(text: string): Promise<{
  blocked: boolean;
  flagged: boolean;
  matchedWords: Array<{ word: string; action: 'block' | 'flag' }>;
  errorMessage?: string;
}> {
  const input = String(text || '').trim();
  if (!input) {
    return { blocked: false, flagged: false, matchedWords: [] };
  }

  // Skip media payload markers when validating text
  if (
    input.startsWith('[IMAGE:') ||
    input.startsWith('[VOICE:') ||
    input.startsWith('[STICKER:') ||
    input.startsWith('[CALL_LOG:')
  ) {
    return { blocked: false, flagged: false, matchedWords: [] };
  }

  if (Date.now() - lastFetchedAt > 45_000) {
    await fetchAppConfigSnapshot(false).catch(() => null);
  }

  if (cachedWords.length > 0) {
    const localResult = matchBannedWordsLocally(input, cachedWords);
    if (localResult.blocked) {
      return {
        ...localResult,
        errorMessage: 'This text contains a restricted word and cannot be used.',
      };
    }
    if (localResult.flagged) {
      return localResult;
    }
  }

  try {
    const headers = await getAuthHeaders().catch(() => ({}));
    const res = await fetch('/api/moderation/check-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ text: input }),
    });
    if (res.ok) {
      const data = await res.json();
      const blocked = Boolean(data?.blocked);
      return {
        blocked,
        flagged: Boolean(data?.flagged),
        matchedWords: Array.isArray(data?.matchedWords) ? data.matchedWords : [],
        errorMessage: blocked ? 'This text contains a restricted word and cannot be used.' : undefined,
      };
    }
  } catch {
    // Fallback gracefully
  }

  return { blocked: false, flagged: false, matchedWords: [] };
}

export async function reportTelemetry(
  eventType: 'dm_sent' | 'family_msg_sent' | 'call_created',
  refId?: string
): Promise<void> {
  try {
    const headers = await getAuthHeaders().catch(() => ({}));
    await fetch('/api/app/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ eventType, refId }),
    });
  } catch {
    // Silent non-blocking telemetry
  }
}
