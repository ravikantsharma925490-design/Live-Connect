import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  X,
  Users,
  Crown,
  Shield,
  Camera,
  Edit3,
  Check,
  Copy,
  RefreshCw,
  Link2,
  UserPlus,
  UserCheck,
  UserMinus,
  Trash2,
  LogOut,
  BellOff,
  Bell,
  Eraser,
  Lock,
  ShieldCheck,
  Search,
  Loader2,
  Tag,
  ArrowRightLeft,
  Send,
  RotateCcw,
  CheckCheck,
  Ban,
} from 'lucide-react';
import { DocumentSnapshot } from 'firebase/firestore';
import {
  Conversation,
  Family,
  FamilyJoinRequest,
  FamilyMember,
  FamilyMembership,
  FamilyMuteDuration,
  Profile,
} from '@/src/types';
import {
  FAMILY_LARGE_THRESHOLD,
  FAMILY_MAX_DAILY_INVITES,
  FAMILY_MAX_INVITE_BATCH,
  FAMILY_MAX_MEMBERS,
  FAMILY_MEMBERS_PAGE_SIZE,
  FAMILY_MUTE_OPTIONS,
  FAMILY_RELATION_PRESETS,
  getInviteUrlForCode,
  isFamilyMembershipMuted,
} from '@/src/lib/family/constants';
import {
  allowMemberRejoin,
  clearFamilyChatForSelf,
  deleteFamilyGroup,
  inviteUsersToFamily,
  leaveFamily,
  listFamilyJoinRequests,
  listFamilyMembersPaged,
  manageFamilyInviteLink,
  muteFamily,
  processFamilyJoinRequests,
  removeFamilyMember,
  transferFamilyOwnership,
  updateFamilySettings,
  updateMemberRelationTag,
  updateMemberRole,
} from '@/src/lib/family/familyService';
import { uploadMediaToServer } from '@/src/lib/mediaUpload';
import { UserAvatar } from '../ui/UserAvatar';
import { cn, formatLastSeen } from '@/src/lib/utils';

interface FamilyInfoDrawerModalProps {
  isOpen: boolean;
  family: Family | null;
  membership: FamilyMembership | null;
  currentUser: Profile | null;
  dmConversations: Conversation[];
  onSearchUsers: (queryText: string) => Promise<Profile[]>;
  onShareInviteToDm?: (conversationId: string, inviteText: string) => Promise<void>;
  onClose: () => void;
  onRefresh: () => Promise<void> | void;
  onLeftOrDeleted: () => void;
}

type DrawerSubView = 'main' | 'invite' | 'requests' | 'removed' | 'share-dm' | 'transfer' | 'delete';

