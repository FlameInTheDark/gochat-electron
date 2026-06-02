import { useState, useEffect, useRef } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useIdlePresence } from '@/hooks/useIdlePresence'
import { useDeepLink } from '@/hooks/useDeepLink'
import { axiosInstance, userApi } from '@/api/client'
import AppShell from '@/components/layout/AppShell'
import InviteModal from '@/components/modals/InviteModal'
import JoinServerModal from '@/components/modals/JoinServerModal'
import AppSettingsModal from '@/components/modals/AppSettingsModal'
import ServerSettingsModal from '@/components/modals/ServerSettingsModal'
import ChannelSettingsModal from '@/components/modals/ChannelSettingsModal'
import DMCallIncomingModal from '@/components/dm/DMCallIncomingModal'
import UserProfilePanel from '@/components/layout/UserProfilePanel'
import type { DtoUser } from '@/types'
import { usePresenceStore, type UserStatus } from '@/stores/presenceStore'

import { useVoiceStore } from '@/stores/voiceStore'
import { sendPresenceStatus } from '@/services/wsService'
import { useFolderStore } from '@/stores/folderStore'
import { useReadStateStore } from '@/stores/readStateStore'
import { useMentionStore } from '@/stores/mentionStore'
import { useEmojiStore } from '@/stores/emojiStore'
import { useGifStore } from '@/stores/gifStore'
import i18n from '@/i18n'
import { setupTokenRefreshScheduler } from '@/lib/tokenRefresh'
import { refreshAuthToken } from '@/lib/authRefresh'
import { useAuthProblemStore } from '@/stores/authProblemStore'
import { getApiBaseUrl } from '@/lib/connectionConfig'
import { compareSnowflakes } from '@/lib/snowflake'
import { voiceSettingsFromDevices } from '@/lib/voiceSettings'
import { mergeUserPreservingAssets } from '@/lib/entityMerge'
import { hasDMCallParticipants, normalizeDMCall, type RawDMCallSummary } from '@/services/dmCallApi'
import { useDMCallStore } from '@/stores/dmCallStore'
import { useGatewayConnectionStore } from '@/stores/gatewayConnectionStore'
import type { UserUserSettingsResponse } from '@/client'

const VALID_STATUSES = new Set<string>(['online', 'idle', 'dnd', 'offline'])

