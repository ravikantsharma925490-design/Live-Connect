import { useState, useEffect, useCallback, useRef } from 'react';
import {
  collection,
  doc,
  getDoc,
  deleteDoc,
  query,
  orderBy,
  limit,
  onSnapshot,
} from 'firebase/firestore';
import { Conversation, Profile, Message } from '@/src/types';
import { notificationService } from '@/src/lib/notification-service';
import {
  db,
  auth,
  isFirebaseSessionActive,
  OperationType,
  handleFirestoreError,
} from '@/src/lib/firebase/client';
import {
  buildConversationFromDocs,
  fetchPublicProfileFs,
  fetchMultiplePublicProfilesFs,
  searchPublicProfilesFs,
  createOrGetDirectConversationFs,
  markMessagesAsReadFs,
} from '@/src/lib/firebase/services';
import { getAuthHeaders } from '@/src/lib/authHeader';

function getLocalConvCacheKey(userId?: string) {
  return `liveconnect_convs_${userId || 'anon'}`;
}

function getDeletedConvsKey(userId?: string) {
  return `liveconnect_deleted_convs_${userId || 'anon'}`;
}

function loadDeletedConvIds(userId?: string): Set<string> {
  if (typeof window === 'undefined' || !userId) return new Set();
  try {
    const raw = localStorage.getItem(getDeletedConvsKey(userId));
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return new Set(arr);
    }
  } catch {
    // ignore
  }
  return new Set();
}

export function recordDeletedConvId(userId: string | undefined, convId: string) {
  if (typeof window === 'undefined' || !userId || !convId) return;
  try {
    const existing = loadDeletedConvIds(userId);
    existing.add(convId);
    localStorage.setItem(getDeletedConvsKey(userId), JSON.stringify(Array.from(existing)));
  } catch {
    // ignore
  }
}

function unrecordDeletedConvId(userId: string | undefined, convId: string) {
  if (typeof window === 'undefined' || !userId || !convId) return;
  try {
    const existing = loadDeletedConvIds(userId);
    existing.delete(convId);
    localStorage.setItem(getDeletedConvsKey(userId), JSON.stringify(Array.from(existing)));
  } catch {
    // ignore
  }
}

function loadLocalConversations(userId?: string): Conversation[] {
  if (typeof window === 'undefined' || !userId) return [];
  try {
    const raw = localStorage.getItem(getLocalConvCacheKey(userId));
    if (raw) {
      const parsed = JSON.parse(raw) as Conversation[];
      if (Array.isArray(parsed)) {
        return cleanAndDeduplicateConversations(parsed, userId);
      }
    }
  } catch {
    // ignore
  }
  return [];
}

export function isLegacyGroupConversation(c: any): boolean {
  if (!c) return false;
  return (
    c.type === 'group' ||
    Boolean(c.name) ||
    Boolean(c.owner_id) ||
    Boolean(c.member_roles) ||
    (Array.isArray(c.member_ids) && c.member_ids.length > 2) ||
    (Array.isArray((c as any).members) && (c as any).members.length > 2)
  );
}

