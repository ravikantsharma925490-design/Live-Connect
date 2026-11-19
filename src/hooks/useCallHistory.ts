import { useState, useEffect, useCallback, useRef } from 'react';
import {
  collection,
  doc,
  query,
  where,
  limit,
  onSnapshot,
  setDoc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import { Call, Profile } from '@/src/types';
import {
  db,
  auth,
  isFirebaseSessionActive,
  OperationType,
  handleFirestoreError,
  tsToIso,
} from '@/src/lib/firebase/client';
import { fetchMultiplePublicProfilesFs } from '@/src/lib/firebase/services';

export interface CallHistoryItem extends Call {
  peer: Profile;
  direction: 'incoming' | 'outgoing';
  isMissed: boolean;
  durationFormatted?: string;
}

function getLocalHistoryCacheKey(userId?: string) {
  return `liveconnect_call_history_${userId || 'anon'}`;
}

export function cleanAndDeduplicateCallHistory(calls: CallHistoryItem[]): CallHistoryItem[] {
  if (!Array.isArray(calls) || calls.length === 0) return [];
  const deduplicated: CallHistoryItem[] = [];
  const seenIds = new Set<string>();

  const sorted = [...calls].sort(
    (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
  );

  for (const c of sorted) {
    if (!c || !c.id) continue;

    // 1. Exact ID match
    let existingIdx = deduplicated.findIndex((p) => p.id === c.id);

    // 2. Proximity match for same call session (within 15 seconds between same two peers)
    if (existingIdx === -1) {
      existingIdx = deduplicated.findIndex((p) => {
        const samePeers =
          (p.caller_id === c.caller_id && p.callee_id === c.callee_id) ||
          (p.caller_id === c.callee_id && p.callee_id === c.caller_id);
        if (!samePeers) return false;
        const timeDiff = Math.abs(
          new Date(p.created_at || 0).getTime() - new Date(c.created_at || 0).getTime()
        );
        return timeDiff < 15000;
      });
    }

    if (existingIdx >= 0) {
      const prev = deduplicated[existingIdx];
      deduplicated[existingIdx] = {
        ...prev,
        ...c,
        peer: c.peer || prev.peer,
        durationFormatted: c.durationFormatted || prev.durationFormatted,
      };
      continue;
    }

    if (seenIds.has(c.id)) continue;
    seenIds.add(c.id);
    deduplicated.push(c);
  }

  return deduplicated;
}

export function loadLocalCallHistory(userId?: string): CallHistoryItem[] {
  if (typeof window === 'undefined' || !userId) return [];
  try {
    const raw = localStorage.getItem(getLocalHistoryCacheKey(userId));
    if (raw) {
      const parsed = JSON.parse(raw) as CallHistoryItem[];
      return cleanAndDeduplicateCallHistory(parsed);
    }
  } catch {
    // ignore
  }
  return [];
}

export function saveLocalCallHistory(userId: string | undefined, history: CallHistoryItem[]) {
  if (typeof window === 'undefined' || !userId) return;
  try {
    const clean = cleanAndDeduplicateCallHistory(history);
    localStorage.setItem(getLocalHistoryCacheKey(userId), JSON.stringify(clean));
    window.dispatchEvent(new CustomEvent('liveconnect_call_history_updated', { detail: { userId } }));
  } catch {
    // ignore
  }
}

export function recordCallInHistory(userId: string | undefined, callItem: CallHistoryItem) {
  if (!userId || !callItem || !callItem.id) return;
  const current = loadLocalCallHistory(userId);
  const existingIdx = current.findIndex(
    (c) =>
      c.id === callItem.id ||
      ((c.caller_id === callItem.caller_id && c.callee_id === callItem.callee_id) &&
        Math.abs(new Date(c.created_at || 0).getTime() - new Date(callItem.created_at || 0).getTime()) < 15000)
  );
  let updated: CallHistoryItem[];
  if (existingIdx >= 0) {
    updated = [...current];
    updated[existingIdx] = { ...updated[existingIdx], ...callItem };
  } else {
    updated = [callItem, ...current];
  }
  if (updated.length > 100) {
    updated = updated.slice(0, 100);
  }
  saveLocalCallHistory(userId, updated);
}

export function updateCallInHistory(
  userId: string | undefined,
  callId: string,
  updates: Partial<CallHistoryItem>
) {
  if (!userId || !callId) return;
  const current = loadLocalCallHistory(userId);
  const existingIdx = current.findIndex((c) => c.id === callId);
  if (existingIdx >= 0) {
    const updated = [...current];
    const item = { ...updated[existingIdx], ...updates };

    if (item.answered_at && item.ended_at) {
      const start = new Date(item.answered_at).getTime();
      const end = new Date(item.ended_at).getTime();
      const seconds = Math.max(0, Math.floor((end - start) / 1000));
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      item.durationFormatted = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    } else if (item.status === 'rejected') {
      item.durationFormatted = 'Declined';
    } else if (item.status === 'cancelled') {
      item.durationFormatted = 'Cancelled';
    } else if (item.status === 'missed') {
      item.durationFormatted = 'Missed';
    } else if (item.status === 'calling' || item.status === 'ringing') {
      item.durationFormatted = 'Ringing...';
    } else if (item.status === 'accepted' || item.status === 'connected') {
      item.durationFormatted = 'Connected';
    }

    updated[existingIdx] = item;
    saveLocalCallHistory(userId, updated);
  }
}

export function useCallHistory(currentUserId?: string) {
  const [history, setHistory] = useState<CallHistoryItem[]>(() =>
    loadLocalCallHistory(currentUserId)
  );
  const [loading, setLoading] = useState<boolean>(
    () => loadLocalCallHistory(currentUserId).length === 0
  );
  const [missedCount, setMissedCount] = useState<number>(0);

  const peerProfilesCacheRef = useRef<Record<string, Profile>>({});
  const outgoingDocsRef = useRef<Record<string, Record<string, any>>>({});
  const incomingDocsRef = useRef<Record<string, Record<string, any>>>({});
  const deletedIdsRef = useRef<Set<string>>(new Set());

  const getLastViewedTimestamp = useCallback(() => {
    if (typeof window === 'undefined' || !currentUserId) return 0;
    const stored = localStorage.getItem(`liveconnect_calls_last_viewed_${currentUserId}`);
    return stored ? parseInt(stored, 10) : 0;
  }, [currentUserId]);

  const markHistoryAsViewed = useCallback(() => {
    if (typeof window === 'undefined' || !currentUserId) return;
    localStorage.setItem(`liveconnect_calls_last_viewed_${currentUserId}`, Date.now().toString());
    setMissedCount(0);
  }, [currentUserId]);

  const formatRawCall = useCallback(
    (rawCall: any, lastViewed: number): { item: CallHistoryItem; isNewMissed: boolean } => {
      const isOutgoing = rawCall.caller_id === currentUserId;
      const isMissed =
        !isOutgoing &&
        (rawCall.status === 'missed' ||
          rawCall.status === 'rejected' ||
          (!rawCall.answered_at && ['ended', 'cancelled', 'missed', 'rejected'].includes(rawCall.status)));

      const callCreatedAt = new Date(rawCall.created_at || Date.now()).getTime();
      const isNewMissed = isMissed && callCreatedAt > lastViewed;

      let durationFormatted = '';
      if (rawCall.answered_at && rawCall.ended_at) {
        const start = new Date(rawCall.answered_at).getTime();
        const end = new Date(rawCall.ended_at).getTime();
        const seconds = Math.max(0, Math.floor((end - start) / 1000));
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        durationFormatted = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
      } else if (rawCall.status === 'connected' || rawCall.status === 'accepted') {
        durationFormatted = 'In progress';
      } else if (isMissed || rawCall.status === 'missed') {
        durationFormatted = 'Missed';
      } else if (rawCall.status === 'rejected') {
        durationFormatted = 'Declined';
      } else if (rawCall.status === 'cancelled') {
        durationFormatted = 'Cancelled';
      } else if (rawCall.status === 'calling' || rawCall.status === 'ringing') {
        durationFormatted = 'Ringing...';
      }

      const peerId = isOutgoing ? rawCall.callee_id : rawCall.caller_id;
      const rawPeer = rawCall.peer || (isOutgoing ? rawCall.callee : rawCall.caller);

      const peer: Profile = {
        id: peerId,
        username: rawPeer?.username || 'user',
        display_name: rawPeer?.display_name || rawPeer?.username || 'Contact',
        avatar_url: rawPeer?.avatar_url || null,
        bio: rawPeer?.bio || null,
        is_online: Boolean(rawPeer?.is_online),
        last_seen: rawPeer?.last_seen || rawCall.created_at,
        created_at: rawPeer?.created_at || rawCall.created_at,
        updated_at: rawPeer?.updated_at || rawCall.created_at,
      };

      const item: CallHistoryItem = {
        ...rawCall,
        peer,
        direction: isOutgoing ? 'outgoing' : 'incoming',
        isMissed,
        durationFormatted,
      };

      return { item, isNewMissed };
    },
    [currentUserId]
  );

  const rebuildFirestoreCallHistory = useCallback(async () => {
    if (!currentUserId) return;
    const lastViewed = getLastViewedTimestamp();
    const mergedRaw = new Map<string, Record<string, any>>();

    Object.entries(outgoingDocsRef.current).forEach(([id, data]) => {
      if (!deletedIdsRef.current.has(id) && data && typeof data === 'object') {
        mergedRaw.set(id, { id, ...(data as Record<string, any>) });
      }
    });
    Object.entries(incomingDocsRef.current).forEach(([id, data]) => {
      if (!deletedIdsRef.current.has(id) && data && typeof data === 'object') {
        mergedRaw.set(id, { id, ...(data as Record<string, any>) });
      }
    });

    const missingPeerIds = new Set<string>();
    mergedRaw.forEach((d) => {
      const peerId = d.callerId === currentUserId ? d.calleeId : d.callerId;
      if (peerId && !peerProfilesCacheRef.current[peerId]) {
        missingPeerIds.add(peerId);
      }
    });

    if (missingPeerIds.size > 0) {
      const fetched = await fetchMultiplePublicProfilesFs(Array.from(missingPeerIds));
      Object.assign(peerProfilesCacheRef.current, fetched);
    }

    const items: CallHistoryItem[] = [];
    mergedRaw.forEach((d, id) => {
      const isOutgoing = d.callerId === currentUserId;
      const peerId = isOutgoing ? d.calleeId : d.callerId;
      const cachedPeer = peerProfilesCacheRef.current[peerId];
      const createdAt = tsToIso(d.createdAt);

      const fallbackPeer: Profile = cachedPeer || {
        id: peerId,
        username: (isOutgoing ? d.calleeUsername : d.callerUsername) || 'user',
        display_name: (isOutgoing ? d.calleeDisplayName : d.callerDisplayName) || 'Contact',
        avatar_url: (isOutgoing ? d.calleeAvatarUrl : d.callerAvatarUrl) || null,
        bio: null,
        is_online: false,
        last_seen: createdAt,
        created_at: createdAt,
        updated_at: createdAt,
      };

      const rawCall = {
        id,
        caller_id: d.callerId,
        callee_id: d.calleeId,
        call_type: d.callType,
        status: d.status,
        room_name: d.roomName,
        started_at: createdAt,
        answered_at: d.answeredAt ? tsToIso(d.answeredAt) : null,
        ended_at: d.endedAt ? tsToIso(d.endedAt) : null,
        created_at: createdAt,
        updated_at: tsToIso(d.updatedAt),
        peer: fallbackPeer,
      };

      const { item } = formatRawCall(rawCall, lastViewed);
      items.push(item);
    });

    const sorted = cleanAndDeduplicateCallHistory(items);
    let missed = 0;
    sorted.forEach((item) => {
      const callCreatedAt = new Date(item.created_at || 0).getTime();
      if (item.isMissed && callCreatedAt > lastViewed) {
        missed += 1;
      }
    });

    setHistory(sorted);
    setMissedCount(missed);
    saveLocalCallHistory(currentUserId, sorted);
    setLoading(false);
  }, [currentUserId, formatRawCall, getLastViewedTimestamp]);

  const fetchHistory = useCallback(async () => {
    if (!currentUserId) {
      setHistory([]);
      setMissedCount(0);
      setLoading(false);
      return;
    }

    if (isFirebaseSessionActive(currentUserId)) {
      await rebuildFirestoreCallHistory();
      return;
    }

    const lastViewed = getLastViewedTimestamp();
    const localList = loadLocalCallHistory(currentUserId);
    const combinedMap = new Map<string, CallHistoryItem>();

    localList.forEach((c) => {
      if (c.id) combinedMap.set(c.id, c);
    });

    try {
      const srvRes = await fetch('/api/calls/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId }),
      });

      if (srvRes.ok) {
        const srvData = await srvRes.json();
        if (Array.isArray(srvData.calls)) {
          const serverMap = new Map<string, CallHistoryItem>();
          srvData.calls.forEach((c: any) => {
            const { item } = formatRawCall(c, lastViewed);
            serverMap.set(item.id, item);
          });

          const mergedMap = new Map<string, CallHistoryItem>(serverMap);
          localList.forEach((localItem) => {
            if (!mergedMap.has(localItem.id)) {
              const ageMs = Date.now() - new Date(localItem.created_at || 0).getTime();
              if (ageMs < 30000) {
                mergedMap.set(localItem.id, localItem);
              }
            }
          });
          combinedMap.clear();
          mergedMap.forEach((v, k) => combinedMap.set(k, v));
        }
      }
    } catch {
      // server fallback uses local cache
    }

    const sorted = cleanAndDeduplicateCallHistory(Array.from(combinedMap.values()));

    let missed = 0;
    sorted.forEach((item) => {
      const callCreatedAt = new Date(item.created_at || 0).getTime();
      if (item.isMissed && callCreatedAt > lastViewed) {
        missed += 1;
      }
    });

    setHistory(sorted);
    setMissedCount(missed);
    saveLocalCallHistory(currentUserId, sorted);
    setLoading(false);
  }, [currentUserId, formatRawCall, getLastViewedTimestamp, rebuildFirestoreCallHistory]);

  // Delete a single call history record
  const deleteCall = async (callId: string): Promise<boolean> => {
    if (!callId || !currentUserId) return false;

    try {
      setHistory((prev) => {
        const next = prev.filter((c) => c.id !== callId);
        saveLocalCallHistory(currentUserId, next);
        return next;
      });

      if (isFirebaseSessionActive(currentUserId)) {
        deletedIdsRef.current.add(callId);
        await setDoc(doc(db, 'users', currentUserId, 'deleted_calls', callId), {
          callId,
          deletedAt: serverTimestamp(),
        });
        return true;
      }

      await fetch('/api/calls/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId, userId: currentUserId }),
      });

      return true;
    } catch (err: any) {
      console.error('Error deleting call log:', err.message);
      return false;
    }
  };

  // Clear all call history records for the current user
  const clearAllHistory = async (): Promise<boolean> => {
    if (!currentUserId) return false;

    const callIdsToClear = history.map((c) => c.id).filter(Boolean);

    try {
      setHistory([]);
      setMissedCount(0);
      saveLocalCallHistory(currentUserId, []);

      if (isFirebaseSessionActive(currentUserId)) {
        callIdsToClear.forEach((id) => deletedIdsRef.current.add(id));
        for (let i = 0; i < callIdsToClear.length; i += 400) {
          const batch = writeBatch(db);
          callIdsToClear.slice(i, i + 400).forEach((callId) => {
            batch.set(doc(db, 'users', currentUserId, 'deleted_calls', callId), {
              callId,
              deletedAt: serverTimestamp(),
            });
          });
          await batch.commit();
        }
        return true;
      }

      await fetch('/api/calls/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId }),
      });

      return true;
    } catch (err: any) {
      console.error('Error clearing all call history:', err.message);
      return false;
    }
  };

  useEffect(() => {
    if (!currentUserId) {
      setHistory([]);
      setMissedCount(0);
      setLoading(false);
      return;
    }

    if (isFirebaseSessionActive(currentUserId)) {
      const unsubOut = onSnapshot(
        query(collection(db, 'calls'), where('callerId', '==', currentUserId), limit(60)),
        (snap) => {
          const next: Record<string, Record<string, any>> = {};
          snap.forEach((d) => {
            next[d.id] = d.data();
          });
          outgoingDocsRef.current = next;
          void rebuildFirestoreCallHistory();
        },
        (err) => {
          if (!auth.currentUser) return;
          handleFirestoreError(err, OperationType.LIST, 'calls');
        }
      );

      const unsubIn = onSnapshot(
        query(collection(db, 'calls'), where('calleeId', '==', currentUserId), limit(60)),
        (snap) => {
          const next: Record<string, Record<string, any>> = {};
          snap.forEach((d) => {
            next[d.id] = d.data();
          });
          incomingDocsRef.current = next;
          void rebuildFirestoreCallHistory();
        },
        (err) => {
          if (!auth.currentUser) return;
          handleFirestoreError(err, OperationType.LIST, 'calls');
        }
      );

      const unsubDel = onSnapshot(
        collection(db, 'users', currentUserId, 'deleted_calls'),
        (snap) => {
          const nextDel = new Set<string>();
          snap.forEach((d) => nextDel.add(d.id));
          deletedIdsRef.current = nextDel;
          void rebuildFirestoreCallHistory();
        },
        (err) => {
          if (!auth.currentUser) return;
          handleFirestoreError(err, OperationType.LIST, `users/${currentUserId}/deleted_calls`);
        }
      );

      return () => {
        unsubOut();
        unsubIn();
        unsubDel();
      };
    }

    fetchHistory();

    const handleLocalUpdate = () => {
      const local = loadLocalCallHistory(currentUserId);
      setHistory(local);
      const lastViewed = getLastViewedTimestamp();
      let missed = 0;
      local.forEach((item) => {
        const callCreatedAt = new Date(item.created_at || 0).getTime();
        if (item.isMissed && callCreatedAt > lastViewed) {
          missed += 1;
        }
      });
      setMissedCount(missed);
    };

    window.addEventListener('liveconnect_call_history_updated', handleLocalUpdate);

    const handleStorage = (e: StorageEvent) => {
      if (e.key === getLocalHistoryCacheKey(currentUserId)) {
        handleLocalUpdate();
      }
    };
    window.addEventListener('storage', handleStorage);

    const pollTimer = setInterval(() => {
      fetchHistory();
    }, 2500);

    return () => {
      clearInterval(pollTimer);
      window.removeEventListener('liveconnect_call_history_updated', handleLocalUpdate);
      window.removeEventListener('storage', handleStorage);
    };
  }, [currentUserId, fetchHistory, getLastViewedTimestamp, rebuildFirestoreCallHistory]);

  return {
    history,
    loading,
    missedCount,
    refetch: fetchHistory,
    markHistoryAsViewed,
    deleteCall,
    clearAllHistory,
  };
}
