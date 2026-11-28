import nodemailer from 'nodemailer';
import dns from 'dns';
import {
  db,
  generateId,
  findUserById,
  getProfileById,
  revokeAllSessionsForUser,
  recordBannedIdentifiers,
  clearBannedIdentifiersForUser,
  deleteAccountCompletely,
  handleOwnerDepartureFromFamilies,
  getAppSetting,
  resolveEffectiveAdminRole,
  DbUserRow,
} from './db';

export type AccountStatus = 'active' | 'restricted' | 'suspended' | 'disabled' | 'deactivated';
export type ModerationAction = 'warn' | 'restrict' | 'suspend' | 'ban' | 'permanent_ban' | 'restore' | 'auto_strike';

export const SERIOUS_VIOLATION_RULES = new Set([
  'child_abuse',
  'terrorism',
  'scam',
  'threats',
]);

export const RULE_LABELS: Record<string, string> = {
  harassment: 'Harassment or Bullying',
  spam: 'Spam & Unsolicited Messaging',
  impersonation: 'Impersonation or Fake Identity',
  hate_speech: 'Hate Speech or Discrimination',
  nudity: 'Nudity or Explicit Content',
  misinformation: 'Harmful Misinformation',
  community_guidelines: 'Community Guidelines Violation',
  child_abuse: 'Child Sexual Exploitation or Abuse (Zero Tolerance)',
  terrorism: 'Terrorism & Violent Extremism (Zero Tolerance)',
  scam: 'Financial Scam or Fraud (Zero Tolerance)',
  threats: 'Credible Threats of Violence (Zero Tolerance)',
};

export function formatRuleLabel(ruleBroken?: string | null): string {
  if (!ruleBroken) return RULE_LABELS.community_guidelines;
  return RULE_LABELS[ruleBroken] || ruleBroken;
}

