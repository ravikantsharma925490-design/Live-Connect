import { DatabaseSync } from 'node:sqlite';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'liveconnect.db');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

export const db = new DatabaseSync(DB_PATH);

// Enable WAL mode & foreign-key safety
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA busy_timeout = 5000;
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    email_confirmed INTEGER DEFAULT 0,
    phone TEXT,
    user_metadata TEXT,
    banned_until TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    avatar_url TEXT,
    bio TEXT,
    gender TEXT,
    country TEXT,
    email TEXT,
    phone_number TEXT,
    cloudinary_public_id TEXT,
    b2_file_id TEXT,
    b2_file_name TEXT,
    is_online INTEGER DEFAULT 0,
    last_seen TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username);

  CREATE TABLE IF NOT EXISTS user_otps (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    otp_code TEXT NOT NULL,
    type TEXT DEFAULT 'signup',
    verified INTEGER DEFAULT 0,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_user_otps_email ON user_otps(email);

  CREATE TABLE IF NOT EXISTS follows (
    follower_id TEXT NOT NULL,
    following_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (follower_id, following_id)
  );
  CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id);
  CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);

  CREATE TABLE IF NOT EXISTS blocked_users (
    blocker_id TEXT NOT NULL,
    blocked_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (blocker_id, blocked_id)
  );
  CREATE INDEX IF NOT EXISTS idx_blocked_blocker ON blocked_users(blocker_id);
  CREATE INDEX IF NOT EXISTS idx_blocked_blocked ON blocked_users(blocked_id);

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    name TEXT,
    description TEXT,
    avatar_url TEXT,
    owner_id TEXT,
    pinned_message_id TEXT,
    removed_members_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT DEFAULT 'member',
    joined_at TEXT NOT NULL,
    PRIMARY KEY (conversation_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_conv_members_user ON conversation_members(user_id);

  CREATE TABLE IF NOT EXISTS deleted_conversations (
    user_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    deleted_at TEXT NOT NULL,
    PRIMARY KEY (user_id, conversation_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    content TEXT NOT NULL,
    reply_to_message_id TEXT,
    reactions_json TEXT,
    mentions_json TEXT,
    media_type TEXT,
    cloudinary_public_id TEXT,
    b2_file_id TEXT,
    b2_file_name TEXT,
    is_read INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);

  CREATE TABLE IF NOT EXISTS message_reads (
    message_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    read_at TEXT NOT NULL,
    PRIMARY KEY (message_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_msg_reads_msg ON message_reads(message_id);

  CREATE TABLE IF NOT EXISTS deleted_messages (
    message_id TEXT PRIMARY KEY,
    deleted_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS calls (
    id TEXT PRIMARY KEY,
    caller_id TEXT NOT NULL,
    callee_id TEXT NOT NULL,
    call_type TEXT NOT NULL,
    status TEXT NOT NULL,
    room_name TEXT,
    caller_device_id TEXT,
    callee_device_id TEXT,
    started_at TEXT NOT NULL,
    answered_at TEXT,
    ended_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_calls_caller ON calls(caller_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_calls_callee ON calls(callee_id, created_at);

  CREATE TABLE IF NOT EXISTS deleted_calls (
    user_id TEXT NOT NULL,
    call_id TEXT NOT NULL,
    deleted_at TEXT NOT NULL,
    PRIMARY KEY (user_id, call_id)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    actor_id TEXT,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    reference_id TEXT,
    actor_json TEXT,
    is_read INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at);

  CREATE TABLE IF NOT EXISTS problem_reports (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT DEFAULT 'submitted',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_reports (
    id TEXT PRIMARY KEY,
    reporter_id TEXT NOT NULL,
    reported_user_id TEXT NOT NULL,
    reported_username TEXT,
    reported_display_name TEXT,
    category TEXT NOT NULL,
    details TEXT,
    source TEXT NOT NULL DEFAULT 'profile',
    conversation_id TEXT,
    also_blocked INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    admin_id TEXT,
    admin_note TEXT,
    reviewed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_user_reports_reporter ON user_reports(reporter_id);
  CREATE INDEX IF NOT EXISTS idx_user_reports_reported ON user_reports(reported_user_id);
  CREATE INDEX IF NOT EXISTS idx_user_reports_status ON user_reports(status, created_at);

  CREATE TABLE IF NOT EXISTS media_files (
    id TEXT PRIMARY KEY,
    mime_type TEXT NOT NULL,
    file_name TEXT,
    size INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    mp3_path TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bans (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    admin_id TEXT,
    action_type TEXT NOT NULL,
    status_applied TEXT NOT NULL,
    reason TEXT NOT NULL,
    rule_broken TEXT NOT NULL,
    severity TEXT NOT NULL,
    strike_number INTEGER NOT NULL DEFAULT 0,
    duration_days INTEGER,
    ban_until TEXT,
    scheduled_deletion_at TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_bans_user ON bans(user_id);
  CREATE INDEX IF NOT EXISTS idx_bans_status ON bans(status_applied, is_active);

  CREATE TABLE IF NOT EXISTS appeals (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    ban_id TEXT,
    reason TEXT NOT NULL,
    verification_doc_url TEXT,
    verification_doc_name TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    admin_id TEXT,
    admin_note TEXT,
    decision_due_at TEXT NOT NULL,
    reviewed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_appeals_user ON appeals(user_id);
  CREATE INDEX IF NOT EXISTS idx_appeals_status ON appeals(status);

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL,
    target_user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    reason TEXT NOT NULL,
    details_json TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_logs(target_user_id);
  CREATE INDEX IF NOT EXISTS idx_audit_admin ON audit_logs(admin_id);

  CREATE TABLE IF NOT EXISTS banned_identifiers (
    id TEXT PRIMARY KEY,
    identifier_type TEXT NOT NULL,
    identifier_value TEXT NOT NULL,
    user_id TEXT NOT NULL,
    ban_id TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(identifier_type, identifier_value)
  );
  CREATE INDEX IF NOT EXISTS idx_banned_id_lookup ON banned_identifiers(identifier_type, identifier_value);
`);

// Safe idempotent column migrations for existing SQLite databases
function ensureColumn(tableName: string, columnName: string, definition: string) {
  const cols = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

ensureColumn('users', 'status', "TEXT NOT NULL DEFAULT 'active'");
ensureColumn('users', 'strike_count', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'ban_reason', 'TEXT');
ensureColumn('users', 'rule_broken', 'TEXT');
ensureColumn('users', 'ban_until', 'TEXT');
ensureColumn('users', 'restricted_until', 'TEXT');
ensureColumn('users', 'scheduled_deletion_at', 'TEXT');
ensureColumn('users', 'restored_at', 'TEXT');
ensureColumn('users', 'restored_notice_pending', 'INTEGER DEFAULT 0');
ensureColumn('users', 'role', "TEXT NOT NULL DEFAULT 'user'");
ensureColumn('users', 'last_device_id', 'TEXT');

ensureColumn('sessions', 'token_scope', "TEXT NOT NULL DEFAULT 'full'");
ensureColumn('sessions', 'device_id', 'TEXT');

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
  CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
  UPDATE users SET status = 'suspended', ban_until = COALESCE(ban_until, banned_until)
    WHERE banned_until IS NOT NULL AND banned_until != '' AND status = 'active';
  UPDATE users SET role = 'admin' WHERE LOWER(email) = 'ravikantsharma925490@gmail.com';
`);

export interface DbUserRow {
  id: string;
  email: string;
  password_hash: string | null;
  email_confirmed: number;
  phone: string | null;
  user_metadata: string | null;
  banned_until: string | null;
  status: string;
  strike_count: number;
  ban_reason: string | null;
  rule_broken: string | null;
  ban_until: string | null;
  restricted_until: string | null;
  scheduled_deletion_at: string | null;
  restored_at: string | null;
  restored_notice_pending: number;
  role: string;
  last_device_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbProfileRow {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  gender: string | null;
  country: string | null;
  email: string | null;
  phone_number: string | null;
  cloudinary_public_id: string | null;
  b2_file_id: string | null;
  b2_file_name: string | null;
  is_online: number;
  last_seen: string;
  created_at: string;
  updated_at: string;
}

export function generateId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString('hex');
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string | null | undefined): boolean {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  try {
    const keyBuf = Buffer.from(keyHex, 'hex');
    const derivedBuf = crypto.scryptSync(password, salt, 64);
    if (keyBuf.length !== derivedBuf.length) return false;
    return crypto.timingSafeEqual(keyBuf, derivedBuf);
  } catch {
    return false;
  }
}

export function isAccountHiddenStatus(status?: string | null): boolean {
  return status === 'suspended' || status === 'disabled' || status === 'deactivated';
}

export function formatAuthUser(row: DbUserRow) {
  let metadata: Record<string, any> = {};
  if (row.user_metadata) {
    try {
      metadata = JSON.parse(row.user_metadata);
    } catch {
      metadata = {};
    }
  }
  return {
    id: row.id,
    email: row.email,
    phone: row.phone || undefined,
    email_confirmed: Boolean(row.email_confirmed),
    user_metadata: metadata,
    status: (row.status || 'active') as 'active' | 'restricted' | 'suspended' | 'disabled' | 'deactivated',
    strike_count: Number(row.strike_count || 0),
    ban_reason: row.ban_reason || null,
    rule_broken: row.rule_broken || null,
    banned_until: row.ban_until || row.banned_until || null,
    ban_until: row.ban_until || row.banned_until || null,
    restricted_until: row.restricted_until || null,
    scheduled_deletion_at: row.scheduled_deletion_at || null,
    restored_at: row.restored_at || null,
    restored_notice_pending: Boolean(row.restored_notice_pending),
    role: (row.role || 'user') as 'user' | 'moderator' | 'admin',
    created_at: row.created_at,
  };
}

export function formatProfile(row: DbProfileRow | undefined | null) {
  if (!row) return null;
  const userRow = db
    .prepare('SELECT status, strike_count, role FROM users WHERE id = ? LIMIT 1')
    .get(row.id) as { status?: string; strike_count?: number; role?: string } | undefined;

  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    avatar_url: row.avatar_url || null,
    bio: row.bio ?? 'Hey there! I am using LiveConnect.',
    gender: row.gender || null,
    country: row.country || null,
    email: row.email || undefined,
    phone_number: row.phone_number || undefined,
    cloudinary_public_id: row.cloudinary_public_id || undefined,
    b2_file_id: row.b2_file_id || undefined,
    b2_file_name: row.b2_file_name || undefined,
    status: (userRow?.status || 'active') as 'active' | 'restricted' | 'suspended' | 'disabled' | 'deactivated',
    strike_count: Number(userRow?.strike_count || 0),
    role: (userRow?.role || 'user') as 'user' | 'moderator' | 'admin',
    is_online: isAccountHiddenStatus(userRow?.status) ? false : Boolean(row.is_online),
    last_seen: row.last_seen,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ---------- User & Session Helpers ----------

export function createSessionForUser(
  userId: string,
  ttlDays = 30,
  tokenScope: 'full' | 'appeal_only' = 'full',
  deviceId?: string | null
) {
  const token = `lc_${crypto.randomBytes(32).toString('hex')}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(
    'INSERT INTO sessions (token, user_id, expires_at, created_at, token_scope, device_id) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(token, userId, expiresAt, now.toISOString(), tokenScope, deviceId || null);

  if (deviceId) {
    db.prepare('UPDATE users SET last_device_id = ? WHERE id = ?').run(deviceId, userId);
  }

  return {
    access_token: token,
    expires_at: expiresAt,
    token_scope: tokenScope,
    user_id: userId,
  };
}

export function revokeAllSessionsForUser(userId: string) {
  if (!userId) return;
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function getUserBySessionToken(token: string) {
  if (!token) return null;
  const sess = db
    .prepare('SELECT token, user_id, expires_at, token_scope FROM sessions WHERE token = ?')
    .get(token) as { token: string; user_id: string; expires_at: string; token_scope?: string } | undefined;
  if (!sess) return null;
  if (new Date(sess.expires_at).getTime() <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(sess.user_id) as unknown as
    | DbUserRow
    | undefined;
  if (!userRow) return null;
  return {
    session: {
      access_token: sess.token,
      expires_at: sess.expires_at,
      token_scope: (sess.token_scope || 'full') as 'full' | 'appeal_only',
    },
    userRow,
    user: formatAuthUser(userRow),
  };
}

export function deleteSessionToken(token: string) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function recordBannedIdentifiers(
  userId: string,
  banId: string | null,
  identifiers: { email?: string | null; phone?: string | null; deviceId?: string | null }
) {
  const nowIso = new Date().toISOString();
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO banned_identifiers (id, identifier_type, identifier_value, user_id, ban_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  if (identifiers.email && identifiers.email.trim()) {
    stmt.run(generateId(), 'email', identifiers.email.trim().toLowerCase(), userId, banId, nowIso);
  }
  if (identifiers.phone && identifiers.phone.trim()) {
    const cleanPhone = identifiers.phone.replace(/\s+/g, '').trim();
    if (cleanPhone) stmt.run(generateId(), 'phone', cleanPhone, userId, banId, nowIso);
  }
  if (identifiers.deviceId && identifiers.deviceId.trim()) {
    stmt.run(generateId(), 'device', identifiers.deviceId.trim(), userId, banId, nowIso);
  }
}

export function clearBannedIdentifiersForUser(userId: string) {
  db.prepare('DELETE FROM banned_identifiers WHERE user_id = ?').run(userId);
}

export function findPermanentBanByIdentifier(identifiers: {
  email?: string | null;
  phone?: string | null;
  deviceId?: string | null;
}) {
  if (identifiers.email && identifiers.email.trim()) {
    const row = db
      .prepare("SELECT * FROM banned_identifiers WHERE identifier_type = 'email' AND identifier_value = ? LIMIT 1")
      .get(identifiers.email.trim().toLowerCase()) as any;
    if (row) return { type: 'email', ...row };
  }
  if (identifiers.phone && identifiers.phone.trim()) {
    const cleanPhone = identifiers.phone.replace(/\s+/g, '').trim();
    if (cleanPhone) {
      const row = db
        .prepare("SELECT * FROM banned_identifiers WHERE identifier_type = 'phone' AND identifier_value = ? LIMIT 1")
        .get(cleanPhone) as any;
      if (row) return { type: 'phone', ...row };
    }
  }
  if (identifiers.deviceId && identifiers.deviceId.trim()) {
    const row = db
      .prepare("SELECT * FROM banned_identifiers WHERE identifier_type = 'device' AND identifier_value = ? LIMIT 1")
      .get(identifiers.deviceId.trim()) as any;
    if (row) return { type: 'device', ...row };
  }
  return null;
}

export function findUserByEmail(email: string): DbUserRow | undefined {
  return db
    .prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1')
    .get(email.trim()) as unknown as DbUserRow | undefined;
}

export function findUserById(userId: string): DbUserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ? LIMIT 1').get(userId) as unknown as
    | DbUserRow
    | undefined;
}

export function getProfileById(userId: string) {
  const row = db.prepare('SELECT * FROM profiles WHERE id = ? LIMIT 1').get(userId) as unknown as
    | DbProfileRow
    | undefined;
  return formatProfile(row);
}

export function getProfileByUsername(username: string) {
  const row = db
    .prepare('SELECT * FROM profiles WHERE LOWER(username) = LOWER(?) LIMIT 1')
    .get(username.trim()) as unknown as DbProfileRow | undefined;
  return formatProfile(row);
}

export function upsertProfile(data: {
  id: string;
  username: string;
  display_name: string;
  avatar_url?: string | null;
  bio?: string | null;
  gender?: string | null;
  country?: string | null;
  email?: string | null;
  phone_number?: string | null;
  cloudinary_public_id?: string | null;
  b2_file_id?: string | null;
  b2_file_name?: string | null;
  is_online?: boolean;
  last_seen?: string;
}) {
  const existing = db.prepare('SELECT * FROM profiles WHERE id = ?').get(data.id) as unknown as
    | DbProfileRow
    | undefined;
  const nowIso = new Date().toISOString();
  const cleanUsername = String(data.username || existing?.username || `user_${data.id.slice(0, 6)}`)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');

  if (existing) {
    db.prepare(`
      UPDATE profiles SET
        username = ?,
        display_name = ?,
        avatar_url = ?,
        bio = ?,
        gender = ?,
        country = ?,
        email = ?,
        phone_number = ?,
        cloudinary_public_id = ?,
        b2_file_id = ?,
        b2_file_name = ?,
        is_online = ?,
        last_seen = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      cleanUsername,
      data.display_name ?? existing.display_name,
      data.avatar_url !== undefined ? data.avatar_url : existing.avatar_url,
      data.bio !== undefined ? data.bio : existing.bio,
      data.gender !== undefined ? data.gender : existing.gender,
      data.country !== undefined ? data.country : existing.country,
      data.email !== undefined ? data.email : existing.email,
      data.phone_number !== undefined ? data.phone_number : existing.phone_number,
      data.cloudinary_public_id !== undefined
        ? data.cloudinary_public_id
        : existing.cloudinary_public_id,
      data.b2_file_id !== undefined ? data.b2_file_id : existing.b2_file_id,
      data.b2_file_name !== undefined ? data.b2_file_name : existing.b2_file_name,
      data.is_online !== undefined ? (data.is_online ? 1 : 0) : existing.is_online,
      data.last_seen || nowIso,
      nowIso,
      data.id
    );
  } else {
    db.prepare(`
      INSERT INTO profiles (
        id, username, display_name, avatar_url, bio, gender, country,
        email, phone_number, cloudinary_public_id, b2_file_id, b2_file_name,
        is_online, last_seen, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.id,
      cleanUsername,
      data.display_name || cleanUsername,
      data.avatar_url ?? null,
      data.bio ?? 'Hey there! I am using LiveConnect.',
      data.gender ?? null,
      data.country ?? 'India',
      data.email ?? null,
      data.phone_number ?? null,
      data.cloudinary_public_id ?? null,
      data.b2_file_id ?? null,
      data.b2_file_name ?? null,
      data.is_online ? 1 : 0,
      data.last_seen || nowIso,
      nowIso,
      nowIso
    );
  }
  return getProfileById(data.id)!;
}

export function deleteAccountCompletely(userId: string, preserveBannedIdentifiers = false) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM follows WHERE follower_id = ? OR following_id = ?').run(userId, userId);
  db.prepare('DELETE FROM blocked_users WHERE blocker_id = ? OR blocked_id = ?').run(userId, userId);
  db.prepare('DELETE FROM notifications WHERE user_id = ? OR actor_id = ?').run(userId, userId);
  db.prepare('DELETE FROM calls WHERE caller_id = ? OR callee_id = ?').run(userId, userId);
  db.prepare('DELETE FROM deleted_calls WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM message_reads WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM conversation_members WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM deleted_conversations WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM messages WHERE sender_id = ?').run(userId);
  db.prepare('DELETE FROM appeals WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM bans WHERE user_id = ?').run(userId);
  if (!preserveBannedIdentifiers) {
    db.prepare('DELETE FROM banned_identifiers WHERE user_id = ?').run(userId);
  }
  db.prepare('DELETE FROM profiles WHERE id = ?').run(userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
}
