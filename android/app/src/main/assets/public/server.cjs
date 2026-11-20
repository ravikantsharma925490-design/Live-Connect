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
var import_express = __toESM(require("express"), 1);
var import_dotenv = __toESM(require("dotenv"), 1);
var import_path3 = __toESM(require("path"), 1);
var import_vite = require("vite");
var import_fs3 = __toESM(require("fs"), 1);
var import_child_process = require("child_process");
var import_nodemailer = __toESM(require("nodemailer"), 1);
var import_dns = __toESM(require("dns"), 1);

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

  CREATE TABLE IF NOT EXISTS media_files (
    id TEXT PRIMARY KEY,
    mime_type TEXT NOT NULL,
    file_name TEXT,
    size INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    mp3_path TEXT,
    created_at TEXT NOT NULL
  );
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
    banned_until: row.banned_until || null,
    created_at: row.created_at
  };
}
function formatProfile(row) {
  if (!row) return null;
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
    is_online: Boolean(row.is_online),
    last_seen: row.last_seen,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}
function createSessionForUser(userId, ttlDays = 30) {
  const token = `lc_${import_crypto.default.randomBytes(32).toString("hex")}`;
  const now = /* @__PURE__ */ new Date();
  const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1e3).toISOString();
  db.prepare(
    "INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)"
  ).run(token, userId, expiresAt, now.toISOString());
  return {
    access_token: token,
    expires_at: expiresAt,
    user_id: userId
  };
}
function getUserBySessionToken(token) {
  if (!token) return null;
  const sess = db.prepare("SELECT token, user_id, expires_at FROM sessions WHERE token = ?").get(token);
  if (!sess) return null;
  if (new Date(sess.expires_at).getTime() <= Date.now()) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return null;
  }
  const userRow = db.prepare("SELECT * FROM users WHERE id = ?").get(sess.user_id);
  if (!userRow) return null;
  return {
    session: { access_token: sess.token, expires_at: sess.expires_at },
    userRow,
    user: formatAuthUser(userRow)
  };
}
function deleteSessionToken(token) {
  if (!token) return;
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
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
function deleteAccountCompletely(userId) {
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
  db.prepare("DELETE FROM profiles WHERE id = ?").run(userId);
  db.prepare("DELETE FROM users WHERE id = ?").run(userId);
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
async function sendBanNotificationEmail(toEmail, username, displayName, reason) {
  if (!toEmail || !toEmail.includes("@")) {
    return false;
  }
  const user = process.env.SMTP_USER || process.env.GMAIL_USER;
  const pass = process.env.SMTP_PASS || process.env.GMAIL_PASS;
  if (!user || !pass) {
    return false;
  }
  const transporter = createStandardTransporter();
  const htmlContent = `
<div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; background-color: #0a0a0a; border-radius: 16px; color: #ffffff; border: 1px solid #262626;">
  <div style="text-align: center; margin-bottom: 24px;">
    <h2 style="color: #ef4444; font-size: 24px; margin: 0; font-weight: 800;">LiveConnect Account Notice</h2>
    <p style="color: #a3a3a3; font-size: 14px; margin-top: 6px;">Important security & account status notification</p>
  </div>
  <div style="background-color: #171717; border: 1px solid #262626; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
    <p style="color: #ffffff; font-size: 16px; margin: 0 0 12px 0;">
      Hello <strong>${displayName || username}</strong> (@${username}),
    </p>
    <p style="color: #d4d4d4; font-size: 14px; line-height: 1.6; margin: 0 0 16px 0;">
      Your LiveConnect account (<strong>${toEmail}</strong> / @${username}) has been <span style="color: #ef4444; font-weight: bold;">banned / suspended</span>.
    </p>
    ${reason ? `<div style="background-color: #262626; border-left: 4px solid #ef4444; padding: 14px 16px; border-radius: 8px; margin-bottom: 16px;">
            <p style="color: #a3a3a3; font-size: 11px; margin: 0 0 4px 0; font-weight: bold; text-transform: uppercase;">Reason for Ban:</p>
            <p style="color: #f87171; font-size: 14px; margin: 0; font-weight: 600;">${reason}</p>
          </div>` : ""}
  </div>
</div>`;
  try {
    await transporter.sendMail({
      from: '"LiveConnect Security" <security@liveconnect.app>',
      to: toEmail,
      subject: `Account Banned Notice: LiveConnect (@${username})`,
      html: htmlContent
    });
    return true;
  } catch (err) {
    console.warn(`[Ban Email] Email send notice for ${toEmail}:`, err.message || err);
    return false;
  }
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
var app = (0, import_express.default)();
var PORT = parseInt(process.env.PORT || "3000", 10);
app.use(import_express.default.json({ limit: "50mb" }));
app.use(import_express.default.urlencoded({ extended: true, limit: "50mb" }));
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
async function requireAuth(req, res, next) {
  const token = extractBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }
  const uid = await verifyAuthToken(token);
  if (!uid) {
    return res.status(401).json({ error: "Invalid or expired authentication token" });
  }
  req.authUserId = uid;
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
function getFollowCounts(userId) {
  const canonicalUserId = resolveUserId(userId);
  const followersRow = db.prepare("SELECT COUNT(*) as cnt FROM follows WHERE following_id = ?").get(canonicalUserId);
  const followingRow = db.prepare("SELECT COUNT(*) as cnt FROM follows WHERE follower_id = ?").get(canonicalUserId);
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
  const lastMessage = msgRow ? formatMessageRow(msgRow) : null;
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
    member_ids: memberIds,
    members_meta: membersMeta,
    created_at: convRow.created_at,
    updated_at: effectiveUpdatedAt,
    other_member: otherProfile,
    last_message: lastMessage,
    unread_count: unreadCount
  };
}
function formatMessageRow(row) {
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
    db.prepare(`
      INSERT INTO users (id, email, password_hash, email_confirmed, user_metadata, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?, ?)
    `).run(userId, cleanEmail, hashPassword(password), JSON.stringify(meta), nowIso, nowIso);
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
    const userRow = findUserByEmail(cleanEmail);
    if (!userRow) {
      return res.status(401).json({ error: "Invalid email or password." });
    }
    if (!userRow.password_hash || !verifyPassword(String(password), userRow.password_hash)) {
      return res.status(401).json({ error: "Invalid email or password." });
    }
    if (userRow.banned_until && new Date(userRow.banned_until).getTime() > Date.now()) {
      return res.status(403).json({
        error: "Your account has been suspended.",
        banned: true,
        bannedUntil: userRow.banned_until
      });
    }
    const session = createSessionForUser(userRow.id);
    const profile = getProfileById(userRow.id);
    if (profile) {
      upsertProfile({ id: userRow.id, username: profile.username, display_name: profile.display_name, is_online: true });
      serverProfilesStore.set(userRow.id, { ...profile, is_online: true });
    }
    return res.json({
      success: true,
      session,
      user: formatAuthUser(userRow),
      profile: profile ? { ...profile, is_online: true } : null,
      needsOnboarding: !profile
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
    let userRow = findUserByEmail(cleanEmail);
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    if (!userRow) {
      const userId = generateUUID();
      const meta = {
        full_name: googleProfile.name || cleanEmail.split("@")[0],
        name: googleProfile.name || cleanEmail.split("@")[0],
        avatar_url: googleProfile.picture || null,
        picture: googleProfile.picture || null,
        provider: "google",
        google_sub: googleProfile.sub
      };
      db.prepare(`
        INSERT INTO users (id, email, password_hash, email_confirmed, user_metadata, created_at, updated_at)
        VALUES (?, ?, NULL, 1, ?, ?, ?)
      `).run(userId, cleanEmail, JSON.stringify(meta), nowIso, nowIso);
      userRow = findUserById(userId);
    } else {
      if (userRow.banned_until && new Date(userRow.banned_until).getTime() > Date.now()) {
        return res.status(403).json({
          error: "Your account has been suspended.",
          banned: true,
          bannedUntil: userRow.banned_until
        });
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
      db.prepare("UPDATE users SET user_metadata = ?, email_confirmed = 1, updated_at = ? WHERE id = ?").run(
        JSON.stringify(updatedMeta),
        nowIso,
        userRow.id
      );
      userRow = findUserById(userRow.id);
    }
    const session = createSessionForUser(userRow.id);
    const profile = getProfileById(userRow.id);
    return res.json({
      success: true,
      session,
      user: formatAuthUser(userRow),
      profile,
      needsOnboarding: !profile
    });
  } catch (err) {
    console.error("[Google Auth Error]:", err);
    return res.status(500).json({ error: err.message || "Google sign-in failed" });
  }
});
app.get("/api/auth/session", (req, res) => {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      return res.json({ session: null, user: null, profile: null });
    }
    const authInfo = getUserBySessionToken(token);
    if (!authInfo) {
      return res.json({ session: null, user: null, profile: null });
    }
    const bannedUntil = authInfo.userRow.banned_until;
    if (bannedUntil && new Date(bannedUntil).getTime() > Date.now()) {
      return res.json({
        session: authInfo.session,
        user: authInfo.user,
        profile: null,
        banned: true,
        bannedUntil
      });
    }
    const profile = getProfileById(authInfo.user.id);
    if (profile) {
      serverProfilesStore.set(profile.id, profile);
    }
    return res.json({
      session: authInfo.session,
      user: authInfo.user,
      profile,
      needsOnboarding: !profile,
      banned: false,
      bannedUntil: null
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
app.post("/api/auth/confirm-user", (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email) return res.status(400).json({ error: "Email is required" });
    const cleanEmail = String(email).trim().toLowerCase();
    let userRow = findUserByEmail(cleanEmail);
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const cleanUsername = cleanEmail.split("@")[0].replace(/[^a-z0-9_]/g, "") || "user";
    if (!userRow && password) {
      const userId = generateUUID();
      db.prepare(`
        INSERT INTO users (id, email, password_hash, email_confirmed, user_metadata, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?, ?)
      `).run(
        userId,
        cleanEmail,
        hashPassword(String(password)),
        JSON.stringify({ display_name: cleanUsername, username: cleanUsername, country: "India" }),
        nowIso,
        nowIso
      );
      userRow = findUserById(userId);
    } else if (userRow) {
      db.prepare("UPDATE users SET email_confirmed = 1, updated_at = ? WHERE id = ?").run(nowIso, userRow.id);
    }
    if (!userRow) {
      return res.status(404).json({ error: "User not found" });
    }
    const profile = ensureProfileRecord(userRow.id, {
      username: cleanUsername,
      display_name: cleanUsername,
      email: cleanEmail
    });
    const session = createSessionForUser(userRow.id);
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
app.post("/api/auth/verify-otp", (req, res) => {
  try {
    const { email, otpCode } = req.body || {};
    if (!email || !otpCode) {
      return res.status(400).json({ error: "email and otpCode are required" });
    }
    const cleanEmail = String(email).trim().toLowerCase();
    const cleanCode = String(otpCode).trim();
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
    const userRow = findUserByEmail(cleanEmail);
    let session = null;
    let user = null;
    let profile = null;
    if (userRow) {
      db.prepare("UPDATE users SET email_confirmed = 1, updated_at = ? WHERE id = ?").run(
        (/* @__PURE__ */ new Date()).toISOString(),
        userRow.id
      );
      session = createSessionForUser(userRow.id);
      user = formatAuthUser(userRow);
      profile = getProfileById(userRow.id);
    }
    return res.json({ success: true, verified: true, session, user, profile });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to verify OTP" });
  }
});
app.get("/api/auth/check-ban-status", (req, res) => {
  try {
    const token = extractBearerToken(req);
    if (!token) return res.status(401).json({ error: "Not authenticated" });
    const authInfo = getUserBySessionToken(token);
    if (!authInfo) return res.status(401).json({ error: "Not authenticated" });
    const bannedUntil = authInfo.userRow.banned_until;
    const isBanned = Boolean(bannedUntil && new Date(bannedUntil).getTime() > Date.now());
    return res.json({ banned: isBanned, bannedUntil: bannedUntil || null });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to check ban status" });
  }
});
app.post("/api/admin/ban-user", async (req, res) => {
  try {
    const { adminId, targetUserId, targetEmail, targetUsername, targetDisplayName, reason } = req.body || {};
    if (!targetUserId && !targetEmail) {
      return res.status(400).json({ error: "targetUserId or targetEmail is required" });
    }
    let emailToSend = targetEmail;
    let usernameToSend = targetUsername || "user";
    let displayNameToSend = targetDisplayName || "User";
    const targetProfile = targetUserId ? getProfileById(targetUserId) : null;
    if (targetProfile) {
      if (targetProfile.email) emailToSend = targetProfile.email;
      if (targetProfile.username) usernameToSend = targetProfile.username;
      if (targetProfile.display_name) displayNameToSend = targetProfile.display_name;
    }
    if (targetUserId) {
      const banDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1e3).toISOString();
      db.prepare("UPDATE users SET banned_until = ?, updated_at = ? WHERE id = ?").run(
        banDate,
        (/* @__PURE__ */ new Date()).toISOString(),
        targetUserId
      );
      if (adminId) {
        db.prepare(
          "INSERT OR IGNORE INTO blocked_users (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)"
        ).run(adminId, targetUserId, (/* @__PURE__ */ new Date()).toISOString());
      }
    }
    let emailSent = false;
    if (emailToSend) {
      emailSent = await sendBanNotificationEmail(
        emailToSend,
        usernameToSend,
        displayNameToSend,
        reason || "Violation of LiveConnect Community Guidelines & Safety Policies"
      );
    }
    return res.json({
      success: true,
      bannedUserId: targetUserId || null,
      targetEmail: emailToSend || null,
      emailSent,
      message: emailSent ? `User @${usernameToSend} has been banned and notification email was sent to ${emailToSend}.` : `User @${usernameToSend} has been banned.`
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to ban user" });
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
async function processTruecallerVerifiedProfile(requestId, rawPhone, displayName, avatarUrl, country) {
  try {
    const cleanDigits = rawPhone.replace(/\D/g, "");
    const formattedPhone = cleanDigits.length === 10 ? `+91${cleanDigits}` : `+${cleanDigits}`;
    const userEmail = `tc_${cleanDigits}@liveconnect.app`;
    let userRow = findUserByEmail(userEmail);
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const baseUsername = (displayName || `user_${cleanDigits.slice(-4)}`).toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 15) || `user_${cleanDigits.slice(-4)}`;
    if (!userRow) {
      const userId = generateUUID();
      const meta = {
        display_name: displayName || `User ${cleanDigits.slice(-4)}`,
        username: baseUsername,
        avatar_url: avatarUrl || null,
        phone: formattedPhone,
        verified_by: "truecaller"
      };
      db.prepare(`
        INSERT INTO users (id, email, password_hash, email_confirmed, phone, user_metadata, created_at, updated_at)
        VALUES (?, ?, NULL, 1, ?, ?, ?, ?)
      `).run(userId, userEmail, formattedPhone, JSON.stringify(meta), nowIso, nowIso);
      userRow = findUserById(userId);
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
    const session = createSessionForUser(userRow.id);
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
    const result = await processTruecallerVerifiedProfile(reqId, cleanDigits, displayName, void 0, "India");
    if (!result.success) {
      return res.status(500).json({ error: result.error || "Failed to authenticate mobile number" });
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
    const result = await processTruecallerVerifiedProfile(reqId, cleanDigits, displayName, void 0, "India");
    if (!result.success) {
      return res.status(500).json({ error: result.error || "Failed to authenticate mobile number" });
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
      users: rows.map((r) => ({ id: r.id, is_online: true, last_seen: r.last_seen }))
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
    if (viewerId && targetId && viewerId !== targetId && isBlocked(viewerId, targetId)) {
      return res.status(404).json({ error: "User not found" });
    }
    const followingRows = db.prepare("SELECT following_id FROM follows WHERE follower_id = ?").all(targetId);
    const followerRows = db.prepare("SELECT follower_id FROM follows WHERE following_id = ?").all(targetId);
    const blockedByMeRows = db.prepare("SELECT blocked_id FROM blocked_users WHERE blocker_id = ?").all(targetId);
    const blockedByThemRows = db.prepare("SELECT blocker_id FROM blocked_users WHERE blocked_id = ?").all(targetId);
    const following = followingRows.map((r) => r.following_id).filter((id) => !isBlocked(targetId, id) && (!viewerId || !isBlocked(viewerId, id)));
    const followers = followerRows.map((r) => r.follower_id).filter((id) => !isBlocked(targetId, id) && (!viewerId || !isBlocked(viewerId, id)));
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
    if (userId && Array.isArray(following)) {
      for (const id of following) {
        if (id && id !== userId && !isBlocked(userId, id)) stmt.run(userId, id, nowIso);
      }
    }
    if (userId && Array.isArray(followers)) {
      for (const id of followers) {
        if (id && id !== userId && !isBlocked(userId, id)) stmt.run(id, userId, nowIso);
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
    if (isBlocked(userId, targetUserId)) {
      return res.status(403).json({ error: "Cannot follow a blocked user" });
    }
    if (userMeta) ensureProfileRecord(userId, userMeta);
    if (targetMeta) ensureProfileRecord(targetUserId, targetMeta);
    db.prepare(
      "INSERT OR IGNORE INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)"
    ).run(userId, targetUserId, (/* @__PURE__ */ new Date()).toISOString());
    const wasFollowedByTarget = isFollowing(targetUserId, userId);
    const isMutualNow = wasFollowedByTarget;
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
    const notifications = rows.filter((r) => !r.actor_id || !isBlocked(userId, r.actor_id)).map((r) => {
      let actor = null;
      if (r.actor_json) {
        try {
          actor = JSON.parse(r.actor_json);
        } catch {
        }
      }
      if (!actor && r.actor_id) actor = getProfileCachedOrDb(r.actor_id);
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
    const pendingCalls = rows.filter((r) => !isBlocked(userId, r.caller_id)).filter((r) => !(deviceId && r.caller_device_id && r.caller_device_id === deviceId)).map(formatCallRow);
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
    const existing = db.prepare("SELECT * FROM conversations WHERE id = ?").get(convId);
    if (!existing) {
      db.prepare(
        "INSERT INTO conversations (id, type, created_at, updated_at) VALUES (?, ?, ?, ?)"
      ).run(convId, "direct", nowIso, nowIso);
      db.prepare(
        "INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)"
      ).run(convId, userId, "member", nowIso);
      if (userId !== targetUserId) {
        db.prepare(
          "INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)"
        ).run(convId, targetUserId, "member", nowIso);
      }
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
      if (otherId && otherId !== userId && isBlocked(userId, otherId)) continue;
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
    const visibleUsers = rows.filter((r) => !viewerId || !isBlocked(viewerId, r.id)).map(formatProfile).filter(Boolean);
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
    db.prepare("DELETE FROM deleted_conversations WHERE conversation_id = ?").run(convId);
    const existingConv = buildConversationObject(convId, senderId);
    let targetRecipient = recipientId || receiverId;
    if (!targetRecipient && existingConv?.member_ids) {
      targetRecipient = existingConv.member_ids.find((id) => id !== senderId);
    }
    if (targetRecipient && targetRecipient !== senderId) {
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
    if (!existingConv) {
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
    } else {
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
    const savedMsg = formatMessageRow(db.prepare("SELECT * FROM messages WHERE id = ?").get(message.id));
    return res.json({ success: true, message: savedMsg || message });
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
    const messages = rows.filter((r) => !userId || !isBlocked(userId, r.sender_id)).map(formatMessageRow).filter(Boolean);
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
    app.use(import_express.default.static(distPath));
    app.get("*", (_req, res) => {
      const indexPath = import_path3.default.join(distPath, "index.html");
      if (import_fs3.default.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send("App build not found. Please run npm run build.");
      }
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`LiveConnect server listening on http://0.0.0.0:${PORT}`);
  });
}
startServer().catch((err) => {
  console.error("Failed to start server:", err);
});
var server_default = app;
//# sourceMappingURL=server.cjs.map
