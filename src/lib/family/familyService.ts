import {
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  where,
  writeBatch,
  increment,
  DocumentSnapshot,
} from 'firebase/firestore';
import { getAuthHeaders } from '@/src/lib/authHeader';
import {
  db,
  handleFirestoreError,
  isFirebaseSessionActive,
  OperationType,
  tsToIso,
} from '@/src/lib/firebase/client';
import { generateUUID } from '@/src/lib/utils';
import {
  computeMutedUntilIso,
  FAMILY_LARGE_THRESHOLD,
  FAMILY_MAX_DAILY_INVITES,
  FAMILY_MAX_INVITE_BATCH,
  FAMILY_MAX_MEMBERS,
  FAMILY_MAX_PINNED_MESSAGES,
  FAMILY_MEMBERS_PAGE_SIZE,
  FAMILY_MESSAGES_PAGE_SIZE,
} from '@/src/lib/family/constants';
import {
  Family,
  FamilyInvite,
  FamilyJoinRequest,
  FamilyMember,
  FamilyMembership,
  FamilyMessage,
  FamilyMessageType,
  FamilyMuteDuration,
  FamilyPinnedMessage,
  FamilyRole,
  Profile,
} from '@/src/types';

async function apiJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error || 'Request failed') as Error & { code?: string; status?: number };
    err.code = data?.code;
    err.status = res.status;
    throw err;
  }
  return data as T;
}

function makeCode(len = 12): string {
  return `fam_${generateUUID().replace(/-/g, '').slice(0, len)}`;
}

function mapFsFamily(id: string, d: any, pendingRequestsCount?: number): Family {
  return {
    id,
    name: d.name || 'Family',
    photoUrl: d.photoUrl || null,
    ownerId: d.ownerId || '',
    memberCount: Number(d.memberCount || 0),
    maxMembers: Number(d.maxMembers || FAMILY_MAX_MEMBERS),
    joinApprovalRequired: Boolean(d.joinApprovalRequired),
    onlyAdminsCanSend: Boolean(d.onlyAdminsCanSend),
    inviteCode: d.inviteLinkEnabled ? d.inviteCode || null : null,
    inviteLinkEnabled: Boolean(d.inviteLinkEnabled),
    pinnedMessages: Array.isArray(d.pinnedMessages) ? d.pinnedMessages : [],
    lastMessageId: d.lastMessageId || null,
    lastMessageText: d.lastMessageText || null,
    lastMessageSenderId: d.lastMessageSenderId || null,
    lastMessageSenderName: d.lastMessageSenderName || null,
    lastMessageAt: d.lastMessageAt ? tsToIso(d.lastMessageAt) : null,
    pendingRequestsCount,
    createdAt: tsToIso(d.createdAt),
    updatedAt: tsToIso(d.updatedAt),
  };
}

function mapFsMessage(id: string, d: any): FamilyMessage & { seenCount?: number } {
  return {
    id,
    familyId: d.familyId,
    senderId: d.senderId,
    senderName: d.senderName || 'Member',
    senderUsername: d.senderUsername || null,
    senderAvatar: d.senderAvatar || null,
    senderRole: d.senderRole || 'member',
    senderRelationTag: d.senderRelationTag || null,
    type: d.type || 'text',
    content: d.isDeleted ? 'This message was deleted' : d.content || '',
    mediaUrl: d.isDeleted ? null : d.mediaUrl || null,
    mediaType: d.isDeleted ? null : d.mediaType || null,
    cloudinaryPublicId: d.isDeleted ? null : d.cloudinaryPublicId || null,
    b2FileId: d.isDeleted ? null : d.b2FileId || null,
    b2FileName: d.isDeleted ? null : d.b2FileName || null,
    replyToMessageId: d.replyToMessageId || null,
    replyToMessage: d.replyToMessage || null,
    mentions: Array.isArray(d.mentions) ? d.mentions : [],
    reactions: d.isDeleted || !d.reactions ? {} : d.reactions,
    isPinned: Boolean(d.isPinned),
    isDeleted: Boolean(d.isDeleted),
    deletedBy: d.deletedBy || null,
    deletedByRole: d.deletedByRole || null,
    safeCheckInAt: d.safeCheckInAt ? tsToIso(d.safeCheckInAt) : null,
    seenCount: Number(d.seenCount || 0),
    createdAt: tsToIso(d.createdAt),
    updatedAt: tsToIso(d.updatedAt),
  };
}

async function createFsNotification(params: {
  userId: string;
  actorId: string;
  actorProfile?: Partial<Profile> | null;
  type: string;
  title: string;
  message: string;
  referenceId?: string | null;
}) {
  const notifId = `fnotif_${generateUUID().replace(/-/g, '').slice(0, 20)}`;
  const payload: Record<string, any> = {
    id: notifId,
    userId: params.userId,
    actorId: params.actorId,
    type: params.type,
    title: params.title.slice(0, 160),
    message: params.message.slice(0, 1000),
    isRead: false,
    createdAt: serverTimestamp(),
  };
  if (params.referenceId) payload.referenceId = params.referenceId;
  if (params.actorId !== 'system' && params.actorProfile) {
    if (params.actorProfile.display_name) payload.actorDisplayName = params.actorProfile.display_name.slice(0, 80);
    if (params.actorProfile.username) payload.actorUsername = params.actorProfile.username.slice(0, 32);
    if (params.actorProfile.avatar_url) payload.actorAvatarUrl = params.actorProfile.avatar_url.slice(0, 1024);
  }
  await setDoc(doc(db, 'users', params.userId, 'notifications', notifId), payload).catch(() => {});
}

