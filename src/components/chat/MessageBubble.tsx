import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { Message, Profile, CallType, Conversation } from '@/src/types';
import { cn, formatTime, formatMessagePreview } from '@/src/lib/utils';
import { UserAvatar } from '../ui/UserAvatar';
import {
  Check,
  CheckCheck,
  Trash2,
  Copy,
  MoreHorizontal,
  Play,
  Pause,
  Mic,
  Maximize2,
  RotateCcw,
  Loader2,
  Pin,
  PinOff,
  Reply,
  Share2,
  Flag,
  Languages,
  Globe,
  X,
  ShieldCheck,
  Crown,
  Shield,
  Eye,
} from 'lucide-react';
import { useLanguage } from '@/src/lib/LanguageContext';
import { FAMILY_QUICK_REACTIONS } from '@/src/lib/family/constants';
import { WorldLanguage } from '@/src/lib/worldData';
import { getCachedTranslation, translateChatText } from '@/src/lib/messageTranslation';

// WhatsApp-style accurate SVG call icons
const WhatsAppMissedVoiceIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" />
    <line x1="21" y1="3" x2="14" y2="10" />
    <polyline points="20 10 14 10 14 4" />
  </svg>
);

const WhatsAppMissedVideoIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="2" y="7" width="13" height="12" rx="2.5" />
    <path d="m15 11 6-4v10l-6-4" />
    <line x1="10" y1="8" x2="4" y2="14" />
    <polyline points="9 14 4 14 4 9" />
  </svg>
);

const WhatsAppOutgoingVoiceIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" />
    <line x1="15" y1="3" x2="22" y2="3" />
    <line x1="22" y1="3" x2="22" y2="10" />
    <line x1="15" y1="10" x2="22" y2="3" />
  </svg>
);

const WhatsAppOutgoingVideoIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="2" y="7" width="13" height="12" rx="2.5" />
    <path d="m15 11 6-4v10l-6-4" />
    <line x1="4" y1="15" x2="10" y2="9" />
    <polyline points="5 9 10 9 10 14" />
  </svg>
);

const WhatsAppIncomingVoiceIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" />
    <line x1="21" y1="3" x2="14" y2="10" />
    <polyline points="20 10 14 10 14 4" />
  </svg>
);

const WhatsAppIncomingVideoIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="2" y="7" width="13" height="12" rx="2.5" />
    <path d="m15 11 6-4v10l-6-4" />
    <line x1="10" y1="8" x2="4" y2="14" />
    <polyline points="9 14 4 14 4 9" />
  </svg>
);

// Universal 16-bit PCM WAV encoder to convert any decoded AudioBuffer into a clean playable WAV Blob
function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const numSamples = buffer.length * numChannels;
  const byteLength = numSamples * (bitDepth / 8);
  const arrayBuffer = new ArrayBuffer(44 + byteLength);
  const view = new DataView(arrayBuffer);

  function writeString(view: DataView, offset: number, string: string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  /* RIFF identifier */
  writeString(view, 0, 'RIFF');
  /* file length */
  view.setUint32(4, 36 + byteLength, true);
  /* RIFF type */
  writeString(view, 8, 'WAVE');
  /* format chunk identifier */
  writeString(view, 12, 'fmt ');
  /* format chunk length */
  view.setUint32(16, 16, true);
  /* sample format (PCM) */
  view.setUint16(20, format, true);
  /* channel count */
  view.setUint16(22, numChannels, true);
  /* sample rate */
  view.setUint32(24, sampleRate, true);
  /* byte rate (sample rate * block align) */
  view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true);
  /* block align (channel count * bytes per sample) */
  view.setUint16(32, numChannels * (bitDepth / 8), true);
  /* bits per sample */
  view.setUint16(34, bitDepth, true);
  /* data chunk identifier */
  writeString(view, 36, 'data');
  /* data chunk length */
  view.setUint32(40, byteLength, true);

  const channels: Float32Array[] = [];
  for (let i = 0; i < numChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      let sample = channels[channel][i];
      sample = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }

  return new Blob([view], { type: 'audio/wav' });
}

// universal audio recovery using server-side MP3 transcoding + client-side Web Audio API fallback
async function recoverAudio(src: string): Promise<string | null> {
  if (!src || src.length < 5) return null;

  // Strategy 1: Server-side transcode via FFmpeg (universal, rock-solid for WebM, Opus, Ogg, and AAC)
  try {
    let payload: { base64Data?: string; fileId?: string } | null = null;
    if (src.startsWith('/api/media/file/')) {
      const fileId = src.replace('/api/media/file/', '');
      payload = { fileId };
    } else if (src.startsWith('data:')) {
      const commaIdx = src.indexOf(',');
      const base64Data = commaIdx !== -1 ? src.substring(commaIdx + 1) : src;
      payload = { base64Data };
    } else if (src.startsWith('blob:')) {
      const res = await fetch(src);
      const blob = await res.blob();
      const b64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const resStr = (reader.result as string) || '';
          const comma = resStr.indexOf(',');
          resolve(comma !== -1 ? resStr.substring(comma + 1) : resStr);
        };
        reader.onerror = () => resolve('');
        reader.readAsDataURL(blob);
      });
      if (b64) payload = { base64Data: b64 };
    }

    if (payload) {
      const response = await fetch('/api/media/transcode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (response.ok) {
        const data = await response.json();
        if (data.url) {
          return data.url;
        }
      }
    }
  } catch (serverErr) {
    console.warn('Server transcode recovery notice:', serverErr);
  }

  // Strategy 2: Client-side Web Audio API decoding into 16-bit PCM WAV blob
  try {
    let arrayBuffer: ArrayBuffer;
    if (src.startsWith('data:')) {
      const commaIdx = src.indexOf(',');
      const b64 = commaIdx !== -1 ? src.substring(commaIdx + 1) : src;
      const binaryStr = atob(b64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      arrayBuffer = bytes.buffer;
    } else {
      const res = await fetch(src);
      if (!res.ok) return null;
      arrayBuffer = await res.arrayBuffer();
    }

    if (!arrayBuffer || arrayBuffer.byteLength < 32) return null;

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return null;

    const ctx = new AudioContextClass();
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {}
    }

    const audioBuffer = await new Promise<AudioBuffer>((resolve, reject) => {
      ctx.decodeAudioData(arrayBuffer, resolve, reject);
    });

    try {
      ctx.close();
    } catch {}

    if (!audioBuffer) return null;
    const wavBlob = audioBufferToWav(audioBuffer);
    return URL.createObjectURL(wavBlob);
  } catch (clientErr) {
    console.warn('Web Audio recovery notice:', clientErr);
    return null;
  }
}

