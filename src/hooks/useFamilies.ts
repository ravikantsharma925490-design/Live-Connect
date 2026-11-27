import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db, isFirebaseSessionActive } from '@/src/lib/firebase/client';
import {
  createFamily,
  joinFamilyByCode,
  listMyFamiliesAndInvites,
  respondToFamilyInvite,
} from '@/src/lib/family/familyService';
import { isFamilyMembershipMuted } from '@/src/lib/family/constants';
import { Family, FamilyInvite, FamilyMembership, Profile } from '@/src/types';

const FAMILIES_CACHE_PREFIX = 'liveconnect_families_cache_';

function loadCachedFamilies(
  userId: string | null
): { memberships: FamilyMembership[]; invites: FamilyInvite[] } {
  if (typeof window === 'undefined' || !userId) {
    return { memberships: [], invites: [] };
  }
  try {
    const raw = localStorage.getItem(`${FAMILIES_CACHE_PREFIX}${userId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        memberships: Array.isArray(parsed?.memberships) ? parsed.memberships : [],
        invites: Array.isArray(parsed?.invites) ? parsed.invites : [],
      };
    }
  } catch {
    // ignore
  }
  return { memberships: [], invites: [] };
}

function saveCachedFamilies(
  userId: string | null,
  data: { memberships: FamilyMembership[]; invites: FamilyInvite[] }
) {
  if (typeof window === 'undefined' || !userId) return;
  try {
    localStorage.setItem(`${FAMILIES_CACHE_PREFIX}${userId}`, JSON.stringify(data));
  } catch {
    // ignore
  }
}

export function useFamilies(userProfile: Profile | null) {
  const userId = userProfile?.id || null;
  const initialCache = useMemo(() => loadCachedFamilies(userId), [userId]);

  const [memberships, setMemberships] = useState<FamilyMembership[]>(() => initialCache.memberships);
  const [invites, setInvites] = useState<FamilyInvite[]>(() => initialCache.invites);
  const [activeFamilyId, setActiveFamilyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const membershipsRef = useRef(memberships);
  const invitesRef = useRef(invites);
  membershipsRef.current = memberships;
  invitesRef.current = invites;

  const fetchingRef = useRef(false);
  const pendingRefreshRef = useRef(false);
  const prevUserIdRef = useRef<string | null>(userId);

  const refreshFamilies = useCallback(async () => {
    if (!userId) return;
    if (fetchingRef.current) {
      pendingRefreshRef.current = true;
      return;
    }
    fetchingRef.current = true;
    try {
      const data = await listMyFamiliesAndInvites(userId);
      const prevMap = new Map<string, FamilyMembership>(
        membershipsRef.current.map((m) => [m.familyId, m])
      );
      const sanitizedMemberships = (data.memberships || []).map((m) => {
        const prev = prevMap.get(m.familyId);
        const resolvedUnread =
          m.unreadCount < 0 ? (prev?.unreadCount ?? 0) : m.unreadCount;
        const resolvedPending =
          m.family && m.family.pendingRequestsCount === undefined
            ? (prev?.family?.pendingRequestsCount ?? 0)
            : m.family?.pendingRequestsCount;
        return {
          ...m,
          unreadCount: resolvedUnread,
          family: m.family
            ? {
                ...m.family,
                pendingRequestsCount: resolvedPending,
              }
            : m.family,
        };
      });
      const nextInvites = data.invites || [];
      membershipsRef.current = sanitizedMemberships;
      invitesRef.current = nextInvites;
      setMemberships(sanitizedMemberships);
      setInvites(nextInvites);
      saveCachedFamilies(userId, { memberships: sanitizedMemberships, invites: nextInvites });
    } catch {
      // Retain last known list on transient errors
    } finally {
      fetchingRef.current = false;
      setLoading(false);
      if (pendingRefreshRef.current) {
        pendingRefreshRef.current = false;
        void refreshFamilies();
      }
    }
  }, [userId]);

  useEffect(() => {
    if (prevUserIdRef.current !== userId) {
      prevUserIdRef.current = userId;
      if (!userId) {
        setMemberships([]);
        setInvites([]);
        setActiveFamilyId(null);
        setLoading(false);
        return;
      }
      const cached = loadCachedFamilies(userId);
      membershipsRef.current = cached.memberships;
      invitesRef.current = cached.invites;
      setMemberships(cached.memberships);
      setInvites(cached.invites);
    }

    if (!userId) {
      setMemberships([]);
      setInvites([]);
      setActiveFamilyId(null);
      return;
    }

    const hasCached = membershipsRef.current.length > 0 || invitesRef.current.length > 0;
    setLoading(!hasCached);
    refreshFamilies();

    const interval = window.setInterval(() => {
      refreshFamilies();
    }, 10_000);

    let unsubMems: (() => void) | null = null;
    let unsubInvs: (() => void) | null = null;

    if (isFirebaseSessionActive(userId)) {
      try {
        unsubMems = onSnapshot(
          query(collection(db, 'users', userId, 'family_memberships'), where('status', 'in', ['active', 'pending'])),
          (snap) => {
            if (
              snap.metadata.fromCache &&
              snap.empty &&
              !snap.metadata.hasPendingWrites &&
              membershipsRef.current.length > 0
            ) {
              return;
            }
            refreshFamilies();
          },
          (err) => {
            console.warn('Transient family_memberships listener error:', err?.message || err);
          }
        );
        unsubInvs = onSnapshot(
          query(collection(db, 'users', userId, 'family_invites'), where('status', '==', 'pending')),
          (snap) => {
            if (
              snap.metadata.fromCache &&
              snap.empty &&
              !snap.metadata.hasPendingWrites &&
              invitesRef.current.length > 0
            ) {
              return;
            }
            refreshFamilies();
          },
          (err) => {
            console.warn('Transient family_invites listener error:', err?.message || err);
          }
        );
      } catch {
        // Fallback to polling interval above
      }
    }

    return () => {
      window.clearInterval(interval);
      if (unsubMems) unsubMems();
      if (unsubInvs) unsubInvs();
    };
  }, [userId, refreshFamilies]);

  const activeMembership = useMemo(
    () => memberships.find((m) => m.familyId === activeFamilyId) || null,
    [memberships, activeFamilyId]
  );

  const familyBadgeCount = useMemo(() => {
    let total = invites.length;
    for (const m of memberships) {
      if (m.status === 'active') {
        const muted = isFamilyMembershipMuted(m);
        if (!muted) {
          total += Math.max(0, m.unreadCount || 0);
        }
        if ((m.role === 'owner' || m.role === 'admin') && m.family?.pendingRequestsCount) {
          total += m.family.pendingRequestsCount;
        }
      }
    }
    return total;
  }, [memberships, invites]);

  const createNewFamily = useCallback(
    async (params: {
      name: string;
      photoUrl?: string | null;
      joinApprovalRequired?: boolean;
      relationTag?: string | null;
    }): Promise<Family> => {
      if (!userProfile) throw new Error('Please sign in first.');
      const { family, membership } = await createFamily(userProfile, params);
      setMemberships((prev) => {
        const next = [membership, ...prev.filter((m) => m.familyId !== family.id)];
        membershipsRef.current = next;
        saveCachedFamilies(userProfile.id, { memberships: next, invites: invitesRef.current });
        return next;
      });
      setActiveFamilyId(family.id);
      return family;
    },
    [userProfile]
  );

  const respondInvite = useCallback(
    async (inviteId: string, action: 'accept' | 'decline') => {
      if (!userProfile) throw new Error('Please sign in first.');
      const result = await respondToFamilyInvite(userProfile, inviteId, action);
      setInvites((prev) => prev.filter((inv) => inv.id !== inviteId));
      await refreshFamilies();
      if (result.status === 'accepted' && result.familyId) {
        setActiveFamilyId(result.familyId);
      }
      return result;
    },
    [userProfile, refreshFamilies]
  );

  const joinByInviteCode = useCallback(
    async (code: string) => {
      if (!userProfile) throw new Error('Please sign in first.');
      const res = await joinFamilyByCode(userProfile, code);
      await refreshFamilies();
      if (res.familyId) {
        setActiveFamilyId(res.familyId);
      }
      return res;
    },
    [userProfile, refreshFamilies]
  );

  return {
    memberships,
    invites,
    activeFamilyId,
    setActiveFamilyId,
    activeMembership,
    familyBadgeCount,
    loading,
    refreshFamilies,
    createNewFamily,
    respondInvite,
    joinByInviteCode,
  };
}
