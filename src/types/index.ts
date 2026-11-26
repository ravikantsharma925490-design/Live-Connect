export enum ConnectionState {
  Connected = 'connected',
  Connecting = 'connecting',
  Disconnected = 'disconnected',
  Reconnecting = 'reconnecting',
}

export type CallType = 'audio' | 'video';

export type CallStatus =
  | 'calling'
  | 'ringing'
  | 'accepted'
  | 'rejected'
  | 'connected'
  | 'ended'
  | 'missed'
  | 'cancelled'
  | 'failed';

export type AccountStatus = 'active' | 'restricted' | 'suspended' | 'disabled' | 'deactivated';
export type UserRole = 'user' | 'moderator' | 'admin';
export type AppealStatus = 'pending' | 'approved' | 'rejected';
export type ModerationActionType = 'warn' | 'restrict' | 'suspend' | 'ban' | 'restore' | 'deactivate' | 'auto_restore';

export interface AccountModerationState {
  status: AccountStatus;
  strike_count: number;
  ban_reason?: string | null;
  rule_broken?: string | null;
  ban_until?: string | null;
  restricted_until?: string | null;
  scheduled_deletion_at?: string | null;
  restored_at?: string | null;
  restored_notice_pending?: boolean;
  role?: UserRole;
}

export interface BanHistoryRecord {
  id: string;
  user_id: string;
  admin_id?: string | null;
  action_type: ModerationActionType;
  status_applied: AccountStatus;
  reason: string;
  rule_broken: string;
  severity: 'warning' | 'restriction' | 'suspension' | 'permanent' | 'system';
  strike_number: number;
  duration_days?: number | null;
  ban_until?: string | null;
  scheduled_deletion_at?: string | null;
  is_active: boolean;
  created_at: string;
  admin_username?: string | null;
}

export interface AppealRecord {
  id: string;
  user_id: string;
  ban_id?: string | null;
  reason: string;
  verification_doc_url?: string | null;
  verification_doc_name?: string | null;
  status: AppealStatus;
  admin_id?: string | null;
  admin_note?: string | null;
  decision_due_at: string;
  reviewed_at?: string | null;
  created_at: string;
  updated_at: string;
  user?: {
    id: string;
    username: string;
    display_name: string;
    email?: string;
    avatar_url?: string | null;
    status: AccountStatus;
    strike_count: number;
    ban_reason?: string | null;
    rule_broken?: string | null;
    ban_until?: string | null;
  };
}

export interface AuditLogRecord {
  id: string;
  admin_id: string;
  target_user_id: string;
  action: string;
  reason: string;
  details_json?: string | null;
  created_at: string;
  admin_username?: string | null;
  target_username?: string | null;
}

export interface AuthUser {
  id: string;
  email?: string;
  phone?: string;
  email_confirmed?: boolean;
  user_metadata?: Record<string, any>;
  status?: AccountStatus;
  strike_count?: number;
  ban_reason?: string | null;
  rule_broken?: string | null;
  banned_until?: string | null;
  ban_until?: string | null;
  restricted_until?: string | null;
  scheduled_deletion_at?: string | null;
  restored_at?: string | null;
  restored_notice_pending?: boolean;
  role?: UserRole;
  created_at?: string;
}

export interface AuthSession {
  access_token: string;
  expires_at?: string;
  token_scope?: 'full' | 'appeal_only';
}

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  gender?: string | null;
  country?: string | null;
  email?: string | null;
  phone_number?: string | null;
  cloudinary_public_id?: string | null;
  b2_file_id?: string | null;
  b2_file_name?: string | null;
  status?: AccountStatus;
  strike_count?: number;
  role?: UserRole;
  is_online: boolean;
  last_seen: string;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  type: 'direct';
  pinned_message_id?: string | null;
  pinned_message?: Message | null;
  created_at: string;
  updated_at: string;
  other_member?: Profile;
  last_message?: Message;
  unread_count?: number;
  member_ids?: string[];
  members_meta?: Record<string, Profile>;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  updated_at: string;
  sender?: Profile;
  reads?: MessageRead[];
  is_read?: boolean;
  reply_to_message_id?: string | null;
  reply_to_message?: Message | null;
  reactions?: Record<string, string[]>;
  mentions?: string[];
  is_pinned?: boolean;
}

