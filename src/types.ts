// Augment DtoUser with is_bot field returned by the API but missing from the generated client
declare module '@/client' {
  interface DtoUser {
    is_bot?: boolean
  }

  interface DtoMessageInteraction {
    id?: number
    application_id?: number
    command_id?: number
    command_name?: string
    user_id?: number
  }

  interface DtoMessage {
    interaction?: DtoMessageInteraction
  }
}

// Re-export key API types for convenience
export type {
  DtoUser,
  DtoGuild,
  DtoChannel,
  DtoMessage,
  DtoMessageReaction,
  DtoMember,
  DtoGuildInvite,
  DtoAttachment,
  DtoBannerData,
  ModelChannelType,
} from '@/client'

export { ModelChannelType as ChannelType } from '@/client'

export interface ContextMenuItem {
  label: string
  action: () => void
  danger?: boolean
}
