import { Fragment, forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, Hash, Shield, Paperclip, SendHorizontal, X } from 'lucide-react'
import { guildApi, rolesApi } from '@/api/client'
import { ChannelType } from '@/types'
import type { DtoChannel, DtoGuild } from '@/client'
import { Smile, ImagePlay } from 'lucide-react'
import EmojiPicker from './EmojiPicker'
import GifPicker from './GifPicker'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import { useClientMode } from '@/hooks/useClientMode'
import { useEmojiStore } from '@/stores/emojiStore'
import { emojiUrl } from '@/lib/emoji'
import { allEmojis } from '@/lib/emojiData'
import { useGuildPermissions } from '@/hooks/useGuildPermissions'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  applicationCommandsApi,
  type ApplicationCommand,
  type ApplicationCommandOption,
  type InteractionOptionValue,
} from '@/lib/applicationCommandsApi'
import { PermissionBits } from '@/lib/permissions'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SuggestionItem {
  type: 'user' | 'channel' | 'role' | 'special' | 'emoji' | 'slash'
  id: string
  display: string  // text shown in the chip in the editor
  token: string    // serialized token: <@id> <#id> <@&id> or <:name:id>
  name: string     // name for the suggestion list
  color?: number   // role color (RGB integer, 0 = none)
  emojiId?: string // emoji image ID (for custom emoji type)
  unicodeEmoji?: string // unicode emoji character (for unicode emoji type)
  serverName?: string  // server name for custom emoji
  description?: string // slash command result preview
  section?: 'internal' | 'application'
  applicationCommand?: ApplicationCommand
  commandPath?: ApplicationCommandOption[]
  optionPreview?: ApplicationCommandOption[]
}

type CommandOptionDrafts = Record<string, string>
type CommandPath = ApplicationCommandOption[]

// ── Slash commands ────────────────────────────────────────────────────────────

const SLASH_COMMAND_LIST: Array<{ name: string; description: string }> = [
  { name: 'tableflip', description: '(╯°□°)╯︵ ┻━┻' },
  { name: 'unflip', description: '┬─┬ノ( º _ ºノ)' },
]

const maxSlashSuggestionRows = 50

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Serialize a contenteditable div to a plain string with mention tokens. */
function serialize(el: HTMLElement): string {
  let result = ''
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      // Replace non-breaking spaces inserted around chips with regular spaces
      result += (node.textContent ?? '').replace(/\u00A0/g, ' ')
    } else if (node instanceof HTMLElement) {
      if (node.dataset.token) {
        result += node.dataset.token
      } else if (node.tagName === 'BR') {
        result += '\n'
      } else if (node.tagName === 'DIV') {
        // Chrome wraps new lines in <div>
        result += '\n' + serialize(node)
      } else {
        result += serialize(node)
      }
    }
  }
  return result
}

/**
 * Detect a slash command trigger when the entire editor content is `/word`
 * (no chips). Returns the query after `/`, or null if not a slash context.
 */
function getSlashQuery(el: HTMLElement): string | null {
  if (el.querySelector('[data-token]')) return null
  const content = serialize(el)
  const match = content.match(/^\/(\w*)$/)
  if (!match) return null
  return match[1]!
}

/**
 * Find an incomplete mention/emoji trigger (@query, #query, or :query) immediately
 * before the cursor in the current text node.
 */
