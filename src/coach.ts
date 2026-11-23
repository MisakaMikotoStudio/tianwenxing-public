/**
 * The 天问星 coach: the agent-scoped tools and system-prompt section that turn
 * a conversation into a timed, in-character communication simulation.
 *
 * The counterpart runs as a separate auxiliary model call that never sees the
 * coach's strategy, so it reacts like the real person. Every counterpart turn,
 * including its unspoken inner thought, is committed as an ignorable plugin
 * record; tool results reveal inner thoughts to the coach only after the stage
 * has ended, and the client view seals them until then as well.
 * @module dsh-tianwen-star/coach
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { Session } from '@deepseek-ai/dsh-session'
import { appendPluginRecord } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { defineTool, ToolArgsError, ToolContextUnavailableError } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { acceptPersona, evaluationAcceptor } from './answers.js'
import type { PersonaAnswer } from './answers.js'
import { callStructured, resolveRoute, TianwenError } from './llm.js'
import type { CallControls, ReasoningChoice, RouteOverride } from './llm.js'
import {
  RECORD_TYPE,
  RECORD_VERSION,
  projectionStateSchema,
  projectionViewSchema,
} from './model.js'
import type {
  EndReason,
  Exchange,
  MetaRecord,
  ProjectionState,
  RubricDimension,
  Scenario,
  SimulationSpec,
  SimulationState,
  StageSpec,
  StageState,
} from './model.js'
import { activeStage, applyEvent, createViewer, findSimulation, initialState, PROJECTION_KEY } from './projection.js'
import {
  DEFAULT_COACH_SECTION,
  evaluatorInput,
  evaluatorSystem,
  personaInput,
  personaSystem,
  timeStatusOf,
} from './prompts.js'
import type { PriorFeedback } from './prompts.js'
import { stageReport, statusReport } from './report.js'
import { defaultRubric, measure } from './rubric.js'

declare module '@deepseek-ai/dsh-session' {
  interface PluginRecordMap {
    /** One 天问星 simulation record. */
    'plugin:dsh-tianwen-star/record': MetaRecord
  }
}

export const name = 'tianwen-star-coach'
export const inject = ['tools', 'llm', 'systemPrompt', 'sessionProjections']

/** Coach configuration. */
export interface Config {
  /** System-prompt section that drives the coaching workflow. */
  section: string
  /** Provider of counterpart and evaluator calls; omit with `model` to reuse the conversation route. */
  provider?: string
  /** Model of counterpart and evaluator calls; omit with `provider` to reuse the conversation route. */
  model?: string
  /** Output-token cap of one counterpart turn, reasoning included. */
  personaMaxOutputTokens: number
  /** Deadline of one counterpart turn in milliseconds. */
  personaTimeoutMs: number
  /** Reasoning effort of counterpart turns. */
  personaReasoning: ReasoningChoice
  /** Output-token cap of one stage evaluation, reasoning included. */
  evaluationMaxOutputTokens: number
  /** Deadline of one stage evaluation in milliseconds. */
  evaluationTimeoutMs: number
  /** Reasoning effort of stage evaluations. */
  evaluationReasoning: ReasoningChoice
  /** Extra attempts when a counterpart or evaluator answer is not valid JSON. */
  jsonRetries: number
  /** Fraction of the planned time after which the counterpart starts closing. */
  wrapUpRatio: number
  /** Most answered user turns in one stage before it closes. */
  maxExchangesPerStage: number
  /** Most stages in one simulation. */
  maxStages: number
  /** Longest planned stage duration in minutes. */
  maxStageMinutes: number
}

const reasoning = Schema.union(['lowest', 'default', 'highest'] as const)

