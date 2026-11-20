import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import fs from 'fs';
import { spawn } from 'child_process';
import nodemailer from 'nodemailer';
import dns from 'dns';
import {
  db,
  UPLOADS_DIR,
  generateId,
  hashPassword,
  verifyPassword,
  formatAuthUser,
  formatProfile,
  createSessionForUser,
  getUserBySessionToken,
  deleteSessionToken,
  findUserByEmail,
  findUserById,
  getProfileById,
  getProfileByUsername,
  upsertProfile,
  deleteAccountCompletely,
  DbUserRow,
  DbProfileRow,
} from './server/db';
import {
  uploadBufferToCloudinary,
  deleteAssetFromCloudinary,
  validateCloudinaryFileSize,
  CloudinaryMediaCategory,
} from './server/cloudinaryService';

if (fs.existsSync(path.join(process.cwd(), '.env.example'))) {
  dotenv.config({ path: path.join(process.cwd(), '.env.example') });
}
dotenv.config();

function generateUUID(): string {
  return generateId();
}

// Helper: Create Render-Safe SMTP Transporter (Forces IPv4 to prevent ENETUNREACH)
function createStandardTransporter(host?: string, port?: number, user?: string, pass?: string) {
  const targetHost = host || process.env.SMTP_HOST || 'smtp.gmail.com';
  const targetPort = port || parseInt(process.env.SMTP_PORT || '587', 10);
  const targetUser = user || process.env.SMTP_USER || process.env.GMAIL_USER || '';
  const targetPass = pass || process.env.SMTP_PASS || process.env.GMAIL_PASS || '';

  const isGmail = targetHost.includes('gmail.com') || targetUser.endsWith('@gmail.com');
  const finalHost = isGmail ? 'smtp.gmail.com' : targetHost;
  const finalPort = isGmail ? 587 : targetPort;
  const isSecure = finalPort === 465;

  return nodemailer.createTransport({
    host: finalHost,
    port: finalPort,
    secure: isSecure,
    requireTLS: !isSecure,
    auth: { user: targetUser, pass: targetPass },
    lookup: (hostname: string, _options: any, callback: any) => {
      dns.lookup(hostname, { family: 4 }, callback);
    },
    connectionTimeout: 7000,
    greetingTimeout: 5000,
    socketTimeout: 8000,
    tls: { rejectUnauthorized: false },
  } as any);
}

// Helper: Send Ban Email Notification to User's Email
async function sendBanNotificationEmail(toEmail: string, username: string, displayName: string, reason?: string) {
  if (!toEmail || !toEmail.includes('@')) {
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
    ${
      reason
        ? `<div style="background-color: #262626; border-left: 4px solid #ef4444; padding: 14px 16px; border-radius: 8px; margin-bottom: 16px;">
            <p style="color: #a3a3a3; font-size: 11px; margin: 0 0 4px 0; font-weight: bold; text-transform: uppercase;">Reason for Ban:</p>
            <p style="color: #f87171; font-size: 14px; margin: 0; font-weight: 600;">${reason}</p>
          </div>`
        : ''
    }
  </div>
</div>`;

  try {
    await transporter.sendMail({
      from: '"LiveConnect Security" <security@liveconnect.app>',
      to: toEmail,
      subject: `Account Banned Notice: LiveConnect (@${username})`,
      html: htmlContent,
    });
    return true;
  } catch (err: any) {
    console.warn(`[Ban Email] Email send notice for ${toEmail}:`, err.message || err);
    return false;
  }
}

// Helper: Send OTP Verification Email via SMTP
async function sendOtpEmail(toEmail: string, otpCode: string) {
  if (!toEmail || !toEmail.includes('@')) return false;

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
      html: htmlContent,
    });
    return true;
  } catch (err: any) {
    console.warn(`[OTP Email] Error sending to ${toEmail}:`, err.message || err);
    return false;
  }
}

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Media cache + disk storage
interface MediaFileRecord {
  id: string;
  buffer: Buffer;
  mimeType: string;
  fileName?: string;
  size: number;
  createdAt: string;
  mp3Buffer?: Buffer;
}
const mediaFilesStore = new Map<string, MediaFileRecord>();

function transcodeAudioToMp3(inputBuffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const ff = spawn('ffmpeg', [
        '-y',
        '-i', 'pipe:0',
        '-vn',
        '-c:a', 'libmp3lame',
        '-b:a', '128k',
        '-ar', '44100',
        '-f', 'mp3',
        'pipe:1',
      ]);

      const chunks: Buffer[] = [];
      ff.stdout.on('data', (chunk) => chunks.push(chunk));
      ff.stderr.on('data', () => {});
      ff.on('close', (code) => {
        if (code === 0 && chunks.length > 0) {
          resolve(Buffer.concat(chunks));
        } else {
          reject(new Error(`FFmpeg audio conversion exited with code ${code}`));
        }
      });
      ff.on('error', (err) => reject(err));

      ff.stdin.write(inputBuffer);
      ff.stdin.end();
    } catch (err) {
      reject(err);
    }
  });
}

// Fast caches synchronized with SQLite
const registeredUsernames = new Map<string, string>();
const serverProfilesStore = new Map<string, any>();
const typingStateMap = new Map<string, Map<string, number>>(); // convId -> Map<userId, expiresAt>

// Hydrate initial profile caches from SQLite
try {
  const profileRows = db.prepare('SELECT * FROM profiles').all() as unknown as DbProfileRow[];
  for (const row of profileRows) {
    const p = formatProfile(row);
    if (p) {
      serverProfilesStore.set(p.id, p);
      if (p.username) registeredUsernames.set(p.username.toLowerCase(), p.id);
    }
  }
} catch (err) {
  console.warn('[SQLite Init] Profile cache hydration warning:', err);
}

// Helper: Extract bearer token
function extractBearerToken(req: express.Request): string {
  const authHeader = req.headers.authorization || '';
  return authHeader.replace(/^Bearer\s+/i, '').trim();
}

// Deterministic direct conversation ID
function getDeterministicDirectConvId(userA: string, userB: string): string {
  const sorted = [userA || '', userB || ''].sort().join(':');
  let h1 = 0x811c9dc5, h2 = 0x811c9dc5, h3 = 0x811c9dc5, h4 = 0x811c9dc5;
  for (let i = 0; i < sorted.length; i++) {
    const code = sorted.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ (code + i), 2246822507) >>> 0;
    h3 = Math.imul(h3 ^ ((code << 3) + i), 3266489909) >>> 0;
    h4 = Math.imul(h4 ^ ((code << 5) + i), 1597334677) >>> 0;
  }
  h1 = (Math.imul(h1 ^ (h3 >>> 15), 2246822507) ^ h4) >>> 0;
  h2 = (Math.imul(h2 ^ (h4 >>> 13), 3266489909) ^ h1) >>> 0;
  h3 = (Math.imul(h3 ^ (h1 >>> 16), 1597334677) ^ h2) >>> 0;
  h4 = (Math.imul(h4 ^ (h2 >>> 11), 2654435761) ^ h3) >>> 0;

  const hex1 = h1.toString(16).padStart(8, '0');
  const hex2 = (h2 & 0xffff).toString(16).padStart(4, '0');
  const hex3 = '4' + ((h2 >>> 16) & 0x0fff).toString(16).padStart(3, '0');
  const hex4 = (0x8 | ((h3 >>> 28) & 0x3)).toString(16) + (h3 & 0x0fff).toString(16).padStart(3, '0');
  const hex5 = h4.toString(16).padStart(8, '0') + ((h3 >>> 12) & 0xffff).toString(16).padStart(4, '0');

  return `${hex1}-${hex2}-${hex3}-${hex4}-${hex5}`.toLowerCase();
}

function getProfileCachedOrDb(userId: string) {
  if (!userId) return null;
  const fromDb = getProfileById(userId);
  if (fromDb) {
    serverProfilesStore.set(userId, fromDb);
    return fromDb;
  }
  return serverProfilesStore.get(userId) || null;
}

function ensureProfileRecord(userId: string, meta?: any) {
  if (!userId) return null;
  const existing = getProfileById(userId);
  if (existing) {
    if (meta && (meta.display_name || meta.username || meta.avatar_url)) {
      const updated = upsertProfile({
        id: userId,
        username: meta.username || existing.username,
        display_name: meta.display_name || existing.display_name,
        avatar_url: meta.avatar_url !== undefined ? meta.avatar_url : existing.avatar_url,
        bio: meta.bio ?? existing.bio,
        country: meta.country ?? existing.country,
        gender: meta.gender ?? existing.gender,
        email: meta.email ?? existing.email,
        phone_number: meta.phone_number ?? existing.phone_number,
      });
      serverProfilesStore.set(userId, updated);
      return updated;
    }
    return existing;
  }
  const baseUname = (meta?.username || `user_${userId.slice(0, 8)}`)
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '') || `user_${userId.slice(0, 6)}`;
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
    bio: meta?.bio || 'Hey there! I am using LiveConnect.',
    country: meta?.country || 'India',
    gender: meta?.gender || null,
    email: meta?.email || null,
    phone_number: meta?.phone_number || null,
    is_online: true,
  });
  serverProfilesStore.set(userId, created);
  registeredUsernames.set(created.username.toLowerCase(), userId);
  return created;
}

function resolveUserId(idOrUsername: string): string {
  if (!idOrUsername) return '';
  if (getProfileById(idOrUsername) || serverProfilesStore.has(idOrUsername)) return idOrUsername;
  const byUname = getProfileByUsername(idOrUsername);
  if (byUname) return byUname.id;
  return idOrUsername;
}

function isBlocked(userA: string, userB: string): boolean {
  if (!userA || !userB) return false;
  const row = db
    .prepare(
      'SELECT 1 FROM blocked_users WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1'
    )
    .get(userA, userB, userB, userA);
  return Boolean(row);
}

function isFollowing(followerId: string, followingId: string): boolean {
  if (!followerId || !followingId) return false;
  const fId = resolveUserId(followerId);
  const tId = resolveUserId(followingId);
  const row = db
    .prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ? LIMIT 1')
    .get(fId, tId);
  return Boolean(row);
}

function isMutualFollow(userA: string, userB: string): boolean {
  if (!userA || !userB || userA === userB) return false;
  if (isBlocked(userA, userB)) return false;
  return isFollowing(userA, userB) && isFollowing(userB, userA);
}

function getFollowCounts(userId: string) {
  const canonicalUserId = resolveUserId(userId);
  const followersRow = db
    .prepare('SELECT COUNT(*) as cnt FROM follows WHERE following_id = ?')
    .get(canonicalUserId) as { cnt: number };
  const followingRow = db
    .prepare('SELECT COUNT(*) as cnt FROM follows WHERE follower_id = ?')
    .get(canonicalUserId) as { cnt: number };
  return {
    followersCount: Number(followersRow?.cnt || 0),
    followingCount: Number(followingRow?.cnt || 0),
  };
}

function addNotification(
  userId: string,
  actorId: string,
  type: string,
  title: string,
  message: string,
  referenceId?: string,
  actorMeta?: any
) {
  if (!userId || !actorId || userId === actorId) return;
  if (isBlocked(userId, actorId)) return;

  const tenSecAgo = new Date(Date.now() - 10000).toISOString();
  const dup = db
    .prepare(
      'SELECT * FROM notifications WHERE user_id = ? AND actor_id = ? AND type = ? AND created_at > ? ORDER BY created_at DESC LIMIT 1'
    )
    .get(userId, actorId, type, tenSecAgo) as any;

  const nowIso = new Date().toISOString();
  const actorObj = actorMeta || getProfileCachedOrDb(actorId) || { id: actorId, display_name: 'User', username: 'user' };

  if (dup) {
    db.prepare('UPDATE notifications SET title = ?, message = ?, created_at = ? WHERE id = ?').run(
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
      actor: actorObj,
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
    actor: actorObj,
  };
}

// Format DB conversation row + members + last message
function buildConversationObject(convId: string, requestingUserId?: string) {
  const convRow = db.prepare('SELECT * FROM conversations WHERE id = ?').get(convId) as any;
  if (!convRow) return null;

  const memberRows = db
    .prepare('SELECT user_id, role, joined_at FROM conversation_members WHERE conversation_id = ?')
    .all(convId) as { user_id: string; role: string; joined_at: string }[];

  const memberIds = memberRows.map((m) => m.user_id);
  const memberRoles: Record<string, 'admin' | 'member'> = {};
  const membersMeta: Record<string, any> = {};

  for (const m of memberRows) {
    memberRoles[m.user_id] = m.role === 'admin' || m.user_id === convRow.owner_id ? 'admin' : 'member';
    const prof = getProfileCachedOrDb(m.user_id);
    if (prof) {
      membersMeta[m.user_id] = prof;
    }
  }

  let removedMembers: Record<string, any> = {};
  if (convRow.removed_members_json) {
    try {
      removedMembers = JSON.parse(convRow.removed_members_json);
    } catch {
      removedMembers = {};
    }
  }

  const isGroup =
    convRow.type === 'group' ||
    Boolean(convRow.name) ||
    Boolean(convRow.owner_id) ||
    memberIds.length > 2;

  const msgRow = db
    .prepare(
      `SELECT m.* FROM messages m
       LEFT JOIN deleted_messages dm ON m.id = dm.message_id
       WHERE m.conversation_id = ? AND dm.message_id IS NULL
       ORDER BY m.created_at DESC LIMIT 1`
    )
    .get(convId) as any;

  const lastMessage = msgRow ? formatMessageRow(msgRow) : null;

  let unreadCount = 0;
  if (requestingUserId) {
    const unreadRow = db
      .prepare(
        `SELECT COUNT(*) as cnt FROM messages m
         LEFT JOIN deleted_messages dm ON m.id = dm.message_id
         LEFT JOIN message_reads mr ON m.id = mr.message_id AND mr.user_id = ?
         WHERE m.conversation_id = ? AND dm.message_id IS NULL
           AND m.sender_id != ? AND m.is_read = 0 AND mr.message_id IS NULL`
      )
      .get(requestingUserId, convId, requestingUserId) as { cnt: number };
    unreadCount = Number(unreadRow?.cnt || 0);
  }

  const effectiveUpdatedAt = lastMessage?.created_at
    ? new Date(lastMessage.created_at).getTime() > new Date(convRow.updated_at || 0).getTime()
      ? lastMessage.created_at
      : convRow.updated_at
    : convRow.updated_at;

  let otherProfile: any = undefined;
  if (!isGroup && requestingUserId) {
    const otherId = memberIds.find((id) => id !== requestingUserId) || requestingUserId;
    otherProfile = membersMeta[otherId] ||
      getProfileCachedOrDb(otherId) || {
        id: otherId,
        username: 'user',
        display_name: 'User',
        avatar_url: null,
        bio: null,
        is_online: false,
        last_seen: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
  }

  const isRemoved = requestingUserId ? Boolean(removedMembers[requestingUserId]) : false;

  return {
    id: convRow.id,
    type: isGroup ? ('group' as const) : ('direct' as const),
    name: convRow.name || undefined,
    description: convRow.description || undefined,
    avatar_url: convRow.avatar_url || undefined,
    owner_id: convRow.owner_id || undefined,
    pinned_message_id: convRow.pinned_message_id || null,
    member_ids: memberIds,
    members_meta: membersMeta,
    member_roles: memberRoles,
    removed_members: removedMembers,
    is_removed: isRemoved,
    removal_info: isRemoved && requestingUserId ? removedMembers[requestingUserId] : null,
    created_at: convRow.created_at,
    updated_at: effectiveUpdatedAt,
    other_member: otherProfile,
    last_message: lastMessage,
    unread_count: unreadCount,
  };
}

function formatMessageRow(row: any) {
  if (!row) return null;
  let reactions: Record<string, string[]> | undefined = undefined;
  if (row.reactions_json) {
    try {
      reactions = JSON.parse(row.reactions_json);
    } catch {
      reactions = undefined;
    }
  }
  let mentions: string[] | undefined = undefined;
  if (row.mentions_json) {
    try {
      mentions = JSON.parse(row.mentions_json);
    } catch {
      mentions = undefined;
    }
  }

  const sender = getProfileCachedOrDb(row.sender_id) || undefined;

  const readRows = db
    .prepare('SELECT message_id, user_id, read_at FROM message_reads WHERE message_id = ?')
    .all(row.id) as { message_id: string; user_id: string; read_at: string }[];

  return {
    id: row.id,
    conversation_id: row.conversation_id,
    sender_id: row.sender_id,
    content: row.content,
    reply_to_message_id: row.reply_to_message_id || null,
    reactions,
    mentions,
    media_type: row.media_type || undefined,
    cloudinary_public_id: row.cloudinary_public_id || undefined,
    b2_file_id: row.b2_file_id || undefined,
    b2_file_name: row.b2_file_name || undefined,
    is_read: Boolean(row.is_read) || readRows.length > 0,
    reads: readRows.map((r) => ({
      id: `${r.message_id}_${r.user_id}`,
      message_id: r.message_id,
      user_id: r.user_id,
      read_at: r.read_at,
    })),
    sender,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ====================================================================
// ACCOUNT DELETION ENDPOINT
// ====================================================================
app.post('/api/account/delete', async (req, res) => {
  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch {}
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
      return res.status(400).json({ error: 'User ID or valid authentication token required' });
    }

    serverProfilesStore.delete(targetId);
    for (const [uname, uId] of registeredUsernames.entries()) {
      if (uId === targetId) registeredUsernames.delete(uname);
    }

    deleteAccountCompletely(targetId);

    return res.json({
      success: true,
      message: 'Account and all associated user data deleted permanently.',
    });
  } catch (error: any) {
    console.error('[Account Deletion Error]:', error);
    return res.status(500).json({ error: error?.message || 'Failed to delete account' });
  }
});

// ====================================================================
// AUTHENTICATION & USERNAME ENDPOINTS (SQLite Backed)
// ====================================================================

// 1. Check username availability
app.post('/api/auth/check-username', (req, res) => {
  try {
    const { username, excludeUserId } = req.body || {};
    if (!username) {
      return res.status(400).json({ available: false, message: 'Username is required' });
    }

    const clean = String(username).trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (clean.length < 3) {
      return res.json({
        available: false,
        message: 'Username must be at least 3 characters (letters, numbers, underscores only).',
      });
    }

    const existing = getProfileByUsername(clean);
    if (existing && (!excludeUserId || existing.id !== excludeUserId)) {
      registeredUsernames.set(clean, existing.id);
      return res.json({
        available: false,
        message: `@${clean} is already taken. Please choose another.`,
      });
    }

    return res.json({
      available: true,
      message: `@${clean} is available!`,
    });
  } catch (error: any) {
    return res.status(500).json({ available: false, message: error.message });
  }
});

// 2. Suggest unique username
app.post('/api/auth/suggest-username', (req, res) => {
  try {
    const { baseHint } = req.body || {};
    const cleanBase = String(baseHint || 'user')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '')
      .substring(0, 10);
    const base = cleanBase.length >= 3 ? cleanBase : 'user';

    for (let i = 0; i < 15; i++) {
      const randomSuffix = Math.floor(100 + Math.random() * 9000);
      const candidate = `${base}_${randomSuffix}`;
      if (!getProfileByUsername(candidate) && !registeredUsernames.has(candidate)) {
        return res.json({ username: candidate });
      }
    }

    return res.json({ username: `${base}_${Date.now().toString().slice(-4)}` });
  } catch {
    return res.json({ username: `user_${Math.floor(1000 + Math.random() * 9000)}` });
  }
});

// 3. Claim username
app.post('/api/auth/claim-username', (req, res) => {
  try {
    const { username, userId } = req.body || {};
    if (username && userId) {
      const clean = String(username).trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
      registeredUsernames.set(clean, userId);
    }
    return res.json({ success: true });
  } catch {
    return res.json({ success: false });
  }
});

// 4. Create account (email/password + OTP)
app.post('/api/auth/create-account', async (req, res) => {
  try {
    const { email, password, displayName, username, country } = req.body || {};
    if (!email || !password || !username) {
      return res.status(400).json({ error: 'Email, password and username are required' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanUsername = String(username).trim().toLowerCase().replace(/[^a-z0-9_]/g, '');

    if (cleanUsername.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters.' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    if (findUserByEmail(cleanEmail)) {
      return res.status(400).json({ error: 'Account already exists with this email!' });
    }
    if (getProfileByUsername(cleanUsername)) {
      return res.status(400).json({ error: `@${cleanUsername} is already taken.` });
    }

    const userId = generateUUID();
    const nowIso = new Date().toISOString();
    const meta = {
      display_name: displayName?.trim() || cleanUsername,
      username: cleanUsername,
      country: country || 'India',
    };

    db.prepare(`
      INSERT INTO users (id, email, password_hash, email_confirmed, user_metadata, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?, ?)
    `).run(userId, cleanEmail, hashPassword(password), JSON.stringify(meta), nowIso, nowIso);

    const profile = upsertProfile({
      id: userId,
      username: cleanUsername,
      display_name: displayName?.trim() || cleanUsername,
      country: country || 'India',
      email: cleanEmail,
      bio: 'Hey there! I am using LiveConnect.',
      is_online: true,
    });
    serverProfilesStore.set(userId, profile);
    registeredUsernames.set(cleanUsername, userId);

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    db.prepare('DELETE FROM user_otps WHERE LOWER(email) = LOWER(?)').run(cleanEmail);
    db.prepare(
      'INSERT INTO user_otps (id, email, otp_code, type, verified, expires_at, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)'
    ).run(generateUUID(), cleanEmail, code, 'signup', expiresAt, nowIso);

    const emailSent = await sendOtpEmail(cleanEmail, code).catch(() => false);

    const userRow = findUserById(userId)!;
    const session = createSessionForUser(userId);

    return res.json({
      success: true,
      userId,
      needsOtp: true,
      emailSent,
      otpCode: code,
      session,
      user: formatAuthUser(userRow),
      profile,
    });
  } catch (err: any) {
    console.error('create-account error:', err);
    return res.status(500).json({ error: err.message || 'Failed to create account' });
  }
});

// 5. Email/Password Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const userRow = findUserByEmail(cleanEmail);
    if (!userRow) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (!userRow.password_hash || !verifyPassword(String(password), userRow.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (userRow.banned_until && new Date(userRow.banned_until).getTime() > Date.now()) {
      return res.status(403).json({
        error: 'Your account has been suspended.',
        banned: true,
        bannedUntil: userRow.banned_until,
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
      needsOnboarding: !profile,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to sign in' });
  }
});

// 6. Google OAuth Login (verifies GIS ID Token or Google Access Token)
app.post('/api/auth/google', async (req, res) => {
  try {
    const { credential, accessToken } = req.body || {};
    if (!credential && !accessToken) {
      return res.status(400).json({ error: 'Google credential or accessToken is required' });
    }

    let googleProfile: { email?: string; name?: string; picture?: string; sub?: string } | null = null;

    if (credential) {
      const verifyRes = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`
      );
      if (!verifyRes.ok) {
        return res.status(401).json({ error: 'Invalid Google credential token.' });
      }
      const info: any = await verifyRes.json();
      const configuredClientId = (process.env.VITE_GOOGLE_CLIENT_ID || '').trim();
      if (configuredClientId && info.aud && info.aud !== configuredClientId) {
        return res.status(401).json({ error: 'Google token audience mismatch.' });
      }
      googleProfile = {
        email: info.email,
        name: info.name,
        picture: info.picture,
        sub: info.sub,
      };
    } else if (accessToken) {
      const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!userRes.ok) {
        return res.status(401).json({ error: 'Invalid Google access token.' });
      }
      const info: any = await userRes.json();
      googleProfile = {
        email: info.email,
        name: info.name,
        picture: info.picture,
        sub: info.sub,
      };
    }

    if (!googleProfile?.email) {
      return res.status(400).json({ error: 'Google account did not return an email address.' });
    }

    const cleanEmail = googleProfile.email.trim().toLowerCase();
    let userRow = findUserByEmail(cleanEmail);
    const nowIso = new Date().toISOString();

    if (!userRow) {
      const userId = generateUUID();
      const meta = {
        full_name: googleProfile.name || cleanEmail.split('@')[0],
        name: googleProfile.name || cleanEmail.split('@')[0],
        avatar_url: googleProfile.picture || null,
        picture: googleProfile.picture || null,
        provider: 'google',
        google_sub: googleProfile.sub,
      };
      db.prepare(`
        INSERT INTO users (id, email, password_hash, email_confirmed, user_metadata, created_at, updated_at)
        VALUES (?, ?, NULL, 1, ?, ?, ?)
      `).run(userId, cleanEmail, JSON.stringify(meta), nowIso, nowIso);
      userRow = findUserById(userId)!;
    } else {
      if (userRow.banned_until && new Date(userRow.banned_until).getTime() > Date.now()) {
        return res.status(403).json({
          error: 'Your account has been suspended.',
          banned: true,
          bannedUntil: userRow.banned_until,
        });
      }
      let existingMeta: any = {};
      try { existingMeta = userRow.user_metadata ? JSON.parse(userRow.user_metadata) : {}; } catch {}
      const updatedMeta = {
        ...existingMeta,
        full_name: googleProfile.name || existingMeta.full_name,
        avatar_url: existingMeta.avatar_url || googleProfile.picture || null,
        provider: 'google',
      };
      db.prepare('UPDATE users SET user_metadata = ?, email_confirmed = 1, updated_at = ? WHERE id = ?').run(
        JSON.stringify(updatedMeta),
        nowIso,
        userRow.id
      );
      userRow = findUserById(userRow.id)!;
    }

    const session = createSessionForUser(userRow.id);
    const profile = getProfileById(userRow.id);

    return res.json({
      success: true,
      session,
      user: formatAuthUser(userRow),
      profile,
      needsOnboarding: !profile,
    });
  } catch (err: any) {
    console.error('[Google Auth Error]:', err);
    return res.status(500).json({ error: err.message || 'Google sign-in failed' });
  }
});

