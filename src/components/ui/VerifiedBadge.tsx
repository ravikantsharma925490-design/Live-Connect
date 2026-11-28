import React from 'react';
import { BadgeCheck } from 'lucide-react';
import { cn } from '@/src/lib/utils';

interface VerifiedBadgeProps {
  className?: string;
  size?: 'xs' | 'sm' | 'md';
}

export const VerifiedBadge: React.FC<VerifiedBadgeProps> = ({
  className,
  size = 'sm',
}) => {
  const sizeClass =
    size === 'xs'
      ? 'w-3.5 h-3.5'
      : size === 'md'
        ? 'w-4.5 h-4.5'
        : 'w-4 h-4';

  return (
    <span
      title="Verified account"
      aria-label="Verified account"
      className={cn(
        'inline-flex items-center justify-center shrink-0 text-sky-500 dark:text-sky-400',
        className
      )}
    >
      <BadgeCheck className={cn(sizeClass, 'fill-sky-500/15 stroke-[2.25]')} />
    </span>
  );
};