// Render-safe IPv4 SMTP transporter
export function createModerationTransporter() {
  const targetHost = process.env.SMTP_HOST || 'smtp.gmail.com';
  const targetPort = parseInt(process.env.SMTP_PORT || '587', 10);
  const targetUser = process.env.SMTP_USER || process.env.GMAIL_USER || '';
  const targetPass = process.env.SMTP_PASS || process.env.GMAIL_PASS || '';

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

export interface RenderedModerationTemplate {
  kind: 'warning' | 'restricted' | 'suspend' | 'permanent_ban' | 'restore' | 'appeal_update';
  subject: string;
  notificationTitle: string;
  notificationMessage: string;
  notificationType: string;
  emailHtml: string;
}

export function buildModerationTemplate(params: {
  kind: 'warning' | 'restricted' | 'suspend' | 'permanent_ban' | 'restore' | 'appeal_update';
  displayName: string;
  username: string;
  email: string;
  reason: string;
  ruleBroken: string;
  strikeCount: number;
  banUntil?: string | null;
  scheduledDeletionAt?: string | null;
  appealUrl?: string;
  adminNote?: string | null;
}): RenderedModerationTemplate {
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
    appealUrl = process.env.APP_URL || 'http://localhost:3000/?action=appeal',
    adminNote,
  } = params;

  const ruleTitle = formatRuleLabel(ruleBroken);
  const formattedEndDate = banUntil
    ? new Date(banUntil).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
    : null;
  const formattedDeletionDate = scheduledDeletionAt
    ? new Date(scheduledDeletionAt).toLocaleString('en-US', { dateStyle: 'medium' })
    : null;

  let accent = '#0095F6';
  let badgeLabel = 'Account Notice';
  let headline = 'LiveConnect Account Update';
  let bodyLead = 'We noticed activity on your account that requires your attention.';
  let subject = `Account Update (@${username}) - LiveConnect`;
  let notificationTitle = 'Account Status Update';
  let notificationMessage = reason;
  let notificationType = 'account_warning';
  let ctaLabel = 'Review Account Status';

  if (kind === 'warning') {
    accent = '#D97706';
    badgeLabel = `Strike ${strikeCount} · Warning`;
    headline = 'Community Guidelines Warning';
    bodyLead =
      'Your account received an official warning. Repeated violations can lead to messaging restrictions, temporary suspension, or permanent removal.';
    subject = `Official Warning: LiveConnect (@${username})`;
    notificationTitle = 'Account Warning Issued';
    notificationMessage = `Rule: ${ruleTitle}. Reason: ${reason}. Please review our Community Guidelines.`;
    notificationType = 'account_warning';
  } else if (kind === 'restricted') {
    accent = '#EA580C';
    badgeLabel = `Strike ${strikeCount} · Restricted`;
    headline = 'Account Temporarily Restricted';
    bodyLead =
      'Some features such as sending new direct messages, starting calls, and following new users have been temporarily restricted.';
    subject = `Account Restricted: LiveConnect (@${username})`;
    notificationTitle = 'Account Features Restricted';
    notificationMessage = `Messaging & calling restricted${formattedEndDate ? ` until ${formattedEndDate}` : ''}. Reason: ${reason}`;
    notificationType = 'account_restricted';
  } else if (kind === 'suspend') {
    accent = '#DC2626';
    badgeLabel = `Strike ${strikeCount} · Temporary Suspension`;
    headline = 'Your account has been suspended';
    bodyLead =
      'Your account is temporarily invisible to others and all active sessions have been signed out. Your data has been preserved safely.';
    subject = `Your account has been suspended - LiveConnect (@${username})`;
    notificationTitle = 'Account Suspended';
    notificationMessage = `Suspended${formattedEndDate ? ` until ${formattedEndDate}` : ''}. Rule: ${ruleTitle}. Request a review if you think this is a mistake.`;
    notificationType = 'account_suspended';
    ctaLabel = 'Request Review / Appeal';
  } else if (kind === 'permanent_ban') {
    accent = '#991B1B';
    badgeLabel = 'Permanent Ban · Disabled';
    headline = 'Your account has been permanently disabled';
    bodyLead =
      'Due to repeated or severe violations of our safety policies, your LiveConnect account has been permanently disabled and all active sessions revoked.';
    subject = `Account Permanently Disabled - LiveConnect (@${username})`;
    notificationTitle = 'Account Permanently Disabled';
    notificationMessage = `Rule: ${ruleTitle}. Data scheduled for deletion${formattedDeletionDate ? ` on ${formattedDeletionDate}` : ' in 30 days'} unless an appeal is approved.`;
    notificationType = 'account_disabled';
    ctaLabel = 'Submit Final Appeal';
  } else if (kind === 'restore') {
    accent = '#16A34A';
    badgeLabel = 'Active · Restored';
    headline = 'Your account has been restored';
    bodyLead =
      'Good news — your LiveConnect account is active again. Your profile, followers, and conversation history are visible and ready to use.';
    subject = `Your account has been restored - LiveConnect (@${username})`;
    notificationTitle = 'Your account has been restored';
    notificationMessage = `${reason || 'Your account access has been restored and is now active.'}`;
    notificationType = 'account_restored';
    ctaLabel = 'Open LiveConnect';
  } else {
    accent = '#0095F6';
    badgeLabel = 'Appeal Update';
    headline = 'Update on Your Account Review Request';
    bodyLead = adminNote || reason;
    subject = `Appeal Update - LiveConnect (@${username})`;
    notificationTitle = 'Appeal Review Update';
    notificationMessage = adminNote || reason;
    notificationType = 'appeal_update';
    ctaLabel = 'View Appeal Status';
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
        ${formattedEndDate && (kind === 'suspend' || kind === 'restricted') ? `<div style="margin-top:10px;font-size:12px;color:#0f172a;"><strong>Restriction ends:</strong> ${formattedEndDate}</div>` : ''}
        ${formattedDeletionDate && kind === 'permanent_ban' ? `<div style="margin-top:10px;font-size:12px;color:#991b1b;"><strong>Scheduled data removal:</strong> ${formattedDeletionDate} (unless appeal approved)</div>` : ''}
        ${adminNote ? `<div style="margin-top:10px;font-size:12px;color:#334155;"><strong>Reviewer Note:</strong> ${adminNote}</div>` : ''}
      </div>
      <a href="${appealUrl}" style="display:inline-block;padding:12px 22px;background-color:${kind === 'restore' ? '#0095F6' : accent};color:#ffffff;text-decoration:none;font-size:13px;font-weight:700;border-radius:10px;">${ctaLabel}</a>
      <p style="margin:20px 0 0 0;font-size:12px;color:#94a3b8;">Sent to ${email} · LiveConnect Trust &amp; Safety</p>
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
    emailHtml,
  };
}

