import { useState, useEffect, useCallback, useRef } from 'react';
import {
  collection,
  doc,
  query,
  orderBy,
  limit,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import { AppNotification, Profile } from '@/src/types';
import { notificationService } from '@/src/lib/notification-service';
import {
  db,
  auth,
  isFirebaseSessionActive,
  OperationType,
  handleFirestoreError,
  tsToIso,
  sanitizeStr,
  sanitizeOptionalStr,
} from '@/src/lib/firebase/client';
import { generateUUID } from '@/src/lib/utils';

export function useNotifications(currentUserId?: string) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const initialLoadDoneRef = useRef<boolean>(false);
  const busRef = useRef<BroadcastChannel | null>(null);

  const fetchNotifications = useCallback(async () => {
    if (!currentUserId) {
      setNotifications([]);
      setLoading(false);
      seenIdsRef.current.clear();
      initialLoadDoneRef.current = false;
      return;
    }

    if (isFirebaseSessionActive(currentUserId)) {
      return;
    }

    try {
      const res = await fetch('/api/notifications/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId }),
      });

      if (res.ok) {
        const apiData = await res.json();
        const rawNotifs: AppNotification[] = (apiData.notifications || [])
          .filter((n: any) => n && n.title !== 'LIVE_CALL_SIGNAL')
          .map((n: any) => ({
            ...n,
            is_read: Boolean(n.is_read),
            actor: n.actor || {
              id: n.actor_id,
              display_name: 'User',
              username: 'user',
            },
          }));

        if (initialLoadDoneRef.current) {
          rawNotifs.forEach((notif) => {
            if (!seenIdsRef.current.has(notif.id) && !notif.is_read) {
              notificationService.sendNotification({
                title: notif.title || 'LiveConnect Notification',
                body: notif.message || 'You have a new update',
                tag: `notif-${notif.id}`,
              });
            }
          });
        }

        rawNotifs.forEach((n) => seenIdsRef.current.add(n.id));
        initialLoadDoneRef.current = true;
        setNotifications(rawNotifs);
      }
    } catch (err: any) {
      console.warn('Error fetching notifications:', err.message);
    } finally {
      setLoading(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    seenIdsRef.current.clear();
    initialLoadDoneRef.current = false;

    if (!currentUserId) {
      setNotifications([]);
      setLoading(false);
      return;
    }

    if (isFirebaseSessionActive(currentUserId)) {
      const q = query(
        collection(db, 'users', currentUserId, 'notifications'),
        orderBy('createdAt', 'desc'),
        limit(50)
      );
      const unsub = onSnapshot(
        q,
        (snap) => {
          const list: AppNotification[] = [];
          snap.forEach((docSnap) => {
            const d = docSnap.data();
            if (!d || d.title === 'LIVE_CALL_SIGNAL') return;
            const createdAt = tsToIso(d.createdAt);
            list.push({
              id: docSnap.id,
              user_id: d.userId || currentUserId,
              actor_id: d.actorId || '',
              type: d.type,
              title: d.title,
              message: d.message,
              reference_id: d.referenceId || null,
              is_read: Boolean(d.isRead),
              created_at: createdAt,
              actor: {
                id: d.actorId || '',
                display_name: d.actorDisplayName || d.actorUsername || 'User',
                username: d.actorUsername || 'user',
                avatar_url: d.actorAvatarUrl || null,
                bio: null,
                is_online: false,
                last_seen: createdAt,
                created_at: createdAt,
                updated_at: createdAt,
              },
            });
          });

          if (initialLoadDoneRef.current) {
            list.forEach((notif) => {
              if (!seenIdsRef.current.has(notif.id) && !notif.is_read) {
                notificationService.sendNotification({
                  title: notif.title || 'LiveConnect Notification',
                  body: notif.message || 'You have a new update',
                  tag: `notif-${notif.id}`,
                });
              }
            });
          }

          list.forEach((n) => seenIdsRef.current.add(n.id));
          initialLoadDoneRef.current = true;
          setNotifications(list);
          setLoading(false);
        },
        (err) => {
          if (!auth.currentUser) return;
          handleFirestoreError(err, OperationType.LIST, `users/${currentUserId}/notifications`);
        }
      );

      return () => {
        unsub();
      };
    }

    fetchNotifications();

    if (typeof BroadcastChannel !== 'undefined') {
      const bus = new BroadcastChannel('liveconnect_notifications_sync');
      busRef.current = bus;
      bus.onmessage = (event) => {
        if (event.data?.userId === currentUserId || event.data?.refreshAll) {
          fetchNotifications();
        }
      };
    }

    const pollInterval = setInterval(() => {
      fetchNotifications();
    }, 2500);

    return () => {
      clearInterval(pollInterval);
      if (busRef.current) {
        busRef.current.close();
        busRef.current = null;
      }
    };
  }, [currentUserId, fetchNotifications]);

  // Mark single notification as read
  const markAsRead = useCallback(
    async (notificationId: string) => {
      if (!currentUserId || !notificationId) return;

      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, is_read: true } : n))
      );

      if (isFirebaseSessionActive(currentUserId)) {
        try {
          await updateDoc(doc(db, 'users', currentUserId, 'notifications', notificationId), {
            isRead: true,
          });
        } catch (err: any) {
          console.warn('Error marking Firestore notification read:', err?.message);
        }
        return;
      }

      try {
        await fetch('/api/notifications/mark-read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId, notificationId }),
        });
        busRef.current?.postMessage({ userId: currentUserId });
      } catch (err: any) {
        console.warn('Error marking notification read:', err.message);
      }
    },
    [currentUserId]
  );

  // Mark all notifications as read
  const markAllAsRead = useCallback(async () => {
    if (!currentUserId) return;

    const unreadIds = notifications.filter((n) => !n.is_read).map((n) => n.id);
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));

    if (isFirebaseSessionActive(currentUserId)) {
      if (unreadIds.length === 0) return;
      try {
        const batch = writeBatch(db);
        unreadIds.slice(0, 400).forEach((id) => {
          batch.update(doc(db, 'users', currentUserId, 'notifications', id), { isRead: true });
        });
        await batch.commit();
      } catch (err: any) {
        console.warn('Error marking all Firestore notifications read:', err?.message);
      }
      return;
    }

    try {
      await fetch('/api/notifications/mark-all-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId }),
      });
      busRef.current?.postMessage({ userId: currentUserId });
    } catch (err: any) {
      console.warn('Error marking all notifications read:', err.message);
    }
  }, [currentUserId, notifications]);

  // Delete a notification
  const deleteNotification = useCallback(
    async (notificationId: string) => {
      if (!currentUserId || !notificationId) return;

      setNotifications((prev) => prev.filter((n) => n.id !== notificationId));

      if (isFirebaseSessionActive(currentUserId)) {
        try {
          await deleteDoc(doc(db, 'users', currentUserId, 'notifications', notificationId));
        } catch (err: any) {
          console.warn('Error deleting Firestore notification:', err?.message);
        }
        return;
      }

      try {
        await fetch('/api/notifications/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId, notificationId }),
        });
        busRef.current?.postMessage({ userId: currentUserId });
      } catch (err: any) {
        console.warn('Error deleting notification:', err.message);
      }
    },
    [currentUserId]
  );

  // Helper to send a notification
  const createNotification = useCallback(
    async (params: {
      userId: string;
      actorId: string;
      type: AppNotification['type'];
      title: string;
      message: string;
      referenceId?: string;
      actorMeta?: Profile;
    }) => {
      if (auth.currentUser && auth.currentUser.uid === params.actorId) {
        const notifId = `nf_${generateUUID().replace(/-/g, '').slice(0, 20)}`;
        try {
          await setDoc(doc(db, 'users', params.userId, 'notifications', notifId), {
            id: notifId,
            userId: params.userId,
            actorId: params.actorId,
            actorDisplayName: sanitizeOptionalStr(params.actorMeta?.display_name, 80),
            actorUsername: sanitizeOptionalStr(params.actorMeta?.username, 32),
            actorAvatarUrl: sanitizeOptionalStr(params.actorMeta?.avatar_url, 1024),
            type: params.type,
            title: sanitizeStr(params.title, 160) || 'LiveConnect Notification',
            message: sanitizeStr(params.message, 1000) || 'New notification',
            referenceId: sanitizeOptionalStr(params.referenceId, 128),
            isRead: false,
            createdAt: serverTimestamp(),
          });
        } catch (err: any) {
          console.warn('Error creating Firestore notification:', err?.message);
        }
        return;
      }

      try {
        await fetch('/api/notifications/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        });
        busRef.current?.postMessage({ userId: params.userId });
      } catch (err: any) {
        console.warn('Error creating notification:', err.message);
      }
    },
    []
  );

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return {
    notifications,
    unreadCount,
    loading,
    fetchNotifications,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    createNotification,
  };
}
