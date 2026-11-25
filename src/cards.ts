/**
 * Cloud role cards of the 天问星 website: the typed card model, the HTTP
 * client that mirrors website cards into a local JSON cache, and the helpers
 * that turn a card into a simulation stage. The cache is a plain file next to
 * the installed package (or under `roleCardCacheDir`), so cards keep working
 * when the cloud is unreachable.
 * @module dsh-tianwen-star/cards
 */

import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { counterpartSchema, scenarioSchema } from './model.js'
import type { Counterpart, Scenario } from './model.js'
import { TianwenError } from './llm.js'

/** Default base URL of the 天问星 role-card API. */
export const DEFAULT_API_BASE = 'https://tianwenxing.yuban.site'

/** Environment variable that overrides the API base URL. */
export const API_BASE_ENV = 'TIANWENSTAR_API_BASE'
/** Environment variable that provides the API token. */
export const API_TOKEN_ENV = 'TIANWENSTAR_API_TOKEN'
/** Environment variable that overrides the cache directory. */
export const CACHE_DIR_ENV = 'TIANWENSTAR_CACHE_DIR'

/** Filename of the local role-card cache inside its directory. */
export const CARD_CACHE_FILENAME = 'role-cards.json'

/** Version of the local cache file format; another version reads as empty. */
export const CARD_CACHE_VERSION = 1

/** Hard deadline of one role-card HTTP request in milliseconds. */
export const REQUEST_TIMEOUT_MS = 30_000

/** One role card as served by the website and stored in the local cache. */
export const roleCardSchema = z.object({
  /** Stable id on the website. */
  id: z.string().min(1),
  /** Display name used to reference the card in conversation. */
  name: z.string().min(1),
  /** Scenario kind the card belongs to. */
  scenario: scenarioSchema,
  /** The simulated counterpart, used verbatim as the stage persona. */
  counterpart: counterpartSchema,
  /** Planned stage duration in minutes; null when the card carries none. */
  timeLimitMinutes: z.number().positive().nullable().catch(null),
  /** Whether the card is publicly listed on the website. */
  public: z.boolean().catch(false),
  /** Website update timestamp, shown to the user only. */
  updated_at: z.string().catch(''),
})
/** One role card. */
export type RoleCard = z.infer<typeof roleCardSchema>

const listPayloadSchema = z.object({ cards: z.array(z.unknown()) })
const cardPayloadSchema = z.object({ card: roleCardSchema })
const cacheFileSchema = z.object({ version: z.literal(CARD_CACHE_VERSION), cards: z.array(z.unknown()) })

/** Authenticated endpoint of the role-card API; fetch is injectable for tests. */
export interface RoleCardEndpoint {
  /** Base URL without a trailing slash, such as the default {@link DEFAULT_API_BASE}. */
  readonly base: string
  /** Bearer token from the website; undefined when not configured. */
  readonly token?: string
  /** HTTP implementation; defaults to global fetch. */
  readonly fetch?: typeof fetch
}

/** Everything needed to upload one card: `id` present means update. */
export interface RoleCardUpload {
  /** Existing card id to update; omit to create. */
  readonly id?: string
  readonly name: string
  readonly scenario: Scenario
  readonly counterpart: Counterpart
  readonly timeLimitMinutes?: number
  readonly public?: boolean
}

/** The parts of a stage a card determines. */
export interface StagePartsFromCard {
  /** Stage display name, taken from the card. */
  readonly name: string
  /** Planned duration; null when the card carries none. */
  readonly timeLimitMinutes: number | null
  /** Counterpart persona, used verbatim. */
  readonly counterpart: Counterpart
}

function cloudError(message: string, code: 'TIANWEN_CLOUD_AUTH' | 'TIANWEN_CLOUD_UNAVAILABLE', options?: ErrorOptions): TianwenError {
  return new TianwenError(message, code, options)
}

/**
 * Resolve the API base URL: configuration first, then the environment, then
 * the default; trailing slashes are removed.
 * @param configured - value of the `roleCardApiBase` config field.
 * @param env - environment variables.
 * @returns the base URL without a trailing slash.
 */
export function resolveApiBase(configured: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
  const value = (configured?.trim() || env[API_BASE_ENV]?.trim() || '').replace(/\/+$/, '')
  return value || DEFAULT_API_BASE
}