function applySettingsBootstrap(
  queryClient: QueryClient,
  data: UserUserSettingsResponse,
  currentUserId: string,
) {
  const settings = data.settings
  if (settings) {
    queryClient.setQueryData(['user-settings'], settings)

    const savedStatus = settings.status?.status
    const savedCustomText = settings.status?.custom_status_text ?? ''
    const effectiveStatus = (savedStatus && VALID_STATUSES.has(savedStatus)
      ? savedStatus : 'online') as UserStatus
    const presenceStore = usePresenceStore.getState()
    presenceStore.setCustomStatusText(savedCustomText)
    if (effectiveStatus === 'online') {
      presenceStore.setManualStatus(null)
      presenceStore.setSessionStatus('online')
    } else {
      presenceStore.setManualStatus(effectiveStatus)
    }
    sendPresenceStatus(effectiveStatus, savedCustomText, { manual: true })

    useFolderStore.getState().loadFromSettings(settings.guild_folders, settings.guilds)

    const savedFavoriteGifs = settings.favorite_gifs
    if (Array.isArray(savedFavoriteGifs)) {
      useGifStore.getState().setFavorites(savedFavoriteGifs)
    }

    const savedLanguage = settings.language
    if (savedLanguage && savedLanguage.trim()) {
      void i18n.changeLanguage(savedLanguage)
    }

    const voiceSettings = voiceSettingsFromDevices(settings.devices)
    if (voiceSettings) {
      useVoiceStore.getState().setSettings(voiceSettings)
    }
  }

  useReadStateStore.getState().setFromSettings(data)

  const rawDMCalls = ((data as unknown as { dm_calls?: RawDMCallSummary[] }).dm_calls ?? [])
  const dmCalls = rawDMCalls
    .map(normalizeDMCall)
    .filter((call) => call.callId && call.channelId && hasDMCallParticipants(call))
  const dmCallStore = useDMCallStore.getState()
  dmCallStore.setCalls(dmCalls)
  const incoming = dmCalls.find((call) =>
    call.recipientId === currentUserId
    && call.callerId !== currentUserId
    && !call.dismissed
  )
  dmCallStore.setIncoming(incoming?.channelId ?? null)

  const rawMentions = data.mentions ?? {}
  const readStates = useReadStateStore.getState().readStates
  const channelGuildMap: Record<string, string> = {}
  for (const [guildId, channelMap] of Object.entries(data.guilds_last_messages ?? {})) {
    for (const channelId of Object.keys(channelMap)) {
      channelGuildMap[channelId] = guildId
    }
  }

  const mentionSeed: Record<string, { messageIds: string[]; guildId: string | null }> = {}
  for (const [channelId, items] of Object.entries(rawMentions)) {
    if (!Array.isArray(items) || !items.length) continue
    const guildId = channelGuildMap[channelId] ?? null
    let messageIds = items
      .map((m) => {
        const raw = m as unknown as Record<string, unknown>
        const msgId = (raw['MessageId'] ?? raw['messageId']) as string | number | undefined
        return msgId != null ? String(msgId) : null
      })
      .filter((msgId): msgId is string => msgId != null)
    const lastRead = readStates[channelId]
    if (lastRead) {
      messageIds = messageIds.filter((msgId) => compareSnowflakes(msgId, lastRead) > 0)
    }
    if (messageIds.length > 0) {
      mentionSeed[channelId] = { messageIds, guildId }
    }
  }
  useMentionStore.getState().seedMentions(mentionSeed)

  const guildEmojis = data.guild_emojis
  if (guildEmojis) {
    const emojiStore = useEmojiStore.getState()
    for (const [guildId, emojiRefs] of Object.entries(guildEmojis)) {
      emojiStore.setGuildEmojis(
        guildId,
        (emojiRefs ?? []).map((emoji) => ({
          id: String(emoji.id ?? ''),
          name: String(emoji.name ?? ''),
          guild_id: guildId,
        })),
      )
    }
  }

  const contentHosts = data.content_hosts
  if (Array.isArray(contentHosts)) {
    useGifStore.getState().setContentHosts(contentHosts)
  }
}

// ── Inner components ───────────────────────────────────────────────────────
// The route tree only mounts after the gateway sends READY. Before that, the
// app keeps showing the loading screen so channel/server queries cannot race
// ahead of the realtime session and its bootstrap cache payload.
function ConnectedAppShell() {
  const queryClient = useQueryClient()

  useEffect(() => {
    let cancelled = false

    queryClient
      .fetchQuery({
        queryKey: ['user-settings-bootstrap'],
        queryFn: () => userApi.userMeSettingsGet({}).then((r) => r.data),
        staleTime: 60_000,
      })
      .then((data) => {
        if (cancelled) return
        const currentUserId = String(useAuthStore.getState().user?.id ?? '')
        applySettingsBootstrap(queryClient, data, currentUserId)
      })
      .catch(() => {
        // Non-critical: gateway READY already provided the minimum bootstrap.
      })

    return () => {
      cancelled = true
    }
  }, [queryClient])

  useIdlePresence()
  useDeepLink()
  // Keep authStore user in sync with WS t=406 profile update events
  useEffect(() => {
    const handler = (e: Event) => {
      const updated = (e as CustomEvent<DtoUser>).detail
      if (updated) {
        const current = useAuthStore.getState().user
        useAuthStore.getState().setUser(mergeUserPreservingAssets(current, updated))
      }
    }
    window.addEventListener('ws:user_update', handler)
    return () => window.removeEventListener('ws:user_update', handler)
  }, [])

  return (
    <AppShell>
      <Outlet />
      <InviteModal />
      <JoinServerModal />
      <AppSettingsModal />
      <ServerSettingsModal />
      <ChannelSettingsModal />
      <DMCallIncomingModal />
      <UserProfilePanel />
    </AppShell>
  )
}

function AuthenticatedApp() {
  useWebSocket()
  const gatewayReady = useGatewayConnectionStore((s) => s.ready)

  if (!gatewayReady) return <LoadingScreen />

  return <ConnectedAppShell />
}

