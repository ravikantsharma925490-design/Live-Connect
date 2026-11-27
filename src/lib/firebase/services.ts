import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  limit,
  orderBy,
  writeBatch,
  serverTimestamp,
  increment,
} from 'firebase/firestore';
import { deleteUser } from 'firebase/auth';
import {
  db,
  auth,
  FIREBASE_CONSTRAINTS,
  OperationType,
  handleFirestoreError,
  tsToIso,
  sanitizeStr,
  sanitizeOptionalStr,
  sanitizeUsername,
  isValidFirestoreId,
} from './client';
import {
  isOfflineOrUnavailableError,
  restGetDocument,
  restCommitWrites,
  RestWriteOperation,
} from './restFallback';
import {
  Profile,
  Conversation,
  Message,
  UserRelationStatus,
} from '@/src/types';
import { generateUUID, getDeterministicDirectConvId } from '@/src/lib/utils';

// ============================================================================
// MAPPERS
// ============================================================================

export function publicProfileDocToProfile(data: Record<string, any>, fallbackId?: string): Profile {
  const id = data.id || fallbackId || '';
  return {
    id,
    username: data.username || 'user',
    display_name: data.displayName || data.display_name || data.username || 'User',
    avatar_url: data.avatarUrl ?? data.avatar_url ?? null,
    bio: data.bio ?? null,
    gender: data.gender ?? null,
    country: data.country ?? null,
    is_online: Boolean(data.isOnline),
    last_seen: tsToIso(data.lastSeen),
    created_at: tsToIso(data.createdAt),
    updated_at: tsToIso(data.updatedAt),
  };
}

export function inboxMessageDocToMessage(data: Record<string, any>): Message {
  const createdAt = tsToIso(data.createdAt);
  const updatedAt = tsToIso(data.updatedAt, createdAt);
  return {
    id: data.id,
    conversation_id: data.conversationId,
    sender_id: data.senderId,
    content: data.content,
    created_at: createdAt,
    updated_at: updatedAt,
    is_read: Boolean(data.isRead),
    reply_to_message_id: data.replyToMessageId || null,
    reactions: data.reactions || undefined,
    mentions: Array.isArray(data.mentions) ? data.mentions : undefined,
    sender: data.senderDisplayName || data.senderUsername
      ? {
          id: data.senderId,
          username: data.senderUsername || 'user',
          display_name: data.senderDisplayName || data.senderUsername || 'User',
          avatar_url: data.senderAvatarUrl || null,
          bio: null,
          is_online: false,
          last_seen: createdAt,
          created_at: createdAt,
          updated_at: updatedAt,
        }
      : undefined,
  };
}

export function buildConversationFromDocs(
  convId: string,
  inboxData: Record<string, any>,
  convData?: Record<string, any> | null,
  memberProfiles?: Record<string, Profile>,
  lastMessageIsRead?: boolean
): Conversation {
  const memberRoles: Record<string, 'admin' | 'member'> | undefined = convData?.memberRoles || undefined;
  const memberIds = memberRoles ? Object.keys(memberRoles) : undefined;

  const createdAt = tsToIso(convData?.createdAt || inboxData.createdAt);
  const updatedAt = tsToIso(inboxData.updatedAt || convData?.updatedAt);

  let otherMember: Profile | undefined;
  if (inboxData.otherMemberId) {
    const resolved = memberProfiles?.[inboxData.otherMemberId];
    otherMember = resolved || {
      id: inboxData.otherMemberId,
      username: inboxData.otherUsername || 'user',
      display_name: inboxData.otherDisplayName || inboxData.otherUsername || 'User',
      avatar_url: inboxData.otherAvatarUrl || null,
      bio: null,
      is_online: false,
      last_seen: updatedAt,
      created_at: createdAt,
      updated_at: updatedAt,
    };
  }

  let lastMessage: Message | undefined;
  if (inboxData.lastMessageId && inboxData.lastMessageContent) {
    const lmAt = tsToIso(inboxData.lastMessageAt, updatedAt);
    const isLastFromOwner =
      Boolean(inboxData.lastMessageSenderId) &&
      Boolean(inboxData.ownerId) &&
      inboxData.lastMessageSenderId === inboxData.ownerId;
    lastMessage = {
      id: inboxData.lastMessageId,
      conversation_id: convId,
      sender_id: inboxData.lastMessageSenderId || '',
      content: inboxData.lastMessageContent,
      created_at: lmAt,
      updated_at: lmAt,
      is_read: isLastFromOwner
        ? Boolean(lastMessageIsRead)
        : (inboxData.unreadCount || 0) === 0,
    };
  }

  return {
    id: convId,
    type: 'direct',
    pinned_message_id: convData?.pinnedMessageId ?? null,
    created_at: createdAt,
    updated_at: updatedAt,
    other_member: otherMember,
    last_message: lastMessage,
    unread_count: typeof inboxData.unreadCount === 'number' ? inboxData.unreadCount : 0,
    member_ids: memberIds,
    members_meta: memberProfiles,
  };
}

// ============================================================================
// PROFILES, AUTH & USERNAMES
// ============================================================================

async function getDocDataWithRestFallback(
  docPath: string,
  ...pathSegments: [string, ...string[]]
): Promise<{ exists: boolean; data?: Record<string, any> }> {
  try {
    const snap = await getDoc(doc(db, ...pathSegments));
    return snap.exists() ? { exists: true, data: snap.data() } : { exists: false };
  } catch (err) {
    if (isOfflineOrUnavailableError(err)) {
      return await restGetDocument(docPath);
    }
    throw err;
  }
}

export async function fetchPublicProfileFs(userId: string, viewerId?: string): Promise<Profile | null> {
  if (!userId || !isValidFirestoreId(userId)) return null;
  const path = `public_profiles/${userId}`;
  try {
    if (viewerId && viewerId !== userId && isValidFirestoreId(viewerId)) {
      const [b1, b2] = await Promise.all([
        getDoc(doc(db, 'blocks', `${viewerId}_${userId}`)).catch(() => null),
        getDoc(doc(db, 'blocks', `${userId}_${viewerId}`)).catch(() => null),
      ]);
      if (b1?.exists() || b2?.exists()) {
        return null;
      }
    }
    const res = await getDocDataWithRestFallback(path, 'public_profiles', userId);
    if (!res.exists || !res.data) return null;
    return publicProfileDocToProfile(res.data, userId);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }
}

export async function fetchMultiplePublicProfilesFs(userIds: string[]): Promise<Record<string, Profile>> {
  const uniqueIds = Array.from(new Set(userIds.filter((id) => id && isValidFirestoreId(id))));
  const result: Record<string, Profile> = {};
  if (uniqueIds.length === 0) return result;

  await Promise.all(
    uniqueIds.map(async (uid) => {
      try {
        const p = await fetchPublicProfileFs(uid);
        if (p) result[uid] = p;
      } catch {
        // Skip unreadable/missing profile
      }
    })
  );
  return result;
}

