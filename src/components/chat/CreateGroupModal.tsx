import React, { useState, useEffect, useRef } from 'react';
import {
  Users,
  X,
  Camera,
  Search,
  Check,
  Loader2,
  AlertCircle,
  Sparkles,
  UserCheck,
} from 'lucide-react';
import { Profile } from '@/src/types';
import { UserAvatar } from '../ui/UserAvatar';
import { uploadMediaToServer } from '@/src/lib/mediaUpload';

interface CreateGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: Profile | null;
  onCreateGroup: (
    name: string,
    description: string,
    avatarUrl: string | null,
    memberIds: string[],
    currentUserProfile: Profile
  ) => Promise<string | null>;
  onGroupCreated?: (conversationId: string) => void;
}

export const CreateGroupModal: React.FC<CreateGroupModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onCreateGroup,
  onGroupCreated,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [availableUsers, setAvailableUsers] = useState<Profile[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Reset form whenever modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setName('');
      setDescription('');
      setAvatarUrl(null);
      setSelectedMemberIds([]);
      setSearchQuery('');
      setError(null);
      fetchUsers('');
    }
  }, [isOpen]);

  const fetchUsers = async (queryStr: string) => {
    if (!currentUser?.id) return;
    setLoadingUsers(true);
    try {
      const res = await fetch('/api/users/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: queryStr, userId: currentUser.id }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.users)) {
          setAvailableUsers(data.users.filter((u: Profile) => u.id !== currentUser.id));
        }
      }
    } catch {
      // ignore
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);
    fetchUsers(val);
  };

  const handleAvatarSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setError('Group icon image must be under 5MB');
      return;
    }

    setAvatarUploading(true);
    setError(null);

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64 = reader.result as string;
          const uploaded = await uploadMediaToServer(base64, {
            mediaType: 'image',
            category: 'profile',
            userId: currentUser?.id,
          });
          if (uploaded) {
            setAvatarUrl(uploaded);
          } else {
            setAvatarUrl(base64);
          }
        } catch {
          setError('Failed to process image');
        } finally {
          setAvatarUploading(false);
        }
      };
      reader.readAsDataURL(file);
    } catch {
      setError('Failed to read image file');
      setAvatarUploading(false);
    }
  };

  const toggleSelectMember = (userId: string) => {
    setSelectedMemberIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const handleRemoveMember = (userId: string) => {
    setSelectedMemberIds((prev) => prev.filter((id) => id !== userId));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Please enter a group name');
      return;
    }

    if (!currentUser) {
      setError('You must be signed in to create a group');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const newGroupId = await onCreateGroup(
        trimmedName,
        description.trim(),
        avatarUrl,
        selectedMemberIds,
        currentUser
      );

      if (newGroupId) {
        onGroupCreated?.(newGroupId);
        onClose();
      } else {
        setError('Failed to create group. Please check your connection and try again.');
      }
    } catch (err: any) {
      setError(err?.message || 'Error creating group');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const selectedProfiles = availableUsers.filter((u) => selectedMemberIds.includes(u.id));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        id="create-group-modal"
        className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between bg-neutral-50/50 dark:bg-neutral-900/50">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-blue-600/10 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">
                New Group Chat
              </h2>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Create a space for your team, friends, or family
              </p>
            </div>
          </div>
          <button
            id="create-group-close-btn"
            onClick={onClose}
            className="p-2 rounded-xl text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-200/60 dark:hover:bg-neutral-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {error && (
            <div className="p-3 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-300 text-xs flex items-center gap-2 animate-in fade-in">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Group Photo & Name */}
          <div className="flex items-center gap-4">
            <div className="relative shrink-0">
              <div
                onClick={() => fileInputRef.current?.click()}
                className="w-16 h-16 rounded-2xl bg-neutral-100 dark:bg-neutral-800 border-2 border-dashed border-neutral-300 dark:border-neutral-700 flex flex-col items-center justify-center cursor-pointer hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-950/20 transition-all overflow-hidden group"
                title="Upload group picture"
              >
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt="Group icon"
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="flex flex-col items-center text-neutral-400 group-hover:text-blue-600 transition-colors">
                    {avatarUploading ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <>
                        <Camera className="w-5 h-5" />
                        <span className="text-[9px] mt-0.5 font-medium">Photo</span>
                      </>
                    )}
                  </div>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleAvatarSelect}
                className="hidden"
              />
              {avatarUrl && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setAvatarUrl(null);
                  }}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-600 text-white flex items-center justify-center text-[10px] shadow-sm hover:scale-110 active:scale-95 transition-all"
                  title="Remove photo"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            <div className="flex-1 space-y-1">
              <label className="text-xs font-bold text-neutral-700 dark:text-neutral-300">
                Group Name <span className="text-red-500">*</span>
              </label>
              <input
                id="create-group-name-input"
                type="text"
                required
                maxLength={50}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Family & Friends"
                className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition-all placeholder:text-neutral-400"
              />
            </div>
          </div>

          {/* Group Description */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-neutral-700 dark:text-neutral-300 flex items-center justify-between">
              <span>Description <span className="text-neutral-400 font-normal">(Optional)</span></span>
              <span className="text-[10px] text-neutral-400 font-mono">{description.length}/150</span>
            </label>
            <input
              id="create-group-desc-input"
              type="text"
              maxLength={150}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's this group about?"
              className="w-full px-3.5 py-2 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition-all placeholder:text-neutral-400"
            />
          </div>

          {/* Selected Member Chips */}
          {selectedProfiles.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between text-xs font-bold text-neutral-700 dark:text-neutral-300">
                <span>Selected Members</span>
                <span className="text-blue-600 dark:text-blue-400 font-medium">
                  {selectedProfiles.length} member{selectedProfiles.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-2 rounded-2xl bg-neutral-100 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700/60">
                {selectedProfiles.map((user) => (
                  <div
                    key={user.id}
                    className="inline-flex items-center gap-1.5 pl-1.5 pr-2 py-1 rounded-xl bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 shadow-2xs text-xs font-medium text-neutral-900 dark:text-neutral-100 animate-in zoom-in-95"
                  >
                    <UserAvatar
                      src={user.avatar_url}
                      name={user.display_name || user.username}
                      id={user.id}
                      className="w-4 h-4"
                    />
                    <span className="truncate max-w-[110px]">{user.display_name || user.username}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveMember(user.id)}
                      className="hover:text-red-500 transition-colors p-0.5"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Member Search and Selector */}
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-neutral-700 dark:text-neutral-300">
                Add Members
              </label>
              <span className="text-[11px] text-neutral-400">
                You will be group admin automatically
              </span>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={handleSearchChange}
                placeholder="Search people by name or @username..."
                className="w-full pl-9 pr-4 py-2 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition-all placeholder:text-neutral-400"
              />
            </div>

            {/* Users list */}
            <div className="border border-neutral-200 dark:border-neutral-800 rounded-2xl overflow-hidden max-h-52 overflow-y-auto divide-y divide-neutral-100 dark:divide-neutral-800/60 bg-white dark:bg-neutral-800/30">
              {loadingUsers ? (
                <div className="p-6 text-center text-xs text-neutral-400 flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                  <span>Finding contacts...</span>
                </div>
              ) : availableUsers.length === 0 ? (
                <div className="p-6 text-center text-xs text-neutral-400">
                  {searchQuery ? `No users matching "${searchQuery}"` : 'No users found'}
                </div>
              ) : (
                availableUsers.map((user) => {
                  const isSelected = selectedMemberIds.includes(user.id);
                  return (
                    <div
                      key={user.id}
                      onClick={() => toggleSelectMember(user.id)}
                      className={`p-2.5 sm:px-3 flex items-center justify-between cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-blue-50/70 dark:bg-blue-950/30'
                          : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/50'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <UserAvatar
                          src={user.avatar_url}
                          name={user.display_name || user.username}
                          id={user.id}
                          className="w-8 h-8"
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-neutral-900 dark:text-neutral-100 truncate">
                            {user.display_name || user.username}
                          </p>
                          {user.username && (
                            <p className="text-[10px] text-neutral-400 truncate font-mono">
                              @{user.username}
                            </p>
                          )}
                        </div>
                      </div>

                      <div
                        className={`w-5 h-5 rounded-lg flex items-center justify-center transition-all ${
                          isSelected
                            ? 'bg-blue-600 text-white'
                            : 'border border-neutral-300 dark:border-neutral-600'
                        }`}
                      >
                        {isSelected && <Check className="w-3.5 h-3.5 stroke-[2.5]" />}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </form>

        {/* Modal Footer */}
        <div className="p-4 sm:p-5 border-t border-neutral-200 dark:border-neutral-800 flex items-center justify-end gap-2.5 bg-neutral-50/50 dark:bg-neutral-900/50">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-700 text-xs font-semibold text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || !name.trim()}
            className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold shadow-md shadow-blue-500/20 transition-all flex items-center gap-2 active:scale-95 cursor-pointer disabled:pointer-events-none"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Creating...</span>
              </>
            ) : (
              <>
                <Users className="w-4 h-4" />
                <span>Create Group</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
