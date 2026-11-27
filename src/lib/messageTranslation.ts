import { WORLD_LANGUAGES, WorldLanguage } from './worldData';
import { getAuthHeaders } from './authHeader';

const TRANSLATION_CACHE_KEY = 'liveconnect_msg_translations_v1';
const CHAT_TRANSLATION_PREFS_KEY = 'liveconnect_chat_translate_prefs_v1';
const MAX_CACHED_TRANSLATIONS = 300;

export interface MessageTranslationResult {
  translatedText: string;
  detectedLanguage: string;
  targetLangCode: string;
}

export interface ChatTranslationSettings {
  autoTranslate: boolean;
  customLangCode: string | null;
}

const memoryTranslationCache = new Map<string, MessageTranslationResult>();
const inFlightTranslations = new Map<string, Promise<MessageTranslationResult>>();
let cacheLoadedFromStorage = false;

function buildCacheKey(text: string, targetLangCode: string): string {
  return `${targetLangCode.trim().toLowerCase()}::${text.trim()}`;
}

function loadCacheFromStorage() {
  if (cacheLoadedFromStorage) return;
  cacheLoadedFromStorage = true;
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(TRANSLATION_CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, MessageTranslationResult>;
    if (parsed && typeof parsed === 'object') {
      Object.entries(parsed).forEach(([k, v]) => {
        if (v && typeof v.translatedText === 'string') {
          memoryTranslationCache.set(k, v);
        }
      });
    }
  } catch {
    // ignore corrupted cache
  }
}

function persistCacheToStorage() {
  if (typeof window === 'undefined') return;
  try {
    while (memoryTranslationCache.size > MAX_CACHED_TRANSLATIONS) {
      const oldestKey = memoryTranslationCache.keys().next().value;
      if (oldestKey === undefined) break;
      memoryTranslationCache.delete(oldestKey);
    }
    const obj: Record<string, MessageTranslationResult> = {};
    memoryTranslationCache.forEach((v, k) => {
      obj[k] = v;
    });
    window.localStorage.setItem(TRANSLATION_CACHE_KEY, JSON.stringify(obj));
  } catch {
    // ignore storage quota errors
  }
}

export function resolveWorldLanguage(code?: string | null): WorldLanguage {
  const normalized = (code || '').trim().toLowerCase();
  if (!normalized) return WORLD_LANGUAGES[0];

  const exact = WORLD_LANGUAGES.find((l) => l.code.toLowerCase() === normalized);
  if (exact) return exact;

  const base = normalized.split('-')[0];
  const baseMatch = WORLD_LANGUAGES.find((l) => l.code.toLowerCase() === base);
  return baseMatch || WORLD_LANGUAGES[0];
}

export function getCachedTranslation(
  text: string,
  targetLangCode: string
): MessageTranslationResult | null {
  const cleanText = text.trim();
  const cleanCode = targetLangCode.trim();
  if (!cleanText || !cleanCode) return null;

  loadCacheFromStorage();
  const key = buildCacheKey(cleanText, cleanCode);
  return memoryTranslationCache.get(key) || null;
}

export async function translateChatText({
  text,
  targetLang,
}: {
  text: string;
  targetLang: WorldLanguage;
}): Promise<MessageTranslationResult> {
  const cleanText = text.trim();
  if (!cleanText) {
    throw new Error('Nothing to translate.');
  }

  const cached = getCachedTranslation(cleanText, targetLang.code);
  if (cached) {
    return cached;
  }

  const key = buildCacheKey(cleanText, targetLang.code);
  const existingFlight = inFlightTranslations.get(key);
  if (existingFlight) {
    return existingFlight;
  }

  const requestPromise = (async (): Promise<MessageTranslationResult> => {
    const payload = JSON.stringify({
      text: cleanText,
      targetLangCode: targetLang.code,
      targetLangName: targetLang.name,
      targetNativeName: targetLang.nativeName,
    });

    let authHeaders = await getAuthHeaders();
    let res = await fetch('/api/messages/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body: payload,
    });

    if (res.status === 401) {
      authHeaders = await getAuthHeaders(true);
      res = await fetch('/api/messages/translate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: payload,
      });
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || 'Failed to translate message.');
    }

    const result: MessageTranslationResult = {
      translatedText:
        typeof data?.translatedText === 'string' && data.translatedText.trim()
          ? data.translatedText.trim()
          : cleanText,
      detectedLanguage:
        typeof data?.detectedLanguage === 'string' && data.detectedLanguage.trim()
          ? data.detectedLanguage.trim()
          : 'Detected',
      targetLangCode: targetLang.code,
    };

    loadCacheFromStorage();
    memoryTranslationCache.set(key, result);
    persistCacheToStorage();

    return result;
  })();

  inFlightTranslations.set(key, requestPromise);
  try {
    return await requestPromise;
  } finally {
    inFlightTranslations.delete(key);
  }
}

export function getChatTranslationSettings(
  conversationId?: string | null
): ChatTranslationSettings {
  const defaults: ChatTranslationSettings = {
    autoTranslate: false,
    customLangCode: null,
  };
  if (!conversationId || typeof window === 'undefined') return defaults;

  try {
    const raw = window.localStorage.getItem(CHAT_TRANSLATION_PREFS_KEY);
    if (!raw) return defaults;
    const allPrefs = JSON.parse(raw) as Record<string, Partial<ChatTranslationSettings>>;
    const entry = allPrefs?.[conversationId];
    if (!entry) return defaults;
    return {
      autoTranslate: Boolean(entry.autoTranslate),
      customLangCode:
        typeof entry.customLangCode === 'string' && entry.customLangCode.trim()
          ? entry.customLangCode.trim()
          : null,
    };
  } catch {
    return defaults;
  }
}

export function saveChatTranslationSettings(
  conversationId: string,
  patch: Partial<ChatTranslationSettings>
): ChatTranslationSettings {
  const current = getChatTranslationSettings(conversationId);
  const next: ChatTranslationSettings = {
    autoTranslate:
      patch.autoTranslate !== undefined ? Boolean(patch.autoTranslate) : current.autoTranslate,
    customLangCode:
      patch.customLangCode !== undefined ? patch.customLangCode : current.customLangCode,
  };

  if (typeof window !== 'undefined' && conversationId) {
    try {
      const raw = window.localStorage.getItem(CHAT_TRANSLATION_PREFS_KEY);
      const allPrefs = (raw ? JSON.parse(raw) : {}) as Record<string, ChatTranslationSettings>;
      allPrefs[conversationId] = next;
      window.localStorage.setItem(CHAT_TRANSLATION_PREFS_KEY, JSON.stringify(allPrefs));
    } catch {
      // ignore storage errors
    }
  }

  return next;
}
