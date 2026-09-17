import React, { useState } from 'react';
import { Users, X, Shield, ShieldCheck, UserMinus, UserPlus, LogOut, Trash2, Edit3, Camera, Loader2, Check } from 'lucide-react';
import { Conversation, Profile } from '@/src/types';
import { UserAvatar } from '../ui/UserAvatar';
import { uploadMediaToServer } from '@/src/lib/mediaUpload';

interface GroupProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  conversation: Conversation | null;
  currentUser: Profile | null;
  onGroupUpdated: () => void;
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
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(conversation?.name || '');
  const [description, setDescription] = useState(conversation?.description || '');
  const [avatarUrl, setAvatarUrl] = useState(conversation?.avatar_url || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [availableUsers, setAvailableUsers] = useState<Profile[]>([]);
  const [selectedNewUsers, setSelectedNewUsers] = useState<string[]>([]);
  const [loadingAvailable, setLoadingAvailable] = useState(false);

  if (!isOpen || !conversation || conversation.type !== 'group') return null;

  const currentUserId = currentUser?.id || '';
  const memberRoles = conversation.member_roles || {};
  const isOwner = conversation.owner_id === currentUserId;
  const isAdmin = isOwner || memberRoles[currentUserId] === 'admin';

  const memberIds = conversation.member_ids || [];
  const membersMeta = conversation.members_meta || {};

  const handleUpdateGroupInfo = async () => {
    if (!name.trim()) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/groups/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: conversation.id,
          userId: currentUserId,
          name: name.trim(),
          description: description.trim(),
          avatarUrl,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update group');
      }

      setIsEditing(false);
      onGroupUpdated();
    } catch (err: any) {
      setError(err.message || 'Error updating group');
    } finally {
      setLoading(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      setError('Group photo must be less than 2MB');
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

  const handleRemoveMember = async (memberId: string) => {
    if (!confirm('Are you sure you want to remove this member?')) return;
    setLoading(true);

    try {
      const res = await fetch('/api/groups/members/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: conversation.id,
          actorId: currentUserId,
          memberId,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to remove member');
      }

      onGroupUpdated();
    } catch (err: any) {
      setError(err.message || 'Error removing member');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleRole = async (memberId: string, currentRole?: string) => {
    const newRole = currentRole === 'admin' ? 'member' : 'admin';
    setLoading(true);

    try {
      const res = await fetch('/api/groups/members/role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: conversation.id,
          actorId: currentUserId,
          memberId,
          role: newRole,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to change role');
      }

      onGroupUpdated();
    } catch (err: any) {
      setError(err.message || 'Error changing role');
    } finally {
      setLoading(false);
    }
  };

  const handleLeaveGroup = async () => {
    if (!confirm('Are you sure you want to leave this group?')) return;
    setLoading(true);

    try {
      const res = await fetch('/api/groups/members/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: conversation.id,
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
    if (!confirm('Are you sure you want to delete this group? All chat history will be permanently deleted.')) return;
    setLoading(true);

    try {
      const res = await fetch('/api/groups/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: conversation.id,
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

  const fetchAvailableUsers = async () => {
    setLoadingAvailable(true);
    setShowAddMembers(true);

    try {
      const res = await fetch('/api/users/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '', userId: currentUserId }),
      });
      const data = await res.json();
      if (data?.users) {
        // Exclude existing group members
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

    try {
      const res = await fetch('/api/groups/members/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: conversation.id,
          userId: currentUserId,
          memberIds: selectedNewUsers,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to add members');
      }

      setShowAddMembers(false);
      setSelectedNewUsers([]);
      onGroupUpdated();
    } catch (err: any) {
      setError(err.message || 'Error adding members');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
          <h3 className="font-bold text-base text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            Group Details
          </h3>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-5 flex-1">
          {error && (
            <div className="p-3 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 text-xs font-medium">
              {error}
            </div>
          )}

          {/* Avatar & Title Banner */}
          <div className="flex flex-col items-center text-center space-y-3">
            <div className="relative group">
              <UserAvatar
                src={avatarUrl || conversation.avatar_url}
                name={conversation.name || 'Group'}
                id={conversation.id}
                className="w-20 h-20 text-xl border-2 border-neutral-200 dark:border-neutral-700 shadow-md"
              />

              {isAdmin && isEditing && (
                <label className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center cursor-pointer text-white">
                  <Camera className="w-6 h-6" />
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleAvatarUpload}
                    className="hidden"
                  />
                </label>
              )}
            </div>

            {isEditing ? (
              <div className="w-full space-y-2">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Group Name"
                  className="w-full px-3 py-1.5 text-center text-base font-bold rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Group Description"
                  className="w-full px-3 py-1.5 text-center text-xs rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <div className="flex justify-center gap-2 pt-1">
                  <button
                    onClick={() => setIsEditing(false)}
                    className="px-3 py-1 text-xs rounded-lg border border-neutral-300 dark:border-neutral-700"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleUpdateGroupInfo}
                    disabled={loading}
                    className="px-4 py-1 text-xs font-bold rounded-lg bg-blue-600 text-white flex items-center gap-1"
                  >
                    {loading && <Loader2 className="w-3 h-3 animate-spin" />}
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <div className="flex items-center justify-center gap-1.5">
                  <h4 className="font-extrabold text-lg text-neutral-900 dark:text-neutral-100">
                    {conversation.name || 'Family Group'}
                  </h4>
                  {isAdmin && (
                    <button
                      onClick={() => {
                        setName(conversation.name || '');
                        setDescription(conversation.description || '');
                        setIsEditing(true);
                      }}
                      className="p-1 text-neutral-400 hover:text-blue-600 transition-colors"
                      title="Edit group details"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                  )}
                </div>
                {conversation.description && (
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 max-w-xs mx-auto">
                    {conversation.description}
                  </p>
                )}
                <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400">
                  {memberIds.length} members
                </span>
              </div>
            )}
          </div>

          {/* Members List Header */}
          <div className="space-y-2 pt-2 border-t border-neutral-200 dark:border-neutral-800">
            <div className="flex items-center justify-between">
              <h5 className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                Group Members ({memberIds.length})
              </h5>
              {isAdmin && !showAddMembers && (
                <button
                  onClick={fetchAvailableUsers}
                  className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  Add Member
                </button>
              )}
            </div>

            {/* Add Member Dropdown Panel */}
            {showAddMembers && (
              <div className="p-3 rounded-2xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                    Select Users to Add
                  </span>
                  <button
                    onClick={() => setShowAddMembers(false)}
                    className="p-1 text-neutral-400 hover:text-neutral-600"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="max-h-36 overflow-y-auto space-y-1">
                  {loadingAvailable ? (
                    <div className="p-3 text-center text-xs text-neutral-400">Loading users...</div>
                  ) : availableUsers.length > 0 ? (
                    availableUsers.map((u) => {
                      const selected = selectedNewUsers.includes(u.id);
                      return (
                        <div
                          key={u.id}
                          onClick={() => {
                            setSelectedNewUsers((prev) =>
                              selected ? prev.filter((id) => id !== u.id) : [...prev, u.id]
                            );
                          }}
                          className={`p-2 rounded-xl flex items-center justify-between cursor-pointer text-xs ${
                            selected ? 'bg-blue-100 dark:bg-blue-900/40' : 'hover:bg-neutral-200/50 dark:hover:bg-neutral-700/50'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <UserAvatar src={u.avatar_url} name={u.display_name} id={u.id} className="w-6 h-6" />
                            <span className="font-medium text-neutral-800 dark:text-neutral-200">
                              {u.display_name}
                            </span>
                          </div>
                          <div className={`w-4 h-4 rounded border flex items-center justify-center ${selected ? 'bg-blue-600 text-white' : ''}`}>
                            {selected && <Check className="w-3 h-3" />}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="p-3 text-center text-xs text-neutral-400">No users available</div>
                  )}
                </div>

                <button
                  onClick={handleAddSelectedMembers}
                  disabled={selectedNewUsers.length === 0 || loading}
                  className="w-full py-1.5 rounded-xl bg-blue-600 text-white text-xs font-bold disabled:opacity-50"
                >
                  Add Selected ({selectedNewUsers.length})
                </button>
              </div>
            )}

            {/* Existing Member Rows */}
            <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
              {memberIds.map((mId) => {
                const memberMeta = membersMeta[mId] || { id: mId, display_name: 'Member', username: 'member' };
                const memberRole = memberRoles[mId] || 'member';
                const isMemberAdmin = memberRole === 'admin' || conversation.owner_id === mId;
                const isSelf = mId === currentUserId;

                return (
                  <div
                    key={mId}
                    className="p-2.5 rounded-2xl bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-100 dark:border-neutral-800 flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <UserAvatar
                        src={memberMeta.avatar_url}
                        name={memberMeta.display_name || memberMeta.username}
                        id={mId}
                        className="w-8 h-8 shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs font-bold text-neutral-900 dark:text-neutral-100 truncate">
                            {memberMeta.display_name || memberMeta.username}
                          </p>
                          {isSelf && <span className="text-[10px] text-neutral-400">(You)</span>}
                        </div>
                        <p className="text-[10px] text-neutral-500 dark:text-neutral-400 truncate">
                          @{memberMeta.username || 'user'}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {isMemberAdmin && (
                        <span className="px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 text-[10px] font-extrabold flex items-center gap-0.5">
                          👑 Admin
                        </span>
                      )}

                      {/* Admin controls over other members */}
                      {isAdmin && !isSelf && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleToggleRole(mId, memberRole)}
                            title={isMemberAdmin ? 'Demote from Admin' : 'Make Admin'}
                            className="p-1 rounded-lg text-neutral-400 hover:text-amber-500 hover:bg-neutral-200/60 dark:hover:bg-neutral-700 transition-colors"
                          >
                            <ShieldCheck className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleRemoveMember(mId)}
                            title="Remove from group"
                            className="p-1 rounded-lg text-neutral-400 hover:text-red-500 hover:bg-neutral-200/60 dark:hover:bg-neutral-700 transition-colors"
                          >
                            <UserMinus className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Action Footer Buttons */}
          <div className="pt-3 border-t border-neutral-200 dark:border-neutral-800 space-y-2">
            <button
              onClick={handleLeaveGroup}
              disabled={loading}
              className="w-full py-2.5 rounded-xl bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 text-xs font-bold hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors flex items-center justify-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              Leave Group
            </button>

            {isAdmin && (
              <button
                onClick={handleDeleteGroup}
                disabled={loading}
                className="w-full py-2.5 rounded-xl border border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 text-xs font-bold hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors flex items-center justify-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                Delete Group (Admins Only)
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