export function cleanAndDeduplicateConversations(convs: Conversation[], userId?: string): Conversation[] {
  if (!Array.isArray(convs) || convs.length === 0) return [];
  const deleted = loadDeletedConvIds(userId);

  const isDbUuid = (id: string | undefined): boolean => {
    return Boolean(
      id &&
        !id.startsWith('dm_') &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    );
  };

  const directByOtherId = new Map<string, Conversation>();

  for (const c of convs) {
    if (!c || !c.id || deleted.has(c.id) || isLegacyGroupConversation(c)) continue;

    let otherMemberId = c.other_member?.id;
    const rawMembers = (c as any).members;
    if (!otherMemberId && Array.isArray(rawMembers) && rawMembers.length > 0) {
      const other = rawMembers.find((m: any) => (m.user_id || m.id) !== userId);
      otherMemberId = other ? other.user_id || other.id : undefined;
    }
    if (!otherMemberId && Array.isArray((c as any).member_ids)) {
      const other = (c as any).member_ids.find((id: string) => id !== userId);
      if (other) otherMemberId = other;
    }
    if (!otherMemberId && (c as any).members_meta) {
      const other = Object.keys((c as any).members_meta).find((id: string) => id !== userId);
      if (other) otherMemberId = other;
    }
    if (!otherMemberId && typeof c.id === 'string' && c.id.startsWith('dm_')) {
      const parts = c.id.replace('dm_', '').split('_');
      const other = parts.find((p) => p !== userId);
      if (other) otherMemberId = other;
    }

    const isDirect = Boolean(otherMemberId);

    if (isDirect && otherMemberId) {
      const canonicalId = userId ? getDeterministicDirectConvId(userId, otherMemberId) : c.id;
      const existing = directByOtherId.get(otherMemberId);

      let chosenId = c.id;
      if (existing) {
        if (isDbUuid(existing.id)) {
          chosenId = existing.id;
        } else if (isDbUuid(c.id)) {
          chosenId = c.id;
        } else {
          chosenId = existing.id || canonicalId;
        }
      } else {
        chosenId = isDbUuid(c.id) ? c.id : canonicalId;
      }

      const existingAliasIds: string[] = (existing as any)?.alias_ids || [];
      const currentAliasIds: string[] = (c as any)?.alias_ids || [];
      const combinedAliases = Array.from(
        new Set([c.id, canonicalId, chosenId, ...existingAliasIds, ...currentAliasIds].filter(Boolean))
      );

      const dbOrigId = isDbUuid(chosenId)
        ? chosenId
        : isDbUuid(c.id)
        ? c.id
        : isDbUuid(existing?.id)
        ? existing?.id
        : undefined;

      if (!existing) {
        directByOtherId.set(otherMemberId, {
          ...c,
          id: chosenId,
          original_id: dbOrigId,
          canonical_id: canonicalId,
          alias_ids: combinedAliases,
        } as any);
      } else {
        const existingTime = Math.max(
          new Date(existing.updated_at || 0).getTime(),
          new Date(existing.last_message?.created_at || 0).getTime()
        );
        const cTime = Math.max(
          new Date(c.updated_at || 0).getTime(),
          new Date(c.last_message?.created_at || 0).getTime()
        );

        const newestLastMsg =
          cTime >= existingTime ? c.last_message || existing.last_message : existing.last_message || c.last_message;
        const newestUpdatedAt =
          cTime >= existingTime ? c.updated_at || existing.updated_at : existing.updated_at || c.updated_at;

        directByOtherId.set(otherMemberId, {
          ...existing,
          ...c,
          id: chosenId,
          original_id: dbOrigId,
          canonical_id: canonicalId,
          alias_ids: combinedAliases,
          other_member: c.other_member || existing.other_member,
          last_message: newestLastMsg,
          updated_at: newestUpdatedAt,
          unread_count: Math.max(existing.unread_count || 0, c.unread_count || 0),
        } as any);
      }
    }
  }

  return Array.from(directByOtherId.values()).sort((a, b) => {
    const timeA = Math.max(new Date(a.updated_at || 0).getTime(), new Date(a.last_message?.created_at || 0).getTime());
    const timeB = Math.max(new Date(b.updated_at || 0).getTime(), new Date(b.last_message?.created_at || 0).getTime());
    return timeB - timeA;
  });
}

function saveLocalConversations(userId: string | undefined, convs: Conversation[]) {
  if (typeof window === 'undefined' || !userId) return;
  try {
    const clean = cleanAndDeduplicateConversations(convs, userId);
    localStorage.setItem(getLocalConvCacheKey(userId), JSON.stringify(clean));
  } catch {
    // ignore
  }
}

