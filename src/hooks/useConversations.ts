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
import { getDeterministicDirectConvId } from '@/src/lib/utils';

export { getDeterministicDirectConvId };

function getLocalConvCacheKey(userId?: string) {
  return `liveconnect_convs_${userId || 'anon'}`;
}

function getDeletedConvsKey(userId?: string) {
  return `liveconnect_deleted_convs_${userId || 'anon'}`;
}

function loadDeletedConvMap(userId?: string): Record<string, number> {
  if (typeof window === 'undefined' || !userId) return {};
  try {
    const raw = localStorage.getItem(getDeletedConvsKey(userId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const map: Record<string, number> = {};
        parsed.forEach((id) => {
          if (typeof id === 'string') map[id] = 0;
        });
        return map;
      }
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, number>;
      }
    }
  } catch {
    // ignore
  }
  return {};
}

function loadDeletedConvIds(userId?: string): Set<string> {
  return new Set(Object.keys(loadDeletedConvMap(userId)));
}

function isConvDeletedForUser(conv: Conversation, deletedMap: Record<string, number>): boolean {
  if (!conv?.id || !(conv.id in deletedMap)) return false;
  const deletedAt = deletedMap[conv.id] || 0;
  if (!deletedAt) return true;
  const lastMsgAt = conv.last_message?.created_at ? new Date(conv.last_message.created_at).getTime() : 0;
  const convUpdatedAt = conv.updated_at ? new Date(conv.updated_at).getTime() : 0;
  if (lastMsgAt > deletedAt || convUpdatedAt > deletedAt + 500) {
    return false;
  }
  return true;
}

export function recordDeletedConvId(userId: string | undefined, convId: string) {
  if (typeof window === 'undefined' || !userId || !convId) return;
  try {
    const existing = loadDeletedConvMap(userId);
    existing[convId] = Date.now();
    localStorage.setItem(getDeletedConvsKey(userId), JSON.stringify(existing));
  } catch {
    // ignore
  }
}

