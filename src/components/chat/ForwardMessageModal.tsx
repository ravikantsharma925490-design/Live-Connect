import React, { useState } from 'react';
import { Share2, X, Send, Users, Check, Loader2 } from 'lucide-react';
import { Conversation, Message, Profile } from '@/src/types';
import { UserAvatar } from '../ui/UserAvatar';

interface ForwardMessageModalProps {
  isOpen: boolean;
  onClose: () => void;
  messageToForward: Message | null;
  conversations: Conversation[];
  currentUser: Profile | null;
  onForwardSuccess?: () => void;
}

export const ForwardMessageModal: React.FC<ForwardMessageModalProps> = ({
  isOpen,
  onClose,
  messageToForward,
  conversations,
  currentUser,
  onForwardSuccess,
}) => {
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [forwarding, setForwarding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!isOpen || !messageToForward) return null;

  const handleForward = async () => {
    if (!selectedConvId || !currentUser) return;
    setForwarding(true);
    setError(null);

    const targetConv = conversations.find((c) => c.id === selectedConvId);
    if (!targetConv) return;

    try {
      const forwardedContent = messageToForward.content;

      const res = await fetch('/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            id: `fw-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
            conversation_id: targetConv.id,
            sender_id: currentUser.id,
            content: forwardedContent,
            created_at: new Date().toISOString(),
          },
          recipientId: targetConv.type === 'direct' ? targetConv.other_member?.id : undefined,
          senderProfile: currentUser,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to forward message');
      }

      setDone(true);
      setTimeout(() => {
        setDone(false);
        onForwardSuccess?.();
        onClose();
      }, 1000);
    } catch (err: any) {
      setError(err.message || 'Error forwarding message');
    } finally {
      setForwarding(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Share2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <h3 className="font-bold text-sm text-neutral-900 dark:text-neutral-100">
              Forward Message
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Preview & Selection */}
        <div className="p-4 space-y-3">
          {error && (
            <div className="p-2.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 text-xs">
              {error}
            </div>
          )}

          {/* Message Preview */}
          <div className="p-2.5 rounded-xl bg-neutral-100 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700 text-xs text-neutral-600 dark:text-neutral-300 line-clamp-2 italic">
            "{messageToForward.content}"
          </div>

          <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">
            Select Chat to Forward to:
          </p>

          <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
            {conversations.length > 0 ? (
              conversations.map((conv) => {
                const isSelected = selectedConvId === conv.id;
                const isGroup = conv.type === 'group';
                const displayName = isGroup
                  ? conv.name || 'Group Chat'
                  : conv.other_member?.display_name || 'User';
                const avatar = isGroup ? conv.avatar_url : conv.other_member?.avatar_url;

                return (
                  <div
                    key={conv.id}
                    onClick={() => setSelectedConvId(conv.id)}
                    className={`p-2.5 rounded-xl flex items-center justify-between cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900'
                        : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <UserAvatar
                        src={avatar}
                        name={displayName}
                        id={conv.id}
                        className="w-8 h-8 shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-neutral-900 dark:text-neutral-100 truncate">
                          {displayName}
                        </p>
                        <p className="text-[10px] text-neutral-400 flex items-center gap-1">
                          {isGroup ? <Users className="w-3 h-3 text-blue-500" /> : null}
                          {isGroup ? `${conv.member_ids?.length || 0} members` : 'Direct Chat'}
                        </p>
                      </div>
                    </div>

                    <div
                      className={`w-5 h-5 rounded-lg flex items-center justify-center ${
                        isSelected ? 'bg-blue-600 text-white' : 'border border-neutral-300 dark:border-neutral-700 text-transparent'
                      }`}
                    >
                      <Check className="w-3.5 h-3.5" />
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="text-center text-xs text-neutral-400 py-4">No conversations found</p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-neutral-200 dark:border-neutral-800 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-2 rounded-xl text-xs font-semibold text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            onClick={handleForward}
            disabled={!selectedConvId || forwarding || done}
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-md shadow-blue-500/20 disabled:opacity-50 flex items-center gap-1.5"
          >
            {forwarding ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : done ? (
              <Check className="w-3.5 h-3.5" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
            {done ? 'Forwarded!' : 'Forward'}
          </button>
        </div>
      </div>
    </div>
  );
};
