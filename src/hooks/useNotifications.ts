import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useMessageStore } from '@/stores/messageStore'
import { useNotificationSettingsStore } from '@/stores/notificationSettingsStore'
import { isChannelVisible } from '@/services/wsService'
import { messageApi } from '@/api/client'
import type { DtoChannel, DtoGuild, DtoMessage, DtoUser, ModelUserSettingsNotifications } from '@/client'
import { ModelNotificationsType } from '@/client'

// Matches backend mention type enum (mention.go)
const MentionType = { User: 0, Role: 1, Everyone: 2, Here: 3 } as const

// Module-level dedup: prevents double-firing the same notification if the
// ws:mention event is delivered more than once (e.g. React StrictMode remount).
const recentlyNotifiedIds = new Set<string>()

interface WsMentionDetail {
  guild_id?: string | number
  channel_id?: string | number
  message_id?: string | number
  author_id?: string | number
  type?: number
}

function isEffectivelyMuted(notif: ModelUserSettingsNotifications | undefined): boolean {
  if (!notif?.muted) return false
  if (!notif.muted_until) return true
  return new Date(notif.muted_until) > new Date()
}

function isMentionTypeSuppressed(
  notif: ModelUserSettingsNotifications | undefined,
  mentionType: number | undefined,
): boolean {
  if (!notif || mentionType == null) return false
  if (mentionType === MentionType.Everyone && notif.suppress_everyone_mentions) return true
  if (mentionType === MentionType.Here && notif.suppress_here_mentions) return true
  if (mentionType === MentionType.Role && notif.suppress_role_mentions) return true
  if (mentionType === MentionType.User && notif.suppress_user_mentions) return true
  return false
}

export function useNotifications() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent<WsMentionDetail>).detail
      const guildId = detail.guild_id != null ? String(detail.guild_id) : null
      const channelId = detail.channel_id != null ? String(detail.channel_id) : null
      const messageId = detail.message_id != null ? String(detail.message_id) : null

      if (!channelId || !messageId) return

      // Deduplicate: skip if we already fired a notification for this message
      if (recentlyNotifiedIds.has(messageId)) return
      recentlyNotifiedIds.add(messageId)
      setTimeout(() => recentlyNotifiedIds.delete(messageId), 10_000)

      // Skip if user is currently viewing the channel
      if (isChannelVisible(channelId)) return

      // Check per-channel → per-guild notification settings (same priority as wsService)
      const store = useNotificationSettingsStore.getState()
      const notif = store.getChannelNotif(channelId) ?? (guildId ? store.getGuildNotif(guildId) : undefined)

      if (isEffectivelyMuted(notif)) return
      if (notif?.notifications === ModelNotificationsType.NotificationsNone) return
      if (isMentionTypeSuppressed(notif, detail.type)) return

      // Look up guild + channel display names from TanStack Query cache
      const guilds = queryClient.getQueryData<DtoGuild[]>(['guilds'])
      const guildName = guilds?.find((g) => String(g.id) === guildId)?.name

      const channels = guildId
        ? queryClient.getQueryData<DtoChannel[]>(['channels', guildId])
        : undefined
      const channelName = channels?.find((c) => String(c.id) === channelId)?.name

      // Find message: check store first (t=100 usually arrives before t=302)
      let msg: DtoMessage | undefined = useMessageStore
        .getState()
        .messages[channelId]
        ?.find((m) => String(m.id) === messageId)

      // Fallback: fetch via API — use string cast (not Number()) to preserve 64-bit Snowflake IDs
      if (!msg) {
        try {
          const res = await messageApi.messageChannelChannelIdGet({
            channelId: channelId as unknown as number,
            from: messageId as unknown as number,
            direction: 'around',
            limit: 1,
          })
          msg = (res.data as DtoMessage[])[0]
        } catch {
          // proceed without message content
        }
      }

      const author = msg?.author as DtoUser | undefined
      const authorName = author?.name ?? 'Someone'
      const content = msg?.content?.trim() ?? ''
      const excerpt = content.length > 100 ? content.slice(0, 97) + '…' : content

      const titleParts: string[] = []
      if (guildName) titleParts.push(guildName)
      if (channelName) titleParts.push(`#${channelName}`)
      const title = titleParts.length > 0 ? titleParts.join(' › ') : 'GoChat'
      const body = excerpt ? `${authorName}: ${excerpt}` : `${authorName} mentioned you`

      window.electronAPI?.notify({ title, body })
    }

    window.addEventListener('ws:mention', handler)
    return () => window.removeEventListener('ws:mention', handler)
  }, [queryClient])
}