/** Schemastery configuration of the coach. */
export const Config: Schema<Config> = Schema.object({
  section: Schema.string().role('textarea').default(DEFAULT_COACH_SECTION)
    .description('System-prompt section that drives the coaching workflow.'),
  provider: Schema.string().description('Provider of counterpart and evaluator calls; set together with model.'),
  model: Schema.string().description('Model of counterpart and evaluator calls; set together with provider.'),
  personaMaxOutputTokens: Schema.natural().min(256).default(4096),
  personaTimeoutMs: Schema.natural().min(1000).default(120_000),
  personaReasoning: reasoning.default('lowest'),
  evaluationMaxOutputTokens: Schema.natural().min(1024).default(8192),
  evaluationTimeoutMs: Schema.natural().min(1000).default(300_000),
  evaluationReasoning: reasoning.default('default'),
  jsonRetries: Schema.natural().max(5).default(1),
  wrapUpRatio: Schema.number().min(0.5).max(1).default(0.85),
  maxExchangesPerStage: Schema.natural().min(2).default(40),
  maxStages: Schema.natural().min(1).default(6),
  maxStageMinutes: Schema.natural().min(5).default(120),
})

const textOutput = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: { text: { type: 'string', required: true } },
  },
  render: (_args: unknown, value: { text: string }) => [{ type: 'text' as const, text: value.text }],
} as const

const END_REASON_TEXT: Readonly<Record<EndReason, string>> = {
  counterpart: '角色结束了对话',
  time: '时间已到',
  user: '用户要求结束',
  limit: '达到本场轮次上限',
}

function sessionOf(exec: ToolRunContext): Session {
  if (exec.agent === undefined) throw new ToolContextUnavailableError('天问星 tools require an owning agent session')
  return exec.agent.session
}

function stateError(message: string): TianwenError {
  return new TianwenError(message, 'TIANWEN_STATE')
}

function requireSimulation(state: ProjectionState, simulationId: string): SimulationState {
  const simulation = findSimulation(state, simulationId)
  if (simulation === undefined) {
    const ids = state.simulations.map(item => item.spec.id).join(', ') || 'none'
    throw stateError(`Simulation ${simulationId} does not exist (existing: ${ids}). Call tianwen_status to list simulations.`)
  }
  return simulation
}

function stageSpecOf(simulation: SimulationState, stageId: string): StageSpec {
  const spec = simulation.spec.stages.find(stage => stage.id === stageId)
  if (spec === undefined) throw stateError(`Stage ${stageId} is not part of simulation ${simulation.spec.id}.`)
  return spec
}

function relay(spec: StageSpec, reply: string): string {
  return `**${spec.counterpart.name}**：${reply}`
}

function nonEmpty(value: string, path: string, violations: string[]): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) violations.push(`${path} must be a non-empty string`)
  return trimmed
}

interface StageInput {
  name: string
  objective: string
  timeLimitMinutes: number
  counterpart: {
    name: string
    title: string
    organization: string
    personality: string
    priorities: string
    hiddenConcerns: string
    speakingStyle: string
  }
  rubric?: { name: string; weight: number; description: string; low: string; mid: string; high: string }[]
}

function buildStages(scenario: Scenario, inputs: readonly StageInput[], config: Config): StageSpec[] {
  const violations: string[] = []
  if (inputs.length === 0 || inputs.length > config.maxStages) {
    violations.push(`stages must contain 1 to ${config.maxStages} stages (got ${inputs.length})`)
  }
  const stages = inputs.map((input, index): StageSpec => {
    const path = `stages[${index}]`
    if (!(input.timeLimitMinutes >= 1 && input.timeLimitMinutes <= config.maxStageMinutes)) {
      violations.push(`${path}.timeLimitMinutes must be between 1 and ${config.maxStageMinutes}`)
    }
    const rubric: RubricDimension[] = input.rubric === undefined || input.rubric.length === 0
      ? defaultRubric(scenario)
      : input.rubric.map((dimension, at) => {
        if (!(dimension.weight > 0)) violations.push(`${path}.rubric[${at}].weight must be positive`)
        return {
          key: `d${at + 1}`,
          name: nonEmpty(dimension.name, `${path}.rubric[${at}].name`, violations),
          weight: dimension.weight,
          description: dimension.description.trim(),
          anchors: { low: dimension.low.trim(), mid: dimension.mid.trim(), high: dimension.high.trim() },
        }
      })
    const { counterpart } = input
    return {
      id: `s${index + 1}`,
      name: nonEmpty(input.name, `${path}.name`, violations),
      objective: input.objective.trim(),
      timeLimitMinutes: input.timeLimitMinutes,
      counterpart: {
        name: nonEmpty(counterpart.name, `${path}.counterpart.name`, violations),
        title: nonEmpty(counterpart.title, `${path}.counterpart.title`, violations),
        organization: counterpart.organization.trim(),
        personality: counterpart.personality.trim(),
        priorities: counterpart.priorities.trim(),
        hiddenConcerns: counterpart.hiddenConcerns.trim(),
        speakingStyle: counterpart.speakingStyle.trim(),
      },
      rubric,
    }
  })
  if (violations.length > 0) throw new ToolArgsError(violations)
  return stages
}

