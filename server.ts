import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import fs from 'fs';
import crypto from 'crypto';
import { spawn } from 'child_process';
import nodemailer from 'nodemailer';
import dns from 'dns';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  db,
  UPLOADS_DIR,
  generateId,
  hashPassword,
  verifyPassword,
  formatAuthUser,
  formatProfile,
  isAccountHiddenStatus,
  createSessionForUser,
  revokeAllSessionsForUser,
  getUserBySessionToken,
  deleteSessionToken,
  findPermanentBanByIdentifier,
  findUserByEmail,
  findUserById,
  getProfileById,
  getProfileByUsername,
  upsertProfile,
  deleteAccountCompletely,
  getAppSetting,
  findMatchedBannedWords,
  resolveEffectiveAdminRole,
  recordActivityEvent,
  SUPER_ADMIN_EMAIL,
  DbUserRow,
  DbProfileRow,
} from './server/db';
import {
  AccountStatus,
  buildModerationTemplate,
  sendModerationEmail,
  executeModerationAction,
  restoreUserAccount,
  resolveLiveUserRow,
  startModerationScheduler,
  writeAuditLog,
  formatRuleLabel,
} from './server/moderationService';
import {
  uploadBufferToCloudinary,
  deleteAssetFromCloudinary,
  validateCloudinaryFileSize,
  CloudinaryMediaCategory,
} from './server/cloudinaryService';
import { createFamilyRouter } from './server/familyRoutes';
import { createAdminRouter, FirebaseJwtClaims } from './server/adminRoutes';

dotenv.config();
if (fs.existsSync(path.join(process.cwd(), '.env.example'))) {
  dotenv.config({ path: path.join(process.cwd(), '.env.example') });
}

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

// Lazy-load Firebase config for verifying Firebase ID tokens on Express endpoints
let cachedFirebaseConfig: { apiKey: string | null; projectId: string | null } | null = null;
function getFirebaseConfigInfo(): { apiKey: string | null; projectId: string | null } {
  if (cachedFirebaseConfig) return cachedFirebaseConfig;
  const candidates = [
    path.join(process.cwd(), 'firebase-applet-config.json'),
    path.resolve(__dirname, 'firebase-applet-config.json'),
    path.resolve(__dirname, '..', 'firebase-applet-config.json'),
  ];
  for (const cfgPath of candidates) {
    try {
      if (fs.existsSync(cfgPath)) {
        const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
        cachedFirebaseConfig = {
          apiKey: parsed?.apiKey || null,
          projectId: parsed?.projectId || null,
        };
        return cachedFirebaseConfig;
      }
    } catch {
      // try next path
    }
  }
  cachedFirebaseConfig = {
    apiKey: process.env.FIREBASE_WEB_API_KEY || process.env.VITE_FIREBASE_API_KEY || null,
    projectId: process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || null,
  };
  return cachedFirebaseConfig;
}

function getFirebaseWebApiKey(): string | null {
  return getFirebaseConfigInfo().apiKey;
}

const verifiedFirebaseTokenCache = new Map<string, { claims: FirebaseJwtClaims; expiresAt: number }>();
let googleCertsCache: { certs: Record<string, string>; expiresAt: number } | null = null;
const lastActiveTouchMap = new Map<string, number>();

async function getGoogleFirebaseCerts(): Promise<Record<string, string> | null> {
  if (googleCertsCache && googleCertsCache.expiresAt > Date.now()) {
    return googleCertsCache.certs;
  }
  try {
    const resp = await fetch(
      'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
    );
    if (!resp.ok) return googleCertsCache?.certs || null;
    const certs = (await resp.json()) as Record<string, string>;
    const cc = resp.headers.get('cache-control') || '';
    const maxAgeMatch = cc.match(/max-age=(\d+)/i);
    const maxAgeSec = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : 3600;
    googleCertsCache = {
      certs,
      expiresAt: Date.now() + Math.max(60, maxAgeSec) * 1000,
    };
    return certs;
  } catch {
    return googleCertsCache?.certs || null;
  }
}

function decodeBase64Url(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4);
  return Buffer.from(padded, 'base64');
}

async function verifyFirebaseJwtClaimsLocally(token: string, expectedProjectId: string): Promise<FirebaseJwtClaims | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(decodeBase64Url(parts[0]).toString('utf8')) as { alg?: string; kid?: string };
    const payload = JSON.parse(decodeBase64Url(parts[1]).toString('utf8')) as {
      aud?: string;
      iss?: string;
      sub?: string;
      user_id?: string;
      email?: string;
      email_verified?: boolean;
      auth_time?: number;
      name?: string;
      picture?: string;
      exp?: number;
      iat?: number;
    };
    const nowSec = Math.floor(Date.now() / 1000);
    if (header.alg !== 'RS256' || !header.kid) return null;
    if (!payload.sub || payload.sub.length > 128) return null;
    if (payload.aud !== expectedProjectId) return null;
    if (payload.iss !== `https://securetoken.google.com/${expectedProjectId}`) return null;
    if (typeof payload.exp !== 'number' || payload.exp <= nowSec - 60) return null;

    const certs = await getGoogleFirebaseCerts();
    const certPem = certs?.[header.kid];
    if (!certPem) return null;

    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${parts[0]}.${parts[1]}`);
    verifier.end();
    const sig = decodeBase64Url(parts[2]);
    const valid = verifier.verify(certPem, sig);
    if (!valid) return null;
    return {
      uid: payload.sub,
      email: typeof payload.email === 'string' ? payload.email.toLowerCase() : undefined,
      emailVerified: Boolean(payload.email_verified),
      authTime: typeof payload.auth_time === 'number' ? payload.auth_time : undefined,
      iat: typeof payload.iat === 'number' ? payload.iat : undefined,
      name: typeof payload.name === 'string' ? payload.name : undefined,
      picture: typeof payload.picture === 'string' ? payload.picture : undefined,
    };
  } catch {
    return null;
  }
}

async function verifyFirebaseClaims(token: string): Promise<FirebaseJwtClaims | null> {
  if (!token || token.split('.').length !== 3) return null;

  const cached = verifiedFirebaseTokenCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.claims;
  }

  const { apiKey, projectId } = getFirebaseConfigInfo();
  if (projectId) {
    const localClaims = await verifyFirebaseJwtClaimsLocally(token, projectId);
    if (localClaims) {
      verifiedFirebaseTokenCache.set(token, { claims: localClaims, expiresAt: Date.now() + 5 * 60_000 });
      return localClaims;
    }
  }

  if (apiKey) {
    try {
      const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: token }),
      });
      if (resp.ok) {
        const data = (await resp.json()) as {
          users?: Array<{
            localId?: string;
            email?: string;
            emailVerified?: boolean;
            displayName?: string;
            photoUrl?: string;
          }>;
        };
        const u = data?.users?.[0];
        if (u?.localId) {
          let authTime: number | undefined;
          let iat: number | undefined;
          try {
            const payload = JSON.parse(decodeBase64Url(token.split('.')[1]).toString('utf8')) as {
              auth_time?: number;
              iat?: number;
            };
            authTime = typeof payload.auth_time === 'number' ? payload.auth_time : undefined;
            iat = typeof payload.iat === 'number' ? payload.iat : undefined;
          } catch {}
          const claims: FirebaseJwtClaims = {
            uid: u.localId,
            email: u.email ? u.email.toLowerCase() : undefined,
            emailVerified: Boolean(u.emailVerified),
            authTime,
            iat,
            name: u.displayName,
            picture: u.photoUrl,
          };
          verifiedFirebaseTokenCache.set(token, { claims, expiresAt: Date.now() + 60_000 });
          return claims;
        }
      }
    } catch {
      // Verification failed or offline
    }
  }

  return null;
}

async function verifyAuthToken(token: string): Promise<string | null> {
  if (!token) return null;

  const sessionInfo = getUserBySessionToken(token);
  if (sessionInfo?.userRow?.id) {
    return sessionInfo.userRow.id;
  }

  const claims = await verifyFirebaseClaims(token);
  return claims?.uid || null;
}

async function getOptionalAuthUserId(req: express.Request): Promise<string | null> {
  const token = extractBearerToken(req);
  if (!token) return null;
  return verifyAuthToken(token);
}

function getRequestDeviceId(req: express.Request): string | null {
  const fromHeader = req.headers['x-device-id'];
  if (typeof fromHeader === 'string' && fromHeader.trim()) return fromHeader.trim().slice(0, 128);
  const fromBody = req.body?.deviceId;
  if (typeof fromBody === 'string' && fromBody.trim()) return fromBody.trim().slice(0, 128);
  return null;
}

function invalidateTokenCachesForUser(userId: string) {
  for (const [tok, val] of verifiedFirebaseTokenCache.entries()) {
    if (val.claims.uid === userId) verifiedFirebaseTokenCache.delete(tok);
  }
}

function syncProfileCacheAfterModeration(userId: string, status: AccountStatus) {
  invalidateTokenCachesForUser(userId);
  const fresh = getProfileById(userId);
  if (fresh) {
    serverProfilesStore.set(userId, {
      ...fresh,
      status,
      is_online: isAccountHiddenStatus(status) ? false : fresh.is_online,
    });
  }
}

function ensureFirebaseUserRowSynced(claims: FirebaseJwtClaims): DbUserRow | undefined {
  const nowIso = new Date().toISOString();
  const cleanEmail = (claims.email || '').trim().toLowerCase();
  const isSuperAdminEmail = cleanEmail === SUPER_ADMIN_EMAIL && Boolean(claims.emailVerified);

  const byId = findUserById(claims.uid);
  if (byId) {
    if (isSuperAdminEmail && (byId.admin_role !== 'super_admin' || byId.role !== 'admin')) {
      db.prepare("UPDATE users SET role = 'admin', admin_role = 'super_admin', email_confirmed = 1, updated_at = ? WHERE id = ?").run(
        nowIso,
        byId.id
      );
      return findUserById(byId.id);
    }
    return byId;
  }

  if (!cleanEmail) return undefined;
  const byEmail = findUserByEmail(cleanEmail);
  if (byEmail) return byEmail;

  const assignedAdminRole = isSuperAdminEmail ? 'super_admin' : 'none';
  const assignedRole = isSuperAdminEmail ? 'admin' : 'user';
  db.prepare(`
    INSERT OR IGNORE INTO users (id, email, password_hash, email_confirmed, user_metadata, role, admin_role, last_active_at, created_at, updated_at)
    VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    claims.uid,
    cleanEmail,
    claims.emailVerified ? 1 : 0,
    JSON.stringify({
      full_name: claims.name || cleanEmail.split('@')[0],
      display_name: claims.name || cleanEmail.split('@')[0],
      avatar_url: claims.picture || null,
      provider: 'google',
    }),
    assignedRole,
    assignedAdminRole,
    nowIso,
    nowIso,
    nowIso
  );
  return findUserById(claims.uid);
}

const APPEAL_ALLOWED_API_PATHS = new Set([
  '/appeals',
  '/appeals/me',
  '/appeals/upload',
  '/account/export-data',
  '/account/status',
  '/account/templates',
  '/account/reactivate',
  '/account/acknowledge-restored',
  '/auth/session',
  '/auth/logout',
  '/auth/check-ban-status',
  '/auth/login',
  '/auth/google',
  '/auth/create-account',
  '/auth/confirm-user',
  '/auth/send-otp',
  '/auth/verify-otp',
  '/auth/truecaller/initiate',
  '/auth/truecaller/status',
  '/auth/truecaller/verify-otp',
  '/auth/truecaller/verify-number',
  '/health',
]);

const MAINTENANCE_BYPASS_PATHS = new Set([
  '/app/config',
  '/auth/session',
  '/auth/logout',
  '/auth/check-ban-status',
  '/health',
]);