/**
 * Resolve the API token: configuration first, then the environment.
 * @param configured - value of the `roleCardToken` config field.
 * @param env - environment variables.
 * @returns the token, or undefined when neither source has one.
 */
export function resolveToken(configured: string | undefined, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return configured?.trim() || env[API_TOKEN_ENV]?.trim() || undefined
}

/**
 * Resolve the cache file path: configuration first, then the environment,
 * then the installed package directory.
 * @param configuredDir - value of the `roleCardCacheDir` config field.
 * @param env - environment variables.
 * @returns absolute path of the cache JSON file.
 */
export function resolveCachePath(configuredDir: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
  const dir = configuredDir?.trim() || env[CACHE_DIR_ENV]?.trim() || packageCacheDir()
  return join(dir, CARD_CACHE_FILENAME)
}

/** Directory of the installed package, derived from this module's location. */
export function packageCacheDir(): string {
  return fileURLToPath(new URL('..', import.meta.url))
}

function requireToken(endpoint: RoleCardEndpoint): string {
  if (endpoint.token === undefined || endpoint.token === '') {
    throw cloudError('未配置天问星 API token：请在官网 https://tianwenxing.yuban.site 注册并创建 token，'
      + '然后配置到 tianwen-coach 的 roleCardToken，或环境变量 TIANWENSTAR_API_TOKEN。', 'TIANWEN_CLOUD_AUTH')
  }
  return endpoint.token
}

async function request(endpoint: RoleCardEndpoint, method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
  const doFetch = endpoint.fetch ?? fetch
  const headers: Record<string, string> = { accept: 'application/json' }
  const token = endpoint.token
  if (token !== undefined && token !== '') headers.authorization = `Bearer ${token}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  let response: Response
  try {
    response = await doFetch(`${endpoint.base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error)
    throw cloudError(`天问星角色卡服务不可达（${endpoint.base}${path}）：${reason}。`
      + '本地缓存的角色卡仍然可用，稍后再试同步。', 'TIANWEN_CLOUD_UNAVAILABLE', { cause: error })
  }
  if (response.status === 401 || response.status === 403) {
    throw cloudError('天问星角色卡 token 无效或没有权限：请在官网 https://tianwenxing.yuban.site 检查 token，'
      + '并确认配置到 tianwen-coach 的 roleCardToken 或环境变量 TIANWENSTAR_API_TOKEN。', 'TIANWEN_CLOUD_AUTH')
  }
  if (!response.ok) {
    throw cloudError(`天问星角色卡服务返回 ${response.status}（${method} ${path}）。`
      + '本地缓存的角色卡仍然可用，稍后再试。', 'TIANWEN_CLOUD_UNAVAILABLE')
  }
  try {
    return await response.json()
  } catch (error: unknown) {
    throw cloudError(`天问星角色卡服务返回的不是 JSON（${method} ${path}）。`, 'TIANWEN_CLOUD_UNAVAILABLE', { cause: error })
  }
}

/**
 * Validate the cards array of a cloud payload, skipping invalid entries.
 * @param entries - raw card objects from the payload.
 * @returns the valid cards and how many entries were skipped.
 */
export function parseRoleCards(entries: readonly unknown[]): { cards: RoleCard[]; invalid: number } {
  const cards: RoleCard[] = []
  let invalid = 0
  for (const entry of entries) {
    const parsed = roleCardSchema.safeParse(entry)
    if (parsed.success) cards.push(parsed.data)
    else invalid += 1
  }
  return { cards, invalid }
}

/**
 * Fetch the token holder's cards and replace the local cache with them.
 * @param endpoint - API endpoint with token.
 * @param cacheFile - path of the local cache file.
 * @returns the synced cards and how many cloud entries were skipped as invalid.
 */
export async function syncRoleCards(endpoint: RoleCardEndpoint, cacheFile: string): Promise<{ cards: RoleCard[]; invalid: number }> {
  requireToken(endpoint)
  const payload = listPayloadSchema.safeParse(await request(endpoint, 'GET', '/api/v1/role-cards'))
  if (!payload.success) {
    throw cloudError('天问星角色卡服务返回了无法解析的列表数据。', 'TIANWEN_CLOUD_UNAVAILABLE')
  }
  const { cards, invalid } = parseRoleCards(payload.data.cards)
  await writeCardCache(cards, cacheFile)
  return { cards, invalid }
}

