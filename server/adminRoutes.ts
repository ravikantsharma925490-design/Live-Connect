import express from 'express';
import crypto from 'crypto';
import {
  db,
  generateId,
  hashPassword,
  verifyPassword,
  findUserById,
  findUserByEmail,
  getProfileById,
  deleteAccountCompletely,
  revokeAllSessionsForUser,
  getAppSetting,
  setAppSetting,
  listBannedWords,
  resolveEffectiveAdminRole,
  SUPER_ADMIN_EMAIL,
  AdminPanelRole,
  DbUserRow,
  isAccountHiddenStatus,
} from './db';
import {
  executeModerationAction,
  writeAuditLog,
  formatRuleLabel,
  AccountStatus,
} from './moderationService';
import {
  fsRestListCollection,
  fsRestListAllCollection,
  fsRestCommitBatchWrites,
  fsRestSetOrPatchDoc,
  fsRestDeleteDoc,
} from './firestoreRest';

export interface FirebaseJwtClaims {
  uid: string;
  email?: string;
  emailVerified?: boolean;
  authTime?: number;
  iat?: number;
  name?: string;
  picture?: string;
}

export interface AdminRouterDeps {
  extractBearerToken: (req: express.Request) => string;
  verifyAuthToken: (token: string) => Promise<string | null>;
  verifyFirebaseClaims: (token: string) => Promise<FirebaseJwtClaims | null>;
  onStatusUpdated: (userId: string, status: AccountStatus) => void;
  invalidateTokenCachesForUser: (userId: string) => void;
}

const ADMIN_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const PIN_LOCK_DURATION_MS = 15 * 60 * 1000;
const PIN_MAX_ATTEMPTS = 5;
const REAUTH_FRESHNESS_SECONDS = 5 * 60;

function isValidSixDigitPin(pin: unknown): pin is string {
  return typeof pin === 'string' && /^\d{6}$/.test(pin);
}

function isOfficialChatModeratorsEnabled(): boolean {
  return getAppSetting('official_chat_moderators_enabled', 'false') === 'true';
}

function getPermissionsForRole(role: AdminPanelRole) {
  const modOfficial = isOfficialChatModeratorsEnabled();
  if (role === 'super_admin') {
    return {
      dashboard: true,
      analytics: true,
      usersView: true,
      usersManage: true,
      reports: true,
      families: true,
      logs: true,
      settings: true,
      appeals: true,
      officialChat: true,
      bannedWords: true,
      roles: true,
      tickets: true,
    };
  }
  if (role === 'moderator') {
    return {
      dashboard: false,
      analytics: false,
      usersView: true,
      usersManage: true,
      reports: true,
      families: false,
      logs: false,
      settings: false,
      appeals: true,
      officialChat: modOfficial,
      bannedWords: false,
      roles: false,
      tickets: false,
    };
  }
  if (role === 'support') {
    return {
      dashboard: false,
      analytics: false,
      usersView: true,
      usersManage: false,
      reports: false,
      families: false,
      logs: false,
      settings: false,
      appeals: false,
      officialChat: false,
      bannedWords: false,
      roles: false,
      tickets: true,
    };
  }
  return {
    dashboard: false,
    analytics: false,
    usersView: false,
    usersManage: false,
    reports: false,
    families: false,
    logs: false,
    settings: false,
    appeals: false,
    officialChat: false,
    bannedWords: false,
    roles: false,
    tickets: false,
  };
}

