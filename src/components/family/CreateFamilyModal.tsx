import React, { useRef, useState } from 'react';
import { X, Users, Camera, Loader2, ShieldCheck, Check } from 'lucide-react';
import { Profile } from '@/src/types';
import { uploadMediaToServer } from '@/src/lib/mediaUpload';
import { FAMILY_RELATION_PRESETS } from '@/src/lib/family/constants';
import { useLanguage } from '@/src/lib/LanguageContext';
import { cn } from '@/src/lib/utils';

interface CreateFamilyModalProps {
  isOpen: boolean;
  currentUser: Profile | null;
  onClose: () => void;
  onCreate: (params: {
    name: string;
    photoUrl?: string | null;
    joinApprovalRequired?: boolean;
    relationTag?: string | null;
  }) => Promise<any>;
}

export const CreateFamilyModal: React.FC<CreateFamilyModalProps> = ({
  isOpen,
  currentUser,
  onClose,
  onCreate,
}) => {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [joinApprovalRequired, setJoinApprovalRequired] = useState(true);
  const [selectedPreset, setSelectedPreset] = useState<string>('');
  const [customTag, setCustomTag] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file.');
      return;
    }

    setUploadingPhoto(true);
    setError(null);
    try {
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const uploaded = await uploadMediaToServer(dataUrl, {
        mimeType: file.type || 'image/jpeg',
        fileName: file.name || 'family-photo.jpg',
        mediaType: 'image',
        category: 'chat-photo',
        userId: currentUser?.id || 'user',
      });
      if (uploaded) {
        setPhotoUrl(uploaded);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to upload photo.');
    } finally {
      setUploadingPhoto(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) {
      setError('Please enter a Family name.');
      return;
    }

    const finalRelationTag =
      selectedPreset === 'Other'
        ? customTag.trim() || null
        : selectedPreset || null;

    setSubmitting(true);
    setError(null);
    try {
      await onCreate({
        name: cleanName,
        photoUrl,
        joinApprovalRequired,
        relationTag: finalRelationTag,
      });
      setName('');
      setPhotoUrl(null);
      setJoinApprovalRequired(true);
      setSelectedPreset('');
      setCustomTag('');
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Could not create Family.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 w-full max-w-md rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-800/40">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-600/10 text-blue-600 dark:text-blue-400">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-neutral-900 dark:text-neutral-100">
                {t('family.createTitle', 'Create a Family')}
              </h3>
              <p className="text-[11px] text-neutral-500">
                Up to 5,000 members • Private family space
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-200/70 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-700 dark:text-rose-300 font-medium">
              {error}
            </div>
          )}

          {/* Optional Family Photo */}
          <div className="flex flex-col items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handlePhotoChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingPhoto}
              className="relative w-20 h-20 rounded-3xl bg-neutral-100 dark:bg-neutral-800 border-2 border-dashed border-neutral-300 dark:border-neutral-700 hover:border-blue-500 dark:hover:border-blue-500 flex items-center justify-center overflow-hidden transition-colors cursor-pointer group"
            >
              {photoUrl ? (
                <img src={photoUrl} alt="Family" className="w-full h-full object-cover" />
              ) : (
                <Users className="w-8 h-8 text-neutral-400 group-hover:text-blue-500 transition-colors" />
              )}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                {uploadingPhoto ? (
                  <Loader2 className="w-5 h-5 text-white animate-spin" />
                ) : (
                  <Camera className="w-5 h-5 text-white" />
                )}
              </div>
            </button>
            <span className="text-[11px] text-neutral-500 font-medium">
              {uploadingPhoto ? 'Uploading photo...' : photoUrl ? 'Tap to change photo' : 'Optional Family photo'}
            </span>
          </div>

          {/* Family Name */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300">
              Family Name <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder="e.g., Sharma Family"
              required
              className="w-full px-3.5 py-2.5 rounded-2xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-sm text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            />
          </div>

          {/* Creator Relation Tag */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300">
              Your Relation Tag <span className="text-neutral-400 font-normal">(optional)</span>
            </label>
            <div className="flex flex-wrap gap-1.5">
              {FAMILY_RELATION_PRESETS.map((preset) => {
                const active = selectedPreset === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setSelectedPreset(active ? '' : preset)}
                    className={cn(
                      'px-2.5 py-1 rounded-xl text-[11px] font-semibold border transition-all cursor-pointer',
                      active
                        ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                        : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border-neutral-200 dark:border-neutral-700 hover:bg-neutral-200/80 dark:hover:bg-neutral-700'
                    )}
                  >
                    {preset}
                  </button>
                );
              })}
            </div>
            {selectedPreset === 'Other' && (
              <input
                type="text"
                value={customTag}
                onChange={(e) => setCustomTag(e.target.value)}
                maxLength={24}
                placeholder="Enter custom relation (e.g., Uncle, Cousin)"
                className="w-full mt-1.5 px-3 py-2 rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-xs text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
            )}
          </div>

          {/* Join Approval Toggle */}
          <div
            onClick={() => setJoinApprovalRequired((v) => !v)}
            className="p-3.5 rounded-2xl bg-neutral-50 dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700/70 flex items-center justify-between gap-3 cursor-pointer"
          >
            <div className="flex items-start gap-2.5 min-w-0">
              <ShieldCheck className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-bold text-neutral-900 dark:text-neutral-100">
                  Require Join Approval
                </p>
                <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                  People joining with the invite link need Owner or Admin approval first.
                </p>
              </div>
            </div>
            <div
              className={cn(
                'w-10 h-6 rounded-full p-0.5 transition-colors shrink-0 flex items-center',
                joinApprovalRequired ? 'bg-blue-600 justify-end' : 'bg-neutral-300 dark:bg-neutral-700 justify-start'
              )}
            >
              <div className="w-5 h-5 rounded-full bg-white shadow-xs" />
            </div>
          </div>

          {/* Actions */}
          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-2xl border border-neutral-300 dark:border-neutral-700 text-xs font-semibold text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
            >
              {t('action.cancel', 'Cancel')}
            </button>
            <button
              type="submit"
              disabled={submitting || uploadingPhoto || !name.trim()}
              className="px-5 py-2.5 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-md shadow-blue-500/20 disabled:opacity-50 flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Creating...</span>
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Create Family</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
