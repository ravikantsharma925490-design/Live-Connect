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

export function useFamilies(userProfile: Profile | null) {
  const [memberships, setMemberships] = useState<FamilyMembership[]>([]);
  const [invites, setInvites] = useState<FamilyInvite[]>([]);
  const [activeFamilyId, setActiveFamilyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const userId = userProfile?.id || null;
  const fetchingRef = useRef(false);

  const refreshFamilies = useCallback(async () => {
    if (!userId || fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const data = await listMyFamiliesAndInvites(userId);
      setMemberships(data.memberships || []);
      setInvites(data.invites || []);
    } catch {
      // Retain last known list on transient errors
    } finally {
      fetchingRef.current = false;
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setMemberships([]);
      setInvites([]);
      setActiveFamilyId(null);
      return;
    }

    setLoading(true);
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
          () => {
            refreshFamilies();
          }
        );
        unsubInvs = onSnapshot(
          query(collection(db, 'users', userId, 'family_invites'), where('status', '==', 'pending')),
          () => {
            refreshFamilies();
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
          total += m.unreadCount || 0;
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
      setMemberships((prev) => [membership, ...prev.filter((m) => m.familyId !== family.id)]);
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