export async function fetchPrivateUserInfoFs(userId: string): Promise<{
  email?: string | null;
  phoneNumber?: string | null;
  role: 'user' | 'admin';
  bannedUntil?: string | null;
} | null> {
  if (!userId || !isValidFirestoreId(userId)) return null;
  const path = `users/${userId}/private/info`;
  try {
    const res = await getDocDataWithRestFallback(path, 'users', userId, 'private', 'info');
    if (!res.exists || !res.data) return null;
    const d = res.data;
    return {
      email: d.email ?? null,
      phoneNumber: d.phoneNumber ?? null,
      role: d.role === 'admin' ? 'admin' : 'user',
      bannedUntil: d.bannedUntil ?? null,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }
}

export async function checkUsernameAvailabilityFs(
  rawUsername: string,
  excludeUserId?: string
): Promise<{ available: boolean; message?: string }> {
  const clean = sanitizeUsername(rawUsername);
  if (!clean || clean.length < 3) {
    return {
      available: false,
      message: 'Username must be at least 3 characters (letters, numbers, underscores only).',
    };
  }

  const path = `usernames/${clean}`;
  try {
    const res = await getDocDataWithRestFallback(path, 'usernames', clean);
    if (!res.exists) {
      return { available: true };
    }
    const existingUid = res.data?.uid;
    if (excludeUserId && existingUid === excludeUserId) {
      return { available: true };
    }
    return { available: false, message: 'This username is already taken.' };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }
}

export async function suggestUniqueUsernameFs(baseHint?: string): Promise<string> {
  const cleanBase = sanitizeUsername(baseHint || 'user').slice(0, 12);
  const base = cleanBase.length >= 3 ? cleanBase : 'user';

  const firstCheck = await checkUsernameAvailabilityFs(base).catch(() => ({ available: false }));
  if (firstCheck.available) return base;

  for (let i = 0; i < 6; i++) {
    const candidate = `${base}_${Math.floor(100 + Math.random() * 9000)}`.slice(0, 32);
    const check = await checkUsernameAvailabilityFs(candidate).catch(() => ({ available: false }));
    if (check.available) return candidate;
  }
  return `${base}_${Date.now().toString(36).slice(-4)}`.slice(0, 32);
}

export async function createOnboardingUserDocsFs(
  userId: string,
  email: string | undefined,
  details: {
    username: string;
    displayName: string;
    country?: string;
    bio?: string;
    gender: string;
    avatarUrl?: string;
  }
): Promise<Profile> {
  const cleanUsername = sanitizeUsername(details.username);
  if (!FIREBASE_CONSTRAINTS.USERNAME_REGEX.test(cleanUsername)) {
    throw new Error('Username must be 3-32 lowercase letters, numbers, or underscores.');
  }

  const avail = await checkUsernameAvailabilityFs(cleanUsername, userId);
  if (!avail.available) {
    throw new Error(avail.message || 'Username is already taken.');
  }

  const cleanDisplayName = sanitizeStr(details.displayName, FIREBASE_CONSTRAINTS.MAX_DISPLAY_NAME) || cleanUsername;
  const cleanAvatar = sanitizeOptionalStr(details.avatarUrl, FIREBASE_CONSTRAINTS.MAX_AVATAR_URL);
  const cleanBio = sanitizeOptionalStr(details.bio, FIREBASE_CONSTRAINTS.MAX_BIO);
  const cleanGender = sanitizeOptionalStr(details.gender, FIREBASE_CONSTRAINTS.MAX_GENDER);
  const cleanCountry = sanitizeOptionalStr(details.country, FIREBASE_CONSTRAINTS.MAX_COUNTRY);
  const cleanEmail = sanitizeOptionalStr(email, FIREBASE_CONSTRAINTS.MAX_EMAIL);

  const [existingUsernameRes, existingPublicRes, existingPrivateRes] = await Promise.all([
    getDocDataWithRestFallback(`usernames/${cleanUsername}`, 'usernames', cleanUsername).catch(
      () => ({ exists: false }) as { exists: boolean; data?: Record<string, any> }
    ),
    getDocDataWithRestFallback(`public_profiles/${userId}`, 'public_profiles', userId).catch(
      () => ({ exists: false }) as { exists: boolean; data?: Record<string, any> }
    ),
    getDocDataWithRestFallback(`users/${userId}/private/info`, 'users', userId, 'private', 'info').catch(
      () => ({ exists: false }) as { exists: boolean; data?: Record<string, any> }
    ),
  ]);

  if (existingUsernameRes.exists && existingUsernameRes.data?.uid !== userId) {
    throw new Error('This username is already taken.');
  }

  const batch = writeBatch(db);
  const restOps: RestWriteOperation[] = [];

  if (!existingUsernameRes.exists) {
    batch.set(doc(db, 'usernames', cleanUsername), {
      uid: userId,
      username: cleanUsername,
      createdAt: serverTimestamp(),
    });
    restOps.push({
      type: 'set',
      path: `usernames/${cleanUsername}`,
      data: {
        uid: userId,
        username: cleanUsername,
      },
      serverTimestampFields: ['createdAt'],
    });
  }

  if (existingPublicRes.exists) {
    batch.update(doc(db, 'public_profiles', userId), {
      username: cleanUsername,
      displayName: cleanDisplayName,
      avatarUrl: cleanAvatar,
      bio: cleanBio,
      gender: cleanGender,
      country: cleanCountry,
      isOnline: true,
      lastSeen: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    restOps.push({
      type: 'update',
      path: `public_profiles/${userId}`,
      data: {
        username: cleanUsername,
        displayName: cleanDisplayName,
        avatarUrl: cleanAvatar,
        bio: cleanBio,
        gender: cleanGender,
        country: cleanCountry,
        isOnline: true,
      },
      serverTimestampFields: ['lastSeen', 'updatedAt'],
    });
  } else {
    batch.set(doc(db, 'public_profiles', userId), {
      id: userId,
      username: cleanUsername,
      displayName: cleanDisplayName,
      avatarUrl: cleanAvatar,
      bio: cleanBio,
      gender: cleanGender,
      country: cleanCountry,
      isOnline: true,
      isPublic: true,
      lastSeen: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    restOps.push({
      type: 'set',
      path: `public_profiles/${userId}`,
      data: {
        id: userId,
        username: cleanUsername,
        displayName: cleanDisplayName,
        avatarUrl: cleanAvatar,
        bio: cleanBio,
        gender: cleanGender,
        country: cleanCountry,
        isOnline: true,
        isPublic: true,
      },
      serverTimestampFields: ['lastSeen', 'createdAt', 'updatedAt'],
    });
  }

  if (existingPrivateRes.exists) {
    batch.update(doc(db, 'users', userId, 'private', 'info'), {
      email: cleanEmail,
      updatedAt: serverTimestamp(),
    });
    restOps.push({
      type: 'update',
      path: `users/${userId}/private/info`,
      data: {
        email: cleanEmail,
      },
      serverTimestampFields: ['updatedAt'],
    });
  } else {
    batch.set(doc(db, 'users', userId, 'private', 'info'), {
      id: userId,
      email: cleanEmail,
      phoneNumber: null,
      role: 'user',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    restOps.push({
      type: 'set',
      path: `users/${userId}/private/info`,
      data: {
        id: userId,
        email: cleanEmail,
        phoneNumber: null,
        role: 'user',
      },
      serverTimestampFields: ['createdAt', 'updatedAt'],
    });
  }

  try {
    await batch.commit();
  } catch (err) {
    if (isOfflineOrUnavailableError(err)) {
      try {
        await restCommitWrites(restOps);
      } catch (restErr) {
        handleFirestoreError(restErr, OperationType.WRITE, `public_profiles/${userId}`);
      }
    } else {
      handleFirestoreError(err, OperationType.WRITE, `public_profiles/${userId}`);
    }
  }

  const saved = await fetchPublicProfileFs(userId);
  const nowIso = new Date().toISOString();
  return (
    saved || {
      id: userId,
      username: cleanUsername,
      display_name: cleanDisplayName,
      avatar_url: cleanAvatar,
      bio: cleanBio,
      gender: cleanGender,
      country: cleanCountry,
      email: cleanEmail,
      is_online: true,
      last_seen: nowIso,
      created_at: nowIso,
      updated_at: nowIso,
    }
  );
}

export async function updateUserProfileDocsFs(
  userId: string,
  currentProfile: Profile | null,
  updates: Partial<Profile>
): Promise<Profile> {
  const path = `public_profiles/${userId}`;
  const batch = writeBatch(db);
  const restOps: RestWriteOperation[] = [];
  const publicPatch: Record<string, any> = {
    updatedAt: serverTimestamp(),
  };
  const restPublicData: Record<string, unknown> = {};
  const publicServerTsFields: string[] = ['updatedAt'];

  if (updates.username !== undefined) {
    const newUsername = sanitizeUsername(updates.username);
    if (!FIREBASE_CONSTRAINTS.USERNAME_REGEX.test(newUsername)) {
      throw new Error('Username must be 3-32 characters (letters, numbers, underscores).');
    }
    if (currentProfile?.username && newUsername !== currentProfile.username) {
      const check = await checkUsernameAvailabilityFs(newUsername, userId);
      if (!check.available) {
        throw new Error(check.message || 'Username is already taken.');
      }
      batch.delete(doc(db, 'usernames', currentProfile.username));
      batch.set(doc(db, 'usernames', newUsername), {
        uid: userId,
        username: newUsername,
        createdAt: serverTimestamp(),
      });
      restOps.push({
        type: 'delete',
        path: `usernames/${currentProfile.username}`,
      });
      restOps.push({
        type: 'set',
        path: `usernames/${newUsername}`,
        data: { uid: userId, username: newUsername },
        serverTimestampFields: ['createdAt'],
      });
    }
    publicPatch.username = newUsername;
    restPublicData.username = newUsername;
  }

  if (updates.display_name !== undefined) {
    const dn = sanitizeStr(updates.display_name, FIREBASE_CONSTRAINTS.MAX_DISPLAY_NAME);
    if (!dn) throw new Error('Display Name cannot be empty.');
    publicPatch.displayName = dn;
    restPublicData.displayName = dn;
  }
  if (updates.avatar_url !== undefined) {
    const av = sanitizeOptionalStr(updates.avatar_url, FIREBASE_CONSTRAINTS.MAX_AVATAR_URL);
    publicPatch.avatarUrl = av;
    restPublicData.avatarUrl = av;
  }
  if (updates.bio !== undefined) {
    const bioVal = sanitizeOptionalStr(updates.bio, FIREBASE_CONSTRAINTS.MAX_BIO);
    publicPatch.bio = bioVal;
    restPublicData.bio = bioVal;
  }
  if (updates.gender !== undefined) {
    const genderVal = sanitizeOptionalStr(updates.gender, FIREBASE_CONSTRAINTS.MAX_GENDER);
    publicPatch.gender = genderVal;
    restPublicData.gender = genderVal;
  }
  if (updates.country !== undefined) {
    const countryVal = sanitizeOptionalStr(updates.country, FIREBASE_CONSTRAINTS.MAX_COUNTRY);
    publicPatch.country = countryVal;
    restPublicData.country = countryVal;
  }
  if (updates.is_online !== undefined) {
    const onlineVal = Boolean(updates.is_online);
    publicPatch.isOnline = onlineVal;
    publicPatch.lastSeen = serverTimestamp();
    restPublicData.isOnline = onlineVal;
    publicServerTsFields.push('lastSeen');
  }

  batch.update(doc(db, 'public_profiles', userId), publicPatch);
  restOps.push({
    type: 'update',
    path: `public_profiles/${userId}`,
    data: restPublicData,
    serverTimestampFields: publicServerTsFields,
  });

  if (updates.email !== undefined || updates.phone_number !== undefined) {
    const privPatch: Record<string, any> = { updatedAt: serverTimestamp() };
    const restPrivData: Record<string, unknown> = {};
    if (updates.email !== undefined) {
      const emailVal = sanitizeOptionalStr(updates.email, FIREBASE_CONSTRAINTS.MAX_EMAIL);
      privPatch.email = emailVal;
      restPrivData.email = emailVal;
    }
    if (updates.phone_number !== undefined) {
      const phoneVal = sanitizeOptionalStr(updates.phone_number, FIREBASE_CONSTRAINTS.MAX_PHONE);
      privPatch.phoneNumber = phoneVal;
      restPrivData.phoneNumber = phoneVal;
    }
    batch.update(doc(db, 'users', userId, 'private', 'info'), privPatch);
    restOps.push({
      type: 'update',
      path: `users/${userId}/private/info`,
      data: restPrivData,
      serverTimestampFields: ['updatedAt'],
    });
  }

  try {
    await batch.commit();
  } catch (err) {
    if (isOfflineOrUnavailableError(err)) {
      try {
        await restCommitWrites(restOps);
      } catch (restErr) {
        handleFirestoreError(restErr, OperationType.UPDATE, path);
      }
    } else {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  }

  const refreshed = await fetchPublicProfileFs(userId);
  if (!refreshed) {
    throw new Error('Failed to reload updated profile.');
  }
  return refreshed;
}

export async function fetchBlockedUserIdsFs(userId: string): Promise<{
  blockedByMe: Set<string>;
  blockedByThem: Set<string>;
  allBlocked: Set<string>;
}> {
  const blockedByMe = new Set<string>();
  const blockedByThem = new Set<string>();
  if (!userId || !isValidFirestoreId(userId)) {
    return { blockedByMe, blockedByThem, allBlocked: new Set() };
  }

  try {
    const [byMeSnap, byThemSnap] = await Promise.all([
      getDocs(query(collection(db, 'blocks'), where('blockerId', '==', userId))),
      getDocs(query(collection(db, 'blocks'), where('blockedId', '==', userId))),
    ]);

    byMeSnap.forEach((docSnap) => {
      const targetId = docSnap.data()?.blockedId;
      if (targetId) blockedByMe.add(targetId);
    });
    byThemSnap.forEach((docSnap) => {
      const blockerId = docSnap.data()?.blockerId;
      if (blockerId) blockedByThem.add(blockerId);
    });
  } catch {
    // Non-fatal fallback: client hook listener still maintains real-time sets
  }

  return {
    blockedByMe,
    blockedByThem,
    allBlocked: new Set([...blockedByMe, ...blockedByThem]),
  };
}

export async function searchPublicProfilesFs(queryText: string, currentUserId: string): Promise<Profile[]> {
  const clean = queryText.trim().replace(/^@/, '').toLowerCase();
  const path = 'public_profiles';
  try {
    const [snap, { allBlocked }] = await Promise.all([
      getDocs(query(collection(db, 'public_profiles'), where('isPublic', '==', true), limit(100))),
      fetchBlockedUserIdsFs(currentUserId),
    ]);
    const results: Profile[] = [];
    snap.forEach((docSnap) => {
      const p = publicProfileDocToProfile(docSnap.data(), docSnap.id);
      if (p.id === currentUserId || allBlocked.has(p.id)) return;
      if (!clean) {
        results.push(p);
        return;
      }
      const matchUsername = p.username.toLowerCase().includes(clean);
      const matchDisplay = p.display_name.toLowerCase().includes(clean);
      const matchId = p.id.toLowerCase().includes(clean);
      if (matchUsername || matchDisplay || matchId) {
        results.push(p);
      }
    });
    return results;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

// ============================================================================
// SOCIAL RELATIONS (FOLLOWS & BLOCKS)
// ============================================================================

export async function fetchRelationStatusFs(userId: string, targetUserId: string): Promise<UserRelationStatus> {
  if (!userId || !targetUserId || userId === targetUserId) {
    return {
      isFollowing: false,
      isFollowedBy: false,
      isMutual: false,
      isBlockedByMe: false,
      isBlockedByThem: false,
      isBlocked: false,
      followersCount: 0,
      followingCount: 0,
    };
  }

  try {
    const [f1, f2, b1, b2] = await Promise.all([
      getDocDataWithRestFallback(`follows/${userId}_${targetUserId}`, 'follows', `${userId}_${targetUserId}`).catch(() => ({ exists: false })),
      getDocDataWithRestFallback(`follows/${targetUserId}_${userId}`, 'follows', `${targetUserId}_${userId}`).catch(() => ({ exists: false })),
      getDocDataWithRestFallback(`blocks/${userId}_${targetUserId}`, 'blocks', `${userId}_${targetUserId}`).catch(() => ({ exists: false })),
      getDocDataWithRestFallback(`blocks/${targetUserId}_${userId}`, 'blocks', `${targetUserId}_${userId}`).catch(() => ({ exists: false })),
    ]);

    const isBlockedByMe = Boolean(b1?.exists);
    const isBlockedByThem = Boolean(b2?.exists);
    const isBlocked = isBlockedByMe || isBlockedByThem;
    const isFollowing = !isBlocked && Boolean(f1?.exists);
    const isFollowedBy = !isBlocked && Boolean(f2?.exists);

    return {
      isFollowing,
      isFollowedBy,
      isMutual: isFollowing && isFollowedBy,
      isBlockedByMe,
      isBlockedByThem,
      isBlocked,
      followersCount: 0,
      followingCount: 0,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `follows/${userId}_${targetUserId}`);
  }
}

export async function followUserFs(
  userId: string,
  targetUserId: string,
  userMeta?: Profile | null,
  targetMeta?: Profile | null
): Promise<{
  isFollowedBy: boolean;
  isMutual: boolean;
  conversationId?: string | null;
  conversation?: Conversation | null;
}> {
  if (!userId || !targetUserId || userId === targetUserId) {
    throw new Error('You cannot follow yourself.');
  }
  const rel = await fetchRelationStatusFs(userId, targetUserId);
  if (rel.isBlocked) {
    throw new Error('Cannot follow this user.');
  }

  const followId = `${userId}_${targetUserId}`;
  const path = `follows/${followId}`;

  try {
    const followData = {
      id: followId,
      followerId: userId,
      followingId: targetUserId,
    };
    try {
      await setDoc(doc(db, 'follows', followId), {
        ...followData,
        createdAt: serverTimestamp(),
      });
    } catch (writeErr) {
      if (isOfflineOrUnavailableError(writeErr)) {
        await restCommitWrites([
          {
            type: 'set',
            path,
            data: followData,
            serverTimestampFields: ['createdAt'],
          },
        ]);
      } else {
        throw writeErr;
      }
    }

    let isFollowedBy = false;
    const reverseSnap = await getDoc(doc(db, 'follows', `${targetUserId}_${userId}`)).catch(() => null);
    if (reverseSnap && reverseSnap.exists()) {
      isFollowedBy = true;
    } else {
      const restReverse = await restGetDocument(`follows/${targetUserId}_${userId}`).catch(() => ({
        exists: false,
      }));
      isFollowedBy = Boolean(restReverse.exists);
    }

    // Create follow/follow_back notification
    const notifId = `nf_${generateUUID().replace(/-/g, '').slice(0, 20)}`;
    const notifType = isFollowedBy ? 'follow_back' : 'follow';
    const actorName = userMeta?.display_name || userMeta?.username || 'Someone';
    await setDoc(doc(db, 'users', targetUserId, 'notifications', notifId), {
      id: notifId,
      userId: targetUserId,
      actorId: userId,
      actorDisplayName: sanitizeOptionalStr(userMeta?.display_name, 80),
      actorUsername: sanitizeOptionalStr(userMeta?.username, 32),
      actorAvatarUrl: sanitizeOptionalStr(userMeta?.avatar_url, 1024),
      type: notifType,
      title: isFollowedBy ? 'Mutual Follow!' : 'New Follower',
      message: isFollowedBy
        ? `${actorName} followed you back! You can now message and call each other.`
        : `${actorName} started following you.`,
      referenceId: userId,
      isRead: false,
      createdAt: serverTimestamp(),
    }).catch(() => {});

    let autoConv: Conversation | null = null;
    let convId: string | null = null;
    if (isFollowedBy) {
      convId = getDeterministicDirectConvId(userId, targetUserId);
      const nowIso = new Date().toISOString();
      const myProf: Profile =
        userMeta ||
        (await fetchPublicProfileFs(userId).catch(() => null)) || {
          id: userId,
          username: 'user',
          display_name: 'User',
          avatar_url: null,
          bio: null,
          is_online: true,
          last_seen: nowIso,
          created_at: nowIso,
          updated_at: nowIso,
        };
      const peerProf: Profile =
        targetMeta ||
        (await fetchPublicProfileFs(targetUserId, userId).catch(() => null)) || {
          id: targetUserId,
          username: 'user',
          display_name: 'User',
          avatar_url: null,
          bio: null,
          is_online: false,
          last_seen: nowIso,
          created_at: nowIso,
          updated_at: nowIso,
        };
      autoConv = await createOrGetDirectConversationFs(convId, myProf, peerProf).catch(() => null);
    }

    return {
      isFollowedBy,
      isMutual: isFollowedBy,
      conversationId: autoConv?.id || convId,
      conversation: autoConv,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function unfollowUserFs(userId: string, targetUserId: string): Promise<void> {
  const followId = `${userId}_${targetUserId}`;
  const path = `follows/${followId}`;
  try {
    await deleteDoc(doc(db, 'follows', followId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function blockUserFs(
  userId: string,
  targetUserId: string
): Promise<void> {
  if (!userId || !targetUserId || userId === targetUserId) {
    throw new Error('You cannot block yourself.');
  }
  const blockId = `${userId}_${targetUserId}`;
  const path = `blocks/${blockId}`;

  try {
    const batch = writeBatch(db);
    // Deterministic document ID {blockerId}_{blockedId} prevents duplicate entries
    batch.set(doc(db, 'blocks', blockId), {
      id: blockId,
      blockerId: userId,
      blockedId: targetUserId,
      createdAt: serverTimestamp(),
    });
    // Atomically remove both follow directions between A and B without notifying B
    batch.delete(doc(db, 'follows', `${userId}_${targetUserId}`));
    batch.delete(doc(db, 'follows', `${targetUserId}_${userId}`));
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function unblockUserFs(userId: string, targetUserId: string): Promise<void> {
  if (!userId || !targetUserId || userId === targetUserId) return;
  const blockId = `${userId}_${targetUserId}`;
  const path = `blocks/${blockId}`;
  try {
    // Only deletes the block entry; old follow connections are never restored
    await deleteDoc(doc(db, 'blocks', blockId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

// ============================================================================
// CONVERSATIONS
// ============================================================================

async function upsertPeerInboxOnMessage(
  peerId: string,
  convId: string,
  senderId: string,
  lastMessageId: string,
  lastMessageContent: string,
  inboxCreateExtras: {
    otherMemberId?: string;
    otherDisplayName?: string | null;
    otherUsername?: string | null;
    otherAvatarUrl?: string | null;
  }
) {
  const inboxPath = `users/${peerId}/inbox/${convId}`;
  const inboxRef = doc(db, 'users', peerId, 'inbox', convId);
  const preview = sanitizeStr(lastMessageContent, FIREBASE_CONSTRAINTS.MAX_LAST_MESSAGE_PREVIEW);

  const createPayload = {
    id: convId,
    ownerId: peerId,
    type: 'direct',
    ...(inboxCreateExtras.otherMemberId ? { otherMemberId: inboxCreateExtras.otherMemberId } : {}),
    ...(inboxCreateExtras.otherDisplayName !== undefined
      ? { otherDisplayName: sanitizeOptionalStr(inboxCreateExtras.otherDisplayName, 80) }
      : {}),
    ...(inboxCreateExtras.otherUsername !== undefined
      ? { otherUsername: sanitizeOptionalStr(inboxCreateExtras.otherUsername, 32) }
      : {}),
    ...(inboxCreateExtras.otherAvatarUrl !== undefined
      ? { otherAvatarUrl: sanitizeOptionalStr(inboxCreateExtras.otherAvatarUrl, 1024) }
      : {}),
    lastMessageId,
    lastMessageContent: preview,
    lastMessageSenderId: senderId,
    unreadCount: peerId === senderId ? 0 : 1,
    isRemoved: false,
  };

  try {
    await updateDoc(inboxRef, {
      lastMessageId,
      lastMessageContent: preview,
      lastMessageSenderId: senderId,
      lastMessageAt: serverTimestamp(),
      unreadCount: peerId === senderId ? 0 : increment(1),
      updatedAt: serverTimestamp(),
    });
  } catch (err: any) {
    const code = err?.code || '';
    const msg = String(err?.message || '');
    if (code === 'not-found' || msg.includes('No document to update')) {
      try {
        await setDoc(inboxRef, {
          ...createPayload,
          lastMessageAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (setErr) {
        if (isOfflineOrUnavailableError(setErr)) {
          await restCommitWrites([
            {
              type: 'set',
              path: inboxPath,
              data: createPayload,
              serverTimestampFields: ['lastMessageAt', 'createdAt', 'updatedAt'],
            },
          ]);
        } else {
          throw setErr;
        }
      }
    } else if (isOfflineOrUnavailableError(err)) {
      const existingRest = await restGetDocument(inboxPath).catch(() => ({ exists: false, data: undefined }));
      if (existingRest.exists) {
        const nextUnread = peerId === senderId ? 0 : Number(existingRest.data?.unreadCount || 0) + 1;
        await restCommitWrites([
          {
            type: 'update',
            path: inboxPath,
            data: {
              lastMessageId,
              lastMessageContent: preview,
              lastMessageSenderId: senderId,
              unreadCount: nextUnread,
            },
            updateMaskFields: [
              'lastMessageId',
              'lastMessageContent',
              'lastMessageSenderId',
              'lastMessageAt',
              'unreadCount',
              'updatedAt',
            ],
            serverTimestampFields: ['lastMessageAt', 'updatedAt'],
          },
        ]);
      } else {
        await restCommitWrites([
          {
            type: 'set',
            path: inboxPath,
            data: createPayload,
            serverTimestampFields: ['lastMessageAt', 'createdAt', 'updatedAt'],
          },
        ]);
      }
    } else {
      throw err;
    }
  }
}

export async function createOrGetDirectConversationFs(
  convId: string,
  currentUserProfile: Profile,
  targetProfile: Profile,
  options?: { skipRelationCheck?: boolean }
): Promise<Conversation> {
  const userId = currentUserProfile.id;
  const targetUserId = targetProfile.id;
  const isSelf = userId === targetUserId;

  if (!isSelf && !options?.skipRelationCheck) {
    const rel = await fetchRelationStatusFs(userId, targetUserId);
    if (rel.isBlocked) {
      throw new Error('Cannot start conversation with a blocked user.');
    }
  }

  const convRef = doc(db, 'conversations', convId);
  const existingConv = await getDocDataWithRestFallback(`conversations/${convId}`, 'conversations', convId).catch(
    () => ({ exists: false })
  );
  const convExists = Boolean(existingConv.exists);

  if (!convExists) {
    const memberRoles: Record<string, 'admin' | 'member'> = isSelf
      ? { [userId]: 'admin' }
      : { [userId]: 'admin', [targetUserId]: 'member' };

    const convData = {
      id: convId,
      type: 'direct',
      ownerId: userId,
      memberRoles,
    };
    const myMemberData = {
      userId,
      conversationId: convId,
      role: 'admin',
      displayName: sanitizeOptionalStr(currentUserProfile.display_name, 80),
      username: sanitizeOptionalStr(currentUserProfile.username, 32),
      avatarUrl: sanitizeOptionalStr(currentUserProfile.avatar_url, 1024),
    };
    const targetMemberData = {
      userId: targetUserId,
      conversationId: convId,
      role: 'member',
      displayName: sanitizeOptionalStr(targetProfile.display_name, 80),
      username: sanitizeOptionalStr(targetProfile.username, 32),
      avatarUrl: sanitizeOptionalStr(targetProfile.avatar_url, 1024),
    };
    const myInboxData = {
      id: convId,
      ownerId: userId,
      type: 'direct',
      otherMemberId: targetUserId,
      otherDisplayName: sanitizeOptionalStr(targetProfile.display_name, 80),
      otherUsername: sanitizeOptionalStr(targetProfile.username, 32),
      otherAvatarUrl: sanitizeOptionalStr(targetProfile.avatar_url, 1024),
      unreadCount: 0,
      isRemoved: false,
    };
    const targetInboxData = {
      id: convId,
      ownerId: targetUserId,
      type: 'direct',
      otherMemberId: userId,
      otherDisplayName: sanitizeOptionalStr(currentUserProfile.display_name, 80),
      otherUsername: sanitizeOptionalStr(currentUserProfile.username, 32),
      otherAvatarUrl: sanitizeOptionalStr(currentUserProfile.avatar_url, 1024),
      unreadCount: 0,
      isRemoved: false,
    };

    const batch = writeBatch(db);
    const restOps: RestWriteOperation[] = [];

    batch.set(convRef, {
      ...convData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    restOps.push({
      type: 'set',
      path: `conversations/${convId}`,
      data: convData,
      serverTimestampFields: ['createdAt', 'updatedAt'],
    });

    batch.set(doc(db, 'conversations', convId, 'members', userId), {
      ...myMemberData,
      joinedAt: serverTimestamp(),
    });
    restOps.push({
      type: 'set',
      path: `conversations/${convId}/members/${userId}`,
      data: myMemberData,
      serverTimestampFields: ['joinedAt'],
    });

    if (!isSelf) {
      batch.set(doc(db, 'conversations', convId, 'members', targetUserId), {
        ...targetMemberData,
        joinedAt: serverTimestamp(),
      });
      restOps.push({
        type: 'set',
        path: `conversations/${convId}/members/${targetUserId}`,
        data: targetMemberData,
        serverTimestampFields: ['joinedAt'],
      });
    }

    batch.set(doc(db, 'users', userId, 'inbox', convId), {
      ...myInboxData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    restOps.push({
      type: 'set',
      path: `users/${userId}/inbox/${convId}`,
      data: myInboxData,
      serverTimestampFields: ['createdAt', 'updatedAt'],
    });

    if (!isSelf) {
      batch.set(doc(db, 'users', targetUserId, 'inbox', convId), {
        ...targetInboxData,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      restOps.push({
        type: 'set',
        path: `users/${targetUserId}/inbox/${convId}`,
        data: targetInboxData,
        serverTimestampFields: ['createdAt', 'updatedAt'],
      });
    }

    try {
      await batch.commit();
    } catch (err) {
      if (isOfflineOrUnavailableError(err)) {
        await restCommitWrites(restOps);
      } else {
        handleFirestoreError(err, OperationType.WRITE, `conversations/${convId}`);
      }
    }
  } else {
    // Ensure both participants have their inbox entries restored if previously deleted or missing
    const ensureInboxEntry = async (
      inboxOwnerId: string,
      peerProfile: Profile
    ) => {
      const inboxPath = `users/${inboxOwnerId}/inbox/${convId}`;
      const inboxRef = doc(db, 'users', inboxOwnerId, 'inbox', convId);
      const snap = await getDoc(inboxRef).catch(() => null);
      let exists = Boolean(snap && snap.exists());
      if (!exists) {
        const restInbox = await restGetDocument(inboxPath).catch(() => ({ exists: false }));
        exists = Boolean(restInbox.exists);
      }

      if (!exists) {
        const restoreData = {
          id: convId,
          ownerId: inboxOwnerId,
          type: 'direct',
          otherMemberId: peerProfile.id,
          otherDisplayName: sanitizeOptionalStr(peerProfile.display_name, 80),
          otherUsername: sanitizeOptionalStr(peerProfile.username, 32),
          otherAvatarUrl: sanitizeOptionalStr(peerProfile.avatar_url, 1024),
          unreadCount: 0,
          isRemoved: false,
        };
        try {
          await setDoc(inboxRef, {
            ...restoreData,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          if (isOfflineOrUnavailableError(err)) {
            await restCommitWrites([
              {
                type: 'set',
                path: inboxPath,
                data: restoreData,
                serverTimestampFields: ['createdAt', 'updatedAt'],
              },
            ]);
          } else {
            throw err;
          }
        }
      }
    };

    await ensureInboxEntry(userId, targetProfile);
    if (!isSelf) {
      await ensureInboxEntry(targetUserId, currentUserProfile).catch(() => {});
    }
  }

  const nowIso = new Date().toISOString();
  return {
    id: convId,
    type: 'direct',
    created_at: nowIso,
    updated_at: nowIso,
    other_member: targetProfile,
    unread_count: 0,
    member_ids: isSelf ? [userId] : [userId, targetUserId],
  };
}

// ============================================================================
// MESSAGING
// ============================================================================

export async function sendMessageToFirestoreFs(params: {
  messageId?: string;
  conversationId: string;
  content: string;
  senderProfile: Profile;
  receiverId?: string;
  receiverProfile?: Profile;
  replyToMessageId?: string | null;
  mentions?: string[];
  mediaType?: string | null;
  cloudinaryPublicId?: string | null;
  b2FileId?: string | null;
  b2FileName?: string | null;
}): Promise<Message> {
  const {
    messageId = generateUUID(),
    conversationId,
    content,
    senderProfile,
    receiverId,
    receiverProfile,
    replyToMessageId,
    mentions,
    mediaType,
    cloudinaryPublicId,
    b2FileId,
    b2FileName,
  } = params;

  const senderId = senderProfile.id;
  const cleanContent = sanitizeStr(content, FIREBASE_CONSTRAINTS.MAX_MESSAGE_CONTENT);
  if (!cleanContent) throw new Error('Message content cannot be empty.');

  const isPeerChat = Boolean(receiverId && receiverId !== senderId);

  // Parallelize relation verification, conversation metadata lookup, and peer profile lookup
  const [rel, convLookup, resolvedPeerProf] = await Promise.all([
    isPeerChat && receiverId ? fetchRelationStatusFs(senderId, receiverId) : Promise.resolve(null),
    getDocDataWithRestFallback(`conversations/${conversationId}`, 'conversations', conversationId).catch(() => ({
      exists: false,
      data: undefined,
    })),
    isPeerChat && receiverId
      ? receiverProfile
        ? Promise.resolve(receiverProfile)
        : fetchPublicProfileFs(receiverId)
      : Promise.resolve(senderProfile),
  ]);

  if (isPeerChat && rel) {
    if (rel.isBlocked) {
      throw new Error('Messaging is unavailable because one of you has blocked the other.');
    }
    if (!rel.isMutual) {
      throw new Error('Follow each other to start messaging.');
    }
  }

  if (isPeerChat && !resolvedPeerProf) {
    throw new Error('Recipient profile not found.');
  }

  let convData: Record<string, any> | undefined = convLookup.exists ? convLookup.data : undefined;

  if (!convLookup.exists) {
    await createOrGetDirectConversationFs(
      conversationId,
      senderProfile,
      resolvedPeerProf || senderProfile,
      { skipRelationCheck: true }
    );
    convData = {
      id: conversationId,
      type: 'direct',
      ownerId: senderId,
      memberRoles:
        isPeerChat && receiverId
          ? { [senderId]: 'admin', [receiverId]: 'member' }
          : { [senderId]: 'admin' },
    };
  }

  const defaultRoles: Record<string, 'admin' | 'member'> =
    receiverId && receiverId !== senderId
      ? { [senderId]: 'admin', [receiverId]: 'member' }
      : { [senderId]: 'admin' };
  const memberRoles: Record<string, 'admin' | 'member'> = convData?.memberRoles || defaultRoles;
  const memberIds = Object.keys(memberRoles);
  if (!memberIds.includes(senderId)) {
    throw new Error('You are no longer a member of this conversation.');
  }

  // 1. Write message to each participant's inbox subcollection in one atomic batch
  const msgBatch = writeBatch(db);
  const msgRestOps: RestWriteOperation[] = [];
  const cleanMentions = Array.isArray(mentions)
    ? mentions.filter((m): m is string => typeof m === 'string').slice(0, 20)
    : [];

  memberIds.forEach((mUid) => {
    const msgData = {
      id: messageId,
      conversationId,
      senderId,
      senderDisplayName: sanitizeOptionalStr(senderProfile.display_name, 80),
      senderUsername: sanitizeOptionalStr(senderProfile.username, 32),
      senderAvatarUrl: sanitizeOptionalStr(senderProfile.avatar_url, 1024),
      content: cleanContent,
      replyToMessageId: sanitizeOptionalStr(replyToMessageId, 128),
      reactions: {},
      mentions: cleanMentions,
      mediaType: sanitizeOptionalStr(mediaType, 32),
      cloudinaryPublicId: sanitizeOptionalStr(cloudinaryPublicId, 256),
      b2FileId: sanitizeOptionalStr(b2FileId, 256),
      b2FileName: sanitizeOptionalStr(b2FileName, 256),
      isRead: !isPeerChat && mUid === senderId,
    };

    msgBatch.set(doc(db, 'users', mUid, 'inbox', conversationId, 'messages', messageId), {
      ...msgData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    msgRestOps.push({
      type: 'set',
      path: `users/${mUid}/inbox/${conversationId}/messages/${messageId}`,
      data: msgData,
      serverTimestampFields: ['createdAt', 'updatedAt'],
    });
  });

  msgBatch.update(doc(db, 'conversations', conversationId), {
    updatedAt: serverTimestamp(),
  });
  msgRestOps.push({
    type: 'update',
    path: `conversations/${conversationId}`,
    data: {},
    updateMaskFields: ['updatedAt'],
    serverTimestampFields: ['updatedAt'],
  });

  try {
    await msgBatch.commit();
  } catch (err) {
    if (isOfflineOrUnavailableError(err)) {
      await restCommitWrites(msgRestOps);
    } else {
      handleFirestoreError(err, OperationType.WRITE, `users/${senderId}/inbox/${conversationId}/messages/${messageId}`);
    }
  }

  // 2 & 3. Update inbox previews & dispatch recipient notifications in parallel without delaying send return
  const postSendTasks: Promise<unknown>[] = memberIds.map((mUid) =>
    upsertPeerInboxOnMessage(mUid, conversationId, senderId, messageId, cleanContent, {
      otherMemberId: mUid === senderId ? receiverId || senderId : senderId,
      otherDisplayName: mUid !== senderId ? senderProfile.display_name : resolvedPeerProf?.display_name,
      otherUsername: mUid !== senderId ? senderProfile.username : resolvedPeerProf?.username,
      otherAvatarUrl: mUid !== senderId ? senderProfile.avatar_url : resolvedPeerProf?.avatar_url,
    }).catch(() => {})
  );

  if (!cleanContent.startsWith('[CALL_LOG:')) {
    const senderName = senderProfile.display_name || senderProfile.username || 'Someone';
    memberIds
      .filter((mUid) => mUid !== senderId)
      .forEach((mUid) => {
        const notifId = `nm_${generateUUID().replace(/-/g, '').slice(0, 20)}`;
        postSendTasks.push(
          setDoc(doc(db, 'users', mUid, 'notifications', notifId), {
            id: notifId,
            userId: mUid,
            actorId: senderId,
            actorDisplayName: sanitizeOptionalStr(senderProfile.display_name, 80),
            actorUsername: sanitizeOptionalStr(senderProfile.username, 32),
            actorAvatarUrl: sanitizeOptionalStr(senderProfile.avatar_url, 1024),
            type: 'message',
            title: `Message from ${senderName}`,
            message: cleanContent.slice(0, 200),
            referenceId: conversationId,
            isRead: false,
            createdAt: serverTimestamp(),
          }).catch(() => {})
        );
      });
  }

  void Promise.all(postSendTasks);

  const nowIso = new Date().toISOString();
  return {
    id: messageId,
    conversation_id: conversationId,
    sender_id: senderId,
    content: cleanContent,
    created_at: nowIso,
    updated_at: nowIso,
    sender: senderProfile,
    is_read: false,
    reply_to_message_id: replyToMessageId || null,
    mentions,
  };
}

export async function toggleMessageReactionFs(
  conversationId: string,
  messageId: string,
  emoji: string,
  userId: string,
  memberIds?: string[]
): Promise<Record<string, string[]>> {
  const myMsgRef = doc(db, 'users', userId, 'inbox', conversationId, 'messages', messageId);
  const mySnap = await getDoc(myMsgRef);
  if (!mySnap.exists()) return {};

  const existingReactions: Record<string, string[]> = { ...(mySnap.data().reactions || {}) };
  const currentUsers = Array.isArray(existingReactions[emoji]) ? [...existingReactions[emoji]] : [];
  if (currentUsers.includes(userId)) {
    const filtered = currentUsers.filter((id) => id !== userId);
    if (filtered.length > 0) {
      existingReactions[emoji] = filtered;
    } else {
      delete existingReactions[emoji];
    }
  } else {
    existingReactions[emoji] = [...currentUsers, userId];
  }

  let targets = memberIds && memberIds.length > 0 ? memberIds : [userId];
  if (!memberIds || memberIds.length === 0) {
    const convSnap = await getDoc(doc(db, 'conversations', conversationId)).catch(() => null);
    if (convSnap?.exists()) {
      targets = Object.keys(convSnap.data().memberRoles || {});
    }
  }

  const batch = writeBatch(db);
  targets.forEach((uid) => {
    batch.update(doc(db, 'users', uid, 'inbox', conversationId, 'messages', messageId), {
      reactions: existingReactions,
      updatedAt: serverTimestamp(),
    });
  });

  await batch.commit().catch(() => {
    // Fallback to updating own copy if a peer already deleted theirs
    return updateDoc(myMsgRef, {
      reactions: existingReactions,
      updatedAt: serverTimestamp(),
    });
  });

  return existingReactions;
}

export async function deleteMessageForAllFs(conversationId: string, messageId: string): Promise<void> {
  const convSnap = await getDoc(doc(db, 'conversations', conversationId)).catch(() => null);
  const memberIds = convSnap?.exists()
    ? Object.keys(convSnap.data().memberRoles || {})
    : auth.currentUser
    ? [auth.currentUser.uid]
    : [];

  await Promise.all(
    memberIds.map((uid) =>
      deleteDoc(doc(db, 'users', uid, 'inbox', conversationId, 'messages', messageId)).catch(() => {})
    )
  );
}

export async function clearUserInboxMessagesFs(conversationId: string, userId: string): Promise<void> {
  const path = `users/${userId}/inbox/${conversationId}/messages`;
  try {
    const snap = await getDocs(collection(db, 'users', userId, 'inbox', conversationId, 'messages'));
    const docs = snap.docs;
    for (let i = 0; i < docs.length; i += 400) {
      const batch = writeBatch(db);
      docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
    await updateDoc(doc(db, 'users', userId, 'inbox', conversationId), {
      lastMessageId: null,
      lastMessageContent: null,
      lastMessageSenderId: null,
      lastMessageAt: null,
      unreadCount: 0,
      updatedAt: serverTimestamp(),
    }).catch(() => {});
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function pinConversationMessageFs(
  conversationId: string,
  messageId: string | null
): Promise<void> {
  if (!conversationId || !isValidFirestoreId(conversationId)) return;
  const path = `conversations/${conversationId}`;
  const cleanPinnedId = messageId ? sanitizeOptionalStr(messageId, 128) : null;

  try {
    await updateDoc(doc(db, 'conversations', conversationId), {
      pinnedMessageId: cleanPinnedId,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    if (isOfflineOrUnavailableError(err)) {
      try {
        await restCommitWrites([
          {
            type: 'update',
            path,
            data: { pinnedMessageId: cleanPinnedId },
            updateMaskFields: ['pinnedMessageId', 'updatedAt'],
            serverTimestampFields: ['updatedAt'],
          },
        ]);
      } catch (restErr) {
        handleFirestoreError(restErr, OperationType.UPDATE, path);
      }
    } else {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  }
}

export async function markMessagesAsReadFs(conversationId: string, readerId: string): Promise<void> {
  try {
    // Zero out own inbox unread counter
    await updateDoc(doc(db, 'users', readerId, 'inbox', conversationId), {
      unreadCount: 0,
      updatedAt: serverTimestamp(),
    }).catch(() => {});

    // Mark unread incoming messages as read in reader's inbox & notify senders' inboxes
    const unreadQuery = query(
      collection(db, 'users', readerId, 'inbox', conversationId, 'messages'),
      where('isRead', '==', false)
    );
    const snap = await getDocs(unreadQuery);
    const unreadFromPeers = snap.docs.filter((d) => d.data().senderId !== readerId);
    if (unreadFromPeers.length === 0) return;

    const readerBatch = writeBatch(db);
    const convSnap = await getDoc(doc(db, 'conversations', conversationId)).catch(() => null);
    const memberIds = convSnap?.exists() ? Object.keys(convSnap.data().memberRoles || {}) : [readerId];
    const senderUpdates: Promise<unknown>[] = [];

    unreadFromPeers.slice(0, 150).forEach((d) => {
      const senderId = d.data().senderId;
      readerBatch.update(d.ref, { isRead: true, updatedAt: serverTimestamp() });
      if (senderId && senderId !== readerId && memberIds.includes(senderId)) {
        senderUpdates.push(
          updateDoc(doc(db, 'users', senderId, 'inbox', conversationId, 'messages', d.id), {
            isRead: true,
            updatedAt: serverTimestamp(),
          }).catch(() => {})
        );
      }
    });

    await Promise.all([
      readerBatch.commit().catch(() => {}),
      ...senderUpdates,
    ]);
  } catch {
    // Silent read-receipt update
  }
}

// ============================================================================
// SUPPORT REPORTS & ACCOUNT DELETION
// ============================================================================

export async function submitProblemReportFs(
  userId: string,
  category: string,
  description: string
): Promise<string> {
  const reportId = `rep_${generateUUID().replace(/-/g, '').slice(0, 20)}`;
  const path = `problem_reports/${reportId}`;
  try {
    await setDoc(doc(db, 'problem_reports', reportId), {
      id: reportId,
      userId,
      category: sanitizeStr(category, FIREBASE_CONSTRAINTS.MAX_REPORT_CATEGORY) || 'other',
      description: sanitizeStr(description, FIREBASE_CONSTRAINTS.MAX_REPORT_DESC) || 'No details provided',
      status: 'submitted',
      createdAt: serverTimestamp(),
    });
    return reportId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function submitUserReportFs(params: {
  reportId?: string;
  reporterId: string;
  reportedUserId: string;
  reportedUsername?: string | null;
  reportedDisplayName?: string | null;
  category: string;
  details?: string | null;
  source: 'profile' | 'chat' | 'search' | 'call' | 'family_chat';
  conversationId?: string | null;
  familyId?: string | null;
  familyName?: string | null;
  reportedMessageId?: string | null;
  reportedMessageContent?: string | null;
  reportedMessageMediaUrl?: string | null;
  alsoBlocked?: boolean;
}): Promise<{ reportId: string; skippedMissingPublicProfile?: boolean }> {
  const reportId =
    params.reportId && isValidFirestoreId(params.reportId)
      ? params.reportId
      : `urep_${generateUUID().replace(/-/g, '').slice(0, 20)}`;
  const path = `user_reports/${reportId}`;

  try {
    // Check if target user's public profile exists in Firestore before enforcing exists() rule
    const targetSnap = await getDoc(doc(db, 'public_profiles', params.reportedUserId)).catch(() => null);
    if (!targetSnap || !targetSnap.exists()) {
      return { reportId, skippedMissingPublicProfile: true };
    }

    const payload: Record<string, any> = {
      id: reportId,
      reporterId: params.reporterId,
      reportedUserId: params.reportedUserId,
      category: sanitizeStr(params.category, 64) || 'other',
      source: params.source || 'profile',
      alsoBlocked: Boolean(params.alsoBlocked),
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    const cleanUsername = sanitizeOptionalStr(params.reportedUsername, 32);
    if (cleanUsername) payload.reportedUsername = cleanUsername;

    const cleanDisplayName = sanitizeOptionalStr(params.reportedDisplayName, 80);
    if (cleanDisplayName) payload.reportedDisplayName = cleanDisplayName;

    const cleanDetails = sanitizeOptionalStr(params.details, 1000);
    if (cleanDetails) payload.details = cleanDetails;

    const cleanConvId = sanitizeOptionalStr(params.conversationId, 128);
    if (cleanConvId) payload.conversationId = cleanConvId;

    const cleanFamilyId = sanitizeOptionalStr(params.familyId, 128);
    if (cleanFamilyId) payload.familyId = cleanFamilyId;

    const cleanFamilyName = sanitizeOptionalStr(params.familyName, 120);
    if (cleanFamilyName) payload.familyName = cleanFamilyName;

    const cleanReportedMsgId = sanitizeOptionalStr(params.reportedMessageId, 128);
    if (cleanReportedMsgId) payload.reportedMessageId = cleanReportedMsgId;

    const cleanReportedMsgContent = sanitizeOptionalStr(params.reportedMessageContent, 1500);
    if (cleanReportedMsgContent) payload.reportedMessageContent = cleanReportedMsgContent;

    const cleanReportedMsgMediaUrl = sanitizeOptionalStr(params.reportedMessageMediaUrl, 1024);
    if (cleanReportedMsgMediaUrl) payload.reportedMessageMediaUrl = cleanReportedMsgMediaUrl;

    await setDoc(doc(db, 'user_reports', reportId), payload);
    return { reportId };
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function fetchMyUserReportsFs(reporterId: string): Promise<any[]> {
  const path = 'user_reports';
  try {
    const q = query(
      collection(db, 'user_reports'),
      where('reporterId', '==', reporterId),
      limit(50)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function deleteFirebaseAccountDataFs(userId: string): Promise<void> {
  const path = `public_profiles/${userId}`;
  try {
    const profSnap = await getDoc(doc(db, 'public_profiles', userId)).catch(() => null);
    const username = profSnap?.data()?.username;

    const batch = writeBatch(db);
    if (username) {
      batch.delete(doc(db, 'usernames', username));
    }
    batch.delete(doc(db, 'public_profiles', userId));
    batch.delete(doc(db, 'users', userId, 'private', 'info'));
    await batch.commit();

    // Clean up user notifications
    const notifSnap = await getDocs(collection(db, 'users', userId, 'notifications')).catch(() => null);
    if (notifSnap && !notifSnap.empty) {
      const nBatch = writeBatch(db);
      notifSnap.docs.forEach((d) => nBatch.delete(d.ref));
      await nBatch.commit().catch(() => {});
    }

    if (auth.currentUser && auth.currentUser.uid === userId) {
      await deleteUser(auth.currentUser).catch(() => {});
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}
