import React, { useState } from 'react';
import { Search, MessageSquarePlus, Trash2, Pin } from 'lucide-react';
import {
  Conversation,
  Profile,
  CallType,
  UserRelationStatus,
  ReportedMessageContext,
  OfficialMessage,
} from '@/src/types';
import { ConversationItem } from '../chat/ConversationItem';
import { ChatWindow } from '../chat/ChatWindow';
import { OfficialChatWindow } from '../chat/OfficialChatWindow';
import { ConversationSkeleton } from '../ui/LoadingSkeleton';
import { EmptyState } from '../ui/EmptyState';
import { VerifiedBadge } from '../ui/VerifiedBadge';
import { OFFICIAL_CHAT_ID } from '@/src/hooks/useOfficialChat';
import { cn, formatDate } from '@/src/lib/utils';
import { useLanguage } from '@/src/lib/LanguageContext';

export interface OfficialChatTabState {
  messages: OfficialMessage[];
  lastMessage: OfficialMessage | null;
  unreadCount: number;
  isVisible: boolean;
  loading: boolean;
  onMarkAsRead: () => Promise<void>;
  onDeleteMessageForMe: (messageId: string) => Promise<void>;
  onClearChatForMe: () => Promise<void>;
}

interface MessagesTabProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  loading: boolean;
  currentUser: Profile | null;
  officialChat?: OfficialChatTabState;
  onSelectConversation: (id: string | null) => void;
  onOpenSearch: () => void;
  onOpenForwardModal?: (message: any) => void;
  onStartCall: (peer: Profile, type: CallType) => void;
  onOpenProfileView: (profile: Profile) => void;
  onDeleteConversation?: (conversationId: string) => void;
  isUserOnline: (profile?: Profile | null) => boolean;
  getUserLastSeen: (profile?: Profile | null) => string;
  getRelationStatus?: (userId: string) => UserRelationStatus;
  onFollow?: (peer: Profile) => Promise<boolean>;
  onUnblock?: (peerId: string) => Promise<boolean>;
  onReportUser?: (
    peer: Profile,
    conversationId?: string,
    reportedMessage?: ReportedMessageContext
  ) => void;
}

