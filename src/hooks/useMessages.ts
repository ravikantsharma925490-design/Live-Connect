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

function cleanAndDeduplicateMessages(msgs: Message[], convId: string | null): Message[] {
  if (!Array.isArray(msgs) || msgs.length === 0) return [];
  const deleted = loadDeletedMsgIds(convId);
  const seenIds = new Set<string>();
  const deduplicated: Message[] = [];

  const sorted = [...msgs].sort(
    (a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
  );

  for (const m of sorted) {
    if (!m || !m.id || deleted.has(m.id)) continue;

    let existingIdx = deduplicated.findIndex((prev) => prev.id === m.id);

    if (existingIdx === -1 && m.content?.startsWith('[CALL_LOG:')) {
      existingIdx = deduplicated.findIndex((prev) => {
        if (!prev.content?.startsWith('[CALL_LOG:')) return false;
        const timeDiff = Math.abs(
          new Date(prev.created_at || 0).getTime() - new Date(m.created_at || 0).getTime()
        );
        return timeDiff < 60000;
      });
    }

    if (existingIdx === -1 && m.sender_id && m.content) {
      existingIdx = deduplicated.findIndex((prev) => {
        if (prev.sender_id !== m.sender_id || prev.content !== m.content) return false;
        const isOneTemp =
          prev.id.startsWith('temp_') ||
          prev.id.startsWith('local_') ||
          m.id.startsWith('temp_') ||
          m.id.startsWith('local_');
        if (!isOneTemp) return false;
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
      const resolvedId = prev.id && !prev.id.startsWith('temp_') ? prev.id : m.id;

      deduplicated[existingIdx] = {
        ...prev,
        ...m,
        id: isNewAnswered || isNewEnded ? m.id : resolvedId,
        content: isNewAnswered || isNewEnded ? m.content : m.content || prev.content,
        sender: m.sender || prev.sender,
        reactions: m.reactions !== undefined ? m.reactions : prev.reactions,
        is_read: Boolean(prev.is_read || m.is_read),
      };
      continue;
    }

    if (seenIds.has(m.id)) continue;
    seenIds.add(m.id);
    deduplicated.push(m);
  }

  return deduplicated;
}

function loadCombinedLocalMessages(candidateIds: string[]): Message[] {
  if (typeof window === 'undefined' || !candidateIds || candidateIds.length === 0) return [];
  const all: Message[] = [];
  candidateIds.forEach((id) => {
    try {
      const raw = localStorage.getItem(getLocalMsgCacheKey(id));
      if (raw) {
        const msgs = JSON.parse(raw) as Message[];
        if (Array.isArray(msgs)) all.push(...msgs);
      }
    } catch {
      // ignore
    }
  });
  return cleanAndDeduplicateMessages(all, candidateIds[0] || null);
}

function saveLocalMessages(convId: string | null, msgs: Message[]) {
  if (typeof window === 'undefined' || !convId) return;
  try {
    const clean = cleanAndDeduplicateMessages(msgs, convId);
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
  const getCandidateConvIds = useCallback((): string[] => {
    const ids = new Set<string>();
    if (conversationId) ids.add(conversationId);
    if (conversationObj?.id) ids.add(conversationObj.id);

    const isGroup =
      conversationObj?.type === 'group' ||
      Boolean(conversationObj?.name) ||
      Boolean(conversationObj?.owner_id) ||
      Boolean((conversationObj as any)?.member_roles);

    if (!isGroup) {
      if ((conversationObj as any)?.original_id) ids.add((conversationObj as any).original_id);
      if ((conversationObj as any)?.canonical_id) ids.add((conversationObj as any).canonical_id);
      if (Array.isArray((conversationObj as any)?.alias_ids)) {
        (conversationObj as any).alias_ids.forEach((id: string) => {
          if (id) ids.add(id);
        });
      }
      if (currentUserId && conversationObj?.other_member?.id) {
        ids.add(getDeterministicDirectConvId(currentUserId, conversationObj.other_member.id));
      }
    }
    return Array.from(ids).filter(Boolean);
  }, [conversationId, conversationObj, currentUserId]);

  const [messages, setMessages] = useState<Message[]>(() => {
    const isGroup =
      conversationObj?.type === 'group' ||
      Boolean(conversationObj?.name) ||
      Boolean(conversationObj?.owner_id);

    const candidateIds = conversationId
      ? Array.from(
          new Set(
            isGroup
              ? ([conversationId, conversationObj?.id].filter(Boolean) as string[])
              : ([
                  conversationId,
                  conversationObj?.id,
                  (conversationObj as any)?.original_id,
                  (conversationObj as any)?.canonical_id,
                ].filter(Boolean) as string[])
          )
        )
      : [];
    return loadCombinedLocalMessages(candidateIds);
  });

  const [loading, setLoading] = useState<boolean>(() => {
    const isGroup =
      conversationObj?.type === 'group' ||
      Boolean(conversationObj?.name) ||
      Boolean(conversationObj?.owner_id);

    const candidateIds = conversationId
      ? Array.from(
          new Set(
            isGroup
              ? ([conversationId, conversationObj?.id].filter(Boolean) as string[])
              : ([
                  conversationId,
                  conversationObj?.id,
                  (conversationObj as any)?.original_id,
                  (conversationObj as any)?.canonical_id,
                ].filter(Boolean) as string[])
          )
        )
      : [];
    const cached = loadCombinedLocalMessages(candidateIds);
    return cached.length === 0 && Boolean(conversationId);
  });

  const [sending, setSending] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const msgBusRef = useRef<BroadcastChannel | null>(null);
  const [typingUserId, setTypingUserId] = useState<string | null>(null);
  const typingTimeoutRef = useRef<any>(null);
  const isViewingChatRef = useRef<boolean>(isViewingChat);
  isViewingChatRef.current = isViewingChat;
  const lastSentContentRef = useRef<{ content: string; time: number } | null>(null);
  const lastTypingEmitRef = useRef<number>(0);

  useEffect(() => {
    if (conversationId) {
      const candidateIds = getCandidateConvIds();
      const cached = loadCombinedLocalMessages(candidateIds);
      setMessages(cached);
      setTypingUserId(null);
      if (cached.length > 0) {
        setLoading(false);
      } else {
        setLoading(true);
      }
    } else {
      setMessages([]);
      setTypingUserId(null);
      setLoading(false);
    }
  }, [conversationId, getCandidateConvIds]);

  const updateMessagesState = useCallback(
    (updater: Message[] | ((prev: Message[]) => Message[])) => {
      setMessages((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        const cleanNext = cleanAndDeduplicateMessages(next, conversationId);
        const candidateIds = getCandidateConvIds();

        if (prev.length === cleanNext.length) {
          const isIdentical = cleanNext.every(
            (m, i) =>
              prev[i].id === m.id &&
              prev[i].content === m.content &&
              Boolean(prev[i].is_read) === Boolean(m.is_read) &&
              prev[i].sender?.id === m.sender?.id &&
              JSON.stringify(prev[i].reactions || null) === JSON.stringify(m.reactions || null)
          );
          if (isIdentical) {
            candidateIds.forEach((cId) => saveLocalMessages(cId, prev));
            return prev;
          }
        }

        candidateIds.forEach((cId) => {
          saveLocalMessages(cId, cleanNext);
        });

        return cleanNext;
      });
    },
    [conversationId, getCandidateConvIds]
  );

  const scrollToBottom = useCallback((_smooth = true) => {
    // Scroll logic is handled by ChatWindow.tsx
  }, []);

  const applyServerTyping = useCallback(
    (typingIds?: string[]) => {
      if (Array.isArray(typingIds) && typingIds.length > 0) {
        const otherTyping = typingIds.find((id) => id && id !== currentUserId);
        if (otherTyping) {
          setTypingUserId(otherTyping);
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = setTimeout(() => {
            setTypingUserId(null);
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
      setMessages(cached);
    } else {
      setLoading(true);
    }

    setError(null);

    try {
      const deletedSet = loadDeletedMsgIds(conversationId);
      const res = await fetch('/api/messages/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, candidateIds, userId: currentUserId }),
      });

      const json = res.ok ? await res.json() : null;
      if (json?.typingUserIds) {
        applyServerTyping(json.typingUserIds);
      }

      const rawMessages: any[] = Array.isArray(json?.messages)
        ? json.messages.filter((m: any) => m?.id && !deletedSet.has(m.id))
        : [];

      const isActivelyLooking =
        isViewingChatRef.current && (typeof document === 'undefined' || !document.hidden);

      const formattedRemoteMessages: Message[] = rawMessages.map((m: any) => ({
        ...m,
        is_read:
          m.sender_id === currentUserId
            ? Boolean(m.is_read)
            : Boolean(m.is_read) || isActivelyLooking,
      }));

      updateMessagesState((prev) => {
        const currentDeleted = loadDeletedMsgIds(conversationId);
        const remoteIdMap = new Map(
          formattedRemoteMessages
            .filter((m) => !currentDeleted.has(m.id))
            .map((m) => [m.id, m])
        );
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
    if (!conversationId || !currentUserId || messages.length === 0) return;

    const unreadMessages = messages.filter(
      (m) => m.sender_id !== currentUserId && !m.is_read
    );

    if (unreadMessages.length === 0) return;

    try {
      const unreadIds = unreadMessages.map((m) => m.id);

      updateMessagesState((prev) =>
        prev.map((msg) =>
          msg.sender_id !== currentUserId ? { ...msg, is_read: true } : msg
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

      await fetch('/api/messages/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
  }, [conversationId, currentUserId, messages, updateMessagesState]);

  const sendTypingSignal = useCallback(() => {
    if (!conversationId || !currentUserId) return;
    const now = Date.now();
    if (now - lastTypingEmitRef.current < 1200) return;
    lastTypingEmitRef.current = now;

    if (isFirebaseSessionActive(currentUserId)) {
      if (!conversationObj?.is_removed) {
        setDoc(doc(db, 'conversations', conversationId, 'typing', currentUserId), {
          userId: currentUserId,
          conversationId,
          expiresAt: Math.floor(now + 4000),
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }
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
  }, [conversationId, currentUserId, conversationObj?.is_removed]);

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
          const isActivelyLooking =
            isViewingChatRef.current && (typeof document === 'undefined' || !document.hidden);

          const remoteList: Message[] = [];
          snap.forEach((docSnap) => {
            if (deletedSet.has(docSnap.id)) return;
            const mapped = inboxMessageDocToMessage(docSnap.data());
            remoteList.push({
              ...mapped,
              is_read:
                mapped.sender_id === currentUserId
                  ? Boolean(mapped.is_read)
                  : Boolean(mapped.is_read) || isActivelyLooking,
            });
          });

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
      if (!conversationObj?.is_removed) {
        const peerIds: string[] = [];
        if (conversationObj?.other_member?.id && conversationObj.other_member.id !== currentUserId) {
          peerIds.push(conversationObj.other_member.id);
        } else if (Array.isArray(conversationObj?.member_ids)) {
          conversationObj.member_ids
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
      }

      return () => {
        unsubMsgs();
        typingUnsubs.forEach((u) => u());
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
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
          setTypingUserId(data.userId);
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = setTimeout(() => {
            setTypingUserId(null);
          }, 3000);
        } else if (data.type === 'messages_read' && data.readerId !== currentUserId) {
          updateMessagesState((prev) =>
            prev.map((msg) => (msg.sender_id === currentUserId ? { ...msg, is_read: true } : msg))
          );
        } else if (data.type === 'message_deleted' && data.messageId) {
          recordDeletedMsgId(conversationId, data.messageId);
          updateMessagesState((prev) => prev.filter((m) => m.id !== data.messageId));
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

          if (currentUserId && newMsg.sender_id !== currentUserId && isActivelyViewing) {
            markMessagesAsRead();
          }

          updateMessagesState((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [
              ...prev,
              {
                ...newMsg,
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

            updateMessagesState((prev) => {
              const currentDeleted = loadDeletedMsgIds(conversationId);
              const prevMap = new Map<string, Message>();
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
                      is_read: Boolean(existing.is_read || srvMsg.is_read),
                    });
                    hasChanged = true;
                  }
                  return;
                }

                const matchingEntry = Array.from(prevMap.values()).find(
                  (m) =>
                    m.sender_id === srvMsg.sender_id &&
                    m.content === srvMsg.content &&
                    Math.abs(new Date(m.created_at || 0).getTime() - new Date(srvMsg.created_at || 0).getTime()) < 45000
                );

                if (matchingEntry) {
                  prevMap.delete(matchingEntry.id);
                  prevMap.set(srvMsg.id, { ...matchingEntry, ...srvMsg });
                  hasChanged = true;
                } else {
                  prevMap.set(srvMsg.id, srvMsg);
                  hasChanged = true;
                }
              });

              if (!hasChanged && prev.length === prevMap.size) return prev;
              return Array.from(prevMap.values()).sort(
                (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
              );
            });
          }
        })
        .catch(() => {});
    }, 1200);

    return () => {
      clearInterval(pollInterval);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (msgBusRef.current) {
        msgBusRef.current.close();
        msgBusRef.current = null;
      }
    };
  }, [
    conversationId,
    currentUserId,
    conversationObj?.other_member?.id,
    conversationObj?.is_removed,
    conversationObj?.member_ids,
    getCandidateConvIds,
    scrollToBottom,
    updateMessagesState,
    markMessagesAsRead,
    applyServerTyping,
  ]);

  const sendMessage = async (
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
      Date.now() - lastSentContentRef.current.time < 1000
    ) {
      return false;
    }
    lastSentContentRef.current = { content: trimmed, time: Date.now() };

    setSending(true);
    setError(null);

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

    const nowIso = new Date().toISOString();
    const tempId = generateUUID();

    const optimisticMessage: Message = {
      id: tempId,
      conversation_id: conversationId,
      sender_id: currentUserId,
      content: processedContent,
      created_at: nowIso,
      updated_at: nowIso,
      sender: senderProfile,
      is_read: false,
    };

    updateMessagesState((prev) => [...prev, optimisticMessage]);

    const isGroup =
      conversationObj?.type === 'group' ||
      Boolean(conversationObj?.name) ||
      Boolean(conversationObj?.owner_id) ||
      Boolean((conversationObj as any)?.member_roles) ||
      !receiverId;

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
          isGroup,
          receiverId: isGroup ? undefined : receiverId,
          receiverProfile: isGroup ? undefined : receiverProfile,
          groupName: conversationObj?.name,
        });

        updateMessagesState((prev) =>
          prev.map((m) => (m.id === tempId ? savedMsg : m))
        );

        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('liveconnect_conversation_message', {
              detail: { conversationId, message: savedMsg },
            })
          );
        }
        return true;
      } catch (err: any) {
        updateMessagesState((prev) => prev.filter((m) => m.id !== tempId));
        setError(err?.message || 'Failed to send message.');
        return false;
      } finally {
        setSending(false);
      }
    }

    try {
      const relayRes = await fetch('/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: optimisticMessage,
          conversationId,
          isGroup,
          conversationType: isGroup ? 'group' : 'direct',
          groupName: conversationObj?.name,
          receiverId: isGroup ? undefined : receiverId,
          recipientId: isGroup ? undefined : receiverId,
          senderProfile,
          receiverProfile: isGroup ? undefined : receiverProfile,
        }),
      });

      if (relayRes.status === 403) {
        const errorData = await relayRes.json().catch(() => ({}));
        updateMessagesState((prev) => prev.filter((m) => m.id !== tempId));
        setError(errorData.error || 'Follow each other to start messaging.');
        return false;
      }

      if (!relayRes.ok) {
        const errorData = await relayRes.json().catch(() => ({}));
        setError(errorData.error || 'Failed to send message.');
        return false;
      }

      const data = await relayRes.json().catch(() => null);
      const savedMsg: Message = data?.message
        ? { ...optimisticMessage, ...data.message, sender: data.message.sender || senderProfile }
        : optimisticMessage;

      updateMessagesState((prev) =>
        prev.map((m) => (m.id === tempId ? savedMsg : m))
      );

      msgBusRef.current?.postMessage({
        type: 'new_message',
        conversationId,
        message: savedMsg,
      });

      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('liveconnect_conversation_message', {
            detail: { conversationId, message: savedMsg },
          })
        );
      }

      return true;
    } catch (err: any) {
      console.warn('Failed to commit message:', err.message);
      return true;
    } finally {
      setSending(false);
    }
  };

  // Delete a single message for EVERYONE
  const deleteMessage = async (messageId: string): Promise<boolean> => {
    if (!messageId) return false;

    try {
      const targetMsg = messages.find((m) => m.id === messageId);
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
  };

  // Clear all messages in the active conversation
  const clearAllMessages = async (): Promise<boolean> => {
    if (!conversationId) return false;

    try {
      const currentIds = messages.map((m) => m.id);
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
  };

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