// 7. Get Current Session
app.get('/api/auth/session', (req, res) => {
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
        bannedUntil,
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
      bannedUntil: null,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Session lookup failed' });
  }
});

// 8. Logout
app.post('/api/auth/logout', (req, res) => {
  try {
    const token = extractBearerToken(req);
    if (token) {
      const authInfo = getUserBySessionToken(token);
      if (authInfo?.user?.id) {
        db.prepare('UPDATE profiles SET is_online = 0, last_seen = ? WHERE id = ?').run(
          new Date().toISOString(),
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

// 9. Complete Onboarding (Create profile for newly signed-in user)
app.post('/api/auth/complete-onboarding', (req, res) => {
  try {
    const token = extractBearerToken(req);
    const authInfo = token ? getUserBySessionToken(token) : null;
    const { userId: bodyUserId, username, displayName, country, bio, gender, avatarUrl } = req.body || {};

    const targetUserId = authInfo?.user?.id || bodyUserId;
    if (!targetUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const cleanUsername = String(username || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (cleanUsername.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters.' });
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
      country: country || 'India',
      bio: bio || 'Hey there! I am using LiveConnect.',
      gender: gender || null,
      avatar_url: avatarUrl || null,
      email: userRow?.email || null,
      is_online: true,
    });

    if (userRow) {
      let existingMeta: any = {};
      try { existingMeta = userRow.user_metadata ? JSON.parse(userRow.user_metadata) : {}; } catch {}
      db.prepare('UPDATE users SET user_metadata = ?, updated_at = ? WHERE id = ?').run(
        JSON.stringify({
          ...existingMeta,
          username: cleanUsername,
          display_name: profile.display_name,
          avatar_url: profile.avatar_url,
          country: profile.country,
          gender: profile.gender,
        }),
        new Date().toISOString(),
        targetUserId
      );
    }

    serverProfilesStore.set(targetUserId, profile);
    registeredUsernames.set(cleanUsername, targetUserId);

    return res.json({ success: true, profile });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to save onboarding profile' });
  }
});

// 10. Update Profile
app.post('/api/auth/update-profile', (req, res) => {
  try {
    const token = extractBearerToken(req);
    const authInfo = token ? getUserBySessionToken(token) : null;
    const { userId: bodyUserId, updates } = req.body || {};

    const targetUserId = authInfo?.user?.id || bodyUserId;
    if (!targetUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const existing = getProfileById(targetUserId);
    const nextUsername = updates?.username
      ? String(updates.username).trim().toLowerCase().replace(/[^a-z0-9_]/g, '')
      : existing?.username || '';

    if (nextUsername && nextUsername.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters.' });
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
      display_name: updates?.display_name ?? existing?.display_name ?? 'User',
      avatar_url: updates?.avatar_url !== undefined ? updates.avatar_url : existing?.avatar_url,
      bio: updates?.bio !== undefined ? updates.bio : existing?.bio,
      gender: updates?.gender !== undefined ? updates.gender : existing?.gender,
      country: updates?.country !== undefined ? updates.country : existing?.country,
      cloudinary_public_id:
        updates?.cloudinary_public_id !== undefined
          ? updates.cloudinary_public_id
          : existing?.cloudinary_public_id,
      b2_file_id: updates?.b2_file_id !== undefined ? updates.b2_file_id : existing?.b2_file_id,
      b2_file_name: updates?.b2_file_name !== undefined ? updates.b2_file_name : existing?.b2_file_name,
    });

    serverProfilesStore.set(targetUserId, profile);
    registeredUsernames.set(profile.username.toLowerCase(), targetUserId);

    return res.json({ success: true, profile });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to update profile' });
  }
});

// 11. Reset Password (Request OTP + Verify Reset)
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Email is required' });
    const cleanEmail = String(email).trim().toLowerCase();
    const userRow = findUserByEmail(cleanEmail);
    if (!userRow) {
      return res.status(404).json({ error: 'No account found with this email address.' });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const nowIso = new Date().toISOString();

    db.prepare('DELETE FROM user_otps WHERE LOWER(email) = LOWER(?) AND type = ?').run(cleanEmail, 'reset');
    db.prepare(
      'INSERT INTO user_otps (id, email, otp_code, type, verified, expires_at, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)'
    ).run(generateUUID(), cleanEmail, code, 'reset', expiresAt, nowIso);

    const emailSent = await sendOtpEmail(cleanEmail, code).catch(() => false);
    return res.json({ success: true, emailSent, otpCode: emailSent ? undefined : code });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to send reset code' });
  }
});

app.post('/api/auth/verify-reset-password', (req, res) => {
  try {
    const { email, otpCode, newPassword } = req.body || {};
    if (!email || !otpCode || !newPassword) {
      return res.status(400).json({ error: 'Email, verification code, and new password are required.' });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanCode = String(otpCode).trim();
    const otpRow = db
      .prepare(
        'SELECT * FROM user_otps WHERE LOWER(email) = LOWER(?) AND type = ? ORDER BY created_at DESC LIMIT 1'
      )
      .get(cleanEmail, 'reset') as any;

    if (!otpRow) {
      return res.status(400).json({ error: 'No reset code found. Please request a new one.' });
    }
    if (otpRow.verified) {
      return res.status(400).json({ error: 'This code was already used.' });
    }
    if (new Date(otpRow.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: 'This code has expired. Please request a new one.' });
    }
    if (String(otpRow.otp_code).trim() !== cleanCode) {
      return res.status(400).json({ error: 'Incorrect verification code.' });
    }

    db.prepare('UPDATE user_otps SET verified = 1 WHERE id = ?').run(otpRow.id);
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE LOWER(email) = LOWER(?)').run(
      hashPassword(String(newPassword)),
      new Date().toISOString(),
      cleanEmail
    );

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to reset password' });
  }
});

// 12. Update Password (authenticated)
app.post('/api/auth/update-password', (req, res) => {
  try {
    const token = extractBearerToken(req);
    const authInfo = getUserBySessionToken(token);
    if (!authInfo) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
      hashPassword(String(newPassword)),
      new Date().toISOString(),
      authInfo.user.id
    );

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to update password' });
  }
});

// 13. Auto Confirm User Endpoint
app.post('/api/auth/confirm-user', (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Email is required' });
    const cleanEmail = String(email).trim().toLowerCase();

    let userRow = findUserByEmail(cleanEmail);
    const nowIso = new Date().toISOString();
    const cleanUsername = cleanEmail.split('@')[0].replace(/[^a-z0-9_]/g, '') || 'user';

    if (!userRow && password) {
      const userId = generateUUID();
      db.prepare(`
        INSERT INTO users (id, email, password_hash, email_confirmed, user_metadata, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?, ?)
      `).run(
        userId,
        cleanEmail,
        hashPassword(String(password)),
        JSON.stringify({ display_name: cleanUsername, username: cleanUsername, country: 'India' }),
        nowIso,
        nowIso
      );
      userRow = findUserById(userId)!;
    } else if (userRow) {
      db.prepare('UPDATE users SET email_confirmed = 1, updated_at = ? WHERE id = ?').run(nowIso, userRow.id);
    }

    if (!userRow) {
      return res.status(404).json({ error: 'User not found' });
    }

    const profile = ensureProfileRecord(userRow.id, {
      username: cleanUsername,
      display_name: cleanUsername,
      email: cleanEmail,
    });
    const session = createSessionForUser(userRow.id);

    return res.json({
      success: true,
      userId: userRow.id,
      session,
      user: formatAuthUser(userRow),
      profile,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to confirm user' });
  }
});

// 14. Send OTP & Verify OTP
app.post('/api/auth/send-otp', async (req, res) => {
  try {
    const { email, type = 'signup' } = req.body || {};
    if (!email) return res.status(400).json({ error: 'email is required' });

    const cleanEmail = String(email).trim().toLowerCase();
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    db.prepare('DELETE FROM user_otps WHERE LOWER(email) = LOWER(?)').run(cleanEmail);
    db.prepare(
      'INSERT INTO user_otps (id, email, otp_code, type, verified, expires_at, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)'
    ).run(generateUUID(), cleanEmail, code, type, expiresAt, new Date().toISOString());

    const emailSent = await sendOtpEmail(cleanEmail, code).catch(() => false);
    return res.json({ success: true, otpCode: code, emailSent, dbSaved: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to send OTP email' });
  }
});

app.post('/api/auth/verify-otp', (req, res) => {
  try {
    const { email, otpCode } = req.body || {};
    if (!email || !otpCode) {
      return res.status(400).json({ error: 'email and otpCode are required' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanCode = String(otpCode).trim();

    const row = db
      .prepare('SELECT * FROM user_otps WHERE LOWER(email) = LOWER(?) ORDER BY created_at DESC LIMIT 1')
      .get(cleanEmail) as any;

    if (!row) {
      return res.status(400).json({ error: 'Verification code not found. Please request a new code.' });
    }
    if (row.verified) {
      return res.status(400).json({ error: 'This code was already used. Please request a new code.' });
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: 'This code has expired. Please request a new code.' });
    }
    if (String(row.otp_code).trim() !== cleanCode) {
      return res.status(400).json({ error: 'Incorrect code. Please check and try again.' });
    }

    db.prepare('UPDATE user_otps SET verified = 1 WHERE id = ?').run(row.id);

    const userRow = findUserByEmail(cleanEmail);
    let session = null;
    let user = null;
    let profile = null;
    if (userRow) {
      db.prepare('UPDATE users SET email_confirmed = 1, updated_at = ? WHERE id = ?').run(
        new Date().toISOString(),
        userRow.id
      );
      session = createSessionForUser(userRow.id);
      user = formatAuthUser(userRow);
      profile = getProfileById(userRow.id);
    }

    return res.json({ success: true, verified: true, session, user, profile });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to verify OTP' });
  }
});

// Check Ban Status Endpoint
app.get('/api/auth/check-ban-status', (req, res) => {
  try {
    const token = extractBearerToken(req);
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    const authInfo = getUserBySessionToken(token);
    if (!authInfo) return res.status(401).json({ error: 'Not authenticated' });

    const bannedUntil = authInfo.userRow.banned_until;
    const isBanned = Boolean(bannedUntil && new Date(bannedUntil).getTime() > Date.now());
    return res.json({ banned: isBanned, bannedUntil: bannedUntil || null });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to check ban status' });
  }
});

// Ban User Endpoint
app.post('/api/admin/ban-user', async (req, res) => {
  try {
    const { adminId, targetUserId, targetEmail, targetUsername, targetDisplayName, reason } = req.body || {};
    if (!targetUserId && !targetEmail) {
      return res.status(400).json({ error: 'targetUserId or targetEmail is required' });
    }

    let emailToSend = targetEmail;
    let usernameToSend = targetUsername || 'user';
    let displayNameToSend = targetDisplayName || 'User';

    const targetProfile = targetUserId ? getProfileById(targetUserId) : null;
    if (targetProfile) {
      if (targetProfile.email) emailToSend = targetProfile.email;
      if (targetProfile.username) usernameToSend = targetProfile.username;
      if (targetProfile.display_name) displayNameToSend = targetProfile.display_name;
    }

    if (targetUserId) {
      const banDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
      db.prepare('UPDATE users SET banned_until = ?, updated_at = ? WHERE id = ?').run(
        banDate,
        new Date().toISOString(),
        targetUserId
      );
      if (adminId) {
        db.prepare(
          'INSERT OR IGNORE INTO blocked_users (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)'
        ).run(adminId, targetUserId, new Date().toISOString());
      }
    }

    let emailSent = false;
    if (emailToSend) {
      emailSent = await sendBanNotificationEmail(
        emailToSend,
        usernameToSend,
        displayNameToSend,
        reason || 'Violation of LiveConnect Community Guidelines & Safety Policies'
      );
    }

    return res.json({
      success: true,
      bannedUserId: targetUserId || null,
      targetEmail: emailToSend || null,
      emailSent,
      message: emailSent
        ? `User @${usernameToSend} has been banned and notification email was sent to ${emailToSend}.`
        : `User @${usernameToSend} has been banned.`,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to ban user' });
  }
});

// ====================================================================
// TRUECALLER 1-TAP & PC OTP AUTH ENDPOINTS
// ====================================================================
interface TruecallerVerificationRecord {
  requestId: string;
  status: 'pending' | 'completed' | 'failed';
  profile?: any;
  user?: any;
  session?: any;
  error?: string;
  createdAt: number;
}
const truecallerVerifications = new Map<string, TruecallerVerificationRecord>();
const pcPhoneOtpStore = new Map<string, { code: string; expiresAt: number; attempts: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [reqId, record] of truecallerVerifications.entries()) {
    if (now - record.createdAt > 15 * 60 * 1000) {
      truecallerVerifications.delete(reqId);
    }
  }
}, 5 * 60 * 1000);

const TRUECALLER_APP_KEY = (
  process.env.TRUECALLER_APP_KEY ||
  process.env.VITE_TRUECALLER_APP_KEY ||
  'VVB4Vacf5545a70f7467094bc0747d59a9819'
).trim();

app.post('/api/auth/truecaller/initiate', (req, res) => {
  try {
    const nonce = `tc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    truecallerVerifications.set(nonce, {
      requestId: nonce,
      status: 'pending',
      createdAt: Date.now(),
    });

    const partnerKey = TRUECALLER_APP_KEY;
    const partnerName = encodeURIComponent('Live Connect APP');
    const privacyUrl = encodeURIComponent('https://live-connect-o0u7.onrender.com');
    const termsUrl = encodeURIComponent('https://live-connect-o0u7.onrender.com');
    const countryCode = (req.body?.countryCode || req.query?.countryCode || 'IN').toString().toUpperCase();
    const params = `type=btmsheet&requestNonce=${nonce}&partnerKey=${partnerKey}&partnerName=${partnerName}&countryCode=${countryCode}&lang=en&title=login&privacyUrl=${privacyUrl}&termsUrl=${termsUrl}&loginPrefix=continue&loginSuffix=login&ctaPrefix=proceed&ctaColor=%230087FF&ctaTextColor=%23ffffff&btnShape=round&skipOption=useanothermethod&ttl=120000`;
    const deepLink = `truecallersdk://truesdk/web_verify?${params}`;
    const androidIntent = `intent://truesdk/web_verify?${params}#Intent;scheme=truecallersdk;package=com.truecaller;end`;

    return res.json({
      success: true,
      requestId: nonce,
      partnerKey,
      deepLink,
      androidIntent,
      expiresIn: 300,
    });
  } catch {
    return res.status(500).json({ error: 'Failed to initiate Truecaller verification' });
  }
});

async function processTruecallerVerifiedProfile(
  requestId: string,
  rawPhone: string,
  displayName: string,
  avatarUrl?: string,
  country?: string
) {
  try {
    const cleanDigits = rawPhone.replace(/\D/g, '');
    const formattedPhone = cleanDigits.length === 10 ? `+91${cleanDigits}` : `+${cleanDigits}`;
    const userEmail = `tc_${cleanDigits}@liveconnect.app`;

    let userRow = findUserByEmail(userEmail);
    const nowIso = new Date().toISOString();

    const baseUsername =
      (displayName || `user_${cleanDigits.slice(-4)}`)
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '')
        .slice(0, 15) || `user_${cleanDigits.slice(-4)}`;

    if (!userRow) {
      const userId = generateUUID();
      const meta = {
        display_name: displayName || `User ${cleanDigits.slice(-4)}`,
        username: baseUsername,
        avatar_url: avatarUrl || null,
        phone: formattedPhone,
        verified_by: 'truecaller',
      };
      db.prepare(`
        INSERT INTO users (id, email, password_hash, email_confirmed, phone, user_metadata, created_at, updated_at)
        VALUES (?, ?, NULL, 1, ?, ?, ?, ?)
      `).run(userId, userEmail, formattedPhone, JSON.stringify(meta), nowIso, nowIso);
      userRow = findUserById(userId)!;
    }

    const userProfile = ensureProfileRecord(userRow.id, {
      username: baseUsername,
      display_name: displayName || `User ${cleanDigits.slice(-4)}`,
      avatar_url: avatarUrl || null,
      phone_number: formattedPhone,
      country: country || 'India',
      bio: 'Verified with Truecaller on LiveConnect.',
      email: userEmail,
    })!;

    const session = createSessionForUser(userRow.id);
    const authUser = formatAuthUser(userRow);

    truecallerVerifications.set(requestId, {
      requestId,
      status: 'completed',
      profile: userProfile,
      user: authUser,
      session,
      createdAt: Date.now(),
    });

    return { success: true, profile: userProfile, user: authUser, session };
  } catch (err: any) {
    truecallerVerifications.set(requestId, {
      requestId,
      status: 'failed',
      error: err.message || 'Failed to authenticate Truecaller user',
      createdAt: Date.now(),
    });
    return { success: false, error: err.message };
  }
}

async function handleTruecallerCallback(req: express.Request, res: express.Response) {
  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch {}
    }
    const { requestId, accessToken, endpoint } = body || {};

    res.status(200).json({ status: 'ok', received: true });
    if (!requestId || !accessToken) return;

    const profileUrl = endpoint || 'https://profile4-noneu.truecaller.com/v1/default';
    try {
      const tcRes = await fetch(profileUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Cache-Control': 'no-cache',
        },
      });
      if (!tcRes.ok) {
        truecallerVerifications.set(requestId, {
          requestId,
          status: 'failed',
          error: `Truecaller Profile API returned status ${tcRes.status}`,
          createdAt: Date.now(),
        });
        return;
      }
      const tcData: any = await tcRes.json();
      const phone =
        tcData.phoneNumber ||
        (Array.isArray(tcData.phoneNumbers) ? tcData.phoneNumbers[0] : '') ||
        '';
      const firstName = tcData.name?.first || tcData.firstName || '';
      const lastName = tcData.name?.last || tcData.lastName || '';
      const fullName = [firstName, lastName].filter(Boolean).join(' ') || 'Truecaller User';
      const avatar = tcData.avatarUrl || tcData.image || null;
      const country = tcData.address?.countryCode || tcData.countryCode || 'India';

      await processTruecallerVerifiedProfile(requestId, phone, fullName, avatar, country);
    } catch (fetchErr: any) {
      truecallerVerifications.set(requestId, {
        requestId,
        status: 'failed',
        error: fetchErr.message || 'Error communicating with Truecaller Profile API',
        createdAt: Date.now(),
      });
    }
  } catch (err: any) {
    try { res.status(500).json({ error: err.message }); } catch {}
  }
}

app.post('/auth/callback', handleTruecallerCallback);
app.post('/api/auth/truecaller/callback', handleTruecallerCallback);

app.get('/auth/callback', (_req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><title>Truecaller Verification - LiveConnect</title>
<style>body{font-family:sans-serif;background:#0a0a0a;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}.card{background:#171717;border:1px solid #262626;border-radius:20px;padding:40px 24px;max-width:400px;width:90%}</style>
</head>
<body><div class="card"><h2>Truecaller Verified!</h2><p>Redirecting you back to LiveConnect...</p></div>
<script>setTimeout(function(){window.location.href='/';},1500);</script></body></html>`);
});

app.get('/api/auth/truecaller/status', (req, res) => {
  const requestId = String(req.query.requestId || '').trim();
  if (!requestId) {
    return res.status(400).json({ error: 'requestId query parameter is required' });
  }
  const record = truecallerVerifications.get(requestId);
  if (!record) {
    return res.json({ status: 'pending', notFoundYet: true });
  }
  return res.json({
    status: record.status,
    profile: record.profile || null,
    user: record.user || null,
    session: record.session || null,
    error: record.error || null,
  });
});

app.post('/api/auth/truecaller/send-otp', (req, res) => {
  try {
    const { phoneNumber } = req.body || {};
    if (!phoneNumber) return res.status(400).json({ error: 'Mobile number is required' });
    const cleanDigits = String(phoneNumber).replace(/\D/g, '');
    if (cleanDigits.length < 7) {
      return res.status(400).json({ error: 'Please enter a valid mobile number' });
    }
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    pcPhoneOtpStore.set(cleanDigits, { code, expiresAt: Date.now() + 5 * 60 * 1000, attempts: 0 });
    return res.json({ success: true, message: `Verification code sent to ${phoneNumber}`, expiresIn: 300 });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to send verification code' });
  }
});

app.post('/api/auth/truecaller/verify-otp', async (req, res) => {
  try {
    const { phoneNumber, code, name, requestId: customRequestId } = req.body || {};
    if (!phoneNumber || !code) {
      return res.status(400).json({ error: 'Phone number and verification code are required' });
    }
    const cleanDigits = String(phoneNumber).replace(/\D/g, '');
    const cleanCode = String(code).trim();
    const record = pcPhoneOtpStore.get(cleanDigits);
    if (!record) {
      return res.status(400).json({ error: 'Verification code expired or not found.' });
    }
    if (Date.now() > record.expiresAt) {
      pcPhoneOtpStore.delete(cleanDigits);
      return res.status(400).json({ error: 'Verification code expired.' });
    }
    if (record.code !== cleanCode) {
      record.attempts = (record.attempts || 0) + 1;
      if (record.attempts >= 5) {
        pcPhoneOtpStore.delete(cleanDigits);
        return res.status(400).json({ error: 'Too many invalid attempts.' });
      }
      return res.status(400).json({ error: 'Incorrect verification code.' });
    }
    pcPhoneOtpStore.delete(cleanDigits);
    const reqId = customRequestId || `tc_manual_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const displayName = String(name || `User ${cleanDigits.slice(-4)}`).trim();
    const result = await processTruecallerVerifiedProfile(reqId, cleanDigits, displayName, undefined, 'India');
    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Failed to authenticate mobile number' });
    }
    return res.json({ success: true, requestId: reqId, profile: result.profile, user: result.user, session: result.session });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to verify code' });
  }
});

app.post('/api/auth/truecaller/verify-number', async (req, res) => {
  try {
    const { phoneNumber, name, requestId: customRequestId } = req.body || {};
    if (!phoneNumber) return res.status(400).json({ error: 'Mobile number is required' });
    const cleanDigits = String(phoneNumber).replace(/\D/g, '');
    if (cleanDigits.length < 10) {
      return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number' });
    }
    const reqId = customRequestId || `tc_manual_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const displayName = String(name || `User ${cleanDigits.slice(-4)}`).trim();
    const result = await processTruecallerVerifiedProfile(reqId, cleanDigits, displayName, undefined, 'India');
    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Failed to authenticate mobile number' });
    }
    return res.json({ success: true, requestId: reqId, profile: result.profile, user: result.user, session: result.session });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to verify mobile number' });
  }
});

app.post('/api/auth/notify-login', async (req, res) => {
  try {
    const { email, name: rawName, displayName } = req.body || {};
    if (!email) return res.status(400).json({ error: 'email is required' });
    const cleanEmail = String(email).trim().toLowerCase();
    const name = String(rawName || displayName || cleanEmail.split('@')[0]).trim();

    const user = process.env.SMTP_USER || process.env.GMAIL_USER;
    const pass = process.env.SMTP_PASS || process.env.GMAIL_PASS;
    if (process.env.DISABLE_SMTP === 'true' || !user || !pass) {
      return res.json({ success: true, message: 'SMTP disabled or unconfigured' });
    }

    const transporter = createStandardTransporter();
    await transporter.sendMail({
      from: `"LiveConnect Security" <${user}>`,
      to: cleanEmail,
      subject: 'New Sign-in Notification - LiveConnect',
      html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#0a0a0a;border-radius:16px;color:#fff;"><h2>LiveConnect</h2><p>New sign-in to your account: <strong>${name}</strong> (${cleanEmail})</p></div>`,
    });
    return res.json({ success: true });
  } catch {
    return res.json({ success: false, message: 'Email notification skipped' });
  }
});

