/**
 * Durable domain records of 天问星 simulations. Every record crosses the
 * session-log boundary as an ignorable plugin record, so the schemas here
 * validate it on read; the inferred types are the in-process representation.
 * @module dsh-tianwen-star/model
 */

import { z } from 'zod'

/** Session plugin record type of every 天问星 record. */
export const RECORD_TYPE = 'plugin:dsh-tianwen-star/record'

/** Version of the record format; a fold ignores records of another version. */
export const RECORD_VERSION = 1

/** Simulation scenario: a job interview loop or a business negotiation. */
export const scenarioSchema = z.enum(['interview', 'business'])
/** Simulation scenario. */
export type Scenario = z.infer<typeof scenarioSchema>

/** Behaviorally anchored descriptors for the low, middle, and high score of one dimension. */
export const anchorsSchema = z.object({
  /** What a score of 1 looks like. */
  low: z.string(),
  /** What a score of 3 looks like. */
  mid: z.string(),
  /** What a score of 5 looks like. */
  high: z.string(),
})

/** One weighted evaluation dimension scored 1-5 against its anchors. */
export const rubricDimensionSchema = z.object({
  /** Stable key within its rubric. */
  key: z.string().min(1),
  /** Display name. */
  name: z.string().min(1),
  /** Positive relative weight. */
  weight: z.number().positive(),
  /** What the dimension measures. */
  description: z.string(),
  /** Behavioral anchors. */
  anchors: anchorsSchema,
})
/** One weighted evaluation dimension. */
export type RubricDimension = z.infer<typeof rubricDimensionSchema>

/** The simulated counterpart of one stage, as the persona model plays it. */
export const counterpartSchema = z.object({
  /** Name the counterpart introduces themself with. */
  name: z.string().min(1),
  /** Job title or role. */
  title: z.string().min(1),
  /** Organization the counterpart represents. */
  organization: z.string(),
  /** Personality, temperament, and decision style. */
  personality: z.string(),
  /** What this person cares about and evaluates in this conversation. */
  priorities: z.string(),
  /** Concerns and sensitivities the person never states; the landmines. */
  hiddenConcerns: z.string(),
  /** How the person speaks. */
  speakingStyle: z.string(),
})
/** The simulated counterpart of one stage. */
export type Counterpart = z.infer<typeof counterpartSchema>

/** One timed conversation stage: an interview round or one meeting. */
export const stageSpecSchema = z.object({
  /** Stable id within the simulation, such as `s1`. */
  id: z.string().min(1),
  /** Display name, such as 一面 or HR 面. */
  name: z.string().min(1),
  /** What the counterpart wants to learn or decide in this stage. */
  objective: z.string(),
  /** Planned duration. */
  timeLimitMinutes: z.number().positive(),
  /** Counterpart played in this stage. */
  counterpart: counterpartSchema,
  /** Evaluation rubric of this stage. */
  rubric: z.array(rubricDimensionSchema).min(1),
})
/** One timed conversation stage. */
export type StageSpec = z.infer<typeof stageSpecSchema>

/** Immutable plan of one simulation, fixed when it is created. */
export const simulationSpecSchema = z.object({
  /** Session-unique id, such as `sim-1`. */
  id: z.string().min(1),
  /** Scenario kind. */
  scenario: scenarioSchema,
  /** Display title. */
  title: z.string().min(1),
  /** Facts about the company, role, JD, or deal that frame every stage. */
  brief: z.string(),
  /** The user's background as the coach collected it. */
  userProfile: z.string(),
  /** What the counterpart knows about the user before the conversation. */
  counterpartKnowledge: z.string(),
  /** What the user wants to achieve. */
  userGoal: z.string(),
  /** Ordered stages. */
  stages: z.array(stageSpecSchema).min(1),
  /** Creation time in Unix epoch milliseconds. */
  createdAt: z.number(),
})
/** Immutable plan of one simulation. */
export type SimulationSpec = z.infer<typeof simulationSpecSchema>

/** How one counterpart reaction moved the user's standing. */
export const signalSchema = z.enum(['plus', 'minus', 'neutral'])
/** How one counterpart reaction moved the user's standing. */
export type Signal = z.infer<typeof signalSchema>