function ensureAdminUserSyncedFromClaims(claims: FirebaseJwtClaims): DbUserRow | undefined {
  const existing = findUserById(claims.uid);
  const nowIso = new Date().toISOString();
  const cleanEmail = (claims.email || '').trim().toLowerCase();
  const isSuperAdminEmail = cleanEmail === SUPER_ADMIN_EMAIL && Boolean(claims.emailVerified);

  if (existing) {
    if (isSuperAdminEmail && (existing.admin_role !== 'super_admin' || existing.role !== 'admin')) {
      db.prepare("UPDATE users SET role = 'admin', admin_role = 'super_admin', email_confirmed = 1, updated_at = ? WHERE id = ?").run(
        nowIso,
        existing.id
      );
      return findUserById(existing.id);
    }
    return existing;
  }

  if (!cleanEmail) return undefined;

  // Check if a SQLite user exists with same email (e.g. role pre-assigned or created previously)
  const byEmail = findUserByEmail(cleanEmail);
  if (byEmail) {
    if (isSuperAdminEmail && (byEmail.admin_role !== 'super_admin' || byEmail.role !== 'admin')) {
      db.prepare("UPDATE users SET role = 'admin', admin_role = 'super_admin', email_confirmed = 1, updated_at = ? WHERE id = ?").run(
        nowIso,
        byEmail.id
      );
      return findUserById(byEmail.id);
    }
    return byEmail;
  }

  // Auto-create SQLite record for Firebase-signed-in user (Super Admin or normal user)
  const assignedAdminRole: AdminPanelRole = isSuperAdminEmail ? 'super_admin' : 'none';
  const assignedRole = isSuperAdminEmail ? 'admin' : 'user';
  const meta = {
    full_name: claims.name || cleanEmail.split('@')[0],
    display_name: claims.name || cleanEmail.split('@')[0],
    avatar_url: claims.picture || null,
    provider: 'google',
  };
  db.prepare(`
    INSERT OR IGNORE INTO users (id, email, password_hash, email_confirmed, user_metadata, role, admin_role, last_active_at, created_at, updated_at)
    VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    claims.uid,
    cleanEmail,
    claims.emailVerified ? 1 : 0,
    JSON.stringify(meta),
    assignedRole,
    assignedAdminRole,
    nowIso,
    nowIso,
    nowIso
  );
  return findUserById(claims.uid);
}

function createAdminPinSession(userId: string, adminRole: AdminPanelRole) {
  const token = `adm_${crypto.randomBytes(32).toString('hex')}`;
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const expiresAt = new Date(now + ADMIN_IDLE_TIMEOUT_MS).toISOString();
  db.prepare(
    'INSERT INTO admin_sessions (token, user_id, admin_role, created_at, last_activity_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(token, userId, adminRole, nowIso, nowIso, expiresAt);
  return { token, expiresAt };
}

function validateAndTouchAdminSession(token: string, expectedUserId: string) {
  if (!token) return null;
  const row = db
    .prepare('SELECT * FROM admin_sessions WHERE token = ? LIMIT 1')
    .get(token) as
    | {
        token: string;
        user_id: string;
        admin_role: string;
        created_at: string;
        last_activity_at: string;
        expires_at: string;
      }
    | undefined;
  if (!row || row.user_id !== expectedUserId) return null;

  const now = Date.now();
  if (new Date(row.expires_at).getTime() <= now) {
    db.prepare('DELETE FROM admin_sessions WHERE token = ?').run(token);
    return null;
  }

  const nextExpiresAt = new Date(now + ADMIN_IDLE_TIMEOUT_MS).toISOString();
  db.prepare('UPDATE admin_sessions SET last_activity_at = ?, expires_at = ? WHERE token = ?').run(
    new Date(now).toISOString(),
    nextExpiresAt,
    token
  );
  return { ...row, expires_at: nextExpiresAt };
}

async function syncFirestoreSnapshotIfAvailable(idToken: string | null) {
  if (!idToken || idToken.split('.').length !== 3) return;
  try {
    const [fsProfiles, fsFamilies, fsUserReports, fsProblemReports, fsAppeals, fsCalls] = await Promise.all([
      fsRestListCollection(idToken, 'public_profiles', 250),
      fsRestListCollection(idToken, 'families', 250),
      fsRestListCollection(idToken, 'user_reports', 200),
      fsRestListCollection(idToken, 'problem_reports', 200),
      fsRestListCollection(idToken, 'appeals', 200),
      fsRestListCollection(idToken, 'calls', 200),
    ]);

    const nowIso = new Date().toISOString();

    for (const p of fsProfiles) {
      const d = p.data;
      const uid = String(d.id || p.id);
      if (!uid) continue;
      const createdAt = typeof d.createdAt === 'string' ? d.createdAt : nowIso;
      const updatedAt = typeof d.updatedAt === 'string' ? d.updatedAt : nowIso;
      const lastSeen = typeof d.lastSeen === 'string' ? d.lastSeen : updatedAt;
      const existingUser = findUserById(uid);
      if (!existingUser) {
        const placeholderEmail = `${String(d.username || uid).toLowerCase()}@firebase.liveconnect.local`;
        db.prepare(`
          INSERT OR IGNORE INTO users (id, email, password_hash, email_confirmed, user_metadata, role, admin_role, is_verified, last_active_at, created_at, updated_at)
          VALUES (?, ?, NULL, 1, ?, 'user', 'none', ?, ?, ?, ?)
        `).run(
          uid,
          placeholderEmail,
          JSON.stringify({ display_name: d.displayName || d.username || 'User', avatar_url: d.avatarUrl || null }),
          d.isVerified ? 1 : 0,
          lastSeen,
          createdAt,
          updatedAt
        );
      } else if (d.isVerified !== undefined && !existingUser.is_verified && d.isVerified) {
        db.prepare('UPDATE users SET is_verified = 1 WHERE id = ?').run(uid);
      }

      const existingProf = getProfileById(uid);
      if (!existingProf) {
        const cleanUname = String(d.username || `user_${uid.slice(0, 6)}`).toLowerCase().replace(/[^a-z0-9_]/g, '') || `user_${uid.slice(0, 6)}`;
        db.prepare(`
          INSERT OR IGNORE INTO profiles (id, username, display_name, avatar_url, bio, gender, country, is_verified, is_online, last_seen, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          uid,
          cleanUname,
          String(d.displayName || cleanUname),
          d.avatarUrl || null,
          d.bio || null,
          d.gender || null,
          d.country || null,
          d.isVerified ? 1 : 0,
          d.isOnline ? 1 : 0,
          lastSeen,
          createdAt,
          updatedAt
        );
      }
    }

    for (const f of fsFamilies) {
      const d = f.data;
      const fid = String(d.id || f.id);
      if (!fid) continue;
      db.prepare(`
        INSERT OR IGNORE INTO families (
          id, name, photo_url, owner_id, member_count, max_members,
          join_approval_required, only_admins_can_send, invite_code, invite_link_enabled,
          pinned_messages_json, last_message_id, last_message_text, last_message_sender_id,
          last_message_sender_name, last_message_at, is_suspended, suspended_reason, suspended_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        fid,
        String(d.name || 'Family'),
        d.photoUrl || null,
        String(d.ownerId || ''),
        Number(d.memberCount || 1),
        Number(d.maxMembers || 5000),
        d.joinApprovalRequired ? 1 : 0,
        d.onlyAdminsCanSend ? 1 : 0,
        d.inviteCode || null,
        d.inviteLinkEnabled ? 1 : 0,
        JSON.stringify(Array.isArray(d.pinnedMessages) ? d.pinnedMessages : []),
        d.lastMessageId || null,
        d.lastMessageText || null,
        d.lastMessageSenderId || null,
        d.lastMessageSenderName || null,
        typeof d.lastMessageAt === 'string' ? d.lastMessageAt : null,
        d.isSuspended ? 1 : 0,
        d.suspendedReason || null,
        typeof d.suspendedAt === 'string' ? d.suspendedAt : null,
        typeof d.createdAt === 'string' ? d.createdAt : nowIso,
        typeof d.updatedAt === 'string' ? d.updatedAt : nowIso
      );
    }

    for (const r of fsUserReports) {
      const d = r.data;
      const rid = String(d.id || r.id);
      if (!rid || !d.reporterId) continue;
      db.prepare(`
        INSERT OR IGNORE INTO user_reports (
          id, reporter_id, reported_user_id, reported_username, reported_display_name,
          category, details, source, conversation_id, family_id, family_name,
          reported_message_id, reported_message_content, reported_message_media_url,
          also_blocked, status, admin_id, admin_note, target_type, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        rid,
        String(d.reporterId),
        String(d.reportedUserId || d.familyId || 'unknown'),
        d.reportedUsername || null,
        d.reportedDisplayName || null,
        String(d.category || 'other'),
        d.details || null,
        String(d.source || 'profile'),
        d.conversationId || null,
        d.familyId || null,
        d.familyName || null,
        d.reportedMessageId || null,
        d.reportedMessageContent || null,
        d.reportedMessageMediaUrl || null,
        d.alsoBlocked ? 1 : 0,
        String(d.status || 'pending'),
        d.adminId || null,
        d.adminNote || null,
        d.familyId && !d.reportedMessageId && d.source === 'family_profile'
          ? 'family'
          : d.reportedMessageId
            ? 'message'
            : 'user',
        typeof d.createdAt === 'string' ? d.createdAt : nowIso,
        typeof d.updatedAt === 'string' ? d.updatedAt : nowIso
      );
    }

    for (const pr of fsProblemReports) {
      const d = pr.data;
      const prid = String(d.id || pr.id);
      if (!prid) continue;
      db.prepare(`
        INSERT OR IGNORE INTO problem_reports (id, user_id, category, description, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        prid,
        d.userId || null,
        String(d.category || 'general'),
        String(d.description || ''),
        String(d.status || 'submitted'),
        typeof d.createdAt === 'string' ? d.createdAt : nowIso
      );
    }

    for (const a of fsAppeals) {
      const d = a.data;
      const aid = String(d.id || a.id);
      if (!aid || !d.userId) continue;
      db.prepare(`
        INSERT OR IGNORE INTO appeals (
          id, user_id, ban_id, reason, verification_doc_url, status, admin_note, decision_due_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        aid,
        String(d.userId),
        d.banId || null,
        String(d.reason || ''),
        d.verificationDocUrl || null,
        String(d.status || 'pending'),
        d.adminNote || null,
        typeof d.decisionDueAt === 'string' ? d.decisionDueAt : nowIso,
        typeof d.createdAt === 'string' ? d.createdAt : nowIso,
        typeof d.updatedAt === 'string' ? d.updatedAt : nowIso
      );
    }

    for (const c of fsCalls) {
      const d = c.data;
      const cid = String(d.id || c.id);
      if (!cid || !d.callerId || !d.calleeId) continue;
      db.prepare(`
        INSERT OR IGNORE INTO calls (
          id, caller_id, callee_id, call_type, status, room_name, started_at, answered_at, ended_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        cid,
        String(d.callerId),
        String(d.calleeId),
        String(d.callType || 'audio'),
        String(d.status || 'ended'),
        d.roomName || cid,
        typeof d.createdAt === 'string' ? d.createdAt : nowIso,
        typeof d.answeredAt === 'string' ? d.answeredAt : null,
        typeof d.endedAt === 'string' ? d.endedAt : null,
        typeof d.createdAt === 'string' ? d.createdAt : nowIso,
        typeof d.updatedAt === 'string' ? d.updatedAt : nowIso
      );
    }
  } catch {
    // Non-fatal fallback
  }
}

export function createAdminRouter(deps: AdminRouterDeps): express.Router {
  const router = express.Router();

  // Middleware 1: Resolve caller identity and return strict 404 to non-admins
  router.use(async (req, res, next) => {
    try {
      const bearer = deps.extractBearerToken(req);
      if (!bearer) {
        return res.status(404).json({ error: 'Not Found' });
      }

      let claims: FirebaseJwtClaims | null = null;
      let userRow: DbUserRow | undefined;

      if (bearer.split('.').length === 3) {
        claims = await deps.verifyFirebaseClaims(bearer);
        if (claims?.uid) {
          userRow = ensureAdminUserSyncedFromClaims(claims);
        }
      } else {
        const uid = await deps.verifyAuthToken(bearer);
        if (uid) userRow = findUserById(uid);
      }

      if (!userRow) {
        return res.status(404).json({ error: 'Not Found' });
      }

      const adminRole = resolveEffectiveAdminRole(userRow);
      if (adminRole === 'none') {
        return res.status(404).json({ error: 'Not Found' });
      }

      (req as any).adminUserRow = userRow;
      (req as any).adminUserId = userRow.id;
      (req as any).adminRole = adminRole;
      (req as any).firebaseClaims = claims;
      (req as any).firebaseIdToken = bearer.split('.').length === 3 ? bearer : null;
      return next();
    } catch {
      return res.status(404).json({ error: 'Not Found' });
    }
  });

  // ------------------------------------------------------------------
  // FEATURE 6: ADMIN AUTH, 6-DIGIT PIN, LOCKOUT, RE-AUTH, 15-MIN IDLE
  // ------------------------------------------------------------------

  router.get('/auth/state', (req, res) => {
    const userRow = (req as any).adminUserRow as DbUserRow;
    const adminRole = (req as any).adminRole as AdminPanelRole;
    const pinToken = String(req.headers['x-admin-session'] || '').trim();
    const validSession = pinToken ? validateAndTouchAdminSession(pinToken, userRow.id) : null;

    const lockedUntilMs = userRow.pin_locked_until ? Date.parse(userRow.pin_locked_until) : 0;
    const isLocked = Boolean(lockedUntilMs && lockedUntilMs > Date.now());
    const failedAttempts = isLocked ? PIN_MAX_ATTEMPTS : Number(userRow.pin_failed_attempts || 0);

    return res.json({
      userId: userRow.id,
      email: userRow.email,
      adminRole,
      permissions: getPermissionsForRole(adminRole),
      officialChatModeratorsEnabled: isOfficialChatModeratorsEnabled(),
      needsPinSetup: !userRow.pin_hash,
      pinLockedUntil: isLocked ? userRow.pin_locked_until : null,
      remainingAttempts: isLocked ? 0 : Math.max(0, PIN_MAX_ATTEMPTS - failedAttempts),
      pinSessionValid: Boolean(validSession),
      pinSessionExpiresAt: validSession?.expires_at || null,
      idleTimeoutSeconds: ADMIN_IDLE_TIMEOUT_MS / 1000,
    });
  });

  router.post('/auth/pin/setup', (req, res) => {
    const userRow = (req as any).adminUserRow as DbUserRow;
    const adminRole = (req as any).adminRole as AdminPanelRole;
    if (userRow.pin_hash) {
      return res.status(409).json({ error: 'PIN is already configured. Use Change PIN instead.' });
    }

    const { pin, confirmPin } = req.body || {};
    if (!isValidSixDigitPin(pin) || !isValidSixDigitPin(confirmPin)) {
      return res.status(400).json({ error: 'PIN must be exactly 6 numeric digits.' });
    }
    if (pin !== confirmPin) {
      return res.status(400).json({ error: 'PIN and confirmation PIN do not match.' });
    }

    const nowIso = new Date().toISOString();
    const hashed = hashPassword(pin);
    db.prepare(
      'UPDATE users SET pin_hash = ?, pin_failed_attempts = 0, pin_locked_until = NULL, updated_at = ? WHERE id = ?'
    ).run(hashed, nowIso, userRow.id);

    const session = createAdminPinSession(userRow.id, adminRole);
    writeAuditLog({
      adminId: userRow.id,
      targetUserId: userRow.id,
      action: 'admin_pin_setup',
      reason: 'Initial 6-digit admin PIN configured',
      details: { adminRole },
    });

    return res.json({
      success: true,
      adminSessionToken: session.token,
      expiresAt: session.expiresAt,
      adminRole,
    });
  });

  router.post('/auth/pin/verify', (req, res) => {
    const userRow = findUserById((req as any).adminUserId)!;
    const adminRole = (req as any).adminRole as AdminPanelRole;

    if (!userRow.pin_hash) {
      return res.status(400).json({ code: 'PIN_NOT_SET', error: 'Please set your 6-digit PIN first.' });
    }

    const now = Date.now();
    const lockedUntilMs = userRow.pin_locked_until ? Date.parse(userRow.pin_locked_until) : 0;
    if (lockedUntilMs && lockedUntilMs > now) {
      return res.status(429).json({
        code: 'PIN_LOCKED',
        pinLockedUntil: userRow.pin_locked_until,
        remainingAttempts: 0,
        error: 'PIN entry is locked for 15 minutes after 5 incorrect attempts.',
      });
    }

    // Reset stale expired lock counter cleanly before verifying
    let currentFailed = lockedUntilMs && lockedUntilMs <= now ? 0 : Number(userRow.pin_failed_attempts || 0);

    const { pin } = req.body || {};
    if (!isValidSixDigitPin(pin)) {
      return res.status(400).json({
        error: 'Enter a valid 6-digit numeric PIN.',
        remainingAttempts: Math.max(0, PIN_MAX_ATTEMPTS - currentFailed),
      });
    }

    const isMatch = verifyPassword(pin, userRow.pin_hash);
    const nowIso = new Date(now).toISOString();

    if (!isMatch) {
      const nextFailed = currentFailed + 1;
      if (nextFailed >= PIN_MAX_ATTEMPTS) {
        const lockUntilIso = new Date(now + PIN_LOCK_DURATION_MS).toISOString();
        db.prepare(
          'UPDATE users SET pin_failed_attempts = ?, pin_locked_until = ?, updated_at = ? WHERE id = ?'
        ).run(nextFailed, lockUntilIso, nowIso, userRow.id);
        writeAuditLog({
          adminId: userRow.id,
          targetUserId: userRow.id,
          action: 'admin_pin_locked',
          reason: '5 failed PIN attempts triggered 15-minute lockout',
        });
        return res.status(429).json({
          code: 'PIN_LOCKED',
          pinLockedUntil: lockUntilIso,
          remainingAttempts: 0,
          error: 'Wrong PIN entered 5 times. PIN entry is locked for 15 minutes.',
        });
      }

      db.prepare(
        'UPDATE users SET pin_failed_attempts = ?, pin_locked_until = NULL, updated_at = ? WHERE id = ?'
      ).run(nextFailed, nowIso, userRow.id);
      return res.status(401).json({
        error: 'Incorrect PIN.',
        remainingAttempts: PIN_MAX_ATTEMPTS - nextFailed,
      });
    }

    db.prepare(
      'UPDATE users SET pin_failed_attempts = 0, pin_locked_until = NULL, updated_at = ? WHERE id = ?'
    ).run(nowIso, userRow.id);
    const session = createAdminPinSession(userRow.id, adminRole);

    writeAuditLog({
      adminId: userRow.id,
      targetUserId: userRow.id,
      action: 'admin_login',
      reason: 'Admin verified 6-digit PIN and entered /admin console',
      details: { adminRole },
    });

    return res.json({
      success: true,
      adminSessionToken: session.token,
      expiresAt: session.expiresAt,
      adminRole,
    });
  });

  // Change PIN or Forgot PIN — strictly requires fresh Google sign-in token (auth_time <= 5 mins)
  router.post('/auth/pin/change', (req, res) => {
    const userRow = (req as any).adminUserRow as DbUserRow;
    const adminRole = (req as any).adminRole as AdminPanelRole;
    const claims = (req as any).firebaseClaims as FirebaseJwtClaims | null;

    const nowSec = Math.floor(Date.now() / 1000);
    const authTime = claims?.authTime || 0;
    if (!claims || !authTime || nowSec - authTime > REAUTH_FRESHNESS_SECONDS) {
      return res.status(403).json({
        code: 'REAUTH_REQUIRED',
        error: 'Fresh Google re-authentication is required before changing or resetting your PIN.',
      });
    }

    const { newPin, confirmPin, mode } = req.body || {};
    if (!isValidSixDigitPin(newPin) || !isValidSixDigitPin(confirmPin)) {
      return res.status(400).json({ error: 'New PIN must be exactly 6 numeric digits.' });
    }
    if (newPin !== confirmPin) {
      return res.status(400).json({ error: 'New PIN and confirmation PIN do not match.' });
    }

    const nowIso = new Date().toISOString();
    const hashed = hashPassword(newPin);
    db.prepare(
      'UPDATE users SET pin_hash = ?, pin_failed_attempts = 0, pin_locked_until = NULL, updated_at = ? WHERE id = ?'
    ).run(hashed, nowIso, userRow.id);
    db.prepare('DELETE FROM admin_sessions WHERE user_id = ?').run(userRow.id);

    const session = createAdminPinSession(userRow.id, adminRole);
    writeAuditLog({
      adminId: userRow.id,
      targetUserId: userRow.id,
      action: mode === 'forgot' ? 'admin_pin_reset' : 'admin_pin_changed',
      reason:
        mode === 'forgot'
          ? 'Admin reset forgotten PIN after fresh Google re-authentication'
          : 'Admin changed 6-digit PIN after fresh Google re-authentication',
    });

    return res.json({
      success: true,
      adminSessionToken: session.token,
      expiresAt: session.expiresAt,
    });
  });

  router.post('/auth/logout', (req, res) => {
    const userRow = (req as any).adminUserRow as DbUserRow;
    const pinToken = String(req.headers['x-admin-session'] || '').trim();
    if (pinToken) {
      db.prepare('DELETE FROM admin_sessions WHERE token = ? AND user_id = ?').run(pinToken, userRow.id);
    }
    writeAuditLog({
      adminId: userRow.id,
      targetUserId: userRow.id,
      action: 'admin_logout',
      reason: 'Admin signed out of /admin console',
    });
    return res.json({ success: true });
  });

  // Require valid unlocked 15-min PIN session for ALL remaining endpoints
  router.use((req, res, next) => {
    const userRow = (req as any).adminUserRow as DbUserRow;
    const pinToken = String(req.headers['x-admin-session'] || '').trim();
    const valid = validateAndTouchAdminSession(pinToken, userRow.id);
    if (!valid) {
      return res.status(401).json({
        code: 'PIN_SESSION_EXPIRED',
        error: 'Admin PIN verification required or session expired after 15 minutes of inactivity.',
      });
    }
    (req as any).adminPinSession = valid;
    return next();
  });

  router.post('/auth/ping', (req, res) => {
    const sess = (req as any).adminPinSession;
    return res.json({ ok: true, expiresAt: sess?.expires_at || null });
  });

  function requireRoles(...allowed: AdminPanelRole[]) {
    return (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const role = (req as any).adminRole as AdminPanelRole;
      if (!allowed.includes(role)) {
        return res.status(403).json({
          error: `Permission denied. Required role: ${allowed.join(' or ')}.`,
        });
      }
      return next();
    };
  }

  // ------------------------------------------------------------------
  // FEATURE 1: DASHBOARD STATS (Super Admin)
  // ------------------------------------------------------------------
  router.get('/dashboard', requireRoles('super_admin'), async (req, res) => {
    try {
      const idToken = (req as any).firebaseIdToken as string | null;
      await syncFirestoreSnapshotIfAvailable(idToken);

      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const todayIso = startOfDay.toISOString();

      const totalUsers = (db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number }).cnt;
      const newUsersToday = (
        db.prepare('SELECT COUNT(*) as cnt FROM users WHERE created_at >= ?').get(todayIso) as { cnt: number }
      ).cnt;
      const onlineNow = (
        db
          .prepare(
            "SELECT COUNT(*) as cnt FROM profiles p INNER JOIN users u ON u.id = p.id WHERE p.is_online = 1 AND u.status NOT IN ('suspended','disabled','deactivated')"
          )
          .get() as { cnt: number }
      ).cnt;

      const dmToday = (
        db.prepare('SELECT COUNT(*) as cnt FROM messages WHERE created_at >= ?').get(todayIso) as { cnt: number }
      ).cnt;
      const famMsgToday = (
        db.prepare('SELECT COUNT(*) as cnt FROM family_messages WHERE created_at >= ?').get(todayIso) as { cnt: number }
      ).cnt;
      const trackedMsgEventsToday = (
        db
          .prepare("SELECT COUNT(*) as cnt FROM activity_events WHERE event_type IN ('dm_sent','family_msg_sent') AND created_at >= ?")
          .get(todayIso) as { cnt: number }
      ).cnt;
      const messagesToday = Math.max(dmToday + famMsgToday, trackedMsgEventsToday);

      const audioCallsToday = (
        db
          .prepare("SELECT COUNT(*) as cnt FROM calls WHERE call_type = 'audio' AND created_at >= ?")
          .get(todayIso) as { cnt: number }
      ).cnt;
      const videoCallsToday = (
        db
          .prepare("SELECT COUNT(*) as cnt FROM calls WHERE call_type = 'video' AND created_at >= ?")
          .get(todayIso) as { cnt: number }
      ).cnt;
      const totalFamilies = (db.prepare('SELECT COUNT(*) as cnt FROM families').get() as { cnt: number }).cnt;
      const pendingReportsCount = (
        db.prepare("SELECT COUNT(*) as cnt FROM user_reports WHERE status IN ('pending', 'under_review')").get() as {
          cnt: number;
        }
      ).cnt;
      const pendingAppealsCount = (
        db.prepare("SELECT COUNT(*) as cnt FROM appeals WHERE status = 'pending'").get() as { cnt: number }
      ).cnt;
      const openTicketsCount = (
        db.prepare("SELECT COUNT(*) as cnt FROM support_tickets WHERE status = 'open'").get() as { cnt: number }
      ).cnt;

      return res.json({
        totalUsers,
        newUsersToday,
        onlineNow,
        messagesToday,
        audioCallsToday,
        videoCallsToday,
        totalFamilies,
        pendingReportsCount,
        pendingAppealsCount,
        openTicketsCount,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to load dashboard' });
    }
  });

  // ------------------------------------------------------------------
  // FEATURE 14: ANALYTICS GRAPHS (Super Admin)
  // ------------------------------------------------------------------
  router.get('/analytics', requireRoles('super_admin'), async (req, res) => {
    try {
      const idToken = (req as any).firebaseIdToken as string | null;
      await syncFirestoreSnapshotIfAvailable(idToken);

      const range = String(req.query.range || 'daily').toLowerCase();
      const userRows = db.prepare('SELECT created_at FROM users ORDER BY created_at ASC').all() as Array<{
        created_at: string;
      }>;

      const growthBuckets: Array<{ label: string; count: number }> = [];
      const now = new Date();

      if (range === 'monthly') {
        for (let i = 11; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          const label = d.toLocaleString('en-US', { month: 'short', year: '2-digit' });
          const count = userRows.filter((u) => String(u.created_at || '').startsWith(ym)).length;
          growthBuckets.push({ label, count });
        }
      } else if (range === 'weekly') {
        for (let i = 11; i >= 0; i--) {
          const endMs = now.getTime() - i * 7 * 86400_000;
          const startMs = endMs - 7 * 86400_000;
          const d = new Date(endMs);
          const label = `${d.getMonth() + 1}/${d.getDate()}`;
          const count = userRows.filter((u) => {
            const t = Date.parse(u.created_at || '');
            return t > startMs && t <= endMs;
          }).length;
          growthBuckets.push({ label, count });
        }
      } else {
        for (let i = 13; i >= 0; i--) {
          const d = new Date(now.getTime() - i * 86400_000);
          const ymd = d.toISOString().slice(0, 10);
          const label = d.toLocaleString('en-US', { month: 'short', day: 'numeric' });
          const count = userRows.filter((u) => String(u.created_at || '').startsWith(ymd)).length;
          growthBuckets.push({ label, count });
        }
      }

      const topActiveUsers = db
        .prepare(`
          SELECT u.id, COALESCE(p.display_name, u.email) as display_name, COALESCE(p.username, '') as username,
                 p.avatar_url, u.is_verified,
                 (
                   (SELECT COUNT(*) FROM messages m WHERE m.sender_id = u.id) +
                   (SELECT COUNT(*) FROM family_messages fm WHERE fm.sender_id = u.id) +
                   (SELECT COUNT(*) FROM calls c WHERE c.caller_id = u.id OR c.callee_id = u.id) +
                   (SELECT COUNT(*) FROM activity_events ae WHERE ae.user_id = u.id)
                 ) as activity_score,
                 (SELECT COUNT(*) FROM messages m WHERE m.sender_id = u.id) as dm_count,
                 (SELECT COUNT(*) FROM family_messages fm WHERE fm.sender_id = u.id) as family_msg_count,
                 (SELECT COUNT(*) FROM calls c WHERE c.caller_id = u.id OR c.callee_id = u.id) as call_count
          FROM users u
          LEFT JOIN profiles p ON p.id = u.id
          ORDER BY activity_score DESC, u.updated_at DESC
          LIMIT 8
        `)
        .all();

      const topActiveFamilies = db
        .prepare(`
          SELECT f.id, f.name, f.photo_url, f.member_count,
                 (SELECT COUNT(*) FROM family_messages fm WHERE fm.family_id = f.id AND fm.is_deleted = 0) as message_count,
                 f.last_message_at
          FROM families f
          ORDER BY message_count DESC, f.member_count DESC
          LIMIT 8
        `)
        .all();

      const hourCounts = Array.from({ length: 24 }, (_, hour) => ({
        hour,
        label: `${String(hour).padStart(2, '0')}:00`,
        count: 0,
      }));

      const timeSamples = [
        ...(db.prepare('SELECT created_at as ts FROM messages ORDER BY created_at DESC LIMIT 1000').all() as Array<{ ts: string }>),
        ...(db.prepare('SELECT created_at as ts FROM family_messages ORDER BY created_at DESC LIMIT 1000').all() as Array<{ ts: string }>),
        ...(db.prepare('SELECT created_at as ts FROM calls ORDER BY created_at DESC LIMIT 500').all() as Array<{ ts: string }>),
        ...(db.prepare('SELECT created_at as ts FROM activity_events ORDER BY created_at DESC LIMIT 1000').all() as Array<{ ts: string }>),
        ...(db.prepare('SELECT last_seen as ts FROM profiles ORDER BY last_seen DESC LIMIT 500').all() as Array<{ ts: string }>),
      ];

      for (const sample of timeSamples) {
        const dt = new Date(sample.ts);
        if (!Number.isNaN(dt.getTime())) {
          const h = dt.getHours();
          if (hourCounts[h]) hourCounts[h].count += 1;
        }
      }

      return res.json({
        range,
        userGrowth: growthBuckets,
        topActiveUsers,
        topActiveFamilies,
        peakOnlineHours: hourCounts,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to compute analytics' });
    }
  });

  // ------------------------------------------------------------------
  // FEATURE 2: USER MANAGEMENT (Super Admin, Moderator, Support view)
  // ------------------------------------------------------------------
  router.get('/users', requireRoles('super_admin', 'moderator', 'support'), async (req, res) => {
    try {
      const idToken = (req as any).firebaseIdToken as string | null;
      await syncFirestoreSnapshotIfAvailable(idToken);

      const q = String(req.query.q || '').trim().toLowerCase();
      const statusFilter = String(req.query.status || 'all').trim().toLowerCase();
      const verifiedFilter = String(req.query.verified || 'all').trim().toLowerCase();

      const rows = db
        .prepare(`
          SELECT u.id, u.email, u.phone, u.status, u.strike_count, u.ban_reason, u.rule_broken,
                 u.ban_until, u.restricted_until, u.scheduled_deletion_at, u.role, u.admin_role,
                 u.is_verified, u.last_active_at, u.created_at, u.updated_at,
                 p.username, p.display_name, p.avatar_url, p.is_online, p.last_seen, p.phone_number,
                 (SELECT COUNT(*) FROM user_warnings w WHERE w.user_id = u.id) as warnings_count,
                 (SELECT COUNT(*) FROM family_members fm WHERE fm.user_id = u.id AND fm.status = 'active') as families_count
          FROM users u
          LEFT JOIN profiles p ON p.id = u.id
          ORDER BY u.updated_at DESC
          LIMIT 500
        `)
        .all() as any[];

      const filtered = rows
        .filter((r) => {
          if (statusFilter !== 'all' && (r.status || 'active') !== statusFilter) return false;
          if (verifiedFilter === 'verified' && !r.is_verified) return false;
          if (verifiedFilter === 'unverified' && r.is_verified) return false;
          if (!q) return true;
          return (
            String(r.email || '').toLowerCase().includes(q) ||
            String(r.username || '').toLowerCase().includes(q) ||
            String(r.display_name || '').toLowerCase().includes(q) ||
            String(r.phone || r.phone_number || '').toLowerCase().includes(q) ||
            String(r.id || '').toLowerCase().includes(q)
          );
        })
        .map((r) => ({
          ...r,
          admin_role: resolveEffectiveAdminRole(r),
          is_verified: Boolean(r.is_verified),
          strike_count: Number(r.strike_count || 0),
          warnings_count: Number(r.warnings_count || 0),
          families_count: Number(r.families_count || 0),
          rule_label: formatRuleLabel(r.rule_broken),
          is_online: Boolean(r.is_online) && !isAccountHiddenStatus(r.status),
        }));

      return res.json({ users: filtered });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to fetch users' });
    }
  });

  router.get('/users/:userId', requireRoles('super_admin', 'moderator', 'support'), (req, res) => {
    try {
      const { userId } = req.params;
      const userRow = findUserById(userId);
      if (!userRow) return res.status(404).json({ error: 'User not found' });

      const profile = getProfileById(userId);
      const bans = db
        .prepare('SELECT * FROM bans WHERE user_id = ? ORDER BY created_at DESC LIMIT 50')
        .all(userId) as any[];
      const warnings = db
        .prepare('SELECT * FROM user_warnings WHERE user_id = ? ORDER BY created_at DESC LIMIT 50')
        .all(userId) as any[];
      const appeals = db
        .prepare('SELECT * FROM appeals WHERE user_id = ? ORDER BY created_at DESC LIMIT 20')
        .all(userId) as any[];
      const familiesJoined = db
        .prepare(`
          SELECT f.id, f.name, f.photo_url, f.member_count, fm.role, fm.joined_at
          FROM family_members fm
          INNER JOIN families f ON f.id = fm.family_id
          WHERE fm.user_id = ? AND fm.status = 'active'
          ORDER BY fm.joined_at DESC
        `)
        .all(userId) as any[];
      const reports = db
        .prepare(`
          SELECT ur.*, p.username as reporter_username, p.display_name as reporter_display_name
          FROM user_reports ur
          LEFT JOIN profiles p ON p.id = ur.reporter_id
          WHERE ur.reported_user_id = ?
          ORDER BY ur.created_at DESC
          LIMIT 30
        `)
        .all(userId) as any[];
      const tickets = db
        .prepare('SELECT * FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC LIMIT 20')
        .all(userId) as any[];

      return res.json({
        user: {
          ...userRow,
          pin_hash: undefined,
          admin_role: resolveEffectiveAdminRole(userRow),
          is_verified: Boolean(userRow.is_verified),
          last_active_at: userRow.last_active_at || profile?.last_seen || userRow.updated_at,
        },
        profile,
        bans: bans.map((b) => ({
          ...b,
          action: b.action_type,
          is_active: Boolean(b.is_active),
          rule_label: formatRuleLabel(b.rule_broken),
        })),
        warnings,
        warningsCount: warnings.length,
        familiesJoined,
        appeals,
        reports,
        tickets,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to inspect user' });
    }
  });

  // Force Logout (Super Admin only)
  router.post('/users/:userId/force-logout', requireRoles('super_admin'), async (req, res) => {
    try {
      const adminId = (req as any).adminUserId as string;
      const idToken = (req as any).firebaseIdToken as string | null;
      const { userId } = req.params;

      const target = findUserById(userId);
      if (!target) return res.status(404).json({ error: 'User not found' });

      const nowIso = new Date().toISOString();
      revokeAllSessionsForUser(userId);
      db.prepare('DELETE FROM admin_sessions WHERE user_id = ?').run(userId);
      db.prepare('UPDATE users SET force_logout_after = ?, updated_at = ? WHERE id = ?').run(nowIso, nowIso, userId);
      db.prepare('UPDATE profiles SET is_online = 0, last_seen = ?, updated_at = ? WHERE id = ?').run(
        nowIso,
        nowIso,
        userId
      );
      deps.invalidateTokenCachesForUser(userId);

      await fsRestSetOrPatchDoc(
        idToken,
        `users/${userId}/private/info`,
        { forceLogoutAfter: nowIso, updatedAt: nowIso },
        { updateMask: ['forceLogoutAfter', 'updatedAt'] }
      );

      writeAuditLog({
        adminId,
        targetUserId: userId,
        action: 'force_logout',
        reason: String(req.body?.reason || 'Forced session logout by Super Admin'),
      });

      return res.json({ success: true, forceLogoutAfter: nowIso });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to force logout user' });
    }
  });

  // Grant / Remove Verified Badge (Super Admin only)
  router.post('/users/:userId/verify', requireRoles('super_admin'), async (req, res) => {
    try {
      const adminId = (req as any).adminUserId as string;
      const idToken = (req as any).firebaseIdToken as string | null;
      const { userId } = req.params;
      const { verified } = req.body || {};

      const target = findUserById(userId);
      if (!target) return res.status(404).json({ error: 'User not found' });

      const nextVerified = Boolean(verified);
      const nowIso = new Date().toISOString();
      db.prepare('UPDATE users SET is_verified = ?, updated_at = ? WHERE id = ?').run(nextVerified ? 1 : 0, nowIso, userId);
      db.prepare('UPDATE profiles SET is_verified = ?, updated_at = ? WHERE id = ?').run(
        nextVerified ? 1 : 0,
        nowIso,
        userId
      );

      await fsRestSetOrPatchDoc(
        idToken,
        `public_profiles/${userId}`,
        { isVerified: nextVerified, updatedAt: nowIso },
        { updateMask: ['isVerified', 'updatedAt'] }
      );

      writeAuditLog({
        adminId,
        targetUserId: userId,
        action: nextVerified ? 'grant_verified_badge' : 'revoke_verified_badge',
        reason: nextVerified ? 'Granted verified badge' : 'Removed verified badge',
      });

      return res.json({ success: true, isVerified: nextVerified });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to update verified status' });
    }
  });

  // Delete Account (Super Admin only)
  router.delete('/users/:userId', requireRoles('super_admin'), async (req, res) => {
    try {
      const adminId = (req as any).adminUserId as string;
      const idToken = (req as any).firebaseIdToken as string | null;
      const { userId } = req.params;

      const target = findUserById(userId);
      if (!target) return res.status(404).json({ error: 'User not found' });
      if (resolveEffectiveAdminRole(target) === 'super_admin' || userId === adminId) {
        return res.status(403).json({ error: 'Cannot delete the Super Admin account.' });
      }

      const prof = getProfileById(userId);
      const reason = String(req.body?.reason || `Deleted account ${prof?.username || target.email}`).trim();

      writeAuditLog({
        adminId,
        targetUserId: userId,
        action: 'delete_user_account',
        reason,
        details: { email: target.email, username: prof?.username },
      });

      deleteAccountCompletely(userId, false);
      deps.invalidateTokenCachesForUser(userId);

      await Promise.all([
        fsRestDeleteDoc(idToken, `public_profiles/${userId}`),
        fsRestDeleteDoc(idToken, `users/${userId}/private/info`),
        prof?.username ? fsRestDeleteDoc(idToken, `usernames/${prof.username.toLowerCase()}`) : Promise.resolve(false),
      ]);

      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to delete user account' });
    }
  });

  // ------------------------------------------------------------------
  // FEATURE 3 & 9: BAN / SUSPEND / UNBAN / WARN (Super Admin & Moderator)
  // ------------------------------------------------------------------
  router.post('/users/:userId/moderate', requireRoles('super_admin', 'moderator'), async (req, res) => {
    try {
      const adminId = (req as any).adminUserId as string;
      const idToken = (req as any).firebaseIdToken as string | null;
      const { userId } = req.params;
      const { action, reason, ruleBroken, durationDays } = req.body || {};

      if (!action || !['warn', 'restrict', 'suspend', 'ban', 'permanent_ban', 'restore'].includes(String(action))) {
        return res.status(400).json({ error: 'Valid moderation action required' });
      }

      const result = await executeModerationAction({
        adminId,
        targetUserId: userId,
        action,
        reason,
        ruleBroken,
        durationDays: durationDays ? Number(durationDays) : undefined,
        onStatusUpdated: deps.onStatusUpdated,
      });

      deps.invalidateTokenCachesForUser(userId);

      // Sync moderation status to Firestore user private doc if possible
      const nowIso = new Date().toISOString();
      await fsRestSetOrPatchDoc(
        idToken,
        `users/${userId}/private/info`,
        {
          status: result.statusApplied,
          strikeCount: result.strikeCount,
          banReason: result.user.ban_reason || '',
          ruleBroken: result.user.rule_broken || '',
          banUntil: result.user.ban_until || '',
          bannedUntil: result.user.ban_until || '',
          updatedAt: nowIso,
        },
        {
          updateMask: ['status', 'strikeCount', 'banReason', 'ruleBroken', 'banUntil', 'bannedUntil', 'updatedAt'],
        }
      );

      return res.json({
        success: true,
        statusApplied: result.statusApplied,
        strikeCount: result.strikeCount,
        banId: result.banId,
        emailSent: result.emailSent,
      });
    } catch (err: any) {
      return res.status(err?.statusCode || 500).json({ error: err?.message || 'Moderation failed' });
    }
  });

  router.get('/warnings', requireRoles('super_admin', 'moderator'), (req, res) => {
    try {
      const rows = db
        .prepare(`
          SELECT w.*, p.username, p.display_name, u.email, u.status as user_status, u.strike_count,
                 ap.username as admin_username, au.email as admin_email
          FROM user_warnings w
          LEFT JOIN users u ON u.id = w.user_id
          LEFT JOIN profiles p ON p.id = w.user_id
          LEFT JOIN users au ON au.id = w.admin_id
          LEFT JOIN profiles ap ON ap.id = w.admin_id
          ORDER BY w.created_at DESC
          LIMIT 200
        `)
        .all();
      return res.json({
        warnings: rows,
        settings: {
          warningThreshold: Number(getAppSetting('warning_threshold', '3')) || 3,
          warningAutoAction: getAppSetting('warning_auto_action', 'suspend'),
          warningSuspendDays: Number(getAppSetting('warning_suspend_days', '7')) || 7,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to load warnings' });
    }
  });

  // ------------------------------------------------------------------
  // FEATURE 4: REPORTS MANAGEMENT (Super Admin & Moderator)
  // ------------------------------------------------------------------
  router.get('/reports', requireRoles('super_admin', 'moderator'), async (req, res) => {
    try {
      const idToken = (req as any).firebaseIdToken as string | null;
      await syncFirestoreSnapshotIfAvailable(idToken);

      const statusFilter = String(req.query.status || 'all').trim().toLowerCase();
      const typeFilter = String(req.query.targetType || 'all').trim().toLowerCase();

      const rows = db
        .prepare(`
          SELECT ur.*,
                 rp.username as reporter_username, rp.display_name as reporter_display_name, rp.avatar_url as reporter_avatar_url,
                 tp.username as target_username, tp.display_name as target_display_name, tp.avatar_url as target_avatar_url,
                 tu.email as target_email, tu.status as target_status, tu.strike_count as target_strike_count
          FROM user_reports ur
          LEFT JOIN profiles rp ON rp.id = ur.reporter_id
          LEFT JOIN profiles tp ON tp.id = ur.reported_user_id
          LEFT JOIN users tu ON tu.id = ur.reported_user_id
          ORDER BY
            CASE ur.status WHEN 'pending' THEN 0 WHEN 'under_review' THEN 1 ELSE 2 END,
            ur.created_at DESC
          LIMIT 300
        `)
        .all() as any[];

      const reports = rows
        .filter((r) => {
          const normalizedStatus = r.status === 'dismissed' ? 'rejected' : r.status;
          if (statusFilter !== 'all') {
            if (statusFilter === 'rejected' && normalizedStatus !== 'rejected') return false;
            else if (statusFilter !== 'rejected' && r.status !== statusFilter) return false;
          }
          const inferredType =
            r.target_type ||
            (r.reported_message_id ? 'message' : r.family_id ? 'family' : 'user');
          if (typeFilter !== 'all' && inferredType !== typeFilter) return false;
          return true;
        })
        .map((r) => {
          const inferredType =
            r.target_type ||
            (r.reported_message_id ? 'message' : r.family_id ? 'family' : 'user');
          return {
            ...r,
            target_type: inferredType,
            status_display: r.status === 'dismissed' ? 'rejected' : r.status,
            reporter: {
              id: r.reporter_id,
              username: r.reporter_username || 'user',
              display_name: r.reporter_display_name || 'User',
              avatar_url: r.reporter_avatar_url || null,
            },
            reported_user: {
              id: r.reported_user_id,
              username: r.target_username || r.reported_username || 'user',
              display_name: r.target_display_name || r.reported_display_name || 'User',
              email: r.target_email || null,
              avatar_url: r.target_avatar_url || null,
              status: r.target_status || 'active',
              strike_count: Number(r.target_strike_count || 0),
            },
          };
        });

      return res.json({ reports });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to load reports' });
    }
  });

  router.post('/reports/:reportId/resolve', requireRoles('super_admin', 'moderator'), async (req, res) => {
    try {
      const adminId = (req as any).adminUserId as string;
      const idToken = (req as any).firebaseIdToken as string | null;
      const { reportId } = req.params;
      const { action, note, durationDays } = req.body || {};
      // action: 'warn_user' | 'delete_message' | 'suspend_user' | 'ban_user' | 'reject' | 'resolve'

      const report = db.prepare('SELECT * FROM user_reports WHERE id = ?').get(reportId) as any;
      if (!report) return res.status(404).json({ error: 'Report not found' });

      const nowIso = new Date().toISOString();
      const adminNote = String(note || '').trim().slice(0, 500) || null;
      const nextStatus = action === 'reject' ? 'rejected' : 'resolved';

      db.prepare(
        'UPDATE user_reports SET status = ?, admin_id = ?, admin_note = ?, reviewed_at = ?, updated_at = ? WHERE id = ?'
      ).run(nextStatus, adminId, adminNote ?? report.admin_note ?? null, nowIso, nowIso, reportId);

      // Mirror status update to Firestore user_reports
      await fsRestSetOrPatchDoc(
        idToken,
        `user_reports/${reportId}`,
        {
          status: nextStatus === 'rejected' ? 'dismissed' : 'resolved',
          adminId,
          adminNote: adminNote || '',
          updatedAt: nowIso,
        },
        { updateMask: ['status', 'adminId', 'adminNote', 'updatedAt'] }
      );

      let moderationResult: any = null;
      let messageDeleted = false;

      if (action === 'delete_message' && report.reported_message_id) {
        const msgId = String(report.reported_message_id);
        if (report.family_id) {
          db.prepare(
            "UPDATE family_messages SET is_deleted = 1, content = 'This message was removed by Moderation', deleted_by = ?, deleted_by_role = 'admin', updated_at = ? WHERE id = ?"
          ).run(adminId, nowIso, msgId);
          await fsRestSetOrPatchDoc(
            idToken,
            `families/${report.family_id}/messages/${msgId}`,
            {
              isDeleted: true,
              isPinned: false,
              content: 'This message was removed by Moderation',
              deletedBy: adminId,
              deletedByRole: 'admin',
              updatedAt: nowIso,
            },
            { updateMask: ['isDeleted', 'isPinned', 'content', 'deletedBy', 'deletedByRole', 'updatedAt'] }
          );
          messageDeleted = true;
        } else {
          db.prepare('INSERT OR IGNORE INTO deleted_messages (message_id, deleted_at) VALUES (?, ?)').run(msgId, nowIso);
          db.prepare('DELETE FROM messages WHERE id = ?').run(msgId);
          messageDeleted = true;
        }
        writeAuditLog({
          adminId,
          targetUserId: report.reported_user_id,
          action: 'report_delete_message',
          reason: adminNote || `Deleted reported message ${msgId}`,
          details: { reportId, msgId, familyId: report.family_id || null },
        });
      } else if (action === 'warn_user' || action === 'suspend_user' || action === 'ban_user') {
        const mappedAction =
          action === 'warn_user' ? 'warn' : action === 'suspend_user' ? 'suspend' : 'permanent_ban';
        moderationResult = await executeModerationAction({
          adminId,
          targetUserId: report.reported_user_id,
          action: mappedAction,
          reason: adminNote || `Action taken from safety report (${report.category})`,
          ruleBroken: 'community_guidelines',
          durationDays: durationDays ? Number(durationDays) : 7,
          onStatusUpdated: deps.onStatusUpdated,
        });
        deps.invalidateTokenCachesForUser(report.reported_user_id);
      } else {
        writeAuditLog({
          adminId,
          targetUserId: report.reported_user_id,
          action: action === 'reject' ? 'report_rejected' : 'report_resolved',
          reason: adminNote || `Report ${reportId} marked ${nextStatus}`,
          details: { reportId, category: report.category },
        });
      }

      const updated = db.prepare('SELECT * FROM user_reports WHERE id = ?').get(reportId);
      return res.json({
        success: true,
        report: updated,
        messageDeleted,
        moderationApplied: moderationResult?.statusApplied || null,
      });
    } catch (err: any) {
      return res.status(err?.statusCode || 500).json({ error: err?.message || 'Failed to resolve report' });
    }
  });

  // ------------------------------------------------------------------
  // FEATURE 5: FAMILY MANAGEMENT (Super Admin)
  // ------------------------------------------------------------------
  router.get('/families', requireRoles('super_admin'), async (req, res) => {
    try {
      const idToken = (req as any).firebaseIdToken as string | null;
      await syncFirestoreSnapshotIfAvailable(idToken);

      const q = String(req.query.q || '').trim().toLowerCase();
      const rows = db
        .prepare(`
          SELECT f.*,
                 op.username as owner_username, op.display_name as owner_display_name,
                 (SELECT COUNT(*) FROM family_members fm WHERE fm.family_id = f.id AND fm.role = 'admin' AND fm.status = 'active') as admins_count
          FROM families f
          LEFT JOIN profiles op ON op.id = f.owner_id
          ORDER BY f.updated_at DESC
          LIMIT 300
        `)
        .all() as any[];

      const families = rows
        .filter((f) => {
          if (!q) return true;
          return (
            String(f.name || '').toLowerCase().includes(q) ||
            String(f.id || '').toLowerCase().includes(q) ||
            String(f.owner_username || '').toLowerCase().includes(q) ||
            String(f.owner_display_name || '').toLowerCase().includes(q)
          );
        })
        .map((f) => {
          const admins = db
            .prepare(`
              SELECT fm.user_id, COALESCE(p.display_name, fm.display_name) as display_name,
                     COALESCE(p.username, fm.username) as username
              FROM family_members fm
              LEFT JOIN profiles p ON p.id = fm.user_id
              WHERE fm.family_id = ? AND fm.role = 'admin' AND fm.status = 'active'
            `)
            .all(f.id);
          return {
            ...f,
            is_suspended: Boolean(f.is_suspended),
            admins,
          };
        });

      return res.json({ families });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to list families' });
    }
  });

  router.get('/families/:familyId/members', requireRoles('super_admin'), async (req, res) => {
    try {
      const idToken = (req as any).firebaseIdToken as string | null;
      const { familyId } = req.params;
      const search = String(req.query.q || '').trim().toLowerCase();

      // Pull from Firestore if needed so Firebase-created family members are also synced
      const fsMembers = await fsRestListCollection(idToken, `families/${familyId}/members`, 250);
      for (const m of fsMembers) {
        const d = m.data;
        const uid = String(d.userId || m.id);
        if (!uid) continue;
        db.prepare(`
          INSERT OR IGNORE INTO family_members (
            family_id, user_id, role, status, relation_tag, display_name, username, avatar_url, joined_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          familyId,
          uid,
          String(d.role || 'member'),
          String(d.status || 'active'),
          d.relationTag || null,
          String(d.displayName || ''),
          String(d.username || ''),
          d.avatarUrl || null,
          typeof d.joinedAt === 'string' ? d.joinedAt : new Date().toISOString(),
          typeof d.updatedAt === 'string' ? d.updatedAt : new Date().toISOString()
        );
      }

      const rows = db
        .prepare(`
          SELECT fm.*, COALESCE(p.display_name, fm.display_name) as resolved_display_name,
                 COALESCE(p.username, fm.username) as resolved_username,
                 COALESCE(p.avatar_url, fm.avatar_url) as resolved_avatar_url,
                 u.is_verified
          FROM family_members fm
          LEFT JOIN profiles p ON p.id = fm.user_id
          LEFT JOIN users u ON u.id = fm.user_id
          WHERE fm.family_id = ? AND fm.status = 'active'
          ORDER BY CASE fm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, fm.joined_at ASC
          LIMIT 300
        `)
        .all(familyId) as any[];

      const members = rows
        .filter((r) => {
          if (!search) return true;
          return (
            String(r.resolved_display_name || '').toLowerCase().includes(search) ||
            String(r.resolved_username || '').toLowerCase().includes(search) ||
            String(r.user_id || '').toLowerCase().includes(search)
          );
        })
        .map((r) => ({
          userId: r.user_id,
          familyId: r.family_id,
          role: r.role,
          status: r.status,
          relationTag: r.relation_tag || null,
          displayName: r.resolved_display_name || r.resolved_username || 'Member',
          username: r.resolved_username || '',
          avatarUrl: r.resolved_avatar_url || null,
          isVerified: Boolean(r.is_verified),
          joinedAt: r.joined_at,
        }));

      return res.json({ members });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to fetch family members' });
    }
  });

  router.post('/families/:familyId/suspend', requireRoles('super_admin'), async (req, res) => {
    try {
      const adminId = (req as any).adminUserId as string;
      const idToken = (req as any).firebaseIdToken as string | null;
      const { familyId } = req.params;
      const { suspend, reason } = req.body || {};

      const fam = db.prepare('SELECT * FROM families WHERE id = ?').get(familyId) as any;
      if (!fam) return res.status(404).json({ error: 'Family not found' });

      const nowIso = new Date().toISOString();
      const nextSuspended = Boolean(suspend);
      const cleanReason = String(reason || (nextSuspended ? 'Suspended by Super Admin' : 'Suspension lifted')).trim();

      db.prepare(
        'UPDATE families SET is_suspended = ?, suspended_reason = ?, suspended_at = ?, suspended_by = ?, updated_at = ? WHERE id = ?'
      ).run(nextSuspended ? 1 : 0, nextSuspended ? cleanReason : null, nextSuspended ? nowIso : null, nextSuspended ? adminId : null, nowIso, familyId);

      await fsRestSetOrPatchDoc(
        idToken,
        `families/${familyId}`,
        {
          isSuspended: nextSuspended,
          suspendedReason: nextSuspended ? cleanReason : null,
          suspendedAt: nextSuspended ? nowIso : null,
          updatedAt: nowIso,
        },
        { updateMask: ['isSuspended', 'suspendedReason', 'suspendedAt', 'updatedAt'] }
      );

      writeAuditLog({
        adminId,
        targetUserId: fam.owner_id || familyId,
        action: nextSuspended ? 'suspend_family' : 'unsuspend_family',
        reason: cleanReason,
        details: { familyId, familyName: fam.name },
      });

      return res.json({ success: true, isSuspended: nextSuspended });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to update family suspension' });
    }
  });

  router.delete('/families/:familyId', requireRoles('super_admin'), async (req, res) => {
    try {
      const adminId = (req as any).adminUserId as string;
      const idToken = (req as any).firebaseIdToken as string | null;
      const { familyId } = req.params;

      const fam = db.prepare('SELECT * FROM families WHERE id = ?').get(familyId) as any;
      if (!fam) return res.status(404).json({ error: 'Family not found' });

      const members = db
        .prepare('SELECT user_id FROM family_members WHERE family_id = ?')
        .all(familyId) as Array<{ user_id: string }>;

      db.exec('BEGIN');
      try {
        db.prepare('DELETE FROM family_message_reads WHERE family_id = ?').run(familyId);
        db.prepare('DELETE FROM family_typing_status WHERE family_id = ?').run(familyId);
        db.prepare('DELETE FROM family_messages WHERE family_id = ?').run(familyId);
        db.prepare('DELETE FROM family_requests WHERE family_id = ?').run(familyId);
        db.prepare('DELETE FROM family_invites WHERE family_id = ?').run(familyId);
        db.prepare('DELETE FROM family_members WHERE family_id = ?').run(familyId);
        db.prepare('DELETE FROM families WHERE id = ?').run(familyId);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }

      if (fam.invite_code) {
        await fsRestDeleteDoc(idToken, `family_invite_links/${fam.invite_code}`);
      }
      await Promise.all(
        members.slice(0, 50).map((m) => fsRestDeleteDoc(idToken, `users/${m.user_id}/family_memberships/${familyId}`))
      );
      await fsRestDeleteDoc(idToken, `families/${familyId}`);

      writeAuditLog({
        adminId,
        targetUserId: fam.owner_id || familyId,
        action: 'delete_family',
        reason: String(req.body?.reason || `Deleted Family "${fam.name}"`),
        details: { familyId, familyName: fam.name },
      });

      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to delete family' });
    }
  });

  router.delete('/families/:familyId/members/:userId', requireRoles('super_admin'), async (req, res) => {
    try {
      const adminId = (req as any).adminUserId as string;
      const idToken = (req as any).firebaseIdToken as string | null;
      const { familyId, userId } = req.params;

      const fam = db.prepare('SELECT * FROM families WHERE id = ?').get(familyId) as any;
      if (!fam) return res.status(404).json({ error: 'Family not found' });
      if (fam.owner_id === userId) {
        return res.status(400).json({ error: 'Transfer Family ownership before removing the current Owner.' });
      }

      const nowIso = new Date().toISOString();
      db.prepare(
        "UPDATE family_members SET status = 'removed', role = 'member', removed_at = ?, removed_by = ?, updated_at = ? WHERE family_id = ? AND user_id = ?"
      ).run(nowIso, adminId, nowIso, familyId, userId);

      const cnt = (
        db.prepare("SELECT COUNT(*) as cnt FROM family_members WHERE family_id = ? AND status = 'active'").get(familyId) as {
          cnt: number;
        }
      ).cnt;
      db.prepare('UPDATE families SET member_count = ?, updated_at = ? WHERE id = ?').run(cnt, nowIso, familyId);

      await Promise.all([
        fsRestSetOrPatchDoc(
          idToken,
          `families/${familyId}/members/${userId}`,
          { status: 'removed', role: 'member', removedAt: nowIso, removedBy: adminId, updatedAt: nowIso },
          { updateMask: ['status', 'role', 'removedAt', 'removedBy', 'updatedAt'] }
        ),
        fsRestSetOrPatchDoc(
          idToken,
          `users/${userId}/family_memberships/${familyId}`,
          { status: 'removed', role: 'member', updatedAt: nowIso },
          { updateMask: ['status', 'role', 'updatedAt'] }
        ),
        fsRestSetOrPatchDoc(
          idToken,
          `families/${familyId}`,
          { memberCount: cnt, updatedAt: nowIso },
          { updateMask: ['memberCount', 'updatedAt'] }
        ),
      ]);

      writeAuditLog({
        adminId,
        targetUserId: userId,
        action: 'family_remove_member',
        reason: `Removed user from Family "${fam.name}"`,
        details: { familyId },
      });

      return res.json({ success: true, memberCount: cnt });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to remove member' });
    }
  });

  router.post('/families/:familyId/transfer-owner', requireRoles('super_admin'), async (req, res) => {
    try {
      const adminId = (req as any).adminUserId as string;
      const idToken = (req as any).firebaseIdToken as string | null;
      const { familyId } = req.params;
      const { newOwnerId } = req.body || {};

      const fam = db.prepare('SELECT * FROM families WHERE id = ?').get(familyId) as any;
      if (!fam) return res.status(404).json({ error: 'Family not found' });
      if (!newOwnerId) return res.status(400).json({ error: 'newOwnerId is required' });

      const targetMember = db
        .prepare("SELECT * FROM family_members WHERE family_id = ? AND user_id = ? AND status = 'active'")
        .get(familyId, newOwnerId) as any;
      if (!targetMember) {
        return res.status(400).json({ error: 'New owner must be an active member of this Family.' });
      }

      const prevOwnerId = fam.owner_id;
      const nowIso = new Date().toISOString();

      db.exec('BEGIN');
      try {
        if (prevOwnerId && prevOwnerId !== newOwnerId) {
          db.prepare("UPDATE family_members SET role = 'admin', updated_at = ? WHERE family_id = ? AND user_id = ?").run(
            nowIso,
            familyId,
            prevOwnerId
          );
        }
        db.prepare("UPDATE family_members SET role = 'owner', updated_at = ? WHERE family_id = ? AND user_id = ?").run(
          nowIso,
          familyId,
          newOwnerId
        );
        db.prepare('UPDATE families SET owner_id = ?, updated_at = ? WHERE id = ?').run(newOwnerId, nowIso, familyId);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }

      await Promise.all([
        fsRestSetOrPatchDoc(
          idToken,
          `families/${familyId}`,
          { ownerId: newOwnerId, updatedAt: nowIso },
          { updateMask: ['ownerId', 'updatedAt'] }
        ),
        fsRestSetOrPatchDoc(
          idToken,
          `families/${familyId}/members/${newOwnerId}`,
          { role: 'owner', updatedAt: nowIso },
          { updateMask: ['role', 'updatedAt'] }
        ),
        prevOwnerId && prevOwnerId !== newOwnerId
          ? fsRestSetOrPatchDoc(
              idToken,
              `families/${familyId}/members/${prevOwnerId}`,
              { role: 'admin', updatedAt: nowIso },
              { updateMask: ['role', 'updatedAt'] }
            )
          : Promise.resolve(false),
      ]);

      writeAuditLog({
        adminId,
        targetUserId: newOwnerId,
        action: 'family_transfer_owner',
        reason: `Transferred ownership of "${fam.name}" to ${targetMember.display_name || newOwnerId}`,
        details: { familyId, previousOwnerId: prevOwnerId, newOwnerId },
      });

      return res.json({ success: true, ownerId: newOwnerId });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to transfer ownership' });
    }
  });

  // ------------------------------------------------------------------
  // FEATURE 7: IMMUTABLE ACTIVITY LOGS (Super Admin)
  // ------------------------------------------------------------------
  router.get('/logs', requireRoles('super_admin'), (req, res) => {
    try {
      const q = String(req.query.q || '').trim().toLowerCase();
      const actionFilter = String(req.query.action || 'all').trim().toLowerCase();
      const adminFilter = String(req.query.adminId || 'all').trim();

      const rows = db
        .prepare(`
          SELECT a.*,
                 COALESCE(au.email, a.admin_id) as admin_email,
                 COALESCE(ap.username, '') as admin_username,
                 COALESCE(tp.username, tu.email, a.target_user_id) as target_label
          FROM audit_logs a
          LEFT JOIN users au ON au.id = a.admin_id
          LEFT JOIN profiles ap ON ap.id = a.admin_id
          LEFT JOIN users tu ON tu.id = a.target_user_id
          LEFT JOIN profiles tp ON tp.id = a.target_user_id
          ORDER BY a.created_at DESC
          LIMIT 500
        `)
        .all() as any[];

      const logs = rows.filter((l) => {
        if (actionFilter !== 'all' && String(l.action || '').toLowerCase() !== actionFilter) return false;
        if (adminFilter !== 'all' && l.admin_id !== adminFilter) return false;
        if (!q) return true;
        return (
          String(l.action || '').toLowerCase().includes(q) ||
          String(l.reason || '').toLowerCase().includes(q) ||
          String(l.admin_email || '').toLowerCase().includes(q) ||
          String(l.admin_username || '').toLowerCase().includes(q) ||
          String(l.target_label || '').toLowerCase().includes(q) ||
          String(l.target_user_id || '').toLowerCase().includes(q)
        );
      });

      return res.json({ logs });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to load activity logs' });
    }
  });

  // ------------------------------------------------------------------
  // FEATURE 8 & 9 SETTINGS: MAINTENANCE MODE & WARNING THRESHOLD (Super Admin)
  // ------------------------------------------------------------------
  router.get('/settings', requireRoles('super_admin'), (_req, res) => {
    return res.json({
      maintenanceMode: getAppSetting('maintenance_mode', 'false') === 'true',
      maintenanceMessage: getAppSetting(
        'maintenance_message',
        'LiveConnect is currently undergoing scheduled maintenance. Please check back shortly.'
      ),
      warningThreshold: Number(getAppSetting('warning_threshold', '3')) || 3,
      warningAutoAction: getAppSetting('warning_auto_action', 'suspend'),
      warningSuspendDays: Number(getAppSetting('warning_suspend_days', '7')) || 7,
      officialChatModeratorsEnabled: isOfficialChatModeratorsEnabled(),
    });
  });

  router.post('/settings/maintenance', requireRoles('super_admin'), async (req, res) => {
    try {
      const adminId = (req as any).adminUserId as string;
      const idToken = (req as any).firebaseIdToken as string | null;
      const { enabled, message } = req.body || {};

      const isEnabled = Boolean(enabled);
      const cleanMessage =
        String(
          message ||
            getAppSetting(
              'maintenance_message',
              'LiveConnect is currently undergoing scheduled maintenance. Please check back shortly.'
            )
        )
          .trim()
          .slice(0, 500) || 'LiveConnect is currently undergoing scheduled maintenance.';

      setAppSetting('maintenance_mode', isEnabled ? 'true' : 'false', adminId);
      setAppSetting('maintenance_message', cleanMessage, adminId);

      const nowIso = new Date().toISOString();
      await fsRestSetOrPatchDoc(idToken, 'app_config/settings', {
        id: 'settings',
        maintenanceMode: isEnabled,
        maintenanceMessage: cleanMessage,
        officialChatModeratorsEnabled: isOfficialChatModeratorsEnabled(),
        updatedBy: adminId,
        updatedAt: nowIso,
      });

      writeAuditLog({
        adminId,
        targetUserId: 'system_maintenance',
        action: isEnabled ? 'maintenance_enabled' : 'maintenance_disabled',
        reason: cleanMessage,
      });

      return res.json({ success: true, maintenanceMode: isEnabled, maintenanceMessage: cleanMessage });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to update maintenance mode' });
    }
  });

  router.post('/settings/official-chat-moderators', requireRoles('super_admin'), async (req, res) => {
    try {
      const adminId = (req as any).adminUserId as string;
      const idToken = (req as any).firebaseIdToken as string | null;
      const isEnabled = Boolean(req.body?.enabled);

      setAppSetting('official_chat_moderators_enabled', isEnabled ? 'true' : 'false', adminId);

      const maintenanceMode = getAppSetting('maintenance_mode', 'false') === 'true';
      const maintenanceMessage = getAppSetting(
        'maintenance_message',
        'LiveConnect is currently undergoing scheduled maintenance. Please check back shortly.'
      );

      const nowIso = new Date().toISOString();
      await fsRestSetOrPatchDoc(idToken, 'app_config/settings', {
        id: 'settings',
        maintenanceMode,
        maintenanceMessage,
        officialChatModeratorsEnabled: isEnabled,
        updatedBy: adminId,
        updatedAt: nowIso,
      });

      writeAuditLog({
        adminId,
        targetUserId: 'official_chat',
        action: 'official_chat_access_updated',
        reason: isEnabled
          ? 'Enabled Official Chat access for Moderators'
          : 'Disabled Official Chat access for Moderators',
        details: { officialChatModeratorsEnabled: isEnabled },
      });

      return res.json({ success: true, officialChatModeratorsEnabled: isEnabled });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to update Official Chat moderator access' });
    }
  });

  router.post('/settings/warnings', requireRoles('super_admin'), (req, res) => {
    try {
      const adminId = (req as any).adminUserId as string;
      const { warningThreshold, warningAutoAction, warningSuspendDays } = req.body || {};

      const nextThreshold = Math.min(20, Math.max(1, Number(warningThreshold || 3)));
      const nextAction = warningAutoAction === 'ban' ? 'ban' : 'suspend';
      const nextDays = Math.min(365, Math.max(1, Number(warningSuspendDays || 7)));

      setAppSetting('warning_threshold', String(nextThreshold), adminId);
      setAppSetting('warning_auto_action', nextAction, adminId);
      setAppSetting('warning_suspend_days', String(nextDays), adminId);

      writeAuditLog({
        adminId,
        targetUserId: 'system_settings',
        action: 'update_warning_settings',
        reason: `Auto-${nextAction} after ${nextThreshold} warnings`,
        details: { nextThreshold, nextAction, nextDays },
      });

      return res.json({
        success: true,
        warningThreshold: nextThreshold,
        warningAutoAction: nextAction,
        warningSuspendDays: nextDays,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to save warning settings' });
    }
  });

  // ------------------------------------------------------------------
  // FEATURE 10: BAN APPEALS (Super Admin & Moderator)
  // ------------------------------------------------------------------
  router.get('/appeals', requireRoles('super_admin', 'moderator'), async (req, res) => {
    try {
      const idToken = (req as any).firebaseIdToken as string | null;
      await syncFirestoreSnapshotIfAvailable(idToken);

      const statusFilter = String(req.query.status || 'all').trim().toLowerCase();
      const rows = db
        .prepare(`
          SELECT a.*, u.email, u.status as user_status, u.strike_count, u.ban_reason, u.rule_broken, u.ban_until,
                 p.username, p.display_name, p.avatar_url
          FROM appeals a
          LEFT JOIN users u ON u.id = a.user_id
          LEFT JOIN profiles p ON p.id = a.user_id
          ORDER BY CASE WHEN a.status = 'pending' THEN 0 ELSE 1 END, a.created_at DESC
          LIMIT 200
        `)
        .all() as any[];

      const appeals = rows
        .filter((r) => statusFilter === 'all' || r.status === statusFilter)
        .map((r) => ({
          ...r,
          user: {
            id: r.user_id,
            username: r.username || 'user',
            display_name: r.display_name || r.email || 'User',
            email: r.email,
            avatar_url: r.avatar_url || null,
            status: r.user_status || 'active',
            strike_count: Number(r.strike_count || 0),
            ban_reason: r.ban_reason || null,
            rule_broken: r.rule_broken || null,
            ban_until: r.ban_until || null,
          },
        }));

      return res.json({ appeals });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to load appeals' });
    }
  });

  router.post('/appeals/:appealId/review', requireRoles('super_admin', 'moderator'), async (req, res) => {
    try {
      const adminId = (req as any).adminUserId as string;
      const idToken = (req as any).firebaseIdToken as string | null;
      const { appealId } = req.params;
      const { decision, note } = req.body || {};

      if (decision !== 'approved' && decision !== 'rejected') {
        return res.status(400).json({ error: 'decision must be approved or rejected' });
      }

      const appeal = db.prepare('SELECT * FROM appeals WHERE id = ?').get(appealId) as any;
      if (!appeal) return res.status(404).json({ error: 'Appeal not found' });
      if (appeal.status !== 'pending') {
        return res.status(409).json({ error: `Appeal already ${appeal.status}` });
      }

      const nowIso = new Date().toISOString();
      const adminNote = String(
        note || (decision === 'approved' ? 'Appeal approved — account unbanned.' : 'Appeal rejected.')
      )
        .trim()
        .slice(0, 500);

      db.prepare(
        'UPDATE appeals SET status = ?, admin_id = ?, admin_note = ?, reviewed_at = ?, updated_at = ? WHERE id = ?'
      ).run(decision, adminId, adminNote, nowIso, nowIso, appealId);

      await fsRestSetOrPatchDoc(
        idToken,
        `appeals/${appealId}`,
        { status: decision, adminNote, updatedAt: nowIso },
        { updateMask: ['status', 'adminNote', 'updatedAt'] }
      );

      if (decision === 'approved') {
        await executeModerationAction({
          adminId,
          targetUserId: appeal.user_id,
          action: 'restore',
          reason: adminNote,
          onStatusUpdated: deps.onStatusUpdated,
        });
        deps.invalidateTokenCachesForUser(appeal.user_id);
        await fsRestSetOrPatchDoc(
          idToken,
          `users/${appeal.user_id}/private/info`,
          { status: 'active', banReason: '', banUntil: '', bannedUntil: '', restoredNoticePending: true, updatedAt: nowIso },
          { updateMask: ['status', 'banReason', 'banUntil', 'bannedUntil', 'restoredNoticePending', 'updatedAt'] }
        );
      } else {
        writeAuditLog({
          adminId,
          targetUserId: appeal.user_id,
          action: 'appeal_rejected',
          reason: adminNote,
          details: { appealId },
        });
      }

      return res.json({ success: true, appeal: db.prepare('SELECT * FROM appeals WHERE id = ?').get(appealId) });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to review appeal' });
    }
  });

  // ------------------------------------------------------------------
  // FEATURE 11: OFFICIAL CHAT (Super Admin + optional Moderator access)
  // ------------------------------------------------------------------
  function requireOfficialChatAccess(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) {
    const role = (req as any).adminRole as AdminPanelRole;
    if (role === 'super_admin') return next();
    if (role === 'moderator' && isOfficialChatModeratorsEnabled()) return next();
    return res.status(403).json({
      error: 'Official Chat access is restricted to Super Admin or enabled Moderators.',
    });
  }

  function formatOfficialRow(row: any) {
    return {
      id: row.id,
      text: row.text || '',
      imageUrl: row.image_url || null,
      senderId: row.sender_id,
      senderEmail: row.sender_email || null,
      senderRole: row.sender_role || 'super_admin',
      deliveredCount: Number(row.delivered_count || 0),
      isDeleted: Boolean(row.is_deleted),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async function dispatchOfficialChatNotificationsInBatches(params: {
    messageId: string;
    previewText: string;
    createdAt: string;
    idToken: string | null;
  }) {
    const { messageId, previewText, createdAt, idToken } = params;
    try {
      const sqliteUsers = db
        .prepare("SELECT id FROM users WHERE status NOT IN ('disabled', 'deactivated')")
        .all() as Array<{ id: string }>;

      const sqliteUserIds = sqliteUsers.map((u) => u.id).filter(Boolean);
      const allRecipientIds = new Set<string>(sqliteUserIds);

      // Include all Firebase-registered public_profiles so Firebase users always receive notifications
      let fsProfileIds: string[] = [];
      if (idToken && idToken.split('.').length === 3) {
        const fsProfiles = await fsRestListAllCollection(idToken, 'public_profiles', 5000);
        fsProfileIds = fsProfiles.map((p) => String(p.data?.id || p.id)).filter(Boolean);
        for (const uid of fsProfileIds) {
          allRecipientIds.add(uid);
        }
      }

      const actorJson = JSON.stringify({
        id: 'official_liveconnect',
        username: 'liveconnect',
        display_name: 'LiveConnect',
        avatar_url: '/icon.svg',
        is_verified: true,
      });

      const notifStmt = db.prepare(`
        INSERT INTO notifications (id, user_id, actor_id, type, title, message, reference_id, actor_json, is_read, created_at)
        VALUES (?, ?, 'official_liveconnect', 'official_chat', 'LiveConnect', ?, ?, ?, 0, ?)
      `);

      // Chunk SQLite inserts (100 rows per transaction) with yields so event loop stays responsive
      const recipientArray = Array.from(allRecipientIds);
      const SQLITE_CHUNK = 100;
      for (let i = 0; i < recipientArray.length; i += SQLITE_CHUNK) {
        const chunk = recipientArray.slice(i, i + SQLITE_CHUNK);
        db.exec('BEGIN');
        try {
          for (const uid of chunk) {
            notifStmt.run(
              `notif_off_${generateId().replace(/-/g, '').slice(0, 16)}`,
              uid,
              previewText,
              messageId,
              actorJson,
              createdAt
            );
          }
          db.exec('COMMIT');
        } catch {
          try {
            db.exec('ROLLBACK');
          } catch {}
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      // Batched Firestore REST notification writes (200 per :commit batch)
      if (idToken && idToken.split('.').length === 3 && recipientArray.length > 0) {
        const writeOps = recipientArray.map((uid) => {
          const notifId = `notif_off_${messageId}_${uid}`.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 120);
          return {
            docPath: `users/${uid}/notifications/${notifId}`,
            fields: {
              id: notifId,
              userId: uid,
              actorId: 'official_liveconnect',
              actorDisplayName: 'LiveConnect',
              actorUsername: 'liveconnect',
              actorAvatarUrl: '/icon.svg',
              type: 'official_chat',
              title: 'LiveConnect',
              message: previewText,
              referenceId: messageId,
              isRead: false,
              createdAt,
            },
            timestampKeys: ['createdAt'],
          };
        });
        await fsRestCommitBatchWrites(idToken, writeOps);
      }

      const finalDelivered = recipientArray.length;
      const doneIso = new Date().toISOString();
      db.prepare('UPDATE official_messages SET delivered_count = ?, updated_at = ? WHERE id = ? AND is_deleted = 0').run(
        finalDelivered,
        doneIso,
        messageId
      );

      if (idToken && idToken.split('.').length === 3) {
        await fsRestSetOrPatchDoc(
          idToken,
          `official_messages/${messageId}`,
          { deliveredCount: finalDelivered, updatedAt: doneIso },
          { updateMask: ['deliveredCount', 'updatedAt'], timestampKeys: ['updatedAt'] }
        );
      }
    } catch {
      // Non-fatal background fan-out guard
    }
  }

  router.get('/official-chat', requireOfficialChatAccess, async (req, res) => {
    try {
      const idToken = (req as any).firebaseIdToken as string | null;
      if (idToken && idToken.split('.').length === 3) {
        const fsMsgs = await fsRestListAllCollection(idToken, 'official_messages', 500);
        for (const item of fsMsgs) {
          const d = item.data || {};
          const msgId = String(d.id || item.id);
          if (!msgId || d.isDeleted) continue;
          const exists = db.prepare('SELECT id, is_deleted FROM official_messages WHERE id = ?').get(msgId) as
            | { id: string; is_deleted: number }
            | undefined;
          if (!exists) {
            const nowIso = new Date().toISOString();
            db.prepare(`
              INSERT OR IGNORE INTO official_messages (
                id, text, image_url, sender_id, sender_email, sender_role, delivered_count, is_deleted, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
            `).run(
              msgId,
              String(d.text || ''),
              d.imageUrl || null,
              String(d.senderId || 'admin'),
              d.senderEmail || null,
              String(d.senderRole || 'super_admin'),
              Number(d.deliveredCount || 0),
              typeof d.createdAt === 'string' ? d.createdAt : nowIso,
              typeof d.updatedAt === 'string' ? d.updatedAt : nowIso
            );
          }
        }
      }

      const rows = db
        .prepare('SELECT * FROM official_messages WHERE is_deleted = 0 ORDER BY created_at DESC LIMIT 200')
        .all();

      return res.json({
        messages: rows.map(formatOfficialRow),
        moderatorsEnabled: isOfficialChatModeratorsEnabled(),
      });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to load Official Chat messages' });
    }
  });

  router.post('/official-chat', requireOfficialChatAccess, async (req, res) => {
    try {
      const adminRow = (req as any).adminUserRow as DbUserRow;
      const adminRole = (req as any).adminRole as AdminPanelRole;
      const idToken = (req as any).firebaseIdToken as string | null;
      const { text, imageUrl } = req.body || {};

      const cleanText = String(text || '').trim().slice(0, 4000);
      const cleanImageUrl = imageUrl ? String(imageUrl).trim().slice(0, 1024) : null;

      if (!cleanText && !cleanImageUrl) {
        return res.status(400).json({ error: 'Please enter a message or attach an image.' });
      }

      if (
        cleanImageUrl &&
        !cleanImageUrl.startsWith('/api/media/') &&
        !cleanImageUrl.startsWith('https://') &&
        !cleanImageUrl.startsWith('http://')
      ) {
        return res.status(400).json({ error: 'Invalid image URL. Upload the image first.' });
      }

      const id = `off_${generateId().replace(/-/g, '').slice(0, 18)}`;
      const nowIso = new Date().toISOString();

      const estRow = db
        .prepare("SELECT COUNT(*) as cnt FROM users WHERE status NOT IN ('disabled', 'deactivated')")
        .get() as { cnt: number };
      const initialEstimate = Number(estRow?.cnt || 0);

      db.prepare(`
        INSERT INTO official_messages (
          id, text, image_url, sender_id, sender_email, sender_role, delivered_count, is_deleted, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `).run(
        id,
        cleanText,
        cleanImageUrl,
        adminRow.id,
        adminRow.email,
        adminRole === 'moderator' ? 'moderator' : 'super_admin',
        initialEstimate,
        nowIso,
        nowIso
      );

      await fsRestSetOrPatchDoc(
        idToken,
        `official_messages/${id}`,
        {
          id,
          text: cleanText,
          imageUrl: cleanImageUrl || null,
          senderId: adminRow.id,
          senderEmail: adminRow.email || null,
          senderRole: adminRole === 'moderator' ? 'moderator' : 'super_admin',
          deliveredCount: initialEstimate,
          isDeleted: false,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
        { timestampKeys: ['createdAt', 'updatedAt'] }
      );

      const previewText = cleanText
        ? cleanText.slice(0, 500)
        : '📷 Sent a photo in Official Chat';

      writeAuditLog({
        adminId: adminRow.id,
        targetUserId: 'official_chat',
        action: 'official_chat_sent',
        reason: previewText.slice(0, 180),
        details: {
          messageId: id,
          hasImage: Boolean(cleanImageUrl),
          senderRole: adminRole,
          estimatedRecipients: initialEstimate,
        },
      });

      // Fan out push/in-app notifications asynchronously in batches so admin request never blocks
      setImmediate(() => {
        void dispatchOfficialChatNotificationsInBatches({
          messageId: id,
          previewText,
          createdAt: nowIso,
          idToken,
        });
      });

      const createdRow = db.prepare('SELECT * FROM official_messages WHERE id = ?').get(id);
      return res.json({
        success: true,
        message: formatOfficialRow(createdRow),
        estimatedRecipients: initialEstimate,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to send Official Chat message' });
    }
  });

  router.delete('/official-chat/:messageId', requireOfficialChatAccess, async (req, res) => {
    try {
      const adminRow = (req as any).adminUserRow as DbUserRow;
      const idToken = (req as any).firebaseIdToken as string | null;
      const { messageId } = req.params;

      const existing = db.prepare('SELECT * FROM official_messages WHERE id = ?').get(messageId) as any;
      if (!existing || existing.is_deleted) {
        return res.status(404).json({ error: 'Official message not found' });
      }

      const nowIso = new Date().toISOString();
      db.prepare(
        'UPDATE official_messages SET is_deleted = 1, deleted_by = ?, deleted_at = ?, updated_at = ? WHERE id = ?'
      ).run(adminRow.id, nowIso, nowIso, messageId);

      // Remove global notifications linked to this deleted message in SQLite
      db.prepare("DELETE FROM notifications WHERE type = 'official_chat' AND reference_id = ?").run(messageId);

      // Delete Firestore document so it vanishes immediately for all users
      await fsRestDeleteDoc(idToken, `official_messages/${messageId}`);

      writeAuditLog({
        adminId: adminRow.id,
        targetUserId: 'official_chat',
        action: 'official_chat_deleted',
        reason: existing.text
          ? `Deleted official message: "${String(existing.text).slice(0, 120)}"`
          : 'Deleted official image message for everyone',
        details: { messageId },
      });

      return res.json({ success: true, messageId });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to delete Official Chat message' });
    }
  });

  // ------------------------------------------------------------------
  // FEATURE 12: BANNED WORDS FILTER (Super Admin)
  // ------------------------------------------------------------------
  router.get('/banned-words', requireRoles('super_admin'), (_req, res) => {
    return res.json({ words: listBannedWords() });
  });

  router.post('/banned-words', requireRoles('super_admin'), async (req, res) => {
    try {
      const adminId = (req as any).adminUserId as string;
      const idToken = (req as any).firebaseIdToken as string | null;
      const { word, matchMode, action } = req.body || {};

      const cleanWord = String(word || '').trim().slice(0, 80);
      if (cleanWord.length < 2) {
        return res.status(400).json({ error: 'Word must be at least 2 characters.' });
      }
      const wordLower = cleanWord.toLowerCase();
      const dup = db.prepare('SELECT id FROM banned_words WHERE word_lower = ?').get(wordLower);
      if (dup) {
        return res.status(409).json({ error: 'This word is already in the blocked list.' });
      }

      const id = `bw_${generateId().replace(/-/g, '').slice(0, 16)}`;
      const nowIso = new Date().toISOString();
      const mode = matchMode === 'exact' ? 'exact' : 'substring';
      const act = action === 'flag' ? 'flag' : 'block';

      db.prepare(
        'INSERT INTO banned_words (id, word, word_lower, match_mode, action, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(id, cleanWord, wordLower, mode, act, adminId, nowIso, nowIso);

      await fsRestSetOrPatchDoc(idToken, `banned_words/${id}`, {
        id,
        word: cleanWord,
        wordLower,
        matchMode: mode,
        action: act,
        createdBy: adminId,
        createdAt: nowIso,
        updatedAt: nowIso,
      });

      writeAuditLog({
        adminId,
        targetUserId: 'banned_words',
        action: 'banned_word_added',
        reason: `Added blocked word "${cleanWord}" (${mode}, ${act})`,
      });

      return res.json({ success: true, word: db.prepare('SELECT * FROM banned_words WHERE id = ?').get(id) });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to add banned word' });
    }
  });

  router.put('/banned-words/:wordId', requireRoles('super_admin'), async (req, res) => {
    try {
      const adminId = (req as any).adminUserId as string;
      const idToken = (req as any).firebaseIdToken as string | null;
      const { wordId } = req.params;
      const { word, matchMode, action } = req.body || {};

      const existing = db.prepare('SELECT * FROM banned_words WHERE id = ?').get(wordId) as any;
      if (!existing) return res.status(404).json({ error: 'Word not found' });

      const cleanWord = String(word || existing.word).trim().slice(0, 80);
      const wordLower = cleanWord.toLowerCase();
      const conflict = db.prepare('SELECT id FROM banned_words WHERE word_lower = ? AND id != ?').get(wordLower, wordId);
      if (conflict) return res.status(409).json({ error: 'Duplicate blocked word.' });

      const mode = matchMode === 'exact' ? 'exact' : 'substring';
      const act = action === 'flag' ? 'flag' : 'block';
      const nowIso = new Date().toISOString();

      db.prepare(
        'UPDATE banned_words SET word = ?, word_lower = ?, match_mode = ?, action = ?, updated_at = ? WHERE id = ?'
      ).run(cleanWord, wordLower, mode, act, nowIso, wordId);

      await fsRestSetOrPatchDoc(idToken, `banned_words/${wordId}`, {
        id: wordId,
        word: cleanWord,
        wordLower,
        matchMode: mode,
        action: act,
        createdBy: existing.created_by || adminId,
        createdAt: existing.created_at || nowIso,
        updatedAt: nowIso,
      });

      writeAuditLog({
        adminId,
        targetUserId: 'banned_words',
        action: 'banned_word_updated',
        reason: `Updated blocked word "${cleanWord}" (${mode}, ${act})`,
      });

      return res.json({ success: true, word: db.prepare('SELECT * FROM banned_words WHERE id = ?').get(wordId) });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to update banned word' });
    }
  });

  router.delete('/banned-words/:wordId', requireRoles('super_admin'), async (req, res) => {
    try {
      const adminId = (req as any).adminUserId as string;
      const idToken = (req as any).firebaseIdToken as string | null;
      const { wordId } = req.params;

      const existing = db.prepare('SELECT * FROM banned_words WHERE id = ?').get(wordId) as any;
      if (!existing) return res.status(404).json({ error: 'Word not found' });

      db.prepare('DELETE FROM banned_words WHERE id = ?').run(wordId);
      await fsRestDeleteDoc(idToken, `banned_words/${wordId}`);

      writeAuditLog({
        adminId,
        targetUserId: 'banned_words',
        action: 'banned_word_removed',
        reason: `Removed blocked word "${existing.word}"`,
      });

      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to delete banned word' });
    }
  });

  // ------------------------------------------------------------------
  // FEATURE 13: ADMIN ROLES MANAGEMENT (Super Admin only)
  // ------------------------------------------------------------------
  router.get('/roles', requireRoles('super_admin'), (_req, res) => {
    const staff = db
      .prepare(`
        SELECT u.id, u.email, u.role, u.admin_role, u.is_verified, u.created_at,
               p.username, p.display_name, p.avatar_url,
               CASE WHEN u.pin_hash IS NOT NULL THEN 1 ELSE 0 END as has_pin
        FROM users u
        LEFT JOIN profiles p ON p.id = u.id
        WHERE LOWER(u.email) = ? OR u.admin_role IN ('super_admin', 'moderator', 'support')
        ORDER BY CASE WHEN LOWER(u.email) = ? THEN 0 WHEN u.admin_role = 'moderator' THEN 1 ELSE 2 END, u.updated_at DESC
      `)
      .all(SUPER_ADMIN_EMAIL, SUPER_ADMIN_EMAIL) as any[];

    return res.json({
      staff: staff.map((s) => ({
        ...s,
        admin_role: resolveEffectiveAdminRole(s),
        has_pin: Boolean(s.has_pin),
      })),
    });
  });

  router.post('/roles', requireRoles('super_admin'), async (req, res) => {
    try {
      const adminId = (req as any).adminUserId as string;
      const idToken = (req as any).firebaseIdToken as string | null;
      const { userId, identifier, role } = req.body || {};

      if (!['none', 'moderator', 'support'].includes(String(role))) {
        return res.status(400).json({ error: 'Role must be "moderator", "support", or "none" (remove).' });
      }

      let target: DbUserRow | undefined;
      if (userId) {
        target = findUserById(String(userId));
      } else if (identifier) {
        const clean = String(identifier).trim().toLowerCase().replace(/^@/, '');
        target = findUserByEmail(clean);
        if (!target) {
          const prof = db
            .prepare('SELECT id FROM profiles WHERE LOWER(username) = ? LIMIT 1')
            .get(clean) as { id: string } | undefined;
          if (prof) target = findUserById(prof.id);
        }
      }

      if (!target) {
        return res.status(404).json({ error: 'User not found. Make sure they have signed in at least once.' });
      }
      if (String(target.email || '').trim().toLowerCase() === SUPER_ADMIN_EMAIL) {
        return res.status(403).json({ error: 'Cannot change or remove the Super Admin role.' });
      }

      const nextAdminRole = role as AdminPanelRole;
      const nextLegacyRole = nextAdminRole === 'moderator' ? 'moderator' : 'user';
      const nowIso = new Date().toISOString();

      db.prepare('UPDATE users SET admin_role = ?, role = ?, updated_at = ? WHERE id = ?').run(
        nextAdminRole,
        nextLegacyRole,
        nowIso,
        target.id
      );

      if (nextAdminRole === 'none') {
        db.prepare('DELETE FROM admin_sessions WHERE user_id = ?').run(target.id);
        await fsRestDeleteDoc(idToken, `admins/${target.id}`);
      } else {
        await fsRestSetOrPatchDoc(idToken, `admins/${target.id}`, {
          uid: target.id,
          email: target.email,
          role: nextAdminRole,
          assignedBy: adminId,
          updatedAt: nowIso,
        });
      }

      writeAuditLog({
        adminId,
        targetUserId: target.id,
        action: nextAdminRole === 'none' ? 'admin_role_removed' : 'admin_role_assigned',
        reason:
          nextAdminRole === 'none'
            ? `Removed admin access from ${target.email}`
            : `Assigned role "${nextAdminRole}" to ${target.email}`,
        details: { nextAdminRole },
      });

      return res.json({ success: true, userId: target.id, adminRole: nextAdminRole });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to update admin role' });
    }
  });

  // ------------------------------------------------------------------
  // FEATURE 15: SUPPORT TICKETS (Super Admin & Support)
  // ------------------------------------------------------------------
  router.get('/tickets', requireRoles('super_admin', 'support'), (req, res) => {
    try {
      const statusFilter = String(req.query.status || 'all').trim().toLowerCase();
      const rows = db
        .prepare(`
          SELECT t.*, p.avatar_url, p.username as live_username, p.display_name as live_display_name, u.is_verified
          FROM support_tickets t
          LEFT JOIN profiles p ON p.id = t.user_id
          LEFT JOIN users u ON u.id = t.user_id
          ORDER BY CASE WHEN t.status = 'open' THEN 0 ELSE 1 END, t.updated_at DESC
          LIMIT 300
        `)
        .all() as any[];

      const tickets = rows
        .filter((t) => statusFilter === 'all' || t.status === statusFilter)
        .map((t) => {
          const replies = db
            .prepare('SELECT * FROM support_ticket_replies WHERE ticket_id = ? ORDER BY created_at ASC')
            .all(t.id);
          return {
            ...t,
            username: t.live_username || t.username || 'user',
            display_name: t.live_display_name || t.display_name || t.user_email || 'User',
            is_verified: Boolean(t.is_verified),
            replies,
          };
        });

      return res.json({ tickets });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to load support tickets' });
    }
  });

  router.post('/tickets/:ticketId/reply', requireRoles('super_admin', 'support'), async (req, res) => {
    try {
      const adminRow = (req as any).adminUserRow as DbUserRow;
      const adminRole = (req as any).adminRole as AdminPanelRole;
      const idToken = (req as any).firebaseIdToken as string | null;
      const { ticketId } = req.params;
      const { message, closeTicket } = req.body || {};

      const ticket = db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(ticketId) as any;
      if (!ticket) return res.status(404).json({ error: 'Support ticket not found' });

      const cleanMsg = String(message || '').trim().slice(0, 2000);
      if (!cleanMsg) return res.status(400).json({ error: 'Reply message is required.' });

      const replyId = `trep_${generateId().replace(/-/g, '').slice(0, 18)}`;
      const nowIso = new Date().toISOString();
      const senderName = adminRole === 'super_admin' ? 'LiveConnect Admin' : 'LiveConnect Support';

      db.prepare(
        'INSERT INTO support_ticket_replies (id, ticket_id, sender_id, sender_role, sender_name, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(replyId, ticketId, adminRow.id, 'admin', senderName, cleanMsg, nowIso);

      const nextStatus = closeTicket ? 'closed' : ticket.status;
      db.prepare('UPDATE support_tickets SET status = ?, updated_at = ? WHERE id = ?').run(
        nextStatus,
        nowIso,
        ticketId
      );

      // Notify user in-app about support reply
      db.prepare(`
        INSERT INTO notifications (id, user_id, actor_id, type, title, message, reference_id, actor_json, is_read, created_at)
        VALUES (?, ?, ?, 'support_reply', ?, ?, ?, ?, 0, ?)
      `).run(
        `notif_sup_${generateId().replace(/-/g, '').slice(0, 16)}`,
        ticket.user_id,
        adminRow.id,
        `Support Reply: ${ticket.subject}`,
        cleanMsg.slice(0, 500),
        ticketId,
        JSON.stringify({ id: adminRow.id, username: 'support', display_name: senderName, avatar_url: null }),
        nowIso
      );

      await fsRestSetOrPatchDoc(
        idToken,
        `support_tickets/${ticketId}/replies/${replyId}`,
        {
          id: replyId,
          ticketId,
          senderId: adminRow.id,
          senderRole: 'admin',
          senderName,
          message: cleanMsg,
          createdAt: nowIso,
        }
      );

      writeAuditLog({
        adminId: adminRow.id,
        targetUserId: ticket.user_id,
        action: 'support_ticket_reply',
        reason: `Replied to support ticket "${ticket.subject}"`,
        details: { ticketId, closed: Boolean(closeTicket) },
      });

      const replies = db
        .prepare('SELECT * FROM support_ticket_replies WHERE ticket_id = ? ORDER BY created_at ASC')
        .all(ticketId);

      return res.json({
        success: true,
        ticket: { ...db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(ticketId), replies },
      });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to reply to ticket' });
    }
  });

  router.patch('/tickets/:ticketId/status', requireRoles('super_admin', 'support'), async (req, res) => {
    try {
      const adminId = (req as any).adminUserId as string;
      const idToken = (req as any).firebaseIdToken as string | null;
      const { ticketId } = req.params;
      const { status } = req.body || {};

      if (status !== 'open' && status !== 'closed') {
        return res.status(400).json({ error: 'status must be open or closed' });
      }

      const ticket = db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(ticketId) as any;
      if (!ticket) return res.status(404).json({ error: 'Support ticket not found' });

      const nowIso = new Date().toISOString();
      db.prepare('UPDATE support_tickets SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso, ticketId);
      await fsRestSetOrPatchDoc(
        idToken,
        `support_tickets/${ticketId}`,
        { status, updatedAt: nowIso },
        { updateMask: ['status', 'updatedAt'] }
      );

      writeAuditLog({
        adminId,
        targetUserId: ticket.user_id,
        action: status === 'closed' ? 'support_ticket_closed' : 'support_ticket_reopened',
        reason: `Marked ticket "${ticket.subject}" as ${status}`,
        details: { ticketId },
      });

      return res.json({ success: true, status });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to update ticket status' });
    }
  });

  return router;
}
