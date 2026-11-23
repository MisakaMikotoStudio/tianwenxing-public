import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { acceptPersona, evaluationAcceptor } from '../src/answers.js'
import { extractJson } from '../src/llm.js'
import { RECORD_TYPE, RECORD_VERSION } from '../src/model.js'
import type { Evaluation, Exchange, MetaRecord, ProjectionState, SimulationSpec } from '../src/model.js'
import { activeStage, applyEvent, applyRecord, createViewer, initialState } from '../src/projection.js'
import { timeStatusOf } from '../src/prompts.js'
import { stageReport, statusReport } from '../src/report.js'
import { defaultRubric, gradeOf, measure, totalScore, verdictLabel } from '../src/rubric.js'

function event(value: object): SessionEvent {
  return JSON.parse(JSON.stringify(value)) as SessionEvent
}

function recordEvent(seq: number, record: MetaRecord): SessionEvent {
  return event({ type: RECORD_TYPE, seq, time: 0, ignorable: true, data: record })
}

function userEvent(seq: number, text: string): SessionEvent {
  return event({ type: 'user/message', seq, time: 0, data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } })
}

const spec: SimulationSpec = {
  id: 'sim-1',
  scenario: 'interview',
  title: '后端面试',
  brief: 'JD',
  userProfile: '5 年经验',
  counterpartKnowledge: '简历',
  userGoal: '拿到 offer',
  stages: [{
    id: 's1',
    name: '一面',
    objective: '考察技术',
    timeLimitMinutes: 45,
    counterpart: {
      name: '王磊', title: '技术经理', organization: 'A 公司', personality: '严谨', priorities: '深度', hiddenConcerns: '讨厌空话', speakingStyle: '简洁',
    },
    rubric: defaultRubric('interview'),
  }],
  createdAt: 0,
}

function exchange(index: number, overrides: Partial<Exchange> = {}): Exchange {
  return {
    index,
    userText: index === 0 ? null : `回答 ${index}`,
    userSeq: index === 0 ? null : index * 10,
    reply: `问题 ${index}`,
    innerThought: `想法 ${index}`,
    mood: '中性',
    impression: 50,
    signal: 'neutral',
    trigger: '',
    at: index * 60_000,
    elapsedMs: index * 60_000,
    closing: null,
    ...overrides,
  }
}

function evaluation(): Evaluation {
  const metrics = measure([exchange(0), exchange(1)], 0, 60_000, 45)
  const accepted = evaluationAcceptor('interview', spec.stages[0]!, metrics)({
    verdict_level: 4,
    likelihood: 70,
    in_character_comment: '基础扎实。',
    dimensions: defaultRubric('interview').map(d => ({ key: d.key, score: 4, evidence: '原话', comment: '不错' })),
    landmines: [{ exchange: 1, quote: '回答 1', why: '空泛', better: '举例说明' }],
  })
  if (typeof accepted === 'string') throw new Error(accepted)
  return accepted
}

describe('rubric scoring', () => {
  it('maps uniform scores onto 0-100 and grades them', () => {
    expect(totalScore([{ weight: 2, score: 5 }, { weight: 1, score: 5 }])).toBe(100)
    expect(totalScore([{ weight: 2, score: 3 }, { weight: 1, score: 3 }])).toBe(50)
    expect(totalScore([{ weight: 3, score: 1 }, { weight: 1, score: 5 }])).toBe(25)
    expect([gradeOf(85), gradeOf(70), gradeOf(55), gradeOf(54)]).toEqual(['A', 'B', 'C', 'D'])
    expect(verdictLabel('business', 9)).toBe('准备签约')
  })

  it('measures talk share, impressions, and signals', () => {
    const metrics = measure([
      exchange(0, { reply: 'ab', impression: 50 }),
      exchange(1, { userText: 'abcd', reply: 'ab', impression: 40, signal: 'minus' }),
      exchange(2, { userText: 'abcd', reply: 'ab', impression: 70, signal: 'plus' }),
    ], 0, 90_000, 30)
    expect(metrics).toMatchObject({
      durationMinutes: 1.5, userTurns: 2, userChars: 8, counterpartChars: 6, averageAnswerChars: 4,
      impressionStart: 50, impressionEnd: 70, impressionLow: 40, impressionHigh: 70, plusCount: 1, minusCount: 1,
    })
    expect(metrics.userTalkShare).toBe(0.57)
  })

  it('classifies elapsed time against the plan', () => {
    expect(timeStatusOf(10 * 60_000, 20, 0.85)).toBe('normal')
    expect(timeStatusOf(18 * 60_000, 20, 0.85)).toBe('wrap-up')
    expect(timeStatusOf(20 * 60_000, 20, 0.85)).toBe('overtime')
  })
})

