import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft,
  Trash2,
  Lock,
  ExternalLink,
  ShieldCheck,
} from 'lucide-react';
import { OfficialMessage } from '@/src/types';
import { VerifiedBadge } from '../ui/VerifiedBadge';
import { ImageViewerModal } from './ImageViewerModal';
import {
  formatChatDateHeader,
  isDifferentDay,
  formatTime,
} from '@/src/lib/utils';

interface OfficialChatWindowProps {
  messages: OfficialMessage[];
  unreadCount: number;
  loading?: boolean;
  onBack: () => void;
  onMarkAsRead: () => Promise<void> | void;
  onDeleteMessageForMe: (messageId: string) => Promise<void> | void;
  onClearChatForMe: () => Promise<void> | void;
}

const URL_REGEX = /(https?:\/\/[^\s<>"'`]+)/gi;

function renderTextWithLinks(text: string): React.ReactNode {
  if (!text) return null;
  const parts = text.split(URL_REGEX);
  return parts.map((part, idx) => {
    if (part && /^https?:\/\//i.test(part)) {
      let cleanUrl = part;
      let trailing = '';
      while (/[.,!?;:)\]]$/.test(cleanUrl)) {
        trailing = cleanUrl.slice(-1) + trailing;
        cleanUrl = cleanUrl.slice(0, -1);
      }
      if (!cleanUrl) return part;
      return (
        <React.Fragment key={`url-${idx}`}>
          <a
            href={cleanUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 dark:text-blue-400 underline underline-offset-2 hover:text-blue-700 dark:hover:text-blue-300 inline-flex items-center gap-0.5 break-all font-medium"
          >
            <span>{cleanUrl}</span>
            <ExternalLink className="w-3 h-3 shrink-0 inline" />
          </a>
          {trailing}
        </React.Fragment>
      );
    }
    return <React.Fragment key={`txt-${idx}`}>{part}</React.Fragment>;
  });
}

export const OfficialChatWindow: React.FC<OfficialChatWindowProps> = ({
  messages,
  unreadCount,
  loading = false,
  onBack,
  onMarkAsRead,
  onDeleteMessageForMe,
  onClearChatForMe,
}) => {
  const [viewerImage, setViewerImage] = useState<{ url: string; caption?: string } | null>(null);
  const [confirmClearChat, setConfirmClearChat] = useState(false);
  const [messageToDelete, setMessageToDelete] = useState<OfficialMessage | null>(null);
  const [busyAction, setBusyAction] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const prevCountRef = useRef<number>(0);

  // Mark Official Chat read on open and whenever new messages arrive while open & visible
  useEffect(() => {
    const isVisibleDoc = typeof document === 'undefined' || !document.hidden;
    if (isVisibleDoc && unreadCount > 0) {
      void onMarkAsRead();
    }
  }, [unreadCount, messages.length, onMarkAsRead]);

  useEffect(() => {
    const handleVisibility = () => {
      if (!document.hidden && unreadCount > 0) {
        void onMarkAsRead();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [unreadCount, onMarkAsRead]);

  // Auto-scroll to bottom on initial open or when new message arrives
  useEffect(() => {
    if (messages.length > prevCountRef.current || prevCountRef.current === 0) {
      messagesEndRef.current?.scrollIntoView({
        behavior: prevCountRef.current === 0 ? 'auto' : 'smooth',
      });
    }
    prevCountRef.current = messages.length;
  }, [messages.length]);

  const handleConfirmDeleteMessage = async () => {
    if (!messageToDelete || busyAction) return;
    setBusyAction(true);
    try {
      await onDeleteMessageForMe(messageToDelete.id);
      setMessageToDelete(null);
    } finally {
      setBusyAction(false);
    }
  };

  const handleConfirmClearChat = async () => {
    if (busyAction) return;
    setBusyAction(true);
    try {
      await onClearChatForMe();
      setConfirmClearChat(false);
      onBack();
    } finally {
      setBusyAction(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-neutral-50 dark:bg-neutral-950 relative overflow-hidden">
      {/* Header (Read-Only Official Account: NO calls, block, report, follow) */}
      <header className="px-4 py-3 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-3 shrink-0 z-10">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to messages"
            className="md:hidden p-2 -ms-2 rounded-xl text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <img
            src="/icon.svg"
            alt="LiveConnect"
            className="w-10 h-10 rounded-2xl object-cover border border-neutral-200 dark:border-neutral-700 bg-neutral-900 shrink-0"
          />

          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h2 className="font-bold text-sm sm:text-base text-neutral-900 dark:text-neutral-100 truncate">
                LiveConnect
              </h2>
              <VerifiedBadge size="sm" />
            </div>
            <p className="text-[11px] font-medium text-sky-600 dark:text-sky-400 truncate">
              Official Account
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setConfirmClearChat(true)}
          title="Delete Official Chat for me"
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-neutral-600 dark:text-neutral-300 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer shrink-0"
        >
          <Trash2 className="w-4 h-4" />
          <span className="hidden sm:inline">Delete Chat</span>
        </button>
      </header>

      {/* Scrollable Messages Area */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-5 py-4 space-y-3">
        {/* Read-only official notice */}
        <div className="flex justify-center pb-1">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-2xl bg-sky-50 dark:bg-sky-950/40 border border-sky-200/70 dark:border-sky-800/50 text-[11px] text-sky-800 dark:text-sky-200 font-medium text-center">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-sky-600 dark:text-sky-400" />
            <span>Official updates from LiveConnect. Messages here are read-only.</span>
          </div>
        </div>

        {loading && messages.length === 0 ? (
          <div className="space-y-3 max-w-lg py-6">
            <div className="h-16 w-3/4 rounded-2xl bg-neutral-200/70 dark:bg-neutral-800/70 animate-pulse" />
            <div className="h-24 w-2/3 rounded-2xl bg-neutral-200/70 dark:bg-neutral-800/70 animate-pulse" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-4">
            <img
              src="/icon.svg"
              alt="LiveConnect"
              className="w-14 h-14 rounded-2xl border border-neutral-200 dark:border-neutral-800 mb-3 shadow-sm"
            />
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
                LiveConnect
              </h3>
              <VerifiedBadge size="xs" />
            </div>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 max-w-xs">
              No official messages right now. Updates, announcements, and tips from LiveConnect will appear here.
            </p>
          </div>
        ) : (
          messages.map((msg, idx) => {
            const prevMsg = idx > 0 ? messages[idx - 1] : null;
            const showDateHeader = !prevMsg || isDifferentDay(prevMsg.createdAt, msg.createdAt);

            return (
              <React.Fragment key={msg.id}>
                {showDateHeader && (
                  <div className="flex justify-center my-2">
                    <span className="px-3 py-1 rounded-full text-[11px] font-semibold bg-neutral-200/80 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300">
                      {formatChatDateHeader(msg.createdAt)}
                    </span>
                  </div>
                )}

                <div className="flex justify-start items-end gap-2 group">
                  <div className="max-w-[88%] sm:max-w-[75%] lg:max-w-[65%] rounded-2xl rounded-bl-md bg-white dark:bg-neutral-900 border border-neutral-200/80 dark:border-neutral-800 shadow-xs overflow-hidden">
                    {msg.imageUrl && (
                      <button
                        type="button"
                        onClick={() =>
                          setViewerImage({
                            url: msg.imageUrl!,
                            caption: msg.text || undefined,
                          })
                        }
                        className="block w-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden cursor-pointer focus:outline-none"
                      >
                        <img
                          src={msg.imageUrl}
                          alt="Official attachment"
                          className="w-full max-h-80 object-cover hover:opacity-95 transition-opacity"
                        />
                      </button>
                    )}

                    <div className="px-3.5 py-2.5 space-y-1.5">
                      {msg.text && (
                        <p className="text-sm text-neutral-900 dark:text-neutral-100 whitespace-pre-wrap break-words leading-relaxed">
                          {renderTextWithLinks(msg.text)}
                        </p>
                      )}

                      <div className="flex items-center justify-between gap-3 pt-0.5">
                        <span className="text-[10px] font-medium text-neutral-400 dark:text-neutral-500 tabular-nums">
                          {formatTime(msg.createdAt)}
                        </span>

                        <button
                          type="button"
                          onClick={() => setMessageToDelete(msg)}
                          title="Delete for me"
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-lg text-[10px] font-semibold text-neutral-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 sm:opacity-0 sm:group-hover:opacity-100 transition-all cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Delete</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </React.Fragment>
            );
          })
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Read-Only Bottom Bar (No message box / no reply / no calls) */}
      <div className="px-4 py-3 bg-white dark:bg-neutral-900 border-t border-neutral-200 dark:border-neutral-800 shrink-0">
        <div className="flex items-center justify-center gap-2 text-xs font-medium text-neutral-500 dark:text-neutral-400 py-1">
          <Lock className="w-3.5 h-3.5 shrink-0" />
          <span>You can only read messages in this official chat.</span>
        </div>
      </div>

      {/* Full-Screen Image Viewer */}
      <ImageViewerModal
        imageUrl={viewerImage?.url || null}
        caption={viewerImage?.caption}
        onClose={() => setViewerImage(null)}
      />

      {/* Delete Single Message (Own Side Only) Confirmation Modal */}
      {messageToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-3xl p-6 max-w-sm w-full shadow-2xl space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto">
              <Trash2 className="w-6 h-6" />
            </div>
            <div className="text-center space-y-1.5">
              <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-100">
                Delete message for you?
              </h3>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
                This message will only be removed from your own view. Other users and LiveConnect admins are unaffected.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                disabled={busyAction}
                onClick={() => setMessageToDelete(null)}
                className="py-2.5 px-4 rounded-xl border border-neutral-300 dark:border-neutral-700 font-semibold text-xs text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busyAction}
                onClick={handleConfirmDeleteMessage}
                className="py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-md shadow-rose-500/20 transition-all active:scale-95 disabled:opacity-60 cursor-pointer"
              >
                {busyAction ? 'Deleting...' : 'Delete for Me'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete / Clear Entire Official Chat (Own Side Only) Confirmation Modal */}
      {confirmClearChat && (
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
                This clears all current official messages on your side only. If LiveConnect sends a new message later, the chat will reappear with that new message.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                disabled={busyAction}
                onClick={() => setConfirmClearChat(false)}
                className="py-2.5 px-4 rounded-xl border border-neutral-300 dark:border-neutral-700 font-semibold text-xs text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busyAction}
                onClick={handleConfirmClearChat}
                className="py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-md shadow-rose-500/20 transition-all active:scale-95 disabled:opacity-60 cursor-pointer"
              >
                {busyAction ? 'Deleting...' : 'Delete Chat'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
