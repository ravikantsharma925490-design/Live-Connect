import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BellOff,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  Info,
  Languages,
  Loader2,
  Pin,
  ShieldAlert,
  Users,
  X,
  Check,
} from 'lucide-react';
import {
  Conversation,
  FamilyMessage,
  FamilyPinnedMessage,
  Message,
  Profile,
} from '@/src/types';
import { useFamilyChat } from '@/src/hooks/useFamilyChat';
import { getFamilyMessageSeenInfo } from '@/src/lib/family/familyService';
import {
  FAMILY_LARGE_THRESHOLD,
  FAMILY_MAX_PINNED_MESSAGES,
  isFamilyMembershipMuted,
} from '@/src/lib/family/constants';
import { UserAvatar } from '../ui/UserAvatar';
import { MessageBubble } from '../chat/MessageBubble';
import { ChatInput } from '../chat/ChatInput';
import { TypingBubble } from '../chat/TypingBubble';
import { ImageViewerModal } from '../chat/ImageViewerModal';
import { TranslateLanguageModal } from '../chat/TranslateLanguageModal';
import { FamilyInfoDrawerModal } from './FamilyInfoDrawerModal';
import { FamilyReportModal } from './FamilyReportModal';
import { useLanguage } from '@/src/lib/LanguageContext';
import { WorldLanguage } from '@/src/lib/worldData';
import {
  getChatTranslationSettings,
  resolveWorldLanguage,
  saveChatTranslationSettings,
} from '@/src/lib/messageTranslation';
import { cn, formatChatDateHeader, formatMessagePreview, isDifferentDay } from '@/src/lib/utils';

interface FamilyChatWindowProps {
  familyId: string | null;
  currentUser: Profile | null;
  dmConversations: Conversation[];
  onSearchUsers: (queryText: string) => Promise<Profile[]>;
  onShareInviteToDm?: (conversationId: string, inviteText: string) => Promise<void>;
  onBack: () => void;
  onFamilyListChanged: () => void;
}