export async function sendModerationEmail(toEmail: string, template: RenderedModerationTemplate): Promise<boolean> {
  if (!toEmail || !toEmail.includes('@')) return false;
  const user = process.env.SMTP_USER || process.env.GMAIL_USER;
  const pass = process.env.SMTP_PASS || process.env.GMAIL_PASS;
  if (process.env.DISABLE_SMTP === 'true' || !user || !pass) return false;

  try {
    const transporter = createModerationTransporter();
    await transporter.sendMail({
      from: `"LiveConnect Safety" <${user}>`,
      to: toEmail,
      subject: template.subject,
      html: template.emailHtml,
    });
    return true;
  } catch (err: any) {
    console.warn(`[Moderation Email] Notice skipped for ${toEmail}:`, err?.message || err);
    return false;
  }
}

function insertTargetUserSystemNotification(
  targetUserId: string,
  adminId: string,
  template: RenderedModerationTemplate,
  referenceId?: string
) {
  const nowIso = new Date().toISOString();
  const notifId = `notif_mod_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const systemActor = {
    id: adminId || 'system_safety',
    username: 'liveconnect_safety',
    display_name: 'LiveConnect Safety',
    avatar_url: null,
  };
  db.prepare(`
    INSERT INTO notifications (id, user_id, actor_id, type, title, message, reference_id, actor_json, is_read, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(
    notifId,
    targetUserId,
    adminId || 'system_safety',
    template.notificationType,
    template.notificationTitle,
    template.notificationMessage,
    referenceId || null,
    JSON.stringify(systemActor),
    nowIso
  );
}

export function writeAuditLog(params: {
  adminId: string;
  targetUserId: string;
  action: string;
  reason: string;
  details?: Record<string, any>;
}) {
  db.prepare(
    'INSERT INTO audit_logs (id, admin_id, target_user_id, action, reason, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    generateId(),
    params.adminId,
    params.targetUserId,
    params.action,
    params.reason,
    params.details ? JSON.stringify(params.details) : null,
    new Date().toISOString()
  );
}

export interface ModerationActionResult {
  success: boolean;
  user: DbUserRow;
  banId: string | null;
  statusApplied: AccountStatus;
  strikeCount: number;
  emailSent: boolean;
}

export async function restoreUserAccount(params: {
  targetUserId: string;
  adminId: string;
  reason?: string;
  decrementStrike?: boolean;
  isAuto?: boolean;
  onStatusUpdated?: (userId: string, status: AccountStatus) => void;
}): Promise<ModerationActionResult> {
  const target = findUserById(params.targetUserId);
  if (!target) {
    throw Object.assign(new Error('Target user not found'), { statusCode: 404 });
  }

  const nowIso = new Date().toISOString();
  const nextStrikes = params.decrementStrike
    ? Math.max(0, Number(target.strike_count || 0) - 1)
    : Number(target.strike_count || 0);
  const restoreReason =
    params.reason?.trim() ||
    (params.isAuto
      ? 'Your temporary suspension period has ended and your account is active again.'
      : 'Your account has been reviewed and restored by our moderation team.');

  const banRecordId = generateId();

  db.exec('BEGIN');
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

    db.prepare('UPDATE bans SET is_active = 0 WHERE user_id = ? AND is_active = 1').run(target.id);
    db.prepare(`
      INSERT INTO bans (
        id, user_id, admin_id, action_type, status_applied, reason, rule_broken,
        severity, strike_number, duration_days, ban_until, scheduled_deletion_at, is_active, created_at
      ) VALUES (?, ?, ?, ?, 'active', ?, 'account_restored', 'system', ?, NULL, NULL, NULL, 0, ?)
    `).run(
      banRecordId,
      target.id,
      params.adminId,
      params.isAuto ? 'auto_restore' : 'restore',
      restoreReason,
      nextStrikes,
      nowIso
    );

    clearBannedIdentifiersForUser(target.id);
    writeAuditLog({
      adminId: params.adminId,
      targetUserId: target.id,
      action: params.isAuto ? 'auto_restore' : 'restore',
      reason: restoreReason,
      details: { previousStatus: target.status, strikeCount: nextStrikes, decremented: Boolean(params.decrementStrike) },
    });

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  params.onStatusUpdated?.(target.id, 'active');

  const prof = getProfileById(target.id);
  const template = buildModerationTemplate({
    kind: 'restore',
    displayName: prof?.display_name || target.email.split('@')[0],
    username: prof?.username || target.email.split('@')[0],
    email: target.email,
    reason: restoreReason,
    ruleBroken: 'account_restored',
    strikeCount: nextStrikes,
  });

  // Notify ONLY the restored user (in-app + email), zero notifications to followers
  insertTargetUserSystemNotification(target.id, params.adminId, template, banRecordId);
  const emailSent = await sendModerationEmail(target.email, template);

  return {
    success: true,
    user: findUserById(target.id)!,
    banId: banRecordId,
    statusApplied: 'active',
    strikeCount: nextStrikes,
    emailSent,
  };
}

export async function executeModerationAction(params: {
  adminId: string;
  targetUserId: string;
  action: ModerationAction;
  reason?: string;
  ruleBroken?: string;
  durationDays?: number;
  onStatusUpdated?: (userId: string, status: AccountStatus) => void;
}): Promise<ModerationActionResult> {
  const { adminId, targetUserId, action } = params;

  const target = findUserById(targetUserId);
  if (!target) {
    throw Object.assign(new Error('Target user not found'), { statusCode: 404 });
  }

  if (action === 'restore') {
    return restoreUserAccount({
      targetUserId,
      adminId,
      reason: params.reason,
      decrementStrike: false,
      isAuto: false,
      onStatusUpdated: params.onStatusUpdated,
    });
  }

  // Edge case: Admins cannot moderate/ban Super Admin or Admins
  const targetAdminRole = resolveEffectiveAdminRole(target);
  if (target.role === 'admin' || targetAdminRole === 'super_admin') {
    throw Object.assign(new Error('Admins cannot warn, restrict, suspend, or ban admin accounts.'), {
      statusCode: 403,
    });
  }

  const ruleBroken = (params.ruleBroken || 'community_guidelines').trim();
  const reason = (params.reason || formatRuleLabel(ruleBroken)).trim();
  const currentStrikes = Number(target.strike_count || 0);
  const nextStrikeCount = currentStrikes + 1;
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  const existingWarningsCountRow = db
    .prepare('SELECT COUNT(*) as cnt FROM user_warnings WHERE user_id = ?')
    .get(target.id) as { cnt: number };
  const currentWarningsCount = Number(existingWarningsCountRow?.cnt || 0);
  const warningThreshold = Math.max(1, Number(getAppSetting('warning_threshold', '3')) || 3);
  const warningAutoAction = getAppSetting('warning_auto_action', 'suspend') === 'ban' ? 'ban' : 'suspend';
  const warningSuspendDays = Math.max(1, Number(getAppSetting('warning_suspend_days', '7')) || 7);

  // Determine effective moderation action using Instagram-like Strike System + Configurable Warning Auto-Escalation
  let resolvedAction: 'warn' | 'restrict' | 'suspend' | 'ban';
  let warningAutoEscalated = false;
  if (SERIOUS_VIOLATION_RULES.has(ruleBroken)) {
    resolvedAction = 'ban';
  } else if (action === 'auto_strike') {
    if (nextStrikeCount === 1) resolvedAction = 'warn';
    else if (nextStrikeCount === 2) resolvedAction = 'restrict';
    else if (nextStrikeCount === 3) resolvedAction = 'suspend';
    else resolvedAction = 'ban';
  } else if (action === 'permanent_ban') {
    resolvedAction = 'ban';
  } else if (action === 'warn') {
    if (currentWarningsCount + 1 >= warningThreshold) {
      resolvedAction = warningAutoAction;
      warningAutoEscalated = true;
    } else {
      resolvedAction = 'warn';
    }
  } else {
    resolvedAction = action;
  }

  let statusApplied: AccountStatus = 'active';
  let severity: 'warning' | 'restriction' | 'suspension' | 'permanent' = 'warning';
  let durationDays: number | null = null;
  let banUntil: string | null = null;
  let restrictedUntil: string | null = null;
  let scheduledDeletionAt: string | null = null;
  let templateKind: 'warning' | 'restricted' | 'suspend' | 'permanent_ban' = 'warning';

  if (resolvedAction === 'warn') {
    statusApplied = 'active';
    severity = 'warning';
    templateKind = 'warning';
  } else if (resolvedAction === 'restrict') {
    statusApplied = 'restricted';
    severity = 'restriction';
    durationDays = Math.min(30, Math.max(1, Number(params.durationDays || 2)));
    restrictedUntil = new Date(now + durationDays * 24 * 60 * 60 * 1000).toISOString();
    templateKind = 'restricted';
  } else if (resolvedAction === 'suspend') {
    statusApplied = 'suspended';
    severity = 'suspension';
    const fallbackDays = warningAutoEscalated ? warningSuspendDays : 7;
    durationDays = Math.min(365, Math.max(1, Number(params.durationDays || fallbackDays)));
    banUntil = new Date(now + durationDays * 24 * 60 * 60 * 1000).toISOString();
    templateKind = 'suspend';
  } else {
    statusApplied = 'disabled';
    severity = 'permanent';
    banUntil = '9999-12-31T23:59:59.000Z';
    scheduledDeletionAt = new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();
    templateKind = 'permanent_ban';
  }

  const banId = generateId();
  const prof = getProfileById(target.id);

  db.exec('BEGIN');
  try {
    db.prepare('UPDATE bans SET is_active = 0 WHERE user_id = ? AND is_active = 1').run(target.id);

    if (action === 'warn' || resolvedAction === 'warn') {
      db.prepare(
        'INSERT INTO user_warnings (id, user_id, admin_id, reason, rule_broken, acknowledged, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)'
      ).run(generateId(), target.id, adminId, reason, ruleBroken, nowIso);
    }

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
      warningAutoEscalated ? `${reason} (Auto-escalated after ${warningThreshold} warnings)` : reason,
      ruleBroken,
      severity,
      nextStrikeCount,
      durationDays,
      banUntil || restrictedUntil,
      scheduledDeletionAt,
      statusApplied === 'active' ? 0 : 1,
      nowIso
    );

    if (statusApplied === 'suspended' || statusApplied === 'disabled') {
      revokeAllSessionsForUser(target.id);
      db.prepare('UPDATE profiles SET is_online = 0, last_seen = ?, updated_at = ? WHERE id = ?').run(
        nowIso,
        nowIso,
        target.id
      );
    }

    if (statusApplied === 'disabled') {
      recordBannedIdentifiers(target.id, banId, {
        email: target.email,
        phone: target.phone || prof?.phone_number || null,
        deviceId: target.last_device_id || null,
      });
      handleOwnerDepartureFromFamilies(target.id);
    }

    writeAuditLog({
      adminId,
      targetUserId: target.id,
      action: warningAutoEscalated ? `warn_auto_${resolvedAction}` : resolvedAction,
      reason,
      details: {
        ruleBroken,
        strikeNumber: nextStrikeCount,
        warningCount: action === 'warn' ? currentWarningsCount + 1 : currentWarningsCount,
        warningThreshold,
        warningAutoEscalated,
        statusApplied,
        durationDays,
        banUntil: banUntil || restrictedUntil,
        scheduledDeletionAt,
      },
    });

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  params.onStatusUpdated?.(target.id, statusApplied);

  const template = buildModerationTemplate({
    kind: templateKind,
    displayName: prof?.display_name || target.email.split('@')[0],
    username: prof?.username || target.email.split('@')[0],
    email: target.email,
    reason: warningAutoEscalated ? `${reason} (Reached ${warningThreshold} warnings threshold)` : reason,
    ruleBroken,
    strikeCount: nextStrikeCount,
    banUntil: banUntil || restrictedUntil,
    scheduledDeletionAt,
  });

  insertTargetUserSystemNotification(target.id, adminId, template, banId);
  const emailSent = await sendModerationEmail(target.email, template);

  return {
    success: true,
    user: findUserById(target.id)!,
    banId,
    statusApplied,
    strikeCount: nextStrikeCount,
    emailSent,
  };
}

// Lazy live status check: auto-expires finished temporary suspensions/restrictions synchronously
export async function resolveLiveUserRow(
  userId: string,
  onStatusUpdated?: (userId: string, status: AccountStatus) => void
): Promise<DbUserRow | null> {
  const row = findUserById(userId);
  if (!row) return null;

  const nowMs = Date.now();
  if (row.status === 'suspended' && row.ban_until && new Date(row.ban_until).getTime() <= nowMs) {
    const res = await restoreUserAccount({
      targetUserId: row.id,
      adminId: 'system_scheduler',
      reason: 'Temporary suspension expired automatically.',
      decrementStrike: false,
      isAuto: true,
      onStatusUpdated,
    });
    return res.user;
  }

  if (row.status === 'restricted' && row.restricted_until && new Date(row.restricted_until).getTime() <= nowMs) {
    const res = await restoreUserAccount({
      targetUserId: row.id,
      adminId: 'system_scheduler',
      reason: 'Temporary feature restriction expired automatically.',
      decrementStrike: false,
      isAuto: true,
      onStatusUpdated,
    });
    return res.user;
  }

  return row;
}

// Scheduled background job: auto-restores expired suspensions & purges 30-day permanent bans without approved appeals
export async function runScheduledModerationSweep(
  onStatusUpdated?: (userId: string, status: AccountStatus) => void
) {
  const nowIso = new Date().toISOString();

  // 1. Auto-restore expired suspensions
  const expiredSuspensions = db
    .prepare(
      "SELECT id FROM users WHERE status = 'suspended' AND ban_until IS NOT NULL AND ban_until <= ?"
    )
    .all(nowIso) as { id: string }[];

  for (const row of expiredSuspensions) {
    await restoreUserAccount({
      targetUserId: row.id,
      adminId: 'system_scheduler',
      reason: 'Your temporary suspension period has completed and your account is active again.',
      decrementStrike: false,
      isAuto: true,
      onStatusUpdated,
    }).catch(() => {});
  }

  // 2. Auto-restore expired feature restrictions
  const expiredRestrictions = db
    .prepare(
      "SELECT id FROM users WHERE status = 'restricted' AND restricted_until IS NOT NULL AND restricted_until <= ?"
    )
    .all(nowIso) as { id: string }[];

  for (const row of expiredRestrictions) {
    await restoreUserAccount({
      targetUserId: row.id,
      adminId: 'system_scheduler',
      reason: 'Your temporary restriction period has completed.',
      decrementStrike: false,
      isAuto: true,
      onStatusUpdated,
    }).catch(() => {});
  }

  // 3. Delete data after 30 days for permanent bans if no pending/approved appeal exists
  const expiredPermanentBans = db
    .prepare(
      "SELECT id, email FROM users WHERE status = 'disabled' AND scheduled_deletion_at IS NOT NULL AND scheduled_deletion_at <= ?"
    )
    .all(nowIso) as { id: string; email: string }[];

  for (const row of expiredPermanentBans) {
    const openAppeal = db
      .prepare("SELECT id FROM appeals WHERE user_id = ? AND status IN ('pending', 'approved') LIMIT 1")
      .get(row.id);
    if (openAppeal) continue;

    writeAuditLog({
      adminId: 'system_scheduler',
      targetUserId: row.id,
      action: 'permanent_ban_data_purge',
      reason: '30-day retention period elapsed with no approved appeal; account data deleted while banned identifiers remain blocked.',
    });
    // Preserve banned_identifiers so email/phone/device remain permanently blocked from new account creation
    deleteAccountCompletely(row.id, true);
  }
}

export function startModerationScheduler(onStatusUpdated?: (userId: string, status: AccountStatus) => void) {
  void runScheduledModerationSweep(onStatusUpdated);
  return setInterval(() => {
    void runScheduledModerationSweep(onStatusUpdated);
  }, 60_000);
}