describe('model answers', () => {
  it('extracts JSON around fences and prose', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(extractJson('no json')).toBeUndefined()
    expect(extractJson('{broken')).toBeUndefined()
  })

  it('accepts a persona answer leniently but requires speech and thought', () => {
    expect(acceptPersona({ inner_thought: '还行', reply: '你好', impression: 120, signal: 'odd' })).toMatchObject({
      impression: 100, signal: 'neutral', end: false, mood: '',
    })
    expect(typeof acceptPersona({ inner_thought: '', reply: '你好' })).toBe('string')
  })

  it('computes the score from the rubric and rejects missing dimensions', () => {
    const result = evaluation()
    expect(result.totalScore).toBe(75)
    expect(result.grade).toBe('B')
    expect(result.verdict).toBe('推荐通过')
    const partial = evaluationAcceptor('interview', spec.stages[0]!, result.metrics)({
      verdict_level: 3, likelihood: 50, in_character_comment: 'x', dimensions: [{ key: 'expertise', score: 3 }],
    })
    expect(partial).toMatch(/problem-solving/u)
  })
})

describe('tianwenStar projection', () => {
  function started(): ProjectionState {
    let state = applyEvent(initialState(), event({ type: 'turn/start', seq: 1, time: 0, data: { turn: 1 } }))
    state = applyEvent(state, recordEvent(2, { v: RECORD_VERSION, op: 'create', simulation: spec }))
    return applyEvent(state, recordEvent(3, { v: RECORD_VERSION, op: 'start', simulationId: 'sim-1', stageId: 's1', startedAt: 5, opening: exchange(0) }))
  }

  it('folds records, the latest human message, and the current turn', () => {
    let state = started()
    state = applyEvent(state, userEvent(4, '  你好  '))
    expect(state.latestUser).toEqual({ seq: 4, text: '你好' })
    expect(activeStage(state)?.stage).toMatchObject({ id: 's1', status: 'active', openedSeq: 3, startedAt: 5 })
    const unrelated = applyEvent(state, event({ type: 'turn/end', seq: 5, time: 0, data: { turn: 1, reason: 'completed' } }))
    expect(unrelated).toBe(state)
    expect(applyEvent(state, recordEvent(6, { v: RECORD_VERSION, op: 'start', simulationId: 'sim-1', stageId: 's1', startedAt: 9, opening: exchange(0) }))).toBe(state)
  })

  it('ignores records of another version or malformed data', () => {
    const state = initialState()
    expect(applyEvent(state, event({ type: RECORD_TYPE, seq: 1, time: 0, ignorable: true, data: { v: 2, op: 'create', simulation: spec } }))).toBe(state)
    expect(applyEvent(state, event({ type: RECORD_TYPE, seq: 1, time: 0, ignorable: true, data: { v: 1, op: 'create' } }))).toBe(state)
  })

  it('seals transcripts and evaluations until the stage ends, then reveals them in that turn', () => {
    const view = createViewer()
    let state = started()
    state = applyEvent(state, recordEvent(7, { v: RECORD_VERSION, op: 'exchange', simulationId: 'sim-1', stageId: 's1', exchange: exchange(1) }))
    const live = view(state).simulations[0]!.stages[0]!
    expect(live).toMatchObject({ status: 'active', exchangeCount: 2, exchanges: null, evaluation: null })
    expect(view(applyEvent(state, userEvent(8, '再见')))).toBe(view(state))
    state = applyEvent(state, event({ type: 'turn/start', seq: 9, time: 0, data: { turn: 2 } }))
    state = applyEvent(state, recordEvent(10, { v: RECORD_VERSION, op: 'end', simulationId: 'sim-1', stageId: 's1', endedAt: 99, reason: 'user', evaluation: evaluation() }))
    const ended = view(state).simulations[0]!.stages[0]!
    expect(ended.exchanges?.map(item => item.innerThought)).toEqual(['想法 0', '想法 1'])
    expect(ended.revealTurns).toEqual([2])
    const reviewed = applyRecord(state, { v: RECORD_VERSION, op: 'review', simulationId: 'sim-1', stageIds: ['s1'] }, 5, 11)
    expect(reviewed.simulations[0]!.stages[0]!.revealTurns).toEqual([2, 5])
    expect(applyRecord(reviewed, { v: RECORD_VERSION, op: 'review', simulationId: 'sim-1', stageIds: ['s1'] }, 5, 12)).toBe(reviewed)
  })
})

describe('reports', () => {
  it('renders the evaluation with every inner thought', () => {
    const stage = {
      id: 's1', status: 'ended' as const, startedAt: 0, openedSeq: 3, endedAt: 60_000, endReason: 'time' as const,
      exchanges: [exchange(0), exchange(1, { signal: 'minus', trigger: '回答 1', mood: '失望', impression: 35 })],
      evaluation: evaluation(), revealTurns: [2],
    }
    const text = stageReport(spec.stages[0]!, stage, stage.evaluation)
    expect(text).toContain('总分 75/100（B）')
    expect(text).toContain('结束原因：时间到')
    expect(text).toContain('王磊心里想：想法 1（失望 · 印象 35 · 踩雷 · 触发：「回答 1」）')
    expect(text).toContain('更好的说法：举例说明')
  })

  it('summarizes simulation status', () => {
    expect(statusReport(initialState(), 0)).toContain('还没有')
    const state = applyRecord(initialState(), { v: RECORD_VERSION, op: 'create', simulation: spec }, 1, 1)
    expect(statusReport(state, 0)).toContain('s1 一面（王磊，45 分钟）：未开始')
  })
})