// Global API middleware: verifies live account status, force-logout, last_active_at, and maintenance mode
app.use('/api', async (req, res, next) => {
  try {
    const reqPath = req.path || '/';
    // Let dedicated Admin Router enforce strict 404 & PIN auth for /api/admin/*
    if (reqPath.startsWith('/admin/') || reqPath === '/admin') {
      return next();
    }

    const maintenanceOn = getAppSetting('maintenance_mode', 'false') === 'true';
    const maintenanceMessage = getAppSetting(
      'maintenance_message',
      'LiveConnect is currently undergoing scheduled maintenance. Please check back shortly.'
    );
    const isMediaServe = reqPath.startsWith('/media/file/') || reqPath.startsWith('/b2/file/');
    const isMaintenanceBypass = MAINTENANCE_BYPASS_PATHS.has(reqPath) || isMediaServe;

    const token = extractBearerToken(req);
    if (!token) {
      if (maintenanceOn && !isMaintenanceBypass) {
        return res.status(503).json({
          error: maintenanceMessage,
          code: 'MAINTENANCE_MODE',
          maintenanceMode: true,
          maintenanceMessage,
        });
      }
      return next();
    }

    const sessionInfo = getUserBySessionToken(token);
    const fbClaims = sessionInfo ? null : await verifyFirebaseClaims(token);
    const uid = sessionInfo?.userRow?.id || fbClaims?.uid;
    if (!uid) {
      if (maintenanceOn && !isMaintenanceBypass) {
        return res.status(503).json({
          error: maintenanceMessage,
          code: 'MAINTENANCE_MODE',
          maintenanceMode: true,
          maintenanceMessage,
        });
      }
      return next();
    }

    let liveRow = await resolveLiveUserRow(uid, syncProfileCacheAfterModeration);
    if (!liveRow && fbClaims) {
      liveRow = ensureFirebaseUserRowSynced(fbClaims);
    }
    if (!liveRow) return next();

    // Enforce server-side Force Logout timestamp (invalidates both SQLite sessions & older Firebase JWTs)
    if (liveRow.force_logout_after && reqPath !== '/auth/logout' && reqPath !== '/health') {
      const cutoffMs = Date.parse(liveRow.force_logout_after);
      const tokenIssuedMs = sessionInfo?.session?.created_at
        ? Date.parse(sessionInfo.session.created_at)
        : fbClaims?.iat
          ? fbClaims.iat * 1000
          : 0;
      if (Number.isFinite(cutoffMs) && (!tokenIssuedMs || tokenIssuedMs < cutoffMs - 2000)) {
        if (reqPath === '/app/config' || reqPath === '/auth/check-ban-status') {
          (req as any).forceLoggedOut = true;
        } else {
          return res.status(401).json({
            error: 'Your session was ended by an administrator. Please sign in again.',
            code: 'FORCE_LOGOUT',
          });
        }
      }
    }

    // Track last_active_at (throttled every 30s per user)
    const nowMs = Date.now();
    const lastTouch = lastActiveTouchMap.get(uid) || 0;
    if (nowMs - lastTouch > 30_000) {
      lastActiveTouchMap.set(uid, nowMs);
      const nowIso = new Date(nowMs).toISOString();
      try {
        db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?').run(nowIso, uid);
      } catch {}
    }

    const tokenScope = sessionInfo?.session?.token_scope || 'full';
    (req as any).authUserId = uid;
    (req as any).authUserRow = liveRow;
    (req as any).tokenScope = tokenScope;

    // Enforce Maintenance Mode (admins can still enter)
    const effectiveAdminRole = resolveEffectiveAdminRole(liveRow);
    if (maintenanceOn && effectiveAdminRole === 'none' && !isMaintenanceBypass) {
      return res.status(503).json({
        error: maintenanceMessage,
        code: 'MAINTENANCE_MODE',
        maintenanceMode: true,
        maintenanceMessage,
      });
    }

    if (APPEAL_ALLOWED_API_PATHS.has(reqPath) || isMediaServe || reqPath.startsWith('/app/') || reqPath.startsWith('/support/')) {
      return next();
    }

    if (
      tokenScope === 'appeal_only' ||
      liveRow.status === 'suspended' ||
      liveRow.status === 'disabled' ||
      liveRow.status === 'deactivated'
    ) {
      return res.status(403).json({
        error:
          liveRow.status === 'disabled'
            ? 'Your account has been permanently disabled. Only the appeal and data-export APIs are permitted.'
            : liveRow.status === 'deactivated'
              ? 'Your account is deactivated. Please reactivate your account to continue.'
              : 'Your account has been suspended. Only the appeal and data-export APIs are permitted.',
        code: 'ACCOUNT_SUSPENDED',
        accountStatus: liveRow.status,
        banReason: liveRow.ban_reason || null,
        ruleBroken: liveRow.rule_broken || null,
        ruleLabel: formatRuleLabel(liveRow.rule_broken),
        banUntil: liveRow.ban_until || liveRow.banned_until || null,
        scheduledDeletionAt: liveRow.scheduled_deletion_at || null,
      });
    }

    const restrictedWriteRoutes = new Set([
      '/messages/send',
      '/messages/react',
      '/calls/create',
      '/relations/follow',
      '/conversations/create-or-get',
    ]);
    if (liveRow.status === 'restricted' && restrictedWriteRoutes.has(reqPath)) {
      return res.status(403).json({
        error: 'Your account is temporarily restricted from sending messages, starting calls, or following users.',
        code: 'ACCOUNT_RESTRICTED',
        accountStatus: 'restricted',
        restrictedUntil: liveRow.restricted_until || null,
      });
    }

    return next();
  } catch {
    return next();
  }
});

// Auth middleware: requires valid session or Firebase Bearer token AND verifies live account row
async function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = extractBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const uid = (req as any).authUserId || (await verifyAuthToken(token));
  if (!uid) {
    return res.status(401).json({ error: 'Invalid or expired authentication token' });
  }
  if (!(req as any).authUserRow) {
    (req as any).authUserRow = await resolveLiveUserRow(uid, syncProfileCacheAfterModeration);
  }
  (req as any).authUserId = uid;
  return next();
}

// Role middleware: only admin and moderator may access moderation endpoints
function requireModeratorOrAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const userRow = (req as any).authUserRow as DbUserRow | undefined;
  const uid = (req as any).authUserId as string | undefined;
  const live = userRow || (uid ? findUserById(uid) : undefined);
  const effective = live ? resolveEffectiveAdminRole(live) : 'none';
  if (effective !== 'super_admin' && effective !== 'moderator') {
    return res.status(403).json({ error: 'Admin or moderator privileges required' });
  }
  return next();
}

// Sliding-window rate limiter for Block / Unblock endpoints (max 12 requests per 60s per user)
const blockRateLimitBuckets = new Map<string, number[]>();
const BLOCK_RATE_LIMIT_MAX = 12;
const BLOCK_RATE_LIMIT_WINDOW_MS = 60_000;

function blockRateLimiter(req: express.Request, res: express.Response, next: express.NextFunction) {
  const key = String((req as any).authUserId || req.ip || 'anonymous');
  const now = Date.now();
  const windowStart = now - BLOCK_RATE_LIMIT_WINDOW_MS;
  const timestamps = (blockRateLimitBuckets.get(key) || []).filter((ts) => ts > windowStart);

  if (timestamps.length >= BLOCK_RATE_LIMIT_MAX) {
    const oldest = timestamps[0] || now;
    const retryAfterSec = Math.max(1, Math.ceil((oldest + BLOCK_RATE_LIMIT_WINDOW_MS - now) / 1000));
    res.setHeader('Retry-After', String(retryAfterSec));
    return res.status(429).json({
      error: 'Too many block/unblock requests. Please wait a moment and try again.',
      retryAfterSeconds: retryAfterSec,
    });
  }

  timestamps.push(now);
  blockRateLimitBuckets.set(key, timestamps);
  return next();
}

// Sliding-window rate limiter for Appeal API (max 5 requests per 10 minutes per user)
const appealRateLimitBuckets = new Map<string, number[]>();
const APPEAL_RATE_LIMIT_MAX = 5;
const APPEAL_RATE_LIMIT_WINDOW_MS = 10 * 60_000;

function appealRateLimiter(req: express.Request, res: express.Response, next: express.NextFunction) {
  const key = String((req as any).authUserId || req.ip || 'anonymous');
  const now = Date.now();
  const windowStart = now - APPEAL_RATE_LIMIT_WINDOW_MS;
  const timestamps = (appealRateLimitBuckets.get(key) || []).filter((ts) => ts > windowStart);

  if (timestamps.length >= APPEAL_RATE_LIMIT_MAX) {
    const oldest = timestamps[0] || now;
    const retryAfterSec = Math.max(1, Math.ceil((oldest + APPEAL_RATE_LIMIT_WINDOW_MS - now) / 1000));
    res.setHeader('Retry-After', String(retryAfterSec));
    return res.status(429).json({
      error: 'Appeal submission rate limit exceeded. Please wait before submitting another request.',
      retryAfterSeconds: retryAfterSec,
    });
  }

  timestamps.push(now);
  appealRateLimitBuckets.set(key, timestamps);
  return next();
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
  if (!userA || !userB || userA === userB) return false;
  const row = db
    .prepare(
      'SELECT 1 FROM blocked_users WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1'
    )
    .get(userA, userB, userB, userA);
  return Boolean(row);
}

// Reusable middleware: rejects action with 403 if either user has blocked the other
function requireNotBlocked(getTargetUserId: (req: express.Request) => string | undefined | null) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const actorId = (req as any).authUserId || req.body?.userId || req.body?.sender_id || req.body?.caller_id;
    const targetId = getTargetUserId(req);
    if (actorId && targetId && isBlocked(String(actorId), String(targetId))) {
      return res.status(403).json({ error: 'Action unavailable because a user block exists' });
    }
    return next();
  };
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

function isTargetUserHidden(userId?: string | null): boolean {
  if (!userId) return false;
  const row = db.prepare('SELECT status FROM users WHERE id = ? LIMIT 1').get(userId) as { status?: string } | undefined;
  return isAccountHiddenStatus(row?.status);
}

