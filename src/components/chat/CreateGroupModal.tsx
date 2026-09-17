import React, { useState, useEffect } from 'react';
import { Users, X, Search, Check, Upload, Image as ImageIcon, Loader2 } from 'lucide-react';
import { Profile } from '@/src/types';
import { UserAvatar } from '../ui/UserAvatar';
import { uploadMediaToServer } from '@/src/lib/mediaUpload';

interface CreateGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: Profile | null;
  onGroupCreated: (conversationId: string) => void;
}

export const CreateGroupModal: React.FC<CreateGroupModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onGroupCreated,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [users, setUsers] = useState<Profile[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch available users to add to group
  useEffect(() => {
    if (!isOpen || !currentUser) return;

    let isMounted = true;
    setLoadingUsers(true);

    fetch('/api/users/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '', userId: currentUser.id }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!isMounted) return;
        if (data?.users && Array.isArray(data.users)) {
          const filtered = data.users.filter((u: Profile) => u.id !== currentUser.id);
          setUsers(filtered);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (isMounted) setLoadingUsers(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, currentUser]);

  if (!isOpen) return null;

  const handleToggleUser = (userId: string) => {
    setSelectedUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      setError('Group photo must be less than 2MB');
      return;
    }

    setUploadingAvatar(true);
    setError(null);

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result as string;
        const uploaded = await uploadMediaToServer(base64, {
          mediaType: 'image',
          category: 'profile',
          userId: currentUser?.id || 'user',
        });
        if (uploaded) {
          setAvatarUrl(uploaded);
        } else {
          setError('Failed to upload group photo');
        }
        setUploadingAvatar(false);
      };
      reader.readAsDataURL(file);
    } catch {
      setError('Error reading avatar file');
      setUploadingAvatar(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Group name is required');
      return;
    }
    if (!currentUser) return;

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/groups/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          avatarUrl,
          memberIds: selectedUserIds,
          creatorId: currentUser.id,
          creatorProfile: currentUser,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create group');
      }

      if (data.conversationId) {
        onGroupCreated(data.conversationId);
        onClose();
      }
    } catch (err: any) {
      setError(err.message || 'Error creating group');
    } finally {
      setSubmitting(false);
    }
  };

  const filteredUsers = users.filter((u) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      u.display_name?.toLowerCase().includes(q) ||
      u.username?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-5 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between bg-neutral-50/50 dark:bg-neutral-900/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-lg text-neutral-900 dark:text-neutral-100">
                New Family / Group Chat
              </h3>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Create a group conversation with multiple members
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Form Content */}
        <form onSubmit={handleSubmit} className="p-5 space-y-5 overflow-y-auto flex-1">
          {error && (
            <div className="p-3.5 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 text-xs font-medium">
              {error}
            </div>
          )}

          {/* Group Photo & Name Inputs */}
          <div className="flex items-center gap-4">
            <div className="relative group shrink-0">
              <div className="w-16 h-16 rounded-2xl bg-neutral-100 dark:bg-neutral-800 border-2 border-dashed border-neutral-300 dark:border-neutral-700 flex items-center justify-center overflow-hidden">
                {uploadingAvatar ? (
                  <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                ) : avatarUrl ? (
                  <img src={avatarUrl} alt="Group Avatar" className="w-full h-full object-cover" />
                ) : (
                  <ImageIcon className="w-6 h-6 text-neutral-400" />
                )}
              </div>
              <label className="absolute inset-0 cursor-pointer flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl text-white text-[10px] font-bold">
                <Upload className="w-4 h-4" />
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleAvatarChange}
                  className="hidden"
                />
              </label>
            </div>

            <div className="flex-1 space-y-1">
              <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                Group Name *
              </label>
              <input
                type="text"
                placeholder="e.g. 👨‍👩‍👧 Family Group"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={50}
                className="w-full px-3.5 py-2.5 text-sm rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Group Description */}
          <div>
            <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
              Description (Optional)
            </label>
            <input
              type="text"
              placeholder="e.g. Family chat for trip planning and updates"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={120}
              className="w-full px-3.5 py-2 text-sm rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Member Selection Section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                Add Members ({selectedUserIds.length} selected)
              </label>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search users..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3.5 py-2 text-xs rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* User List */}
            <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
              {loadingUsers ? (
                <div className="p-4 text-center text-xs text-neutral-400 flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                  Loading contacts...
                </div>
              ) : filteredUsers.length > 0 ? (
                filteredUsers.map((user) => {
                  const isSelected = selectedUserIds.includes(user.id);
                  return (
                    <div
                      key={user.id}
                      onClick={() => handleToggleUser(user.id)}
                      className={`p-2.5 rounded-2xl flex items-center justify-between cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900'
                          : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 border border-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <UserAvatar
                          src={user.avatar_url}
                          name={user.display_name}
                          id={user.id}
                          className="w-8 h-8 shrink-0"
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-neutral-900 dark:text-neutral-100 truncate">
                            {user.display_name}
                          </p>
                          <p className="text-[10px] text-neutral-500 dark:text-neutral-400 truncate">
                            @{user.username}
                          </p>
                        </div>
                      </div>

                      <div
                        className={`w-5 h-5 rounded-lg flex items-center justify-center transition-colors ${
                          isSelected
                            ? 'bg-blue-600 text-white'
                            : 'border border-neutral-300 dark:border-neutral-700 text-transparent'
                        }`}
                      >
                        <Check className="w-3.5 h-3.5" />
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="p-4 text-center text-xs text-neutral-400">
                  No users found
                </div>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-700 text-xs font-semibold text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !name.trim()}
              className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-md shadow-blue-500/20 disabled:opacity-50 transition-all flex items-center gap-2"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              Create Group
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
