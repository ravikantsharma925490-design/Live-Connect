import { Profile, CallType, CallStatus } from '@/src/types';
import { getDeterministicDirectConvId } from '@/src/hooks/useConversations';
import { generateUUID } from '@/src/lib/utils';
import { doc, getDoc } from 'firebase/firestore';
import { db, auth, isFirebaseSessionActive } from '@/src/lib/firebase/client';
import { sendMessageToFirestoreFs } from '@/src/lib/firebase/services';

export interface CallLogMessageMeta {
  callId?: string;
  caller: Profile;
  callee: Profile;
  callType: CallType;
  status: CallStatus;
  isMissed: boolean;
  durationFormatted?: string;
}

// Track call log contents to avoid duplicate identical inserts
const loggedCallStatus = new Map<string, string>();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const callLogMsgIdMap = new Map<string, string>();

function getOrCreateValidMsgUuid(callId?: string): string {
  if (!callId) return generateUUID();
  if (UUID_REGEX.test(callId)) return callId;
  const existing = callLogMsgIdMap.get(callId);
  if (existing) return existing;
  const newUuid = generateUUID();
  callLogMsgIdMap.set(callId, newUuid);
  return newUuid;
}

export function formatCallDurationText(seconds?: number): string {
  if (!seconds || seconds <= 0) return '';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins > 0 && secs > 0) {
    return `${mins} min ${secs} sec`;
  }
  if (mins > 0) {
    return `${mins} min`;
  }
  return `${secs} seconds`;
}

/**
 * Creates a system call log message inside the direct conversation
 * between caller and callee so it appears directly in both users' chat feed.
 */
export async function insertCallLogIntoChat({
  callId,
  caller,
  callee,
  callType,
  status,
  isMissed,
  durationFormatted,
}: CallLogMessageMeta) {
  if (!caller?.id || !callee?.id) return;

  const conversationId = getDeterministicDirectConvId(caller.id, callee.id);
  const nowIso = new Date().toISOString();
  const msgId = getOrCreateValidMsgUuid(callId);

  let displayStatus = 'No answer';
  const effectiveMissed = isMissed || status === 'missed' || status === 'rejected' || status === 'cancelled';
  const normalizedStatus = effectiveMissed ? 'missed' : 'ended';

  if (effectiveMissed) {
    displayStatus = 'No answer';
  } else if (durationFormatted && durationFormatted !== 'Connected' && durationFormatted !== 'Ended') {
    displayStatus = durationFormatted;
  } else {
    displayStatus = 'Ended';
  }

  const content = `[CALL_LOG:${callType}:${normalizedStatus}:${effectiveMissed ? 'missed' : 'answered'}:${displayStatus}]`;

  if (callId) {
    const prevLogged = loggedCallStatus.get(callId);
    if (prevLogged === content) {
      return;
    }
    loggedCallStatus.set(callId, content);
    setTimeout(() => loggedCallStatus.delete(callId), 10 * 60 * 1000);
  }

  const messageObj = {
    id: msgId,
    conversation_id: conversationId,
    sender_id: caller.id,
    content,
    created_at: nowIso,
    updated_at: nowIso,
    sender: caller,
    is_read: false,
  };

  if (auth.currentUser && isFirebaseSessionActive(auth.currentUser.uid)) {
    const activeUid = auth.currentUser.uid;
    if (activeUid === caller.id) {
      sendMessageToFirestoreFs({
        messageId: msgId,
        conversationId,
        content,
        senderProfile: caller,
        isGroup: false,
        receiverId: callee.id,
        receiverProfile: callee,
      }).catch(() => {});
    } else if (activeUid === callee.id) {
      // Give caller a moment to insert the canonical log, then write if missing
      setTimeout(async () => {
        try {
          const existing = await getDoc(
            doc(db, 'users', callee.id, 'inbox', conversationId, 'messages', msgId)
          ).catch(() => null);
          if (!existing || !existing.exists()) {
            await sendMessageToFirestoreFs({
              messageId: msgId,
              conversationId,
              content,
              senderProfile: callee,
              isGroup: false,
              receiverId: caller.id,
              receiverProfile: caller,
            }).catch(() => {});
          }
        } catch {}
      }, 700);
    }
  } else {
    // Legacy SQLite Server Message Relay
    fetch('/api/messages/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: messageObj,
        recipientId: callee.id,
        senderProfile: caller,
        recipientProfile: callee,
      }),
    }).catch(() => {});
  }

  // Cache in local storage for instant reactivity
  try {
    const localCacheKey = `liveconnect_msgs_${conversationId}`;
    const raw = localStorage.getItem(localCacheKey);
    const existing = raw ? JSON.parse(raw) : [];
    if (Array.isArray(existing)) {
      const idx = existing.findIndex((m) => m.id === msgId);
      if (idx >= 0) {
        existing[idx] = messageObj;
      } else {
        existing.push(messageObj);
      }
      localStorage.setItem(localCacheKey, JSON.stringify(existing));
    }
  } catch {}

  [caller.id, callee.id].forEach((uid) => {
    try {
      const convCacheKey = `liveconnect_convs_${uid}`;
      const raw = localStorage.getItem(convCacheKey);
      if (raw) {
        const convs = JSON.parse(raw);
        if (Array.isArray(convs)) {
          const updated = convs.map((c: any) => {
            if (c.id === conversationId) {
              return {
                ...c,
                updated_at: nowIso,
                last_message: messageObj,
              };
            }
            return c;
          });
          localStorage.setItem(convCacheKey, JSON.stringify(updated));
        }
      }
    } catch {}
  });

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('liveconnect_conversation_message', {
        detail: { conversationId, message: messageObj },
      })
    );
  }
}
