import express from 'express';
import crypto from 'crypto';
import {
  db,
  generateId,
  findUserById,
  getProfileById,
  findMatchedBannedWords,
  recordActivityEvent,
  DbUserRow,
} from './db';
import { deleteAssetFromCloudinary } from './cloudinaryService';

const MAX_MEMBERS = 5000;
const LARGE_FAMILY_THRESHOLD = 50;
const MAX_INVITE_BATCH = 10;
const MAX_DAILY_INVITES = 50;
const MAX_PINNED_MESSAGES = 3;

const VALID_MUTE_DURATIONS = new Set(['1h', '8h', '1w', 'always', 'off']);

// Sliding-window rate limiter for Family message sends (max 20 msgs per 10 seconds per user)
const familyMsgRateBuckets = new Map<string, number[]>();

function checkFamilyMessageRateLimit(userId: string): boolean {
  const now = Date.now();
  const cutoff = now - 10_000;
  const recent = (familyMsgRateBuckets.get(userId) || []).filter((ts) => ts > cutoff);
  if (recent.length >= 20) {
    familyMsgRateBuckets.set(userId, recent);
    return false;
  }
  recent.push(now);
  familyMsgRateBuckets.set(userId, recent);
  return true;
}

function generateInviteCode(): string {
  return `fam_${crypto.randomBytes(6).toString('hex')}`;
}

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function formatFamilyRow(row: any, includePendingCount = false) {
  if (!row) return null;
  let pendingRequestsCount: number | undefined;
  if (includePendingCount) {
    const cnt = db
      .prepare("SELECT COUNT(*) as cnt FROM family_requests WHERE family_id = ? AND status = 'pending'")
      .get(row.id) as { cnt: number };
    pendingRequestsCount = Number(cnt?.cnt || 0);
  }
  return {
    id: row.id,
    name: row.name,
    photoUrl: row.photo_url || null,
    ownerId: row.owner_id,
    memberCount: Number(row.member_count || 0),
    maxMembers: Number(row.max_members || MAX_MEMBERS),
    joinApprovalRequired: Boolean(row.join_approval_required),
    onlyAdminsCanSend: Boolean(row.only_admins_can_send),
    inviteCode: row.invite_link_enabled ? row.invite_code || null : null,
    inviteLinkEnabled: Boolean(row.invite_link_enabled),
    pinnedMessages: safeJsonParse(row.pinned_messages_json, []),
    lastMessageId: row.last_message_id || null,
    lastMessageText: row.last_message_text || null,
    lastMessageSenderId: row.last_message_sender_id || null,
    lastMessageSenderName: row.last_message_sender_name || null,
    lastMessageAt: row.last_message_at || null,
    pendingRequestsCount,
    isSuspended: Boolean(row.is_suspended),
    suspendedReason: row.suspended_reason || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function formatMemberRow(row: any, hidePresence: boolean) {
  return {
    userId: row.user_id,
    familyId: row.family_id,
    role: row.role,
    status: row.status,
    relationTag: row.relation_tag || null,
    displayName: row.live_display_name || row.display_name || row.username || 'User',
    username: row.live_username || row.username || 'user',
    avatarUrl: row.live_avatar_url !== undefined ? row.live_avatar_url : row.avatar_url || null,
    isOnline: hidePresence ? false : Boolean(row.live_is_online),
    lastSeen: hidePresence ? null : row.live_last_seen || null,
    joinedAt: row.joined_at,
    updatedAt: row.updated_at,
    removedAt: row.removed_at || null,
    removedBy: row.removed_by || null,
  };
}

function computeUnreadCount(familyId: string, userId: string, lastReadAt: string | null, clearedAt: string | null, joinedAt: string): number {
  const baseline = [lastReadAt, clearedAt, joinedAt]
    .filter((v): v is string => Boolean(v))
    .sort()
    .pop() || joinedAt;

  const row = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM family_messages
       WHERE family_id = ? AND created_at > ? AND sender_id != ? AND is_deleted = 0`
    )
    .get(familyId, baseline, userId) as { cnt: number };
  return Number(row?.cnt || 0);
}

function insertNotificationRow(params: {
  userId: string;
  actorId: string;
  type: string;
  title: string;
  message: string;
  referenceId?: string | null;
}) {
  const actor = params.actorId && params.actorId !== 'system' ? getProfileById(params.actorId) : null;
  db.prepare(`
    INSERT INTO notifications (id, user_id, actor_id, type, title, message, reference_id, actor_json, is_read, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(
    generateId(),
    params.userId,
    params.actorId,
    params.type,
    params.title.slice(0, 140),
    params.message.slice(0, 320),
    params.referenceId || null,
    actor ? JSON.stringify(actor) : null,
    new Date().toISOString()
  );
}

function insertSystemMessage(familyId: string, text: string) {
  const nowIso = new Date().toISOString();
  const msgId = `fmsg_${generateId().replace(/-/g, '').slice(0, 20)}`;
  db.prepare(`
    INSERT INTO family_messages (
      id, family_id, sender_id, sender_name, type, content,
      mentions_json, reactions_json, is_pinned, is_deleted, created_at, updated_at
    ) VALUES (?, ?, 'system', 'System', 'system', ?, '[]', '{}', 0, 0, ?, ?)
  `).run(msgId, familyId, text, nowIso, nowIso);

  db.prepare(`
    UPDATE families SET
      last_message_id = ?,
      last_message_text = ?,
      last_message_sender_id = 'system',
      last_message_sender_name = 'System',
      last_message_at = ?,
      updated_at = ?
    WHERE id = ?
  `).run(msgId, text, nowIso, nowIso, familyId);

  return msgId;
}

function recalcFamilyMemberCount(familyId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) as cnt FROM family_members WHERE family_id = ? AND status = 'active'")
    .get(familyId) as { cnt: number };
  const cnt = Number(row?.cnt || 0);
  db.prepare('UPDATE families SET member_count = ?, updated_at = ? WHERE id = ?').run(
    cnt,
    new Date().toISOString(),
    familyId
  );
  return cnt;
}

function formatMessageRow(row: any, seenCountMap?: Map<string, number>) {
  const replyTo = safeJsonParse<any>(row.reply_to_json, null);
  return {
    id: row.id,
    familyId: row.family_id,
    senderId: row.sender_id,
    senderName: row.sender_name,
    senderUsername: row.sender_username || null,
    senderAvatar: row.sender_avatar || null,
    senderRole: row.sender_role || 'member',
    senderRelationTag: row.sender_relation_tag || null,
    type: row.type,
    content: row.is_deleted ? 'This message was deleted' : row.content,
    mediaUrl: row.is_deleted ? null : row.media_url || null,
    mediaType: row.is_deleted ? null : row.media_type || null,
    cloudinaryPublicId: row.is_deleted ? null : row.cloudinary_public_id || null,
    b2FileId: row.is_deleted ? null : row.b2_file_id || null,
    b2FileName: row.is_deleted ? null : row.b2_file_name || null,
    replyToMessageId: row.reply_to_message_id || null,
    replyToMessage: replyTo,
    mentions: safeJsonParse<string[]>(row.mentions_json, []),
    reactions: row.is_deleted ? {} : safeJsonParse<Record<string, string[]>>(row.reactions_json, {}),
    isPinned: Boolean(row.is_pinned),
    isDeleted: Boolean(row.is_deleted),
    deletedBy: row.deleted_by || null,
    deletedByRole: row.deleted_by_role || null,
    safeCheckInAt: row.safe_checkin_at || null,
    seenCount: seenCountMap ? Number(seenCountMap.get(row.id) || 0) : 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createFamilyRouter(requireAuth: express.RequestHandler) {
  const router = express.Router();
  router.use(requireAuth);

  // Guard helper inside router: restricted accounts cannot perform write operations
  function rejectIfRestricted(req: express.Request, res: express.Response): boolean {
    const userRow = (req as any).authUserRow as DbUserRow | undefined;
    if (userRow?.status === 'restricted') {
      res.status(403).json({
        error: 'Your account is temporarily restricted from sending messages or managing Family groups.',
        code: 'ACCOUNT_RESTRICTED',
      });
      return true;
    }
    return false;
  }

  function getActiveMembership(familyId: string, userId: string) {
    return db
      .prepare('SELECT * FROM family_members WHERE family_id = ? AND user_id = ? LIMIT 1')
      .get(familyId, userId) as any;
  }

  // 1. List user's Families + pending invites
  router.get('/my', (req, res) => {
    try {
      const userId = (req as any).authUserId as string;
      const memberRows = db
        .prepare(`
          SELECT fm.*, f.id as f_id, f.name, f.photo_url, f.owner_id, f.member_count, f.max_members,
                 f.join_approval_required, f.only_admins_can_send, f.invite_code, f.invite_link_enabled,
                 f.pinned_messages_json, f.last_message_id, f.last_message_text, f.last_message_sender_id,
                 f.last_message_sender_name, f.last_message_at, f.created_at as f_created_at, f.updated_at as f_updated_at
          FROM family_members fm
          INNER JOIN families f ON f.id = fm.family_id
          WHERE fm.user_id = ? AND fm.status IN ('active', 'pending')
          ORDER BY COALESCE(f.last_message_at, f.updated_at) DESC
        `)
        .all(userId) as any[];

      const memberships = memberRows.map((row) => {
        const isPrivileged = row.status === 'active' && (row.role === 'owner' || row.role === 'admin');
        const unreadCount =
          row.status === 'active'
            ? computeUnreadCount(row.family_id, userId, row.last_read_at, row.cleared_at, row.joined_at)
            : 0;
        const familyObj = formatFamilyRow(
          {
            id: row.f_id,
            name: row.name,
            photo_url: row.photo_url,
            owner_id: row.owner_id,
            member_count: row.member_count,
            max_members: row.max_members,
            join_approval_required: row.join_approval_required,
            only_admins_can_send: row.only_admins_can_send,
            invite_code: row.invite_code,
            invite_link_enabled: row.invite_link_enabled,
            pinned_messages_json: row.pinned_messages_json,
            last_message_id: row.last_message_id,
            last_message_text: row.last_message_text,
            last_message_sender_id: row.last_message_sender_id,
            last_message_sender_name: row.last_message_sender_name,
            last_message_at: row.last_message_at,
            created_at: row.f_created_at,
            updated_at: row.f_updated_at,
          },
          isPrivileged
        );

        return {
          familyId: row.family_id,
          userId: row.user_id,
          role: row.role,
          status: row.status,
          relationTag: row.relation_tag || null,
          mutedUntil: row.muted_until || null,
          isMutedAlways: Boolean(row.is_muted_always),
          lastReadAt: row.last_read_at || null,
          clearedAt: row.cleared_at || null,
          unreadCount,
          joinedAt: row.joined_at,
          updatedAt: row.updated_at,
          family: familyObj,
        };
      });

      const invites = db
        .prepare(
          `SELECT * FROM family_invites
           WHERE invitee_id = ? AND status = 'pending'
           ORDER BY created_at DESC LIMIT 50`
        )
        .all(userId)
        .map((inv: any) => ({
          id: inv.id,
          familyId: inv.family_id,
          familyName: inv.family_name,
          familyPhotoUrl: inv.family_photo_url || null,
          inviterId: inv.inviter_id,
          inviterName: inv.inviter_name,
          inviteeId: inv.invitee_id,
          status: inv.status,
          createdAt: inv.created_at,
          respondedAt: inv.responded_at || null,
        }));

      return res.json({ memberships, invites });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to load Families' });
    }
  });

  // 2. Create Family
  router.post('/', (req, res) => {
    try {
      if (rejectIfRestricted(req, res)) return;
      const userId = (req as any).authUserId as string;
      const { name, photoUrl, joinApprovalRequired, relationTag } = req.body || {};

      const cleanName = typeof name === 'string' ? name.trim().slice(0, 80) : '';
      if (!cleanName) {
        return res.status(400).json({ error: 'Family name is required.' });
      }
      const matchedNameWords = findMatchedBannedWords(cleanName).filter((w) => w.action === 'block');
      if (matchedNameWords.length > 0) {
        return res.status(400).json({ error: 'Family name contains a restricted word.' });
      }
      const cleanPhoto = typeof photoUrl === 'string' && photoUrl.trim() ? photoUrl.trim().slice(0, 500) : null;
      const cleanRelation = typeof relationTag === 'string' && relationTag.trim() ? relationTag.trim().slice(0, 32) : null;
      const approvalFlag = joinApprovalRequired === undefined ? 1 : joinApprovalRequired ? 1 : 0;

      const profile = getProfileById(userId);
      const nowIso = new Date().toISOString();
      const familyId = `fam_${generateId().replace(/-/g, '').slice(0, 20)}`;
      const inviteCode = generateInviteCode();
      const sysMsgId = `fmsg_${generateId().replace(/-/g, '').slice(0, 20)}`;
      const ownerDisplay = profile?.display_name || profile?.username || 'Owner';
      const welcomeText = `${ownerDisplay} created "${cleanName}"`;

      db.exec('BEGIN');
      try {
        db.prepare(`
          INSERT INTO families (
            id, name, photo_url, owner_id, member_count, max_members,
            join_approval_required, only_admins_can_send, invite_code, invite_link_enabled,
            pinned_messages_json, last_message_id, last_message_text, last_message_sender_id,
            last_message_sender_name, last_message_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 1, ?, ?, 0, ?, 1, '[]', ?, ?, 'system', 'System', ?, ?, ?)
        `).run(
          familyId,
          cleanName,
          cleanPhoto,
          userId,
          MAX_MEMBERS,
          approvalFlag,
          inviteCode,
          sysMsgId,
          welcomeText,
          nowIso,
          nowIso,
          nowIso
        );

        db.prepare(`
          INSERT INTO family_members (
            family_id, user_id, role, status, relation_tag, display_name, username, avatar_url,
            muted_until, is_muted_always, last_read_at, joined_at, updated_at
          ) VALUES (?, ?, 'owner', 'active', ?, ?, ?, ?, NULL, 0, ?, ?, ?)
        `).run(
          familyId,
          userId,
          cleanRelation,
          ownerDisplay,
          profile?.username || 'user',
          profile?.avatar_url || null,
          nowIso,
          nowIso,
          nowIso
        );

        db.prepare(`
          INSERT INTO family_messages (
            id, family_id, sender_id, sender_name, type, content,
            mentions_json, reactions_json, is_pinned, is_deleted, created_at, updated_at
          ) VALUES (?, ?, 'system', 'System', 'system', ?, '[]', '{}', 0, 0, ?, ?)
        `).run(sysMsgId, familyId, welcomeText, nowIso, nowIso);

        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }

      const famRow = db.prepare('SELECT * FROM families WHERE id = ?').get(familyId);
      const memRow = db.prepare('SELECT * FROM family_members WHERE family_id = ? AND user_id = ?').get(familyId, userId) as any;

      return res.json({
        family: formatFamilyRow(famRow, true),
        membership: {
          familyId,
          userId,
          role: 'owner',
          status: 'active',
          relationTag: cleanRelation,
          mutedUntil: null,
          isMutedAlways: false,
          lastReadAt: memRow?.last_read_at || nowIso,
          clearedAt: null,
          unreadCount: 0,
          joinedAt: nowIso,
          updatedAt: nowIso,
          family: formatFamilyRow(famRow, true),
        },
      });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to create Family' });
    }
  });

  // 3. Lookup Family by Invite Code
  router.get('/by-invite/:code', (req, res) => {
    try {
      const userId = (req as any).authUserId as string;
      const code = String(req.params.code || '').trim();
      if (!code) return res.status(400).json({ error: 'Invite code is required.' });

      const fam = db
        .prepare('SELECT * FROM families WHERE invite_code = ? AND invite_link_enabled = 1 LIMIT 1')
        .get(code) as any;

      if (!fam) {
        return res.status(404).json({ error: 'Invite link is invalid or has been disabled.' });
      }

      const mem = getActiveMembership(fam.id, userId);
      return res.json({
        family: {
          id: fam.id,
          name: fam.name,
          photoUrl: fam.photo_url || null,
          memberCount: Number(fam.member_count || 0),
          maxMembers: Number(fam.max_members || MAX_MEMBERS),
          joinApprovalRequired: Boolean(fam.join_approval_required),
        },
        membershipStatus: mem?.status || null,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to look up invite link' });
    }
  });

  // 4. Join via Invite Code
  router.post('/join-by-code', (req, res) => {
    try {
      if (rejectIfRestricted(req, res)) return;
      const userId = (req as any).authUserId as string;
      const code = String(req.body?.code || '').trim();
      if (!code) return res.status(400).json({ error: 'Invite code is required.' });

      const fam = db
        .prepare('SELECT * FROM families WHERE invite_code = ? AND invite_link_enabled = 1 LIMIT 1')
        .get(code) as any;

      if (!fam) {
        return res.status(404).json({ error: 'This invite link is invalid, reset, or disabled.' });
      }
      if (fam.is_suspended) {
        return res.status(403).json({
          error: fam.suspended_reason ? `This Family is suspended: ${fam.suspended_reason}` : 'This Family has been suspended by an administrator.',
          code: 'FAMILY_SUSPENDED',
        });
      }

      const existing = getActiveMembership(fam.id, userId);
      if (existing?.status === 'active') {
        return res.json({
          status: 'active',
          family: formatFamilyRow(fam, existing.role === 'owner' || existing.role === 'admin'),
        });
      }
      if (existing?.status === 'removed') {
        return res.status(403).json({
          error: 'You were removed from this Family and cannot rejoin until an Owner or Admin allows you again.',
          code: 'FAMILY_REMOVED',
        });
      }

      if (Number(fam.member_count || 0) >= MAX_MEMBERS) {
        return res.status(400).json({ error: `This Family has reached the maximum of ${MAX_MEMBERS} members.` });
      }

      const profile = getProfileById(userId);
      const displayName = profile?.display_name || profile?.username || 'Member';
      const username = profile?.username || 'user';
      const avatarUrl = profile?.avatar_url || null;
      const nowIso = new Date().toISOString();

      if (fam.join_approval_required) {
        db.prepare(`
          INSERT INTO family_requests (family_id, user_id, display_name, username, avatar_url, status, invite_code, created_at)
          VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
          ON CONFLICT(family_id, user_id) DO UPDATE SET
            display_name = excluded.display_name,
            username = excluded.username,
            avatar_url = excluded.avatar_url,
            status = 'pending',
            invite_code = excluded.invite_code,
            created_at = excluded.created_at,
            reviewed_at = NULL,
            reviewed_by = NULL
        `).run(fam.id, userId, displayName, username, avatarUrl, code, nowIso);

        db.prepare(`
          INSERT INTO family_members (
            family_id, user_id, role, status, display_name, username, avatar_url, joined_at, updated_at
          ) VALUES (?, ?, 'member', 'pending', ?, ?, ?, ?, ?)
          ON CONFLICT(family_id, user_id) DO UPDATE SET
            status = 'pending',
            display_name = excluded.display_name,
            username = excluded.username,
            avatar_url = excluded.avatar_url,
            updated_at = excluded.updated_at
        `).run(fam.id, userId, displayName, username, avatarUrl, nowIso, nowIso);

        // Notify Owner & Admins
        const admins = db
          .prepare("SELECT user_id FROM family_members WHERE family_id = ? AND status = 'active' AND role IN ('owner', 'admin')")
          .all(fam.id) as Array<{ user_id: string }>;
        for (const admin of admins) {
          insertNotificationRow({
            userId: admin.user_id,
            actorId: userId,
            type: 'family_join_request',
            title: `Join request: ${fam.name}`,
            message: `${displayName} (@${username}) requested to join ${fam.name}.`,
            referenceId: fam.id,
          });
        }

        return res.json({ status: 'pending', familyId: fam.id, familyName: fam.name });
      }

      // Direct join (Join approval OFF)
      const autoMute = Number(fam.member_count || 0) >= LARGE_FAMILY_THRESHOLD ? 1 : 0;
      db.prepare(`
        INSERT INTO family_members (
          family_id, user_id, role, status, display_name, username, avatar_url,
          muted_until, is_muted_always, last_read_at, joined_at, updated_at
        ) VALUES (?, ?, 'member', 'active', ?, ?, ?, NULL, ?, ?, ?, ?)
        ON CONFLICT(family_id, user_id) DO UPDATE SET
          role = 'member',
          status = 'active',
          display_name = excluded.display_name,
          username = excluded.username,
          avatar_url = excluded.avatar_url,
          is_muted_always = excluded.is_muted_always,
          last_read_at = excluded.last_read_at,
          joined_at = excluded.joined_at,
          updated_at = excluded.updated_at,
          removed_at = NULL,
          removed_by = NULL
      `).run(fam.id, userId, displayName, username, avatarUrl, autoMute, nowIso, nowIso, nowIso);

      recalcFamilyMemberCount(fam.id);
      insertSystemMessage(fam.id, `${displayName} joined via invite link`);

      const updatedFam = db.prepare('SELECT * FROM families WHERE id = ?').get(fam.id);
      return res.json({ status: 'active', family: formatFamilyRow(updatedFam, false) });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to join Family' });
    }
  });

  // 5. Respond to a direct Family Invite
  router.post('/invites/:inviteId/respond', (req, res) => {
    try {
      const userId = (req as any).authUserId as string;
      const { inviteId } = req.params;
      const action = String(req.body?.action || '').trim().toLowerCase();
      if (action !== 'accept' && action !== 'decline') {
        return res.status(400).json({ error: 'action must be accept or decline.' });
      }
      if (action === 'accept' && rejectIfRestricted(req, res)) return;

      const invite = db
        .prepare('SELECT * FROM family_invites WHERE id = ? AND invitee_id = ? LIMIT 1')
        .get(inviteId, userId) as any;
      if (!invite) {
        return res.status(404).json({ error: 'Invite not found.' });
      }
      if (invite.status !== 'pending') {
        return res.json({ success: true, status: invite.status, familyId: invite.family_id });
      }

      const nowIso = new Date().toISOString();
      if (action === 'decline') {
        db.prepare("UPDATE family_invites SET status = 'declined', responded_at = ? WHERE id = ?").run(nowIso, inviteId);
        return res.json({ success: true, status: 'declined' });
      }

      const fam = db.prepare('SELECT * FROM families WHERE id = ? LIMIT 1').get(invite.family_id) as any;
      if (!fam) {
        db.prepare("UPDATE family_invites SET status = 'declined', responded_at = ? WHERE id = ?").run(nowIso, inviteId);
        return res.status(404).json({ error: 'This Family no longer exists.' });
      }

      const existing = getActiveMembership(fam.id, userId);
      if (existing?.status === 'removed') {
        return res.status(403).json({
          error: 'You were removed from this Family and cannot join until an Owner or Admin allows you again.',
        });
      }

      if (existing?.status !== 'active' && Number(fam.member_count || 0) >= MAX_MEMBERS) {
        return res.status(400).json({ error: `This Family has reached the ${MAX_MEMBERS} member limit.` });
      }

      const profile = getProfileById(userId);
      const displayName = profile?.display_name || profile?.username || 'Member';
      const username = profile?.username || 'user';
      const autoMute = Number(fam.member_count || 0) >= LARGE_FAMILY_THRESHOLD ? 1 : 0;

      db.exec('BEGIN');
      try {
        db.prepare("UPDATE family_invites SET status = 'accepted', responded_at = ? WHERE id = ?").run(nowIso, inviteId);

        if (existing?.status !== 'active') {
          db.prepare(`
            INSERT INTO family_members (
              family_id, user_id, role, status, display_name, username, avatar_url,
              muted_until, is_muted_always, last_read_at, joined_at, updated_at
            ) VALUES (?, ?, 'member', 'active', ?, ?, ?, NULL, ?, ?, ?, ?)
            ON CONFLICT(family_id, user_id) DO UPDATE SET
              role = 'member',
              status = 'active',
              display_name = excluded.display_name,
              username = excluded.username,
              avatar_url = excluded.avatar_url,
              is_muted_always = excluded.is_muted_always,
              last_read_at = excluded.last_read_at,
              joined_at = excluded.joined_at,
              updated_at = excluded.updated_at,
              removed_at = NULL,
              removed_by = NULL
          `).run(fam.id, userId, displayName, username, profile?.avatar_url || null, autoMute, nowIso, nowIso, nowIso);

          db.prepare("DELETE FROM family_requests WHERE family_id = ? AND user_id = ?").run(fam.id, userId);
          recalcFamilyMemberCount(fam.id);
          insertSystemMessage(fam.id, `${invite.inviter_name} added ${displayName}`);
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }

      const updatedFam = db.prepare('SELECT * FROM families WHERE id = ?').get(fam.id);
      return res.json({ success: true, status: 'accepted', familyId: fam.id, family: formatFamilyRow(updatedFam, false) });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to respond to invite' });
    }
  });

  // 6. Get single Family detail + current user's membership
  router.get('/:familyId', (req, res) => {
    try {
      const userId = (req as any).authUserId as string;
      const { familyId } = req.params;
      const fam = db.prepare('SELECT * FROM families WHERE id = ? LIMIT 1').get(familyId) as any;
      if (!fam) return res.status(404).json({ error: 'Family not found.' });

      const mem = getActiveMembership(familyId, userId);
      if (!mem) return res.status(403).json({ error: 'You are not a member of this Family.' });
      if (mem.status === 'removed') {
        return res.status(403).json({
          error: 'You were removed from this Family.',
          code: 'FAMILY_REMOVED',
        });
      }

      if (mem.status === 'pending') {
        return res.json({
          family: {
            id: fam.id,
            name: fam.name,
            photoUrl: fam.photo_url || null,
            ownerId: fam.owner_id,
            memberCount: Number(fam.member_count || 0),
            maxMembers: Number(fam.max_members || MAX_MEMBERS),
            joinApprovalRequired: Boolean(fam.join_approval_required),
            onlyAdminsCanSend: Boolean(fam.only_admins_can_send),
            inviteLinkEnabled: Boolean(fam.invite_link_enabled),
            pinnedMessages: [],
            createdAt: fam.created_at,
            updatedAt: fam.updated_at,
          },
          membership: {
            familyId: mem.family_id,
            userId: mem.user_id,
            role: mem.role,
            status: 'pending',
            relationTag: mem.relation_tag || null,
            mutedUntil: mem.muted_until || null,
            isMutedAlways: Boolean(mem.is_muted_always),
            unreadCount: 0,
            joinedAt: mem.joined_at,
            updatedAt: mem.updated_at,
          },
        });
      }

      const isPrivileged = mem.role === 'owner' || mem.role === 'admin';
      return res.json({
        family: formatFamilyRow(fam, isPrivileged),
        membership: {
          familyId: mem.family_id,
          userId: mem.user_id,
          role: mem.role,
          status: mem.status,
          relationTag: mem.relation_tag || null,
          mutedUntil: mem.muted_until || null,
          isMutedAlways: Boolean(mem.is_muted_always),
          lastReadAt: mem.last_read_at || null,
          clearedAt: mem.cleared_at || null,
          unreadCount: computeUnreadCount(familyId, userId, mem.last_read_at, mem.cleared_at, mem.joined_at),
          joinedAt: mem.joined_at,
          updatedAt: mem.updated_at,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to load Family' });
    }
  });

  // 7. Update Family name / photo / settings (Owner or Admin)
  router.patch('/:familyId', (req, res) => {
    try {
      if (rejectIfRestricted(req, res)) return;
      const userId = (req as any).authUserId as string;
      const { familyId } = req.params;
      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== 'active' || (mem.role !== 'owner' && mem.role !== 'admin')) {
        return res.status(403).json({ error: 'Only the Owner or Admins can update Family settings.' });
      }
      const fam = db.prepare('SELECT * FROM families WHERE id = ?').get(familyId) as any;
      if (!fam) return res.status(404).json({ error: 'Family not found.' });
      if (fam.is_suspended) {
        return res.status(403).json({ error: 'This Family is suspended and cannot be edited.' });
      }

      const { name, photoUrl, joinApprovalRequired, onlyAdminsCanSend } = req.body || {};
      const actor = getProfileById(userId);
      const actorName = actor?.display_name || actor?.username || 'Admin';
      const nowIso = new Date().toISOString();

      let nextName = fam.name;
      let nextPhoto = fam.photo_url;
      let nextJoinApproval = Boolean(fam.join_approval_required);
      let nextOnlyAdmins = Boolean(fam.only_admins_can_send);

      if (typeof name === 'string' && name.trim()) {
        const clean = name.trim().slice(0, 80);
        const blockedNameWords = findMatchedBannedWords(clean).filter((w) => w.action === 'block');
        if (blockedNameWords.length > 0) {
          return res.status(400).json({ error: 'Family name contains a restricted word.' });
        }
        if (clean !== fam.name) {
          nextName = clean;
          insertSystemMessage(familyId, `${actorName} renamed the Family to "${clean}"`);
        }
      }
      if (photoUrl !== undefined) {
        const cleanPhoto = typeof photoUrl === 'string' && photoUrl.trim() ? photoUrl.trim().slice(0, 500) : null;
        if (cleanPhoto !== fam.photo_url) {
          nextPhoto = cleanPhoto;
          insertSystemMessage(familyId, `${actorName} updated the Family photo`);
        }
      }
      if (typeof joinApprovalRequired === 'boolean') {
        // Switching ON -> OFF does NOT auto-approve existing pending requests
        nextJoinApproval = joinApprovalRequired;
      }
      if (typeof onlyAdminsCanSend === 'boolean' && onlyAdminsCanSend !== Boolean(fam.only_admins_can_send)) {
        nextOnlyAdmins = onlyAdminsCanSend;
        insertSystemMessage(
          familyId,
          onlyAdminsCanSend
            ? `${actorName} enabled "Only admins can send messages"`
            : `${actorName} allowed all members to send messages`
        );
      }

      db.prepare(`
        UPDATE families SET
          name = ?,
          photo_url = ?,
          join_approval_required = ?,
          only_admins_can_send = ?,
          updated_at = ?
        WHERE id = ?
      `).run(nextName, nextPhoto, nextJoinApproval ? 1 : 0, nextOnlyAdmins ? 1 : 0, nowIso, familyId);

      const updated = db.prepare('SELECT * FROM families WHERE id = ?').get(familyId);
      return res.json({ family: formatFamilyRow(updated, true) });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to update Family' });
    }
  });

  // 8. Manage Invite Link (create/reset/disable/enable)
  router.post('/:familyId/invite-link', (req, res) => {
    try {
      if (rejectIfRestricted(req, res)) return;
      const userId = (req as any).authUserId as string;
      const { familyId } = req.params;
      const action = String(req.body?.action || 'reset').trim().toLowerCase();
      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== 'active' || (mem.role !== 'owner' && mem.role !== 'admin')) {
        return res.status(403).json({ error: 'Only the Owner or Admins can manage the invite link.' });
      }
      const fam = db.prepare('SELECT * FROM families WHERE id = ?').get(familyId) as any;
      if (!fam) return res.status(404).json({ error: 'Family not found.' });

      const nowIso = new Date().toISOString();
      if (action === 'disable') {
        db.prepare('UPDATE families SET invite_link_enabled = 0, updated_at = ? WHERE id = ?').run(nowIso, familyId);
      } else if (action === 'enable') {
        const code = fam.invite_code || generateInviteCode();
        db.prepare('UPDATE families SET invite_code = ?, invite_link_enabled = 1, updated_at = ? WHERE id = ?').run(
          code,
          nowIso,
          familyId
        );
      } else {
        const newCode = generateInviteCode();
        db.prepare('UPDATE families SET invite_code = ?, invite_link_enabled = 1, updated_at = ? WHERE id = ?').run(
          newCode,
          nowIso,
          familyId
        );
      }

      const updated = db.prepare('SELECT * FROM families WHERE id = ?').get(familyId);
      return res.json({ family: formatFamilyRow(updated, true) });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to update invite link' });
    }
  });

  // 9. Paged & Searchable Members (never returns all 5,000 at once)
  router.get('/:familyId/members', (req, res) => {
    try {
      const userId = (req as any).authUserId as string;
      const { familyId } = req.params;
      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== 'active') {
        return res.status(403).json({ error: 'Active Family membership required to view members.' });
      }

      const fam = db.prepare('SELECT member_count FROM families WHERE id = ?').get(familyId) as { member_count: number } | undefined;
      if (!fam) return res.status(404).json({ error: 'Family not found.' });

      const requestedStatus = String(req.query.status || 'active').trim();
      const targetStatus =
        requestedStatus === 'removed' && (mem.role === 'owner' || mem.role === 'admin') ? 'removed' : 'active';

      const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '30'), 10) || 30));
      const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10) || 0);
      const q = String(req.query.q || '').trim().toLowerCase();
      const hidePresence = Number(fam.member_count || 0) > LARGE_FAMILY_THRESHOLD;

      let rows: any[];
      let totalRow: { cnt: number };

      if (q) {
        const pattern = `%${q}%`;
        totalRow = db
          .prepare(`
            SELECT COUNT(*) as cnt FROM family_members fm
            LEFT JOIN profiles p ON p.id = fm.user_id
            WHERE fm.family_id = ? AND fm.status = ?
              AND (LOWER(COALESCE(p.display_name, fm.display_name)) LIKE ?
                   OR LOWER(COALESCE(p.username, fm.username)) LIKE ?
                   OR LOWER(COALESCE(fm.relation_tag, '')) LIKE ?)
          `)
          .get(familyId, targetStatus, pattern, pattern, pattern) as { cnt: number };

        rows = db
          .prepare(`
            SELECT fm.*, p.display_name as live_display_name, p.username as live_username,
                   p.avatar_url as live_avatar_url, p.is_online as live_is_online, p.last_seen as live_last_seen
            FROM family_members fm
            LEFT JOIN profiles p ON p.id = fm.user_id
            WHERE fm.family_id = ? AND fm.status = ?
              AND (LOWER(COALESCE(p.display_name, fm.display_name)) LIKE ?
                   OR LOWER(COALESCE(p.username, fm.username)) LIKE ?
                   OR LOWER(COALESCE(fm.relation_tag, '')) LIKE ?)
            ORDER BY
              CASE fm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
              LOWER(COALESCE(p.display_name, fm.display_name)) ASC
            LIMIT ? OFFSET ?
          `)
          .all(familyId, targetStatus, pattern, pattern, pattern, limit, offset);
      } else {
        totalRow = db
          .prepare('SELECT COUNT(*) as cnt FROM family_members WHERE family_id = ? AND status = ?')
          .get(familyId, targetStatus) as { cnt: number };

        rows = db
          .prepare(`
            SELECT fm.*, p.display_name as live_display_name, p.username as live_username,
                   p.avatar_url as live_avatar_url, p.is_online as live_is_online, p.last_seen as live_last_seen
            FROM family_members fm
            LEFT JOIN profiles p ON p.id = fm.user_id
            WHERE fm.family_id = ? AND fm.status = ?
            ORDER BY
              CASE fm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
              LOWER(COALESCE(p.display_name, fm.display_name)) ASC
            LIMIT ? OFFSET ?
          `)
          .all(familyId, targetStatus, limit, offset);
      }

      const total = Number(totalRow?.cnt || 0);
      return res.json({
        members: rows.map((r) => formatMemberRow(r, hidePresence)),
        total,
        hasMore: offset + rows.length < total,
        hidePresence,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to load members' });
    }
  });

  // 10. Invite Members by User ID (max 10 at once, max 50/day per user)
  router.post('/:familyId/invite', (req, res) => {
    try {
      if (rejectIfRestricted(req, res)) return;
      const userId = (req as any).authUserId as string;
      const { familyId } = req.params;
      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== 'active' || (mem.role !== 'owner' && mem.role !== 'admin')) {
        return res.status(403).json({ error: 'Only the Owner or Admins can invite members.' });
      }

      const fam = db.prepare('SELECT * FROM families WHERE id = ?').get(familyId) as any;
      if (!fam) return res.status(404).json({ error: 'Family not found.' });

      const rawIds = Array.isArray(req.body?.inviteeIds) ? req.body.inviteeIds : [];
      const inviteeIds: string[] = Array.from(
        new Set(rawIds.filter((v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v !== userId))
      );

      if (inviteeIds.length === 0) {
        return res.status(400).json({ error: 'Select at least one user to invite.' });
      }
      if (inviteeIds.length > MAX_INVITE_BATCH) {
        return res.status(400).json({ error: `You can invite up to ${MAX_INVITE_BATCH} users at a time.` });
      }

      const dayKey = new Date().toISOString().slice(0, 10);
      const limitRow = db
        .prepare('SELECT invite_count FROM family_invite_daily_limits WHERE user_id = ? AND day_key = ?')
        .get(userId, dayKey) as { invite_count: number } | undefined;
      const sentToday = Number(limitRow?.invite_count || 0);
      if (sentToday + inviteeIds.length > MAX_DAILY_INVITES) {
        return res.status(429).json({
          error: `Daily invite limit reached (${sentToday}/${MAX_DAILY_INVITES} invites sent today).`,
        });
      }

      const inviterProfile = getProfileById(userId);
      const inviterName = inviterProfile?.display_name || inviterProfile?.username || 'Someone';
      const nowIso = new Date().toISOString();
      let sentCount = 0;
      const skipped: Array<{ userId: string; reason: string }> = [];

      for (const targetId of inviteeIds) {
        const targetUser = findUserById(targetId);
        const targetProfile = getProfileById(targetId);
        if (!targetUser || !targetProfile) {
          skipped.push({ userId: targetId, reason: 'User not found' });
          continue;
        }
        if (targetUser.status === 'suspended' || targetUser.status === 'disabled' || targetUser.status === 'deactivated') {
          skipped.push({ userId: targetId, reason: 'User account unavailable' });
          continue;
        }

        // Check block relationship either direction
        const blockRow = db
          .prepare('SELECT 1 FROM blocked_users WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1')
          .get(userId, targetId, targetId, userId);
        if (blockRow) {
          skipped.push({ userId: targetId, reason: 'Blocked relationship' });
          continue;
        }

        const targetMem = getActiveMembership(familyId, targetId);
        if (targetMem?.status === 'active') {
          skipped.push({ userId: targetId, reason: 'Already a member' });
          continue;
        }
        if (targetMem?.status === 'removed') {
          skipped.push({ userId: targetId, reason: 'Previously removed (allow rejoin first)' });
          continue;
        }

        const existingInvite = db
          .prepare("SELECT id FROM family_invites WHERE family_id = ? AND invitee_id = ? AND status = 'pending' LIMIT 1")
          .get(familyId, targetId);
        if (existingInvite) {
          skipped.push({ userId: targetId, reason: 'Invite already pending' });
          continue;
        }

        const inviteId = `finv_${generateId().replace(/-/g, '').slice(0, 20)}`;
        db.prepare(`
          INSERT INTO family_invites (
            id, family_id, family_name, family_photo_url, inviter_id, inviter_name, invitee_id, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        `).run(inviteId, familyId, fam.name, fam.photo_url || null, userId, inviterName, targetId, nowIso);

        insertNotificationRow({
          userId: targetId,
          actorId: userId,
          type: 'family_invite',
          title: `Family Invite: ${fam.name}`,
          message: `${inviterName} invited you to join "${fam.name}".`,
          referenceId: inviteId,
        });
        sentCount++;
      }

      if (sentCount > 0) {
        db.prepare(`
          INSERT INTO family_invite_daily_limits (user_id, day_key, invite_count)
          VALUES (?, ?, ?)
          ON CONFLICT(user_id, day_key) DO UPDATE SET invite_count = invite_count + excluded.invite_count
        `).run(userId, dayKey, sentCount);
      }

      return res.json({
        sentCount,
        skipped,
        dailyRemaining: Math.max(0, MAX_DAILY_INVITES - (sentToday + sentCount)),
      });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to send invites' });
    }
  });

  // 11. List Pending Join Requests (Owner / Admin)
  router.get('/:familyId/requests', (req, res) => {
    try {
      const userId = (req as any).authUserId as string;
      const { familyId } = req.params;
      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== 'active' || (mem.role !== 'owner' && mem.role !== 'admin')) {
        return res.status(403).json({ error: 'Only the Owner or Admins can review join requests.' });
      }

      const rows = db
        .prepare(`
          SELECT fr.*, p.display_name as live_display_name, p.username as live_username, p.avatar_url as live_avatar_url
          FROM family_requests fr
          LEFT JOIN profiles p ON p.id = fr.user_id
          WHERE fr.family_id = ? AND fr.status = 'pending'
          ORDER BY fr.created_at DESC
          LIMIT 200
        `)
        .all(familyId) as any[];

      return res.json({
        requests: rows.map((r) => ({
          userId: r.user_id,
          familyId: r.family_id,
          displayName: r.live_display_name || r.display_name || 'User',
          username: r.live_username || r.username || 'user',
          avatarUrl: r.live_avatar_url !== undefined ? r.live_avatar_url : r.avatar_url || null,
          status: r.status,
          inviteCode: r.invite_code || null,
          createdAt: r.created_at,
        })),
      });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to load join requests' });
    }
  });

  // 12. Approve / Reject Join Requests (single or bulk)
  router.post('/:familyId/requests/action', (req, res) => {
    try {
      if (rejectIfRestricted(req, res)) return;
      const userId = (req as any).authUserId as string;
      const { familyId } = req.params;
      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== 'active' || (mem.role !== 'owner' && mem.role !== 'admin')) {
        return res.status(403).json({ error: 'Only the Owner or Admins can approve or reject requests.' });
      }

      const fam = db.prepare('SELECT * FROM families WHERE id = ?').get(familyId) as any;
      if (!fam) return res.status(404).json({ error: 'Family not found.' });

      const action = String(req.body?.action || '').trim().toLowerCase();
      const targetUserIds = Array.isArray(req.body?.userIds)
        ? req.body.userIds.filter((v: unknown): v is string => typeof v === 'string')
        : [];

      let pendingRows: any[];
      if (action === 'approve_all' || action === 'reject_all') {
        pendingRows = db
          .prepare("SELECT * FROM family_requests WHERE family_id = ? AND status = 'pending'")
          .all(familyId) as any[];
      } else if ((action === 'approve' || action === 'reject') && targetUserIds.length > 0) {
        const placeholders = targetUserIds.map(() => '?').join(',');
        pendingRows = db
          .prepare(`SELECT * FROM family_requests WHERE family_id = ? AND status = 'pending' AND user_id IN (${placeholders})`)
          .all(familyId, ...targetUserIds) as any[];
      } else {
        return res.status(400).json({ error: 'Invalid join request action.' });
      }

      const isApprove = action === 'approve' || action === 'approve_all';
      if (isApprove && Number(fam.member_count || 0) + pendingRows.length > MAX_MEMBERS) {
        return res.status(400).json({ error: `Approving these requests would exceed the ${MAX_MEMBERS} member limit.` });
      }

      const nowIso = new Date().toISOString();
      const actor = getProfileById(userId);
      const actorName = actor?.display_name || actor?.username || 'Admin';

      db.exec('BEGIN');
      try {
        for (const reqRow of pendingRows) {
          if (isApprove) {
            const targetUser = findUserById(reqRow.user_id);
            if (!targetUser || targetUser.status === 'suspended' || targetUser.status === 'disabled' || targetUser.status === 'deactivated') {
              db.prepare("UPDATE family_requests SET status = 'rejected', reviewed_at = ?, reviewed_by = ? WHERE family_id = ? AND user_id = ?").run(
                nowIso,
                userId,
                familyId,
                reqRow.user_id
              );
              db.prepare("DELETE FROM family_members WHERE family_id = ? AND user_id = ? AND status = 'pending'").run(
                familyId,
                reqRow.user_id
              );
              continue;
            }
            const autoMute = Number(fam.member_count || 0) >= LARGE_FAMILY_THRESHOLD ? 1 : 0;
            db.prepare("UPDATE family_requests SET status = 'approved', reviewed_at = ?, reviewed_by = ? WHERE family_id = ? AND user_id = ?").run(
              nowIso,
              userId,
              familyId,
              reqRow.user_id
            );
            db.prepare(`
              UPDATE family_members SET
                status = 'active',
                role = 'member',
                is_muted_always = ?,
                last_read_at = ?,
                joined_at = ?,
                updated_at = ?
              WHERE family_id = ? AND user_id = ?
            `).run(autoMute, nowIso, nowIso, nowIso, familyId, reqRow.user_id);

            insertNotificationRow({
              userId: reqRow.user_id,
              actorId: userId,
              type: 'family_join_approved',
              title: `Approved: ${fam.name}`,
              message: `${actorName} approved your request to join "${fam.name}".`,
              referenceId: familyId,
            });
          } else {
            db.prepare("UPDATE family_requests SET status = 'rejected', reviewed_at = ?, reviewed_by = ? WHERE family_id = ? AND user_id = ?").run(
              nowIso,
              userId,
              familyId,
              reqRow.user_id
            );
            db.prepare("DELETE FROM family_members WHERE family_id = ? AND user_id = ? AND status = 'pending'").run(
              familyId,
              reqRow.user_id
            );
            insertNotificationRow({
              userId: reqRow.user_id,
              actorId: userId,
              type: 'family_join_rejected',
              title: `Join request declined`,
              message: `Your request to join "${fam.name}" was declined.`,
              referenceId: familyId,
            });
          }
        }
        if (isApprove && pendingRows.length > 0) {
          recalcFamilyMemberCount(familyId);
          if (pendingRows.length === 1) {
            insertSystemMessage(familyId, `${pendingRows[0].display_name || 'Member'} joined the Family`);
          } else {
            insertSystemMessage(familyId, `${pendingRows.length} new members joined the Family`);
          }
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }

      const updatedFam = db.prepare('SELECT * FROM families WHERE id = ?').get(familyId);
      return res.json({ processed: pendingRows.length, family: formatFamilyRow(updatedFam, true) });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to process join requests' });
    }
  });

  // 13. Update Relation Tag (member updates own tag; Owner/Admin updates anyone's)
  router.patch('/:familyId/members/:targetUserId/relation-tag', (req, res) => {
    try {
      if (rejectIfRestricted(req, res)) return;
      const userId = (req as any).authUserId as string;
      const { familyId, targetUserId } = req.params;
      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== 'active') {
        return res.status(403).json({ error: 'Active Family membership required.' });
      }

      const isSelf = userId === targetUserId;
      const isPrivileged = mem.role === 'owner' || mem.role === 'admin';
      if (!isSelf && !isPrivileged) {
        return res.status(403).json({ error: 'Only the Owner or Admins can change other members\' relation tags.' });
      }

      const targetMem = getActiveMembership(familyId, targetUserId);
      if (!targetMem || targetMem.status !== 'active') {
        return res.status(404).json({ error: 'Target member not found.' });
      }

      const rawTag = req.body?.relationTag;
      const cleanTag = typeof rawTag === 'string' && rawTag.trim() ? rawTag.trim().slice(0, 32) : null;

      db.prepare('UPDATE family_members SET relation_tag = ?, updated_at = ? WHERE family_id = ? AND user_id = ?').run(
        cleanTag,
        new Date().toISOString(),
        familyId,
        targetUserId
      );

      return res.json({ success: true, userId: targetUserId, relationTag: cleanTag });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to update relation tag' });
    }
  });

  // 14. Make / Remove Admin (OWNER ONLY)
  router.patch('/:familyId/members/:targetUserId/role', (req, res) => {
    try {
      if (rejectIfRestricted(req, res)) return;
      const userId = (req as any).authUserId as string;
      const { familyId, targetUserId } = req.params;
      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== 'active' || mem.role !== 'owner') {
        return res.status(403).json({ error: 'Only the Family Owner can assign or remove Admins.' });
      }
      if (targetUserId === userId) {
        return res.status(400).json({ error: 'Owner role cannot be changed directly. Use Transfer Ownership instead.' });
      }

      const targetRole = String(req.body?.role || '').trim().toLowerCase();
      if (targetRole !== 'admin' && targetRole !== 'member') {
        return res.status(400).json({ error: 'role must be admin or member.' });
      }

      const targetMem = getActiveMembership(familyId, targetUserId);
      if (!targetMem || targetMem.status !== 'active') {
        return res.status(404).json({ error: 'Member not found.' });
      }

      db.prepare('UPDATE family_members SET role = ?, updated_at = ? WHERE family_id = ? AND user_id = ?').run(
        targetRole,
        new Date().toISOString(),
        familyId,
        targetUserId
      );

      const targetName = targetMem.display_name || targetMem.username || 'Member';
      insertSystemMessage(
        familyId,
        targetRole === 'admin' ? `${targetName} is now an Admin` : `${targetName} is no longer an Admin`
      );

      return res.json({ success: true, userId: targetUserId, role: targetRole });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to update member role' });
    }
  });

  // 15. Remove Member (Owner removes Admin/Member; Admin removes normal Member only)
  router.post('/:familyId/members/:targetUserId/remove', (req, res) => {
    try {
      if (rejectIfRestricted(req, res)) return;
      const userId = (req as any).authUserId as string;
      const { familyId, targetUserId } = req.params;
      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== 'active' || (mem.role !== 'owner' && mem.role !== 'admin')) {
        return res.status(403).json({ error: 'Only the Owner or Admins can remove members.' });
      }
      if (targetUserId === userId) {
        return res.status(400).json({ error: 'Use Leave Family instead of removing yourself.' });
      }

      const targetMem = getActiveMembership(familyId, targetUserId);
      if (!targetMem || targetMem.status !== 'active') {
        return res.status(404).json({ error: 'Active member not found.' });
      }
      if (targetMem.role === 'owner') {
        return res.status(403).json({ error: 'The Family Owner cannot be removed.' });
      }
      if (mem.role === 'admin' && targetMem.role === 'admin') {
        return res.status(403).json({ error: 'Admins cannot remove other Admins.' });
      }

      const nowIso = new Date().toISOString();
      db.prepare(`
        UPDATE family_members SET
          status = 'removed',
          role = 'member',
          removed_at = ?,
          removed_by = ?,
          updated_at = ?
        WHERE family_id = ? AND user_id = ?
      `).run(nowIso, userId, nowIso, familyId, targetUserId);

      recalcFamilyMemberCount(familyId);
      const actor = getProfileById(userId);
      const actorName = actor?.display_name || actor?.username || 'Admin';
      const targetName = targetMem.display_name || targetMem.username || 'Member';
      insertSystemMessage(familyId, `${actorName} removed ${targetName}`);

      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to remove member' });
    }
  });

  // 16. Allow a Removed Member to Rejoin (Owner or Admin)
  router.post('/:familyId/members/:targetUserId/allow-rejoin', (req, res) => {
    try {
      if (rejectIfRestricted(req, res)) return;
      const userId = (req as any).authUserId as string;
      const { familyId, targetUserId } = req.params;
      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== 'active' || (mem.role !== 'owner' && mem.role !== 'admin')) {
        return res.status(403).json({ error: 'Only the Owner or Admins can allow a removed member to rejoin.' });
      }

      const targetMem = getActiveMembership(familyId, targetUserId);
      if (!targetMem || targetMem.status !== 'removed') {
        return res.status(404).json({ error: 'Removed member record not found.' });
      }

      db.prepare(
        "UPDATE family_members SET status = 'left', removed_at = NULL, removed_by = NULL, updated_at = ? WHERE family_id = ? AND user_id = ?"
      ).run(new Date().toISOString(), familyId, targetUserId);

      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to allow rejoin' });
    }
  });

  // 17. Transfer Ownership (OWNER ONLY)
  router.post('/:familyId/transfer-ownership', (req, res) => {
    try {
      if (rejectIfRestricted(req, res)) return;
      const userId = (req as any).authUserId as string;
      const { familyId } = req.params;
      const targetUserId = String(req.body?.targetUserId || '').trim();
      if (!targetUserId) return res.status(400).json({ error: 'targetUserId is required.' });

      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== 'active' || mem.role !== 'owner') {
        return res.status(403).json({ error: 'Only the Family Owner can transfer ownership.' });
      }
      if (targetUserId === userId) {
        return res.status(400).json({ error: 'You are already the Owner.' });
      }

      const targetMem = getActiveMembership(familyId, targetUserId);
      if (!targetMem || targetMem.status !== 'active') {
        return res.status(404).json({ error: 'Target user must be an active Family member.' });
      }

      const nowIso = new Date().toISOString();
      db.exec('BEGIN');
      try {
        db.prepare("UPDATE family_members SET role = 'admin', updated_at = ? WHERE family_id = ? AND user_id = ?").run(
          nowIso,
          familyId,
          userId
        );
        db.prepare("UPDATE family_members SET role = 'owner', updated_at = ? WHERE family_id = ? AND user_id = ?").run(
          nowIso,
          familyId,
          targetUserId
        );
        db.prepare('UPDATE families SET owner_id = ?, updated_at = ? WHERE id = ?').run(targetUserId, nowIso, familyId);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }

      const targetName = targetMem.display_name || targetMem.username || 'Member';
      const oldName = mem.display_name || mem.username || 'Owner';
      insertSystemMessage(familyId, `${oldName} transferred Family ownership to ${targetName}`);

      const updatedFam = db.prepare('SELECT * FROM families WHERE id = ?').get(familyId);
      return res.json({ success: true, family: formatFamilyRow(updatedFam, true) });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to transfer ownership' });
    }
  });

  // 18. Mute / Unmute Family
  router.post('/:familyId/mute', (req, res) => {
    try {
      const userId = (req as any).authUserId as string;
      const { familyId } = req.params;
      const duration = String(req.body?.duration || 'off').trim();
      if (!VALID_MUTE_DURATIONS.has(duration)) {
        return res.status(400).json({ error: 'Invalid mute duration.' });
      }

      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== 'active') {
        return res.status(403).json({ error: 'Active Family membership required.' });
      }

      let isMutedAlways = 0;
      let mutedUntil: string | null = null;
      if (duration === 'always') isMutedAlways = 1;
      else if (duration === '1h') mutedUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      else if (duration === '8h') mutedUntil = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
      else if (duration === '1w') mutedUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      db.prepare(
        'UPDATE family_members SET is_muted_always = ?, muted_until = ?, updated_at = ? WHERE family_id = ? AND user_id = ?'
      ).run(isMutedAlways, mutedUntil, new Date().toISOString(), familyId, userId);

      return res.json({ success: true, isMutedAlways: Boolean(isMutedAlways), mutedUntil });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to update mute preference' });
    }
  });

  // 19. Clear Chat for Self Only
  router.post('/:familyId/clear-chat', (req, res) => {
    try {
      const userId = (req as any).authUserId as string;
      const { familyId } = req.params;
      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== 'active') {
        return res.status(403).json({ error: 'Active Family membership required.' });
      }

      const nowIso = new Date().toISOString();
      db.prepare(
        'UPDATE family_members SET cleared_at = ?, last_read_at = ?, updated_at = ? WHERE family_id = ? AND user_id = ?'
      ).run(nowIso, nowIso, nowIso, familyId, userId);

      return res.json({ success: true, clearedAt: nowIso });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to clear chat' });
    }
  });

  // 20. Leave Family (Owner cannot leave until transferring ownership)
  router.post('/:familyId/leave', (req, res) => {
    try {
      const userId = (req as any).authUserId as string;
      const { familyId } = req.params;
      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== 'active') {
        return res.status(403).json({ error: 'You are not an active member of this Family.' });
      }
      if (mem.role === 'owner') {
        return res.status(400).json({
          error: 'As Owner, please transfer ownership to another member before leaving, or delete the Family.',
        });
      }

      const nowIso = new Date().toISOString();
      db.prepare("UPDATE family_members SET status = 'left', role = 'member', updated_at = ? WHERE family_id = ? AND user_id = ?").run(
        nowIso,
        familyId,
        userId
      );
      recalcFamilyMemberCount(familyId);

      const profile = getProfileById(userId);
      insertSystemMessage(familyId, `${profile?.display_name || mem.display_name || 'Member'} left`);

      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to leave Family' });
    }
  });

  // 21. Delete Family (OWNER ONLY -> notifies all active members)
  router.delete('/:familyId', async (req, res) => {
    try {
      const userId = (req as any).authUserId as string;
      const { familyId } = req.params;
      const fam = db.prepare('SELECT * FROM families WHERE id = ?').get(familyId) as any;
      if (!fam) return res.status(404).json({ error: 'Family not found.' });

      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== 'active' || mem.role !== 'owner') {
        return res.status(403).json({ error: 'Only the Family Owner can delete this Family.' });
      }

      const ownerProfile = getProfileById(userId);
      const ownerName = ownerProfile?.display_name || ownerProfile?.username || 'Owner';

      // Collect active members to notify
      const activeMembers = db
        .prepare("SELECT user_id FROM family_members WHERE family_id = ? AND status = 'active' AND user_id != ?")
        .all(familyId, userId) as Array<{ user_id: string }>;

      // Best-effort media cleanup for Family messages
      const mediaMessages = db
        .prepare(
          'SELECT cloudinary_public_id, b2_file_id, media_type FROM family_messages WHERE family_id = ? AND (cloudinary_public_id IS NOT NULL OR b2_file_id IS NOT NULL)'
        )
        .all(familyId) as Array<{ cloudinary_public_id?: string | null; b2_file_id?: string | null; media_type?: string | null }>;

      db.exec('BEGIN');
      try {
        for (const m of activeMembers) {
          insertNotificationRow({
            userId: m.user_id,
            actorId: userId,
            type: 'family_deleted',
            title: `Family Deleted: ${fam.name}`,
            message: `${ownerName} deleted the Family "${fam.name}".`,
            referenceId: familyId,
          });
        }
        db.prepare('DELETE FROM family_message_reads WHERE family_id = ?').run(familyId);
        db.prepare('DELETE FROM family_typing_status WHERE family_id = ?').run(familyId);
        db.prepare('DELETE FROM family_messages WHERE family_id = ?').run(familyId);
        db.prepare('DELETE FROM family_requests WHERE family_id = ?').run(familyId);
        db.prepare('DELETE FROM family_invites WHERE family_id = ?').run(familyId);
        db.prepare('DELETE FROM family_members WHERE family_id = ?').run(familyId);
        db.prepare('DELETE FROM families WHERE id = ?').run(familyId);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }

      for (const item of mediaMessages) {
        const pid = item.cloudinary_public_id || item.b2_file_id;
        if (pid) {
          const rType = item.media_type === 'voice' ? 'raw' : 'image';
          deleteAssetFromCloudinary(pid, rType).catch(() => {});
        }
      }

      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to delete Family' });
    }
  });

  // 22. Fetch Messages (1 shared collection per Family; paged)
  router.get('/:familyId/messages', (req, res) => {
    try {
      const userId = (req as any).authUserId as string;
      const { familyId } = req.params;
      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== 'active') {
        return res.status(403).json({ error: 'Only active Family members can read chat messages.' });
      }

      const limit = Math.min(80, Math.max(10, parseInt(String(req.query.limit || '50'), 10) || 50));
      const before = typeof req.query.before === 'string' && req.query.before.trim() ? req.query.before.trim() : null;
      const clearedAt = mem.cleared_at || null;

      let query = 'SELECT * FROM family_messages WHERE family_id = ?';
      const params: any[] = [familyId];

      if (clearedAt) {
        query += ' AND created_at > ?';
        params.push(clearedAt);
      }
      if (before) {
        query += ' AND created_at < ?';
        params.push(before);
      }
      query += ' ORDER BY created_at DESC LIMIT ?';
      params.push(limit);

      const rows = (db.prepare(query).all(...params) as any[]).reverse();
      const msgIds = rows.map((r) => r.id);
      const seenCountMap = new Map<string, number>();

      if (msgIds.length > 0) {
        const placeholders = msgIds.map(() => '?').join(',');
        const counts = db
          .prepare(
            `SELECT message_id, COUNT(*) as cnt FROM family_message_reads
             WHERE family_id = ? AND message_id IN (${placeholders})
             GROUP BY message_id`
          )
          .all(familyId, ...msgIds) as Array<{ message_id: string; cnt: number }>;
        for (const c of counts) {
          seenCountMap.set(c.message_id, Number(c.cnt || 0));
        }
      }

      return res.json({
        messages: rows.map((r) => formatMessageRow(r, seenCountMap)),
        hasMore: rows.length === limit,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to load Family messages' });
    }
  });

  // 23. Send Message (1 write per message regardless of 5,000 members!)
  router.post('/:familyId/messages', (req, res) => {
    try {
      if (rejectIfRestricted(req, res)) return;
      const userId = (req as any).authUserId as string;
      const { familyId } = req.params;

      if (!checkFamilyMessageRateLimit(userId)) {
        return res.status(429).json({ error: 'Slow down! You are sending messages too quickly.' });
      }

      const fam = db.prepare('SELECT * FROM families WHERE id = ?').get(familyId) as any;
      if (!fam) return res.status(404).json({ error: 'Family not found.' });
      if (fam.is_suspended) {
        return res.status(403).json({
          error: fam.suspended_reason ? `This Family is suspended: ${fam.suspended_reason}` : 'This Family is currently suspended by an administrator.',
          code: 'FAMILY_SUSPENDED',
        });
      }

      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== 'active') {
        return res.status(403).json({ error: 'Only active Family members can send messages.' });
      }
      if (fam.only_admins_can_send && mem.role !== 'owner' && mem.role !== 'admin') {
        return res.status(403).json({ error: 'Only the Owner and Admins can send messages in this Family.' });
      }

      const {
        type = 'text',
        content,
        mediaUrl,
        mediaType,
        cloudinaryPublicId,
        b2FileId,
        b2FileName,
        replyToMessageId,
        mentions,
      } = req.body || {};

      const allowedTypes = new Set(['text', 'image', 'voice', 'sticker', 'safe_checkin']);
      const msgType = allowedTypes.has(String(type)) ? String(type) : 'text';
      const cleanContent = typeof content === 'string' ? content.trim().slice(0, 4000) : '';
      if (!cleanContent && msgType === 'text') {
        return res.status(400).json({ error: 'Message content cannot be empty.' });
      }

      if (msgType === 'text') {
        const blockedWords = findMatchedBannedWords(cleanContent).filter((w) => w.action === 'block');
        if (blockedWords.length > 0) {
          return res.status(400).json({ error: 'Message contains a restricted word and could not be sent.' });
        }
      }

      const finalContent =
        msgType === 'safe_checkin'
          ? cleanContent || "I'm safe"
          : cleanContent;

      const profile = getProfileById(userId);
      const senderName = profile?.display_name || mem.display_name || 'Member';
      const senderUsername = profile?.username || mem.username || 'user';
      const senderAvatar = profile?.avatar_url || mem.avatar_url || null;

      let replySnapshot: any = null;
      let validReplyId: string | null = null;
      if (typeof replyToMessageId === 'string' && replyToMessageId.trim()) {
        const parent = db
          .prepare('SELECT id, sender_id, sender_name, content, is_deleted FROM family_messages WHERE id = ? AND family_id = ? LIMIT 1')
          .get(replyToMessageId.trim(), familyId) as any;
        if (parent) {
          validReplyId = parent.id;
          replySnapshot = {
            id: parent.id,
            senderId: parent.sender_id,
            senderName: parent.sender_name,
            content: parent.is_deleted ? 'This message was deleted' : String(parent.content || '').slice(0, 140),
          };
        }
      }

      // Valid individual mentions only (never @everyone)
      const mentionIds: string[] = Array.isArray(mentions)
        ? Array.from(new Set(mentions.filter((m: unknown): m is string => typeof m === 'string' && m.trim().length > 0 && m !== 'everyone'))).slice(0, 20)
        : [];

      const nowIso = new Date().toISOString();
      const msgId = `fmsg_${generateId().replace(/-/g, '').slice(0, 20)}`;

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

      db.exec('BEGIN');
      try {
        db.prepare(`
          INSERT INTO family_messages (
            id, family_id, sender_id, sender_name, sender_username, sender_avatar, sender_role, sender_relation_tag,
            type, content, media_url, media_type, cloudinary_public_id, b2_file_id, b2_file_name,
            reply_to_message_id, reply_to_json, mentions_json, reactions_json, is_pinned, is_deleted,
            safe_checkin_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', 0, 0, ?, ?, ?)
        `).run(
          msgId,
          familyId,
          userId,
          senderName,
          senderUsername,
          senderAvatar,
          mem.role,
          mem.relation_tag || null,
          msgType,
          finalContent,
          mediaUrl || null,
          mediaType || null,
          cloudinaryPublicId || null,
          b2FileId || null,
          b2FileName || null,
          validReplyId,
          replySnapshot ? JSON.stringify(replySnapshot) : null,
          JSON.stringify(mentionIds),
          msgType === 'safe_checkin' ? nowIso : null,
          nowIso,
          nowIso
        );

        db.prepare(`
          UPDATE families SET
            last_message_id = ?,
            last_message_text = ?,
            last_message_sender_id = ?,
            last_message_sender_name = ?,
            last_message_at = ?,
            updated_at = ?
          WHERE id = ?
        `).run(msgId, previewText, userId, senderName, nowIso, nowIso, familyId);

        db.prepare('UPDATE family_members SET last_read_at = ?, updated_at = ? WHERE family_id = ? AND user_id = ?').run(
          nowIso,
          nowIso,
          familyId,
          userId
        );

        db.prepare('DELETE FROM family_typing_status WHERE family_id = ? AND user_id = ?').run(familyId, userId);

        // Notify @mentioned active members even if they muted the Family
        for (const targetUid of mentionIds) {
          if (targetUid === userId) continue;
          const targetMem = getActiveMembership(familyId, targetUid);
          if (targetMem?.status === 'active') {
            insertNotificationRow({
              userId: targetUid,
              actorId: userId,
              type: 'family_mention',
              title: `${senderName} mentioned you in ${fam.name}`,
              message: previewText,
              referenceId: familyId,
            });
          }
        }

        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }

      const inserted = db.prepare('SELECT * FROM family_messages WHERE id = ?').get(msgId);
      recordActivityEvent({ eventType: 'family_msg_sent', userId, familyId });
      return res.json({ message: formatMessageRow(inserted) });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to send message' });
    }
  });

  // 24. Toggle Reaction on a Family Message (single shared message update)
  router.post('/:familyId/messages/:messageId/react', (req, res) => {
    try {
      if (rejectIfRestricted(req, res)) return;
      const userId = (req as any).authUserId as string;
      const { familyId, messageId } = req.params;
      const emoji = typeof req.body?.emoji === 'string' ? req.body.emoji.trim().slice(0, 16) : '';
      if (!emoji) return res.status(400).json({ error: 'emoji is required.' });

      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== 'active') {
        return res.status(403).json({ error: 'Only active Family members can react to messages.' });
      }

      const msg = db
        .prepare('SELECT * FROM family_messages WHERE id = ? AND family_id = ? LIMIT 1')
        .get(messageId, familyId) as any;
      if (!msg || msg.is_deleted) {
        return res.status(404).json({ error: 'Message not found.' });
      }

      const reactions = safeJsonParse<Record<string, string[]>>(msg.reactions_json, {});
      const list = Array.isArray(reactions[emoji]) ? [...reactions[emoji]] : [];
      const idx = list.indexOf(userId);
      if (idx >= 0) {
        list.splice(idx, 1);
      } else {
        list.push(userId);
      }
      if (list.length === 0) {
        delete reactions[emoji];
      } else {
        reactions[emoji] = list;
      }

      db.prepare('UPDATE family_messages SET reactions_json = ?, updated_at = ? WHERE id = ?').run(
        JSON.stringify(reactions),
        new Date().toISOString(),
        messageId
      );

      return res.json({ success: true, reactions });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to update reaction' });
    }
  });

  // 25. Pin / Unpin Family Message (Owner or Admin, max 3 FIFO)
  router.post('/:familyId/messages/:messageId/pin', (req, res) => {
    try {
      if (rejectIfRestricted(req, res)) return;
      const userId = (req as any).authUserId as string;
      const { familyId, messageId } = req.params;
      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== 'active' || (mem.role !== 'owner' && mem.role !== 'admin')) {
        return res.status(403).json({ error: 'Only the Owner or Admins can pin or unpin messages.' });
      }

      const fam = db.prepare('SELECT * FROM families WHERE id = ?').get(familyId) as any;
      const msg = db.prepare('SELECT * FROM family_messages WHERE id = ? AND family_id = ?').get(messageId, familyId) as any;
      if (!fam || !msg || msg.is_deleted) {
        return res.status(404).json({ error: 'Message not found.' });
      }

      const currentPins = safeJsonParse<any[]>(fam.pinned_messages_json, []);
      const alreadyIdx = currentPins.findIndex((p) => p.messageId === messageId);
      const nowIso = new Date().toISOString();
      const actor = getProfileById(userId);
      const actorName = actor?.display_name || actor?.username || 'Admin';

      let nextPins = [...currentPins];
      let nextIsPinned = 0;

      if (alreadyIdx >= 0) {
        // Unpin
        nextPins.splice(alreadyIdx, 1);
        nextIsPinned = 0;
      } else {
        // Enforce max 3: unpin oldest FIFO
        while (nextPins.length >= MAX_PINNED_MESSAGES) {
          const evicted = nextPins.shift();
          if (evicted?.messageId) {
            db.prepare('UPDATE family_messages SET is_pinned = 0, updated_at = ? WHERE id = ? AND family_id = ?').run(
              nowIso,
              evicted.messageId,
              familyId
            );
          }
        }
        nextPins.push({
          messageId: msg.id,
          content: String(msg.content || '').slice(0, 180),
          senderId: msg.sender_id,
          senderName: msg.sender_name,
          pinnedById: userId,
          pinnedByName: actorName,
          pinnedAt: nowIso,
        });
        nextIsPinned = 1;
      }

      db.prepare('UPDATE family_messages SET is_pinned = ?, updated_at = ? WHERE id = ?').run(
        nextIsPinned,
        nowIso,
        messageId
      );
      db.prepare('UPDATE families SET pinned_messages_json = ?, updated_at = ? WHERE id = ?').run(
        JSON.stringify(nextPins),
        nowIso,
        familyId
      );

      return res.json({ success: true, isPinned: Boolean(nextIsPinned), pinnedMessages: nextPins });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to update pinned message' });
    }
  });

  // 26. Delete Family Message (Sender or Owner/Admin -> tombstone + deletes attached media)
  router.delete('/:familyId/messages/:messageId', (req, res) => {
    try {
      const userId = (req as any).authUserId as string;
      const { familyId, messageId } = req.params;
      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== 'active') {
        return res.status(403).json({ error: 'Active Family membership required.' });
      }

      const fam = db.prepare('SELECT * FROM families WHERE id = ?').get(familyId) as any;
      const msg = db.prepare('SELECT * FROM family_messages WHERE id = ? AND family_id = ?').get(messageId, familyId) as any;
      if (!fam || !msg) return res.status(404).json({ error: 'Message not found.' });

      const isSelf = msg.sender_id === userId;
      const isPrivileged = mem.role === 'owner' || mem.role === 'admin';
      if (!isSelf && !isPrivileged) {
        return res.status(403).json({ error: 'You can only delete your own messages unless you are Owner or Admin.' });
      }

      const nowIso = new Date().toISOString();
      const publicId = msg.cloudinary_public_id || msg.b2_file_id;
      const mediaType = msg.media_type;

      // Remove from pinnedMessages if pinned
      const currentPins = safeJsonParse<any[]>(fam.pinned_messages_json, []);
      const filteredPins = currentPins.filter((p) => p.messageId !== messageId);

      db.prepare(`
        UPDATE family_messages SET
          is_deleted = 1,
          is_pinned = 0,
          content = 'This message was deleted',
          media_url = NULL,
          cloudinary_public_id = NULL,
          b2_file_id = NULL,
          b2_file_name = NULL,
          reactions_json = '{}',
          deleted_by = ?,
          deleted_by_role = ?,
          updated_at = ?
        WHERE id = ? AND family_id = ?
      `).run(userId, mem.role, nowIso, messageId, familyId);

      if (filteredPins.length !== currentPins.length) {
        db.prepare('UPDATE families SET pinned_messages_json = ?, updated_at = ? WHERE id = ?').run(
          JSON.stringify(filteredPins),
          nowIso,
          familyId
        );
      }

      if (fam.last_message_id === messageId) {
        db.prepare("UPDATE families SET last_message_text = 'This message was deleted', updated_at = ? WHERE id = ?").run(
          nowIso,
          familyId
        );
      }

      if (publicId) {
        const resType = mediaType === 'voice' ? 'raw' : 'image';
        deleteAssetFromCloudinary(publicId, resType).catch(() => {});
      }

      return res.json({ success: true, pinnedMessages: filteredPins });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to delete message' });
    }
  });

  // 27. Mark Read & Seen Count (<=50 includes readers; >50 returns aggregate count only)
  router.post('/:familyId/read', (req, res) => {
    try {
      const userId = (req as any).authUserId as string;
      const { familyId } = req.params;
      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== 'active') {
        return res.status(403).json({ error: 'Active Family membership required.' });
      }

      const messageIds: string[] = Array.isArray(req.body?.messageIds)
        ? req.body.messageIds.filter((v: unknown): v is string => typeof v === 'string').slice(-50)
        : [];
      const nowIso = new Date().toISOString();
      const profile = getProfileById(userId);
      const displayName = profile?.display_name || mem.display_name || 'Member';

      db.prepare('UPDATE family_members SET last_read_at = ?, updated_at = ? WHERE family_id = ? AND user_id = ?').run(
        nowIso,
        nowIso,
        familyId,
        userId
      );

      if (messageIds.length > 0) {
        const stmt = db.prepare(`
          INSERT OR IGNORE INTO family_message_reads (message_id, family_id, user_id, display_name, read_at)
          VALUES (?, ?, ?, ?, ?)
        `);
        for (const mid of messageIds) {
          stmt.run(mid, familyId, userId, displayName, nowIso);
        }
      }

      return res.json({ success: true, lastReadAt: nowIso });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to mark messages read' });
    }
  });

  router.get('/:familyId/messages/:messageId/seen', (req, res) => {
    try {
      const userId = (req as any).authUserId as string;
      const { familyId, messageId } = req.params;
      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== 'active') {
        return res.status(403).json({ error: 'Active Family membership required.' });
      }

      const fam = db.prepare('SELECT member_count FROM families WHERE id = ?').get(familyId) as { member_count: number } | undefined;
      const countRow = db
        .prepare('SELECT COUNT(*) as cnt FROM family_message_reads WHERE family_id = ? AND message_id = ?')
        .get(familyId, messageId) as { cnt: number };
      const count = Number(countRow?.cnt || 0);
      const largeFamily = Number(fam?.member_count || 0) > LARGE_FAMILY_THRESHOLD;

      if (largeFamily) {
        return res.json({ count, readers: [], isLargeFamily: true });
      }

      const readers = db
        .prepare(
          `SELECT user_id as userId, display_name as displayName, read_at as readAt
           FROM family_message_reads
           WHERE family_id = ? AND message_id = ?
           ORDER BY read_at DESC LIMIT 50`
        )
        .all(familyId, messageId);

      return res.json({ count, readers, isLargeFamily: false });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to load seen info' });
    }
  });

  // 28. Typing Indicator (Active ONLY for Families <= 50 members)
  router.post('/:familyId/typing', (req, res) => {
    try {
      const userId = (req as any).authUserId as string;
      const { familyId } = req.params;
      const isTyping = Boolean(req.body?.isTyping);
      const fam = db.prepare('SELECT member_count FROM families WHERE id = ?').get(familyId) as { member_count: number } | undefined;
      if (!fam || Number(fam.member_count || 0) > LARGE_FAMILY_THRESHOLD) {
        return res.json({ success: true, disabledForLargeFamily: true });
      }

      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== 'active') {
        return res.status(403).json({ error: 'Active Family membership required.' });
      }

      if (isTyping) {
        const profile = getProfileById(userId);
        const name = profile?.display_name || mem.display_name || 'Member';
        db.prepare(`
          INSERT INTO family_typing_status (family_id, user_id, display_name, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(family_id, user_id) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at
        `).run(familyId, userId, name, new Date().toISOString());
      } else {
        db.prepare('DELETE FROM family_typing_status WHERE family_id = ? AND user_id = ?').run(familyId, userId);
      }

      return res.json({ success: true });
    } catch {
      return res.status(500).json({ error: 'Failed to update typing status' });
    }
  });

  router.get('/:familyId/typing', (req, res) => {
    try {
      const userId = (req as any).authUserId as string;
      const { familyId } = req.params;
      const fam = db.prepare('SELECT member_count FROM families WHERE id = ?').get(familyId) as { member_count: number } | undefined;
      if (!fam || Number(fam.member_count || 0) > LARGE_FAMILY_THRESHOLD) {
        return res.json({ typingUsers: [], disabledForLargeFamily: true });
      }

      const cutoff = new Date(Date.now() - 5500).toISOString();
      const rows = db
        .prepare(
          `SELECT user_id as userId, display_name as displayName
           FROM family_typing_status
           WHERE family_id = ? AND user_id != ? AND updated_at > ?
           ORDER BY updated_at DESC LIMIT 10`
        )
        .all(familyId, userId, cutoff);

      return res.json({ typingUsers: rows, disabledForLargeFamily: false });
    } catch {
      return res.json({ typingUsers: [] });
    }
  });

  return router;
}
