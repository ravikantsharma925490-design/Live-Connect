import { useState, useEffect, useCallback, useRef } from 'react';
import {
  collection,
  doc,
  query,
  orderBy,
  onSnapshot,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { Message, Profile, Conversation } from '@/src/types';
import { generateUUID } from '@/src/lib/utils';
import { uploadMediaToServer } from '@/src/lib/mediaUpload';
import { deleteB2Object } from '@/src/lib/b2Client';
import { deleteCloudinaryAsset } from '@/src/lib/cloudinaryClient';
import { getDeterministicDirectConvId } from './useConversations';
import {
  db,
  auth,
  isFirebaseSessionActive,
  OperationType,
  handleFirestoreError,
} from '@/src/lib/firebase/client';
import {
  inboxMessageDocToMessage,
  sendMessageToFirestoreFs,
  deleteMessageForAllFs,
  clearUserInboxMessagesFs,
  markMessagesAsReadFs,
} from '@/src/lib/firebase/services';
import { getAuthHeaders } from '@/src/lib/authHeader';
import { validateTextAgainstBannedWords, reportTelemetry } from '@/src/lib/bannedWordsCheck';

export type ClientMessage = Message & {
  client_id?: string;
  is_pending?: boolean;
  should_animate?: boolean;
};

function getLocalMsgCacheKey(convId: string) {
  return `liveconnect_msgs_${convId}`;
}

function getDeletedMsgIdsKey(convId: string) {
  return `liveconnect_deleted_ids_${convId}`;
}

function loadDeletedMsgIds(convId: string | null): Set<string> {
  if (typeof window === 'undefined' || !convId) return new Set();
  try {
    const raw = localStorage.getItem(getDeletedMsgIdsKey(convId));
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return new Set(arr);
    }
  } catch {
    // ignore
  }
  return new Set();
}

function recordDeletedMsgId(convId: string | null, msgId: string) {
  if (typeof window === 'undefined' || !convId || !msgId) return;
  try {
    const existing = loadDeletedMsgIds(convId);
    existing.add(msgId);
    localStorage.setItem(getDeletedMsgIdsKey(convId), JSON.stringify(Array.from(existing)));
  } catch {
    // ignore
  }
}

function recordMultipleDeletedMsgIds(convId: string | null, msgIds: string[]) {
  if (typeof window === 'undefined' || !convId || !msgIds.length) return;
  try {
    const existing = loadDeletedMsgIds(convId);
    msgIds.forEach((id) => existing.add(id));
    localStorage.setItem(getDeletedMsgIdsKey(convId), JSON.stringify(Array.from(existing)));
  } catch {
    // ignore
  }
}

function isMessagePending(msg: ClientMessage): boolean {
  return Boolean(
    msg.is_pending ||
      msg.id.startsWith('temp_') ||
      msg.id.startsWith('local_')
  );
}