// ====================================================================
// PRESENCE ENDPOINTS (SQLite Backed)
// ====================================================================
app.post('/api/presence/heartbeat', (req, res) => {
  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch {}
    }
    const { userId } = body || {};
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const now = new Date().toISOString();
    db.prepare('UPDATE profiles SET is_online = 1, last_seen = ?, updated_at = ? WHERE id = ?').run(
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
    return res.status(500).json({ error: 'Failed to update heartbeat' });
  }
});

app.post('/api/presence/offline', (req, res) => {
  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch {}
    }
    const { userId } = body || {};
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const now = new Date().toISOString();
    db.prepare('UPDATE profiles SET is_online = 0, last_seen = ?, updated_at = ? WHERE id = ?').run(
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
    return res.status(500).json({ error: 'Failed to update offline state' });
  }
});

app.get('/api/presence/online', (_req, res) => {
  try {
    const cutoff = new Date(Date.now() - 45000).toISOString();
    const rows = db
      .prepare('SELECT id, is_online, last_seen FROM profiles WHERE is_online = 1 AND last_seen >= ?')
      .all(cutoff) as { id: string; is_online: number; last_seen: string }[];
    return res.json({
      users: rows.map((r) => ({ id: r.id, is_online: true, last_seen: r.last_seen })),
    });
  } catch {
    return res.json({ users: [] });
  }
});