export function getDeterministicDirectConvId(userA: string, userB: string): string {
  const sorted = [userA || '', userB || ''].sort().join(':');
  let h1 = 0x811c9dc5,
    h2 = 0x811c9dc5,
    h3 = 0x811c9dc5,
    h4 = 0x811c9dc5;
  for (let i = 0; i < sorted.length; i++) {
    const code = sorted.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ (code + i), 2246822507) >>> 0;
    h3 = Math.imul(h3 ^ ((code << 3) + i), 3266489909) >>> 0;
    h4 = Math.imul(h4 ^ ((code << 5) + i), 1597334677) >>> 0;
  }
  h1 = (Math.imul(h1 ^ (h3 >>> 15), 2246822507) ^ h4) >>> 0;
  h2 = (Math.imul(h2 ^ (h4 >>> 13), 3266489909) ^ h1) >>> 0;
  h3 = (Math.imul(h3 ^ (h1 >>> 16), 1597334677) ^ h2) >>> 0;
  h4 = (Math.imul(h4 ^ (h2 >>> 11), 2654435761) ^ h3) >>> 0;

  const hex1 = h1.toString(16).padStart(8, '0');
  const hex2 = (h2 & 0xffff).toString(16).padStart(4, '0');
  const hex3 = '4' + ((h2 >>> 16) & 0x0fff).toString(16).padStart(3, '0');
  const hex4 = (0x8 | ((h3 >>> 28) & 0x3)).toString(16) + (h3 & 0x0fff).toString(16).padStart(3, '0');
  const hex5 = h4.toString(16).padStart(8, '0') + ((h3 >>> 12) & 0xffff).toString(16).padStart(4, '0');

  return `${hex1}-${hex2}-${hex3}-${hex4}-${hex5}`.toLowerCase();
}

