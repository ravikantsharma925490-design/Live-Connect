import { useCallback, useEffect, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db, isFirebaseSessionActive } from '@/src/lib/firebase/client';
import {
  clearFamilyChatForSelf,
  deleteFamilyMessage,
  fetchFamilyMessages,
  fetchFamilyTypingUsers,
  getFamilyDetail,
  listFamilyMembersPaged,
  markFamilyMessagesRead,
  sendFamilyMessage,
  setFamilyTypingStatus,
  subscribeFamilyMessagesFs,
  toggleFamilyMessageReaction,
  togglePinFamilyMessage,
} from '@/src/lib/family/familyService';
import { FAMILY_LARGE_THRESHOLD } from '@/src/lib/family/constants';
import { Family, FamilyMembership, FamilyMessage, FamilyMessageType, Profile } from '@/src/types';

export function useFamilyChat(familyId: string | null, userProfile: Profile | null) {
  const [family, setFamily] = useState<Family | null>(null);
  const [membership, setMembership] = useState<FamilyMembership | null>(null);
  const [messages, setMessages] = useState<(FamilyMessage & { seenCount?: number })[]>([]);
  const [typingUsers, setTypingUsers] = useState<Array<{ userId: string; displayName: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [removedNotice, setRemovedNotice] = useState<string | null>(null);

  const userId = userProfile?.id || null;
  const lastTypingPulseRef = useRef(0);
  const hasLiveMessagesSubRef = useRef(false);

  const loadDetailAndMessages = useCallback(async () => {
    if (!familyId || !userId) return;
    try {
      const detail = await getFamilyDetail(userId, familyId);
      setFamily((prev) => ({
        ...detail.family,
        pendingRequestsCount:
          detail.family.pendingRequestsCount === undefined
            ? (prev?.pendingRequestsCount ?? 0)
            : detail.family.pendingRequestsCount,
      }));
      setMembership(detail.membership);
      setRemovedNotice(null);

      if (detail.membership.status === 'active') {
        if (!isFirebaseSessionActive(userId) || !hasLiveMessagesSubRef.current) {
          const msgRes = await fetchFamilyMessages(userId, familyId, detail.membership.clearedAt || null);
          setMessages(msgRes.messages || []);
          setHasMore(Boolean(msgRes.hasMore));
        }
      } else {
        setMessages([]);
        setHasMore(false);
      }
    } catch (err: any) {
      if (err?.code === 'FAMILY_REMOVED' || String(err?.message || '').toLowerCase().includes('removed')) {
        setRemovedNotice(err?.message || 'You were removed from this Family.');
      }
    } finally {
      setLoading(false);
    }
  }, [familyId, userId]);

  useEffect(() => {
    if (!familyId || !userId) {
      hasLiveMessagesSubRef.current = false;
      setFamily(null);
      setMembership(null);
      setMessages([]);
      setTypingUsers([]);
      setRemovedNotice(null);
      return;
    }

    hasLiveMessagesSubRef.current = false;
    setLoading(true);
    loadDetailAndMessages();

    let unsubFamily: (() => void) | null = null;
    let pollTimer: number | null = null;

    if (isFirebaseSessionActive(userId)) {
      try {
        unsubFamily = onSnapshot(
          doc(db, 'families', familyId),
          (snap) => {
            if (snap.metadata.fromCache && !snap.exists()) return;
            loadDetailAndMessages();
          },
          (err) => {
            console.warn('Transient family detail listener error:', err?.message || err);
          }
        );
      } catch {
        // Fallback handled by polling
      }
    }

    pollTimer = window.setInterval(() => {
      loadDetailAndMessages();
    }, 4500);

    return () => {
      if (unsubFamily) unsubFamily();
      if (pollTimer) window.clearInterval(pollTimer);
    };
  }, [familyId, userId, loadDetailAndMessages]);

  // Separate real-time messages subscription for Firebase mode
  useEffect(() => {
    if (!familyId || !userId || membership?.status !== 'active') {
      hasLiveMessagesSubRef.current = false;
      return;
    }
    if (!isFirebaseSessionActive(userId)) return;

    hasLiveMessagesSubRef.current = true;
    const unsub = subscribeFamilyMessagesFs(familyId, membership?.clearedAt || null, (list) => {
      setMessages(list);
    });
    return () => {
      hasLiveMessagesSubRef.current = false;
      unsub();
    };
  }, [familyId, userId, membership?.status, membership?.clearedAt]);

  // Typing polling ONLY for Families <= 50 members
  useEffect(() => {
    if (!family || !userId || membership?.status !== 'active') {
      setTypingUsers([]);
      return;
    }
    if (family.memberCount > FAMILY_LARGE_THRESHOLD) {
      setTypingUsers([]);
      return;
    }

    let cancelled = false;
    const pollTyping = async () => {
      const list = await fetchFamilyTypingUsers(userId, family);
      if (!cancelled) setTypingUsers(list);
    };

    pollTyping();
    const timer = window.setInterval(pollTyping, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [family?.id, family?.memberCount, userId, membership?.status]);

  // Mark latest visible messages as read
  const markVisibleRead = useCallback(async () => {
    if (!userProfile || !familyId || membership?.status !== 'active' || messages.length === 0) return;
    const recentIds = messages.slice(-15).map((m) => m.id);
    await markFamilyMessagesRead(userProfile, familyId, recentIds);
  }, [userProfile, familyId, membership?.status, messages]);

  useEffect(() => {
    markVisibleRead();
  }, [markVisibleRead]);

  const loadOlderMessages = useCallback(async () => {
    if (!userId || !familyId || messages.length === 0 || !hasMore) return;
    const oldest = messages[0];
    const older = await fetchFamilyMessages(userId, familyId, membership?.clearedAt || null, oldest.createdAt);
    if (older.messages.length > 0) {
      setMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.id));
        const uniqueOlder = older.messages.filter((m) => !existingIds.has(m.id));
        return [...uniqueOlder, ...prev];
      });
    }
    setHasMore(Boolean(older.hasMore));
  }, [userId, familyId, messages, hasMore, membership?.clearedAt]);

  const sendMessage = useCallback(
    async (params: {
      type?: FamilyMessageType;
      content: string;
      mediaUrl?: string | null;
      mediaType?: 'image' | 'voice' | null;
      cloudinaryPublicId?: string | null;
      b2FileId?: string | null;
      b2FileName?: string | null;
      replyToMessage?: FamilyMessage | null;
      mentions?: string[];
    }) => {
      if (!userProfile || !family || !membership || membership.status !== 'active') return null;
      setSending(true);
      try {
        const created = await sendFamilyMessage({
          user: userProfile,
          family,
          role: membership.role,
          relationTag: membership.relationTag,
          ...params,
        });
        setMessages((prev) => (prev.some((m) => m.id === created.id) ? prev : [...prev, created]));
        setFamilyTypingStatus(userProfile, family, false).catch(() => {});
        return created;
      } finally {
        setSending(false);
      }
    },
    [userProfile, family, membership]
  );

  const sendSafeCheckIn = useCallback(async () => {
    if (!userProfile || !family || !membership || membership.status !== 'active') return null;
    const nowLabel = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return sendMessage({
      type: 'safe_checkin',
      content: `I'm safe (${nowLabel})`,
    });
  }, [userProfile, family, membership, sendMessage]);

  const reactToMessage = useCallback(
    async (messageId: string, emoji: string) => {
      if (!userId || !familyId) return;
      const target = messages.find((m) => m.id === messageId);
      if (!target || target.isDeleted) return;
      const updated = await toggleFamilyMessageReaction(userId, familyId, messageId, emoji, target.reactions || {});
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, reactions: updated } : m)));
    },
    [userId, familyId, messages]
  );

  const pinMessage = useCallback(
    async (message: FamilyMessage) => {
      if (!userProfile || !family) return;
      const nextPins = await togglePinFamilyMessage(userProfile, family, message);
      const pinnedIds = new Set(nextPins.map((p) => p.messageId));
      setFamily((prev) => (prev ? { ...prev, pinnedMessages: nextPins } : prev));
      setMessages((prev) => prev.map((m) => ({ ...m, isPinned: pinnedIds.has(m.id) })));
    },
    [userProfile, family]
  );

  const removeMessage = useCallback(
    async (message: FamilyMessage) => {
      if (!userId || !family || !membership) return;
      await deleteFamilyMessage(userId, membership.role, family, message);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === message.id
            ? {
                ...m,
                isDeleted: true,
                isPinned: false,
                content: 'This message was deleted',
                mediaUrl: null,
                reactions: {},
              }
            : m
        )
      );
      setFamily((prev) =>
        prev
          ? {
              ...prev,
              pinnedMessages: (prev.pinnedMessages || []).filter((p) => p.messageId !== message.id),
            }
          : prev
      );
    },
    [userId, family, membership]
  );

  const clearChat = useCallback(async () => {
    if (!userId || !familyId) return;
    const clearedAt = await clearFamilyChatForSelf(userId, familyId);
    setMembership((prev) => (prev ? { ...prev, clearedAt } : prev));
    setMessages([]);
  }, [userId, familyId]);

  const notifyTyping = useCallback(
    (isTyping: boolean) => {
      if (!userProfile || !family || family.memberCount > FAMILY_LARGE_THRESHOLD) return;
      const now = Date.now();
      if (isTyping && now - lastTypingPulseRef.current < 2200) return;
      lastTypingPulseRef.current = isTyping ? now : 0;
      setFamilyTypingStatus(userProfile, family, isTyping).catch(() => {});
    },
    [userProfile, family]
  );

  const searchMentionMembers = useCallback(
    async (searchQuery: string) => {
      if (!userId || !family) return [];
      const res = await listFamilyMembersPaged({
        userId,
        familyId: family.id,
        memberCount: family.memberCount,
        limitCount: 10,
        searchQuery,
        status: 'active',
      });
      return res.members
        .filter((m) => m.userId !== userId)
        .map((m) => ({
          id: m.userId,
          username: m.username,
          display_name: m.displayName,
          avatar_url: m.avatarUrl || null,
          relationTag: m.relationTag || null,
        }));
    },
    [userId, family]
  );

  return {
    family,
    setFamily,
    membership,
    setMembership,
    messages,
    typingUsers,
    loading,
    sending,
    hasMore,
    removedNotice,
    refreshFamilyChat: loadDetailAndMessages,
    loadOlderMessages,
    sendMessage,
    sendSafeCheckIn,
    reactToMessage,
    pinMessage,
    removeMessage,
    clearChat,
    notifyTyping,
    searchMentionMembers,
  };
}
