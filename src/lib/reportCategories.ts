import { getAuthHeaders } from '@/src/lib/authHeader';
import { isFirebaseSessionActive } from '@/src/lib/firebase/client';
import { submitUserReportFs } from '@/src/lib/firebase/services';
import { formatMessagePreview, generateUUID } from '@/src/lib/utils';
import {
  Profile,
  ReportedMessageContext,
  UserReportCategory,
  UserReportSource,
} from '@/src/types';

export interface UserReportCategoryOption {
  id: UserReportCategory;
  label: string;
  description: string;
  severity: 'standard' | 'high' | 'critical';
  suggestedRule: string;
}

export const USER_REPORT_CATEGORIES: UserReportCategoryOption[] = [
  {
    id: 'spam',
    label: 'Spam or Unwanted Messages',
    description: 'Unsolicited promotions, repetitive links, or bot-like behavior',
    severity: 'standard',
    suggestedRule: 'spam',
  },
  {
    id: 'harassment',
    label: 'Harassment or Bullying',
    description: 'Targeted abuse, insults, stalking, or intimidation',
    severity: 'high',
    suggestedRule: 'harassment',
  },
  {
    id: 'hate_speech',
    label: 'Hate Speech or Discrimination',
    description: 'Slurs, dehumanizing language, or attacks based on identity',
    severity: 'high',
    suggestedRule: 'hate_speech',
  },
  {
    id: 'nudity_sexual',
    label: 'Nudity or Sexual Content',
    description: 'Explicit media, sexual solicitation, or unwanted advances',
    severity: 'high',
    suggestedRule: 'community_guidelines',
  },
  {
    id: 'impersonation',
    label: 'Fake Account or Impersonation',
    description: 'Pretending to be you, someone else, or a verified brand',
    severity: 'high',
    suggestedRule: 'impersonation',
  },
  {
    id: 'scam_fraud',
    label: 'Scam, Phishing, or Fraud',
    description: 'Money requests, fake giveaways, or malicious links',
    severity: 'critical',
    suggestedRule: 'scam',
  },
  {
    id: 'violence_threats',
    label: 'Violence or Physical Threats',
    description: 'Threats of physical harm, self-harm encouragement, or extremism',
    severity: 'critical',
    suggestedRule: 'threats',
  },
  {
    id: 'child_safety',
    label: 'Child Safety Concern',
    description: 'Any exploitation, grooming, or endangerment involving minors',
    severity: 'critical',
    suggestedRule: 'child_abuse',
  },
  {
    id: 'underage',
    label: 'Underage User',
    description: 'Account appears to belong to someone below minimum age',
    severity: 'high',
    suggestedRule: 'community_guidelines',
  },
  {
    id: 'privacy_violation',
    label: 'Privacy Violation / Doxxing',
    description: 'Sharing private phone numbers, photos, or personal info without consent',
    severity: 'high',
    suggestedRule: 'harassment',
  },
  {
    id: 'abusive_calls',
    label: 'Abusive Audio or Video Calls',
    description: 'Inappropriate behavior, flashing, or repeated unwanted calling',
    severity: 'high',
    suggestedRule: 'harassment',
  },
  {
    id: 'other',
    label: 'Other Policy Violation',
    description: 'Something else that violates LiveConnect Community Guidelines',
    severity: 'standard',
    suggestedRule: 'community_guidelines',
  },
];

export function getReportCategoryMeta(category: string): UserReportCategoryOption {
  return (
    USER_REPORT_CATEGORIES.find((c) => c.id === category) ||
    USER_REPORT_CATEGORIES[USER_REPORT_CATEGORIES.length - 1]
  );
}

export async function submitUserReport(params: {
  reporterId: string;
  targetUser: Profile;
  category: UserReportCategory;
  details?: string;
  source: UserReportSource;
  conversationId?: string | null;
  familyId?: string | null;
  familyName?: string | null;
  reportedMessage?: ReportedMessageContext | null;
  alsoBlocked?: boolean;
}): Promise<{ reportId: string; duplicate?: boolean }> {
  const reportId = `urep_${generateUUID().replace(/-/g, '').slice(0, 20)}`;
  const rawUserDetails = params.details?.trim() || '';

  let combinedDetails = rawUserDetails;
  let reportedMessagePreview: string | undefined;
  if (params.reportedMessage) {
    reportedMessagePreview = formatMessagePreview(params.reportedMessage.content).slice(0, 320);
    const msgHeader = `[Reported Message ID: ${params.reportedMessage.id}] "${reportedMessagePreview}"`;
    combinedDetails = rawUserDetails ? `${msgHeader}\n\n${rawUserDetails}` : msgHeader;
  }
  const cleanDetails = combinedDetails.trim().slice(0, 1000) || undefined;

  const headers = await getAuthHeaders();
  const res = await fetch('/api/reports/user', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({
      reportId,
      reportedUserId: params.targetUser.id,
      reportedUsername: params.targetUser.username,
      reportedDisplayName: params.targetUser.display_name,
      category: params.category,
      details: cleanDetails,
      source: params.source,
      conversationId: params.conversationId || null,
      familyId: params.familyId || null,
      familyName: params.familyName || null,
      reportedMessageId: params.reportedMessage?.id || null,
      reportedMessagePreview: reportedMessagePreview || null,
      reportedMessageContent: params.reportedMessage?.content?.slice(0, 1500) || null,
      reportedMessageMediaUrl: params.reportedMessage?.mediaUrl || null,
      alsoBlocked: Boolean(params.alsoBlocked),
    }),
  });

  const data = await res.json().catch(() => null);

  if (res.status === 409 && data?.duplicate) {
    return {
      reportId: data.reportId || reportId,
      duplicate: true,
    };
  }

  if (!res.ok) {
    throw new Error(data?.error || 'Failed to submit report. Please try again.');
  }

  const finalReportId = data?.reportId || reportId;

  // Sync to Firestore if Firebase session is active
  if (isFirebaseSessionActive(params.reporterId)) {
    try {
      await submitUserReportFs({
        reportId: finalReportId,
        reporterId: params.reporterId,
        reportedUserId: params.targetUser.id,
        reportedUsername: params.targetUser.username,
        reportedDisplayName: params.targetUser.display_name,
        category: params.category,
        details: cleanDetails || null,
        source: params.source,
        conversationId: params.conversationId || null,
        familyId: params.familyId || null,
        familyName: params.familyName || null,
        reportedMessageId: params.reportedMessage?.id || null,
        reportedMessageContent: params.reportedMessage?.content?.slice(0, 1500) || null,
        reportedMessageMediaUrl: params.reportedMessage?.mediaUrl || null,
        alsoBlocked: Boolean(params.alsoBlocked),
      });
    } catch (fsErr) {
      // Do not fail report submission if SQLite persistence already succeeded
      console.warn('Firestore user_report sync notice:', fsErr);
    }
  }

  return { reportId: finalReportId };
}