function nextSimulationId(state: ProjectionState): string {
  let n = state.simulations.length + 1
  while (findSimulation(state, `sim-${n}`) !== undefined) n += 1
  return `sim-${n}`
}

function priorFeedback(simulation: SimulationState): PriorFeedback[] {
  return simulation.stages.flatMap((stage, index) => {
    const spec = simulation.spec.stages[index]
    if (stage.status !== 'ended' || stage.evaluation === null || spec === undefined) return []
    return [{
      stageName: spec.name,
      counterpartName: spec.counterpart.name,
      verdict: stage.evaluation.verdict,
      comment: stage.evaluation.inCharacterComment,
    }]
  })
}

function exchangeOf(
  answer: PersonaAnswer,
  index: number,
  user: { seq: number; text: string } | null,
  at: number,
  elapsedMs: number,
  closing: Exchange['closing'],
): Exchange {
  return {
    index,
    userText: user?.text ?? null,
    userSeq: user?.seq ?? null,
    reply: answer.reply,
    innerThought: answer.inner_thought,
    mood: answer.mood,
    impression: answer.impression,
    signal: user === null ? 'neutral' : answer.signal,
    trigger: user === null ? '' : answer.trigger,
    at,
    elapsedMs,
    closing,
  }
}

function reportFor(simulation: SimulationState, stage: StageState): string {
  const spec = stageSpecOf(simulation, stage.id)
  if (stage.evaluation === null) throw stateError(`Stage ${stage.id} has no evaluation.`)
  return stageReport(spec, stage, stage.evaluation)
}

