var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// server.ts
var server_exports = {};
__export(server_exports, {
  default: () => server_default
});
module.exports = __toCommonJS(server_exports);
var import_express2 = __toESM(require("express"), 1);
var import_dotenv = __toESM(require("dotenv"), 1);
var import_path3 = __toESM(require("path"), 1);
var import_vite = require("vite");
var import_fs3 = __toESM(require("fs"), 1);
var import_child_process = require("child_process");
var import_nodemailer2 = __toESM(require("nodemailer"), 1);
var import_dns2 = __toESM(require("dns"), 1);
var import_genai = require("@google/genai");

// server/db.ts
var import_node_sqlite = require("node:sqlite");
var import_crypto = __toESM(require("crypto"), 1);
var import_fs = __toESM(require("fs"), 1);
var import_path = __toESM(require("path"), 1);
var DATA_DIR = import_path.default.join(process.cwd(), "data");
var DB_PATH = import_path.default.join(DATA_DIR, "liveconnect.db");
var UPLOADS_DIR = import_path.default.join(DATA_DIR, "uploads");
if (!import_fs.default.existsSync(DATA_DIR)) {
  import_fs.default.mkdirSync(DATA_DIR, { recursive: true });
}
if (!import_fs.default.existsSync(UPLOADS_DIR)) {
  import_fs.default.mkdirSync(UPLOADS_DIR, { recursive: true });
}
var db = new import_node_sqlite.DatabaseSync(DB_PATH);
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

  -- ==========================================
  -- FAMILY GROUP TABLES
  -- ==========================================
  CREATE TABLE IF NOT EXISTS families (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    photo_url TEXT,
    owner_id TEXT NOT NULL,
    member_count INTEGER NOT NULL DEFAULT 1,
    max_members INTEGER NOT NULL DEFAULT 5000,
    join_approval_required INTEGER NOT NULL DEFAULT 1,
    only_admins_can_send INTEGER NOT NULL DEFAULT 0,
    invite_code TEXT,
    invite_link_enabled INTEGER NOT NULL DEFAULT 1,
    pinned_messages_json TEXT NOT NULL DEFAULT '[]',
    last_message_id TEXT,
    last_message_text TEXT,
    last_message_sender_id TEXT,
    last_message_sender_name TEXT,
    last_message_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_families_invite_code ON families(invite_code);

  CREATE TABLE IF NOT EXISTS family_members (
    family_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    status TEXT NOT NULL DEFAULT 'active',
    relation_tag TEXT,
    display_name TEXT NOT NULL DEFAULT '',
    username TEXT NOT NULL DEFAULT '',
    avatar_url TEXT,
    muted_until TEXT,
    is_muted_always INTEGER NOT NULL DEFAULT 0,
    last_read_at TEXT,
    cleared_at TEXT,
    joined_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    removed_at TEXT,
    removed_by TEXT,
    PRIMARY KEY (family_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_family_members_family_status ON family_members(family_id, status, display_name);
  CREATE INDEX IF NOT EXISTS idx_family_members_user_status ON family_members(user_id, status, updated_at);

  CREATE TABLE IF NOT EXISTS family_requests (
    family_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    username TEXT NOT NULL DEFAULT '',
    avatar_url TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    invite_code TEXT,
    created_at TEXT NOT NULL,
    reviewed_at TEXT,
    reviewed_by TEXT,
    PRIMARY KEY (family_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_family_requests_family_status ON family_requests(family_id, status, created_at);

  CREATE TABLE IF NOT EXISTS family_invites (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL,
    family_name TEXT NOT NULL,
    family_photo_url TEXT,
    inviter_id TEXT NOT NULL,
    inviter_name TEXT NOT NULL,
    invitee_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    responded_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_family_invites_invitee ON family_invites(invitee_id, status, created_at);
  CREATE INDEX IF NOT EXISTS idx_family_invites_family ON family_invites(family_id, status);

  CREATE TABLE IF NOT EXISTS family_invite_daily_limits (
    user_id TEXT NOT NULL,
    day_key TEXT NOT NULL,
    invite_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day_key)
  );

  CREATE TABLE IF NOT EXISTS family_messages (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    sender_username TEXT,
    sender_avatar TEXT,
    sender_role TEXT,
    sender_relation_tag TEXT,
    type TEXT NOT NULL DEFAULT 'text',
    content TEXT NOT NULL,
    media_url TEXT,
    media_type TEXT,
    cloudinary_public_id TEXT,
    b2_file_id TEXT,
    b2_file_name TEXT,
    reply_to_message_id TEXT,
    reply_to_json TEXT,
    mentions_json TEXT NOT NULL DEFAULT '[]',
    reactions_json TEXT NOT NULL DEFAULT '{}',
    is_pinned INTEGER NOT NULL DEFAULT 0,
    is_deleted INTEGER NOT NULL DEFAULT 0,
    deleted_by TEXT,
    deleted_by_role TEXT,
    safe_checkin_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_family_messages_family_created ON family_messages(family_id, created_at);

  CREATE TABLE IF NOT EXISTS family_message_reads (
    message_id TEXT NOT NULL,
    family_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    display_name TEXT,
    read_at TEXT NOT NULL,
    PRIMARY KEY (message_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_family_reads_family_msg ON family_message_reads(family_id, message_id);

  CREATE TABLE IF NOT EXISTS family_typing_status (
    family_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (family_id, user_id)
  );
`);
function ensureColumn(tableName, columnName, definition) {
  const cols = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!cols.some((c) => c.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}
ensureColumn("users", "status", "TEXT NOT NULL DEFAULT 'active'");
ensureColumn("users", "strike_count", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("users", "ban_reason", "TEXT");
ensureColumn("users", "rule_broken", "TEXT");
ensureColumn("users", "ban_until", "TEXT");
ensureColumn("users", "restricted_until", "TEXT");
ensureColumn("users", "scheduled_deletion_at", "TEXT");
ensureColumn("users", "restored_at", "TEXT");
ensureColumn("users", "restored_notice_pending", "INTEGER DEFAULT 0");
ensureColumn("users", "role", "TEXT NOT NULL DEFAULT 'user'");
ensureColumn("users", "last_device_id", "TEXT");
ensureColumn("sessions", "token_scope", "TEXT NOT NULL DEFAULT 'full'");
ensureColumn("sessions", "device_id", "TEXT");
ensureColumn("user_reports", "family_id", "TEXT");
ensureColumn("user_reports", "family_name", "TEXT");
ensureColumn("user_reports", "reported_message_id", "TEXT");
ensureColumn("user_reports", "reported_message_content", "TEXT");
ensureColumn("user_reports", "reported_message_media_url", "TEXT");
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
  CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
  UPDATE users SET status = 'suspended', ban_until = COALESCE(ban_until, banned_until)
    WHERE banned_until IS NOT NULL AND banned_until != '' AND status = 'active';
  UPDATE users SET role = 'admin' WHERE LOWER(email) = 'ravikantsharma925490@gmail.com';
`);
function generateId() {
  if (typeof import_crypto.default.randomUUID === "function") {
    return import_crypto.default.randomUUID();
  }
  return import_crypto.default.randomBytes(16).toString("hex");
}
function hashPassword(password) {
  const salt = import_crypto.default.randomBytes(16).toString("hex");
  const derived = import_crypto.default.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}
function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(":")) return false;
  const [salt, keyHex] = storedHash.split(":");
  if (!salt || !keyHex) return false;
  try {
    const keyBuf = Buffer.from(keyHex, "hex");
    const derivedBuf = import_crypto.default.scryptSync(password, salt, 64);
    if (keyBuf.length !== derivedBuf.length) return false;
    return import_crypto.default.timingSafeEqual(keyBuf, derivedBuf);
  } catch {
    return false;
  }
}
function isAccountHiddenStatus(status) {
  return status === "suspended" || status === "disabled" || status === "deactivated";
}
function formatAuthUser(row) {
  let metadata = {};
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
    phone: row.phone || void 0,
    email_confirmed: Boolean(row.email_confirmed),
    user_metadata: metadata,
    status: row.status || "active",
    strike_count: Number(row.strike_count || 0),
    ban_reason: row.ban_reason || null,
    rule_broken: row.rule_broken || null,
    banned_until: row.ban_until || row.banned_until || null,
    ban_until: row.ban_until || row.banned_until || null,
    restricted_until: row.restricted_until || null,
    scheduled_deletion_at: row.scheduled_deletion_at || null,
    restored_at: row.restored_at || null,
    restored_notice_pending: Boolean(row.restored_notice_pending),
    role: row.role || "user",
    created_at: row.created_at
  };
}
function formatProfile(row) {
  if (!row) return null;
  const userRow = db.prepare("SELECT status, strike_count, role FROM users WHERE id = ? LIMIT 1").get(row.id);
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    avatar_url: row.avatar_url || null,
    bio: row.bio ?? "Hey there! I am using LiveConnect.",
    gender: row.gender || null,
    country: row.country || null,
    email: row.email || void 0,
    phone_number: row.phone_number || void 0,
    cloudinary_public_id: row.cloudinary_public_id || void 0,
    b2_file_id: row.b2_file_id || void 0,
    b2_file_name: row.b2_file_name || void 0,
    status: userRow?.status || "active",
    strike_count: Number(userRow?.strike_count || 0),
    role: userRow?.role || "user",
    is_online: isAccountHiddenStatus(userRow?.status) ? false : Boolean(row.is_online),
    last_seen: row.last_seen,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}
function createSessionForUser(userId, ttlDays = 30, tokenScope = "full", deviceId) {
  const token = `lc_${import_crypto.default.randomBytes(32).toString("hex")}`;
  const now = /* @__PURE__ */ new Date();
  const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1e3).toISOString();
  db.prepare(
    "INSERT INTO sessions (token, user_id, expires_at, created_at, token_scope, device_id) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(token, userId, expiresAt, now.toISOString(), tokenScope, deviceId || null);
  if (deviceId) {
    db.prepare("UPDATE users SET last_device_id = ? WHERE id = ?").run(deviceId, userId);
  }
  return {
    access_token: token,
    expires_at: expiresAt,
    token_scope: tokenScope,
    user_id: userId
  };
}
function revokeAllSessionsForUser(userId) {
  if (!userId) return;
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}
function getUserBySessionToken(token) {
  if (!token) return null;
  const sess = db.prepare("SELECT token, user_id, expires_at, token_scope FROM sessions WHERE token = ?").get(token);
  if (!sess) return null;
  if (new Date(sess.expires_at).getTime() <= Date.now()) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return null;
  }
  const userRow = db.prepare("SELECT * FROM users WHERE id = ?").get(sess.user_id);
  if (!userRow) return null;
  return {
    session: {
      access_token: sess.token,
      expires_at: sess.expires_at,
      token_scope: sess.token_scope || "full"
    },
    userRow,
    user: formatAuthUser(userRow)
  };
}
function deleteSessionToken(token) {
  if (!token) return;
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}
function recordBannedIdentifiers(userId, banId, identifiers) {
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO banned_identifiers (id, identifier_type, identifier_value, user_id, ban_id, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  );
  if (identifiers.email && identifiers.email.trim()) {
    stmt.run(generateId(), "email", identifiers.email.trim().toLowerCase(), userId, banId, nowIso);
  }
  if (identifiers.phone && identifiers.phone.trim()) {
    const cleanPhone = identifiers.phone.replace(/\s+/g, "").trim();
    if (cleanPhone) stmt.run(generateId(), "phone", cleanPhone, userId, banId, nowIso);
  }
  if (identifiers.deviceId && identifiers.deviceId.trim()) {
    stmt.run(generateId(), "device", identifiers.deviceId.trim(), userId, banId, nowIso);
  }
}
function clearBannedIdentifiersForUser(userId) {
  db.prepare("DELETE FROM banned_identifiers WHERE user_id = ?").run(userId);
}
function findPermanentBanByIdentifier(identifiers) {
  if (identifiers.email && identifiers.email.trim()) {
    const row = db.prepare("SELECT * FROM banned_identifiers WHERE identifier_type = 'email' AND identifier_value = ? LIMIT 1").get(identifiers.email.trim().toLowerCase());
    if (row) return { type: "email", ...row };
  }
  if (identifiers.phone && identifiers.phone.trim()) {
    const cleanPhone = identifiers.phone.replace(/\s+/g, "").trim();
    if (cleanPhone) {
      const row = db.prepare("SELECT * FROM banned_identifiers WHERE identifier_type = 'phone' AND identifier_value = ? LIMIT 1").get(cleanPhone);
      if (row) return { type: "phone", ...row };
    }
  }
  if (identifiers.deviceId && identifiers.deviceId.trim()) {
    const row = db.prepare("SELECT * FROM banned_identifiers WHERE identifier_type = 'device' AND identifier_value = ? LIMIT 1").get(identifiers.deviceId.trim());
    if (row) return { type: "device", ...row };
  }
  return null;
}
function findUserByEmail(email) {
  return db.prepare("SELECT * FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1").get(email.trim());
}
function findUserById(userId) {
  return db.prepare("SELECT * FROM users WHERE id = ? LIMIT 1").get(userId);
}
function getProfileById(userId) {
  const row = db.prepare("SELECT * FROM profiles WHERE id = ? LIMIT 1").get(userId);
  return formatProfile(row);
}
function getProfileByUsername(username) {
  const row = db.prepare("SELECT * FROM profiles WHERE LOWER(username) = LOWER(?) LIMIT 1").get(username.trim());
  return formatProfile(row);
}
function upsertProfile(data) {
  const existing = db.prepare("SELECT * FROM profiles WHERE id = ?").get(data.id);
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const cleanUsername = String(data.username || existing?.username || `user_${data.id.slice(0, 6)}`).trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
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
      data.avatar_url !== void 0 ? data.avatar_url : existing.avatar_url,
      data.bio !== void 0 ? data.bio : existing.bio,
      data.gender !== void 0 ? data.gender : existing.gender,
      data.country !== void 0 ? data.country : existing.country,
      data.email !== void 0 ? data.email : existing.email,
      data.phone_number !== void 0 ? data.phone_number : existing.phone_number,
      data.cloudinary_public_id !== void 0 ? data.cloudinary_public_id : existing.cloudinary_public_id,
      data.b2_file_id !== void 0 ? data.b2_file_id : existing.b2_file_id,
      data.b2_file_name !== void 0 ? data.b2_file_name : existing.b2_file_name,
      data.is_online !== void 0 ? data.is_online ? 1 : 0 : existing.is_online,
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
      data.bio ?? "Hey there! I am using LiveConnect.",
      data.gender ?? null,
      data.country ?? "India",
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
  return getProfileById(data.id);
}
function handleOwnerDepartureFromFamilies(userId) {
  const ownedFamilies = db.prepare("SELECT id, name, owner_id FROM families WHERE owner_id = ?").all(userId);
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  for (const fam of ownedFamilies) {
    let successor = db.prepare(
      `SELECT user_id, display_name, username FROM family_members
         WHERE family_id = ? AND status = 'active' AND role = 'admin' AND user_id != ?
         ORDER BY joined_at ASC LIMIT 1`
    ).get(fam.id, userId);
    if (!successor) {
      successor = db.prepare(
        `SELECT user_id, display_name, username FROM family_members
           WHERE family_id = ? AND status = 'active' AND role = 'member' AND user_id != ?
           ORDER BY joined_at ASC LIMIT 1`
      ).get(fam.id, userId);
    }
    if (successor) {
      db.prepare("UPDATE family_members SET role = 'owner', updated_at = ? WHERE family_id = ? AND user_id = ?").run(
        nowIso,
        fam.id,
        successor.user_id
      );
      db.prepare("UPDATE family_members SET status = 'left', role = 'member', updated_at = ? WHERE family_id = ? AND user_id = ?").run(
        nowIso,
        fam.id,
        userId
      );
      const countRow = db.prepare("SELECT COUNT(*) as cnt FROM family_members WHERE family_id = ? AND status = 'active'").get(fam.id);
      const sysMsgId = `fmsg_${generateId().replace(/-/g, "").slice(0, 20)}`;
      const successorName = successor.display_name || successor.username || "Member";
      const sysText = `Ownership transferred to ${successorName}`;
      db.prepare(`
        INSERT INTO family_messages (
          id, family_id, sender_id, sender_name, type, content, mentions_json, reactions_json, is_pinned, is_deleted, created_at, updated_at
        ) VALUES (?, ?, 'system', 'System', 'system', ?, '[]', '{}', 0, 0, ?, ?)
      `).run(sysMsgId, fam.id, sysText, nowIso, nowIso);
      db.prepare(`
        UPDATE families SET
          owner_id = ?,
          member_count = ?,
          last_message_id = ?,
          last_message_text = ?,
          last_message_sender_id = 'system',
          last_message_sender_name = 'System',
          last_message_at = ?,
          updated_at = ?
        WHERE id = ?
      `).run(successor.user_id, Number(countRow?.cnt || 1), sysMsgId, sysText, nowIso, nowIso, fam.id);
    } else {
      db.prepare("DELETE FROM family_message_reads WHERE family_id = ?").run(fam.id);
      db.prepare("DELETE FROM family_typing_status WHERE family_id = ?").run(fam.id);
      db.prepare("DELETE FROM family_messages WHERE family_id = ?").run(fam.id);
      db.prepare("DELETE FROM family_requests WHERE family_id = ?").run(fam.id);
      db.prepare("DELETE FROM family_invites WHERE family_id = ?").run(fam.id);
      db.prepare("DELETE FROM family_members WHERE family_id = ?").run(fam.id);
      db.prepare("DELETE FROM families WHERE id = ?").run(fam.id);
    }
  }
}
function deleteAccountCompletely(userId, preserveBannedIdentifiers = false) {
  handleOwnerDepartureFromFamilies(userId);
  const memberFamilies = db.prepare("SELECT family_id FROM family_members WHERE user_id = ? AND status = 'active'").all(userId);
  db.prepare("DELETE FROM family_message_reads WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM family_typing_status WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM family_requests WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM family_invites WHERE inviter_id = ? OR invitee_id = ?").run(userId, userId);
  db.prepare("DELETE FROM family_members WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM family_invite_daily_limits WHERE user_id = ?").run(userId);
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  for (const row of memberFamilies) {
    const cnt = db.prepare("SELECT COUNT(*) as cnt FROM family_members WHERE family_id = ? AND status = 'active'").get(row.family_id);
    db.prepare("UPDATE families SET member_count = ?, updated_at = ? WHERE id = ?").run(
      Number(cnt?.cnt || 0),
      nowIso,
      row.family_id
    );
  }
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM follows WHERE follower_id = ? OR following_id = ?").run(userId, userId);
  db.prepare("DELETE FROM blocked_users WHERE blocker_id = ? OR blocked_id = ?").run(userId, userId);
  db.prepare("DELETE FROM notifications WHERE user_id = ? OR actor_id = ?").run(userId, userId);
  db.prepare("DELETE FROM calls WHERE caller_id = ? OR callee_id = ?").run(userId, userId);
  db.prepare("DELETE FROM deleted_calls WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM message_reads WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM conversation_members WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM deleted_conversations WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM messages WHERE sender_id = ?").run(userId);
  db.prepare("DELETE FROM appeals WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM bans WHERE user_id = ?").run(userId);
  if (!preserveBannedIdentifiers) {
    db.prepare("DELETE FROM banned_identifiers WHERE user_id = ?").run(userId);
  }
  db.prepare("DELETE FROM profiles WHERE id = ?").run(userId);
  db.prepare("DELETE FROM users WHERE id = ?").run(userId);
}

// server/moderationService.ts
var import_nodemailer = __toESM(require("nodemailer"), 1);
var import_dns = __toESM(require("dns"), 1);
var SERIOUS_VIOLATION_RULES = /* @__PURE__ */ new Set([
  "child_abuse",
  "terrorism",
  "scam",
  "threats"
]);
var RULE_LABELS = {
  harassment: "Harassment or Bullying",
  spam: "Spam & Unsolicited Messaging",
  impersonation: "Impersonation or Fake Identity",
  hate_speech: "Hate Speech or Discrimination",
  nudity: "Nudity or Explicit Content",
  misinformation: "Harmful Misinformation",
  community_guidelines: "Community Guidelines Violation",
  child_abuse: "Child Sexual Exploitation or Abuse (Zero Tolerance)",
  terrorism: "Terrorism & Violent Extremism (Zero Tolerance)",
  scam: "Financial Scam or Fraud (Zero Tolerance)",
  threats: "Credible Threats of Violence (Zero Tolerance)"
};
function formatRuleLabel(ruleBroken) {
  if (!ruleBroken) return RULE_LABELS.community_guidelines;
  return RULE_LABELS[ruleBroken] || ruleBroken;
}
function createModerationTransporter() {
  const targetHost = process.env.SMTP_HOST || "smtp.gmail.com";
  const targetPort = parseInt(process.env.SMTP_PORT || "587", 10);
  const targetUser = process.env.SMTP_USER || process.env.GMAIL_USER || "";
  const targetPass = process.env.SMTP_PASS || process.env.GMAIL_PASS || "";
  const isGmail = targetHost.includes("gmail.com") || targetUser.endsWith("@gmail.com");
  const finalHost = isGmail ? "smtp.gmail.com" : targetHost;
  const finalPort = isGmail ? 587 : targetPort;
  const isSecure = finalPort === 465;
  return import_nodemailer.default.createTransport({
    host: finalHost,
    port: finalPort,
    secure: isSecure,
    requireTLS: !isSecure,
    auth: { user: targetUser, pass: targetPass },
    lookup: (hostname, _options, callback) => {
      import_dns.default.lookup(hostname, { family: 4 }, callback);
    },
    connectionTimeout: 7e3,
    greetingTimeout: 5e3,
    socketTimeout: 8e3,
    tls: { rejectUnauthorized: false }
  });
}
function buildModerationTemplate(params) {
  const {
    kind,
    displayName,
    username,
    email,
    reason,
    ruleBroken,
    strikeCount,
    banUntil,
    scheduledDeletionAt,
    appealUrl = process.env.APP_URL || "http://localhost:3000/?action=appeal",
    adminNote
  } = params;
  const ruleTitle = formatRuleLabel(ruleBroken);
  const formattedEndDate = banUntil ? new Date(banUntil).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : null;
  const formattedDeletionDate = scheduledDeletionAt ? new Date(scheduledDeletionAt).toLocaleString("en-US", { dateStyle: "medium" }) : null;
  let accent = "#0095F6";
  let badgeLabel = "Account Notice";
  let headline = "LiveConnect Account Update";
  let bodyLead = "We noticed activity on your account that requires your attention.";
  let subject = `Account Update (@${username}) - LiveConnect`;
  let notificationTitle = "Account Status Update";
  let notificationMessage = reason;
  let notificationType = "account_warning";
  let ctaLabel = "Review Account Status";
  if (kind === "warning") {
    accent = "#D97706";
    badgeLabel = `Strike ${strikeCount} \xB7 Warning`;
    headline = "Community Guidelines Warning";
    bodyLead = "Your account received an official warning. Repeated violations can lead to messaging restrictions, temporary suspension, or permanent removal.";
    subject = `Official Warning: LiveConnect (@${username})`;
    notificationTitle = "Account Warning Issued";
    notificationMessage = `Rule: ${ruleTitle}. Reason: ${reason}. Please review our Community Guidelines.`;
    notificationType = "account_warning";
  } else if (kind === "restricted") {
    accent = "#EA580C";
    badgeLabel = `Strike ${strikeCount} \xB7 Restricted`;
    headline = "Account Temporarily Restricted";
    bodyLead = "Some features such as sending new direct messages, starting calls, and following new users have been temporarily restricted.";
    subject = `Account Restricted: LiveConnect (@${username})`;
    notificationTitle = "Account Features Restricted";
    notificationMessage = `Messaging & calling restricted${formattedEndDate ? ` until ${formattedEndDate}` : ""}. Reason: ${reason}`;
    notificationType = "account_restricted";
  } else if (kind === "suspend") {
    accent = "#DC2626";
    badgeLabel = `Strike ${strikeCount} \xB7 Temporary Suspension`;
    headline = "Your account has been suspended";
    bodyLead = "Your account is temporarily invisible to others and all active sessions have been signed out. Your data has been preserved safely.";
    subject = `Your account has been suspended - LiveConnect (@${username})`;
    notificationTitle = "Account Suspended";
    notificationMessage = `Suspended${formattedEndDate ? ` until ${formattedEndDate}` : ""}. Rule: ${ruleTitle}. Request a review if you think this is a mistake.`;
    notificationType = "account_suspended";
    ctaLabel = "Request Review / Appeal";
  } else if (kind === "permanent_ban") {
    accent = "#991B1B";
    badgeLabel = "Permanent Ban \xB7 Disabled";
    headline = "Your account has been permanently disabled";
    bodyLead = "Due to repeated or severe violations of our safety policies, your LiveConnect account has been permanently disabled and all active sessions revoked.";
    subject = `Account Permanently Disabled - LiveConnect (@${username})`;
    notificationTitle = "Account Permanently Disabled";
    notificationMessage = `Rule: ${ruleTitle}. Data scheduled for deletion${formattedDeletionDate ? ` on ${formattedDeletionDate}` : " in 30 days"} unless an appeal is approved.`;
    notificationType = "account_disabled";
    ctaLabel = "Submit Final Appeal";
  } else if (kind === "restore") {
    accent = "#16A34A";
    badgeLabel = "Active \xB7 Restored";
    headline = "Your account has been restored";
    bodyLead = "Good news \u2014 your LiveConnect account is active again. Your profile, followers, and conversation history are visible and ready to use.";
    subject = `Your account has been restored - LiveConnect (@${username})`;
    notificationTitle = "Your account has been restored";
    notificationMessage = `${reason || "Your account access has been restored and is now active."}`;
    notificationType = "account_restored";
    ctaLabel = "Open LiveConnect";
  } else {
    accent = "#0095F6";
    badgeLabel = "Appeal Update";
    headline = "Update on Your Account Review Request";
    bodyLead = adminNote || reason;
    subject = `Appeal Update - LiveConnect (@${username})`;
    notificationTitle = "Appeal Review Update";
    notificationMessage = adminNote || reason;
    notificationType = "appeal_update";
    ctaLabel = "View Appeal Status";
  }
  const emailHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px;background-color:#f8fafc;font-family:'Plus Jakarta Sans',Arial,sans-serif;color:#0f172a;">
  <div style="max-width:540px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
    <div style="padding:24px 28px;border-bottom:1px solid #f1f5f9;">
      <div style="font-size:18px;font-weight:800;color:#0f172a;letter-spacing:-0.02em;">LiveConnect Safety</div>
      <div style="margin-top:6px;font-size:12px;font-weight:700;color:${accent};text-transform:uppercase;letter-spacing:0.06em;">${badgeLabel}</div>
    </div>
    <div style="padding:28px;">
      <h1 style="margin:0 0 10px 0;font-size:20px;font-weight:800;color:#0f172a;">${headline}</h1>
      <p style="margin:0 0 18px 0;font-size:14px;line-height:1.6;color:#475569;">Hi <strong>${displayName || username}</strong> (@${username}), ${bodyLead}</p>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:20px;">
        <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">Policy & Details</div>
        <div style="margin-top:6px;font-size:14px;font-weight:700;color:#0f172a;">${ruleTitle}</div>
        <div style="margin-top:4px;font-size:13px;color:#334155;line-height:1.5;">${reason}</div>
        ${formattedEndDate && (kind === "suspend" || kind === "restricted") ? `<div style="margin-top:10px;font-size:12px;color:#0f172a;"><strong>Restriction ends:</strong> ${formattedEndDate}</div>` : ""}
        ${formattedDeletionDate && kind === "permanent_ban" ? `<div style="margin-top:10px;font-size:12px;color:#991b1b;"><strong>Scheduled data removal:</strong> ${formattedDeletionDate} (unless appeal approved)</div>` : ""}
        ${adminNote ? `<div style="margin-top:10px;font-size:12px;color:#334155;"><strong>Reviewer Note:</strong> ${adminNote}</div>` : ""}
      </div>
      <a href="${appealUrl}" style="display:inline-block;padding:12px 22px;background-color:${kind === "restore" ? "#0095F6" : accent};color:#ffffff;text-decoration:none;font-size:13px;font-weight:700;border-radius:10px;">${ctaLabel}</a>
      <p style="margin:20px 0 0 0;font-size:12px;color:#94a3b8;">Sent to ${email} \xB7 LiveConnect Trust &amp; Safety</p>
    </div>
  </div>
</body>
</html>`;
  return {
    kind,
    subject,
    notificationTitle,
    notificationMessage,
    notificationType,
    emailHtml
  };
}
async function sendModerationEmail(toEmail, template) {
  if (!toEmail || !toEmail.includes("@")) return false;
  const user = process.env.SMTP_USER || process.env.GMAIL_USER;
  const pass = process.env.SMTP_PASS || process.env.GMAIL_PASS;
  if (process.env.DISABLE_SMTP === "true" || !user || !pass) return false;
  try {
    const transporter = createModerationTransporter();
    await transporter.sendMail({
      from: `"LiveConnect Safety" <${user}>`,
      to: toEmail,
      subject: template.subject,
      html: template.emailHtml
    });
    return true;
  } catch (err) {
    console.warn(`[Moderation Email] Notice skipped for ${toEmail}:`, err?.message || err);
    return false;
  }
}
function insertTargetUserSystemNotification(targetUserId, adminId, template, referenceId) {
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const notifId = `notif_mod_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const systemActor = {
    id: adminId || "system_safety",
    username: "liveconnect_safety",
    display_name: "LiveConnect Safety",
    avatar_url: null
  };
  db.prepare(`
    INSERT INTO notifications (id, user_id, actor_id, type, title, message, reference_id, actor_json, is_read, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(
    notifId,
    targetUserId,
    adminId || "system_safety",
    template.notificationType,
    template.notificationTitle,
    template.notificationMessage,
    referenceId || null,
    JSON.stringify(systemActor),
    nowIso
  );
}
function writeAuditLog(params) {
  db.prepare(
    "INSERT INTO audit_logs (id, admin_id, target_user_id, action, reason, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(
    generateId(),
    params.adminId,
    params.targetUserId,
    params.action,
    params.reason,
    params.details ? JSON.stringify(params.details) : null,
    (/* @__PURE__ */ new Date()).toISOString()
  );
}
async function restoreUserAccount(params) {
  const target = findUserById(params.targetUserId);
  if (!target) {
    throw Object.assign(new Error("Target user not found"), { statusCode: 404 });
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const nextStrikes = params.decrementStrike ? Math.max(0, Number(target.strike_count || 0) - 1) : Number(target.strike_count || 0);
  const restoreReason = params.reason?.trim() || (params.isAuto ? "Your temporary suspension period has ended and your account is active again." : "Your account has been reviewed and restored by our moderation team.");
  const banRecordId = generateId();
  db.exec("BEGIN");
  try {
    db.prepare(`
      UPDATE users SET
        status = 'active',
        strike_count = ?,
        ban_reason = NULL,
        rule_broken = NULL,
        ban_until = NULL,
        banned_until = NULL,
        restricted_until = NULL,
        scheduled_deletion_at = NULL,
        restored_at = ?,
        restored_notice_pending = 1,
        updated_at = ?
      WHERE id = ?
    `).run(nextStrikes, nowIso, nowIso, target.id);
    db.prepare("UPDATE bans SET is_active = 0 WHERE user_id = ? AND is_active = 1").run(target.id);
    db.prepare(`
      INSERT INTO bans (
        id, user_id, admin_id, action_type, status_applied, reason, rule_broken,
        severity, strike_number, duration_days, ban_until, scheduled_deletion_at, is_active, created_at
      ) VALUES (?, ?, ?, ?, 'active', ?, 'account_restored', 'system', ?, NULL, NULL, NULL, 0, ?)
    `).run(
      banRecordId,
      target.id,
      params.adminId,
      params.isAuto ? "auto_restore" : "restore",
      restoreReason,
      nextStrikes,
      nowIso
    );
    clearBannedIdentifiersForUser(target.id);
    writeAuditLog({
      adminId: params.adminId,
      targetUserId: target.id,
      action: params.isAuto ? "auto_restore" : "restore",
      reason: restoreReason,
      details: { previousStatus: target.status, strikeCount: nextStrikes, decremented: Boolean(params.decrementStrike) }
    });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  params.onStatusUpdated?.(target.id, "active");
  const prof = getProfileById(target.id);
  const template = buildModerationTemplate({
    kind: "restore",
    displayName: prof?.display_name || target.email.split("@")[0],
    username: prof?.username || target.email.split("@")[0],
    email: target.email,
    reason: restoreReason,
    ruleBroken: "account_restored",
    strikeCount: nextStrikes
  });
  insertTargetUserSystemNotification(target.id, params.adminId, template, banRecordId);
  const emailSent = await sendModerationEmail(target.email, template);
  return {
    success: true,
    user: findUserById(target.id),
    banId: banRecordId,
    statusApplied: "active",
    strikeCount: nextStrikes,
    emailSent
  };
}
async function executeModerationAction(params) {
  const { adminId, targetUserId, action } = params;
  const target = findUserById(targetUserId);
  if (!target) {
    throw Object.assign(new Error("Target user not found"), { statusCode: 404 });
  }
  if (action === "restore") {
    return restoreUserAccount({
      targetUserId,
      adminId,
      reason: params.reason,
      decrementStrike: false,
      isAuto: false,
      onStatusUpdated: params.onStatusUpdated
    });
  }
  if (target.role === "admin") {
    throw Object.assign(new Error("Admins cannot warn, restrict, suspend, or ban other admin accounts."), {
      statusCode: 403
    });
  }
  const ruleBroken = (params.ruleBroken || "community_guidelines").trim();
  const reason = (params.reason || formatRuleLabel(ruleBroken)).trim();
  const currentStrikes = Number(target.strike_count || 0);
  const nextStrikeCount = currentStrikes + 1;
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  let resolvedAction;
  if (SERIOUS_VIOLATION_RULES.has(ruleBroken)) {
    resolvedAction = "ban";
  } else if (action === "auto_strike") {
    if (nextStrikeCount === 1) resolvedAction = "warn";
    else if (nextStrikeCount === 2) resolvedAction = "restrict";
    else if (nextStrikeCount === 3) resolvedAction = "suspend";
    else resolvedAction = "ban";
  } else if (action === "permanent_ban") {
    resolvedAction = "ban";
  } else {
    resolvedAction = action;
  }
  let statusApplied = "active";
  let severity = "warning";
  let durationDays = null;
  let banUntil = null;
  let restrictedUntil = null;
  let scheduledDeletionAt = null;
  let templateKind = "warning";
  if (resolvedAction === "warn") {
    statusApplied = "active";
    severity = "warning";
    templateKind = "warning";
  } else if (resolvedAction === "restrict") {
    statusApplied = "restricted";
    severity = "restriction";
    durationDays = Math.min(30, Math.max(1, Number(params.durationDays || 2)));
    restrictedUntil = new Date(now + durationDays * 24 * 60 * 60 * 1e3).toISOString();
    templateKind = "restricted";
  } else if (resolvedAction === "suspend") {
    statusApplied = "suspended";
    severity = "suspension";
    durationDays = Math.min(30, Math.max(1, Number(params.durationDays || 7)));
    banUntil = new Date(now + durationDays * 24 * 60 * 60 * 1e3).toISOString();
    templateKind = "suspend";
  } else {
    statusApplied = "disabled";
    severity = "permanent";
    banUntil = "9999-12-31T23:59:59.000Z";
    scheduledDeletionAt = new Date(now + 30 * 24 * 60 * 60 * 1e3).toISOString();
    templateKind = "permanent_ban";
  }
  const banId = generateId();
  const prof = getProfileById(target.id);
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE bans SET is_active = 0 WHERE user_id = ? AND is_active = 1").run(target.id);
    db.prepare(`
      UPDATE users SET
        status = ?,
        strike_count = ?,
        ban_reason = ?,
        rule_broken = ?,
        ban_until = ?,
        banned_until = ?,
        restricted_until = ?,
        scheduled_deletion_at = ?,
        restored_notice_pending = 0,
        updated_at = ?
      WHERE id = ?
    `).run(
      statusApplied,
      nextStrikeCount,
      reason,
      ruleBroken,
      banUntil,
      banUntil,
      restrictedUntil,
      scheduledDeletionAt,
      nowIso,
      target.id
    );
    db.prepare(`
      INSERT INTO bans (
        id, user_id, admin_id, action_type, status_applied, reason, rule_broken,
        severity, strike_number, duration_days, ban_until, scheduled_deletion_at, is_active, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      banId,
      target.id,
      adminId,
      resolvedAction,
      statusApplied,
      reason,
      ruleBroken,
      severity,
      nextStrikeCount,
      durationDays,
      banUntil || restrictedUntil,
      scheduledDeletionAt,
      statusApplied === "active" ? 0 : 1,
      nowIso
    );
    if (statusApplied === "suspended" || statusApplied === "disabled") {
      revokeAllSessionsForUser(target.id);
      db.prepare("UPDATE profiles SET is_online = 0, last_seen = ?, updated_at = ? WHERE id = ?").run(
        nowIso,
        nowIso,
        target.id
      );
    }
    if (statusApplied === "disabled") {
      recordBannedIdentifiers(target.id, banId, {
        email: target.email,
        phone: target.phone || prof?.phone_number || null,
        deviceId: target.last_device_id || null
      });
      handleOwnerDepartureFromFamilies(target.id);
    }
    writeAuditLog({
      adminId,
      targetUserId: target.id,
      action: resolvedAction,
      reason,
      details: {
        ruleBroken,
        strikeNumber: nextStrikeCount,
        statusApplied,
        durationDays,
        banUntil: banUntil || restrictedUntil,
        scheduledDeletionAt
      }
    });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  params.onStatusUpdated?.(target.id, statusApplied);
  const template = buildModerationTemplate({
    kind: templateKind,
    displayName: prof?.display_name || target.email.split("@")[0],
    username: prof?.username || target.email.split("@")[0],
    email: target.email,
    reason,
    ruleBroken,
    strikeCount: nextStrikeCount,
    banUntil: banUntil || restrictedUntil,
    scheduledDeletionAt
  });
  insertTargetUserSystemNotification(target.id, adminId, template, banId);
  const emailSent = await sendModerationEmail(target.email, template);
  return {
    success: true,
    user: findUserById(target.id),
    banId,
    statusApplied,
    strikeCount: nextStrikeCount,
    emailSent
  };
}
async function resolveLiveUserRow(userId, onStatusUpdated) {
  const row = findUserById(userId);
  if (!row) return null;
  const nowMs = Date.now();
  if (row.status === "suspended" && row.ban_until && new Date(row.ban_until).getTime() <= nowMs) {
    const res = await restoreUserAccount({
      targetUserId: row.id,
      adminId: "system_scheduler",
      reason: "Temporary suspension expired automatically.",
      decrementStrike: false,
      isAuto: true,
      onStatusUpdated
    });
    return res.user;
  }
  if (row.status === "restricted" && row.restricted_until && new Date(row.restricted_until).getTime() <= nowMs) {
    const res = await restoreUserAccount({
      targetUserId: row.id,
      adminId: "system_scheduler",
      reason: "Temporary feature restriction expired automatically.",
      decrementStrike: false,
      isAuto: true,
      onStatusUpdated
    });
    return res.user;
  }
  return row;
}
async function runScheduledModerationSweep(onStatusUpdated) {
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const expiredSuspensions = db.prepare(
    "SELECT id FROM users WHERE status = 'suspended' AND ban_until IS NOT NULL AND ban_until <= ?"
  ).all(nowIso);
  for (const row of expiredSuspensions) {
    await restoreUserAccount({
      targetUserId: row.id,
      adminId: "system_scheduler",
      reason: "Your temporary suspension period has completed and your account is active again.",
      decrementStrike: false,
      isAuto: true,
      onStatusUpdated
    }).catch(() => {
    });
  }
  const expiredRestrictions = db.prepare(
    "SELECT id FROM users WHERE status = 'restricted' AND restricted_until IS NOT NULL AND restricted_until <= ?"
  ).all(nowIso);
  for (const row of expiredRestrictions) {
    await restoreUserAccount({
      targetUserId: row.id,
      adminId: "system_scheduler",
      reason: "Your temporary restriction period has completed.",
      decrementStrike: false,
      isAuto: true,
      onStatusUpdated
    }).catch(() => {
    });
  }
  const expiredPermanentBans = db.prepare(
    "SELECT id, email FROM users WHERE status = 'disabled' AND scheduled_deletion_at IS NOT NULL AND scheduled_deletion_at <= ?"
  ).all(nowIso);
  for (const row of expiredPermanentBans) {
    const openAppeal = db.prepare("SELECT id FROM appeals WHERE user_id = ? AND status IN ('pending', 'approved') LIMIT 1").get(row.id);
    if (openAppeal) continue;
    writeAuditLog({
      adminId: "system_scheduler",
      targetUserId: row.id,
      action: "permanent_ban_data_purge",
      reason: "30-day retention period elapsed with no approved appeal; account data deleted while banned identifiers remain blocked."
    });
    deleteAccountCompletely(row.id, true);
  }
}
function startModerationScheduler(onStatusUpdated) {
  void runScheduledModerationSweep(onStatusUpdated);
  return setInterval(() => {
    void runScheduledModerationSweep(onStatusUpdated);
  }, 6e4);
}

// server/cloudinaryService.ts
var import_cloudinary = require("cloudinary");
var import_fs2 = __toESM(require("fs"), 1);
var import_path2 = __toESM(require("path"), 1);
var CLOUDINARY_SIZE_LIMITS = {
  profile: 1 * 1024 * 1024,
  // 1 MB
  "chat-photo": 2 * 1024 * 1024,
  // 2 MB
  "chat-video": 50 * 1024 * 1024,
  // 50 MB
  "chat-voice-note": 10 * 1024 * 1024
  // 10 MB
};
var CLOUDINARY_SIZE_ERROR_MESSAGES = {
  profile: "Profile picture size must be 1 MB or less.",
  "chat-photo": "Photo size must be 2 MB or less.",
  "chat-video": "Video size must be 50 MB or less.",
  "chat-voice-note": "Voice note size must be 10 MB or less."
};
function validateCloudinaryFileSize(sizeInBytes, category) {
  const maxLimit = CLOUDINARY_SIZE_LIMITS[category];
  if (sizeInBytes > maxLimit) {
    return {
      valid: false,
      error: CLOUDINARY_SIZE_ERROR_MESSAGES[category] || `File size exceeds limit for ${category}`
    };
  }
  return { valid: true };
}
function isCloudinaryConfigured() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME || process.env.VITE_CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  return Boolean(cloudName && apiKey && apiSecret);
}
function initCloudinary() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME || process.env.VITE_CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (cloudName && apiKey && apiSecret) {
    import_cloudinary.v2.config({
      cloud_name: cloudName.trim(),
      api_key: apiKey.trim(),
      api_secret: apiSecret.trim(),
      secure: true
    });
    return true;
  }
  return false;
}
function buildCloudinaryFolder(category, userId, conversationId) {
  const uid = userId || "user";
  const cid = conversationId || "general";
  switch (category) {
    case "profile":
      return `LiveConnect/profile/${uid}`;
    case "chat-photo":
      return `LiveConnect/chat/photos/${cid}`;
    case "chat-video":
      return `LiveConnect/chat/videos/${cid}`;
    case "chat-voice-note":
      return `LiveConnect/chat/voice-notes/${cid}`;
    default:
      return `LiveConnect/chat/general/${cid}`;
  }
}
async function uploadBufferToCloudinary(options) {
  const { buffer, category, userId, conversationId, mimeType, fileName } = options;
  const validation = validateCloudinaryFileSize(buffer.length, category);
  if (!validation.valid) {
    throw new Error(validation.error || "File size exceeds allowed limit.");
  }
  const folder = buildCloudinaryFolder(category, userId, conversationId);
  const resourceType = category === "chat-video" ? "video" : category === "chat-voice-note" ? "raw" : "image";
  const fileId = `${category}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${category === "chat-voice-note" ? "mp3" : category === "chat-video" ? "mp4" : "jpg"}`;
  try {
    const uploadsDir = import_path2.default.join(process.cwd(), "uploads");
    if (!import_fs2.default.existsSync(uploadsDir)) {
      import_fs2.default.mkdirSync(uploadsDir, { recursive: true });
    }
    import_fs2.default.writeFileSync(import_path2.default.join(uploadsDir, fileId), buffer);
  } catch (diskErr) {
    console.warn("Local disk fallback write notice:", diskErr);
  }
  let defaultUrl = `/api/media/file/${fileId}`;
  let publicId = `${folder}/${fileId.split(".")[0]}`;
  if (isCloudinaryConfigured()) {
    initCloudinary();
    try {
      const uploadPreset = (process.env.CLOUDINARY_UPLOAD_PRESET || process.env.CLOUDINARY_UPLOD_PRESETS || "").trim();
      const options2 = {
        folder,
        resource_type: resourceType === "raw" ? "auto" : resourceType,
        overwrite: true,
        invalidate: true
      };
      if (uploadPreset) {
        options2.upload_preset = uploadPreset;
      }
      const uploadPromise = new Promise((resolve, reject) => {
        const uploadStream = import_cloudinary.v2.uploader.upload_stream(
          options2,
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );
        uploadStream.end(buffer);
      });
      const res = await uploadPromise;
      console.log(`[Cloudinary Upload Success] Public ID: ${res.public_id} (${buffer.length} bytes)`);
      return {
        success: true,
        cloudinary_public_id: res.public_id,
        url: res.secure_url || res.url,
        secure_url: res.secure_url || res.url,
        resource_type: res.resource_type || resourceType,
        format: res.format,
        bytes: res.bytes || buffer.length
      };
    } catch (cErr) {
      console.error("[Cloudinary Upload Error]:", cErr?.message || cErr);
    }
  }
  return {
    success: true,
    cloudinary_public_id: publicId,
    url: defaultUrl,
    secure_url: defaultUrl,
    resource_type: resourceType,
    bytes: buffer.length
  };
}
async function deleteAssetFromCloudinary(publicId, resourceType = "image") {
  if (!publicId) return false;
  if (isCloudinaryConfigured()) {
    initCloudinary();
    try {
      const res = await import_cloudinary.v2.uploader.destroy(publicId, {
        resource_type: resourceType,
        invalidate: true
      });
      console.log(`[Cloudinary Delete Result] '${publicId}':`, res?.result);
      return res?.result === "ok" || res?.result === "not_found";
    } catch (err) {
      console.error(`[Cloudinary Delete Error] '${publicId}':`, err?.message || err);
      return false;
    }
  }
  return true;
}

// server/familyRoutes.ts
var import_express = __toESM(require("express"), 1);
var import_crypto2 = __toESM(require("crypto"), 1);
var MAX_MEMBERS = 5e3;
var LARGE_FAMILY_THRESHOLD = 50;
var MAX_INVITE_BATCH = 10;
var MAX_DAILY_INVITES = 50;
var MAX_PINNED_MESSAGES = 3;
var VALID_MUTE_DURATIONS = /* @__PURE__ */ new Set(["1h", "8h", "1w", "always", "off"]);
var familyMsgRateBuckets = /* @__PURE__ */ new Map();
function checkFamilyMessageRateLimit(userId) {
  const now = Date.now();
  const cutoff = now - 1e4;
  const recent = (familyMsgRateBuckets.get(userId) || []).filter((ts) => ts > cutoff);
  if (recent.length >= 20) {
    familyMsgRateBuckets.set(userId, recent);
    return false;
  }
  recent.push(now);
  familyMsgRateBuckets.set(userId, recent);
  return true;
}
function generateInviteCode() {
  return `fam_${import_crypto2.default.randomBytes(6).toString("hex")}`;
}
function safeJsonParse(raw, fallback) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function formatFamilyRow(row, includePendingCount = false) {
  if (!row) return null;
  let pendingRequestsCount;
  if (includePendingCount) {
    const cnt = db.prepare("SELECT COUNT(*) as cnt FROM family_requests WHERE family_id = ? AND status = 'pending'").get(row.id);
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
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function formatMemberRow(row, hidePresence) {
  return {
    userId: row.user_id,
    familyId: row.family_id,
    role: row.role,
    status: row.status,
    relationTag: row.relation_tag || null,
    displayName: row.live_display_name || row.display_name || row.username || "User",
    username: row.live_username || row.username || "user",
    avatarUrl: row.live_avatar_url !== void 0 ? row.live_avatar_url : row.avatar_url || null,
    isOnline: hidePresence ? false : Boolean(row.live_is_online),
    lastSeen: hidePresence ? null : row.live_last_seen || null,
    joinedAt: row.joined_at,
    updatedAt: row.updated_at,
    removedAt: row.removed_at || null,
    removedBy: row.removed_by || null
  };
}
function computeUnreadCount(familyId, userId, lastReadAt, clearedAt, joinedAt) {
  const baseline = [lastReadAt, clearedAt, joinedAt].filter((v) => Boolean(v)).sort().pop() || joinedAt;
  const row = db.prepare(
    `SELECT COUNT(*) as cnt FROM family_messages
       WHERE family_id = ? AND created_at > ? AND sender_id != ? AND is_deleted = 0`
  ).get(familyId, baseline, userId);
  return Number(row?.cnt || 0);
}
function insertNotificationRow(params) {
  const actor = params.actorId && params.actorId !== "system" ? getProfileById(params.actorId) : null;
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
    (/* @__PURE__ */ new Date()).toISOString()
  );
}
function insertSystemMessage(familyId, text) {
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const msgId = `fmsg_${generateId().replace(/-/g, "").slice(0, 20)}`;
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
function recalcFamilyMemberCount(familyId) {
  const row = db.prepare("SELECT COUNT(*) as cnt FROM family_members WHERE family_id = ? AND status = 'active'").get(familyId);
  const cnt = Number(row?.cnt || 0);
  db.prepare("UPDATE families SET member_count = ?, updated_at = ? WHERE id = ?").run(
    cnt,
    (/* @__PURE__ */ new Date()).toISOString(),
    familyId
  );
  return cnt;
}
function formatMessageRow(row, seenCountMap) {
  const replyTo = safeJsonParse(row.reply_to_json, null);
  return {
    id: row.id,
    familyId: row.family_id,
    senderId: row.sender_id,
    senderName: row.sender_name,
    senderUsername: row.sender_username || null,
    senderAvatar: row.sender_avatar || null,
    senderRole: row.sender_role || "member",
    senderRelationTag: row.sender_relation_tag || null,
    type: row.type,
    content: row.is_deleted ? "This message was deleted" : row.content,
    mediaUrl: row.is_deleted ? null : row.media_url || null,
    mediaType: row.is_deleted ? null : row.media_type || null,
    cloudinaryPublicId: row.is_deleted ? null : row.cloudinary_public_id || null,
    b2FileId: row.is_deleted ? null : row.b2_file_id || null,
    b2FileName: row.is_deleted ? null : row.b2_file_name || null,
    replyToMessageId: row.reply_to_message_id || null,
    replyToMessage: replyTo,
    mentions: safeJsonParse(row.mentions_json, []),
    reactions: row.is_deleted ? {} : safeJsonParse(row.reactions_json, {}),
    isPinned: Boolean(row.is_pinned),
    isDeleted: Boolean(row.is_deleted),
    deletedBy: row.deleted_by || null,
    deletedByRole: row.deleted_by_role || null,
    safeCheckInAt: row.safe_checkin_at || null,
    seenCount: seenCountMap ? Number(seenCountMap.get(row.id) || 0) : 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function createFamilyRouter(requireAuth2) {
  const router = import_express.default.Router();
  router.use(requireAuth2);
  function rejectIfRestricted(req, res) {
    const userRow = req.authUserRow;
    if (userRow?.status === "restricted") {
      res.status(403).json({
        error: "Your account is temporarily restricted from sending messages or managing Family groups.",
        code: "ACCOUNT_RESTRICTED"
      });
      return true;
    }
    return false;
  }
  function getActiveMembership(familyId, userId) {
    return db.prepare("SELECT * FROM family_members WHERE family_id = ? AND user_id = ? LIMIT 1").get(familyId, userId);
  }
  router.get("/my", (req, res) => {
    try {
      const userId = req.authUserId;
      const memberRows = db.prepare(`
          SELECT fm.*, f.id as f_id, f.name, f.photo_url, f.owner_id, f.member_count, f.max_members,
                 f.join_approval_required, f.only_admins_can_send, f.invite_code, f.invite_link_enabled,
                 f.pinned_messages_json, f.last_message_id, f.last_message_text, f.last_message_sender_id,
                 f.last_message_sender_name, f.last_message_at, f.created_at as f_created_at, f.updated_at as f_updated_at
          FROM family_members fm
          INNER JOIN families f ON f.id = fm.family_id
          WHERE fm.user_id = ? AND fm.status IN ('active', 'pending')
          ORDER BY COALESCE(f.last_message_at, f.updated_at) DESC
        `).all(userId);
      const memberships = memberRows.map((row) => {
        const isPrivileged = row.status === "active" && (row.role === "owner" || row.role === "admin");
        const unreadCount = row.status === "active" ? computeUnreadCount(row.family_id, userId, row.last_read_at, row.cleared_at, row.joined_at) : 0;
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
            updated_at: row.f_updated_at
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
          family: familyObj
        };
      });
      const invites = db.prepare(
        `SELECT * FROM family_invites
           WHERE invitee_id = ? AND status = 'pending'
           ORDER BY created_at DESC LIMIT 50`
      ).all(userId).map((inv) => ({
        id: inv.id,
        familyId: inv.family_id,
        familyName: inv.family_name,
        familyPhotoUrl: inv.family_photo_url || null,
        inviterId: inv.inviter_id,
        inviterName: inv.inviter_name,
        inviteeId: inv.invitee_id,
        status: inv.status,
        createdAt: inv.created_at,
        respondedAt: inv.responded_at || null
      }));
      return res.json({ memberships, invites });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Failed to load Families" });
    }
  });
  router.post("/", (req, res) => {
    try {
      if (rejectIfRestricted(req, res)) return;
      const userId = req.authUserId;
      const { name, photoUrl, joinApprovalRequired, relationTag } = req.body || {};
      const cleanName = typeof name === "string" ? name.trim().slice(0, 80) : "";
      if (!cleanName) {
        return res.status(400).json({ error: "Family name is required." });
      }
      const cleanPhoto = typeof photoUrl === "string" && photoUrl.trim() ? photoUrl.trim().slice(0, 500) : null;
      const cleanRelation = typeof relationTag === "string" && relationTag.trim() ? relationTag.trim().slice(0, 32) : null;
      const approvalFlag = joinApprovalRequired === void 0 ? 1 : joinApprovalRequired ? 1 : 0;
      const profile = getProfileById(userId);
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      const familyId = `fam_${generateId().replace(/-/g, "").slice(0, 20)}`;
      const inviteCode = generateInviteCode();
      const sysMsgId = `fmsg_${generateId().replace(/-/g, "").slice(0, 20)}`;
      const ownerDisplay = profile?.display_name || profile?.username || "Owner";
      const welcomeText = `${ownerDisplay} created "${cleanName}"`;
      db.exec("BEGIN");
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
          profile?.username || "user",
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
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      const famRow = db.prepare("SELECT * FROM families WHERE id = ?").get(familyId);
      const memRow = db.prepare("SELECT * FROM family_members WHERE family_id = ? AND user_id = ?").get(familyId, userId);
      return res.json({
        family: formatFamilyRow(famRow, true),
        membership: {
          familyId,
          userId,
          role: "owner",
          status: "active",
          relationTag: cleanRelation,
          mutedUntil: null,
          isMutedAlways: false,
          lastReadAt: memRow?.last_read_at || nowIso,
          clearedAt: null,
          unreadCount: 0,
          joinedAt: nowIso,
          updatedAt: nowIso,
          family: formatFamilyRow(famRow, true)
        }
      });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Failed to create Family" });
    }
  });
  router.get("/by-invite/:code", (req, res) => {
    try {
      const userId = req.authUserId;
      const code = String(req.params.code || "").trim();
      if (!code) return res.status(400).json({ error: "Invite code is required." });
      const fam = db.prepare("SELECT * FROM families WHERE invite_code = ? AND invite_link_enabled = 1 LIMIT 1").get(code);
      if (!fam) {
        return res.status(404).json({ error: "Invite link is invalid or has been disabled." });
      }
      const mem = getActiveMembership(fam.id, userId);
      return res.json({
        family: {
          id: fam.id,
          name: fam.name,
          photoUrl: fam.photo_url || null,
          memberCount: Number(fam.member_count || 0),
          maxMembers: Number(fam.max_members || MAX_MEMBERS),
          joinApprovalRequired: Boolean(fam.join_approval_required)
        },
        membershipStatus: mem?.status || null
      });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Failed to look up invite link" });
    }
  });
  router.post("/join-by-code", (req, res) => {
    try {
      if (rejectIfRestricted(req, res)) return;
      const userId = req.authUserId;
      const code = String(req.body?.code || "").trim();
      if (!code) return res.status(400).json({ error: "Invite code is required." });
      const fam = db.prepare("SELECT * FROM families WHERE invite_code = ? AND invite_link_enabled = 1 LIMIT 1").get(code);
      if (!fam) {
        return res.status(404).json({ error: "This invite link is invalid, reset, or disabled." });
      }
      const existing = getActiveMembership(fam.id, userId);
      if (existing?.status === "active") {
        return res.json({
          status: "active",
          family: formatFamilyRow(fam, existing.role === "owner" || existing.role === "admin")
        });
      }
      if (existing?.status === "removed") {
        return res.status(403).json({
          error: "You were removed from this Family and cannot rejoin until an Owner or Admin allows you again.",
          code: "FAMILY_REMOVED"
        });
      }
      if (Number(fam.member_count || 0) >= MAX_MEMBERS) {
        return res.status(400).json({ error: `This Family has reached the maximum of ${MAX_MEMBERS} members.` });
      }
      const profile = getProfileById(userId);
      const displayName = profile?.display_name || profile?.username || "Member";
      const username = profile?.username || "user";
      const avatarUrl = profile?.avatar_url || null;
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
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
        const admins = db.prepare("SELECT user_id FROM family_members WHERE family_id = ? AND status = 'active' AND role IN ('owner', 'admin')").all(fam.id);
        for (const admin of admins) {
          insertNotificationRow({
            userId: admin.user_id,
            actorId: userId,
            type: "family_join_request",
            title: `Join request: ${fam.name}`,
            message: `${displayName} (@${username}) requested to join ${fam.name}.`,
            referenceId: fam.id
          });
        }
        return res.json({ status: "pending", familyId: fam.id, familyName: fam.name });
      }
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
      const updatedFam = db.prepare("SELECT * FROM families WHERE id = ?").get(fam.id);
      return res.json({ status: "active", family: formatFamilyRow(updatedFam, false) });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Failed to join Family" });
    }
  });
  router.post("/invites/:inviteId/respond", (req, res) => {
    try {
      const userId = req.authUserId;
      const { inviteId } = req.params;
      const action = String(req.body?.action || "").trim().toLowerCase();
      if (action !== "accept" && action !== "decline") {
        return res.status(400).json({ error: "action must be accept or decline." });
      }
      if (action === "accept" && rejectIfRestricted(req, res)) return;
      const invite = db.prepare("SELECT * FROM family_invites WHERE id = ? AND invitee_id = ? LIMIT 1").get(inviteId, userId);
      if (!invite) {
        return res.status(404).json({ error: "Invite not found." });
      }
      if (invite.status !== "pending") {
        return res.json({ success: true, status: invite.status, familyId: invite.family_id });
      }
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      if (action === "decline") {
        db.prepare("UPDATE family_invites SET status = 'declined', responded_at = ? WHERE id = ?").run(nowIso, inviteId);
        return res.json({ success: true, status: "declined" });
      }
      const fam = db.prepare("SELECT * FROM families WHERE id = ? LIMIT 1").get(invite.family_id);
      if (!fam) {
        db.prepare("UPDATE family_invites SET status = 'declined', responded_at = ? WHERE id = ?").run(nowIso, inviteId);
        return res.status(404).json({ error: "This Family no longer exists." });
      }
      const existing = getActiveMembership(fam.id, userId);
      if (existing?.status === "removed") {
        return res.status(403).json({
          error: "You were removed from this Family and cannot join until an Owner or Admin allows you again."
        });
      }
      if (existing?.status !== "active" && Number(fam.member_count || 0) >= MAX_MEMBERS) {
        return res.status(400).json({ error: `This Family has reached the ${MAX_MEMBERS} member limit.` });
      }
      const profile = getProfileById(userId);
      const displayName = profile?.display_name || profile?.username || "Member";
      const username = profile?.username || "user";
      const autoMute = Number(fam.member_count || 0) >= LARGE_FAMILY_THRESHOLD ? 1 : 0;
      db.exec("BEGIN");
      try {
        db.prepare("UPDATE family_invites SET status = 'accepted', responded_at = ? WHERE id = ?").run(nowIso, inviteId);
        if (existing?.status !== "active") {
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
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      const updatedFam = db.prepare("SELECT * FROM families WHERE id = ?").get(fam.id);
      return res.json({ success: true, status: "accepted", familyId: fam.id, family: formatFamilyRow(updatedFam, false) });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Failed to respond to invite" });
    }
  });
  router.get("/:familyId", (req, res) => {
    try {
      const userId = req.authUserId;
      const { familyId } = req.params;
      const fam = db.prepare("SELECT * FROM families WHERE id = ? LIMIT 1").get(familyId);
      if (!fam) return res.status(404).json({ error: "Family not found." });
      const mem = getActiveMembership(familyId, userId);
      if (!mem) return res.status(403).json({ error: "You are not a member of this Family." });
      if (mem.status === "removed") {
        return res.status(403).json({
          error: "You were removed from this Family.",
          code: "FAMILY_REMOVED"
        });
      }
      if (mem.status === "pending") {
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
            updatedAt: fam.updated_at
          },
          membership: {
            familyId: mem.family_id,
            userId: mem.user_id,
            role: mem.role,
            status: "pending",
            relationTag: mem.relation_tag || null,
            mutedUntil: mem.muted_until || null,
            isMutedAlways: Boolean(mem.is_muted_always),
            unreadCount: 0,
            joinedAt: mem.joined_at,
            updatedAt: mem.updated_at
          }
        });
      }
      const isPrivileged = mem.role === "owner" || mem.role === "admin";
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
          updatedAt: mem.updated_at
        }
      });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Failed to load Family" });
    }
  });
  router.patch("/:familyId", (req, res) => {
    try {
      if (rejectIfRestricted(req, res)) return;
      const userId = req.authUserId;
      const { familyId } = req.params;
      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== "active" || mem.role !== "owner" && mem.role !== "admin") {
        return res.status(403).json({ error: "Only the Owner or Admins can update Family settings." });
      }
      const fam = db.prepare("SELECT * FROM families WHERE id = ?").get(familyId);
      if (!fam) return res.status(404).json({ error: "Family not found." });
      const { name, photoUrl, joinApprovalRequired, onlyAdminsCanSend } = req.body || {};
      const actor = getProfileById(userId);
      const actorName = actor?.display_name || actor?.username || "Admin";
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      let nextName = fam.name;
      let nextPhoto = fam.photo_url;
      let nextJoinApproval = Boolean(fam.join_approval_required);
      let nextOnlyAdmins = Boolean(fam.only_admins_can_send);
      if (typeof name === "string" && name.trim()) {
        const clean = name.trim().slice(0, 80);
        if (clean !== fam.name) {
          nextName = clean;
          insertSystemMessage(familyId, `${actorName} renamed the Family to "${clean}"`);
        }
      }
      if (photoUrl !== void 0) {
        const cleanPhoto = typeof photoUrl === "string" && photoUrl.trim() ? photoUrl.trim().slice(0, 500) : null;
        if (cleanPhoto !== fam.photo_url) {
          nextPhoto = cleanPhoto;
          insertSystemMessage(familyId, `${actorName} updated the Family photo`);
        }
      }
      if (typeof joinApprovalRequired === "boolean") {
        nextJoinApproval = joinApprovalRequired;
      }
      if (typeof onlyAdminsCanSend === "boolean" && onlyAdminsCanSend !== Boolean(fam.only_admins_can_send)) {
        nextOnlyAdmins = onlyAdminsCanSend;
        insertSystemMessage(
          familyId,
          onlyAdminsCanSend ? `${actorName} enabled "Only admins can send messages"` : `${actorName} allowed all members to send messages`
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
      const updated = db.prepare("SELECT * FROM families WHERE id = ?").get(familyId);
      return res.json({ family: formatFamilyRow(updated, true) });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Failed to update Family" });
    }
  });
  router.post("/:familyId/invite-link", (req, res) => {
    try {
      if (rejectIfRestricted(req, res)) return;
      const userId = req.authUserId;
      const { familyId } = req.params;
      const action = String(req.body?.action || "reset").trim().toLowerCase();
      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== "active" || mem.role !== "owner" && mem.role !== "admin") {
        return res.status(403).json({ error: "Only the Owner or Admins can manage the invite link." });
      }
      const fam = db.prepare("SELECT * FROM families WHERE id = ?").get(familyId);
      if (!fam) return res.status(404).json({ error: "Family not found." });
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      if (action === "disable") {
        db.prepare("UPDATE families SET invite_link_enabled = 0, updated_at = ? WHERE id = ?").run(nowIso, familyId);
      } else if (action === "enable") {
        const code = fam.invite_code || generateInviteCode();
        db.prepare("UPDATE families SET invite_code = ?, invite_link_enabled = 1, updated_at = ? WHERE id = ?").run(
          code,
          nowIso,
          familyId
        );
      } else {
        const newCode = generateInviteCode();
        db.prepare("UPDATE families SET invite_code = ?, invite_link_enabled = 1, updated_at = ? WHERE id = ?").run(
          newCode,
          nowIso,
          familyId
        );
      }
      const updated = db.prepare("SELECT * FROM families WHERE id = ?").get(familyId);
      return res.json({ family: formatFamilyRow(updated, true) });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Failed to update invite link" });
    }
  });
  router.get("/:familyId/members", (req, res) => {
    try {
      const userId = req.authUserId;
      const { familyId } = req.params;
      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== "active") {
        return res.status(403).json({ error: "Active Family membership required to view members." });
      }
      const fam = db.prepare("SELECT member_count FROM families WHERE id = ?").get(familyId);
      if (!fam) return res.status(404).json({ error: "Family not found." });
      const requestedStatus = String(req.query.status || "active").trim();
      const targetStatus = requestedStatus === "removed" && (mem.role === "owner" || mem.role === "admin") ? "removed" : "active";
      const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || "30"), 10) || 30));
      const offset = Math.max(0, parseInt(String(req.query.offset || "0"), 10) || 0);
      const q = String(req.query.q || "").trim().toLowerCase();
      const hidePresence = Number(fam.member_count || 0) > LARGE_FAMILY_THRESHOLD;
      let rows;
      let totalRow;
      if (q) {
        const pattern = `%${q}%`;
        totalRow = db.prepare(`
            SELECT COUNT(*) as cnt FROM family_members fm
            LEFT JOIN profiles p ON p.id = fm.user_id
            WHERE fm.family_id = ? AND fm.status = ?
              AND (LOWER(COALESCE(p.display_name, fm.display_name)) LIKE ?
                   OR LOWER(COALESCE(p.username, fm.username)) LIKE ?
                   OR LOWER(COALESCE(fm.relation_tag, '')) LIKE ?)
          `).get(familyId, targetStatus, pattern, pattern, pattern);
        rows = db.prepare(`
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
          `).all(familyId, targetStatus, pattern, pattern, pattern, limit, offset);
      } else {
        totalRow = db.prepare("SELECT COUNT(*) as cnt FROM family_members WHERE family_id = ? AND status = ?").get(familyId, targetStatus);
        rows = db.prepare(`
            SELECT fm.*, p.display_name as live_display_name, p.username as live_username,
                   p.avatar_url as live_avatar_url, p.is_online as live_is_online, p.last_seen as live_last_seen
            FROM family_members fm
            LEFT JOIN profiles p ON p.id = fm.user_id
            WHERE fm.family_id = ? AND fm.status = ?
            ORDER BY
              CASE fm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
              LOWER(COALESCE(p.display_name, fm.display_name)) ASC
            LIMIT ? OFFSET ?
          `).all(familyId, targetStatus, limit, offset);
      }
      const total = Number(totalRow?.cnt || 0);
      return res.json({
        members: rows.map((r) => formatMemberRow(r, hidePresence)),
        total,
        hasMore: offset + rows.length < total,
        hidePresence
      });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Failed to load members" });
    }
  });
  router.post("/:familyId/invite", (req, res) => {
    try {
      if (rejectIfRestricted(req, res)) return;
      const userId = req.authUserId;
      const { familyId } = req.params;
      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== "active" || mem.role !== "owner" && mem.role !== "admin") {
        return res.status(403).json({ error: "Only the Owner or Admins can invite members." });
      }
      const fam = db.prepare("SELECT * FROM families WHERE id = ?").get(familyId);
      if (!fam) return res.status(404).json({ error: "Family not found." });
      const rawIds = Array.isArray(req.body?.inviteeIds) ? req.body.inviteeIds : [];
      const inviteeIds = Array.from(
        new Set(rawIds.filter((v) => typeof v === "string" && v.trim().length > 0 && v !== userId))
      );
      if (inviteeIds.length === 0) {
        return res.status(400).json({ error: "Select at least one user to invite." });
      }
      if (inviteeIds.length > MAX_INVITE_BATCH) {
        return res.status(400).json({ error: `You can invite up to ${MAX_INVITE_BATCH} users at a time.` });
      }
      const dayKey = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      const limitRow = db.prepare("SELECT invite_count FROM family_invite_daily_limits WHERE user_id = ? AND day_key = ?").get(userId, dayKey);
      const sentToday = Number(limitRow?.invite_count || 0);
      if (sentToday + inviteeIds.length > MAX_DAILY_INVITES) {
        return res.status(429).json({
          error: `Daily invite limit reached (${sentToday}/${MAX_DAILY_INVITES} invites sent today).`
        });
      }
      const inviterProfile = getProfileById(userId);
      const inviterName = inviterProfile?.display_name || inviterProfile?.username || "Someone";
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      let sentCount = 0;
      const skipped = [];
      for (const targetId of inviteeIds) {
        const targetUser = findUserById(targetId);
        const targetProfile = getProfileById(targetId);
        if (!targetUser || !targetProfile) {
          skipped.push({ userId: targetId, reason: "User not found" });
          continue;
        }
        if (targetUser.status === "suspended" || targetUser.status === "disabled" || targetUser.status === "deactivated") {
          skipped.push({ userId: targetId, reason: "User account unavailable" });
          continue;
        }
        const blockRow = db.prepare("SELECT 1 FROM blocked_users WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1").get(userId, targetId, targetId, userId);
        if (blockRow) {
          skipped.push({ userId: targetId, reason: "Blocked relationship" });
          continue;
        }
        const targetMem = getActiveMembership(familyId, targetId);
        if (targetMem?.status === "active") {
          skipped.push({ userId: targetId, reason: "Already a member" });
          continue;
        }
        if (targetMem?.status === "removed") {
          skipped.push({ userId: targetId, reason: "Previously removed (allow rejoin first)" });
          continue;
        }
        const existingInvite = db.prepare("SELECT id FROM family_invites WHERE family_id = ? AND invitee_id = ? AND status = 'pending' LIMIT 1").get(familyId, targetId);
        if (existingInvite) {
          skipped.push({ userId: targetId, reason: "Invite already pending" });
          continue;
        }
        const inviteId = `finv_${generateId().replace(/-/g, "").slice(0, 20)}`;
        db.prepare(`
          INSERT INTO family_invites (
            id, family_id, family_name, family_photo_url, inviter_id, inviter_name, invitee_id, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        `).run(inviteId, familyId, fam.name, fam.photo_url || null, userId, inviterName, targetId, nowIso);
        insertNotificationRow({
          userId: targetId,
          actorId: userId,
          type: "family_invite",
          title: `Family Invite: ${fam.name}`,
          message: `${inviterName} invited you to join "${fam.name}".`,
          referenceId: inviteId
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
        dailyRemaining: Math.max(0, MAX_DAILY_INVITES - (sentToday + sentCount))
      });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Failed to send invites" });
    }
  });
  router.get("/:familyId/requests", (req, res) => {
    try {
      const userId = req.authUserId;
      const { familyId } = req.params;
      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== "active" || mem.role !== "owner" && mem.role !== "admin") {
        return res.status(403).json({ error: "Only the Owner or Admins can review join requests." });
      }
      const rows = db.prepare(`
          SELECT fr.*, p.display_name as live_display_name, p.username as live_username, p.avatar_url as live_avatar_url
          FROM family_requests fr
          LEFT JOIN profiles p ON p.id = fr.user_id
          WHERE fr.family_id = ? AND fr.status = 'pending'
          ORDER BY fr.created_at DESC
          LIMIT 200
        `).all(familyId);
      return res.json({
        requests: rows.map((r) => ({
          userId: r.user_id,
          familyId: r.family_id,
          displayName: r.live_display_name || r.display_name || "User",
          username: r.live_username || r.username || "user",
          avatarUrl: r.live_avatar_url !== void 0 ? r.live_avatar_url : r.avatar_url || null,
          status: r.status,
          inviteCode: r.invite_code || null,
          createdAt: r.created_at
        }))
      });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Failed to load join requests" });
    }
  });
  router.post("/:familyId/requests/action", (req, res) => {
    try {
      if (rejectIfRestricted(req, res)) return;
      const userId = req.authUserId;
      const { familyId } = req.params;
      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== "active" || mem.role !== "owner" && mem.role !== "admin") {
        return res.status(403).json({ error: "Only the Owner or Admins can approve or reject requests." });
      }
      const fam = db.prepare("SELECT * FROM families WHERE id = ?").get(familyId);
      if (!fam) return res.status(404).json({ error: "Family not found." });
      const action = String(req.body?.action || "").trim().toLowerCase();
      const targetUserIds = Array.isArray(req.body?.userIds) ? req.body.userIds.filter((v) => typeof v === "string") : [];
      let pendingRows;
      if (action === "approve_all" || action === "reject_all") {
        pendingRows = db.prepare("SELECT * FROM family_requests WHERE family_id = ? AND status = 'pending'").all(familyId);
      } else if ((action === "approve" || action === "reject") && targetUserIds.length > 0) {
        const placeholders = targetUserIds.map(() => "?").join(",");
        pendingRows = db.prepare(`SELECT * FROM family_requests WHERE family_id = ? AND status = 'pending' AND user_id IN (${placeholders})`).all(familyId, ...targetUserIds);
      } else {
        return res.status(400).json({ error: "Invalid join request action." });
      }
      const isApprove = action === "approve" || action === "approve_all";
      if (isApprove && Number(fam.member_count || 0) + pendingRows.length > MAX_MEMBERS) {
        return res.status(400).json({ error: `Approving these requests would exceed the ${MAX_MEMBERS} member limit.` });
      }
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      const actor = getProfileById(userId);
      const actorName = actor?.display_name || actor?.username || "Admin";
      db.exec("BEGIN");
      try {
        for (const reqRow of pendingRows) {
          if (isApprove) {
            const targetUser = findUserById(reqRow.user_id);
            if (!targetUser || targetUser.status === "suspended" || targetUser.status === "disabled" || targetUser.status === "deactivated") {
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
              type: "family_join_approved",
              title: `Approved: ${fam.name}`,
              message: `${actorName} approved your request to join "${fam.name}".`,
              referenceId: familyId
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
              type: "family_join_rejected",
              title: `Join request declined`,
              message: `Your request to join "${fam.name}" was declined.`,
              referenceId: familyId
            });
          }
        }
        if (isApprove && pendingRows.length > 0) {
          recalcFamilyMemberCount(familyId);
          if (pendingRows.length === 1) {
            insertSystemMessage(familyId, `${pendingRows[0].display_name || "Member"} joined the Family`);
          } else {
            insertSystemMessage(familyId, `${pendingRows.length} new members joined the Family`);
          }
        }
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      const updatedFam = db.prepare("SELECT * FROM families WHERE id = ?").get(familyId);
      return res.json({ processed: pendingRows.length, family: formatFamilyRow(updatedFam, true) });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Failed to process join requests" });
    }
  });
  router.patch("/:familyId/members/:targetUserId/relation-tag", (req, res) => {
    try {
      if (rejectIfRestricted(req, res)) return;
      const userId = req.authUserId;
      const { familyId, targetUserId } = req.params;
      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== "active") {
        return res.status(403).json({ error: "Active Family membership required." });
      }
      const isSelf = userId === targetUserId;
      const isPrivileged = mem.role === "owner" || mem.role === "admin";
      if (!isSelf && !isPrivileged) {
        return res.status(403).json({ error: "Only the Owner or Admins can change other members' relation tags." });
      }
      const targetMem = getActiveMembership(familyId, targetUserId);
      if (!targetMem || targetMem.status !== "active") {
        return res.status(404).json({ error: "Target member not found." });
      }
      const rawTag = req.body?.relationTag;
      const cleanTag = typeof rawTag === "string" && rawTag.trim() ? rawTag.trim().slice(0, 32) : null;
      db.prepare("UPDATE family_members SET relation_tag = ?, updated_at = ? WHERE family_id = ? AND user_id = ?").run(
        cleanTag,
        (/* @__PURE__ */ new Date()).toISOString(),
        familyId,
        targetUserId
      );
      return res.json({ success: true, userId: targetUserId, relationTag: cleanTag });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Failed to update relation tag" });
    }
  });
  router.patch("/:familyId/members/:targetUserId/role", (req, res) => {
    try {
      if (rejectIfRestricted(req, res)) return;
      const userId = req.authUserId;
      const { familyId, targetUserId } = req.params;
      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== "active" || mem.role !== "owner") {
        return res.status(403).json({ error: "Only the Family Owner can assign or remove Admins." });
      }
      if (targetUserId === userId) {
        return res.status(400).json({ error: "Owner role cannot be changed directly. Use Transfer Ownership instead." });
      }
      const targetRole = String(req.body?.role || "").trim().toLowerCase();
      if (targetRole !== "admin" && targetRole !== "member") {
        return res.status(400).json({ error: "role must be admin or member." });
      }
      const targetMem = getActiveMembership(familyId, targetUserId);
      if (!targetMem || targetMem.status !== "active") {
        return res.status(404).json({ error: "Member not found." });
      }
      db.prepare("UPDATE family_members SET role = ?, updated_at = ? WHERE family_id = ? AND user_id = ?").run(
        targetRole,
        (/* @__PURE__ */ new Date()).toISOString(),
        familyId,
        targetUserId
      );
      const targetName = targetMem.display_name || targetMem.username || "Member";
      insertSystemMessage(
        familyId,
        targetRole === "admin" ? `${targetName} is now an Admin` : `${targetName} is no longer an Admin`
      );
      return res.json({ success: true, userId: targetUserId, role: targetRole });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Failed to update member role" });
    }
  });
  router.post("/:familyId/members/:targetUserId/remove", (req, res) => {
    try {
      if (rejectIfRestricted(req, res)) return;
      const userId = req.authUserId;
      const { familyId, targetUserId } = req.params;
      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== "active" || mem.role !== "owner" && mem.role !== "admin") {
        return res.status(403).json({ error: "Only the Owner or Admins can remove members." });
      }
      if (targetUserId === userId) {
        return res.status(400).json({ error: "Use Leave Family instead of removing yourself." });
      }
      const targetMem = getActiveMembership(familyId, targetUserId);
      if (!targetMem || targetMem.status !== "active") {
        return res.status(404).json({ error: "Active member not found." });
      }
      if (targetMem.role === "owner") {
        return res.status(403).json({ error: "The Family Owner cannot be removed." });
      }
      if (mem.role === "admin" && targetMem.role === "admin") {
        return res.status(403).json({ error: "Admins cannot remove other Admins." });
      }
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
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
      const actorName = actor?.display_name || actor?.username || "Admin";
      const targetName = targetMem.display_name || targetMem.username || "Member";
      insertSystemMessage(familyId, `${actorName} removed ${targetName}`);
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Failed to remove member" });
    }
  });
  router.post("/:familyId/members/:targetUserId/allow-rejoin", (req, res) => {
    try {
      if (rejectIfRestricted(req, res)) return;
      const userId = req.authUserId;
      const { familyId, targetUserId } = req.params;
      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== "active" || mem.role !== "owner" && mem.role !== "admin") {
        return res.status(403).json({ error: "Only the Owner or Admins can allow a removed member to rejoin." });
      }
      const targetMem = getActiveMembership(familyId, targetUserId);
      if (!targetMem || targetMem.status !== "removed") {
        return res.status(404).json({ error: "Removed member record not found." });
      }
      db.prepare(
        "UPDATE family_members SET status = 'left', removed_at = NULL, removed_by = NULL, updated_at = ? WHERE family_id = ? AND user_id = ?"
      ).run((/* @__PURE__ */ new Date()).toISOString(), familyId, targetUserId);
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Failed to allow rejoin" });
    }
  });
  router.post("/:familyId/transfer-ownership", (req, res) => {
    try {
      if (rejectIfRestricted(req, res)) return;
      const userId = req.authUserId;
      const { familyId } = req.params;
      const targetUserId = String(req.body?.targetUserId || "").trim();
      if (!targetUserId) return res.status(400).json({ error: "targetUserId is required." });
      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== "active" || mem.role !== "owner") {
        return res.status(403).json({ error: "Only the Family Owner can transfer ownership." });
      }
      if (targetUserId === userId) {
        return res.status(400).json({ error: "You are already the Owner." });
      }
      const targetMem = getActiveMembership(familyId, targetUserId);
      if (!targetMem || targetMem.status !== "active") {
        return res.status(404).json({ error: "Target user must be an active Family member." });
      }
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      db.exec("BEGIN");
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
        db.prepare("UPDATE families SET owner_id = ?, updated_at = ? WHERE id = ?").run(targetUserId, nowIso, familyId);
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      const targetName = targetMem.display_name || targetMem.username || "Member";
      const oldName = mem.display_name || mem.username || "Owner";
      insertSystemMessage(familyId, `${oldName} transferred Family ownership to ${targetName}`);
      const updatedFam = db.prepare("SELECT * FROM families WHERE id = ?").get(familyId);
      return res.json({ success: true, family: formatFamilyRow(updatedFam, true) });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Failed to transfer ownership" });
    }
  });
  router.post("/:familyId/mute", (req, res) => {
    try {
      const userId = req.authUserId;
      const { familyId } = req.params;
      const duration = String(req.body?.duration || "off").trim();
      if (!VALID_MUTE_DURATIONS.has(duration)) {
        return res.status(400).json({ error: "Invalid mute duration." });
      }
      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== "active") {
        return res.status(403).json({ error: "Active Family membership required." });
      }
      let isMutedAlways = 0;
      let mutedUntil = null;
      if (duration === "always") isMutedAlways = 1;
      else if (duration === "1h") mutedUntil = new Date(Date.now() + 60 * 60 * 1e3).toISOString();
      else if (duration === "8h") mutedUntil = new Date(Date.now() + 8 * 60 * 60 * 1e3).toISOString();
      else if (duration === "1w") mutedUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1e3).toISOString();
      db.prepare(
        "UPDATE family_members SET is_muted_always = ?, muted_until = ?, updated_at = ? WHERE family_id = ? AND user_id = ?"
      ).run(isMutedAlways, mutedUntil, (/* @__PURE__ */ new Date()).toISOString(), familyId, userId);
      return res.json({ success: true, isMutedAlways: Boolean(isMutedAlways), mutedUntil });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Failed to update mute preference" });
    }
  });
  router.post("/:familyId/clear-chat", (req, res) => {
    try {
      const userId = req.authUserId;
      const { familyId } = req.params;
      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== "active") {
        return res.status(403).json({ error: "Active Family membership required." });
      }
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      db.prepare(
        "UPDATE family_members SET cleared_at = ?, last_read_at = ?, updated_at = ? WHERE family_id = ? AND user_id = ?"
      ).run(nowIso, nowIso, nowIso, familyId, userId);
      return res.json({ success: true, clearedAt: nowIso });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Failed to clear chat" });
    }
  });
  router.post("/:familyId/leave", (req, res) => {
    try {
      const userId = req.authUserId;
      const { familyId } = req.params;
      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== "active") {
        return res.status(403).json({ error: "You are not an active member of this Family." });
      }
      if (mem.role === "owner") {
        return res.status(400).json({
          error: "As Owner, please transfer ownership to another member before leaving, or delete the Family."
        });
      }
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      db.prepare("UPDATE family_members SET status = 'left', role = 'member', updated_at = ? WHERE family_id = ? AND user_id = ?").run(
        nowIso,
        familyId,
        userId
      );
      recalcFamilyMemberCount(familyId);
      const profile = getProfileById(userId);
      insertSystemMessage(familyId, `${profile?.display_name || mem.display_name || "Member"} left`);
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Failed to leave Family" });
    }
  });
  router.delete("/:familyId", async (req, res) => {
    try {
      const userId = req.authUserId;
      const { familyId } = req.params;
      const fam = db.prepare("SELECT * FROM families WHERE id = ?").get(familyId);
      if (!fam) return res.status(404).json({ error: "Family not found." });
      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== "active" || mem.role !== "owner") {
        return res.status(403).json({ error: "Only the Family Owner can delete this Family." });
      }
      const ownerProfile = getProfileById(userId);
      const ownerName = ownerProfile?.display_name || ownerProfile?.username || "Owner";
      const activeMembers = db.prepare("SELECT user_id FROM family_members WHERE family_id = ? AND status = 'active' AND user_id != ?").all(familyId, userId);
      const mediaMessages = db.prepare(
        "SELECT cloudinary_public_id, b2_file_id, media_type FROM family_messages WHERE family_id = ? AND (cloudinary_public_id IS NOT NULL OR b2_file_id IS NOT NULL)"
      ).all(familyId);
      db.exec("BEGIN");
      try {
        for (const m of activeMembers) {
          insertNotificationRow({
            userId: m.user_id,
            actorId: userId,
            type: "family_deleted",
            title: `Family Deleted: ${fam.name}`,
            message: `${ownerName} deleted the Family "${fam.name}".`,
            referenceId: familyId
          });
        }
        db.prepare("DELETE FROM family_message_reads WHERE family_id = ?").run(familyId);
        db.prepare("DELETE FROM family_typing_status WHERE family_id = ?").run(familyId);
        db.prepare("DELETE FROM family_messages WHERE family_id = ?").run(familyId);
        db.prepare("DELETE FROM family_requests WHERE family_id = ?").run(familyId);
        db.prepare("DELETE FROM family_invites WHERE family_id = ?").run(familyId);
        db.prepare("DELETE FROM family_members WHERE family_id = ?").run(familyId);
        db.prepare("DELETE FROM families WHERE id = ?").run(familyId);
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      for (const item of mediaMessages) {
        const pid = item.cloudinary_public_id || item.b2_file_id;
        if (pid) {
          const rType = item.media_type === "voice" ? "raw" : "image";
          deleteAssetFromCloudinary(pid, rType).catch(() => {
          });
        }
      }
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Failed to delete Family" });
    }
  });
  router.get("/:familyId/messages", (req, res) => {
    try {
      const userId = req.authUserId;
      const { familyId } = req.params;
      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== "active") {
        return res.status(403).json({ error: "Only active Family members can read chat messages." });
      }
      const limit = Math.min(80, Math.max(10, parseInt(String(req.query.limit || "50"), 10) || 50));
      const before = typeof req.query.before === "string" && req.query.before.trim() ? req.query.before.trim() : null;
      const clearedAt = mem.cleared_at || null;
      let query = "SELECT * FROM family_messages WHERE family_id = ?";
      const params = [familyId];
      if (clearedAt) {
        query += " AND created_at > ?";
        params.push(clearedAt);
      }
      if (before) {
        query += " AND created_at < ?";
        params.push(before);
      }
      query += " ORDER BY created_at DESC LIMIT ?";
      params.push(limit);
      const rows = db.prepare(query).all(...params).reverse();
      const msgIds = rows.map((r) => r.id);
      const seenCountMap = /* @__PURE__ */ new Map();
      if (msgIds.length > 0) {
        const placeholders = msgIds.map(() => "?").join(",");
        const counts = db.prepare(
          `SELECT message_id, COUNT(*) as cnt FROM family_message_reads
             WHERE family_id = ? AND message_id IN (${placeholders})
             GROUP BY message_id`
        ).all(familyId, ...msgIds);
        for (const c of counts) {
          seenCountMap.set(c.message_id, Number(c.cnt || 0));
        }
      }
      return res.json({
        messages: rows.map((r) => formatMessageRow(r, seenCountMap)),
        hasMore: rows.length === limit
      });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Failed to load Family messages" });
    }
  });
  router.post("/:familyId/messages", (req, res) => {
    try {
      if (rejectIfRestricted(req, res)) return;
      const userId = req.authUserId;
      const { familyId } = req.params;
      if (!checkFamilyMessageRateLimit(userId)) {
        return res.status(429).json({ error: "Slow down! You are sending messages too quickly." });
      }
      const fam = db.prepare("SELECT * FROM families WHERE id = ?").get(familyId);
      if (!fam) return res.status(404).json({ error: "Family not found." });
      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== "active") {
        return res.status(403).json({ error: "Only active Family members can send messages." });
      }
      if (fam.only_admins_can_send && mem.role !== "owner" && mem.role !== "admin") {
        return res.status(403).json({ error: "Only the Owner and Admins can send messages in this Family." });
      }
      const {
        type = "text",
        content,
        mediaUrl,
        mediaType,
        cloudinaryPublicId,
        b2FileId,
        b2FileName,
        replyToMessageId,
        mentions
      } = req.body || {};
      const allowedTypes = /* @__PURE__ */ new Set(["text", "image", "voice", "sticker", "safe_checkin"]);
      const msgType = allowedTypes.has(String(type)) ? String(type) : "text";
      const cleanContent = typeof content === "string" ? content.trim().slice(0, 4e3) : "";
      if (!cleanContent && msgType === "text") {
        return res.status(400).json({ error: "Message content cannot be empty." });
      }
      const finalContent = msgType === "safe_checkin" ? cleanContent || "I'm safe" : cleanContent;
      const profile = getProfileById(userId);
      const senderName = profile?.display_name || mem.display_name || "Member";
      const senderUsername = profile?.username || mem.username || "user";
      const senderAvatar = profile?.avatar_url || mem.avatar_url || null;
      let replySnapshot = null;
      let validReplyId = null;
      if (typeof replyToMessageId === "string" && replyToMessageId.trim()) {
        const parent = db.prepare("SELECT id, sender_id, sender_name, content, is_deleted FROM family_messages WHERE id = ? AND family_id = ? LIMIT 1").get(replyToMessageId.trim(), familyId);
        if (parent) {
          validReplyId = parent.id;
          replySnapshot = {
            id: parent.id,
            senderId: parent.sender_id,
            senderName: parent.sender_name,
            content: parent.is_deleted ? "This message was deleted" : String(parent.content || "").slice(0, 140)
          };
        }
      }
      const mentionIds = Array.isArray(mentions) ? Array.from(new Set(mentions.filter((m) => typeof m === "string" && m.trim().length > 0 && m !== "everyone"))).slice(0, 20) : [];
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      const msgId = `fmsg_${generateId().replace(/-/g, "").slice(0, 20)}`;
      const previewText = msgType === "image" || finalContent.startsWith("[IMAGE:") ? "Sent a photo" : msgType === "voice" || finalContent.startsWith("[VOICE:") ? "Sent a voice message" : msgType === "sticker" || finalContent.startsWith("[STICKER:") ? "Sent a sticker" : msgType === "safe_checkin" ? "I'm Safe check-in" : finalContent.slice(0, 160);
      db.exec("BEGIN");
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
          msgType === "safe_checkin" ? nowIso : null,
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
        db.prepare("UPDATE family_members SET last_read_at = ?, updated_at = ? WHERE family_id = ? AND user_id = ?").run(
          nowIso,
          nowIso,
          familyId,
          userId
        );
        db.prepare("DELETE FROM family_typing_status WHERE family_id = ? AND user_id = ?").run(familyId, userId);
        for (const targetUid of mentionIds) {
          if (targetUid === userId) continue;
          const targetMem = getActiveMembership(familyId, targetUid);
          if (targetMem?.status === "active") {
            insertNotificationRow({
              userId: targetUid,
              actorId: userId,
              type: "family_mention",
              title: `${senderName} mentioned you in ${fam.name}`,
              message: previewText,
              referenceId: familyId
            });
          }
        }
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      const inserted = db.prepare("SELECT * FROM family_messages WHERE id = ?").get(msgId);
      return res.json({ message: formatMessageRow(inserted) });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Failed to send message" });
    }
  });
  router.post("/:familyId/messages/:messageId/react", (req, res) => {
    try {
      if (rejectIfRestricted(req, res)) return;
      const userId = req.authUserId;
      const { familyId, messageId } = req.params;
      const emoji = typeof req.body?.emoji === "string" ? req.body.emoji.trim().slice(0, 16) : "";
      if (!emoji) return res.status(400).json({ error: "emoji is required." });
      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== "active") {
        return res.status(403).json({ error: "Only active Family members can react to messages." });
      }
      const msg = db.prepare("SELECT * FROM family_messages WHERE id = ? AND family_id = ? LIMIT 1").get(messageId, familyId);
      if (!msg || msg.is_deleted) {
        return res.status(404).json({ error: "Message not found." });
      }
      const reactions = safeJsonParse(msg.reactions_json, {});
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
      db.prepare("UPDATE family_messages SET reactions_json = ?, updated_at = ? WHERE id = ?").run(
        JSON.stringify(reactions),
        (/* @__PURE__ */ new Date()).toISOString(),
        messageId
      );
      return res.json({ success: true, reactions });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Failed to update reaction" });
    }
  });
  router.post("/:familyId/messages/:messageId/pin", (req, res) => {
    try {
      if (rejectIfRestricted(req, res)) return;
      const userId = req.authUserId;
      const { familyId, messageId } = req.params;
      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== "active" || mem.role !== "owner" && mem.role !== "admin") {
        return res.status(403).json({ error: "Only the Owner or Admins can pin or unpin messages." });
      }
      const fam = db.prepare("SELECT * FROM families WHERE id = ?").get(familyId);
      const msg = db.prepare("SELECT * FROM family_messages WHERE id = ? AND family_id = ?").get(messageId, familyId);
      if (!fam || !msg || msg.is_deleted) {
        return res.status(404).json({ error: "Message not found." });
      }
      const currentPins = safeJsonParse(fam.pinned_messages_json, []);
      const alreadyIdx = currentPins.findIndex((p) => p.messageId === messageId);
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      const actor = getProfileById(userId);
      const actorName = actor?.display_name || actor?.username || "Admin";
      let nextPins = [...currentPins];
      let nextIsPinned = 0;
      if (alreadyIdx >= 0) {
        nextPins.splice(alreadyIdx, 1);
        nextIsPinned = 0;
      } else {
        while (nextPins.length >= MAX_PINNED_MESSAGES) {
          const evicted = nextPins.shift();
          if (evicted?.messageId) {
            db.prepare("UPDATE family_messages SET is_pinned = 0, updated_at = ? WHERE id = ? AND family_id = ?").run(
              nowIso,
              evicted.messageId,
              familyId
            );
          }
        }
        nextPins.push({
          messageId: msg.id,
          content: String(msg.content || "").slice(0, 180),
          senderId: msg.sender_id,
          senderName: msg.sender_name,
          pinnedById: userId,
          pinnedByName: actorName,
          pinnedAt: nowIso
        });
        nextIsPinned = 1;
      }
      db.prepare("UPDATE family_messages SET is_pinned = ?, updated_at = ? WHERE id = ?").run(
        nextIsPinned,
        nowIso,
        messageId
      );
      db.prepare("UPDATE families SET pinned_messages_json = ?, updated_at = ? WHERE id = ?").run(
        JSON.stringify(nextPins),
        nowIso,
        familyId
      );
      return res.json({ success: true, isPinned: Boolean(nextIsPinned), pinnedMessages: nextPins });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Failed to update pinned message" });
    }
  });
  router.delete("/:familyId/messages/:messageId", (req, res) => {
    try {
      const userId = req.authUserId;
      const { familyId, messageId } = req.params;
      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== "active") {
        return res.status(403).json({ error: "Active Family membership required." });
      }
      const fam = db.prepare("SELECT * FROM families WHERE id = ?").get(familyId);
      const msg = db.prepare("SELECT * FROM family_messages WHERE id = ? AND family_id = ?").get(messageId, familyId);
      if (!fam || !msg) return res.status(404).json({ error: "Message not found." });
      const isSelf = msg.sender_id === userId;
      const isPrivileged = mem.role === "owner" || mem.role === "admin";
      if (!isSelf && !isPrivileged) {
        return res.status(403).json({ error: "You can only delete your own messages unless you are Owner or Admin." });
      }
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      const publicId = msg.cloudinary_public_id || msg.b2_file_id;
      const mediaType = msg.media_type;
      const currentPins = safeJsonParse(fam.pinned_messages_json, []);
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
        db.prepare("UPDATE families SET pinned_messages_json = ?, updated_at = ? WHERE id = ?").run(
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
        const resType = mediaType === "voice" ? "raw" : "image";
        deleteAssetFromCloudinary(publicId, resType).catch(() => {
        });
      }
      return res.json({ success: true, pinnedMessages: filteredPins });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Failed to delete message" });
    }
  });
  router.post("/:familyId/read", (req, res) => {
    try {
      const userId = req.authUserId;
      const { familyId } = req.params;
      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== "active") {
        return res.status(403).json({ error: "Active Family membership required." });
      }
      const messageIds = Array.isArray(req.body?.messageIds) ? req.body.messageIds.filter((v) => typeof v === "string").slice(-50) : [];
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      const profile = getProfileById(userId);
      const displayName = profile?.display_name || mem.display_name || "Member";
      db.prepare("UPDATE family_members SET last_read_at = ?, updated_at = ? WHERE family_id = ? AND user_id = ?").run(
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
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Failed to mark messages read" });
    }
  });
  router.get("/:familyId/messages/:messageId/seen", (req, res) => {
    try {
      const userId = req.authUserId;
      const { familyId, messageId } = req.params;
      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== "active") {
        return res.status(403).json({ error: "Active Family membership required." });
      }
      const fam = db.prepare("SELECT member_count FROM families WHERE id = ?").get(familyId);
      const countRow = db.prepare("SELECT COUNT(*) as cnt FROM family_message_reads WHERE family_id = ? AND message_id = ?").get(familyId, messageId);
      const count = Number(countRow?.cnt || 0);
      const largeFamily = Number(fam?.member_count || 0) > LARGE_FAMILY_THRESHOLD;
      if (largeFamily) {
        return res.json({ count, readers: [], isLargeFamily: true });
      }
      const readers = db.prepare(
        `SELECT user_id as userId, display_name as displayName, read_at as readAt
           FROM family_message_reads
           WHERE family_id = ? AND message_id = ?
           ORDER BY read_at DESC LIMIT 50`
      ).all(familyId, messageId);
      return res.json({ count, readers, isLargeFamily: false });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Failed to load seen info" });
    }
  });
  router.post("/:familyId/typing", (req, res) => {
    try {
      const userId = req.authUserId;
      const { familyId } = req.params;
      const isTyping = Boolean(req.body?.isTyping);
      const fam = db.prepare("SELECT member_count FROM families WHERE id = ?").get(familyId);
      if (!fam || Number(fam.member_count || 0) > LARGE_FAMILY_THRESHOLD) {
        return res.json({ success: true, disabledForLargeFamily: true });
      }
      const mem = getActiveMembership(familyId, userId);
      if (!mem || mem.status !== "active") {
        return res.status(403).json({ error: "Active Family membership required." });
      }
      if (isTyping) {
        const profile = getProfileById(userId);
        const name = profile?.display_name || mem.display_name || "Member";
        db.prepare(`
          INSERT INTO family_typing_status (family_id, user_id, display_name, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(family_id, user_id) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at
        `).run(familyId, userId, name, (/* @__PURE__ */ new Date()).toISOString());
      } else {
        db.prepare("DELETE FROM family_typing_status WHERE family_id = ? AND user_id = ?").run(familyId, userId);
      }
      return res.json({ success: true });
    } catch {
      return res.status(500).json({ error: "Failed to update typing status" });
    }
  });
  router.get("/:familyId/typing", (req, res) => {
    try {
      const userId = req.authUserId;
      const { familyId } = req.params;
      const fam = db.prepare("SELECT member_count FROM families WHERE id = ?").get(familyId);
      if (!fam || Number(fam.member_count || 0) > LARGE_FAMILY_THRESHOLD) {
        return res.json({ typingUsers: [], disabledForLargeFamily: true });
      }
      const cutoff = new Date(Date.now() - 5500).toISOString();
      const rows = db.prepare(
        `SELECT user_id as userId, display_name as displayName
           FROM family_typing_status
           WHERE family_id = ? AND user_id != ? AND updated_at > ?
           ORDER BY updated_at DESC LIMIT 10`
      ).all(familyId, userId, cutoff);
      return res.json({ typingUsers: rows, disabledForLargeFamily: false });
    } catch {
      return res.json({ typingUsers: [] });
    }
  });
  return router;
}