// ====================================================================
// SOCIAL RELATIONS ENDPOINTS (SQLite Backed)
// ====================================================================

app.post('/api/relations/user-overview', (req, res) => {
  try {
    const { userId, username } = req.body || {};
    if (!userId && !username) {
      return res.status(400).json({ error: 'userId or username is required' });
    }

    let targetId = userId || '';
    if (!targetId && username) {
      const p = getProfileByUsername(username);
      if (p) targetId = p.id;
    }

    const followingRows = db
      .prepare('SELECT following_id FROM follows WHERE follower_id = ?')
      .all(targetId) as { following_id: string }[];
    const followerRows = db
      .prepare('SELECT follower_id FROM follows WHERE following_id = ?')
      .all(targetId) as { follower_id: string }[];

    const blockedByMeRows = db
      .prepare('SELECT blocked_id FROM blocked_users WHERE blocker_id = ?')
      .all(targetId) as { blocked_id: string }[];
    const blockedByThemRows = db
      .prepare('SELECT blocker_id FROM blocked_users WHERE blocked_id = ?')
      .all(targetId) as { blocker_id: string }[];

    const following = followingRows.map((r) => r.following_id);
    const followers = followerRows.map((r) => r.follower_id);
    const blockedByMe = blockedByMeRows.map((r) => r.blocked_id);
    const blockedByThem = blockedByThemRows.map((r) => r.blocker_id);

    const buildMini = (id: string) =>
      getProfileCachedOrDb(id) || {
        id,
        username: `user_${id.slice(0, 5)}`,
        display_name: 'User',
        avatar_url: null,
        bio: null,
        is_online: false,
      };

    return res.json({
      following,
      followers,
      followingCount: following.length,
      followersCount: followers.length,
      followingProfiles: following.map(buildMini),
      followerProfiles: followers.map(buildMini),
      blockedByMe,
      blockedByThem,
    });
  } catch {
    return res.status(500).json({ error: 'Failed to retrieve user overview' });
  }
});

app.post('/api/relations/blocked-profiles', (req, res) => {
  try {
    const { userId, ids } = req.body || {};
    let targetIds: string[] = Array.isArray(ids) ? ids : [];
    if (userId && targetIds.length === 0) {
      const rows = db
        .prepare('SELECT blocked_id FROM blocked_users WHERE blocker_id = ?')
        .all(userId) as { blocked_id: string }[];
      targetIds = rows.map((r) => r.blocked_id);
    }

    const profiles = targetIds
      .map((id) => getProfileCachedOrDb(id))
      .filter(Boolean);

    return res.json({ blockedUsers: profiles });
  } catch {
    return res.status(500).json({ error: 'Failed to fetch blocked profiles' });
  }
});

app.get('/api/relations/all-counts', (_req, res) => {
  try {
    const rows = db.prepare('SELECT follower_id, following_id FROM follows').all() as {
      follower_id: string;
      following_id: string;
    }[];
    const counts: Record<string, { followers: number; following: number }> = {};
    for (const r of rows) {
      if (!counts[r.follower_id]) counts[r.follower_id] = { followers: 0, following: 0 };
      if (!counts[r.following_id]) counts[r.following_id] = { followers: 0, following: 0 };
      counts[r.follower_id].following += 1;
      counts[r.following_id].followers += 1;
    }
    return res.json({ counts });
  } catch {
    return res.status(500).json({ error: 'Failed to retrieve counts' });
  }
});

app.post('/api/relations/status', (req, res) => {
  try {
    const { userId, targetUserId } = req.body || {};
    if (!userId || !targetUserId) {
      return res.status(400).json({ error: 'userId and targetUserId are required' });
    }

    const isFollowingThem = isFollowing(userId, targetUserId);
    const isFollowedByThem = isFollowing(targetUserId, userId);
    const isMutual = Boolean(isFollowingThem && isFollowedByThem);
    const isBlockedByMe = Boolean(
      db.prepare('SELECT 1 FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?').get(userId, targetUserId)
    );
    const isBlockedByThem = Boolean(
      db.prepare('SELECT 1 FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?').get(targetUserId, userId)
    );
    const counts = getFollowCounts(targetUserId);

    return res.json({
      isFollowing: isFollowingThem,
      isFollowedBy: isFollowedByThem,
      isMutual,
      isBlockedByMe,
      isBlockedByThem,
      isBlocked: isBlockedByMe || isBlockedByThem,
      followersCount: counts.followersCount,
      followingCount: counts.followingCount,
    });
  } catch {
    return res.status(500).json({ error: 'Failed to retrieve relation status' });
  }
});

app.post('/api/relations/sync', (req, res) => {
  try {
    const { userId, following, followers } = req.body || {};
    const nowIso = new Date().toISOString();
    const stmt = db.prepare(
      'INSERT OR IGNORE INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)'
    );
    if (userId && Array.isArray(following)) {
      for (const id of following) {
        if (id && id !== userId) stmt.run(userId, id, nowIso);
      }
    }
    if (userId && Array.isArray(followers)) {
      for (const id of followers) {
        if (id && id !== userId) stmt.run(id, userId, nowIso);
      }
    }
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: 'Failed to sync relations' });
  }
});

app.post('/api/relations/follow', (req, res) => {
  try {
    const { userId, targetUserId, userMeta, targetMeta } = req.body || {};
    if (!userId || !targetUserId) {
      return res.status(400).json({ error: 'userId and targetUserId are required' });
    }
    if (userId === targetUserId) {
      return res.status(400).json({ error: 'You cannot follow yourself' });
    }
    if (isBlocked(userId, targetUserId)) {
      return res.status(403).json({ error: 'Cannot follow a blocked user' });
    }

    if (userMeta) ensureProfileRecord(userId, userMeta);
    if (targetMeta) ensureProfileRecord(targetUserId, targetMeta);

    db.prepare(
      'INSERT OR IGNORE INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)'
    ).run(userId, targetUserId, new Date().toISOString());

    const wasFollowedByTarget = isFollowing(targetUserId, userId);
    const isMutualNow = wasFollowedByTarget;

    const actorDisplayName = userMeta?.display_name || userMeta?.username || 'Someone';
    if (isMutualNow) {
      addNotification(
        targetUserId,
        userId,
        'follow_back',
        'Followed you back',
        `${actorDisplayName} followed you back. You are now connected!`,
        userId,
        userMeta
      );
    } else {
      addNotification(
        targetUserId,
        userId,
        'follow',
        'New Follower',
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
      userFollowingCount: userCounts.followingCount,
    });
  } catch {
    return res.status(500).json({ error: 'Failed to process follow' });
  }
});

app.post('/api/relations/unfollow', (req, res) => {
  try {
    const { userId, targetUserId } = req.body || {};
    if (!userId || !targetUserId) {
      return res.status(400).json({ error: 'userId and targetUserId are required' });
    }

    db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').run(userId, targetUserId);

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
      userFollowingCount: userCounts.followingCount,
    });
  } catch {
    return res.status(500).json({ error: 'Failed to unfollow' });
  }
});

app.post('/api/relations/block', (req, res) => {
  try {
    const { userId, targetUserId, targetEmail, targetUsername, targetDisplayName, reason, sendEmail } = req.body || {};
    if (!userId || !targetUserId) {
      return res.status(400).json({ error: 'userId and targetUserId are required' });
    }
    if (userId === targetUserId) {
      return res.status(400).json({ error: 'You cannot block yourself' });
    }

    db.prepare(
      'INSERT OR IGNORE INTO blocked_users (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)'
    ).run(userId, targetUserId, new Date().toISOString());

    db.prepare(
      'DELETE FROM follows WHERE (follower_id = ? AND following_id = ?) OR (follower_id = ? AND following_id = ?)'
    ).run(userId, targetUserId, targetUserId, userId);

    if (sendEmail || targetEmail) {
      const targetProf = getProfileById(targetUserId);
      const emailToSend = targetEmail || targetProf?.email;
      if (emailToSend) {
        sendBanNotificationEmail(
          emailToSend,
          targetUsername || targetProf?.username || 'user',
          targetDisplayName || targetProf?.display_name || 'User',
          reason || 'Account Restriction / Block Notice'
        );
      }
    }

    const counts = getFollowCounts(targetUserId);
    return res.json({
      success: true,
      isBlockedByMe: true,
      isBlocked: true,
      isFollowing: false,
      isFollowedBy: false,
      isMutual: false,
      followersCount: counts.followersCount,
      followingCount: counts.followingCount,
    });
  } catch {
    return res.status(500).json({ error: 'Failed to block user' });
  }
});

