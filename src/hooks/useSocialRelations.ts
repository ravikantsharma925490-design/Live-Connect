import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { Profile, UserRelationStatus } from '@/src/types';
import { FollowStatus } from '@/src/components/profile/FollowButton';
import {
  loadLocalFollows,
  saveLocalFollows,
  saveCachedProfile,
  loadCachedProfiles,
  loadCachedFollowersList,
  saveCachedFollowersList,
  loadCachedFollowingList,
  saveCachedFollowingList,
  saveMultipleCachedProfiles,
} from '@/src/lib/social-cache';
import {
  db,
  auth,
  isFirebaseSessionActive,
  OperationType,
  handleFirestoreError,
} from '@/src/lib/firebase/client';
import {
  fetchRelationStatusFs,
  followUserFs,
  unfollowUserFs,
  blockUserFs,
  unblockUserFs,
  fetchMultiplePublicProfilesFs,
} from '@/src/lib/firebase/services';
import { getAuthHeaders } from '@/src/lib/authHeader';

export function useSocialRelations(currentProfile?: Profile | null) {
  const currentUserId = currentProfile?.id;
  const initialLocal = useMemo(() => {
    const loc = loadLocalFollows(currentUserId);
    const cachedFollowers = loadCachedFollowersList(currentUserId);
    const cachedFollowing = loadCachedFollowingList(currentUserId);
    const following = Array.from(new Set([...loc.following, ...cachedFollowing.map((p) => p.id)]));
    const followers = Array.from(new Set([...loc.followers, ...cachedFollowers.map((p) => p.id)]));
    return { following, followers };
  }, [currentUserId]);

  const [followingSet, setFollowingSet] = useState<Set<string>>(() => new Set(initialLocal.following));
  const [followerSet, setFollowerSet] = useState<Set<string>>(() => new Set(initialLocal.followers));
  const [blockedByMeSet, setBlockedByMeSet] = useState<Set<string>>(new Set());
  const [blockedByThemSet, setBlockedByThemSet] = useState<Set<string>>(new Set());
  const [countsMap, setCountsMap] = useState<Record<string, { followers: number; following: number }>>({});
  const [loading, setLoading] = useState<boolean>(
    () => !(initialLocal.following.length > 0 || initialLocal.followers.length > 0)
  );
  const inFlightRef = useRef<Set<string>>(new Set());
  const socialBusRef = useRef<BroadcastChannel | null>(null);

  // Synchronize relations from SQLite backend when not in a Firebase session
  const fetchRelations = useCallback(async () => {
    if (!currentUserId) {
      setFollowingSet(new Set());
      setFollowerSet(new Set());
      setBlockedByMeSet(new Set());
      setBlockedByThemSet(new Set());
      setLoading(false);
      return;
    }

    if (isFirebaseSessionActive(currentUserId)) {
      return;
    }

    try {
      const nextFollowing = new Set<string>();
      const nextFollowers = new Set<string>();
      const nextBlockedByMe = new Set<string>();
      const nextBlockedByThem = new Set<string>();
      const cMap: Record<string, { followers: number; following: number }> = {};
      let fetchedFromNetwork = false;

      const authHeaders = await getAuthHeaders();
      const [overviewResult, countsResult] = await Promise.allSettled([
        fetch('/api/relations/user-overview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({
            userId: currentUserId,
            username: currentProfile?.username,
          }),
        }).then((r) => (r.ok ? r.json() : null)),
        fetch('/api/relations/all-counts').then((r) => (r.ok ? r.json() : null)),
      ]);

      if (overviewResult.status === 'fulfilled' && overviewResult.value) {
        const sData = overviewResult.value;
        fetchedFromNetwork = true;
        if (Array.isArray(sData.following)) {
          sData.following.forEach((id: string) => nextFollowing.add(id));
        }
        if (Array.isArray(sData.followers)) {
          sData.followers.forEach((id: string) => nextFollowers.add(id));
        }
        if (Array.isArray(sData.blockedByMe)) {
          sData.blockedByMe.forEach((id: string) => nextBlockedByMe.add(id));
        }
        if (Array.isArray(sData.blockedByThem)) {
          sData.blockedByThem.forEach((id: string) => nextBlockedByThem.add(id));
        }
        if (Array.isArray(sData.followerProfiles)) {
          saveCachedFollowersList(currentUserId, sData.followerProfiles);
          saveMultipleCachedProfiles(sData.followerProfiles);
        }
        if (Array.isArray(sData.followingProfiles)) {
          saveCachedFollowingList(currentUserId, sData.followingProfiles);
          saveMultipleCachedProfiles(sData.followingProfiles);
        }
      }

      if (countsResult.status === 'fulfilled' && countsResult.value?.counts) {
        Object.entries(countsResult.value.counts).forEach(([uId, c]: [string, any]) => {
          cMap[uId] = { followers: c.followers || 0, following: c.following || 0 };
        });
      }

      if (!fetchedFromNetwork) {
        const local = loadLocalFollows(currentUserId);
        local.following.forEach((id) => nextFollowing.add(id));
        local.followers.forEach((id) => nextFollowers.add(id));
      } else {
        saveLocalFollows(currentUserId, {
          following: Array.from(nextFollowing),
          followers: Array.from(nextFollowers),
        });
      }

      cMap[currentUserId] = {
        followers: nextFollowers.size,
        following: nextFollowing.size,
      };

      setFollowingSet(nextFollowing);
      setFollowerSet(nextFollowers);
      setBlockedByMeSet(nextBlockedByMe);
      setBlockedByThemSet(nextBlockedByThem);
      setCountsMap(cMap);
    } catch (err: any) {
      console.warn('Notice loading social relations:', err.message);
    } finally {
      setLoading(false);
    }
  }, [currentUserId, currentProfile?.username]);

  useEffect(() => {
    if (!currentUserId) {
      setLoading(false);
      return;
    }

    if (isFirebaseSessionActive(currentUserId)) {
      const unsubFollowing = onSnapshot(
        query(collection(db, 'follows'), where('followerId', '==', currentUserId)),
        (snap) => {
          const next = new Set<string>();
          snap.forEach((d) => {
            const fid = d.data()?.followingId;
            if (fid) next.add(fid);
          });
          setFollowingSet(next);
          setCountsMap((prev) => ({
            ...prev,
            [currentUserId]: {
              followers: prev[currentUserId]?.followers || 0,
              following: next.size,
            },
          }));
          setLoading(false);
        },
        (err) => {
          if (!auth.currentUser) return;
          handleFirestoreError(err, OperationType.LIST, 'follows');
        }
      );

      const unsubFollowers = onSnapshot(
        query(collection(db, 'follows'), where('followingId', '==', currentUserId)),
        (snap) => {
          const next = new Set<string>();
          snap.forEach((d) => {
            const fid = d.data()?.followerId;
            if (fid) next.add(fid);
          });
          setFollowerSet(next);
          setCountsMap((prev) => ({
            ...prev,
            [currentUserId]: {
              followers: next.size,
              following: prev[currentUserId]?.following || 0,
            },
          }));
          setLoading(false);
        },
        (err) => {
          if (!auth.currentUser) return;
          handleFirestoreError(err, OperationType.LIST, 'follows');
        }
      );

      const unsubBlockedByMe = onSnapshot(
        query(collection(db, 'blocks'), where('blockerId', '==', currentUserId)),
        (snap) => {
          const next = new Set<string>();
          snap.forEach((d) => {
            const bid = d.data()?.blockedId;
            if (bid) next.add(bid);
          });
          setBlockedByMeSet(next);
        },
        (err) => {
          if (!auth.currentUser) return;
          handleFirestoreError(err, OperationType.LIST, 'blocks');
        }
      );

      const unsubBlockedByThem = onSnapshot(
        query(collection(db, 'blocks'), where('blockedId', '==', currentUserId)),
        (snap) => {
          const next = new Set<string>();
          snap.forEach((d) => {
            const bid = d.data()?.blockerId;
            if (bid) next.add(bid);
          });
          setBlockedByThemSet(next);
        },
        (err) => {
          if (!auth.currentUser) return;
          handleFirestoreError(err, OperationType.LIST, 'blocks');
        }
      );

      return () => {
        unsubFollowing();
        unsubFollowers();
        unsubBlockedByMe();
        unsubBlockedByThem();
      };
    }

    fetchRelations();

    if (typeof BroadcastChannel !== 'undefined') {
      const bus = new BroadcastChannel('liveconnect_social_sync');
      socialBusRef.current = bus;
      bus.onmessage = () => {
        fetchRelations();
      };
    }

    const pollInterval = setInterval(() => {
      fetchRelations();
    }, 1500);

    return () => {
      clearInterval(pollInterval);
      if (socialBusRef.current) {
        socialBusRef.current.close();
        socialBusRef.current = null;
      }
    };
  }, [currentUserId, fetchRelations]);

  // Authorization & status checks
  const isBlocked = useCallback(
    (targetUserId: string) => {
      if (!targetUserId) return false;
      return blockedByMeSet.has(targetUserId) || blockedByThemSet.has(targetUserId);
    },
    [blockedByMeSet, blockedByThemSet]
  );

  const isBlockedByMe = useCallback(
    (targetUserId: string) => {
      if (!targetUserId) return false;
      return blockedByMeSet.has(targetUserId);
    },
    [blockedByMeSet]
  );

  const isFollowing = useCallback(
    (targetUserId: string) => {
      if (!targetUserId) return false;
      if (isBlocked(targetUserId)) return false;
      return followingSet.has(targetUserId);
    },
    [followingSet, isBlocked]
  );

  const isFollowedBy = useCallback(
    (targetUserId: string) => {
      if (!targetUserId) return false;
      if (isBlocked(targetUserId)) return false;
      return followerSet.has(targetUserId);
    },
    [followerSet, isBlocked]
  );

  const isMutualFollow = useCallback(
    (targetUserId: string, userBId?: string): boolean => {
      const uA = userBId ? targetUserId : currentUserId;
      const uB = userBId ? userBId : targetUserId;
      if (!uA || !uB || uA === uB) return false;
      if (isBlocked(uB)) return false;

      if (uA === currentUserId) {
        let followsB = followingSet.has(uB);
        let bFollowsMe = followerSet.has(uB);
        if (!followsB || !bFollowsMe) {
          const cached = loadCachedProfiles();
          const p = cached[uB];
          if (p?.username) {
            if (!followsB && followingSet.has(p.username)) followsB = true;
            if (!bFollowsMe && followerSet.has(p.username)) bFollowsMe = true;
          }
        }
        return followsB && bFollowsMe;
      }
      return false;
    },
    [currentUserId, followingSet, followerSet, isBlocked]
  );

  const getFollowStatus = useCallback(
    (targetUserId: string): FollowStatus => {
      if (!targetUserId || !currentUserId || targetUserId === currentUserId) {
        return 'self';
      }
      if (isBlocked(targetUserId)) {
        return 'not_following';
      }

      let followsTarget = followingSet.has(targetUserId);
      let targetFollowsMe = followerSet.has(targetUserId);

      if (!followsTarget || !targetFollowsMe) {
        const cached = loadCachedProfiles();
        const p = cached[targetUserId];
        if (p?.username) {
          if (!followsTarget && followingSet.has(p.username)) followsTarget = true;
          if (!targetFollowsMe && followerSet.has(p.username)) targetFollowsMe = true;
        }
      }

      if (followsTarget && targetFollowsMe) {
        return 'mutual';
      }
      if (followsTarget) {
        return 'following';
      }
      if (targetFollowsMe) {
        return 'followed_by';
      }
      return 'not_following';
    },
    [currentUserId, followingSet, followerSet, isBlocked]
  );

  // Authoritative follow status
  const fetchRpcFollowStatus = useCallback(
    async (targetUserId: string): Promise<FollowStatus> => {
      if (!currentUserId || !targetUserId || currentUserId === targetUserId) return 'self';

      if (isFirebaseSessionActive(currentUserId)) {
        try {
          const status = await fetchRelationStatusFs(currentUserId, targetUserId);
          if (status.isMutual) return 'mutual';
          if (status.isFollowing) return 'following';
          if (status.isFollowedBy) return 'followed_by';
          return 'not_following';
        } catch {
          return getFollowStatus(targetUserId);
        }
      }

      try {
        const res = await fetch('/api/relations/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId, targetUserId }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.isMutual) return 'mutual';
          if (data.isFollowing) return 'following';
          if (data.isFollowedBy) return 'followed_by';
          return 'not_following';
        }
      } catch {
        // Fallback to local synchronous computation
      }
      return getFollowStatus(targetUserId);
    },
    [currentUserId, getFollowStatus]
  );

  const checkRpcMutualFollow = useCallback(
    async (userA: string, userB: string): Promise<boolean> => {
      if (!userA || !userB || userA === userB) return false;

      if (isFirebaseSessionActive(currentUserId)) {
        try {
          const status = await fetchRelationStatusFs(userA, userB);
          return status.isMutual;
        } catch {
          return isMutualFollow(userA, userB);
        }
      }

      try {
        const res = await fetch('/api/relations/check-mutual', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userA, userB }),
        });
        if (res.ok) {
          const data = await res.json();
          if (typeof data.isMutual === 'boolean') {
            return data.isMutual;
          }
        }
      } catch {
        // Fallback
      }
      return isMutualFollow(userA, userB);
    },
    [currentUserId, isMutualFollow]
  );

  const getRelationStatus = useCallback(
    (targetUserId: string): UserRelationStatus => {
      const isBlockedMe = blockedByMeSet.has(targetUserId);
      const isBlockedThem = blockedByThemSet.has(targetUserId);
      const blocked = isBlockedMe || isBlockedThem;

      const isSelf = targetUserId === currentUserId;
      let following = !blocked && (isSelf ? false : followingSet.has(targetUserId));
      let followed = !blocked && (isSelf ? false : followerSet.has(targetUserId));

      if (!following || !followed) {
        const cached = loadCachedProfiles();
        const p = cached[targetUserId];
        if (p?.username) {
          if (!following && followingSet.has(p.username)) following = true;
          if (!followed && followerSet.has(p.username)) followed = true;
        }
      }

      const mutual = following && followed;

      const baseCounts = countsMap[targetUserId];
      const targetFollowers = blocked
        ? 0
        : isSelf
        ? followerSet.size
        : typeof baseCounts?.followers === 'number'
        ? baseCounts.followers
        : following
        ? 1
        : 0;

      const targetFollowing = blocked
        ? 0
        : isSelf
        ? followingSet.size
        : typeof baseCounts?.following === 'number'
        ? baseCounts.following
        : followed
        ? 1
        : 0;

      return {
        isFollowing: following,
        isFollowedBy: followed,
        isMutual: mutual,
        isBlockedByMe: isBlockedMe,
        isBlockedByThem: isBlockedThem,
        isBlocked: blocked,
        followersCount: targetFollowers,
        followingCount: targetFollowing,
      };
    },
    [blockedByMeSet, blockedByThemSet, currentUserId, followingSet, followerSet, countsMap]
  );

  // 1. Follow User (or Follow Back)
  const followUser = useCallback(
    async (targetUser: Profile | string | any): Promise<boolean> => {
      const targetId =
        typeof targetUser === 'string'
          ? targetUser
          : targetUser?.id ||
            targetUser?.user_id ||
            targetUser?.follower_id ||
            targetUser?.following_id ||
            targetUser?.actor_id;

      if (!currentUserId || !targetId || currentUserId === targetId) {
        return false;
      }
      if (isBlocked(targetId)) {
        return false;
      }

      if (inFlightRef.current.has(targetId)) {
        return false;
      }
      inFlightRef.current.add(targetId);

      const previousFollowing = new Set(followingSet);
      const previousCounts = { ...countsMap };

      if (typeof targetUser === 'object' && targetUser !== null) {
        saveCachedProfile(targetUser);
      }
      setFollowingSet((prev) => {
        const next = new Set<string>(prev);
        next.add(targetId);
        saveLocalFollows(currentUserId, {
          following: Array.from(next),
          followers: Array.from(followerSet),
        });
        return next;
      });

      setCountsMap((prev) => {
        const curTarget = prev[targetId] || { followers: 0, following: 0 };
        const curMe = prev[currentUserId] || { followers: followerSet.size, following: followingSet.size };
        return {
          ...prev,
          [targetId]: { ...curTarget, followers: Math.max(1, curTarget.followers + 1) },
          [currentUserId]: { ...curMe, following: curMe.following + 1 },
        };
      });

      try {
        const targetMeta = typeof targetUser === 'object' && targetUser !== null ? targetUser : undefined;

        if (isFirebaseSessionActive(currentUserId)) {
          const data = await followUserFs(currentUserId, targetId, currentProfile, targetMeta);
          if (data?.isFollowedBy || data?.isMutual) {
            setFollowerSet((prev) => {
              const next = new Set<string>(prev);
              next.add(targetId);
              return next;
            });
            if (typeof window !== 'undefined') {
              window.dispatchEvent(
                new CustomEvent('liveconnect_conversation_created', {
                  detail: {
                    conversationId: data.conversationId,
                    conversation: data.conversation,
                    targetUserId: targetId,
                    targetProfile: targetMeta,
                  },
                })
              );
            }
          }
          return true;
        }

        const authHeaders = await getAuthHeaders();
        const res = await fetch('/api/relations/follow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({
            userId: currentUserId,
            targetUserId: targetId,
            userMeta: currentProfile,
            targetMeta,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data?.isFollowedBy || data?.isMutual) {
            setFollowerSet((prev: Set<string>) => {
              const next = new Set<string>(prev);
              next.add(targetId);
              saveLocalFollows(currentUserId, {
                following: [...Array.from(followingSet), targetId],
                followers: Array.from(next),
              });
              return next;
            });
            if (typeof window !== 'undefined') {
              window.dispatchEvent(
                new CustomEvent('liveconnect_conversation_created', {
                  detail: {
                    conversationId: data.conversationId,
                    conversation: data.conversation,
                    targetUserId: targetId,
                    targetProfile: targetMeta,
                  },
                })
              );
            }
          }
        }

        socialBusRef.current?.postMessage({ type: 'FOLLOW_UPDATED', userId: currentUserId, targetId });
        fetchRelations();
        return true;
      } catch {
        setFollowingSet(previousFollowing);
        setCountsMap(previousCounts);
        return false;
      } finally {
        inFlightRef.current.delete(targetId);
      }
    },
    [currentUserId, currentProfile, followerSet, followingSet, isBlocked, countsMap, fetchRelations]
  );

  // 2. Unfollow User
  const unfollowUser = useCallback(
    async (targetUser: Profile | string | any): Promise<boolean> => {
      const targetUserId =
        typeof targetUser === 'string'
          ? targetUser
          : targetUser?.id ||
            targetUser?.user_id ||
            targetUser?.follower_id ||
            targetUser?.following_id ||
            targetUser?.actor_id;

      if (!currentUserId || !targetUserId) return false;

      if (inFlightRef.current.has(targetUserId)) {
        return false;
      }
      inFlightRef.current.add(targetUserId);

      const previousFollowing = new Set(followingSet);
      const previousCounts = { ...countsMap };

      setFollowingSet((prev) => {
        const next = new Set<string>(prev);
        next.delete(targetUserId);
        saveLocalFollows(currentUserId, {
          following: Array.from(next),
          followers: Array.from(followerSet),
        });
        return next;
      });

      setCountsMap((prev) => {
        const curTarget = prev[targetUserId] || { followers: 1, following: 0 };
        const curMe = prev[currentUserId] || { followers: followerSet.size, following: followingSet.size };
        return {
          ...prev,
          [targetUserId]: { ...curTarget, followers: Math.max(0, curTarget.followers - 1) },
          [currentUserId]: { ...curMe, following: Math.max(0, curMe.following - 1) },
        };
      });

      try {
        if (isFirebaseSessionActive(currentUserId)) {
          await unfollowUserFs(currentUserId, targetUserId);
          return true;
        }

        await fetch('/api/relations/unfollow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUserId,
            targetUserId,
          }),
        });

        socialBusRef.current?.postMessage({ type: 'UNFOLLOW_UPDATED', userId: currentUserId, targetUserId });
        fetchRelations();
        return true;
      } catch {
        setFollowingSet(previousFollowing);
        setCountsMap(previousCounts);
        return false;
      } finally {
        inFlightRef.current.delete(targetUserId);
      }
    },
    [currentUserId, followerSet, followingSet, countsMap, fetchRelations]
  );

  // 3. Fetch Followers list (excluding blocked users)
  const fetchFollowersList = useCallback(
    async (userId: string): Promise<Profile[]> => {
      if (!userId || (userId !== currentUserId && isBlocked(userId))) return [];

      if (isFirebaseSessionActive(currentUserId)) {
        if (userId === currentUserId) {
          const visibleIds = Array.from<string>(followerSet).filter((id) => !isBlocked(id));
          const profilesMap = await fetchMultiplePublicProfilesFs(visibleIds);
          const list = Object.values(profilesMap).filter((u) => !isBlocked(u.id));
          saveCachedFollowersList(userId, list);
          saveMultipleCachedProfiles(list);
          return list;
        }
        return loadCachedFollowersList(userId).filter((u) => !isBlocked(u.id));
      }

      const cachedList = loadCachedFollowersList(userId).filter((u) => !isBlocked(u.id));
      try {
        const authHeaders = await getAuthHeaders();
        const sRes = await fetch('/api/relations/user-overview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ userId }),
        });
        if (sRes.ok) {
          const sData = await sRes.json();
          if (Array.isArray(sData.followerProfiles)) {
            const filtered = (sData.followerProfiles as Profile[]).filter((u) => !isBlocked(u.id));
            saveCachedFollowersList(userId, filtered);
            saveMultipleCachedProfiles(filtered);
            return filtered;
          }
        }
      } catch (err) {
        console.warn('Error fetching followers list:', err);
      }

      return cachedList;
    },
    [currentUserId, followerSet, isBlocked]
  );

  // 4. Fetch Following list (excluding blocked users)
  const fetchFollowingList = useCallback(
    async (userId: string): Promise<Profile[]> => {
      if (!userId || (userId !== currentUserId && isBlocked(userId))) return [];

      if (isFirebaseSessionActive(currentUserId)) {
        if (userId === currentUserId) {
          const visibleIds = Array.from<string>(followingSet).filter((id) => !isBlocked(id));
          const profilesMap = await fetchMultiplePublicProfilesFs(visibleIds);
          const list = Object.values(profilesMap).filter((u) => !isBlocked(u.id));
          saveCachedFollowingList(userId, list);
          saveMultipleCachedProfiles(list);
          return list;
        }
        return loadCachedFollowingList(userId).filter((u) => !isBlocked(u.id));
      }

      const cachedList = loadCachedFollowingList(userId).filter((u) => !isBlocked(u.id));
      try {
        const authHeaders = await getAuthHeaders();
        const sRes = await fetch('/api/relations/user-overview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ userId }),
        });
        if (sRes.ok) {
          const sData = await sRes.json();
          if (Array.isArray(sData.followingProfiles)) {
            const filtered = (sData.followingProfiles as Profile[]).filter((u) => !isBlocked(u.id));
            saveCachedFollowingList(userId, filtered);
            saveMultipleCachedProfiles(filtered);
            return filtered;
          }
        }
      } catch (err) {
        console.warn('Error fetching following list:', err);
      }

      return cachedList;
    },
    [currentUserId, followingSet, isBlocked]
  );

  // 5. Block User (removes follows in both directions; sends zero notifications to target)
  const blockUser = useCallback(
    async (targetUser: Profile): Promise<boolean> => {
      if (!currentUserId || !targetUser?.id || currentUserId === targetUser.id) {
        return false;
      }

      const targetId = targetUser.id;
      const prevBlockedByMe = new Set(blockedByMeSet);
      const prevFollowing = new Set(followingSet);
      const prevFollowers = new Set(followerSet);

      setBlockedByMeSet((prev) => new Set([...prev, targetId]));
      setFollowingSet((prev) => {
        const next = new Set(prev);
        next.delete(targetId);
        return next;
      });
      setFollowerSet((prev) => {
        const next = new Set(prev);
        next.delete(targetId);
        return next;
      });

      try {
        if (isFirebaseSessionActive(currentUserId)) {
          await blockUserFs(currentUserId, targetId);
          return true;
        }

        const authHeaders = await getAuthHeaders();
        const res = await fetch('/api/blocks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({
            userId: currentUserId,
            targetUserId: targetId,
          }),
        });

        if (!res.ok) {
          setBlockedByMeSet(prevBlockedByMe);
          setFollowingSet(prevFollowing);
          setFollowerSet(prevFollowers);
          return false;
        }

        socialBusRef.current?.postMessage({ type: 'BLOCK_UPDATED', userId: currentUserId, targetId });
        fetchRelations();
        return true;
      } catch {
        setBlockedByMeSet(prevBlockedByMe);
        setFollowingSet(prevFollowing);
        setFollowerSet(prevFollowers);
        return false;
      }
    },
    [currentUserId, blockedByMeSet, followingSet, followerSet, fetchRelations]
  );

  // 6. Unblock User (deletes block entry only; old follow connections are NOT restored)
  const unblockUser = useCallback(
    async (targetUserId: string): Promise<boolean> => {
      if (!currentUserId || !targetUserId) return false;

      const prevBlockedByMe = new Set(blockedByMeSet);
      setBlockedByMeSet((prev) => {
        const next = new Set(prev);
        next.delete(targetUserId);
        return next;
      });

      try {
        if (isFirebaseSessionActive(currentUserId)) {
          await unblockUserFs(currentUserId, targetUserId);
          return true;
        }

        const authHeaders = await getAuthHeaders();
        const res = await fetch(`/api/blocks/${encodeURIComponent(targetUserId)}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({
            userId: currentUserId,
            targetUserId,
          }),
        });

        if (!res.ok) {
          setBlockedByMeSet(prevBlockedByMe);
          return false;
        }

        socialBusRef.current?.postMessage({ type: 'UNBLOCK_UPDATED', userId: currentUserId, targetUserId });
        fetchRelations();
        return true;
      } catch {
        setBlockedByMeSet(prevBlockedByMe);
        return false;
      }
    },
    [currentUserId, blockedByMeSet, fetchRelations]
  );

  const getFollowersCount = useCallback(
    (userId: string): number => {
      if (!userId || (userId !== currentUserId && isBlocked(userId))) return 0;
      if (userId === currentUserId) {
        return Array.from(followerSet).filter((id) => !isBlocked(id)).length;
      }
      return countsMap[userId]?.followers || 0;
    },
    [currentUserId, followerSet, countsMap, isBlocked]
  );

  const getFollowingCount = useCallback(
    (userId: string): number => {
      if (!userId || (userId !== currentUserId && isBlocked(userId))) return 0;
      if (userId === currentUserId) {
        return Array.from(followingSet).filter((id) => !isBlocked(id)).length;
      }
      return countsMap[userId]?.following || 0;
    },
    [currentUserId, followingSet, countsMap, isBlocked]
  );

  return {
    loading,
    followingSet,
    followerSet,
    blockedByMeSet,
    blockedByThemSet,
    countsMap,
    followersCount: Array.from(followerSet).filter((id) => !isBlocked(id)).length,
    followingCount: Array.from(followingSet).filter((id) => !isBlocked(id)).length,
    isFollowing,
    isFollowedBy,
    isMutualFollow,
    getFollowStatus,
    fetchRpcFollowStatus,
    checkRpcMutualFollow,
    getFollowersCount,
    getFollowingCount,
    fetchFollowersList,
    fetchFollowingList,
    isBlocked,
    isBlockedByMe,
    getRelationStatus,
    followUser,
    unfollowUser,
    blockUser,
    unblockUser,
    refreshRelations: fetchRelations,
  };
}