export function useConversations(currentUserId?: string, activeTab: string = 'messages') {
  const [conversations, setConversations] = useState<Conversation[]>(() =>
    loadLocalConversations(currentUserId)
  );
  const [loading, setLoading] = useState<boolean>(() => loadLocalConversations(currentUserId).length === 0);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(() => {
    if (typeof window !== 'undefined' && currentUserId) {
      if (window.innerWidth >= 768) {
        return localStorage.getItem(`liveconnect_active_conv_${currentUserId}`) || null;
      }
    }
    return null;
  });

  const activeTabRef = useRef<string>(activeTab);
  activeTabRef.current = activeTab;

  const convRef = useRef<Conversation[]>(conversations);
  convRef.current = conversations;

  const activeConvIdRef = useRef<string | null>(activeConversationId);
  activeConvIdRef.current = activeConversationId;

  const knownLastMsgIdsRef = useRef<Record<string, string>>({});
  const initialSyncDoneRef = useRef<boolean>(false);
  const msgBusRef = useRef<BroadcastChannel | null>(null);
  const profileCacheRef = useRef<Record<string, Profile>>({});

  useEffect(() => {
    if (typeof window !== 'undefined' && currentUserId) {
      if (activeConversationId) {
        localStorage.setItem(`liveconnect_active_conv_${currentUserId}`, activeConversationId);
      }
    }
  }, [activeConversationId, currentUserId]);

  const updateConversationsState = useCallback(
    (updater: Conversation[] | ((prev: Conversation[]) => Conversation[])) => {
      setConversations((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        const clean = cleanAndDeduplicateConversations(next, currentUserId);

        if (prev.length === clean.length) {
          const isIdentical = clean.every(
            (c, i) =>
              prev[i].id === c.id &&
              prev[i].unread_count === c.unread_count &&
              prev[i].last_message?.id === c.last_message?.id &&
              prev[i].updated_at === c.updated_at &&
              (prev[i].member_ids?.length || 0) === (c.member_ids?.length || 0)
          );
          if (isIdentical) {
            saveLocalConversations(currentUserId, prev);
            return prev;
          }
        }

        saveLocalConversations(currentUserId, clean);
        return clean;
      });
    },
    [currentUserId]
  );

  // Mark all unread messages in a conversation as read and zero out unread_count
  const markConversationAsRead = useCallback(
    async (conversationId: string) => {
      if (!conversationId || !currentUserId) return;

      updateConversationsState((prev) =>
        prev.map((c) => (c.id === conversationId ? { ...c, unread_count: 0 } : c))
      );

      if (isFirebaseSessionActive(currentUserId)) {
        await markMessagesAsReadFs(conversationId, currentUserId).catch(() => {});
        return;
      }

      try {
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
      } catch (err: any) {
        console.warn('Notice marking conversation as read:', err.message);
      }
    },
    [currentUserId, updateConversationsState]
  );

  const hydrateAndApplyConversations = useCallback(
    (rawConvs: Conversation[]) => {
      const deletedIds = loadDeletedConvIds(currentUserId);
      const isActivelyViewing = (convId: string) => {
        return (
          typeof document !== 'undefined' &&
          !document.hidden &&
          activeTabRef.current === 'messages' &&
          activeConvIdRef.current === convId
        );
      };

      const combinedMap = new Map<string, Conversation>();
      rawConvs
        .filter((c) => !deletedIds.has(c.id) && !isLegacyGroupConversation(c))
        .forEach((c) => {
          const isViewing = isActivelyViewing(c.id);
          const uCount = isViewing ? 0 : c.unread_count || 0;
          combinedMap.set(c.id, { ...c, unread_count: uCount });

          if (c.last_message?.id) {
            const prevKnownId = knownLastMsgIdsRef.current[c.id];
            if (
              initialSyncDoneRef.current &&
              prevKnownId !== c.last_message.id &&
              c.last_message.sender_id !== currentUserId
            ) {
              if (isViewing) {
                markConversationAsRead(c.id);
              } else {
                notificationService.sendNotification({
                  title: c.other_member?.display_name || 'New LiveConnect Message',
                  body: c.last_message.content || 'You have received a new message.',
                  tag: `msg-${c.id}`,
                  onClick: () => {
                    setActiveConversationId(c.id);
                  },
                });
              }
            }
            knownLastMsgIdsRef.current[c.id] = c.last_message.id;
          }
        });

      initialSyncDoneRef.current = true;

      updateConversationsState((prev) => {
        prev.forEach((localConv) => {
          if (!deletedIds.has(localConv.id) && !combinedMap.has(localConv.id)) {
            const ageMs = Date.now() - new Date(localConv.updated_at || localConv.created_at || 0).getTime();
            if (ageMs < 30000 && !localConv.last_message) {
              const uCount = isActivelyViewing(localConv.id) ? 0 : localConv.unread_count || 0;
              combinedMap.set(localConv.id, { ...localConv, unread_count: uCount });
            }
          }
        });

        return Array.from(combinedMap.values())
          .map((c) => (isActivelyViewing(c.id) ? { ...c, unread_count: 0 } : c))
          .sort((a, b) => {
            const timeA = Math.max(
              new Date(a.updated_at || 0).getTime(),
              new Date(a.last_message?.created_at || 0).getTime()
            );
            const timeB = Math.max(
              new Date(b.updated_at || 0).getTime(),
              new Date(b.last_message?.created_at || 0).getTime()
            );
            return timeB - timeA;
          });
      });
    },
    [currentUserId, markConversationAsRead, updateConversationsState]
  );

  const fetchConversations = useCallback(async () => {
    if (!currentUserId) {
      setLoading(false);
      return;
    }

    if (isFirebaseSessionActive(currentUserId)) {
      return;
    }

    const deletedIds = loadDeletedConvIds(currentUserId);

    try {
      let serverConvs: Conversation[] = [];
      try {
        const srvRes = await fetch('/api/conversations/list', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId }),
        });
        if (srvRes.ok) {
          const srvData = await srvRes.json();
          if (Array.isArray(srvData.conversations)) {
            serverConvs = srvData.conversations.filter((c: Conversation) => !deletedIds.has(c.id));
          }
        }
      } catch {
        // server fetch fallback
      }

      // Check local message caches for any even newer message
      serverConvs.forEach((conv) => {
        try {
          const raw = localStorage.getItem(`liveconnect_msgs_${conv.id}`);
          if (raw) {
            const localMsgs = JSON.parse(raw);
            if (Array.isArray(localMsgs) && localMsgs.length > 0) {
              const sorted = [...localMsgs].sort(
                (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
              );
              const newestLocal = sorted[0];
              if (newestLocal) {
                const currentLastTime = new Date(conv.last_message?.created_at || 0).getTime();
                const localLastTime = new Date(newestLocal.created_at || 0).getTime();
                if (localLastTime > currentLastTime) {
                  conv.last_message = newestLocal;
                  if (localLastTime > new Date(conv.updated_at || 0).getTime()) {
                    conv.updated_at = newestLocal.created_at;
                  }
                }
              }
            }
          }
        } catch {
          // ignore
        }
      });

      hydrateAndApplyConversations(serverConvs);
    } catch (err: any) {
      console.warn('Error fetching conversations:', err.message);
    } finally {
      setLoading(false);
    }
  }, [currentUserId, hydrateAndApplyConversations]);

  useEffect(() => {
    if (!currentUserId) return;

    knownLastMsgIdsRef.current = {};
    initialSyncDoneRef.current = false;

    if (isFirebaseSessionActive(currentUserId)) {
      const inboxQuery = query(
        collection(db, 'users', currentUserId, 'inbox'),
        orderBy('updatedAt', 'desc'),
        limit(60)
      );

      const unsub = onSnapshot(
        inboxQuery,
        async (snap) => {
          try {
            const inboxEntries: { id: string; data: Record<string, any> }[] = [];
            snap.forEach((docSnap) => {
              const d = docSnap.data();
              if (d?.type !== 'group' && !docSnap.id.startsWith('grp_')) {
                inboxEntries.push({ id: docSnap.id, data: d });
              }
            });

            const convDocs: Record<string, Record<string, any> | null> = {};
            const neededProfileIds = new Set<string>();

            await Promise.all(
              inboxEntries.map(async ({ id, data }) => {
                if (data.otherMemberId) neededProfileIds.add(data.otherMemberId);
                try {
                  const cSnap = await getDoc(doc(db, 'conversations', id));
                  if (cSnap.exists()) {
                    const cData = cSnap.data();
                    convDocs[id] = cData;
                    Object.keys(cData.memberRoles || {}).forEach((uid) => neededProfileIds.add(uid));
                  } else {
                    convDocs[id] = null;
                  }
                } catch {
                  convDocs[id] = null;
                }
              })
            );

            // Hydrate any uncached participant profiles
            const missingIds = Array.from(neededProfileIds).filter((uid) => !profileCacheRef.current[uid]);
            if (missingIds.length > 0) {
              const fetched = await fetchMultiplePublicProfilesFs(missingIds);
              Object.assign(profileCacheRef.current, fetched);
            }

            const builtConvs: Conversation[] = inboxEntries
              .filter(({ id }) => convDocs[id]?.type !== 'group')
              .map(({ id, data }) =>
                buildConversationFromDocs(id, data, convDocs[id], profileCacheRef.current)
              );

            hydrateAndApplyConversations(builtConvs);
          } finally {
            setLoading(false);
          }
        },
        (err) => {
          if (!auth.currentUser) return;
          handleFirestoreError(err, OperationType.LIST, `users/${currentUserId}/inbox`);
        }
      );

      // Listen for local optimistic events (like call logs inserted while chat open)
      const handleLocalConvMessage = (e: any) => {
        const detail = e.detail;
        if (!detail?.conversationId || !detail?.message) return;
        const newMsg = detail.message as Message;
        updateConversationsState((prev) =>
          prev.map((c) =>
            c.id === newMsg.conversation_id
              ? { ...c, updated_at: newMsg.created_at, last_message: newMsg }
              : c
          )
        );
      };
      window.addEventListener('liveconnect_conversation_message', handleLocalConvMessage);

      return () => {
        unsub();
        window.removeEventListener('liveconnect_conversation_message', handleLocalConvMessage);
      };
    }

    fetchConversations();

    if (typeof BroadcastChannel !== 'undefined') {
      const bus = new BroadcastChannel('liveconnect_messages_sync');
      msgBusRef.current = bus;
      bus.onmessage = (event) => {
        const data = event.data;
        if (!data) return;
        if (data.type === 'new_message' && data.message) {
          const newMsg = data.message as Message;
          const isFromOther = newMsg.sender_id !== currentUserId;
          const isViewing =
            typeof document !== 'undefined' &&
            !document.hidden &&
            activeTabRef.current === 'messages' &&
            activeConvIdRef.current === newMsg.conversation_id;

          if (isViewing) {
            markConversationAsRead(newMsg.conversation_id);
          }

          updateConversationsState((prev) => {
            const exists = prev.some((c) => c.id === newMsg.conversation_id);
            if (!exists) {
              fetchConversations();
              return prev;
            }
            return prev
              .map((c) =>
                c.id === newMsg.conversation_id
                  ? {
                      ...c,
                      updated_at: newMsg.created_at,
                      last_message: newMsg,
                      unread_count: isViewing
                        ? 0
                        : isFromOther
                        ? (c.unread_count || 0) + 1
                        : c.unread_count || 0,
                    }
                  : c
              )
              .sort(
                (a, b) =>
                  Math.max(new Date(b.updated_at || 0).getTime(), new Date(b.last_message?.created_at || 0).getTime()) -
                  Math.max(new Date(a.updated_at || 0).getTime(), new Date(a.last_message?.created_at || 0).getTime())
              );
          });
        } else {
          fetchConversations();
        }
      };
    }

    const pollInterval = setInterval(() => {
      fetchConversations();
    }, 1200);

    const handleLocalConvMessage = (e: any) => {
      const detail = e.detail;
      if (!detail?.conversationId || !detail?.message) return;
      const newMsg = detail.message as Message;
      const isFromOther = newMsg.sender_id !== currentUserId;
      const isViewing =
        typeof document !== 'undefined' &&
        !document.hidden &&
        activeTabRef.current === 'messages' &&
        activeConvIdRef.current === newMsg.conversation_id;

      updateConversationsState((prev) => {
        const exists = prev.some((c) => c.id === newMsg.conversation_id);
        if (!exists) {
          fetchConversations();
          return prev;
        }
        return prev
          .map((c) => {
            if (c.id === newMsg.conversation_id) {
              return {
                ...c,
                updated_at: newMsg.created_at,
                last_message: newMsg,
                unread_count: isViewing
                  ? 0
                  : isFromOther
                  ? (c.unread_count || 0) + 1
                  : c.unread_count || 0,
              };
            }
            return c;
          })
          .sort((a, b) => {
            const timeA = Math.max(
              new Date(a.updated_at || 0).getTime(),
              new Date(a.last_message?.created_at || 0).getTime()
            );
            const timeB = Math.max(
              new Date(b.updated_at || 0).getTime(),
              new Date(b.last_message?.created_at || 0).getTime()
            );
            return timeB - timeA;
          });
      });
    };

    window.addEventListener('liveconnect_conversation_message', handleLocalConvMessage);

    return () => {
      window.removeEventListener('liveconnect_conversation_message', handleLocalConvMessage);
      clearInterval(pollInterval);
      if (msgBusRef.current) {
        msgBusRef.current.close();
        msgBusRef.current = null;
      }
    };
  }, [currentUserId, fetchConversations, hydrateAndApplyConversations, updateConversationsState, markConversationAsRead]);

  // Search users by ID, username, or display_name
  const searchUsers = useCallback(
    async (queryText: string): Promise<Profile[]> => {
      const cleanQuery = queryText.trim().replace(/^@/, '');
      if (!currentUserId || !cleanQuery) return [];

      if (isFirebaseSessionActive(currentUserId)) {
        try {
          return await searchPublicProfilesFs(cleanQuery, currentUserId);
        } catch (err: any) {
          console.warn('Firestore user search error:', err?.message);
          return [];
        }
      }

      try {
        const authHeaders = await getAuthHeaders();
        const res = await fetch('/api/users/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ query: cleanQuery, userId: currentUserId }),
        });
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data.users) ? (data.users as Profile[]) : [];
      } catch (err: any) {
        console.warn('User search error:', err.message);
        return [];
      }
    },
    [currentUserId]
  );

  // Start or open a direct conversation with target user
  const startConversation = async (targetUserId: string, targetProfileData?: Profile): Promise<string | null> => {
    if (!currentUserId) return null;
    const isSelfChat = targetUserId === currentUserId;

    try {
      const newConvId = isSelfChat
        ? getDeterministicDirectConvId(currentUserId, currentUserId)
        : getDeterministicDirectConvId(currentUserId, targetUserId);

      unrecordDeletedConvId(currentUserId, newConvId);

      if (isFirebaseSessionActive(currentUserId)) {
        const resolvedTargetProf = isSelfChat
          ? await fetchPublicProfileFs(currentUserId)
          : targetProfileData || (await fetchPublicProfileFs(targetUserId, currentUserId));

        if (!isSelfChat && !resolvedTargetProf) {
          return null;
        }

        const targetProf = resolvedTargetProf || {
          id: targetUserId,
          username: isSelfChat ? 'self' : 'user',
          display_name: isSelfChat ? 'Note to Self (You)' : 'User',
          avatar_url: null,
          bio: null,
          is_online: true,
          last_seen: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        const myProf = (await fetchPublicProfileFs(currentUserId)) || {
          id: currentUserId,
          username: 'user',
          display_name: 'User',
          avatar_url: null,
          bio: null,
          is_online: true,
          last_seen: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        const conv = await createOrGetDirectConversationFs(newConvId, myProf, targetProf);
        updateConversationsState((prev) =>
          cleanAndDeduplicateConversations([conv, ...prev], currentUserId)
        );
        setActiveConversationId(newConvId);
        return newConvId;
      }

      let targetProfile = targetProfileData;
      if (!targetProfile) {
        try {
          const authHeaders = await getAuthHeaders();
          const profRes = await fetch(
            `/api/users/profile/${encodeURIComponent(targetUserId)}?viewerId=${encodeURIComponent(currentUserId)}`,
            { headers: authHeaders }
          );
          if (profRes.status === 404 || profRes.status === 403) {
            return null;
          }
          if (profRes.ok) {
            const profJson = await profRes.json();
            if (profJson?.profile) {
              targetProfile = profJson.profile as Profile;
            }
          }
        } catch {
          // ignore
        }
      }

      const optimisticConv: Conversation = {
        id: newConvId,
        type: 'direct',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        other_member: targetProfile || {
          id: targetUserId,
          username: isSelfChat ? 'self' : 'user',
          display_name: isSelfChat ? 'Note to Self (You)' : 'User',
          avatar_url: null,
          bio: null,
          is_online: true,
          last_seen: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        last_message: undefined,
        unread_count: 0,
      };

      updateConversationsState((prev) => [
        optimisticConv,
        ...prev.filter((c) => c.id !== newConvId && c.other_member?.id !== targetUserId),
      ]);
      setActiveConversationId(newConvId);

      const res = await fetch('/api/conversations/create-or-get', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          targetUserId,
          targetProfile,
        }),
      }).catch(() => null);

      if (res && res.ok) {
        const data = await res.json();
        if (data?.conversation) {
          updateConversationsState((prev) =>
            cleanAndDeduplicateConversations([data.conversation, ...prev], currentUserId)
          );
        }
      }

      setTimeout(() => {
        fetchConversations();
      }, 300);

      return newConvId;
    } catch (err: any) {
      console.error('Error starting conversation:', err.message);
      return null;
    }
  };

  useEffect(() => {
    if (activeConversationId && activeTab === 'messages') {
      if (typeof document === 'undefined' || !document.hidden) {
        markConversationAsRead(activeConversationId);
      }
    }
  }, [activeConversationId, activeTab, markConversationAsRead]);

  useEffect(() => {
    const handleFocus = () => {
      if (
        document.visibilityState === 'visible' &&
        activeConvIdRef.current &&
        activeTabRef.current === 'messages'
      ) {
        markConversationAsRead(activeConvIdRef.current);
      }
    };
    document.addEventListener('visibilitychange', handleFocus);
    window.addEventListener('focus', handleFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleFocus);
      window.removeEventListener('focus', handleFocus);
    };
  }, [markConversationAsRead]);

  // Delete conversation completely
  const deleteConversation = async (conversationId: string): Promise<boolean> => {
    if (!conversationId) return false;

    const targetConv = conversations.find((c) => c.id === conversationId);
    const otherMemberId = targetConv?.other_member?.id;
    const canonicalId =
      currentUserId && otherMemberId ? getDeterministicDirectConvId(currentUserId, otherMemberId) : null;

    try {
      recordDeletedConvId(currentUserId, conversationId);
      if (canonicalId) recordDeletedConvId(currentUserId, canonicalId);

      updateConversationsState((prev) =>
        prev.filter(
          (c) =>
            c.id !== conversationId &&
            (!canonicalId || c.id !== canonicalId) &&
            (!otherMemberId || c.other_member?.id !== otherMemberId)
        )
      );
      if (activeConversationId === conversationId || activeConversationId === canonicalId) {
        setActiveConversationId(null);
        if (typeof window !== 'undefined' && currentUserId) {
          localStorage.removeItem(`liveconnect_active_conv_${currentUserId}`);
        }
      }
      if (typeof window !== 'undefined') {
        localStorage.removeItem(`liveconnect_msgs_${conversationId}`);
        localStorage.removeItem(`liveconnect_deleted_ids_${conversationId}`);
        if (canonicalId) {
          localStorage.removeItem(`liveconnect_msgs_${canonicalId}`);
          localStorage.removeItem(`liveconnect_deleted_ids_${canonicalId}`);
        }
      }

      if (isFirebaseSessionActive(currentUserId) && currentUserId) {
        await deleteDoc(doc(db, 'users', currentUserId, 'inbox', conversationId)).catch(() => {});
        if (canonicalId && canonicalId !== conversationId) {
          await deleteDoc(doc(db, 'users', currentUserId, 'inbox', canonicalId)).catch(() => {});
        }
        return true;
      }

      await fetch('/api/conversations/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, userId: currentUserId }),
      }).catch(() => {});

      if (canonicalId && canonicalId !== conversationId) {
        await fetch('/api/conversations/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId: canonicalId, userId: currentUserId }),
        }).catch(() => {});
      }

      return true;
    } catch (err: any) {
      console.error('Error deleting conversation:', err.message);
      return false;
    }
  };

  const activeConversation = conversations.find((c) => c.id === activeConversationId) || null;

  const updateConversation = useCallback(
    (updatedConv: Conversation) => {
      if (!updatedConv || !updatedConv.id) return;
      updateConversationsState((prev) => {
        const idx = prev.findIndex((c) => c.id === updatedConv.id);
        if (idx !== -1) {
          const next = [...prev];
          next[idx] = { ...next[idx], ...updatedConv };
          return next;
        }
        return [updatedConv, ...prev];
      });
    },
    [updateConversationsState]
  );

  return {
    conversations,
    loading,
    activeConversationId,
    activeConversation,
    setActiveConversationId,
    fetchConversations,
    searchUsers,
    startConversation,
    deleteConversation,
    markConversationAsRead,
    updateConversation,
  };
}
