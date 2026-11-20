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
  deleteField,
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
  ConversationMember,
  Message,
  UserRelationStatus,
  RemovedMemberInfo,
} from '@/src/types';
import { generateUUID } from '@/src/lib/utils';

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
  memberProfiles?: Record<string, Profile>
): Conversation {
  const type = (convData?.type || inboxData.type || 'direct') as 'direct' | 'group';
  const memberRoles: Record<string, 'admin' | 'member'> | undefined = convData?.memberRoles || undefined;
  const memberIds = memberRoles ? Object.keys(memberRoles) : undefined;

  const createdAt = tsToIso(convData?.createdAt || inboxData.createdAt);
  const updatedAt = tsToIso(inboxData.updatedAt || convData?.updatedAt);

  let otherMember: Profile | undefined;
  if (type === 'direct' && inboxData.otherMemberId) {
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
    lastMessage = {
      id: inboxData.lastMessageId,
      conversation_id: convId,
      sender_id: inboxData.lastMessageSenderId || '',
      content: inboxData.lastMessageContent,
      created_at: lmAt,
      updated_at: lmAt,
      is_read: (inboxData.unreadCount || 0) === 0,
    };
  }

  let removalInfo: RemovedMemberInfo | null = null;
  if (inboxData.isRemoved) {
    removalInfo = {
      removed_at: inboxData.removedAt || updatedAt,
      removed_by: '',
      admin_name: inboxData.removalAdminName || 'Admin',
      admin_username: inboxData.removalAdminUsername || 'admin',
    };
  }

  return {
    id: convId,
    type,
    name: convData?.name ?? inboxData.name ?? null,
    description: convData?.description ?? inboxData.description ?? null,
    avatar_url: convData?.avatarUrl ?? inboxData.avatarUrl ?? null,
    owner_id: convData?.ownerId ?? inboxData.groupOwnerId ?? null,
    pinned_message_id: convData?.pinnedMessageId ?? null,
    created_at: createdAt,
    updated_at: updatedAt,
    other_member: otherMember,
    last_message: lastMessage,
    unread_count: typeof inboxData.unreadCount === 'number' ? inboxData.unreadCount : 0,
    member_ids: memberIds,
    member_roles: memberRoles,
    members_meta: memberProfiles,
    removed_members: convData?.removedMembers || undefined,
    is_removed: Boolean(inboxData.isRemoved),
    removal_info: removalInfo,
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

export async function fetchPublicProfileFs(userId: string): Promise<Profile | null> {
  if (!userId || !isValidFirestoreId(userId)) return null;
  const path = `public_profiles/${userId}`;
  try {
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

export async function searchPublicProfilesFs(queryText: string, currentUserId: string): Promise<Profile[]> {
  const clean = queryText.trim().replace(/^@/, '').toLowerCase();
  const path = 'public_profiles';
  try {
    const q = query(
      collection(db, 'public_profiles'),
      where('isPublic', '==', true),
      limit(100)
    );
    const snap = await getDocs(q);
    const results: Profile[] = [];
    snap.forEach((docSnap) => {
      const p = publicProfileDocToProfile(docSnap.data(), docSnap.id);
      if (p.id === currentUserId) return;
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
      getDoc(doc(db, 'follows', `${userId}_${targetUserId}`)).catch(() => null),
      getDoc(doc(db, 'follows', `${targetUserId}_${userId}`)).catch(() => null),
      getDoc(doc(db, 'blocks', `${userId}_${targetUserId}`)).catch(() => null),
      getDoc(doc(db, 'blocks', `${targetUserId}_${userId}`)).catch(() => null),
    ]);

    const isBlockedByMe = Boolean(b1?.exists());
    const isBlockedByThem = Boolean(b2?.exists());
    const isBlocked = isBlockedByMe || isBlockedByThem;
    const isFollowing = !isBlocked && Boolean(f1?.exists());
    const isFollowedBy = !isBlocked && Boolean(f2?.exists());

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
  userMeta?: Profile | null
): Promise<{ isFollowedBy: boolean; isMutual: boolean }> {
  const followId = `${userId}_${targetUserId}`;
  const path = `follows/${followId}`;

  try {
    await setDoc(doc(db, 'follows', followId), {
      id: followId,
      followerId: userId,
      followingId: targetUserId,
      createdAt: serverTimestamp(),
    });

    const reverseSnap = await getDoc(doc(db, 'follows', `${targetUserId}_${userId}`)).catch(() => null);
    const isFollowedBy = Boolean(reverseSnap?.exists());

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

    return { isFollowedBy, isMutual: isFollowedBy };
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
  targetUserId: string,
  reason?: string
): Promise<void> {
  const blockId = `${userId}_${targetUserId}`;
  const path = `blocks/${blockId}`;

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'blocks', blockId), {
      id: blockId,
      blockerId: userId,
      blockedId: targetUserId,
      reason: sanitizeOptionalStr(reason, 300),
      createdAt: serverTimestamp(),
    });
    // Clean up our follow link in same atomic batch
    batch.delete(doc(db, 'follows', `${userId}_${targetUserId}`));
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function unblockUserFs(userId: string, targetUserId: string): Promise<void> {
  const blockId = `${userId}_${targetUserId}`;
  const path = `blocks/${blockId}`;
  try {
    await deleteDoc(doc(db, 'blocks', blockId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

// ============================================================================
// CONVERSATIONS & GROUPS
// ============================================================================

async function upsertPeerInboxOnMessage(
  peerId: string,
  convId: string,
  senderId: string,
  convType: 'direct' | 'group',
  lastMessageId: string,
  lastMessageContent: string,
  inboxCreateExtras: {
    otherMemberId?: string;
    otherDisplayName?: string | null;
    otherUsername?: string | null;
    otherAvatarUrl?: string | null;
    name?: string | null;
    description?: string | null;
    avatarUrl?: string | null;
    groupOwnerId?: string | null;
    myRole?: 'admin' | 'member' | null;
  }
) {
  const inboxRef = doc(db, 'users', peerId, 'inbox', convId);
  try {
    await updateDoc(inboxRef, {
      lastMessageId,
      lastMessageContent: sanitizeStr(lastMessageContent, FIREBASE_CONSTRAINTS.MAX_LAST_MESSAGE_PREVIEW),
      lastMessageSenderId: senderId,
      lastMessageAt: serverTimestamp(),
      unreadCount: peerId === senderId ? 0 : increment(1),
      updatedAt: serverTimestamp(),
    });
  } catch (err: any) {
    const code = err?.code || '';
    const msg = String(err?.message || '');
    if (code === 'not-found' || msg.includes('No document to update')) {
      await setDoc(inboxRef, {
        id: convId,
        ownerId: peerId,
        type: convType,
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
        ...(inboxCreateExtras.name !== undefined
          ? { name: sanitizeOptionalStr(inboxCreateExtras.name, 100) }
          : {}),
        ...(inboxCreateExtras.description !== undefined
          ? { description: sanitizeOptionalStr(inboxCreateExtras.description, 500) }
          : {}),
        ...(inboxCreateExtras.avatarUrl !== undefined
          ? { avatarUrl: sanitizeOptionalStr(inboxCreateExtras.avatarUrl, 1024) }
          : {}),
        ...(inboxCreateExtras.groupOwnerId ? { groupOwnerId: inboxCreateExtras.groupOwnerId } : {}),
        ...(inboxCreateExtras.myRole ? { myRole: inboxCreateExtras.myRole } : {}),
        lastMessageId,
        lastMessageContent: sanitizeStr(lastMessageContent, FIREBASE_CONSTRAINTS.MAX_LAST_MESSAGE_PREVIEW),
        lastMessageSenderId: senderId,
        lastMessageAt: serverTimestamp(),
        unreadCount: peerId === senderId ? 0 : 1,
        isRemoved: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      throw err;
    }
  }
}

export async function createOrGetDirectConversationFs(
  convId: string,
  currentUserProfile: Profile,
  targetProfile: Profile
): Promise<Conversation> {
  const userId = currentUserProfile.id;
  const targetUserId = targetProfile.id;
  const isSelf = userId === targetUserId;

  const convRef = doc(db, 'conversations', convId);
  const existingConv = await getDoc(convRef).catch(() => null);

  if (!existingConv || !existingConv.exists()) {
    const memberRoles: Record<string, 'admin' | 'member'> = isSelf
      ? { [userId]: 'admin' }
      : { [userId]: 'admin', [targetUserId]: 'member' };

    const batch = writeBatch(db);
    batch.set(convRef, {
      id: convId,
      type: 'direct',
      ownerId: userId,
      memberRoles,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'conversations', convId, 'members', userId), {
      userId,
      conversationId: convId,
      role: 'admin',
      displayName: sanitizeOptionalStr(currentUserProfile.display_name, 80),
      username: sanitizeOptionalStr(currentUserProfile.username, 32),
      avatarUrl: sanitizeOptionalStr(currentUserProfile.avatar_url, 1024),
      joinedAt: serverTimestamp(),
    });

    if (!isSelf) {
      batch.set(doc(db, 'conversations', convId, 'members', targetUserId), {
        userId: targetUserId,
        conversationId: convId,
        role: 'member',
        displayName: sanitizeOptionalStr(targetProfile.display_name, 80),
        username: sanitizeOptionalStr(targetProfile.username, 32),
        avatarUrl: sanitizeOptionalStr(targetProfile.avatar_url, 1024),
        joinedAt: serverTimestamp(),
      });
    }

    // Create inbox items for both participants
    batch.set(doc(db, 'users', userId, 'inbox', convId), {
      id: convId,
      ownerId: userId,
      type: 'direct',
      otherMemberId: targetUserId,
      otherDisplayName: sanitizeOptionalStr(targetProfile.display_name, 80),
      otherUsername: sanitizeOptionalStr(targetProfile.username, 32),
      otherAvatarUrl: sanitizeOptionalStr(targetProfile.avatar_url, 1024),
      unreadCount: 0,
      isRemoved: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    if (!isSelf) {
      batch.set(doc(db, 'users', targetUserId, 'inbox', convId), {
        id: convId,
        ownerId: targetUserId,
        type: 'direct',
        otherMemberId: userId,
        otherDisplayName: sanitizeOptionalStr(currentUserProfile.display_name, 80),
        otherUsername: sanitizeOptionalStr(currentUserProfile.username, 32),
        otherAvatarUrl: sanitizeOptionalStr(currentUserProfile.avatar_url, 1024),
        unreadCount: 0,
        isRemoved: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `conversations/${convId}`);
    }
  } else {
    // Ensure current user has their inbox entry restored if they had previously deleted the chat
    const myInboxRef = doc(db, 'users', userId, 'inbox', convId);
    const myInboxSnap = await getDoc(myInboxRef).catch(() => null);
    if (!myInboxSnap || !myInboxSnap.exists()) {
      await setDoc(myInboxRef, {
        id: convId,
        ownerId: userId,
        type: 'direct',
        otherMemberId: targetUserId,
        otherDisplayName: sanitizeOptionalStr(targetProfile.display_name, 80),
        otherUsername: sanitizeOptionalStr(targetProfile.username, 32),
        otherAvatarUrl: sanitizeOptionalStr(targetProfile.avatar_url, 1024),
        unreadCount: 0,
        isRemoved: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  }

  const nowIso = new Date().toISOString();
  return {
    id: convId,
    type: 'direct',
    owner_id: userId,
    created_at: nowIso,
    updated_at: nowIso,
    other_member: targetProfile,
    unread_count: 0,
    member_ids: isSelf ? [userId] : [userId, targetUserId],
  };
}

export async function createGroupConversationFs(
  name: string,
  description: string,
  avatarUrl: string | null,
  memberIds: string[],
  creatorProfile: Profile
): Promise<Conversation> {
  const convId = `grp_${generateUUID().replace(/-/g, '').slice(0, 24)}`;
  const allMemberIds = Array.from(new Set([creatorProfile.id, ...memberIds.filter(Boolean)])).slice(0, 50);
  const profilesMap = await fetchMultiplePublicProfilesFs(allMemberIds);
  profilesMap[creatorProfile.id] = creatorProfile;

  const memberRoles: Record<string, 'admin' | 'member'> = {};
  allMemberIds.forEach((uid) => {
    memberRoles[uid] = uid === creatorProfile.id ? 'admin' : 'member';
  });

  const cleanName = sanitizeStr(name, FIREBASE_CONSTRAINTS.MAX_GROUP_NAME) || 'New Group';
  const cleanDesc = sanitizeOptionalStr(description, FIREBASE_CONSTRAINTS.MAX_GROUP_DESC);
  const cleanAvatar = sanitizeOptionalStr(avatarUrl, FIREBASE_CONSTRAINTS.MAX_AVATAR_URL);

  const batch = writeBatch(db);
  batch.set(doc(db, 'conversations', convId), {
    id: convId,
    type: 'group',
    name: cleanName,
    description: cleanDesc,
    avatarUrl: cleanAvatar,
    ownerId: creatorProfile.id,
    memberRoles,
    removedMembers: {},
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  allMemberIds.forEach((uid) => {
    const p = profilesMap[uid];
    const role = uid === creatorProfile.id ? 'admin' : 'member';
    batch.set(doc(db, 'conversations', convId, 'members', uid), {
      userId: uid,
      conversationId: convId,
      role,
      displayName: sanitizeOptionalStr(p?.display_name, 80),
      username: sanitizeOptionalStr(p?.username, 32),
      avatarUrl: sanitizeOptionalStr(p?.avatar_url, 1024),
      joinedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'users', uid, 'inbox', convId), {
      id: convId,
      ownerId: uid,
      type: 'group',
      name: cleanName,
      description: cleanDesc,
      avatarUrl: cleanAvatar,
      groupOwnerId: creatorProfile.id,
      myRole: role,
      unreadCount: 0,
      isRemoved: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `conversations/${convId}`);
  }

  // Send system creation message
  const sysMsgId = `sys_${generateUUID().replace(/-/g, '').slice(0, 20)}`;
  const sysContent = `[SYSTEM:${creatorProfile.display_name || creatorProfile.username} (@${creatorProfile.username}) created group "${cleanName}"]`;
  const msgBatch = writeBatch(db);
  allMemberIds.forEach((uid) => {
    msgBatch.set(doc(db, 'users', uid, 'inbox', convId, 'messages', sysMsgId), {
      id: sysMsgId,
      conversationId: convId,
      senderId: creatorProfile.id,
      senderDisplayName: sanitizeOptionalStr(creatorProfile.display_name, 80),
      senderUsername: sanitizeOptionalStr(creatorProfile.username, 32),
      senderAvatarUrl: sanitizeOptionalStr(creatorProfile.avatar_url, 1024),
      content: sysContent,
      isRead: uid === creatorProfile.id,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
  await msgBatch.commit().catch(() => {});

  const nowIso = new Date().toISOString();
  return {
    id: convId,
    type: 'group',
    name: cleanName,
    description: cleanDesc,
    avatar_url: cleanAvatar,
    owner_id: creatorProfile.id,
    member_roles: memberRoles,
    member_ids: allMemberIds,
    members_meta: profilesMap,
    unread_count: 0,
    created_at: nowIso,
    updated_at: nowIso,
  };
}

export async function fetchGroupDetailsFs(conversationId: string): Promise<Conversation | null> {
  const path = `conversations/${conversationId}`;
  try {
    const convSnap = await getDoc(doc(db, 'conversations', conversationId));
    if (!convSnap.exists()) return null;
    const convData = convSnap.data();
    const memberRoles: Record<string, 'admin' | 'member'> = convData.memberRoles || {};
    const memberIds = Object.keys(memberRoles);
    const membersMeta = await fetchMultiplePublicProfilesFs(memberIds);

    return {
      id: convSnap.id,
      type: convData.type || 'group',
      name: convData.name || null,
      description: convData.description || null,
      avatar_url: convData.avatarUrl || null,
      owner_id: convData.ownerId || null,
      member_roles: memberRoles,
      member_ids: memberIds,
      members_meta: membersMeta,
      removed_members: convData.removedMembers || undefined,
      pinned_message_id: convData.pinnedMessageId || null,
      created_at: tsToIso(convData.createdAt),
      updated_at: tsToIso(convData.updatedAt),
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }
}

export async function updateGroupInfoFs(
  conversationId: string,
  updates: { name: string; description?: string; avatarUrl?: string | null }
): Promise<Conversation | null> {
  const path = `conversations/${conversationId}`;
  const cleanName = sanitizeStr(updates.name, FIREBASE_CONSTRAINTS.MAX_GROUP_NAME);
  const cleanDesc = sanitizeOptionalStr(updates.description, FIREBASE_CONSTRAINTS.MAX_GROUP_DESC);
  const cleanAvatar = sanitizeOptionalStr(updates.avatarUrl, FIREBASE_CONSTRAINTS.MAX_AVATAR_URL);

  try {
    const convSnap = await getDoc(doc(db, 'conversations', conversationId));
    if (!convSnap.exists()) throw new Error('Group not found');
    const convData = convSnap.data();
    const memberIds = Object.keys(convData.memberRoles || {});

    const batch = writeBatch(db);
    batch.update(doc(db, 'conversations', conversationId), {
      name: cleanName,
      description: cleanDesc,
      avatarUrl: cleanAvatar,
      updatedAt: serverTimestamp(),
    });

    memberIds.forEach((uid) => {
      batch.update(doc(db, 'users', uid, 'inbox', conversationId), {
        name: cleanName,
        description: cleanDesc,
        avatarUrl: cleanAvatar,
        updatedAt: serverTimestamp(),
      });
    });

    await batch.commit();
    return await fetchGroupDetailsFs(conversationId);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function addGroupMembersFs(
  conversationId: string,
  actorProfile: Profile,
  newMemberIds: string[],
  profilesMap: Record<string, Profile>
): Promise<Conversation | null> {
  const path = `conversations/${conversationId}`;
  try {
    const convSnap = await getDoc(doc(db, 'conversations', conversationId));
    if (!convSnap.exists()) throw new Error('Group not found');
    const convData = convSnap.data();
    const currentRoles: Record<string, 'admin' | 'member'> = { ...(convData.memberRoles || {}) };
    const cleanToAdd = newMemberIds.filter((id) => id && !currentRoles[id]);
    if (cleanToAdd.length === 0) return await fetchGroupDetailsFs(conversationId);

    const updatedRoles = { ...currentRoles };
    const updatedRemoved = { ...(convData.removedMembers || {}) };
    cleanToAdd.forEach((uid) => {
      updatedRoles[uid] = 'member';
      delete updatedRemoved[uid];
    });

    const batch1 = writeBatch(db);
    batch1.update(doc(db, 'conversations', conversationId), {
      memberRoles: updatedRoles,
      removedMembers: updatedRemoved,
      updatedAt: serverTimestamp(),
    });

    cleanToAdd.forEach((uid) => {
      const p = profilesMap[uid];
      batch1.set(doc(db, 'conversations', conversationId, 'members', uid), {
        userId: uid,
        conversationId,
        role: 'member',
        displayName: sanitizeOptionalStr(p?.display_name, 80),
        username: sanitizeOptionalStr(p?.username, 32),
        avatarUrl: sanitizeOptionalStr(p?.avatar_url, 1024),
        joinedAt: serverTimestamp(),
      });

      batch1.set(doc(db, 'users', uid, 'inbox', conversationId), {
        id: conversationId,
        ownerId: uid,
        type: 'group',
        name: sanitizeOptionalStr(convData.name, 100),
        description: sanitizeOptionalStr(convData.description, 500),
        avatarUrl: sanitizeOptionalStr(convData.avatarUrl, 1024),
        groupOwnerId: convData.ownerId,
        myRole: 'member',
        unreadCount: 0,
        isRemoved: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });

    await batch1.commit();

    // Send centered [SYSTEM:...] notification messages for each added user
    const allCurrentMembers = Object.keys(updatedRoles);
    for (const addedUid of cleanToAdd) {
      const addedProf = profilesMap[addedUid];
      const addedName = addedProf?.display_name || addedProf?.username || addedUid;
      const addedUsername = addedProf?.username || '';
      const actorName = actorProfile.display_name || actorProfile.username;
      const sysId = `sys_${generateUUID().replace(/-/g, '').slice(0, 20)}`;
      const content = `[SYSTEM:USER_ADDED:${actorProfile.id}:${actorName}:${actorProfile.username}:${addedUid}:${addedName}:${addedUsername}]`;

      const msgBatch = writeBatch(db);
      allCurrentMembers.forEach((mUid) => {
        msgBatch.set(doc(db, 'users', mUid, 'inbox', conversationId, 'messages', sysId), {
          id: sysId,
          conversationId,
          senderId: actorProfile.id,
          senderDisplayName: sanitizeOptionalStr(actorProfile.display_name, 80),
          senderUsername: sanitizeOptionalStr(actorProfile.username, 32),
          senderAvatarUrl: sanitizeOptionalStr(actorProfile.avatar_url, 1024),
          content,
          isRead: mUid === actorProfile.id,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });
      await msgBatch.commit().catch(() => {});
    }

    return await fetchGroupDetailsFs(conversationId);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function removeGroupMemberFs(
  conversationId: string,
  actorProfile: Profile,
  targetMemberId: string
): Promise<Conversation | null> {
  const path = `conversations/${conversationId}`;
  try {
    const convSnap = await getDoc(doc(db, 'conversations', conversationId));
    if (!convSnap.exists()) throw new Error('Group not found');
    const convData = convSnap.data();
    const currentRoles: Record<string, 'admin' | 'member'> = { ...(convData.memberRoles || {}) };
    const existingMemberIds = Object.keys(currentRoles);
    const isSelfLeave = actorProfile.id === targetMemberId;

    const targetProfile = isSelfLeave ? actorProfile : await fetchPublicProfileFs(targetMemberId);
    const targetName = targetProfile?.display_name || targetProfile?.username || targetMemberId;
    const targetUsername = targetProfile?.username || '';
    const actorName = actorProfile.display_name || actorProfile.username;

    const sysId = `sys_${generateUUID().replace(/-/g, '').slice(0, 20)}`;
    const content = isSelfLeave
      ? `[SYSTEM:USER_LEFT:${targetMemberId}:${targetName}:${targetUsername}]`
      : `[SYSTEM:USER_REMOVED:${actorProfile.id}:${actorName}:${actorProfile.username}:${targetMemberId}:${targetName}:${targetUsername}]`;

    const remainingMembers = existingMemberIds.filter((id) => id !== targetMemberId);

    // If the last member is leaving the group, delete the conversation instead of leaving memberRoles empty
    if (isSelfLeave && remainingMembers.length === 0) {
      const cleanupBatch = writeBatch(db);
      cleanupBatch.delete(doc(db, 'conversations', conversationId, 'members', targetMemberId));
      cleanupBatch.delete(doc(db, 'users', targetMemberId, 'inbox', conversationId));
      cleanupBatch.delete(doc(db, 'conversations', conversationId));
      await cleanupBatch.commit();
      return null;
    }

    const batch = writeBatch(db);

    // 1. Write centered system notification message before member removal commits
    remainingMembers.forEach((mUid) => {
      batch.set(doc(db, 'users', mUid, 'inbox', conversationId, 'messages', sysId), {
        id: sysId,
        conversationId,
        senderId: actorProfile.id,
        senderDisplayName: sanitizeOptionalStr(actorProfile.display_name, 80),
        senderUsername: sanitizeOptionalStr(actorProfile.username, 32),
        senderAvatarUrl: sanitizeOptionalStr(actorProfile.avatar_url, 1024),
        content,
        isRead: mUid === actorProfile.id,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });

    // 2. Update conversation metadata
    if (isSelfLeave) {
      if (convData.ownerId === targetMemberId && remainingMembers.length > 0) {
        const nextOwnerId = remainingMembers[0];
        const nextRoles = { ...currentRoles };
        delete nextRoles[targetMemberId];
        nextRoles[nextOwnerId] = 'admin';
        batch.update(doc(db, 'conversations', conversationId), {
          ownerId: nextOwnerId,
          memberRoles: nextRoles,
          updatedAt: serverTimestamp(),
        });
        batch.update(doc(db, 'conversations', conversationId, 'members', nextOwnerId), {
          role: 'admin',
        });
      } else {
        batch.update(doc(db, 'conversations', conversationId), {
          [`memberRoles.${targetMemberId}`]: deleteField(),
          updatedAt: serverTimestamp(),
        });
      }
    } else {
      const nextRoles = { ...currentRoles };
      delete nextRoles[targetMemberId];
      const nextRemoved = {
        ...(convData.removedMembers || {}),
        [targetMemberId]: {
          removed_at: new Date().toISOString(),
          removed_by: actorProfile.id,
          admin_name: actorName,
          admin_username: actorProfile.username,
          member_name: targetName,
          member_username: targetUsername,
        },
      };
      batch.update(doc(db, 'conversations', conversationId), {
        memberRoles: nextRoles,
        removedMembers: nextRemoved,
        updatedAt: serverTimestamp(),
      });

      // Mark target's inbox item as removed (so UI deletes/notifies)
      batch.update(doc(db, 'users', targetMemberId, 'inbox', conversationId), {
        isRemoved: true,
        removalAdminName: sanitizeOptionalStr(actorName, 80),
        removalAdminUsername: sanitizeOptionalStr(actorProfile.username, 32),
        removedAt: new Date().toISOString(),
        updatedAt: serverTimestamp(),
      });
    }

    // 3. Remove from Master Gate members subcollection
    batch.delete(doc(db, 'conversations', conversationId, 'members', targetMemberId));

    await batch.commit();

    if (isSelfLeave) {
      await deleteDoc(doc(db, 'users', targetMemberId, 'inbox', conversationId)).catch(() => {});
      return null;
    }
    return await fetchGroupDetailsFs(conversationId);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function updateGroupMemberRoleFs(
  conversationId: string,
  targetMemberId: string,
  role: 'admin' | 'member'
): Promise<Conversation | null> {
  const path = `conversations/${conversationId}`;
  try {
    const convSnap = await getDoc(doc(db, 'conversations', conversationId));
    if (!convSnap.exists()) throw new Error('Group not found');
    const convData = convSnap.data();
    const nextRoles = { ...(convData.memberRoles || {}), [targetMemberId]: role };

    const batch = writeBatch(db);
    batch.update(doc(db, 'conversations', conversationId), {
      memberRoles: nextRoles,
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'conversations', conversationId, 'members', targetMemberId), {
      role,
    });
    batch.update(doc(db, 'users', targetMemberId, 'inbox', conversationId), {
      myRole: role,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();

    return await fetchGroupDetailsFs(conversationId);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteGroupFs(conversationId: string): Promise<void> {
  const path = `conversations/${conversationId}`;
  try {
    const convSnap = await getDoc(doc(db, 'conversations', conversationId));
    if (convSnap.exists()) {
      const convData = convSnap.data();
      const memberIds = Object.keys(convData.memberRoles || {});
      for (const mUid of memberIds) {
        await updateDoc(doc(db, 'users', mUid, 'inbox', conversationId), {
          isRemoved: true,
          removedAt: new Date().toISOString(),
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }
      await deleteDoc(doc(db, 'conversations', conversationId));
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

// ============================================================================
// MESSAGING
// ============================================================================

export async function sendMessageToFirestoreFs(params: {
  messageId?: string;
  conversationId: string;
  content: string;
  senderProfile: Profile;
  isGroup: boolean;
  receiverId?: string;
  receiverProfile?: Profile;
  groupName?: string | null;
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
    isGroup,
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

  // For direct chats with another user, verify mutual follow & ensure conversation exists
  if (!isGroup && receiverId && receiverId !== senderId) {
    const rel = await fetchRelationStatusFs(senderId, receiverId);
    if (rel.isBlocked) {
      throw new Error('Messaging is unavailable because one of you has blocked the other.');
    }
    if (!rel.isMutual) {
      throw new Error('Follow each other to start messaging.');
    }

    const peerProf = receiverProfile || (await fetchPublicProfileFs(receiverId));
    if (!peerProf) throw new Error('Recipient profile not found.');
    await createOrGetDirectConversationFs(conversationId, senderProfile, peerProf);
  } else if (!isGroup && (!receiverId || receiverId === senderId)) {
    await createOrGetDirectConversationFs(conversationId, senderProfile, senderProfile);
  }

  // Read authoritative member list from conversation metadata
  const convSnap = await getDoc(doc(db, 'conversations', conversationId));
  if (!convSnap.exists()) {
    throw new Error('Conversation not found.');
  }
  const convData = convSnap.data();
  const convType = (convData.type || (isGroup ? 'group' : 'direct')) as 'direct' | 'group';
  const memberRoles: Record<string, 'admin' | 'member'> = convData.memberRoles || { [senderId]: 'admin' };
  const memberIds = Object.keys(memberRoles);
  if (!memberIds.includes(senderId)) {
    throw new Error('You are no longer a member of this conversation.');
  }

  // 1. Write message to each participant's inbox subcollection in one atomic batch
  const msgBatch = writeBatch(db);
  memberIds.forEach((mUid) => {
    msgBatch.set(doc(db, 'users', mUid, 'inbox', conversationId, 'messages', messageId), {
      id: messageId,
      conversationId,
      senderId,
      senderDisplayName: sanitizeOptionalStr(senderProfile.display_name, 80),
      senderUsername: sanitizeOptionalStr(senderProfile.username, 32),
      senderAvatarUrl: sanitizeOptionalStr(senderProfile.avatar_url, 1024),
      content: cleanContent,
      replyToMessageId: sanitizeOptionalStr(replyToMessageId, 128),
      reactions: {},
      mentions: Array.isArray(mentions)
        ? mentions.filter((m): m is string => typeof m === 'string').slice(0, 20)
        : [],
      mediaType: sanitizeOptionalStr(mediaType, 32),
      cloudinaryPublicId: sanitizeOptionalStr(cloudinaryPublicId, 256),
      b2FileId: sanitizeOptionalStr(b2FileId, 256),
      b2FileName: sanitizeOptionalStr(b2FileName, 256),
      isRead: mUid === senderId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  msgBatch.update(doc(db, 'conversations', conversationId), {
    updatedAt: serverTimestamp(),
  });

  try {
    await msgBatch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `users/${senderId}/inbox/${conversationId}/messages/${messageId}`);
  }

  // 2. Update each participant's inbox preview & unread counter
  await Promise.all(
    memberIds.map((mUid) =>
      upsertPeerInboxOnMessage(mUid, conversationId, senderId, convType, messageId, cleanContent, {
        otherMemberId: convType === 'direct' ? (mUid === senderId ? receiverId || senderId : senderId) : undefined,
        otherDisplayName: convType === 'direct' && mUid !== senderId ? senderProfile.display_name : receiverProfile?.display_name,
        otherUsername: convType === 'direct' && mUid !== senderId ? senderProfile.username : receiverProfile?.username,
        otherAvatarUrl: convType === 'direct' && mUid !== senderId ? senderProfile.avatar_url : receiverProfile?.avatar_url,
        name: convData.name ?? params.groupName ?? null,
        description: convData.description ?? null,
        avatarUrl: convData.avatarUrl ?? null,
        groupOwnerId: convData.ownerId ?? null,
        myRole: memberRoles[mUid] || 'member',
      }).catch(() => {})
    )
  );

  // 3. Dispatch notification to recipients (for non-call-log messages)
  if (!cleanContent.startsWith('[CALL_LOG:') && !cleanContent.startsWith('[SYSTEM:')) {
    const senderName = senderProfile.display_name || senderProfile.username || 'Someone';
    await Promise.all(
      memberIds
        .filter((mUid) => mUid !== senderId)
        .map((mUid) => {
          const notifId = `nm_${generateUUID().replace(/-/g, '').slice(0, 20)}`;
          return setDoc(doc(db, 'users', mUid, 'notifications', notifId), {
            id: notifId,
            userId: mUid,
            actorId: senderId,
            actorDisplayName: sanitizeOptionalStr(senderProfile.display_name, 80),
            actorUsername: sanitizeOptionalStr(senderProfile.username, 32),
            actorAvatarUrl: sanitizeOptionalStr(senderProfile.avatar_url, 1024),
            type: 'message',
            title: convType === 'group' ? `${senderName} in ${convData.name || 'Group'}` : `Message from ${senderName}`,
            message: cleanContent.slice(0, 200),
            referenceId: conversationId,
            isRead: false,
            createdAt: serverTimestamp(),
          }).catch(() => {});
        })
    );
  }

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

    const batch = writeBatch(db);
    const convSnap = await getDoc(doc(db, 'conversations', conversationId)).catch(() => null);
    const memberIds = convSnap?.exists() ? Object.keys(convSnap.data().memberRoles || {}) : [readerId];

    unreadFromPeers.slice(0, 150).forEach((d) => {
      const senderId = d.data().senderId;
      batch.update(d.ref, { isRead: true, updatedAt: serverTimestamp() });
      if (senderId && senderId !== readerId && memberIds.includes(senderId)) {
        batch.update(doc(db, 'users', senderId, 'inbox', conversationId, 'messages', d.id), {
          isRead: true,
          updatedAt: serverTimestamp(),
        });
      }
    });

    await batch.commit().catch(() => {});
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
