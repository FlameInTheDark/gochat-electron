import type { CSSProperties, MouseEvent } from 'react'
import { Component, CornerUpRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import type { MentionResolver } from '@/lib/messageParser'
import { cn } from '@/lib/utils'

interface Props {
  userId: string
  userName: string
  userAvatarUrl?: string | null
  userRoleColor?: string
  commandName: string
  resolver?: MentionResolver
  className?: string
}

function fallbackInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?'
}

export default function ApplicationCommandUsageHeader({
  userId,
  userName,
  userAvatarUrl,
  userRoleColor,
  commandName,
  resolver,
  className,
}: Props) {
  const { t } = useTranslation()
  const resolvedUserName = resolver?.user?.(userId) ?? userName
  const canOpenUser = Boolean(resolver?.onUserClick)
  const userNameStyle: CSSProperties = userRoleColor
    ? { color: userRoleColor, opacity: 0.75 }
    : { color: 'var(--foreground)' }

  function handleUserClick(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation()
    resolver?.onUserClick?.(userId, event.clientX, event.clientY)
  }

  return (
    <div className={cn('group/appcmd flex min-w-0 items-center gap-3 text-xs text-muted-foreground', className)}>
      <div className="flex w-9 shrink-0 items-center justify-end">
        <CornerUpRight
          className="h-4 w-4 text-muted-foreground/40 transition-colors group-hover/appcmd:text-muted-foreground"
          strokeWidth={2.5}
        />
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        <Avatar className="h-4 w-4 shrink-0">
          <AvatarImage src={userAvatarUrl ?? undefined} alt={resolvedUserName} className="object-cover" />
          <AvatarFallback className="text-[9px]">{fallbackInitial(resolvedUserName)}</AvatarFallback>
        </Avatar>
        {canOpenUser ? (
          <button
            type="button"
            onClick={handleUserClick}
            data-message-interactive="true"
            className="shrink-0 font-medium hover:underline"
            style={userNameStyle}
          >
            {resolvedUserName}
          </button>
        ) : (
          <span className="shrink-0 font-medium" style={userNameStyle}>
            {resolvedUserName}
          </span>
        )}
        <span className="shrink-0">{t('chat.usedApplicationCommand', { defaultValue: 'used' })}</span>
        <span className="inline-flex min-w-0 items-center gap-1 rounded-sm bg-blue-500/18 px-1.5 py-0.5 text-xs font-semibold text-blue-300">
          <Component className="h-3 w-3 shrink-0" />
          <span className="truncate">{commandName}</span>
        </span>
      </div>
    </div>
  )
}