/** One counterpart turn: what the user said, what was said back, and what was thought. */
export const exchangeSchema = z.object({
  /** 0 for the opening, then 1, 2, ... */
  index: z.number().int().nonnegative(),
  /** The user's exact words; null for the counterpart's opening. */
  userText: z.string().nullable(),
  /** Log seq of the user message answered; null for the opening. */
  userSeq: z.number().int().nullable(),
  /** Words the counterpart said aloud. */
  reply: z.string(),
  /** The counterpart's unspoken first-person thought. */
  innerThought: z.string(),
  /** Short mood label, such as 认可 or 不耐烦. */
  mood: z.string(),
  /** Overall impression of the user after this turn, 0-100. */
  impression: z.number().min(0).max(100),
  /** Whether the user's last words gained, lost, or kept standing. */
  signal: signalSchema,
  /** The user's words that caused the reaction; empty when none. */
  trigger: z.string(),
  /** Unix epoch milliseconds when the reply was produced. */
  at: z.number(),
  /** Milliseconds since the stage started. */
  elapsedMs: z.number().nonnegative(),
  /** Why this turn closed the stage; null while the conversation continues. */
  closing: z.enum(['counterpart', 'time', 'limit']).nullable(),
})
/** One counterpart turn. */
export type Exchange = z.infer<typeof exchangeSchema>

/** One scored rubric dimension. */
export const dimensionScoreSchema = z.object({
  key: z.string(),
  name: z.string(),
  weight: z.number(),
  /** Integer score 1-5. */
  score: z.number().int().min(1).max(5),
  /** Quoted evidence from the transcript. */
  evidence: z.string(),
  /** Assessment against the anchors. */
  comment: z.string(),
})
/** One scored rubric dimension. */
export type DimensionScore = z.infer<typeof dimensionScoreSchema>

/** One cited moment of the transcript. */
export const momentSchema = z.object({
  /** Exchange index the moment belongs to. */
  exchange: z.number().int().nonnegative(),
  /** The user's words. */
  quote: z.string(),
  /** Why it mattered to the counterpart. */
  why: z.string(),
  /** A better way to say it; empty for highlights. */
  better: z.string(),
})
/** One cited moment of the transcript. */
export type Moment = z.infer<typeof momentSchema>

/** Deterministic conversation measurements computed from the transcript. */
export const metricsSchema = z.object({
  durationMinutes: z.number(),
  timeLimitMinutes: z.number(),
  /** Answered user turns, excluding the opening. */
  userTurns: z.number().int(),
  userChars: z.number().int(),
  counterpartChars: z.number().int(),
  /** User share of all spoken characters, 0-1. */
  userTalkShare: z.number(),
  averageAnswerChars: z.number(),
  impressionStart: z.number(),
  impressionEnd: z.number(),
  impressionLow: z.number(),
  impressionHigh: z.number(),
  plusCount: z.number().int(),
  minusCount: z.number().int(),
})
/** Deterministic conversation measurements. */
export type Metrics = z.infer<typeof metricsSchema>

/** Letter grade of a total score. */
export const gradeSchema = z.enum(['A', 'B', 'C', 'D'])
/** Letter grade of a total score. */
export type Grade = z.infer<typeof gradeSchema>

/** Complete evaluation of one ended stage. */
export const evaluationSchema = z.object({
  /** Outcome level 1-5 on the scenario's verdict scale. */
  verdictLevel: z.number().int().min(1).max(5),
  /** Label of {@link verdictLevel} on the scenario's verdict scale. */
  verdict: z.string(),
  /** Deal or offer likelihood the counterpart assigns, 0-100. */
  likelihood: z.number().min(0).max(100),
  /** The counterpart's candid internal write-up, in character. */
  inCharacterComment: z.string(),
  dimensions: z.array(dimensionScoreSchema),
  /** Weighted rubric score, 0-100. */
  totalScore: z.number(),
  grade: gradeSchema,
  highlights: z.array(momentSchema),
  landmines: z.array(momentSchema),
  /** Prioritized, actionable improvements for the next attempt. */
  improvements: z.array(z.string()),
  /** What to prepare before the next stage or meeting. */
  nextSteps: z.string(),
  metrics: metricsSchema,
})
/** Complete evaluation of one ended stage. */
export type Evaluation = z.infer<typeof evaluationSchema>