export const FamilyChatWindow: React.FC<FamilyChatWindowProps> = ({
  familyId,
  currentUser,
  dmConversations,
  onSearchUsers,
  onShareInviteToDm,
  onBack,
  onFamilyListChanged,
}) => {
  const { t, currentLanguage } = useLanguage();
  const {
    family,
    membership,
    messages,
    typingUsers,
    loading,
    hasMore,
    removedNotice,
    refreshFamilyChat,
    loadOlderMessages,
    sendMessage,
    sendSafeCheckIn,
    reactToMessage,
    pinMessage,
    removeMessage,
    notifyTyping,
    searchMentionMembers,
  } = useFamilyChat(familyId, currentUser);

  const [infoOpen, setInfoOpen] = useState(false);
  const [replyingTo, setReplyingTo] = useState<FamilyMessage | null>(null);
  const [reportingMsg, setReportingMsg] = useState<FamilyMessage | null>(null);
  const [viewingImage, setViewingImage] = useState<{ url: string; caption?: string } | null>(null);
  const [activePinIndex, setActivePinIndex] = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const [seenModal, setSeenModal] = useState<{
    messageId: string;
    loading: boolean;
    count: number;
    readers: Array<{ userId: string; displayName: string; readAt: string }>;
    isLargeFamily: boolean;
  } | null>(null);

  const translationScopeKey = familyId ? `family_${familyId}` : undefined;
  const [translationSettings, setTranslationSettings] = useState(() =>
    getChatTranslationSettings(translationScopeKey)
  );
  const [translatePickerState, setTranslatePickerState] = useState<{
    isOpen: boolean;
    selectedCode: string;
    title?: string;
    onPicked?: (lang: WorldLanguage) => void;
  }>({ isOpen: false, selectedCode: currentLanguage.code });

  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef(true);
  const prevTailIdRef = useRef<string | null>(null);

  useEffect(() => {
    setReplyingTo(null);
    setInfoOpen(false);
    setReportingMsg(null);
    setSeenModal(null);
    setActivePinIndex(0);
    setTranslationSettings(getChatTranslationSettings(translationScopeKey));
    isNearBottomRef.current = true;
    prevTailIdRef.current = null;
  }, [familyId, translationScopeKey]);

  const snapToBottom = useCallback(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  useLayoutEffect(() => {
    isNearBottomRef.current = true;
    snapToBottom();
  }, [familyId, snapToBottom]);

  useLayoutEffect(() => {
    const tail = messages[messages.length - 1]?.id || null;
    const isNewTail = prevTailIdRef.current !== tail;
    prevTailIdRef.current = tail;
    if (isNewTail && isNearBottomRef.current) {
      snapToBottom();
    }
  }, [messages.length, messages, snapToBottom]);

  const isOwnerOrAdmin = membership?.role === 'owner' || membership?.role === 'admin';
  const isMuted = membership ? isFamilyMembershipMuted(membership) : false;
  const pinnedList: FamilyPinnedMessage[] = family?.pinnedMessages || [];
  const safePinIndex = pinnedList.length > 0 ? Math.min(activePinIndex, pinnedList.length - 1) : 0;
  const activePin = pinnedList[safePinIndex] || null;

  const activeTargetLang = useMemo(
    () =>
      translationSettings.customLangCode
        ? resolveWorldLanguage(translationSettings.customLangCode)
        : currentLanguage,
    [translationSettings.customLangCode, currentLanguage]
  );

  const handleOpenTranslatePicker = useCallback(
    (selectedCode: string, onPicked: (lang: WorldLanguage) => void, title?: string) => {
      setTranslatePickerState({
        isOpen: true,
        selectedCode,
        title,
        onPicked,
      });
    },
    []
  );

  // Convert FamilyMessage to Message shape for shared MessageBubble reuse
  const adaptedMessages = useMemo(() => {
    return messages.map((fm) => {
      const senderProfile: Profile = {
        id: fm.senderId,
        username: fm.senderUsername || fm.senderName.toLowerCase().replace(/\s+/g, '_'),
        display_name: fm.senderName,
        avatar_url: fm.senderAvatar || null,
        bio: '',
        is_online: false,
        last_seen: fm.createdAt,
        created_at: fm.createdAt,
        updated_at: fm.updatedAt,
      };
      const adapted: Message = {
        id: fm.id,
        conversation_id: fm.familyId,
        sender_id: fm.senderId,
        content: fm.isDeleted ? 'This message was deleted' : fm.content,
        created_at: fm.createdAt,
        updated_at: fm.updatedAt,
        is_read: true,
        sender: senderProfile,
        reply_to_message_id: fm.replyToMessageId || null,
        reply_to_message: fm.replyToMessage
          ? ({
              id: fm.replyToMessage.id,
              conversation_id: fm.familyId,
              sender_id: fm.replyToMessage.senderId,
              content: fm.replyToMessage.content,
              created_at: fm.createdAt,
              updated_at: fm.createdAt,
              is_read: true,
              sender: {
                id: fm.replyToMessage.senderId,
                username: '',
                display_name: fm.replyToMessage.senderName,
                avatar_url: null,
                bio: '',
                is_online: false,
                last_seen: '',
                created_at: '',
                updated_at: '',
              },
            } as Message)
          : null,
        reactions: fm.reactions || {},
        mentions: fm.mentions || [],
        is_pinned: fm.isPinned,
      };
      return { raw: fm, adapted };
    });
  }, [messages]);

  const adaptedById = useMemo(() => {
    const map = new Map<string, Message>();
    adaptedMessages.forEach(({ adapted }) => map.set(adapted.id, adapted));
    return map;
  }, [adaptedMessages]);

  const rawById = useMemo(() => {
    const map = new Map<string, FamilyMessage>();
    messages.forEach((m) => map.set(m.id, m));
    return map;
  }, [messages]);

  const handleChatSendMessage = useCallback(
    async (rawContent: string, mentions?: string[]): Promise<boolean> => {
      if (!family || !membership) return false;
      let content = rawContent;
      let replyTarget = replyingTo;

      if (content.startsWith('[REPLY:')) {
        const endIdx = content.indexOf(']');
        if (endIdx !== -1) {
          const parsedId = content.slice(7, endIdx);
          replyTarget = replyTarget || rawById.get(parsedId) || null;
          content = content.slice(endIdx + 1).trim();
        }
      }

      const detectedType = content.startsWith('[IMAGE:')
        ? 'image'
        : content.startsWith('[VOICE:')
          ? 'voice'
          : content.startsWith('[STICKER:')
            ? 'sticker'
            : 'text';

      await sendMessage({
        type: detectedType,
        content,
        replyToMessage: replyTarget,
        mentions: mentions || [],
      });
      setReplyingTo(null);
      onFamilyListChanged();
      return true;
    },
    [family, membership, replyingTo, rawById, sendMessage, onFamilyListChanged]
  );

  const handleShowSeenDetails = useCallback(
    async (messageId: string) => {
      if (!currentUser?.id || !family) return;
      setSeenModal({
        messageId,
        loading: true,
        count: 0,
        readers: [],
        isLargeFamily: family.memberCount > FAMILY_LARGE_THRESHOLD,
      });
      const info = await getFamilyMessageSeenInfo(
        currentUser.id,
        family.id,
        messageId,
        family.memberCount
      );
      setSeenModal({
        messageId,
        loading: false,
        count: info.count,
        readers: info.readers,
        isLargeFamily: info.isLargeFamily,
      });
    },
    [currentUser?.id, family]
  );

  const jumpToMessage = (messageId: string) => {
    const el = document.getElementById(`msg-${messageId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-2', 'ring-amber-400', 'bg-amber-100/40', 'dark:bg-amber-900/30');
      setTimeout(() => {
        el.classList.remove('ring-2', 'ring-amber-400', 'bg-amber-100/40', 'dark:bg-amber-900/30');
      }, 2000);
    }
  };

  if (!familyId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-neutral-50 dark:bg-neutral-950">
        <div className="w-16 h-16 rounded-3xl bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-3">
          <Users className="w-8 h-8" />
        </div>
        <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-100">
          Select a Family
        </h3>
        <p className="text-xs text-neutral-500 mt-1 max-w-xs">
          Pick a Family from the list or create a new one to start chatting together.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-neutral-50 dark:bg-neutral-950 overflow-hidden relative">
      {/* Header — ZERO audio/video call buttons inside Family chat */}
      <header className="px-3 sm:px-4 py-3 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-2 shrink-0 z-10">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <button
            type="button"
            onClick={onBack}
            className="md:hidden p-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300 cursor-pointer shrink-0"
            title="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={() => family && setInfoOpen(true)}
            className="flex items-center gap-2.5 min-w-0 text-left hover:opacity-85 transition-opacity cursor-pointer flex-1"
          >
            <UserAvatar
              src={family?.photoUrl}
              name={family?.name || 'Family'}
              id={familyId}
              className="w-10 h-10 rounded-2xl shrink-0"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <h3 className="text-sm font-extrabold text-neutral-900 dark:text-neutral-100 truncate">
                  {family?.name || 'Family'}
                </h3>
                {isMuted && <BellOff className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
              </div>
              <p className="text-[11px] text-neutral-500 truncate">
                {family
                  ? `${family.memberCount.toLocaleString()} member${family.memberCount === 1 ? '' : 's'}${
                      family.memberCount > FAMILY_LARGE_THRESHOLD
                        ? ' • Presence hidden'
                        : ''
                    }`
                  : 'Loading...'}
              </p>
            </div>
          </button>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {translationScopeKey && (
            <button
              type="button"
              onClick={() => {
                const updated = saveChatTranslationSettings(translationScopeKey, {
                  autoTranslate: !translationSettings.autoTranslate,
                });
                setTranslationSettings(updated);
              }}
              title="Toggle Auto-Translate (106+ languages)"
              className={cn(
                'p-2 rounded-xl transition-colors cursor-pointer',
                translationSettings.autoTranslate
                  ? 'bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400'
                  : 'text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800'
              )}
            >
              <Languages className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => family && setInfoOpen(true)}
            title="Family Info & Members"
            className="p-2 rounded-xl text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
          >
            <Info className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Removed or Pending States */}
      {removedNotice ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center gap-3">
          <div className="w-14 h-14 rounded-3xl bg-rose-500/10 text-rose-500 flex items-center justify-center">
            <ShieldAlert className="w-7 h-7" />
          </div>
          <h4 className="text-base font-bold text-neutral-900 dark:text-neutral-100">
            Removed from Family
          </h4>
          <p className="text-xs text-neutral-500 max-w-xs">{removedNotice}</p>
          <button
            type="button"
            onClick={onBack}
            className="px-4 py-2 rounded-xl bg-neutral-200 dark:bg-neutral-800 text-xs font-bold cursor-pointer"
          >
            Back to Families
          </button>
        </div>
      ) : membership?.status === 'pending' ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center gap-3">
          <div className="w-14 h-14 rounded-3xl bg-amber-500/15 text-amber-500 flex items-center justify-center">
            <Clock className="w-7 h-7" />
          </div>
          <h4 className="text-base font-bold text-neutral-900 dark:text-neutral-100">
            Waiting for approval
          </h4>
          <p className="text-xs text-neutral-500 max-w-sm">
            Your request to join <strong>{family?.name || 'this Family'}</strong> is pending review by the Owner or an Admin. Chat history and member lists stay hidden until approved.
          </p>
        </div>
      ) : (
        <>
          {/* Up to 3 Pinned Messages Banner */}
          {activePin && (
            <div className="bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800/60 px-3.5 py-2 flex items-center justify-between gap-2 text-xs shrink-0 z-10">
              <button
                type="button"
                onClick={() => jumpToMessage(activePin.messageId)}
                className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer hover:opacity-85"
              >
                <div className="p-1 rounded-md bg-amber-100 dark:bg-amber-900/80 text-amber-600 dark:text-amber-400 shrink-0">
                  <Pin className="w-3.5 h-3.5 fill-amber-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[10.5px] font-bold text-amber-800 dark:text-amber-300">
                    <span>
                      Pinned ({safePinIndex + 1}/{Math.min(pinnedList.length, FAMILY_MAX_PINNED_MESSAGES)})
                    </span>
                    <span className="font-normal opacity-80">• {activePin.senderName}</span>
                  </div>
                  <p className="text-amber-900 dark:text-amber-200 truncate font-medium">
                    {formatMessagePreview(activePin.content)}
                  </p>
                </div>
              </button>

              <div className="flex items-center gap-1 shrink-0">
                {pinnedList.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={() => setActivePinIndex((i) => (i - 1 + pinnedList.length) % pinnedList.length)}
                      className="p-1 rounded-lg text-amber-700 dark:text-amber-300 hover:bg-amber-200/50 dark:hover:bg-amber-900/50 cursor-pointer"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setActivePinIndex((i) => (i + 1) % pinnedList.length)}
                      className="p-1 rounded-lg text-amber-700 dark:text-amber-300 hover:bg-amber-200/50 dark:hover:bg-amber-900/50 cursor-pointer"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
                {isOwnerOrAdmin && (
                  <button
                    type="button"
                    onClick={() => {
                      const target = rawById.get(activePin.messageId) || ({
                        id: activePin.messageId,
                        familyId: familyId,
                        senderId: activePin.senderId,
                        senderName: activePin.senderName,
                        type: 'text',
                        content: activePin.content,
                        mentions: [],
                        reactions: {},
                        isPinned: true,
                        isDeleted: false,
                        createdAt: activePin.pinnedAt,
                        updatedAt: activePin.pinnedAt,
                      } as FamilyMessage);
                      void pinMessage(target);
                    }}
                    title="Unpin message"
                    className="p-1 rounded-lg text-amber-700 dark:text-amber-300 hover:bg-amber-200/50 dark:hover:bg-amber-900/50 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Auto-Translate Banner */}
          {translationSettings.autoTranslate && translationScopeKey && (
            <div className="bg-indigo-50/90 dark:bg-indigo-950/40 border-b border-indigo-200/80 dark:border-indigo-800/50 px-4 py-1.5 flex items-center justify-between gap-2 text-xs shrink-0">
              <span className="text-indigo-900 dark:text-indigo-200 truncate flex items-center gap-1.5">
                <Languages className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                Auto-translating to{' '}
                <strong>
                  {activeTargetLang.flag} {activeTargetLang.nativeName}
                </strong>
              </span>
              <button
                type="button"
                onClick={() =>
                  handleOpenTranslatePicker(
                    activeTargetLang.code,
                    (picked) => {
                      setTranslationSettings(
                        saveChatTranslationSettings(translationScopeKey, { customLangCode: picked.code })
                      );
                    },
                    'Family Translation Language'
                  )
                }
                className="px-2 py-0.5 rounded-lg bg-indigo-600 text-white font-semibold text-[11px] cursor-pointer shrink-0"
              >
                Change
              </button>
            </div>
          )}

          {/* Messages Feed */}
          <div
            ref={chatScrollRef}
            onScroll={() => {
              const el = chatScrollRef.current;
              if (!el) return;
              isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 65;
            }}
            className="flex-1 overflow-y-auto p-3 sm:p-4 [scrollbar-gutter:stable]"
          >
            <div className="flex flex-col min-h-full">
              <div className="flex-1 min-h-0 shrink-0" />

              {hasMore && (
                <div className="flex justify-center mb-3">
                  <button
                    type="button"
                    disabled={loadingOlder}
                    onClick={async () => {
                      setLoadingOlder(true);
                      await loadOlderMessages();
                      setLoadingOlder(false);
                    }}
                    className="px-3.5 py-1.5 rounded-full bg-neutral-200/80 dark:bg-neutral-800 text-xs font-semibold text-neutral-700 dark:text-neutral-300 hover:bg-neutral-300 dark:hover:bg-neutral-700 cursor-pointer flex items-center gap-1.5"
                  >
                    {loadingOlder && <Loader2 className="w-3 h-3 animate-spin" />}
                    <span>Load older messages</span>
                  </button>
                </div>
              )}

              {loading && adaptedMessages.length === 0 ? (
                <div className="py-16 flex flex-col items-center justify-center gap-2 text-xs text-neutral-500">
                  <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                  <span>Loading Family chat...</span>
                </div>
              ) : adaptedMessages.length === 0 ? (
                <div className="my-auto py-12 text-center space-y-2">
                  <div className="w-12 h-12 rounded-2xl bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto">
                    <Users className="w-6 h-6" />
                  </div>
                  <p className="text-sm font-bold text-neutral-800 dark:text-neutral-200">
                    Welcome to {family?.name || 'Family'}!
                  </p>
                  <p className="text-xs text-neutral-500 max-w-xs mx-auto">
                    Say hello or tap &quot;I&apos;m Safe&quot; to check in with everyone.
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  {adaptedMessages.map(({ raw, adapted }, idx) => {
                    const isMine = raw.senderId === currentUser?.id;
                    const prev = adaptedMessages[idx - 1]?.raw;
                    const showDateHeader = !prev || isDifferentDay(prev.createdAt, raw.createdAt);
                    const showAvatar =
                      !isMine && (!prev || prev.senderId !== raw.senderId || prev.type === 'system' || showDateHeader);
                    const canDelete = !raw.isDeleted && raw.type !== 'system' && (isMine || isOwnerOrAdmin);

                    return (
                      <React.Fragment key={raw.id}>
                        {showDateHeader && (
                          <div className="flex items-center justify-center my-3 select-none">
                            <div className="px-3 py-1 rounded-full bg-neutral-200/90 dark:bg-neutral-800/90 text-[11px] font-semibold text-neutral-600 dark:text-neutral-300 border border-neutral-300/40 dark:border-neutral-700/60">
                              {formatChatDateHeader(raw.createdAt)}
                            </div>
                          </div>
                        )}

                        <MessageBubble
                          message={adapted}
                          isMine={isMine}
                          showAvatar={showAvatar}
                          isFamilyMode={true}
                          currentUserId={currentUser?.id}
                          senderRelationTag={raw.senderRelationTag}
                          senderRoleBadge={raw.senderRole}
                          isSystemMessage={raw.type === 'system'}
                          isSafeCheckIn={raw.type === 'safe_checkin'}
                          isDeletedTombstone={raw.isDeleted}
                          seenCount={raw.seenCount || 0}
                          onShowSeenDetails={handleShowSeenDetails}
                          onViewImage={(url, caption) => setViewingImage({ url, caption })}
                          onReplyMessage={
                            !raw.isDeleted && raw.type !== 'system'
                              ? () => setReplyingTo(raw)
                              : undefined
                          }
                          onReactMessage={
                            !raw.isDeleted && raw.type !== 'system'
                              ? (mid, emoji) => void reactToMessage(mid, emoji)
                              : undefined
                          }
                          onPinMessage={
                            isOwnerOrAdmin && !raw.isDeleted && raw.type !== 'system'
                              ? () => void pinMessage(raw)
                              : undefined
                          }
                          onDeleteMessage={
                            canDelete ? (mid) => { const target = rawById.get(mid); if (target) void removeMessage(target); } : undefined
                          }
                          onReportMessage={
                            !isMine && !raw.isDeleted && raw.type !== 'system'
                              ? () => setReportingMsg(raw)
                              : undefined
                          }
                          resolveReplyMessage={(id) => adaptedById.get(id) || adapted.reply_to_message || undefined}
                          isPinned={raw.isPinned}
                          defaultTargetLang={activeTargetLang}
                          autoTranslate={translationSettings.autoTranslate}
                          onOpenTranslatePicker={handleOpenTranslatePicker}
                        />
                      </React.Fragment>
                    );
                  })}
                </div>
              )}

              {/* Typing indicator ONLY when <= 50 members */}
              {family && family.memberCount <= FAMILY_LARGE_THRESHOLD && typingUsers.length > 0 && (
                <div className="flex items-center gap-2">
                  <TypingBubble
                    user={{
                      id: typingUsers[0].userId,
                      display_name: typingUsers[0].displayName,
                      username: '',
                      avatar_url: null,
                      bio: '',
                      is_online: true,
                      last_seen: '',
                      created_at: '',
                      updated_at: '',
                    }}
                  />
                  <span className="text-[11px] text-neutral-500 font-medium">
                    {typingUsers.length === 1
                      ? `${typingUsers[0].displayName} is typing`
                      : `${typingUsers[0].displayName} and ${typingUsers.length - 1} other${
                          typingUsers.length - 1 > 1 ? 's' : ''
                        } are typing`}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Input Footer */}
          <footer className="p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-white dark:bg-neutral-900 border-t border-neutral-200 dark:border-neutral-800 shrink-0">
            <ChatInput
              onSendMessage={handleChatSendMessage}
              displayName={family?.name || 'Family'}
              onTyping={() => notifyTyping(true)}
              replyingToMessage={replyingTo ? adaptedById.get(replyingTo.id) || null : null}
              onCancelReply={() => setReplyingTo(null)}
              onSearchMentions={searchMentionMembers}
              onSendSafeCheckIn={async () => {
                await sendSafeCheckIn();
                onFamilyListChanged();
              }}
              lockMessage={
                family?.onlyAdminsCanSend && membership?.role === 'member'
                  ? 'Only Admins and the Owner can send messages in this Family.'
                  : null
              }
              defaultTargetLang={activeTargetLang}
              onOpenTranslatePicker={handleOpenTranslatePicker}
            />
          </footer>
        </>
      )}

      {/* Family Info / Members / Settings Drawer Modal */}
      <FamilyInfoDrawerModal
        isOpen={infoOpen}
        family={family}
        membership={membership}
        currentUser={currentUser}
        dmConversations={dmConversations}
        onSearchUsers={onSearchUsers}
        onShareInviteToDm={onShareInviteToDm}
        onClose={() => setInfoOpen(false)}
        onRefresh={async () => {
          await refreshFamilyChat();
          onFamilyListChanged();
        }}
        onLeftOrDeleted={() => {
          onFamilyListChanged();
          onBack();
        }}
      />

      {/* Anonymous Family Message Report Modal */}
      <FamilyReportModal
        isOpen={Boolean(reportingMsg)}
        currentUser={currentUser}
        family={family}
        message={reportingMsg}
        onClose={() => setReportingMsg(null)}
      />

      {/* Seen By Details Modal */}
      {seenModal && (
        <div
          onClick={() => setSeenModal(null)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-3.5 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4 text-blue-600" />
                <h4 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
                  Seen by {seenModal.count}
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setSeenModal(null)}
                className="p-1 rounded-xl text-neutral-400 hover:text-neutral-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 max-h-72 overflow-y-auto space-y-2">
              {seenModal.loading ? (
                <div className="py-6 flex justify-center">
                  <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                </div>
              ) : seenModal.isLargeFamily ? (
                <p className="text-xs text-neutral-600 dark:text-neutral-300 text-center py-4">
                  Seen by <strong>{seenModal.count}</strong> member{seenModal.count === 1 ? '' : 's'}. Individual viewer names are hidden for Families with over {FAMILY_LARGE_THRESHOLD} members.
                </p>
              ) : seenModal.readers.length === 0 ? (
                <p className="text-xs text-neutral-500 text-center py-4">No one else has seen this yet.</p>
              ) : (
                seenModal.readers.map((r) => (
                  <div
                    key={r.userId}
                    className="flex items-center justify-between p-2 rounded-xl bg-neutral-50 dark:bg-neutral-800/60 text-xs"
                  >
                    <span className="font-semibold text-neutral-900 dark:text-neutral-100">
                      {r.displayName}
                    </span>
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Image Lightbox */}
      <ImageViewerModal
        imageUrl={viewingImage?.url || null}
        caption={viewingImage?.caption}
        onClose={() => setViewingImage(null)}
      />

      {/* 106+ Languages Picker */}
      <TranslateLanguageModal
        isOpen={translatePickerState.isOpen}
        selectedLanguageCode={translatePickerState.selectedCode}
        title={translatePickerState.title}
        onSelectLanguage={(lang) => {
          translatePickerState.onPicked?.(lang);
        }}
        onClose={() => setTranslatePickerState((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
};