/**
 * Create or update one card on the website.
 * @param endpoint - API endpoint with token.
 * @param input - card fields; `id` present updates that card.
 * @returns the card as stored by the website.
 */
export async function pushRemoteCard(endpoint: RoleCardEndpoint, input: RoleCardUpload): Promise<RoleCard> {
  requireToken(endpoint)
  const payload = uploadPayload(input)
  const parsed = cardPayloadSchema.safeParse(await request(endpoint, 'POST', '/api/v1/role-cards', payload))
  if (!parsed.success) {
    throw cloudError('天问星角色卡服务返回了无法解析的卡片数据。', 'TIANWEN_CLOUD_UNAVAILABLE')
  }
  return parsed.data.card
}

/**
 * Assemble the POST body of one card upload.
 * @param input - card fields; `id` present means update.
 * @returns the JSON-serializable body.
 */
export function uploadPayload(input: RoleCardUpload): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: input.name,
    scenario: input.scenario,
    counterpart: { ...input.counterpart },
  }
  if (input.id !== undefined) payload.id = input.id
  if (input.timeLimitMinutes !== undefined) payload.timeLimitMinutes = input.timeLimitMinutes
  if (input.public !== undefined) payload.public = input.public
  return payload
}

/**
 * Read the local cache; a missing or unreadable file reads as empty so the
 * coach keeps working.
 * @param cacheFile - path of the cache file.
 * @returns the cached cards.
 */
export async function readCardCache(cacheFile: string): Promise<RoleCard[]> {
  let text: string
  try {
    text = await readFile(cacheFile, 'utf8')
  } catch (_error: unknown) {
    return []
  }
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (_error: unknown) {
    return []
  }
  const parsed = cacheFileSchema.safeParse(data)
  if (!parsed.success) return []
  return parseRoleCards(parsed.data.cards).cards
}

/**
 * Replace the local cache with the given cards, writing atomically.
 * @param cards - cards to store.
 * @param cacheFile - path of the cache file.
 */
export async function writeCardCache(cards: readonly RoleCard[], cacheFile: string): Promise<void> {
  const payload = `${JSON.stringify({ version: CARD_CACHE_VERSION, cards }, null, 2)}\n`
  const temporary = `${cacheFile}.tmp`
  await writeFile(temporary, payload, 'utf8')
  await rename(temporary, cacheFile)
}

/**
 * Insert or replace one card in a cached list, keyed by id.
 * @param cards - current cache contents.
 * @param card - card to upsert.
 * @returns the new cache contents.
 */
export function upsertCard(cards: readonly RoleCard[], card: RoleCard): RoleCard[] {
  const at = cards.findIndex(item => item.id === card.id)
  if (at < 0) return [...cards, card]
  const next = [...cards]
  next[at] = card
  return next
}

/**
 * Find a cached card by name (exact, then case-insensitive, then prefix) or id.
 * @param cards - cached cards.
 * @param query - card name or id as the user said it.
 * @returns the first matching card, or undefined.
 */
export function findCardByName(cards: readonly RoleCard[], query: string): RoleCard | undefined {
  const key = query.trim().toLowerCase()
  if (key === '') return undefined
  return cards.find(card => card.name.toLowerCase() === key)
    ?? cards.find(card => card.id.toLowerCase() === key)
    ?? cards.find(card => card.name.toLowerCase().startsWith(key))
}

/**
 * Map a card onto the parts of a simulation stage it determines.
 * @param card - validated card.
 * @returns stage name, planned duration (null when the card carries none), and the persona.
 */
export function stagePartsFromCard(card: RoleCard): StagePartsFromCard {
  return { name: card.name, timeLimitMinutes: card.timeLimitMinutes, counterpart: card.counterpart }
}

/** One-line summary of a card for coach-facing tool output. */
export function cardSummary(card: RoleCard): string {
  const scenario = card.scenario === 'interview' ? '面试' : '商务'
  const limit = card.timeLimitMinutes === null ? '时限未定' : `${card.timeLimitMinutes} 分钟`
  const updated = card.updated_at === '' ? '' : ` · 更新于 ${card.updated_at}`
  return `- ${card.name}（${scenario} · ${card.counterpart.name}，${card.counterpart.title} · ${limit} · ${card.public ? '公开' : '私有'}${updated}）id=${card.id}`
}