function getMentionQuery(
  el: HTMLElement,
): { trigger: '@' | '#' | ':'; query: string; triggerText: string } | null {
  const sel = window.getSelection()
  if (!sel?.rangeCount) return null
  const range = sel.getRangeAt(0)
  if (!range.collapsed) return null

  const node = range.startContainer
  if (node.nodeType !== Node.TEXT_NODE) return null
  // Make sure this text node is inside our editor
  if (!el.contains(node)) return null

  const textBefore = (node.textContent ?? '').slice(0, range.startOffset)
  // Match the last run of [@#:] + non-whitespace from the end of textBefore
  const match = textBefore.match(/([@#:][^\s@#:]*)$/)
  if (!match) return null

  const triggerText = match[1] // e.g. "@foo", "#bar", ":smile"
  const posInText = textBefore.length - triggerText.length
  // Must be at start of text or preceded by whitespace.
  if (posInText > 0 && !/\s/.test(textBefore[posInText - 1]!)) return null

  return {
    trigger: triggerText[0] as '@' | '#' | ':',
    query: triggerText.slice(1),
    triggerText,
  }
}

/** Insert a mention chip at the cursor, replacing the current trigger text. */
function insertChip(chip: SuggestionItem) {
  const sel = window.getSelection()
  if (!sel?.rangeCount) return
  const range = sel.getRangeAt(0)
  const node = range.startContainer
  if (node.nodeType !== Node.TEXT_NODE) return

  const text = node.textContent ?? ''
  const offset = range.startOffset
  const textBefore = text.slice(0, offset)

  const match = textBefore.match(/([@#][^\s@#]*)$/)
  if (!match) return

  const triggerStart = offset - match[1].length
  const beforeText = text.slice(0, triggerStart)
  const afterText = text.slice(offset)

  // Build chip span
  const span = document.createElement('span')
  span.contentEditable = 'false'
  span.dataset.token = chip.token
  span.dataset.mention = 'true'
  span.dataset.type = chip.type
  span.className = 'mention-chip'
  span.textContent = chip.display

  // Text nodes flanking the chip
  const beforeNode = document.createTextNode(beforeText)
  // Non-breaking space after chip so cursor has a text node to land in
  const afterNode = document.createTextNode('\u00A0' + afterText)

  const parent = node.parentNode!
  parent.insertBefore(beforeNode, node)
  parent.insertBefore(span, node)
  parent.insertBefore(afterNode, node)
  parent.removeChild(node)

  // Place cursor after the non-breaking space
  const newRange = document.createRange()
  newRange.setStart(afterNode, 1)
  newRange.collapse(true)
  sel.removeAllRanges()
  sel.addRange(newRange)
}

/**
 * Insert a custom emoji `<:name:id>` as a non-editable image chip at the cursor,
 * replacing the `:query` trigger text that preceded it (if any).
 * Works identically to insertChip but renders an <img> instead of text.
 */
function insertCustomEmojiChip(name: string, id: string) {
  const sel = window.getSelection()
  if (!sel?.rangeCount) return
  const range = sel.getRangeAt(0)
  const node = range.startContainer
  if (node.nodeType !== Node.TEXT_NODE) return

  const text = node.textContent ?? ''
  const offset = range.startOffset
  const textBefore = text.slice(0, offset)

  // Remove the `:query` trigger text if present
  const match = textBefore.match(/(:)([A-Za-z0-9-]*)$/)
  const triggerStart = match ? offset - match[0].length : offset
  const beforeText = text.slice(0, triggerStart)
  const afterText = text.slice(offset)

  const span = document.createElement('span')
  span.contentEditable = 'false'
  span.dataset.token = `<:${name}:${id}>`
  const img = document.createElement('img')
  img.src = emojiUrl(id, 44)
  img.alt = `:${name}:`
  img.title = `:${name}:`
  img.className = 'inline-block h-[1.375em] w-auto align-middle pointer-events-none select-none'
  span.appendChild(img)

  const beforeNode = document.createTextNode(beforeText)
  const afterNode = document.createTextNode('\u00A0' + afterText)
  const parent = node.parentNode!
  parent.insertBefore(beforeNode, node)
  parent.insertBefore(span, node)
  parent.insertBefore(afterNode, node)
  parent.removeChild(node)

  const newRange = document.createRange()
  newRange.setStart(afterNode, 1)
  newRange.collapse(true)
  sel.removeAllRanges()
  sel.addRange(newRange)
}

/** Convert role RGB integer to css rgb() string, or null for "no color". */
function roleColor(color: number | undefined): string | null {
  if (!color) return null
  const r = (color >> 16) & 0xff
  const g = (color >> 8) & 0xff
  const b = color & 0xff
  return `rgb(${r},${g},${b})`
}

function isValueOption(option: ApplicationCommandOption): boolean {
  return option.type >= 3 && option.type <= 11
}

function commandGuildContextAllowed(command: ApplicationCommand): boolean {
  return !command.contexts || command.contexts.length === 0 || command.contexts.includes(0)
}

function commandAllowedByMemberPermissions(command: ApplicationCommand, effectivePermissions: number, isPrivileged: boolean): boolean {
  const raw = command.default_member_permissions
  if (raw === null || raw === undefined || raw === '') return true
  if (isPrivileged) return true
  try {
    const required = BigInt(String(raw))
    const effective = BigInt(Math.trunc(effectivePermissions))
    return (effective & required) === required
  } catch {
    return false
  }
}

function optionPlaceholder(option: ApplicationCommandOption): string {
  if (option.choices?.length) return option.choices.map((choice) => choice.name).slice(0, 3).join(', ')
  switch (option.type) {
    case 4:
      return 'integer'
    case 5:
      return 'true / false'
    case 6:
      return 'user'
    case 7:
      return 'channel'
    case 8:
      return 'role'
    case 9:
      return 'mention'
    case 10:
      return 'number'
    case 11:
      return 'attachment'
    default:
      return option.name
  }
}

function coerceOptionValue(option: ApplicationCommandOption, rawValue: string): string | number | boolean {
  const value = rawValue.trim()
  if (option.type === 4) {
    const parsed = Number.parseInt(value, 10)
    return Number.isNaN(parsed) ? value : parsed
  }
  if (option.type === 10) {
    const parsed = Number.parseFloat(value)
    return Number.isNaN(parsed) ? value : parsed
  }
  if (option.type === 5) {
    return value.toLowerCase() === 'true' || value === '1' || value.toLowerCase() === 'yes'
  }
  return value
}

function visibleCommandOptions(options: ApplicationCommandOption[]): ApplicationCommandOption[] {
  return options.filter(isValueOption)
}

function commandPathText(command: ApplicationCommand, path: CommandPath = []): string {
  return [command.name, ...path.map((option) => option.name)].join(' ')
}

function commandPathDescription(command: ApplicationCommand, path: CommandPath = []): string {
  return path[path.length - 1]?.description || command.description || ''
}

function commandOptionsForPath(command: ApplicationCommand | null, path: CommandPath): ApplicationCommandOption[] {
  if (!command) return []
  const source = path[path.length - 1]?.options ?? command.options ?? []
  return visibleCommandOptions(source)
}

function flattenApplicationCommand(command: ApplicationCommand): Array<{
  path: CommandPath
  label: string
  description: string
  options: ApplicationCommandOption[]
}> {
  const options = command.options ?? []
  const subcommands = options.filter((option) => option.type === 1)
  const groups = options.filter((option) => option.type === 2)
  const rows: Array<{
    path: CommandPath
    label: string
    description: string
    options: ApplicationCommandOption[]
  }> = []

  for (const subcommand of subcommands) {
    const path = [subcommand]
    rows.push({
      path,
      label: commandPathText(command, path),
      description: commandPathDescription(command, path),
      options: commandOptionsForPath(command, path),
    })
  }

  for (const group of groups) {
    for (const subcommand of group.options?.filter((option) => option.type === 1) ?? []) {
      const path = [group, subcommand]
      rows.push({
        path,
        label: commandPathText(command, path),
        description: commandPathDescription(command, path),
        options: commandOptionsForPath(command, path),
      })
    }
  }

  if (rows.length > 0) return rows

  return [{
    path: [],
    label: command.name,
    description: command.description || '',
    options: commandOptionsForPath(command, []),
  }]
}

function wrapCommandOptionsForPath(path: CommandPath, options: InteractionOptionValue[]): InteractionOptionValue[] {
  if (path.length === 0) return options
  if (path.length === 1) {
    return [{
      name: path[0]!.name,
      type: path[0]!.type,
      options,
    }]
  }
  return [{
    name: path[0]!.name,
    type: path[0]!.type,
    options: [{
      name: path[1]!.name,
      type: path[1]!.type,
      options,
    }],
  }]
}

function commandOptionPreviewLabel(option: ApplicationCommandOption): string {
  return option.required ? option.name : `${option.name}?`
}

function fallbackInitial(name: string | undefined): string {
  return name?.trim().charAt(0).toUpperCase() || '?'
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  channelId: string
  channelName?: string
  onSend: (content: string) => void
  onApplicationCommand?: (command: ApplicationCommand, options: InteractionOptionValue[]) => void
  onTyping: () => void
  disabled?: boolean
  topBar?: React.ReactNode
  /** Called when the paperclip button is clicked — opens the file picker. */
  onAttachClick?: () => void
  /**
   * Called when files are dropped onto the input or pasted from the clipboard.
   * The parent component owns file state management.
   */
  onFileDrop?: (files: FileList) => void
  /**
   * Rendered above the text editor row, inside the input border.
   * Pass the <PendingAttachmentBar /> here.
   */
  attachmentBar?: React.ReactNode
  /**
   * When true, the Enter key will send even with empty text content
   * (so a message with only attachments can be submitted).
   */
  hasAttachments?: boolean
}

export interface MentionInputHandle {
  focusEditor: () => void
  insertMentionAtEnd: (userId: string, name: string) => void
}

const MentionInput = forwardRef<MentionInputHandle, Props>(function MentionInput({
  channelId,
  channelName,
  onSend,
  onApplicationCommand,
  onTyping,
  disabled = false,
  topBar,
  onAttachClick,
  onFileDrop,
  attachmentBar,
  hasAttachments,
}: Props, ref) {
  const { serverId } = useParams<{ serverId?: string }>()
  const { t } = useTranslation()
  const isMobile = useClientMode() === 'mobile'
  const queryClient = useQueryClient()
  const permissions = useGuildPermissions(serverId)

  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const commandOptionInputRef = useRef<HTMLInputElement>(null)
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([])
  const [activeIdx, setActiveIdx] = useState(0)
  const [slashQuery, setSlashQuery] = useState<string | null>(null)
  const [selectedApplicationCommand, setSelectedApplicationCommand] = useState<ApplicationCommand | null>(null)
  const [selectedCommandPath, setSelectedCommandPath] = useState<CommandPath>([])
  const [commandOptionDrafts, setCommandOptionDrafts] = useState<CommandOptionDrafts>({})
  const [activeCommandOptionName, setActiveCommandOptionName] = useState<string | null>(null)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [gifOpen, setGifOpen] = useState(false)
  const [pickerBottom, setPickerBottom] = useState(64)
  const [pickerRight, setPickerRight] = useState(0)

  function openPicker(which: 'emoji' | 'gif') {
    const rect = containerRef.current?.getBoundingClientRect()
    setPickerBottom(rect ? window.innerHeight - rect.top : 64)
    setPickerRight(rect ? window.innerWidth - rect.right : 0)
    setEmojiOpen(which === 'emoji')
    setGifOpen(which === 'gif')
  }
  // Tracks drag-enter depth so dragleave on children doesn't hide the highlight
  const dragCounterRef = useRef(0)
  const [isDragging, setIsDragging] = useState(false)

  // Custom emojis from the global store
  const guildEmojiMap = useEmojiStore((s) => s.guildEmojis)
  const guilds = queryClient.getQueryData<DtoGuild[]>(['guilds'])

  const customEmojiGroups = useMemo(() =>
    Object.entries(guildEmojiMap)
      .filter(([, emojis]) => emojis.length > 0)
      .map(([guildId, emojis]) => {
        const guild = guilds?.find((g) => String(g.id) === guildId)
        return {
          guildId,
          guildName: guild?.name ?? guildId,
          guildIconUrl: guild?.icon?.url,
          emojis,
        }
      }),
  [guildEmojiMap, guilds])

  // Fetch guild data for suggestions — reuse cached queries from ServerLayout
  const { data: members } = useQuery({
    queryKey: ['members', serverId],
    queryFn: () =>
      guildApi.guildGuildIdMembersGet({ guildId: serverId! as unknown as number }).then((r) => r.data ?? []),
    enabled: !!serverId,
    staleTime: 30_000,
  })

  const { data: channels } = useQuery({
    queryKey: ['channels', serverId],
    queryFn: () =>
      guildApi.guildGuildIdChannelGet({ guildId: serverId! as unknown as number }).then((r) => r.data ?? []),
    enabled: !!serverId,
    staleTime: 30_000,
  })

  const { data: roles } = useQuery({
    queryKey: ['roles', serverId],
    queryFn: () =>
      rolesApi.guildGuildIdRolesGet({ guildId: serverId! as unknown as number }).then((r) => r.data ?? []),
    enabled: !!serverId,
    staleTime: 60_000,
  })

  const { data: commandIndex } = useQuery({
    queryKey: ['application-command-index', serverId],
    queryFn: () => applicationCommandsApi.guildCommandIndex(serverId!),
    enabled: slashQuery !== null && !!serverId && !disabled,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  })

  const visibleApplicationCommands = useMemo(() => {
    if (!serverId || !permissions.has(PermissionBits.USE_APPLICATION_COMMANDS)) return []
    return (commandIndex?.application_commands ?? []).filter((command) => (
      command.type === 1 &&
      commandGuildContextAllowed(command) &&
      commandAllowedByMemberPermissions(command, permissions.effectivePermissions, permissions.isOwner || permissions.isAdmin)
    ))
  }, [commandIndex?.application_commands, permissions, serverId])

  const slashSuggestions = useMemo(() => {
    if (slashQuery === null) return []
    const q = slashQuery.toLowerCase()
    const internalItems: SuggestionItem[] = SLASH_COMMAND_LIST
      .filter((cmd) => !q || cmd.name.startsWith(q))
      .map((cmd) => ({
        type: 'slash' as const,
        id: `internal:${cmd.name}`,
        display: `/${cmd.name}`,
        token: `/${cmd.name}`,
        name: cmd.name,
        description: cmd.description,
        section: 'internal' as const,
      }))
    const applicationItems: SuggestionItem[] = visibleApplicationCommands
      .flatMap((cmd) => flattenApplicationCommand(cmd).map((row) => ({
        type: 'slash' as const,
        id: `application:${String(cmd.id)}:${row.label}`,
        display: `/${row.label}`,
        token: `/${row.label}`,
        name: row.label,
        description: row.description,
        section: 'application' as const,
        applicationCommand: cmd,
        commandPath: row.path,
        optionPreview: row.options,
      })))
      .filter((item) => {
        if (!q) return true
        const haystack = `${item.name} ${item.description ?? ''} ${item.applicationCommand?.bot_name ?? ''}`.toLowerCase()
        return haystack.includes(q)
      })
    const maxApplicationItems = Math.max(0, maxSlashSuggestionRows - internalItems.length)
    return [...applicationItems.slice(0, maxApplicationItems), ...internalItems]
  }, [slashQuery, visibleApplicationCommands])

  const activeSuggestions = slashQuery === null ? suggestions : slashSuggestions
  const commandOptions = useMemo(
    () => commandOptionsForPath(selectedApplicationCommand, selectedCommandPath),
    [selectedApplicationCommand, selectedCommandPath],
  )
  const selectedCommandDisplay = selectedApplicationCommand
    ? commandPathText(selectedApplicationCommand, selectedCommandPath)
    : ''
  const activeCommandOption = commandOptions.find((option) => option.name === activeCommandOptionName) ?? commandOptions[0]
  const requiredCommandOptions = useMemo(
    () => commandOptions.filter((option) => option.required),
    [commandOptions],
  )
  const filledCommandOptionNames = useMemo(() => {
    const names = new Set<string>()
    for (const [name, value] of Object.entries(commandOptionDrafts)) {
      if (value.trim() !== '') names.add(name)
    }
    return names
  }, [commandOptionDrafts])
  const visibleOptionRows = useMemo(() => {
    const names = new Set<string>()
    const rows: ApplicationCommandOption[] = []
    for (const option of commandOptions) {
      if (option.required || filledCommandOptionNames.has(option.name) || option.name === activeCommandOption?.name) {
        if (!names.has(option.name)) {
          names.add(option.name)
          rows.push(option)
        }
      }
    }
    return rows
  }, [activeCommandOption?.name, commandOptions, filledCommandOptionNames])
  const hiddenOptionalOptions = useMemo(
    () => commandOptions.filter((option) => !option.required && !visibleOptionRows.some((row) => row.name === option.name)),
    [commandOptions, visibleOptionRows],
  )

  function canViewChannel(ch: DtoChannel): boolean {
    return permissions.canViewChannel(ch)
  }

  const allChannels = channels ?? []
  const categoryIds = new Set(
    allChannels.filter((c) => c.type === ChannelType.ChannelTypeGuildCategory).map((c) => String(c.id)),
  )
  const visibleCategoryIds = new Set(
    allChannels
      .filter((c) => c.type === ChannelType.ChannelTypeGuildCategory && canViewChannel(c))
      .map((c) => String(c.id)),
  )

  function isChannelVisible(ch: DtoChannel): boolean {
    if (!canViewChannel(ch)) return false
    const parentId = ch.parent_id ? String(ch.parent_id) : null
    if (parentId && categoryIds.has(parentId) && !visibleCategoryIds.has(parentId)) return false
    return true
  }

  const focusEditor = useCallback(() => {
    if (selectedApplicationCommand) {
      commandOptionInputRef.current?.focus()
      return
    }
    const el = editorRef.current
    if (!el || disabled) return

    el.focus()

    const selection = window.getSelection()
    if (!selection) return

    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
  }, [disabled, selectedApplicationCommand])

  function handleComposerMouseDown(e: MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    if (
      disabled ||
      target.closest('[contenteditable="true"], button, a, input, textarea, select, [role="button"]')
    ) {
      return
    }

    e.preventDefault()
    if (selectedApplicationCommand) {
      commandOptionInputRef.current?.focus()
    } else {
      focusEditor()
    }
  }

  const insertMentionAtEnd = useCallback((userId: string, name: string) => {
    const el = editorRef.current
    if (!el || disabled) return

    const span = document.createElement('span')
    span.contentEditable = 'false'
    span.dataset.token = `<@${userId}>`
    span.dataset.mention = 'true'
    span.dataset.type = 'user'
    span.className = 'mention-chip'
    span.textContent = `@${name}`

    const space = document.createTextNode('\u00A0')
    el.appendChild(span)
    el.appendChild(space)
    el.classList.remove('is-empty')

    el.focus()
    const range = document.createRange()
    range.setStart(space, 1)
    range.collapse(true)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
  }, [disabled])

  useImperativeHandle(ref, () => ({
    focusEditor,
    insertMentionAtEnd,
  }), [focusEditor, insertMentionAtEnd])

  // Close suggestions when clicking outside the entire component (editor + popup)
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setSuggestions([])
        setSlashQuery(null)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  // Initialize empty class on mount
  useEffect(() => {
    const el = editorRef.current
    if (el) {
      el.classList.add('is-empty')
    }
  }, [])

  useEffect(() => {
    if (selectedApplicationCommand) {
      commandOptionInputRef.current?.focus()
    } else {
      editorRef.current?.classList.add('is-empty')
    }
  }, [activeCommandOptionName, selectedApplicationCommand])

  function computeSuggestions(q: { trigger: '@' | '#' | ':'; query: string }) {
    const query = q.query.toLowerCase()

    if (q.trigger === ':') {
      // Emoji completion — require at least 1 char to avoid showing all emojis
      if (!query) {
        setSuggestions([])
        return
      }
      const customItems: SuggestionItem[] = customEmojiGroups
        .flatMap((g) => g.emojis.map((e) => ({ ...e, guildName: g.guildName })))
        .filter((e) => e.name.toLowerCase().includes(query))
        .sort((a, b) => {
          const as = a.name.toLowerCase().startsWith(query)
          const bs = b.name.toLowerCase().startsWith(query)
          if (as !== bs) return as ? -1 : 1
          return a.name.localeCompare(b.name)
        })
        .slice(0, 5)
        .map((e) => ({
          type: 'emoji' as const,
          id: e.id,
          display: `:${e.name}:`,
          token: `<:${e.name}:${e.id}>`,
          name: e.name,
          emojiId: e.id,
          serverName: e.guildName,
        }))
      const unicodeItems: SuggestionItem[] = allEmojis
        .filter((e) => e.slug.includes(query) || e.name.toLowerCase().includes(query))
        .sort((a, b) => {
          const as = a.slug.startsWith(query)
          const bs = b.slug.startsWith(query)
          if (as !== bs) return as ? -1 : 1
          return a.slug.localeCompare(b.slug)
        })
        .slice(0, 10 - customItems.length)
        .map((e) => ({
          type: 'emoji' as const,
          id: e.slug,
          display: e.emoji,
          token: e.emoji,
          name: e.slug,
          unicodeEmoji: e.emoji,
        }))
      const items = [...customItems, ...unicodeItems]
      setSuggestions(items)
      setActiveIdx(0)
      return
    }

    if (q.trigger === '#') {
      const items: SuggestionItem[] = allChannels
        .filter((c): c is typeof c & { name: string } => {
          if (!c.name) return false
          // exclude category channels and channels the user cannot see
          if (c.type === ChannelType.ChannelTypeGuildCategory) return false
          if (!isChannelVisible(c)) return false
          return !query || c.name.toLowerCase().includes(query)
        })
        .sort((a, b) => {
          const as = a.name.toLowerCase().startsWith(query)
          const bs = b.name.toLowerCase().startsWith(query)
          if (as !== bs) return as ? -1 : 1
          return a.name.localeCompare(b.name)
        })
        .slice(0, 10)
        .map((c) => ({
          type: 'channel' as const,
          id: String(c.id),
          display: `#${c.name}`,
          token: `<#${String(c.id)}>`,
          name: c.name,
        }))
      setSuggestions(items)
    } else {
      const specialItems: SuggestionItem[] = (
        [
          { id: 'everyone', name: 'everyone', display: '@everyone', token: '@everyone' },
          { id: 'here', name: 'here', display: '@here', token: '@here' },
        ] as const
      )
        .filter((s) => !query || s.name.startsWith(query))
        .map((s) => ({ type: 'special' as const, ...s }))

      const memberItems: SuggestionItem[] = (members ?? [])
        .filter((m) => {
          if (!m.user?.id) return false
          const name = (m.username ?? m.user.name ?? '').toLowerCase()
          return !query || name.includes(query)
        })
        .sort((a, b) => {
          const an = (a.username ?? a.user?.name ?? '').toLowerCase()
          const bn = (b.username ?? b.user?.name ?? '').toLowerCase()
          const as = an.startsWith(query)
          const bs = bn.startsWith(query)
          if (as !== bs) return as ? -1 : 1
          return an.localeCompare(bn)
        })
        .slice(0, 8)
        .map((m) => {
          const name = m.username ?? m.user?.name ?? 'Unknown'
          return {
            type: 'user' as const,
            id: String(m.user!.id),
            display: `@${name}`,
            token: `<@${String(m.user!.id)}>`,
            name,
          }
        })

      const roleItems: SuggestionItem[] = (roles ?? [])
        .filter((r) => {
          if (!r.name) return false
          return !query || r.name.toLowerCase().includes(query)
        })
        .sort((a, b) => {
          const an = (a.name ?? '').toLowerCase()
          const bn = (b.name ?? '').toLowerCase()
          const as = an.startsWith(query)
          const bs = bn.startsWith(query)
          if (as !== bs) return as ? -1 : 1
          return an.localeCompare(bn)
        })
        .slice(0, 5)
        .map((r) => ({
          type: 'role' as const,
          id: String(r.id),
          display: `@${r.name}`,
          token: `<@&${String(r.id)}>`,
          name: r.name!,
          color: r.color,
        }))

      setSuggestions([...specialItems, ...memberItems, ...roleItems].slice(0, 10))
    }
    setActiveIdx(0)
  }

  function clearEditor() {
    const el = editorRef.current
    if (!el) return
    while (el.firstChild) {
      el.removeChild(el.firstChild)
    }
    el.classList.add('is-empty')
  }

  function resetApplicationCommandMode() {
    setSelectedApplicationCommand(null)
    setSelectedCommandPath([])
    setCommandOptionDrafts({})
    setActiveCommandOptionName(null)
  }

  function startApplicationCommandMode(command: ApplicationCommand, path: CommandPath = []) {
    clearEditor()
    const options = commandOptionsForPath(command, path)
    const firstOption = options.find((option) => option.required) ?? options[0] ?? null
    setSelectedApplicationCommand(command)
    setSelectedCommandPath(path)
    setCommandOptionDrafts({})
    setActiveCommandOptionName(firstOption?.name ?? null)
    setSuggestions([])
    setSlashQuery(null)
  }

  function updateCommandOption(optionName: string, value: string) {
    setCommandOptionDrafts((drafts) => ({ ...drafts, [optionName]: value }))
  }

  function selectNextCommandOption(direction: 1 | -1 = 1) {
    if (commandOptions.length === 0) return
    const currentIndex = activeCommandOption
      ? commandOptions.findIndex((option) => option.name === activeCommandOption.name)
      : -1
    const nextIndex = currentIndex < 0
      ? 0
      : (currentIndex + direction + commandOptions.length) % commandOptions.length
    setActiveCommandOptionName(commandOptions[nextIndex]?.name ?? null)
  }

  function commandOptionsPayload(): InteractionOptionValue[] | null {
    const missing = requiredCommandOptions.find((option) => !commandOptionDrafts[option.name]?.trim())
    if (missing) {
      setActiveCommandOptionName(missing.name)
      return null
    }
    const payload: InteractionOptionValue[] = []
    for (const option of commandOptions) {
      const rawValue = commandOptionDrafts[option.name]
      if (!rawValue?.trim()) continue
      payload.push({
        name: option.name,
        type: option.type,
        value: coerceOptionValue(option, rawValue),
      })
    }
    return wrapCommandOptionsForPath(selectedCommandPath, payload)
  }

  function submitApplicationCommand() {
    if (!selectedApplicationCommand) return
    const options = commandOptionsPayload()
    if (!options) return
    onApplicationCommand?.(selectedApplicationCommand, options)
    resetApplicationCommandMode()
    clearEditor()
  }

  function handleCommandOptionKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      resetApplicationCommandMode()
      clearEditor()
      window.setTimeout(() => editorRef.current?.focus(), 0)
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      selectNextCommandOption(e.shiftKey ? -1 : 1)
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submitApplicationCommand()
    }
  }

  function selectSuggestion(item: SuggestionItem) {
    const el = editorRef.current
    if (!el) return
    el.focus()
    if (item.type === 'slash') {
      setSuggestions([])
      setSlashQuery(null)
      if (item.section === 'application' && item.applicationCommand) {
        startApplicationCommandMode(item.applicationCommand, item.commandPath ?? [])
        return
      }
      resetApplicationCommandMode()
      clearEditor()
      onSend(`/${item.name}`)
      return
    }
    if (item.type === 'emoji') {
      if (item.unicodeEmoji) {
        insertEmojiInEditor(item.unicodeEmoji)
      } else {
        insertCustomEmojiChip(item.name, item.emojiId!)
      }
    } else {
      insertChip(item)
    }
    setSuggestions([])
    // Re-evaluate empty state
    const isEmpty = !el.textContent?.trim() && !el.querySelector('[data-token]')
    el.classList.toggle('is-empty', isEmpty)
  }

  function handleInput() {
    if (disabled) return
    if (selectedApplicationCommand) return
    const el = editorRef.current
    if (!el) return

    // Check if editor is truly empty (no visible text and no emoji chips)
    const isEmpty = !el.textContent?.trim() && !el.querySelector('[data-token]')
    el.classList.toggle('is-empty', isEmpty)
    
    const slashQuery = getSlashQuery(el)
    if (slashQuery !== null) {
      setSlashQuery(slashQuery)
      setActiveIdx(0)
    } else {
      setSlashQuery(null)
      const q = getMentionQuery(el)
      if (q) {
        computeSuggestions(q)
      } else {
        setSuggestions([])
      }
    }
    onTyping()
  }

  function handleSend() {
    if (selectedApplicationCommand) {
      submitApplicationCommand()
      return
    }
    const el = editorRef.current
    if (!el) return
    const content = serialize(el).trim()
    if (!content && !hasAttachments) return
    onSend(content)
    while (el.firstChild) {
      el.removeChild(el.firstChild)
    }
    el.classList.add('is-empty')
    setSuggestions([])
    setSlashQuery(null)
    resetApplicationCommandMode()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (disabled) {
      e.preventDefault()
      return
    }

    // Suggestion navigation
    if (activeSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIdx((i) => Math.min(i + 1, activeSuggestions.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIdx((i) => Math.max(i - 1, 0))
        return
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault()
        const item = activeSuggestions[activeIdx]
        if (item) selectSuggestion(item)
        return
      }
      if (e.key === 'Escape') {
        setSuggestions([])
        return
      }
    }

    // Backspace: delete adjacent emoji/mention chip in one keystroke
    if (e.key === 'Backspace') {
      const sel = window.getSelection()
      if (sel?.rangeCount) {
        const range = sel.getRangeAt(0)
        if (range.collapsed) {
          const node = range.startContainer
          const offset = range.startOffset
          let chip: HTMLElement | null = null

          if (node.nodeType === Node.TEXT_NODE && offset === 0) {
            // Cursor at start of a text node — previous sibling may be a chip
            const prev = (node as Text).previousSibling
            if (prev instanceof HTMLElement && prev.dataset.token) chip = prev
          } else if (node.nodeType === Node.ELEMENT_NODE && offset > 0) {
            // Cursor inside the editor element itself — child at offset-1 may be a chip
            const prev = (node as HTMLElement).childNodes[offset - 1]
            if (prev instanceof HTMLElement && prev.dataset.token) chip = prev
          }

          if (chip) {
            e.preventDefault()
            chip.remove()
            const el2 = editorRef.current!
            const isEmpty = !el2.textContent?.trim() && !el2.querySelector('[data-token]')
            el2.classList.toggle('is-empty', isEmpty)
            return
          }
        }
      }
    }

    // Send on Enter (no shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
      return
    }

    // Shift+Enter → insert <br>
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault()
      document.execCommand('insertLineBreak')
      setSuggestions([])
      editorRef.current?.classList.remove('is-empty')
      return
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    if (disabled) {
      e.preventDefault()
      return
    }
    // Files in clipboard (e.g. a screenshot via Ctrl+V)
    if (e.clipboardData.files.length > 0) {
      e.preventDefault()
      onFileDrop?.(e.clipboardData.files)
      return
    }
    // Plain-text fallback — strip rich HTML
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    document.execCommand('insertText', false, text)
  }

  function insertEmojiInEditor(emoji: string) {
    if (disabled) return
    const el = editorRef.current
    if (!el) return
    el.focus()

    // Custom emoji token <:name:id> → insert as image chip
    const customMatch = emoji.match(/^<:([A-Za-z0-9-]+):(\d+)>$/)
    if (customMatch) {
      const name = customMatch[1]!
      const id = customMatch[2]!
      const token = emoji
      const span = document.createElement('span')
      span.contentEditable = 'false'
      span.dataset.token = token
      const img = document.createElement('img')
      img.src = emojiUrl(id, 44)
      img.alt = `:${name}:`
      img.title = `:${name}:`
      img.className = 'inline-block h-[1.375em] w-auto align-middle pointer-events-none select-none'
      span.appendChild(img)

      const sel = window.getSelection()
      if (sel?.rangeCount) {
        const range = sel.getRangeAt(0)
        range.deleteContents()
        range.insertNode(span)
        const afterNode = document.createTextNode('\u00A0')
        span.after(afterNode)
        range.setStart(afterNode, 1)
        range.collapse(true)
        sel.removeAllRanges()
        sel.addRange(range)
      } else {
        el.appendChild(span)
      }
      setSuggestions([])
      el.classList.remove('is-empty')
      return
    }

    // Unicode emoji → insert as plain text
    const sel = window.getSelection()
    if (sel?.rangeCount) {
      const range = sel.getRangeAt(0)
      range.deleteContents()
      const textNode = document.createTextNode(emoji)
      range.insertNode(textNode)
      range.setStartAfter(textNode)
      range.collapse(true)
      sel.removeAllRanges()
      sel.addRange(range)
    } else {
      el.appendChild(document.createTextNode(emoji))
    }
    setSuggestions([])
    el.classList.remove('is-empty')
  }

  // ── Drag-and-drop ────────────────────────────────────────────────────────

  function handleDragEnter(e: React.DragEvent) {
    if (disabled) return
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    dragCounterRef.current++
    setIsDragging(true)
  }

  function handleDragLeave() {
    if (disabled) return
    dragCounterRef.current--
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0
      setIsDragging(false)
    }
  }

  function handleDragOver(e: React.DragEvent) {
    if (disabled) return
    if (e.dataTransfer.types.includes('Files')) e.preventDefault()
  }

  function handleDrop(e: React.DragEvent) {
    if (disabled) return
    e.preventDefault()
    dragCounterRef.current = 0
    setIsDragging(false)
    if (e.dataTransfer.files.length > 0) {
      onFileDrop?.(e.dataTransfer.files)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      className="relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Suggestions popup — sits above the input */}
      {!disabled && activeSuggestions.length > 0 && (
        <div
          className={cn(
            'absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-md border border-white/[0.1] bg-popover shadow-lg',
            activeSuggestions[0]?.type === 'slash' && 'max-h-[420px] overflow-y-auto',
          )}
        >
          {activeSuggestions[0]?.type === 'slash' ? (
            <>
              {activeSuggestions.map((item, i) => {
                const previous = activeSuggestions[i - 1]
                const appKey = item.section === 'application'
                  ? String(item.applicationCommand?.application_id ?? item.applicationCommand?.id ?? item.id)
                  : 'internal'
                const previousAppKey = previous?.section === 'application'
                  ? String(previous.applicationCommand?.application_id ?? previous.applicationCommand?.id ?? previous.id)
                  : previous?.section
                const showSectionHeader = i === 0 || item.section !== previous?.section || appKey !== previousAppKey
                const appName = item.applicationCommand?.bot_name ?? t('chat.applicationCommands', 'Application commands')
                const previewOptions = item.optionPreview ?? []
                const requiredPreview = previewOptions.filter((option) => option.required)
                const shownOptions = (requiredPreview.length > 0 ? requiredPreview : previewOptions).slice(0, 3)
                const hiddenOptions = previewOptions.filter((option) => !shownOptions.some((shown) => shown.name === option.name))
                const hiddenOptionsAreOptional = hiddenOptions.length > 0 && hiddenOptions.every((option) => !option.required)
                const optionPreviewVisible = i === activeIdx

                return (
                  <Fragment key={`${item.type}-${item.id}`}>
                    {showSectionHeader && (
                      <div className={cn('flex items-center gap-3 px-4 pb-1 pt-3', i > 0 && 'border-t border-border/70')}>
                        {item.section === 'application' ? (
                          <Avatar className="h-5 w-5 rounded-md">
                            <AvatarImage
                              src={item.applicationCommand?.application_icon ?? undefined}
                              alt={appName}
                              className="object-cover"
                            />
                            <AvatarFallback className="rounded-md text-[10px]">
                              {fallbackInitial(appName)}
                            </AvatarFallback>
                          </Avatar>
                        ) : (
                          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted text-xs font-bold text-muted-foreground">
                            /
                          </div>
                        )}
                        <span className="min-w-0 truncate text-xs font-semibold text-muted-foreground">
                          {item.section === 'application'
                            ? appName
                            : t('chat.internalCommands', 'Built-in commands')}
                        </span>
                      </div>
                    )}
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        // prevent blur before click registers
                        e.preventDefault()
                        selectSuggestion(item)
                      }}
                      className={cn(
                        'group/command flex w-full items-start gap-3 px-4 py-2 text-left text-sm transition-colors',
                        i === activeIdx ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent/50',
                      )}
                    >
                      <div className="w-5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="shrink-0 font-semibold">/{item.name}</span>
                          {previewOptions.length > 0 && (
                            <div
                              className={cn(
                                'flex min-w-0 items-center gap-1 overflow-hidden opacity-0 transition-opacity group-hover/command:opacity-100',
                                optionPreviewVisible && 'opacity-100',
                              )}
                            >
                              {shownOptions.map((option) => (
                                <span
                                  key={option.name}
                                  className="max-w-28 shrink-0 truncate rounded bg-black/45 px-1.5 py-0.5 text-[11px] font-medium text-foreground"
                                >
                                  {commandOptionPreviewLabel(option)}
                                </span>
                              ))}
                              {hiddenOptions.length > 0 && (
                                <span className="shrink-0 border-l border-border pl-2 text-xs text-muted-foreground">
                                  +{hiddenOptions.length} {hiddenOptionsAreOptional ? 'optional' : 'more'}
                                </span>
                              )}
                            </div>
                          )}
                          {item.section === 'application' && appName && (
                            <span className="ml-auto hidden shrink-0 text-xs text-muted-foreground sm:inline">
                              {appName}
                            </span>
                          )}
                        </div>
                        {item.description && (
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {item.description}
                          </p>
                        )}
                      </div>
                    </button>
                  </Fragment>
                )
              })}
            </>
          ) : (
            <>
              <div className="border-b border-border px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {activeSuggestions[0]?.type === 'channel'
                  ? t('chat.channels')
                  : activeSuggestions[0]?.type === 'emoji'
                    ? 'Emoji'
                    : t('chat.membersAndRoles')}
              </div>
              {activeSuggestions.map((item, i) => (
                <button
                  key={`${item.type}-${item.id}`}
                  type="button"
                  onMouseDown={(e) => {
                    // prevent blur before click registers
                    e.preventDefault()
                    selectSuggestion(item)
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-sm transition-colors ${i === activeIdx
                    ? 'bg-accent text-accent-foreground'
                    : 'text-foreground hover:bg-accent/50'
                    }`}
                >
                  {item.type === 'emoji' && item.emojiId && (
                    <img
                      src={emojiUrl(item.emojiId, 44)}
                      alt={item.name}
                      className="w-6 h-6 shrink-0 object-contain"
                    />
                  )}
                  {item.type === 'emoji' && item.unicodeEmoji && (
                    <span className="w-6 h-6 shrink-0 flex items-center justify-center text-xl leading-none">{item.unicodeEmoji}</span>
                  )}
                  {item.type === 'channel' && (
                    <Hash className="w-4 h-4 shrink-0 text-muted-foreground" />
                  )}
                  {item.type === 'special' && (
                    <div className="w-6 h-6 rounded-full bg-muted shrink-0 flex items-center justify-center text-[11px] font-semibold text-muted-foreground">
                      @
                    </div>
                  )}
                  {item.type === 'user' && (
                    <div className="w-6 h-6 rounded-full bg-muted shrink-0 flex items-center justify-center text-[11px] font-semibold">
                      {item.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  {item.type === 'role' && (
                    <Shield
                      className="w-4 h-4 shrink-0"
                      style={{ color: roleColor(item.color) ?? 'var(--muted-foreground)' }}
                    />
                  )}
                  <span className="font-medium truncate">{item.name}</span>
                  {item.type === 'emoji' && item.serverName && (
                    <span className="ml-auto text-xs text-muted-foreground shrink-0 pl-2 truncate max-w-[120px]">{item.serverName}</span>
                  )}
                  {item.type === 'role' && (
                    <span className="ml-auto text-xs text-muted-foreground shrink-0">{t('chat.role')}</span>
                  )}
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {/* ── Input box ──────────────────────────────────────────────────────── */}
      <div
        className={cn(
          'cursor-text rounded-xl border border-white/[0.1] bg-white/[0.035] shadow-none transition-[color,box-shadow] focus-within:border-white/[0.16] focus-within:ring-[3px] focus-within:ring-white/[0.04]',
          isDragging && 'border-primary ring-[3px] ring-primary/50',
        )}
        onMouseDown={handleComposerMouseDown}
      >
        {topBar}

        {/* Attachment preview bar — rendered above the text row when present */}
        {attachmentBar && (
          <div className="px-2 pt-2">
            {attachmentBar}
          </div>
        )}

        {selectedApplicationCommand && activeCommandOption && (
          <div className="flex items-center gap-2 border-b border-border/70 px-4 py-2 text-xs">
            <span className="font-semibold text-foreground">{activeCommandOption.name}</span>
            <span className="min-w-0 truncate text-muted-foreground">{activeCommandOption.description}</span>
          </div>
        )}

        {/* Drag-over overlay label */}
        {isDragging && (
          <div className="px-3 py-2 text-sm text-primary font-medium text-center select-none pointer-events-none">
            {t('chat.dropFiles')}
          </div>
        )}

        {/* Text editor row */}
        <div className="flex items-end gap-2 px-4 py-3">
          {/* Paperclip button */}
          {onAttachClick && (
            <button
              type="button"
              onClick={onAttachClick}
              aria-label="Attach file"
              disabled={disabled}
              className="mb-0.5 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
            >
              <Paperclip className="h-5 w-5" />
            </button>
          )}

          {selectedApplicationCommand ? (
            <div className="flex min-h-[28px] min-w-0 flex-1 flex-wrap items-center gap-1.5 text-sm">
              {!activeCommandOption && (
                <input
                  ref={commandOptionInputRef}
                  readOnly
                  aria-label={`/${selectedCommandDisplay}`}
                  onKeyDown={handleCommandOptionKeyDown}
                  className="sr-only"
                />
              )}
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
                <Bot className="h-4 w-4" />
              </div>
              <span className="shrink-0 font-semibold text-foreground">/{selectedCommandDisplay}</span>
              {visibleOptionRows.map((option) => {
                const value = commandOptionDrafts[option.name] ?? ''
                const isActive = option.name === activeCommandOption?.name
                return (
                  <div
                    key={option.name}
                    className={cn(
                      'flex min-h-7 max-w-full items-center overflow-hidden rounded border bg-background/50 text-sm',
                      isActive ? 'border-sky-500 ring-1 ring-sky-500/60' : 'border-border',
                    )}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      setActiveCommandOptionName(option.name)
                      window.setTimeout(() => commandOptionInputRef.current?.focus(), 0)
                    }}
                  >
                    <button
                      type="button"
                      className="h-7 shrink-0 px-2 font-medium text-foreground"
                      onClick={() => setActiveCommandOptionName(option.name)}
                    >
                      {option.name}
                    </button>
                    {(isActive || value) && (
                      <input
                        ref={isActive ? commandOptionInputRef : undefined}
                        value={value}
                        onChange={(e) => updateCommandOption(option.name, e.target.value)}
                        onKeyDown={handleCommandOptionKeyDown}
                        placeholder={optionPlaceholder(option)}
                        className="h-7 min-w-[72px] flex-1 bg-muted/50 px-2 outline-none placeholder:text-muted-foreground"
                      />
                    )}
                  </div>
                )
              })}
              {hiddenOptionalOptions.length > 0 && (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setActiveCommandOptionName(hiddenOptionalOptions[0]?.name ?? null)}
                  className="h-7 shrink-0 rounded border border-border px-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  +{hiddenOptionalOptions.length} more
                </button>
              )}
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  resetApplicationCommandMode()
                  clearEditor()
                  window.setTimeout(() => editorRef.current?.focus(), 0)
                }}
                aria-label="Cancel command"
                className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div
              ref={editorRef}
              contentEditable={!disabled}
              suppressContentEditableWarning
              onInput={handleInput}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              aria-disabled={disabled}
              data-placeholder={t('chat.messagePlaceholder', { name: channelName ?? channelId })}
              className={cn(
                'mention-editor flex-1 min-h-[28px] max-h-48 overflow-y-auto outline-none text-sm text-foreground leading-6 break-words',
                disabled && 'cursor-not-allowed text-muted-foreground',
              )}
            />
          )}

          {/* GIF picker */}
          <button
            type="button"
            aria-label="Open GIF picker"
            disabled={disabled}
            onClick={() => gifOpen ? setGifOpen(false) : openPicker('gif')}
            className={cn(
              'mb-0.5 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-xl transition-colors',
              gifOpen ? 'bg-white/[0.06] text-foreground' : 'text-muted-foreground hover:bg-white/[0.06] hover:text-foreground',
            )}
          >
            <ImagePlay className="h-5 w-5" />
          </button>
          {gifOpen && createPortal(
            <>
              <div className="fixed inset-0 z-[99]" onClick={() => setGifOpen(false)} />
              <div
                className={cn('fixed z-[100] px-2 pb-2', isMobile && 'left-0 right-0')}
                style={{ bottom: pickerBottom, ...(isMobile ? {} : { right: pickerRight }) }}
              >
                <GifPicker onSelect={(url) => { onSend(url); setGifOpen(false) }} isMobile={isMobile} />
              </div>
            </>,
            document.body,
          )}

          {/* Emoji picker */}
          <button
            type="button"
            aria-label="Open emoji picker"
            disabled={disabled}
            onClick={() => emojiOpen ? setEmojiOpen(false) : openPicker('emoji')}
            className={cn(
              'mb-0.5 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-xl transition-colors',
              emojiOpen ? 'bg-white/[0.06] text-foreground' : 'text-muted-foreground hover:bg-white/[0.06] hover:text-foreground',
            )}
          >
            <Smile className="h-5 w-5" />
          </button>
          {emojiOpen && createPortal(
            <>
              <div className="fixed inset-0 z-[99]" onClick={() => setEmojiOpen(false)} />
              <div
                className={cn('fixed z-[100] px-2 pb-2', isMobile && 'left-0 right-0')}
                style={{ bottom: pickerBottom, ...(isMobile ? {} : { right: pickerRight }) }}
              >
                <EmojiPicker
                  onSelect={(e) => { insertEmojiInEditor(e); if (isMobile) setEmojiOpen(false) }}
                  customEmojiGroups={customEmojiGroups}
                  isMobile={isMobile}
                />
              </div>
            </>,
            document.body,
          )}

          {/* Send button — mobile only */}
          {isMobile && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleSend}
              disabled={disabled}
              aria-label={t('chat.send')}
              className="mb-0.5 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-white/[0.08] text-foreground transition-colors hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <SendHorizontal className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
})

MentionInput.displayName = 'MentionInput'

export default MentionInput