app.post('/api/relations/unblock', (req, res) => {
  try {
    const { userId, targetUserId } = req.body || {};
    if (!userId || !targetUserId) {
      return res.status(400).json({ error: 'userId and targetUserId are required' });
    }
    db.prepare('DELETE FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?').run(userId, targetUserId);
    const counts = getFollowCounts(targetUserId);
    return res.json({
      success: true,
      isBlockedByMe: false,
      isBlocked: false,
      isFollowing: false,
      isFollowedBy: false,
      isMutual: false,
      followersCount: counts.followersCount,
      followingCount: counts.followingCount,
    });
  } catch {
    return res.status(500).json({ error: 'Failed to unblock user' });
  }
});

app.post('/api/relations/check-mutual', (req, res) => {
  try {
    const { userA, userB } = req.body || {};
    if (!userA || !userB) {
      return res.status(400).json({ error: 'userA and userB are required' });
    }
    const blocked = isBlocked(userA, userB);
    const mutual = !blocked && isMutualFollow(userA, userB);
    return res.json({
      isMutual: mutual,
      mutual,
      blocked,
      userAFollowsUserB: isFollowing(userA, userB),
      userBFollowsUserA: isFollowing(userB, userA),
    });
  } catch {
    return res.status(500).json({ error: 'Failed to check mutual status' });
  }
});

// ====================================================================
// NOTIFICATIONS ENDPOINTS (SQLite Backed)
// ====================================================================
app.post('/api/notifications/list', (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const rows = db
      .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100')
      .all(userId) as any[];

    const notifications = rows.map((r) => {
      let actor = null;
      if (r.actor_json) {
        try { actor = JSON.parse(r.actor_json); } catch {}
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
        actor,
      };
    });

    const unreadCount = notifications.filter((n) => !n.is_read).length;
    return res.json({ notifications, unreadCount });
  } catch {
    return res.status(500).json({ error: 'Failed to load notifications' });
  }
});

app.post('/api/notifications/mark-read', (req, res) => {
  try {
    const { userId, notificationId } = req.body || {};
    if (!userId || !notificationId) {
      return res.status(400).json({ error: 'userId and notificationId are required' });
    }
    db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(notificationId, userId);
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

app.post('/api/notifications/mark-all-read', (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(userId);
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: 'Failed to mark all as read' });
  }
});

app.post('/api/notifications/delete', (req, res) => {
  try {
    const { userId, notificationId } = req.body || {};
    if (!userId || !notificationId) {
      return res.status(400).json({ error: 'userId and notificationId are required' });
    }
    db.prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?').run(notificationId, userId);
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: 'Failed to delete notification' });
  }
});

app.post('/api/notifications/create', (req, res) => {
  try {
    const { userId, actorId, type, title, message, referenceId, actorMeta } = req.body || {};
    if (!userId || !actorId || !type) {
      return res.status(400).json({ error: 'userId, actorId, and type are required' });
    }
    const newNotif = addNotification(userId, actorId, type, title, message, referenceId, actorMeta);
    return res.json({ success: true, notification: newNotif });
  } catch {
    return res.status(500).json({ error: 'Failed to create notification' });
  }
});

// ====================================================================
// CALL SIGNALING & CALL HISTORY ENDPOINTS (SQLite Backed)
// ====================================================================
const serverSignalsStore = new Map<string, any[]>();

function formatCallRow(row: any) {
  if (!row) return null;
  const caller = getProfileCachedOrDb(row.caller_id) || undefined;
  const callee = getProfileCachedOrDb(row.callee_id) || undefined;
  return {
    id: row.id,
    caller_id: row.caller_id,
    callee_id: row.callee_id,
    callerDeviceId: row.caller_device_id || undefined,
    calleeDeviceId: row.callee_device_id || undefined,
    call_type: row.call_type || 'audio',
    status: row.status,
    room_name: row.room_name || `room_${row.id}`,
    started_at: row.started_at || row.created_at,
    answered_at: row.answered_at || null,
    ended_at: row.ended_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    caller,
    callee,
  };
}

app.post('/api/calls/create', (req, res) => {
  try {
    const { call, callerMeta } = req.body || {};
    if (!call || !call.id || !call.caller_id || !call.callee_id) {
      return res.status(400).json({ error: 'Valid call object with caller_id and callee_id required' });
    }

    if (isBlocked(call.caller_id, call.callee_id)) {
      return res.status(403).json({ error: 'Cannot call blocked user' });
    }

    if (callerMeta) ensureProfileRecord(call.caller_id, callerMeta);

    const nowIso = new Date().toISOString();
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
      call.call_type || 'audio',
      roomName,
      call.callerDeviceId || null,
      call.calleeDeviceId || null,
      nowIso,
      nowIso,
      nowIso
    );

    const callerObj = callerMeta || getProfileCachedOrDb(call.caller_id) || {
      id: call.caller_id,
      username: 'Caller',
      display_name: 'Caller',
      avatar_url: null,
    };

    const newCall = formatCallRow(db.prepare('SELECT * FROM calls WHERE id = ?').get(call.id));

    const callerName = callerObj?.display_name || callerObj?.username || 'Someone';
    addNotification(
      call.callee_id,
      call.caller_id,
      call.call_type === 'video' ? 'call_video' : 'call_audio',
      `Incoming ${call.call_type === 'video' ? 'Video' : 'Voice'} Call`,
      `${callerName} is calling you...`,
      call.id,
      callerObj
    );

    return res.json({ success: true, call: newCall });
  } catch {
    return res.status(500).json({ error: 'Failed to dispatch call' });
  }
});

