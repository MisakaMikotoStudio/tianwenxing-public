import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CARD_CACHE_VERSION,
  DEFAULT_API_BASE,
  findCardByName,
  parseRoleCards,
  pushRemoteCard,
  readCardCache,
  resolveApiBase,
  resolveCachePath,
  resolveToken,
  stagePartsFromCard,
  syncRoleCards,
  upsertCard,
  uploadPayload,
  writeCardCache,
} from '../src/cards.js'
import type { RoleCard, RoleCardEndpoint } from '../src/cards.js'
import { TianwenError } from '../src/llm.js'
import type { Counterpart } from '../src/model.js'

const counterpart: Counterpart = {
  name: '王磊', title: '技术经理', organization: 'A 公司', personality: '严谨', priorities: '深度', hiddenConcerns: '讨厌空话', speakingStyle: '简洁',
}

function card(overrides: Partial<RoleCard> = {}): RoleCard {
  return {
    id: 'card-1', name: '王磊一面', scenario: 'interview', counterpart,
    timeLimitMinutes: 45, public: false, updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function fakeFetch(handler: (url: string, init: RequestInit) => Response): { fetch: typeof fetch; calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = []
  const impl: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const requestInit: RequestInit = init ?? {}
    calls.push({ url, init: requestInit })
    return Promise.resolve(handler(url, requestInit))
  }
  return { fetch: impl, calls }
}

function endpointWith(overrides: Partial<RoleCardEndpoint>, handler?: (url: string, init: RequestInit) => Response): RoleCardEndpoint & { calls: { url: string; init: RequestInit }[] } {
  const mock = fakeFetch(handler ?? (() => jsonResponse(200, { cards: [] })))
  return { base: DEFAULT_API_BASE, token: 'tok', ...overrides, fetch: mock.fetch, calls: mock.calls }
}

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tianwen-cards-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('cloud sync', () => {
  it('fetches the list with the bearer token and replaces the local cache', async () => {
    const cacheFile = join(dir, 'role-cards.json')
    await writeCardCache([card({ id: 'stale', name: '旧卡' })], cacheFile)
    const remote = endpointWith({}, () => jsonResponse(200, { cards: [card(), card({ id: 'card-2', name: '李总', scenario: 'business' })] }))
    const { cards, invalid } = await syncRoleCards(remote, cacheFile)
    expect(invalid).toBe(0)
    expect(cards.map(item => item.id)).toEqual(['card-1', 'card-2'])
    expect(remote.calls).toHaveLength(1)
    expect(remote.calls[0]?.url).toBe(`${DEFAULT_API_BASE}/api/v1/role-cards`)
    expect(remote.calls[0]?.init.method).toBe('GET')
    expect(remote.calls[0]?.init.headers).toMatchObject({ authorization: 'Bearer tok' })
    expect(await readCardCache(cacheFile)).toEqual(cards)
  })

  it('refuses to sync without a token and never calls the network', async () => {
    const endpoint = endpointWith({ token: undefined }, () => {
      throw new Error('network must not be reached')
    })
    await expect(syncRoleCards(endpoint, join(dir, 'role-cards.json'))).rejects.toMatchObject({ code: 'TIANWEN_CLOUD_AUTH' })
    expect(endpoint.calls).toHaveLength(0)
  })

  it('keeps the local cache intact on a 401 and reports an auth error', async () => {
    const cacheFile = join(dir, 'role-cards.json')
    await writeCardCache([card()], cacheFile)
    const endpoint = endpointWith({}, () => jsonResponse(401, { message: 'unauthorized' }))
    const error = await syncRoleCards(endpoint, cacheFile).catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(TianwenError)
    expect((error as TianwenError).code).toBe('TIANWEN_CLOUD_AUTH')
    expect(await readCardCache(cacheFile)).toEqual([card()])
  })

  it('degrades to the cache when the cloud is unreachable', async () => {
    const cacheFile = join(dir, 'role-cards.json')
    await writeCardCache([card()], cacheFile)
    const endpoint = endpointWith({ base: 'https://cloud.invalid' }, () => {
      throw new TypeError('fetch failed')
    })
    await expect(syncRoleCards(endpoint, cacheFile)).rejects.toMatchObject({ code: 'TIANWEN_CLOUD_UNAVAILABLE' })
    expect(await readCardCache(cacheFile)).toEqual([card()])
  })
})

describe('card parsing and cache', () => {
  it('parses valid cards, skips invalid ones, and defaults optional fields', () => {
    const { cards, invalid } = parseRoleCards([
      card(),
      { id: 'x', name: '坏场景', scenario: 'chat', counterpart },
      { id: 'y', name: '', scenario: 'business', counterpart },
      card({ id: 'card-3', name: '无时限', timeLimitMinutes: null, public: undefined, updated_at: undefined }),
    ])
    expect(cards.map(item => item.id)).toEqual(['card-1', 'card-3'])
    expect(cards[1]).toMatchObject({ timeLimitMinutes: null, public: false, updated_at: '' })
    expect(invalid).toBe(2)
  })

  it('reads a missing or corrupt cache as empty', async () => {
    expect(await readCardCache(join(dir, 'absent.json'))).toEqual([])
    const corrupt = join(dir, 'corrupt.json')
    await writeFile(corrupt, '{not json', 'utf8')
    expect(await readCardCache(corrupt)).toEqual([])
  })

  it('round-trips the cache file and upserts by id', async () => {
    const cacheFile = join(dir, 'role-cards.json')
    await writeCardCache([card()], cacheFile)
    expect(JSON.parse(await readFile(cacheFile, 'utf8'))).toMatchObject({ version: CARD_CACHE_VERSION })
    expect(upsertCard([card()], card({ name: '改名' }))).toEqual([card({ name: '改名' })])
    expect(upsertCard([card()], card({ id: 'card-9', name: '新卡' }))).toHaveLength(2)
    expect(await readCardCache(cacheFile)).toEqual([card()])
  })
})

describe('lookup and stage mapping', () => {
  const cards = [card(), card({ id: 'card-2', name: '李总（采购总监）', scenario: 'business', timeLimitMinutes: null })]

  it('finds cards by exact name, case-insensitive name, id, and name prefix', () => {
    expect(findCardByName(cards, ' 王磊一面 ')?.id).toBe('card-1')
    expect(findCardByName(cards, '王磊一面'.toUpperCase())?.id).toBe('card-1')
    expect(findCardByName(cards, 'CARD-2')?.id).toBe('card-2')
    expect(findCardByName(cards, '李总')?.id).toBe('card-2')
    expect(findCardByName(cards, '不存在')).toBeUndefined()
    expect(findCardByName(cards, '  ')).toBeUndefined()
  })

  it('maps a card onto the stage parts it determines', () => {
    expect(stagePartsFromCard(cards[0]!)).toEqual({
      name: '王磊一面', timeLimitMinutes: 45, counterpart,
    })
    const parts = stagePartsFromCard(cards[1]!)
    expect(parts.name).toBe('李总（采购总监）')
    expect(parts.timeLimitMinutes).toBeNull()
    expect(parts.counterpart).toEqual(counterpart)
  })
})

describe('upload payload', () => {
  it('assembles create and update bodies with only the given fields', () => {
    expect(uploadPayload({ name: '王磊一面', scenario: 'interview', counterpart })).toEqual({
      name: '王磊一面', scenario: 'interview', counterpart,
    })
    expect(uploadPayload({
      id: 'card-1', name: '王磊一面', scenario: 'interview', counterpart, timeLimitMinutes: 45, public: true,
    })).toEqual({
      id: 'card-1', name: '王磊一面', scenario: 'interview', counterpart: { ...counterpart }, timeLimitMinutes: 45, public: true,
    })
  })

  it('posts the payload with the bearer token and parses the returned card', async () => {
    const endpoint = endpointWith({}, (url, init) => {
      expect(url).toBe(`${DEFAULT_API_BASE}/api/v1/role-cards`)
      expect(init.method).toBe('POST')
      expect(init.headers).toMatchObject({ authorization: 'Bearer tok', 'content-type': 'application/json' })
      return jsonResponse(200, { card: card() })
    })
    const uploaded = await pushRemoteCard(endpoint, { name: '王磊一面', scenario: 'interview', counterpart, timeLimitMinutes: 45 })
    expect(uploaded.id).toBe('card-1')
    const body = JSON.parse(String(endpoint.calls[0]?.init.body)) as Record<string, unknown>
    expect(body).toMatchObject({ name: '王磊一面', scenario: 'interview', counterpart })
  })

  it('reports auth and unavailable errors like the sync path', async () => {
    const noToken = endpointWith({ token: undefined }, () => jsonResponse(200, { card: card() }))
    await expect(pushRemoteCard(noToken, { name: 'x', scenario: 'interview', counterpart })).rejects.toMatchObject({ code: 'TIANWEN_CLOUD_AUTH' })
    const broken = endpointWith({}, () => jsonResponse(200, { unexpected: true }))
    await expect(pushRemoteCard(broken, { name: 'x', scenario: 'interview', counterpart })).rejects.toMatchObject({ code: 'TIANWEN_CLOUD_UNAVAILABLE' })
    const httpError = endpointWith({}, () => jsonResponse(500, {}))
    await expect(pushRemoteCard(httpError, { name: 'x', scenario: 'interview', counterpart })).rejects.toMatchObject({ code: 'TIANWEN_CLOUD_UNAVAILABLE' })
  })
})

describe('configuration resolution', () => {
  it('resolves api base and token from config, env, and defaults', () => {
    expect(resolveApiBase(undefined, {})).toBe(DEFAULT_API_BASE)
    expect(resolveApiBase(undefined, { TIANWENSTAR_API_BASE: 'https://env.example/' })).toBe('https://env.example')
    expect(resolveApiBase('https://cfg.example', { TIANWENSTAR_API_BASE: 'https://env.example' })).toBe('https://cfg.example')
    expect(resolveApiBase('  ', { TIANWENSTAR_API_BASE: 'https://env.example' })).toBe('https://env.example')
    expect(resolveToken(undefined, {})).toBeUndefined()
    expect(resolveToken(undefined, { TIANWENSTAR_API_TOKEN: 'env-tok' })).toBe('env-tok')
    expect(resolveToken('cfg-tok', { TIANWENSTAR_API_TOKEN: 'env-tok' })).toBe('cfg-tok')
    expect(resolveToken('  ', { TIANWENSTAR_API_TOKEN: 'env-tok' })).toBe('env-tok')
  })

  it('resolves the cache path from config, env, or the package directory', () => {
    expect(resolveCachePath('  /tmp/cards ', {})).toBe(join('/tmp/cards', 'role-cards.json'))
    expect(resolveCachePath(undefined, { TIANWENSTAR_CACHE_DIR: '/env/dir' })).toBe(join('/env/dir', 'role-cards.json'))
    expect(resolveCachePath(undefined, {})).toMatch(/role-cards\.json$/u)
  })
})

