/**
 * Acceptance of counterpart and evaluator model answers. Model JSON is an
 * untrusted boundary: unusable answers return a reason the retry prompt
 * reports back to the model.
 * @module dsh-tianwen-star/answers
 */

import { z } from 'zod'
import type { Evaluation, Metrics, Scenario, StageSpec } from './model.js'
import { gradeOf, totalScore, verdictLabel } from './rubric.js'

const clampedInt = (min: number, max: number, fallback: number) =>
  z.coerce.number().catch(fallback).transform(value => Math.min(max, Math.max(min, Math.round(value))))

const personaAnswerSchema = z.object({
  inner_thought: z.string().trim().min(1),
  mood: z.string().catch(''),
  impression: clampedInt(0, 100, 50),
  signal: z.enum(['plus', 'minus', 'neutral']).catch('neutral'),
  trigger: z.string().catch(''),
  reply: z.string().trim().min(1),
  end: z.boolean().catch(false),
})

/** One accepted counterpart answer. */
export type PersonaAnswer = z.infer<typeof personaAnswerSchema>

function describe(error: z.ZodError): string {
  return error.issues.slice(0, 3).map(issue => `${issue.path.join('.') || '根对象'}: ${issue.message}`).join('; ')
}

/**
 * Accept one counterpart answer.
 * @param value - parsed model JSON.
 * @returns the answer, or the reason it is unusable.
 */
export function acceptPersona(value: unknown): PersonaAnswer | string {
  const parsed = personaAnswerSchema.safeParse(value)
  return parsed.success ? parsed.data : describe(parsed.error)
}

const evaluatorAnswerSchema = z.object({
  verdict_level: clampedInt(1, 5, 3),
  likelihood: clampedInt(0, 100, 50),
  in_character_comment: z.string().trim().min(1),
  dimensions: z.array(z.object({
    key: z.string(),
    score: clampedInt(1, 5, 3),
    evidence: z.string().catch(''),
    comment: z.string().catch(''),
  })),
  highlights: z.array(z.object({
    exchange: clampedInt(0, 10_000, 0),
    quote: z.string().catch(''),
    why: z.string().catch(''),
  })).catch([]),
  landmines: z.array(z.object({
    exchange: clampedInt(0, 10_000, 0),
    quote: z.string().catch(''),
    why: z.string().catch(''),
    better: z.string().catch(''),
  })).catch([]),
  improvements: z.array(z.string()).catch([]),
  next_steps: z.string().catch(''),
})

/**
 * Create the acceptance function of one stage evaluation. Scores, the grade,
 * and the verdict label are computed here from the rubric, never taken from the model.
 * @param scenario - simulation scenario.
 * @param spec - stage plan with its rubric.
 * @param metrics - deterministic transcript metrics.
 * @returns a function accepting parsed evaluator JSON.
 */
export function evaluationAcceptor(scenario: Scenario, spec: StageSpec, metrics: Metrics): (value: unknown) => Evaluation | string {
  return value => {
    const parsed = evaluatorAnswerSchema.safeParse(value)
    if (!parsed.success) return describe(parsed.error)
    const answer = parsed.data
    const byKey = new Map(answer.dimensions.map(item => [item.key, item]))
    const missing = spec.rubric.filter(dimension => !byKey.has(dimension.key)).map(dimension => dimension.key)
    if (missing.length > 0) return `dimensions 缺少 key：${missing.join('、')}`
    const dimensions = spec.rubric.map(dimension => {
      const scored = byKey.get(dimension.key)
      return {
        key: dimension.key,
        name: dimension.name,
        weight: dimension.weight,
        score: scored?.score ?? 3,
        evidence: scored?.evidence ?? '',
        comment: scored?.comment ?? '',
      }
    })
    const total = totalScore(dimensions)
    return {
      verdictLevel: answer.verdict_level,
      verdict: verdictLabel(scenario, answer.verdict_level),
      likelihood: answer.likelihood,
      inCharacterComment: answer.in_character_comment,
      dimensions,
      totalScore: total,
      grade: gradeOf(total),
      highlights: answer.highlights.map(item => ({ ...item, better: '' })),
      landmines: answer.landmines,
      improvements: answer.improvements,
      nextSteps: answer.next_steps,
      metrics,
    }
  }
}