// server.ts
if (import_fs3.default.existsSync(import_path3.default.join(process.cwd(), ".env.example"))) {
  import_dotenv.default.config({ path: import_path3.default.join(process.cwd(), ".env.example") });
}
import_dotenv.default.config();
function generateUUID() {
  return generateId();
}
function createStandardTransporter(host, port, user, pass) {
  const targetHost = host || process.env.SMTP_HOST || "smtp.gmail.com";
  const targetPort = port || parseInt(process.env.SMTP_PORT || "587", 10);
  const targetUser = user || process.env.SMTP_USER || process.env.GMAIL_USER || "";
  const targetPass = pass || process.env.SMTP_PASS || process.env.GMAIL_PASS || "";
  const isGmail = targetHost.includes("gmail.com") || targetUser.endsWith("@gmail.com");
  const finalHost = isGmail ? "smtp.gmail.com" : targetHost;
  const finalPort = isGmail ? 587 : targetPort;
  const isSecure = finalPort === 465;
  return import_nodemailer2.default.createTransport({
    host: finalHost,
    port: finalPort,
    secure: isSecure,
    requireTLS: !isSecure,
    auth: { user: targetUser, pass: targetPass },
    lookup: (hostname, _options, callback) => {
      import_dns2.default.lookup(hostname, { family: 4 }, callback);
    },
    connectionTimeout: 7e3,
    greetingTimeout: 5e3,
    socketTimeout: 8e3,
    tls: { rejectUnauthorized: false }
  });
}
async function sendOtpEmail(toEmail, otpCode) {
  if (!toEmail || !toEmail.includes("@")) return false;
  const user = process.env.SMTP_USER || process.env.GMAIL_USER;
  const pass = process.env.SMTP_PASS || process.env.GMAIL_PASS;
  if (!user || !pass) {
    return false;
  }
  const transporter = createStandardTransporter();
  const formattedCode = String(otpCode).trim();
  const htmlContent = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; background-color: #f4f6f8; margin: 0; padding: 20px;">
  <div style="max-width: 460px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 32px 24px; border: 1px solid #e2e8f0; text-align: center;">
    <h2 style="color: #0284c7; margin-top: 0; font-size: 24px; font-weight: bold;">LiveConnect</h2>
    <p style="color: #475569; font-size: 15px; margin-bottom: 24px;">Use the verification code below to confirm your email address.</p>
    <div style="background-color: #f1f5f9; border: 2px dashed #0284c7; border-radius: 10px; padding: 20px; margin-bottom: 24px; display: inline-block; width: 85%;">
      <span style="font-family: monospace; font-size: 38px; font-weight: bold; letter-spacing: 10px; color: #0f172a; display: block;">
        ${formattedCode}
      </span>
    </div>
    <p style="color: #64748b; font-size: 13px; margin: 0;">This code will expire in <strong>10 minutes</strong> and can only be used once.</p>
  </div>
</body>
</html>`;
  try {
    await transporter.sendMail({
      from: `"LiveConnect Auth" <${user}>`,
      to: toEmail,
      subject: `${formattedCode} - LiveConnect Verification Code`,
      html: htmlContent
    });
    return true;
  } catch (err) {
    console.warn(`[OTP Email] Error sending to ${toEmail}:`, err.message || err);
    return false;
  }
}
var app = (0, import_express2.default)();
var PORT = parseInt(process.env.PORT || "3000", 10);
app.use(import_express2.default.json({ limit: "50mb" }));
app.use(import_express2.default.urlencoded({ extended: true, limit: "50mb" }));
var mediaFilesStore = /* @__PURE__ */ new Map();
function transcodeAudioToMp3(inputBuffer) {
  return new Promise((resolve, reject) => {
    try {
      const ff = (0, import_child_process.spawn)("ffmpeg", [
        "-y",
        "-i",
        "pipe:0",
        "-vn",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "128k",
        "-ar",
        "44100",
        "-f",
        "mp3",
        "pipe:1"
      ]);
      const chunks = [];
      ff.stdout.on("data", (chunk) => chunks.push(chunk));
      ff.stderr.on("data", () => {
      });
      ff.on("close", (code) => {
        if (code === 0 && chunks.length > 0) {
          resolve(Buffer.concat(chunks));
        } else {
          reject(new Error(`FFmpeg audio conversion exited with code ${code}`));
        }
      });
      ff.on("error", (err) => reject(err));
      ff.stdin.write(inputBuffer);
      ff.stdin.end();
    } catch (err) {
      reject(err);
    }
  });
}
var registeredUsernames = /* @__PURE__ */ new Map();
var serverProfilesStore = /* @__PURE__ */ new Map();
var typingStateMap = /* @__PURE__ */ new Map();
try {
  const profileRows = db.prepare("SELECT * FROM profiles").all();
  for (const row of profileRows) {
    const p = formatProfile(row);
    if (p) {
      serverProfilesStore.set(p.id, p);
      if (p.username) registeredUsernames.set(p.username.toLowerCase(), p.id);
    }
  }
} catch (err) {
  console.warn("[SQLite Init] Profile cache hydration warning:", err);
}
function extractBearerToken(req) {
  const authHeader = req.headers.authorization || "";
  return authHeader.replace(/^Bearer\s+/i, "").trim();
}
var cachedFirebaseApiKey;
function getFirebaseWebApiKey() {
  if (cachedFirebaseApiKey !== void 0) return cachedFirebaseApiKey;
  try {
    const cfgPath = import_path3.default.join(process.cwd(), "firebase-applet-config.json");
    if (import_fs3.default.existsSync(cfgPath)) {
      const parsed = JSON.parse(import_fs3.default.readFileSync(cfgPath, "utf-8"));
      cachedFirebaseApiKey = parsed?.apiKey || null;
      return cachedFirebaseApiKey;
    }
  } catch {
  }
  cachedFirebaseApiKey = null;
  return null;
}
var verifiedFirebaseTokenCache = /* @__PURE__ */ new Map();
async function verifyAuthToken(token) {
  if (!token) return null;
  const sessionInfo = getUserBySessionToken(token);
  if (sessionInfo?.userRow?.id) {
    return sessionInfo.userRow.id;
  }
  const cached = verifiedFirebaseTokenCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.uid;
  }
  const apiKey = getFirebaseWebApiKey();
  if (apiKey && token.split(".").length === 3) {
    try {
      const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: token })
      });
      if (resp.ok) {
        const data = await resp.json();
        const uid = data?.users?.[0]?.localId;
        if (uid) {
          verifiedFirebaseTokenCache.set(token, { uid, expiresAt: Date.now() + 6e4 });
          return uid;
        }
      }
    } catch {
    }
  }
  return null;
}
async function getOptionalAuthUserId(req) {
  const token = extractBearerToken(req);
  if (!token) return null;
  return verifyAuthToken(token);
}
function getRequestDeviceId(req) {
  const fromHeader = req.headers["x-device-id"];
  if (typeof fromHeader === "string" && fromHeader.trim()) return fromHeader.trim().slice(0, 128);
  const fromBody = req.body?.deviceId;
  if (typeof fromBody === "string" && fromBody.trim()) return fromBody.trim().slice(0, 128);
  return null;
}
function syncProfileCacheAfterModeration(userId, status) {
  for (const [tok, val] of verifiedFirebaseTokenCache.entries()) {
    if (val.uid === userId) verifiedFirebaseTokenCache.delete(tok);
  }
  const fresh = getProfileById(userId);
  if (fresh) {
    serverProfilesStore.set(userId, {
      ...fresh,
      status,
      is_online: isAccountHiddenStatus(status) ? false : fresh.is_online
    });
  }
}
var APPEAL_ALLOWED_API_PATHS = /* @__PURE__ */ new Set([
  "/appeals",
  "/appeals/me",
  "/appeals/upload",
  "/account/export-data",
  "/account/status",
  "/account/templates",
  "/account/reactivate",
  "/account/acknowledge-restored",
  "/auth/session",
  "/auth/logout",
  "/auth/check-ban-status",
  "/auth/login",
  "/auth/google",
  "/auth/create-account",
  "/auth/confirm-user",
  "/auth/send-otp",
  "/auth/verify-otp",
  "/auth/truecaller/initiate",
  "/auth/truecaller/status",
  "/auth/truecaller/verify-otp",
  "/auth/truecaller/verify-number",
  "/health"
]);
app.use("/api", async (req, res, next) => {
  try {
    const token = extractBearerToken(req);
    if (!token) return next();
    const sessionInfo = getUserBySessionToken(token);
    const uid = sessionInfo?.userRow?.id || await verifyAuthToken(token);
    if (!uid) return next();
    const liveRow = await resolveLiveUserRow(uid, syncProfileCacheAfterModeration);
    if (!liveRow) return next();
    const tokenScope = sessionInfo?.session?.token_scope || "full";
    req.authUserId = uid;
    req.authUserRow = liveRow;
    req.tokenScope = tokenScope;
    const reqPath = req.path || "/";
    const isMediaServe = reqPath.startsWith("/media/file/") || reqPath.startsWith("/b2/file/");
    if (APPEAL_ALLOWED_API_PATHS.has(reqPath) || isMediaServe) {
      return next();
    }
    if (tokenScope === "appeal_only" || liveRow.status === "suspended" || liveRow.status === "disabled" || liveRow.status === "deactivated") {
      return res.status(403).json({
        error: liveRow.status === "disabled" ? "Your account has been permanently disabled. Only the appeal and data-export APIs are permitted." : liveRow.status === "deactivated" ? "Your account is deactivated. Please reactivate your account to continue." : "Your account has been suspended. Only the appeal and data-export APIs are permitted.",
        code: "ACCOUNT_SUSPENDED",
        accountStatus: liveRow.status,
        banReason: liveRow.ban_reason || null,
        ruleBroken: liveRow.rule_broken || null,
        ruleLabel: formatRuleLabel(liveRow.rule_broken),
        banUntil: liveRow.ban_until || liveRow.banned_until || null,
        scheduledDeletionAt: liveRow.scheduled_deletion_at || null
      });
    }
    const restrictedWriteRoutes = /* @__PURE__ */ new Set([
      "/messages/send",
      "/messages/react",
      "/calls/create",
      "/relations/follow",
      "/conversations/create-or-get"
    ]);
    if (liveRow.status === "restricted" && restrictedWriteRoutes.has(reqPath)) {
      return res.status(403).json({
        error: "Your account is temporarily restricted from sending messages, starting calls, or following users.",
        code: "ACCOUNT_RESTRICTED",
        accountStatus: "restricted",
        restrictedUntil: liveRow.restricted_until || null
      });
    }
    return next();
  } catch {
    return next();
  }
});
async function requireAuth(req, res, next) {
  const token = extractBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }
  const uid = req.authUserId || await verifyAuthToken(token);
  if (!uid) {
    return res.status(401).json({ error: "Invalid or expired authentication token" });
  }
  if (!req.authUserRow) {
    req.authUserRow = await resolveLiveUserRow(uid, syncProfileCacheAfterModeration);
  }
  req.authUserId = uid;
  return next();
}
function requireModeratorOrAdmin(req, res, next) {
  const userRow = req.authUserRow;
  const uid = req.authUserId;
  const live = userRow || (uid ? findUserById(uid) : void 0);
  const role = live?.role || "user";
  if (role !== "admin" && role !== "moderator") {
    return res.status(403).json({ error: "Admin or moderator privileges required" });
  }
  return next();
}
var blockRateLimitBuckets = /* @__PURE__ */ new Map();
var BLOCK_RATE_LIMIT_MAX = 12;
var BLOCK_RATE_LIMIT_WINDOW_MS = 6e4;
function blockRateLimiter(req, res, next) {
  const key = String(req.authUserId || req.ip || "anonymous");
  const now = Date.now();
  const windowStart = now - BLOCK_RATE_LIMIT_WINDOW_MS;
  const timestamps = (blockRateLimitBuckets.get(key) || []).filter((ts) => ts > windowStart);
  if (timestamps.length >= BLOCK_RATE_LIMIT_MAX) {
    const oldest = timestamps[0] || now;
    const retryAfterSec = Math.max(1, Math.ceil((oldest + BLOCK_RATE_LIMIT_WINDOW_MS - now) / 1e3));
    res.setHeader("Retry-After", String(retryAfterSec));
    return res.status(429).json({
      error: "Too many block/unblock requests. Please wait a moment and try again.",
      retryAfterSeconds: retryAfterSec
    });
  }
  timestamps.push(now);
  blockRateLimitBuckets.set(key, timestamps);
  return next();
}
var appealRateLimitBuckets = /* @__PURE__ */ new Map();
var APPEAL_RATE_LIMIT_MAX = 5;
var APPEAL_RATE_LIMIT_WINDOW_MS = 10 * 6e4;
function appealRateLimiter(req, res, next) {
  const key = String(req.authUserId || req.ip || "anonymous");
  const now = Date.now();
  const windowStart = now - APPEAL_RATE_LIMIT_WINDOW_MS;
  const timestamps = (appealRateLimitBuckets.get(key) || []).filter((ts) => ts > windowStart);
  if (timestamps.length >= APPEAL_RATE_LIMIT_MAX) {
    const oldest = timestamps[0] || now;
    const retryAfterSec = Math.max(1, Math.ceil((oldest + APPEAL_RATE_LIMIT_WINDOW_MS - now) / 1e3));
    res.setHeader("Retry-After", String(retryAfterSec));
    return res.status(429).json({
      error: "Appeal submission rate limit exceeded. Please wait before submitting another request.",
      retryAfterSeconds: retryAfterSec
    });
  }
  timestamps.push(now);
  appealRateLimitBuckets.set(key, timestamps);
  return next();
}
function getDeterministicDirectConvId(userA, userB) {
  const sorted = [userA || "", userB || ""].sort().join(":");
  let h1 = 2166136261, h2 = 2166136261, h3 = 2166136261, h4 = 2166136261;
  for (let i = 0; i < sorted.length; i++) {
    const code = sorted.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ code + i, 2246822507) >>> 0;
    h3 = Math.imul(h3 ^ (code << 3) + i, 3266489909) >>> 0;
    h4 = Math.imul(h4 ^ (code << 5) + i, 1597334677) >>> 0;
  }
  h1 = (Math.imul(h1 ^ h3 >>> 15, 2246822507) ^ h4) >>> 0;
  h2 = (Math.imul(h2 ^ h4 >>> 13, 3266489909) ^ h1) >>> 0;
  h3 = (Math.imul(h3 ^ h1 >>> 16, 1597334677) ^ h2) >>> 0;
  h4 = (Math.imul(h4 ^ h2 >>> 11, 2654435761) ^ h3) >>> 0;
  const hex1 = h1.toString(16).padStart(8, "0");
  const hex2 = (h2 & 65535).toString(16).padStart(4, "0");
  const hex3 = "4" + (h2 >>> 16 & 4095).toString(16).padStart(3, "0");
  const hex4 = (8 | h3 >>> 28 & 3).toString(16) + (h3 & 4095).toString(16).padStart(3, "0");
  const hex5 = h4.toString(16).padStart(8, "0") + (h3 >>> 12 & 65535).toString(16).padStart(4, "0");
  return `${hex1}-${hex2}-${hex3}-${hex4}-${hex5}`.toLowerCase();
}
function getProfileCachedOrDb(userId) {
  if (!userId) return null;
  const fromDb = getProfileById(userId);
  if (fromDb) {
    serverProfilesStore.set(userId, fromDb);
    return fromDb;
  }
  return serverProfilesStore.get(userId) || null;
}
function ensureProfileRecord(userId, meta) {
  if (!userId) return null;
  const existing = getProfileById(userId);
  if (existing) {
    if (meta && (meta.display_name || meta.username || meta.avatar_url)) {
      const updated = upsertProfile({
        id: userId,
        username: meta.username || existing.username,
        display_name: meta.display_name || existing.display_name,
        avatar_url: meta.avatar_url !== void 0 ? meta.avatar_url : existing.avatar_url,
        bio: meta.bio ?? existing.bio,
        country: meta.country ?? existing.country,
        gender: meta.gender ?? existing.gender,
        email: meta.email ?? existing.email,
        phone_number: meta.phone_number ?? existing.phone_number
      });
      serverProfilesStore.set(userId, updated);
      return updated;
    }
    return existing;
  }
  const baseUname = (meta?.username || `user_${userId.slice(0, 8)}`).toLowerCase().replace(/[^a-z0-9_]/g, "") || `user_${userId.slice(0, 6)}`;
  let candidate = baseUname;
  let suffix = 1;
  while (getProfileByUsername(candidate)) {
    candidate = `${baseUname}_${suffix++}`;
  }
  const created = upsertProfile({
    id: userId,
    username: candidate,
    display_name: meta?.display_name || meta?.full_name || candidate,
    avatar_url: meta?.avatar_url || null,
    bio: meta?.bio || "Hey there! I am using LiveConnect.",
    country: meta?.country || "India",
    gender: meta?.gender || null,
    email: meta?.email || null,
    phone_number: meta?.phone_number || null,
    is_online: true
  });
  serverProfilesStore.set(userId, created);
  registeredUsernames.set(created.username.toLowerCase(), userId);
  return created;
}
function resolveUserId(idOrUsername) {
  if (!idOrUsername) return "";
  if (getProfileById(idOrUsername) || serverProfilesStore.has(idOrUsername)) return idOrUsername;
  const byUname = getProfileByUsername(idOrUsername);
  if (byUname) return byUname.id;
  return idOrUsername;
}
function isBlocked(userA, userB) {
  if (!userA || !userB || userA === userB) return false;
  const row = db.prepare(
    "SELECT 1 FROM blocked_users WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1"
  ).get(userA, userB, userB, userA);
  return Boolean(row);
}
function requireNotBlocked(getTargetUserId) {
  return (req, res, next) => {
    const actorId = req.authUserId || req.body?.userId || req.body?.sender_id || req.body?.caller_id;
    const targetId = getTargetUserId(req);
    if (actorId && targetId && isBlocked(String(actorId), String(targetId))) {
      return res.status(403).json({ error: "Action unavailable because a user block exists" });
    }
    return next();
  };
}
function isFollowing(followerId, followingId) {
  if (!followerId || !followingId) return false;
  const fId = resolveUserId(followerId);
  const tId = resolveUserId(followingId);
  const row = db.prepare("SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ? LIMIT 1").get(fId, tId);
  return Boolean(row);
}
function isMutualFollow(userA, userB) {
  if (!userA || !userB || userA === userB) return false;
  if (isBlocked(userA, userB)) return false;
  return isFollowing(userA, userB) && isFollowing(userB, userA);
}
function isTargetUserHidden(userId) {
  if (!userId) return false;
  const row = db.prepare("SELECT status FROM users WHERE id = ? LIMIT 1").get(userId);
  return isAccountHiddenStatus(row?.status);
}
function getFollowCounts(userId) {
  const canonicalUserId = resolveUserId(userId);
  const followersRow = db.prepare(
    `SELECT COUNT(*) as cnt FROM follows f
       LEFT JOIN users u ON u.id = f.follower_id
       WHERE f.following_id = ? AND COALESCE(u.status, 'active') NOT IN ('suspended', 'disabled', 'deactivated')`
  ).get(canonicalUserId);
  const followingRow = db.prepare(
    `SELECT COUNT(*) as cnt FROM follows f
       LEFT JOIN users u ON u.id = f.following_id
       WHERE f.follower_id = ? AND COALESCE(u.status, 'active') NOT IN ('suspended', 'disabled', 'deactivated')`
  ).get(canonicalUserId);
  return {
    followersCount: Number(followersRow?.cnt || 0),
    followingCount: Number(followingRow?.cnt || 0)
  };
}
function addNotification(userId, actorId, type, title, message, referenceId, actorMeta) {
  if (!userId || !actorId || userId === actorId) return;
  if (isBlocked(userId, actorId)) return;
  const tenSecAgo = new Date(Date.now() - 1e4).toISOString();
  const dup = db.prepare(
    "SELECT * FROM notifications WHERE user_id = ? AND actor_id = ? AND type = ? AND created_at > ? ORDER BY created_at DESC LIMIT 1"
  ).get(userId, actorId, type, tenSecAgo);
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const actorObj = actorMeta || getProfileCachedOrDb(actorId) || { id: actorId, display_name: "User", username: "user" };
  if (dup) {
    db.prepare("UPDATE notifications SET title = ?, message = ?, created_at = ? WHERE id = ?").run(
      title,
      message,
      nowIso,
      dup.id
    );
    return {
      ...dup,
      title,
      message,
      created_at: nowIso,
      is_read: Boolean(dup.is_read),
      actor: actorObj
    };
  }
  const id = `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  db.prepare(`
    INSERT INTO notifications (id, user_id, actor_id, type, title, message, reference_id, actor_json, is_read, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(
    id,
    userId,
    actorId,
    type,
    title,
    message,
    referenceId || actorId || null,
    JSON.stringify(actorObj),
    nowIso
  );
  return {
    id,
    user_id: userId,
    actor_id: actorId,
    type,
    title,
    message,
    reference_id: referenceId || actorId || null,
    is_read: false,
    created_at: nowIso,
    actor: actorObj
  };
}
function buildConversationObject(convId, requestingUserId) {
  const convRow = db.prepare("SELECT * FROM conversations WHERE id = ?").get(convId);
  if (!convRow) return null;
  const memberRows = db.prepare("SELECT user_id, role, joined_at FROM conversation_members WHERE conversation_id = ?").all(convId);
  const memberIds = memberRows.map((m) => m.user_id);
  const memberRoles = {};
  const membersMeta = {};
  for (const m of memberRows) {
    memberRoles[m.user_id] = m.role === "admin" || m.user_id === convRow.owner_id ? "admin" : "member";
    const prof = getProfileCachedOrDb(m.user_id);
    if (prof) {
      membersMeta[m.user_id] = prof;
    }
  }
  const isGroup = convRow.type === "group" || Boolean(convRow.name) || memberIds.length > 2;
  if (isGroup) return null;
  const msgRow = db.prepare(
    `SELECT m.* FROM messages m
       LEFT JOIN deleted_messages dm ON m.id = dm.message_id
       WHERE m.conversation_id = ? AND dm.message_id IS NULL
       ORDER BY m.created_at DESC LIMIT 1`
  ).get(convId);
  const lastMessage = msgRow ? formatMessageRow2(msgRow) : null;
  let pinnedMessage = null;
  if (convRow.pinned_message_id) {
    const pinnedRow = db.prepare(
      `SELECT m.* FROM messages m
         LEFT JOIN deleted_messages dm ON m.id = dm.message_id
         WHERE m.id = ? AND m.conversation_id = ? AND dm.message_id IS NULL
         LIMIT 1`
    ).get(convRow.pinned_message_id, convId);
    if (pinnedRow) {
      pinnedMessage = formatMessageRow2(pinnedRow);
    }
  }
  let unreadCount = 0;
  if (requestingUserId) {
    const unreadRow = db.prepare(
      `SELECT COUNT(*) as cnt FROM messages m
         LEFT JOIN deleted_messages dm ON m.id = dm.message_id
         LEFT JOIN message_reads mr ON m.id = mr.message_id AND mr.user_id = ?
         WHERE m.conversation_id = ? AND dm.message_id IS NULL
           AND m.sender_id != ? AND m.is_read = 0 AND mr.message_id IS NULL`
    ).get(requestingUserId, convId, requestingUserId);
    unreadCount = Number(unreadRow?.cnt || 0);
  }
  const effectiveUpdatedAt = lastMessage?.created_at ? new Date(lastMessage.created_at).getTime() > new Date(convRow.updated_at || 0).getTime() ? lastMessage.created_at : convRow.updated_at : convRow.updated_at;
  let otherProfile = void 0;
  if (requestingUserId) {
    const otherId = memberIds.find((id) => id !== requestingUserId) || requestingUserId;
    otherProfile = membersMeta[otherId] || getProfileCachedOrDb(otherId) || {
      id: otherId,
      username: "user",
      display_name: "User",
      avatar_url: null,
      bio: null,
      is_online: false,
      last_seen: (/* @__PURE__ */ new Date()).toISOString(),
      created_at: (/* @__PURE__ */ new Date()).toISOString(),
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  return {
    id: convRow.id,
    type: "direct",
    pinned_message_id: convRow.pinned_message_id || null,
    pinned_message: pinnedMessage,
    member_ids: memberIds,
    members_meta: membersMeta,
    created_at: convRow.created_at,
    updated_at: effectiveUpdatedAt,
    other_member: otherProfile,
    last_message: lastMessage,
    unread_count: unreadCount
  };
}
function formatMessageRow2(row) {
  if (!row) return null;
  let reactions = void 0;
  if (row.reactions_json) {
    try {
      reactions = JSON.parse(row.reactions_json);
    } catch {
      reactions = void 0;
    }
  }
  let mentions = void 0;
  if (row.mentions_json) {
    try {
      mentions = JSON.parse(row.mentions_json);
    } catch {
      mentions = void 0;
    }
  }
  const sender = getProfileCachedOrDb(row.sender_id) || void 0;
  const readRows = db.prepare("SELECT message_id, user_id, read_at FROM message_reads WHERE message_id = ?").all(row.id);
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    sender_id: row.sender_id,
    content: row.content,
    reply_to_message_id: row.reply_to_message_id || null,
    reactions,
    mentions,
    media_type: row.media_type || void 0,
    cloudinary_public_id: row.cloudinary_public_id || void 0,
    b2_file_id: row.b2_file_id || void 0,
    b2_file_name: row.b2_file_name || void 0,
    is_read: Boolean(row.is_read) || readRows.length > 0,
    reads: readRows.map((r) => ({
      id: `${r.message_id}_${r.user_id}`,
      message_id: r.message_id,
      user_id: r.user_id,
      read_at: r.read_at
    })),
    sender,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}
app.post("/api/account/delete", async (req, res) => {
  try {
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
      }
    }
    const { userId } = body || {};
    const token = extractBearerToken(req);
    let targetId = userId;
    if (token) {
      const authInfo = getUserBySessionToken(token);
      if (authInfo?.user?.id) {
        targetId = authInfo.user.id;
      }
    }
    if (!targetId) {
      return res.status(400).json({ error: "User ID or valid authentication token required" });
    }
    serverProfilesStore.delete(targetId);
    for (const [uname, uId] of registeredUsernames.entries()) {
      if (uId === targetId) registeredUsernames.delete(uname);
    }
    deleteAccountCompletely(targetId);
    return res.json({
      success: true,
      message: "Account and all associated user data deleted permanently."
    });
  } catch (error) {
    console.error("[Account Deletion Error]:", error);
    return res.status(500).json({ error: error?.message || "Failed to delete account" });
  }
});
app.post("/api/auth/check-username", (req, res) => {
  try {
    const { username, excludeUserId } = req.body || {};
    if (!username) {
      return res.status(400).json({ available: false, message: "Username is required" });
    }
    const clean = String(username).trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (clean.length < 3) {
      return res.json({
        available: false,
        message: "Username must be at least 3 characters (letters, numbers, underscores only)."
      });
    }
    const existing = getProfileByUsername(clean);
    if (existing && (!excludeUserId || existing.id !== excludeUserId)) {
      registeredUsernames.set(clean, existing.id);
      return res.json({
        available: false,
        message: `@${clean} is already taken. Please choose another.`
      });
    }
    return res.json({
      available: true,
      message: `@${clean} is available!`
    });
  } catch (error) {
    return res.status(500).json({ available: false, message: error.message });
  }
});
app.post("/api/auth/suggest-username", (req, res) => {
  try {
    const { baseHint } = req.body || {};
    const cleanBase = String(baseHint || "user").trim().toLowerCase().replace(/[^a-z0-9_]/g, "").substring(0, 10);
    const base = cleanBase.length >= 3 ? cleanBase : "user";
    for (let i = 0; i < 15; i++) {
      const randomSuffix = Math.floor(100 + Math.random() * 9e3);
      const candidate = `${base}_${randomSuffix}`;
      if (!getProfileByUsername(candidate) && !registeredUsernames.has(candidate)) {
        return res.json({ username: candidate });
      }
    }
    return res.json({ username: `${base}_${Date.now().toString().slice(-4)}` });
  } catch {
    return res.json({ username: `user_${Math.floor(1e3 + Math.random() * 9e3)}` });
  }
});
app.post("/api/auth/claim-username", (req, res) => {
  try {
    const { username, userId } = req.body || {};
    if (username && userId) {
      const clean = String(username).trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
      registeredUsernames.set(clean, userId);
    }
    return res.json({ success: true });
  } catch {
    return res.json({ success: false });
  }
});
app.post("/api/auth/create-account", async (req, res) => {
  try {
    const { email, password, displayName, username, country } = req.body || {};
    if (!email || !password || !username) {
      return res.status(400).json({ error: "Email, password and username are required" });
    }
    const cleanEmail = String(email).trim().toLowerCase();
    const cleanUsername = String(username).trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
    const deviceId = getRequestDeviceId(req);
    const permanentBlock = findPermanentBanByIdentifier({
      email: cleanEmail,
      phone: req.body?.phone || null,
      deviceId
    });
    if (permanentBlock) {
      return res.status(403).json({
        error: `Account creation is permanently blocked because this ${permanentBlock.type} is associated with a permanently disabled account.`,
        code: "PERMANENT_BAN_BLOCK"
      });
    }
    if (cleanUsername.length < 3) {
      return res.status(400).json({ error: "Username must be at least 3 characters." });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters." });
    }
    if (findUserByEmail(cleanEmail)) {
      return res.status(400).json({ error: "Account already exists with this email!" });
    }
    if (getProfileByUsername(cleanUsername)) {
      return res.status(400).json({ error: `@${cleanUsername} is already taken.` });
    }
    const userId = generateUUID();
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const meta = {
      display_name: displayName?.trim() || cleanUsername,
      username: cleanUsername,
      country: country || "India"
    };
    const assignedRole = cleanEmail === "ravikantsharma925490@gmail.com" ? "admin" : "user";
    db.prepare(`
      INSERT INTO users (id, email, password_hash, email_confirmed, user_metadata, role, last_device_id, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
    `).run(userId, cleanEmail, hashPassword(password), JSON.stringify(meta), assignedRole, deviceId, nowIso, nowIso);
    const profile = upsertProfile({
      id: userId,
      username: cleanUsername,
      display_name: displayName?.trim() || cleanUsername,
      country: country || "India",
      email: cleanEmail,
      bio: "Hey there! I am using LiveConnect.",
      is_online: true
    });
    serverProfilesStore.set(userId, profile);
    registeredUsernames.set(cleanUsername, userId);
    const code = Math.floor(1e5 + Math.random() * 9e5).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1e3).toISOString();
    db.prepare("DELETE FROM user_otps WHERE LOWER(email) = LOWER(?)").run(cleanEmail);
    db.prepare(
      "INSERT INTO user_otps (id, email, otp_code, type, verified, expires_at, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)"
    ).run(generateUUID(), cleanEmail, code, "signup", expiresAt, nowIso);
    const emailSent = await sendOtpEmail(cleanEmail, code).catch(() => false);
    const userRow = findUserById(userId);
    const session = createSessionForUser(userId);
    return res.json({
      success: true,
      userId,
      needsOtp: true,
      emailSent,
      otpCode: code,
      session,
      user: formatAuthUser(userRow),
      profile
    });
  } catch (err) {
    console.error("create-account error:", err);
    return res.status(500).json({ error: err.message || "Failed to create account" });
  }
});
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }
    const cleanEmail = String(email).trim().toLowerCase();
    const deviceId = getRequestDeviceId(req);
    let userRow = findUserByEmail(cleanEmail);
    if (!userRow) {
      return res.status(401).json({ error: "Invalid email or password." });
    }
    if (!userRow.password_hash || !verifyPassword(String(password), userRow.password_hash)) {
      return res.status(401).json({ error: "Invalid email or password." });
    }
    userRow = await resolveLiveUserRow(userRow.id, syncProfileCacheAfterModeration) || userRow;
    if (userRow.status === "suspended" || userRow.status === "disabled") {
      revokeAllSessionsForUser(userRow.id);
      const appealSession = createSessionForUser(userRow.id, 7, "appeal_only", deviceId);
      const latestBan = db.prepare("SELECT * FROM bans WHERE user_id = ? ORDER BY created_at DESC LIMIT 1").get(userRow.id);
      return res.status(403).json({
        error: userRow.status === "disabled" ? "Your account has been permanently disabled." : "Your account has been suspended.",
        banned: true,
        accountStatus: userRow.status,
        banReason: userRow.ban_reason || latestBan?.reason || "Community Guidelines violation",
        ruleBroken: userRow.rule_broken || latestBan?.rule_broken || "community_guidelines",
        ruleLabel: formatRuleLabel(userRow.rule_broken || latestBan?.rule_broken),
        banUntil: userRow.ban_until || userRow.banned_until || null,
        bannedUntil: userRow.ban_until || userRow.banned_until || null,
        scheduledDeletionAt: userRow.scheduled_deletion_at || null,
        strikeCount: Number(userRow.strike_count || 0),
        appealSession,
        user: formatAuthUser(userRow)
      });
    }
    if (userRow.status === "deactivated") {
      db.prepare("UPDATE users SET status = 'active', updated_at = ? WHERE id = ?").run(
        (/* @__PURE__ */ new Date()).toISOString(),
        userRow.id
      );
      userRow = findUserById(userRow.id);
    }
    const session = createSessionForUser(userRow.id, 30, "full", deviceId);
    const profile = getProfileById(userRow.id);
    if (profile) {
      upsertProfile({ id: userRow.id, username: profile.username, display_name: profile.display_name, is_online: true });
      serverProfilesStore.set(userRow.id, { ...profile, is_online: true, status: userRow.status });
    }
    return res.json({
      success: true,
      session,
      user: formatAuthUser(userRow),
      profile: profile ? { ...profile, is_online: true, status: userRow.status } : null,
      needsOnboarding: !profile,
      restoredNoticePending: Boolean(userRow.restored_notice_pending)
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to sign in" });
  }
});
app.post("/api/auth/google", async (req, res) => {
  try {
    const { credential, accessToken } = req.body || {};
    if (!credential && !accessToken) {
      return res.status(400).json({ error: "Google credential or accessToken is required" });
    }
    let googleProfile = null;
    if (credential) {
      const verifyRes = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`
      );
      if (!verifyRes.ok) {
        return res.status(401).json({ error: "Invalid Google credential token." });
      }
      const info = await verifyRes.json();
      const configuredClientId = (process.env.VITE_GOOGLE_CLIENT_ID || "").trim();
      if (configuredClientId && info.aud && info.aud !== configuredClientId) {
        return res.status(401).json({ error: "Google token audience mismatch." });
      }
      googleProfile = {
        email: info.email,
        name: info.name,
        picture: info.picture,
        sub: info.sub
      };
    } else if (accessToken) {
      const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!userRes.ok) {
        return res.status(401).json({ error: "Invalid Google access token." });
      }
      const info = await userRes.json();
      googleProfile = {
        email: info.email,
        name: info.name,
        picture: info.picture,
        sub: info.sub
      };
    }
    if (!googleProfile?.email) {
      return res.status(400).json({ error: "Google account did not return an email address." });
    }
    const cleanEmail = googleProfile.email.trim().toLowerCase();
    const deviceId = getRequestDeviceId(req);
    let userRow = findUserByEmail(cleanEmail);
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    if (!userRow) {
      const permanentBlock = findPermanentBanByIdentifier({ email: cleanEmail, deviceId });
      if (permanentBlock) {
        return res.status(403).json({
          error: `Account creation is permanently blocked because this ${permanentBlock.type} is associated with a permanently disabled account.`,
          code: "PERMANENT_BAN_BLOCK"
        });
      }
      const userId = generateUUID();
      const meta = {
        full_name: googleProfile.name || cleanEmail.split("@")[0],
        name: googleProfile.name || cleanEmail.split("@")[0],
        avatar_url: googleProfile.picture || null,
        picture: googleProfile.picture || null,
        provider: "google",
        google_sub: googleProfile.sub
      };
      const assignedRole = cleanEmail === "ravikantsharma925490@gmail.com" ? "admin" : "user";
      db.prepare(`
        INSERT INTO users (id, email, password_hash, email_confirmed, user_metadata, role, last_device_id, created_at, updated_at)
        VALUES (?, ?, NULL, 1, ?, ?, ?, ?, ?)
      `).run(userId, cleanEmail, JSON.stringify(meta), assignedRole, deviceId, nowIso, nowIso);
      userRow = findUserById(userId);
    } else {
      userRow = await resolveLiveUserRow(userRow.id, syncProfileCacheAfterModeration) || userRow;
      if (userRow.status === "suspended" || userRow.status === "disabled") {
        revokeAllSessionsForUser(userRow.id);
        const appealSession = createSessionForUser(userRow.id, 7, "appeal_only", deviceId);
        return res.status(403).json({
          error: userRow.status === "disabled" ? "Your account has been permanently disabled." : "Your account has been suspended.",
          banned: true,
          accountStatus: userRow.status,
          banReason: userRow.ban_reason || "Community Guidelines violation",
          ruleBroken: userRow.rule_broken || "community_guidelines",
          ruleLabel: formatRuleLabel(userRow.rule_broken),
          banUntil: userRow.ban_until || userRow.banned_until || null,
          bannedUntil: userRow.ban_until || userRow.banned_until || null,
          scheduledDeletionAt: userRow.scheduled_deletion_at || null,
          strikeCount: Number(userRow.strike_count || 0),
          appealSession,
          user: formatAuthUser(userRow)
        });
      }
      if (userRow.status === "deactivated") {
        db.prepare("UPDATE users SET status = 'active', updated_at = ? WHERE id = ?").run(nowIso, userRow.id);
      }
      let existingMeta = {};
      try {
        existingMeta = userRow.user_metadata ? JSON.parse(userRow.user_metadata) : {};
      } catch {
      }
      const updatedMeta = {
        ...existingMeta,
        full_name: googleProfile.name || existingMeta.full_name,
        avatar_url: existingMeta.avatar_url || googleProfile.picture || null,
        provider: "google"
      };
      db.prepare("UPDATE users SET user_metadata = ?, email_confirmed = 1, last_device_id = COALESCE(?, last_device_id), updated_at = ? WHERE id = ?").run(
        JSON.stringify(updatedMeta),
        deviceId,
        nowIso,
        userRow.id
      );
      userRow = findUserById(userRow.id);
    }
    const session = createSessionForUser(userRow.id, 30, "full", deviceId);
    const profile = getProfileById(userRow.id);
    return res.json({
      success: true,
      session,
      user: formatAuthUser(userRow),
      profile,
      needsOnboarding: !profile,
      restoredNoticePending: Boolean(userRow.restored_notice_pending)
    });
  } catch (err) {
    console.error("[Google Auth Error]:", err);
    return res.status(500).json({ error: err.message || "Google sign-in failed" });
  }
});
app.get("/api/auth/session", async (req, res) => {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      return res.json({ session: null, user: null, profile: null });
    }
    const authInfo = getUserBySessionToken(token);
    if (!authInfo) {
      return res.json({ session: null, user: null, profile: null });
    }
    const liveRow = await resolveLiveUserRow(authInfo.user.id, syncProfileCacheAfterModeration) || authInfo.userRow;
    const isBannedOrSuspended = liveRow.status === "suspended" || liveRow.status === "disabled";
    if (isBannedOrSuspended) {
      return res.json({
        session: authInfo.session,
        user: formatAuthUser(liveRow),
        profile: null,
        banned: true,
        accountStatus: liveRow.status,
        banReason: liveRow.ban_reason || null,
        ruleBroken: liveRow.rule_broken || null,
        ruleLabel: formatRuleLabel(liveRow.rule_broken),
        bannedUntil: liveRow.ban_until || liveRow.banned_until || null,
        banUntil: liveRow.ban_until || liveRow.banned_until || null,
        scheduledDeletionAt: liveRow.scheduled_deletion_at || null,
        strikeCount: Number(liveRow.strike_count || 0)
      });
    }
    if (authInfo.session.token_scope === "appeal_only") {
      deleteSessionToken(token);
      const upgraded = createSessionForUser(liveRow.id, 30, "full", getRequestDeviceId(req));
      const profile2 = getProfileById(liveRow.id);
      return res.json({
        session: upgraded,
        user: formatAuthUser(liveRow),
        profile: profile2,
        needsOnboarding: !profile2,
        banned: false,
        bannedUntil: null,
        restoredNoticePending: Boolean(liveRow.restored_notice_pending)
      });
    }
    const profile = getProfileById(liveRow.id);
    if (profile) {
      serverProfilesStore.set(profile.id, profile);
    }
    return res.json({
      session: authInfo.session,
      user: formatAuthUser(liveRow),
      profile,
      needsOnboarding: !profile,
      banned: false,
      bannedUntil: null,
      restoredNoticePending: Boolean(liveRow.restored_notice_pending)
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Session lookup failed" });
  }
});
app.post("/api/auth/logout", (req, res) => {
  try {
    const token = extractBearerToken(req);
    if (token) {
      const authInfo = getUserBySessionToken(token);
      if (authInfo?.user?.id) {
        db.prepare("UPDATE profiles SET is_online = 0, last_seen = ? WHERE id = ?").run(
          (/* @__PURE__ */ new Date()).toISOString(),
          authInfo.user.id
        );
      }
      deleteSessionToken(token);
    }
    return res.json({ success: true });
  } catch {
    return res.json({ success: true });
  }
});
app.post("/api/auth/complete-onboarding", (req, res) => {
  try {
    const token = extractBearerToken(req);
    const authInfo = token ? getUserBySessionToken(token) : null;
    const { userId: bodyUserId, username, displayName, country, bio, gender, avatarUrl } = req.body || {};
    const targetUserId = authInfo?.user?.id || bodyUserId;
    if (!targetUserId) {
      return res.status(401).json({ error: "Authentication required" });
    }
    const cleanUsername = String(username || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (cleanUsername.length < 3) {
      return res.status(400).json({ error: "Username must be at least 3 characters." });
    }
    const taken = getProfileByUsername(cleanUsername);
    if (taken && taken.id !== targetUserId) {
      return res.status(400).json({ error: `@${cleanUsername} is already taken. Please choose another.` });
    }
    const userRow = findUserById(targetUserId);
    const profile = upsertProfile({
      id: targetUserId,
      username: cleanUsername,
      display_name: (displayName || cleanUsername).trim(),
      country: country || "India",
      bio: bio || "Hey there! I am using LiveConnect.",
      gender: gender || null,
      avatar_url: avatarUrl || null,
      email: userRow?.email || null,
      is_online: true
    });
    if (userRow) {
      let existingMeta = {};
      try {
        existingMeta = userRow.user_metadata ? JSON.parse(userRow.user_metadata) : {};
      } catch {
      }
      db.prepare("UPDATE users SET user_metadata = ?, updated_at = ? WHERE id = ?").run(
        JSON.stringify({
          ...existingMeta,
          username: cleanUsername,
          display_name: profile.display_name,
          avatar_url: profile.avatar_url,
          country: profile.country,
          gender: profile.gender
        }),
        (/* @__PURE__ */ new Date()).toISOString(),
        targetUserId
      );
    }
    serverProfilesStore.set(targetUserId, profile);
    registeredUsernames.set(cleanUsername, targetUserId);
    return res.json({ success: true, profile });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to save onboarding profile" });
  }
});
app.post("/api/auth/update-profile", (req, res) => {
  try {
    const token = extractBearerToken(req);
    const authInfo = token ? getUserBySessionToken(token) : null;
    const { userId: bodyUserId, updates } = req.body || {};
    const targetUserId = authInfo?.user?.id || bodyUserId;
    if (!targetUserId) {
      return res.status(401).json({ error: "Authentication required" });
    }
    const existing = getProfileById(targetUserId);
    const nextUsername = updates?.username ? String(updates.username).trim().toLowerCase().replace(/[^a-z0-9_]/g, "") : existing?.username || "";
    if (nextUsername && nextUsername.length < 3) {
      return res.status(400).json({ error: "Username must be at least 3 characters." });
    }
    if (nextUsername) {
      const taken = getProfileByUsername(nextUsername);
      if (taken && taken.id !== targetUserId) {
        return res.status(400).json({ error: `@${nextUsername} is already taken.` });
      }
    }
    const profile = upsertProfile({
      id: targetUserId,
      username: nextUsername || `user_${targetUserId.slice(0, 6)}`,
      display_name: updates?.display_name ?? existing?.display_name ?? "User",
      avatar_url: updates?.avatar_url !== void 0 ? updates.avatar_url : existing?.avatar_url,
      bio: updates?.bio !== void 0 ? updates.bio : existing?.bio,
      gender: updates?.gender !== void 0 ? updates.gender : existing?.gender,
      country: updates?.country !== void 0 ? updates.country : existing?.country,
      cloudinary_public_id: updates?.cloudinary_public_id !== void 0 ? updates.cloudinary_public_id : existing?.cloudinary_public_id,
      b2_file_id: updates?.b2_file_id !== void 0 ? updates.b2_file_id : existing?.b2_file_id,
      b2_file_name: updates?.b2_file_name !== void 0 ? updates.b2_file_name : existing?.b2_file_name
    });
    serverProfilesStore.set(targetUserId, profile);
    registeredUsernames.set(profile.username.toLowerCase(), targetUserId);
    return res.json({ success: true, profile });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to update profile" });
  }
});
app.post("/api/auth/reset-password", async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "Email is required" });
    const cleanEmail = String(email).trim().toLowerCase();
    const userRow = findUserByEmail(cleanEmail);
    if (!userRow) {
      return res.status(404).json({ error: "No account found with this email address." });
    }
    const code = Math.floor(1e5 + Math.random() * 9e5).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1e3).toISOString();
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    db.prepare("DELETE FROM user_otps WHERE LOWER(email) = LOWER(?) AND type = ?").run(cleanEmail, "reset");
    db.prepare(
      "INSERT INTO user_otps (id, email, otp_code, type, verified, expires_at, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)"
    ).run(generateUUID(), cleanEmail, code, "reset", expiresAt, nowIso);
    const emailSent = await sendOtpEmail(cleanEmail, code).catch(() => false);
    return res.json({ success: true, emailSent, otpCode: emailSent ? void 0 : code });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to send reset code" });
  }
});
app.post("/api/auth/verify-reset-password", (req, res) => {
  try {
    const { email, otpCode, newPassword } = req.body || {};
    if (!email || !otpCode || !newPassword) {
      return res.status(400).json({ error: "Email, verification code, and new password are required." });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters." });
    }
    const cleanEmail = String(email).trim().toLowerCase();
    const cleanCode = String(otpCode).trim();
    const otpRow = db.prepare(
      "SELECT * FROM user_otps WHERE LOWER(email) = LOWER(?) AND type = ? ORDER BY created_at DESC LIMIT 1"
    ).get(cleanEmail, "reset");
    if (!otpRow) {
      return res.status(400).json({ error: "No reset code found. Please request a new one." });
    }
    if (otpRow.verified) {
      return res.status(400).json({ error: "This code was already used." });
    }
    if (new Date(otpRow.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: "This code has expired. Please request a new one." });
    }
    if (String(otpRow.otp_code).trim() !== cleanCode) {
      return res.status(400).json({ error: "Incorrect verification code." });
    }
    db.prepare("UPDATE user_otps SET verified = 1 WHERE id = ?").run(otpRow.id);
    db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE LOWER(email) = LOWER(?)").run(
      hashPassword(String(newPassword)),
      (/* @__PURE__ */ new Date()).toISOString(),
      cleanEmail
    );
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to reset password" });
  }
});
app.post("/api/auth/update-password", (req, res) => {
  try {
    const token = extractBearerToken(req);
    const authInfo = getUserBySessionToken(token);
    if (!authInfo) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    const { newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters." });
    }
    db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(
      hashPassword(String(newPassword)),
      (/* @__PURE__ */ new Date()).toISOString(),
      authInfo.user.id
    );
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to update password" });
  }
});
app.post("/api/auth/confirm-user", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email) return res.status(400).json({ error: "Email is required" });
    const cleanEmail = String(email).trim().toLowerCase();
    const deviceId = getRequestDeviceId(req);
    let userRow = findUserByEmail(cleanEmail);
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const cleanUsername = cleanEmail.split("@")[0].replace(/[^a-z0-9_]/g, "") || "user";
    if (!userRow && password) {
      const permanentBlock = findPermanentBanByIdentifier({ email: cleanEmail, deviceId });
      if (permanentBlock) {
        return res.status(403).json({
          error: `Account creation is permanently blocked because this ${permanentBlock.type} is associated with a permanently disabled account.`,
          code: "PERMANENT_BAN_BLOCK"
        });
      }
      const userId = generateUUID();
      const assignedRole = cleanEmail === "ravikantsharma925490@gmail.com" ? "admin" : "user";
      db.prepare(`
        INSERT INTO users (id, email, password_hash, email_confirmed, user_metadata, role, last_device_id, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
      `).run(
        userId,
        cleanEmail,
        hashPassword(String(password)),
        JSON.stringify({ display_name: cleanUsername, username: cleanUsername, country: "India" }),
        assignedRole,
        deviceId,
        nowIso,
        nowIso
      );
      userRow = findUserById(userId);
    } else if (userRow) {
      userRow = await resolveLiveUserRow(userRow.id, syncProfileCacheAfterModeration) || userRow;
      if (userRow.status === "suspended" || userRow.status === "disabled") {
        revokeAllSessionsForUser(userRow.id);
        const appealSession = createSessionForUser(userRow.id, 7, "appeal_only", deviceId);
        return res.status(403).json({
          error: userRow.status === "disabled" ? "Your account has been permanently disabled." : "Your account has been suspended.",
          banned: true,
          accountStatus: userRow.status,
          banReason: userRow.ban_reason || "Community Guidelines violation",
          ruleBroken: userRow.rule_broken || "community_guidelines",
          ruleLabel: formatRuleLabel(userRow.rule_broken),
          banUntil: userRow.ban_until || userRow.banned_until || null,
          bannedUntil: userRow.ban_until || userRow.banned_until || null,
          scheduledDeletionAt: userRow.scheduled_deletion_at || null,
          strikeCount: Number(userRow.strike_count || 0),
          appealSession,
          user: formatAuthUser(userRow)
        });
      }
      db.prepare("UPDATE users SET email_confirmed = 1, status = CASE WHEN status = 'deactivated' THEN 'active' ELSE status END, updated_at = ? WHERE id = ?").run(
        nowIso,
        userRow.id
      );
      userRow = findUserById(userRow.id);
    }
    if (!userRow) {
      return res.status(404).json({ error: "User not found" });
    }
    const profile = ensureProfileRecord(userRow.id, {
      username: cleanUsername,
      display_name: cleanUsername,
      email: cleanEmail
    });
    const session = createSessionForUser(userRow.id, 30, "full", deviceId);
    return res.json({
      success: true,
      userId: userRow.id,
      session,
      user: formatAuthUser(userRow),
      profile
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to confirm user" });
  }
});
app.post("/api/auth/send-otp", async (req, res) => {
  try {
    const { email, type = "signup" } = req.body || {};
    if (!email) return res.status(400).json({ error: "email is required" });
    const cleanEmail = String(email).trim().toLowerCase();
    const code = Math.floor(1e5 + Math.random() * 9e5).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1e3).toISOString();
    db.prepare("DELETE FROM user_otps WHERE LOWER(email) = LOWER(?)").run(cleanEmail);
    db.prepare(
      "INSERT INTO user_otps (id, email, otp_code, type, verified, expires_at, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)"
    ).run(generateUUID(), cleanEmail, code, type, expiresAt, (/* @__PURE__ */ new Date()).toISOString());
    const emailSent = await sendOtpEmail(cleanEmail, code).catch(() => false);
    return res.json({ success: true, otpCode: code, emailSent, dbSaved: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to send OTP email" });
  }
});
app.post("/api/auth/verify-otp", async (req, res) => {
  try {
    const { email, otpCode } = req.body || {};
    if (!email || !otpCode) {
      return res.status(400).json({ error: "email and otpCode are required" });
    }
    const cleanEmail = String(email).trim().toLowerCase();
    const cleanCode = String(otpCode).trim();
    const deviceId = getRequestDeviceId(req);
    const row = db.prepare("SELECT * FROM user_otps WHERE LOWER(email) = LOWER(?) ORDER BY created_at DESC LIMIT 1").get(cleanEmail);
    if (!row) {
      return res.status(400).json({ error: "Verification code not found. Please request a new code." });
    }
    if (row.verified) {
      return res.status(400).json({ error: "This code was already used. Please request a new code." });
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: "This code has expired. Please request a new code." });
    }
    if (String(row.otp_code).trim() !== cleanCode) {
      return res.status(400).json({ error: "Incorrect code. Please check and try again." });
    }
    db.prepare("UPDATE user_otps SET verified = 1 WHERE id = ?").run(row.id);
    let userRow = findUserByEmail(cleanEmail);
    let session = null;
    let user = null;
    let profile = null;
    if (userRow) {
      userRow = await resolveLiveUserRow(userRow.id, syncProfileCacheAfterModeration) || userRow;
      if (userRow.status === "suspended" || userRow.status === "disabled") {
        revokeAllSessionsForUser(userRow.id);
        const appealSession = createSessionForUser(userRow.id, 7, "appeal_only", deviceId);
        return res.status(403).json({
          error: userRow.status === "disabled" ? "Your account has been permanently disabled." : "Your account has been suspended.",
          banned: true,
          accountStatus: userRow.status,
          banReason: userRow.ban_reason || "Community Guidelines violation",
          ruleBroken: userRow.rule_broken || "community_guidelines",
          ruleLabel: formatRuleLabel(userRow.rule_broken),
          banUntil: userRow.ban_until || userRow.banned_until || null,
          bannedUntil: userRow.ban_until || userRow.banned_until || null,
          scheduledDeletionAt: userRow.scheduled_deletion_at || null,
          strikeCount: Number(userRow.strike_count || 0),
          appealSession,
          user: formatAuthUser(userRow)
        });
      }
      db.prepare(
        "UPDATE users SET email_confirmed = 1, status = CASE WHEN status = 'deactivated' THEN 'active' ELSE status END, updated_at = ? WHERE id = ?"
      ).run((/* @__PURE__ */ new Date()).toISOString(), userRow.id);
      userRow = findUserById(userRow.id);
      session = createSessionForUser(userRow.id, 30, "full", deviceId);
      user = formatAuthUser(userRow);
      profile = getProfileById(userRow.id);
    }
    return res.json({ success: true, verified: true, session, user, profile });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to verify OTP" });
  }
});
app.get("/api/auth/check-ban-status", async (req, res) => {
  try {
    const token = extractBearerToken(req);
    if (!token) return res.status(401).json({ error: "Not authenticated" });
    const uid = req.authUserId || await verifyAuthToken(token);
    if (!uid) return res.status(401).json({ error: "Not authenticated" });
    const liveRow = await resolveLiveUserRow(uid, syncProfileCacheAfterModeration);
    if (!liveRow) return res.status(401).json({ error: "Not authenticated" });
    const isBanned = liveRow.status === "suspended" || liveRow.status === "disabled";
    return res.json({
      banned: isBanned,
      accountStatus: liveRow.status,
      banReason: liveRow.ban_reason || null,
      ruleBroken: liveRow.rule_broken || null,
      ruleLabel: formatRuleLabel(liveRow.rule_broken),
      bannedUntil: liveRow.ban_until || liveRow.banned_until || null,
      banUntil: liveRow.ban_until || liveRow.banned_until || null,
      restrictedUntil: liveRow.restricted_until || null,
      scheduledDeletionAt: liveRow.scheduled_deletion_at || null,
      strikeCount: Number(liveRow.strike_count || 0),
      restoredNoticePending: Boolean(liveRow.restored_notice_pending)
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to check ban status" });
  }
});
app.get("/api/account/status", requireAuth, async (req, res) => {
  try {
    const userId = req.authUserId;
    const liveRow = await resolveLiveUserRow(userId, syncProfileCacheAfterModeration);
    if (!liveRow) return res.status(404).json({ error: "Account not found" });
    const profile = getProfileById(userId);
    const historyRows = db.prepare("SELECT * FROM bans WHERE user_id = ? ORDER BY created_at DESC LIMIT 30").all(userId);
    const appealRows = db.prepare("SELECT * FROM appeals WHERE user_id = ? ORDER BY created_at DESC LIMIT 10").all(userId);
    const status = liveRow.status || "active";
    const permissions = {
      canLogin: status === "active" || status === "restricted",
      canSendMessages: status === "active",
      canStartCalls: status === "active",
      canFollowUsers: status === "active",
      profileVisibleToOthers: status === "active" || status === "restricted",
      appearsInSearch: status === "active" || status === "restricted",
      canSubmitAppeal: status === "suspended" || status === "disabled" || status === "restricted",
      canDownloadData: true
    };
    return res.json({
      account: {
        id: liveRow.id,
        email: liveRow.email,
        status,
        strike_count: Number(liveRow.strike_count || 0),
        ban_reason: liveRow.ban_reason || null,
        rule_broken: liveRow.rule_broken || null,
        rule_label: formatRuleLabel(liveRow.rule_broken),
        ban_until: liveRow.ban_until || liveRow.banned_until || null,
        restricted_until: liveRow.restricted_until || null,
        scheduled_deletion_at: liveRow.scheduled_deletion_at || null,
        restored_at: liveRow.restored_at || null,
        restored_notice_pending: Boolean(liveRow.restored_notice_pending),
        role: liveRow.role || "user"
      },
      profile,
      history: historyRows.map((r) => ({ ...r, action: r.action_type || r.action, is_active: Boolean(r.is_active) })),
      appeals: appealRows,
      permissions
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to fetch account status" });
  }
});
app.post("/api/account/acknowledge-restored", requireAuth, (req, res) => {
  try {
    const userId = req.authUserId;
    db.prepare("UPDATE users SET restored_notice_pending = 0, updated_at = ? WHERE id = ?").run(
      (/* @__PURE__ */ new Date()).toISOString(),
      userId
    );
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to acknowledge restore notice" });
  }
});
app.post("/api/account/deactivate", requireAuth, (req, res) => {
  try {
    const userId = req.authUserId;
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    db.prepare("UPDATE users SET status = 'deactivated', updated_at = ? WHERE id = ?").run(nowIso, userId);
    db.prepare("UPDATE profiles SET is_online = 0, last_seen = ?, updated_at = ? WHERE id = ?").run(
      nowIso,
      nowIso,
      userId
    );
    revokeAllSessionsForUser(userId);
    writeAuditLog({
      adminId: userId,
      targetUserId: userId,
      action: "deactivate",
      reason: String(req.body?.reason || "User voluntarily deactivated their account.")
    });
    syncProfileCacheAfterModeration(userId, "deactivated");
    return res.json({ success: true, status: "deactivated" });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to deactivate account" });
  }
});
app.get("/api/account/export-data", requireAuth, (req, res) => {
  try {
    const userId = req.authUserId;
    const userRow = findUserById(userId);
    if (!userRow) return res.status(404).json({ error: "User not found" });
    const profile = getProfileById(userId);
    const follows = db.prepare("SELECT follower_id, following_id, created_at FROM follows WHERE follower_id = ? OR following_id = ?").all(userId, userId);
    const messages = db.prepare("SELECT id, conversation_id, sender_id, content, created_at FROM messages WHERE sender_id = ? ORDER BY created_at DESC LIMIT 500").all(userId);
    const calls = db.prepare("SELECT id, caller_id, callee_id, call_type, status, started_at, ended_at FROM calls WHERE caller_id = ? OR callee_id = ? ORDER BY created_at DESC LIMIT 200").all(userId, userId);
    const bans = db.prepare("SELECT * FROM bans WHERE user_id = ? ORDER BY created_at DESC").all(userId);
    const appeals = db.prepare("SELECT * FROM appeals WHERE user_id = ? ORDER BY created_at DESC").all(userId);
    const exportPayload = {
      exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
      account: formatAuthUser(userRow),
      profile,
      follows,
      messagesSentCount: messages.length,
      messages,
      calls,
      moderationHistory: bans,
      appeals
    };
    const safeUsername = profile?.username || "user";
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="liveconnect-export-${safeUsername}.json"`);
    return res.send(JSON.stringify(exportPayload, null, 2));
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to export user data" });
  }
});
app.get("/api/account/templates", requireAuth, (req, res) => {
  const userId = req.authUserId;
  const userRow = findUserById(userId);
  const profile = getProfileById(userId);
  const displayName = profile?.display_name || userRow?.email?.split("@")[0] || "Alex Morgan";
  const username = profile?.username || "alex_morgan";
  const email = userRow?.email || "user@example.com";
  const templates = {
    warning: buildModerationTemplate({
      kind: "warning",
      displayName,
      username,
      email,
      reason: "Repeated unsolicited messages flagged by safety filters.",
      ruleBroken: "spam",
      strikeCount: 1
    }),
    restricted: buildModerationTemplate({
      kind: "restricted",
      displayName,
      username,
      email,
      reason: "Abusive language in direct messages (2nd strike).",
      ruleBroken: "harassment",
      strikeCount: 2,
      banUntil: new Date(Date.now() + 2 * 24 * 3600 * 1e3).toISOString()
    }),
    suspend: buildModerationTemplate({
      kind: "suspend",
      displayName,
      username,
      email,
      reason: userRow?.ban_reason || "Continued violations after prior warnings (3rd strike).",
      ruleBroken: userRow?.rule_broken || "harassment",
      strikeCount: Math.max(3, Number(userRow?.strike_count || 3)),
      banUntil: userRow?.ban_until || new Date(Date.now() + 7 * 24 * 3600 * 1e3).toISOString()
    }),
    permanent_ban: buildModerationTemplate({
      kind: "permanent_ban",
      displayName,
      username,
      email,
      reason: userRow?.ban_reason || "Severe safety policy violation.",
      ruleBroken: userRow?.rule_broken || "scam",
      strikeCount: Math.max(4, Number(userRow?.strike_count || 4)),
      scheduledDeletionAt: userRow?.scheduled_deletion_at || new Date(Date.now() + 30 * 24 * 3600 * 1e3).toISOString()
    }),
    restore: buildModerationTemplate({
      kind: "restore",
      displayName,
      username,
      email,
      reason: "Your appeal was approved and your account access has been restored.",
      ruleBroken: "account_restored",
      strikeCount: Math.max(0, Number(userRow?.strike_count || 0))
    })
  };
  return res.json({ templates });
});
app.post("/api/appeals/upload", requireAuth, appealRateLimiter, async (req, res) => {
  try {
    const userId = req.authUserId;
    const { base64Data, mimeType, fileName } = req.body || {};
    if (!base64Data || typeof base64Data !== "string") {
      return res.status(400).json({ error: "Verification image data is required" });
    }
    const cleanBase64 = base64Data.includes(",") ? base64Data.split(",")[1] : base64Data;
    const buf = Buffer.from(cleanBase64, "base64");
    if (buf.length === 0 || buf.length > 5 * 1024 * 1024) {
      return res.status(400).json({ error: "Verification document must be between 1 byte and 5 MB" });
    }
    const cleanMime = String(mimeType || "image/jpeg").split(";")[0].trim().toLowerCase();
    const ext = cleanMime.includes("png") ? "png" : cleanMime.includes("webp") ? "webp" : cleanMime.includes("pdf") ? "pdf" : "jpg";
    const fileId = `appeal_${userId.slice(0, 8)}_${Date.now()}.${ext}`;
    const filePath = import_path3.default.join(UPLOADS_DIR, fileId);
    import_fs3.default.writeFileSync(filePath, buf);
    mediaFilesStore.set(fileId, {
      id: fileId,
      buffer: buf,
      mimeType: cleanMime,
      fileName: fileName || fileId,
      size: buf.length,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    return res.json({
      success: true,
      url: `/api/media/file/${fileId}`,
      fileName: fileName || fileId
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to upload verification document" });
  }
});
app.post("/api/appeals", requireAuth, appealRateLimiter, async (req, res) => {
  try {
    const userId = req.authUserId;
    const { reason, verificationDocUrl, verificationDocName } = req.body || {};
    const cleanReason = String(reason || "").trim();
    if (cleanReason.length < 10) {
      return res.status(400).json({ error: "Please explain your appeal in at least 10 characters." });
    }
    const existingPending = db.prepare("SELECT id FROM appeals WHERE user_id = ? AND status = 'pending' LIMIT 1").get(userId);
    if (existingPending) {
      return res.status(409).json({
        error: "You already have a pending appeal under review. Please wait for a decision."
      });
    }
    const activeBan = db.prepare("SELECT id FROM bans WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1").get(userId);
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const decisionDueAt = new Date(Date.now() + 48 * 60 * 60 * 1e3).toISOString();
    const appealId = generateId();
    db.prepare(`
      INSERT INTO appeals (
        id, user_id, ban_id, reason, verification_doc_url, verification_doc_name,
        status, decision_due_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    `).run(
      appealId,
      userId,
      activeBan?.id || null,
      cleanReason.slice(0, 2e3),
      verificationDocUrl || null,
      verificationDocName || null,
      decisionDueAt,
      nowIso,
      nowIso
    );
    writeAuditLog({
      adminId: userId,
      targetUserId: userId,
      action: "appeal_submitted",
      reason: cleanReason.slice(0, 300),
      details: { appealId, hasDoc: Boolean(verificationDocUrl) }
    });
    const userRow = findUserById(userId);
    const prof = getProfileById(userId);
    if (userRow?.email) {
      const tpl = buildModerationTemplate({
        kind: "appeal_update",
        displayName: prof?.display_name || userRow.email.split("@")[0],
        username: prof?.username || "user",
        email: userRow.email,
        reason: "We received your review request. Our Trust & Safety team will review it within 48 hours.",
        ruleBroken: userRow.rule_broken || "community_guidelines",
        strikeCount: Number(userRow.strike_count || 0)
      });
      void sendModerationEmail(userRow.email, tpl);
    }
    const appeal = db.prepare("SELECT * FROM appeals WHERE id = ?").get(appealId);
    return res.status(201).json({ success: true, appeal });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to submit appeal" });
  }
});
app.get("/api/appeals/me", requireAuth, (req, res) => {
  try {
    const userId = req.authUserId;
    const rows = db.prepare("SELECT * FROM appeals WHERE user_id = ? ORDER BY created_at DESC LIMIT 20").all(userId);
    return res.json({ appeals: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to fetch appeals" });
  }
});
app.get("/api/admin/users", requireAuth, requireModeratorOrAdmin, (req, res) => {
  try {
    const q = String(req.query.q || "").trim().toLowerCase();
    const statusFilter = String(req.query.status || "all").trim().toLowerCase();
    const rows = db.prepare(`
        SELECT u.id, u.email, u.phone, u.status, u.strike_count, u.ban_reason, u.rule_broken,
               u.ban_until, u.restricted_until, u.scheduled_deletion_at, u.role, u.created_at, u.updated_at,
               p.username, p.display_name, p.avatar_url, p.is_online
        FROM users u
        LEFT JOIN profiles p ON p.id = u.id
        ORDER BY u.updated_at DESC
        LIMIT 200
      `).all();
    const filtered = rows.filter((r) => {
      if (statusFilter && statusFilter !== "all" && (r.status || "active") !== statusFilter) {
        return false;
      }
      if (!q) return true;
      return String(r.email || "").toLowerCase().includes(q) || String(r.username || "").toLowerCase().includes(q) || String(r.display_name || "").toLowerCase().includes(q) || String(r.id || "").toLowerCase().includes(q);
    }).map((r) => ({
      ...r,
      strike_count: Number(r.strike_count || 0),
      rule_label: formatRuleLabel(r.rule_broken),
      is_online: Boolean(r.is_online) && !isAccountHiddenStatus(r.status)
    }));
    return res.json({ users: filtered });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to fetch admin users list" });
  }
});
app.get("/api/admin/users/:userId", requireAuth, requireModeratorOrAdmin, (req, res) => {
  try {
    const { userId } = req.params;
    const userRow = findUserById(userId);
    if (!userRow) return res.status(404).json({ error: "User not found" });
    const profile = getProfileById(userId);
    const bans = db.prepare("SELECT * FROM bans WHERE user_id = ? ORDER BY created_at DESC LIMIT 50").all(userId);
    const appeals = db.prepare("SELECT * FROM appeals WHERE user_id = ? ORDER BY created_at DESC LIMIT 20").all(userId);
    const problemReports = db.prepare("SELECT * FROM problem_reports WHERE user_id = ? ORDER BY created_at DESC LIMIT 20").all(userId);
    const incomingUserReports = db.prepare(`
        SELECT ur.*, p.username as reporter_username, p.display_name as reporter_display_name
        FROM user_reports ur
        LEFT JOIN profiles p ON p.id = ur.reporter_id
        WHERE ur.reported_user_id = ?
        ORDER BY ur.created_at DESC
        LIMIT 30
      `).all(userId);
    const reports = [
      ...incomingUserReports.map((r) => ({
        ...r,
        report_type: "user_report",
        description: r.details || `Reported from ${r.source} (${r.category})`
      })),
      ...problemReports.map((r) => ({
        ...r,
        report_type: "problem_report"
      }))
    ];
    const auditLogs = db.prepare("SELECT * FROM audit_logs WHERE target_user_id = ? ORDER BY created_at DESC LIMIT 50").all(userId);
    return res.json({
      user: formatAuthUser(userRow),
      profile,
      bans: bans.map((b) => ({
        ...b,
        action: b.action_type || b.action,
        is_active: Boolean(b.is_active),
        rule_label: formatRuleLabel(b.rule_broken)
      })),
      appeals,
      reports,
      auditLogs
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to fetch user moderation detail" });
  }
});
async function handleAdminModerate(req, res) {
  try {
    const adminId = req.authUserId;
    const { targetUserId, action, reason, ruleBroken, durationDays } = req.body || {};
    if (!targetUserId || !action) {
      return res.status(400).json({ error: "targetUserId and action are required" });
    }
    const result = await executeModerationAction({
      adminId,
      targetUserId,
      action,
      reason,
      ruleBroken,
      durationDays: durationDays ? Number(durationDays) : void 0,
      onStatusUpdated: syncProfileCacheAfterModeration
    });
    return res.json({
      success: true,
      user: formatAuthUser(result.user),
      banId: result.banId,
      statusApplied: result.statusApplied,
      strikeCount: result.strikeCount,
      emailSent: result.emailSent
    });
  } catch (err) {
    return res.status(err?.statusCode || 500).json({ error: err.message || "Moderation action failed" });
  }
}
app.post("/api/admin/moderate", requireAuth, requireModeratorOrAdmin, handleAdminModerate);
app.post("/api/admin/ban-user", requireAuth, requireModeratorOrAdmin, async (req, res) => {
  try {
    const adminId = req.authUserId;
    const { targetUserId, targetEmail, reason, ruleBroken, durationDays, action } = req.body || {};
    let resolvedTargetId = targetUserId;
    if (!resolvedTargetId && targetEmail) {
      const u = findUserByEmail(String(targetEmail));
      if (u) resolvedTargetId = u.id;
    }
    if (!resolvedTargetId) {
      return res.status(400).json({ error: "targetUserId or valid targetEmail is required" });
    }
    const result = await executeModerationAction({
      adminId,
      targetUserId: resolvedTargetId,
      action: action || "suspend",
      reason: reason || "Violation of LiveConnect Community Guidelines & Safety Policies",
      ruleBroken: ruleBroken || "community_guidelines",
      durationDays: durationDays ? Number(durationDays) : 7,
      onStatusUpdated: syncProfileCacheAfterModeration
    });
    return res.json({
      success: true,
      bannedUserId: resolvedTargetId,
      statusApplied: result.statusApplied,
      strikeCount: result.strikeCount,
      emailSent: result.emailSent
    });
  } catch (error) {
    return res.status(error?.statusCode || 500).json({ error: error.message || "Failed to ban user" });
  }
});
app.get("/api/admin/appeals", requireAuth, requireModeratorOrAdmin, (req, res) => {
  try {
    const statusFilter = String(req.query.status || "all").trim().toLowerCase();
    const rows = db.prepare(`
        SELECT a.*, u.email, u.status as user_status, u.strike_count, u.ban_reason, u.rule_broken, u.ban_until,
               p.username, p.display_name, p.avatar_url
        FROM appeals a
        LEFT JOIN users u ON u.id = a.user_id
        LEFT JOIN profiles p ON p.id = a.user_id
        ORDER BY CASE WHEN a.status = 'pending' THEN 0 ELSE 1 END, a.created_at DESC
        LIMIT 100
      `).all();
    const appeals = rows.filter((r) => statusFilter === "all" || r.status === statusFilter).map((r) => ({
      id: r.id,
      user_id: r.user_id,
      ban_id: r.ban_id,
      reason: r.reason,
      verification_doc_url: r.verification_doc_url,
      verification_doc_name: r.verification_doc_name,
      status: r.status,
      admin_id: r.admin_id,
      admin_note: r.admin_note,
      decision_due_at: r.decision_due_at,
      reviewed_at: r.reviewed_at,
      created_at: r.created_at,
      updated_at: r.updated_at,
      user: {
        id: r.user_id,
        username: r.username || "user",
        display_name: r.display_name || r.email || "User",
        email: r.email,
        avatar_url: r.avatar_url || null,
        status: r.user_status || "active",
        strike_count: Number(r.strike_count || 0),
        ban_reason: r.ban_reason || null,
        rule_broken: r.rule_broken || null,
        ban_until: r.ban_until || null
      }
    }));
    return res.json({ appeals });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to load appeals queue" });
  }
});
app.post("/api/admin/appeals/:appealId/review", requireAuth, requireModeratorOrAdmin, async (req, res) => {
  try {
    const adminId = req.authUserId;
    const { appealId } = req.params;
    const { decision, note } = req.body || {};
    if (decision !== "approved" && decision !== "rejected") {
      return res.status(400).json({ error: 'decision must be "approved" or "rejected"' });
    }
    const appeal = db.prepare("SELECT * FROM appeals WHERE id = ?").get(appealId);
    if (!appeal) return res.status(404).json({ error: "Appeal not found" });
    if (appeal.status !== "pending") {
      return res.status(409).json({ error: `Appeal was already ${appeal.status}.` });
    }
    const targetRow = findUserById(appeal.user_id);
    if (targetRow?.role === "admin" && decision === "rejected") {
      return res.status(403).json({ error: "Cannot uphold ban against an admin." });
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const adminNote = String(note || (decision === "approved" ? "Appeal approved upon review." : "Violation confirmed upon manual review.")).trim();
    db.prepare(
      "UPDATE appeals SET status = ?, admin_id = ?, admin_note = ?, reviewed_at = ?, updated_at = ? WHERE id = ?"
    ).run(decision, adminId, adminNote, nowIso, nowIso, appealId);
    if (decision === "approved") {
      await restoreUserAccount({
        targetUserId: appeal.user_id,
        adminId,
        reason: adminNote,
        decrementStrike: true,
        isAuto: false,
        onStatusUpdated: syncProfileCacheAfterModeration
      });
      writeAuditLog({
        adminId,
        targetUserId: appeal.user_id,
        action: "appeal_approved",
        reason: adminNote,
        details: { appealId, strikeReduced: true }
      });
    } else {
      writeAuditLog({
        adminId,
        targetUserId: appeal.user_id,
        action: "appeal_rejected",
        reason: adminNote,
        details: { appealId }
      });
      const prof = getProfileById(appeal.user_id);
      if (targetRow?.email) {
        const tpl = buildModerationTemplate({
          kind: "appeal_update",
          displayName: prof?.display_name || targetRow.email.split("@")[0],
          username: prof?.username || "user",
          email: targetRow.email,
          reason: "Your appeal was reviewed and not approved.",
          ruleBroken: targetRow.rule_broken || "community_guidelines",
          strikeCount: Number(targetRow.strike_count || 0),
          adminNote
        });
        void sendModerationEmail(targetRow.email, tpl);
      }
    }
    const updatedAppeal = db.prepare("SELECT * FROM appeals WHERE id = ?").get(appealId);
    return res.json({ success: true, appeal: updatedAppeal });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to review appeal" });
  }
});
app.get("/api/admin/audit-logs", requireAuth, requireModeratorOrAdmin, (req, res) => {
  try {
    const limit = Math.min(200, Math.max(10, Number(req.query.limit || 100)));
    const rows = db.prepare(`
        SELECT a.*, ap.username as admin_username, tp.username as target_username
        FROM audit_logs a
        LEFT JOIN profiles ap ON ap.id = a.admin_id
        LEFT JOIN profiles tp ON tp.id = a.target_user_id
        ORDER BY a.created_at DESC
        LIMIT ?
      `).all(limit);
    return res.json({ logs: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to fetch audit logs" });
  }
});
var VALID_USER_REPORT_CATEGORIES = /* @__PURE__ */ new Set([
  "spam",
  "harassment",
  "hate_speech",
  "nudity_sexual",
  "impersonation",
  "scam_fraud",
  "violence_threats",
  "child_safety",
  "underage",
  "privacy_violation",
  "abusive_calls",
  "other"
]);
var VALID_USER_REPORT_SOURCES = /* @__PURE__ */ new Set(["profile", "chat", "search", "call", "family_chat"]);
var VALID_USER_REPORT_STATUSES = /* @__PURE__ */ new Set(["pending", "under_review", "resolved", "dismissed"]);
app.get("/api/admin/reports", requireAuth, requireModeratorOrAdmin, (req, res) => {
  try {
    const statusFilter = String(req.query.status || "all").trim().toLowerCase();
    const rows = db.prepare(`
        SELECT ur.*,
               rp.username as reporter_username, rp.display_name as reporter_display_name, rp.avatar_url as reporter_avatar_url,
               tp.username as target_username, tp.display_name as target_display_name, tp.avatar_url as target_avatar_url,
               tu.email as target_email, tu.status as target_status, tu.strike_count as target_strike_count
        FROM user_reports ur
        LEFT JOIN profiles rp ON rp.id = ur.reporter_id
        LEFT JOIN profiles tp ON tp.id = ur.reported_user_id
        LEFT JOIN users tu ON tu.id = ur.reported_user_id
        ORDER BY
          CASE ur.status
            WHEN 'pending' THEN 0
            WHEN 'under_review' THEN 1
            ELSE 2
          END,
          ur.created_at DESC
        LIMIT 200
      `).all();
    const reports = rows.filter((r) => statusFilter === "all" || r.status === statusFilter).map((r) => ({
      id: r.id,
      reporter_id: r.reporter_id,
      reported_user_id: r.reported_user_id,
      reported_username: r.reported_username || r.target_username || null,
      reported_display_name: r.reported_display_name || r.target_display_name || null,
      category: r.category,
      details: r.details || null,
      source: r.source,
      conversation_id: r.conversation_id || null,
      family_id: r.family_id || null,
      family_name: r.family_name || null,
      reported_message_id: r.reported_message_id || null,
      reported_message_content: r.reported_message_content || null,
      reported_message_media_url: r.reported_message_media_url || null,
      also_blocked: Boolean(r.also_blocked),
      status: r.status,
      admin_id: r.admin_id || null,
      admin_note: r.admin_note || null,
      reviewed_at: r.reviewed_at || null,
      created_at: r.created_at,
      updated_at: r.updated_at,
      reporter: {
        id: r.reporter_id,
        username: r.reporter_username || "user",
        display_name: r.reporter_display_name || "User",
        avatar_url: r.reporter_avatar_url || null
      },
      reported_user: {
        id: r.reported_user_id,
        username: r.target_username || r.reported_username || "user",
        display_name: r.target_display_name || r.reported_display_name || "User",
        email: r.target_email || null,
        avatar_url: r.target_avatar_url || null,
        status: r.target_status || "active",
        strike_count: Number(r.target_strike_count || 0)
      }
    }));
    return res.json({ reports });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to load user reports queue" });
  }
});
app.post("/api/admin/reports/:reportId/review", requireAuth, requireModeratorOrAdmin, async (req, res) => {
  try {
    const adminId = req.authUserId;
    const { reportId } = req.params;
    const { status, note, moderationAction, ruleBroken, durationDays } = req.body || {};
    if (!status || !VALID_USER_REPORT_STATUSES.has(String(status))) {
      return res.status(400).json({ error: "Valid status (pending, under_review, resolved, dismissed) is required" });
    }
    const report = db.prepare("SELECT * FROM user_reports WHERE id = ?").get(reportId);
    if (!report) return res.status(404).json({ error: "Report not found" });
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const adminNote = note ? String(note).trim().slice(0, 500) : null;
    const reviewedAt = status === "resolved" || status === "dismissed" ? nowIso : report.reviewed_at || null;
    db.prepare(
      "UPDATE user_reports SET status = ?, admin_id = ?, admin_note = ?, reviewed_at = ?, updated_at = ? WHERE id = ?"
    ).run(status, adminId, adminNote ?? report.admin_note ?? null, reviewedAt, nowIso, reportId);
    let moderationResult = null;
    if (moderationAction && ["warn", "restrict", "suspend", "permanent_ban"].includes(String(moderationAction))) {
      moderationResult = await executeModerationAction({
        adminId,
        targetUserId: report.reported_user_id,
        action: moderationAction,
        reason: adminNote || `Action taken following user report (${report.category})`,
        ruleBroken: ruleBroken || "community_guidelines",
        durationDays: durationDays ? Number(durationDays) : 7,
        onStatusUpdated: syncProfileCacheAfterModeration
      });
    } else {
      writeAuditLog({
        adminId,
        targetUserId: report.reported_user_id,
        action: `report_${status}`,
        reason: adminNote || `Marked user report (${report.category}) as ${status}`,
        details: { reportId, category: report.category, reporterId: report.reporter_id }
      });
    }
    const updated = db.prepare("SELECT * FROM user_reports WHERE id = ?").get(reportId);
    return res.json({
      success: true,
      report: updated,
      moderationApplied: moderationResult ? moderationResult.statusApplied : null
    });
  } catch (err) {
    return res.status(err?.statusCode || 500).json({ error: err.message || "Failed to update report" });
  }
});
var truecallerVerifications = /* @__PURE__ */ new Map();
var pcPhoneOtpStore = /* @__PURE__ */ new Map();
setInterval(() => {
  const now = Date.now();
  for (const [reqId, record] of truecallerVerifications.entries()) {
    if (now - record.createdAt > 15 * 60 * 1e3) {
      truecallerVerifications.delete(reqId);
    }
  }
}, 5 * 60 * 1e3);
var TRUECALLER_APP_KEY = (process.env.TRUECALLER_APP_KEY || process.env.VITE_TRUECALLER_APP_KEY || "VVB4Vacf5545a70f7467094bc0747d59a9819").trim();
app.post("/api/auth/truecaller/initiate", (req, res) => {
  try {
    const nonce = `tc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    truecallerVerifications.set(nonce, {
      requestId: nonce,
      status: "pending",
      createdAt: Date.now()
    });
    const partnerKey = TRUECALLER_APP_KEY;
    const partnerName = encodeURIComponent("Live Connect APP");
    const privacyUrl = encodeURIComponent("https://live-connect-o0u7.onrender.com");
    const termsUrl = encodeURIComponent("https://live-connect-o0u7.onrender.com");
    const countryCode = (req.body?.countryCode || req.query?.countryCode || "IN").toString().toUpperCase();
    const params = `type=btmsheet&requestNonce=${nonce}&partnerKey=${partnerKey}&partnerName=${partnerName}&countryCode=${countryCode}&lang=en&title=login&privacyUrl=${privacyUrl}&termsUrl=${termsUrl}&loginPrefix=continue&loginSuffix=login&ctaPrefix=proceed&ctaColor=%230087FF&ctaTextColor=%23ffffff&btnShape=round&skipOption=useanothermethod&ttl=120000`;
    const deepLink = `truecallersdk://truesdk/web_verify?${params}`;
    const androidIntent = `intent://truesdk/web_verify?${params}#Intent;scheme=truecallersdk;package=com.truecaller;end`;
    return res.json({
      success: true,
      requestId: nonce,
      partnerKey,
      deepLink,
      androidIntent,
      expiresIn: 300
    });
  } catch {
    return res.status(500).json({ error: "Failed to initiate Truecaller verification" });
  }
});
async function processTruecallerVerifiedProfile(requestId, rawPhone, displayName, avatarUrl, country, deviceId) {
  try {
    const cleanDigits = rawPhone.replace(/\D/g, "");
    const formattedPhone = cleanDigits.length === 10 ? `+91${cleanDigits}` : `+${cleanDigits}`;
    const userEmail = `tc_${cleanDigits}@liveconnect.app`;
    let userRow = findUserByEmail(userEmail);
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const baseUsername = (displayName || `user_${cleanDigits.slice(-4)}`).toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 15) || `user_${cleanDigits.slice(-4)}`;
    if (!userRow) {
      const permanentBlock = findPermanentBanByIdentifier({
        email: userEmail,
        phone: formattedPhone,
        deviceId: deviceId || null
      });
      if (permanentBlock) {
        const errMsg = `Account creation is permanently blocked because this ${permanentBlock.type} is associated with a permanently disabled account.`;
        truecallerVerifications.set(requestId, {
          requestId,
          status: "failed",
          error: errMsg,
          createdAt: Date.now()
        });
        return { success: false, error: errMsg };
      }
      const userId = generateUUID();
      const meta = {
        display_name: displayName || `User ${cleanDigits.slice(-4)}`,
        username: baseUsername,
        avatar_url: avatarUrl || null,
        phone: formattedPhone,
        verified_by: "truecaller"
      };
      db.prepare(`
        INSERT INTO users (id, email, password_hash, email_confirmed, phone, user_metadata, last_device_id, created_at, updated_at)
        VALUES (?, ?, NULL, 1, ?, ?, ?, ?, ?)
      `).run(userId, userEmail, formattedPhone, JSON.stringify(meta), deviceId || null, nowIso, nowIso);
      userRow = findUserById(userId);
    } else {
      userRow = await resolveLiveUserRow(userRow.id, syncProfileCacheAfterModeration) || userRow;
      if (userRow.status === "suspended" || userRow.status === "disabled") {
        revokeAllSessionsForUser(userRow.id);
        const appealSession = createSessionForUser(userRow.id, 7, "appeal_only", deviceId || null);
        const errMsg = userRow.status === "disabled" ? "Your account has been permanently disabled." : "Your account has been suspended.";
        truecallerVerifications.set(requestId, {
          requestId,
          status: "failed",
          error: errMsg,
          createdAt: Date.now()
        });
        return {
          success: false,
          banned: true,
          accountStatus: userRow.status,
          banReason: userRow.ban_reason || "Community Guidelines violation",
          ruleBroken: userRow.rule_broken || "community_guidelines",
          ruleLabel: formatRuleLabel(userRow.rule_broken),
          banUntil: userRow.ban_until || userRow.banned_until || null,
          bannedUntil: userRow.ban_until || userRow.banned_until || null,
          scheduledDeletionAt: userRow.scheduled_deletion_at || null,
          strikeCount: Number(userRow.strike_count || 0),
          appealSession,
          user: formatAuthUser(userRow),
          error: errMsg
        };
      }
      if (userRow.status === "deactivated") {
        db.prepare("UPDATE users SET status = 'active', updated_at = ? WHERE id = ?").run(nowIso, userRow.id);
        userRow = findUserById(userRow.id);
      }
    }
    const userProfile = ensureProfileRecord(userRow.id, {
      username: baseUsername,
      display_name: displayName || `User ${cleanDigits.slice(-4)}`,
      avatar_url: avatarUrl || null,
      phone_number: formattedPhone,
      country: country || "India",
      bio: "Verified with Truecaller on LiveConnect.",
      email: userEmail
    });
    const session = createSessionForUser(userRow.id, 30, "full", deviceId || null);
    const authUser = formatAuthUser(userRow);
    truecallerVerifications.set(requestId, {
      requestId,
      status: "completed",
      profile: userProfile,
      user: authUser,
      session,
      createdAt: Date.now()
    });
    return { success: true, profile: userProfile, user: authUser, session };
  } catch (err) {
    truecallerVerifications.set(requestId, {
      requestId,
      status: "failed",
      error: err.message || "Failed to authenticate Truecaller user",
      createdAt: Date.now()
    });
    return { success: false, error: err.message };
  }
}
async function handleTruecallerCallback(req, res) {
  try {
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
      }
    }
    const { requestId, accessToken, endpoint } = body || {};
    res.status(200).json({ status: "ok", received: true });
    if (!requestId || !accessToken) return;
    const profileUrl = endpoint || "https://profile4-noneu.truecaller.com/v1/default";
    try {
      const tcRes = await fetch(profileUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Cache-Control": "no-cache"
        }
      });
      if (!tcRes.ok) {
        truecallerVerifications.set(requestId, {
          requestId,
          status: "failed",
          error: `Truecaller Profile API returned status ${tcRes.status}`,
          createdAt: Date.now()
        });
        return;
      }
      const tcData = await tcRes.json();
      const phone = tcData.phoneNumber || (Array.isArray(tcData.phoneNumbers) ? tcData.phoneNumbers[0] : "") || "";
      const firstName = tcData.name?.first || tcData.firstName || "";
      const lastName = tcData.name?.last || tcData.lastName || "";
      const fullName = [firstName, lastName].filter(Boolean).join(" ") || "Truecaller User";
      const avatar = tcData.avatarUrl || tcData.image || null;
      const country = tcData.address?.countryCode || tcData.countryCode || "India";
      await processTruecallerVerifiedProfile(requestId, phone, fullName, avatar, country);
    } catch (fetchErr) {
      truecallerVerifications.set(requestId, {
        requestId,
        status: "failed",
        error: fetchErr.message || "Error communicating with Truecaller Profile API",
        createdAt: Date.now()
      });
    }
  } catch (err) {
    try {
      res.status(500).json({ error: err.message });
    } catch {
    }
  }
}
app.post("/auth/callback", handleTruecallerCallback);
app.post("/api/auth/truecaller/callback", handleTruecallerCallback);
app.get("/auth/callback", (_req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><title>Truecaller Verification - LiveConnect</title>
<style>body{font-family:sans-serif;background:#0a0a0a;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}.card{background:#171717;border:1px solid #262626;border-radius:20px;padding:40px 24px;max-width:400px;width:90%}</style>
</head>
<body><div class="card"><h2>Truecaller Verified!</h2><p>Redirecting you back to LiveConnect...</p></div>
<script>setTimeout(function(){window.location.href='/';},1500);</script></body></html>`);
});
app.get("/api/auth/truecaller/status", (req, res) => {
  const requestId = String(req.query.requestId || "").trim();
  if (!requestId) {
    return res.status(400).json({ error: "requestId query parameter is required" });
  }
  const record = truecallerVerifications.get(requestId);
  if (!record) {
    return res.json({ status: "pending", notFoundYet: true });
  }
  return res.json({
    status: record.status,
    profile: record.profile || null,
    user: record.user || null,
    session: record.session || null,
    error: record.error || null
  });
});
app.post("/api/auth/truecaller/send-otp", (req, res) => {
  try {
    const { phoneNumber } = req.body || {};
    if (!phoneNumber) return res.status(400).json({ error: "Mobile number is required" });
    const cleanDigits = String(phoneNumber).replace(/\D/g, "");
    if (cleanDigits.length < 7) {
      return res.status(400).json({ error: "Please enter a valid mobile number" });
    }
    const code = Math.floor(1e5 + Math.random() * 9e5).toString();
    pcPhoneOtpStore.set(cleanDigits, { code, expiresAt: Date.now() + 5 * 60 * 1e3, attempts: 0 });
    return res.json({ success: true, message: `Verification code sent to ${phoneNumber}`, expiresIn: 300 });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to send verification code" });
  }
});
app.post("/api/auth/truecaller/verify-otp", async (req, res) => {
  try {
    const { phoneNumber, code, name, requestId: customRequestId } = req.body || {};
    if (!phoneNumber || !code) {
      return res.status(400).json({ error: "Phone number and verification code are required" });
    }
    const cleanDigits = String(phoneNumber).replace(/\D/g, "");
    const cleanCode = String(code).trim();
    const record = pcPhoneOtpStore.get(cleanDigits);
    if (!record) {
      return res.status(400).json({ error: "Verification code expired or not found." });
    }
    if (Date.now() > record.expiresAt) {
      pcPhoneOtpStore.delete(cleanDigits);
      return res.status(400).json({ error: "Verification code expired." });
    }
    if (record.code !== cleanCode) {
      record.attempts = (record.attempts || 0) + 1;
      if (record.attempts >= 5) {
        pcPhoneOtpStore.delete(cleanDigits);
        return res.status(400).json({ error: "Too many invalid attempts." });
      }
      return res.status(400).json({ error: "Incorrect verification code." });
    }
    pcPhoneOtpStore.delete(cleanDigits);
    const reqId = customRequestId || `tc_manual_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const displayName = String(name || `User ${cleanDigits.slice(-4)}`).trim();
    const deviceId = getRequestDeviceId(req);
    const result = await processTruecallerVerifiedProfile(reqId, cleanDigits, displayName, void 0, "India", deviceId);
    if (!result.success) {
      return res.status(result.banned ? 403 : 500).json(result);
    }
    return res.json({ success: true, requestId: reqId, profile: result.profile, user: result.user, session: result.session });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to verify code" });
  }
});
app.post("/api/auth/truecaller/verify-number", async (req, res) => {
  try {
    const { phoneNumber, name, requestId: customRequestId } = req.body || {};
    if (!phoneNumber) return res.status(400).json({ error: "Mobile number is required" });
    const cleanDigits = String(phoneNumber).replace(/\D/g, "");
    if (cleanDigits.length < 10) {
      return res.status(400).json({ error: "Please enter a valid 10-digit mobile number" });
    }
    const reqId = customRequestId || `tc_manual_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const displayName = String(name || `User ${cleanDigits.slice(-4)}`).trim();
    const deviceId = getRequestDeviceId(req);
    const result = await processTruecallerVerifiedProfile(reqId, cleanDigits, displayName, void 0, "India", deviceId);
    if (!result.success) {
      return res.status(result.banned ? 403 : 500).json(result);
    }
    return res.json({ success: true, requestId: reqId, profile: result.profile, user: result.user, session: result.session });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to verify mobile number" });
  }
});
app.post("/api/auth/notify-login", async (req, res) => {
  try {
    const { email, name: rawName, displayName } = req.body || {};
    if (!email) return res.status(400).json({ error: "email is required" });
    const cleanEmail = String(email).trim().toLowerCase();
    const name = String(rawName || displayName || cleanEmail.split("@")[0]).trim();
    const user = process.env.SMTP_USER || process.env.GMAIL_USER;
    const pass = process.env.SMTP_PASS || process.env.GMAIL_PASS;
    if (process.env.DISABLE_SMTP === "true" || !user || !pass) {
      return res.json({ success: true, message: "SMTP disabled or unconfigured" });
    }
    const transporter = createStandardTransporter();
    await transporter.sendMail({
      from: `"LiveConnect Security" <${user}>`,
      to: cleanEmail,
      subject: "New Sign-in Notification - LiveConnect",
      html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#0a0a0a;border-radius:16px;color:#fff;"><h2>LiveConnect</h2><p>New sign-in to your account: <strong>${name}</strong> (${cleanEmail})</p></div>`
    });
    return res.json({ success: true });
  } catch {
    return res.json({ success: false, message: "Email notification skipped" });
  }
});
app.post("/api/presence/heartbeat", (req, res) => {
  try {
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
      }
    }
    const { userId } = body || {};
    if (!userId) return res.status(400).json({ error: "userId is required" });
    const now = (/* @__PURE__ */ new Date()).toISOString();
    db.prepare("UPDATE profiles SET is_online = 1, last_seen = ?, updated_at = ? WHERE id = ?").run(
      now,
      now,
      userId
    );
    const cached = getProfileCachedOrDb(userId);
    if (cached) {
      serverProfilesStore.set(userId, { ...cached, is_online: true, last_seen: now });
    }
    return res.json({ success: true, is_online: true, last_seen: now });
  } catch {
    return res.status(500).json({ error: "Failed to update heartbeat" });
  }
});
app.post("/api/presence/offline", (req, res) => {
  try {
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
      }
    }
    const { userId } = body || {};
    if (!userId) return res.status(400).json({ error: "userId is required" });
    const now = (/* @__PURE__ */ new Date()).toISOString();
    db.prepare("UPDATE profiles SET is_online = 0, last_seen = ?, updated_at = ? WHERE id = ?").run(
      now,
      now,
      userId
    );
    const cached = getProfileCachedOrDb(userId);
    if (cached) {
      serverProfilesStore.set(userId, { ...cached, is_online: false, last_seen: now });
    }
    return res.json({ success: true, is_online: false, last_seen: now });
  } catch {
    return res.status(500).json({ error: "Failed to update offline state" });
  }
});
app.get("/api/presence/online", (_req, res) => {
  try {
    const cutoff = new Date(Date.now() - 45e3).toISOString();
    const rows = db.prepare("SELECT id, is_online, last_seen FROM profiles WHERE is_online = 1 AND last_seen >= ?").all(cutoff);
    return res.json({
      users: rows.filter((r) => !isTargetUserHidden(r.id)).map((r) => ({ id: r.id, is_online: true, last_seen: r.last_seen }))
    });
  } catch {
    return res.json({ users: [] });
  }
});
app.post("/api/relations/user-overview", async (req, res) => {
  try {
    const { userId, username } = req.body || {};
    if (!userId && !username) {
      return res.status(400).json({ error: "userId or username is required" });
    }
    let targetId = userId || "";
    if (!targetId && username) {
      const p = getProfileByUsername(username);
      if (p) targetId = p.id;
    }
    const viewerId = await getOptionalAuthUserId(req);
    const viewerRow = viewerId ? findUserById(viewerId) : null;
    const viewerIsMod = viewerRow?.role === "admin" || viewerRow?.role === "moderator";
    if (targetId && viewerId !== targetId && !viewerIsMod && isTargetUserHidden(targetId)) {
      return res.status(404).json({ error: "User not found" });
    }
    if (viewerId && targetId && viewerId !== targetId && isBlocked(viewerId, targetId)) {
      return res.status(404).json({ error: "User not found" });
    }
    const followingRows = db.prepare("SELECT following_id FROM follows WHERE follower_id = ?").all(targetId);
    const followerRows = db.prepare("SELECT follower_id FROM follows WHERE following_id = ?").all(targetId);
    const blockedByMeRows = db.prepare("SELECT blocked_id FROM blocked_users WHERE blocker_id = ?").all(targetId);
    const blockedByThemRows = db.prepare("SELECT blocker_id FROM blocked_users WHERE blocked_id = ?").all(targetId);
    const following = followingRows.map((r) => r.following_id).filter((id) => !isTargetUserHidden(id) && !isBlocked(targetId, id) && (!viewerId || !isBlocked(viewerId, id)));
    const followers = followerRows.map((r) => r.follower_id).filter((id) => !isTargetUserHidden(id) && !isBlocked(targetId, id) && (!viewerId || !isBlocked(viewerId, id)));
    const blockedByMe = blockedByMeRows.map((r) => r.blocked_id);
    const blockedByThem = blockedByThemRows.map((r) => r.blocker_id);
    const buildMini = (id) => getProfileCachedOrDb(id) || {
      id,
      username: `user_${id.slice(0, 5)}`,
      display_name: "User",
      avatar_url: null,
      bio: null,
      is_online: false
    };
    return res.json({
      following,
      followers,
      followingCount: following.length,
      followersCount: followers.length,
      followingProfiles: following.map(buildMini),
      followerProfiles: followers.map(buildMini),
      blockedByMe,
      blockedByThem
    });
  } catch {
    return res.status(500).json({ error: "Failed to retrieve user overview" });
  }
});
function handleGetBlockedList(req, res) {
  try {
    const authUserId = req.authUserId;
    const requestedIds = Array.isArray(req.body?.ids) ? req.body.ids : null;
    const rows = db.prepare("SELECT blocked_id, created_at FROM blocked_users WHERE blocker_id = ? ORDER BY created_at DESC").all(authUserId);
    const blockedIdsSet = new Set(rows.map((r) => r.blocked_id));
    const filteredRows = requestedIds && requestedIds.length > 0 ? rows.filter((r) => requestedIds.includes(r.blocked_id)) : rows;
    const blockedUsers = filteredRows.map((r) => {
      const prof = getProfileCachedOrDb(r.blocked_id);
      return prof ? { ...prof, blocked_at: r.created_at } : null;
    }).filter(Boolean);
    return res.json({
      blockedUsers,
      blockedIds: Array.from(blockedIdsSet)
    });
  } catch {
    return res.status(500).json({ error: "Failed to fetch blocked users" });
  }
}
app.get("/api/blocks", requireAuth, handleGetBlockedList);
app.post("/api/relations/blocked-profiles", requireAuth, handleGetBlockedList);
app.get("/api/relations/all-counts", (_req, res) => {
  try {
    const rows = db.prepare("SELECT follower_id, following_id FROM follows").all();
    const counts = {};
    for (const r of rows) {
      if (isBlocked(r.follower_id, r.following_id)) continue;
      if (isTargetUserHidden(r.follower_id) || isTargetUserHidden(r.following_id)) continue;
      if (!counts[r.follower_id]) counts[r.follower_id] = { followers: 0, following: 0 };
      if (!counts[r.following_id]) counts[r.following_id] = { followers: 0, following: 0 };
      counts[r.follower_id].following += 1;
      counts[r.following_id].followers += 1;
    }
    return res.json({ counts });
  } catch {
    return res.status(500).json({ error: "Failed to retrieve counts" });
  }
});
app.post("/api/relations/status", (req, res) => {
  try {
    const { userId, targetUserId } = req.body || {};
    if (!userId || !targetUserId) {
      return res.status(400).json({ error: "userId and targetUserId are required" });
    }
    if (isTargetUserHidden(targetUserId) || isTargetUserHidden(userId)) {
      return res.json({
        isFollowing: false,
        isFollowedBy: false,
        isMutual: false,
        isBlockedByMe: false,
        isBlockedByThem: false,
        isBlocked: false,
        followersCount: 0,
        followingCount: 0
      });
    }
    const isBlockedByMe = Boolean(
      db.prepare("SELECT 1 FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?").get(userId, targetUserId)
    );
    const isBlockedByThem = Boolean(
      db.prepare("SELECT 1 FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?").get(targetUserId, userId)
    );
    const blocked = isBlockedByMe || isBlockedByThem;
    if (blocked) {
      return res.json({
        isFollowing: false,
        isFollowedBy: false,
        isMutual: false,
        isBlockedByMe,
        isBlockedByThem,
        isBlocked: true,
        followersCount: 0,
        followingCount: 0
      });
    }
    const isFollowingThem = isFollowing(userId, targetUserId);
    const isFollowedByThem = isFollowing(targetUserId, userId);
    const isMutual = Boolean(isFollowingThem && isFollowedByThem);
    const counts = getFollowCounts(targetUserId);
    return res.json({
      isFollowing: isFollowingThem,
      isFollowedBy: isFollowedByThem,
      isMutual,
      isBlockedByMe: false,
      isBlockedByThem: false,
      isBlocked: false,
      followersCount: counts.followersCount,
      followingCount: counts.followingCount
    });
  } catch {
    return res.status(500).json({ error: "Failed to retrieve relation status" });
  }
});
app.post("/api/relations/sync", (req, res) => {
  try {
    const { userId, following, followers } = req.body || {};
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const stmt = db.prepare(
      "INSERT OR IGNORE INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)"
    );
    const peerIds = /* @__PURE__ */ new Set();
    if (userId && Array.isArray(following)) {
      for (const id of following) {
        if (id && id !== userId && !isBlocked(userId, id)) {
          stmt.run(userId, id, nowIso);
          peerIds.add(id);
        }
      }
    }
    if (userId && Array.isArray(followers)) {
      for (const id of followers) {
        if (id && id !== userId && !isBlocked(userId, id)) {
          stmt.run(id, userId, nowIso);
          peerIds.add(id);
        }
      }
    }
    if (userId) {
      for (const peerId of peerIds) {
        if (isMutualFollow(userId, peerId)) {
          const convId = getDeterministicDirectConvId(userId, peerId);
          db.prepare("INSERT OR IGNORE INTO conversations (id, type, created_at, updated_at) VALUES (?, ?, ?, ?)").run(
            convId,
            "direct",
            nowIso,
            nowIso
          );
          db.prepare("INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)").run(
            convId,
            userId,
            "member",
            nowIso
          );
          db.prepare("INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)").run(
            convId,
            peerId,
            "member",
            nowIso
          );
        }
      }
    }
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: "Failed to sync relations" });
  }
});
app.post("/api/relations/follow", requireNotBlocked((req) => req.body?.targetUserId), (req, res) => {
  try {
    const { userId, targetUserId, userMeta, targetMeta } = req.body || {};
    if (!userId || !targetUserId) {
      return res.status(400).json({ error: "userId and targetUserId are required" });
    }
    if (userId === targetUserId) {
      return res.status(400).json({ error: "You cannot follow yourself" });
    }
    if (isTargetUserHidden(targetUserId) || isTargetUserHidden(userId)) {
      return res.status(404).json({ error: "User not found" });
    }
    if (isBlocked(userId, targetUserId)) {
      return res.status(403).json({ error: "Cannot follow a blocked user" });
    }
    if (userMeta) ensureProfileRecord(userId, userMeta);
    if (targetMeta) ensureProfileRecord(targetUserId, targetMeta);
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    db.prepare(
      "INSERT OR IGNORE INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)"
    ).run(userId, targetUserId, nowIso);
    const wasFollowedByTarget = isFollowing(targetUserId, userId);
    const isMutualNow = wasFollowedByTarget;
    let autoConvId = null;
    let autoConv = null;
    if (isMutualNow) {
      autoConvId = getDeterministicDirectConvId(userId, targetUserId);
      db.prepare("DELETE FROM deleted_conversations WHERE conversation_id = ?").run(autoConvId);
      db.prepare(
        "INSERT OR IGNORE INTO conversations (id, type, created_at, updated_at) VALUES (?, ?, ?, ?)"
      ).run(autoConvId, "direct", nowIso, nowIso);
      db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(nowIso, autoConvId);
      db.prepare(
        "INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)"
      ).run(autoConvId, userId, "member", nowIso);
      db.prepare(
        "INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)"
      ).run(autoConvId, targetUserId, "member", nowIso);
      autoConv = buildConversationObject(autoConvId, userId);
    }
    const actorDisplayName = userMeta?.display_name || userMeta?.username || "Someone";
    if (isMutualNow) {
      addNotification(
        targetUserId,
        userId,
        "follow_back",
        "Followed you back",
        `${actorDisplayName} followed you back. You are now connected!`,
        userId,
        userMeta
      );
    } else {
      addNotification(
        targetUserId,
        userId,
        "follow",
        "New Follower",
        `${actorDisplayName} started following you. Follow back to chat & call!`,
        userId,
        userMeta
      );
    }
    const targetCounts = getFollowCounts(targetUserId);
    const userCounts = getFollowCounts(userId);
    return res.json({
      success: true,
      isFollowing: true,
      isFollowedBy: wasFollowedByTarget,
      isMutual: isMutualNow,
      conversationId: autoConvId,
      conversation: autoConv,
      followersCount: targetCounts.followersCount,
      followingCount: targetCounts.followingCount,
      targetUserId,
      targetFollowersCount: targetCounts.followersCount,
      targetFollowingCount: targetCounts.followingCount,
      userId,
      userFollowersCount: userCounts.followersCount,
      userFollowingCount: userCounts.followingCount
    });
  } catch {
    return res.status(500).json({ error: "Failed to process follow" });
  }
});
app.post("/api/relations/unfollow", (req, res) => {
  try {
    const { userId, targetUserId } = req.body || {};
    if (!userId || !targetUserId) {
      return res.status(400).json({ error: "userId and targetUserId are required" });
    }
    db.prepare("DELETE FROM follows WHERE follower_id = ? AND following_id = ?").run(userId, targetUserId);
    const isFollowedByThem = isFollowing(targetUserId, userId);
    const targetCounts = getFollowCounts(targetUserId);
    const userCounts = getFollowCounts(userId);
    return res.json({
      success: true,
      isFollowing: false,
      isFollowedBy: isFollowedByThem,
      isMutual: false,
      followersCount: targetCounts.followersCount,
      followingCount: targetCounts.followingCount,
      targetUserId,
      targetFollowersCount: targetCounts.followersCount,
      targetFollowingCount: targetCounts.followingCount,
      userId,
      userFollowersCount: userCounts.followersCount,
      userFollowingCount: userCounts.followingCount
    });
  } catch {
    return res.status(500).json({ error: "Failed to unfollow" });
  }
});
function handleBlockUser(req, res) {
  try {
    const authUserId = req.authUserId;
    const requestedUserId = req.body?.userId ? String(req.body.userId) : authUserId;
    if (requestedUserId !== authUserId) {
      return res.status(403).json({ error: "Cannot block users on behalf of another account" });
    }
    const targetUserId = String(req.body?.targetUserId || req.body?.blockedId || "").trim();
    if (!targetUserId) {
      return res.status(400).json({ error: "targetUserId is required" });
    }
    if (authUserId === targetUserId) {
      return res.status(400).json({ error: "You cannot block yourself" });
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    db.exec("BEGIN");
    try {
      db.prepare(
        "INSERT OR IGNORE INTO blocked_users (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)"
      ).run(authUserId, targetUserId, nowIso);
      db.prepare(
        "DELETE FROM follows WHERE (follower_id = ? AND following_id = ?) OR (follower_id = ? AND following_id = ?)"
      ).run(authUserId, targetUserId, targetUserId, authUserId);
      db.exec("COMMIT");
    } catch (txErr) {
      db.exec("ROLLBACK");
      throw txErr;
    }
    return res.json({
      success: true,
      isBlockedByMe: true,
      isBlocked: true,
      isFollowing: false,
      isFollowedBy: false,
      isMutual: false,
      followersCount: 0,
      followingCount: 0
    });
  } catch {
    return res.status(500).json({ error: "Failed to block user" });
  }
}
function handleUnblockUser(req, res) {
  try {
    const authUserId = req.authUserId;
    const requestedUserId = req.body?.userId ? String(req.body.userId) : authUserId;
    if (requestedUserId !== authUserId) {
      return res.status(403).json({ error: "Cannot unblock users on behalf of another account" });
    }
    const targetUserId = String(req.params?.targetUserId || req.body?.targetUserId || req.body?.blockedId || "").trim();
    if (!targetUserId) {
      return res.status(400).json({ error: "targetUserId is required" });
    }
    db.prepare("DELETE FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?").run(authUserId, targetUserId);
    const counts = getFollowCounts(targetUserId);
    return res.json({
      success: true,
      isBlockedByMe: false,
      isBlocked: isBlocked(authUserId, targetUserId),
      isFollowing: false,
      isFollowedBy: false,
      isMutual: false,
      followersCount: counts.followersCount,
      followingCount: counts.followingCount
    });
  } catch {
    return res.status(500).json({ error: "Failed to unblock user" });
  }
}
app.post("/api/blocks", requireAuth, blockRateLimiter, handleBlockUser);
app.delete("/api/blocks/:targetUserId", requireAuth, blockRateLimiter, handleUnblockUser);
app.post("/api/relations/block", requireAuth, blockRateLimiter, handleBlockUser);
app.post("/api/relations/unblock", requireAuth, blockRateLimiter, handleUnblockUser);
app.post("/api/relations/check-mutual", (req, res) => {
  try {
    const { userA, userB } = req.body || {};
    if (!userA || !userB) {
      return res.status(400).json({ error: "userA and userB are required" });
    }
    const blocked = isBlocked(userA, userB);
    const mutual = !blocked && isMutualFollow(userA, userB);
    return res.json({
      isMutual: mutual,
      mutual,
      blocked,
      userAFollowsUserB: !blocked && isFollowing(userA, userB),
      userBFollowsUserA: !blocked && isFollowing(userB, userA)
    });
  } catch {
    return res.status(500).json({ error: "Failed to check mutual status" });
  }
});
app.post("/api/notifications/list", (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: "userId is required" });
    const rows = db.prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100").all(userId);
    const notifications = rows.filter((r) => {
      const isModerationNotif = String(r.type || "").startsWith("account_") || r.type === "appeal_update";
      if (isModerationNotif) return true;
      if (r.actor_id && (isBlocked(userId, r.actor_id) || isTargetUserHidden(r.actor_id))) return false;
      return true;
    }).map((r) => {
      let actor = null;
      if (r.actor_json) {
        try {
          actor = JSON.parse(r.actor_json);
        } catch {
        }
      }
      if (!actor && r.actor_id && r.actor_id !== "system_moderation") actor = getProfileCachedOrDb(r.actor_id);
      return {
        id: r.id,
        user_id: r.user_id,
        actor_id: r.actor_id,
        type: r.type,
        title: r.title,
        message: r.message,
        reference_id: r.reference_id,
        is_read: Boolean(r.is_read),
        created_at: r.created_at,
        actor
      };
    });
    const unreadCount = notifications.filter((n) => !n.is_read).length;
    return res.json({ notifications, unreadCount });
  } catch {
    return res.status(500).json({ error: "Failed to load notifications" });
  }
});
app.post("/api/notifications/mark-read", (req, res) => {
  try {
    const { userId, notificationId } = req.body || {};
    if (!userId || !notificationId) {
      return res.status(400).json({ error: "userId and notificationId are required" });
    }
    db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?").run(notificationId, userId);
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: "Failed to mark notification as read" });
  }
});
app.post("/api/notifications/mark-all-read", (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: "userId is required" });
    db.prepare("UPDATE notifications SET is_read = 1 WHERE user_id = ?").run(userId);
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: "Failed to mark all as read" });
  }
});
app.post("/api/notifications/delete", (req, res) => {
  try {
    const { userId, notificationId } = req.body || {};
    if (!userId || !notificationId) {
      return res.status(400).json({ error: "userId and notificationId are required" });
    }
    db.prepare("DELETE FROM notifications WHERE id = ? AND user_id = ?").run(notificationId, userId);
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: "Failed to delete notification" });
  }
});
app.post("/api/notifications/create", (req, res) => {
  try {
    const { userId, actorId, type, title, message, referenceId, actorMeta } = req.body || {};
    if (!userId || !actorId || !type) {
      return res.status(400).json({ error: "userId, actorId, and type are required" });
    }
    if (isBlocked(userId, actorId)) {
      return res.status(403).json({ error: "Cannot notify a blocked user" });
    }
    const newNotif = addNotification(userId, actorId, type, title, message, referenceId, actorMeta);
    return res.json({ success: true, notification: newNotif });
  } catch {
    return res.status(500).json({ error: "Failed to create notification" });
  }
});
var serverSignalsStore = /* @__PURE__ */ new Map();
function formatCallRow(row) {
  if (!row) return null;
  const caller = getProfileCachedOrDb(row.caller_id) || void 0;
  const callee = getProfileCachedOrDb(row.callee_id) || void 0;
  return {
    id: row.id,
    caller_id: row.caller_id,
    callee_id: row.callee_id,
    callerDeviceId: row.caller_device_id || void 0,
    calleeDeviceId: row.callee_device_id || void 0,
    call_type: row.call_type || "audio",
    status: row.status,
    room_name: row.room_name || `room_${row.id}`,
    started_at: row.started_at || row.created_at,
    answered_at: row.answered_at || null,
    ended_at: row.ended_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    caller,
    callee
  };
}
app.post("/api/calls/create", (req, res) => {
  try {
    const { call, callerMeta } = req.body || {};
    if (!call || !call.id || !call.caller_id || !call.callee_id) {
      return res.status(400).json({ error: "Valid call object with caller_id and callee_id required" });
    }
    if (isTargetUserHidden(call.caller_id) || isTargetUserHidden(call.callee_id)) {
      return res.status(403).json({ error: "Account unavailable for calls" });
    }
    if (isBlocked(call.caller_id, call.callee_id)) {
      return res.status(403).json({ error: "Cannot call blocked user" });
    }
    if (callerMeta) ensureProfileRecord(call.caller_id, callerMeta);
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const roomName = call.room_name || `room_${call.caller_id.slice(0, 6)}_${Date.now()}`;
    db.prepare(`
      INSERT OR REPLACE INTO calls (
        id, caller_id, callee_id, call_type, status, room_name,
        caller_device_id, callee_device_id, started_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'calling', ?, ?, ?, ?, ?, ?)
    `).run(
      call.id,
      call.caller_id,
      call.callee_id,
      call.call_type || "audio",
      roomName,
      call.callerDeviceId || null,
      call.calleeDeviceId || null,
      nowIso,
      nowIso,
      nowIso
    );
    const callerObj = callerMeta || getProfileCachedOrDb(call.caller_id) || {
      id: call.caller_id,
      username: "Caller",
      display_name: "Caller",
      avatar_url: null
    };
    const newCall = formatCallRow(db.prepare("SELECT * FROM calls WHERE id = ?").get(call.id));
    const callerName = callerObj?.display_name || callerObj?.username || "Someone";
    addNotification(
      call.callee_id,
      call.caller_id,
      call.call_type === "video" ? "call_video" : "call_audio",
      `Incoming ${call.call_type === "video" ? "Video" : "Voice"} Call`,
      `${callerName} is calling you...`,
      call.id,
      callerObj
    );
    return res.json({ success: true, call: newCall });
  } catch {
    return res.status(500).json({ error: "Failed to dispatch call" });
  }
});
app.post("/api/calls/incoming", (req, res) => {
  try {
    const { userId, deviceId } = req.body || {};
    if (!userId) return res.status(400).json({ error: "userId is required" });
    const ninetySecondsAgo = new Date(Date.now() - 9e4).toISOString();
    const rows = db.prepare(
      `SELECT * FROM calls
         WHERE callee_id = ? AND status IN ('calling', 'ringing') AND created_at >= ?
         ORDER BY created_at DESC LIMIT 5`
    ).all(userId, ninetySecondsAgo);
    const pendingCalls = rows.filter((r) => !isBlocked(userId, r.caller_id) && !isTargetUserHidden(r.caller_id)).filter((r) => !(deviceId && r.caller_device_id && r.caller_device_id === deviceId)).map(formatCallRow);
    return res.json({ calls: pendingCalls });
  } catch {
    return res.status(500).json({ error: "Failed to check incoming calls" });
  }
});
app.post("/api/calls/status", (req, res) => {
  try {
    const { callId } = req.body || {};
    if (!callId) return res.status(400).json({ error: "callId is required" });
    const row = db.prepare("SELECT * FROM calls WHERE id = ?").get(callId);
    if (!row) {
      return res.json({ exists: false, status: "unknown" });
    }
    const call = formatCallRow(row);
    return res.json({ exists: true, status: row.status, call });
  } catch {
    return res.status(500).json({ error: "Failed to check call status" });
  }
});
app.post("/api/calls/action", (req, res) => {
  try {
    const { callId, action, userId, calleeDeviceId } = req.body || {};
    if (!callId || !action) {
      return res.status(400).json({ error: "callId and action are required" });
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    let row = db.prepare("SELECT * FROM calls WHERE id = ?").get(callId);
    if (!row) {
      const status = action === "accept" ? "accepted" : action === "reject" ? "rejected" : action === "cancel" ? "cancelled" : "ended";
      db.prepare(`
        INSERT INTO calls (
          id, caller_id, callee_id, call_type, status, room_name,
          callee_device_id, started_at, answered_at, ended_at, created_at, updated_at
        ) VALUES (?, ?, ?, 'audio', ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        callId,
        userId || "unknown",
        "unknown",
        status,
        `room_${callId}`,
        calleeDeviceId || null,
        nowIso,
        action === "accept" ? nowIso : null,
        ["ended", "rejected", "cancelled"].includes(action) ? nowIso : null,
        nowIso,
        nowIso
      );
      row = db.prepare("SELECT * FROM calls WHERE id = ?").get(callId);
    } else {
      let nextStatus = row.status;
      let answeredAt = row.answered_at;
      let endedAt = row.ended_at;
      let nextCalleeDev = calleeDeviceId || row.callee_device_id;
      if (action === "ring" && row.status === "calling") {
        nextStatus = "ringing";
      } else if (action === "accept") {
        nextStatus = "accepted";
        answeredAt = nowIso;
      } else if (action === "reject") {
        nextStatus = "rejected";
        endedAt = nowIso;
      } else if (action === "cancel") {
        nextStatus = "cancelled";
        endedAt = nowIso;
      } else if (action === "end") {
        nextStatus = "ended";
        endedAt = nowIso;
      }
      db.prepare(
        "UPDATE calls SET status = ?, callee_device_id = ?, answered_at = ?, ended_at = ?, updated_at = ? WHERE id = ?"
      ).run(nextStatus, nextCalleeDev, answeredAt, endedAt, nowIso, callId);
      row = db.prepare("SELECT * FROM calls WHERE id = ?").get(callId);
    }
    const call = formatCallRow(row);
    const actionSignal = {
      id: `act_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      type: action === "accept" ? "CALL_ACCEPTED" : action === "reject" ? "CALL_REJECTED" : action === "cancel" ? "CALL_CANCELLED" : action === "end" ? "CALL_ENDED" : "CALL_ACTION",
      callId,
      action,
      status: call.status,
      senderId: userId,
      senderDeviceId: calleeDeviceId,
      calleeDeviceId: call.calleeDeviceId,
      _t: Date.now()
    };
    const globalKey = `call_${callId}`;
    serverSignalsStore.set(globalKey, [...(serverSignalsStore.get(globalKey) || []).slice(-40), actionSignal]);
    if (call.caller_id && call.caller_id !== "unknown") {
      const callerKey = `${callId}_${call.caller_id}`;
      serverSignalsStore.set(callerKey, [...(serverSignalsStore.get(callerKey) || []).slice(-40), actionSignal]);
    }
    if (call.callerDeviceId) {
      const devKey = `${callId}_${call.callerDeviceId}`;
      serverSignalsStore.set(devKey, [...(serverSignalsStore.get(devKey) || []).slice(-40), actionSignal]);
    }
    return res.json({ success: true, status: call.status, call });
  } catch {
    return res.status(500).json({ error: "Failed to update call action" });
  }
});
app.post("/api/calls/signal", (req, res) => {
  try {
    const signal = req.body;
    if (signal && signal.callId) {
      const payload = {
        ...signal,
        id: signal.id || `sig_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
      };
      if (signal.targetDeviceId) {
        const devKey = `${signal.callId}_${signal.targetDeviceId}`;
        serverSignalsStore.set(devKey, [...(serverSignalsStore.get(devKey) || []).slice(-40), payload]);
      }
      if (signal.targetId) {
        const userKey = `${signal.callId}_${signal.targetId}`;
        serverSignalsStore.set(userKey, [...(serverSignalsStore.get(userKey) || []).slice(-40), payload]);
      }
      const globalKey = `call_${signal.callId}`;
      serverSignalsStore.set(globalKey, [...(serverSignalsStore.get(globalKey) || []).slice(-40), payload]);
    }
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: "Failed to process signal" });
  }
});
app.post("/api/calls/signals", (req, res) => {
  try {
    const { callId, targetId, deviceId } = req.body || {};
    if (!callId) return res.json({ signals: [] });
    const collected = [];
    const seenKeys = /* @__PURE__ */ new Set();
    const checkKey = (key) => {
      const list = serverSignalsStore.get(key) || [];
      for (const sig of list) {
        if (deviceId && sig.senderDeviceId && sig.senderDeviceId === deviceId) continue;
        const sigId = sig.id || `${sig.type}_${sig.senderId}_${sig._t || ""}`;
        if (!seenKeys.has(sigId)) {
          seenKeys.add(sigId);
          collected.push(sig);
        }
      }
    };
    if (deviceId) checkKey(`${callId}_${deviceId}`);
    if (targetId) checkKey(`${callId}_${targetId}`);
    checkKey(`call_${callId}`);
    return res.json({ signals: collected });
  } catch {
    return res.status(500).json({ error: "Failed to get signals" });
  }
});
app.get("/api/webrtc/ice-servers", (_req, res) => {
  try {
    const customTurnUrl = process.env.TURN_URL || process.env.VITE_TURN_URL;
    const customTurnUser = process.env.TURN_USERNAME || process.env.VITE_TURN_USERNAME;
    const customTurnPass = process.env.TURN_CREDENTIAL || process.env.VITE_TURN_CREDENTIAL;
    const iceServers = [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
      { urls: "stun:stun3.l.google.com:19302" },
      { urls: "stun:stun4.l.google.com:19302" },
      { urls: "stun:stun.cloudflare.com:3478" },
      { urls: "stun:stun.services.mozilla.com" },
      {
        urls: [
          "turn:openrelay.metered.ca:80",
          "turn:openrelay.metered.ca:443",
          "turn:openrelay.metered.ca:443?transport=tcp",
          "turns:openrelay.metered.ca:443?transport=tcp"
        ],
        username: "openrelay",
        credential: "openrelay"
      }
    ];
    if (customTurnUrl) {
      iceServers.unshift({
        urls: customTurnUrl.split(","),
        username: customTurnUser || void 0,
        credential: customTurnPass || void 0
      });
    }
    return res.json({
      iceServers,
      iceCandidatePoolSize: 6,
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require"
    });
  } catch {
    return res.status(500).json({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
      ]
    });
  }
});
app.post("/api/calls/history", (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: "userId is required" });
    const rows = db.prepare(
      `SELECT c.* FROM calls c
         LEFT JOIN deleted_calls dc ON c.id = dc.call_id AND dc.user_id = ?
         WHERE (c.caller_id = ? OR c.callee_id = ?) AND dc.call_id IS NULL
         ORDER BY c.created_at DESC LIMIT 60`
    ).all(userId, userId, userId);
    return res.json({ calls: rows.map(formatCallRow) });
  } catch {
    return res.status(500).json({ error: "Failed to get call history" });
  }
});
app.post("/api/calls/delete", (req, res) => {
  try {
    const { callId, userId } = req.body || {};
    if (!callId || !userId) {
      return res.status(400).json({ error: "callId and userId are required" });
    }
    db.prepare("INSERT OR IGNORE INTO deleted_calls (user_id, call_id, deleted_at) VALUES (?, ?, ?)").run(
      userId,
      callId,
      (/* @__PURE__ */ new Date()).toISOString()
    );
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: "Failed to delete call history entry" });
  }
});
app.post("/api/calls/clear", (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: "userId required" });
    const rows = db.prepare("SELECT id FROM calls WHERE caller_id = ? OR callee_id = ?").all(userId, userId);
    const stmt = db.prepare("INSERT OR IGNORE INTO deleted_calls (user_id, call_id, deleted_at) VALUES (?, ?, ?)");
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    for (const r of rows) {
      stmt.run(userId, r.id, nowIso);
    }
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: "Failed to clear call history" });
  }
});
app.post("/api/conversations/create-or-get", (req, res) => {
  try {
    const { userId, targetUserId, userProfile, targetProfile } = req.body || {};
    if (!userId || !targetUserId) {
      return res.status(400).json({ error: "userId and targetUserId are required" });
    }
    if (isTargetUserHidden(userId) || isTargetUserHidden(targetUserId)) {
      return res.status(404).json({ error: "User not found" });
    }
    if (isBlocked(userId, targetUserId)) {
      return res.status(403).json({ error: "Cannot start conversation with blocked user" });
    }
    const convId = getDeterministicDirectConvId(userId, targetUserId);
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    db.prepare("DELETE FROM deleted_conversations WHERE conversation_id = ? AND user_id IN (?, ?)").run(
      convId,
      userId,
      "*"
    );
    if (userProfile?.id) ensureProfileRecord(userProfile.id, userProfile);
    if (targetProfile?.id) ensureProfileRecord(targetProfile.id, targetProfile);
    db.prepare(
      "INSERT OR IGNORE INTO conversations (id, type, created_at, updated_at) VALUES (?, ?, ?, ?)"
    ).run(convId, "direct", nowIso, nowIso);
    db.prepare(
      "INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)"
    ).run(convId, userId, "member", nowIso);
    if (userId !== targetUserId) {
      db.prepare(
        "INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)"
      ).run(convId, targetUserId, "member", nowIso);
    }
    const convObj = buildConversationObject(convId, userId);
    return res.json({
      success: true,
      conversationId: convId,
      conversation: convObj
    });
  } catch {
    return res.status(500).json({ error: "Failed to create or get conversation" });
  }
});
app.post("/api/conversations/list", (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: "userId is required" });
    const memberConvRows = db.prepare("SELECT DISTINCT conversation_id FROM conversation_members WHERE user_id = ?").all(userId);
    const candidateConvIds = new Set(memberConvRows.map((r) => r.conversation_id));
    const directMap = /* @__PURE__ */ new Map();
    for (const convId of candidateConvIds) {
      const deletedRow = db.prepare("SELECT 1 FROM deleted_conversations WHERE conversation_id = ? AND user_id IN (?, ?) LIMIT 1").get(convId, userId, "*");
      if (deletedRow) continue;
      const convObj = buildConversationObject(convId, userId);
      if (!convObj) continue;
      const otherId = convObj.other_member?.id;
      if (otherId && otherId !== userId && (isBlocked(userId, otherId) || isTargetUserHidden(otherId))) continue;
      const mapKey = otherId || userId;
      const existing = directMap.get(mapKey);
      if (!existing || new Date(convObj.updated_at).getTime() >= new Date(existing.updated_at).getTime()) {
        directMap.set(mapKey, convObj);
      }
    }
    const result = Array.from(directMap.values());
    result.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    return res.json({ conversations: result });
  } catch {
    return res.status(500).json({ error: "Failed to list conversations" });
  }
});
app.post("/api/users/search", async (req, res) => {
  try {
    const { query = "", userId } = req.body || {};
    const viewerId = await getOptionalAuthUserId(req) || (userId ? String(userId) : "");
    const cleanQuery = String(query || "").trim().toLowerCase().replace(/^@/, "");
    let rows;
    if (!cleanQuery) {
      rows = db.prepare(
        viewerId ? "SELECT * FROM profiles WHERE id != ? ORDER BY updated_at DESC LIMIT 50" : "SELECT * FROM profiles ORDER BY updated_at DESC LIMIT 50"
      ).all(...viewerId ? [viewerId] : []);
    } else {
      const likePattern = `%${cleanQuery}%`;
      if (viewerId) {
        rows = db.prepare(
          `SELECT * FROM profiles
             WHERE id != ? AND (LOWER(username) LIKE ? OR LOWER(display_name) LIKE ? OR LOWER(id) = ?)
             ORDER BY is_online DESC, updated_at DESC LIMIT 50`
        ).all(viewerId, likePattern, likePattern, cleanQuery);
      } else {
        rows = db.prepare(
          `SELECT * FROM profiles
             WHERE LOWER(username) LIKE ? OR LOWER(display_name) LIKE ? OR LOWER(id) = ?
             ORDER BY is_online DESC, updated_at DESC LIMIT 50`
        ).all(likePattern, likePattern, cleanQuery);
      }
    }
    const visibleUsers = rows.filter((r) => !isTargetUserHidden(r.id)).filter((r) => !viewerId || !isBlocked(viewerId, r.id)).map(formatProfile).filter(Boolean);
    return res.json({ users: visibleUsers });
  } catch {
    return res.status(500).json({ error: "Failed to search users" });
  }
});
app.get("/api/users/profile/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ error: "userId is required" });
    const viewerId = await getOptionalAuthUserId(req) || String(req.query.viewerId || "");
    const viewerRow = viewerId ? findUserById(viewerId) : null;
    const viewerIsMod = viewerRow?.role === "admin" || viewerRow?.role === "moderator";
    if (viewerId !== userId && !viewerIsMod && isTargetUserHidden(userId)) {
      return res.status(404).json({ error: "User not found" });
    }
    if (viewerId && viewerId !== userId && isBlocked(viewerId, userId)) {
      return res.status(404).json({ error: "User not found" });
    }
    const profile = getProfileCachedOrDb(userId);
    if (!profile) {
      return res.status(404).json({ error: "User not found" });
    }
    return res.json({ profile });
  } catch {
    return res.status(500).json({ error: "Failed to fetch user profile" });
  }
});
app.post("/api/messages/typing", (req, res) => {
  try {
    const { conversationId, userId } = req.body || {};
    if (conversationId && userId) {
      if (!typingStateMap.has(conversationId)) {
        typingStateMap.set(conversationId, /* @__PURE__ */ new Map());
      }
      typingStateMap.get(conversationId).set(userId, Date.now() + 3500);
    }
    return res.json({ success: true });
  } catch {
    return res.json({ success: false });
  }
});
app.post("/api/messages/react", (req, res) => {
  try {
    const { messageId, userId, emoji } = req.body || {};
    if (!messageId || !userId || !emoji) {
      return res.status(400).json({ error: "messageId, userId, and emoji required" });
    }
    const row = db.prepare("SELECT conversation_id, sender_id, reactions_json FROM messages WHERE id = ?").get(messageId);
    if (!row) return res.json({ success: true });
    if (isTargetUserHidden(userId) || row.sender_id && isTargetUserHidden(row.sender_id)) {
      return res.status(403).json({ error: "Interaction paused due to account status" });
    }
    if (row.sender_id && isBlocked(userId, row.sender_id)) {
      return res.status(403).json({ error: "Cannot interact with blocked user" });
    }
    const memberRows = db.prepare("SELECT user_id FROM conversation_members WHERE conversation_id = ?").all(row.conversation_id);
    if (memberRows.some((m) => m.user_id !== userId && isBlocked(userId, m.user_id))) {
      return res.status(403).json({ error: "Cannot interact with blocked user" });
    }
    let reactions = {};
    if (row.reactions_json) {
      try {
        reactions = JSON.parse(row.reactions_json);
      } catch {
      }
    }
    const userList = reactions[emoji] || [];
    if (userList.includes(userId)) {
      reactions[emoji] = userList.filter((id) => id !== userId);
      if (reactions[emoji].length === 0) delete reactions[emoji];
    } else {
      reactions[emoji] = [...userList, userId];
    }
    db.prepare("UPDATE messages SET reactions_json = ?, updated_at = ? WHERE id = ?").run(
      JSON.stringify(reactions),
      (/* @__PURE__ */ new Date()).toISOString(),
      messageId
    );
    return res.json({ success: true, reactions });
  } catch {
    return res.status(500).json({ error: "Failed to react to message" });
  }
});
app.post("/api/messages/send", (req, res) => {
  try {
    const { message, recipientId, receiverId, senderProfile, recipientProfile, receiverProfile } = req.body || {};
    if (!message || !message.conversation_id || !message.sender_id || !message.content) {
      return res.status(400).json({ error: "Valid message object required" });
    }
    const convId = message.conversation_id;
    const senderId = message.sender_id;
    const nowIso = message.created_at || (/* @__PURE__ */ new Date()).toISOString();
    if (isTargetUserHidden(senderId)) {
      return res.status(403).json({ error: "Your account cannot send messages while suspended or disabled" });
    }
    db.prepare("DELETE FROM deleted_conversations WHERE conversation_id = ?").run(convId);
    const existingConv = buildConversationObject(convId, senderId);
    let targetRecipient = recipientId || receiverId;
    if (!targetRecipient && existingConv?.member_ids) {
      targetRecipient = existingConv.member_ids.find((id) => id !== senderId);
    }
    if (targetRecipient && targetRecipient !== senderId) {
      if (isTargetUserHidden(targetRecipient)) {
        return res.status(403).json({ error: "Direct messages to this account are paused" });
      }
      if (isBlocked(senderId, targetRecipient)) {
        return res.status(403).json({ error: "Cannot message blocked user" });
      }
      if (!isMutualFollow(senderId, targetRecipient)) {
        return res.status(403).json({ error: "Mutual follow is required to send direct messages" });
      }
    }
    const recProfile = recipientProfile || receiverProfile;
    if (senderProfile?.id) ensureProfileRecord(senderProfile.id, senderProfile);
    if (recProfile?.id) ensureProfileRecord(recProfile.id, recProfile);
    db.prepare(
      "INSERT OR IGNORE INTO conversations (id, type, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    ).run(convId, "direct", null, nowIso, nowIso);
    db.prepare(
      "INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)"
    ).run(convId, senderId, "member", nowIso);
    if (targetRecipient && targetRecipient !== senderId) {
      db.prepare(
        "INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)"
      ).run(convId, targetRecipient, "member", nowIso);
    }
    if (existingConv) {
      db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(nowIso, convId);
    }
    const dupRow = db.prepare("SELECT * FROM messages WHERE id = ?").get(message.id);
    if (dupRow) {
      db.prepare("UPDATE messages SET content = ?, updated_at = ? WHERE id = ?").run(
        message.content,
        nowIso,
        message.id
      );
    } else {
      db.prepare(`
        INSERT INTO messages (
          id, conversation_id, sender_id, content, reply_to_message_id,
          reactions_json, mentions_json, media_type, cloudinary_public_id,
          b2_file_id, b2_file_name, is_read, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `).run(
        message.id,
        convId,
        senderId,
        message.content,
        message.reply_to_message_id || null,
        message.reactions ? JSON.stringify(message.reactions) : null,
        message.mentions ? JSON.stringify(message.mentions) : null,
        message.media_type || null,
        message.cloudinary_public_id || null,
        message.b2_file_id || null,
        message.b2_file_name || null,
        nowIso,
        nowIso
      );
    }
    typingStateMap.get(convId)?.delete(senderId);
    const senderProf = senderProfile || getProfileCachedOrDb(senderId);
    const senderName = senderProf?.display_name || senderProf?.username || "Someone";
    let notifPreview = message.content;
    if (notifPreview.startsWith("[IMAGE:")) notifPreview = "Sent a photo";
    else if (notifPreview.startsWith("[VOICE:")) notifPreview = "Sent a voice note";
    else if (notifPreview.startsWith("[VIDEO:")) notifPreview = "Sent a video";
    else if (notifPreview.startsWith("[STICKER:")) notifPreview = "Sent a sticker";
    if (targetRecipient && targetRecipient !== senderId) {
      addNotification(
        targetRecipient,
        senderId,
        "message",
        `New message from ${senderName}`,
        notifPreview,
        convId,
        senderProf
      );
    }
    const savedMsg = formatMessageRow2(db.prepare("SELECT * FROM messages WHERE id = ?").get(message.id));
    const updatedConv = buildConversationObject(convId, senderId);
    return res.json({ success: true, message: savedMsg || message, conversation: updatedConv });
  } catch (error) {
    console.error("[Send Message Error]:", error);
    return res.status(500).json({ error: "Failed to send message" });
  }
});
app.post("/api/messages/list", (req, res) => {
  try {
    const { conversationId, candidateIds, userId } = req.body || {};
    if (!conversationId && (!Array.isArray(candidateIds) || candidateIds.length === 0)) {
      return res.status(400).json({ error: "conversationId required" });
    }
    const allIds = Array.from(new Set([conversationId, ...Array.isArray(candidateIds) ? candidateIds : []].filter(Boolean)));
    const placeholders = allIds.map(() => "?").join(",");
    if (userId) {
      const memberRows = db.prepare(`SELECT user_id FROM conversation_members WHERE conversation_id IN (${placeholders})`).all(...allIds);
      if (memberRows.some((m) => m.user_id !== userId && isBlocked(userId, m.user_id))) {
        return res.json({ messages: [], typingUserIds: [] });
      }
    }
    const rows = db.prepare(
      `SELECT m.* FROM messages m
         LEFT JOIN deleted_messages dm ON m.id = dm.message_id
         WHERE m.conversation_id IN (${placeholders}) AND dm.message_id IS NULL
         ORDER BY m.created_at ASC LIMIT 250`
    ).all(...allIds);
    const messages = rows.filter((r) => !userId || !isBlocked(userId, r.sender_id)).map(formatMessageRow2).filter(Boolean);
    const now = Date.now();
    const typingUserIds = [];
    for (const cId of allIds) {
      const tMap = typingStateMap.get(cId);
      if (tMap) {
        for (const [uId, exp] of tMap.entries()) {
          if (exp <= now) {
            tMap.delete(uId);
          } else if (!userId || uId !== userId) {
            typingUserIds.push(uId);
          }
        }
      }
    }
    return res.json({ messages, typingUserIds: Array.from(new Set(typingUserIds)) });
  } catch {
    return res.status(500).json({ error: "Failed to list messages" });
  }
});
app.post("/api/messages/mark-read", (req, res) => {
  try {
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
      }
    }
    const { conversationId, userId } = body || {};
    if (conversationId && userId) {
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      db.prepare("UPDATE messages SET is_read = 1 WHERE conversation_id = ? AND sender_id != ?").run(
        conversationId,
        userId
      );
      const unreadMsgs = db.prepare("SELECT id FROM messages WHERE conversation_id = ? AND sender_id != ?").all(conversationId, userId);
      const readStmt = db.prepare(
        "INSERT OR IGNORE INTO message_reads (message_id, user_id, read_at) VALUES (?, ?, ?)"
      );
      for (const m of unreadMsgs) {
        readStmt.run(m.id, userId, nowIso);
      }
    }
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: "Failed to mark messages as read" });
  }
});
app.post("/api/messages/delete", (req, res) => {
  try {
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
      }
    }
    const { conversationId, messageId } = body || {};
    if (!messageId) return res.status(400).json({ error: "messageId required" });
    const targetRow = db.prepare("SELECT * FROM messages WHERE id = ?").get(messageId);
    if (targetRow) {
      let cPublicId = targetRow.cloudinary_public_id || null;
      const resType = targetRow.media_type === "video" ? "video" : targetRow.media_type === "voice" ? "raw" : "image";
      if (!cPublicId && targetRow.content?.includes("cloudinary.com")) {
        const parts = targetRow.content.split("/upload/");
        if (parts[1]) {
          const fileWithExt = parts[1].replace(/^v\d+\//, "").split("?")[0];
          cPublicId = fileWithExt.substring(0, fileWithExt.lastIndexOf(".")) || fileWithExt;
        }
      }
      if (cPublicId) {
        deleteAssetFromCloudinary(cPublicId, resType).catch(() => {
        });
      }
    }
    db.prepare("INSERT OR IGNORE INTO deleted_messages (message_id, deleted_at) VALUES (?, ?)").run(
      messageId,
      (/* @__PURE__ */ new Date()).toISOString()
    );
    db.prepare("DELETE FROM messages WHERE id = ?").run(messageId);
    return res.json({ success: true, messageId, conversationId });
  } catch {
    return res.status(500).json({ error: "Failed to delete message" });
  }
});
app.post("/api/messages/clear", (req, res) => {
  try {
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
      }
    }
    const { conversationId } = body || {};
    if (!conversationId) return res.status(400).json({ error: "conversationId required" });
    const msgs = db.prepare("SELECT id FROM messages WHERE conversation_id = ?").all(conversationId);
    const stmt = db.prepare("INSERT OR IGNORE INTO deleted_messages (message_id, deleted_at) VALUES (?, ?)");
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    for (const m of msgs) stmt.run(m.id, nowIso);
    db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(conversationId);
    return res.json({ success: true, conversationId });
  } catch {
    return res.status(500).json({ error: "Failed to clear conversation messages" });
  }
});
var translationCache = /* @__PURE__ */ new Map();
var TRANSLATION_CACHE_MAX = 1500;
var sharedGeminiClient = null;
function getGeminiTranslationClient() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    const err = new Error(
      "Translation requires a Gemini API key. Please configure it in Settings > Secrets."
    );
    err.statusCode = 503;
    throw err;
  }
  if (!sharedGeminiClient) {
    sharedGeminiClient = new import_genai.GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build"
        }
      }
    });
  }
  return sharedGeminiClient;
}
app.post("/api/messages/translate", requireAuth, async (req, res) => {
  try {
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
      }
    }
    const { text, targetLangCode, targetLangName, targetNativeName } = body || {};
    const cleanText = typeof text === "string" ? text.trim() : "";
    const cleanCode = typeof targetLangCode === "string" ? targetLangCode.trim().slice(0, 24) : "";
    const cleanName = typeof targetLangName === "string" ? targetLangName.trim().slice(0, 80) : "";
    const cleanNative = typeof targetNativeName === "string" ? targetNativeName.trim().slice(0, 80) : "";
    if (!cleanText) {
      return res.status(400).json({ error: "Message text is required for translation." });
    }
    if (cleanText.length > 4e3) {
      return res.status(400).json({ error: "Message is too long to translate (max 4000 characters)." });
    }
    if (!cleanCode && !cleanName) {
      return res.status(400).json({ error: "Target language is required." });
    }
    const cacheKey = `${cleanCode.toLowerCase() || cleanName.toLowerCase()}::${cleanText}`;
    const cached = translationCache.get(cacheKey);
    if (cached) {
      return res.json({
        success: true,
        translatedText: cached.translatedText,
        detectedLanguage: cached.detectedLanguage,
        targetLangCode: cleanCode || cleanName,
        cached: true
      });
    }
    const ai = getGeminiTranslationClient();
    const targetDescriptor = [cleanName || cleanCode, cleanNative && cleanNative !== cleanName ? cleanNative : null].filter(Boolean).join(" / ");
    const response = await ai.models.generateContent({
      model: "gemini-4-hydrogen",
      contents: `Target language: ${targetDescriptor} (code: ${cleanCode || "auto"})

Message:
${cleanText}`,
      config: {
        thinkingConfig: { thinkingLevel: import_genai.ThinkingLevel.LOW },
        systemInstruction: "You are an accurate real-time chat translator supporting all 106+ world languages, Hinglish/romanized text, casual chat slang, and formal speech. Translate the provided chat message naturally into the exact requested target language while preserving emojis, formatting, line breaks, @mentions, and URLs. If the message is already in the target language, return it cleanly as-is. Respond strictly with valid JSON matching the schema.",
        responseMimeType: "application/json",
        responseSchema: {
          type: import_genai.Type.OBJECT,
          properties: {
            translatedText: {
              type: import_genai.Type.STRING,
              description: "The translated chat message in the target language."
            },
            detectedLanguage: {
              type: import_genai.Type.STRING,
              description: "The detected source language name in English."
            }
          },
          required: ["translatedText", "detectedLanguage"]
        }
      }
    });
    const rawJson = (response.text ?? "{}").trim();
    let parsed = {};
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      parsed = { translatedText: rawJson || cleanText, detectedLanguage: "Detected" };
    }
    const translatedText = typeof parsed.translatedText === "string" && parsed.translatedText.trim() ? parsed.translatedText.trim() : cleanText;
    const detectedLanguage = typeof parsed.detectedLanguage === "string" && parsed.detectedLanguage.trim() ? parsed.detectedLanguage.trim() : "Auto";
    if (translationCache.size >= TRANSLATION_CACHE_MAX) {
      const oldestKey = translationCache.keys().next().value;
      if (oldestKey !== void 0) translationCache.delete(oldestKey);
    }
    translationCache.set(cacheKey, { translatedText, detectedLanguage });
    return res.json({
      success: true,
      translatedText,
      detectedLanguage,
      targetLangCode: cleanCode || cleanName,
      cached: false
    });
  } catch (err) {
    const status = Number(err?.statusCode || err?.status || 500);
    const msg = String(err?.message || "Failed to translate message");
    if (status === 503) {
      return res.status(503).json({ error: msg });
    }
    if (status === 429 || msg.includes("RESOURCE_EXHAUSTED")) {
      return res.status(429).json({
        error: "Translation quota limit reached. Please wait a moment or check your billing plan in Settings > Secrets."
      });
    }
    if (status === 400 || status === 403 || msg.includes("PERMISSION_DENIED") || msg.includes("API_KEY_INVALID")) {
      return res.status(502).json({
        error: "Translation service API key error. Please check your Gemini API key in Settings > Secrets."
      });
    }
    return res.status(500).json({ error: msg });
  }
});
app.post("/api/conversations/delete", (req, res) => {
  try {
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
      }
    }
    const { conversationId, userId } = body || {};
    if (!conversationId) return res.status(400).json({ error: "conversationId required" });
    db.prepare("INSERT OR IGNORE INTO deleted_conversations (user_id, conversation_id, deleted_at) VALUES (?, ?, ?)").run(
      userId || "*",
      conversationId,
      (/* @__PURE__ */ new Date()).toISOString()
    );
    db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(conversationId);
    db.prepare("DELETE FROM conversation_members WHERE conversation_id = ?").run(conversationId);
    db.prepare("DELETE FROM conversations WHERE id = ?").run(conversationId);
    return res.json({ success: true, conversationId });
  } catch {
    return res.status(500).json({ error: "Failed to delete conversation" });
  }
});
app.post("/api/conversations/pin", requireAuth, (req, res) => {
  try {
    const authUserId = req.authUserId;
    const { conversationId, messageId } = req.body || {};
    if (!conversationId || typeof conversationId !== "string") {
      return res.status(400).json({ error: "conversationId is required." });
    }
    const memberRow = db.prepare("SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ? LIMIT 1").get(conversationId, authUserId);
    if (!memberRow) {
      return res.status(403).json({ error: "You are not a member of this conversation." });
    }
    const cleanMessageId = typeof messageId === "string" && messageId.trim() ? messageId.trim().slice(0, 128) : null;
    if (cleanMessageId) {
      const msgRow = db.prepare(
        `SELECT m.id FROM messages m
           LEFT JOIN deleted_messages dm ON m.id = dm.message_id
           WHERE m.id = ? AND m.conversation_id = ? AND dm.message_id IS NULL
           LIMIT 1`
      ).get(cleanMessageId, conversationId);
      if (!msgRow) {
        return res.status(404).json({ error: "Message not found in this conversation." });
      }
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    db.prepare("UPDATE conversations SET pinned_message_id = ?, updated_at = ? WHERE id = ?").run(
      cleanMessageId,
      nowIso,
      conversationId
    );
    return res.json({
      success: true,
      conversationId,
      pinnedMessageId: cleanMessageId
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Failed to update pinned message" });
  }
});
app.post("/api/reports/create", (req, res) => {
  try {
    const { userId, category, description } = req.body || {};
    if (!description || !String(description).trim()) {
      return res.status(400).json({ error: "Please describe the problem." });
    }
    const id = generateUUID();
    db.prepare(
      "INSERT INTO problem_reports (id, user_id, category, description, status, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(id, userId || null, category || "Bug", String(description).trim(), "submitted", (/* @__PURE__ */ new Date()).toISOString());
    return res.json({ success: true, reportId: id });
  } catch {
    return res.status(500).json({ error: "Failed to submit problem report" });
  }
});
app.post("/api/reports/user", requireAuth, (req, res) => {
  try {
    const reporterId = req.authUserId;
    const {
      reportId: clientReportId,
      reportedUserId,
      reportedUsername,
      reportedDisplayName,
      category,
      details,
      source,
      conversationId,
      familyId,
      familyName,
      alsoBlocked,
      reportedMessageId,
      reportedMessageContent,
      reportedMessageMediaUrl
    } = req.body || {};
    if (!reportedUserId || typeof reportedUserId !== "string") {
      return res.status(400).json({ error: "reportedUserId is required." });
    }
    if (reportedUserId === reporterId) {
      return res.status(400).json({ error: "You cannot report your own account." });
    }
    if (!category || !VALID_USER_REPORT_CATEGORIES.has(String(category))) {
      return res.status(400).json({ error: "Please select a valid report category." });
    }
    const cleanReportedMsgId = typeof reportedMessageId === "string" && reportedMessageId.trim() ? reportedMessageId.trim().slice(0, 128) : null;
    const existingPending = cleanReportedMsgId ? db.prepare(
      `SELECT id, created_at FROM user_reports
             WHERE reporter_id = ? AND reported_user_id = ? AND status IN ('pending', 'under_review')
               AND (reported_message_id = ? OR details LIKE ?)
             LIMIT 1`
    ).get(reporterId, reportedUserId, cleanReportedMsgId, `%[Reported Message ID: ${cleanReportedMsgId}]%`) : db.prepare(
      `SELECT id, created_at FROM user_reports
             WHERE reporter_id = ? AND reported_user_id = ? AND status IN ('pending', 'under_review')
             LIMIT 1`
    ).get(reporterId, reportedUserId);
    if (existingPending && (!clientReportId || existingPending.id !== clientReportId)) {
      return res.status(409).json({
        error: cleanReportedMsgId ? "You have already reported this message. Our safety team is reviewing it." : "You already have an open report for this user. Our safety team is reviewing it.",
        reportId: existingPending.id,
        duplicate: true
      });
    }
    const safeReportId = typeof clientReportId === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(clientReportId) ? clientReportId : `urep_${generateUUID().replace(/-/g, "").slice(0, 20)}`;
    const safeSource = VALID_USER_REPORT_SOURCES.has(String(source)) ? String(source) : "profile";
    const safeDetails = details ? String(details).trim().slice(0, 1e3) : null;
    const safeUsername = reportedUsername ? String(reportedUsername).trim().slice(0, 32) : null;
    const safeDisplayName = reportedDisplayName ? String(reportedDisplayName).trim().slice(0, 80) : null;
    const safeConvId = conversationId ? String(conversationId).trim().slice(0, 128) : null;
    const safeFamilyId = typeof familyId === "string" && familyId.trim() ? familyId.trim().slice(0, 128) : null;
    const safeFamilyName = typeof familyName === "string" && familyName.trim() ? familyName.trim().slice(0, 120) : null;
    const safeMsgContent = typeof reportedMessageContent === "string" && reportedMessageContent.trim() ? reportedMessageContent.trim().slice(0, 1500) : null;
    const safeMsgMediaUrl = typeof reportedMessageMediaUrl === "string" && reportedMessageMediaUrl.trim() ? reportedMessageMediaUrl.trim().slice(0, 500) : null;
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    db.prepare(`
      INSERT OR IGNORE INTO user_reports (
        id, reporter_id, reported_user_id, reported_username, reported_display_name,
        category, details, source, conversation_id, family_id, family_name,
        reported_message_id, reported_message_content, reported_message_media_url,
        also_blocked, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      safeReportId,
      reporterId,
      reportedUserId,
      safeUsername,
      safeDisplayName,
      String(category),
      safeDetails,
      safeSource,
      safeConvId,
      safeFamilyId,
      safeFamilyName,
      cleanReportedMsgId,
      safeMsgContent,
      safeMsgMediaUrl,
      alsoBlocked ? 1 : 0,
      nowIso,
      nowIso
    );
    if (safeSource === "family_chat" && safeFamilyId) {
      const admins = db.prepare("SELECT user_id FROM family_members WHERE family_id = ? AND status = 'active' AND role IN ('owner', 'admin')").all(safeFamilyId);
      const targetLabel = safeDisplayName || safeUsername || "a member";
      for (const adm of admins) {
        if (adm.user_id === reportedUserId) continue;
        db.prepare(`
          INSERT INTO notifications (id, user_id, actor_id, type, title, message, reference_id, is_read, created_at)
          VALUES (?, ?, 'system', 'family_message_report', ?, ?, ?, 0, ?)
        `).run(
          generateUUID(),
          adm.user_id,
          `Message Reported in ${safeFamilyName || "Family"}`,
          `A member reported a message from ${targetLabel} (${String(category)}).`,
          safeFamilyId,
          nowIso
        );
      }
    }
    return res.json({ success: true, reportId: safeReportId });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Failed to submit user report" });
  }
});
app.use("/api/families", createFamilyRouter(requireAuth));
app.get("/api/reports/my-reports", requireAuth, (req, res) => {
  try {
    const reporterId = req.authUserId;
    const rows = db.prepare("SELECT * FROM user_reports WHERE reporter_id = ? ORDER BY created_at DESC LIMIT 50").all(reporterId);
    return res.json({ reports: rows });
  } catch {
    return res.status(500).json({ error: "Failed to load your reports" });
  }
});
app.post("/api/b2/upload", async (req, res) => {
  try {
    const { base64Data, category, userId, conversationId, messageId, mimeType, fileName } = req.body || {};
    if (!base64Data) return res.status(400).json({ error: "base64Data is required" });
    const cat = category || "chat-photo";
    const buffer = Buffer.from(base64Data, "base64");
    const validation = validateCloudinaryFileSize(buffer.length, cat);
    if (!validation.valid) return res.status(400).json({ error: validation.error });
    const result = await uploadBufferToCloudinary({
      buffer,
      category: cat,
      userId: userId || "user",
      conversationId,
      messageId,
      mimeType: mimeType || "application/octet-stream",
      fileName
    });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to upload media" });
  }
});
app.post("/api/b2/delete", async (req, res) => {
  try {
    const { b2_file_id, cloudinary_public_id, resource_type } = req.body || {};
    const publicId = cloudinary_public_id || b2_file_id;
    if (!publicId) return res.status(400).json({ error: "publicId is required" });
    const success = await deleteAssetFromCloudinary(publicId, resource_type || "image");
    return res.json({ success, publicId });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to delete media" });
  }
});
app.post("/api/cloudinary/upload", async (req, res) => {
  try {
    const { base64Data, category, userId, conversationId, messageId, mimeType, fileName } = req.body || {};
    if (!base64Data) return res.status(400).json({ error: "base64Data is required" });
    const cat = category || "chat-photo";
    const buffer = Buffer.from(base64Data, "base64");
    const validation = validateCloudinaryFileSize(buffer.length, cat);
    if (!validation.valid) return res.status(400).json({ error: validation.error });
    const result = await uploadBufferToCloudinary({
      buffer,
      category: cat,
      userId: userId || "user",
      conversationId,
      messageId,
      mimeType: mimeType || "application/octet-stream",
      fileName
    });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to upload to Cloudinary" });
  }
});
app.post("/api/cloudinary/delete", async (req, res) => {
  try {
    const { cloudinary_public_id, resource_type } = req.body || {};
    if (!cloudinary_public_id) return res.status(400).json({ error: "cloudinary_public_id is required" });
    const success = await deleteAssetFromCloudinary(cloudinary_public_id, resource_type || "image");
    return res.json({ success, cloudinary_public_id });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to delete asset from Cloudinary" });
  }
});
app.get("/api/b2/file/*", (req, res) => {
  try {
    const b2Key = decodeURIComponent(req.params[0] || "");
    if (!b2Key) return res.status(400).send("File key required");
    const sanitizedLocalName = b2Key.replace(/\//g, "_");
    const candidates = [
      import_path3.default.join(UPLOADS_DIR, sanitizedLocalName),
      import_path3.default.join(process.cwd(), "uploads", sanitizedLocalName)
    ];
    const localPath = candidates.find((p) => import_fs3.default.existsSync(p));
    if (!localPath) return res.status(404).send("File not found");
    const stat = import_fs3.default.statSync(localPath);
    const fileSize = stat.size;
    const range = req.headers.range;
    let mimeType = "video/mp4";
    if (b2Key.endsWith(".mp3")) mimeType = "audio/mpeg";
    else if (b2Key.endsWith(".webm")) mimeType = "video/webm";
    else if (b2Key.endsWith(".png")) mimeType = "image/png";
    else if (b2Key.endsWith(".jpg") || b2Key.endsWith(".jpeg")) mimeType = "image/jpeg";
    else if (b2Key.endsWith(".gif")) mimeType = "image/gif";
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      let start = parseInt(parts[0], 10);
      let end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      if (isNaN(start)) {
        start = fileSize - parseInt(parts[1], 10);
        end = fileSize - 1;
      }
      if (isNaN(end) || end >= fileSize) end = fileSize - 1;
      if (start < 0) start = 0;
      if (start > end || start >= fileSize) {
        res.setHeader("Content-Range", `bytes */${fileSize}`);
        return res.status(416).send("Requested Range Not Satisfiable");
      }
      const chunksize = end - start + 1;
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunksize,
        "Content-Type": mimeType,
        "Cache-Control": "public, max-age=31536000, immutable"
      });
      return import_fs3.default.createReadStream(localPath, { start, end }).pipe(res);
    }
    res.writeHead(200, {
      "Content-Length": fileSize,
      "Content-Type": mimeType,
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=31536000, immutable"
    });
    return import_fs3.default.createReadStream(localPath).pipe(res);
  } catch {
    return res.status(500).send("Error serving media file");
  }
});
app.post("/api/media/upload", async (req, res) => {
  try {
    const { base64Data, mimeType, fileName, mediaType } = req.body || {};
    if (!base64Data) return res.status(400).json({ error: "base64Data is required" });
    const rawType = mimeType || (mediaType === "audio" ? "audio/webm" : "image/jpeg");
    let type = rawType.split(";")[0].trim().toLowerCase();
    let buffer = Buffer.from(base64Data, "base64");
    let ext = "bin";
    const isAudio = mediaType === "audio" || type.startsWith("audio/") || type.includes("webm") || type.includes("opus") || type.includes("ogg");
    if (isAudio) {
      try {
        const mp3Buffer = await transcodeAudioToMp3(buffer);
        if (mp3Buffer && mp3Buffer.length > 0) {
          buffer = mp3Buffer;
          type = "audio/mpeg";
          ext = "mp3";
        }
      } catch {
      }
    }
    if (ext === "bin") {
      if (type.includes("jpeg") || type.includes("jpg")) ext = "jpg";
      else if (type.includes("png")) ext = "png";
      else if (type.includes("webp")) ext = "webp";
      else if (type.includes("gif")) ext = "gif";
      else if (type.includes("mp3") || type.includes("mpeg")) ext = "mp3";
      else if (type.includes("mp4") || type.includes("m4a") || type.includes("aac")) ext = "mp4";
      else if (type.includes("webm")) ext = "webm";
      else if (type.includes("ogg") || type.includes("opus")) ext = "ogg";
      else if (type.includes("wav")) ext = "wav";
    }
    const fileId = `${mediaType || "file"}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${ext}`;
    const filePath = import_path3.default.join(UPLOADS_DIR, fileId);
    import_fs3.default.writeFileSync(filePath, buffer);
    mediaFilesStore.set(fileId, {
      id: fileId,
      buffer,
      mimeType: type,
      fileName: fileName || fileId,
      size: buffer.length,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      mp3Buffer: ext === "mp3" ? buffer : void 0
    });
    db.prepare(
      "INSERT OR REPLACE INTO media_files (id, mime_type, file_name, size, file_path, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(fileId, type, fileName || fileId, buffer.length, filePath, (/* @__PURE__ */ new Date()).toISOString());
    let mediaUrl = `/api/media/file/${fileId}`;
    try {
      let cCat = "chat-photo";
      if (type.startsWith("video/")) cCat = "chat-video";
      else if (type.startsWith("audio/")) cCat = "chat-voice-note";
      else if (mediaType === "profile") cCat = "profile";
      const cRes = await uploadBufferToCloudinary({
        buffer,
        category: cCat,
        userId: "general",
        mimeType: type,
        fileName: fileId
      });
      if (cRes?.url) mediaUrl = cRes.url;
    } catch {
    }
    return res.json({ success: true, url: mediaUrl, fileId, mimeType: type, size: buffer.length });
  } catch {
    return res.status(500).json({ error: "Failed to process media upload" });
  }
});
app.post("/api/media/transcode", async (req, res) => {
  try {
    const { base64Data, fileId } = req.body || {};
    let inputBuf = null;
    if (base64Data) {
      inputBuf = Buffer.from(base64Data, "base64");
    } else if (fileId) {
      const rec = mediaFilesStore.get(fileId);
      if (rec) {
        inputBuf = rec.buffer;
      } else {
        const candidates = [import_path3.default.join(UPLOADS_DIR, fileId), import_path3.default.join(process.cwd(), "uploads", fileId)];
        const found = candidates.find((p) => import_fs3.default.existsSync(p));
        if (found) inputBuf = import_fs3.default.readFileSync(found);
      }
    }
    if (!inputBuf || inputBuf.length === 0) {
      return res.status(400).json({ error: "Valid audio data or fileId required" });
    }
    const mp3Buf = await transcodeAudioToMp3(inputBuf);
    const newFileId = `audio_transcoded_${Date.now()}_${Math.random().toString(36).substring(2, 9)}.mp3`;
    const filePath = import_path3.default.join(UPLOADS_DIR, newFileId);
    import_fs3.default.writeFileSync(filePath, mp3Buf);
    mediaFilesStore.set(newFileId, {
      id: newFileId,
      buffer: mp3Buf,
      mimeType: "audio/mpeg",
      fileName: newFileId,
      size: mp3Buf.length,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      mp3Buffer: mp3Buf
    });
    return res.json({
      success: true,
      url: `/api/media/file/${newFileId}`,
      fileId: newFileId,
      mimeType: "audio/mpeg",
      size: mp3Buf.length
    });
  } catch {
    return res.status(500).json({ error: "Failed to transcode audio" });
  }
});
app.get("/api/media/file/:fileId", async (req, res) => {
  try {
    const { fileId } = req.params;
    if (!fileId) return res.status(400).send("File ID required");
    let record = mediaFilesStore.get(fileId);
    if (!record) {
      const candidates = [import_path3.default.join(UPLOADS_DIR, fileId), import_path3.default.join(process.cwd(), "uploads", fileId)];
      const diskPath = candidates.find((p) => import_fs3.default.existsSync(p));
      if (diskPath) {
        const diskBuf = import_fs3.default.readFileSync(diskPath);
        let fallbackMime = "application/octet-stream";
        if (fileId.endsWith(".webm")) fallbackMime = "audio/webm";
        else if (fileId.endsWith(".ogg")) fallbackMime = "audio/ogg";
        else if (fileId.endsWith(".mp4") || fileId.endsWith(".m4a")) fallbackMime = "audio/mp4";
        else if (fileId.endsWith(".mp3")) fallbackMime = "audio/mpeg";
        else if (fileId.endsWith(".wav")) fallbackMime = "audio/wav";
        else if (fileId.endsWith(".jpg") || fileId.endsWith(".jpeg")) fallbackMime = "image/jpeg";
        else if (fileId.endsWith(".png")) fallbackMime = "image/png";
        else if (fileId.endsWith(".webp")) fallbackMime = "image/webp";
        record = {
          id: fileId,
          buffer: diskBuf,
          mimeType: fallbackMime,
          fileName: fileId,
          size: diskBuf.length,
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        mediaFilesStore.set(fileId, record);
      }
    }
    if (!record) return res.status(404).send("Media file not found");
    let cleanMime = (record.mimeType || "audio/webm").split(";")[0].trim().toLowerCase();
    if ((fileId.endsWith(".webm") || cleanMime.includes("webm")) && !record.mp3Buffer) {
      try {
        const mp3Buf = await transcodeAudioToMp3(record.buffer);
        if (mp3Buf && mp3Buf.length > 0) record.mp3Buffer = mp3Buf;
      } catch {
      }
    }
    const activeBuffer = record.mp3Buffer || record.buffer;
    const activeMime = record.mp3Buffer ? "audio/mpeg" : cleanMime;
    const totalSize = activeBuffer.length;
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      let start = parseInt(parts[0], 10);
      let end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
      if (isNaN(start)) start = 0;
      if (isNaN(end) || end >= totalSize) end = totalSize - 1;
      if (start > end) start = 0;
      const chunkSize = end - start + 1;
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${totalSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": activeMime,
        "Cache-Control": "public, max-age=31536000, immutable"
      });
      return res.end(activeBuffer.subarray(start, end + 1));
    }
    res.writeHead(200, {
      "Content-Length": totalSize,
      "Content-Type": activeMime,
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=31536000, immutable"
    });
    return res.end(activeBuffer);
  } catch {
    return res.status(500).send("Error serving media file");
  }
});
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    database: "sqlite",
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
});
app.get("/favicon.ico", (_req, res) => {
  res.redirect(302, "/icon.svg");
});
async function startServer() {
  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) {
    const vitePromise = (0, import_vite.createServer)({
      server: { middlewareMode: true, hmr: false },
      appType: "spa"
    });
    app.use(async (req, res, next) => {
      try {
        const vite = await vitePromise;
        return vite.middlewares(req, res, next);
      } catch (err) {
        return next(err);
      }
    });
  } else {
    const cwdDist = import_path3.default.resolve(process.cwd(), "dist");
    const localDist = import_path3.default.resolve(__dirname, "dist");
    const parentDist = import_path3.default.resolve(__dirname, "..", "dist");
    const distPath = import_fs3.default.existsSync(cwdDist) ? cwdDist : import_fs3.default.existsSync(parentDist) ? parentDist : localDist;
    app.use(import_express2.default.static(distPath));
    app.get("*", (_req, res) => {
      const indexPath = import_path3.default.join(distPath, "index.html");
      if (import_fs3.default.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send("App build not found. Please run npm run build.");
      }
    });
  }
  startModerationScheduler(syncProfileCacheAfterModeration);
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`LiveConnect server listening on http://0.0.0.0:${PORT}`);
  });
}
startServer().catch((err) => {
  console.error("Failed to start server:", err);
});
var server_default = app;
//# sourceMappingURL=server.cjs.map
