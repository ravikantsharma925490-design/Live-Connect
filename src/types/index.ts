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
export type AdminRoleType = 'none' | 'super_admin' | 'moderator' | 'support';
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
  admin_role?: AdminRoleType;
  is_verified?: boolean;
  force_logout_after?: string | null;
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
  admin_role?: AdminRoleType;
  is_verified?: boolean;
  force_logout_after?: string | null;
  last_active_at?: string | null;
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
  | 'appeal_update'
  | 'family_invite'
  | 'family_message'
  | 'family_mention'
  | 'family_join_request'
  | 'family_join_approved'
  | 'family_join_rejected'
  | 'family_message_report'
  | 'family_deleted'
  | 'announcement'
  | 'official_chat'
  | 'support_reply';

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

export type UserReportSource = 'profile' | 'chat' | 'search' | 'call' | 'family_chat' | 'family_profile';

export interface ReportedMessageContext {
  id: string;
  content: string;
  createdAt?: string;
  mediaUrl?: string | null;
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
  family_id?: string | null;
  family_name?: string | null;
  reported_message_id?: string | null;
  reported_message_content?: string | null;
  reported_message_media_url?: string | null;
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

// ==========================================
// FAMILY GROUP TYPES
// ==========================================

export type FamilyRole = 'owner' | 'admin' | 'member';
export type FamilyMemberStatus = 'active' | 'pending' | 'removed' | 'left';
export type FamilyMuteDuration = '1h' | '8h' | '1w' | 'always' | 'off';

export interface FamilyPinnedMessage {
  messageId: string;
  content: string;
  senderId: string;
  senderName: string;
  pinnedById: string;
  pinnedByName: string;
  pinnedAt: string;
}

export interface Family {
  id: string;
  name: string;
  photoUrl?: string | null;
  ownerId: string;
  memberCount: number;
  maxMembers: number;
  joinApprovalRequired: boolean;
  onlyAdminsCanSend: boolean;
  inviteCode?: string | null;
  inviteLinkEnabled: boolean;
  pinnedMessages: FamilyPinnedMessage[];
  lastMessageId?: string | null;
  lastMessageText?: string | null;
  lastMessageSenderId?: string | null;
  lastMessageSenderName?: string | null;
  lastMessageAt?: string | null;
  pendingRequestsCount?: number;
  isSuspended?: boolean;
  suspendedReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FamilyMember {
  userId: string;
  familyId: string;
  role: FamilyRole;
  status: FamilyMemberStatus;
  relationTag?: string | null;
  displayName: string;
  username: string;
  avatarUrl?: string | null;
  isOnline?: boolean;
  lastSeen?: string | null;
  joinedAt: string;
  updatedAt: string;
  removedAt?: string | null;
  removedBy?: string | null;
}

export interface FamilyMembership {
  familyId: string;
  userId: string;
  role: FamilyRole;
  status: FamilyMemberStatus;
  relationTag?: string | null;
  mutedUntil?: string | null;
  isMutedAlways: boolean;
  lastReadAt?: string | null;
  clearedAt?: string | null;
  unreadCount: number;
  joinedAt: string;
  updatedAt: string;
  family?: Family;
}

export type FamilyMessageType = 'text' | 'image' | 'voice' | 'sticker' | 'system' | 'safe_checkin';

export interface FamilyMessage {
  id: string;
  familyId: string;
  senderId: string;
  senderName: string;
  senderUsername?: string | null;
  senderAvatar?: string | null;
  senderRole?: FamilyRole;
  senderRelationTag?: string | null;
  type: FamilyMessageType;
  content: string;
  mediaUrl?: string | null;
  mediaType?: 'image' | 'voice' | null;
  cloudinaryPublicId?: string | null;
  b2FileId?: string | null;
  b2FileName?: string | null;
  replyToMessageId?: string | null;
  replyToMessage?: {
    id: string;
    senderId: string;
    senderName: string;
    content: string;
  } | null;
  mentions: string[];
  reactions: Record<string, string[]>;
  isPinned: boolean;
  isDeleted: boolean;
  deletedBy?: string | null;
  deletedByRole?: FamilyRole | null;
  safeCheckInAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FamilyJoinRequest {
  userId: string;
  familyId: string;
  displayName: string;
  username: string;
  avatarUrl?: string | null;
  status: 'pending' | 'approved' | 'rejected';
  inviteCode?: string | null;
  createdAt: string;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
}

export interface FamilyInvite {
  id: string;
  familyId: string;
  familyName: string;
  familyPhotoUrl?: string | null;
  inviterId: string;
  inviterName: string;
  inviteeId: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: string;
  respondedAt?: string | null;
}

export interface OfficialMessage {
  id: string;
  text: string;
  imageUrl?: string | null;
  senderId: string;
  senderEmail?: string | null;
  senderRole: 'super_admin' | 'moderator';
  deliveredCount: number;
  createdAt: string;
  updatedAt: string;
}



