import React, { useState, useEffect, useCallback } from 'react';
import { X, Mail, Bell, Copy, Check, Loader2, AlertCircle } from 'lucide-react';
import { cn } from '@/src/lib/utils';

type TemplateKey = 'warning' | 'restricted' | 'suspend' | 'permanent_ban' | 'restore';

interface TemplateItem {
  emailSubject: string;
  emailHtml: string;
  notificationTitle: string;
  notificationMessage: string;
  notificationType: string;
}

interface ModerationTemplatesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const TEMPLATE_LABELS: { key: TemplateKey; label: string }[] = [
  { key: 'warning', label: '1. Warning' },
  { key: 'restricted', label: '2. Restricted' },
  { key: 'suspend', label: '3. Suspended' },
  { key: 'permanent_ban', label: '4. Permanent Ban' },
  { key: 'restore', label: '5. Restored' },
];

export const ModerationTemplatesModal: React.FC<ModerationTemplatesModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [selectedKey, setSelectedKey] = useState<TemplateKey>('suspend');
  const [templates, setTemplates] = useState<Record<string, TemplateItem> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadTemplates = useCallback(async () => {
    const token =
      typeof window !== 'undefined'
        ? localStorage.getItem('liveconnect_session_token') ||
          localStorage.getItem('liveconnect_appeal_token') ||
          ''
        : '';
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/account/templates', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load templates');
      setTemplates(data.templates || null);
    } catch (err: any) {
      setError(err?.message || 'Could not load moderation templates.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void loadTemplates();
    }
  }, [isOpen, loadTemplates]);

  if (!isOpen) return null;

  const activeTemplate = templates?.[selectedKey];

  const handleCopyHtml = async () => {
    if (!activeTemplate?.emailHtml) return;
    try {
      await navigator.clipboard.writeText(activeTemplate.emailHtml);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in font-sans">
      <div className="w-full max-w-3xl rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-2xl overflow-hidden flex flex-col max-h-[92vh] text-neutral-900 dark:text-neutral-100">
        {/* Header */}
        <div className="px-5 py-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold">Notification & Email Templates</h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Official account enforcement messages delivered in-app and via email
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close templates modal"
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Selector bar */}
        <div className="px-5 py-3 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950/40 flex flex-wrap gap-2">
          {TEMPLATE_LABELS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setSelectedKey(item.key)}
              className={cn(
                'min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer',
                selectedKey === item.key
                  ? 'bg-[#0095F6] text-white'
                  : 'bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700'
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-5">
          {loading ? (
            <div className="py-12 flex items-center justify-center gap-2 text-xs text-neutral-500">
              <Loader2 className="w-4 h-4 animate-spin text-[#0095F6]" />
              <span>Loading templates...</span>
            </div>
          ) : error ? (
            <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 flex items-center gap-2.5 text-xs text-red-700 dark:text-red-300">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : activeTemplate ? (
            <>
              {/* In-App Notification Card */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                  <Bell className="w-3.5 h-3.5 text-[#0095F6]" />
                  <span>In-App Notification</span>
                </div>
                <div className="p-4 rounded-xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-sm font-bold">{activeTemplate.notificationTitle}</h4>
                    <span className="text-[11px] font-mono text-neutral-500">
                      {activeTemplate.notificationType}
                    </span>
                  </div>
                  <p className="text-xs text-neutral-600 dark:text-neutral-300 leading-relaxed">
                    {activeTemplate.notificationMessage}
                  </p>
                </div>
              </div>

              {/* Email Template Preview */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                    <Mail className="w-3.5 h-3.5 text-[#0095F6]" />
                    <span>Email Template</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyHtml}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-xs font-semibold cursor-pointer"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? 'Copied HTML' : 'Copy HTML'}</span>
                  </button>
                </div>

                <div className="px-3.5 py-2.5 rounded-xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700 text-xs">
                  <span className="text-neutral-500 mr-1.5 font-semibold">Subject:</span>
                  <span className="font-bold">{activeTemplate.emailSubject}</span>
                </div>

                <div className="rounded-xl overflow-hidden border border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-950">
                  <iframe
                    title="Email Template Preview"
                    sandbox=""
                    srcDoc={activeTemplate.emailHtml}
                    className="w-full h-[360px] bg-white"
                  />
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};