function cleanAndDeduplicateMessages(msgs: ClientMessage[], convId: string | null): ClientMessage[] {
  if (!Array.isArray(msgs) || msgs.length === 0) return [];
  const deleted = loadDeletedMsgIds(convId);
  const seenIds = new Set<string>();
  const deduplicated: ClientMessage[] = [];

  const sorted = [...msgs].sort(
    (a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
  );

  for (const m of sorted) {
    if (!m || !m.id || deleted.has(m.id)) continue;

    let existingIdx = deduplicated.findIndex((prev) => prev.id === m.id);

    if (existingIdx === -1 && m.client_id) {
      existingIdx = deduplicated.findIndex((prev) => prev.client_id === m.client_id);
    }

    if (existingIdx === -1 && m.sender_id && m.content) {
      const mPending = isMessagePending(m);
      existingIdx = deduplicated.findIndex((prev) => {
        if (prev.sender_id !== m.sender_id || prev.content !== m.content) return false;
        const prevPending = isMessagePending(prev);
        if (prevPending === mPending) return false;
        const timeDiff = Math.abs(
          new Date(prev.created_at || 0).getTime() - new Date(m.created_at || 0).getTime()
        );
        return timeDiff < 45000;
      });
    }

    if (existingIdx >= 0) {
      const prev = deduplicated[existingIdx];
      const isNewAnswered = m.content?.includes(':answered:') && !prev.content?.includes(':answered:');
      const isNewEnded = m.content?.includes(':ended:') && !prev.content?.includes(':ended:');
      const prevPending = isMessagePending(prev);
      const mPending = isMessagePending(m);
      const resolvedId = !prevPending ? prev.id : !mPending ? m.id : m.id;
      const resolvedClientId = prev.client_id || m.client_id || prev.id || m.id;

      deduplicated[existingIdx] = {
        ...prev,
        ...m,
        id: isNewAnswered || isNewEnded ? m.id : resolvedId,
        client_id: resolvedClientId,
        is_pending: prevPending && mPending,
        should_animate: Boolean(prev.should_animate || m.should_animate),
        content: isNewAnswered || isNewEnded ? m.content : m.content || prev.content,
        sender: m.sender || prev.sender,
        reactions: m.reactions !== undefined ? m.reactions : prev.reactions,
        is_read: Boolean(prev.is_read || m.is_read),
      };
      continue;
    }

    if (seenIds.has(m.id)) continue;
    seenIds.add(m.id);
    deduplicated.push({
      ...m,
      client_id: m.client_id || m.id,
    });
  }

  return deduplicated;
}

function loadCombinedLocalMessages(candidateIds: string[]): ClientMessage[] {
  if (typeof window === 'undefined' || !candidateIds || candidateIds.length === 0) return [];
  const all: ClientMessage[] = [];
  candidateIds.forEach((id) => {
    try {
      const raw = localStorage.getItem(getLocalMsgCacheKey(id));
      if (raw) {
        const msgs = JSON.parse(raw) as ClientMessage[];
        if (Array.isArray(msgs)) {
          msgs.forEach((msg) => {
            all.push({
              ...msg,
              client_id: msg.client_id || msg.id,
              is_pending: false,
              should_animate: false,
            });
          });
        }
      }
    } catch {
      // ignore
    }
  });
  return cleanAndDeduplicateMessages(all, candidateIds[0] || null);
}

function saveLocalMessages(convId: string | null, msgs: ClientMessage[]) {
  if (typeof window === 'undefined' || !convId) return;
  try {
    const clean = cleanAndDeduplicateMessages(msgs, convId).map(
      ({ should_animate: _sa, is_pending: _ip, ...rest }) => rest
    );
    localStorage.setItem(getLocalMsgCacheKey(convId), JSON.stringify(clean));
  } catch {
    // ignore
  }
}

export function useMessages(
  conversationId: string | null,
  currentUserId?: string,
  isViewingChat: boolean = true,
  conversationObj?: Conversation | null
) {
  const conversationObjRef = useRef(conversationObj);
  conversationObjRef.current = conversationObj;

  const convObjId = conversationObj?.id || '';
  const convObjOriginalId = ((conversationObj as any)?.original_id as string) || '';
  const convObjCanonicalId = ((conversationObj as any)?.canonical_id as string) || '';
  const otherMemberId = conversationObj?.other_member?.id || '';
  const aliasIdsKey = Array.isArray((conversationObj as any)?.alias_ids)
    ? ((conversationObj as any).alias_ids as string[]).filter(Boolean).join(',')
    : '';
  const memberIdsKey = Array.isArray(conversationObj?.member_ids)
    ? conversationObj.member_ids.filter(Boolean).join(',')
    : '';

  const getCandidateConvIds = useCallback((): string[] => {
    const ids = new Set<string>();
    if (conversationId) ids.add(conversationId);
    if (convObjId) ids.add(convObjId);
    if (convObjOriginalId) ids.add(convObjOriginalId);
    if (convObjCanonicalId) ids.add(convObjCanonicalId);
    if (aliasIdsKey) {
      aliasIdsKey.split(',').forEach((id) => {
        if (id) ids.add(id);
      });
    }
    if (currentUserId && otherMemberId) {
      ids.add(getDeterministicDirectConvId(currentUserId, otherMemberId));
    }
    return Array.from(ids).filter(Boolean);
  }, [
    conversationId,
    currentUserId,
    convObjId,
    convObjOriginalId,
    convObjCanonicalId,
    otherMemberId,
    aliasIdsKey,
  ]);

  const getCandidateConvIdsRef = useRef(getCandidateConvIds);
  getCandidateConvIdsRef.current = getCandidateConvIds;

  const [messages, setMessages] = useState<ClientMessage[]>(() => {
    const candidateIds = conversationId
      ? Array.from(
          new Set(
            [
              conversationId,
              convObjId,
              convObjOriginalId,
              convObjCanonicalId,
            ].filter(Boolean) as string[]
          )
        )
      : [];
    return loadCombinedLocalMessages(candidateIds);
  });

  const [loading, setLoading] = useState<boolean>(() => {
    const candidateIds = conversationId
      ? Array.from(
          new Set(
            [
              conversationId,
              convObjId,
              convObjOriginalId,
              convObjCanonicalId,
            ].filter(Boolean) as string[]
          )
        )
      : [];
    const cached = loadCombinedLocalMessages(candidateIds);
    return cached.length === 0 && Boolean(conversationId);
  });

  const [sending] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const msgBusRef = useRef<BroadcastChannel | null>(null);
  const [typingUserId, setTypingUserId] = useState<string | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isViewingChatRef = useRef<boolean>(isViewingChat);
  isViewingChatRef.current = isViewingChat;
  const lastSentContentRef = useRef<{ content: string; time: number } | null>(null);
  const lastTypingEmitRef = useRef<number>(0);
  const messagesRef = useRef<ClientMessage[]>(messages);
  messagesRef.current = messages;
  const knownMsgIdsRef = useRef<Set<string>>(new Set(messages.map((m) => m.id)));
  const hasLoadedInitialRef = useRef<boolean>(false);

  const clearTyping = useCallback(() => {
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    setTypingUserId((prev) => (prev !== null ? null : prev));
  }, []);

  useEffect(() => {
    hasLoadedInitialRef.current = false;
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    setTypingUserId(null);

    if (conversationId) {
      const candidateIds = getCandidateConvIdsRef.current();
      const cached = loadCombinedLocalMessages(candidateIds);
      knownMsgIdsRef.current = new Set(cached.map((m) => m.id));
      setMessages(cached);
      if (cached.length > 0) {
        setLoading(false);
      } else {
        setLoading(true);
      }
    } else {
      knownMsgIdsRef.current = new Set();
      setMessages([]);
      setLoading(false);
    }
  }, [conversationId]);

  const updateMessagesState = useCallback(
    (updater: ClientMessage[] | ((prev: ClientMessage[]) => ClientMessage[])) => {
      setMessages((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        if (next === prev) {
          return prev;
        }

        const cleanNext = cleanAndDeduplicateMessages(next, conversationId);

        if (prev.length === cleanNext.length) {
          const isIdentical = cleanNext.every(
            (m, i) =>
              prev[i].id === m.id &&
              (prev[i].client_id || prev[i].id) === (m.client_id || m.id) &&
              prev[i].content === m.content &&
              prev[i].created_at === m.created_at &&
              Boolean(prev[i].is_read) === Boolean(m.is_read) &&
              Boolean(prev[i].is_pending) === Boolean(m.is_pending) &&
              prev[i].sender?.id === m.sender?.id &&
              JSON.stringify(prev[i].reactions || null) === JSON.stringify(m.reactions || null)
          );
          if (isIdentical) {
            return prev;
          }
        }

        const candidateIds = getCandidateConvIdsRef.current();
        candidateIds.forEach((cId) => {
          saveLocalMessages(cId, cleanNext);
        });

        return cleanNext;
      });
    },
    [conversationId]
  );

  const scrollToBottom = useCallback((_smooth = true) => {
    // Scroll logic is handled by ChatWindow.tsx
  }, []);

  const applyServerTyping = useCallback(
    (typingIds?: string[]) => {
      if (Array.isArray(typingIds) && typingIds.length > 0) {
        const otherTyping = typingIds.find((id) => id && id !== currentUserId);
        if (otherTyping) {
          setTypingUserId((prev) => (prev === otherTyping ? prev : otherTyping));
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = setTimeout(() => {
            setTypingUserId(null);
            typingTimeoutRef.current = null;
          }, 3000);
          return;
        }
      }
    },
    [currentUserId]
  );

  const fetchMessages = useCallback(async () => {
    if (!conversationId) {
      setMessages([]);
      setLoading(false);
      return;
    }

    if (isFirebaseSessionActive(currentUserId)) {
      return;
    }

    const candidateIds = getCandidateConvIds();
    const cached = loadCombinedLocalMessages(candidateIds);
    if (cached.length > 0) {
      updateMessagesState((prev) => (prev.length === 0 ? cached : prev));
    } else {
      setLoading(true);
    }

    setError(null);

    try {
      const deletedSet = loadDeletedMsgIds(conversationId);
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/messages/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ conversationId, candidateIds, userId: currentUserId }),
      });

      const json = res.ok ? await res.json() : null;
      if (json?.typingUserIds) {
        applyServerTyping(json.typingUserIds);
      }

      const rawMessages: any[] = Array.isArray(json?.messages)
        ? json.messages.filter((m: any) => m?.id && !deletedSet.has(m.id))
        : [];

      const formattedRemoteMessages: ClientMessage[] = rawMessages.map((m: any) => ({
        ...m,
        client_id: m.client_id || m.id,
        is_pending: false,
        should_animate: false,
        is_read: Boolean(m.is_read),
      }));

      formattedRemoteMessages.forEach((m) => knownMsgIdsRef.current.add(m.id));
      hasLoadedInitialRef.current = true;

      updateMessagesState((prev) => {
        const currentDeleted = loadDeletedMsgIds(conversationId);
        const prevById = new Map<string, ClientMessage>(prev.map((m) => [m.id, m]));
        const remoteIdMap = new Map<string, ClientMessage>();

        formattedRemoteMessages.forEach((m) => {
          if (currentDeleted.has(m.id)) return;
          const existing = prevById.get(m.id);
          remoteIdMap.set(m.id, {
            ...m,
            client_id: existing?.client_id || m.id,
            should_animate: existing?.should_animate ?? false,
          });
        });

        const merged = Array.from(remoteIdMap.values());
        const now = Date.now();
        prev.forEach((localMsg) => {
          if (!remoteIdMap.has(localMsg.id) && !currentDeleted.has(localMsg.id)) {
            const alreadyInRemote = Array.from(remoteIdMap.values()).some(
              (rm) =>
                rm.sender_id === localMsg.sender_id &&
                rm.content === localMsg.content &&
                Math.abs(new Date(rm.created_at || 0).getTime() - new Date(localMsg.created_at || 0).getTime()) < 45000
            );
            if (alreadyInRemote) return;

            const isCallLog = localMsg.content?.startsWith('[CALL_LOG:');
            const ageMs = now - new Date(localMsg.created_at || 0).getTime();
            if (isCallLog || ageMs < 60000) {
              merged.push(localMsg);
            }
          }
        });

        return merged.sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
      });

      scrollToBottom(false);
    } catch (err: any) {
      console.warn('Notice fetching messages:', err.message);
    } finally {
      setLoading(false);
    }
  }, [conversationId, currentUserId, getCandidateConvIds, scrollToBottom, updateMessagesState, applyServerTyping]);

  useEffect(() => {
    if (!isFirebaseSessionActive(currentUserId)) {
      fetchMessages();
    }
  }, [currentUserId, fetchMessages]);

  // Mark unread messages from other user as read
  const markMessagesAsRead = useCallback(async () => {
    const currentMsgs = messagesRef.current;
    if (!conversationId || !currentUserId || currentMsgs.length === 0) return;

    const unreadMessages = currentMsgs.filter(
      (m) => m.sender_id !== currentUserId && !m.is_read
    );

    if (unreadMessages.length === 0) return;

    try {
      const unreadIds = unreadMessages.map((m) => m.id);

      updateMessagesState((prev) =>
        prev.map((msg) =>
          msg.sender_id !== currentUserId && !msg.is_read ? { ...msg, is_read: true } : msg
        )
      );

      try {
        const currentCache = JSON.parse(localStorage.getItem('lc_read_msgs') || '[]');
        const updatedCache = Array.from(new Set([...currentCache, ...unreadIds])).slice(-500);
        localStorage.setItem('lc_read_msgs', JSON.stringify(updatedCache));
      } catch {
        // ignore
      }

      if (isFirebaseSessionActive(currentUserId)) {
        await markMessagesAsReadFs(conversationId, currentUserId);
        return;
      }

      const authHeaders = await getAuthHeaders();
      await fetch('/api/messages/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ conversationId, userId: currentUserId }),
      });

      msgBusRef.current?.postMessage({
        type: 'messages_read',
        conversationId,
        readerId: currentUserId,
      });
    } catch (err) {
      console.warn('Silent notice on markMessagesAsRead:', err);
    }
  }, [conversationId, currentUserId, updateMessagesState]);

  const sendTypingSignal = useCallback(() => {
    if (!conversationId || !currentUserId) return;
    const now = Date.now();
    if (now - lastTypingEmitRef.current < 1200) return;
    lastTypingEmitRef.current = now;

    if (isFirebaseSessionActive(currentUserId)) {
      setDoc(doc(db, 'conversations', conversationId, 'typing', currentUserId), {
        userId: currentUserId,
        conversationId,
        expiresAt: Math.floor(now + 4000),
        updatedAt: serverTimestamp(),
      }).catch(() => {});
      return;
    }

    fetch('/api/messages/typing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, userId: currentUserId }),
    }).catch(() => {});

    msgBusRef.current?.postMessage({
      type: 'typing',
      conversationId,
      userId: currentUserId,
    });
  }, [conversationId, currentUserId]);

  useEffect(() => {
    if (!conversationId || !currentUserId || !isViewingChat) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    const hasUnread = messages.some((m) => m.sender_id !== currentUserId && !m.is_read);
    if (hasUnread) {
      markMessagesAsRead();
    }
  }, [conversationId, currentUserId, messages, isViewingChat, markMessagesAsRead]);

  useEffect(() => {
    const handleFocus = () => {
      if (
        document.visibilityState === 'visible' &&
        conversationId &&
        currentUserId &&
        isViewingChatRef.current
      ) {
        markMessagesAsRead();
      }
    };
    document.addEventListener('visibilitychange', handleFocus);
    window.addEventListener('focus', handleFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleFocus);
      window.removeEventListener('focus', handleFocus);
    };
  }, [conversationId, currentUserId, markMessagesAsRead]);

  // Real-time listeners (Firestore onSnapshot when Firebase signed-in; BroadcastChannel + polling fallback otherwise)
  useEffect(() => {
    if (!conversationId) return;

    if (isFirebaseSessionActive(currentUserId) && currentUserId) {
      const msgQuery = query(
        collection(db, 'users', currentUserId, 'inbox', conversationId, 'messages'),
        orderBy('createdAt', 'asc')
      );

      const unsubMsgs = onSnapshot(
        msgQuery,
        (snap) => {
          const deletedSet = loadDeletedMsgIds(conversationId);

          const prevById = new Map<string, ClientMessage>(messagesRef.current.map((m) => [m.id, m]));
          const prevByClientId = new Map<string, ClientMessage>(
            messagesRef.current.map((m) => [m.client_id || m.id, m])
          );
          const wasInitialized = hasLoadedInitialRef.current;
          let receivedNewPeerMessage = false;
          let newlyReadOwnMsgIds: string[] = [];
          let lastSnapTimeMs = 0;

          const remoteList: ClientMessage[] = [];
          snap.forEach((docSnap) => {
            if (deletedSet.has(docSnap.id)) return;
            const rawData = docSnap.data();
            const mapped = inboxMessageDocToMessage(rawData);
            const existing = prevById.get(mapped.id) || prevByClientId.get(mapped.id);

            // Prevent shifting timestamps on local pending writes before serverTimestamp resolves
            if (!rawData.createdAt) {
              if (existing?.created_at) {
                mapped.created_at = existing.created_at;
              } else {
                const monoMs = Math.max(Date.now(), lastSnapTimeMs + 1);
                mapped.created_at = new Date(monoMs).toISOString();
              }
            }

            const mappedMs = new Date(mapped.created_at || 0).getTime();
            if (Number.isFinite(mappedMs) && mappedMs > lastSnapTimeMs) {
              lastSnapTimeMs = mappedMs;
            }

            const isBrandNew = wasInitialized && !knownMsgIdsRef.current.has(mapped.id);
            knownMsgIdsRef.current.add(mapped.id);

            if (isBrandNew && mapped.sender_id !== currentUserId) {
              receivedNewPeerMessage = true;
            }

            if (mapped.sender_id === currentUserId && mapped.is_read && existing && !existing.is_read) {
              newlyReadOwnMsgIds.push(mapped.id);
            }

            remoteList.push({
              ...mapped,
              client_id: existing?.client_id || mapped.id,
              is_pending: false,
              should_animate: existing ? existing.should_animate : isBrandNew,
              is_read: Boolean(mapped.is_read),
            });
          });

          if (newlyReadOwnMsgIds.length > 0 && typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent('liveconnect_messages_read_sync', {
                detail: { conversationId, messageIds: newlyReadOwnMsgIds },
              })
            );
          }

          // Preserve any still-in-flight optimistic pending messages so they never vanish during pre-write checks
          const remoteIds = new Set(remoteList.map((m) => m.id));
          const remoteClientIds = new Set(remoteList.map((m) => m.client_id || m.id));
          messagesRef.current.forEach((localMsg) => {
            if (
              isMessagePending(localMsg) &&
              !deletedSet.has(localMsg.id) &&
              !remoteIds.has(localMsg.id) &&
              !remoteClientIds.has(localMsg.client_id || localMsg.id)
            ) {
              const localMs = new Date(localMsg.created_at || 0).getTime();
              const monotonicIso =
                Number.isFinite(localMs) && localMs > lastSnapTimeMs
                  ? localMsg.created_at
                  : new Date(++lastSnapTimeMs).toISOString();
              remoteList.push({
                ...localMsg,
                created_at: monotonicIso,
              });
            }
          });

          hasLoadedInitialRef.current = true;
          if (receivedNewPeerMessage) {
            clearTyping();
          }

          updateMessagesState(remoteList);
          setLoading(false);
        },
        (err) => {
          if (!auth.currentUser) return;
          handleFirestoreError(err, OperationType.LIST, `users/${currentUserId}/inbox/${conversationId}/messages`);
        }
      );

      // Single-doc typing listeners (uses allow get rather than allow list)
      const typingUnsubs: (() => void)[] = [];
      const peerIds: string[] = [];
      const currentConvObj = conversationObjRef.current;
      if (otherMemberId && otherMemberId !== currentUserId) {
        peerIds.push(otherMemberId);
      } else if (memberIdsKey) {
        memberIdsKey
          .split(',')
          .filter((id) => id && id !== currentUserId)
          .slice(0, 15)
          .forEach((id) => peerIds.push(id));
      } else if (Array.isArray(currentConvObj?.member_ids)) {
        currentConvObj.member_ids
          .filter((id) => id && id !== currentUserId)
          .slice(0, 15)
          .forEach((id) => peerIds.push(id));
      }

      peerIds.forEach((peerId) => {
        const unsubTyping = onSnapshot(
          doc(db, 'conversations', conversationId, 'typing', peerId),
          (tSnap) => {
            if (!tSnap.exists()) return;
            const td = tSnap.data();
            if (td?.expiresAt && td.expiresAt > Date.now()) {
              applyServerTyping([peerId]);
            }
          },
          () => {
            // Silent ignore for typing status if conversation hasn't been created on disk yet
          }
        );
        typingUnsubs.push(unsubTyping);
      });

      return () => {
        unsubMsgs();
        typingUnsubs.forEach((u) => u());
        if (typingTimeoutRef.current) {
          clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = null;
        }
      };
    }

    const candidateSet = new Set(getCandidateConvIds());

    if (typeof BroadcastChannel !== 'undefined') {
      const bus = new BroadcastChannel('liveconnect_messages_sync');
      msgBusRef.current = bus;
      bus.onmessage = (event) => {
        const data = event.data;
        if (!data) return;
        const targetConvId = data.conversationId || data.message?.conversation_id;
        if (targetConvId && !candidateSet.has(targetConvId)) return;

        if (data.type === 'typing' && data.userId && data.userId !== currentUserId) {
          setTypingUserId((prev) => (prev === data.userId ? prev : data.userId));
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = setTimeout(() => {
            setTypingUserId(null);
            typingTimeoutRef.current = null;
          }, 3000);
        } else if (data.type === 'messages_read' && data.readerId !== currentUserId) {
          updateMessagesState((prev) => {
            let changed = false;
            const next = prev.map((msg) => {
              if (msg.sender_id === currentUserId && !msg.is_read) {
                changed = true;
                return { ...msg, is_read: true };
              }
              return msg;
            });
            return changed ? next : prev;
          });
        } else if (data.type === 'message_deleted' && data.messageId) {
          recordDeletedMsgId(conversationId, data.messageId);
          updateMessagesState((prev) => {
            const next = prev.filter((m) => m.id !== data.messageId);
            return next.length === prev.length ? prev : next;
          });
        } else if (data.type === 'messages_cleared') {
          updateMessagesState([]);
          if (typeof window !== 'undefined') {
            localStorage.removeItem(getLocalMsgCacheKey(conversationId));
          }
        } else if (data.type === 'new_message' && data.message) {
          const newMsg = data.message as Message;
          const deleted = loadDeletedMsgIds(conversationId);
          if (deleted.has(newMsg.id)) return;

          const isActivelyViewing =
            isViewingChatRef.current && (typeof document === 'undefined' || !document.hidden);

          if (currentUserId && newMsg.sender_id !== currentUserId) {
            clearTyping();
            if (isActivelyViewing) {
              markMessagesAsRead();
            }
          }

          knownMsgIdsRef.current.add(newMsg.id);
          updateMessagesState((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [
              ...prev,
              {
                ...newMsg,
                client_id: (newMsg as ClientMessage).client_id || newMsg.id,
                is_pending: false,
                should_animate: true,
                is_read:
                  newMsg.sender_id === currentUserId
                    ? Boolean(newMsg.is_read)
                    : isActivelyViewing,
              },
            ];
          });
        }
      };
    }

    const pollInterval = setInterval(() => {
      const currentCandidateIds = getCandidateConvIds();
      fetch('/api/messages/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, candidateIds: currentCandidateIds, userId: currentUserId }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          if (json?.typingUserIds) {
            applyServerTyping(json.typingUserIds);
          }

          if (json?.messages && Array.isArray(json.messages)) {
            const deletedSet = loadDeletedMsgIds(conversationId);
            const activeServerMsgs: Message[] = json.messages.filter((m: Message) => !deletedSet.has(m.id));
            const serverIds = new Set(activeServerMsgs.map((m) => m.id));
            let receivedNewPeerMessage = false;

            updateMessagesState((prev) => {
              const currentDeleted = loadDeletedMsgIds(conversationId);
              const prevMap = new Map<string, ClientMessage>();
              let hasChanged = false;

              prev.forEach((m) => {
                if (currentDeleted.has(m.id)) {
                  hasChanged = true;
                  return;
                }
                const ageMs = Date.now() - new Date(m.created_at || 0).getTime();
                if (!serverIds.has(m.id) && !m.content?.startsWith('[CALL_LOG:') && ageMs > 10000) {
                  hasChanged = true;
                  return;
                }
                prevMap.set(m.id, m);
              });

              activeServerMsgs.forEach((srvMsg: Message) => {
                if (currentDeleted.has(srvMsg.id)) return;
                const existing = prevMap.get(srvMsg.id);
                if (existing) {
                  if (
                    Boolean(existing.is_read) !== Boolean(srvMsg.is_read) ||
                    existing.content !== srvMsg.content ||
                    JSON.stringify(existing.reactions || null) !== JSON.stringify(srvMsg.reactions || null)
                  ) {
                    prevMap.set(srvMsg.id, {
                      ...existing,
                      ...srvMsg,
                      client_id: existing.client_id || existing.id,
                      is_pending: false,
                      is_read: Boolean(existing.is_read || srvMsg.is_read),
                    });
                    hasChanged = true;
                  }
                  knownMsgIdsRef.current.add(srvMsg.id);
                  return;
                }

                const matchingEntry = Array.from(prevMap.values()).find(
                  (m) =>
                    !serverIds.has(m.id) &&
                    isMessagePending(m) &&
                    m.sender_id === srvMsg.sender_id &&
                    m.content === srvMsg.content &&
                    Math.abs(new Date(m.created_at || 0).getTime() - new Date(srvMsg.created_at || 0).getTime()) < 45000
                );

                if (matchingEntry) {
                  prevMap.delete(matchingEntry.id);
                  prevMap.set(srvMsg.id, {
                    ...matchingEntry,
                    ...srvMsg,
                    client_id: matchingEntry.client_id || matchingEntry.id,
                    is_pending: false,
                  });
                  knownMsgIdsRef.current.add(srvMsg.id);
                  hasChanged = true;
                } else {
                  const isBrandNew = hasLoadedInitialRef.current && !knownMsgIdsRef.current.has(srvMsg.id);
                  knownMsgIdsRef.current.add(srvMsg.id);
                  if (isBrandNew && srvMsg.sender_id !== currentUserId) {
                    receivedNewPeerMessage = true;
                  }
                  prevMap.set(srvMsg.id, {
                    ...srvMsg,
                    client_id: srvMsg.id,
                    is_pending: false,
                    should_animate: isBrandNew,
                  });
                  hasChanged = true;
                }
              });

              hasLoadedInitialRef.current = true;
              if (!hasChanged && prev.length === prevMap.size) return prev;
              return Array.from(prevMap.values()).sort(
                (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
              );
            });

            if (receivedNewPeerMessage) {
              clearTyping();
            }
          }
        })
        .catch(() => {});
    }, 1200);

    return () => {
      clearInterval(pollInterval);
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      if (msgBusRef.current) {
        msgBusRef.current.close();
        msgBusRef.current = null;
      }
    };
  }, [
    conversationId,
    currentUserId,
    otherMemberId,
    memberIdsKey,
    getCandidateConvIds,
    scrollToBottom,
    updateMessagesState,
    markMessagesAsRead,
    applyServerTyping,
    clearTyping,
  ]);

  const sendMessage = useCallback(
    async (
      content: string,
      senderProfile?: Profile,
      receiverId?: string,
      receiverProfile?: Profile
    ): Promise<boolean> => {
      const trimmed = content.trim();
      if (!trimmed || !conversationId || !currentUserId) return false;

      if (
        lastSentContentRef.current &&
        lastSentContentRef.current.content === trimmed &&
        Date.now() - lastSentContentRef.current.time < 150
      ) {
        return false;
      }
      lastSentContentRef.current = { content: trimmed, time: Date.now() };

      setError(null);

      if (isFirebaseSessionActive(currentUserId)) {
        const wordCheck = await validateTextAgainstBannedWords(trimmed);
        if (wordCheck.blocked) {
          setError(wordCheck.errorMessage || 'This message contains a restricted word and cannot be sent.');
          return false;
        }
      }

      let processedContent = trimmed;

      if (processedContent.includes('data:image') || processedContent.includes('data:audio')) {
        try {
          if (processedContent.startsWith('[IMAGE:data:image')) {
            const inside = processedContent.slice(7, -1);
            const base64Idx = inside.indexOf(';base64,');
            if (base64Idx !== -1) {
              const nextColon = inside.indexOf(':', base64Idx);
              const dataUrl = nextColon !== -1 ? inside.slice(0, nextColon) : inside;
              const caption = nextColon !== -1 ? inside.slice(nextColon + 1) : '';
              const uploadedUrl = await uploadMediaToServer(dataUrl, { mediaType: 'image' });
              if (uploadedUrl) {
                processedContent = caption ? `[IMAGE:${uploadedUrl}:${caption}]` : `[IMAGE:${uploadedUrl}]`;
              }
            }
          } else if (processedContent.startsWith('[VOICE:')) {
            const tokens = processedContent.slice(7, -1);
            const firstColon = tokens.indexOf(':');
            if (firstColon !== -1) {
              const dur = tokens.slice(0, firstColon);
              const audioData = tokens.slice(firstColon + 1);
              if (audioData.startsWith('data:audio')) {
                const uploadedUrl = await uploadMediaToServer(audioData, { mediaType: 'audio' });
                if (uploadedUrl) {
                  processedContent = `[VOICE:${dur}:${uploadedUrl}]`;
                }
              }
            }
          }
        } catch (err) {
          console.warn('Fallback processing media payload:', err);
        }
      }

      const tailMsg = messagesRef.current[messagesRef.current.length - 1];
      const tailMs = tailMsg ? new Date(tailMsg.created_at || 0).getTime() : 0;
      const safeNowMs = Math.max(Date.now(), Number.isFinite(tailMs) ? tailMs + 1 : 0);
      const nowIso = new Date(safeNowMs).toISOString();
      const tempId = generateUUID();

      const optimisticMessage: ClientMessage = {
        id: tempId,
        client_id: tempId,
        is_pending: true,
        should_animate: true,
        conversation_id: conversationId,
        sender_id: currentUserId,
        content: processedContent,
        created_at: nowIso,
        updated_at: nowIso,
        sender: senderProfile,
        is_read: false,
      };

      knownMsgIdsRef.current.add(tempId);

      // Render message & update conversation preview immediately with zero loading lock
      updateMessagesState((prev) => [...prev, optimisticMessage]);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('liveconnect_conversation_message', {
            detail: {
              conversationId,
              message: optimisticMessage,
              receiverId,
              receiverProfile,
            },
          })
        );
      }

      if (isFirebaseSessionActive(currentUserId)) {
        try {
          const senderProf: Profile = senderProfile || {
            id: currentUserId,
            username: 'user',
            display_name: 'User',
            avatar_url: null,
            bio: null,
            is_online: true,
            last_seen: nowIso,
            created_at: nowIso,
            updated_at: nowIso,
          };

          const savedMsg = await sendMessageToFirestoreFs({
            messageId: tempId,
            conversationId,
            content: processedContent,
            senderProfile: senderProf,
            receiverId,
            receiverProfile,
          });

          knownMsgIdsRef.current.add(savedMsg.id);
          updateMessagesState((prev) =>
            prev.map((m) =>
              m.id === tempId || m.client_id === tempId
                ? {
                    ...savedMsg,
                    created_at: m.created_at || savedMsg.created_at,
                    updated_at: m.updated_at || savedMsg.updated_at,
                    client_id: m.client_id || tempId,
                    is_pending: false,
                    should_animate: m.should_animate,
                  }
                : m
            )
          );

          void reportTelemetry('dm_sent', conversationId);
          return true;
        } catch (err: any) {
          updateMessagesState((prev) => prev.filter((m) => m.id !== tempId && m.client_id !== tempId));
          setError(err?.message || 'Failed to send message.');
          return false;
        }
      }

      try {
        const authHeaders = await getAuthHeaders();
        const relayRes = await fetch('/api/messages/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({
            message: optimisticMessage,
            conversationId,
            receiverId,
            recipientId: receiverId,
            senderProfile,
            receiverProfile,
          }),
        });

        if (relayRes.status === 403) {
          const errorData = await relayRes.json().catch(() => ({}));
          updateMessagesState((prev) => prev.filter((m) => m.id !== tempId && m.client_id !== tempId));
          setError(errorData.error || 'Follow each other to start messaging.');
          return false;
        }

        if (!relayRes.ok) {
          const errorData = await relayRes.json().catch(() => ({}));
          updateMessagesState((prev) => prev.filter((m) => m.id !== tempId && m.client_id !== tempId));
          setError(errorData.error || 'Failed to send message.');
          return false;
        }

        const data = await relayRes.json().catch(() => null);
        const savedMsg: ClientMessage = data?.message
          ? {
              ...optimisticMessage,
              ...data.message,
              client_id: tempId,
              is_pending: false,
              should_animate: optimisticMessage.should_animate,
              sender: data.message.sender || senderProfile,
            }
          : { ...optimisticMessage, is_pending: false };

        knownMsgIdsRef.current.add(savedMsg.id);
        updateMessagesState((prev) =>
          prev.map((m) =>
            m.id === tempId || m.client_id === tempId
              ? {
                  ...savedMsg,
                  client_id: m.client_id || tempId,
                  is_pending: false,
                  should_animate: m.should_animate,
                }
              : m
          )
        );

        msgBusRef.current?.postMessage({
          type: 'new_message',
          conversationId,
          message: savedMsg,
          conversation: data?.conversation,
        });

        if (data?.conversation && typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('liveconnect_conversation_message', {
              detail: {
                conversationId,
                message: savedMsg,
                conversation: data.conversation,
                receiverId,
                receiverProfile,
              },
            })
          );
        }

        return true;
      } catch (err: any) {
        updateMessagesState((prev) => prev.filter((m) => m.id !== tempId && m.client_id !== tempId));
        setError(err?.message || 'Failed to send message.');
        return false;
      }
    },
    [conversationId, currentUserId, updateMessagesState]
  );

  // Delete a single message for EVERYONE
  const deleteMessage = useCallback(
    async (messageId: string): Promise<boolean> => {
      if (!messageId) return false;

      try {
        const targetMsg = messagesRef.current.find((m) => m.id === messageId);
        if (targetMsg) {
          let cPublicId = (targetMsg as any).cloudinary_public_id || null;
          const resType =
            (targetMsg as any).media_type === 'video'
              ? 'video'
              : (targetMsg as any).media_type === 'voice'
              ? 'raw'
              : 'image';

          if (!cPublicId) {
            const rawUrl = (targetMsg as any).media_url || targetMsg.content || '';
            if (rawUrl.includes('cloudinary.com') || rawUrl.includes('/res.cloudinary.com/')) {
              const parts = rawUrl.split('/upload/');
              if (parts[1]) {
                const fileWithExt = parts[1].replace(/^v\d+\//, '').split('?')[0];
                cPublicId = fileWithExt.substring(0, fileWithExt.lastIndexOf('.')) || fileWithExt;
              }
            }
          }

          if (cPublicId) {
            deleteCloudinaryAsset(cPublicId, resType).catch((cErr) => {
              console.warn('Notice deleting Cloudinary asset for message:', cErr);
            });
          }

          let b2Key = (targetMsg as any).b2_file_id || null;
          if (!b2Key) {
            const rawUrl = (targetMsg as any).media_url || targetMsg.content || '';
            if (rawUrl.includes('/api/b2/file/')) {
              const encoded = rawUrl.split('/api/b2/file/')[1]?.split(']')[0]?.split('?')[0];
              if (encoded) {
                b2Key = decodeURIComponent(encoded);
              }
            }
          }
          if (b2Key) {
            deleteB2Object(b2Key).catch((delErr) => {
              console.warn('Notice deleting B2 cloud object for message:', delErr);
            });
          }
        }

        recordDeletedMsgId(conversationId, messageId);
        updateMessagesState((prev) => prev.filter((m) => m.id !== messageId));

        if (isFirebaseSessionActive(currentUserId) && conversationId) {
          await deleteMessageForAllFs(conversationId, messageId).catch(() => {});
          return true;
        }

        msgBusRef.current?.postMessage({
          type: 'message_deleted',
          conversationId,
          messageId,
        });

        await fetch('/api/messages/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId, messageId }),
        }).catch(() => {});

        return true;
      } catch (err: any) {
        console.error('Error in deleteMessage:', err.message);
        return false;
      }
    },
    [conversationId, currentUserId, updateMessagesState]
  );

  // Clear all messages in the active conversation
  const clearAllMessages = useCallback(async (): Promise<boolean> => {
    if (!conversationId) return false;

    try {
      const currentIds = messagesRef.current.map((m) => m.id);
      recordMultipleDeletedMsgIds(conversationId, currentIds);

      updateMessagesState([]);
      if (typeof window !== 'undefined') {
        localStorage.removeItem(getLocalMsgCacheKey(conversationId));
      }

      if (isFirebaseSessionActive(currentUserId) && currentUserId) {
        await clearUserInboxMessagesFs(conversationId, currentUserId).catch(() => {});
        return true;
      }

      msgBusRef.current?.postMessage({
        type: 'messages_cleared',
        conversationId,
      });

      await fetch('/api/messages/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId }),
      }).catch(() => {});

      return true;
    } catch (err: any) {
      console.error('Error in clearAllMessages:', err.message);
      return false;
    }
  }, [conversationId, currentUserId, updateMessagesState]);

  return {
    messages,
    loading,
    sending,
    error,
    messagesEndRef,
    sendMessage,
    deleteMessage,
    clearAllMessages,
    fetchMessages,
    scrollToBottom,
    markMessagesAsRead,
    typingUserId,
    sendTypingSignal,
  };
}