app.post('/api/calls/incoming', (req, res) => {
  try {
    const { userId, deviceId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const ninetySecondsAgo = new Date(Date.now() - 90000).toISOString();
    const rows = db
      .prepare(
        `SELECT * FROM calls
         WHERE callee_id = ? AND status IN ('calling', 'ringing') AND created_at >= ?
         ORDER BY created_at DESC LIMIT 5`
      )
      .all(userId, ninetySecondsAgo) as any[];

    const pendingCalls = rows
      .filter((r) => !(deviceId && r.caller_device_id && r.caller_device_id === deviceId))
      .map(formatCallRow);

    return res.json({ calls: pendingCalls });
  } catch {
    return res.status(500).json({ error: 'Failed to check incoming calls' });
  }
});

app.post('/api/calls/status', (req, res) => {
  try {
    const { callId } = req.body || {};
    if (!callId) return res.status(400).json({ error: 'callId is required' });

    const row = db.prepare('SELECT * FROM calls WHERE id = ?').get(callId) as any;
    if (!row) {
      return res.json({ exists: false, status: 'unknown' });
    }
    const call = formatCallRow(row);
    return res.json({ exists: true, status: row.status, call });
  } catch {
    return res.status(500).json({ error: 'Failed to check call status' });
  }
});

app.post('/api/calls/action', (req, res) => {
  try {
    const { callId, action, userId, calleeDeviceId } = req.body || {};
    if (!callId || !action) {
      return res.status(400).json({ error: 'callId and action are required' });
    }

    const nowIso = new Date().toISOString();
    let row = db.prepare('SELECT * FROM calls WHERE id = ?').get(callId) as any;

    if (!row) {
      const status =
        action === 'accept'
          ? 'accepted'
          : action === 'reject'
            ? 'rejected'
            : action === 'cancel'
              ? 'cancelled'
              : 'ended';
      db.prepare(`
        INSERT INTO calls (
          id, caller_id, callee_id, call_type, status, room_name,
          callee_device_id, started_at, answered_at, ended_at, created_at, updated_at
        ) VALUES (?, ?, ?, 'audio', ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        callId,
        userId || 'unknown',
        'unknown',
        status,
        `room_${callId}`,
        calleeDeviceId || null,
        nowIso,
        action === 'accept' ? nowIso : null,
        ['ended', 'rejected', 'cancelled'].includes(action) ? nowIso : null,
        nowIso,
        nowIso
      );
      row = db.prepare('SELECT * FROM calls WHERE id = ?').get(callId);
    } else {
      let nextStatus = row.status;
      let answeredAt = row.answered_at;
      let endedAt = row.ended_at;
      let nextCalleeDev = calleeDeviceId || row.callee_device_id;

      if (action === 'ring' && row.status === 'calling') {
        nextStatus = 'ringing';
      } else if (action === 'accept') {
        nextStatus = 'accepted';
        answeredAt = nowIso;
      } else if (action === 'reject') {
        nextStatus = 'rejected';
        endedAt = nowIso;
      } else if (action === 'cancel') {
        nextStatus = 'cancelled';
        endedAt = nowIso;
      } else if (action === 'end') {
        nextStatus = 'ended';
        endedAt = nowIso;
      }

      db.prepare(
        'UPDATE calls SET status = ?, callee_device_id = ?, answered_at = ?, ended_at = ?, updated_at = ? WHERE id = ?'
      ).run(nextStatus, nextCalleeDev, answeredAt, endedAt, nowIso, callId);
      row = db.prepare('SELECT * FROM calls WHERE id = ?').get(callId);
    }

    const call = formatCallRow(row)!;

    const actionSignal = {
      id: `act_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      type:
        action === 'accept'
          ? 'CALL_ACCEPTED'
          : action === 'reject'
            ? 'CALL_REJECTED'
            : action === 'cancel'
              ? 'CALL_CANCELLED'
              : action === 'end'
                ? 'CALL_ENDED'
                : 'CALL_ACTION',
      callId,
      action,
      status: call.status,
      senderId: userId,
      senderDeviceId: calleeDeviceId,
      calleeDeviceId: call.calleeDeviceId,
      _t: Date.now(),
    };

    const globalKey = `call_${callId}`;
    serverSignalsStore.set(globalKey, [...(serverSignalsStore.get(globalKey) || []).slice(-40), actionSignal]);

    if (call.caller_id && call.caller_id !== 'unknown') {
      const callerKey = `${callId}_${call.caller_id}`;
      serverSignalsStore.set(callerKey, [...(serverSignalsStore.get(callerKey) || []).slice(-40), actionSignal]);
    }
    if (call.callerDeviceId) {
      const devKey = `${callId}_${call.callerDeviceId}`;
      serverSignalsStore.set(devKey, [...(serverSignalsStore.get(devKey) || []).slice(-40), actionSignal]);
    }

    return res.json({ success: true, status: call.status, call });
  } catch {
    return res.status(500).json({ error: 'Failed to update call action' });
  }
});

app.post('/api/calls/signal', (req, res) => {
  try {
    const signal = req.body;
    if (signal && signal.callId) {
      const payload = {
        ...signal,
        id: signal.id || `sig_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
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
    return res.status(500).json({ error: 'Failed to process signal' });
  }
});

app.post('/api/calls/signals', (req, res) => {
  try {
    const { callId, targetId, deviceId } = req.body || {};
    if (!callId) return res.json({ signals: [] });

    const collected: any[] = [];
    const seenKeys = new Set<string>();

    const checkKey = (key: string) => {
      const list = serverSignalsStore.get(key) || [];
      for (const sig of list) {
        if (deviceId && sig.senderDeviceId && sig.senderDeviceId === deviceId) continue;
        const sigId = sig.id || `${sig.type}_${sig.senderId}_${sig._t || ''}`;
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
    return res.status(500).json({ error: 'Failed to get signals' });
  }
});

app.get('/api/webrtc/ice-servers', (_req, res) => {
  try {
    const customTurnUrl = process.env.TURN_URL || process.env.VITE_TURN_URL;
    const customTurnUser = process.env.TURN_USERNAME || process.env.VITE_TURN_USERNAME;
    const customTurnPass = process.env.TURN_CREDENTIAL || process.env.VITE_TURN_CREDENTIAL;

    const iceServers: RTCIceServer[] = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: 'stun:stun.services.mozilla.com' },
      {
        urls: [
          'turn:openrelay.metered.ca:80',
          'turn:openrelay.metered.ca:443',
          'turn:openrelay.metered.ca:443?transport=tcp',
          'turns:openrelay.metered.ca:443?transport=tcp',
        ],
        username: 'openrelay',
        credential: 'openrelay',
      },
    ];

    if (customTurnUrl) {
      iceServers.unshift({
        urls: customTurnUrl.split(','),
        username: customTurnUser || undefined,
        credential: customTurnPass || undefined,
      });
    }

    return res.json({
      iceServers,
      iceCandidatePoolSize: 6,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });
  } catch {
    return res.status(500).json({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });
  }
});

app.post('/api/calls/history', (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const rows = db
      .prepare(
        `SELECT c.* FROM calls c
         LEFT JOIN deleted_calls dc ON c.id = dc.call_id AND dc.user_id = ?
         WHERE (c.caller_id = ? OR c.callee_id = ?) AND dc.call_id IS NULL
         ORDER BY c.created_at DESC LIMIT 60`
      )
      .all(userId, userId, userId) as any[];

    return res.json({ calls: rows.map(formatCallRow) });
  } catch {
    return res.status(500).json({ error: 'Failed to get call history' });
  }
});

app.post('/api/calls/delete', (req, res) => {
  try {
    const { callId, userId } = req.body || {};
    if (!callId || !userId) {
      return res.status(400).json({ error: 'callId and userId are required' });
    }
    db.prepare('INSERT OR IGNORE INTO deleted_calls (user_id, call_id, deleted_at) VALUES (?, ?, ?)').run(
      userId,
      callId,
      new Date().toISOString()
    );
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: 'Failed to delete call history entry' });
  }
});

app.post('/api/calls/clear', (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const rows = db
      .prepare('SELECT id FROM calls WHERE caller_id = ? OR callee_id = ?')
      .all(userId, userId) as { id: string }[];
    const stmt = db.prepare('INSERT OR IGNORE INTO deleted_calls (user_id, call_id, deleted_at) VALUES (?, ?, ?)');
    const nowIso = new Date().toISOString();
    for (const r of rows) {
      stmt.run(userId, r.id, nowIso);
    }
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: 'Failed to clear call history' });
  }
});

// ====================================================================
// CONVERSATIONS, USERS SEARCH & GROUPS ENDPOINTS (SQLite Backed)
// ====================================================================

app.post('/api/conversations/create-or-get', (req, res) => {
  try {
    const { userId, targetUserId, userProfile, targetProfile } = req.body || {};
    if (!userId || !targetUserId) {
      return res.status(400).json({ error: 'userId and targetUserId are required' });
    }

    if (isBlocked(userId, targetUserId)) {
      return res.status(403).json({ error: 'Cannot start conversation with blocked user' });
    }

    const convId = getDeterministicDirectConvId(userId, targetUserId);
    const nowIso = new Date().toISOString();

    db.prepare('DELETE FROM deleted_conversations WHERE conversation_id = ? AND user_id IN (?, ?)').run(
      convId,
      userId,
      '*'
    );

    if (userProfile?.id) ensureProfileRecord(userProfile.id, userProfile);
    if (targetProfile?.id) ensureProfileRecord(targetProfile.id, targetProfile);

    const existing = db.prepare('SELECT * FROM conversations WHERE id = ?').get(convId);
    if (!existing) {
      db.prepare(
        'INSERT INTO conversations (id, type, created_at, updated_at) VALUES (?, ?, ?, ?)'
      ).run(convId, 'direct', nowIso, nowIso);

      db.prepare(
        'INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)'
      ).run(convId, userId, 'member', nowIso);

      if (userId !== targetUserId) {
        db.prepare(
          'INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)'
        ).run(convId, targetUserId, 'member', nowIso);
      }
    }

    const convObj = buildConversationObject(convId, userId);
    return res.json({
      success: true,
      conversationId: convId,
      conversation: convObj,
    });
  } catch {
    return res.status(500).json({ error: 'Failed to create or get conversation' });
  }
});

app.post('/api/conversations/list', (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const memberConvRows = db
      .prepare('SELECT DISTINCT conversation_id FROM conversation_members WHERE user_id = ?')
      .all(userId) as { conversation_id: string }[];

    // Also find groups where user is in removed_members_json
    const removedGroupRows = db
      .prepare(`SELECT id, removed_members_json FROM conversations WHERE type = 'group' AND removed_members_json IS NOT NULL`)
      .all() as { id: string; removed_members_json: string }[];

    const candidateConvIds = new Set<string>(memberConvRows.map((r) => r.conversation_id));
    for (const r of removedGroupRows) {
      try {
        const parsed = JSON.parse(r.removed_members_json);
        if (parsed && parsed[userId]) {
          candidateConvIds.add(r.id);
        }
      } catch {}
    }

    const directMap = new Map<string, any>();
    const groupList: any[] = [];

    for (const convId of candidateConvIds) {
      const deletedRow = db
        .prepare('SELECT 1 FROM deleted_conversations WHERE conversation_id = ? AND user_id IN (?, ?) LIMIT 1')
        .get(convId, userId, '*');
      if (deletedRow) continue;

      const convObj = buildConversationObject(convId, userId);
      if (!convObj) continue;

      if (convObj.type === 'group') {
        groupList.push(convObj);
      } else {
        const otherId = convObj.other_member?.id || userId;
        const existing = directMap.get(otherId);
        if (!existing || new Date(convObj.updated_at).getTime() >= new Date(existing.updated_at).getTime()) {
          directMap.set(otherId, convObj);
        }
      }
    }

    const result = [...Array.from(directMap.values()), ...groupList];
    result.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

    return res.json({ conversations: result });
  } catch {
    return res.status(500).json({ error: 'Failed to list conversations' });
  }
});

app.post('/api/users/search', (req, res) => {
  try {
    const { query = '', userId } = req.body || {};
    const cleanQuery = String(query || '').trim().toLowerCase().replace(/^@/, '');

    let rows: DbProfileRow[];
    if (!cleanQuery) {
      rows = db
        .prepare(
          userId
            ? 'SELECT * FROM profiles WHERE id != ? ORDER BY updated_at DESC LIMIT 50'
            : 'SELECT * FROM profiles ORDER BY updated_at DESC LIMIT 50'
        )
        .all(...(userId ? [userId] : [])) as unknown as DbProfileRow[];
    } else {
      const likePattern = `%${cleanQuery}%`;
      if (userId) {
        rows = db
          .prepare(
            `SELECT * FROM profiles
             WHERE id != ? AND (LOWER(username) LIKE ? OR LOWER(display_name) LIKE ? OR LOWER(id) = ?)
             ORDER BY is_online DESC, updated_at DESC LIMIT 50`
          )
          .all(userId, likePattern, likePattern, cleanQuery) as unknown as DbProfileRow[];
      } else {
        rows = db
          .prepare(
            `SELECT * FROM profiles
             WHERE LOWER(username) LIKE ? OR LOWER(display_name) LIKE ? OR LOWER(id) = ?
             ORDER BY is_online DESC, updated_at DESC LIMIT 50`
          )
          .all(likePattern, likePattern, cleanQuery) as unknown as DbProfileRow[];
      }
    }

    return res.json({ users: rows.map(formatProfile).filter(Boolean) });
  } catch {
    return res.status(500).json({ error: 'Failed to search users' });
  }
});

app.get('/api/users/profile/:userId', (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const profile = getProfileCachedOrDb(userId);
    if (!profile) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json({ profile });
  } catch {
    return res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

// Create Group Conversation
app.post('/api/groups/create', (req, res) => {
  try {
    const { name, description, avatarUrl, memberIds, creatorId, creatorProfile } = req.body || {};
    if (!name || !creatorId) {
      return res.status(400).json({ error: 'Group name and creatorId are required' });
    }

    const groupId = generateUUID();
    const nowIso = new Date().toISOString();

    if (creatorProfile) ensureProfileRecord(creatorId, creatorProfile);

    const allMembers = Array.from(new Set([creatorId, ...(Array.isArray(memberIds) ? memberIds : [])]));

    db.prepare(`
      INSERT INTO conversations (id, type, name, description, avatar_url, owner_id, removed_members_json, created_at, updated_at)
      VALUES (?, 'group', ?, ?, ?, ?, '{}', ?, ?)
    `).run(groupId, name.trim(), (description || '').trim(), avatarUrl || null, creatorId, nowIso, nowIso);

    const memStmt = db.prepare(
      'INSERT OR REPLACE INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)'
    );
    for (const mId of allMembers) {
      memStmt.run(groupId, mId, mId === creatorId ? 'admin' : 'member', nowIso);
    }

    const cProf = getProfileCachedOrDb(creatorId) || creatorProfile;
    const creatorDisplayName = cProf?.display_name || cProf?.username || 'Admin';
    const creatorUsername = cProf?.username || 'admin';
    const otherMemberIds = allMembers.filter((id) => id !== creatorId);

    let createSysMsgContent = `[SYSTEM:GROUP_CREATED:${creatorId}:${creatorDisplayName}:${creatorUsername}:${name}] ${creatorUsername} created this group`;
    if (otherMemberIds.length > 0) {
      const addedMembersList = otherMemberIds.map((mId) => {
        const meta = getProfileCachedOrDb(mId);
        const dName = (meta?.display_name || meta?.username || 'Member').replace(/[:|;]/g, ' ');
        const uName = (meta?.username || 'user').replace(/[:|;]/g, ' ');
        return `${mId}|${dName}|${uName}`;
      });
      createSysMsgContent = `[SYSTEM:MEMBERS_ADDED:${creatorId}:${creatorDisplayName}:${creatorUsername}:${addedMembersList.join(';')}] ${creatorUsername} added ${otherMemberIds.length} member(s)`;
    }

    const sysMsgId = generateUUID();
    db.prepare(`
      INSERT INTO messages (id, conversation_id, sender_id, content, is_read, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
    `).run(sysMsgId, groupId, creatorId, createSysMsgContent, nowIso, nowIso);

    const groupConv = buildConversationObject(groupId, creatorId);
    return res.json({ success: true, conversationId: groupId, conversation: groupConv });
  } catch (err) {
    console.error('[Create Group Error]:', err);
    return res.status(500).json({ error: 'Failed to create group' });
  }
});

app.post('/api/groups/details', (req, res) => {
  try {
    const { conversationId } = req.body || {};
    if (!conversationId) return res.status(400).json({ error: 'conversationId required' });

    const group = buildConversationObject(conversationId);
    if (!group || group.type !== 'group') {
      return res.status(404).json({ error: 'Group not found' });
    }
    return res.json({ success: true, conversation: group });
  } catch {
    return res.status(500).json({ error: 'Failed to fetch group details' });
  }
});

app.post('/api/groups/update', (req, res) => {
  try {
    const { conversationId, userId, name, description, avatarUrl } = req.body || {};
    if (!conversationId || !userId) {
      return res.status(400).json({ error: 'conversationId and userId required' });
    }

    const group = buildConversationObject(conversationId, userId);
    if (!group || group.type !== 'group') {
      return res.status(404).json({ error: 'Group not found' });
    }

    const role = group.member_roles?.[userId];
    const isOwner = group.owner_id === userId;
    if (role !== 'admin' && !isOwner) {
      return res.status(403).json({ error: 'Only admins can update group details' });
    }

    const nextName = name ? name.trim() : group.name;
    const nextDesc = description !== undefined ? description.trim() : group.description;
    const nextAvatar = avatarUrl !== undefined ? avatarUrl : group.avatar_url;
    const nowIso = new Date().toISOString();

    db.prepare(
      'UPDATE conversations SET name = ?, description = ?, avatar_url = ?, updated_at = ? WHERE id = ?'
    ).run(nextName, nextDesc, nextAvatar || null, nowIso, conversationId);

    return res.json({ success: true, conversation: buildConversationObject(conversationId, userId) });
  } catch {
    return res.status(500).json({ error: 'Failed to update group' });
  }
});

app.post('/api/groups/members/add', (req, res) => {
  try {
    const { conversationId, userId, memberIds, profilesMap } = req.body || {};
    if (!conversationId || !userId || !Array.isArray(memberIds)) {
      return res.status(400).json({ error: 'conversationId, userId, and memberIds required' });
    }

    const group = buildConversationObject(conversationId, userId);
    if (!group || group.type !== 'group') {
      return res.status(404).json({ error: 'Group not found' });
    }

    const role = group.member_roles?.[userId];
    const isOwner = group.owner_id === userId;
    if (role !== 'admin' && !isOwner) {
      return res.status(403).json({ error: 'Only admins can add members' });
    }

    const nowIso = new Date().toISOString();
    const newAdded: string[] = [];
    const addedNamesList: string[] = [];
    const removedMembers = { ...(group.removed_members || {}) };

    const insertStmt = db.prepare(
      'INSERT OR REPLACE INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)'
    );

    for (const mId of memberIds) {
      if (profilesMap?.[mId]) {
        ensureProfileRecord(mId, profilesMap[mId]);
      }
      if (!group.member_ids?.includes(mId)) {
        insertStmt.run(conversationId, mId, 'member', nowIso);
        delete removedMembers[mId];
        db.prepare('DELETE FROM deleted_conversations WHERE conversation_id = ? AND user_id = ?').run(
          conversationId,
          mId
        );
        const meta = profilesMap?.[mId] || getProfileCachedOrDb(mId);
        addedNamesList.push(meta?.display_name || meta?.username || 'User');
        newAdded.push(mId);
      }
    }

    db.prepare('UPDATE conversations SET removed_members_json = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(removedMembers),
      nowIso,
      conversationId
    );

    if (newAdded.length > 0) {
      const actorProfile = group.members_meta?.[userId] || getProfileCachedOrDb(userId);
      const actorDisplayName = actorProfile?.display_name || actorProfile?.username || 'Admin';
      const actorUsername = actorProfile?.username || 'admin';
      const namesJoined = addedNamesList.length > 0 ? addedNamesList.join(', ') : `${newAdded.length} new member(s)`;

      const addedMembersList = newAdded.map((mId) => {
        const meta = profilesMap?.[mId] || getProfileCachedOrDb(mId);
        const dName = (meta?.display_name || meta?.username || 'Member').replace(/[:|;]/g, ' ');
        const uName = (meta?.username || 'user').replace(/[:|;]/g, ' ');
        return `${mId}|${dName}|${uName}`;
      });
      const sysMsgContent = `[SYSTEM:MEMBERS_ADDED:${userId}:${actorDisplayName}:${actorUsername}:${addedMembersList.join(';')}] ${actorUsername} added ${namesJoined}`;

      db.prepare(`
        INSERT INTO messages (id, conversation_id, sender_id, content, is_read, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)
      `).run(generateUUID(), conversationId, userId, sysMsgContent, nowIso, nowIso);
    }

    return res.json({ success: true, conversation: buildConversationObject(conversationId, userId) });
  } catch {
    return res.status(500).json({ error: 'Failed to add members' });
  }
});

app.post('/api/groups/members/remove', (req, res) => {
  try {
    const { conversationId, actorId, memberId } = req.body || {};
    if (!conversationId || !actorId || !memberId) {
      return res.status(400).json({ error: 'conversationId, actorId, and memberId required' });
    }

    const group = buildConversationObject(conversationId, actorId);
    if (!group || group.type !== 'group') {
      return res.status(404).json({ error: 'Group not found' });
    }

    const isSelfLeaving = actorId === memberId;
    const actorRole = group.member_roles?.[actorId];
    const isOwner = group.owner_id === actorId;

    if (!isSelfLeaving && actorRole !== 'admin' && !isOwner) {
      return res.status(403).json({ error: 'Only group admins can remove members' });
    }
    if (!isSelfLeaving && memberId === group.owner_id) {
      return res.status(403).json({ error: 'The group creator/owner cannot be removed from the group' });
    }

    const removedProfile = group.members_meta?.[memberId] || getProfileCachedOrDb(memberId);
    const actorProfile = group.members_meta?.[actorId] || getProfileCachedOrDb(actorId);
    const removedDisplayName = removedProfile?.display_name || removedProfile?.username || 'Member';
    const removedUsername = removedProfile?.username || 'user';
    const actorDisplayName = actorProfile?.display_name || actorProfile?.username || 'Admin';
    const actorUsername = actorProfile?.username || 'admin';

    db.prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?').run(
      conversationId,
      memberId
    );

    const remainingIds = (group.member_ids || []).filter((id: string) => id !== memberId);
    const nowIso = new Date().toISOString();

    if (remainingIds.length === 0) {
      db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);
      db.prepare('DELETE FROM conversations WHERE id = ?').run(conversationId);
      return res.json({ success: true, groupDeleted: true });
    }

    const removedMembers = { ...(group.removed_members || {}) };
    if (!isSelfLeaving) {
      removedMembers[memberId] = {
        removed_at: nowIso,
        removed_by: actorId,
        admin_name: actorDisplayName,
        admin_username: actorUsername,
        member_name: removedDisplayName,
        member_username: removedUsername,
      };
    }

    let nextOwnerId = group.owner_id;
    if (memberId === group.owner_id) {
      const remainingAdmins = Object.entries(group.member_roles || {})
        .filter(([id, r]) => r === 'admin' && id !== memberId && remainingIds.includes(id))
        .map(([id]) => id);
      nextOwnerId = remainingAdmins.length > 0 ? remainingAdmins[0] : remainingIds[0];
      db.prepare('UPDATE conversation_members SET role = ? WHERE conversation_id = ? AND user_id = ?').run(
        'admin',
        conversationId,
        nextOwnerId
      );
    }

    db.prepare(
      'UPDATE conversations SET owner_id = ?, removed_members_json = ?, updated_at = ? WHERE id = ?'
    ).run(nextOwnerId || null, JSON.stringify(removedMembers), nowIso, conversationId);

    const sysMsgContent = isSelfLeaving
      ? `[SYSTEM:MEMBER_LEFT:${memberId}:${removedDisplayName}:${removedUsername}] ${removedUsername} left the group`
      : `[SYSTEM:MEMBER_REMOVED:${actorId}:${actorDisplayName}:${actorUsername}:${memberId}:${removedDisplayName}:${removedUsername}] ${actorUsername} removed ${removedUsername}`;

    db.prepare(`
      INSERT INTO messages (id, conversation_id, sender_id, content, is_read, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
    `).run(generateUUID(), conversationId, actorId, sysMsgContent, nowIso, nowIso);

    return res.json({
      success: true,
      conversation: buildConversationObject(conversationId, actorId),
      message: sysMsgContent,
    });
  } catch {
    return res.status(500).json({ error: 'Failed to remove member' });
  }
});

app.post('/api/groups/members/role', (req, res) => {
  try {
    const { conversationId, actorId, memberId, role } = req.body || {};
    if (!conversationId || !actorId || !memberId || !['admin', 'member'].includes(role)) {
      return res.status(400).json({ error: 'Valid arguments required' });
    }

    const group = buildConversationObject(conversationId, actorId);
    if (!group || group.type !== 'group') {
      return res.status(404).json({ error: 'Group not found' });
    }

    const actorRole = group.member_roles?.[actorId];
    const isOwner = group.owner_id === actorId;
    if (actorRole !== 'admin' && !isOwner) {
      return res.status(403).json({ error: 'Only admins can manage roles' });
    }
    if (memberId === group.owner_id && role === 'member' && actorId !== group.owner_id) {
      return res.status(403).json({ error: 'The group creator/owner cannot be demoted from admin' });
    }

    const nowIso = new Date().toISOString();
    db.prepare('UPDATE conversation_members SET role = ? WHERE conversation_id = ? AND user_id = ?').run(
      role,
      conversationId,
      memberId
    );
    db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(nowIso, conversationId);

    const targetProfile = group.members_meta?.[memberId] || getProfileCachedOrDb(memberId);
    const actorProfile = group.members_meta?.[actorId] || getProfileCachedOrDb(actorId);
    const targetDisplayName = targetProfile?.display_name || targetProfile?.username || 'Member';
    const targetUsername = targetProfile?.username || 'user';
    const actorDisplayName = actorProfile?.display_name || actorProfile?.username || 'Admin';
    const actorUsername = actorProfile?.username || 'admin';

    const sysMsgContent =
      role === 'admin'
        ? `[SYSTEM:ROLE_CHANGED:admin:${actorId}:${actorDisplayName}:${actorUsername}:${memberId}:${targetDisplayName}:${targetUsername}] ${actorUsername} made ${targetUsername} a group admin`
        : `[SYSTEM:ROLE_CHANGED:member:${actorId}:${actorDisplayName}:${actorUsername}:${memberId}:${targetDisplayName}:${targetUsername}] ${actorUsername} dismissed ${targetUsername} from group admin`;

    db.prepare(`
      INSERT INTO messages (id, conversation_id, sender_id, content, is_read, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
    `).run(generateUUID(), conversationId, actorId, sysMsgContent, nowIso, nowIso);

    return res.json({
      success: true,
      conversation: buildConversationObject(conversationId, actorId),
      message: sysMsgContent,
    });
  } catch {
    return res.status(500).json({ error: 'Failed to change role' });
  }
});

app.post('/api/groups/delete', (req, res) => {
  try {
    const { conversationId, actorId } = req.body || {};
    if (!conversationId || !actorId) {
      return res.status(400).json({ error: 'conversationId and actorId required' });
    }

    const group = buildConversationObject(conversationId, actorId);
    if (!group) return res.status(404).json({ error: 'Group not found' });

    const actorRole = group.member_roles?.[actorId];
    const isOwner = group.owner_id === actorId;
    if (actorRole !== 'admin' && !isOwner) {
      return res.status(403).json({ error: 'Only group admins can delete the group' });
    }

    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);
    db.prepare('DELETE FROM conversation_members WHERE conversation_id = ?').run(conversationId);
    db.prepare('DELETE FROM conversations WHERE id = ?').run(conversationId);
    db.prepare('INSERT OR IGNORE INTO deleted_conversations (user_id, conversation_id, deleted_at) VALUES (?, ?, ?)').run(
      '*',
      conversationId,
      new Date().toISOString()
    );

    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: 'Failed to delete group' });
  }
});

// ====================================================================
// MESSAGES ENDPOINTS (SQLite Backed)
// ====================================================================

app.post('/api/messages/typing', (req, res) => {
  try {
    const { conversationId, userId } = req.body || {};
    if (conversationId && userId) {
      if (!typingStateMap.has(conversationId)) {
        typingStateMap.set(conversationId, new Map());
      }
      typingStateMap.get(conversationId)!.set(userId, Date.now() + 3500);
    }
    return res.json({ success: true });
  } catch {
    return res.json({ success: false });
  }
});

app.post('/api/messages/react', (req, res) => {
  try {
    const { messageId, userId, emoji } = req.body || {};
    if (!messageId || !userId || !emoji) {
      return res.status(400).json({ error: 'messageId, userId, and emoji required' });
    }

    const row = db.prepare('SELECT reactions_json FROM messages WHERE id = ?').get(messageId) as any;
    if (!row) return res.json({ success: true });

    let reactions: Record<string, string[]> = {};
    if (row.reactions_json) {
      try { reactions = JSON.parse(row.reactions_json); } catch {}
    }

    const userList = reactions[emoji] || [];
    if (userList.includes(userId)) {
      reactions[emoji] = userList.filter((id) => id !== userId);
      if (reactions[emoji].length === 0) delete reactions[emoji];
    } else {
      reactions[emoji] = [...userList, userId];
    }

    db.prepare('UPDATE messages SET reactions_json = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(reactions),
      new Date().toISOString(),
      messageId
    );

    return res.json({ success: true, reactions });
  } catch {
    return res.status(500).json({ error: 'Failed to react to message' });
  }
});

app.post('/api/messages/send', (req, res) => {
  try {
    const { message, recipientId, receiverId, senderProfile, recipientProfile, receiverProfile } = req.body || {};
    if (!message || !message.conversation_id || !message.sender_id || !message.content) {
      return res.status(400).json({ error: 'Valid message object required' });
    }

    const convId = message.conversation_id;
    const senderId = message.sender_id;
    const nowIso = message.created_at || new Date().toISOString();

    db.prepare('DELETE FROM deleted_conversations WHERE conversation_id = ?').run(convId);

    const existingConv = buildConversationObject(convId, senderId);
    const isGroupChat =
      existingConv?.type === 'group' ||
      req.body.isGroup === true ||
      req.body.conversationType === 'group' ||
      Boolean(req.body.groupName);

    let targetRecipient = isGroupChat ? undefined : recipientId || receiverId;
    if (!isGroupChat && !targetRecipient && existingConv?.member_ids) {
      targetRecipient = existingConv.member_ids.find((id: string) => id !== senderId);
    }

    if (isGroupChat) {
      if (existingConv) {
        if (existingConv.removed_members?.[senderId]) {
          return res.status(403).json({
            error: 'You cannot send messages because you were removed from this group by an admin',
          });
        }
        if (Array.isArray(existingConv.member_ids) && !existingConv.member_ids.includes(senderId)) {
          return res.status(403).json({ error: 'You are not a member of this group' });
        }
      }
    } else {
      if (targetRecipient && targetRecipient !== senderId) {
        if (isBlocked(senderId, targetRecipient)) {
          return res.status(403).json({ error: 'Cannot message blocked user' });
        }
        if (!isMutualFollow(senderId, targetRecipient)) {
          return res.status(403).json({ error: 'Mutual follow is required to send direct messages' });
        }
      }
    }

    const recProfile = recipientProfile || receiverProfile;
    if (senderProfile?.id) ensureProfileRecord(senderProfile.id, senderProfile);
    if (recProfile?.id) ensureProfileRecord(recProfile.id, recProfile);

    if (!existingConv) {
      db.prepare(
        'INSERT OR IGNORE INTO conversations (id, type, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).run(convId, isGroupChat ? 'group' : 'direct', isGroupChat ? req.body.groupName || 'Group Chat' : null, nowIso, nowIso);
      db.prepare(
        'INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)'
      ).run(convId, senderId, 'member', nowIso);
      if (!isGroupChat && targetRecipient && targetRecipient !== senderId) {
        db.prepare(
          'INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)'
        ).run(convId, targetRecipient, 'member', nowIso);
      }
    } else {
      db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(nowIso, convId);
    }

    // Deduplicate call logs or rapid duplicate sends
    const dupRow = db.prepare('SELECT * FROM messages WHERE id = ?').get(message.id) as any;
    if (dupRow) {
      db.prepare('UPDATE messages SET content = ?, updated_at = ? WHERE id = ?').run(
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

    // Clear typing state on send
    typingStateMap.get(convId)?.delete(senderId);

    // Notifications
    const senderProf = senderProfile || getProfileCachedOrDb(senderId);
    const senderName = senderProf?.display_name || senderProf?.username || 'Someone';
    let notifPreview = message.content;
    if (notifPreview.startsWith('[IMAGE:')) notifPreview = 'Sent a photo';
    else if (notifPreview.startsWith('[VOICE:')) notifPreview = 'Sent a voice note';
    else if (notifPreview.startsWith('[VIDEO:')) notifPreview = 'Sent a video';
    else if (notifPreview.startsWith('[STICKER:')) notifPreview = 'Sent a sticker';

    if (isGroupChat && existingConv?.member_ids) {
      const groupName = existingConv.name || 'Group';
      for (const mId of existingConv.member_ids) {
        if (mId !== senderId) {
          addNotification(mId, senderId, 'message', `${senderName} in ${groupName}`, notifPreview, convId, senderProf);
        }
      }
    } else if (targetRecipient && targetRecipient !== senderId) {
      addNotification(
        targetRecipient,
        senderId,
        'message',
        `New message from ${senderName}`,
        notifPreview,
        convId,
        senderProf
      );
    }

    const savedMsg = formatMessageRow(db.prepare('SELECT * FROM messages WHERE id = ?').get(message.id));
    return res.json({ success: true, message: savedMsg || message });
  } catch (error) {
    console.error('[Send Message Error]:', error);
    return res.status(500).json({ error: 'Failed to send message' });
  }
});

app.post('/api/messages/list', (req, res) => {
  try {
    const { conversationId, candidateIds, userId } = req.body || {};
    if (!conversationId && (!Array.isArray(candidateIds) || candidateIds.length === 0)) {
      return res.status(400).json({ error: 'conversationId required' });
    }

    const targetConv = conversationId ? buildConversationObject(conversationId) : null;
    const isTargetGroup = targetConv?.type === 'group';
    const allIds = isTargetGroup
      ? [conversationId]
      : Array.from(new Set([conversationId, ...(Array.isArray(candidateIds) ? candidateIds : [])].filter(Boolean)));

    const placeholders = allIds.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT m.* FROM messages m
         LEFT JOIN deleted_messages dm ON m.id = dm.message_id
         WHERE m.conversation_id IN (${placeholders}) AND dm.message_id IS NULL
         ORDER BY m.created_at ASC LIMIT 250`
      )
      .all(...allIds) as any[];

    const messages = rows.map(formatMessageRow).filter(Boolean);

    // Collect active typing users (excluding requesting userId)
    const now = Date.now();
    const typingUserIds: string[] = [];
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
    return res.status(500).json({ error: 'Failed to list messages' });
  }
});

app.post('/api/messages/mark-read', (req, res) => {
  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch {}
    }
    const { conversationId, userId } = body || {};
    if (conversationId && userId) {
      const nowIso = new Date().toISOString();
      db.prepare('UPDATE messages SET is_read = 1 WHERE conversation_id = ? AND sender_id != ?').run(
        conversationId,
        userId
      );
      const unreadMsgs = db
        .prepare('SELECT id FROM messages WHERE conversation_id = ? AND sender_id != ?')
        .all(conversationId, userId) as { id: string }[];
      const readStmt = db.prepare(
        'INSERT OR IGNORE INTO message_reads (message_id, user_id, read_at) VALUES (?, ?, ?)'
      );
      for (const m of unreadMsgs) {
        readStmt.run(m.id, userId, nowIso);
      }
    }
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: 'Failed to mark messages as read' });
  }
});

app.post('/api/messages/delete', (req, res) => {
  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch {}
    }
    const { conversationId, messageId } = body || {};
    if (!messageId) return res.status(400).json({ error: 'messageId required' });

    const targetRow = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId) as any;
    if (targetRow) {
      let cPublicId = targetRow.cloudinary_public_id || null;
      const resType =
        targetRow.media_type === 'video' ? 'video' : targetRow.media_type === 'voice' ? 'raw' : 'image';
      if (!cPublicId && targetRow.content?.includes('cloudinary.com')) {
        const parts = targetRow.content.split('/upload/');
        if (parts[1]) {
          const fileWithExt = parts[1].replace(/^v\d+\//, '').split('?')[0];
          cPublicId = fileWithExt.substring(0, fileWithExt.lastIndexOf('.')) || fileWithExt;
        }
      }
      if (cPublicId) {
        deleteAssetFromCloudinary(cPublicId, resType).catch(() => {});
      }
    }

    db.prepare('INSERT OR IGNORE INTO deleted_messages (message_id, deleted_at) VALUES (?, ?)').run(
      messageId,
      new Date().toISOString()
    );
    db.prepare('DELETE FROM messages WHERE id = ?').run(messageId);

    return res.json({ success: true, messageId, conversationId });
  } catch {
    return res.status(500).json({ error: 'Failed to delete message' });
  }
});

