import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch (e) {}
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function parseDate(dateInput: string | Date | number | null | undefined): Date | null {
  if (!dateInput) return null;
  if (dateInput instanceof Date) return isNaN(dateInput.getTime()) ? null : dateInput;
  if (typeof dateInput === 'number') {
    const d = new Date(dateInput);
    return isNaN(d.getTime()) ? null : d;
  }
  let str = String(dateInput).trim();
  // If string is sqlite timestamp like "2026-09-17 10:20:30" without offset, ensure parsed as UTC
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(str)) {
    str = str.replace(' ', 'T');
    if (!str.endsWith('Z')) {
      str += 'Z';
    }
  }
  const date = new Date(str);
  if (!isNaN(date.getTime())) return date;

  const fallback = new Date(dateInput);
  return isNaN(fallback.getTime()) ? null : fallback;
}

export function formatJoinedYear(dateString: string | Date | null | undefined): string {
  const date = parseDate(dateString);
  if (!date) return new Date().getFullYear().toString();
  return date.getFullYear().toString();
}

export function formatTime(dateString: string | Date | number | null | undefined): string {
  const date = parseDate(dateString);
  if (!date) return '';
  // Formats in user's phone / device local timezone
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
}

export function formatDate(dateString: string | Date | number | null | undefined): string {
  const date = parseDate(dateString);
  if (!date) return '';
  
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  
  if (isToday) {
    return formatTime(date);
  }
  if (isYesterday) {
    return 'Yesterday';
  }
  
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 7) {
    return date.toLocaleDateString([], { weekday: 'short' });
  }
  
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function formatTimestamp(dateString: string | Date | number | null | undefined): string {
  const date = parseDate(dateString);
  if (!date) return '';

  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const timeStr = formatTime(date);

  if (isToday) {
    return `Today at ${timeStr}`;
  }
  if (isYesterday) {
    return `Yesterday at ${timeStr}`;
  }

  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${timeStr}`;
}

export function formatChatDateHeader(dateInput: string | Date | number | null | undefined): string {
  const date = parseDate(dateInput);
  if (!date) return '';

  const dayOfWeek = date.toLocaleDateString([], { weekday: 'long' });
  const dayNum = date.getDate();
  const monthName = date.toLocaleDateString([], { month: 'long' });
  const year = date.getFullYear();

  return `${dayOfWeek}, ${dayNum} ${monthName} ${year}`;
}

export function isDifferentDay(date1?: string | Date | number | null, date2?: string | Date | number | null): boolean {
  if (!date1 || !date2) return true;
  const d1 = parseDate(date1);
  const d2 = parseDate(date2);
  if (!d1 || !d2) return true;
  return d1.toDateString() !== d2.toDateString();
}

export function formatLastSeen(dateString: string | null | undefined, isOnline: boolean): string {
  if (isOnline) return 'Online';
  if (!dateString) return 'Offline';
  
  const date = parseDate(dateString);
  if (!date) return 'Offline';
  
  const now = new Date();
  const diffMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
  
  if (diffMinutes < 1) return 'Active just now';
  if (diffMinutes < 60) return `Active ${diffMinutes}m ago`;
  
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `Active ${diffHours}h ago`;
  
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Active yesterday';
  if (diffDays < 7) return `Active ${diffDays}d ago`;
  
  return `Last seen ${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const hours = Math.floor(mins / 60);
  
  if (hours > 0) {
    const remMins = mins % 60;
    return `${hours.toString().padStart(2, '0')}:${remMins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function getInitials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].substring(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const AVATAR_COLORS = [
  'bg-emerald-500 text-white',
  'bg-blue-500 text-white',
  'bg-indigo-500 text-white',
  'bg-violet-500 text-white',
  'bg-purple-500 text-white',
  'bg-pink-500 text-white',
  'bg-rose-500 text-white',
  'bg-amber-500 text-white',
  'bg-cyan-500 text-white',
  'bg-teal-500 text-white',
];

export function getAvatarColor(identifier: string): string {
  let hash = 0;
  for (let i = 0; i < identifier.length; i++) {
    hash = identifier.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % AVATAR_COLORS.length;
  return AVATAR_COLORS[index];
}

export function getClientDeviceId(): string {
  if (typeof window === 'undefined') return 'device_server';
  try {
    let devId = sessionStorage.getItem('liveconnect_device_client_id');
    if (!devId) {
      devId = 'dev_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now().toString(36);
      sessionStorage.setItem('liveconnect_device_client_id', devId);
    }
    return devId;
  } catch {
    return 'dev_fallback_' + Math.random().toString(36).substring(2, 8);
  }
}
