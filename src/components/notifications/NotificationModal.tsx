import React, { useState } from 'react';
import {
  X,
  Bell,
  Users,
  MessageSquare,
  Phone,
  Video,
  CheckCircle,
  Clock,
  Trash2,
  CheckCheck,
  Flag,
  AtSign,
  Megaphone,
  LifeBuoy,
  BadgeCheck,
} from 'lucide-react';
import { AppNotification, Profile } from '@/src/types';
import { cn, getAvatarColor, getInitials } from '@/src/lib/utils';
import { useLanguage } from '@/src/lib/LanguageContext';

interface NotificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: AppNotification[];
  unreadCount: number;
  onMarkAsRead: (id: string) => void;
  onMarkAllAsRead: () => void;
  onDeleteNotification: (id: string) => void;
  onSelectUser?: (user: Profile) => void;
  onOpenChat?: (userId: string, profile?: Profile) => void;
  onOpenOfficialChat?: () => void;
  onOpenFamily?: (familyId?: string) => void;
  onRespondFamilyInvite?: (inviteId: string, action: 'accept' | 'decline') => Promise<any>;
}

export const NotificationModal: React.FC<NotificationModalProps> = ({
  isOpen,
  onClose,
  notifications,
  unreadCount,
  onMarkAsRead,
  onMarkAllAsRead,
  onDeleteNotification,
  onSelectUser,
  onOpenChat,
  onOpenOfficialChat,
  onOpenFamily,
  onRespondFamilyInvite,
}) => {
  const { t } = useLanguage();
  const [handledInvites, setHandledInvites] = useState<Record<string, 'accepted' | 'declined' | 'busy'>>({});
  if (!isOpen) return null;

  const getNotificationIcon = (type: AppNotification['type']) => {
    switch (type) {
      case 'message':
        return <MessageSquare className="w-4 h-4 text-purple-500" />;
      case 'call_audio':
        return <Phone className="w-4 h-4 text-emerald-500" />;
      case 'call_video':
        return <Video className="w-4 h-4 text-indigo-500" />;
      case 'family_invite':
      case 'family_join_request':
      case 'family_deleted':
      case 'family_message':
        return <Users className="w-4 h-4 text-blue-500" />;
      case 'family_mention':
        return <AtSign className="w-4 h-4 text-indigo-500" />;
      case 'family_join_approved':
        return <CheckCircle className="w-4 h-4 text-emerald-500" />;
      case 'family_message_report':
        return <Flag className="w-4 h-4 text-amber-500" />;
      case 'announcement':
        return <Megaphone className="w-4 h-4 text-blue-600" />;
      case 'official_chat':
        return <BadgeCheck className="w-4 h-4 text-sky-500" />;
      case 'support_reply':
        return <LifeBuoy className="w-4 h-4 text-emerald-500" />;
      default:
        return <Bell className="w-4 h-4 text-neutral-400" />;
    }
  };

  const formatTime = (iso: string) => {
    try {
      const d = new Date(iso);
      const diffMs = Date.now() - d.getTime();
      const mins = Math.floor(diffMs / 60000);
      if (mins < 1) return 'Just now';
      if (mins < 60) return `${mins}m ago`;
      const hours = Math.floor(mins / 60);
      if (hours < 24) return `${hours}h ago`;
      return d.toLocaleDateString();
    } catch {
      return '';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 px-6 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-800/40">
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <div className="p-2 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
                <Bell className="w-5 h-5" />
              </div>
              {unreadCount > 0 && (
                <span className="absolute -top-1 -end-1 flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white shadow">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </div>
            <div>
              <h3 className="font-bold text-base text-neutral-900 dark:text-neutral-100">
                {t('title.notifications')}
              </h3>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                {unreadCount > 0 ? `${unreadCount} ${t('status.unread')}` : t('status.allCaughtUp')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                onClick={onMarkAllAsRead}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50 transition-colors"
                title={t('action.markAllRead')}
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>{t('action.markAllRead')}</span>
              </button>
            )}
            <button
              onClick={onClose}
              title={t('action.close')}
              className="p-1.5 rounded-xl hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Notifications List */}
        <div className="flex-1 overflow-y-auto p-4 divide-y divide-neutral-100 dark:divide-neutral-800/60">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="p-4 rounded-3xl bg-neutral-100 dark:bg-neutral-800 text-neutral-400 dark:text-neutral-500 mb-3">
                <Bell className="w-8 h-8 stroke-[1.5]" />
              </div>
              <h4 className="font-semibold text-neutral-700 dark:text-neutral-300 text-sm">
                {t('desc.noNotifications')}
              </h4>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 max-w-xs">
                When someone messages or calls you, you'll see alerts here in real time.
              </p>
            </div>
          ) : (
            notifications.map((notif) => {
              const actor = notif.actor;

              return (
                <div
                  key={notif.id}
                  onClick={() => {
                    if (!notif.is_read) onMarkAsRead(notif.id);
                  }}
                  className={cn(
                    'p-3.5 rounded-2xl transition-all flex items-start gap-3.5 relative group',
                    notif.is_read
                      ? 'hover:bg-neutral-50 dark:hover:bg-neutral-800/40 opacity-80'
                      : 'bg-blue-500/5 hover:bg-blue-500/10 border border-blue-500/20'
                  )}
                >
                  {/* Actor Avatar or Icon */}
                  <div className="relative shrink-0">
                    {notif.type === 'official_chat' ? (
                      <img
                        src="/icon.svg"
                        alt="LiveConnect"
                        className="w-10 h-10 rounded-2xl object-cover border border-neutral-200 dark:border-neutral-700 bg-neutral-900"
                      />
                    ) : actor?.avatar_url ? (
                      <img
                        src={actor.avatar_url}
                        alt="Actor"
                        className="w-10 h-10 rounded-2xl object-cover border border-neutral-200 dark:border-neutral-700"
                      />
                    ) : (
                      <div
                        className={cn(
                          'w-10 h-10 rounded-2xl flex items-center justify-center font-bold text-sm text-white shadow-sm',
                          getAvatarColor(notif.actor_id)
                        )}
                      >
                        {getInitials(actor?.display_name || 'User')}
                      </div>
                    )}
                    <div className="absolute -bottom-1 -end-1 p-1 rounded-full bg-white dark:bg-neutral-900 shadow-sm">
                      {getNotificationIcon(notif.type)}
                    </div>
                  </div>

                  {/* Body */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h5 className="text-xs font-bold text-neutral-900 dark:text-neutral-100 truncate">
                        {notif.title}
                      </h5>
                      <span className="text-[10px] text-neutral-400 shrink-0 flex items-center gap-1 font-medium">
                        <Clock className="w-2.5 h-2.5" />
                        {formatTime(notif.created_at)}
                      </span>
                    </div>

                    <p className="text-xs text-neutral-600 dark:text-neutral-300 mt-0.5 leading-snug">
                      {notif.message}
                    </p>

                    {/* Interactive Action Buttons */}
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      {notif.type === 'family_invite' && notif.reference_id && onRespondFamilyInvite && (
                        handledInvites[notif.id] === 'accepted' || handledInvites[notif.id] === 'declined' ? (
                          <span className="text-[11px] font-semibold text-neutral-500">
                            {handledInvites[notif.id] === 'accepted' ? 'Joined Family' : 'Declined'}
                          </span>
                        ) : (
                          <>
                            <button
                              type="button"
                              disabled={handledInvites[notif.id] === 'busy'}
                              onClick={async (e) => {
                                e.stopPropagation();
                                setHandledInvites((prev) => ({ ...prev, [notif.id]: 'busy' }));
                                try {
                                  await onRespondFamilyInvite(notif.reference_id!, 'accept');
                                  setHandledInvites((prev) => ({ ...prev, [notif.id]: 'accepted' }));
                                  onMarkAsRead(notif.id);
                                  onOpenFamily?.();
                                  onClose();
                                } catch {
                                  setHandledInvites((prev) => {
                                    const copy = { ...prev };
                                    delete copy[notif.id];
                                    return copy;
                                  });
                                }
                              }}
                              className="px-2.5 py-1 text-[11px] font-bold rounded-xl bg-blue-600 hover:bg-blue-700 text-white transition-colors cursor-pointer"
                            >
                              Accept
                            </button>
                            <button
                              type="button"
                              disabled={handledInvites[notif.id] === 'busy'}
                              onClick={async (e) => {
                                e.stopPropagation();
                                setHandledInvites((prev) => ({ ...prev, [notif.id]: 'busy' }));
                                try {
                                  await onRespondFamilyInvite(notif.reference_id!, 'decline');
                                  setHandledInvites((prev) => ({ ...prev, [notif.id]: 'declined' }));
                                  onMarkAsRead(notif.id);
                                } catch {
                                  setHandledInvites((prev) => {
                                    const copy = { ...prev };
                                    delete copy[notif.id];
                                    return copy;
                                  });
                                }
                              }}
                              className="px-2.5 py-1 text-[11px] font-semibold rounded-xl bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors cursor-pointer"
                            >
                              Decline
                            </button>
                          </>
                        )
                      )}

                      {(notif.type === 'family_mention' ||
                        notif.type === 'family_message' ||
                        notif.type === 'family_join_request' ||
                        notif.type === 'family_join_approved' ||
                        notif.type === 'family_message_report') &&
                        notif.reference_id &&
                        onOpenFamily && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenFamily(notif.reference_id!);
                              onMarkAsRead(notif.id);
                              onClose();
                            }}
                            className="px-2.5 py-1 text-[11px] font-bold rounded-xl bg-blue-600 hover:bg-blue-700 text-white transition-colors cursor-pointer"
                          >
                            Open Family
                          </button>
                        )}

                      {notif.type === 'official_chat' && onOpenOfficialChat && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenOfficialChat();
                            onMarkAsRead(notif.id);
                            onClose();
                          }}
                          className="px-2.5 py-1 text-[11px] font-bold rounded-xl bg-blue-600 hover:bg-blue-700 text-white transition-colors cursor-pointer"
                        >
                          Open Chat
                        </button>
                      )}

                      {actor &&
                        notif.actor_id !== 'system' &&
                        notif.actor_id !== 'official_liveconnect' &&
                        notif.type !== 'official_chat' &&
                        onSelectUser &&
                        !notif.type.startsWith('family_') && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectUser(actor);
                            onMarkAsRead(notif.id);
                            onClose();
                          }}
                          className="px-2.5 py-1 text-[11px] font-medium rounded-xl bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors"
                        >
                          {t('action.viewProfile')}
                        </button>
                      )}

                      {actor &&
                        notif.actor_id !== 'system' &&
                        notif.actor_id !== 'official_liveconnect' &&
                        notif.type !== 'official_chat' &&
                        onOpenChat &&
                        !notif.type.startsWith('family_') && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenChat(actor.id, actor);
                            onMarkAsRead(notif.id);
                            onClose();
                          }}
                          className="px-2.5 py-1 text-[11px] font-medium rounded-xl bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors"
                        >
                          {t('label.chat')}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Actions (Delete, unread indicator) */}
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    {!notif.is_read && (
                      <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse" />
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteNotification(notif.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 text-neutral-400 hover:text-rose-500 transition-all rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      title={t('action.delete')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