function getFollowCounts(userId: string) {
  const canonicalUserId = resolveUserId(userId);
  const followersRow = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM follows f
       LEFT JOIN users u ON u.id = f.follower_id
       WHERE f.following_id = ? AND COALESCE(u.status, 'active') NOT IN ('suspended', 'disabled', 'deactivated')`
    )
    .get(canonicalUserId) as { cnt: number };
  const followingRow = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM follows f
       LEFT JOIN users u ON u.id = f.following_id
       WHERE f.follower_id = ? AND COALESCE(u.status, 'active') NOT IN ('suspended', 'disabled', 'deactivated')`
    )
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

  const isGroup =
    convRow.type === 'group' ||
    Boolean(convRow.name) ||
    memberIds.length > 2;
  if (isGroup) return null;

  const msgRow = db
    .prepare(
      `SELECT m.* FROM messages m
       LEFT JOIN deleted_messages dm ON m.id = dm.message_id
       WHERE m.conversation_id = ? AND dm.message_id IS NULL
       ORDER BY m.created_at DESC LIMIT 1`
    )
    .get(convId) as any;

  const lastMessage = msgRow ? formatMessageRow(msgRow) : null;

  let pinnedMessage: any = null;
  if (convRow.pinned_message_id) {
    const pinnedRow = db
      .prepare(
        `SELECT m.* FROM messages m
         LEFT JOIN deleted_messages dm ON m.id = dm.message_id
         WHERE m.id = ? AND m.conversation_id = ? AND dm.message_id IS NULL
         LIMIT 1`
      )
      .get(convRow.pinned_message_id, convId) as any;
    if (pinnedRow) {
      pinnedMessage = formatMessageRow(pinnedRow);
    }
  }

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
  if (requestingUserId) {
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

  return {
    id: convRow.id,
    type: 'direct' as const,
    pinned_message_id: convRow.pinned_message_id || null,
    pinned_message: pinnedMessage,
    member_ids: memberIds,
    members_meta: membersMeta,
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
    const deviceId = getRequestDeviceId(req);

    // Prevent new account creation from same email, phone, or device after a permanent ban
    const permanentBlock = findPermanentBanByIdentifier({
      email: cleanEmail,
      phone: req.body?.phone || null,
      deviceId,
    });
    if (permanentBlock) {
      return res.status(403).json({
        error: `Account creation is permanently blocked because this ${permanentBlock.type} is associated with a permanently disabled account.`,
        code: 'PERMANENT_BAN_BLOCK',
      });
    }

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

    const assignedRole = cleanEmail === SUPER_ADMIN_EMAIL ? 'admin' : 'user';
    const assignedAdminRole = cleanEmail === SUPER_ADMIN_EMAIL ? 'super_admin' : 'none';
    db.prepare(`
      INSERT INTO users (id, email, password_hash, email_confirmed, user_metadata, role, admin_role, last_active_at, last_device_id, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, cleanEmail, hashPassword(password), JSON.stringify(meta), assignedRole, assignedAdminRole, nowIso, deviceId, nowIso, nowIso);
    recordActivityEvent({ eventType: 'user_signup', userId });

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
    const deviceId = getRequestDeviceId(req);
    let userRow = findUserByEmail(cleanEmail);
    if (!userRow) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (!userRow.password_hash || !verifyPassword(String(password), userRow.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    userRow = (await resolveLiveUserRow(userRow.id, syncProfileCacheAfterModeration)) || userRow;

    if (userRow.status === 'suspended' || userRow.status === 'disabled') {
      // Ensure active sessions are revoked and issue an appeal-only token for the Suspension/Appeal screen
      revokeAllSessionsForUser(userRow.id);
      const appealSession = createSessionForUser(userRow.id, 7, 'appeal_only', deviceId);
      const latestBan = db
        .prepare('SELECT * FROM bans WHERE user_id = ? ORDER BY created_at DESC LIMIT 1')
        .get(userRow.id) as any;

      return res.status(403).json({
        error:
          userRow.status === 'disabled'
            ? 'Your account has been permanently disabled.'
            : 'Your account has been suspended.',
        banned: true,
        accountStatus: userRow.status,
        banReason: userRow.ban_reason || latestBan?.reason || 'Community Guidelines violation',
        ruleBroken: userRow.rule_broken || latestBan?.rule_broken || 'community_guidelines',
        ruleLabel: formatRuleLabel(userRow.rule_broken || latestBan?.rule_broken),
        banUntil: userRow.ban_until || userRow.banned_until || null,
        bannedUntil: userRow.ban_until || userRow.banned_until || null,
        scheduledDeletionAt: userRow.scheduled_deletion_at || null,
        strikeCount: Number(userRow.strike_count || 0),
        appealSession,
        user: formatAuthUser(userRow),
      });
    }

    if (userRow.status === 'deactivated') {
      // Automatically reactivate self-deactivated account upon valid sign-in
      db.prepare("UPDATE users SET status = 'active', updated_at = ? WHERE id = ?").run(
        new Date().toISOString(),
        userRow.id
      );
      userRow = findUserById(userRow.id)!;
    }

    const session = createSessionForUser(userRow.id, 30, 'full', deviceId);
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
      restoredNoticePending: Boolean(userRow.restored_notice_pending),
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
    const deviceId = getRequestDeviceId(req);
    let userRow = findUserByEmail(cleanEmail);
    const nowIso = new Date().toISOString();

    if (!userRow) {
      const permanentBlock = findPermanentBanByIdentifier({ email: cleanEmail, deviceId });
      if (permanentBlock) {
        return res.status(403).json({
          error: `Account creation is permanently blocked because this ${permanentBlock.type} is associated with a permanently disabled account.`,
          code: 'PERMANENT_BAN_BLOCK',
        });
      }

      const userId = generateUUID();
      const meta = {
        full_name: googleProfile.name || cleanEmail.split('@')[0],
        name: googleProfile.name || cleanEmail.split('@')[0],
        avatar_url: googleProfile.picture || null,
        picture: googleProfile.picture || null,
        provider: 'google',
        google_sub: googleProfile.sub,
      };
      const assignedRole = cleanEmail === SUPER_ADMIN_EMAIL ? 'admin' : 'user';
      const assignedAdminRole = cleanEmail === SUPER_ADMIN_EMAIL ? 'super_admin' : 'none';
      db.prepare(`
        INSERT INTO users (id, email, password_hash, email_confirmed, user_metadata, role, admin_role, last_active_at, last_device_id, created_at, updated_at)
        VALUES (?, ?, NULL, 1, ?, ?, ?, ?, ?, ?, ?)
      `).run(userId, cleanEmail, JSON.stringify(meta), assignedRole, assignedAdminRole, nowIso, deviceId, nowIso, nowIso);
      recordActivityEvent({ eventType: 'user_signup', userId });
      userRow = findUserById(userId)!;
    } else {
      userRow = (await resolveLiveUserRow(userRow.id, syncProfileCacheAfterModeration)) || userRow;
      if (userRow.status === 'suspended' || userRow.status === 'disabled') {
        revokeAllSessionsForUser(userRow.id);
        const appealSession = createSessionForUser(userRow.id, 7, 'appeal_only', deviceId);
        return res.status(403).json({
          error:
            userRow.status === 'disabled'
              ? 'Your account has been permanently disabled.'
              : 'Your account has been suspended.',
          banned: true,
          accountStatus: userRow.status,
          banReason: userRow.ban_reason || 'Community Guidelines violation',
          ruleBroken: userRow.rule_broken || 'community_guidelines',
          ruleLabel: formatRuleLabel(userRow.rule_broken),
          banUntil: userRow.ban_until || userRow.banned_until || null,
          bannedUntil: userRow.ban_until || userRow.banned_until || null,
          scheduledDeletionAt: userRow.scheduled_deletion_at || null,
          strikeCount: Number(userRow.strike_count || 0),
          appealSession,
          user: formatAuthUser(userRow),
        });
      }

      if (userRow.status === 'deactivated') {
        db.prepare("UPDATE users SET status = 'active', updated_at = ? WHERE id = ?").run(nowIso, userRow.id);
      }

      let existingMeta: any = {};
      try { existingMeta = userRow.user_metadata ? JSON.parse(userRow.user_metadata) : {}; } catch {}
      const updatedMeta = {
        ...existingMeta,
        full_name: googleProfile.name || existingMeta.full_name,
        avatar_url: existingMeta.avatar_url || googleProfile.picture || null,
        provider: 'google',
      };
      db.prepare('UPDATE users SET user_metadata = ?, email_confirmed = 1, last_device_id = COALESCE(?, last_device_id), updated_at = ? WHERE id = ?').run(
        JSON.stringify(updatedMeta),
        deviceId,
        nowIso,
        userRow.id
      );
      userRow = findUserById(userRow.id)!;
    }

    const session = createSessionForUser(userRow.id, 30, 'full', deviceId);
    const profile = getProfileById(userRow.id);

    return res.json({
      success: true,
      session,
      user: formatAuthUser(userRow),
      profile,
      needsOnboarding: !profile,
      restoredNoticePending: Boolean(userRow.restored_notice_pending),
    });
  } catch (err: any) {
    console.error('[Google Auth Error]:', err);
    return res.status(500).json({ error: err.message || 'Google sign-in failed' });
  }
});

// 7. Get Current Session (verifies live status on DB, not just token validity)
app.get('/api/auth/session', async (req, res) => {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      return res.json({ session: null, user: null, profile: null });
    }

    const authInfo = getUserBySessionToken(token);
    if (!authInfo) {
      return res.json({ session: null, user: null, profile: null });
    }

    const liveRow = (await resolveLiveUserRow(authInfo.user.id, syncProfileCacheAfterModeration)) || authInfo.userRow;
    const isBannedOrSuspended = liveRow.status === 'suspended' || liveRow.status === 'disabled';

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
        strikeCount: Number(liveRow.strike_count || 0),
      });
    }

    if (authInfo.session.token_scope === 'appeal_only') {
      // Suspension was lifted! Upgrade to full session cleanly
      deleteSessionToken(token);
      const upgraded = createSessionForUser(liveRow.id, 30, 'full', getRequestDeviceId(req));
      const profile = getProfileById(liveRow.id);
      return res.json({
        session: upgraded,
        user: formatAuthUser(liveRow),
        profile,
        needsOnboarding: !profile,
        banned: false,
        bannedUntil: null,
        restoredNoticePending: Boolean(liveRow.restored_notice_pending),
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
      restoredNoticePending: Boolean(liveRow.restored_notice_pending),
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

    const blockedInUsername = findMatchedBannedWords(cleanUsername).filter((w) => w.action === 'block');
    const blockedInDisplayName = findMatchedBannedWords(String(displayName || '')).filter((w) => w.action === 'block');
    if (blockedInUsername.length > 0 || blockedInDisplayName.length > 0) {
      return res.status(400).json({ error: 'Username or display name contains a restricted word.' });
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
      const blockedUsername = findMatchedBannedWords(nextUsername).filter((w) => w.action === 'block');
      if (blockedUsername.length > 0) {
        return res.status(400).json({ error: 'This username contains a restricted word.' });
      }
      const taken = getProfileByUsername(nextUsername);
      if (taken && taken.id !== targetUserId) {
        return res.status(400).json({ error: `@${nextUsername} is already taken.` });
      }
    }
    if (updates?.display_name) {
      const blockedDisplay = findMatchedBannedWords(String(updates.display_name)).filter((w) => w.action === 'block');
      if (blockedDisplay.length > 0) {
        return res.status(400).json({ error: 'Display name contains a restricted word.' });
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
app.post('/api/auth/confirm-user', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Email is required' });
    const cleanEmail = String(email).trim().toLowerCase();
    const deviceId = getRequestDeviceId(req);

    let userRow = findUserByEmail(cleanEmail);
    const nowIso = new Date().toISOString();
    const cleanUsername = cleanEmail.split('@')[0].replace(/[^a-z0-9_]/g, '') || 'user';

    if (!userRow && password) {
      const permanentBlock = findPermanentBanByIdentifier({ email: cleanEmail, deviceId });
      if (permanentBlock) {
        return res.status(403).json({
          error: `Account creation is permanently blocked because this ${permanentBlock.type} is associated with a permanently disabled account.`,
          code: 'PERMANENT_BAN_BLOCK',
        });
      }
      const userId = generateUUID();
      const assignedRole = cleanEmail === SUPER_ADMIN_EMAIL ? 'admin' : 'user';
      const assignedAdminRole = cleanEmail === SUPER_ADMIN_EMAIL ? 'super_admin' : 'none';
      db.prepare(`
        INSERT INTO users (id, email, password_hash, email_confirmed, user_metadata, role, admin_role, last_active_at, last_device_id, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        cleanEmail,
        hashPassword(String(password)),
        JSON.stringify({ display_name: cleanUsername, username: cleanUsername, country: 'India' }),
        assignedRole,
        assignedAdminRole,
        nowIso,
        deviceId,
        nowIso,
        nowIso
      );
      recordActivityEvent({ eventType: 'user_signup', userId });
      userRow = findUserById(userId)!;
    } else if (userRow) {
      userRow = (await resolveLiveUserRow(userRow.id, syncProfileCacheAfterModeration)) || userRow;
      if (userRow.status === 'suspended' || userRow.status === 'disabled') {
        revokeAllSessionsForUser(userRow.id);
        const appealSession = createSessionForUser(userRow.id, 7, 'appeal_only', deviceId);
        return res.status(403).json({
          error:
            userRow.status === 'disabled'
              ? 'Your account has been permanently disabled.'
              : 'Your account has been suspended.',
          banned: true,
          accountStatus: userRow.status,
          banReason: userRow.ban_reason || 'Community Guidelines violation',
          ruleBroken: userRow.rule_broken || 'community_guidelines',
          ruleLabel: formatRuleLabel(userRow.rule_broken),
          banUntil: userRow.ban_until || userRow.banned_until || null,
          bannedUntil: userRow.ban_until || userRow.banned_until || null,
          scheduledDeletionAt: userRow.scheduled_deletion_at || null,
          strikeCount: Number(userRow.strike_count || 0),
          appealSession,
          user: formatAuthUser(userRow),
        });
      }
      db.prepare("UPDATE users SET email_confirmed = 1, status = CASE WHEN status = 'deactivated' THEN 'active' ELSE status END, updated_at = ? WHERE id = ?").run(
        nowIso,
        userRow.id
      );
      userRow = findUserById(userRow.id)!;
    }

    if (!userRow) {
      return res.status(404).json({ error: 'User not found' });
    }

    const profile = ensureProfileRecord(userRow.id, {
      username: cleanUsername,
      display_name: cleanUsername,
      email: cleanEmail,
    });
    const session = createSessionForUser(userRow.id, 30, 'full', deviceId);

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

app.post('/api/auth/verify-otp', async (req, res) => {
  try {
    const { email, otpCode } = req.body || {};
    if (!email || !otpCode) {
      return res.status(400).json({ error: 'email and otpCode are required' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanCode = String(otpCode).trim();
    const deviceId = getRequestDeviceId(req);

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

    let userRow = findUserByEmail(cleanEmail);
    let session = null;
    let user = null;
    let profile = null;
    if (userRow) {
      userRow = (await resolveLiveUserRow(userRow.id, syncProfileCacheAfterModeration)) || userRow;
      if (userRow.status === 'suspended' || userRow.status === 'disabled') {
        revokeAllSessionsForUser(userRow.id);
        const appealSession = createSessionForUser(userRow.id, 7, 'appeal_only', deviceId);
        return res.status(403).json({
          error:
            userRow.status === 'disabled'
              ? 'Your account has been permanently disabled.'
              : 'Your account has been suspended.',
          banned: true,
          accountStatus: userRow.status,
          banReason: userRow.ban_reason || 'Community Guidelines violation',
          ruleBroken: userRow.rule_broken || 'community_guidelines',
          ruleLabel: formatRuleLabel(userRow.rule_broken),
          banUntil: userRow.ban_until || userRow.banned_until || null,
          bannedUntil: userRow.ban_until || userRow.banned_until || null,
          scheduledDeletionAt: userRow.scheduled_deletion_at || null,
          strikeCount: Number(userRow.strike_count || 0),
          appealSession,
          user: formatAuthUser(userRow),
        });
      }
      db.prepare(
        "UPDATE users SET email_confirmed = 1, status = CASE WHEN status = 'deactivated' THEN 'active' ELSE status END, updated_at = ? WHERE id = ?"
      ).run(new Date().toISOString(), userRow.id);
      userRow = findUserById(userRow.id)!;
      session = createSessionForUser(userRow.id, 30, 'full', deviceId);
      user = formatAuthUser(userRow);
      profile = getProfileById(userRow.id);
    }

    return res.json({ success: true, verified: true, session, user, profile });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to verify OTP' });
  }
});

// Check Ban Status Endpoint (checks live status from SQLite, not only token)
app.get('/api/auth/check-ban-status', async (req, res) => {
  try {
    const token = extractBearerToken(req);
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    const uid = (req as any).authUserId || (await verifyAuthToken(token));
    if (!uid) return res.status(401).json({ error: 'Not authenticated' });

    const liveRow = await resolveLiveUserRow(uid, syncProfileCacheAfterModeration);
    if (!liveRow) return res.status(401).json({ error: 'Not authenticated' });

    const isBanned = liveRow.status === 'suspended' || liveRow.status === 'disabled';
    const maintenanceMode = getAppSetting('maintenance_mode', 'false') === 'true';
    const maintenanceMessage = getAppSetting(
      'maintenance_message',
      'LiveConnect is currently undergoing scheduled maintenance. Please check back shortly.'
    );
    const adminRole = resolveEffectiveAdminRole(liveRow);
    const unreadWarnings = db
      .prepare('SELECT id, reason, rule_broken, created_at FROM user_warnings WHERE user_id = ? AND acknowledged = 0 ORDER BY created_at DESC LIMIT 20')
      .all(uid);

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
      restoredNoticePending: Boolean(liveRow.restored_notice_pending),
      forceLoggedOut: Boolean((req as any).forceLoggedOut),
      maintenanceMode,
      maintenanceMessage,
      isAdminStaff: adminRole !== 'none',
      isVerified: Boolean(liveRow.is_verified),
      unreadWarnings,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to check ban status' });
  }
});

// ====================================================================
// ACCOUNT STATUS, EXPORT, DEACTIVATION, TEMPLATES & APPEAL ENDPOINTS
// ====================================================================

// Get current user's full Account Status, strike ladder, history & permissions
app.get('/api/account/status', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).authUserId as string;
    const liveRow = await resolveLiveUserRow(userId, syncProfileCacheAfterModeration);
    if (!liveRow) return res.status(404).json({ error: 'Account not found' });

    const profile = getProfileById(userId);
    const historyRows = db
      .prepare('SELECT * FROM bans WHERE user_id = ? ORDER BY created_at DESC LIMIT 30')
      .all(userId) as any[];
    const appealRows = db
      .prepare('SELECT * FROM appeals WHERE user_id = ? ORDER BY created_at DESC LIMIT 10')
      .all(userId) as any[];

    const status = (liveRow.status || 'active') as AccountStatus;
    const permissions = {
      canLogin: status === 'active' || status === 'restricted',
      canSendMessages: status === 'active',
      canStartCalls: status === 'active',
      canFollowUsers: status === 'active',
      profileVisibleToOthers: status === 'active' || status === 'restricted',
      appearsInSearch: status === 'active' || status === 'restricted',
      canSubmitAppeal: status === 'suspended' || status === 'disabled' || status === 'restricted',
      canDownloadData: true,
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
        role: liveRow.role || 'user',
      },
      profile,
      history: historyRows.map((r) => ({ ...r, action: r.action_type || r.action, is_active: Boolean(r.is_active) })),
      appeals: appealRows,
      permissions,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to fetch account status' });
  }
});

// Clear restored celebration banner after user clicks "Continue"
app.post('/api/account/acknowledge-restored', requireAuth, (req, res) => {
  try {
    const userId = (req as any).authUserId as string;
    db.prepare('UPDATE users SET restored_notice_pending = 0, updated_at = ? WHERE id = ?').run(
      new Date().toISOString(),
      userId
    );
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to acknowledge restore notice' });
  }
});

// Self-deactivation (user chooses to deactivate account temporarily)
app.post('/api/account/deactivate', requireAuth, (req, res) => {
  try {
    const userId = (req as any).authUserId as string;
    const nowIso = new Date().toISOString();
    db.prepare("UPDATE users SET status = 'deactivated', updated_at = ? WHERE id = ?").run(nowIso, userId);
    db.prepare('UPDATE profiles SET is_online = 0, last_seen = ?, updated_at = ? WHERE id = ?').run(
      nowIso,
      nowIso,
      userId
    );
    revokeAllSessionsForUser(userId);
    writeAuditLog({
      adminId: userId,
      targetUserId: userId,
      action: 'deactivate',
      reason: String(req.body?.reason || 'User voluntarily deactivated their account.'),
    });
    syncProfileCacheAfterModeration(userId, 'deactivated');
    return res.json({ success: true, status: 'deactivated' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to deactivate account' });
  }
});

// Download-your-data JSON export (explicitly permitted even when suspended or disabled)
app.get('/api/account/export-data', requireAuth, (req, res) => {
  try {
    const userId = (req as any).authUserId as string;
    const userRow = findUserById(userId);
    if (!userRow) return res.status(404).json({ error: 'User not found' });

    const profile = getProfileById(userId);
    const follows = db
      .prepare('SELECT follower_id, following_id, created_at FROM follows WHERE follower_id = ? OR following_id = ?')
      .all(userId, userId);
    const messages = db
      .prepare('SELECT id, conversation_id, sender_id, content, created_at FROM messages WHERE sender_id = ? ORDER BY created_at DESC LIMIT 500')
      .all(userId);
    const calls = db
      .prepare('SELECT id, caller_id, callee_id, call_type, status, started_at, ended_at FROM calls WHERE caller_id = ? OR callee_id = ? ORDER BY created_at DESC LIMIT 200')
      .all(userId, userId);
    const bans = db.prepare('SELECT * FROM bans WHERE user_id = ? ORDER BY created_at DESC').all(userId);
    const appeals = db.prepare('SELECT * FROM appeals WHERE user_id = ? ORDER BY created_at DESC').all(userId);

    const exportPayload = {
      exportedAt: new Date().toISOString(),
      account: formatAuthUser(userRow),
      profile,
      follows,
      messagesSentCount: messages.length,
      messages,
      calls,
      moderationHistory: bans,
      appeals,
    };

    const safeUsername = profile?.username || 'user';
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="liveconnect-export-${safeUsername}.json"`);
    return res.send(JSON.stringify(exportPayload, null, 2));
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to export user data' });
  }
});

// Notification & Email Template preview endpoint (for Screen 5 template inspection & testing)
app.get('/api/account/templates', requireAuth, (req, res) => {
  const userId = (req as any).authUserId as string;
  const userRow = findUserById(userId);
  const profile = getProfileById(userId);
  const displayName = profile?.display_name || userRow?.email?.split('@')[0] || 'Alex Morgan';
  const username = profile?.username || 'alex_morgan';
  const email = userRow?.email || 'user@example.com';

  const templates = {
    warning: buildModerationTemplate({
      kind: 'warning',
      displayName,
      username,
      email,
      reason: 'Repeated unsolicited messages flagged by safety filters.',
      ruleBroken: 'spam',
      strikeCount: 1,
    }),
    restricted: buildModerationTemplate({
      kind: 'restricted',
      displayName,
      username,
      email,
      reason: 'Abusive language in direct messages (2nd strike).',
      ruleBroken: 'harassment',
      strikeCount: 2,
      banUntil: new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString(),
    }),
    suspend: buildModerationTemplate({
      kind: 'suspend',
      displayName,
      username,
      email,
      reason: userRow?.ban_reason || 'Continued violations after prior warnings (3rd strike).',
      ruleBroken: userRow?.rule_broken || 'harassment',
      strikeCount: Math.max(3, Number(userRow?.strike_count || 3)),
      banUntil: userRow?.ban_until || new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    }),
    permanent_ban: buildModerationTemplate({
      kind: 'permanent_ban',
      displayName,
      username,
      email,
      reason: userRow?.ban_reason || 'Severe safety policy violation.',
      ruleBroken: userRow?.rule_broken || 'scam',
      strikeCount: Math.max(4, Number(userRow?.strike_count || 4)),
      scheduledDeletionAt: userRow?.scheduled_deletion_at || new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    }),
    restore: buildModerationTemplate({
      kind: 'restore',
      displayName,
      username,
      email,
      reason: 'Your appeal was approved and your account access has been restored.',
      ruleBroken: 'account_restored',
      strikeCount: Math.max(0, Number(userRow?.strike_count || 0)),
    }),
  };

  return res.json({ templates });
});

// Appeal Verification Document Upload (ID / Selfie upload)
app.post('/api/appeals/upload', requireAuth, appealRateLimiter, async (req, res) => {
  try {
    const userId = (req as any).authUserId as string;
    const { base64Data, mimeType, fileName } = req.body || {};
    if (!base64Data || typeof base64Data !== 'string') {
      return res.status(400).json({ error: 'Verification image data is required' });
    }
    const cleanBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
    const buf = Buffer.from(cleanBase64, 'base64');
    if (buf.length === 0 || buf.length > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'Verification document must be between 1 byte and 5 MB' });
    }

    const cleanMime = String(mimeType || 'image/jpeg').split(';')[0].trim().toLowerCase();
    const ext = cleanMime.includes('png') ? 'png' : cleanMime.includes('webp') ? 'webp' : cleanMime.includes('pdf') ? 'pdf' : 'jpg';
    const fileId = `appeal_${userId.slice(0, 8)}_${Date.now()}.${ext}`;
    const filePath = path.join(UPLOADS_DIR, fileId);
    fs.writeFileSync(filePath, buf);

    mediaFilesStore.set(fileId, {
      id: fileId,
      buffer: buf,
      mimeType: cleanMime,
      fileName: fileName || fileId,
      size: buf.length,
      createdAt: new Date().toISOString(),
    });

    return res.json({
      success: true,
      url: `/api/media/file/${fileId}`,
      fileName: fileName || fileId,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to upload verification document' });
  }
});

// Submit Appeal (Rate-limited, creates Pending appeal with 48h SLA)
app.post('/api/appeals', requireAuth, appealRateLimiter, async (req, res) => {
  try {
    const userId = (req as any).authUserId as string;
    const { reason, verificationDocUrl, verificationDocName } = req.body || {};

    const cleanReason = String(reason || '').trim();
    if (cleanReason.length < 10) {
      return res.status(400).json({ error: 'Please explain your appeal in at least 10 characters.' });
    }

    const existingPending = db
      .prepare("SELECT id FROM appeals WHERE user_id = ? AND status = 'pending' LIMIT 1")
      .get(userId);
    if (existingPending) {
      return res.status(409).json({
        error: 'You already have a pending appeal under review. Please wait for a decision.',
      });
    }

    const activeBan = db
      .prepare('SELECT id FROM bans WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1')
      .get(userId) as { id?: string } | undefined;

    const nowIso = new Date().toISOString();
    const decisionDueAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
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
      cleanReason.slice(0, 2000),
      verificationDocUrl || null,
      verificationDocName || null,
      decisionDueAt,
      nowIso,
      nowIso
    );

    writeAuditLog({
      adminId: userId,
      targetUserId: userId,
      action: 'appeal_submitted',
      reason: cleanReason.slice(0, 300),
      details: { appealId, hasDoc: Boolean(verificationDocUrl) },
    });

    const userRow = findUserById(userId);
    const prof = getProfileById(userId);
    if (userRow?.email) {
      const tpl = buildModerationTemplate({
        kind: 'appeal_update',
        displayName: prof?.display_name || userRow.email.split('@')[0],
        username: prof?.username || 'user',
        email: userRow.email,
        reason: 'We received your review request. Our Trust & Safety team will review it within 48 hours.',
        ruleBroken: userRow.rule_broken || 'community_guidelines',
        strikeCount: Number(userRow.strike_count || 0),
      });
      void sendModerationEmail(userRow.email, tpl);
    }

    const appeal = db.prepare('SELECT * FROM appeals WHERE id = ?').get(appealId);
    return res.status(201).json({ success: true, appeal });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to submit appeal' });
  }
});

// Get Current User's Appeals
app.get('/api/appeals/me', requireAuth, (req, res) => {
  try {
    const userId = (req as any).authUserId as string;
    const rows = db
      .prepare('SELECT * FROM appeals WHERE user_id = ? ORDER BY created_at DESC LIMIT 20')
      .all(userId);
    return res.json({ appeals: rows });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to fetch appeals' });
  }
});

// ====================================================================
// DEDICATED ADMIN PANEL ROUTER (/api/admin/*) & APP SAFETY ENDPOINTS
// ====================================================================
app.use(
  '/api/admin',
  createAdminRouter({
    extractBearerToken,
    verifyAuthToken,
    verifyFirebaseClaims,
    onStatusUpdated: syncProfileCacheAfterModeration,
    invalidateTokenCachesForUser,
  })
);

const VALID_USER_REPORT_CATEGORIES = new Set([
  'spam',
  'harassment',
  'hate_speech',
  'nudity_sexual',
  'impersonation',
  'scam_fraud',
  'violence_threats',
  'child_safety',
  'underage',
  'privacy_violation',
  'abusive_calls',
  'other',
]);

const VALID_USER_REPORT_SOURCES = new Set(['profile', 'chat', 'search', 'call', 'family_chat', 'family_profile']);

// Public/User App Config (Maintenance mode, banned words, unread warnings, recent announcements)
app.get('/api/app/config', async (req, res) => {
  try {
    const maintenanceMode = getAppSetting('maintenance_mode', 'false') === 'true';
    const maintenanceMessage = getAppSetting(
      'maintenance_message',
      'LiveConnect is currently undergoing scheduled maintenance. Please check back shortly.'
    );
    const uid = (req as any).authUserId as string | undefined;
    const liveRow = (req as any).authUserRow as DbUserRow | undefined;
    const adminRole = liveRow ? resolveEffectiveAdminRole(liveRow) : 'none';

    const words = db
      .prepare('SELECT id, word, match_mode as matchMode, action FROM banned_words ORDER BY word_lower ASC')
      .all();

    let unreadWarnings: any[] = [];
    let recentAnnouncements: any[] = [];
    if (uid) {
      const warnRows = db
        .prepare('SELECT id, reason, rule_broken, created_at FROM user_warnings WHERE user_id = ? AND acknowledged = 0 ORDER BY created_at DESC LIMIT 20')
        .all(uid) as Array<{ id: string; reason: string; rule_broken: string; created_at: string }>;
      const userStrikeCount = Number(liveRow?.strike_count || 0);
      unreadWarnings = warnRows.map((w, idx) => ({
        id: w.id,
        reason: w.reason,
        ruleBroken: w.rule_broken,
        strikeNumber: Math.max(1, userStrikeCount - idx),
        createdAt: w.created_at,
      }));
      recentAnnouncements = db
        .prepare('SELECT id, title, message, created_at as createdAt FROM announcements ORDER BY created_at DESC LIMIT 10')
        .all();
    }

    return res.json({
      maintenanceMode,
      maintenanceMessage,
      isAdminStaff: adminRole !== 'none',
      adminRole,
      forceLoggedOut: Boolean((req as any).forceLoggedOut),
      forceLogout: Boolean((req as any).forceLoggedOut),
      isVerified: Boolean(liveRow?.is_verified),
      unreadWarnings,
      recentAnnouncements,
      unreadAnnouncements: recentAnnouncements,
      officialChatModeratorsEnabled: getAppSetting('official_chat_moderators_enabled', 'false') === 'true',
      bannedWords: words,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to load app config' });
  }
});

// Acknowledge unread warnings in-app
app.post('/api/app/warnings/ack', requireAuth, (req, res) => {
  try {
    const userId = (req as any).authUserId as string;
    const { warningIds } = req.body || {};
    if (Array.isArray(warningIds) && warningIds.length > 0) {
      const cleanIds = warningIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0).slice(0, 50);
      if (cleanIds.length > 0) {
        const placeholders = cleanIds.map(() => '?').join(',');
        db.prepare(`UPDATE user_warnings SET acknowledged = 1 WHERE user_id = ? AND id IN (${placeholders})`).run(
          userId,
          ...cleanIds
        );
      }
    } else {
      db.prepare('UPDATE user_warnings SET acknowledged = 1 WHERE user_id = ?').run(userId);
    }
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to acknowledge warnings' });
  }
});

// Record lightweight activity telemetry from Firebase-mode clients
app.post('/api/app/telemetry', requireAuth, (req, res) => {
  try {
    const userId = (req as any).authUserId as string;
    const { eventType, familyId, callType } = req.body || {};
    const allowed = new Set(['dm_sent', 'family_msg_sent', 'call_created', 'user_active']);
    if (allowed.has(String(eventType))) {
      recordActivityEvent({
        eventType: String(eventType) as any,
        userId,
        familyId: typeof familyId === 'string' ? familyId : null,
        callType: callType === 'video' ? 'video' : callType === 'audio' ? 'audio' : null,
      });
    }
    return res.json({ success: true });
  } catch {
    return res.json({ success: false });
  }
});

// ====================================================================
// OFFICIAL CHAT USER ENDPOINTS (Read-only + per-user hide/clear)
// ====================================================================
app.get('/api/official-chat', requireAuth, (req, res) => {
  try {
    const userId = (req as any).authUserId as string;
    const stateRow = db
      .prepare('SELECT cleared_at, last_read_at FROM official_chat_user_state WHERE user_id = ? LIMIT 1')
      .get(userId) as { cleared_at?: string | null; last_read_at?: string | null } | undefined;

    const deletedRows = db
      .prepare('SELECT message_id FROM official_chat_user_deleted WHERE user_id = ?')
      .all(userId) as Array<{ message_id: string }>;
    const deletedSet = new Set(deletedRows.map((r) => r.message_id));

    const clearedAt = stateRow?.cleared_at || null;
    const lastReadAt = stateRow?.last_read_at || null;
    const clearedMs = clearedAt ? Date.parse(clearedAt) : 0;
    const readMs = Math.max(clearedMs, lastReadAt ? Date.parse(lastReadAt) : 0);

    const allRows = db
      .prepare('SELECT * FROM official_messages WHERE is_deleted = 0 ORDER BY created_at ASC LIMIT 300')
      .all() as any[];

    const visibleMessages = allRows
      .filter((row) => {
        if (deletedSet.has(row.id)) return false;
        if (clearedMs > 0) {
          const msgMs = Date.parse(row.created_at);
          if (!Number.isNaN(msgMs) && msgMs <= clearedMs) return false;
        }
        return true;
      })
      .map((row) => ({
        id: row.id,
        text: row.text || '',
        imageUrl: row.image_url || null,
        senderId: row.sender_id,
        senderRole: row.sender_role || 'super_admin',
        deliveredCount: Number(row.delivered_count || 0),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));

    // If user cleared the whole chat and no newer message has arrived since clearedAt, keep hidden
    const isHidden = Boolean(clearedAt) && visibleMessages.length === 0;
    const unreadCount = visibleMessages.filter((m) => {
      const ms = Date.parse(m.createdAt);
      return !Number.isNaN(ms) ? ms > readMs : true;
    }).length;

    return res.json({
      messages: visibleMessages,
      clearedAt,
      lastReadAt,
      unreadCount,
      isHidden,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to load Official Chat' });
  }
});

app.post('/api/official-chat/read', requireAuth, (req, res) => {
  try {
    const userId = (req as any).authUserId as string;
    const nowIso = new Date().toISOString();
    const existing = db
      .prepare('SELECT cleared_at FROM official_chat_user_state WHERE user_id = ? LIMIT 1')
      .get(userId) as { cleared_at?: string | null } | undefined;

    db.prepare(`
      INSERT INTO official_chat_user_state (user_id, cleared_at, last_read_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        last_read_at = excluded.last_read_at,
        updated_at = excluded.updated_at
    `).run(userId, existing?.cleared_at || null, nowIso, nowIso);

    db.prepare("UPDATE notifications SET is_read = 1 WHERE user_id = ? AND type = 'official_chat'").run(userId);
    return res.json({ success: true, lastReadAt: nowIso });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to mark Official Chat as read' });
  }
});

app.delete('/api/official-chat/messages/:messageId', requireAuth, (req, res) => {
  try {
    const userId = (req as any).authUserId as string;
    const { messageId } = req.params;
    if (!messageId || messageId.length > 128) {
      return res.status(400).json({ error: 'Invalid messageId' });
    }
    const nowIso = new Date().toISOString();
    db.prepare(
      'INSERT OR IGNORE INTO official_chat_user_deleted (user_id, message_id, deleted_at) VALUES (?, ?, ?)'
    ).run(userId, messageId, nowIso);

    return res.json({ success: true, messageId });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to hide message' });
  }
});

app.delete('/api/official-chat', requireAuth, (req, res) => {
  try {
    const userId = (req as any).authUserId as string;
    const nowIso = new Date().toISOString();
    db.prepare(`
      INSERT INTO official_chat_user_state (user_id, cleared_at, last_read_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        cleared_at = excluded.cleared_at,
        last_read_at = excluded.last_read_at,
        updated_at = excluded.updated_at
    `).run(userId, nowIso, nowIso, nowIso);

    db.prepare("UPDATE notifications SET is_read = 1 WHERE user_id = ? AND type = 'official_chat'").run(userId);
    return res.json({ success: true, clearedAt: nowIso });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to clear Official Chat' });
  }
});

// Server-side text check against banned words
app.post('/api/moderation/check-text', requireAuth, (req, res) => {
  try {
    const { text } = req.body || {};
    const matched = findMatchedBannedWords(typeof text === 'string' ? text : '');
    const blocked = matched.some((w) => w.action === 'block');
    return res.json({
      allowed: !blocked,
      blocked,
      matchedWords: matched.map((w) => ({ word: w.word, action: w.action })),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to check text' });
  }
});

// Support Tickets (User Side - Feature 15)
app.get('/api/support/tickets', requireAuth, (req, res) => {
  try {
    const userId = (req as any).authUserId as string;
    const tickets = db
      .prepare('SELECT * FROM support_tickets WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50')
      .all(userId) as any[];

    const enriched = tickets.map((t) => {
      const replies = db
        .prepare('SELECT * FROM support_ticket_replies WHERE ticket_id = ? ORDER BY created_at ASC')
        .all(t.id);
      return { ...t, replies };
    });

    return res.json({ tickets: enriched });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to load support tickets' });
  }
});

app.post('/api/support/tickets', requireAuth, (req, res) => {
  try {
    const userId = (req as any).authUserId as string;
    const userRow = (req as any).authUserRow as DbUserRow | undefined;
    const profile = getProfileById(userId);
    const { category, subject, message } = req.body || {};

    const cleanSubject = typeof subject === 'string' ? subject.trim().slice(0, 140) : '';
    const cleanMessage = typeof message === 'string' ? message.trim().slice(0, 3000) : '';
    if (!cleanSubject || !cleanMessage) {
      return res.status(400).json({ error: 'Subject and message are required.' });
    }

    const ticketId = `tkt_${generateUUID().replace(/-/g, '').slice(0, 18)}`;
    const nowIso = new Date().toISOString();
    const cleanCat = typeof category === 'string' && category.trim() ? category.trim().slice(0, 48) : 'general';

    db.prepare(`
      INSERT INTO support_tickets (id, user_id, user_email, username, display_name, category, subject, message, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
    `).run(
      ticketId,
      userId,
      userRow?.email || null,
      profile?.username || null,
      profile?.display_name || null,
      cleanCat,
      cleanSubject,
      cleanMessage,
      nowIso,
      nowIso
    );

    const ticket = db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(ticketId);
    return res.json({ success: true, ticket: { ...ticket, replies: [] } });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to create support ticket' });
  }
});

app.post('/api/support/tickets/:ticketId/reply', requireAuth, (req, res) => {
  try {
    const userId = (req as any).authUserId as string;
    const { ticketId } = req.params;
    const { message } = req.body || {};
    const cleanMsg = typeof message === 'string' ? message.trim().slice(0, 2000) : '';
    if (!cleanMsg) return res.status(400).json({ error: 'Reply message cannot be empty.' });

    const ticket = db.prepare('SELECT * FROM support_tickets WHERE id = ? AND user_id = ?').get(ticketId, userId) as any;
    if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });

    const profile = getProfileById(userId);
    const nowIso = new Date().toISOString();
    const replyId = `trp_${generateUUID().replace(/-/g, '').slice(0, 18)}`;

    db.prepare(`
      INSERT INTO support_ticket_replies (id, ticket_id, sender_id, sender_role, sender_name, message, created_at)
      VALUES (?, ?, ?, 'user', ?, ?, ?)
    `).run(replyId, ticketId, userId, profile?.display_name || profile?.username || 'You', cleanMsg, nowIso);

    db.prepare("UPDATE support_tickets SET status = 'open', updated_at = ? WHERE id = ?").run(nowIso, ticketId);

    const reply = db.prepare('SELECT * FROM support_ticket_replies WHERE id = ?').get(replyId);
    return res.json({ success: true, reply });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to send reply' });
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
  country?: string,
  deviceId?: string | null
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
      const permanentBlock = findPermanentBanByIdentifier({
        email: userEmail,
        phone: formattedPhone,
        deviceId: deviceId || null,
      });
      if (permanentBlock) {
        const errMsg = `Account creation is permanently blocked because this ${permanentBlock.type} is associated with a permanently disabled account.`;
        truecallerVerifications.set(requestId, {
          requestId,
          status: 'failed',
          error: errMsg,
          createdAt: Date.now(),
        });
        return { success: false, error: errMsg };
      }

      const userId = generateUUID();
      const meta = {
        display_name: displayName || `User ${cleanDigits.slice(-4)}`,
        username: baseUsername,
        avatar_url: avatarUrl || null,
        phone: formattedPhone,
        verified_by: 'truecaller',
      };
      db.prepare(`
        INSERT INTO users (id, email, password_hash, email_confirmed, phone, user_metadata, last_device_id, created_at, updated_at)
        VALUES (?, ?, NULL, 1, ?, ?, ?, ?, ?)
      `).run(userId, userEmail, formattedPhone, JSON.stringify(meta), deviceId || null, nowIso, nowIso);
      userRow = findUserById(userId)!;
    } else {
      userRow = (await resolveLiveUserRow(userRow.id, syncProfileCacheAfterModeration)) || userRow;
      if (userRow.status === 'suspended' || userRow.status === 'disabled') {
        revokeAllSessionsForUser(userRow.id);
        const appealSession = createSessionForUser(userRow.id, 7, 'appeal_only', deviceId || null);
        const errMsg =
          userRow.status === 'disabled'
            ? 'Your account has been permanently disabled.'
            : 'Your account has been suspended.';
        truecallerVerifications.set(requestId, {
          requestId,
          status: 'failed',
          error: errMsg,
          createdAt: Date.now(),
        });
        return {
          success: false,
          banned: true,
          accountStatus: userRow.status,
          banReason: userRow.ban_reason || 'Community Guidelines violation',
          ruleBroken: userRow.rule_broken || 'community_guidelines',
          ruleLabel: formatRuleLabel(userRow.rule_broken),
          banUntil: userRow.ban_until || userRow.banned_until || null,
          bannedUntil: userRow.ban_until || userRow.banned_until || null,
          scheduledDeletionAt: userRow.scheduled_deletion_at || null,
          strikeCount: Number(userRow.strike_count || 0),
          appealSession,
          user: formatAuthUser(userRow),
          error: errMsg,
        };
      }
      if (userRow.status === 'deactivated') {
        db.prepare("UPDATE users SET status = 'active', updated_at = ? WHERE id = ?").run(nowIso, userRow.id);
        userRow = findUserById(userRow.id)!;
      }
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

    const session = createSessionForUser(userRow.id, 30, 'full', deviceId || null);
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
    const deviceId = getRequestDeviceId(req);
    const result = await processTruecallerVerifiedProfile(reqId, cleanDigits, displayName, undefined, 'India', deviceId);
    if (!result.success) {
      return res.status((result as any).banned ? 403 : 500).json(result);
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
    const deviceId = getRequestDeviceId(req);
    const result = await processTruecallerVerifiedProfile(reqId, cleanDigits, displayName, undefined, 'India', deviceId);
    if (!result.success) {
      return res.status((result as any).banned ? 403 : 500).json(result);
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
      users: rows
        .filter((r) => !isTargetUserHidden(r.id))
        .map((r) => ({ id: r.id, is_online: true, last_seen: r.last_seen })),
    });
  } catch {
    return res.json({ users: [] });
  }
});

// ====================================================================
// SOCIAL RELATIONS ENDPOINTS (SQLite Backed)
// ====================================================================

app.post('/api/relations/user-overview', async (req, res) => {
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

    const viewerId = await getOptionalAuthUserId(req);
    const viewerRow = viewerId ? findUserById(viewerId) : null;
    const viewerIsMod = viewerRow?.role === 'admin' || viewerRow?.role === 'moderator';

    if (targetId && viewerId !== targetId && !viewerIsMod && isTargetUserHidden(targetId)) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (viewerId && targetId && viewerId !== targetId && isBlocked(viewerId, targetId)) {
      return res.status(404).json({ error: 'User not found' });
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

    // Exclude any blocked or suspended/disabled/deactivated users from follower/following lists
    const following = followingRows
      .map((r) => r.following_id)
      .filter((id) => !isTargetUserHidden(id) && !isBlocked(targetId, id) && (!viewerId || !isBlocked(viewerId, id)));
    const followers = followerRows
      .map((r) => r.follower_id)
      .filter((id) => !isTargetUserHidden(id) && !isBlocked(targetId, id) && (!viewerId || !isBlocked(viewerId, id)));
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

function handleGetBlockedList(req: express.Request, res: express.Response) {
  try {
    const authUserId = (req as any).authUserId as string;
    const requestedIds = Array.isArray(req.body?.ids) ? (req.body.ids as string[]) : null;

    const rows = db
      .prepare('SELECT blocked_id, created_at FROM blocked_users WHERE blocker_id = ? ORDER BY created_at DESC')
      .all(authUserId) as { blocked_id: string; created_at: string }[];

    const blockedIdsSet = new Set(rows.map((r) => r.blocked_id));
    const filteredRows =
      requestedIds && requestedIds.length > 0
        ? rows.filter((r) => requestedIds.includes(r.blocked_id))
        : rows;

    const blockedUsers = filteredRows
      .map((r) => {
        const prof = getProfileCachedOrDb(r.blocked_id);
        return prof ? { ...prof, blocked_at: r.created_at } : null;
      })
      .filter(Boolean);

    return res.json({
      blockedUsers,
      blockedIds: Array.from(blockedIdsSet),
    });
  } catch {
    return res.status(500).json({ error: 'Failed to fetch blocked users' });
  }
}

app.get('/api/blocks', requireAuth, handleGetBlockedList);
app.post('/api/relations/blocked-profiles', requireAuth, handleGetBlockedList);

app.get('/api/relations/all-counts', (_req, res) => {
  try {
    const rows = db.prepare('SELECT follower_id, following_id FROM follows').all() as {
      follower_id: string;
      following_id: string;
    }[];
    const counts: Record<string, { followers: number; following: number }> = {};
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
    return res.status(500).json({ error: 'Failed to retrieve counts' });
  }
});

app.post('/api/relations/status', (req, res) => {
  try {
    const { userId, targetUserId } = req.body || {};
    if (!userId || !targetUserId) {
      return res.status(400).json({ error: 'userId and targetUserId are required' });
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
        followingCount: 0,
      });
    }

    const isBlockedByMe = Boolean(
      db.prepare('SELECT 1 FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?').get(userId, targetUserId)
    );
    const isBlockedByThem = Boolean(
      db.prepare('SELECT 1 FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?').get(targetUserId, userId)
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
        followingCount: 0,
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
    const peerIds = new Set<string>();
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
          db.prepare('INSERT OR IGNORE INTO conversations (id, type, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
            convId,
            'direct',
            nowIso,
            nowIso
          );
          db.prepare('INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').run(
            convId,
            userId,
            'member',
            nowIso
          );
          db.prepare('INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').run(
            convId,
            peerId,
            'member',
            nowIso
          );
        }
      }
    }
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: 'Failed to sync relations' });
  }
});

app.post('/api/relations/follow', requireNotBlocked((req) => req.body?.targetUserId), (req, res) => {
  try {
    const { userId, targetUserId, userMeta, targetMeta } = req.body || {};
    if (!userId || !targetUserId) {
      return res.status(400).json({ error: 'userId and targetUserId are required' });
    }
    if (userId === targetUserId) {
      return res.status(400).json({ error: 'You cannot follow yourself' });
    }
    if (isTargetUserHidden(targetUserId) || isTargetUserHidden(userId)) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (isBlocked(userId, targetUserId)) {
      return res.status(403).json({ error: 'Cannot follow a blocked user' });
    }

    if (userMeta) ensureProfileRecord(userId, userMeta);
    if (targetMeta) ensureProfileRecord(targetUserId, targetMeta);

    const nowIso = new Date().toISOString();
    db.prepare(
      'INSERT OR IGNORE INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)'
    ).run(userId, targetUserId, nowIso);

    const wasFollowedByTarget = isFollowing(targetUserId, userId);
    const isMutualNow = wasFollowedByTarget;

    let autoConvId: string | null = null;
    let autoConv: any = null;

    if (isMutualNow) {
      autoConvId = getDeterministicDirectConvId(userId, targetUserId);
      db.prepare('DELETE FROM deleted_conversations WHERE conversation_id = ?').run(autoConvId);
      db.prepare(
        'INSERT OR IGNORE INTO conversations (id, type, created_at, updated_at) VALUES (?, ?, ?, ?)'
      ).run(autoConvId, 'direct', nowIso, nowIso);
      db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(nowIso, autoConvId);
      db.prepare(
        'INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)'
      ).run(autoConvId, userId, 'member', nowIso);
      db.prepare(
        'INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)'
      ).run(autoConvId, targetUserId, 'member', nowIso);
      autoConv = buildConversationObject(autoConvId, userId);
    }

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
      conversationId: autoConvId,
      conversation: autoConv,
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

function handleBlockUser(req: express.Request, res: express.Response) {
  try {
    const authUserId = (req as any).authUserId as string;
    const requestedUserId = req.body?.userId ? String(req.body.userId) : authUserId;
    if (requestedUserId !== authUserId) {
      return res.status(403).json({ error: 'Cannot block users on behalf of another account' });
    }

    const targetUserId = String(req.body?.targetUserId || req.body?.blockedId || '').trim();
    if (!targetUserId) {
      return res.status(400).json({ error: 'targetUserId is required' });
    }
    if (authUserId === targetUserId) {
      return res.status(400).json({ error: 'You cannot block yourself' });
    }

    const nowIso = new Date().toISOString();
    db.exec('BEGIN');
    try {
      // Idempotent insert: composite primary key (blocker_id, blocked_id) prevents duplicates
      db.prepare(
        'INSERT OR IGNORE INTO blocked_users (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)'
      ).run(authUserId, targetUserId, nowIso);

      // Remove existing follows/connections in BOTH directions
      db.prepare(
        'DELETE FROM follows WHERE (follower_id = ? AND following_id = ?) OR (follower_id = ? AND following_id = ?)'
      ).run(authUserId, targetUserId, targetUserId, authUserId);

      db.exec('COMMIT');
    } catch (txErr) {
      db.exec('ROLLBACK');
      throw txErr;
    }

    // Note: Blocked user receives ZERO notifications or emails about the block.
    return res.json({
      success: true,
      isBlockedByMe: true,
      isBlocked: true,
      isFollowing: false,
      isFollowedBy: false,
      isMutual: false,
      followersCount: 0,
      followingCount: 0,
    });
  } catch {
    return res.status(500).json({ error: 'Failed to block user' });
  }
}

function handleUnblockUser(req: express.Request, res: express.Response) {
  try {
    const authUserId = (req as any).authUserId as string;
    const requestedUserId = req.body?.userId ? String(req.body.userId) : authUserId;
    if (requestedUserId !== authUserId) {
      return res.status(403).json({ error: 'Cannot unblock users on behalf of another account' });
    }

    const targetUserId = String(req.params?.targetUserId || req.body?.targetUserId || req.body?.blockedId || '').trim();
    if (!targetUserId) {
      return res.status(400).json({ error: 'targetUserId is required' });
    }

    // Only delete the block entry; old follow connections are NOT restored
    db.prepare('DELETE FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?').run(authUserId, targetUserId);
    const counts = getFollowCounts(targetUserId);
    return res.json({
      success: true,
      isBlockedByMe: false,
      isBlocked: isBlocked(authUserId, targetUserId),
      isFollowing: false,
      isFollowedBy: false,
      isMutual: false,
      followersCount: counts.followersCount,
      followingCount: counts.followingCount,
    });
  } catch {
    return res.status(500).json({ error: 'Failed to unblock user' });
  }
}

app.post('/api/blocks', requireAuth, blockRateLimiter, handleBlockUser);
app.delete('/api/blocks/:targetUserId', requireAuth, blockRateLimiter, handleUnblockUser);
app.post('/api/relations/block', requireAuth, blockRateLimiter, handleBlockUser);
app.post('/api/relations/unblock', requireAuth, blockRateLimiter, handleUnblockUser);

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
      userAFollowsUserB: !blocked && isFollowing(userA, userB),
      userBFollowsUserA: !blocked && isFollowing(userB, userA),
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

    const notifications = rows
      .filter((r) => {
        const isModerationNotif = String(r.type || '').startsWith('account_') || r.type === 'appeal_update';
        if (isModerationNotif) return true;
        if (r.actor_id && (isBlocked(userId, r.actor_id) || isTargetUserHidden(r.actor_id))) return false;
        return true;
      })
      .map((r) => {
        let actor = null;
        if (r.actor_json) {
          try { actor = JSON.parse(r.actor_json); } catch {}
        }
        if (!actor && r.actor_id && r.actor_id !== 'system_moderation') actor = getProfileCachedOrDb(r.actor_id);
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
    if (isBlocked(userId, actorId)) {
      return res.status(403).json({ error: 'Cannot notify a blocked user' });
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

    if (isTargetUserHidden(call.caller_id) || isTargetUserHidden(call.callee_id)) {
      return res.status(403).json({ error: 'Account unavailable for calls' });
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
    recordActivityEvent({
      eventType: 'call_created',
      userId: call.caller_id,
      callType: call.call_type === 'video' ? 'video' : 'audio',
    });

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
      .filter((r) => !isBlocked(userId, r.caller_id) && !isTargetUserHidden(r.caller_id))
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

    if (isTargetUserHidden(userId) || isTargetUserHidden(targetUserId)) {
      return res.status(404).json({ error: 'User not found' });
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

    db.prepare(
      'INSERT OR IGNORE INTO conversations (id, type, created_at, updated_at) VALUES (?, ?, ?, ?)'
    ).run(convId, 'direct', nowIso, nowIso);

    db.prepare(
      'INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)'
    ).run(convId, userId, 'member', nowIso);

    if (userId !== targetUserId) {
      db.prepare(
        'INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)'
      ).run(convId, targetUserId, 'member', nowIso);
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

    const candidateConvIds = new Set<string>(memberConvRows.map((r) => r.conversation_id));
    const directMap = new Map<string, any>();

    for (const convId of candidateConvIds) {
      const deletedRow = db
        .prepare('SELECT 1 FROM deleted_conversations WHERE conversation_id = ? AND user_id IN (?, ?) LIMIT 1')
        .get(convId, userId, '*');
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
    return res.status(500).json({ error: 'Failed to list conversations' });
  }
});

app.post('/api/users/search', async (req, res) => {
  try {
    const { query = '', userId } = req.body || {};
    const viewerId = (await getOptionalAuthUserId(req)) || (userId ? String(userId) : '');
    const cleanQuery = String(query || '').trim().toLowerCase().replace(/^@/, '');

    let rows: DbProfileRow[];
    if (!cleanQuery) {
      rows = db
        .prepare(
          viewerId
            ? 'SELECT * FROM profiles WHERE id != ? ORDER BY updated_at DESC LIMIT 50'
            : 'SELECT * FROM profiles ORDER BY updated_at DESC LIMIT 50'
        )
        .all(...(viewerId ? [viewerId] : [])) as unknown as DbProfileRow[];
    } else {
      const likePattern = `%${cleanQuery}%`;
      if (viewerId) {
        rows = db
          .prepare(
            `SELECT * FROM profiles
             WHERE id != ? AND (LOWER(username) LIKE ? OR LOWER(display_name) LIKE ? OR LOWER(id) = ?)
             ORDER BY is_online DESC, updated_at DESC LIMIT 50`
          )
          .all(viewerId, likePattern, likePattern, cleanQuery) as unknown as DbProfileRow[];
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

    // Exclude suspended/disabled/deactivated accounts AND blocked accounts from search & suggestions
    const visibleUsers = rows
      .filter((r) => !isTargetUserHidden(r.id))
      .filter((r) => !viewerId || !isBlocked(viewerId, r.id))
      .map(formatProfile)
      .filter(Boolean);

    return res.json({ users: visibleUsers });
  } catch {
    return res.status(500).json({ error: 'Failed to search users' });
  }
});

app.get('/api/users/profile/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const viewerId = (await getOptionalAuthUserId(req)) || String(req.query.viewerId || '');
    const viewerRow = viewerId ? findUserById(viewerId) : null;
    const viewerIsMod = viewerRow?.role === 'admin' || viewerRow?.role === 'moderator';

    if (viewerId !== userId && !viewerIsMod && isTargetUserHidden(userId)) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (viewerId && viewerId !== userId && isBlocked(viewerId, userId)) {
      return res.status(404).json({ error: 'User not found' });
    }

    const profile = getProfileCachedOrDb(userId);
    if (!profile) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json({ profile });
  } catch {
    return res.status(500).json({ error: 'Failed to fetch user profile' });
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

    const row = db
      .prepare('SELECT conversation_id, sender_id, reactions_json FROM messages WHERE id = ?')
      .get(messageId) as any;
    if (!row) return res.json({ success: true });

    if (isTargetUserHidden(userId) || (row.sender_id && isTargetUserHidden(row.sender_id))) {
      return res.status(403).json({ error: 'Interaction paused due to account status' });
    }

    if (row.sender_id && isBlocked(userId, row.sender_id)) {
      return res.status(403).json({ error: 'Cannot interact with blocked user' });
    }
    const memberRows = db
      .prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?')
      .all(row.conversation_id) as { user_id: string }[];
    if (memberRows.some((m) => m.user_id !== userId && isBlocked(userId, m.user_id))) {
      return res.status(403).json({ error: 'Cannot interact with blocked user' });
    }

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

    if (isTargetUserHidden(senderId)) {
      return res.status(403).json({ error: 'Your account cannot send messages while suspended or disabled' });
    }

    const msgText = String(message.content || '');
    const isMediaPlaceholder =
      msgText.startsWith('[IMAGE:') ||
      msgText.startsWith('[VOICE:') ||
      msgText.startsWith('[VIDEO:') ||
      msgText.startsWith('[STICKER:');
    if (!isMediaPlaceholder) {
      const matched = findMatchedBannedWords(msgText).filter((w) => w.action === 'block');
      if (matched.length > 0) {
        return res.status(400).json({ error: 'Message contains a blocked word and could not be sent.' });
      }
    }

    db.prepare('DELETE FROM deleted_conversations WHERE conversation_id = ?').run(convId);

    const existingConv = buildConversationObject(convId, senderId);

    let targetRecipient = recipientId || receiverId;
    if (!targetRecipient && existingConv?.member_ids) {
      targetRecipient = existingConv.member_ids.find((id: string) => id !== senderId);
    }

    if (targetRecipient && targetRecipient !== senderId) {
      if (isTargetUserHidden(targetRecipient)) {
        return res.status(403).json({ error: 'Direct messages to this account are paused' });
      }
      if (isBlocked(senderId, targetRecipient)) {
        return res.status(403).json({ error: 'Cannot message blocked user' });
      }
      if (!isMutualFollow(senderId, targetRecipient)) {
        return res.status(403).json({ error: 'Mutual follow is required to send direct messages' });
      }
    }

    const recProfile = recipientProfile || receiverProfile;
    if (senderProfile?.id) ensureProfileRecord(senderProfile.id, senderProfile);
    if (recProfile?.id) ensureProfileRecord(recProfile.id, recProfile);

    db.prepare(
      'INSERT OR IGNORE INTO conversations (id, type, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(convId, 'direct', null, nowIso, nowIso);
    db.prepare(
      'INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)'
    ).run(convId, senderId, 'member', nowIso);
    if (targetRecipient && targetRecipient !== senderId) {
      db.prepare(
        'INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)'
      ).run(convId, targetRecipient, 'member', nowIso);
    }
    if (existingConv) {
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

    if (targetRecipient && targetRecipient !== senderId) {
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
    recordActivityEvent({ eventType: 'dm_sent', userId: senderId });
    const updatedConv = buildConversationObject(convId, senderId);
    return res.json({ success: true, message: savedMsg || message, conversation: updatedConv });
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

    const allIds = Array.from(new Set([conversationId, ...(Array.isArray(candidateIds) ? candidateIds : [])].filter(Boolean)));

    const placeholders = allIds.map(() => '?').join(',');
    if (userId) {
      const memberRows = db
        .prepare(`SELECT user_id FROM conversation_members WHERE conversation_id IN (${placeholders})`)
        .all(...allIds) as { user_id: string }[];
      if (memberRows.some((m) => m.user_id !== userId && isBlocked(userId, m.user_id))) {
        return res.json({ messages: [], typingUserIds: [] });
      }
    }

    const rows = db
      .prepare(
        `SELECT m.* FROM messages m
         LEFT JOIN deleted_messages dm ON m.id = dm.message_id
         WHERE m.conversation_id IN (${placeholders}) AND dm.message_id IS NULL
         ORDER BY m.created_at ASC LIMIT 250`
      )
      .all(...allIds) as any[];

    const messages = rows
      .filter((r) => !userId || !isBlocked(userId, r.sender_id))
      .map(formatMessageRow)
      .filter(Boolean);

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

// ====================================================================
// MESSAGE TRANSLATION ENDPOINT (All 106+ Languages via Gemini + Auto Key Rotation & Recycling)
// ====================================================================
const translationCache = new Map<string, { translatedText: string; detectedLanguage: string }>();
const TRANSLATION_CACHE_MAX = 1500;

interface GeminiKeySlot {
  index: number;
  label: string;
  apiKey: string;
  client: GoogleGenAI;
  cooldownUntil: number;
  consecutiveFailures: number;
  lastErrorStatus?: number;
}

const RATE_LIMIT_COOLDOWN_MS = 65_000;
const TRANSIENT_COOLDOWN_MS = 20_000;
const AUTH_ERROR_COOLDOWN_MS = 10 * 60_000;

let geminiKeySlots: GeminiKeySlot[] | null = null;
let geminiKeySignature = '';
let activeGeminiKeyCursor = 0;

function extractTokensFromEnvValue(rawVal: string | undefined, target: string[]) {
  if (!rawVal || typeof rawVal !== 'string') return;
  let cleaned = rawVal.trim();
  if (!cleaned) return;

  // Strip surrounding single/double quotes if pasted in Render/dashboard UI
  cleaned = cleaned.replace(/^['"]+|['"]+$/g, '').trim();
  // Strip accidental "ENV_NAME=" prefix if pasted into the value field
  cleaned = cleaned.replace(/^[A-Za-z0-9_ ]+\s*=\s*/, '').trim();
  cleaned = cleaned.replace(/^['"]+|['"]+$/g, '').trim();
  if (!cleaned) return;

  for (const part of cleaned.split(/[\s,;]+/)) {
    const token = part.replace(/^['"]+|['"]+$/g, '').trim();
    if (!token || token.length < 16) continue;
    const lower = token.toLowerCase();
    if (lower.startsWith('your_') || lower.startsWith('replace_') || lower === 'undefined' || lower === 'null') {
      continue;
    }
    target.push(token);
  }
}

function collectGeminiTranslationKeys(): string[] {
  const rawKeys: string[] = [];

  for (let i = 1; i <= 20; i++) {
    extractTokensFromEnvValue(process.env[`GEMINI_API_KEY_${i}`], rawKeys);
    extractTokensFromEnvValue(process.env[`GEMINI_API_KEY${i}`], rawKeys);
    extractTokensFromEnvValue(process.env[`GEMINI_KEY_${i}`], rawKeys);
    extractTokensFromEnvValue(process.env[`GEMINI_KEY${i}`], rawKeys);
    extractTokensFromEnvValue(process.env[`GOOGLE_API_KEY_${i}`], rawKeys);
    extractTokensFromEnvValue(process.env[`GOOGLE_API_KEY${i}`], rawKeys);
    extractTokensFromEnvValue(process.env[`VITE_GEMINI_API_KEY_${i}`], rawKeys);
    extractTokensFromEnvValue(process.env[`VITE_GEMINI_API_KEY${i}`], rawKeys);
  }

  extractTokensFromEnvValue(process.env.GEMINI_API_KEYS, rawKeys);
  extractTokensFromEnvValue(process.env.GEMINI_KEYS, rawKeys);
  extractTokensFromEnvValue(process.env.GEMINI_API_KEY, rawKeys);
  extractTokensFromEnvValue(process.env.GEMINI_KEY, rawKeys);
  extractTokensFromEnvValue(process.env.GOOGLE_API_KEY, rawKeys);
  extractTokensFromEnvValue(process.env.VITE_GEMINI_API_KEY, rawKeys);

  // Fallback scan for any case-insensitive Gemini API key env var added on Render
  for (const [envName, envVal] of Object.entries(process.env)) {
    if (
      /gemini.*key/i.test(envName) &&
      !/firebase|cloudinary|admob|oauth|secret/i.test(envName)
    ) {
      extractTokensFromEnvValue(envVal, rawKeys);
    }
  }

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const key of rawKeys) {
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(key);
    }
  }
  return unique;
}

function getGeminiKeySlots(): GeminiKeySlot[] {
  const keys = collectGeminiTranslationKeys();
  const nextSignature = keys.join('|');

  if (geminiKeySlots && geminiKeySlots.length > 0 && geminiKeySignature === nextSignature) {
    return geminiKeySlots;
  }

  if (keys.length === 0) {
    const err: any = new Error(
      'Translation requires a Gemini API key (GEMINI_API_KEY or GEMINI_API_KEY_1..6) in environment variables.'
    );
    err.statusCode = 503;
    throw err;
  }

  geminiKeySignature = nextSignature;
  geminiKeySlots = keys.map((apiKey, idx) => ({
    index: idx,
    label: `Key#${idx + 1}(...${apiKey.slice(-4)})`,
    apiKey,
    client: new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    }),
    cooldownUntil: 0,
    consecutiveFailures: 0,
  }));
  activeGeminiKeyCursor = 0;
  console.log(`[Translation] Loaded ${geminiKeySlots.length} Gemini API key(s) for auto-rotation.`);

  return geminiKeySlots;
}

function parseRetryDelayMs(err: any): number | null {
  const msg = String(err?.message || '');
  const match = msg.match(/retry\s*(?:in|after|delay)?\s*[:=]?\s*(\d+(?:\.\d+)?)\s*s/i);
  if (match) {
    const secs = parseFloat(match[1]);
    if (Number.isFinite(secs) && secs > 0) {
      return Math.min(10 * 60_000, Math.max(15_000, Math.ceil(secs * 1000) + 1500));
    }
  }
  return null;
}

function classifyGeminiKeyError(err: any): {
  rotatable: boolean;
  isQuota: boolean;
  isAuth: boolean;
  status: number;
  cooldownMs: number;
} {
  const status = Number(err?.statusCode || err?.status || 500);
  const msg = String(err?.message || '');
  const lower = msg.toLowerCase();

  const isQuota =
    status === 429 ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    lower.includes('quota') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests');

  const isAuth =
    status === 401 ||
    status === 403 ||
    msg.includes('API_KEY_INVALID') ||
    msg.includes('PERMISSION_DENIED') ||
    lower.includes('api key not valid') ||
    lower.includes('api_key_expired') ||
    lower.includes('api key expired') ||
    lower.includes('invalid api key') ||
    (status === 400 && lower.includes('api key'));

  const isTransient =
    status === 404 ||
    status === 408 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('NOT_FOUND') ||
    msg.includes('DEADLINE_EXCEEDED') ||
    lower.includes('high demand') ||
    lower.includes('timeout') ||
    lower.includes('econnreset') ||
    lower.includes('enotfound') ||
    lower.includes('etimedout') ||
    lower.includes('fetch failed') ||
    lower.includes('network');

  if (isQuota) {
    return {
      rotatable: true,
      isQuota: true,
      isAuth: false,
      status: 429,
      cooldownMs: parseRetryDelayMs(err) ?? RATE_LIMIT_COOLDOWN_MS,
    };
  }
  if (isAuth) {
    return {
      rotatable: true,
      isQuota: false,
      isAuth: true,
      status,
      cooldownMs: AUTH_ERROR_COOLDOWN_MS,
    };
  }
  if (isTransient) {
    return {
      rotatable: true,
      isQuota: false,
      isAuth: false,
      status,
      cooldownMs: TRANSIENT_COOLDOWN_MS,
    };
  }

  return {
    rotatable: true,
    isQuota: false,
    isAuth: false,
    status,
    cooldownMs: TRANSIENT_COOLDOWN_MS,
  };
}

async function callGeminiTranslateModel(
  client: GoogleGenAI,
  targetDescriptor: string,
  cleanCode: string,
  cleanText: string
) {
  const prompt = `Target language: ${targetDescriptor} (code: ${cleanCode || 'auto'})\n\nMessage:\n${cleanText}`;
  const sysInstr =
    'You are an accurate real-time chat translator supporting all 106+ world languages, Hinglish/romanized text, casual chat slang, and formal speech. Translate the provided chat message naturally into the exact requested target language while preserving emojis, formatting, line breaks, @mentions, and URLs. If the message is already in the target language, return it cleanly as-is. Respond strictly with valid JSON matching the schema.';
  const schema = {
    type: Type.OBJECT,
    properties: {
      translatedText: {
        type: Type.STRING,
        description: 'The translated chat message in the target language.',
      },
      detectedLanguage: {
        type: Type.STRING,
        description: 'The detected source language name in English.',
      },
    },
    required: ['translatedText', 'detectedLanguage'],
  };

  try {
    return await client.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        systemInstruction: sysInstr,
        responseMimeType: 'application/json',
        responseSchema: schema,
      },
    });
  } catch (primaryErr: any) {
    const pStatus = Number(primaryErr?.statusCode || primaryErr?.status || 500);
    const pMsg = String(primaryErr?.message || '');
    const pLower = pMsg.toLowerCase();
    const shouldTryFallbackModel =
      pStatus === 503 ||
      pStatus === 404 ||
      pMsg.includes('UNAVAILABLE') ||
      pMsg.includes('NOT_FOUND') ||
      pLower.includes('high demand') ||
      pLower.includes('model');

    if (!shouldTryFallbackModel) {
      throw primaryErr;
    }

    return await client.models.generateContent({
      model: 'gemini-3.1-flash-lite',
      contents: prompt,
      config: {
        systemInstruction: sysInstr,
        responseMimeType: 'application/json',
        responseSchema: schema,
      },
    });
  }
}

async function generateTranslationWithRotation(
  targetDescriptor: string,
  cleanCode: string,
  cleanText: string
) {
  const slots = getGeminiKeySlots();
  const total = slots.length;
  const now = Date.now();

  // Recycle any keys whose cooldown has finished
  for (const slot of slots) {
    if (slot.cooldownUntil > 0 && slot.cooldownUntil <= now) {
      slot.cooldownUntil = 0;
    }
  }

  // Build candidate order starting from current active cursor, prioritizing ready keys,
  // then cooled-down keys ordered by earliest cooldownUntil (recycled fallback).
  const orderedIndices: number[] = [];
  for (let offset = 0; offset < total; offset++) {
    orderedIndices.push((activeGeminiKeyCursor + offset) % total);
  }
  const readyIndices = orderedIndices.filter((idx) => slots[idx].cooldownUntil <= now);
  const coolingIndices = orderedIndices
    .filter((idx) => slots[idx].cooldownUntil > now)
    .sort((a, b) => slots[a].cooldownUntil - slots[b].cooldownUntil);

  const attemptOrder = readyIndices.length > 0 ? [...readyIndices, ...coolingIndices] : coolingIndices;
  let lastError: any = null;

  for (const idx of attemptOrder) {
    const slot = slots[idx];
    if (readyIndices.length > 0 && slot.cooldownUntil > Date.now()) {
      continue;
    }
    if (readyIndices.length === 0 && slot.cooldownUntil > Date.now()) {
      const waitMs = slot.cooldownUntil - Date.now();
      if (waitMs > 0 && waitMs <= 2500) {
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }

    try {
      const response = await callGeminiTranslateModel(slot.client, targetDescriptor, cleanCode, cleanText);

      // Success: stick to this healthy key and reset its failure counters
      slot.cooldownUntil = 0;
      slot.consecutiveFailures = 0;
      slot.lastErrorStatus = undefined;
      activeGeminiKeyCursor = idx;
      return response;
    } catch (err: any) {
      lastError = err;
      const info = classifyGeminiKeyError(err);

      slot.consecutiveFailures += 1;
      slot.lastErrorStatus = info.status;
      slot.cooldownUntil = Date.now() + info.cooldownMs;
      activeGeminiKeyCursor = (idx + 1) % total;

      console.warn(
        `[Translation Key Rotate] ${slot.label} hit status=${info.status} (quota=${info.isQuota}, auth=${info.isAuth}): ${String(err?.message || '').slice(0, 180)}. Switching to next key & recycling after ${Math.round(info.cooldownMs / 1000)}s.`
      );
    }
  }

  throw lastError || new Error('All Gemini translation API keys are temporarily unavailable.');
}

app.post('/api/messages/translate', requireAuth, async (req, res) => {
  try {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {}
    }

    const { text, targetLangCode, targetLangName, targetNativeName } = body || {};
    const cleanText = typeof text === 'string' ? text.trim() : '';
    const cleanCode = typeof targetLangCode === 'string' ? targetLangCode.trim().slice(0, 24) : '';
    const cleanName = typeof targetLangName === 'string' ? targetLangName.trim().slice(0, 80) : '';
    const cleanNative =
      typeof targetNativeName === 'string' ? targetNativeName.trim().slice(0, 80) : '';

    if (!cleanText) {
      return res.status(400).json({ error: 'Message text is required for translation.' });
    }
    if (cleanText.length > 4000) {
      return res.status(400).json({ error: 'Message is too long to translate (max 4000 characters).' });
    }
    if (!cleanCode && !cleanName) {
      return res.status(400).json({ error: 'Target language is required.' });
    }

    const cacheKey = `${cleanCode.toLowerCase() || cleanName.toLowerCase()}::${cleanText}`;
    const cached = translationCache.get(cacheKey);
    if (cached) {
      return res.json({
        success: true,
        translatedText: cached.translatedText,
        detectedLanguage: cached.detectedLanguage,
        targetLangCode: cleanCode || cleanName,
        cached: true,
      });
    }

    const targetDescriptor = [cleanName || cleanCode, cleanNative && cleanNative !== cleanName ? cleanNative : null]
      .filter(Boolean)
      .join(' / ');

    const response = await generateTranslationWithRotation(targetDescriptor, cleanCode, cleanText);

    const rawJson = (response.text ?? '{}')
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    let parsed: { translatedText?: string; detectedLanguage?: string } = {};
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      parsed = { translatedText: rawJson || cleanText, detectedLanguage: 'Detected' };
    }

    const translatedText =
      typeof parsed.translatedText === 'string' && parsed.translatedText.trim()
        ? parsed.translatedText.trim()
        : cleanText;
    const detectedLanguage =
      typeof parsed.detectedLanguage === 'string' && parsed.detectedLanguage.trim()
        ? parsed.detectedLanguage.trim()
        : 'Auto';

    if (translationCache.size >= TRANSLATION_CACHE_MAX) {
      const oldestKey = translationCache.keys().next().value;
      if (oldestKey !== undefined) translationCache.delete(oldestKey);
    }
    translationCache.set(cacheKey, { translatedText, detectedLanguage });

    return res.json({
      success: true,
      translatedText,
      detectedLanguage,
      targetLangCode: cleanCode || cleanName,
      cached: false,
    });
  } catch (err: any) {
    const status = Number(err?.statusCode || err?.status || 500);
    const msg = String(err?.message || 'Failed to translate message');
    console.warn(`[Translation Error] status=${status} msg=${msg.slice(0, 240)}`);
    if (status === 503) {
      return res.status(503).json({ error: msg });
    }
    if (status === 429 || msg.includes('RESOURCE_EXHAUSTED')) {
      return res.status(429).json({
        error: 'Translation quota limit reached across all configured keys. Please wait a moment and try again.',
      });
    }
    if (status === 400 || status === 401 || status === 403 || msg.includes('PERMISSION_DENIED') || msg.includes('API_KEY_INVALID')) {
      return res.status(502).json({
        error: 'Translation API key rejected by Gemini. Verify the API key values (no extra quotes/spaces) in your environment variables.',
      });
    }
    return res.status(500).json({ error: msg });
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

app.post('/api/conversations/pin', requireAuth, (req, res) => {
  try {
    const authUserId = (req as any).authUserId as string;
    const { conversationId, messageId } = req.body || {};

    if (!conversationId || typeof conversationId !== 'string') {
      return res.status(400).json({ error: 'conversationId is required.' });
    }

    const memberRow = db
      .prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ? LIMIT 1')
      .get(conversationId, authUserId);
    if (!memberRow) {
      return res.status(403).json({ error: 'You are not a member of this conversation.' });
    }

    const cleanMessageId =
      typeof messageId === 'string' && messageId.trim() ? messageId.trim().slice(0, 128) : null;

    if (cleanMessageId) {
      const msgRow = db
        .prepare(
          `SELECT m.id FROM messages m
           LEFT JOIN deleted_messages dm ON m.id = dm.message_id
           WHERE m.id = ? AND m.conversation_id = ? AND dm.message_id IS NULL
           LIMIT 1`
        )
        .get(cleanMessageId, conversationId);
      if (!msgRow) {
        return res.status(404).json({ error: 'Message not found in this conversation.' });
      }
    }

    const nowIso = new Date().toISOString();
    db.prepare('UPDATE conversations SET pinned_message_id = ?, updated_at = ? WHERE id = ?').run(
      cleanMessageId,
      nowIso,
      conversationId
    );

    return res.json({
      success: true,
      conversationId,
      pinnedMessageId: cleanMessageId,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to update pinned message' });
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
// USER ID / PROFILE SAFETY REPORTS ENDPOINTS (SQLite Backed)
// ====================================================================
app.post('/api/reports/user', requireAuth, (req, res) => {
  try {
    const reporterId = (req as any).authUserId as string;
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
      reportedMessageMediaUrl,
      targetType,
    } = req.body || {};

    const safeTargetType =
      targetType === 'family' || source === 'family_profile'
        ? 'family'
        : cleanTextCheck(reportedMessageId)
          ? 'message'
          : 'user';

    function cleanTextCheck(v: unknown) {
      return typeof v === 'string' && v.trim().length > 0;
    }

    const safeFamilyId = typeof familyId === 'string' && familyId.trim() ? familyId.trim().slice(0, 128) : null;
    const resolvedReportedUserId =
      typeof reportedUserId === 'string' && reportedUserId.trim()
        ? reportedUserId.trim()
        : safeTargetType === 'family' && safeFamilyId
          ? `family:${safeFamilyId}`
          : '';

    if (!resolvedReportedUserId) {
      return res.status(400).json({ error: 'reportedUserId or familyId is required.' });
    }
    if (resolvedReportedUserId === reporterId && safeTargetType !== 'family') {
      return res.status(400).json({ error: 'You cannot report your own account.' });
    }
    if (!category || !VALID_USER_REPORT_CATEGORIES.has(String(category))) {
      return res.status(400).json({ error: 'Please select a valid report category.' });
    }

    const cleanReportedMsgId =
      typeof reportedMessageId === 'string' && reportedMessageId.trim()
        ? reportedMessageId.trim().slice(0, 128)
        : null;

    const existingPending = cleanReportedMsgId
      ? (db
          .prepare(
            `SELECT id, created_at FROM user_reports
             WHERE reporter_id = ? AND reported_user_id = ? AND status IN ('pending', 'under_review')
               AND (reported_message_id = ? OR details LIKE ?)
             LIMIT 1`
          )
          .get(reporterId, resolvedReportedUserId, cleanReportedMsgId, `%[Reported Message ID: ${cleanReportedMsgId}]%`) as
          | { id: string; created_at: string }
          | undefined)
      : safeTargetType === 'family' && safeFamilyId
        ? (db
            .prepare(
              `SELECT id, created_at FROM user_reports
               WHERE reporter_id = ? AND family_id = ? AND target_type = 'family' AND status IN ('pending', 'under_review')
               LIMIT 1`
            )
            .get(reporterId, safeFamilyId) as { id: string; created_at: string } | undefined)
        : (db
            .prepare(
              `SELECT id, created_at FROM user_reports
               WHERE reporter_id = ? AND reported_user_id = ? AND status IN ('pending', 'under_review')
               LIMIT 1`
            )
            .get(reporterId, resolvedReportedUserId) as { id: string; created_at: string } | undefined);

    if (existingPending && (!clientReportId || existingPending.id !== clientReportId)) {
      return res.status(409).json({
        error: cleanReportedMsgId
          ? 'You have already reported this message. Our safety team is reviewing it.'
          : safeTargetType === 'family'
            ? 'You already have an open report for this Family. Our safety team is reviewing it.'
            : 'You already have an open report for this user. Our safety team is reviewing it.',
        reportId: existingPending.id,
        duplicate: true,
      });
    }

    const safeReportId =
      typeof clientReportId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(clientReportId)
        ? clientReportId
        : `urep_${generateUUID().replace(/-/g, '').slice(0, 20)}`;

    const safeSource = VALID_USER_REPORT_SOURCES.has(String(source)) ? String(source) : 'profile';
    const safeDetails = details ? String(details).trim().slice(0, 1000) : null;
    const safeUsername = reportedUsername ? String(reportedUsername).trim().slice(0, 32) : null;
    const safeDisplayName = reportedDisplayName ? String(reportedDisplayName).trim().slice(0, 80) : null;
    const safeConvId = conversationId ? String(conversationId).trim().slice(0, 128) : null;
    const safeFamilyName = typeof familyName === 'string' && familyName.trim() ? familyName.trim().slice(0, 120) : null;
    const safeMsgContent =
      typeof reportedMessageContent === 'string' && reportedMessageContent.trim()
        ? reportedMessageContent.trim().slice(0, 1500)
        : null;
    const safeMsgMediaUrl =
      typeof reportedMessageMediaUrl === 'string' && reportedMessageMediaUrl.trim()
        ? reportedMessageMediaUrl.trim().slice(0, 500)
        : null;
    const nowIso = new Date().toISOString();

    db.prepare(`
      INSERT OR IGNORE INTO user_reports (
        id, reporter_id, reported_user_id, reported_username, reported_display_name,
        category, details, source, conversation_id, family_id, family_name,
        reported_message_id, reported_message_content, reported_message_media_url,
        also_blocked, target_type, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      safeReportId,
      reporterId,
      resolvedReportedUserId,
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
      safeTargetType,
      nowIso,
      nowIso
    );

    // Notify Family Owner & Admins anonymously when a Family message is reported (reporter hidden)
    if (safeSource === 'family_chat' && safeFamilyId) {
      const admins = db
        .prepare("SELECT user_id FROM family_members WHERE family_id = ? AND status = 'active' AND role IN ('owner', 'admin')")
        .all(safeFamilyId) as Array<{ user_id: string }>;
      const targetLabel = safeDisplayName || safeUsername || 'a member';
      for (const adm of admins) {
        if (adm.user_id === reportedUserId) continue;
        db.prepare(`
          INSERT INTO notifications (id, user_id, actor_id, type, title, message, reference_id, is_read, created_at)
          VALUES (?, ?, 'system', 'family_message_report', ?, ?, ?, 0, ?)
        `).run(
          generateUUID(),
          adm.user_id,
          `Message Reported in ${safeFamilyName || 'Family'}`,
          `A member reported a message from ${targetLabel} (${String(category)}).`,
          safeFamilyId,
          nowIso
        );
      }
    }

    return res.json({ success: true, reportId: safeReportId });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to submit user report' });
  }
});

app.use('/api/families', createFamilyRouter(requireAuth));

app.get('/api/reports/my-reports', requireAuth, (req, res) => {
  try {
    const reporterId = (req as any).authUserId as string;
    const rows = db
      .prepare('SELECT * FROM user_reports WHERE reporter_id = ? ORDER BY created_at DESC LIMIT 50')
      .all(reporterId);
    return res.json({ reports: rows });
  } catch {
    return res.status(500).json({ error: 'Failed to load your reports' });
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

  startModerationScheduler(syncProfileCacheAfterModeration);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`LiveConnect server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});

export default app;
