import React from 'react';
import { Profile } from '@/src/types';
import { UserAvatar } from '../ui/UserAvatar';

interface TypingBubbleProps {
  user?: Profile | null;
}

export const TypingBubble: React.FC<TypingBubbleProps> = React.memo(({ user }) => {
  const displayName = user?.display_name || user?.username || 'User';

  return (
    <div
      className="flex items-end gap-1.5 my-1.5 p-0.5 h-10 shrink-0 justify-start animate-in fade-in duration-150"
      aria-label={`${displayName} is typing`}
    >
      <UserAvatar
        src={user?.avatar_url}
        name={displayName}
        id={user?.id}
        className="w-7 h-7 mb-0.5 shadow-xs shrink-0"
      />
      <div className="h-9 px-3.5 rounded-2xl rounded-bl-xs bg-neutral-100 dark:bg-neutral-800 border border-neutral-200/90 dark:border-neutral-700/60 shadow-xs flex items-center gap-1.5">
        <span
          className="w-2 h-2 rounded-full bg-neutral-400 dark:bg-neutral-400 animate-bounce"
          style={{ animationDelay: '0ms', animationDuration: '0.9s' }}
        />
        <span
          className="w-2 h-2 rounded-full bg-neutral-400 dark:bg-neutral-400 animate-bounce"
          style={{ animationDelay: '150ms', animationDuration: '0.9s' }}
        />
        <span
          className="w-2 h-2 rounded-full bg-neutral-400 dark:bg-neutral-400 animate-bounce"
          style={{ animationDelay: '300ms', animationDuration: '0.9s' }}
        />
      </div>
    </div>
  );
});

TypingBubble.displayName = 'TypingBubble';
