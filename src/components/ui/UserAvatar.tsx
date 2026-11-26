import React, { useState, useEffect, useRef } from 'react';
import { cn, getAvatarColor, getInitials } from '@/src/lib/utils';

interface UserAvatarProps {
  src?: string | null;
  name?: string | null;
  id?: string | null;
  className?: string;
  imgClassName?: string;
  isOnline?: boolean;
  showStatus?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
}

const SIZE_CLASSES = {
  xs: 'w-6 h-6 text-[10px]',
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-12 h-12 text-base',
  xl: 'w-16 h-16 text-xl',
  '2xl': 'w-24 h-24 text-2xl',
};

export const UserAvatar: React.FC<UserAvatarProps> = ({
  src,
  name,
  id,
  className,
  imgClassName,
  isOnline,
  showStatus = false,
  size,
}) => {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(src || null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const displayName = name || 'User';
  const initials = getInitials(displayName);
  const bgColor = getAvatarColor(id || displayName);

  useEffect(() => {
    if (!src) {
      setLoadedSrc(null);
      setFailedSrc(null);
      return;
    }
    setFailedSrc(null);
    if (imgRef.current && imgRef.current.complete && imgRef.current.naturalWidth > 0) {
      setLoadedSrc(src);
    }
  }, [src]);

  const sizeClass = size ? SIZE_CLASSES[size] : '';
  const isCurrentLoaded = Boolean(src && loadedSrc === src && failedSrc !== src);
  const hasPreviousLoaded = Boolean(loadedSrc && loadedSrc !== src && failedSrc !== loadedSrc);

  return (
    <div className={cn('relative shrink-0 select-none rounded-full overflow-hidden', sizeClass, className)}>
      {/* Background / Fallback Initials - Always rendered underneath with fixed layout */}
      <div
        className={cn(
          'w-full h-full flex items-center justify-center font-bold text-white shadow-xs rounded-[inherit]',
          bgColor
        )}
      >
        {initials}
      </div>

      {/* Keep previous image visible while new src loads to prevent flash/flicker */}
      {src && hasPreviousLoaded && loadedSrc && (
        <img
          src={loadedSrc}
          alt={displayName}
          className={cn(
            'absolute inset-0 w-full h-full object-cover rounded-[inherit]',
            imgClassName
          )}
        />
      )}

      {/* Active Image Layer - Smooth fade-in once loaded, zero layout jumping */}
      {src && failedSrc !== src && (
        <img
          ref={imgRef}
          src={src}
          alt={displayName}
          onLoad={() => setLoadedSrc(src)}
          onError={() => {
            setFailedSrc(src);
            if (loadedSrc === src) setLoadedSrc(null);
          }}
          className={cn(
            'absolute inset-0 w-full h-full object-cover rounded-[inherit] transition-opacity duration-150',
            isCurrentLoaded ? 'opacity-100' : 'opacity-0',
            imgClassName
          )}
        />
      )}

      {/* Online Status Dot */}
      {showStatus && isOnline !== undefined && (
        <span
          className={cn(
            'absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-neutral-900 z-10',
            isOnline ? 'bg-emerald-500' : 'bg-neutral-400'
          )}
          title={isOnline ? 'Online' : 'Offline'}
        />
      )}
    </div>
  );
};