export interface MessageRead {
  id: string;
  message_id: string;
  user_id: string;
  read_at: string;
  profile?: Profile;
}

export interface Call {
  id: string;
  caller_id: string;
  callee_id: string;
  callerDeviceId?: string;
  calleeDeviceId?: string;
  call_type: CallType;
  status: CallStatus;
  room_name: string;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
  caller?: Profile;
  callee?: Profile;
}

export interface CallParticipant {
  id: string;
  call_id: string;
  user_id: string;
  joined_at: string;
  left_at: string | null;
  profile?: Profile;
}


export type NotificationType =
  | 'follow'
  | 'follow_back'
  | 'message'
  | 'call_audio'
  | 'call_video'
  | 'account_warning'
  | 'account_restricted'
  | 'account_suspended'
  | 'account_disabled'
  | 'account_restored'
  | 'appeal_update';

export interface AppNotification {
  id: string;
  user_id: string;
  actor_id: string;
  type: NotificationType;
  title: string;
  message: string;
  reference_id?: string | null;
  is_read: boolean;
  created_at: string;
  actor?: Profile;
}

export interface FollowRelationship {
  id: string;
  follower_id: string;
  following_id: string;
  created_at: string;
  follower?: Profile;
  following?: Profile;
}

export interface BlockedUser {
  id: string;
  blocker_id: string;
  blocked_id: string;
  created_at: string;
  blocked?: Profile;
}

export type FollowState = 'none' | 'following' | 'mutual';

export interface UserRelationStatus {
  isFollowing: boolean;
  isFollowedBy: boolean;
  isMutual: boolean;
  isBlockedByMe: boolean;
  isBlockedByThem: boolean;
  isBlocked: boolean;
  followersCount: number;
  followingCount: number;
}

export interface ActiveCallState {
  call: Call;
  peer: Profile;
  isCaller: boolean;
  status: CallStatus;
  token?: string;
  serverUrl?: string;
  localAudioEnabled: boolean;
  localVideoEnabled: boolean;
  isFrontCamera: boolean;
  connectedAt?: Date;
  durationSeconds: number;
  networkQuality?: 'excellent' | 'good' | 'poor';
}

export type UserReportCategory =
  | 'spam'
  | 'harassment'
  | 'hate_speech'
  | 'nudity_sexual'
  | 'impersonation'
  | 'scam_fraud'
  | 'violence_threats'
  | 'child_safety'
  | 'underage'
  | 'privacy_violation'
  | 'abusive_calls'
  | 'other';

export type UserReportStatus = 'pending' | 'under_review' | 'resolved' | 'dismissed';

export type UserReportSource = 'profile' | 'chat' | 'search' | 'call';

export interface ReportedMessageContext {
  id: string;
  content: string;
  createdAt?: string;
}

export interface UserReportRecord {
  id: string;
  reporter_id: string;
  reported_user_id: string;
  reported_username?: string | null;
  reported_display_name?: string | null;
  category: UserReportCategory;
  details?: string | null;
  source: UserReportSource;
  conversation_id?: string | null;
  also_blocked?: boolean;
  status: UserReportStatus;
  admin_id?: string | null;
  admin_note?: string | null;
  reviewed_at?: string | null;
  created_at: string;
  updated_at: string;
  reporter?: {
    id: string;
    username: string;
    display_name: string;
    avatar_url?: string | null;
  };
  reported_user?: {
    id: string;
    username: string;
    display_name: string;
    email?: string | null;
    avatar_url?: string | null;
    status?: AccountStatus;
    strike_count?: number;
  };
}