export const FamilyInfoDrawerModal: React.FC<FamilyInfoDrawerModalProps> = ({
  isOpen,
  family,
  membership,
  currentUser,
  dmConversations,
  onSearchUsers,
  onShareInviteToDm,
  onClose,
  onRefresh,
  onLeftOrDeleted,
}) => {
  const [subView, setSubView] = useState<DrawerSubView>('main');
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Paged members state (never load all 5,000 at once)
  const [memberSearch, setMemberSearch] = useState('');
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersHasMore, setMembersHasMore] = useState(false);
  const [membersOffset, setMembersOffset] = useState(0);
  const [hidePresence, setHidePresence] = useState(false);
  const membersCursorRef = useRef<DocumentSnapshot | null>(null);

  // Removed members state (for Owner/Admin Allow Rejoin)
  const [removedMembers, setRemovedMembers] = useState<FamilyMember[]>([]);
  const [removedLoading, setRemovedLoading] = useState(false);

  // Join requests
  const [requests, setRequests] = useState<FamilyJoinRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);

  // Invite search (max 10 multi-select)
  const [inviteQuery, setInviteQuery] = useState('');
  const [inviteResults, setInviteResults] = useState<Profile[]>([]);
  const [inviteSearching, setInviteSearching] = useState(false);
  const [selectedInviteIds, setSelectedInviteIds] = useState<string[]>([]);

  // Relation tag editor modal state
  const [editingTagMember, setEditingTagMember] = useState<{
    userId: string;
    displayName: string;
    currentTag: string | null;
  } | null>(null);
  const [tagPreset, setTagPreset] = useState('');
  const [customTagInput, setCustomTagInput] = useState('');

  // Mute picker & clear confirm
  const [showMuteMenu, setShowMuteMenu] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [sharedConvIds, setSharedConvIds] = useState<Record<string, boolean>>({});
  const [transferTarget, setTransferTarget] = useState<FamilyMember | null>(null);

  const photoInputRef = useRef<HTMLInputElement | null>(null);

  const role = membership?.role || 'member';
  const isOwner = role === 'owner';
  const isAdmin = role === 'admin';
  const isPrivileged = isOwner || isAdmin;
  const isMuted = membership ? isFamilyMembershipMuted(membership) : false;

  const flashBanner = (type: 'ok' | 'err', text: string) => {
    setStatusBanner({ type, text });
    window.setTimeout(() => {
      setStatusBanner((prev) => (prev?.text === text ? null : prev));
    }, 3500);
  };

  const loadMembersPage = useCallback(
    async (reset: boolean) => {
      if (!family || !currentUser?.id) return;
      setMembersLoading(true);
      try {
        const res = await listFamilyMembersPaged({
          userId: currentUser.id,
          familyId: family.id,
          memberCount: family.memberCount,
          limitCount: FAMILY_MEMBERS_PAGE_SIZE,
          offset: reset ? 0 : membersOffset,
          cursorDoc: reset ? null : membersCursorRef.current,
          searchQuery: memberSearch,
          status: 'active',
        });
        membersCursorRef.current = res.lastDoc;
        setHidePresence(res.hidePresence);
        setMembersHasMore(res.hasMore);
        if (reset) {
          setMembers(res.members);
          setMembersOffset(res.members.length);
        } else {
          setMembers((prev) => {
            const seen = new Set(prev.map((m) => m.userId));
            return [...prev, ...res.members.filter((m) => !seen.has(m.userId))];
          });
          setMembersOffset((prev) => prev + res.members.length);
        }
      } catch (err: any) {
        flashBanner('err', err?.message || 'Failed to load members.');
      } finally {
        setMembersLoading(false);
      }
    },
    [family?.id, family?.memberCount, currentUser?.id, memberSearch, membersOffset]
  );

  useEffect(() => {
    if (!isOpen || !family) {
      setSubView('main');
      setEditingName(false);
      setShowMuteMenu(false);
      setConfirmLeave(false);
      setConfirmClear(false);
      setEditingTagMember(null);
      return;
    }
    setNameDraft(family.name);
  }, [isOpen, family?.id, family?.name]);

  // Debounced member search + initial page load
  useEffect(() => {
    if (!isOpen || !family || !currentUser?.id) return;
    membersCursorRef.current = null;
    const timer = window.setTimeout(() => {
      void loadMembersPage(true);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [isOpen, family?.id, family?.memberCount, memberSearch, currentUser?.id]);

  // Load requests when entering Requests view
  useEffect(() => {
    if (!isOpen || subView !== 'requests' || !family || !currentUser?.id || !isPrivileged) return;
    setRequestsLoading(true);
    listFamilyJoinRequests(currentUser.id, family.id)
      .then((list) => setRequests(list))
      .catch(() => setRequests([]))
      .finally(() => setRequestsLoading(false));
  }, [isOpen, subView, family?.id, currentUser?.id, isPrivileged]);

  // Load removed members when entering Removed view
  useEffect(() => {
    if (!isOpen || subView !== 'removed' || !family || !currentUser?.id || !isPrivileged) return;
    setRemovedLoading(true);
    listFamilyMembersPaged({
      userId: currentUser.id,
      familyId: family.id,
      memberCount: family.memberCount,
      limitCount: FAMILY_MEMBERS_PAGE_SIZE,
      status: 'removed',
    })
      .then((res) => setRemovedMembers(res.members))
      .catch(() => setRemovedMembers([]))
      .finally(() => setRemovedLoading(false));
  }, [isOpen, subView, family?.id, currentUser?.id, isPrivileged]);

  // Search users to invite
  useEffect(() => {
    if (!isOpen || subView !== 'invite') return;
    const q = inviteQuery.trim();
    if (!q) {
      setInviteResults([]);
      return;
    }
    let cancelled = false;
    setInviteSearching(true);
    const timer = window.setTimeout(() => {
      onSearchUsers(q)
        .then((users) => {
          if (!cancelled) {
            const activeIds = new Set(members.map((m) => m.userId));
            setInviteResults(
              users.filter((u) => u.id !== currentUser?.id && u.status !== 'disabled' && u.status !== 'suspended' && !activeIds.has(u.id))
            );
          }
        })
        .catch(() => {
          if (!cancelled) setInviteResults([]);
        })
        .finally(() => {
          if (!cancelled) setInviteSearching(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isOpen, subView, inviteQuery, onSearchUsers, currentUser?.id, members]);

  if (!isOpen || !family || !membership || !currentUser) return null;

  const inviteUrl = family.inviteLinkEnabled && family.inviteCode ? getInviteUrlForCode(family.inviteCode) : null;

  const handleSaveName = async () => {
    const clean = nameDraft.trim();
    if (!clean || clean === family.name) {
      setEditingName(false);
      return;
    }
    setActionBusy('name');
    try {
      await updateFamilySettings(currentUser, family.id, { name: clean });
      setEditingName(false);
      await onRefresh();
      flashBanner('ok', 'Family name updated.');
    } catch (err: any) {
      flashBanner('err', err?.message || 'Failed to rename Family.');
    } finally {
      setActionBusy(null);
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !isPrivileged) return;
    setUploadingPhoto(true);
    try {
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const url = await uploadMediaToServer(dataUrl, {
        mimeType: file.type || 'image/jpeg',
        fileName: file.name || 'family.jpg',
        mediaType: 'image',
        category: 'chat-photo',
        userId: currentUser.id,
      });
      if (url) {
        await updateFamilySettings(currentUser, family.id, { photoUrl: url });
        await onRefresh();
        flashBanner('ok', 'Family photo updated.');
      }
    } catch (err: any) {
      flashBanner('err', err?.message || 'Failed to update Family photo.');
    } finally {
      setUploadingPhoto(false);
      if (photoInputRef.current) photoInputRef.current.value = '';
    }
  };

  const handleToggleSetting = async (field: 'onlyAdminsCanSend' | 'joinApprovalRequired') => {
    if (!isPrivileged) return;
    setActionBusy(field);
    try {
      await updateFamilySettings(currentUser, family.id, {
        [field]: !family[field],
      });
      await onRefresh();
    } catch (err: any) {
      flashBanner('err', err?.message || 'Could not update setting.');
    } finally {
      setActionBusy(null);
    }
  };

  const handleInviteLinkAction = async (action: 'reset' | 'disable' | 'enable') => {
    if (!isPrivileged) return;
    setActionBusy(`link_${action}`);
    try {
      await manageFamilyInviteLink(currentUser.id, family.id, action);
      await onRefresh();
      flashBanner(
        'ok',
        action === 'reset'
          ? 'Invite link reset. Previous links no longer work.'
          : action === 'disable'
            ? 'Invite link disabled.'
            : 'Invite link enabled.'
      );
    } catch (err: any) {
      flashBanner('err', err?.message || 'Could not update invite link.');
    } finally {
      setActionBusy(null);
    }
  };

  const handleCopyInviteLink = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 1800);
    } catch {}
  };

  const handleSendInvites = async () => {
    if (selectedInviteIds.length === 0) return;
    setActionBusy('send_invites');
    try {
      const res = await inviteUsersToFamily(currentUser, family, selectedInviteIds);
      setSelectedInviteIds([]);
      setInviteQuery('');
      setSubView('main');
      flashBanner(
        'ok',
        res.sentCount > 0
          ? `Sent ${res.sentCount} Family invite${res.sentCount > 1 ? 's' : ''}.`
          : res.skipped[0]?.reason || 'No invites sent.'
      );
    } catch (err: any) {
      flashBanner('err', err?.message || 'Failed to send invites.');
    } finally {
      setActionBusy(null);
    }
  };

  const handleRequestAction = async (
    action: 'approve' | 'reject' | 'approve_all' | 'reject_all',
    userIds?: string[]
  ) => {
    setActionBusy(`req_${action}`);
    try {
      await processFamilyJoinRequests(currentUser, family, action, userIds);
      const updated = await listFamilyJoinRequests(currentUser.id, family.id);
      setRequests(updated);
      await onRefresh();
      await loadMembersPage(true);
      flashBanner('ok', action.startsWith('approve') ? 'Approved.' : 'Rejected.');
    } catch (err: any) {
      flashBanner('err', err?.message || 'Failed to process requests.');
    } finally {
      setActionBusy(null);
    }
  };

  const openTagEditor = (target: { userId: string; displayName: string; currentTag: string | null }) => {
    setEditingTagMember(target);
    const existing = target.currentTag || '';
    if (!existing) {
      setTagPreset('');
      setCustomTagInput('');
    } else if ((FAMILY_RELATION_PRESETS as readonly string[]).includes(existing)) {
      setTagPreset(existing);
      setCustomTagInput('');
    } else {
      setTagPreset('Other');
      setCustomTagInput(existing);
    }
  };

  const handleSaveRelationTag = async () => {
    if (!editingTagMember) return;
    const finalTag = tagPreset === 'Other' ? customTagInput.trim() || null : tagPreset || null;
    setActionBusy('tag');
    try {
      await updateMemberRelationTag(currentUser.id, family.id, editingTagMember.userId, finalTag);
      setEditingTagMember(null);
      await onRefresh();
      await loadMembersPage(true);
      flashBanner('ok', 'Relation tag updated.');
    } catch (err: any) {
      flashBanner('err', err?.message || 'Failed to update relation tag.');
    } finally {
      setActionBusy(null);
    }
  };

  const handleRoleToggle = async (member: FamilyMember) => {
    if (!isOwner || member.userId === currentUser.id) return;
    const nextRole = member.role === 'admin' ? 'member' : 'admin';
    setActionBusy(`role_${member.userId}`);
    try {
      await updateMemberRole(currentUser.id, family.id, member, nextRole);
      await loadMembersPage(true);
      await onRefresh();
      flashBanner('ok', `${member.displayName} is now ${nextRole === 'admin' ? 'an Admin' : 'a Member'}.`);
    } catch (err: any) {
      flashBanner('err', err?.message || 'Could not change role.');
    } finally {
      setActionBusy(null);
    }
  };

  const handleRemoveMember = async (member: FamilyMember) => {
    setActionBusy(`rem_${member.userId}`);
    try {
      await removeFamilyMember(currentUser, family.id, member);
      await loadMembersPage(true);
      await onRefresh();
      flashBanner('ok', `Removed ${member.displayName}.`);
    } catch (err: any) {
      flashBanner('err', err?.message || 'Could not remove member.');
    } finally {
      setActionBusy(null);
    }
  };

  const handleAllowRejoin = async (member: FamilyMember) => {
    setActionBusy(`rejoin_${member.userId}`);
    try {
      await allowMemberRejoin(currentUser.id, family.id, member.userId);
      setRemovedMembers((prev) => prev.filter((m) => m.userId !== member.userId));
      flashBanner('ok', `${member.displayName} can now rejoin.`);
    } catch (err: any) {
      flashBanner('err', err?.message || 'Could not allow rejoin.');
    } finally {
      setActionBusy(null);
    }
  };

  const handleMuteSelect = async (duration: FamilyMuteDuration) => {
    setActionBusy('mute');
    try {
      await muteFamily(currentUser.id, family.id, duration);
      setShowMuteMenu(false);
      await onRefresh();
      flashBanner('ok', duration === 'off' ? 'Family notifications unmuted.' : 'Family muted.');
    } catch (err: any) {
      flashBanner('err', err?.message || 'Could not update mute setting.');
    } finally {
      setActionBusy(null);
    }
  };

  const handleClearChat = async () => {
    setActionBusy('clear');
    try {
      await clearFamilyChatForSelf(currentUser.id, family.id);
      setConfirmClear(false);
      await onRefresh();
      flashBanner('ok', 'Chat cleared for your account.');
    } catch (err: any) {
      flashBanner('err', err?.message || 'Could not clear chat.');
    } finally {
      setActionBusy(null);
    }
  };

  const handleLeave = async () => {
    if (isOwner) {
      setConfirmLeave(false);
      setSubView('transfer');
      return;
    }
    setActionBusy('leave');
    try {
      await leaveFamily(currentUser, family.id);
      setConfirmLeave(false);
      onLeftOrDeleted();
      onClose();
    } catch (err: any) {
      flashBanner('err', err?.message || 'Could not leave Family.');
    } finally {
      setActionBusy(null);
    }
  };

  const handleConfirmTransferOwnership = async () => {
    if (!transferTarget || !isOwner) return;
    setActionBusy('transfer');
    try {
      await transferFamilyOwnership(currentUser, family.id, transferTarget);
      setTransferTarget(null);
      setSubView('main');
      await onRefresh();
      await loadMembersPage(true);
      flashBanner('ok', `Ownership transferred to ${transferTarget.displayName}.`);
    } catch (err: any) {
      flashBanner('err', err?.message || 'Could not transfer ownership.');
    } finally {
      setActionBusy(null);
    }
  };

  const handleConfirmDeleteFamily = async () => {
    if (!isOwner) return;
    setActionBusy('delete');
    try {
      await deleteFamilyGroup(currentUser, family);
      onLeftOrDeleted();
      onClose();
    } catch (err: any) {
      flashBanner('err', err?.message || 'Could not delete Family.');
    } finally {
      setActionBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/65 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-800/40 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            {subView !== 'main' && (
              <button
                type="button"
                onClick={() => setSubView('main')}
                className="px-2.5 py-1 rounded-xl bg-neutral-200/80 dark:bg-neutral-800 text-xs font-bold text-neutral-700 dark:text-neutral-200 hover:bg-neutral-300 dark:hover:bg-neutral-700 cursor-pointer"
              >
                Back
              </button>
            )}
            <h3 className="font-extrabold text-base text-neutral-900 dark:text-neutral-100 truncate">
              {subView === 'invite'
                ? 'Invite Members'
                : subView === 'requests'
                  ? `Join Requests (${family.pendingRequestsCount || requests.length})`
                  : subView === 'removed'
                    ? 'Removed Members'
                    : subView === 'share-dm'
                      ? 'Share Invite via Direct Message'
                      : subView === 'transfer'
                        ? 'Transfer Ownership'
                        : subView === 'delete'
                          ? 'Delete Family'
                          : 'Family Info'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-200/70 dark:hover:bg-neutral-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Status Toast Banner */}
        {statusBanner && (
          <div
            className={cn(
              'mx-5 mt-3 px-3.5 py-2.5 rounded-2xl text-xs font-semibold border shrink-0',
              statusBanner.type === 'ok'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900/60 text-emerald-700 dark:text-emerald-300'
                : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-300'
            )}
          >
            {statusBanner.text}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* SUB-VIEW: INVITE MEMBERS */}
          {subView === 'invite' && (
            <div className="space-y-4">
              <div className="p-3 rounded-2xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200/70 dark:border-blue-900/50 text-[11px] text-blue-700 dark:text-blue-300 flex items-center justify-between gap-2">
                <span>
                  Select up to {FAMILY_MAX_INVITE_BATCH} people at once ({FAMILY_MAX_DAILY_INVITES}/day limit). Direct invites skip Join Approval.
                </span>
                <span className="font-bold shrink-0">
                  {selectedInviteIds.length}/{FAMILY_MAX_INVITE_BATCH}
                </span>
              </div>

              <div className="relative">
                <Search className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={inviteQuery}
                  onChange={(e) => setInviteQuery(e.target.value)}
                  placeholder="Search by username or name..."
                  autoFocus
                  className="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-xs text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
              </div>

              <div className="space-y-1.5 max-h-72 overflow-y-auto">
                {inviteSearching ? (
                  <div className="py-6 flex items-center justify-center text-xs text-neutral-500 gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Searching...</span>
                  </div>
                ) : inviteResults.length === 0 ? (
                  <p className="text-center text-xs text-neutral-500 py-6">
                    {inviteQuery.trim() ? 'No matching users found.' : 'Type a username to search.'}
                  </p>
                ) : (
                  inviteResults.map((u) => {
                    const selected = selectedInviteIds.includes(u.id);
                    const disabledLimit = !selected && selectedInviteIds.length >= FAMILY_MAX_INVITE_BATCH;
                    return (
                      <button
                        key={u.id}
                        type="button"
                        disabled={disabledLimit}
                        onClick={() => {
                          setSelectedInviteIds((prev) =>
                            selected
                              ? prev.filter((id) => id !== u.id)
                              : prev.length < FAMILY_MAX_INVITE_BATCH
                                ? [...prev, u.id]
                                : prev
                          );
                        }}
                        className={cn(
                          'w-full p-2.5 rounded-2xl flex items-center justify-between gap-3 border transition-colors text-left cursor-pointer disabled:opacity-50',
                          selected
                            ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-400'
                            : 'bg-neutral-50 dark:bg-neutral-800/50 border-neutral-200 dark:border-neutral-700/70 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                        )}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <UserAvatar src={u.avatar_url} name={u.display_name} id={u.id} className="w-9 h-9" />
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-neutral-900 dark:text-neutral-100 truncate">
                              {u.display_name}
                            </p>
                            <p className="text-[11px] text-neutral-500 font-mono truncate">@{u.username}</p>
                          </div>
                        </div>
                        <div
                          className={cn(
                            'w-5 h-5 rounded-lg flex items-center justify-center border',
                            selected
                              ? 'bg-blue-600 border-blue-600 text-white'
                              : 'border-neutral-300 dark:border-neutral-600'
                          )}
                        >
                          {selected && <Check className="w-3.5 h-3.5" />}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              <button
                type="button"
                disabled={selectedInviteIds.length === 0 || actionBusy === 'send_invites'}
                onClick={handleSendInvites}
                className="w-full py-2.5 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-md shadow-blue-500/20 disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {actionBusy === 'send_invites' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Send {selectedInviteIds.length || ''} Invite{selectedInviteIds.length === 1 ? '' : 's'}</span>
              </button>
            </div>
          )}

          {/* SUB-VIEW: JOIN REQUESTS */}
          {subView === 'requests' && (
            <div className="space-y-3">
              {requests.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={Boolean(actionBusy)}
                    onClick={() => handleRequestAction('approve_all')}
                    className="py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <CheckCheck className="w-3.5 h-3.5" />
                    <span>Approve All</span>
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(actionBusy)}
                    onClick={() => handleRequestAction('reject_all')}
                    className="py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Reject All</span>
                  </button>
                </div>
              )}

              {requestsLoading ? (
                <div className="py-8 flex justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                </div>
              ) : requests.length === 0 ? (
                <div className="py-10 text-center text-xs text-neutral-500">
                  No pending join requests right now.
                </div>
              ) : (
                <div className="space-y-2">
                  {requests.map((req) => (
                    <div
                      key={req.userId}
                      className="p-3 rounded-2xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700/70 flex items-center justify-between gap-2.5"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <UserAvatar src={req.avatarUrl} name={req.displayName} id={req.userId} className="w-9 h-9" />
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-neutral-900 dark:text-neutral-100 truncate">
                            {req.displayName}
                          </p>
                          <p className="text-[11px] text-neutral-500 font-mono truncate">@{req.username}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          disabled={Boolean(actionBusy)}
                          onClick={() => handleRequestAction('approve', [req.userId])}
                          className="px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold cursor-pointer"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(actionBusy)}
                          onClick={() => handleRequestAction('reject', [req.userId])}
                          className="px-2.5 py-1.5 rounded-xl bg-neutral-200 dark:bg-neutral-700 hover:bg-rose-600 hover:text-white text-neutral-700 dark:text-neutral-200 text-[11px] font-bold cursor-pointer"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* SUB-VIEW: REMOVED MEMBERS (ALLOW REJOIN) */}
          {subView === 'removed' && (
            <div className="space-y-3">
              <p className="text-xs text-neutral-500">
                Removed members cannot rejoin by invite link or invite until allowed by the Owner or an Admin.
              </p>
              {removedLoading ? (
                <div className="py-8 flex justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                </div>
              ) : removedMembers.length === 0 ? (
                <div className="py-10 text-center text-xs text-neutral-500">
                  No removed members.
                </div>
              ) : (
                <div className="space-y-2">
                  {removedMembers.map((m) => (
                    <div
                      key={m.userId}
                      className="p-3 rounded-2xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700/70 flex items-center justify-between gap-2.5"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <UserAvatar src={m.avatarUrl} name={m.displayName} id={m.userId} className="w-9 h-9" />
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-neutral-900 dark:text-neutral-100 truncate">
                            {m.displayName}
                          </p>
                          <p className="text-[11px] text-neutral-500 font-mono truncate">@{m.username}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={actionBusy === `rejoin_${m.userId}`}
                        onClick={() => handleAllowRejoin(m)}
                        className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer shrink-0"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Allow Rejoin</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* SUB-VIEW: SHARE INVITE VIA DM */}
          {subView === 'share-dm' && (
            <div className="space-y-3">
              <p className="text-xs text-neutral-500">
                Only contacts who mutually follow you and are not blocked appear here.
              </p>
              {!inviteUrl ? (
                <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-300">
                  Invite link is currently disabled. Enable it first to share.
                </div>
              ) : dmConversations.length === 0 ? (
                <p className="text-center text-xs text-neutral-500 py-8">
                  No direct conversations available to share with.
                </p>
              ) : (
                <div className="space-y-1.5 max-h-80 overflow-y-auto">
                  {dmConversations.map((conv) => {
                    const peer = conv.other_member;
                    if (!peer) return null;
                    const alreadySent = Boolean(sharedConvIds[conv.id]);
                    return (
                      <div
                        key={conv.id}
                        className="p-2.5 rounded-2xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700/70 flex items-center justify-between gap-2.5"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <UserAvatar src={peer.avatar_url} name={peer.display_name} id={peer.id} className="w-9 h-9" />
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-neutral-900 dark:text-neutral-100 truncate">
                              {peer.display_name}
                            </p>
                            <p className="text-[11px] text-neutral-500 font-mono truncate">@{peer.username}</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={alreadySent || !onShareInviteToDm || actionBusy === `dm_${conv.id}`}
                          onClick={async () => {
                            if (!onShareInviteToDm || !inviteUrl) return;
                            setActionBusy(`dm_${conv.id}`);
                            try {
                              await onShareInviteToDm(
                                conv.id,
                                `Join our Family "${family.name}" on LiveConnect: ${inviteUrl}`
                              );
                              setSharedConvIds((prev) => ({ ...prev, [conv.id]: true }));
                            } catch (err: any) {
                              flashBanner('err', err?.message || 'Could not send invite to chat.');
                            } finally {
                              setActionBusy(null);
                            }
                          }}
                          className={cn(
                            'px-3 py-1.5 rounded-xl text-[11px] font-bold flex items-center gap-1 cursor-pointer shrink-0',
                            alreadySent
                              ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                              : 'bg-blue-600 hover:bg-blue-700 text-white'
                          )}
                        >
                          {alreadySent ? <Check className="w-3 h-3" /> : <Send className="w-3 h-3" />}
                          <span>{alreadySent ? 'Sent' : 'Send'}</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* SUB-VIEW: TRANSFER OWNERSHIP */}
          {subView === 'transfer' && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-xs text-amber-800 dark:text-amber-200">
                Select a member or Admin to become the new Family Owner. You will become an Admin and can then leave if you wish.
              </div>
              {transferTarget ? (
                <div className="p-4 rounded-2xl bg-neutral-50 dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700 space-y-3">
                  <p className="text-xs font-bold text-neutral-900 dark:text-neutral-100">
                    Transfer ownership to {transferTarget.displayName} (@{transferTarget.username})?
                  </p>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setTransferTarget(null)}
                      className="px-3.5 py-2 rounded-xl border border-neutral-300 dark:border-neutral-700 text-xs font-semibold cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={actionBusy === 'transfer'}
                      onClick={handleConfirmTransferOwnership}
                      className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold cursor-pointer"
                    >
                      {actionBusy === 'transfer' ? 'Transferring...' : 'Confirm Transfer'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5 max-h-72 overflow-y-auto">
                  {members
                    .filter((m) => m.userId !== currentUser.id)
                    .map((m) => (
                      <button
                        key={m.userId}
                        type="button"
                        onClick={() => setTransferTarget(m)}
                        className="w-full p-2.5 rounded-2xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700/70 hover:border-amber-500 flex items-center justify-between gap-2.5 text-left cursor-pointer"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <UserAvatar src={m.avatarUrl} name={m.displayName} id={m.userId} className="w-9 h-9" />
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-neutral-900 dark:text-neutral-100 truncate">
                              {m.displayName}
                            </p>
                            <p className="text-[11px] text-neutral-500 font-mono truncate">@{m.username}</p>
                          </div>
                        </div>
                        <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400">Select</span>
                      </button>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* SUB-VIEW: DELETE FAMILY */}
          {subView === 'delete' && (
            <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 space-y-4">
              <div className="space-y-1.5">
                <h4 className="text-sm font-extrabold text-rose-700 dark:text-rose-300">
                  Permanently delete &quot;{family.name}&quot;?
                </h4>
                <p className="text-xs text-rose-700/90 dark:text-rose-300/90 leading-relaxed">
                  All Family messages, pinned items, join requests, and invite links will be permanently lost. All active members will receive a notification that this Family was deleted.
                </p>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSubView('main')}
                  className="px-4 py-2 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={actionBusy === 'delete'}
                  onClick={handleConfirmDeleteFamily}
                  className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer flex items-center gap-1.5"
                >
                  {actionBusy === 'delete' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Delete Family</span>
                </button>
              </div>
            </div>
          )}

          {/* MAIN VIEW */}
          {subView === 'main' && (
            <>
              {/* Identity Banner */}
              <div className="flex flex-col items-center text-center gap-2.5 pb-4 border-b border-neutral-200 dark:border-neutral-800">
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoUpload}
                  className="hidden"
                />
                <div className="relative">
                  <UserAvatar
                    src={family.photoUrl}
                    name={family.name}
                    id={family.id}
                    className="w-20 h-20 rounded-3xl shadow-md"
                  />
                  {isPrivileged && (
                    <button
                      type="button"
                      disabled={uploadingPhoto}
                      onClick={() => photoInputRef.current?.click()}
                      title="Change Family photo"
                      className="absolute -bottom-1 -right-1 p-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-md cursor-pointer"
                    >
                      {uploadingPhoto ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Camera className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                </div>

                {editingName ? (
                  <div className="flex items-center gap-1.5 w-full max-w-xs">
                    <input
                      type="text"
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                      maxLength={80}
                      className="flex-1 px-3 py-1.5 rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 text-sm font-bold text-center"
                    />
                    <button
                      type="button"
                      onClick={handleSaveName}
                      disabled={actionBusy === 'name'}
                      className="p-1.5 rounded-xl bg-blue-600 text-white cursor-pointer"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingName(false);
                        setNameDraft(family.name);
                      }}
                      className="p-1.5 rounded-xl bg-neutral-200 dark:bg-neutral-800 text-neutral-600 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-2">
                    <h2 className="text-lg font-extrabold text-neutral-900 dark:text-neutral-100">
                      {family.name}
                    </h2>
                    {isPrivileged && (
                      <button
                        type="button"
                        onClick={() => setEditingName(true)}
                        title="Rename Family"
                        className="p-1 rounded-lg text-neutral-400 hover:text-blue-600 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-neutral-500">
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-xl bg-neutral-100 dark:bg-neutral-800 font-semibold">
                    <Users className="w-3.5 h-3.5" />
                    {family.memberCount.toLocaleString()} / {FAMILY_MAX_MEMBERS.toLocaleString()} members
                  </span>
                  {isOwner && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 font-bold">
                      <Crown className="w-3 h-3" /> Owner
                    </span>
                  )}
                  {isAdmin && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-xl bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-bold">
                      <Shield className="w-3 h-3" /> Admin
                    </span>
                  )}
                </div>

                {family.memberCount > FAMILY_LARGE_THRESHOLD && (
                  <p className="text-[11px] text-neutral-500 max-w-sm">
                    Large Family ({FAMILY_LARGE_THRESHOLD}+): Online status, last seen, and typing indicators are turned off automatically.
                  </p>
                )}
              </div>

              {/* Owner / Admin Management Controls */}
              {isPrivileged && (
                <div className="space-y-2.5">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">
                    Admin Controls
                  </h4>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setSubView('invite')}
                      className="p-2.5 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                    >
                      <UserPlus className="w-4 h-4" />
                      <span>Invite Members</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSubView('requests')}
                      className="p-2.5 rounded-2xl bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-900 dark:text-neutral-100 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer relative"
                    >
                      <UserCheck className="w-4 h-4 text-emerald-500" />
                      <span>Requests</span>
                      {Boolean(family.pendingRequestsCount && family.pendingRequestsCount > 0) && (
                        <span className="px-1.5 py-0.2 rounded-full bg-red-500 text-white text-[10px] font-bold">
                          {family.pendingRequestsCount}
                        </span>
                      )}
                    </button>
                  </div>

                  {/* Toggles */}
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() => handleToggleSetting('onlyAdminsCanSend')}
                      disabled={actionBusy === 'onlyAdminsCanSend'}
                      className="w-full p-3 rounded-2xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700/70 flex items-center justify-between gap-3 text-left cursor-pointer"
                    >
                      <div className="flex items-start gap-2.5">
                        <Lock className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                        <div>
                          <p className="text-xs font-bold text-neutral-900 dark:text-neutral-100">
                            Only admins can send messages
                          </p>
                          <p className="text-[11px] text-neutral-500">
                            Members can still read, react, report, and update their relation tag.
                          </p>
                        </div>
                      </div>
                      <span
                        className={cn(
                          'w-10 h-6 rounded-full p-0.5 transition-colors shrink-0 flex items-center',
                          family.onlyAdminsCanSend
                            ? 'bg-blue-600 justify-end'
                            : 'bg-neutral-300 dark:bg-neutral-700 justify-start'
                        )}
                      >
                        <span className="w-5 h-5 rounded-full bg-white shadow-xs" />
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleToggleSetting('joinApprovalRequired')}
                      disabled={actionBusy === 'joinApprovalRequired'}
                      className="w-full p-3 rounded-2xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700/70 flex items-center justify-between gap-3 text-left cursor-pointer"
                    >
                      <div className="flex items-start gap-2.5">
                        <ShieldCheck className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                        <div>
                          <p className="text-xs font-bold text-neutral-900 dark:text-neutral-100">
                            Join approval required
                          </p>
                          <p className="text-[11px] text-neutral-500">
                            New link joiners wait for approval (turning OFF keeps pending requests waiting).
                          </p>
                        </div>
                      </div>
                      <span
                        className={cn(
                          'w-10 h-6 rounded-full p-0.5 transition-colors shrink-0 flex items-center',
                          family.joinApprovalRequired
                            ? 'bg-blue-600 justify-end'
                            : 'bg-neutral-300 dark:bg-neutral-700 justify-start'
                        )}
                      >
                        <span className="w-5 h-5 rounded-full bg-white shadow-xs" />
                      </span>
                    </button>
                  </div>

                  {/* Invite Link Panel */}
                  <div className="p-3.5 rounded-2xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700/70 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-1.5">
                        <Link2 className="w-3.5 h-3.5 text-blue-500" />
                        Family Invite Link
                      </span>
                      <button
                        type="button"
                        onClick={() => setSubView('removed')}
                        className="text-[11px] font-semibold text-neutral-500 hover:text-blue-600 cursor-pointer"
                      >
                        Removed Members
                      </button>
                    </div>

                    {inviteUrl ? (
                      <>
                        <div className="px-3 py-2 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-[11px] font-mono text-neutral-600 dark:text-neutral-300 truncate">
                          {inviteUrl}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={handleCopyInviteLink}
                            className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                          >
                            {copiedLink ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                            <span>{copiedLink ? 'Copied' : 'Copy Link'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setSubView('share-dm')}
                            className="px-3 py-1.5 rounded-xl bg-neutral-200 dark:bg-neutral-700 text-neutral-800 dark:text-neutral-100 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                          >
                            <Send className="w-3 h-3" />
                            <span>Share via DM</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleInviteLinkAction('reset')}
                            className="px-3 py-1.5 rounded-xl bg-neutral-200 dark:bg-neutral-700 text-neutral-800 dark:text-neutral-100 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                          >
                            <RefreshCw className="w-3 h-3" />
                            <span>Reset</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleInviteLinkAction('disable')}
                            className="px-3 py-1.5 rounded-xl bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                          >
                            <Ban className="w-3 h-3" />
                            <span>Disable</span>
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-neutral-500">Invite link is disabled.</span>
                        <button
                          type="button"
                          onClick={() => handleInviteLinkAction('enable')}
                          className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold cursor-pointer"
                        >
                          Enable Link
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Personal Preferences */}
              <div className="space-y-2">
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">
                  Your Preferences
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      openTagEditor({
                        userId: currentUser.id,
                        displayName: currentUser.display_name || 'You',
                        currentTag: membership.relationTag || null,
                      })
                    }
                    className="p-2.5 rounded-2xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700/70 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs font-semibold flex items-center gap-2 cursor-pointer"
                  >
                    <Tag className="w-4 h-4 text-indigo-500 shrink-0" />
                    <span className="truncate">
                      {membership.relationTag ? `Tag: ${membership.relationTag}` : 'Set Relation Tag'}
                    </span>
                  </button>

                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowMuteMenu((v) => !v)}
                      className="w-full p-2.5 rounded-2xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700/70 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs font-semibold flex items-center gap-2 cursor-pointer"
                    >
                      {isMuted ? (
                        <BellOff className="w-4 h-4 text-amber-500 shrink-0" />
                      ) : (
                        <Bell className="w-4 h-4 text-emerald-500 shrink-0" />
                      )}
                      <span className="truncate">{isMuted ? 'Muted' : 'Mute Alerts'}</span>
                    </button>
                    {showMuteMenu && (
                      <div className="absolute right-0 mt-1.5 z-20 w-44 p-1.5 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-xl space-y-0.5">
                        {FAMILY_MUTE_OPTIONS.map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => handleMuteSelect(opt.id)}
                            className="w-full px-3 py-1.5 rounded-xl text-left text-xs font-semibold text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
                          >
                            {opt.label}
                          </button>
                        ))}
                        {isMuted && (
                          <button
                            type="button"
                            onClick={() => handleMuteSelect('off')}
                            className="w-full px-3 py-1.5 rounded-xl text-left text-xs font-bold text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 cursor-pointer border-t border-neutral-100 dark:border-neutral-800"
                          >
                            Unmute Notifications
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Inline Relation Tag Editor Modal/Box */}
                {editingTagMember && (
                  <div className="p-3.5 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900/60 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-indigo-900 dark:text-indigo-200">
                        Relation tag for {editingTagMember.displayName}
                      </span>
                      <button
                        type="button"
                        onClick={() => setEditingTagMember(null)}
                        className="text-neutral-400 hover:text-neutral-600 cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {FAMILY_RELATION_PRESETS.map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setTagPreset(tagPreset === preset ? '' : preset)}
                          className={cn(
                            'px-2.5 py-1 rounded-xl text-[11px] font-semibold border cursor-pointer',
                            tagPreset === preset
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border-neutral-200 dark:border-neutral-700'
                          )}
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                    {tagPreset === 'Other' && (
                      <input
                        type="text"
                        value={customTagInput}
                        onChange={(e) => setCustomTagInput(e.target.value)}
                        maxLength={24}
                        placeholder="Custom relation..."
                        className="w-full px-3 py-1.5 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 text-xs"
                      />
                    )}
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setTagPreset('');
                          setCustomTagInput('');
                        }}
                        className="px-2.5 py-1 rounded-xl text-[11px] text-neutral-500 hover:text-neutral-700 cursor-pointer"
                      >
                        Clear Tag
                      </button>
                      <button
                        type="button"
                        disabled={actionBusy === 'tag'}
                        onClick={handleSaveRelationTag}
                        className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Paginated & Searchable Members List */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">
                    Members ({family.memberCount.toLocaleString()})
                  </h4>
                  <span className="text-[10px] text-neutral-400">
                    Loaded in pages of {FAMILY_MEMBERS_PAGE_SIZE}
                  </span>
                </div>

                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    placeholder="Search members by name..."
                    className="w-full pl-9 pr-3 py-2 rounded-2xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-xs text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                </div>

                <div className="space-y-1.5 max-h-72 overflow-y-auto pr-0.5">
                  {members.map((m) => {
                    const isSelfMember = m.userId === currentUser.id;
                    const canChangeTag = isPrivileged || isSelfMember;
                    const canRemoveThisMember =
                      !isSelfMember &&
                      m.role !== 'owner' &&
                      (isOwner || (isAdmin && m.role === 'member'));

                    return (
                      <div
                        key={m.userId}
                        className="p-2.5 rounded-2xl bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200/80 dark:border-neutral-700/60 flex items-center justify-between gap-2"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <UserAvatar
                            src={m.avatarUrl}
                            name={m.displayName}
                            id={m.userId}
                            className="w-9 h-9 shrink-0"
                            showStatus={!hidePresence}
                            isOnline={!hidePresence && Boolean(m.isOnline)}
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-bold text-neutral-900 dark:text-neutral-100 truncate">
                                {m.displayName}
                                {isSelfMember ? ' (You)' : ''}
                              </span>
                              {m.role === 'owner' && (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded-md bg-amber-100 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 text-[10px] font-bold">
                                  <Crown className="w-2.5 h-2.5" /> Owner
                                </span>
                              )}
                              {m.role === 'admin' && (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded-md bg-blue-100 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 text-[10px] font-bold">
                                  <Shield className="w-2.5 h-2.5" /> Admin
                                </span>
                              )}
                              {m.relationTag && (
                                <span className="px-1.5 py-0.2 rounded-md bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 text-[10px] font-semibold">
                                  {m.relationTag}
                                </span>
                              )}
                            </div>
                            <p className="text-[10.5px] text-neutral-500 truncate">
                              @{m.username}
                              {!hidePresence && (
                                <>
                                  {' • '}
                                  {formatLastSeen(m.lastSeen, Boolean(m.isOnline))}
                                </>
                              )}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {canChangeTag && (
                            <button
                              type="button"
                              onClick={() =>
                                openTagEditor({
                                  userId: m.userId,
                                  displayName: m.displayName,
                                  currentTag: m.relationTag || null,
                                })
                              }
                              title="Edit Relation Tag"
                              className="p-1.5 rounded-xl text-neutral-400 hover:text-indigo-500 hover:bg-neutral-200/60 dark:hover:bg-neutral-700/60 cursor-pointer"
                            >
                              <Tag className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {isOwner && !isSelfMember && m.role !== 'owner' && (
                            <button
                              type="button"
                              disabled={actionBusy === `role_${m.userId}`}
                              onClick={() => handleRoleToggle(m)}
                              title={m.role === 'admin' ? 'Remove Admin' : 'Make Admin'}
                              className={cn(
                                'px-2 py-1 rounded-xl text-[10px] font-bold cursor-pointer',
                                m.role === 'admin'
                                  ? 'bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-200'
                                  : 'bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
                              )}
                            >
                              {m.role === 'admin' ? 'Demote' : 'Make Admin'}
                            </button>
                          )}

                          {canRemoveThisMember && (
                            <button
                              type="button"
                              disabled={actionBusy === `rem_${m.userId}`}
                              onClick={() => handleRemoveMember(m)}
                              title="Remove from Family"
                              className="p-1.5 rounded-xl text-neutral-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                            >
                              <UserMinus className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {membersLoading && (
                    <div className="py-4 flex items-center justify-center gap-2 text-xs text-neutral-500">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Loading members...</span>
                    </div>
                  )}

                  {membersHasMore && !membersLoading && (
                    <button
                      type="button"
                      onClick={() => void loadMembersPage(false)}
                      className="w-full py-2 rounded-2xl bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-xs font-bold text-blue-600 dark:text-blue-400 cursor-pointer"
                    >
                      Load more members
                    </button>
                  )}
                </div>
              </div>

              {/* Footer Actions (Clear, Transfer, Leave, Delete) */}
              <div className="pt-3 border-t border-neutral-200 dark:border-neutral-800 space-y-2">
                {confirmClear ? (
                  <div className="p-3 rounded-2xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold">Clear chat for yourself?</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setConfirmClear(false)}
                        className="px-2.5 py-1 rounded-xl border border-neutral-300 dark:border-neutral-700 cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleClearChat}
                        className="px-3 py-1 rounded-xl bg-blue-600 text-white font-bold cursor-pointer"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmClear(true)}
                    className="w-full p-2.5 rounded-2xl bg-neutral-100 dark:bg-neutral-800/80 hover:bg-neutral-200 dark:hover:bg-neutral-800 text-xs font-semibold text-neutral-700 dark:text-neutral-200 flex items-center gap-2 cursor-pointer"
                  >
                    <Eraser className="w-4 h-4 text-neutral-500" />
                    <span>Clear Chat (for me only)</span>
                  </button>
                )}

                {isOwner && (
                  <button
                    type="button"
                    onClick={() => setSubView('transfer')}
                    className="w-full p-2.5 rounded-2xl bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-950/50 text-xs font-bold text-amber-700 dark:text-amber-300 flex items-center gap-2 cursor-pointer"
                  >
                    <ArrowRightLeft className="w-4 h-4" />
                    <span>Transfer Ownership</span>
                  </button>
                )}

                {confirmLeave ? (
                  <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-rose-700 dark:text-rose-300">
                      Leave {family.name}?
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setConfirmLeave(false)}
                        className="px-2.5 py-1 rounded-xl border border-neutral-300 dark:border-neutral-700 cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleLeave}
                        className="px-3 py-1 rounded-xl bg-rose-600 text-white font-bold cursor-pointer"
                      >
                        Leave
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => (isOwner ? setSubView('transfer') : setConfirmLeave(true))}
                    className="w-full p-2.5 rounded-2xl bg-rose-50 dark:bg-rose-950/30 hover:bg-rose-100 dark:hover:bg-rose-950/50 text-xs font-bold text-rose-600 dark:text-rose-400 flex items-center justify-between cursor-pointer"
                  >
                    <span className="flex items-center gap-2">
                      <LogOut className="w-4 h-4" />
                      <span>{isOwner ? 'Leave Family (Transfer Ownership First)' : 'Leave Family'}</span>
                    </span>
                  </button>
                )}

                {isOwner && (
                  <button
                    type="button"
                    onClick={() => setSubView('delete')}
                    className="w-full p-2.5 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Delete Family</span>
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
