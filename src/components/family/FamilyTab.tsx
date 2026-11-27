import React, { useState } from 'react';
import {
  Users,
  Plus,
  Link2,
  BellOff,
  Crown,
  Shield,
  Clock,
  Check,
  X,
  Search,
} from 'lucide-react';
import { Conversation, FamilyInvite, FamilyMembership, Profile } from '@/src/types';
import { isFamilyMembershipMuted } from '@/src/lib/family/constants';
import { UserAvatar } from '../ui/UserAvatar';
import { CreateFamilyModal } from './CreateFamilyModal';
import { JoinFamilyModal } from './JoinFamilyModal';
import { FamilyChatWindow } from './FamilyChatWindow';
import { useLanguage } from '@/src/lib/LanguageContext';
import { cn, formatMessagePreview, formatTime } from '@/src/lib/utils';

interface FamilyTabProps {
  currentUser: Profile | null;
  memberships: FamilyMembership[];
  invites: FamilyInvite[];
  activeFamilyId: string | null;
  loading: boolean;
  dmConversations: Conversation[];
  onSelectFamily: (familyId: string | null) => void;
  onCreateFamily: (params: {
    name: string;
    photoUrl?: string | null;
    joinApprovalRequired?: boolean;
    relationTag?: string | null;
  }) => Promise<any>;
  onRespondInvite: (inviteId: string, action: 'accept' | 'decline') => Promise<any>;
  onJoinByCode: (code: string) => Promise<{ status: 'active' | 'pending'; familyId: string; familyName?: string }>;
  onSearchUsers: (queryText: string) => Promise<Profile[]>;
  onShareInviteToDm?: (conversationId: string, inviteText: string) => Promise<void>;
  onRefreshFamilies: () => void;
  externalJoinOpen?: boolean;
  onCloseExternalJoin?: () => void;
}