export const MessagesTab: React.FC<MessagesTabProps> = ({
  conversations,
  activeConversationId,
  loading,
  currentUser,
  officialChat,
  onSelectConversation,
  onOpenSearch,
  onOpenForwardModal,
  onStartCall,
  onOpenProfileView,
  onDeleteConversation,
  isUserOnline,
  getUserLastSeen,
  getRelationStatus,
  onFollow,
  onUnblock,
  onReportUser,
}) => {
  const { t } = useLanguage();
  const [searchQuery, setSearchQuery] = useState('');
  const [convToDelete, setConvToDelete] = useState<Conversation | null>(null);
  const [confirmDeleteOfficial, setConfirmDeleteOfficial] = useState(false);

  const isOfficialActive = Boolean(
    activeConversationId === OFFICIAL_CHAT_ID && officialChat?.isVisible
  );

  const activeConversation = conversations.find(
    (c) =>
      c.id === activeConversationId ||
      (c as any).original_id === activeConversationId ||
      c.other_member?.id === activeConversationId
  ) || null;
  const activePeerId = activeConversation?.other_member?.id;
  const activeRelationStatus = activePeerId && getRelationStatus ? getRelationStatus(activePeerId) : undefined;

  // On mobile view (<768px), hide list and show chat pane when either Official Chat or a DM is open
  const hasActiveChatOnMobile = Boolean(
    isOfficialActive || (activeConversationId && activeConversation)
  );

  const q = searchQuery.trim().toLowerCase();

  const showPinnedOfficialRow = Boolean(
    officialChat?.isVisible &&
      (!q ||
        'liveconnect official account'.includes(q) ||
        (officialChat.lastMessage?.text || '').toLowerCase().includes(q))
  );

  const filteredConversations = conversations.filter((c) => {
    if (!q) return true;
    const name = c.other_member?.display_name || '';
    const uname = c.other_member?.username || '';
    const lastContent = c.last_message?.content || '';
    return (
      name.toLowerCase().includes(q) ||
      uname.toLowerCase().includes(q) ||
      lastContent.toLowerCase().includes(q)
    );
  });

  const confirmDelete = () => {
    if (convToDelete && onDeleteConversation) {
      onDeleteConversation(convToDelete.id);
      setConvToDelete(null);
    }
  };

  const confirmOfficialDelete = async () => {
    if (!officialChat) return;
    await officialChat.onClearChatForMe();
    setConfirmDeleteOfficial(false);
    if (activeConversationId === OFFICIAL_CHAT_ID) {
      onSelectConversation(null);
    }
  };

  const officialPreviewText = (() => {
    const last = officialChat?.lastMessage;
    if (!last) return 'Official updates from LiveConnect';
    if (last.text?.trim()) return last.imageUrl ? `📷 ${last.text.trim()}` : last.text.trim();
    if (last.imageUrl) return '📷 Photo';
    return 'Official updates from LiveConnect';
  })();

  return (
    <div className="flex-1 flex h-full overflow-hidden relative">
      {/* Delete Conversation Confirmation Modal */}
      {convToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-3xl p-6 max-w-sm w-full shadow-2xl space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400 flex items-center justify-center mx-auto">
              <Trash2 className="w-6 h-6" />
            </div>

            <div className="text-center space-y-1">
              <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-100">
                {t('desc.deleteConversationTitle', 'Delete Conversation?')}
              </h3>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                {convToDelete.other_member?.display_name || convToDelete.other_member?.username || 'User'}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                onClick={() => setConvToDelete(null)}
                className="py-2.5 px-4 rounded-xl border border-neutral-300 dark:border-neutral-700 font-semibold text-xs text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              >
                {t('action.cancel', 'Cancel')}
              </button>
              <button
                onClick={confirmDelete}
                className="py-2.5 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs shadow-md shadow-red-500/20 transition-all active:scale-95"
              >
                {t('action.delete', 'Delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Official Chat (Own Side Only) Modal */}
      {confirmDeleteOfficial && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-3xl p-6 max-w-sm w-full shadow-2xl space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto">
              <Trash2 className="w-6 h-6" />
            </div>

            <div className="text-center space-y-1.5">
              <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-100">
                Delete LiveConnect Official Chat?
              </h3>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
                This clears the chat on your side only. If LiveConnect sends a new message later, it will appear again with only the new message.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => setConfirmDeleteOfficial(false)}
                className="py-2.5 px-4 rounded-xl border border-neutral-300 dark:border-neutral-700 font-semibold text-xs text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
              >
                {t('action.cancel', 'Cancel')}
              </button>
              <button
                type="button"
                onClick={confirmOfficialDelete}
                className="py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-md shadow-rose-500/20 transition-all active:scale-95 cursor-pointer"
              >
                Delete for Me
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Conversation List Column */}
      <div
        className={`${
          hasActiveChatOnMobile ? 'hidden md:flex' : 'flex'
        } flex-col w-full md:w-80 lg:w-96 h-full bg-white dark:bg-neutral-900 border-e border-neutral-200 dark:border-neutral-800 shrink-0`}
      >
        {/* Messages Header */}
        <div className="p-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-extrabold text-neutral-900 dark:text-neutral-100 tracking-tight">
              {t('title.messages', 'Messages')}
            </h2>
            <p className="text-xs text-neutral-500 font-medium">
              {conversations.length} • {t('nav.messages', 'Messages')}
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={onOpenSearch}
              title={t('action.newChat', 'New Chat')}
              className="p-2.5 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-500/20 transition-all hover:scale-105 active:scale-95 flex items-center gap-1.5 text-xs font-semibold"
            >
              <MessageSquarePlus className="w-4 h-4" />
              <span>{t('action.newChat', 'New Chat')}</span>
            </button>
          </div>
        </div>

        {/* Search Filter Input */}
        <div className="px-4 py-2.5">
          <div className="relative">
            <Search className="w-4 h-4 text-neutral-400 absolute start-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder={t('desc.searchConversations', 'Search conversations...')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full ps-9 pe-3.5 py-2 text-base rounded-xl bg-neutral-100 dark:bg-neutral-800/80 border border-transparent focus:border-neutral-300 dark:focus:border-neutral-700 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:bg-white dark:focus:bg-neutral-900 transition-all"
            />
          </div>
        </div>

        {/* Conversation Items List */}
        <div className="flex-1 overflow-y-auto px-2 py-1 pb-24 md:pb-4 space-y-1">
          {/* Pinned Verified Official LiveConnect Chat */}
          {showPinnedOfficialRow && officialChat && (
            <div
              role="button"
              tabIndex={0}
              onClick={() => onSelectConversation(OFFICIAL_CHAT_ID)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectConversation(OFFICIAL_CHAT_ID);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setConfirmDeleteOfficial(true);
              }}
              className={cn(
                'w-full text-start p-3 rounded-2xl flex items-center gap-3 transition-all relative group cursor-pointer select-none border',
                isOfficialActive
                  ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-500/10'
                  : 'bg-sky-50/70 dark:bg-sky-950/20 hover:bg-sky-100/70 dark:hover:bg-sky-950/35 border-sky-200/70 dark:border-sky-800/40 text-neutral-900 dark:text-neutral-100'
              )}
            >
              <div className="relative shrink-0">
                <img
                  src="/icon.svg"
                  alt="LiveConnect"
                  className="w-12 h-12 rounded-2xl object-cover border border-black/10 dark:border-white/10 bg-neutral-900"
                />
                <span
                  title="Pinned"
                  className={cn(
                    'absolute -bottom-1 -end-1 w-5 h-5 rounded-full flex items-center justify-center border shadow-xs',
                    isOfficialActive
                      ? 'bg-white text-blue-600 border-blue-600'
                      : 'bg-white dark:bg-neutral-900 text-sky-600 dark:text-sky-400 border-sky-200 dark:border-sky-800'
                  )}
                >
                  <Pin className="w-2.5 h-2.5" />
                </span>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1 mb-1">
                  <div className="flex items-center gap-1 min-w-0 flex-1">
                    <h4
                      className={cn(
                        'font-bold text-sm truncate',
                        isOfficialActive ? 'text-white' : 'text-neutral-900 dark:text-neutral-100'
                      )}
                    >
                      LiveConnect
                    </h4>
                    <VerifiedBadge
                      size="xs"
                      className={isOfficialActive ? 'text-white' : undefined}
                    />
                  </div>
                  {officialChat.lastMessage?.createdAt && (
                    <span
                      className={cn(
                        'text-[11px] shrink-0 font-medium tabular-nums',
                        isOfficialActive ? 'text-blue-100' : 'text-neutral-400'
                      )}
                    >
                      {formatDate(officialChat.lastMessage.createdAt)}
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2">
                  <p
                    className={cn(
                      'text-xs truncate flex-1 min-w-0',
                      isOfficialActive ? 'text-blue-100' : 'text-neutral-600 dark:text-neutral-400'
                    )}
                  >
                    {officialPreviewText}
                  </p>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDeleteOfficial(true);
                    }}
                    title="Delete Official Chat for me"
                    className={cn(
                      'hidden sm:flex opacity-0 group-hover:opacity-100 p-1.5 rounded-xl transition-all shrink-0 cursor-pointer',
                      isOfficialActive
                        ? 'hover:bg-blue-700 text-white'
                        : 'hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/50 dark:hover:text-rose-400 text-neutral-400'
                    )}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>

                  {!isOfficialActive && officialChat.unreadCount > 0 && (
                    <span className="shrink-0 px-2 py-0.5 text-[11px] font-bold rounded-full min-w-[20px] text-center shadow-sm bg-blue-600 text-white tabular-nums">
                      {officialChat.unreadCount > 99 ? '99+' : officialChat.unreadCount}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {loading && conversations.length === 0 ? (
            <ConversationSkeleton />
          ) : filteredConversations.length > 0 ? (
            filteredConversations.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isSelected={conv.id === activeConversationId}
                isOnline={isUserOnline(conv.other_member)}
                currentUserId={currentUser?.id}
                onSelect={() => onSelectConversation(conv.id)}
                onDelete={() => setConvToDelete(conv)}
              />
            ))
          ) : conversations.length === 0 ? (
            showPinnedOfficialRow ? null : (
              <EmptyState
                type="no-conversations"
                onAction={onOpenSearch}
                actionLabel={t('desc.findPeopleToChat', 'Find People to Chat')}
              />
            )
          ) : !showPinnedOfficialRow ? (
            <div className="p-8 text-center text-xs text-neutral-400">
              {t('desc.noUsersFound', 'No user found')} &quot;{searchQuery}&quot;
            </div>
          ) : null}
        </div>
      </div>

      {/* Active Conversation or Official Chat Window */}
      <div
        className={`${
          !hasActiveChatOnMobile ? 'hidden md:flex' : 'flex'
        } flex-1 h-full overflow-hidden`}
      >
        {isOfficialActive && officialChat ? (
          <OfficialChatWindow
            messages={officialChat.messages}
            unreadCount={officialChat.unreadCount}
            loading={officialChat.loading}
            onBack={() => onSelectConversation(null)}
            onMarkAsRead={officialChat.onMarkAsRead}
            onDeleteMessageForMe={officialChat.onDeleteMessageForMe}
            onClearChatForMe={officialChat.onClearChatForMe}
          />
        ) : (
          <ChatWindow
            key={activeConversationId || 'no-active-chat'}
            conversation={activeConversation}
            currentUser={currentUser}
            isOnline={isUserOnline(activeConversation?.other_member)}
            lastSeenString={getUserLastSeen(activeConversation?.other_member)}
            onBack={() => onSelectConversation(null)}
            onStartCall={onStartCall}
            onOpenProfileView={onOpenProfileView}
            onDeleteConversation={onDeleteConversation}
            onOpenForwardModal={onOpenForwardModal}
            relationStatus={activeRelationStatus}
            onFollow={onFollow}
            onUnblock={onUnblock}
            onReportUser={onReportUser}
          />
        )}
      </div>
    </div>
  );
};