function unrecordDeletedConvId(userId: string | undefined, convId: string) {
  if (typeof window === 'undefined' || !userId || !convId) return;
  try {
    const existing = loadDeletedConvMap(userId);
    if (convId in existing) {
      delete existing[convId];
      localStorage.setItem(getDeletedConvsKey(userId), JSON.stringify(existing));
    }
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
  const deletedMap = loadDeletedConvMap(userId);

  const isDbUuid = (id: string | undefined): boolean => {
    return Boolean(
      id &&
        !id.startsWith('dm_') &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    );
  };

  const directByOtherId = new Map<string, Conversation>();

  for (const c of convs) {
    if (!c || !c.id || isLegacyGroupConversation(c)) continue;
    if (c.id in deletedMap) {
      if (isConvDeletedForUser(c, deletedMap)) continue;
      unrecordDeletedConvId(userId, c.id);
    }

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

export function useConversations(
  currentUserId?: string,
  activeTab: string = 'messages',
  currentUserProfile?: Profile | null
) {
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
      } catch (err: any) {
        console.warn('Notice marking conversation as read:', err.message);
      }
    },
    [currentUserId, updateConversationsState]
  );

  const hydrateAndApplyConversations = useCallback(
    (rawConvs: Conversation[]) => {
      const deletedMap = loadDeletedConvMap(currentUserId);
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
        .filter((c) => {
          if (isLegacyGroupConversation(c)) return false;
          if (isConvDeletedForUser(c, deletedMap)) return false;
          if (c.id in deletedMap) unrecordDeletedConvId(currentUserId, c.id);
          return true;
        })
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
          if (!isConvDeletedForUser(localConv, deletedMap) && !combinedMap.has(localConv.id)) {
            const ageMs = Date.now() - new Date(localConv.updated_at || localConv.created_at || 0).getTime();
            const isCurrentlyActive = localConv.id === activeConvIdRef.current;
            if (isCurrentlyActive || (ageMs < 300000 && !localConv.last_message)) {
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

    const deletedMap = loadDeletedConvMap(currentUserId);

    try {
      let serverConvs: Conversation[] = [];
      try {
        const authHeaders = await getAuthHeaders();
        const srvRes = await fetch('/api/conversations/list', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ userId: currentUserId }),
        });
        if (srvRes.ok) {
          const srvData = await srvRes.json();
          if (Array.isArray(srvData.conversations)) {
            serverConvs = srvData.conversations.filter((c: Conversation) => {
              if (isConvDeletedForUser(c, deletedMap)) return false;
              if (c.id in deletedMap) unrecordDeletedConvId(currentUserId, c.id);
              return true;
            });
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

      // Listen for local optimistic events (like sent messages or call logs inserted while chat open)
      const handleLocalConvMessage = (e: any) => {
        const detail = e.detail;
        if (!detail?.conversationId || !detail?.message) return;
        const newMsg = detail.message as Message;
        const convId = detail.conversationId || newMsg.conversation_id;
        unrecordDeletedConvId(currentUserId, convId);
        updateConversationsState((prev) => {
          const exists = prev.some((c) => c.id === convId);
          if (exists) {
            return prev.map((c) =>
              c.id === convId
                ? {
                    ...c,
                    updated_at: newMsg.created_at,
                    last_message: newMsg,
                  }
                : c
            );
          }
          if (detail.conversation) {
            return cleanAndDeduplicateConversations(
              [{ ...detail.conversation, last_message: newMsg, updated_at: newMsg.created_at }, ...prev],
              currentUserId
            );
          }
          if (detail.receiverProfile || detail.receiverId) {
            const synthesized: Conversation = {
              id: convId,
              type: 'direct',
              created_at: newMsg.created_at,
              updated_at: newMsg.created_at,
              other_member: detail.receiverProfile || {
                id: detail.receiverId,
                username: 'user',
                display_name: 'User',
                avatar_url: null,
                bio: null,
                is_online: false,
                last_seen: newMsg.created_at,
                created_at: newMsg.created_at,
                updated_at: newMsg.created_at,
              },
              last_message: newMsg,
              unread_count: 0,
            };
            return cleanAndDeduplicateConversations([synthesized, ...prev], currentUserId);
          }
          return prev;
        });
      };
      window.addEventListener('liveconnect_conversation_message', handleLocalConvMessage);

      const handleLocalConvCreated = (e: any) => {
        const detail = e.detail;
        const conv = detail?.conversation as Conversation | undefined;
        const convId = detail?.conversationId || conv?.id;
        if (!convId && !detail?.targetUserId) return;
        const resolvedId = convId || getDeterministicDirectConvId(currentUserId, detail.targetUserId);
        unrecordDeletedConvId(currentUserId, resolvedId);
        const nowIso = new Date().toISOString();
        const convToAdd: Conversation = conv || {
          id: resolvedId,
          type: 'direct',
          created_at: nowIso,
          updated_at: nowIso,
          other_member: detail.targetProfile || {
            id: detail.targetUserId,
            username: 'user',
            display_name: 'User',
            avatar_url: null,
            bio: null,
            is_online: false,
            last_seen: nowIso,
            created_at: nowIso,
            updated_at: nowIso,
          },
          unread_count: 0,
          member_ids: [currentUserId, detail.targetUserId].filter(Boolean),
        };
        updateConversationsState((prev) =>
          cleanAndDeduplicateConversations([convToAdd, ...prev], currentUserId)
        );
      };
      window.addEventListener('liveconnect_conversation_created', handleLocalConvCreated);

      return () => {
        unsub();
        window.removeEventListener('liveconnect_conversation_message', handleLocalConvMessage);
        window.removeEventListener('liveconnect_conversation_created', handleLocalConvCreated);
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
              if (data.conversation) {
                return cleanAndDeduplicateConversations(
                  [{ ...data.conversation, last_message: newMsg, updated_at: newMsg.created_at }, ...prev],
                  currentUserId
                );
              }
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
      const convId = detail.conversationId || newMsg.conversation_id;
      unrecordDeletedConvId(currentUserId, convId);
      const isFromOther = newMsg.sender_id !== currentUserId;
      const isViewing =
        typeof document !== 'undefined' &&
        !document.hidden &&
        activeTabRef.current === 'messages' &&
        activeConvIdRef.current === convId;

      updateConversationsState((prev) => {
        const exists = prev.some((c) => c.id === convId);
        if (!exists) {
          fetchConversations();
          if (detail.conversation) {
            return cleanAndDeduplicateConversations(
              [{ ...detail.conversation, last_message: newMsg, updated_at: newMsg.created_at }, ...prev],
              currentUserId
            );
          }
          if (detail.receiverProfile || detail.receiverId) {
            const synthesized: Conversation = {
              id: convId,
              type: 'direct',
              created_at: newMsg.created_at,
              updated_at: newMsg.created_at,
              other_member: detail.receiverProfile || {
                id: detail.receiverId,
                username: 'user',
                display_name: 'User',
                avatar_url: null,
                bio: null,
                is_online: false,
                last_seen: newMsg.created_at,
                created_at: newMsg.created_at,
                updated_at: newMsg.created_at,
              },
              last_message: newMsg,
              unread_count: isViewing ? 0 : isFromOther ? 1 : 0,
            };
            return cleanAndDeduplicateConversations([synthesized, ...prev], currentUserId);
          }
          return prev;
        }
        return prev
          .map((c) => {
            if (c.id === convId) {
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

    const handleLocalConvCreated = (e: any) => {
      const detail = e.detail;
      const conv = detail?.conversation as Conversation | undefined;
      const convId = detail?.conversationId || conv?.id;
      if (!convId && !detail?.targetUserId) return;
      const resolvedId = convId || getDeterministicDirectConvId(currentUserId, detail.targetUserId);
      unrecordDeletedConvId(currentUserId, resolvedId);
      const nowIso = new Date().toISOString();
      const convToAdd: Conversation = conv || {
        id: resolvedId,
        type: 'direct',
        created_at: nowIso,
        updated_at: nowIso,
        other_member: detail.targetProfile || {
          id: detail.targetUserId,
          username: 'user',
          display_name: 'User',
          avatar_url: null,
          bio: null,
          is_online: false,
          last_seen: nowIso,
          created_at: nowIso,
          updated_at: nowIso,
        },
        unread_count: 0,
        member_ids: [currentUserId, detail.targetUserId].filter(Boolean),
      };
      updateConversationsState((prev) =>
        cleanAndDeduplicateConversations([convToAdd, ...prev], currentUserId)
      );
      fetchConversations();
    };

    window.addEventListener('liveconnect_conversation_message', handleLocalConvMessage);
    window.addEventListener('liveconnect_conversation_created', handleLocalConvCreated);

    return () => {
      window.removeEventListener('liveconnect_conversation_message', handleLocalConvMessage);
      window.removeEventListener('liveconnect_conversation_created', handleLocalConvCreated);
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
    if (!currentUserId || !targetUserId) return null;
    const isSelfChat = targetUserId === currentUserId;

    try {
      const newConvId = isSelfChat
        ? getDeterministicDirectConvId(currentUserId, currentUserId)
        : getDeterministicDirectConvId(currentUserId, targetUserId);

      unrecordDeletedConvId(currentUserId, newConvId);

      if (isFirebaseSessionActive(currentUserId)) {
        const resolvedTargetProf = isSelfChat
          ? currentUserProfile || (await fetchPublicProfileFs(currentUserId))
          : targetProfileData || (await fetchPublicProfileFs(targetUserId, currentUserId));

        if (!isSelfChat && !resolvedTargetProf) {
          return null;
        }

        const nowIso = new Date().toISOString();
        const targetProf = resolvedTargetProf || {
          id: targetUserId,
          username: isSelfChat ? 'self' : 'user',
          display_name: isSelfChat ? 'Note to Self (You)' : 'User',
          avatar_url: null,
          bio: null,
          is_online: true,
          last_seen: nowIso,
          created_at: nowIso,
          updated_at: nowIso,
        };

        const myProf =
          currentUserProfile ||
          (await fetchPublicProfileFs(currentUserId)) || {
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

        const optimisticConv: Conversation = {
          id: newConvId,
          type: 'direct',
          created_at: nowIso,
          updated_at: nowIso,
          other_member: targetProf,
          unread_count: 0,
          member_ids: isSelfChat ? [currentUserId] : [currentUserId, targetUserId],
        };

        updateConversationsState((prev) =>
          cleanAndDeduplicateConversations([optimisticConv, ...prev], currentUserId)
        );
        setActiveConversationId(newConvId);

        const conv = await createOrGetDirectConversationFs(newConvId, myProf, targetProf);
        updateConversationsState((prev) =>
          cleanAndDeduplicateConversations([conv, ...prev], currentUserId)
        );
        setActiveConversationId(newConvId);
        return newConvId;
      }

      let targetProfile = targetProfileData;
      const authHeaders = await getAuthHeaders();

      if (!targetProfile && !isSelfChat) {
        try {
          const profRes = await fetch(
            `/api/users/profile/${encodeURIComponent(targetUserId)}?viewerId=${encodeURIComponent(currentUserId)}`,
            { headers: authHeaders }
          );
          if (profRes.status === 403) {
            return null;
          }
          if (profRes.ok) {
            const profJson = await profRes.json();
            if (profJson?.profile) {
              targetProfile = profJson.profile as Profile;
            }
          }
        } catch {
          // ignore and let create-or-get resolve
        }
      }

      const nowIso = new Date().toISOString();
      const optimisticConv: Conversation = {
        id: newConvId,
        type: 'direct',
        created_at: nowIso,
        updated_at: nowIso,
        other_member:
          targetProfile ||
          (isSelfChat && currentUserProfile ? currentUserProfile : undefined) || {
            id: targetUserId,
            username: isSelfChat ? 'self' : 'user',
            display_name: isSelfChat ? 'Note to Self (You)' : 'User',
            avatar_url: null,
            bio: null,
            is_online: true,
            last_seen: nowIso,
            created_at: nowIso,
            updated_at: nowIso,
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
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          userId: currentUserId,
          targetUserId,
          userProfile: currentUserProfile || undefined,
          targetProfile,
        }),
      }).catch(() => null);

      if (res && (res.status === 403 || res.status === 404)) {
        updateConversationsState((prev) => prev.filter((c) => c.id !== newConvId));
        if (activeConvIdRef.current === newConvId) {
          setActiveConversationId(null);
        }
        return null;
      }

      if (res && res.ok) {
        const data = await res.json().catch(() => null);
        if (data?.conversation) {
          const resolvedId = data.conversation.id || newConvId;
          unrecordDeletedConvId(currentUserId, resolvedId);
          updateConversationsState((prev) =>
            cleanAndDeduplicateConversations([data.conversation, ...prev], currentUserId)
          );
          setActiveConversationId(resolvedId);
          return resolvedId;
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
