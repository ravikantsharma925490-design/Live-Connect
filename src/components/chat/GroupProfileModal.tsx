import React, { useState, useEffect } from 'react';
import {
  Users,
  X,
  Shield,
  ShieldCheck,
  ShieldAlert,
  UserMinus,
  UserPlus,
  LogOut,
  Trash2,
  Edit3,
  Camera,
  Loader2,
  Check,
  Search,
  AlertCircle,
  Crown,
} from 'lucide-react';
import { Conversation, Profile } from '@/src/types';
import { UserAvatar } from '../ui/UserAvatar';
import { uploadMediaToServer } from '@/src/lib/mediaUpload';
import { recordDeletedConvId } from '@/src/hooks/useConversations';

interface GroupProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  conversation: Conversation | null;
  currentUser: Profile | null;
  onGroupUpdated: (updatedConv?: Conversation) => void;
  onGroupDeleted: () => void;
}

export const GroupProfileModal: React.FC<GroupProfileModalProps> = ({
  isOpen,
  onClose,
  conversation,
  currentUser,
  onGroupUpdated,
  onGroupDeleted,
}) => {
  const [localGroup, setLocalGroup] = useState<Conversation | null>(conversation);
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(conversation?.name || '');
  const [description, setDescription] = useState(conversation?.description || '');
  const [avatarUrl, setAvatarUrl] = useState(conversation?.avatar_url || '');
  const [loading, setLoading] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Member search & add state
  const [memberFilterQuery, setMemberFilterQuery] = useState('');
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [availableUsers, setAvailableUsers] = useState<Profile[]>([]);
  const [selectedNewUsers, setSelectedNewUsers] = useState<string[]>([]);
  const [loadingAvailable, setLoadingAvailable] = useState(false);

  // Confirmation modals
  const [confirmRemoveTarget, setConfirmRemoveTarget] = useState<{ id: string; name: string; username?: string } | null>(null);
  const [confirmRoleTarget, setConfirmRoleTarget] = useState<{ id: string; name: string; targetRole: 'admin' | 'member' } | null>(null);
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState(false);
  const [confirmLeaveGroup, setConfirmLeaveGroup] = useState(false);

  // Sync state whenever conversation prop changes or modal opens
  useEffect(() => {
    if (conversation) {
      setLocalGroup(conversation);
      setName(conversation.name || '');
      setDescription(conversation.description || '');
      setAvatarUrl(conversation.avatar_url || '');
    }
  }, [conversation]);

  // Always fetch fresh authoritative group details on open
  useEffect(() => {
    if (isOpen && conversation?.id) {
      setError(null);
      setFeedback(null);
      setConfirmRemoveTarget(null);
      setConfirmRoleTarget(null);
      setConfirmDeleteGroup(false);
      setConfirmLeaveGroup(false);

      fetch('/api/groups/details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: conversation.id }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data?.success && data?.conversation) {
            setLocalGroup(data.conversation);
            setName(data.conversation.name || '');
            setDescription(data.conversation.description || '');
            setAvatarUrl(data.conversation.avatar_url || '');
          }
        })
        .catch(() => {});
    }
  }, [isOpen, conversation?.id]);

  if (!isOpen || !localGroup || localGroup.type !== 'group') return null;

  const currentUserId = currentUser?.id || '';
  const memberRoles = localGroup.member_roles || {};
  const isOwner = localGroup.owner_id === currentUserId;
  const hasAnyExplicitAdmin = Object.values(memberRoles).some((r) => r === 'admin') || Boolean(localGroup.owner_id);
  const isAdmin =
    isOwner ||
    memberRoles[currentUserId] === 'admin' ||
    (!hasAnyExplicitAdmin && (localGroup.member_ids?.[0] === currentUserId || (localGroup.member_ids?.length || 0) <= 1));

  const memberIds = localGroup.member_ids || [];
  const membersMeta = localGroup.members_meta || {};

  // Filter members by query
  const filteredMemberIds = memberIds.filter((mId) => {
    if (!memberFilterQuery.trim()) return true;
    const meta = membersMeta[mId];
    const q = memberFilterQuery.trim().toLowerCase();
    const dName = (meta?.display_name || '').toLowerCase();
    const uName = (meta?.username || '').toLowerCase();
    return dName.includes(q) || uName.includes(q) || mId.toLowerCase().includes(q);
  });

  const showToast = (type: 'success' | 'error', text: string) => {
    setFeedback({ type, text });
    setTimeout(() => {
      setFeedback((prev) => (prev?.text === text ? null : prev));
    }, 4000);
  };

  const handleUpdateGroupInfo = async () => {
    if (!name.trim()) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/groups/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: localGroup.id,
          userId: currentUserId,
          name: name.trim(),
          description: description.trim(),
          avatarUrl,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update group');
      }

      setIsEditing(false);
      if (data.conversation) {
        setLocalGroup(data.conversation);
        onGroupUpdated(data.conversation);
      } else {
        onGroupUpdated();
      }
      showToast('success', 'Group profile updated successfully!');
    } catch (err: any) {
      setError(err.message || 'Error updating group');
    } finally {
      setLoading(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setError('Group photo must be less than 5MB');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result as string;
        const uploaded = await uploadMediaToServer(base64, {
          mediaType: 'image',
          category: 'profile',
          userId: currentUserId,
        });
        if (uploaded) {
          setAvatarUrl(uploaded);
        }
        setLoading(false);
      };
      reader.readAsDataURL(file);
    } catch {
      setError('Failed to upload image');
      setLoading(false);
    }
  };

  const executeRemoveMember = async (memberId: string) => {
    setActionLoadingId(memberId);
    setError(null);
    setConfirmRemoveTarget(null);

    try {
      const res = await fetch('/api/groups/members/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: localGroup.id,
          actorId: currentUserId,
          memberId,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to remove member');
      }

      const updatedConv = data.conversation || {
        ...localGroup,
        member_ids: localGroup.member_ids?.filter((id) => id !== memberId),
      };

      setLocalGroup(updatedConv);
      onGroupUpdated(updatedConv);
      showToast('success', 'Member removed from group successfully.');
    } catch (err: any) {
      setError(err.message || 'Error removing member');
      showToast('error', err.message || 'Error removing member');
    } finally {
      setActionLoadingId(null);
    }
  };

  const executeToggleRole = async (memberId: string, targetRole: 'admin' | 'member') => {
    setActionLoadingId(memberId);
    setError(null);
    setConfirmRoleTarget(null);

    try {
      const res = await fetch('/api/groups/members/role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: localGroup.id,
          actorId: currentUserId,
          memberId,
          role: targetRole,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to change role');
      }

      const updatedConv = data.conversation || {
        ...localGroup,
        member_roles: {
          ...(localGroup.member_roles || {}),
          [memberId]: targetRole,
        },
      };

      setLocalGroup(updatedConv);
      onGroupUpdated(updatedConv);
      showToast(
        'success',
        targetRole === 'admin'
          ? 'Member promoted to Group Admin successfully.'
          : 'Admin privileges removed successfully.'
      );
    } catch (err: any) {
      setError(err.message || 'Error changing role');
      showToast('error', err.message || 'Error changing role');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleLeaveGroup = async () => {
    setLoading(true);
    setConfirmLeaveGroup(false);

    try {
      if (currentUserId && localGroup?.id) {
        recordDeletedConvId(currentUserId, localGroup.id);
        try {
          localStorage.removeItem(`liveconnect_msgs_${localGroup.id}`);
          localStorage.removeItem(`liveconnect_deleted_ids_${localGroup.id}`);
          localStorage.removeItem(`liveconnect_active_conv_${currentUserId}`);
        } catch (e) {}
      }

      const res = await fetch('/api/groups/members/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: localGroup.id,
          actorId: currentUserId,
          memberId: currentUserId,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to leave group');
      }

      onGroupDeleted();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error leaving group');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteGroup = async () => {
    setLoading(true);
    setConfirmDeleteGroup(false);

    try {
      const res = await fetch('/api/groups/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: localGroup.id,
          actorId: currentUserId,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete group');
      }

      onGroupDeleted();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error deleting group');
    } finally {
      setLoading(false);
    }
  };

  const fetchAvailableUsers = async (query = '') => {
    setLoadingAvailable(true);
    setShowAddMembers(true);

    try {
      const res = await fetch('/api/users/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, userId: currentUserId }),
      });
      const data = await res.json();
      if (data?.users) {
        // Exclude existing members
        const filtered = data.users.filter((u: Profile) => !memberIds.includes(u.id));
        setAvailableUsers(filtered);
      }
    } catch {
      // ignore
    } finally {
      setLoadingAvailable(false);
    }
  };

  const handleAddSelectedMembers = async () => {
    if (selectedNewUsers.length === 0) return;
    setLoading(true);
    setError(null);

    const profilesMap: Record<string, Profile> = {};
    availableUsers.forEach((u) => {
      if (selectedNewUsers.includes(u.id)) {
        profilesMap[u.id] = u;
      }
    });

    try {
      const res = await fetch('/api/groups/members/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: localGroup.id,
          userId: currentUserId,
          memberIds: selectedNewUsers,
          profilesMap,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to add members');
      }

      setShowAddMembers(false);
      setSelectedNewUsers([]);
      setSearchQuery('');

      if (data.conversation) {
        setLocalGroup(data.conversation);
        onGroupUpdated(data.conversation);
      } else {
        onGroupUpdated();
      }
      showToast('success', `${selectedNewUsers.length} member(s) added to group!`);
    } catch (err: any) {
      setError(err.message || 'Error adding members');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg bg-white dark:bg-neutral-900 rounded-3xl shadow-2xl border border-neutral-200 dark:border-neutral-800 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-900/70">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center shadow-xs">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-100 leading-tight">
                Group Details & Members
              </h2>
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                {memberIds.length} {memberIds.length === 1 ? 'member' : 'members'} • Manage admin & roles
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-200/60 dark:hover:bg-neutral-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Feedback / Toast Banner */}
        {feedback && (
          <div
            className={`px-4 py-2.5 text-xs font-semibold flex items-center gap-2 transition-all ${
              feedback.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-b border-emerald-200 dark:border-emerald-800/60'
                : 'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border-b border-rose-200 dark:border-rose-800/60'
            }`}
          >
            {feedback.type === 'success' ? (
              <Check className="w-4 h-4 text-emerald-500 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
            )}
            <span>{feedback.text}</span>
          </div>
        )}

        {/* Modal Scrollable Body */}
        <div className="p-5 space-y-5 overflow-y-auto flex-1">
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 rounded-2xl flex items-center gap-2.5 text-red-600 dark:text-red-400 text-xs font-medium">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Group Profile Info Card */}
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 p-4 rounded-2xl bg-neutral-50 dark:bg-neutral-800/40 border border-neutral-100 dark:border-neutral-800">
            {/* Avatar Upload */}
            <div className="relative group shrink-0">
              <div className="w-20 h-20 rounded-2xl overflow-hidden bg-neutral-200 dark:bg-neutral-700 border-2 border-white dark:border-neutral-800 shadow-md">
                {avatarUrl ? (
                  <img src={avatarUrl} alt={name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-blue-600 text-white font-black text-2xl">
                    {name.charAt(0).toUpperCase() || 'G'}
                  </div>
                )}
              </div>
              {isAdmin && isEditing && (
                <label className="absolute inset-0 bg-black/40 rounded-2xl flex flex-col items-center justify-center text-white cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity">
                  <Camera className="w-5 h-5 mb-0.5" />
                  <span className="text-[10px] font-bold">Change</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarUpload}
                    disabled={loading}
                    className="hidden"
                  />
                </label>
              )}
            </div>

            {/* Name & Description */}
            <div className="flex-1 w-full text-center sm:text-left">
              {isEditing ? (
                <div className="space-y-2.5">
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Group name"
                    className="w-full px-3 py-1.5 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm font-bold text-neutral-900 dark:text-neutral-100 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  />
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Group description (optional)"
                    rows={2}
                    className="w-full px-3 py-1.5 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-xs text-neutral-900 dark:text-neutral-100 focus:outline-hidden focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      onClick={() => setIsEditing(false)}
                      className="px-3 py-1 rounded-xl text-xs font-semibold text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleUpdateGroupInfo}
                      disabled={loading || !name.trim()}
                      className="px-4 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      Save Details
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-center sm:justify-start gap-2">
                    <h3 className="text-base font-extrabold text-neutral-900 dark:text-neutral-100">
                      {localGroup.name || 'Unnamed Group'}
                    </h3>
                    {isAdmin && (
                      <button
                        onClick={() => setIsEditing(true)}
                        title="Edit group details"
                        className="p-1 rounded-lg text-neutral-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  {localGroup.description && (
                    <p className="text-xs text-neutral-600 dark:text-neutral-400 mt-1 line-clamp-3">
                      {localGroup.description}
                    </p>
                  )}
                  <p className="text-[11px] text-neutral-400 dark:text-neutral-500 mt-2">
                    Created {new Date(localGroup.created_at).toLocaleDateString()}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Admin Role Status Badge Banner */}
          {isAdmin ? (
            <div className="px-3.5 py-2.5 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/50 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="p-1.5 rounded-xl bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-400 shrink-0">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-amber-900 dark:text-amber-200 leading-tight">
                    {isOwner ? '👑 You are the Group Creator & Admin' : '🛡️ You are a Group Admin'}
                  </p>
                  <p className="text-[11px] text-amber-700/80 dark:text-amber-400/80 truncate">
                    You can remove members and promote or demote admins.
                  </p>
                </div>
              </div>
              <span className="px-2 py-0.5 rounded-full bg-amber-200/70 dark:bg-amber-900/80 text-amber-800 dark:text-amber-300 text-[10px] font-black shrink-0">
                ADMIN
              </span>
            </div>
          ) : (
            <div className="px-3.5 py-2 rounded-xl bg-neutral-100 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-800 flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400">
              <Shield className="w-4 h-4 text-neutral-400 shrink-0" />
              <span>Only Group Admins can add/remove members or change roles.</span>
            </div>
          )}

          {/* Members Section Header */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-blue-500" />
                <span>Group Members ({memberIds.length})</span>
              </h4>

              {isAdmin && !showAddMembers && (
                <button
                  onClick={() => fetchAvailableUsers('')}
                  className="px-2.5 py-1 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 text-xs font-bold hover:bg-blue-100 dark:hover:bg-blue-900/40 flex items-center gap-1.5 transition-colors shadow-2xs"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Add Member</span>
                </button>
              )}
            </div>

            {/* Filter member search bar */}
            {memberIds.length > 3 && (
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input
                  type="text"
                  value={memberFilterQuery}
                  onChange={(e) => setMemberFilterQuery(e.target.value)}
                  placeholder="Search group members..."
                  className="w-full pl-8 pr-3 py-1.5 rounded-xl text-xs bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
                {memberFilterQuery && (
                  <button
                    onClick={() => setMemberFilterQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}

            {/* Add Member Drawer / Panel */}
            {showAddMembers && (
              <div className="p-3.5 rounded-2xl bg-blue-50/60 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/40 space-y-3 animate-in fade-in duration-150">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-neutral-800 dark:text-neutral-200 flex items-center gap-1.5">
                    <UserPlus className="w-3.5 h-3.5 text-blue-500" />
                    <span>Select Users to Add</span>
                  </span>
                  <button
                    onClick={() => setShowAddMembers(false)}
                    className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      fetchAvailableUsers(e.target.value);
                    }}
                    placeholder="Search people to add..."
                    className="w-full pl-8 pr-3 py-1.5 rounded-xl text-xs bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 text-neutral-900 dark:text-neutral-100 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {loadingAvailable ? (
                  <div className="flex items-center justify-center py-4 text-neutral-400 text-xs">
                    <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
                    Loading available users...
                  </div>
                ) : availableUsers.length === 0 ? (
                  <p className="text-xs text-neutral-500 text-center py-2">
                    No new users available to add.
                  </p>
                ) : (
                  <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                    {availableUsers.map((u) => {
                      const isSelected = selectedNewUsers.includes(u.id);
                      return (
                        <div
                          key={u.id}
                          onClick={() => {
                            setSelectedNewUsers((prev) =>
                              isSelected ? prev.filter((id) => id !== u.id) : [...prev, u.id]
                            );
                          }}
                          className={`flex items-center justify-between p-2 rounded-xl cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-blue-100 dark:bg-blue-900/40 border border-blue-300 dark:border-blue-700'
                              : 'bg-white dark:bg-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-700/60'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <UserAvatar
                              src={u.avatar_url}
                              name={u.display_name || u.username}
                              id={u.id}
                              className="w-7 h-7 shrink-0"
                            />
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-neutral-900 dark:text-neutral-100 truncate">
                                {u.display_name || u.username}
                              </p>
                              <p className="text-[10px] text-neutral-400 truncate">@{u.username}</p>
                            </div>
                          </div>
                          <div
                            className={`w-4 h-4 rounded-md border flex items-center justify-center ${
                              isSelected
                                ? 'bg-blue-600 border-blue-600 text-white'
                                : 'border-neutral-300 dark:border-neutral-600'
                            }`}
                          >
                            {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <button
                  onClick={handleAddSelectedMembers}
                  disabled={selectedNewUsers.length === 0 || loading}
                  className="w-full py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold disabled:opacity-50 flex items-center justify-center gap-1.5 transition-colors"
                >
                  {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Add Selected ({selectedNewUsers.length})
                </button>
              </div>
            )}

            {/* Confirmation Inline Prompt for Removing Member */}
            {confirmRemoveTarget && (
              <div className="p-3.5 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 space-y-2.5 animate-in fade-in duration-150">
                <div className="flex items-start gap-2.5">
                  <div className="p-1.5 rounded-xl bg-red-100 dark:bg-red-900/60 text-red-600 dark:text-red-300 shrink-0">
                    <UserMinus className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h5 className="text-xs font-bold text-red-900 dark:text-red-200">
                      Remove {confirmRemoveTarget.name} from group?
                    </h5>
                    <p className="text-[11px] text-red-700/80 dark:text-red-300/80 mt-0.5">
                      This will remove the user from the group. The chat conversation will be automatically deleted from their screen.
                    </p>

                    {/* Both Admin ID and Target Member ID side-by-side */}
                    <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                      <div className="p-2 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
                        <span className="text-[10px] font-bold text-neutral-400 dark:text-neutral-500 uppercase tracking-wider block">Admin (You)</span>
                        <span className="font-bold text-neutral-800 dark:text-neutral-200 block truncate mt-0.5">
                          {currentUser?.display_name || 'Admin'} (@{currentUser?.username || 'admin'})
                        </span>
                        <div className="mt-1 flex items-center gap-1 font-mono text-[10px] text-neutral-500">
                          <span>ID:</span>
                          <span className="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded font-bold text-neutral-800 dark:text-neutral-200 truncate max-w-[130px]" title={currentUserId}>
                            {currentUserId}
                          </span>
                        </div>
                      </div>

                      <div className="p-2 rounded-xl bg-red-100/60 dark:bg-red-900/30 border border-red-200 dark:border-red-800">
                        <span className="text-[10px] font-bold text-red-600 dark:text-red-400 uppercase tracking-wider block">Target Member</span>
                        <span className="font-bold text-red-950 dark:text-red-100 block truncate mt-0.5">
                          {confirmRemoveTarget.name} (@{confirmRemoveTarget.username || 'user'})
                        </span>
                        <div className="mt-1 flex items-center gap-1 font-mono text-[10px] text-red-600 dark:text-red-400">
                          <span>ID:</span>
                          <span className="bg-red-200/60 dark:bg-red-900/60 px-1.5 py-0.5 rounded font-bold text-red-900 dark:text-red-100 truncate max-w-[130px]" title={confirmRemoveTarget.id}>
                            {confirmRemoveTarget.id}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    onClick={() => setConfirmRemoveTarget(null)}
                    disabled={Boolean(actionLoadingId)}
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200/60 dark:hover:bg-neutral-800 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => executeRemoveMember(confirmRemoveTarget.id)}
                    disabled={Boolean(actionLoadingId)}
                    className="px-3.5 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs cursor-pointer active:scale-95"
                  >
                    {actionLoadingId === confirmRemoveTarget.id && (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    )}
                    Confirm & Remove
                  </button>
                </div>
              </div>
            )}

            {/* Confirmation Inline Prompt for Role Change */}
            {confirmRoleTarget && (
              <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 space-y-2.5 animate-in fade-in duration-150">
                <div className="flex items-start gap-2.5">
                  <div className="p-1.5 rounded-xl bg-amber-100 dark:bg-amber-900/60 text-amber-600 dark:text-amber-300 shrink-0">
                    {confirmRoleTarget.targetRole === 'admin' ? (
                      <ShieldCheck className="w-4 h-4" />
                    ) : (
                      <ShieldAlert className="w-4 h-4" />
                    )}
                  </div>
                  <div>
                    <h5 className="text-xs font-bold text-amber-900 dark:text-amber-200">
                      {confirmRoleTarget.targetRole === 'admin'
                        ? `Make ${confirmRoleTarget.name} a Group Admin?`
                        : `Dismiss ${confirmRoleTarget.name} from Group Admin?`}
                    </h5>
                    <p className="text-[11px] text-amber-700/80 dark:text-amber-300/80 mt-0.5">
                      {confirmRoleTarget.targetRole === 'admin'
                        ? 'They will have full permissions to add/remove members and manage group settings.'
                        : 'They will return to regular member status.'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    onClick={() => setConfirmRoleTarget(null)}
                    disabled={Boolean(actionLoadingId)}
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200/60 dark:hover:bg-neutral-800"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => executeToggleRole(confirmRoleTarget.id, confirmRoleTarget.targetRole)}
                    disabled={Boolean(actionLoadingId)}
                    className="px-3.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs"
                  >
                    {actionLoadingId === confirmRoleTarget.id && (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    )}
                    Confirm Change
                  </button>
                </div>
              </div>
            )}

            {/* Existing Member Rows */}
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {filteredMemberIds.length === 0 ? (
                <p className="text-xs text-neutral-400 text-center py-4">No matching members found.</p>
              ) : (
                filteredMemberIds.map((mId) => {
                  const memberMeta = membersMeta[mId] || {
                    id: mId,
                    display_name: 'Member',
                    username: 'member',
                  };
                  const memberRole = memberRoles[mId] || 'member';
                  const isMemberOwner = localGroup.owner_id === mId;
                  const isMemberAdmin = isMemberOwner || memberRole === 'admin';
                  const isSelf = mId === currentUserId;
                  const isPerformingAction = actionLoadingId === mId;

                  return (
                    <div
                      key={mId}
                      className="p-3 rounded-2xl bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200/70 dark:border-neutral-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 transition-colors hover:bg-neutral-100/60 dark:hover:bg-neutral-800"
                    >
                      {/* Member Info */}
                      <div className="flex items-center gap-3 min-w-0">
                        <UserAvatar
                          src={memberMeta.avatar_url}
                          name={memberMeta.display_name || memberMeta.username}
                          id={mId}
                          className="w-9 h-9 shrink-0 shadow-2xs"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="text-xs font-bold text-neutral-900 dark:text-neutral-100 truncate">
                              {memberMeta.display_name || memberMeta.username}
                            </p>
                            {isSelf && (
                              <span className="px-1.5 py-0.2 rounded-md bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 text-[10px] font-bold">
                                You
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="text-[10px] text-neutral-500 dark:text-neutral-400 truncate">
                              @{memberMeta.username || 'user'}
                            </p>
                            <span className="font-mono text-[9px] text-neutral-400 dark:text-neutral-500 bg-neutral-200/60 dark:bg-neutral-800/80 px-1.5 py-0.2 rounded" title={mId}>
                              ID: {mId.length > 8 ? `${mId.slice(0, 8)}...` : mId}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Badges & Actions */}
                      <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0 pt-1 sm:pt-0 border-t sm:border-t-0 border-neutral-200/50 dark:border-neutral-700/50">
                        {/* Status Badges */}
                        <div className="flex items-center gap-1">
                          {isMemberOwner ? (
                            <span className="px-2 py-0.5 rounded-lg bg-amber-100 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 text-[10px] font-black flex items-center gap-1 border border-amber-300 dark:border-amber-800">
                              <Crown className="w-3 h-3 text-amber-500 fill-amber-500" />
                              <span>Owner</span>
                            </span>
                          ) : isMemberAdmin ? (
                            <span className="px-2 py-0.5 rounded-lg bg-purple-100 dark:bg-purple-950/70 text-purple-700 dark:text-purple-300 text-[10px] font-extrabold flex items-center gap-1 border border-purple-200 dark:border-purple-800">
                              <ShieldCheck className="w-3 h-3 text-purple-500" />
                              <span>Admin</span>
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-lg bg-neutral-200/70 dark:bg-neutral-700/60 text-neutral-600 dark:text-neutral-300 text-[10px] font-medium">
                              Member
                            </span>
                          )}
                        </div>

                        {/* Admin Action Controls */}
                        {isAdmin && !isSelf && (
                          <div className="flex items-center gap-1.5">
                            {/* Make Admin / Dismiss Admin */}
                            {!isMemberOwner && (
                              <button
                                onClick={() =>
                                  setConfirmRoleTarget({
                                    id: mId,
                                    name: memberMeta.display_name || memberMeta.username || 'Member',
                                    targetRole: isMemberAdmin ? 'member' : 'admin',
                                  })
                                }
                                disabled={isPerformingAction}
                                title={isMemberAdmin ? 'Dismiss as Admin' : 'Make Group Admin'}
                                className={`px-2 py-1 rounded-xl text-[11px] font-bold flex items-center gap-1 transition-all active:scale-95 ${
                                  isMemberAdmin
                                    ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 hover:bg-amber-100 border border-amber-200 dark:border-amber-800'
                                    : 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 hover:bg-blue-100 border border-blue-200 dark:border-blue-800'
                                }`}
                              >
                                {isPerformingAction ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : isMemberAdmin ? (
                                  <>
                                    <ShieldAlert className="w-3 h-3 text-amber-500" />
                                    <span>Dismiss</span>
                                  </>
                                ) : (
                                  <>
                                    <ShieldCheck className="w-3 h-3 text-blue-500" />
                                    <span>Make Admin</span>
                                  </>
                                )}
                              </button>
                            )}

                            {/* Remove Member Button */}
                            {!isMemberOwner && (
                              <button
                                onClick={() =>
                                  setConfirmRemoveTarget({
                                    id: mId,
                                    name: memberMeta.display_name || memberMeta.username || 'Member',
                                    username: memberMeta.username || 'user',
                                  })
                                }
                                disabled={isPerformingAction}
                                title="Remove member from group"
                                className="px-2 py-1 rounded-xl text-[11px] font-bold bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 border border-red-200 dark:border-red-800 flex items-center gap-1 transition-all active:scale-95 cursor-pointer"
                              >
                                <UserMinus className="w-3 h-3" />
                                <span>Remove</span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Leave & Delete Group Confirmation Modals */}
          {confirmLeaveGroup && (
            <div className="p-3.5 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 space-y-2.5 animate-in fade-in">
              <div className="flex items-start gap-2.5">
                <LogOut className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <h5 className="text-xs font-bold text-red-900 dark:text-red-200">
                    Are you sure you want to leave this group?
                  </h5>
                  <p className="text-[11px] text-red-700/80 dark:text-red-300/80 mt-0.5">
                    You will no longer participate in this chat unless someone adds you back.
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setConfirmLeaveGroup(false)}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleLeaveGroup}
                  disabled={loading}
                  className="px-3.5 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold flex items-center gap-1.5"
                >
                  {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Confirm Leave
                </button>
              </div>
            </div>
          )}

          {confirmDeleteGroup && (
            <div className="p-3.5 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 space-y-2.5 animate-in fade-in">
              <div className="flex items-start gap-2.5">
                <Trash2 className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <h5 className="text-xs font-bold text-red-900 dark:text-red-200">
                    Permanently delete this group?
                  </h5>
                  <p className="text-[11px] text-red-700/80 dark:text-red-300/80 mt-0.5">
                    This action cannot be undone. All messages and media in this group will be deleted for everyone.
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setConfirmDeleteGroup(false)}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteGroup}
                  disabled={loading}
                  className="px-3.5 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold flex items-center gap-1.5"
                >
                  {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Yes, Delete Group
                </button>
              </div>
            </div>
          )}

          {/* Action Footer Buttons */}
          <div className="pt-3 border-t border-neutral-200 dark:border-neutral-800 space-y-2">
            {!confirmLeaveGroup && (
              <button
                onClick={() => setConfirmLeaveGroup(true)}
                disabled={loading}
                className="w-full py-2.5 rounded-2xl bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 text-xs font-bold hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors flex items-center justify-center gap-2"
              >
                <LogOut className="w-4 h-4" />
                <span>Leave Group</span>
              </button>
            )}

            {isAdmin && !confirmDeleteGroup && (
              <button
                onClick={() => setConfirmDeleteGroup(true)}
                disabled={loading}
                className="w-full py-2.5 rounded-2xl border border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 text-xs font-bold hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors flex items-center justify-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                <span>Delete Group (Admins Only)</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
