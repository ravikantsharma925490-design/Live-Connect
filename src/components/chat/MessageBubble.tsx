import React, { useState, useRef, useEffect } from 'react';
import { Message, Profile, CallType, Conversation } from '@/src/types';
import { cn, formatTime, getAvatarColor, getInitials } from '@/src/lib/utils';
import { UserAvatar } from '../ui/UserAvatar';
import {
  Check,
  CheckCheck,
  Trash2,
  Copy,
  MoreHorizontal,
  Phone,
  Video,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  Play,
  Pause,
  Volume2,
  Mic,
  Maximize2,
  RotateCcw,
  AlertCircle,
  Loader2,
  Pin,
  PinOff,
  Reply,
  Share2,
  UserMinus,
  UserPlus,
  ShieldCheck,
  ShieldAlert,
  LogOut,
} from 'lucide-react';

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

interface ParsedSystemMessage {
  type: 'MEMBER_REMOVED' | 'MEMBER_LEFT' | 'ROLE_CHANGED' | 'MEMBERS_ADDED' | 'GENERIC';
  actorId?: string;
  actorName?: string;
  actorUsername?: string;
  targetId?: string;
  targetName?: string;
  targetUsername?: string;
  newRole?: 'admin' | 'member';
  rawText: string;
}

function parseSystemMessage(content: string | undefined): ParsedSystemMessage | null {
  if (!content || typeof content !== 'string') return null;

  // 1. Tagged format: [SYSTEM:MEMBER_REMOVED:actorId:actorName:actorUsername:targetId:targetName:targetUsername] text
  if (content.startsWith('[SYSTEM:MEMBER_REMOVED:')) {
    const endTagIdx = content.indexOf(']');
    if (endTagIdx !== -1) {
      const tagContent = content.substring(23, endTagIdx);
      const parts = tagContent.split(':');
      const text = content.substring(endTagIdx + 1).trim();
      return {
        type: 'MEMBER_REMOVED',
        actorId: parts[0] || '',
        actorName: parts[1] || 'Admin',
        actorUsername: parts[2] || 'admin',
        targetId: parts[3] || '',
        targetName: parts[4] || 'Member',
        targetUsername: parts[5] || 'user',
        rawText: text,
      };
    }
  }

  // 2. Tagged format: [SYSTEM:MEMBER_LEFT:targetId:targetName:targetUsername] text
  if (content.startsWith('[SYSTEM:MEMBER_LEFT:')) {
    const endTagIdx = content.indexOf(']');
    if (endTagIdx !== -1) {
      const tagContent = content.substring(20, endTagIdx);
      const parts = tagContent.split(':');
      const text = content.substring(endTagIdx + 1).trim();
      return {
        type: 'MEMBER_LEFT',
        targetId: parts[0] || '',
        targetName: parts[1] || 'Member',
        targetUsername: parts[2] || 'user',
        rawText: text,
      };
    }
  }

  // 3. Tagged format: [SYSTEM:ROLE_CHANGED:newRole:actorId:actorName:actorUsername:targetId:targetName:targetUsername] text
  if (content.startsWith('[SYSTEM:ROLE_CHANGED:')) {
    const endTagIdx = content.indexOf(']');
    if (endTagIdx !== -1) {
      const tagContent = content.substring(21, endTagIdx);
      const parts = tagContent.split(':');
      const text = content.substring(endTagIdx + 1).trim();
      return {
        type: 'ROLE_CHANGED',
        newRole: parts[0] === 'admin' ? 'admin' : 'member',
        actorId: parts[1] || '',
        actorName: parts[2] || 'Admin',
        actorUsername: parts[3] || 'admin',
        targetId: parts[4] || '',
        targetName: parts[5] || 'Member',
        targetUsername: parts[6] || 'user',
        rawText: text,
      };
    }
  }

  // 4. Tagged format: [SYSTEM:MEMBERS_ADDED:actorId:actorName:actorUsername] text
  if (content.startsWith('[SYSTEM:MEMBERS_ADDED:')) {
    const endTagIdx = content.indexOf(']');
    if (endTagIdx !== -1) {
      const tagContent = content.substring(22, endTagIdx);
      const parts = tagContent.split(':');
      const text = content.substring(endTagIdx + 1).trim();
      return {
        type: 'MEMBERS_ADDED',
        actorId: parts[0] || '',
        actorName: parts[1] || 'Admin',
        actorUsername: parts[2] || 'admin',
        rawText: text,
      };
    }
  }

  // 5. Plain text heuristics for group events
  if (content.includes('removed') && content.includes('from the group')) {
    return {
      type: 'MEMBER_REMOVED',
      rawText: content,
    };
  }

  if (content.includes('left the group')) {
    return {
      type: 'MEMBER_LEFT',
      rawText: content,
    };
  }

  if (content.includes('Group Admin') || content.includes('group admin')) {
    return {
      type: 'ROLE_CHANGED',
      rawText: content,
    };
  }

  if (content.includes('added') && content.includes('to the group')) {
    return {
      type: 'MEMBERS_ADDED',
      rawText: content,
    };
  }

  return null;
}

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
  isPinned?: boolean;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  isMine,
  showAvatar = true,
  onDeleteMessage,
  onStartCall,
  onViewImage,
  otherUser,
  conversation,
  onReplyMessage,
  onForwardMessage,
  onReactMessage,
  onPinMessage,
  isPinned = false,
}) => {
  const [showConfirm, setShowConfirm] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);

  // Close menu when clicking outside
  useEffect(() => {
    if (!showMenu) return;
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
        setShowConfirm(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
      }
    };
  }, [showMenu]);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches[0]) {
      touchStartPosRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
    }
    // 1-second long press
    longPressTimerRef.current = setTimeout(() => {
      try {
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          navigator.vibrate?.(50);
        }
      } catch (err) {}
      setShowMenu(true);
    }, 1000);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartPosRef.current && e.touches[0]) {
      const dx = Math.abs(e.touches[0].clientX - touchStartPosRef.current.x);
      const dy = Math.abs(e.touches[0].clientY - touchStartPosRef.current.y);
      if (dx > 10 || dy > 10) {
        handleTouchEnd();
      }
    }
  };

  const handleTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    handleTouchEnd();
    setShowMenu(true);
  };

  const handleCopy = () => {
    try {
      if (navigator?.clipboard?.writeText) {
        navigator.clipboard.writeText(message.content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch (e) {}
    setShowMenu(false);
  };

  const handleDelete = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (showConfirm) {
      onDeleteMessage?.(message.id);
      setShowConfirm(false);
      setShowMenu(false);
    } else {
      setShowConfirm(true);
      setTimeout(() => setShowConfirm(false), 4500);
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
        title = isVideo ? 'Missed video call' : 'Missed voice call';
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
          'flex items-end gap-1.5 my-1.5 animate-in fade-in duration-150 group relative',
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
                <span>Delete</span>
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
                <span>Delete</span>
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

  // 2. Check if this is a SYSTEM NOTIFICATION message (Member removed, member left, role change, etc.)
  const systemMessage = parseSystemMessage(message.content);
  if (systemMessage) {
    return (
      <div className="flex justify-center my-3.5 w-full px-2 select-none">
        {systemMessage.type === 'MEMBER_REMOVED' ? (
          <div className="max-w-md w-full bg-linear-to-b from-red-50/90 via-white to-red-50/40 dark:from-red-950/40 dark:via-neutral-900 dark:to-neutral-900 border border-red-200/90 dark:border-red-900/60 rounded-2xl p-3.5 shadow-xs space-y-2.5 text-center animate-in fade-in duration-200">
            {/* Header Badge */}
            <div className="flex items-center justify-center gap-2">
              <div className="p-1 rounded-full bg-red-100 dark:bg-red-900/60 text-red-600 dark:text-red-400">
                <UserMinus className="w-3.5 h-3.5" />
              </div>
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-red-700 dark:text-red-300">
                Member Removed From Group
              </span>
            </div>

            {systemMessage.actorId && systemMessage.targetId ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-left pt-0.5">
                {/* Admin who performed removal */}
                <div className="p-2.5 rounded-xl bg-white dark:bg-neutral-800 border border-neutral-200/90 dark:border-neutral-700/80 shadow-2xs">
                  <div className="text-[10px] font-extrabold text-neutral-400 dark:text-neutral-500 uppercase tracking-wider flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3 text-purple-500" />
                    <span>Removed By (Admin)</span>
                  </div>
                  <p className="text-xs font-bold text-neutral-900 dark:text-neutral-100 truncate mt-0.5">
                    {systemMessage.actorName}
                  </p>
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate font-mono">
                    @{systemMessage.actorUsername}
                  </p>
                  <div className="mt-1.5 flex items-center justify-between gap-1 bg-neutral-100 dark:bg-neutral-700/60 px-2 py-1 rounded-lg">
                    <span className="text-[9px] font-bold text-neutral-500 dark:text-neutral-400">ADMIN ID:</span>
                    <span className="text-[10px] font-mono font-bold text-neutral-800 dark:text-neutral-200 truncate max-w-[120px]" title={systemMessage.actorId}>
                      {systemMessage.actorId}
                    </span>
                  </div>
                </div>

                {/* Member who was removed */}
                <div className="p-2.5 rounded-xl bg-red-50/70 dark:bg-red-950/30 border border-red-200/80 dark:border-red-900/60 shadow-2xs">
                  <div className="text-[10px] font-extrabold text-red-600 dark:text-red-400 uppercase tracking-wider flex items-center gap-1">
                    <UserMinus className="w-3 h-3 text-red-500" />
                    <span>Removed Member</span>
                  </div>
                  <p className="text-xs font-bold text-red-950 dark:text-red-200 truncate mt-0.5">
                    {systemMessage.targetName}
                  </p>
                  <p className="text-[11px] text-red-700/80 dark:text-red-400/80 truncate font-mono">
                    @{systemMessage.targetUsername}
                  </p>
                  <div className="mt-1.5 flex items-center justify-between gap-1 bg-red-100/90 dark:bg-red-900/50 px-2 py-1 rounded-lg">
                    <span className="text-[9px] font-bold text-red-600 dark:text-red-400">USER ID:</span>
                    <span className="text-[10px] font-mono font-bold text-red-900 dark:text-red-200 truncate max-w-[120px]" title={systemMessage.targetId}>
                      {systemMessage.targetId}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                {systemMessage.rawText}
              </p>
            )}

            <div className="flex items-center justify-center gap-2 text-[10px] text-neutral-400 dark:text-neutral-500 pt-0.5">
              <span>{formatTime(message.created_at)}</span>
              {onDeleteMessage && (
                <button
                  onClick={() => onDeleteMessage(message.id)}
                  title="Delete notification"
                  className="hover:text-red-500 transition-colors p-0.5 rounded cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        ) : systemMessage.type === 'MEMBER_LEFT' ? (
          <div className="max-w-sm w-full bg-neutral-50 dark:bg-neutral-900 border border-neutral-200/80 dark:border-neutral-800 rounded-2xl p-3 shadow-xs space-y-2 text-center animate-in fade-in duration-200">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-neutral-200/70 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 text-[10px] font-bold">
              <LogOut className="w-3 h-3 text-neutral-500" />
              <span>Member Left Group</span>
            </div>
            <div className="p-2 rounded-xl bg-white dark:bg-neutral-800/80 border border-neutral-200/70 dark:border-neutral-700/60 text-left">
              <p className="text-xs font-bold text-neutral-900 dark:text-neutral-100 truncate">
                {systemMessage.targetName || 'Member'}
              </p>
              {systemMessage.targetUsername && (
                <p className="text-[11px] text-neutral-500 dark:text-neutral-400 font-mono">
                  @{systemMessage.targetUsername}
                </p>
              )}
              {systemMessage.targetId && (
                <div className="mt-1 flex items-center justify-between text-[10px] bg-neutral-100 dark:bg-neutral-700/50 px-2 py-0.5 rounded font-mono">
                  <span className="text-neutral-400">USER ID:</span>
                  <span className="text-neutral-700 dark:text-neutral-300 font-bold truncate max-w-[150px]">{systemMessage.targetId}</span>
                </div>
              )}
            </div>
            <div className="flex items-center justify-center gap-2 text-[10px] text-neutral-400 font-medium">
              <span>{formatTime(message.created_at)}</span>
              {onDeleteMessage && (
                <button
                  onClick={() => onDeleteMessage(message.id)}
                  title="Delete message"
                  className="hover:text-red-500 transition-colors p-0.5 rounded cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        ) : systemMessage.type === 'ROLE_CHANGED' ? (
          <div className="max-w-md w-full bg-purple-50/50 dark:bg-purple-950/30 border border-purple-200/80 dark:border-purple-900/60 rounded-2xl p-3 shadow-xs space-y-2 text-center animate-in fade-in duration-200">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/60 text-purple-700 dark:text-purple-300 text-[10px] font-bold">
              <ShieldCheck className="w-3 h-3 text-purple-600" />
              <span>{systemMessage.newRole === 'admin' ? 'Promoted To Group Admin' : 'Dismissed From Group Admin'}</span>
            </div>
            {systemMessage.actorId && systemMessage.targetId ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-left pt-0.5">
                <div className="p-2 rounded-xl bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700">
                  <span className="text-[10px] font-bold text-neutral-400 uppercase">Updated By (Admin)</span>
                  <p className="text-xs font-bold text-neutral-900 dark:text-neutral-100 truncate mt-0.5">{systemMessage.actorName}</p>
                  <div className="mt-1 text-[9px] font-mono text-neutral-500 truncate">ID: {systemMessage.actorId}</div>
                </div>
                <div className="p-2 rounded-xl bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-800">
                  <span className="text-[10px] font-bold text-purple-600 dark:text-purple-400 uppercase">Member</span>
                  <p className="text-xs font-bold text-purple-950 dark:text-purple-100 truncate mt-0.5">{systemMessage.targetName}</p>
                  <div className="mt-1 text-[9px] font-mono text-purple-700 dark:text-purple-300 truncate">ID: {systemMessage.targetId}</div>
                </div>
              </div>
            ) : (
              <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">{systemMessage.rawText}</p>
            )}
            <div className="flex items-center justify-center gap-2 text-[10px] text-neutral-400 font-medium">
              <span>{formatTime(message.created_at)}</span>
              {onDeleteMessage && (
                <button
                  onClick={() => onDeleteMessage(message.id)}
                  title="Delete message"
                  className="hover:text-red-500 transition-colors p-0.5 rounded cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="max-w-md w-full bg-blue-50/50 dark:bg-blue-950/30 border border-blue-200/80 dark:border-blue-900/60 rounded-2xl p-3 shadow-xs space-y-1.5 text-center animate-in fade-in duration-200">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 text-[10px] font-bold">
              <UserPlus className="w-3 h-3 text-blue-600" />
              <span>Group Update</span>
            </div>
            <p className="text-xs font-medium text-neutral-800 dark:text-neutral-200 px-2">{systemMessage.rawText}</p>
            {systemMessage.actorId && (
              <p className="text-[10px] text-neutral-500 dark:text-neutral-400 font-mono">
                Admin ID: {systemMessage.actorId}
              </p>
            )}
            <div className="flex items-center justify-center gap-2 text-[10px] text-neutral-400 font-medium pt-0.5">
              <span>{formatTime(message.created_at)}</span>
              {onDeleteMessage && (
                <button
                  onClick={() => onDeleteMessage(message.id)}
                  title="Delete message"
                  className="hover:text-red-500 transition-colors p-0.5 rounded cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // 3. Check if message is a STICKER: [STICKER:emojiOrIcon:label]
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

  return (
    <div
      id={`msg-${message.id}`}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      onContextMenu={handleContextMenu}
      className={cn(
        'flex items-end gap-1.5 my-1.5 animate-in fade-in duration-150 group relative transition-all rounded-2xl p-0.5',
        isMine ? 'justify-end' : 'justify-start'
      )}
    >
      {/* Left Avatar for receiver */}
      {!isMine && showAvatar && (
        <UserAvatar
          src={message.sender?.avatar_url}
          name={message.sender?.display_name || 'User'}
          id={message.sender_id}
          className="w-7 h-7 mb-1 shadow-xs"
        />
      )}

      {/* Options Menu for Sender */}
      {isMine && (
        <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          {showConfirm ? (
            <button
              onClick={handleDelete}
              className="text-[11px] bg-rose-600 hover:bg-rose-700 active:scale-95 text-white font-bold px-2 py-1 rounded-xl shadow-md transition-all flex items-center gap-1 animate-pulse"
              title="Click again to confirm delete"
            >
              <Trash2 className="w-3 h-3" />
              <span>Delete</span>
            </button>
          ) : (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setShowMenu(!showMenu)}
                className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-200/80 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
                title="Message options"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>

              {showMenu && (
                <div
                  className={cn(
                    'absolute bottom-full mb-1 z-30 min-w-[140px] p-1 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-xl space-y-0.5 animate-in fade-in zoom-in-95 duration-100',
                    isMine ? 'right-0' : 'left-0'
                  )}
                >
                  {onReplyMessage && (
                    <button
                      onClick={() => {
                        setShowMenu(false);
                        onReplyMessage(message);
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors cursor-pointer"
                    >
                      <Reply className="w-3.5 h-3.5 text-blue-500" />
                      <span>Reply</span>
                    </button>
                  )}

                  {onPinMessage && (
                    <button
                      onClick={() => {
                        setShowMenu(false);
                        onPinMessage(message);
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors cursor-pointer"
                    >
                      {isPinned ? (
                        <>
                          <PinOff className="w-3.5 h-3.5 text-amber-500" />
                          <span>Unpin</span>
                        </>
                      ) : (
                        <>
                          <Pin className="w-3.5 h-3.5 text-amber-500" />
                          <span>Pin Message</span>
                        </>
                      )}
                    </button>
                  )}

                  {onForwardMessage && (
                    <button
                      onClick={() => {
                        setShowMenu(false);
                        onForwardMessage(message);
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors cursor-pointer"
                    >
                      <Share2 className="w-3.5 h-3.5 text-purple-500" />
                      <span>Forward</span>
                    </button>
                  )}

                  {!isVoice && !isImage && (
                    <button
                      onClick={handleCopy}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors cursor-pointer"
                    >
                      {copied ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-500" />
                          <span className="text-emerald-600 dark:text-emerald-400">Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy Text</span>
                        </>
                      )}
                    </button>
                  )}

                  {onDeleteMessage && (
                    <button
                      onClick={handleDelete}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Main Content Bubble */}
      {isSticker ? (
        /* Render Expressive Sticker */
        <div className="flex flex-col items-end group/stk">
          <div className="text-6xl p-2 select-none filter drop-shadow-md hover:scale-110 transition-transform duration-200 cursor-default animate-in zoom-in-75">
            {stickerIcon}
          </div>
          <div
            className={cn(
              'flex items-center gap-1 text-[10px] select-none px-1.5 py-0.5 rounded-md',
              isMine ? 'text-neutral-500' : 'text-neutral-400'
            )}
          >
            <span>{formatTime(message.created_at)}</span>
            {isMine && (
              <span className="inline-flex items-center ml-0.5">
                {message.is_read ? (
                  <CheckCheck className="w-3.5 h-3.5 text-blue-500" strokeWidth={2.5} />
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
            'rounded-2xl shadow-xs overflow-hidden w-[280px] sm:w-[320px] border transition-all',
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
              className="w-full max-h-72 object-cover transition-transform duration-300 group-hover/img:scale-102"
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
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{imageCaption}</p>
            )}
            <div
              className={cn(
                'flex items-center justify-end gap-1 text-[10px] select-none',
                isMine ? 'text-blue-100/90' : 'text-neutral-400'
              )}
            >
              <span>{formatTime(message.created_at)}</span>
              {isMine && (
                <span className="inline-flex items-center ml-0.5">
                  {message.is_read ? (
                    <CheckCheck className="w-4 h-4 text-cyan-300" strokeWidth={2.5} />
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
            'rounded-2xl shadow-xs overflow-hidden w-[280px] sm:w-[340px] border transition-all',
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
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{videoCaption}</p>
            )}
            <div
              className={cn(
                'flex items-center justify-end gap-1 text-[10px] select-none',
                isMine ? 'text-blue-100/90' : 'text-neutral-400'
              )}
            >
              <span>{formatTime(message.created_at)}</span>
              {isMine && (
                <span className="inline-flex items-center ml-0.5">
                  {message.is_read ? (
                    <CheckCheck className="w-4 h-4 text-cyan-300" strokeWidth={2.5} />
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
            <Mic className="w-3 h-3 opacity-70" />
            <span>{formatTime(message.created_at)}</span>
            {isMine && (
              <span className="inline-flex items-center ml-0.5">
                {message.is_read ? (
                  <CheckCheck className="w-4 h-4 text-cyan-300" strokeWidth={2.5} />
                ) : (
                  <Check className="w-3.5 h-3.5 text-blue-200/70" strokeWidth={2} />
                )}
              </span>
            )}
          </div>
        </div>
      ) : (
        /* Render Standard Text Message */
        (() => {
          let replyId = message.reply_to_message_id || null;
          let replySender = message.reply_to_message?.sender?.display_name || 'Message';
          let replySnippet = message.reply_to_message?.content || '';
          let textBody = message.content || '';

          if (textBody.startsWith('[REPLY:')) {
            const closing = textBody.indexOf(']');
            if (closing !== -1) {
              replyId = replyId || textBody.substring(7, closing);
              textBody = textBody.substring(closing + 1).trim();
            }
          }

          return (
            <div
              className={cn(
                'max-w-[82%] md:max-w-[65%] px-4 py-2.5 rounded-2xl shadow-xs relative text-sm leading-relaxed break-words select-text transition-all',
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

              <div
                className={cn(
                  'flex items-center justify-end gap-1 mt-1 text-[10px] select-none',
                  isMine ? 'text-blue-100/90' : 'text-neutral-400'
                )}
              >
                {isPinned && (
                  <span className="inline-flex items-center gap-0.5 text-amber-300 font-medium mr-1">
                    <Pin className="w-3 h-3 fill-amber-300" />
                    <span>Pinned</span>
                  </span>
                )}
                <span>{formatTime(message.created_at)}</span>
                {isMine && (
                  <span className="inline-flex items-center ml-0.5">
                    {message.is_read ? (
                      <CheckCheck className="w-4 h-4 text-cyan-300" strokeWidth={2.5} title="Read (Seen)" />
                    ) : (
                      <Check className="w-3.5 h-3.5 text-blue-200/70" strokeWidth={2} title="Sent / Delivered" />
                    )}
                  </span>
                )}
              </div>
            </div>
          );
        })()
      )}

      {/* Options Menu for Receiver */}
      {!isMine && (
        <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          {showConfirm ? (
            <button
              onClick={handleDelete}
              className="text-[11px] bg-rose-600 hover:bg-rose-700 active:scale-95 text-white font-bold px-2 py-1 rounded-xl shadow-md transition-all flex items-center gap-1 animate-pulse"
              title="Click again to confirm delete"
            >
              <Trash2 className="w-3 h-3" />
              <span>Delete</span>
            </button>
          ) : (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setShowMenu(!showMenu)}
                className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-200/80 dark:hover:bg-neutral-800 transition-colors"
                title="Message options"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>

              {showMenu && (
                <div className="absolute bottom-full left-0 mb-1 z-30 min-w-[140px] p-1 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-xl space-y-0.5 animate-in fade-in zoom-in-95 duration-100">
                  {onReplyMessage && (
                    <button
                      onClick={() => {
                        setShowMenu(false);
                        onReplyMessage(message);
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors cursor-pointer"
                    >
                      <Reply className="w-3.5 h-3.5 text-blue-500" />
                      <span>Reply</span>
                    </button>
                  )}

                  {onPinMessage && (
                    <button
                      onClick={() => {
                        setShowMenu(false);
                        onPinMessage(message);
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors cursor-pointer"
                    >
                      {isPinned ? (
                        <>
                          <PinOff className="w-3.5 h-3.5 text-amber-500" />
                          <span>Unpin</span>
                        </>
                      ) : (
                        <>
                          <Pin className="w-3.5 h-3.5 text-amber-500" />
                          <span>Pin Message</span>
                        </>
                      )}
                    </button>
                  )}

                  {onForwardMessage && (
                    <button
                      onClick={() => {
                        setShowMenu(false);
                        onForwardMessage(message);
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors cursor-pointer"
                    >
                      <Share2 className="w-3.5 h-3.5 text-purple-500" />
                      <span>Forward</span>
                    </button>
                  )}

                  {!isVoice && !isImage && (
                    <button
                      onClick={handleCopy}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors cursor-pointer"
                    >
                      {copied ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-500" />
                          <span className="text-emerald-600 dark:text-emerald-400">Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy Text</span>
                        </>
                      )}
                    </button>
                  )}

                  {onDeleteMessage && (
                    <button
                      onClick={handleDelete}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