/**
 * Register the coach section, the `tianwenStar` projection, and the 天问星 tools.
 * @param ctx - preset-scoped plugin context.
 * @param config - validated coach configuration.
 * @returns when the projection is registered.
 * @throws {Error} when only one of `provider` and `model` is configured.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  if ((config.provider === undefined) !== (config.model === undefined)) {
    throw new Error('tianwen-star-coach: configure provider and model together, or omit both to reuse the conversation route.')
  }
  const override: RouteOverride | undefined = config.provider !== undefined && config.model !== undefined
    ? { provider: config.provider, model: config.model }
    : undefined
  const personaControls: CallControls = {
    maxOutputTokens: config.personaMaxOutputTokens,
    timeoutMs: config.personaTimeoutMs,
    reasoning: config.personaReasoning,
  }
  const evaluationControls: CallControls = {
    maxOutputTokens: config.evaluationMaxOutputTokens,
    timeoutMs: config.evaluationTimeoutMs,
    reasoning: config.evaluationReasoning,
  }

  const projectionReady = ctx.sessionProjections.register<typeof PROJECTION_KEY, ProjectionState>({
    key: PROJECTION_KEY,
    stateVersion: 1,
    stateSchema: projectionStateSchema,
    init: initialState,
    apply: applyEvent,
    wire: { viewSchema: projectionViewSchema, view: createViewer(), summary: false },
  })
  let readState: ((session: Session) => ProjectionState) | undefined
  const stateOf = (session: Session): ProjectionState => {
    if (readState === undefined) throw stateError('The 天问星 projection is not registered yet; retry the tool call.')
    return readState(session)
  }
  const write = (session: Session, record: MetaRecord): void => {
    appendPluginRecord(session, RECORD_TYPE, record)
  }

  const askPersona = async (session: Session, simulation: SimulationState, spec: StageSpec, input: string, signal: AbortSignal) => {
    const result = await callStructured(ctx, {
      session,
      route: resolveRoute(session, override),
      controls: personaControls,
      system: personaSystem(simulation.spec, spec, priorFeedback(simulation)),
      input,
      retries: config.jsonRetries,
      accept: acceptPersona,
      signal,
    })
    return result.value
  }

  ctx.systemPrompt.section({
    name: 'tianwen-star:coach',
    order: 1500,
    text: config.section,
    interpolate: false,
  })

  ctx.tools.register(defineTool({
    name: 'tianwen_create_simulation',
    description: 'Create a 天问星 communication simulation (job interview loop or business negotiation) from the background interview. '
      + 'Each stage is one timed conversation with one realistic counterpart whose personality, priorities, and unspoken concerns you design. '
      + 'Call only after the background interview and the strategy briefing.',
    parameters: {
      scenario: { type: 'string', enum: ['interview', 'business'], required: true, description: 'interview: job interview loop; business: business negotiation.' },
      title: { type: 'string', required: true, description: 'Short title, such as 字节跳动 后端工程师面试.' },
      brief: { type: 'string', required: true, description: 'All known facts about the company, role, JD, deal, and context, in full detail.' },
      userProfile: { type: 'string', required: true, description: "The user's background as collected in the interview." },
      counterpartKnowledge: { type: 'string', required: true, description: 'What the counterparts know about the user beforehand, such as the resume or the meeting request.' },
      userGoal: { type: 'string', required: true, description: 'What the user wants to achieve.' },
      stages: {
        type: 'array',
        required: true,
        description: 'Ordered stages, such as 一面, 二面, HR 面; usually one stage for a business meeting.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', required: true, description: 'Stage name, such as 一面（技术面）.' },
            objective: { type: 'string', required: true, description: 'What the counterpart wants to learn or decide in this stage.' },
            timeLimitMinutes: { type: 'number', required: true, description: 'Realistic planned duration in minutes.' },
            counterpart: {
              type: 'object',
              required: true,
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true, description: 'Name, such as 王磊 or 李总.' },
                title: { type: 'string', required: true, description: 'Job title.' },
                organization: { type: 'string', required: true, description: 'Company and department.' },
                personality: { type: 'string', required: true, description: 'Temperament and decision style.' },
                priorities: { type: 'string', required: true, description: 'What this person evaluates and cares about in this conversation.' },
                hiddenConcerns: { type: 'string', required: true, description: 'Concerns and landmines the person never says aloud.' },
                speakingStyle: { type: 'string', required: true, description: 'How the person talks.' },
              },
            },
            rubric: {
              type: 'array',
              description: 'Optional evaluation dimensions; omit to use the scientific default rubric of the scenario.',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  name: { type: 'string', required: true },
                  weight: { type: 'number', required: true, description: 'Positive relative weight.' },
                  description: { type: 'string', required: true },
                  low: { type: 'string', required: true, description: 'Behavior that scores 1.' },
                  mid: { type: 'string', required: true, description: 'Behavior that scores 3.' },
                  high: { type: 'string', required: true, description: 'Behavior that scores 5.' },
                },
              },
            },
          },
        },
      },
    },
    output: textOutput,
    isConcurrencySafe: () => false,
    execute(args, exec) {
      const session = sessionOf(exec)
      const state = stateOf(session)
      const scenario: Scenario = args.scenario
      const stages = buildStages(scenario, args.stages, config)
      const simulation: SimulationSpec = {
        id: nextSimulationId(state),
        scenario,
        title: args.title.trim() || '沟通模拟',
        brief: args.brief.trim(),
        userProfile: args.userProfile.trim(),
        counterpartKnowledge: args.counterpartKnowledge.trim(),
        userGoal: args.userGoal.trim(),
        stages,
        createdAt: Date.now(),
      }
      write(session, { v: RECORD_VERSION, op: 'create', simulation })
      const lines = stages.map(stage => `- ${stage.id} ${stage.name}：${stage.counterpart.name}（${stage.counterpart.title}），约 ${stage.timeLimitMinutes} 分钟`)
      return Promise.resolve({
        text: `Created simulation ${simulation.id}「${simulation.title}」.\n${lines.join('\n')}\n`
          + 'Introduce only stage names, counterpart names and titles, and time limits; never reveal personalities, priorities, or concerns. '
          + `Call tianwen_start_stage with simulationId ${simulation.id} once the user is ready.`,
      })
    },
    presentCall: args => ({ card: 'generic', title: `Create simulation: ${args.title}`, kind: 'other' }),
  }))

  ctx.tools.register(defineTool({
    name: 'tianwen_start_stage',
    description: 'Start one stage of a 天问星 simulation. The counterpart speaks first and the clock starts. '
      + 'Reply with the returned line verbatim and nothing else.',
    parameters: {
      simulationId: { type: 'string', required: true },
      stageId: { type: 'string', description: 'Stage to start; omit for the next stage that has not started.' },
    },
    output: textOutput,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const session = sessionOf(exec)
      const state = stateOf(session)
      const running = activeStage(state)
      if (running !== undefined) {
        throw stateError(`Stage ${running.stage.id} of ${running.simulation.spec.id} is still in progress; call tianwen_end_stage first.`)
      }
      const simulation = requireSimulation(state, args.simulationId)
      const stage = args.stageId === undefined
        ? simulation.stages.find(item => item.status === 'pending')
        : simulation.stages.find(item => item.id === args.stageId)
      if (stage === undefined) {
        throw stateError(args.stageId === undefined
          ? `Every stage of ${simulation.spec.id} has already run. Use tianwen_review to revisit one.`
          : `Stage ${args.stageId} is not part of simulation ${simulation.spec.id}.`)
      }
      if (stage.status !== 'pending') throw stateError(`Stage ${stage.id} has already run; a stage runs once.`)
      const spec = stageSpecOf(simulation, stage.id)
      const answer = await askPersona(session, simulation, spec, personaInput(stage, spec, null, 0, 'normal'), exec.signal)
      const startedAt = Date.now()
      write(session, {
        v: RECORD_VERSION,
        op: 'start',
        simulationId: simulation.spec.id,
        stageId: stage.id,
        startedAt,
        opening: exchangeOf(answer, 0, null, startedAt, 0, null),
      })
      return {
        text: `Stage ${stage.id}「${spec.name}」started; the clock is running (${spec.timeLimitMinutes} minutes). `
          + 'Your whole reply must be exactly this line:\n\n'
          + relay(spec, answer.reply),
      }
    },
    presentCall: () => ({ card: 'generic', title: 'Start simulation stage', kind: 'other' }),
  }))

  ctx.tools.register(defineTool({
    name: 'tianwen_reply',
    description: "Pass the user's latest message to the counterpart of the running 天问星 stage and get the counterpart's answer. "
      + 'The tool reads the exact message itself. Reply with the returned line verbatim and nothing else.',
    parameters: {},
    output: textOutput,
    isConcurrencySafe: () => false,
    async execute(_args, exec) {
      const session = sessionOf(exec)
      const state = stateOf(session)
      const running = activeStage(state)
      if (running === undefined) throw stateError('No stage is in progress. Call tianwen_start_stage first.')
      const { simulation, stage } = running
      const spec = stageSpecOf(simulation, stage.id)
      const last = stage.exchanges.at(-1)
      const latest = state.latestUser
      const answeredAfter = Math.max(stage.openedSeq ?? 0, last?.userSeq ?? 0)
      if (latest === null || latest.seq <= answeredAfter) {
        throw stateError('The user has not said anything new since the counterpart last spoke; wait for the user.')
      }
      const now = Date.now()
      const elapsedMs = Math.max(0, now - (stage.startedAt ?? now))
      const answered = stage.exchanges.length
      const atLimit = answered >= config.maxExchangesPerStage
      const status = atLimit ? 'overtime' : timeStatusOf(elapsedMs, spec.timeLimitMinutes, config.wrapUpRatio)
      const answer = await askPersona(session, simulation, spec, personaInput(stage, spec, latest.text, elapsedMs, status), exec.signal)
      const closing: Exchange['closing'] = atLimit ? 'limit' : status === 'overtime' ? 'time' : answer.end ? 'counterpart' : null
      const at = Date.now()
      write(session, {
        v: RECORD_VERSION,
        op: 'exchange',
        simulationId: simulation.spec.id,
        stageId: stage.id,
        exchange: exchangeOf(answer, answered, latest, at, Math.max(0, at - (stage.startedAt ?? at)), closing),
      })
      const line = relay(spec, answer.reply)
      if (closing === null) return { text: `Reply with exactly this line and nothing else:\n\n${line}` }
      return {
        text: `The stage has ended (${END_REASON_TEXT[closing]}). Output exactly this line, then immediately call tianwen_end_stage:\n\n${line}`,
      }
    },
    presentCall: () => ({ card: 'generic', title: 'Counterpart reply', kind: 'other' }),
  }))

  ctx.tools.register(defineTool({
    name: 'tianwen_end_stage',
    description: 'End the running 天问星 stage and produce the in-character evaluation: weighted rubric scores with evidence, '
      + 'verdict, landmines and highlights, improvements, and the full transcript with the counterpart\'s inner thoughts.',
    parameters: {},
    output: textOutput,
    isConcurrencySafe: () => false,
    async execute(_args, exec) {
      const session = sessionOf(exec)
      const state = stateOf(session)
      const running = activeStage(state)
      if (running === undefined) throw stateError('No stage is in progress.')
      const { simulation, stage, index } = running
      const spec = stageSpecOf(simulation, stage.id)
      const endedAt = Date.now()
      const reason: EndReason = stage.exchanges.at(-1)?.closing ?? 'user'
      const metrics = measure(stage.exchanges, stage.startedAt ?? endedAt, endedAt, spec.timeLimitMinutes)
      const { value: evaluation } = await callStructured(ctx, {
        session,
        route: resolveRoute(session, override),
        controls: evaluationControls,
        system: evaluatorSystem(simulation.spec, spec),
        input: evaluatorInput(simulation.spec, spec, stage.exchanges, metrics),
        retries: config.jsonRetries,
        accept: evaluationAcceptor(simulation.spec.scenario, spec, metrics),
        signal: exec.signal,
      })
      write(session, {
        v: RECORD_VERSION,
        op: 'end',
        simulationId: simulation.spec.id,
        stageId: stage.id,
        endedAt,
        reason,
        evaluation,
      })
      const ended: StageState = { ...stage, status: 'ended', endedAt, endReason: reason, evaluation }
      const next = simulation.stages.slice(index + 1).find(item => item.status === 'pending')
      const nextText = next === undefined
        ? 'This was the last stage of the simulation.'
        : `Next stage: ${next.id}. Ask whether the user wants to continue before calling tianwen_start_stage.`
      return {
        text: `The stage is over and the counterpart's inner thoughts are now revealed. Debrief the user from this report. ${nextText}\n\n${stageReport(spec, ended, evaluation)}`,
      }
    },
    presentCall: () => ({ card: 'generic', title: 'Evaluate simulation stage', kind: 'other' }),
  }))

  ctx.tools.register(defineTool({
    name: 'tianwen_review',
    description: 'Show the evaluation report, transcript, and inner thoughts of ended 天问星 stages again.',
    parameters: {
      simulationId: { type: 'string', required: true },
      stageId: { type: 'string', description: 'Stage to review; omit for every ended stage.' },
    },
    output: textOutput,
    isConcurrencySafe: () => false,
    execute(args, exec) {
      const session = sessionOf(exec)
      const simulation = requireSimulation(stateOf(session), args.simulationId)
      const stages = simulation.stages.filter(stage => args.stageId === undefined || stage.id === args.stageId)
      if (args.stageId !== undefined && stages.length === 0) stageSpecOf(simulation, args.stageId)
      const ended = stages.filter(stage => stage.status === 'ended')
      if (ended.length === 0) {
        throw stateError('Inner thoughts and evaluations become visible only after a stage has ended; no requested stage has ended yet.')
      }
      write(session, { v: RECORD_VERSION, op: 'review', simulationId: simulation.spec.id, stageIds: ended.map(stage => stage.id) })
      return Promise.resolve({ text: ended.map(stage => reportFor(simulation, stage)).join('\n\n---\n\n') })
    },
    presentCall: () => ({ card: 'generic', title: 'Review simulation', kind: 'read' }),
  }))

  ctx.tools.register(defineTool({
    name: 'tianwen_status',
    description: 'List the 天问星 simulations of this conversation and the status of each stage.',
    parameters: {},
    output: textOutput,
    isConcurrencySafe: () => true,
    execute(_args, exec) {
      return Promise.resolve({ text: statusReport(stateOf(sessionOf(exec)), Date.now()) })
    },
    presentCall: () => ({ card: 'generic', title: 'Simulation status', kind: 'read' }),
  }))

  const handle = await projectionReady
  readState = session => handle.stateOf(session)
}