// WhatsApp-style Voice Note Audio Player with multi-tier recovery fallback
const VoiceNotePlayer = ({
  audioSrc,
  durationSec,
  isMine,
}: {
  audioSrc: string;
  durationSec: number;
  isMine: boolean;
}) => {
  const [playableSrc, setPlayableSrc] = useState<string>(audioSrc);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(durationSec || 1);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [hasError, setHasError] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recoveryAttemptedRef = useRef(false);
  const prevBlobUrlRef = useRef<string | null>(null);

  // Sync playableSrc with incoming audioSrc
  useEffect(() => {
    if (prevBlobUrlRef.current && prevBlobUrlRef.current.startsWith('blob:')) {
      URL.revokeObjectURL(prevBlobUrlRef.current);
      prevBlobUrlRef.current = null;
    }
    setPlayableSrc(audioSrc);
    setHasError(false);
    recoveryAttemptedRef.current = false;
  }, [audioSrc]);

  // Clean up object URLs on unmount
  useEffect(() => {
    return () => {
      if (prevBlobUrlRef.current && prevBlobUrlRef.current.startsWith('blob:')) {
        URL.revokeObjectURL(prevBlobUrlRef.current);
        prevBlobUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updateProgress = () => {
      setCurrentTime(audio.currentTime);
      if (audio.duration && !isNaN(audio.duration) && isFinite(audio.duration) && audio.duration > 0) {
        setTotalDuration(Math.round(audio.duration));
      }
      // If we've reached the known duration but the audio hasn't fired 'ended' yet, we should pause it manually.
      if (totalDuration > 0 && audio.currentTime >= totalDuration) {
        if (!audio.paused) {
          audio.pause();
        }
        setIsPlaying(false);
        setCurrentTime(0);
      }
    };

    const handleLoadedMetadata = () => {
      setHasError(false);
      if (audio.duration && !isNaN(audio.duration) && isFinite(audio.duration) && audio.duration > 0) {
        setTotalDuration(Math.round(audio.duration));
      }
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    const handleError = async () => {
      // Auto-recover seamlessly on format or decode failure
      if (!recoveryAttemptedRef.current && audioSrc && audioSrc.length > 10) {
        recoveryAttemptedRef.current = true;
        setIsRecovering(true);
        const recoveredUrl = await recoverAudio(audioSrc);
        setIsRecovering(false);
        if (recoveredUrl) {
          prevBlobUrlRef.current = recoveredUrl;
          setPlayableSrc(recoveredUrl);
          setHasError(false);
          setTimeout(async () => {
            if (audioRef.current) {
              try {
                audioRef.current.playbackRate = playbackRate;
                await audioRef.current.play();
                setIsPlaying(true);
              } catch {}
            }
          }, 100);
          return;
        }
      }

      setIsPlaying(false);
      setHasError(true);
    };

    audio.addEventListener('timeupdate', updateProgress);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('timeupdate', updateProgress);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
    };
  }, [playableSrc, audioSrc, totalDuration]);

  const togglePlay = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      if (hasError) {
        setHasError(false);
        setIsRecovering(true);
        const recoveredUrl = await recoverAudio(audioSrc);
        setIsRecovering(false);
        if (recoveredUrl) {
          prevBlobUrlRef.current = recoveredUrl;
          setPlayableSrc(recoveredUrl);
          setHasError(false);
          setTimeout(async () => {
            if (audioRef.current) {
              try {
                audioRef.current.playbackRate = playbackRate;
                await audioRef.current.play();
                setIsPlaying(true);
              } catch {
                setIsPlaying(false);
                setHasError(true);
              }
            }
          }, 60);
          return;
        }
      }

      setHasError(false);
      try {
        audio.playbackRate = playbackRate;
        await audio.play();
        setIsPlaying(true);
      } catch (err: any) {
        setIsRecovering(true);
        const recoveredUrl = await recoverAudio(audioSrc);
        setIsRecovering(false);
        if (recoveredUrl) {
          prevBlobUrlRef.current = recoveredUrl;
          setPlayableSrc(recoveredUrl);
          setHasError(false);
          setTimeout(async () => {
            if (audioRef.current) {
              try {
                audioRef.current.playbackRate = playbackRate;
                await audioRef.current.play();
                setIsPlaying(true);
              } catch {
                setIsPlaying(false);
                setHasError(true);
              }
            }
          }, 60);
        } else {
          setIsPlaying(false);
          setHasError(true);
        }
      }
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const audio = audioRef.current;
    if (!audio || !totalDuration) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    const newTime = ratio * totalDuration;
    audio.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const cycleSpeed = (e: React.MouseEvent) => {
    e.stopPropagation();
    const nextRate = playbackRate === 1 ? 1.5 : playbackRate === 1.5 ? 2 : 1;
    setPlaybackRate(nextRate);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextRate;
    }
  };

  const progressPercent = totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0;

  const formatAudioTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const hasValidAudioSrc = Boolean(playableSrc && playableSrc.trim().length >= 5);

  return (
    <div className="flex items-center gap-3 py-1 min-w-[205px] max-w-[265px] select-none">
      {hasValidAudioSrc && (
        <audio ref={audioRef} src={playableSrc} preload="none" playsInline />
      )}

      {/* Play/Pause / Retry Button */}
      <button
        type="button"
        onClick={togglePlay}
        disabled={isRecovering}
        title={isRecovering ? 'Decoding audio...' : hasError ? 'Retry voice message' : isPlaying ? 'Pause' : 'Play voice message'}
        className={cn(
          'w-9 h-9 rounded-full flex items-center justify-center shadow-xs transition-transform active:scale-95 cursor-pointer shrink-0',
          isMine
            ? 'bg-white text-blue-600 hover:bg-blue-50'
            : hasError
            ? 'bg-amber-600 text-white hover:bg-amber-700'
            : 'bg-blue-600 text-white hover:bg-blue-700',
          isRecovering && 'opacity-80 cursor-wait'
        )}
      >
        {isRecovering ? (
          <Loader2 className="w-4 h-4 animate-spin text-current" />
        ) : hasError ? (
          <RotateCcw className="w-4 h-4 text-current" />
        ) : isPlaying ? (
          <Pause className="w-4 h-4 fill-current" />
        ) : (
          <Play className="w-4 h-4 fill-current ml-0.5" />
        )}
      </button>

      {/* Waveform Bars & Slider */}
      <div className="flex-1 flex flex-col justify-center gap-1 min-w-0">
        <div
          onClick={handleSeek}
          className="flex items-center gap-0.5 h-6 cursor-pointer py-1 group/seek"
          title="Click to seek"
        >
          {[40, 75, 55, 90, 60, 80, 45, 95, 70, 50, 85, 65, 40, 90, 70, 55, 80, 60].map((h, i) => {
            const barProgress = (i / 18) * 100;
            const isFilled = barProgress <= progressPercent;
            return (
              <div
                key={i}
                style={{ height: `${h}%` }}
                className={cn(
                  'w-1 rounded-full transition-colors group-hover/seek:opacity-90',
                  isMine
                    ? isFilled
                      ? 'bg-white'
                      : 'bg-blue-400/60'
                    : isFilled
                    ? 'bg-blue-600'
                    : 'bg-neutral-300 dark:bg-neutral-600'
                )}
              />
            );
          })}
        </div>

        <div className="flex items-center justify-between text-[11px] font-mono leading-none">
          <span className={isMine ? 'text-blue-100' : 'text-neutral-500 dark:text-neutral-400'}>
            {formatAudioTime(isPlaying ? currentTime : totalDuration)}
          </span>

          <button
            type="button"
            onClick={cycleSpeed}
            className={cn(
              'text-[10px] px-1 py-0.5 rounded-md font-bold cursor-pointer transition-colors',
              isMine
                ? 'bg-white/20 text-white hover:bg-white/30'
                : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-300'
            )}
          >
            {playbackRate}x
          </button>
        </div>
      </div>
    </div>
  );
};

interface MessageBubbleProps {
  message: Message;
  isMine: boolean;
  showAvatar?: boolean;
  onDeleteMessage?: (id: string) => void;
  onStartCall?: (peer: Profile, type: CallType) => void;
  onViewImage?: (imageUrl: string, caption?: string) => void;
  otherUser?: Profile;
  conversation?: Conversation | null;
  onReplyMessage?: (message: Message) => void;
  onForwardMessage?: (message: Message) => void;
  onReactMessage?: (messageId: string, emoji: string) => void;
  onPinMessage?: (message: Message) => void;
  onReportMessage?: (message: Message) => void;
  resolveReplyMessage?: (id: string) => Message | undefined;
  isPinned?: boolean;
  onOpenProfileView?: (profile: Profile) => void;
  shouldAnimate?: boolean;
  defaultTargetLang?: WorldLanguage;
  autoTranslate?: boolean;
  onOpenTranslatePicker?: (
    selectedCode: string,
    onPicked: (lang: WorldLanguage) => void,
    title?: string
  ) => void;
  // Optional Family Group extensions
  currentUserId?: string;
  isFamilyMode?: boolean;
  senderRelationTag?: string | null;
  senderRoleBadge?: 'owner' | 'admin' | 'member' | null;
  isSystemMessage?: boolean;
  isSafeCheckIn?: boolean;
  isDeletedTombstone?: boolean;
  seenCount?: number;
  onShowSeenDetails?: (messageId: string) => void;
}

const SWIPE_REPLY_THRESHOLD = 52;
const SWIPE_MAX_OFFSET = 78;
const HOLD_DURATION_MS = 1000;

const isInteractiveTarget = (target: EventTarget | null): boolean => {
  if (!target || !(target instanceof Element)) return false;
  return Boolean(target.closest('button, a, video, audio, input, textarea'));
};

const MessageBubbleComponent: React.FC<MessageBubbleProps> = ({
  message,
  isMine,
  showAvatar = true,
  onDeleteMessage,
  onStartCall,
  onViewImage,
  otherUser,
  onReplyMessage,
  onForwardMessage,
  onReactMessage,
  onPinMessage,
  onReportMessage,
  resolveReplyMessage,
  isPinned = false,
  shouldAnimate,
  defaultTargetLang,
  autoTranslate = false,
  onOpenTranslatePicker,
  currentUserId,
  isFamilyMode = false,
  senderRelationTag,
  senderRoleBadge,
  isSystemMessage = false,
  isSafeCheckIn = false,
  isDeletedTombstone = false,
  seenCount = 0,
  onShowSeenDetails,
}) => {
  const { t, currentLanguage } = useLanguage();
  const resolvedTargetLang = defaultTargetLang || currentLanguage;
  const [shouldAnimateOnMount] = useState(
    () => Boolean(shouldAnimate ?? (message as Message & { should_animate?: boolean }).should_animate)
  );
  const [showConfirm, setShowConfirm] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [menuCoords, setMenuCoords] = useState<{ top: number; left: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const [translation, setTranslation] = useState<{
    text: string;
    detectedLanguage: string;
    lang: WorldLanguage;
  } | null>(null);
  const [showTranslation, setShowTranslation] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [copiedTranslation, setCopiedTranslation] = useState(false);
  const activeTranslateReqRef = useRef(0);

  const rowRef = useRef<HTMLDivElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swipeOffsetRef = useRef(0);
  const suppressNextClickRef = useRef(false);
  const mouseStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const touchGestureRef = useRef<{
    startX: number;
    startY: number;
    mode: 'pending' | 'swipe' | 'scroll';
    thresholdHit: boolean;
  } | null>(null);

  const clearHoldTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const closeMenu = useCallback(() => {
    setShowMenu(false);
    setShowConfirm(false);
    setMenuCoords(null);
  }, []);

  const openMenuAtElement = useCallback(
    (anchorEl?: HTMLElement | null) => {
      const targetEl = anchorEl || bubbleRef.current || rowRef.current;
      if (targetEl && typeof window !== 'undefined') {
        const rect = targetEl.getBoundingClientRect();
        const estWidth = 196;
        const estHeight = 250;
        const pad = 12;

        let left = isMine ? rect.right - estWidth : rect.left;
        left = Math.max(pad, Math.min(left, window.innerWidth - estWidth - pad));

        let top = rect.top - estHeight - 8;
        if (top < pad) {
          top = rect.bottom + 8;
        }
        top = Math.max(pad, Math.min(top, window.innerHeight - estHeight - pad));

        setMenuCoords({ top, left });
      } else {
        setMenuCoords({ top: 120, left: 24 });
      }
      setShowConfirm(false);
      setShowMenu(true);
    },
    [isMine]
  );

  // Refine floating menu coordinates based on exact rendered width/height
  useLayoutEffect(() => {
    if (!showMenu || !menuRef.current || typeof window === 'undefined') return;
    const anchorEl = bubbleRef.current || rowRef.current;
    if (!anchorEl) return;
    const anchorRect = anchorEl.getBoundingClientRect();
    const menuRect = menuRef.current.getBoundingClientRect();
    const pad = 12;

    let left = isMine ? anchorRect.right - menuRect.width : anchorRect.left;
    left = Math.max(pad, Math.min(left, window.innerWidth - menuRect.width - pad));

    let top = anchorRect.top - menuRect.height - 8;
    if (top < pad) {
      top = anchorRect.bottom + 8;
    }
    if (top + menuRect.height > window.innerHeight - pad) {
      top = Math.max(pad, window.innerHeight - menuRect.height - pad);
    }

    setMenuCoords((prev) =>
      prev && Math.abs(prev.top - top) < 2 && Math.abs(prev.left - left) < 2
        ? prev
        : { top, left }
    );
  }, [showMenu, showConfirm, isMine]);

  // Close menu on outside click or Escape
  useEffect(() => {
    if (!showMenu) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showMenu, closeMenu]);

  useEffect(() => {
    return () => {
      clearHoldTimer();
    };
  }, [clearHoldTimer]);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (showMenu || e.touches.length !== 1 || isInteractiveTarget(e.target)) return;
    const touch = e.touches[0];
    if (!touch) return;

    touchGestureRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      mode: 'pending',
      thresholdHit: false,
    };
    clearHoldTimer();
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      touchGestureRef.current = null;
      suppressNextClickRef.current = true;
      setTimeout(() => {
        suppressNextClickRef.current = false;
      }, 450);
      try {
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          navigator.vibrate?.(45);
        }
      } catch {}
      openMenuAtElement(bubbleRef.current || rowRef.current);
    }, HOLD_DURATION_MS);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const gesture = touchGestureRef.current;
    const touch = e.touches[0];
    if (!gesture || !touch) return;

    const dx = touch.clientX - gesture.startX;
    const dy = touch.clientY - gesture.startY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (absDx > 8 || absDy > 8) {
      clearHoldTimer();
    }

    if (gesture.mode === 'pending') {
      if (onReplyMessage && dx > 10 && absDx > absDy * 1.2) {
        gesture.mode = 'swipe';
        setIsSwiping(true);
      } else if (absDy > 10 || dx < -10) {
        gesture.mode = 'scroll';
      }
    }

    if (gesture.mode === 'swipe') {
      const clamped =
        dx <= 0
          ? 0
          : dx <= SWIPE_REPLY_THRESHOLD
          ? dx
          : Math.min(SWIPE_MAX_OFFSET, SWIPE_REPLY_THRESHOLD + (dx - SWIPE_REPLY_THRESHOLD) * 0.45);
      swipeOffsetRef.current = clamped;
      setSwipeOffset(clamped);

      if (clamped >= SWIPE_REPLY_THRESHOLD && !gesture.thresholdHit) {
        gesture.thresholdHit = true;
        try {
          if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
            navigator.vibrate?.(20);
          }
        } catch {}
      } else if (clamped < SWIPE_REPLY_THRESHOLD - 6) {
        gesture.thresholdHit = false;
      }
    }
  };

  const handleTouchEndOrCancel = () => {
    clearHoldTimer();
    const gesture = touchGestureRef.current;
    touchGestureRef.current = null;

    if (gesture?.mode === 'swipe') {
      const triggered = gesture.thresholdHit || swipeOffsetRef.current >= SWIPE_REPLY_THRESHOLD;
      swipeOffsetRef.current = 0;
      setIsSwiping(false);
      setSwipeOffset(0);

      if (triggered && onReplyMessage) {
        suppressNextClickRef.current = true;
        setTimeout(() => {
          suppressNextClickRef.current = false;
        }, 300);
        onReplyMessage(message);
      }
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || showMenu || isInteractiveTarget(e.target)) return;
    mouseStartPosRef.current = { x: e.clientX, y: e.clientY };
    clearHoldTimer();
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      mouseStartPosRef.current = null;
      suppressNextClickRef.current = true;
      setTimeout(() => {
        suppressNextClickRef.current = false;
      }, 450);
      openMenuAtElement(bubbleRef.current || rowRef.current);
    }, HOLD_DURATION_MS);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!mouseStartPosRef.current) return;
    const dx = Math.abs(e.clientX - mouseStartPosRef.current.x);
    const dy = Math.abs(e.clientY - mouseStartPosRef.current.y);
    if (dx > 8 || dy > 8) {
      clearHoldTimer();
      mouseStartPosRef.current = null;
    }
  };

  const handleMouseUpOrLeave = () => {
    clearHoldTimer();
    mouseStartPosRef.current = null;
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    clearHoldTimer();
    openMenuAtElement(bubbleRef.current || rowRef.current);
  };

  const handleDelete = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (showConfirm) {
      onDeleteMessage?.(message.id);
      closeMenu();
    } else {
      setShowConfirm(true);
    }
  };

  // 1. Check if this message is a CALL LOG card: [CALL_LOG:callType:status:missed/answered:durationOrStatus]
  const isCallLog = message.content?.startsWith('[CALL_LOG:') && message.content.endsWith(']');

  if (isCallLog) {
    const rawTokens = message.content.slice(10, -1).split(':');
    const callType: CallType = rawTokens[0] === 'video' ? 'video' : 'audio';
    const rawStatus = rawTokens[1] || 'ended';
    const rawMissedFlag = rawTokens[2];
    const details = rawTokens.slice(3).join(':');

    const isVideo = callType === 'video';
    const callerIsMe = isMine;

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

    let title = '';
    let subtitle = '';

    if (callerIsMe) {
      title = isVideo ? 'Video call' : 'Voice call';
      subtitle = isMissed ? 'No answer' : details;
    } else {
      if (isMissed) {
        title = isVideo ? t('label.missedVideoCall') : t('label.missedAudioCall');
        subtitle = 'Tap to call back';
      } else {
        title = isVideo ? 'Video call' : 'Voice call';
        subtitle = details;
      }
    }

    const peerToCall = otherUser || (isMine ? undefined : message.sender);

    return (
      <div
        className={cn(
          'flex items-end gap-1.5 my-1.5 group relative',
          shouldAnimateOnMount && 'animate-in fade-in duration-150',
          isMine ? 'justify-end' : 'justify-start'
        )}
      >
        {!isMine && showAvatar && (
          <UserAvatar
            src={message.sender?.avatar_url}
            name={message.sender?.display_name || 'User'}
            id={message.sender_id}
            className="w-7 h-7 mb-1 shadow-xs"
          />
        )}

        {isMine && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            {showConfirm ? (
              <button
                onClick={handleDelete}
                className="text-[11px] bg-rose-600 hover:bg-rose-700 active:scale-95 text-white font-bold px-2 py-1 rounded-xl shadow-md transition-all flex items-center gap-1 animate-pulse"
                title="Click again to confirm delete"
              >
                <Trash2 className="w-3 h-3" />
                <span>{t('action.delete')}</span>
              </button>
            ) : (
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setShowMenu(!showMenu)}
                  className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-200/80 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
                  title="Options"
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>
                {showMenu && (
                  <div className="absolute bottom-full right-0 mb-1 z-30 min-w-[120px] p-1 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-xl">
                    <button
                      onClick={handleDelete}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete log</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div
          onClick={() => {
            if (!isMine && peerToCall && onStartCall) {
              onStartCall(peerToCall, callType);
            }
          }}
          className={cn(
            'p-3 rounded-2xl shadow-xs relative text-sm select-none transition-all flex items-center gap-3 min-w-[210px] max-w-[290px]',
            !isMine && peerToCall && onStartCall && 'cursor-pointer active:scale-[0.99]',
            isMine
              ? 'bg-[#d9fdd3] dark:bg-[#005c4b] text-neutral-900 dark:text-neutral-100 rounded-br-xs border border-emerald-300/60 dark:border-emerald-700/50'
              : 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 border border-neutral-200/90 dark:border-neutral-700/60 rounded-bl-xs'
          )}
        >
          <div
            className={cn(
              'w-10 h-10 rounded-full flex items-center justify-center shrink-0 shadow-2xs transition-transform',
              isMine
                ? 'bg-white/80 dark:bg-white/15'
                : isMissed
                ? 'bg-white dark:bg-neutral-700 shadow-xs'
                : 'bg-[#f0f2f5] dark:bg-neutral-700'
            )}
          >
            {isMine ? (
              isVideo ? (
                <WhatsAppOutgoingVideoIcon className="w-5 h-5 text-[#3b4a54] dark:text-emerald-100" />
              ) : (
                <WhatsAppOutgoingVoiceIcon className="w-5 h-5 text-[#3b4a54] dark:text-emerald-100" />
              )
            ) : isMissed ? (
              isVideo ? (
                <WhatsAppMissedVideoIcon className="w-5 h-5 text-[#ea4335] dark:text-[#ef4444]" />
              ) : (
                <WhatsAppMissedVoiceIcon className="w-5 h-5 text-[#ea4335] dark:text-[#ef4444]" />
              )
            ) : isVideo ? (
              <WhatsAppIncomingVideoIcon className="w-5 h-5 text-[#3b4a54] dark:text-neutral-200" />
            ) : (
              <WhatsAppIncomingVoiceIcon className="w-5 h-5 text-[#3b4a54] dark:text-neutral-200" />
            )}
          </div>

          <div className="flex-1 min-w-0 pr-1">
            <div className="font-semibold text-[13.5px] leading-tight text-neutral-900 dark:text-neutral-100 truncate">
              {title}
            </div>
            <div
              className={cn(
                'text-xs leading-tight mt-0.5 truncate',
                isMine
                  ? 'text-neutral-600 dark:text-emerald-100/80 font-normal'
                  : isMissed
                  ? 'text-neutral-500 dark:text-neutral-400 font-normal'
                  : 'text-neutral-500 dark:text-neutral-400 font-normal'
              )}
            >
              {subtitle}
            </div>
          </div>

          <div
            className={cn(
              'self-end text-[10px] shrink-0 font-medium select-none ml-auto pb-0.5',
              isMine ? 'text-neutral-500 dark:text-emerald-100/70' : 'text-neutral-400'
            )}
          >
            {formatTime(message.created_at)}
          </div>
        </div>

        {!isMine && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            {showConfirm ? (
              <button
                onClick={handleDelete}
                className="text-[11px] bg-rose-600 hover:bg-rose-700 active:scale-95 text-white font-bold px-2 py-1 rounded-xl shadow-md transition-all flex items-center gap-1 animate-pulse"
                title="Click again to confirm delete"
              >
                <Trash2 className="w-3 h-3" />
                <span>{t('action.delete')}</span>
              </button>
            ) : (
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setShowMenu(!showMenu)}
                  className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-200/80 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
                  title="Options"
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>
                {showMenu && (
                  <div className="absolute bottom-full left-0 mb-1 z-30 min-w-[120px] p-1 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-xl">
                    <button
                      onClick={handleDelete}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete log</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // 2. Check if message is a STICKER: [STICKER:emojiOrIcon:label]
  const isSticker = message.content?.startsWith('[STICKER:') && message.content.endsWith(']');
  let stickerIcon = '';
  let stickerLabel = '';
  if (isSticker) {
    const raw = message.content.slice(9, -1).split(':');
    stickerIcon = raw[0] || '✨';
    stickerLabel = raw.slice(1).join(':') || 'Sticker';
  }

  // 3. Check if message is an IMAGE: [IMAGE:url] or [IMAGE:url:caption]
  const isImage = message.content?.startsWith('[IMAGE:') && message.content.endsWith(']');
  let imageUrl = '';
  let imageCaption = '';
  if (isImage) {
    const inside = message.content.slice(7, -1);
    if (inside.startsWith('data:image')) {
      const closingBracketPos = inside.indexOf(';base64,');
      if (closingBracketPos !== -1) {
        const nextColon = inside.indexOf(':', closingBracketPos);
        if (nextColon !== -1) {
          imageUrl = inside.slice(0, nextColon);
          imageCaption = inside.slice(nextColon + 1);
        } else {
          imageUrl = inside;
        }
      } else {
        imageUrl = inside;
      }
    } else if (inside.startsWith('http://') || inside.startsWith('https://')) {
      const slashIndex = inside.indexOf('/', 8);
      if (slashIndex !== -1) {
        const nextColon = inside.indexOf(':', slashIndex);
        if (nextColon !== -1) {
          imageUrl = inside.slice(0, nextColon);
          imageCaption = inside.slice(nextColon + 1);
        } else {
          imageUrl = inside;
        }
      } else {
        imageUrl = inside;
      }
    } else {
      const firstColon = inside.indexOf(':');
      if (firstColon !== -1) {
        imageUrl = inside.slice(0, firstColon);
        imageCaption = inside.slice(firstColon + 1);
      } else {
        imageUrl = inside;
      }
    }
  }

  // 4. Check if message is a VIDEO: [VIDEO:url] or [VIDEO:url:caption]
  const isVideo = message.content?.startsWith('[VIDEO:') && message.content.endsWith(']');
  let videoUrl = '';
  let videoCaption = '';
  if (isVideo) {
    const inside = message.content.slice(7, -1);
    if (inside.startsWith('data:video')) {
      const b64Pos = inside.indexOf(';base64,');
      if (b64Pos !== -1) {
        const nextColon = inside.indexOf(':', b64Pos);
        if (nextColon !== -1) {
          videoUrl = inside.slice(0, nextColon);
          videoCaption = inside.slice(nextColon + 1);
        } else {
          videoUrl = inside;
        }
      } else {
        videoUrl = inside;
      }
    } else if (inside.startsWith('http://') || inside.startsWith('https://')) {
      const slashIndex = inside.indexOf('/', 8);
      if (slashIndex !== -1) {
        const nextColon = inside.indexOf(':', slashIndex);
        if (nextColon !== -1) {
          videoUrl = inside.slice(0, nextColon);
          videoCaption = inside.slice(nextColon + 1);
        } else {
          videoUrl = inside;
        }
      } else {
        videoUrl = inside;
      }
    } else {
      const firstColon = inside.indexOf(':');
      if (firstColon !== -1) {
        videoUrl = inside.slice(0, firstColon);
        videoCaption = inside.slice(firstColon + 1);
      } else {
        videoUrl = inside;
      }
    }
  }

  // 5. Check if message is a VOICE NOTE: [VOICE:duration:dataUrl]
  const isVoice = message.content?.startsWith('[VOICE:') && message.content.endsWith(']');
  let voiceDuration = 1;
  let voiceAudioSrc = '';
  if (isVoice) {
    const tokens = message.content.slice(7, -1);
    const colonIdx = tokens.indexOf(':');
    if (colonIdx !== -1) {
      voiceDuration = parseInt(tokens.slice(0, colonIdx), 10) || 1;
      voiceAudioSrc = tokens.slice(colonIdx + 1);
    }
  }

  // 6. Standard text & reply parsing
  let replyId = message.reply_to_message_id || null;
  let textBody = message.content || '';
  if (!isSticker && !isImage && !isVideo && !isVoice && textBody.startsWith('[REPLY:')) {
    const closing = textBody.indexOf(']');
    if (closing !== -1) {
      replyId = replyId || textBody.substring(7, closing);
      textBody = textBody.substring(closing + 1).trim();
    }
  }

  const copyableText = isSticker
    ? `${stickerIcon} ${stickerLabel}`.trim()
    : isImage
    ? imageCaption.trim()
    : isVideo
    ? videoCaption.trim()
    : isVoice
    ? ''
    : textBody.trim();

  const translatableText =
    !isSticker && !isVoice
      ? isImage
        ? imageCaption.trim()
        : isVideo
        ? videoCaption.trim()
        : textBody.trim()
      : '';

  const canCopyText = Boolean(copyableText);

  const handleTranslate = useCallback(
    async (targetLang: WorldLanguage) => {
      if (!translatableText) return;
      const cached = getCachedTranslation(translatableText, targetLang.code);
      if (cached) {
        activeTranslateReqRef.current += 1;
        setTranslation({
          text: cached.translatedText,
          detectedLanguage: cached.detectedLanguage,
          lang: targetLang,
        });
        setTranslateError(null);
        setIsTranslating(false);
        setShowTranslation(true);
        return;
      }

      const reqId = ++activeTranslateReqRef.current;
      setShowTranslation(true);
      setIsTranslating(true);
      setTranslateError(null);

      try {
        const result = await translateChatText({
          text: translatableText,
          targetLang,
        });
        if (activeTranslateReqRef.current !== reqId) return;
        setTranslation({
          text: result.translatedText,
          detectedLanguage: result.detectedLanguage,
          lang: targetLang,
        });
        setTranslateError(null);
      } catch (err: any) {
        if (activeTranslateReqRef.current !== reqId) return;
        setTranslateError(err?.message || 'Could not translate message.');
      } finally {
        if (activeTranslateReqRef.current === reqId) {
          setIsTranslating(false);
        }
      }
    },
    [translatableText]
  );

  useEffect(() => {
    if (!autoTranslate || isMine || !translatableText || !resolvedTargetLang) return;
    void handleTranslate(resolvedTargetLang);
  }, [autoTranslate, isMine, translatableText, resolvedTargetLang?.code, handleTranslate]);

  const handleCopy = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!copyableText) return;
    try {
      if (navigator?.clipboard?.writeText) {
        void navigator.clipboard.writeText(copyableText);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }
    } catch {}
    closeMenu();
  };

  const handleCopyTranslation = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!translation?.text) return;
    try {
      if (navigator?.clipboard?.writeText) {
        void navigator.clipboard.writeText(translation.text);
        setCopiedTranslation(true);
        setTimeout(() => setCopiedTranslation(false), 1800);
      }
    } catch {}
  };

  const renderTranslationBlock = (onColoredBubble: boolean) => {
    if (!showTranslation && !isTranslating && !translateError) return null;
    const activeLang = translation?.lang || resolvedTargetLang;

    return (
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'mt-2 pt-2 border-t space-y-1 text-xs',
          onColoredBubble
            ? 'border-white/25 text-white'
            : 'border-neutral-200 dark:border-neutral-700/80 text-neutral-800 dark:text-neutral-100'
        )}
      >
        <div className="flex items-center justify-between gap-2 text-[10.5px]">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (onOpenTranslatePicker) {
                onOpenTranslatePicker(
                  activeLang.code,
                  (picked) => void handleTranslate(picked),
                  t('action.translateTo', 'Translate Message To')
                );
              }
            }}
            className={cn(
              'inline-flex items-center gap-1 font-semibold px-1.5 py-0.5 rounded-md transition-colors',
              onOpenTranslatePicker && 'cursor-pointer',
              onColoredBubble
                ? 'bg-white/15 hover:bg-white/25 text-blue-50'
                : 'bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/60 text-blue-600 dark:text-blue-400'
            )}
            title="Change translation language (106+)"
          >
            <Languages className="w-3 h-3 shrink-0" />
            <span>
              {activeLang.flag} {activeLang.nativeName}
            </span>
          </button>

          <div className="flex items-center gap-1 shrink-0">
            {translation?.text && !isTranslating && !translateError && (
              <button
                type="button"
                onClick={handleCopyTranslation}
                className={cn(
                  'p-1 rounded-md transition-colors cursor-pointer',
                  onColoredBubble
                    ? 'hover:bg-white/20 text-blue-100'
                    : 'hover:bg-neutral-200/70 dark:hover:bg-neutral-700 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200'
                )}
                title="Copy translation"
              >
                {copiedTranslation ? (
                  <Check className="w-3 h-3 text-emerald-400" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                activeTranslateReqRef.current += 1;
                setIsTranslating(false);
                setShowTranslation(false);
                setTranslateError(null);
              }}
              className={cn(
                'p-1 rounded-md transition-colors cursor-pointer',
                onColoredBubble
                  ? 'hover:bg-white/20 text-blue-100'
                  : 'hover:bg-neutral-200/70 dark:hover:bg-neutral-700 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200'
              )}
              title="Hide translation"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>

        {isTranslating ? (
          <div
            className={cn(
              'flex items-center gap-1.5 text-xs py-0.5',
              onColoredBubble ? 'text-blue-100' : 'text-neutral-500 dark:text-neutral-400'
            )}
          >
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
            <span>Translating to {activeLang.nativeName}...</span>
          </div>
        ) : translateError ? (
          <div className="flex items-center justify-between gap-2 text-[11px] py-0.5">
            <span className={onColoredBubble ? 'text-amber-200' : 'text-rose-600 dark:text-rose-400'}>
              {translateError}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void handleTranslate(activeLang);
              }}
              className={cn(
                'font-bold underline shrink-0 cursor-pointer',
                onColoredBubble ? 'text-white' : 'text-blue-600 dark:text-blue-400'
              )}
            >
              Retry
            </button>
          </div>
        ) : translation ? (
          <p
            dir={translation.lang.dir}
            className="text-sm whitespace-pre-wrap leading-relaxed select-text"
          >
            {translation.text}
          </p>
        ) : null}
      </div>
    );
  };

  const resolvedReplyMsg =
    message.reply_to_message ||
    (replyId && resolveReplyMessage ? resolveReplyMessage(replyId) : undefined);

  const replySender =
    resolvedReplyMsg?.sender?.display_name ||
    resolvedReplyMsg?.sender?.username ||
    (resolvedReplyMsg
      ? otherUser && resolvedReplyMsg.sender_id === otherUser.id
        ? otherUser.display_name || otherUser.username || 'User'
        : 'You'
      : 'Message');

  const replySnippet = resolvedReplyMsg?.content
    ? formatMessagePreview(resolvedReplyMsg.content)
    : '';

  const swipeProgress = Math.min(1, swipeOffset / SWIPE_REPLY_THRESHOLD);

  const renderPinnedPill = (onColoredBubble: boolean) => {
    if (!isPinned) return null;
    return (
      <span
        className={cn(
          'inline-flex items-center gap-0.5 font-semibold mr-1',
          onColoredBubble ? 'text-amber-200' : 'text-amber-500 dark:text-amber-400'
        )}
      >
        <Pin className="w-3 h-3 fill-current" />
        <span>Pinned</span>
      </span>
    );
  };

  const renderOptionsTrigger = () => (
    <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (showMenu) {
            closeMenu();
          } else {
            openMenuAtElement(bubbleRef.current || e.currentTarget);
          }
        }}
        className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-200/80 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
        title="Message options"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
    </div>
  );

  const renderStatusTicksOrSeen = (onColoredBubble: boolean) => {
    if (isFamilyMode) {
      if (!isMine || seenCount <= 0) return null;
      return (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onShowSeenDetails?.(message.id);
          }}
          className={cn(
            'inline-flex items-center gap-1 ml-1 text-[10px] font-medium underline decoration-dotted cursor-pointer',
            onColoredBubble ? 'text-blue-100 hover:text-white' : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700'
          )}
          title="Seen count"
        >
          <Eye className="w-3 h-3" />
          <span>Seen by {seenCount}</span>
        </button>
      );
    }
    if (!isMine) return null;
    return (
      <span className="inline-flex items-center ml-0.5">
        {message.is_read ? (
          <CheckCheck className="w-4 h-4 text-green-300" strokeWidth={2.5} />
        ) : (
          <Check className="w-3.5 h-3.5 text-blue-200/70" strokeWidth={2} />
        )}
      </span>
    );
  };

  const reactionEntries = Object.entries(message.reactions || {}).filter(
    (entry): entry is [string, string[]] => Array.isArray(entry[1]) && entry[1].length > 0
  );

  const renderReactionsBar = () => {
    if (isDeletedTombstone || reactionEntries.length === 0) return null;
    return (
      <div className={cn('flex flex-wrap gap-1 mt-1', isMine ? 'justify-end' : 'justify-start')}>
        {reactionEntries.map(([emoji, userIds]) => {
          const reactedByMe = Boolean(currentUserId && userIds.includes(currentUserId));
          return (
            <button
              key={emoji}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onReactMessage?.(message.id, emoji);
              }}
              className={cn(
                'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border transition-all cursor-pointer',
                reactedByMe
                  ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-400 text-blue-700 dark:text-blue-300'
                  : 'bg-white dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-700'
              )}
            >
              <span>{emoji}</span>
              <span>{userIds.length}</span>
            </button>
          );
        })}
      </div>
    );
  };

  const renderFamilySenderHeader = () => {
    if (!isFamilyMode || isMine) return null;
    const senderDisplay = message.sender?.display_name || message.sender?.username || 'Member';
    return (
      <div className="flex flex-wrap items-center gap-1.5 mb-1 px-1">
        <span className="text-[11.5px] font-bold text-neutral-700 dark:text-neutral-200">
          {senderDisplay}
        </span>
        {senderRelationTag && (
          <span className="px-1.5 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200/70 dark:border-emerald-800/60 text-[10px] font-semibold">
            {senderRelationTag}
          </span>
        )}
        {senderRoleBadge === 'owner' && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-200/70 dark:border-amber-800/60 text-[10px] font-bold">
            <Crown className="w-2.5 h-2.5" />
            Owner
          </span>
        )}
        {senderRoleBadge === 'admin' && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200/70 dark:border-indigo-800/60 text-[10px] font-bold">
            <Shield className="w-2.5 h-2.5" />
            Admin
          </span>
        )}
      </div>
    );
  };

  if (isSystemMessage) {
    return (
      <div id={`msg-${message.id}`} className="flex justify-center my-2.5 px-4">
        <span className="px-3 py-1 rounded-full bg-neutral-200/80 dark:bg-neutral-800/90 text-neutral-600 dark:text-neutral-300 text-[11.5px] font-medium text-center">
          {message.content}
        </span>
      </div>
    );
  }

  return (
    <div
      ref={rowRef}
      id={`msg-${message.id}`}
      onTouchStart={isDeletedTombstone ? undefined : handleTouchStart}
      onTouchMove={isDeletedTombstone ? undefined : handleTouchMove}
      onTouchEnd={isDeletedTombstone ? undefined : handleTouchEndOrCancel}
      onTouchCancel={isDeletedTombstone ? undefined : handleTouchEndOrCancel}
      onMouseDown={isDeletedTombstone ? undefined : handleMouseDown}
      onMouseMove={isDeletedTombstone ? undefined : handleMouseMove}
      onMouseUp={isDeletedTombstone ? undefined : handleMouseUpOrLeave}
      onMouseLeave={isDeletedTombstone ? undefined : handleMouseUpOrLeave}
      onContextMenu={isDeletedTombstone ? undefined : handleContextMenu}
      className={cn(
        'flex items-end gap-1.5 my-1.5 group relative transition-colors rounded-2xl p-0.5 touch-pan-y select-none [-webkit-touch-callout:none]',
        shouldAnimateOnMount && 'animate-in fade-in duration-150',
        isMine ? 'justify-end' : 'justify-start'
      )}
    >
      {/* Swipe-Right Reply Indicator */}
      {swipeOffset > 4 && (
        <div
          className="absolute left-1.5 top-1/2 -translate-y-1/2 pointer-events-none z-10 flex items-center justify-center"
          style={{
            opacity: Math.min(1, swipeProgress * 1.15),
            transform: `translate3d(0, -50%, 0) scale(${0.65 + swipeProgress * 0.4})`,
          }}
        >
          <div
            className={cn(
              'w-8 h-8 rounded-full flex items-center justify-center shadow-md transition-colors',
              swipeProgress >= 1
                ? 'bg-blue-600 text-white'
                : 'bg-neutral-200 dark:bg-neutral-700 text-blue-600 dark:text-blue-400'
            )}
          >
            <Reply className="w-4 h-4" />
          </div>
        </div>
      )}

      {/* Sliding Row Content Wrapper */}
      <div
        style={{
          transform: swipeOffset > 0 ? `translate3d(${swipeOffset}px, 0, 0)` : undefined,
          transition: isSwiping ? 'none' : 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
        className={cn(
          'flex items-end gap-1.5 max-w-full min-w-0',
          isMine ? 'justify-end' : 'justify-start'
        )}
      >
        {/* Left Avatar for receiver */}
        {!isMine && showAvatar && (
          <UserAvatar
            src={message.sender?.avatar_url}
            name={message.sender?.display_name || 'User'}
            id={message.sender_id}
            className="w-7 h-7 mb-1 shadow-xs shrink-0"
          />
        )}

        {/* Options trigger for Sender (left of bubble) */}
        {isMine && !isDeletedTombstone && renderOptionsTrigger()}

        {/* Main Content Bubble Wrapper (anchor for floating menu) */}
        <div
          ref={bubbleRef}
          onClickCapture={(e) => {
            if (suppressNextClickRef.current) {
              e.stopPropagation();
              e.preventDefault();
            }
          }}
          className={cn(
            'min-w-0',
            !isSticker && !isImage && !isVideo && !isVoice && 'max-w-[82%] md:max-w-[65%]'
          )}
        >
          {renderFamilySenderHeader()}

          {isDeletedTombstone ? (
            <div className="px-4 py-2 rounded-2xl bg-neutral-100 dark:bg-neutral-800/60 border border-dashed border-neutral-300 dark:border-neutral-700 text-neutral-500 dark:text-neutral-400 text-xs italic">
              This message was deleted
            </div>
          ) : isSafeCheckIn ? (
            <div
              className={cn(
                'px-4 py-3 rounded-2xl shadow-xs border text-sm select-none',
                isMine
                  ? 'bg-emerald-600 text-white border-emerald-500 rounded-br-xs'
                  : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-950 dark:text-emerald-100 border-emerald-300 dark:border-emerald-700/70 rounded-bl-xs'
              )}
            >
              <div className="flex items-center gap-2 font-bold">
                <ShieldCheck className={cn('w-4 h-4 shrink-0', isMine ? 'text-emerald-100' : 'text-emerald-600 dark:text-emerald-400')} />
                <span>{textBody || "I'm safe"}</span>
              </div>
              <div className={cn('flex items-center justify-end gap-1 mt-1 text-[10px]', isMine ? 'text-emerald-100/90' : 'text-emerald-700/80 dark:text-emerald-300/80')}>
                {renderPinnedPill(isMine)}
                <span>{formatTime(message.created_at)}</span>
                {renderStatusTicksOrSeen(isMine)}
              </div>
            </div>
          ) : isSticker ? (
            /* Render Expressive Sticker */
            <div className="flex flex-col items-end group/stk select-none">
              <div className="text-6xl p-2 select-none filter drop-shadow-md hover:scale-110 transition-transform duration-200 cursor-default animate-in zoom-in-75">
                {stickerIcon}
              </div>
              <div
                className={cn(
                  'flex items-center gap-1 text-[10px] select-none px-1.5 py-0.5 rounded-md',
                  isMine ? 'text-neutral-500' : 'text-neutral-400'
                )}
              >
                {renderPinnedPill(false)}
                <span>{formatTime(message.created_at)}</span>
                {isMine && (
                  <span className="inline-flex items-center ml-0.5">
                    {message.is_read ? (
                      <CheckCheck className="w-3.5 h-3.5 text-green-500 dark:text-green-400" strokeWidth={2.5} />
                    ) : (
                      <Check className="w-3 h-3 text-neutral-400" strokeWidth={2} />
                    )}
                  </span>
                )}
              </div>
            </div>
          ) : isImage ? (
            /* Render Photo / Image Attachment */
            <div
              className={cn(
                'rounded-2xl shadow-xs overflow-hidden w-[280px] sm:w-[320px] border transition-all select-none',
                isMine
                  ? 'bg-blue-600 text-white rounded-br-xs border-blue-500'
                  : 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 border-neutral-200/90 dark:border-neutral-700/60 rounded-bl-xs'
              )}
            >
              <div
                onClick={() => onViewImage?.(imageUrl, imageCaption)}
                className="relative cursor-pointer group/img overflow-hidden w-full min-h-[180px] bg-neutral-900/10 dark:bg-neutral-800/50 flex items-center justify-center"
              >
                <img
                  src={imageUrl}
                  alt={imageCaption || 'Attached photo'}
                  draggable={false}
                  className="w-full max-h-72 object-cover transition-transform duration-300 group-hover/img:scale-102 pointer-events-none"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover/img:opacity-100">
                  <div className="p-2 rounded-full bg-black/60 text-white backdrop-blur-xs">
                    <Maximize2 className="w-4 h-4" />
                  </div>
                </div>
              </div>

              {/* Caption & Timestamp */}
              <div className="p-2.5 space-y-1">
                {imageCaption && (
                  <>
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">{imageCaption}</p>
                    {renderTranslationBlock(isMine)}
                  </>
                )}
                <div
                  className={cn(
                    'flex items-center justify-end gap-1 text-[10px] select-none',
                    isMine ? 'text-blue-100/90' : 'text-neutral-400'
                  )}
                >
                  {renderPinnedPill(isMine)}
                  <span>{formatTime(message.created_at)}</span>
                  {isMine && (
                    <span className="inline-flex items-center ml-0.5">
                      {message.is_read ? (
                        <CheckCheck className="w-4 h-4 text-green-300" strokeWidth={2.5} />
                      ) : (
                        <Check className="w-3.5 h-3.5 text-blue-200/70" strokeWidth={2} />
                      )}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ) : isVideo ? (
            /* Render Video Attachment */
            <div
              className={cn(
                'rounded-2xl shadow-xs overflow-hidden w-[280px] sm:w-[340px] border transition-all select-none',
                isMine
                  ? 'bg-blue-600 text-white rounded-br-xs border-blue-500'
                  : 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 border-neutral-200/90 dark:border-neutral-700/60 rounded-bl-xs'
              )}
            >
              <div className="relative overflow-hidden bg-black/95 aspect-video min-h-[190px] w-full flex items-center justify-center">
                <video
                  src={videoUrl}
                  controls
                  preload="auto"
                  playsInline
                  className="w-full h-full object-contain rounded-t-2xl"
                />
              </div>

              {/* Caption & Timestamp */}
              <div className="p-2.5 space-y-1">
                {videoCaption && (
                  <>
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">{videoCaption}</p>
                    {renderTranslationBlock(isMine)}
                  </>
                )}
                <div
                  className={cn(
                    'flex items-center justify-end gap-1 text-[10px] select-none',
                    isMine ? 'text-blue-100/90' : 'text-neutral-400'
                  )}
                >
                  {renderPinnedPill(isMine)}
                  <span>{formatTime(message.created_at)}</span>
                  {isMine && (
                    <span className="inline-flex items-center ml-0.5">
                      {message.is_read ? (
                        <CheckCheck className="w-4 h-4 text-green-300" strokeWidth={2.5} />
                      ) : (
                        <Check className="w-3.5 h-3.5 text-blue-200/70" strokeWidth={2} />
                      )}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ) : isVoice ? (
            /* Render Voice Note Player */
            <div
              className={cn(
                'px-3.5 py-2.5 rounded-2xl shadow-xs relative text-sm select-none transition-all',
                isMine
                  ? 'bg-blue-600 text-white rounded-br-xs'
                  : 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 border border-neutral-200/90 dark:border-neutral-700/60 rounded-bl-xs'
              )}
            >
              <VoiceNotePlayer
                audioSrc={voiceAudioSrc}
                durationSec={voiceDuration}
                isMine={isMine}
              />
              <div
                className={cn(
                  'flex items-center justify-end gap-1 mt-1 text-[10px] select-none',
                  isMine ? 'text-blue-100/90' : 'text-neutral-400'
                )}
              >
                {renderPinnedPill(isMine)}
                <Mic className="w-3 h-3 opacity-70" />
                <span>{formatTime(message.created_at)}</span>
                {isMine && (
                  <span className="inline-flex items-center ml-0.5">
                    {message.is_read ? (
                      <CheckCheck className="w-4 h-4 text-green-300" strokeWidth={2.5} />
                    ) : (
                      <Check className="w-3.5 h-3.5 text-blue-200/70" strokeWidth={2} />
                    )}
                  </span>
                )}
              </div>
            </div>
          ) : (
            /* Render Standard Text Message */
            <div
              className={cn(
                'px-4 py-2.5 rounded-2xl shadow-xs relative text-sm leading-relaxed break-words select-none [-webkit-touch-callout:none] transition-all',
                isMine
                  ? 'bg-blue-600 text-white rounded-br-xs'
                  : 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 border border-neutral-200/90 dark:border-neutral-700/60 rounded-bl-xs'
              )}
            >
              {/* Quoted Reply Preview */}
              {replyId && (
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    const el = document.getElementById(`msg-${replyId}`);
                    if (el) {
                      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      el.classList.add('ring-2', 'ring-amber-400', 'bg-amber-100/50', 'dark:bg-amber-900/40');
                      setTimeout(() => {
                        el.classList.remove('ring-2', 'ring-amber-400', 'bg-amber-100/50', 'dark:bg-amber-900/40');
                      }, 2000);
                    }
                  }}
                  className={cn(
                    'mb-2 p-2 rounded-xl border-l-3 text-xs cursor-pointer select-none transition-all hover:opacity-90',
                    isMine
                      ? 'bg-black/15 dark:bg-white/10 border-blue-200 text-white'
                      : 'bg-neutral-100 dark:bg-neutral-700/80 border-blue-500 text-neutral-800 dark:text-neutral-200'
                  )}
                >
                  <div className="font-bold text-[11px] flex items-center gap-1 opacity-90">
                    <Reply className="w-3 h-3 text-blue-400" />
                    <span>{replySender}</span>
                  </div>
                  {replySnippet && (
                    <div className="line-clamp-2 text-[11.5px] opacity-80 mt-0.5">
                      {replySnippet}
                    </div>
                  )}
                </div>
              )}

              <p className="whitespace-pre-wrap">{textBody}</p>
              {renderTranslationBlock(isMine)}

              <div
                className={cn(
                  'flex items-center justify-end gap-1 mt-1 text-[10px] select-none',
                  isMine ? 'text-blue-100/90' : 'text-neutral-400'
                )}
              >
                {renderPinnedPill(isMine)}
                <span>{formatTime(message.created_at)}</span>
                {renderStatusTicksOrSeen(isMine)}
              </div>
            </div>
          )}
          {renderReactionsBar()}
        </div>

        {/* Options trigger for Receiver (right of bubble) */}
        {!isMine && !isDeletedTombstone && renderOptionsTrigger()}
      </div>

      {/* Unified Floating Context Menu (1-sec Hold / Right-Click / Options Trigger) */}
      {showMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={(e) => {
              e.stopPropagation();
              closeMenu();
            }}
          />
          <div
            ref={menuRef}
            onClick={(e) => e.stopPropagation()}
            style={
              menuCoords
                ? { top: `${menuCoords.top}px`, left: `${menuCoords.left}px` }
                : undefined
            }
            className="fixed z-50 min-w-[204px] py-1.5 px-1.5 rounded-[20px] bg-white dark:bg-neutral-900 border border-neutral-200/80 dark:border-neutral-700/80 shadow-[0_12px_36px_rgba(0,0,0,0.14)] dark:shadow-[0_12px_36px_rgba(0,0,0,0.5)] animate-in fade-in zoom-in-95 duration-120 space-y-0.5 select-none"
          >
            {onReactMessage && !isDeletedTombstone && (
              <div className="flex items-center justify-between gap-1 px-2 py-1.5 mb-1 border-b border-neutral-100 dark:border-neutral-800">
                {FAMILY_QUICK_REACTIONS.slice(0, 6).map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => {
                      closeMenu();
                      onReactMessage(message.id, emoji);
                    }}
                    className="w-7 h-7 rounded-full flex items-center justify-center text-base hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:scale-120 transition-all cursor-pointer"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}

            {onReplyMessage && (
              <button
                type="button"
                onClick={() => {
                  closeMenu();
                  onReplyMessage(message);
                }}
                className="w-full flex items-center gap-3 px-3.5 py-2.5 text-[14px] font-medium text-neutral-800 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-xl transition-colors cursor-pointer"
              >
                <Reply className="w-4 h-4 text-blue-500 shrink-0" />
                <span>Reply</span>
              </button>
            )}

            {onPinMessage && (
              <button
                type="button"
                onClick={() => {
                  closeMenu();
                  onPinMessage(message);
                }}
                className="w-full flex items-center gap-3 px-3.5 py-2.5 text-[14px] font-medium text-neutral-800 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-xl transition-colors cursor-pointer"
              >
                {isPinned ? (
                  <>
                    <PinOff className="w-4 h-4 text-amber-500 shrink-0" />
                    <span>Unpin</span>
                  </>
                ) : (
                  <>
                    <Pin className="w-4 h-4 text-amber-500 shrink-0" />
                    <span>Pin Message</span>
                  </>
                )}
              </button>
            )}

            {canCopyText && (
              <button
                type="button"
                onClick={handleCopy}
                className="w-full flex items-center gap-3 px-3.5 py-2.5 text-[14px] font-medium text-neutral-800 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-xl transition-colors cursor-pointer"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span className="text-emerald-600 dark:text-emerald-400">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 text-neutral-700 dark:text-neutral-300 shrink-0" />
                    <span>Copy Text</span>
                  </>
                )}
              </button>
            )}

            {translatableText && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    closeMenu();
                    if (showTranslation && !translateError) {
                      activeTranslateReqRef.current += 1;
                      setIsTranslating(false);
                      setShowTranslation(false);
                      setTranslateError(null);
                    } else {
                      void handleTranslate(resolvedTargetLang);
                    }
                  }}
                  className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 text-[14px] font-medium text-neutral-800 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-xl transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-3">
                    <Languages className="w-4 h-4 text-indigo-500 shrink-0" />
                    <span>
                      {showTranslation && !translateError
                        ? t('action.hideTranslation', 'Hide Translation')
                        : t('action.translate', 'Translate')}
                    </span>
                  </span>
                  <span className="text-[11px] font-semibold text-neutral-400 shrink-0">
                    {resolvedTargetLang.flag}
                  </span>
                </button>

                {onOpenTranslatePicker && (
                  <button
                    type="button"
                    onClick={() => {
                      closeMenu();
                      onOpenTranslatePicker(
                        translation?.lang.code || resolvedTargetLang.code,
                        (picked) => void handleTranslate(picked),
                        t('action.translateTo', 'Translate Message To')
                      );
                    }}
                    className="w-full flex items-center gap-3 px-3.5 py-2.5 text-[14px] font-medium text-neutral-800 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-xl transition-colors cursor-pointer"
                  >
                    <Globe className="w-4 h-4 text-sky-500 shrink-0" />
                    <span>{t('action.translateTo106', 'Translate to... (106+)')}</span>
                  </button>
                )}
              </>
            )}

            {onForwardMessage && (
              <button
                type="button"
                onClick={() => {
                  closeMenu();
                  onForwardMessage(message);
                }}
                className="w-full flex items-center gap-3 px-3.5 py-2.5 text-[14px] font-medium text-neutral-800 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-xl transition-colors cursor-pointer"
              >
                <Share2 className="w-4 h-4 text-purple-500 shrink-0" />
                <span>Forward</span>
              </button>
            )}

            {!isMine && onReportMessage && (
              <button
                type="button"
                onClick={() => {
                  closeMenu();
                  onReportMessage(message);
                }}
                className="w-full flex items-center gap-3 px-3.5 py-2.5 text-[14px] font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40 rounded-xl transition-colors cursor-pointer"
              >
                <Flag className="w-4 h-4 shrink-0" />
                <span>{t('action.report')}</span>
              </button>
            )}

            {onDeleteMessage && (
              <button
                type="button"
                onClick={handleDelete}
                className={cn(
                  'w-full flex items-center gap-3 px-3.5 py-2.5 text-[14px] font-medium rounded-xl transition-colors cursor-pointer',
                  showConfirm
                    ? 'bg-rose-600 text-white hover:bg-rose-700 font-semibold'
                    : 'text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40'
                )}
              >
                <Trash2 className="w-4 h-4 shrink-0" />
                <span>{showConfirm ? `Confirm ${t('action.delete')}?` : t('action.delete')}</span>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export const MessageBubble = React.memo(MessageBubbleComponent);
MessageBubble.displayName = 'MessageBubble';