/** Why a stage ended. */
export const endReasonSchema = z.enum(['counterpart', 'time', 'user', 'limit'])
/** Why a stage ended. */
export type EndReason = z.infer<typeof endReasonSchema>

const recordBase = { v: z.literal(RECORD_VERSION) }

/** One plugin record; the projection folds these in log order. */
export const metaRecordSchema = z.discriminatedUnion('op', [
  z.object({ ...recordBase, op: z.literal('create'), simulation: simulationSpecSchema }),
  z.object({
    ...recordBase,
    op: z.literal('start'),
    simulationId: z.string(),
    stageId: z.string(),
    startedAt: z.number(),
    opening: exchangeSchema,
  }),
  z.object({
    ...recordBase,
    op: z.literal('exchange'),
    simulationId: z.string(),
    stageId: z.string(),
    exchange: exchangeSchema,
  }),
  z.object({
    ...recordBase,
    op: z.literal('end'),
    simulationId: z.string(),
    stageId: z.string(),
    endedAt: z.number(),
    reason: endReasonSchema,
    evaluation: evaluationSchema,
  }),
  z.object({
    ...recordBase,
    op: z.literal('review'),
    simulationId: z.string(),
    stageIds: z.array(z.string()),
  }),
])
/** One plugin record. */
export type MetaRecord = z.infer<typeof metaRecordSchema>

/** Lifecycle of one stage. */
export const stageStatusSchema = z.enum(['pending', 'active', 'ended'])
/** Lifecycle of one stage. */
export type StageStatus = z.infer<typeof stageStatusSchema>

/** Folded runtime state of one stage. */
export const stageStateSchema = z.object({
  id: z.string(),
  status: stageStatusSchema,
  startedAt: z.number().nullable(),
  /** Log seq of the record that started the stage; only later human messages are answered. */
  openedSeq: z.number().int().nullable(),
  endedAt: z.number().nullable(),
  endReason: endReasonSchema.nullable(),
  exchanges: z.array(exchangeSchema),
  evaluation: evaluationSchema.nullable(),
  /** Turns whose closing review card shows this stage. */
  revealTurns: z.array(z.number().int()),
})
/** Folded runtime state of one stage. */
export type StageState = z.infer<typeof stageStateSchema>

/** Folded state of one simulation. */
export const simulationStateSchema = z.object({
  spec: simulationSpecSchema,
  stages: z.array(stageStateSchema),
})
/** Folded state of one simulation. */
export type SimulationState = z.infer<typeof simulationStateSchema>

/** The latest human message, the input of the next counterpart turn. */
export const latestUserSchema = z.object({ seq: z.number().int(), text: z.string() })
/** The latest human message. */
export type LatestUser = z.infer<typeof latestUserSchema>

/** Host state of the `tianwenStar` projection. */
export const projectionStateSchema = z.object({
  /** Number of the latest started turn; 0 before the first. */
  currentTurn: z.number().int(),
  latestUser: latestUserSchema.nullable(),
  simulations: z.array(simulationStateSchema),
})
/** Host state of the `tianwenStar` projection. */
export type ProjectionState = z.infer<typeof projectionStateSchema>

/** Client view of one stage; transcript and evaluation appear only once it has ended. */
export const stageViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  counterpartName: z.string(),
  counterpartTitle: z.string(),
  timeLimitMinutes: z.number(),
  status: stageStatusSchema,
  startedAt: z.number().nullable(),
  endedAt: z.number().nullable(),
  exchangeCount: z.number().int(),
  revealTurns: z.array(z.number().int()),
  exchanges: z.array(exchangeSchema).nullable(),
  evaluation: evaluationSchema.nullable(),
})
/** Client view of one stage. */
export type StageView = z.infer<typeof stageViewSchema>

/** Client view of all simulations of one Session. */
export const projectionViewSchema = z.object({
  simulations: z.array(z.object({
    id: z.string(),
    scenario: scenarioSchema,
    title: z.string(),
    stages: z.array(stageViewSchema),
  })),
})
/** Client view of all simulations of one Session. */
export type ProjectionView = z.infer<typeof projectionViewSchema>
