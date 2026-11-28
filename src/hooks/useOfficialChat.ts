import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  collection,
  doc,
  query,
  orderBy,
  limit,
  onSnapshot,
  setDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { OfficialMessage } from '@/src/types';
import {
  db,
  auth,
  isFirebaseSessionActive,
  tsToIso,
} from '@/src/lib/firebase/client';
import { getAuthHeaders } from '@/src/lib/authHeader';

export const OFFICIAL_CHAT_ID = '__liveconnect_official__';

interface UseOfficialChatResult {
  messages: OfficialMessage[];
  lastMessage: OfficialMessage | null;
  unreadCount: number;
  isVisible: boolean;
  loading: boolean;
  markAsRead: () => Promise<void>;
  deleteMessageForMe: (messageId: string) => Promise<void>;
  clearChatForMe: () => Promise<void>;
  refreshOfficialChat: () => Promise<void>;
}

export function useOfficialChat(currentUserId?: string): UseOfficialChatResult {
  const [rawMessages, setRawMessages] = useState<OfficialMessage[]>([]);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [clearedAt, setClearedAt] = useState<string | null>(null);
  const [lastReadAt, setLastReadAt] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const clearedTimestampRef = useRef<Timestamp | null>(null);
  const lastReadTimestampRef = useRef<Timestamp | null>(null);
  const busRef = useRef<BroadcastChannel | null>(null);

  const fetchFromServer = useCallback(async () => {
    if (!currentUserId) {
      setRawMessages([]);
      setDeletedIds(new Set());
      setClearedAt(null);
      setLastReadAt(null);
      setLoading(false);
      return;
    }

    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/official-chat', {
        headers: { ...headers },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!isFirebaseSessionActive(currentUserId)) {
        setRawMessages(Array.isArray(data.messages) ? data.messages : []);
        setClearedAt(data.clearedAt || null);
        setLastReadAt(data.lastReadAt || null);
      }
    } catch {
      // ignore transient network errors
    } finally {
      if (!isFirebaseSessionActive(currentUserId)) {
        setLoading(false);
      }
    }
  }, [currentUserId]);

  useEffect(() => {
    clearedTimestampRef.current = null;
    lastReadTimestampRef.current = null;

    if (!currentUserId) {
      setRawMessages([]);
      setDeletedIds(new Set());
      setClearedAt(null);
      setLastReadAt(null);
      setLoading(false);
      return;
    }

    if (isFirebaseSessionActive(currentUserId)) {
      setLoading(true);
      let gotMessages = false;

      const messagesQuery = query(
        collection(db, 'official_messages'),
        orderBy('createdAt', 'asc'),
        limit(300)
      );

      const unsubMessages = onSnapshot(
        messagesQuery,
        (snap) => {
          const list: OfficialMessage[] = [];
          snap.forEach((docSnap) => {
            const d = docSnap.data();
            if (!d || d.isDeleted === true) return;
            list.push({
              id: docSnap.id,
              text: typeof d.text === 'string' ? d.text : '',
              imageUrl: typeof d.imageUrl === 'string' ? d.imageUrl : null,
              senderId: d.senderId || '',
              senderEmail: d.senderEmail || null,
              senderRole: d.senderRole === 'moderator' ? 'moderator' : 'super_admin',
              deliveredCount: Number(d.deliveredCount || 0),
              createdAt: tsToIso(d.createdAt),
              updatedAt: tsToIso(d.updatedAt),
            });
          });
          setRawMessages(list);
          gotMessages = true;
          setLoading(false);
        },
        (err) => {
          if (auth.currentUser) {
            console.warn('Official chat messages snapshot error:', err?.message);
          }
          if (!gotMessages) {
            setLoading(false);
          }
        }
      );

      const stateRef = doc(db, 'users', currentUserId, 'official_chat_state', 'state');
      const unsubState = onSnapshot(
        stateRef,
        (docSnap) => {
          if (!docSnap.exists()) {
            clearedTimestampRef.current = null;
            lastReadTimestampRef.current = null;
            setClearedAt(null);
            setLastReadAt(null);
            return;
          }
          const d = docSnap.data();
          clearedTimestampRef.current = d?.clearedAt instanceof Timestamp ? d.clearedAt : null;
          lastReadTimestampRef.current = d?.lastReadAt instanceof Timestamp ? d.lastReadAt : null;
          setClearedAt(d?.clearedAt ? tsToIso(d.clearedAt) : null);
          setLastReadAt(d?.lastReadAt ? tsToIso(d.lastReadAt) : null);
        },
        (err) => {
          if (auth.currentUser) {
            console.warn('Official chat state snapshot error:', err?.message);
          }
        }
      );

      const deletedRef = collection(db, 'users', currentUserId, 'official_deleted_messages');
      const unsubDeleted = onSnapshot(
        deletedRef,
        (snap) => {
          const next = new Set<string>();
          snap.forEach((docSnap) => {
            next.add(docSnap.id);
          });
          setDeletedIds(next);
        },
        (err) => {
          if (auth.currentUser) {
            console.warn('Official chat deleted markers snapshot error:', err?.message);
          }
        }
      );

      return () => {
        unsubMessages();
        unsubState();
        unsubDeleted();
      };
    }

    // SQLite fallback mode
    void fetchFromServer();

    if (typeof BroadcastChannel !== 'undefined') {
      const bus = new BroadcastChannel('liveconnect_official_chat_sync');
      busRef.current = bus;
      bus.onmessage = (event) => {
        if (!event.data || event.data.userId === currentUserId || event.data.refreshAll) {
          void fetchFromServer();
        }
      };
    }

    const pollTimer = setInterval(() => {
      void fetchFromServer();
    }, 4500);

    const onFocus = () => {
      void fetchFromServer();
    };
    window.addEventListener('focus', onFocus);

    return () => {
      clearInterval(pollTimer);
      window.removeEventListener('focus', onFocus);
      if (busRef.current) {
        busRef.current.close();
        busRef.current = null;
      }
    };
  }, [currentUserId, fetchFromServer]);

  const visibleMessages = useMemo(() => {
    const clearedMs = clearedAt ? Date.parse(clearedAt) : 0;
    return rawMessages.filter((msg) => {
      if (deletedIds.has(msg.id)) return false;
      if (clearedMs > 0) {
        const msgMs = Date.parse(msg.createdAt);
        if (!Number.isNaN(msgMs) && msgMs <= clearedMs) return false;
      }
      return true;
    });
  }, [rawMessages, deletedIds, clearedAt]);

  // Visible by default (including brand-new users with 0 or past messages).
  // Hidden ONLY if the user explicitly cleared the chat and no newer message has arrived since clearedAt.
  const isVisible = Boolean(currentUserId) && (!clearedAt || visibleMessages.length > 0);

  const lastMessage = visibleMessages.length > 0 ? visibleMessages[visibleMessages.length - 1] : null;

  const unreadCount = useMemo(() => {
    if (!isVisible || visibleMessages.length === 0) return 0;
    const clearedMs = clearedAt ? Date.parse(clearedAt) : 0;
    const readMs = Math.max(
      Number.isNaN(clearedMs) ? 0 : clearedMs,
      lastReadAt && !Number.isNaN(Date.parse(lastReadAt)) ? Date.parse(lastReadAt) : 0
    );
    return visibleMessages.filter((m) => {
      const msgMs = Date.parse(m.createdAt);
      return Number.isNaN(msgMs) ? true : msgMs > readMs;
    }).length;
  }, [isVisible, visibleMessages, clearedAt, lastReadAt]);

  const markAsRead = useCallback(async () => {
    if (!currentUserId) return;
    const nowIso = new Date().toISOString();
    setLastReadAt(nowIso);

    if (isFirebaseSessionActive(currentUserId)) {
      try {
        await setDoc(doc(db, 'users', currentUserId, 'official_chat_state', 'state'), {
          userId: currentUserId,
          clearedAt: clearedTimestampRef.current ?? null,
          lastReadAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (err: any) {
        console.warn('Official chat Firestore markAsRead error:', err?.message);
      }
    }

    try {
      const headers = await getAuthHeaders();
      await fetch('/api/official-chat/read', {
        method: 'POST',
        headers: { ...headers },
      });
      busRef.current?.postMessage({ userId: currentUserId });
    } catch {
      // ignore
    }
  }, [currentUserId]);

  const deleteMessageForMe = useCallback(
    async (messageId: string) => {
      if (!currentUserId || !messageId) return;

      setDeletedIds((prev) => {
        const next = new Set(prev);
        next.add(messageId);
        return next;
      });
      if (!isFirebaseSessionActive(currentUserId)) {
        setRawMessages((prev) => prev.filter((m) => m.id !== messageId));
      }

      if (isFirebaseSessionActive(currentUserId)) {
        try {
          await setDoc(
            doc(db, 'users', currentUserId, 'official_deleted_messages', messageId),
            {
              messageId,
              deletedAt: serverTimestamp(),
            }
          );
        } catch (err: any) {
          console.warn('Official chat Firestore hide message error:', err?.message);
        }
      }

      try {
        const headers = await getAuthHeaders();
        await fetch(`/api/official-chat/messages/${encodeURIComponent(messageId)}`, {
          method: 'DELETE',
          headers: { ...headers },
        });
        busRef.current?.postMessage({ userId: currentUserId });
      } catch {
        // ignore
      }
    },
    [currentUserId]
  );

  const clearChatForMe = useCallback(async () => {
    if (!currentUserId) return;
    const nowIso = new Date().toISOString();
    setClearedAt(nowIso);
    setLastReadAt(nowIso);
    if (!isFirebaseSessionActive(currentUserId)) {
      setRawMessages([]);
    }

    if (isFirebaseSessionActive(currentUserId)) {
      try {
        await setDoc(doc(db, 'users', currentUserId, 'official_chat_state', 'state'), {
          userId: currentUserId,
          clearedAt: serverTimestamp(),
          lastReadAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (err: any) {
        console.warn('Official chat Firestore clear error:', err?.message);
      }
    }

    try {
      const headers = await getAuthHeaders();
      await fetch('/api/official-chat', {
        method: 'DELETE',
        headers: { ...headers },
      });
      busRef.current?.postMessage({ userId: currentUserId });
    } catch {
      // ignore
    }
  }, [currentUserId]);

  return {
    messages: visibleMessages,
    lastMessage,
    unreadCount,
    isVisible,
    loading,
    markAsRead,
    deleteMessageForMe,
    clearChatForMe,
    refreshOfficialChat: fetchFromServer,
  };
}