app.post('/api/messages/clear', (req, res) => {
  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch {}
    }
    const { conversationId } = body || {};
    if (!conversationId) return res.status(400).json({ error: 'conversationId required' });

    const msgs = db.prepare('SELECT id FROM messages WHERE conversation_id = ?').all(conversationId) as { id: string }[];
    const stmt = db.prepare('INSERT OR IGNORE INTO deleted_messages (message_id, deleted_at) VALUES (?, ?)');
    const nowIso = new Date().toISOString();
    for (const m of msgs) stmt.run(m.id, nowIso);
    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);

    return res.json({ success: true, conversationId });
  } catch {
    return res.status(500).json({ error: 'Failed to clear conversation messages' });
  }
});

app.post('/api/conversations/delete', (req, res) => {
  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch {}
    }
    const { conversationId, userId } = body || {};
    if (!conversationId) return res.status(400).json({ error: 'conversationId required' });

    const convObj = buildConversationObject(conversationId, userId);
    if (convObj && convObj.type === 'group' && userId) {
      db.prepare('INSERT OR IGNORE INTO deleted_conversations (user_id, conversation_id, deleted_at) VALUES (?, ?, ?)').run(
        userId,
        conversationId,
        new Date().toISOString()
      );
      db.prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?').run(
        conversationId,
        userId
      );
      const remainingCount = db
        .prepare('SELECT COUNT(*) as cnt FROM conversation_members WHERE conversation_id = ?')
        .get(conversationId) as { cnt: number };

      if (remainingCount.cnt > 0) {
        return res.json({ success: true, conversationId, deletedForUser: true });
      }
    }

    db.prepare('INSERT OR IGNORE INTO deleted_conversations (user_id, conversation_id, deleted_at) VALUES (?, ?, ?)').run(
      userId || '*',
      conversationId,
      new Date().toISOString()
    );
    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);
    db.prepare('DELETE FROM conversation_members WHERE conversation_id = ?').run(conversationId);
    db.prepare('DELETE FROM conversations WHERE id = ?').run(conversationId);

    return res.json({ success: true, conversationId });
  } catch {
    return res.status(500).json({ error: 'Failed to delete conversation' });
  }
});

