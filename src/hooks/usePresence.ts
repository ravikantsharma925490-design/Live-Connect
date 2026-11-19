import { useEffect, useState, useCallback, useRef } from 'react';
import {
  collection,
  doc,
  query,
  where,
  limit,
  onSnapshot,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { Profile } from '@/src/types';
import {
  db,
  auth,
  isFirebaseSessionActive,
  OperationType,
  handleFirestoreError,
  tsToIso,
} from '@/src/lib/firebase/client';

export function usePresence(currentUserId?: string) {
  const [onlineUsers, setOnlineUsers] = useState<Record<string, { is_online: boolean; last_seen: string }>>({});
  // Re-evaluation tick every 10 seconds to auto-expire stale heartbeats
  const [, setTick] = useState(0);
  const presenceBusRef = useRef<BroadcastChannel | null>(null);

  // Send offline beacon
  const sendOfflineStatus = useCallback((userId: string) => {
    if (!userId) return;
    const now = new Date().toISOString();

    if (isFirebaseSessionActive(userId)) {
      updateDoc(doc(db, 'public_profiles', userId), {
        isOnline: false,
        lastSeen: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }).catch(() => {});
      return;
    }

    try {
      const payload = JSON.stringify({ userId });
      if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        const blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon('/api/presence/offline', blob);
      } else {
        fetch('/api/presence/offline', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true,
        }).catch(() => {});
      }
    } catch {
      // ignore
    }

    try {
      presenceBusRef.current?.postMessage({
        type: 'PRESENCE_UPDATE',
        userId,
        is_online: false,
        last_seen: now,
      });
    } catch {
      // ignore
    }
  }, []);

  // Send online heartbeat
  const sendOnlineHeartbeat = useCallback((userId: string) => {
    if (!userId) return;
    const now = new Date().toISOString();

    if (isFirebaseSessionActive(userId)) {
      updateDoc(doc(db, 'public_profiles', userId), {
        isOnline: true,
        lastSeen: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }).catch(() => {});
    } else {
      try {
        fetch('/api/presence/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId }),
        }).catch(() => {});
      } catch {
        // ignore
      }
    }

    setOnlineUsers((prev) => ({
      ...prev,
      [userId]: { is_online: true, last_seen: now },
    }));

    try {
      presenceBusRef.current?.postMessage({
        type: 'PRESENCE_UPDATE',
        userId,
        is_online: true,
        last_seen: now,
      });
    } catch {
      // ignore
    }
  }, []);

  const fetchOnlinePresence = useCallback(async () => {
    if (isFirebaseSessionActive(currentUserId)) return;
    try {
      const res = await fetch('/api/presence/online');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.users)) {
        const nextMap: Record<string, { is_online: boolean; last_seen: string }> = {};
        data.users.forEach((u: any) => {
          if (u?.id) {
            nextMap[u.id] = {
              is_online: Boolean(u.is_online),
              last_seen: u.last_seen || new Date().toISOString(),
            };
          }
        });
        if (currentUserId) {
          nextMap[currentUserId] = {
            is_online: true,
            last_seen: new Date().toISOString(),
          };
        }
        setOnlineUsers(nextMap);
      }
    } catch {
      // ignore
    }
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId) return;

    const usingFirebase = isFirebaseSessionActive(currentUserId);

    if (typeof BroadcastChannel !== 'undefined') {
      const bus = new BroadcastChannel('liveconnect_presence_sync');
      presenceBusRef.current = bus;
      bus.onmessage = (event) => {
        const msg = event.data;
        if (msg?.type === 'PRESENCE_UPDATE' && msg.userId) {
          setOnlineUsers((prev) => ({
            ...prev,
            [msg.userId]: {
              is_online: Boolean(msg.is_online),
              last_seen: msg.last_seen || new Date().toISOString(),
            },
          }));
        }
      };
    }

    // 1. Immediately mark self online
    sendOnlineHeartbeat(currentUserId);

    let unsubFirestore: (() => void) | null = null;
    let pollInterval: any = null;

    if (usingFirebase) {
      const q = query(
        collection(db, 'public_profiles'),
        where('isPublic', '==', true),
        where('isOnline', '==', true),
        limit(150)
      );
      unsubFirestore = onSnapshot(
        q,
        (snap) => {
          const nextMap: Record<string, { is_online: boolean; last_seen: string }> = {};
          snap.forEach((docSnap) => {
            const d = docSnap.data();
            nextMap[docSnap.id] = {
              is_online: Boolean(d.isOnline),
              last_seen: tsToIso(d.lastSeen),
            };
          });
          nextMap[currentUserId] = {
            is_online: true,
            last_seen: new Date().toISOString(),
          };
          setOnlineUsers(nextMap);
        },
        (err) => {
          if (!auth.currentUser) return;
          handleFirestoreError(err, OperationType.LIST, 'public_profiles');
        }
      );
    } else {
      fetchOnlinePresence();
      pollInterval = setInterval(() => {
        fetchOnlinePresence();
      }, 8000);
    }

    // 2. Heartbeat interval every 20 seconds
    const heartbeatInterval = setInterval(() => {
      sendOnlineHeartbeat(currentUserId);
    }, 20000);

    // 3. Tick timer every 10 seconds to auto-expire stale heartbeats
    const tickInterval = setInterval(() => {
      setTick((t) => (t + 1) % 10000);
    }, 10000);

    // 4. Browser Lifecycle events
    const handleBeforeUnload = () => {
      sendOfflineStatus(currentUserId);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        sendOnlineHeartbeat(currentUserId);
        if (!usingFirebase) fetchOnlinePresence();
      } else if (document.visibilityState === 'hidden') {
        sendOnlineHeartbeat(currentUserId);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (unsubFirestore) unsubFirestore();
      if (pollInterval) clearInterval(pollInterval);
      clearInterval(heartbeatInterval);
      clearInterval(tickInterval);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);

      if (presenceBusRef.current) {
        presenceBusRef.current.close();
        presenceBusRef.current = null;
      }
      sendOfflineStatus(currentUserId);
    };
  }, [currentUserId, sendOnlineHeartbeat, sendOfflineStatus, fetchOnlinePresence]);

  const isUserOnline = useCallback(
    (profile?: Profile | null): boolean => {
      if (!profile?.id) return false;

      if (currentUserId && profile.id === currentUserId) {
        return true;
      }

      const presenceData = onlineUsers[profile.id];
      if (presenceData !== undefined) {
        if (!presenceData.is_online) return false;
        const lastSeenMs = new Date(presenceData.last_seen).getTime();
        if (!isNaN(lastSeenMs) && Date.now() - lastSeenMs < 55 * 1000) {
          return true;
        }
      }

      if (profile.is_online && profile.last_seen) {
        const lastSeenMs = new Date(profile.last_seen).getTime();
        if (!isNaN(lastSeenMs) && Date.now() - lastSeenMs < 50 * 1000) {
          return true;
        }
      }

      return false;
    },
    [currentUserId, onlineUsers]
  );

  const getUserLastSeen = useCallback(
    (profile?: Profile | null): string => {
      if (!profile?.id) return '';
      return onlineUsers[profile.id]?.last_seen || profile.last_seen || profile.updated_at || '';
    },
    [onlineUsers]
  );

  return {
    onlineUsers,
    isUserOnline,
    getUserLastSeen,
  };
}
