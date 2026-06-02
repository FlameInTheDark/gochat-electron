import type { MouseEvent } from 'react'
import { AlertCircle, Eye, Loader2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import BotBadge from '@/components/ui/BotBadge'
import { parseInlineMessageContent, type MentionResolver } from '@/lib/messageParser'
import { cn } from '@/lib/utils'
import type { PendingInteraction } from '@/stores/interactionStore'
import ApplicationCommandUsageHeader from '@/components/chat/message-list/ApplicationCommandUsageHeader'

interface Props {
  interaction: PendingInteraction
  resolver?: MentionResolver
  onDismiss?: () => void
}

function initials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase() || 'A'
}

function formatTimestamp(value: number): string {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function ApplicationCommandUsageRow({
  interaction,
  resolver,
  onDismiss,
}: Props) {
  const { t } = useTranslation()
  const timestamp = formatTimestamp(interaction.createdAt)
  const ephemeralContent = interaction.ephemeralContent?.trim()
  const isEphemeral = interaction.status === 'ephemeral'
  const isFailed = interaction.status === 'failed'
  const isWaiting = !isEphemeral && !isFailed
  const applicationUserId = interaction.applicationUserId ?? interaction.applicationId
  const canOpenApplication = Boolean(applicationUserId && resolver?.onUserClick)

  function handleApplicationClick(event: MouseEvent<HTMLElement>) {
    event.stopPropagation()
    if (!applicationUserId) return
    resolver?.onUserClick?.(applicationUserId, event.clientX, event.clientY)
  }

  return (
    <div className="px-4">
      <div
        className={cn(
          'relative flex min-h-[104px] flex-col rounded-xl px-2 py-1 hover:bg-white/[0.025]',
          isFailed && 'bg-red-500/6 hover:bg-red-500/10',
        )}
      >
        <ApplicationCommandUsageHeader
          userId={interaction.userId}
          userName={interaction.userName}
          userAvatarUrl={interaction.userAvatarUrl}
          commandName={interaction.commandName}
          resolver={resolver}
        />

        <div className="mt-1 flex items-start gap-3">
          {canOpenApplication ? (
            <button
              type="button"
              onClick={handleApplicationClick}
              data-message-interactive="true"
              className="mt-0.5 shrink-0 rounded-full focus:outline-none"
              tabIndex={-1}
            >
              <Avatar className="h-9 w-9">
                <AvatarImage src={interaction.applicationIcon ?? undefined} alt={interaction.applicationName} className="object-cover" />
                <AvatarFallback className="text-xs">{initials(interaction.applicationName)}</AvatarFallback>
              </Avatar>
            </button>
          ) : (
            <Avatar className="mt-0.5 h-9 w-9 shrink-0">
              <AvatarImage src={interaction.applicationIcon ?? undefined} alt={interaction.applicationName} className="object-cover" />
              <AvatarFallback className="text-xs">{initials(interaction.applicationName)}</AvatarFallback>
            </Avatar>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-baseline gap-2">
              {canOpenApplication ? (
                <button
                  type="button"
                  onClick={handleApplicationClick}
                  data-message-interactive="true"
                  className="min-w-0 truncate text-sm font-semibold text-foreground hover:underline"
                >
                  {interaction.applicationName}
                </button>
              ) : (
                <span className="min-w-0 truncate text-sm font-semibold text-foreground">
                  {interaction.applicationName}
                </span>
              )}
              <BotBadge />
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{timestamp}</span>
            </div>
            {isFailed && (
              <div className="mt-1 space-y-1">
                <div className="flex items-center gap-2 text-sm text-red-300">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{t('chat.applicationDidNotRespond', { defaultValue: 'The application did not respond' })}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <Eye className="h-3.5 w-3.5" />
                  <span>{t('chat.onlyYouCanSeeThis', { defaultValue: 'Only you can see this' })}</span>
                  {onDismiss && (
                    <>
                      <span>-</span>
                      <button
                        type="button"
                        onClick={onDismiss}
                        className="inline-flex items-center gap-1 font-medium text-blue-300 hover:underline"
                      >
                        <X className="h-3 w-3" />
                        {t('chat.dismissMessage', { defaultValue: 'Dismiss message' })}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
            {isEphemeral && (
              <div className="mt-1 space-y-1">
                <div className="text-sm leading-relaxed text-foreground">
                  {ephemeralContent
                    ? parseInlineMessageContent(ephemeralContent, resolver, `interaction-${interaction.localId}`)
                    : t('chat.applicationRespondedPrivately', { defaultValue: 'The application responded privately.' })}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <Eye className="h-3.5 w-3.5" />
                  <span>{t('chat.onlyYouCanSeeThis', { defaultValue: 'Only you can see this' })}</span>
                  {onDismiss && (
                    <>
                      <span>-</span>
                      <button
                        type="button"
                        onClick={onDismiss}
                        className="inline-flex items-center gap-1 font-medium text-blue-300 hover:underline"
                      >
                        <X className="h-3 w-3" />
                        {t('chat.dismissMessage', { defaultValue: 'Dismiss message' })}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
            {isWaiting && (
              <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>{t('chat.sendingCommand', { defaultValue: 'Sending command...' })}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
