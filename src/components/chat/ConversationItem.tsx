import React, { useState, useRef, useEffect } from 'react';
import { Conversation } from '@/src/types';
import { cn, formatDate, getAvatarColor, getInitials } from '@/src/lib/utils';
import { Check, CheckCheck, Trash2, Phone, Video, PhoneMissed, PhoneOutgoing, PhoneIncoming, MoreVertical, X } from 'lucide-react';
import { UserAvatar } from '@/src/components/ui/UserAvatar';

interface ConversationItemProps {
  conversation: Conversation;
  isSelected: boolean;
  isOnline: boolean;
  currentUserId?: string;
  onSelect: () => void;
  onDelete?: (e: React.MouseEvent | React.TouchEvent) => void;
}

export const ConversationItem: React.FC<ConversationItemProps> = ({
  conversation,
  isSelected,
  isOnline,
  currentUserId,
  onSelect,
  onDelete,
}) => {
  const [showLongPressModal, setShowLongPressModal] = useState(false);
  const [isPressing, setIsPressing] = useState(false);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const longPressTriggeredRef = useRef(false);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);

  const isGroup = conversation.type === 'group';
  const otherUser = conversation.other_member;
  const lastMsg = conversation.last_message;
  const isLastMsgFromMe = lastMsg?.sender_id === currentUserId;

  const isSelf = !isGroup && otherUser?.id === currentUserId;
  const rawDisplayName = isGroup
    ? conversation.name || 'Group Chat'
    : otherUser?.display_name || otherUser?.username || 'Unknown User';
  const displayName = isSelf ? `${rawDisplayName} (You)` : rawDisplayName;
  const avatarUrl = isGroup ? conversation.avatar_url : otherUser?.avatar_url;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
      }
    };
  }, []);

  const handleStartPress = (e: React.TouchEvent | React.MouseEvent) => {
    longPressTriggeredRef.current = false;
    setIsPressing(true);

    if ('touches' in e && e.touches[0]) {
      touchStartPosRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }

    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
    }

    // 1-second (1000ms) long press
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      setIsPressing(false);
      try {
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          navigator.vibrate?.(60);
        }
      } catch (err) {}
      setShowLongPressModal(true);
    }, 1000);
  };

  const handleMovePress = (e: React.TouchEvent) => {
    if (touchStartPosRef.current && e.touches[0]) {
      const dx = Math.abs(e.touches[0].clientX - touchStartPosRef.current.x);
      const dy = Math.abs(e.touches[0].clientY - touchStartPosRef.current.y);
      // If user is scrolling (moved more than 10px), cancel long press
      if (dx > 10 || dy > 10) {
        handleCancelPress();
      }
    }
  };

  const handleCancelPress = () => {
    setIsPressing(false);
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    if (longPressTriggeredRef.current) {
      e.preventDefault();
      e.stopPropagation();
      longPressTriggeredRef.current = false;
      return;
    }
    onSelect();
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    handleCancelPress();
    setShowLongPressModal(true);
  };

  // Render call log label if last message is a call log
  const renderMessagePreview = () => {
    if (!lastMsg?.content) return 'No messages yet';

    if (lastMsg.content.startsWith('[CALL_LOG:') && lastMsg.content.endsWith(']')) {
      const tokens = lastMsg.content.slice(10, -1).split(':');
      const isVideo = tokens[0] === 'video';
      const rawStatus = tokens[1] || 'ended';
      const rawMissedFlag = tokens[2];
      const details = tokens.slice(3).join(':');

      const hasConnectedDuration = Boolean(
        details &&
        details !== 'No answer' &&
        details !== 'Declined' &&
        details !== 'Cancelled' &&
        details !== 'Missed' &&
        details !== 'Ended' &&
        details !== 'Call ended' &&
        /\d/.test(details)
      );

      const isMissed = !hasConnectedDuration || rawMissedFlag === 'missed' || rawStatus === 'missed' || rawStatus === 'rejected' || rawStatus === 'cancelled';

      if (isLastMsgFromMe) {
        return (
          <span className={cn('inline-flex items-center gap-1', isSelected ? 'text-blue-100' : 'text-neutral-500 dark:text-neutral-400')}>
            {isVideo ? (
              <Video className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <PhoneOutgoing className="w-3.5 h-3.5 shrink-0" />
            )}
            <span className="truncate">
              {isVideo ? 'Video call' : 'Voice call'}
              {isMissed ? ' • No answer' : (hasConnectedDuration ? ` • ${details}` : '')}
            </span>
          </span>
        );
      }

      if (isMissed) {
        return (
          <span className={cn('inline-flex items-center gap-1 font-medium', isSelected ? 'text-red-200' : 'text-[#ea4335] dark:text-[#ef4444]')}>
            <PhoneMissed className={cn('w-3.5 h-3.5 shrink-0', isSelected ? 'text-red-200' : 'text-[#ea4335] dark:text-[#ef4444]')} />
            <span className="truncate">{isVideo ? 'Missed video call' : 'Missed voice call'}</span>
          </span>
        );
      }

      return (
        <span className={cn('inline-flex items-center gap-1', isSelected ? 'text-blue-100' : 'text-neutral-500 dark:text-neutral-400')}>
          {isVideo ? (
            <Video className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <PhoneIncoming className="w-3.5 h-3.5 shrink-0" />
          )}
          <span className="truncate">
            {isVideo ? 'Video call' : 'Voice call'}
            {hasConnectedDuration ? ` • ${details}` : ''}
          </span>
        </span>
      );
    }

    if (lastMsg.content.startsWith('[IMAGE:') && lastMsg.content.endsWith(']')) {
      const inside = lastMsg.content.slice(7, -1);
      const colonIdx = inside.lastIndexOf(':');
      let caption = '';
      if (colonIdx !== -1 && !inside.startsWith('data:image')) {
        caption = inside.slice(colonIdx + 1);
      }
      return caption ? `📷 Photo: ${caption}` : '📷 Photo';
    }

    if (lastMsg.content.startsWith('[VIDEO:') && lastMsg.content.endsWith(']')) {
      const inside = lastMsg.content.slice(7, -1);
      const colonIdx = inside.lastIndexOf(':');
      let caption = '';
      if (colonIdx !== -1 && !inside.startsWith('data:video')) {
        caption = inside.slice(colonIdx + 1);
      }
      return caption ? `🎥 Video: ${caption}` : '🎥 Video';
    }

    if (lastMsg.content.startsWith('[VOICE:') && lastMsg.content.endsWith(']')) {
      return '🎙️ Voice note';
    }

    if (lastMsg.content.startsWith('[STICKER:') && lastMsg.content.endsWith(']')) {
      const parts = lastMsg.content.slice(9, -1).split(':');
      const icon = parts[0] || '✨';
      const label = parts[1] || 'Sticker';
      return `${icon} ${label}`;
    }

    return lastMsg.content;
  };

  return (
    <>
      <div
        onClick={handleClick}
        onTouchStart={handleStartPress}
        onTouchMove={handleMovePress}
        onTouchEnd={handleCancelPress}
        onTouchCancel={handleCancelPress}
        onMouseDown={handleStartPress}
        onMouseUp={handleCancelPress}
        onMouseLeave={handleCancelPress}
        onContextMenu={handleContextMenu}
        role="button"
        tabIndex={0}
        className={cn(
          'w-full text-left p-3 rounded-2xl flex items-center gap-3 transition-all relative group cursor-pointer select-none',
          isPressing && 'scale-[0.98] bg-neutral-200/80 dark:bg-neutral-800 transition-transform duration-300',
          isSelected
            ? 'bg-blue-600 text-white shadow-md shadow-blue-500/10'
            : 'hover:bg-neutral-100 dark:hover:bg-neutral-800/60 text-neutral-800 dark:text-neutral-200'
        )}
      >
        {/* Avatar with presence dot */}
        <UserAvatar
          src={avatarUrl}
          name={displayName}
          id={otherUser?.id || conversation.id}
          className="w-12 h-12 border border-black/10 dark:border-white/10 shrink-0"
          showStatus
          isOnline={isOnline}
        />

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1 mb-1">
            <div className="flex items-baseline gap-1.5 min-w-0 flex-1">
              <h4
                className={cn(
                  'font-semibold text-sm truncate',
                  isSelected ? 'text-white' : 'text-neutral-900 dark:text-neutral-100'
                )}
              >
                {displayName}
              </h4>
              {otherUser?.username && (
                <span
                  className={cn(
                    'text-[11px] font-normal truncate shrink-0 max-w-[120px]',
                    isSelected ? 'text-blue-200' : 'text-neutral-400 dark:text-neutral-500'
                  )}
                  title={`@${otherUser.username}`}
                >
                  @{otherUser.username}
                </span>
              )}
            </div>
            {lastMsg?.created_at && (
              <span
                className={cn(
                  'text-[11px] shrink-0 font-medium',
                  isSelected ? 'text-blue-100' : 'text-neutral-400'
                )}
              >
                {formatDate(lastMsg.created_at)}
              </span>
            )}
          </div>

          <div className="flex items-center justify-between gap-2">
            <p
              className={cn(
                'text-xs truncate flex items-center gap-1 flex-1 min-w-0',
                isSelected ? 'text-blue-100' : 'text-neutral-500 dark:text-neutral-400'
              )}
            >
              {isLastMsgFromMe && !lastMsg?.content?.startsWith('[CALL_LOG:') && (
                <span className="shrink-0 inline-flex items-center">
                  {lastMsg?.is_read ? (
                    <CheckCheck className="w-3.5 h-3.5 text-blue-300" />
                  ) : (
                    <Check className="w-3.5 h-3.5 opacity-70" />
                  )}
                </span>
              )}
              <span className="truncate">{renderMessagePreview()}</span>
            </p>

            {/* Desktop subtle hover button */}
            {onDelete && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(e);
                }}
                title="Delete conversation"
                className={cn(
                  'hidden sm:flex opacity-0 group-hover:opacity-100 p-1.5 rounded-xl transition-all shrink-0 cursor-pointer',
                  isSelected
                    ? 'hover:bg-blue-700 text-white'
                    : 'hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/50 dark:hover:text-red-400 text-neutral-400'
                )}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Unread badge */}
            {!isSelected && Boolean(conversation.unread_count && conversation.unread_count > 0) && (
              <span
                className="shrink-0 px-2 py-0.5 text-[11px] font-bold rounded-full min-w-[20px] text-center shadow-sm animate-in zoom-in bg-blue-600 text-white"
              >
                {conversation.unread_count > 99 ? '99+' : conversation.unread_count}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Long Press Action Modal / Bottom Sheet */}
      {showLongPressModal && (
        <div
          onClick={(e) => {
            e.stopPropagation();
            setShowLongPressModal(false);
          }}
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-4 animate-in fade-in duration-150"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm bg-white dark:bg-neutral-900 rounded-2xl sm:rounded-3xl p-5 shadow-2xl border border-neutral-200 dark:border-neutral-800 animate-in slide-in-from-bottom sm:zoom-in-95 duration-200"
          >
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-neutral-100 dark:border-neutral-800">
              <div className="flex items-center gap-3 min-w-0">
                <UserAvatar
                  src={avatarUrl}
                  name={displayName}
                  id={otherUser?.id || conversation.id}
                  className="w-10 h-10 shrink-0"
                />
                <div className="min-w-0">
                  <h3 className="font-semibold text-neutral-900 dark:text-neutral-100 text-sm truncate">
                    {displayName}
                  </h3>
                  <p className="text-xs text-neutral-400 truncate">
                    Conversation options
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowLongPressModal(false)}
                className="p-1.5 rounded-full text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2">
              <button
                onClick={(e) => {
                  setShowLongPressModal(false);
                  onSelect();
                }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              >
                Open Chat
              </button>

              {onDelete && (
                <button
                  onClick={(e) => {
                    setShowLongPressModal(false);
                    onDelete(e);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Delete Conversation</span>
                </button>
              )}

              <button
                onClick={() => setShowLongPressModal(false)}
                className="w-full text-center py-2.5 text-xs text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