// ── Loading screen ─────────────────────────────────────────────────────────
function LoadingScreen() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4 text-muted-foreground">
        <div className="w-10 h-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        <p className="text-sm">{i18n.t('app.loading')}</p>
      </div>
    </div>
  )
}

// ── Auth guard / init orchestrator ─────────────────────────────────────────
// Initialization order:
//   1. Validate the stored access token via GET /user/me
//      → if expired: the 401 interceptor on axiosInstance transparently uses
//        the refresh token to obtain a new access token, then retries
//      → if both tokens are invalid/absent: logout + redirect to /
//   2. On success: set the user in authStore
//   3. AuthenticatedApp mounts → useWebSocket() connects
//   4. WS READY seeds bootstrap caches and guild subscriptions
//   5. Child components mount and fetch their own data (channels, members, …)
export default function AppLayout() {
  const navigate = useNavigate()
  const token = useAuthStore((s) => s.token)
  const refreshToken = useAuthStore((s) => s.refreshToken)
  const setUser = useAuthStore((s) => s.setUser)
  const authProblemOpen = useAuthProblemStore((s) => s.isOpen)

  // Proactive token refresh: decodes the JWT expiry and schedules a refresh
  // 30 s before it expires so the WS and API never hit a stale token.
  // Runs once and subscribes to future token changes (e.g. after each refresh).
  useEffect(() => setupTokenRefreshScheduler(), [])

  // Only show the loading screen when we actually have a token to validate.
  // Avoids a blank-flash on the unauthenticated redirect path.
  const [isValidating, setIsValidating] = useState(!!token)

  // Tracks the token that was most recently validated successfully.
  // A non-null → different non-null transition means the 401 interceptor silently
  // refreshed the token — skip re-validation to prevent a loading-screen flash.
  const validatedTokenRef = useRef<string | null>(null)

  useEffect(() => {
    if (!token) {
      validatedTokenRef.current = null
      if (refreshToken) {
        setIsValidating(true)
        refreshAuthToken({ openModalOnFailure: true })
          .catch(() => {
            // The auth problem modal owns recovery. Keep the refresh token so
            // the user can retry instead of being forced out.
          })
          .finally(() => setIsValidating(false))
        return
      }
      if (authProblemOpen) {
        setIsValidating(false)
        return
      }
      setIsValidating(false)
      navigate('/', { replace: true })
      return
    }

    // Silent token refresh: the 401 interceptor already renewed the token while
    // the user was authenticated.  Just update the ref — no need to hit /user/me
    // again or show the loading spinner.
    if (validatedTokenRef.current !== null) {
      validatedTokenRef.current = token
      return
    }

    setIsValidating(true)

    const baseUrl = getApiBaseUrl()
    const controller = new AbortController()

    // Validate user identity only. All non-auth bootstrap data waits until the
    // gateway sends READY so the app does not mount around a missing WS session.
    axiosInstance
      .get<DtoUser>(`${baseUrl}/user/me`, { signal: controller.signal })
      .then((userRes) => {
        if (userRes.data) {
          setUser(userRes.data)
        } else {
          throw new Error('Empty /user/me response')
        }
        // Mark this token as validated so future silent refreshes are skipped.
        validatedTokenRef.current = token
      })
      .catch(() => {
        // Aborted by StrictMode cleanup — the effect will re-run; do nothing.
        if (controller.signal.aborted) return
        // Refresh also failed. The shared refresh flow opens a blocking modal
        // after retries fail; keep tokens intact until the user retries or logs out.
        validatedTokenRef.current = null
      })
      .finally(() => {
        // Guard against calling setState after the effect was cleaned up.
        // When the signal is aborted (token changed while validating), the new
        // effect invocation takes responsibility for isValidating state.
        if (!controller.signal.aborted) setIsValidating(false)
      })

    return () => {
      controller.abort()
    }
    // token is the only real dependency; navigate/setUser are stable refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, refreshToken, authProblemOpen])

  // No token — effect already navigated away; render nothing during transition
  if (!token) return null

  // Token exists but not yet validated — show spinner so child components
  // don't mount and fire off queries while auth is still undecided
  if (isValidating) return <LoadingScreen />

  // Validated — hand off to the authenticated shell + WebSocket
  return <AuthenticatedApp />
}