// ====================================================================
// PROBLEM REPORTS ENDPOINT (SQLite Backed)
// ====================================================================
app.post('/api/reports/create', (req, res) => {
  try {
    const { userId, category, description } = req.body || {};
    if (!description || !String(description).trim()) {
      return res.status(400).json({ error: 'Please describe the problem.' });
    }
    const id = generateUUID();
    db.prepare(
      'INSERT INTO problem_reports (id, user_id, category, description, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, userId || null, category || 'Bug', String(description).trim(), 'submitted', new Date().toISOString());

    return res.json({ success: true, reportId: id });
  } catch {
    return res.status(500).json({ error: 'Failed to submit problem report' });
  }
});

// ====================================================================
// MEDIA UPLOAD & SERVING ENDPOINTS (Cloudinary + Persistent Disk Fallback)
// ====================================================================

app.post('/api/b2/upload', async (req, res) => {
  try {
    const { base64Data, category, userId, conversationId, messageId, mimeType, fileName } = req.body || {};
    if (!base64Data) return res.status(400).json({ error: 'base64Data is required' });

    const cat: CloudinaryMediaCategory = (category as CloudinaryMediaCategory) || 'chat-photo';
    const buffer = Buffer.from(base64Data, 'base64');
    const validation = validateCloudinaryFileSize(buffer.length, cat);
    if (!validation.valid) return res.status(400).json({ error: validation.error });

    const result = await uploadBufferToCloudinary({
      buffer,
      category: cat,
      userId: userId || 'user',
      conversationId,
      messageId,
      mimeType: mimeType || 'application/octet-stream',
      fileName,
    });
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to upload media' });
  }
});

app.post('/api/b2/delete', async (req, res) => {
  try {
    const { b2_file_id, cloudinary_public_id, resource_type } = req.body || {};
    const publicId = cloudinary_public_id || b2_file_id;
    if (!publicId) return res.status(400).json({ error: 'publicId is required' });
    const success = await deleteAssetFromCloudinary(publicId, resource_type || 'image');
    return res.json({ success, publicId });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to delete media' });
  }
});

app.post('/api/cloudinary/upload', async (req, res) => {
  try {
    const { base64Data, category, userId, conversationId, messageId, mimeType, fileName } = req.body || {};
    if (!base64Data) return res.status(400).json({ error: 'base64Data is required' });

    const cat: CloudinaryMediaCategory = (category as CloudinaryMediaCategory) || 'chat-photo';
    const buffer = Buffer.from(base64Data, 'base64');
    const validation = validateCloudinaryFileSize(buffer.length, cat);
    if (!validation.valid) return res.status(400).json({ error: validation.error });

    const result = await uploadBufferToCloudinary({
      buffer,
      category: cat,
      userId: userId || 'user',
      conversationId,
      messageId,
      mimeType: mimeType || 'application/octet-stream',
      fileName,
    });
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to upload to Cloudinary' });
  }
});

app.post('/api/cloudinary/delete', async (req, res) => {
  try {
    const { cloudinary_public_id, resource_type } = req.body || {};
    if (!cloudinary_public_id) return res.status(400).json({ error: 'cloudinary_public_id is required' });
    const success = await deleteAssetFromCloudinary(cloudinary_public_id, resource_type || 'image');
    return res.json({ success, cloudinary_public_id });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to delete asset from Cloudinary' });
  }
});

app.get('/api/b2/file/*', (req, res) => {
  try {
    const b2Key = decodeURIComponent(req.params[0] || '');
    if (!b2Key) return res.status(400).send('File key required');

    const sanitizedLocalName = b2Key.replace(/\//g, '_');
    const candidates = [
      path.join(UPLOADS_DIR, sanitizedLocalName),
      path.join(process.cwd(), 'uploads', sanitizedLocalName),
    ];
    const localPath = candidates.find((p) => fs.existsSync(p));
    if (!localPath) return res.status(404).send('File not found');

    const stat = fs.statSync(localPath);
    const fileSize = stat.size;
    const range = req.headers.range;
    let mimeType = 'video/mp4';
    if (b2Key.endsWith('.mp3')) mimeType = 'audio/mpeg';
    else if (b2Key.endsWith('.webm')) mimeType = 'video/webm';
    else if (b2Key.endsWith('.png')) mimeType = 'image/png';
    else if (b2Key.endsWith('.jpg') || b2Key.endsWith('.jpeg')) mimeType = 'image/jpeg';
    else if (b2Key.endsWith('.gif')) mimeType = 'image/gif';

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      let start = parseInt(parts[0], 10);
      let end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      if (isNaN(start)) {
        start = fileSize - parseInt(parts[1], 10);
        end = fileSize - 1;
      }
      if (isNaN(end) || end >= fileSize) end = fileSize - 1;
      if (start < 0) start = 0;
      if (start > end || start >= fileSize) {
        res.setHeader('Content-Range', `bytes */${fileSize}`);
        return res.status(416).send('Requested Range Not Satisfiable');
      }
      const chunksize = end - start + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      });
      return fs.createReadStream(localPath, { start, end }).pipe(res);
    }

    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': mimeType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    return fs.createReadStream(localPath).pipe(res);
  } catch {
    return res.status(500).send('Error serving media file');
  }
});

app.post('/api/media/upload', async (req, res) => {
  try {
    const { base64Data, mimeType, fileName, mediaType } = req.body || {};
    if (!base64Data) return res.status(400).json({ error: 'base64Data is required' });

    const rawType = mimeType || (mediaType === 'audio' ? 'audio/webm' : 'image/jpeg');
    let type = rawType.split(';')[0].trim().toLowerCase();
    let buffer = Buffer.from(base64Data, 'base64');
    let ext = 'bin';

    const isAudio =
      mediaType === 'audio' ||
      type.startsWith('audio/') ||
      type.includes('webm') ||
      type.includes('opus') ||
      type.includes('ogg');
    if (isAudio) {
      try {
        const mp3Buffer = await transcodeAudioToMp3(buffer);
        if (mp3Buffer && mp3Buffer.length > 0) {
          buffer = mp3Buffer;
          type = 'audio/mpeg';
          ext = 'mp3';
        }
      } catch {}
    }

    if (ext === 'bin') {
      if (type.includes('jpeg') || type.includes('jpg')) ext = 'jpg';
      else if (type.includes('png')) ext = 'png';
      else if (type.includes('webp')) ext = 'webp';
      else if (type.includes('gif')) ext = 'gif';
      else if (type.includes('mp3') || type.includes('mpeg')) ext = 'mp3';
      else if (type.includes('mp4') || type.includes('m4a') || type.includes('aac')) ext = 'mp4';
      else if (type.includes('webm')) ext = 'webm';
      else if (type.includes('ogg') || type.includes('opus')) ext = 'ogg';
      else if (type.includes('wav')) ext = 'wav';
    }

    const fileId = `${mediaType || 'file'}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${ext}`;
    const filePath = path.join(UPLOADS_DIR, fileId);
    fs.writeFileSync(filePath, buffer);

    mediaFilesStore.set(fileId, {
      id: fileId,
      buffer,
      mimeType: type,
      fileName: fileName || fileId,
      size: buffer.length,
      createdAt: new Date().toISOString(),
      mp3Buffer: ext === 'mp3' ? buffer : undefined,
    });

    db.prepare(
      'INSERT OR REPLACE INTO media_files (id, mime_type, file_name, size, file_path, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(fileId, type, fileName || fileId, buffer.length, filePath, new Date().toISOString());

    let mediaUrl = `/api/media/file/${fileId}`;
    try {
      let cCat: CloudinaryMediaCategory = 'chat-photo';
      if (type.startsWith('video/')) cCat = 'chat-video';
      else if (type.startsWith('audio/')) cCat = 'chat-voice-note';
      else if (mediaType === 'profile') cCat = 'profile';

      const cRes = await uploadBufferToCloudinary({
        buffer,
        category: cCat,
        userId: 'general',
        mimeType: type,
        fileName: fileId,
      });
      if (cRes?.url) mediaUrl = cRes.url;
    } catch {}

    return res.json({ success: true, url: mediaUrl, fileId, mimeType: type, size: buffer.length });
  } catch {
    return res.status(500).json({ error: 'Failed to process media upload' });
  }
});

app.post('/api/media/transcode', async (req, res) => {
  try {
    const { base64Data, fileId } = req.body || {};
    let inputBuf: Buffer | null = null;
    if (base64Data) {
      inputBuf = Buffer.from(base64Data, 'base64');
    } else if (fileId) {
      const rec = mediaFilesStore.get(fileId);
      if (rec) {
        inputBuf = rec.buffer;
      } else {
        const candidates = [path.join(UPLOADS_DIR, fileId), path.join(process.cwd(), 'uploads', fileId)];
        const found = candidates.find((p) => fs.existsSync(p));
        if (found) inputBuf = fs.readFileSync(found);
      }
    }

    if (!inputBuf || inputBuf.length === 0) {
      return res.status(400).json({ error: 'Valid audio data or fileId required' });
    }

    const mp3Buf = await transcodeAudioToMp3(inputBuf);
    const newFileId = `audio_transcoded_${Date.now()}_${Math.random().toString(36).substring(2, 9)}.mp3`;
    const filePath = path.join(UPLOADS_DIR, newFileId);
    fs.writeFileSync(filePath, mp3Buf);

    mediaFilesStore.set(newFileId, {
      id: newFileId,
      buffer: mp3Buf,
      mimeType: 'audio/mpeg',
      fileName: newFileId,
      size: mp3Buf.length,
      createdAt: new Date().toISOString(),
      mp3Buffer: mp3Buf,
    });

    return res.json({
      success: true,
      url: `/api/media/file/${newFileId}`,
      fileId: newFileId,
      mimeType: 'audio/mpeg',
      size: mp3Buf.length,
    });
  } catch {
    return res.status(500).json({ error: 'Failed to transcode audio' });
  }
});

app.get('/api/media/file/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    if (!fileId) return res.status(400).send('File ID required');

    let record = mediaFilesStore.get(fileId);
    if (!record) {
      const candidates = [path.join(UPLOADS_DIR, fileId), path.join(process.cwd(), 'uploads', fileId)];
      const diskPath = candidates.find((p) => fs.existsSync(p));
      if (diskPath) {
        const diskBuf = fs.readFileSync(diskPath);
        let fallbackMime = 'application/octet-stream';
        if (fileId.endsWith('.webm')) fallbackMime = 'audio/webm';
        else if (fileId.endsWith('.ogg')) fallbackMime = 'audio/ogg';
        else if (fileId.endsWith('.mp4') || fileId.endsWith('.m4a')) fallbackMime = 'audio/mp4';
        else if (fileId.endsWith('.mp3')) fallbackMime = 'audio/mpeg';
        else if (fileId.endsWith('.wav')) fallbackMime = 'audio/wav';
        else if (fileId.endsWith('.jpg') || fileId.endsWith('.jpeg')) fallbackMime = 'image/jpeg';
        else if (fileId.endsWith('.png')) fallbackMime = 'image/png';
        else if (fileId.endsWith('.webp')) fallbackMime = 'image/webp';

        record = {
          id: fileId,
          buffer: diskBuf,
          mimeType: fallbackMime,
          fileName: fileId,
          size: diskBuf.length,
          createdAt: new Date().toISOString(),
        };
        mediaFilesStore.set(fileId, record);
      }
    }

    if (!record) return res.status(404).send('Media file not found');

    let cleanMime = (record.mimeType || 'audio/webm').split(';')[0].trim().toLowerCase();
    if ((fileId.endsWith('.webm') || cleanMime.includes('webm')) && !record.mp3Buffer) {
      try {
        const mp3Buf = await transcodeAudioToMp3(record.buffer);
        if (mp3Buf && mp3Buf.length > 0) record.mp3Buffer = mp3Buf;
      } catch {}
    }

    const activeBuffer = record.mp3Buffer || record.buffer;
    const activeMime = record.mp3Buffer ? 'audio/mpeg' : cleanMime;
    const totalSize = activeBuffer.length;

    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      let start = parseInt(parts[0], 10);
      let end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
      if (isNaN(start)) start = 0;
      if (isNaN(end) || end >= totalSize) end = totalSize - 1;
      if (start > end) start = 0;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${totalSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': activeMime,
        'Cache-Control': 'public, max-age=31536000, immutable',
      });
      return res.end(activeBuffer.subarray(start, end + 1));
    }

    res.writeHead(200, {
      'Content-Length': totalSize,
      'Content-Type': activeMime,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    return res.end(activeBuffer);
  } catch {
    return res.status(500).send('Error serving media file');
  }
});

// Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    database: 'sqlite',
    timestamp: new Date().toISOString(),
  });
});

app.get('/favicon.ico', (_req, res) => {
  res.redirect(302, '/icon.svg');
});

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const vitePromise = createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
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
    const cwdDist = path.resolve(process.cwd(), 'dist');
    const localDist = path.resolve(__dirname, 'dist');
    const parentDist = path.resolve(__dirname, '..', 'dist');
    const distPath = fs.existsSync(cwdDist)
      ? cwdDist
      : fs.existsSync(parentDist)
        ? parentDist
        : localDist;

    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      const indexPath = path.join(distPath, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('App build not found. Please run npm run build.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`LiveConnect server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});

export default app;
