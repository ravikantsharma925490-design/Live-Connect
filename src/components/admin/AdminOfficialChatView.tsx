import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Send,
  ImagePlus,
  Trash2,
  RefreshCw,
  Loader2,
  Users,
  X,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';
import { adminApi } from '@/src/lib/admin/adminApi';
import type { OfficialMessage } from '@/src/types';
import { VerifiedBadge } from '@/src/components/ui/VerifiedBadge';
import { ImageViewerModal } from '@/src/components/chat/ImageViewerModal';
import { cn } from '@/src/lib/utils';

interface AdminOfficialChatViewProps {
  isSuperAdmin: boolean;
  initialModeratorsEnabled?: boolean;
  onModeratorsToggleChanged?: (enabled: boolean) => void;
}

const URL_SPLIT_REGEX = /(https?:\/\/[^\s<>"']+)/gi;

function renderSafeLinkText(text: string): React.ReactNode {
  if (!text) return null;
  const parts = text.split(URL_SPLIT_REGEX);
  return parts.map((part, idx) => {
    if (/^https?:\/\//i.test(part)) {
      return (
        <a
          key={idx}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 dark:text-blue-400 underline break-all hover:opacity-80"
        >
          {part}
        </a>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

export const AdminOfficialChatView: React.FC<AdminOfficialChatViewProps> = ({
  isSuperAdmin,
  initialModeratorsEnabled = false,
  onModeratorsToggleChanged,
}) => {
  const [messages, setMessages] = useState<OfficialMessage[]>([]);
  const [moderatorsEnabled, setModeratorsEnabled] = useState<boolean>(initialModeratorsEnabled);
  const [loading, setLoading] = useState(true);
  const [toggleBusy, setToggleBusy] = useState(false);

  const [text, setText] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [sending, setSending] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteMsg, setConfirmDeleteMsg] = useState<OfficialMessage | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const flash = (kind: 'ok' | 'err', msg: string) => {
    setNotice({ kind, text: msg });
    setTimeout(() => setNotice(null), 4500);
  };

  const loadMessages = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.getOfficialMessages();
      setMessages(res.messages || []);
      setModeratorsEnabled(Boolean(res.moderatorsEnabled));
    } catch (err: any) {
      flash('err', err?.message || 'Failed to load Official Chat messages.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  const handleToggleModerators = async () => {
    if (!isSuperAdmin || toggleBusy) return;
    const next = !moderatorsEnabled;
    setToggleBusy(true);
    try {
      const res = await adminApi.updateOfficialChatModerators(next);
      setModeratorsEnabled(Boolean(res.officialChatModeratorsEnabled));
      onModeratorsToggleChanged?.(Boolean(res.officialChatModeratorsEnabled));
      flash(
        'ok',
        next
          ? 'Moderators can now send & delete Official Chat messages.'
          : 'Official Chat access restricted to Super Admin only.'
      );
    } catch (err: any) {
      flash('err', err?.message || 'Could not update moderator permission.');
    } finally {
      setToggleBusy(false);
    }
  };

  const handleSelectImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      flash('err', 'Please choose a valid image file (PNG, JPG, WEBP, GIF).');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      flash('err', 'Image size must be 8 MB or smaller.');
      return;
    }

    setUploadingImage(true);
    try {
      const res = await adminApi.uploadOfficialImage(file);
      setImageUrl(res.url);
    } catch (err: any) {
      flash('err', err?.message || 'Image upload failed.');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanText = text.trim();
    if (!cleanText && !imageUrl) {
      flash('err', 'Write a message or attach an image first.');
      return;
    }

    setSending(true);
    try {
      const res = await adminApi.sendOfficialMessage({
        text: cleanText,
        imageUrl,
      });
      setText('');
      setImageUrl(null);
      flash(
        'ok',
        `Official message sent! Delivering notifications in background batches (~${res.estimatedRecipients} user(s)).`
      );
      await loadMessages();
      // Refresh once more shortly after background batch updates exact deliveredCount
      setTimeout(() => {
        void adminApi
          .getOfficialMessages()
          .then((r) => setMessages(r.messages || []))
          .catch(() => null);
      }, 1500);
    } catch (err: any) {
      flash('err', err?.message || 'Failed to send Official Chat message.');
    } finally {
      setSending(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!confirmDeleteMsg) return;
    const targetId = confirmDeleteMsg.id;
    setDeletingId(targetId);
    try {
      await adminApi.deleteOfficialMessage(targetId);
      setConfirmDeleteMsg(null);
      setMessages((prev) => prev.filter((m) => m.id !== targetId));
      flash('ok', 'Official message deleted for everyone.');
    } catch (err: any) {
      flash('err', err?.message || 'Could not delete official message.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-5">
      {notice && (
        <div
          className={cn(
            'px-4 py-2.5 rounded-lg border text-sm font-medium',
            notice.kind === 'ok'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300'
              : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300'
          )}
        >
          {notice.text}
        </div>
      )}

      {/* Super Admin Moderator Access Control */}
      {isSuperAdmin && (
        <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl px-5 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
                Allow Moderators to Manage Official Chat
              </p>
              <p className="text-xs text-neutral-500 mt-0.5">
                When enabled, Moderator accounts can view history, send messages, and delete messages in Official Chat.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={toggleBusy}
            onClick={() => void handleToggleModerators()}
            aria-label="Toggle Moderator Official Chat access"
            className={cn(
              'w-12 h-6 rounded-full p-0.5 transition-colors flex items-center cursor-pointer disabled:opacity-50 shrink-0',
              moderatorsEnabled ? 'bg-blue-600 justify-end' : 'bg-neutral-300 dark:bg-neutral-700 justify-start'
            )}
          >
            <span className="w-5 h-5 rounded-full bg-white shadow-xs" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left: Compose Official Message */}
        <div className="lg:col-span-5 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-5">
          <div className="flex items-center gap-3 pb-4 mb-4 border-b border-neutral-200 dark:border-neutral-800">
            <img
              src="/icon.svg"
              alt="LiveConnect"
              className="w-10 h-10 rounded-xl border border-neutral-200 dark:border-neutral-700 shrink-0"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h2 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
                  LiveConnect
                </h2>
                <VerifiedBadge size="xs" />
              </div>
              <p className="text-xs text-neutral-500">
                Official pinned read-only chat for all users
              </p>
            </div>
          </div>

          <form onSubmit={handleSend} className="space-y-3.5">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-neutral-600 dark:text-neutral-400">
                  Message (supports text &amp; links)
                </label>
                <span className="text-[11px] text-neutral-400 tabular-nums">
                  {text.length} / 4000
                </span>
              </div>
              <textarea
                rows={5}
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={4000}
                placeholder="Write an official update, link (https://...), or announcement for all LiveConnect users..."
                className="w-full px-3 py-2.5 rounded-lg bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500/30 resize-y"
              />
            </div>

            {/* Image attachment */}
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleSelectImage}
                className="hidden"
              />

              {imageUrl ? (
                <div className="relative rounded-lg overflow-hidden border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950">
                  <img
                    src={imageUrl}
                    alt="Attachment preview"
                    className="w-full max-h-56 object-cover cursor-pointer"
                    onClick={() => setPreviewImage(imageUrl)}
                  />
                  <button
                    type="button"
                    onClick={() => setImageUrl(null)}
                    title="Remove attached image"
                    className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/70 hover:bg-black text-white cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={uploadingImage}
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full py-2.5 px-3 rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 text-xs font-semibold text-neutral-600 dark:text-neutral-300 inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {uploadingImage ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <ImagePlus className="w-4 h-4" />
                  )}
                  <span>{uploadingImage ? 'Uploading image...' : 'Attach Image (Optional)'}</span>
                </button>
              )}
            </div>

            <button
              type="submit"
              disabled={sending || uploadingImage || (!text.trim() && !imageUrl)}
              className="w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 cursor-pointer"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              <span>Send Official Message</span>
            </button>
          </form>
        </div>

        {/* Right: History of Sent Official Messages */}
        <div className="lg:col-span-7 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
                Sent Official Messages ({messages.length})
              </h3>
              <p className="text-xs text-neutral-500">
                Deleting here removes the message for every user.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadMessages()}
              className="text-xs font-semibold text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 inline-flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
              Refresh
            </button>
          </div>

          {loading && messages.length === 0 ? (
            <div className="py-12 flex items-center justify-center text-neutral-500 gap-2 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Loading Official Chat history...</span>
            </div>
          ) : messages.length === 0 ? (
            <p className="text-sm text-neutral-500 py-10 text-center">
              No Official Chat messages sent yet.
            </p>
          ) : (
            <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {messages.map((msg) => (
                <div key={msg.id} className="py-4 first:pt-0 last:pb-0 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={cn(
                          'px-2 py-0.5 rounded text-[11px] font-semibold uppercase',
                          msg.senderRole === 'super_admin'
                            ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300'
                            : 'bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
                        )}
                      >
                        {msg.senderRole === 'super_admin' ? 'Super Admin' : 'Moderator'}
                      </span>
                      <span className="text-xs text-neutral-500 tabular-nums">
                        {new Date(msg.createdAt).toLocaleString()}
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-xs font-semibold tabular-nums">
                        <Users className="w-3 h-3" />
                        {msg.deliveredCount} received
                      </span>
                    </div>

                    <button
                      type="button"
                      disabled={deletingId === msg.id}
                      onClick={() => setConfirmDeleteMsg(msg)}
                      className="px-2.5 py-1 rounded-lg border border-rose-200 dark:border-rose-900/60 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete for Everyone</span>
                    </button>
                  </div>

                  {msg.imageUrl && (
                    <img
                      src={msg.imageUrl}
                      alt="Official attachment"
                      onClick={() => setPreviewImage(msg.imageUrl || null)}
                      className="max-h-60 rounded-lg border border-neutral-200 dark:border-neutral-800 object-cover cursor-pointer hover:opacity-95"
                    />
                  )}

                  {msg.text && (
                    <p className="text-sm text-neutral-800 dark:text-neutral-200 whitespace-pre-wrap break-words leading-relaxed">
                      {renderSafeLinkText(msg.text)}
                    </p>
                  )}

                  {msg.senderEmail && (
                    <p className="text-[11px] text-neutral-400">
                      Sent by {msg.senderEmail}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Delete for Everyone Confirmation Modal */}
      {confirmDeleteMsg && (
        <div
          onClick={() => !deletingId && setConfirmDeleteMsg(null)}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 shadow-2xl space-y-4"
          >
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
                  Delete for Everyone?
                </h4>
                <p className="text-xs text-neutral-500 mt-1">
                  This official message will immediately disappear from every user&apos;s Official Chat.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={Boolean(deletingId)}
                onClick={() => setConfirmDeleteMsg(null)}
                className="px-3.5 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 text-xs font-semibold text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={Boolean(deletingId)}
                onClick={() => void handleConfirmDelete()}
                className="px-3.5 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {deletingId && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Delete for Everyone</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <ImageViewerModal
        imageUrl={previewImage}
        onClose={() => setPreviewImage(null)}
      />
    </div>
  );
};
