import { create } from 'zustand'
import type { ApplicationCommand, InteractionOptionValue } from '@/lib/applicationCommandsApi'
import type { DtoMessage } from '@/types'

export type PendingInteractionStatus = 'sending' | 'dispatched' | 'deferred' | 'ephemeral' | 'failed'

export interface InteractionResponseData {
  content?: string
  flags?: number
  embeds?: unknown[]
  components?: unknown[]
  attachments?: unknown[]
}

export interface InteractionStatusEvent {
  interaction_id?: string | number
  application_id?: string | number
  command_id?: string | number
  command_name?: string
  channel_id?: string | number
  guild_id?: string | number | null
  user_id?: string | number
  state?: string
  response?: InteractionResponseData | null
  message?: DtoMessage | null
}

export interface PendingInteraction {
  localId: string
  channelId: string
  interactionId?: string
  commandId: string
  commandName: string
  applicationId: string
  applicationUserId?: string | null
  applicationName: string
  applicationIcon?: string | null
  userId: string
  userName: string
  userAvatarUrl?: string | null
  options: InteractionOptionValue[]
  status: PendingInteractionStatus
  ephemeralResponse?: InteractionResponseData | null
  ephemeralContent?: string | null
  createdAt: number
}

interface InteractionState {
  pendingInteractions: Record<string, PendingInteraction[]>
  addPendingInteraction: (interaction: PendingInteraction) => void
  attachInteractionId: (localId: string, interactionId: string) => void
  markInteractionFailed: (localId: string) => void
  applyInteractionStatus: (event: InteractionStatusEvent) => void
  removePendingInteraction: (localId: string) => void
  removePendingInteractionForMessage: (message: DtoMessage) => void
  findPendingInteraction: (localId: string) => PendingInteraction | null
  removeChannelInteractions: (channelId: string) => void
}

const failureTimers = new Map<string, ReturnType<typeof setTimeout>>()

function clearFailureTimer(localId: string) {
  const timer = failureTimers.get(localId)
  if (timer !== undefined) {
    clearTimeout(timer)
    failureTimers.delete(localId)
  }
}

function updatePendingCollections(
  pendingInteractions: Record<string, PendingInteraction[]>,
  matcher: (interaction: PendingInteraction) => boolean,
  updater: (interaction: PendingInteraction) => PendingInteraction | null,
): Record<string, PendingInteraction[]> {
  let changed = false
  const nextPendingInteractions: Record<string, PendingInteraction[]> = { ...pendingInteractions }

  for (const [channelId, interactions] of Object.entries(pendingInteractions)) {
    let channelChanged = false
    const updatedInteractions = interactions
      .map((interaction) => {
        if (!matcher(interaction)) return interaction
        channelChanged = true
        return updater(interaction)
      })
      .filter((interaction): interaction is PendingInteraction => interaction != null)

    if (channelChanged) {
      changed = true
      if (updatedInteractions.length > 0) {
        nextPendingInteractions[channelId] = updatedInteractions
      } else {
        delete nextPendingInteractions[channelId]
      }
    }
  }

  return changed ? nextPendingInteractions : pendingInteractions
}

export function createPendingInteraction(params: {
  channelId: string
  command: ApplicationCommand
  userId: string
  userName: string
  userAvatarUrl?: string | null
  options: InteractionOptionValue[]
}): PendingInteraction {
  return {
    localId: `appcmd:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`,
    channelId: params.channelId,
    commandId: String(params.command.id),
    commandName: params.command.name,
    applicationId: String(params.command.application_id),
    applicationUserId: params.command.bot_id != null ? String(params.command.bot_id) : String(params.command.application_id),
    applicationName: params.command.bot_name?.trim() || `Application ${params.command.application_id}`,
    applicationIcon: params.command.application_icon ?? null,
    userId: params.userId,
    userName: params.userName,
    userAvatarUrl: params.userAvatarUrl ?? null,
    options: params.options,
    status: 'sending',
    createdAt: Date.now(),
  }
}

export function schedulePendingInteractionFailure(localId: string, timeoutMs = 120_000) {
  clearFailureTimer(localId)
  failureTimers.set(
    localId,
    setTimeout(() => {
      failureTimers.delete(localId)
      useInteractionStore.getState().markInteractionFailed(localId)
    }, timeoutMs),
  )
}

function interactionStatusMatches(
  interaction: PendingInteraction,
  event: InteractionStatusEvent,
): boolean {
  const eventInteractionId = event.interaction_id != null ? String(event.interaction_id) : null
  if (eventInteractionId && interaction.interactionId === eventInteractionId) return true

  const channelId = event.channel_id != null ? String(event.channel_id) : null
  const commandId = event.command_id != null ? String(event.command_id) : null
  const userId = event.user_id != null ? String(event.user_id) : null
  if (!channelId || !commandId) return false
  return interaction.channelId === channelId &&
    interaction.commandId === commandId &&
    (userId == null || interaction.userId === userId)
}

function responseContent(response: InteractionResponseData | null | undefined): string | null {
  const content = response?.content?.trim()
  return content ? content : null
}