async function writeFsSystemMessage(familyId: string, text: string) {
  const msgId = `fmsg_${generateUUID().replace(/-/g, '').slice(0, 20)}`;
  await setDoc(doc(db, 'families', familyId, 'messages', msgId), {
    id: msgId,
    familyId,
    senderId: 'system',
    senderName: 'System',
    type: 'system',
    content: text.slice(0, 500),
    mentions: [],
    reactions: {},
    isPinned: false,
    isDeleted: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await updateDoc(doc(db, 'families', familyId), {
    lastMessageId: msgId,
    lastMessageText: text.slice(0, 500),
    lastMessageSenderId: 'system',
    lastMessageSenderName: 'System',
    lastMessageAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }).catch(() => {});
}

// =========================================================================
// LIST MY FAMILIES & INVITES
// =========================================================================

export async function listMyFamiliesAndInvites(userId: string): Promise<{
  memberships: FamilyMembership[];
  invites: FamilyInvite[];
}> {
  if (!isFirebaseSessionActive(userId)) {
    return apiJson('/api/families/my');
  }

  try {
    const [memsSnap, invitesSnap] = await Promise.all([
      getDocs(
        query(
          collection(db, 'users', userId, 'family_memberships'),
          where('status', 'in', ['active', 'pending'])
        )
      ),
      getDocs(
        query(
          collection(db, 'users', userId, 'family_invites'),
          where('status', '==', 'pending')
        )
      ),
    ]);

    const memberships: FamilyMembership[] = [];

    await Promise.all(
      memsSnap.docs.map(async (mDoc) => {
        const md = mDoc.data();
        const famId = md.familyId || mDoc.id;
        const famSnap = await getDoc(doc(db, 'families', famId)).catch(() => null);
        if (!famSnap || !famSnap.exists()) return;
        const fd = famSnap.data();

        const isPrivileged = md.status === 'active' && (md.role === 'owner' || md.role === 'admin');
        let pendingRequestsCount = 0;
        if (isPrivileged) {
          const reqCountSnap = await getCountFromServer(
            query(collection(db, 'families', famId, 'requests'), where('status', '==', 'pending'))
          ).catch(() => null);
          pendingRequestsCount = reqCountSnap?.data().count || 0;
        }

        let unreadCount = 0;
        if (md.status === 'active') {
          const baseline = md.clearedAt && (!md.lastReadAt || tsToIso(md.clearedAt) > tsToIso(md.lastReadAt))
            ? md.clearedAt
            : md.lastReadAt || md.joinedAt;
          if (baseline) {
            const unreadSnap = await getDocs(
              query(
                collection(db, 'families', famId, 'messages'),
                where('createdAt', '>', baseline),
                orderBy('createdAt', 'desc'),
                limit(25)
              )
            ).catch(() => null);
            if (unreadSnap) {
              unreadCount = unreadSnap.docs.filter(
                (msgDoc) => msgDoc.data().senderId !== userId && !msgDoc.data().isDeleted
              ).length;
            }
          }
        }

        memberships.push({
          familyId: famId,
          userId,
          role: md.role || 'member',
          status: md.status,
          relationTag: md.relationTag || null,
          mutedUntil: md.mutedUntil ? tsToIso(md.mutedUntil) : null,
          isMutedAlways: Boolean(md.isMutedAlways),
          lastReadAt: md.lastReadAt ? tsToIso(md.lastReadAt) : null,
          clearedAt: md.clearedAt ? tsToIso(md.clearedAt) : null,
          unreadCount,
          joinedAt: tsToIso(md.joinedAt),
          updatedAt: tsToIso(md.updatedAt),
          family: mapFsFamily(famId, fd, pendingRequestsCount),
        });
      })
    );

    memberships.sort((a, b) => {
      const ta = a.family?.lastMessageAt || a.family?.updatedAt || a.updatedAt;
      const tb = b.family?.lastMessageAt || b.family?.updatedAt || b.updatedAt;
      return tb.localeCompare(ta);
    });

    const invites: FamilyInvite[] = invitesSnap.docs
      .map((d) => {
        const data = d.data();
        return {
          id: d.id,
          familyId: data.familyId,
          familyName: data.familyName,
          familyPhotoUrl: data.familyPhotoUrl || null,
          inviterId: data.inviterId,
          inviterName: data.inviterName,
          inviteeId: data.inviteeId,
          status: data.status,
          createdAt: tsToIso(data.createdAt),
          respondedAt: data.respondedAt ? tsToIso(data.respondedAt) : null,
        } as FamilyInvite;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return { memberships, invites };
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, `users/${userId}/family_memberships`);
  }
}

// =========================================================================
// CREATE FAMILY
// =========================================================================

export async function createFamily(
  user: Profile,
  params: { name: string; photoUrl?: string | null; joinApprovalRequired?: boolean; relationTag?: string | null }
): Promise<{ family: Family; membership: FamilyMembership }> {
  if (!isFirebaseSessionActive(user.id)) {
    return apiJson('/api/families', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  const cleanName = params.name.trim().slice(0, 80);
  if (!cleanName) throw new Error('Family name is required.');
  const familyId = `fam_${generateUUID().replace(/-/g, '').slice(0, 20)}`;
  const inviteCode = makeCode(10);
  const sysMsgId = `fmsg_${generateUUID().replace(/-/g, '').slice(0, 20)}`;
  const joinApprovalRequired = params.joinApprovalRequired ?? true;
  const relationTag = params.relationTag?.trim().slice(0, 32) || null;
  const ownerName = user.display_name || user.username || 'Owner';
  const welcomeText = `${ownerName} created "${cleanName}"`;

  try {
    const batch = writeBatch(db);

    batch.set(doc(db, 'families', familyId), {
      id: familyId,
      name: cleanName,
      photoUrl: params.photoUrl || null,
      ownerId: user.id,
      memberCount: 1,
      maxMembers: FAMILY_MAX_MEMBERS,
      joinApprovalRequired,
      onlyAdminsCanSend: false,
      inviteCode,
      inviteLinkEnabled: true,
      pinnedMessages: [],
      lastMessageId: sysMsgId,
      lastMessageText: welcomeText,
      lastMessageSenderId: 'system',
      lastMessageSenderName: 'System',
      lastMessageAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'families', familyId, 'members', user.id), {
      userId: user.id,
      familyId,
      role: 'owner',
      status: 'active',
      relationTag,
      displayName: ownerName,
      displayNameLower: ownerName.toLowerCase(),
      username: user.username,
      avatarUrl: user.avatar_url || null,
      joinedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'users', user.id, 'family_memberships', familyId), {
      familyId,
      userId: user.id,
      role: 'owner',
      status: 'active',
      relationTag,
      mutedUntil: null,
      isMutedAlways: false,
      lastReadAt: serverTimestamp(),
      clearedAt: null,
      joinedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'family_invite_links', inviteCode), {
      code: inviteCode,
      familyId,
      familyName: cleanName,
      photoUrl: params.photoUrl || null,
      memberCount: 1,
      maxMembers: FAMILY_MAX_MEMBERS,
      joinApprovalRequired,
      enabled: true,
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'families', familyId, 'messages', sysMsgId), {
      id: sysMsgId,
      familyId,
      senderId: 'system',
      senderName: 'System',
      type: 'system',
      content: welcomeText,
      mentions: [],
      reactions: {},
      isPinned: false,
      isDeleted: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await batch.commit();

    const nowIso = new Date().toISOString();
    const family: Family = {
      id: familyId,
      name: cleanName,
      photoUrl: params.photoUrl || null,
      ownerId: user.id,
      memberCount: 1,
      maxMembers: FAMILY_MAX_MEMBERS,
      joinApprovalRequired,
      onlyAdminsCanSend: false,
      inviteCode,
      inviteLinkEnabled: true,
      pinnedMessages: [],
      lastMessageId: sysMsgId,
      lastMessageText: welcomeText,
      lastMessageSenderId: 'system',
      lastMessageSenderName: 'System',
      lastMessageAt: nowIso,
      pendingRequestsCount: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const membership: FamilyMembership = {
      familyId,
      userId: user.id,
      role: 'owner',
      status: 'active',
      relationTag,
      isMutedAlways: false,
      mutedUntil: null,
      unreadCount: 0,
      joinedAt: nowIso,
      updatedAt: nowIso,
      family,
    };

    return { family, membership };
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `families/${familyId}`);
  }
}

// =========================================================================
// INVITE LINK LOOKUP & JOIN FLOW
// =========================================================================

export async function lookupFamilyByInviteCode(userId: string, code: string): Promise<{
  family: Pick<Family, 'id' | 'name' | 'photoUrl' | 'memberCount' | 'maxMembers' | 'joinApprovalRequired'>;
  membershipStatus: string | null;
}> {
  if (!isFirebaseSessionActive(userId)) {
    return apiJson(`/api/families/by-invite/${encodeURIComponent(code)}`);
  }

  try {
    const linkSnap = await getDoc(doc(db, 'family_invite_links', code));
    if (!linkSnap.exists() || linkSnap.data().enabled !== true) {
      throw new Error('Invite link is invalid or has been disabled.');
    }
    const linkData = linkSnap.data();
    const famId = linkData.familyId;
    const famSnap = await getDoc(doc(db, 'families', famId));
    if (!famSnap.exists() || famSnap.data().inviteLinkEnabled !== true || famSnap.data().inviteCode !== code) {
      throw new Error('This invite link has been reset or disabled.');
    }
    const fd = famSnap.data();
    const memSnap = await getDoc(doc(db, 'families', famId, 'members', userId)).catch(() => null);
    return {
      family: {
        id: famId,
        name: fd.name,
        photoUrl: fd.photoUrl || null,
        memberCount: Number(fd.memberCount || 0),
        maxMembers: Number(fd.maxMembers || FAMILY_MAX_MEMBERS),
        joinApprovalRequired: Boolean(fd.joinApprovalRequired),
      },
      membershipStatus: memSnap?.exists() ? memSnap.data().status : null,
    };
  } catch (err: any) {
    if (err instanceof Error && !err.message.includes('Firestore')) throw err;
    handleFirestoreError(err, OperationType.GET, `family_invite_links/${code}`);
  }
}

export async function joinFamilyByCode(
  user: Profile,
  code: string
): Promise<{ status: 'active' | 'pending'; familyId: string; familyName?: string }> {
  if (!isFirebaseSessionActive(user.id)) {
    return apiJson('/api/families/join-by-code', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  }

  try {
    const linkSnap = await getDoc(doc(db, 'family_invite_links', code));
    if (!linkSnap.exists() || linkSnap.data().enabled !== true) {
      throw new Error('This invite link is invalid, reset, or disabled.');
    }
    const famId = linkSnap.data().familyId;
    const famSnap = await getDoc(doc(db, 'families', famId));
    if (!famSnap.exists() || !famSnap.data().inviteLinkEnabled || famSnap.data().inviteCode !== code) {
      throw new Error('This invite link is no longer valid.');
    }
    const fam = famSnap.data();

    const existingSnap = await getDoc(doc(db, 'families', famId, 'members', user.id)).catch(() => null);
    if (existingSnap?.exists()) {
      const existingData = existingSnap.data();
      if (existingData.status === 'active') {
        return { status: 'active', familyId: famId, familyName: fam.name };
      }
      if (existingData.status === 'removed') {
        throw new Error('You were removed from this Family and cannot rejoin until an Owner or Admin allows you again.');
      }
    }

    if (Number(fam.memberCount || 0) >= FAMILY_MAX_MEMBERS) {
      throw new Error(`This Family has reached the maximum of ${FAMILY_MAX_MEMBERS} members.`);
    }

    const displayName = user.display_name || user.username || 'Member';

    if (fam.joinApprovalRequired) {
      const batch = writeBatch(db);
      batch.set(doc(db, 'families', famId, 'requests', user.id), {
        userId: user.id,
        familyId: famId,
        displayName,
        username: user.username,
        avatarUrl: user.avatar_url || null,
        status: 'pending',
        inviteCode: code,
        createdAt: serverTimestamp(),
      });
      batch.set(
        doc(db, 'families', famId, 'members', user.id),
        {
          userId: user.id,
          familyId: famId,
          role: 'member',
          status: 'pending',
          displayName,
          displayNameLower: displayName.toLowerCase(),
          username: user.username,
          avatarUrl: user.avatar_url || null,
          joinedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      batch.set(
        doc(db, 'users', user.id, 'family_memberships', famId),
        {
          familyId: famId,
          userId: user.id,
          role: 'member',
          status: 'pending',
          isMutedAlways: Number(fam.memberCount || 0) >= FAMILY_LARGE_THRESHOLD,
          joinedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      await batch.commit();

      // Notify Owner & Admins (query limited to role in ['owner', 'admin'])
      const adminsSnap = await getDocs(
        query(
          collection(db, 'families', famId, 'members'),
          where('status', '==', 'active'),
          where('role', 'in', ['owner', 'admin']),
          limit(25)
        )
      ).catch(() => null);
      if (adminsSnap) {
        await Promise.all(
          adminsSnap.docs.map((ad) =>
            createFsNotification({
              userId: ad.id,
              actorId: user.id,
              actorProfile: user,
              type: 'family_join_request',
              title: `Join request: ${fam.name}`,
              message: `${displayName} (@${user.username}) requested to join ${fam.name}.`,
              referenceId: famId,
            })
          )
        );
      }

      return { status: 'pending', familyId: famId, familyName: fam.name };
    }

    // Direct join
    const autoMute = Number(fam.memberCount || 0) >= FAMILY_LARGE_THRESHOLD;
    const batch = writeBatch(db);
    batch.set(
      doc(db, 'families', famId, 'members', user.id),
      {
        userId: user.id,
        familyId: famId,
        role: 'member',
        status: 'active',
        displayName,
        displayNameLower: displayName.toLowerCase(),
        username: user.username,
        avatarUrl: user.avatar_url || null,
        joinedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    batch.set(
      doc(db, 'users', user.id, 'family_memberships', famId),
      {
        familyId: famId,
        userId: user.id,
        role: 'member',
        status: 'active',
        isMutedAlways: autoMute,
        lastReadAt: serverTimestamp(),
        joinedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    batch.update(doc(db, 'families', famId), {
      memberCount: increment(1),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    await writeFsSystemMessage(famId, `${displayName} joined via invite link`);
    return { status: 'active', familyId: famId, familyName: fam.name };
  } catch (err: any) {
    if (err instanceof Error && !err.message.includes('Firestore')) throw err;
    handleFirestoreError(err, OperationType.WRITE, 'family_invite_links');
  }
}

// =========================================================================
// FAMILY DETAIL, SETTINGS & INVITE LINK MANAGEMENT
// =========================================================================

export async function getFamilyDetail(
  userId: string,
  familyId: string
): Promise<{ family: Family; membership: FamilyMembership }> {
  if (!isFirebaseSessionActive(userId)) {
    return apiJson(`/api/families/${encodeURIComponent(familyId)}`);
  }

  try {
    const [famSnap, memSnap, userMemSnap] = await Promise.all([
      getDoc(doc(db, 'families', familyId)),
      getDoc(doc(db, 'families', familyId, 'members', userId)),
      getDoc(doc(db, 'users', userId, 'family_memberships', familyId)).catch(() => null),
    ]);
    if (!famSnap.exists()) throw new Error('Family not found.');
    if (!memSnap.exists()) throw new Error('You are not a member of this Family.');

    const md = memSnap.data();
    if (md.status === 'removed') {
      const err = new Error('You were removed from this Family.') as Error & { code?: string };
      err.code = 'FAMILY_REMOVED';
      throw err;
    }

    const isPrivileged = md.status === 'active' && (md.role === 'owner' || md.role === 'admin');
    let pendingRequestsCount = 0;
    if (isPrivileged) {
      const cntSnap = await getCountFromServer(
        query(collection(db, 'families', familyId, 'requests'), where('status', '==', 'pending'))
      ).catch(() => null);
      pendingRequestsCount = cntSnap?.data().count || 0;
    }

    const umd = userMemSnap?.exists() ? userMemSnap.data() : {};
    const family = mapFsFamily(familyId, famSnap.data(), pendingRequestsCount);
    const membership: FamilyMembership = {
      familyId,
      userId,
      role: md.role || 'member',
      status: md.status,
      relationTag: md.relationTag || null,
      mutedUntil: umd.mutedUntil ? tsToIso(umd.mutedUntil) : null,
      isMutedAlways: Boolean(umd.isMutedAlways),
      lastReadAt: umd.lastReadAt ? tsToIso(umd.lastReadAt) : null,
      clearedAt: umd.clearedAt ? tsToIso(umd.clearedAt) : null,
      unreadCount: 0,
      joinedAt: tsToIso(md.joinedAt),
      updatedAt: tsToIso(md.updatedAt),
      family,
    };
    return { family, membership };
  } catch (err: any) {
    if (err instanceof Error && !err.message.includes('Firestore')) throw err;
    handleFirestoreError(err, OperationType.GET, `families/${familyId}`);
  }
}

export async function updateFamilySettings(
  user: Profile,
  familyId: string,
  updates: {
    name?: string;
    photoUrl?: string | null;
    joinApprovalRequired?: boolean;
    onlyAdminsCanSend?: boolean;
  }
): Promise<Family> {
  if (!isFirebaseSessionActive(user.id)) {
    const res = await apiJson<{ family: Family }>(`/api/families/${encodeURIComponent(familyId)}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    return res.family;
  }

  try {
    const famSnap = await getDoc(doc(db, 'families', familyId));
    if (!famSnap.exists()) throw new Error('Family not found.');
    const current = famSnap.data();
    const actorName = user.display_name || user.username || 'Admin';

    const payload: Record<string, any> = { updatedAt: serverTimestamp() };
    const sysMessages: string[] = [];

    if (typeof updates.name === 'string' && updates.name.trim()) {
      const clean = updates.name.trim().slice(0, 80);
      if (clean !== current.name) {
        payload.name = clean;
        sysMessages.push(`${actorName} renamed the Family to "${clean}"`);
      }
    }
    if (updates.photoUrl !== undefined && updates.photoUrl !== current.photoUrl) {
      payload.photoUrl = updates.photoUrl || null;
      sysMessages.push(`${actorName} updated the Family photo`);
    }
    if (typeof updates.joinApprovalRequired === 'boolean') {
      // Switching ON -> OFF does NOT auto-approve existing pending requests
      payload.joinApprovalRequired = updates.joinApprovalRequired;
    }
    if (typeof updates.onlyAdminsCanSend === 'boolean' && updates.onlyAdminsCanSend !== Boolean(current.onlyAdminsCanSend)) {
      payload.onlyAdminsCanSend = updates.onlyAdminsCanSend;
      sysMessages.push(
        updates.onlyAdminsCanSend
          ? `${actorName} enabled "Only admins can send messages"`
          : `${actorName} allowed all members to send messages`
      );
    }

    await updateDoc(doc(db, 'families', familyId), payload);
    if (current.inviteCode && (payload.name || payload.photoUrl !== undefined || payload.joinApprovalRequired !== undefined)) {
      await updateDoc(doc(db, 'family_invite_links', current.inviteCode), {
        familyName: payload.name || current.name,
        photoUrl: payload.photoUrl !== undefined ? payload.photoUrl : current.photoUrl || null,
        joinApprovalRequired:
          payload.joinApprovalRequired !== undefined ? payload.joinApprovalRequired : Boolean(current.joinApprovalRequired),
        updatedAt: serverTimestamp(),
      }).catch(() => {});
    }

    for (const txt of sysMessages) {
      await writeFsSystemMessage(familyId, txt);
    }

    const updatedSnap = await getDoc(doc(db, 'families', familyId));
    return mapFsFamily(familyId, updatedSnap.data());
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `families/${familyId}`);
  }
}

export async function manageFamilyInviteLink(
  userId: string,
  familyId: string,
  action: 'reset' | 'disable' | 'enable'
): Promise<Family> {
  if (!isFirebaseSessionActive(userId)) {
    const res = await apiJson<{ family: Family }>(`/api/families/${encodeURIComponent(familyId)}/invite-link`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
    return res.family;
  }

  try {
    const famSnap = await getDoc(doc(db, 'families', familyId));
    if (!famSnap.exists()) throw new Error('Family not found.');
    const fam = famSnap.data();

    if (action === 'disable') {
      await updateDoc(doc(db, 'families', familyId), {
        inviteLinkEnabled: false,
        updatedAt: serverTimestamp(),
      });
      if (fam.inviteCode) {
        await updateDoc(doc(db, 'family_invite_links', fam.inviteCode), {
          enabled: false,
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }
    } else if (action === 'enable') {
      const code = fam.inviteCode || makeCode(10);
      await updateDoc(doc(db, 'families', familyId), {
        inviteCode: code,
        inviteLinkEnabled: true,
        updatedAt: serverTimestamp(),
      });
      await setDoc(doc(db, 'family_invite_links', code), {
        code,
        familyId,
        familyName: fam.name,
        photoUrl: fam.photoUrl || null,
        memberCount: Number(fam.memberCount || 0),
        maxMembers: Number(fam.maxMembers || FAMILY_MAX_MEMBERS),
        joinApprovalRequired: Boolean(fam.joinApprovalRequired),
        enabled: true,
        updatedAt: serverTimestamp(),
      });
    } else {
      const oldCode = fam.inviteCode;
      const newCode = makeCode(10);
      await updateDoc(doc(db, 'families', familyId), {
        inviteCode: newCode,
        inviteLinkEnabled: true,
        updatedAt: serverTimestamp(),
      });
      if (oldCode) {
        await deleteDoc(doc(db, 'family_invite_links', oldCode)).catch(() => {});
      }
      await setDoc(doc(db, 'family_invite_links', newCode), {
        code: newCode,
        familyId,
        familyName: fam.name,
        photoUrl: fam.photoUrl || null,
        memberCount: Number(fam.memberCount || 0),
        maxMembers: Number(fam.maxMembers || FAMILY_MAX_MEMBERS),
        joinApprovalRequired: Boolean(fam.joinApprovalRequired),
        enabled: true,
        updatedAt: serverTimestamp(),
      });
    }

    const updated = await getDoc(doc(db, 'families', familyId));
    return mapFsFamily(familyId, updated.data());
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `families/${familyId}`);
  }
}

// =========================================================================
// PAGED & SEARCHABLE MEMBERS (NEVER LOADS ALL 5,000 AT ONCE)
// =========================================================================

export async function listFamilyMembersPaged(params: {
  userId: string;
  familyId: string;
  memberCount: number;
  limitCount?: number;
  offset?: number;
  cursorDoc?: DocumentSnapshot | null;
  searchQuery?: string;
  status?: 'active' | 'removed';
}): Promise<{
  members: FamilyMember[];
  hasMore: boolean;
  total: number;
  hidePresence: boolean;
  lastDoc: DocumentSnapshot | null;
}> {
  const pageSize = params.limitCount || FAMILY_MEMBERS_PAGE_SIZE;
  const targetStatus = params.status || 'active';

  if (!isFirebaseSessionActive(params.userId)) {
    const qs = new URLSearchParams({
      limit: String(pageSize),
      offset: String(params.offset || 0),
      status: targetStatus,
    });
    if (params.searchQuery?.trim()) qs.set('q', params.searchQuery.trim());
    const data = await apiJson<any>(`/api/families/${encodeURIComponent(params.familyId)}/members?${qs.toString()}`);
    return {
      members: data.members || [],
      hasMore: Boolean(data.hasMore),
      total: Number(data.total || 0),
      hidePresence: Boolean(data.hidePresence),
      lastDoc: null,
    };
  }

  try {
    const hidePresence = params.memberCount > FAMILY_LARGE_THRESHOLD;
    const qStr = (params.searchQuery || '').trim().toLowerCase();
    const baseCol = collection(db, 'families', params.familyId, 'members');

    let q;
    if (qStr) {
      const endStr = `${qStr}\uf8ff`;
      const constraints: any[] = [
        where('status', '==', targetStatus),
        where('displayNameLower', '>=', qStr),
        where('displayNameLower', '<=', endStr),
        orderBy('displayNameLower', 'asc'),
        limit(pageSize),
      ];
      if (params.cursorDoc) constraints.splice(4, 0, startAfter(params.cursorDoc));
      q = query(baseCol, ...constraints);
    } else {
      const constraints: any[] = [
        where('status', '==', targetStatus),
        orderBy('displayNameLower', 'asc'),
        limit(pageSize),
      ];
      if (params.cursorDoc) constraints.splice(2, 0, startAfter(params.cursorDoc));
      q = query(baseCol, ...constraints);
    }

    const snap = await getDocs(q);
    const members: FamilyMember[] = snap.docs.map((d) => {
      const md = d.data() as Record<string, any>;
      return {
        userId: md.userId || d.id,
        familyId: md.familyId || params.familyId,
        role: md.role || 'member',
        status: md.status || targetStatus,
        relationTag: md.relationTag || null,
        displayName: md.displayName || md.username || 'User',
        username: md.username || 'user',
        avatarUrl: md.avatarUrl || null,
        isOnline: false,
        lastSeen: null,
        joinedAt: tsToIso(md.joinedAt),
        updatedAt: tsToIso(md.updatedAt),
        removedAt: md.removedAt ? tsToIso(md.removedAt) : null,
        removedBy: md.removedBy || null,
      };
    });

    // Hydrate online status ONLY when memberCount <= 50 and targetStatus == 'active'
    if (!hidePresence && targetStatus === 'active' && members.length > 0) {
      await Promise.all(
        members.map(async (m) => {
          const pSnap = await getDoc(doc(db, 'public_profiles', m.userId)).catch(() => null);
          if (pSnap?.exists()) {
            const pd = pSnap.data() as Record<string, any>;
            m.isOnline = Boolean(pd.isOnline);
            m.lastSeen = pd.lastSeen ? tsToIso(pd.lastSeen) : null;
            m.avatarUrl = pd.avatarUrl || m.avatarUrl;
            m.displayName = pd.displayName || m.displayName;
          }
        })
      );
    }

    return {
      members,
      hasMore: snap.docs.length === pageSize,
      total: targetStatus === 'active' && !qStr ? params.memberCount : members.length,
      hidePresence,
      lastDoc: snap.docs.length > 0 ? (snap.docs[snap.docs.length - 1] as DocumentSnapshot) : null,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, `families/${params.familyId}/members`);
  }
}

// =========================================================================
// INVITES (MAX 10 AT ONCE, MAX 50/DAY) & JOIN REQUESTS
// =========================================================================

export async function inviteUsersToFamily(
  inviter: Profile,
  family: Family,
  inviteeIds: string[]
): Promise<{ sentCount: number; skipped: Array<{ userId: string; reason: string }> }> {
  const uniqueIds = Array.from(new Set(inviteeIds.filter((id) => id && id !== inviter.id)));
  if (uniqueIds.length === 0) throw new Error('Select at least one user to invite.');
  if (uniqueIds.length > FAMILY_MAX_INVITE_BATCH) {
    throw new Error(`You can invite up to ${FAMILY_MAX_INVITE_BATCH} users at a time.`);
  }

  if (!isFirebaseSessionActive(inviter.id)) {
    return apiJson(`/api/families/${encodeURIComponent(family.id)}/invite`, {
      method: 'POST',
      body: JSON.stringify({ inviteeIds: uniqueIds }),
    });
  }

  try {
    const dayKey = new Date().toISOString().slice(0, 10);
    const dailyRef = doc(db, 'users', inviter.id, 'family_daily_invites', dayKey);
    const dailySnap = await getDoc(dailyRef).catch(() => null);
    const usedToday = Number(dailySnap?.exists() ? dailySnap.data().count || 0 : 0);
    if (usedToday + uniqueIds.length > FAMILY_MAX_DAILY_INVITES) {
      throw new Error(`Daily invite limit reached (${usedToday}/${FAMILY_MAX_DAILY_INVITES} invites sent today).`);
    }

    const inviterName = inviter.display_name || inviter.username || 'Someone';
    let sentCount = 0;
    const skipped: Array<{ userId: string; reason: string }> = [];

    for (const targetId of uniqueIds) {
      const [block1, block2, existingMem] = await Promise.all([
        getDoc(doc(db, 'blocks', `${inviter.id}_${targetId}`)).catch(() => null),
        getDoc(doc(db, 'blocks', `${targetId}_${inviter.id}`)).catch(() => null),
        getDoc(doc(db, 'families', family.id, 'members', targetId)).catch(() => null),
      ]);
      if (block1?.exists() || block2?.exists()) {
        skipped.push({ userId: targetId, reason: 'Blocked relationship' });
        continue;
      }
      if (existingMem?.exists()) {
        const st = existingMem.data().status;
        if (st === 'active') {
          skipped.push({ userId: targetId, reason: 'Already a member' });
          continue;
        }
        if (st === 'removed') {
          skipped.push({ userId: targetId, reason: 'Removed (allow rejoin first)' });
          continue;
        }
      }

      const inviteId = `finv_${generateUUID().replace(/-/g, '').slice(0, 20)}`;
      await setDoc(doc(db, 'users', targetId, 'family_invites', inviteId), {
        id: inviteId,
        familyId: family.id,
        familyName: family.name,
        familyPhotoUrl: family.photoUrl || null,
        inviterId: inviter.id,
        inviterName,
        inviteeId: targetId,
        status: 'pending',
        createdAt: serverTimestamp(),
      });
      await createFsNotification({
        userId: targetId,
        actorId: inviter.id,
        actorProfile: inviter,
        type: 'family_invite',
        title: `Family Invite: ${family.name}`,
        message: `${inviterName} invited you to join "${family.name}".`,
        referenceId: inviteId,
      });
      sentCount++;
    }

    if (sentCount > 0) {
      await setDoc(dailyRef, { count: usedToday + sentCount, updatedAt: serverTimestamp() });
    }

    return { sentCount, skipped };
  } catch (err: any) {
    if (err instanceof Error && !err.message.includes('Firestore')) throw err;
    handleFirestoreError(err, OperationType.CREATE, `users/${inviter.id}/family_invites`);
  }
}

export async function respondToFamilyInvite(
  user: Profile,
  inviteId: string,
  action: 'accept' | 'decline'
): Promise<{ status: 'accepted' | 'declined'; familyId?: string }> {
  if (!isFirebaseSessionActive(user.id)) {
    return apiJson(`/api/families/invites/${encodeURIComponent(inviteId)}/respond`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
  }

  try {
    const invRef = doc(db, 'users', user.id, 'family_invites', inviteId);
    const invSnap = await getDoc(invRef);
    if (!invSnap.exists()) throw new Error('Invite not found.');
    const inv = invSnap.data();

    if (action === 'decline') {
      await updateDoc(invRef, { status: 'declined', respondedAt: serverTimestamp() });
      return { status: 'declined' };
    }

    const famId = inv.familyId;
    const famSnap = await getDoc(doc(db, 'families', famId));
    if (!famSnap.exists()) {
      await updateDoc(invRef, { status: 'declined', respondedAt: serverTimestamp() });
      throw new Error('This Family no longer exists.');
    }
    const fam = famSnap.data();

    const memSnap = await getDoc(doc(db, 'families', famId, 'members', user.id)).catch(() => null);
    if (memSnap?.exists() && memSnap.data().status === 'removed') {
      throw new Error('You were removed from this Family and cannot join until allowed by an Owner or Admin.');
    }
    if (Number(fam.memberCount || 0) >= FAMILY_MAX_MEMBERS) {
      throw new Error(`This Family has reached the ${FAMILY_MAX_MEMBERS} member limit.`);
    }

    const displayName = user.display_name || user.username || 'Member';
    const autoMute = Number(fam.memberCount || 0) >= FAMILY_LARGE_THRESHOLD;
    const batch = writeBatch(db);
    batch.update(invRef, { status: 'accepted', respondedAt: serverTimestamp() });
    batch.set(
      doc(db, 'families', famId, 'members', user.id),
      {
        userId: user.id,
        familyId: famId,
        role: 'member',
        status: 'active',
        displayName,
        displayNameLower: displayName.toLowerCase(),
        username: user.username,
        avatarUrl: user.avatar_url || null,
        joinedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    batch.set(
      doc(db, 'users', user.id, 'family_memberships', famId),
      {
        familyId: famId,
        userId: user.id,
        role: 'member',
        status: 'active',
        isMutedAlways: autoMute,
        lastReadAt: serverTimestamp(),
        joinedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    batch.update(doc(db, 'families', famId), {
      memberCount: increment(1),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    await writeFsSystemMessage(famId, `${inv.inviterName || 'Admin'} added ${displayName}`);

    return { status: 'accepted', familyId: famId };
  } catch (err: any) {
    if (err instanceof Error && !err.message.includes('Firestore')) throw err;
    handleFirestoreError(err, OperationType.WRITE, `users/${user.id}/family_invites/${inviteId}`);
  }
}

export async function listFamilyJoinRequests(userId: string, familyId: string): Promise<FamilyJoinRequest[]> {
  if (!isFirebaseSessionActive(userId)) {
    const res = await apiJson<{ requests: FamilyJoinRequest[] }>(`/api/families/${encodeURIComponent(familyId)}/requests`);
    return res.requests || [];
  }

  try {
    const snap = await getDocs(
      query(
        collection(db, 'families', familyId, 'requests'),
        where('status', '==', 'pending'),
        orderBy('createdAt', 'desc'),
        limit(200)
      )
    );
    return snap.docs.map((d) => {
      const r = d.data();
      return {
        userId: r.userId || d.id,
        familyId,
        displayName: r.displayName || 'User',
        username: r.username || 'user',
        avatarUrl: r.avatarUrl || null,
        status: r.status,
        inviteCode: r.inviteCode || null,
        createdAt: tsToIso(r.createdAt),
      };
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, `families/${familyId}/requests`);
  }
}

export async function processFamilyJoinRequests(
  actor: Profile,
  family: Family,
  action: 'approve' | 'reject' | 'approve_all' | 'reject_all',
  userIds?: string[]
): Promise<void> {
  if (!isFirebaseSessionActive(actor.id)) {
    await apiJson(`/api/families/${encodeURIComponent(family.id)}/requests/action`, {
      method: 'POST',
      body: JSON.stringify({ action, userIds }),
    });
    return;
  }

  try {
    const snap = await getDocs(
      query(collection(db, 'families', family.id, 'requests'), where('status', '==', 'pending'), limit(200))
    );
    const targets =
      action === 'approve_all' || action === 'reject_all'
        ? snap.docs
        : snap.docs.filter((d) => (userIds || []).includes(d.id));

    if (targets.length === 0) return;
    const isApprove = action === 'approve' || action === 'approve_all';
    if (isApprove && family.memberCount + targets.length > FAMILY_MAX_MEMBERS) {
      throw new Error(`Approving these requests would exceed ${FAMILY_MAX_MEMBERS} members.`);
    }

    const autoMute = family.memberCount >= FAMILY_LARGE_THRESHOLD;
    const actorName = actor.display_name || actor.username || 'Admin';

    for (const reqDoc of targets) {
      const rd = reqDoc.data();
      if (isApprove) {
        await updateDoc(reqDoc.ref, {
          status: 'approved',
          reviewedAt: serverTimestamp(),
          reviewedBy: actor.id,
        });
        await updateDoc(doc(db, 'families', family.id, 'members', reqDoc.id), {
          status: 'active',
          role: 'member',
          joinedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await setDoc(
          doc(db, 'users', reqDoc.id, 'family_memberships', family.id),
          {
            familyId: family.id,
            userId: reqDoc.id,
            role: 'member',
            status: 'active',
            isMutedAlways: autoMute,
            lastReadAt: serverTimestamp(),
            joinedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
        await createFsNotification({
          userId: reqDoc.id,
          actorId: actor.id,
          actorProfile: actor,
          type: 'family_join_approved',
          title: `Approved: ${family.name}`,
          message: `${actorName} approved your request to join "${family.name}".`,
          referenceId: family.id,
        });
      } else {
        await updateDoc(reqDoc.ref, {
          status: 'rejected',
          reviewedAt: serverTimestamp(),
          reviewedBy: actor.id,
        });
        await deleteDoc(doc(db, 'families', family.id, 'members', reqDoc.id)).catch(() => {});
        await deleteDoc(doc(db, 'users', reqDoc.id, 'family_memberships', family.id)).catch(() => {});
        await createFsNotification({
          userId: reqDoc.id,
          actorId: actor.id,
          actorProfile: actor,
          type: 'family_join_rejected',
          title: 'Join request declined',
          message: `Your request to join "${family.name}" was declined.`,
          referenceId: family.id,
        });
      }
    }

    if (isApprove) {
      await updateDoc(doc(db, 'families', family.id), {
        memberCount: increment(targets.length),
        updatedAt: serverTimestamp(),
      });
      await writeFsSystemMessage(
        family.id,
        targets.length === 1
          ? `${targets[0].data().displayName || 'Member'} joined the Family`
          : `${targets.length} new members joined the Family`
      );
    }
  } catch (err: any) {
    if (err instanceof Error && !err.message.includes('Firestore')) throw err;
    handleFirestoreError(err, OperationType.UPDATE, `families/${family.id}/requests`);
  }
}

// =========================================================================
// MEMBER ACTIONS (RELATION TAG, ROLE, REMOVE, ALLOW REJOIN, TRANSFER, LEAVE, DELETE)
// =========================================================================

export async function updateMemberRelationTag(
  actorId: string,
  familyId: string,
  targetUserId: string,
  relationTag: string | null
): Promise<void> {
  const cleanTag = relationTag?.trim().slice(0, 32) || null;
  if (!isFirebaseSessionActive(actorId)) {
    await apiJson(
      `/api/families/${encodeURIComponent(familyId)}/members/${encodeURIComponent(targetUserId)}/relation-tag`,
      { method: 'PATCH', body: JSON.stringify({ relationTag: cleanTag }) }
    );
    return;
  }

  try {
    await updateDoc(doc(db, 'families', familyId, 'members', targetUserId), {
      relationTag: cleanTag,
      updatedAt: serverTimestamp(),
    });
    await updateDoc(doc(db, 'users', targetUserId, 'family_memberships', familyId), {
      relationTag: cleanTag,
      updatedAt: serverTimestamp(),
    }).catch(() => {});
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `families/${familyId}/members/${targetUserId}`);
  }
}

export async function updateMemberRole(
  ownerId: string,
  familyId: string,
  targetMember: FamilyMember,
  role: 'admin' | 'member'
): Promise<void> {
  if (!isFirebaseSessionActive(ownerId)) {
    await apiJson(
      `/api/families/${encodeURIComponent(familyId)}/members/${encodeURIComponent(targetMember.userId)}/role`,
      { method: 'PATCH', body: JSON.stringify({ role }) }
    );
    return;
  }

  try {
    await updateDoc(doc(db, 'families', familyId, 'members', targetMember.userId), {
      role,
      updatedAt: serverTimestamp(),
    });
    await updateDoc(doc(db, 'users', targetMember.userId, 'family_memberships', familyId), {
      role,
      updatedAt: serverTimestamp(),
    }).catch(() => {});
    await writeFsSystemMessage(
      familyId,
      role === 'admin' ? `${targetMember.displayName} is now an Admin` : `${targetMember.displayName} is no longer an Admin`
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `families/${familyId}/members/${targetMember.userId}`);
  }
}

export async function removeFamilyMember(
  actor: Profile,
  familyId: string,
  targetMember: FamilyMember
): Promise<void> {
  if (!isFirebaseSessionActive(actor.id)) {
    await apiJson(
      `/api/families/${encodeURIComponent(familyId)}/members/${encodeURIComponent(targetMember.userId)}/remove`,
      { method: 'POST', body: JSON.stringify({}) }
    );
    return;
  }

  try {
    await updateDoc(doc(db, 'families', familyId, 'members', targetMember.userId), {
      status: 'removed',
      role: 'member',
      removedAt: serverTimestamp(),
      removedBy: actor.id,
      updatedAt: serverTimestamp(),
    });
    await deleteDoc(doc(db, 'users', targetMember.userId, 'family_memberships', familyId)).catch(() => {});
    await updateDoc(doc(db, 'families', familyId), {
      memberCount: increment(-1),
      updatedAt: serverTimestamp(),
    });
    const actorName = actor.display_name || actor.username || 'Admin';
    await writeFsSystemMessage(familyId, `${actorName} removed ${targetMember.displayName}`);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `families/${familyId}/members/${targetMember.userId}`);
  }
}

export async function allowMemberRejoin(
  actorId: string,
  familyId: string,
  targetUserId: string
): Promise<void> {
  if (!isFirebaseSessionActive(actorId)) {
    await apiJson(
      `/api/families/${encodeURIComponent(familyId)}/members/${encodeURIComponent(targetUserId)}/allow-rejoin`,
      { method: 'POST', body: JSON.stringify({}) }
    );
    return;
  }

  try {
    await updateDoc(doc(db, 'families', familyId, 'members', targetUserId), {
      status: 'left',
      removedAt: null,
      removedBy: null,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `families/${familyId}/members/${targetUserId}`);
  }
}

export async function transferFamilyOwnership(
  owner: Profile,
  familyId: string,
  targetMember: FamilyMember
): Promise<void> {
  if (!isFirebaseSessionActive(owner.id)) {
    await apiJson(`/api/families/${encodeURIComponent(familyId)}/transfer-ownership`, {
      method: 'POST',
      body: JSON.stringify({ targetUserId: targetMember.userId }),
    });
    return;
  }

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'families', familyId, 'members', owner.id), {
      role: 'admin',
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'families', familyId, 'members', targetMember.userId), {
      role: 'owner',
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'families', familyId), {
      ownerId: targetMember.userId,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();

    await Promise.all([
      updateDoc(doc(db, 'users', owner.id, 'family_memberships', familyId), { role: 'admin', updatedAt: serverTimestamp() }).catch(() => {}),
      updateDoc(doc(db, 'users', targetMember.userId, 'family_memberships', familyId), { role: 'owner', updatedAt: serverTimestamp() }).catch(() => {}),
    ]);

    const oldName = owner.display_name || owner.username || 'Owner';
    await writeFsSystemMessage(familyId, `${oldName} transferred Family ownership to ${targetMember.displayName}`);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `families/${familyId}`);
  }
}

export async function muteFamily(
  userId: string,
  familyId: string,
  duration: FamilyMuteDuration
): Promise<{ isMutedAlways: boolean; mutedUntil: string | null }> {
  if (!isFirebaseSessionActive(userId)) {
    return apiJson(`/api/families/${encodeURIComponent(familyId)}/mute`, {
      method: 'POST',
      body: JSON.stringify({ duration }),
    });
  }

  const computed = computeMutedUntilIso(duration);
  try {
    await updateDoc(doc(db, 'users', userId, 'family_memberships', familyId), {
      isMutedAlways: computed.isMutedAlways,
      mutedUntil: computed.mutedUntil ? new Date(computed.mutedUntil) : null,
      updatedAt: serverTimestamp(),
    });
    return computed;
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${userId}/family_memberships/${familyId}`);
  }
}

export async function clearFamilyChatForSelf(userId: string, familyId: string): Promise<string> {
  if (!isFirebaseSessionActive(userId)) {
    const res = await apiJson<{ clearedAt: string }>(`/api/families/${encodeURIComponent(familyId)}/clear-chat`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    return res.clearedAt;
  }

  try {
    await updateDoc(doc(db, 'users', userId, 'family_memberships', familyId), {
      clearedAt: serverTimestamp(),
      lastReadAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return new Date().toISOString();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${userId}/family_memberships/${familyId}`);
  }
}

export async function leaveFamily(user: Profile, familyId: string): Promise<void> {
  if (!isFirebaseSessionActive(user.id)) {
    await apiJson(`/api/families/${encodeURIComponent(familyId)}/leave`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    return;
  }

  try {
    const displayName = user.display_name || user.username || 'Member';
    await writeFsSystemMessage(familyId, `${displayName} left`);
    await updateDoc(doc(db, 'families', familyId, 'members', user.id), {
      status: 'left',
      role: 'member',
      updatedAt: serverTimestamp(),
    });
    await deleteDoc(doc(db, 'users', user.id, 'family_memberships', familyId)).catch(() => {});
    await updateDoc(doc(db, 'families', familyId), {
      memberCount: increment(-1),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `families/${familyId}`);
  }
}

export async function deleteFamilyGroup(owner: Profile, family: Family): Promise<void> {
  if (!isFirebaseSessionActive(owner.id)) {
    await apiJson(`/api/families/${encodeURIComponent(family.id)}`, { method: 'DELETE' });
    return;
  }

  try {
    const ownerName = owner.display_name || owner.username || 'Owner';
    // Notify active members in pages
    const membersSnap = await getDocs(
      query(collection(db, 'families', family.id, 'members'), where('status', '==', 'active'), limit(500))
    ).catch(() => null);

    if (membersSnap) {
      await Promise.all(
        membersSnap.docs.map(async (mDoc) => {
          await deleteDoc(doc(db, 'users', mDoc.id, 'family_memberships', family.id)).catch(() => {});
          if (mDoc.id !== owner.id) {
            await createFsNotification({
              userId: mDoc.id,
              actorId: owner.id,
              actorProfile: owner,
              type: 'family_deleted',
              title: `Family Deleted: ${family.name}`,
              message: `${ownerName} deleted the Family "${family.name}".`,
              referenceId: family.id,
            });
          }
        })
      );
    }

    if (family.inviteCode) {
      await deleteDoc(doc(db, 'family_invite_links', family.inviteCode)).catch(() => {});
    }
    await deleteDoc(doc(db, 'families', family.id));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `families/${family.id}`);
  }
}

// =========================================================================
// MESSAGES (1 WRITE PER MESSAGE), REACTIONS, PINNING (MAX 3 FIFO), DELETE, READ, TYPING
// =========================================================================

export async function fetchFamilyMessages(
  userId: string,
  familyId: string,
  clearedAt?: string | null,
  beforeIso?: string | null
): Promise<{ messages: (FamilyMessage & { seenCount?: number })[]; hasMore: boolean }> {
  if (!isFirebaseSessionActive(userId)) {
    const qs = new URLSearchParams({ limit: String(FAMILY_MESSAGES_PAGE_SIZE) });
    if (beforeIso) qs.set('before', beforeIso);
    return apiJson(`/api/families/${encodeURIComponent(familyId)}/messages?${qs.toString()}`);
  }

  try {
    const q = query(
      collection(db, 'families', familyId, 'messages'),
      orderBy('createdAt', 'desc'),
      limit(FAMILY_MESSAGES_PAGE_SIZE)
    );
    const snap = await getDocs(q);
    let list = snap.docs.map((d) => mapFsMessage(d.id, d.data())).reverse();
    if (clearedAt) {
      list = list.filter((m) => m.createdAt > clearedAt);
    }
    return { messages: list, hasMore: snap.docs.length === FAMILY_MESSAGES_PAGE_SIZE };
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, `families/${familyId}/messages`);
  }
}

export function subscribeFamilyMessagesFs(
  familyId: string,
  clearedAt: string | null | undefined,
  onUpdate: (messages: (FamilyMessage & { seenCount?: number })[]) => void
): () => void {
  const q = query(
    collection(db, 'families', familyId, 'messages'),
    orderBy('createdAt', 'desc'),
    limit(FAMILY_MESSAGES_PAGE_SIZE)
  );
  return onSnapshot(q, (snap) => {
    let list = snap.docs.map((d) => mapFsMessage(d.id, d.data())).reverse();
    if (clearedAt) {
      list = list.filter((m) => m.createdAt > clearedAt);
    }
    onUpdate(list);
  });
}

export async function sendFamilyMessage(params: {
  user: Profile;
  family: Family;
  role: FamilyRole;
  relationTag?: string | null;
  type?: FamilyMessageType;
  content: string;
  mediaUrl?: string | null;
  mediaType?: 'image' | 'voice' | null;
  cloudinaryPublicId?: string | null;
  b2FileId?: string | null;
  b2FileName?: string | null;
  replyToMessage?: FamilyMessage | null;
  mentions?: string[];
}): Promise<FamilyMessage> {
  if (!isFirebaseSessionActive(params.user.id)) {
    const res = await apiJson<{ message: FamilyMessage }>(
      `/api/families/${encodeURIComponent(params.family.id)}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({
          type: params.type || 'text',
          content: params.content,
          mediaUrl: params.mediaUrl,
          mediaType: params.mediaType,
          cloudinaryPublicId: params.cloudinaryPublicId,
          b2FileId: params.b2FileId,
          b2FileName: params.b2FileName,
          replyToMessageId: params.replyToMessage?.id || null,
          mentions: params.mentions || [],
        }),
      }
    );
    return res.message;
  }

  const msgId = `fmsg_${generateUUID().replace(/-/g, '').slice(0, 20)}`;
  const msgType = params.type || 'text';
  const senderName = params.user.display_name || params.user.username || 'Member';
  const finalContent = msgType === 'safe_checkin' ? params.content || "I'm safe" : params.content.trim().slice(0, 4000);
  const validMentions = Array.from(
    new Set((params.mentions || []).filter((id) => id && id !== 'everyone' && id !== params.user.id))
  ).slice(0, 20);

  const previewText =
    msgType === 'image' || finalContent.startsWith('[IMAGE:')
      ? 'Sent a photo'
      : msgType === 'voice' || finalContent.startsWith('[VOICE:')
        ? 'Sent a voice message'
        : msgType === 'sticker' || finalContent.startsWith('[STICKER:')
          ? 'Sent a sticker'
          : msgType === 'safe_checkin'
            ? "I'm Safe check-in"
            : finalContent.slice(0, 160);

  try {
    // STRICT 1-WRITE-PER-MESSAGE into shared families/{familyId}/messages/{msgId}
    await setDoc(doc(db, 'families', params.family.id, 'messages', msgId), {
      id: msgId,
      familyId: params.family.id,
      senderId: params.user.id,
      senderName,
      senderUsername: params.user.username || null,
      senderAvatar: params.user.avatar_url || null,
      senderRole: params.role,
      senderRelationTag: params.relationTag || null,
      type: msgType,
      content: finalContent,
      mediaUrl: params.mediaUrl || null,
      mediaType: params.mediaType || null,
      cloudinaryPublicId: params.cloudinaryPublicId || null,
      b2FileId: params.b2FileId || null,
      b2FileName: params.b2FileName || null,
      replyToMessageId: params.replyToMessage?.id || null,
      replyToMessage: params.replyToMessage
        ? {
            id: params.replyToMessage.id,
            senderId: params.replyToMessage.senderId,
            senderName: params.replyToMessage.senderName,
            content: params.replyToMessage.isDeleted
              ? 'This message was deleted'
              : params.replyToMessage.content.slice(0, 140),
          }
        : null,
      mentions: validMentions,
      reactions: {},
      isPinned: false,
      isDeleted: false,
      seenCount: 0,
      safeCheckInAt: msgType === 'safe_checkin' ? serverTimestamp() : null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await updateDoc(doc(db, 'families', params.family.id), {
      lastMessageId: msgId,
      lastMessageText: previewText,
      lastMessageSenderId: params.user.id,
      lastMessageSenderName: senderName,
      lastMessageAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }).catch(() => {});

    // Notify @mentioned members directly (notifies even if they muted)
    await Promise.all(
      validMentions.map((targetId) =>
        createFsNotification({
          userId: targetId,
          actorId: params.user.id,
          actorProfile: params.user,
          type: 'family_mention',
          title: `${senderName} mentioned you in ${params.family.name}`,
          message: previewText,
          referenceId: params.family.id,
        })
      )
    );

    const nowIso = new Date().toISOString();
    return {
      id: msgId,
      familyId: params.family.id,
      senderId: params.user.id,
      senderName,
      senderUsername: params.user.username,
      senderAvatar: params.user.avatar_url,
      senderRole: params.role,
      senderRelationTag: params.relationTag || null,
      type: msgType,
      content: finalContent,
      mediaUrl: params.mediaUrl || null,
      mediaType: params.mediaType || null,
      cloudinaryPublicId: params.cloudinaryPublicId || null,
      b2FileId: params.b2FileId || null,
      b2FileName: params.b2FileName || null,
      replyToMessageId: params.replyToMessage?.id || null,
      replyToMessage: params.replyToMessage
        ? {
            id: params.replyToMessage.id,
            senderId: params.replyToMessage.senderId,
            senderName: params.replyToMessage.senderName,
            content: params.replyToMessage.content,
          }
        : null,
      mentions: validMentions,
      reactions: {},
      isPinned: false,
      isDeleted: false,
      safeCheckInAt: msgType === 'safe_checkin' ? nowIso : null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `families/${params.family.id}/messages/${msgId}`);
  }
}

export async function toggleFamilyMessageReaction(
  userId: string,
  familyId: string,
  messageId: string,
  emoji: string,
  currentReactions: Record<string, string[]>
): Promise<Record<string, string[]>> {
  if (!isFirebaseSessionActive(userId)) {
    const res = await apiJson<{ reactions: Record<string, string[]> }>(
      `/api/families/${encodeURIComponent(familyId)}/messages/${encodeURIComponent(messageId)}/react`,
      { method: 'POST', body: JSON.stringify({ emoji }) }
    );
    return res.reactions;
  }

  const next = { ...currentReactions };
  const users = Array.isArray(next[emoji]) ? [...next[emoji]] : [];
  const idx = users.indexOf(userId);
  if (idx >= 0) users.splice(idx, 1);
  else users.push(userId);
  if (users.length === 0) delete next[emoji];
  else next[emoji] = users;

  try {
    await updateDoc(doc(db, 'families', familyId, 'messages', messageId), {
      reactions: next,
      updatedAt: serverTimestamp(),
    });
    return next;
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `families/${familyId}/messages/${messageId}`);
  }
}

export async function togglePinFamilyMessage(
  actor: Profile,
  family: Family,
  message: FamilyMessage
): Promise<FamilyPinnedMessage[]> {
  if (!isFirebaseSessionActive(actor.id)) {
    const res = await apiJson<{ pinnedMessages: FamilyPinnedMessage[] }>(
      `/api/families/${encodeURIComponent(family.id)}/messages/${encodeURIComponent(message.id)}/pin`,
      { method: 'POST', body: JSON.stringify({}) }
    );
    return res.pinnedMessages;
  }

  const nextPins = [...(family.pinnedMessages || [])];
  const existingIdx = nextPins.findIndex((p) => p.messageId === message.id);
  const actorName = actor.display_name || actor.username || 'Admin';
  const nowIso = new Date().toISOString();

  try {
    if (existingIdx >= 0) {
      nextPins.splice(existingIdx, 1);
      await updateDoc(doc(db, 'families', family.id, 'messages', message.id), {
        isPinned: false,
        updatedAt: serverTimestamp(),
      });
    } else {
      while (nextPins.length >= FAMILY_MAX_PINNED_MESSAGES) {
        const evicted = nextPins.shift();
        if (evicted?.messageId) {
          await updateDoc(doc(db, 'families', family.id, 'messages', evicted.messageId), {
            isPinned: false,
            updatedAt: serverTimestamp(),
          }).catch(() => {});
        }
      }
      nextPins.push({
        messageId: message.id,
        content: message.content.slice(0, 180),
        senderId: message.senderId,
        senderName: message.senderName,
        pinnedById: actor.id,
        pinnedByName: actorName,
        pinnedAt: nowIso,
      });
      await updateDoc(doc(db, 'families', family.id, 'messages', message.id), {
        isPinned: true,
        updatedAt: serverTimestamp(),
      });
    }

    await updateDoc(doc(db, 'families', family.id), {
      pinnedMessages: nextPins,
      updatedAt: serverTimestamp(),
    });
    return nextPins;
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `families/${family.id}`);
  }
}

export async function deleteFamilyMessage(
  actorId: string,
  actorRole: FamilyRole,
  family: Family,
  message: FamilyMessage
): Promise<void> {
  if (!isFirebaseSessionActive(actorId)) {
    await apiJson(
      `/api/families/${encodeURIComponent(family.id)}/messages/${encodeURIComponent(message.id)}`,
      { method: 'DELETE' }
    );
    return;
  }

  try {
    await updateDoc(doc(db, 'families', family.id, 'messages', message.id), {
      isDeleted: true,
      isPinned: false,
      content: 'This message was deleted',
      mediaUrl: null,
      cloudinaryPublicId: null,
      b2FileId: null,
      b2FileName: null,
      reactions: {},
      deletedBy: actorId,
      deletedByRole: actorRole,
      updatedAt: serverTimestamp(),
    });

    const filteredPins = (family.pinnedMessages || []).filter((p) => p.messageId !== message.id);
    if (filteredPins.length !== (family.pinnedMessages || []).length) {
      await updateDoc(doc(db, 'families', family.id), {
        pinnedMessages: filteredPins,
        updatedAt: serverTimestamp(),
      }).catch(() => {});
    }

    const publicId = message.cloudinaryPublicId || message.b2FileId;
    if (publicId) {
      fetch('/api/b2/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cloudinary_public_id: publicId,
          resource_type: message.mediaType === 'voice' ? 'raw' : 'image',
        }),
      }).catch(() => {});
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `families/${family.id}/messages/${message.id}`);
  }
}

export async function markFamilyMessagesRead(
  user: Profile,
  familyId: string,
  messageIds: string[]
): Promise<void> {
  if (!isFirebaseSessionActive(user.id)) {
    await apiJson(`/api/families/${encodeURIComponent(familyId)}/read`, {
      method: 'POST',
      body: JSON.stringify({ messageIds }),
    }).catch(() => {});
    return;
  }

  try {
    await updateDoc(doc(db, 'users', user.id, 'family_memberships', familyId), {
      lastReadAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }).catch(() => {});

    const recentIds = messageIds.slice(-15);
    const displayName = user.display_name || user.username || 'Member';
    await Promise.all(
      recentIds.map((mid) =>
        setDoc(
          doc(db, 'families', familyId, 'reads', `${mid}_${user.id}`),
          {
            id: `${mid}_${user.id}`,
            messageId: mid,
            userId: user.id,
            displayName,
            readAt: serverTimestamp(),
          },
          { merge: true }
        ).catch(() => {})
      )
    );
  } catch {
    // Non-critical read-receipt sync
  }
}

export async function getFamilyMessageSeenInfo(
  userId: string,
  familyId: string,
  messageId: string,
  memberCount: number
): Promise<{ count: number; readers: Array<{ userId: string; displayName: string; readAt: string }>; isLargeFamily: boolean }> {
  if (!isFirebaseSessionActive(userId)) {
    return apiJson(`/api/families/${encodeURIComponent(familyId)}/messages/${encodeURIComponent(messageId)}/seen`);
  }

  const isLargeFamily = memberCount > FAMILY_LARGE_THRESHOLD;
  try {
    const cntSnap = await getCountFromServer(
      query(collection(db, 'families', familyId, 'reads'), where('messageId', '==', messageId))
    );
    const count = cntSnap.data().count || 0;
    if (isLargeFamily) {
      return { count, readers: [], isLargeFamily: true };
    }
    const snap = await getDocs(
      query(
        collection(db, 'families', familyId, 'reads'),
        where('messageId', '==', messageId),
        limit(50)
      )
    );
    const readers = snap.docs.map((d) => {
      const rd = d.data();
      return {
        userId: rd.userId,
        displayName: rd.displayName || 'Member',
        readAt: tsToIso(rd.readAt),
      };
    });
    return { count: Math.max(count, readers.length), readers, isLargeFamily: false };
  } catch {
    return { count: 0, readers: [], isLargeFamily };
  }
}

export async function setFamilyTypingStatus(
  user: Profile,
  family: Family,
  isTyping: boolean
): Promise<void> {
  if (family.memberCount > FAMILY_LARGE_THRESHOLD) return;
  if (!isFirebaseSessionActive(user.id)) {
    await apiJson(`/api/families/${encodeURIComponent(family.id)}/typing`, {
      method: 'POST',
      body: JSON.stringify({ isTyping }),
    }).catch(() => {});
    return;
  }

  const ref = doc(db, 'families', family.id, 'typing', user.id);
  try {
    if (isTyping) {
      await setDoc(ref, {
        userId: user.id,
        familyId: family.id,
        displayName: user.display_name || user.username || 'Member',
        expiresAt: Date.now() + 5500,
        updatedAt: serverTimestamp(),
      });
    } else {
      await deleteDoc(ref).catch(() => {});
    }
  } catch {
    // Non-critical typing pulse
  }
}

export async function fetchFamilyTypingUsers(
  userId: string,
  family: Family
): Promise<Array<{ userId: string; displayName: string }>> {
  if (family.memberCount > FAMILY_LARGE_THRESHOLD) return [];
  if (!isFirebaseSessionActive(userId)) {
    const res = await apiJson<{ typingUsers: Array<{ userId: string; displayName: string }> }>(
      `/api/families/${encodeURIComponent(family.id)}/typing`
    ).catch(() => ({ typingUsers: [] }));
    return res.typingUsers || [];
  }

  try {
    const snap = await getDocs(
      query(collection(db, 'families', family.id, 'typing'), where('expiresAt', '>', Date.now()), limit(10))
    );
    return snap.docs
      .filter((d) => d.id !== userId)
      .map((d) => ({ userId: d.id, displayName: d.data().displayName || 'Member' }));
  } catch {
    return [];
  }
}

export async function notifyFamilyAdminsOfReportFs(params: {
  reporterId: string;
  family: Family;
  reportedUserName: string;
  category: string;
}): Promise<void> {
  if (!isFirebaseSessionActive(params.reporterId)) return;
  try {
    const adminsSnap = await getDocs(
      query(
        collection(db, 'families', params.family.id, 'members'),
        where('status', '==', 'active'),
        where('role', 'in', ['owner', 'admin']),
        limit(25)
      )
    ).catch(() => null);
    if (!adminsSnap) return;
    await Promise.all(
      adminsSnap.docs.map((ad) =>
        createFsNotification({
          userId: ad.id,
          actorId: 'system', // Reporter identity is completely hidden
          type: 'family_message_report',
          title: `Message Reported in ${params.family.name}`,
          message: `A member reported a message from ${params.reportedUserName} (${params.category}).`,
          referenceId: params.family.id,
        })
      )
    );
  } catch {
    // Silent fallback
  }
}
