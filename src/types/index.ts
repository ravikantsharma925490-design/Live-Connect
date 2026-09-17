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

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  gender?: string | null;
  country?: string | null;
  is_online: boolean;
  last_seen: string;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  type: 'direct' | 'group';
  name?: string | null;
  description?: string | null;
  avatar_url?: string | null;
  owner_id?: string | null;
  pinned_message_id?: string | null;
  pinned_message?: Message | null;
  created_at: string;
  updated_at: string;
  other_member?: Profile;
  last_message?: Message;
  unread_count?: number;
  members?: ConversationMember[];
  member_ids?: string[];
  members_meta?: Record<string, Profile>;
}

export interface ConversationMember {
  id: string;
  conversation_id: string;
  user_id: string;
  joined_at: string;
  role?: 'admin' | 'member';
  profile?: Profile;
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
  | 'call_video';

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

