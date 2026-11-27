import { FamilyMuteDuration, UserReportCategory } from '@/src/types';

export const FAMILY_MAX_MEMBERS = 5000;
export const FAMILY_LARGE_THRESHOLD = 50;
export const FAMILY_MAX_INVITE_BATCH = 10;
export const FAMILY_MAX_DAILY_INVITES = 50;
export const FAMILY_MAX_PINNED_MESSAGES = 3;
export const FAMILY_MEMBERS_PAGE_SIZE = 30;
export const FAMILY_MESSAGES_PAGE_SIZE = 50;

export const FAMILY_RELATION_PRESETS = [
  'Papa',
  'Maa',
  'Bhai',
  'Behen',
  'Dada',
  'Dadi',
  'Nana',
  'Nani',
  'Chacha',
  'Chachi',
  'Mama',
  'Mami',
  'Beta',
  'Beti',
  'Pati',
  'Patni',
] as const;

export const FAMILY_QUICK_REACTIONS = ['❤️', '👍', '😂', '🙏', '🔥', '🎉', '😮', '😢'];

export const FAMILY_MUTE_OPTIONS: Array<{
  id: FamilyMuteDuration;
  label: string;
  durationMs: number | null;
}> = [
  { id: '1h', label: '1 hour', durationMs: 60 * 60 * 1000 },
  { id: '8h', label: '8 hours', durationMs: 8 * 60 * 60 * 1000 },
  { id: '1w', label: '1 week', durationMs: 7 * 24 * 60 * 60 * 1000 },
  { id: 'always', label: 'Always', durationMs: null },
];

export const FAMILY_REPORT_OPTIONS: Array<{
  id: UserReportCategory;
  label: string;
  description: string;
}> = [
  {
    id: 'spam',
    label: 'Spam',
    description: 'Unsolicited links, promotions, or repetitive junk messages',
  },
  {
    id: 'harassment',
    label: 'Abuse / Harassment',
    description: 'Insults, bullying, threats, or targeted harassment',
  },
  {
    id: 'nudity_sexual',
    label: 'Inappropriate Photo',
    description: 'Explicit, graphic, or inappropriate media content',
  },
  {
    id: 'scam_fraud',
    label: 'Scam',
    description: 'Phishing, fake money requests, or fraudulent activity',
  },
  {
    id: 'other',
    label: 'Other',
    description: 'Another violation of LiveConnect Community Guidelines',
  },
];

export function computeMutedUntilIso(duration: FamilyMuteDuration): {
  isMutedAlways: boolean;
  mutedUntil: string | null;
} {
  if (duration === 'off') {
    return { isMutedAlways: false, mutedUntil: null };
  }
  if (duration === 'always') {
    return { isMutedAlways: true, mutedUntil: null };
  }
  const opt = FAMILY_MUTE_OPTIONS.find((o) => o.id === duration);
  if (!opt || !opt.durationMs) {
    return { isMutedAlways: false, mutedUntil: null };
  }
  return {
    isMutedAlways: false,
    mutedUntil: new Date(Date.now() + opt.durationMs).toISOString(),
  };
}

export function isFamilyMembershipMuted(params: {
  isMutedAlways?: boolean;
  mutedUntil?: string | null;
}): boolean {
  if (params.isMutedAlways) return true;
  if (!params.mutedUntil) return false;
  const ts = new Date(params.mutedUntil).getTime();
  return Number.isFinite(ts) && ts > Date.now();
}

export function getInviteUrlForCode(inviteCode: string): string {
  if (typeof window === 'undefined') {
    return `?joinFamily=${encodeURIComponent(inviteCode)}`;
  }
  const url = new URL(window.location.origin);
  url.searchParams.set('joinFamily', inviteCode);
  return url.toString();
}

export function extractFamilyInviteCode(rawInput: string): string {
  const trimmed = rawInput.trim();
  if (!trimmed) return '';
  try {
    if (trimmed.includes('://') || trimmed.includes('joinFamily=')) {
      const parsed = trimmed.startsWith('http')
        ? new URL(trimmed)
        : new URL(trimmed.startsWith('?') ? `https://liveconnect.local/${trimmed}` : `https://liveconnect.local/?${trimmed}`);
      const code = parsed.searchParams.get('joinFamily');
      if (code) return code.trim();
    }
  } catch {
    // Fallback to string extraction
  }
  const match = trimmed.match(/joinFamily=([A-Za-z0-9_-]+)/);
  if (match && match[1]) return match[1];
  return trimmed.replace(/[^A-Za-z0-9_-]/g, '');
}