export const useInteractionStore = create<InteractionState>((set, get) => ({
  pendingInteractions: {},
  addPendingInteraction: (interaction) => {
    set((state) => ({
      pendingInteractions: {
        ...state.pendingInteractions,
        [interaction.channelId]: [
          ...(state.pendingInteractions[interaction.channelId] ?? []),
          interaction,
        ],
      },
    }))
  },
  attachInteractionId: (localId, interactionId) => {
    set((state) => {
      const nextPendingInteractions = updatePendingCollections(
        state.pendingInteractions,
        (interaction) => interaction.localId === localId,
        (interaction) => ({
          ...interaction,
          interactionId,
          status: interaction.status === 'sending' ? 'dispatched' : interaction.status,
        }),
      )
      return nextPendingInteractions === state.pendingInteractions
        ? state
        : { pendingInteractions: nextPendingInteractions }
    })
  },
  markInteractionFailed: (localId) => {
    set((state) => {
      const nextPendingInteractions = updatePendingCollections(
        state.pendingInteractions,
        (interaction) =>
          interaction.localId === localId &&
          (interaction.status === 'sending' || interaction.status === 'dispatched'),
        (interaction) => ({ ...interaction, status: 'failed' }),
      )
      return nextPendingInteractions === state.pendingInteractions
        ? state
        : { pendingInteractions: nextPendingInteractions }
    })
  },
  applyInteractionStatus: (event) => {
    const stateName = event.state?.toLowerCase() ?? ''
    const matched = Object.values(get().pendingInteractions)
      .flat()
      .filter((interaction) => interactionStatusMatches(interaction, event))
    matched.forEach((interaction) => clearFailureTimer(interaction.localId))

    if (matched.length === 0) return

    set((state) => {
      const nextPendingInteractions = updatePendingCollections(
        state.pendingInteractions,
        (interaction) => matched.some((candidate) => candidate.localId === interaction.localId),
        (interaction) => {
          const interactionId = event.interaction_id != null
            ? String(event.interaction_id)
            : interaction.interactionId

          if (event.message || stateName === 'responded' || stateName === 'modal' || stateName === 'deleted') {
            return null
          }
          if (stateName === 'failed' || stateName === 'expired') {
            return { ...interaction, interactionId, status: 'failed' }
          }
          if (stateName === 'ephemeral' || stateName === 'ephemeral_followup') {
            return {
              ...interaction,
              interactionId,
              status: 'ephemeral',
              ephemeralResponse: event.response ?? null,
              ephemeralContent: responseContent(event.response),
            }
          }
          if (stateName === 'deferred') {
            return {
              ...interaction,
              interactionId,
              status: 'deferred',
              ephemeralResponse: event.response ?? interaction.ephemeralResponse ?? null,
            }
          }
          return { ...interaction, interactionId }
        },
      )
      return nextPendingInteractions === state.pendingInteractions
        ? state
        : { pendingInteractions: nextPendingInteractions }
    })
  },
  removePendingInteraction: (localId) => {
    clearFailureTimer(localId)
    set((state) => {
      const nextPendingInteractions = updatePendingCollections(
        state.pendingInteractions,
        (interaction) => interaction.localId === localId,
        () => null,
      )
      return nextPendingInteractions === state.pendingInteractions
        ? state
        : { pendingInteractions: nextPendingInteractions }
    })
  },
  removePendingInteractionForMessage: (message) => {
    const interactionId = message.interaction?.id != null ? String(message.interaction.id) : null
    const commandId = message.interaction?.command_id != null ? String(message.interaction.command_id) : null
    const channelId = message.channel_id != null ? String(message.channel_id) : null
    const userId = message.interaction?.user_id != null ? String(message.interaction.user_id) : null
    if (!channelId || (!interactionId && !commandId)) return

    const matched = get().pendingInteractions[channelId]?.filter((interaction) => {
      if (interactionId && interaction.interactionId === interactionId) return true
      return !interaction.interactionId &&
        commandId != null &&
        interaction.commandId === commandId &&
        (userId == null || interaction.userId === userId)
    }) ?? []
    matched.forEach((interaction) => clearFailureTimer(interaction.localId))

    set((state) => {
      const nextPendingInteractions = updatePendingCollections(
        state.pendingInteractions,
        (interaction) => matched.some((candidate) => candidate.localId === interaction.localId),
        () => null,
      )
      return nextPendingInteractions === state.pendingInteractions
        ? state
        : { pendingInteractions: nextPendingInteractions }
    })
  },
  findPendingInteraction: (localId) => {
    for (const interactions of Object.values(get().pendingInteractions)) {
      const interaction = interactions.find((candidate) => candidate.localId === localId)
      if (interaction) return interaction
    }
    return null
  },
  removeChannelInteractions: (channelId) => {
    const removedInteractions = get().pendingInteractions[channelId] ?? []
    removedInteractions.forEach((interaction) => clearFailureTimer(interaction.localId))
    set((state) => {
      if (!(channelId in state.pendingInteractions)) return state
      const nextPendingInteractions = { ...state.pendingInteractions }
      delete nextPendingInteractions[channelId]
      return { pendingInteractions: nextPendingInteractions }
    })
  },
}))