export const FamilyTab: React.FC<FamilyTabProps> = ({
  currentUser,
  memberships,
  invites,
  activeFamilyId,
  loading,
  dmConversations,
  onSelectFamily,
  onCreateFamily,
  onRespondInvite,
  onJoinByCode,
  onSearchUsers,
  onShareInviteToDm,
  onRefreshFamilies,
}) => {
  const { t } = useLanguage();
  const [searchQuery, setSearchQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [respondingId, setRespondingId] = useState<string | null>(null);

  const activeMembership = memberships.find((m) => m.familyId === activeFamilyId) || null;
  const hasActiveFamilyOnMobile = Boolean(activeFamilyId && activeMembership);

  const filteredMemberships = memberships.filter((m) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (m.family?.name || '').toLowerCase().includes(q) ||
      (m.family?.lastMessageText || '').toLowerCase().includes(q)
    );
  });

  const handleRespondInvite = async (inviteId: string, action: 'accept' | 'decline') => {
    setRespondingId(inviteId);
    try {
      await onRespondInvite(inviteId, action);
    } finally {
      setRespondingId(null);
    }
  };

  return (
    <div className="flex-1 flex h-full overflow-hidden relative">
      {/* Left Family List Column */}
      <div
        className={cn(
          hasActiveFamilyOnMobile ? 'hidden md:flex' : 'flex',
          'flex-col w-full md:w-80 lg:w-96 h-full bg-white dark:bg-neutral-900 border-e border-neutral-200 dark:border-neutral-800 shrink-0'
        )}
      >
        {/* Header */}
        <div className="p-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-xl font-extrabold text-neutral-900 dark:text-neutral-100 tracking-tight">
              {t('nav.family', 'Family')}
            </h2>
            <p className="text-xs text-neutral-500 font-medium">
              {memberships.length} {memberships.length === 1 ? 'Family' : 'Families'}
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setJoinOpen(true)}
              title="Join with link"
              className="p-2.5 rounded-2xl bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 transition-colors flex items-center gap-1 text-xs font-bold cursor-pointer"
            >
              <Link2 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span className="hidden sm:inline">Join</span>
            </button>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="px-3 py-2.5 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-500/20 transition-all active:scale-95 flex items-center gap-1.5 text-xs font-bold cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Create Family</span>
            </button>
          </div>
        </div>

        {/* Search Input */}
        {memberships.length > 0 && (
          <div className="px-4 py-2.5">
            <div className="relative">
              <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search Families..."
                className="w-full pl-9 pr-3 py-2 rounded-2xl bg-neutral-100 dark:bg-neutral-800/80 text-xs text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
            </div>
          </div>
        )}

        {/* List Scroll */}
        <div className="flex-1 overflow-y-auto px-3 pb-24 md:pb-4 space-y-2">
          {/* Pending Direct Invites */}
          {invites.length > 0 && (
            <div className="space-y-2 pt-1 pb-2">
              <p className="px-1 text-[11px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                Family Invites ({invites.length})
              </p>
              {invites.map((inv) => (
                <div
                  key={inv.id}
                  className="p-3 rounded-2xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/60 space-y-2.5"
                >
                  <div className="flex items-center gap-2.5">
                    <UserAvatar
                      src={inv.familyPhotoUrl}
                      name={inv.familyName}
                      id={inv.familyId}
                      className="w-10 h-10 rounded-2xl shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <h4 className="text-xs font-extrabold text-neutral-900 dark:text-neutral-100 truncate">
                        {inv.familyName}
                      </h4>
                      <p className="text-[11px] text-neutral-600 dark:text-neutral-300 truncate">
                        Invited by {inv.inviterName}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      disabled={respondingId === inv.id}
                      onClick={() => handleRespondInvite(inv.id, 'accept')}
                      className="py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Accept</span>
                    </button>
                    <button
                      type="button"
                      disabled={respondingId === inv.id}
                      onClick={() => handleRespondInvite(inv.id, 'decline')}
                      className="py-1.5 rounded-xl bg-neutral-200 dark:bg-neutral-800 hover:bg-neutral-300 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-300 text-xs font-semibold flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Decline</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Families List or Empty State */}
          {loading && memberships.length === 0 ? (
            <div className="py-12 text-center text-xs text-neutral-500">
              Loading your Families...
            </div>
          ) : filteredMemberships.length === 0 && invites.length === 0 ? (
            <div className="py-14 px-4 flex flex-col items-center text-center space-y-3">
              <div className="w-16 h-16 rounded-3xl bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                <Users className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-extrabold text-neutral-900 dark:text-neutral-100">
                  No Family Groups Yet
                </h3>
                <p className="text-xs text-neutral-500 max-w-xs">
                  Create a private Family space for your relatives or join an existing one with an invite link.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  className="px-4 py-2.5 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-md shadow-blue-500/20 flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Create Family</span>
                </button>
                <button
                  type="button"
                  onClick={() => setJoinOpen(true)}
                  className="px-4 py-2.5 rounded-2xl bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Link2 className="w-4 h-4" />
                  <span>Join with link</span>
                </button>
              </div>
            </div>
          ) : (
            filteredMemberships.map((m) => {
              const fam = m.family;
              if (!fam) return null;
              const isSelected = activeFamilyId === m.familyId;
              const muted = isFamilyMembershipMuted(m);
              const isPrivileged = m.role === 'owner' || m.role === 'admin';
              const pendingReqCount = isPrivileged ? fam.pendingRequestsCount || 0 : 0;

              return (
                <button
                  key={m.familyId}
                  type="button"
                  onClick={() => onSelectFamily(m.familyId)}
                  className={cn(
                    'w-full p-3 rounded-2xl flex items-center gap-3 transition-all text-left cursor-pointer border',
                    isSelected
                      ? 'bg-blue-50/90 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800 shadow-2xs'
                      : 'bg-transparent border-transparent hover:bg-neutral-100/80 dark:hover:bg-neutral-800/60'
                  )}
                >
                  <UserAvatar
                    src={fam.photoUrl}
                    name={fam.name}
                    id={fam.id}
                    className="w-12 h-12 rounded-2xl shrink-0"
                  />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <h4 className="text-sm font-bold text-neutral-900 dark:text-neutral-100 truncate">
                          {fam.name}
                        </h4>
                        {m.role === 'owner' && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded-md bg-amber-100 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 text-[9.5px] font-bold shrink-0">
                            <Crown className="w-2.5 h-2.5" /> Owner
                          </span>
                        )}
                        {m.role === 'admin' && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded-md bg-blue-100 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 text-[9.5px] font-bold shrink-0">
                            <Shield className="w-2.5 h-2.5" /> Admin
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {muted && <BellOff className="w-3.5 h-3.5 text-neutral-400" />}
                        {fam.lastMessageAt && (
                          <span className="text-[10px] text-neutral-400 font-medium">
                            {formatTime(fam.lastMessageAt)}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      {m.status === 'pending' ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                          <Clock className="w-3 h-3" />
                          Waiting for approval
                        </span>
                      ) : fam.lastMessageText ? (
                        <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                          {fam.lastMessageSenderName && fam.lastMessageSenderId !== 'system' ? (
                            <span className="font-semibold text-neutral-700 dark:text-neutral-300">
                              {fam.lastMessageSenderName}:{' '}
                            </span>
                          ) : null}
                          {formatMessagePreview(fam.lastMessageText)}
                        </p>
                      ) : (
                        <p className="text-xs text-neutral-400 truncate">
                          {fam.memberCount.toLocaleString()} member{fam.memberCount === 1 ? '' : 's'}
                        </p>
                      )}

                      <div className="flex items-center gap-1 shrink-0">
                        {pendingReqCount > 0 && (
                          <span className="px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-[10px] font-bold">
                            {pendingReqCount} req
                          </span>
                        )}
                        {m.status === 'active' && m.unreadCount > 0 && !isSelected && (
                          <span
                            className={cn(
                              'min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center text-white',
                              muted ? 'bg-neutral-400 dark:bg-neutral-600' : 'bg-blue-600'
                            )}
                          >
                            {m.unreadCount > 99 ? '99+' : m.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Right Family Chat Pane */}
      <div
        className={cn(
          hasActiveFamilyOnMobile ? 'flex' : 'hidden md:flex',
          'flex-1 flex-col h-full overflow-hidden'
        )}
      >
        <FamilyChatWindow
          familyId={activeFamilyId}
          currentUser={currentUser}
          dmConversations={dmConversations}
          onSearchUsers={onSearchUsers}
          onShareInviteToDm={onShareInviteToDm}
          onBack={() => onSelectFamily(null)}
          onFamilyListChanged={onRefreshFamilies}
        />
      </div>

      {/* Create Family Modal */}
      <CreateFamilyModal
        isOpen={createOpen}
        currentUser={currentUser}
        onClose={() => setCreateOpen(false)}
        onCreate={onCreateFamily}
      />

      {/* Join with Link Modal */}
      <JoinFamilyModal
        isOpen={joinOpen}
        currentUser={currentUser}
        onClose={() => setJoinOpen(false)}
        onConfirmJoin={onJoinByCode}
        onOpenFamily={(fid) => onSelectFamily(fid)}
      />
    </div>
  );
};
