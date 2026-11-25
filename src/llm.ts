/**
 * Auxiliary model calls of 天问星: one system prompt plus one JSON-framed user
 * input, a structured JSON answer, a per-call deadline, and a bounded retry
 * when the answer does not satisfy its schema.
 * @module dsh-tianwen-star/llm
 */

import type { Context } from '@deepseek-ai/cordis'
import { BlockAssembler, createUserMessage, HarnessError } from '@deepseek-ai/dsh-llm'
import type { ContextFormed, GenerateOptions, LlmResolvedModelInfo, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/dsh-llm/types' {
  interface LlmRequestPurposeMap {
    'tianwen-star': true
  }
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'tianwen-star': { kind: 'tianwen-star' } & ContextFormed
  }
}

/** Stable failure codes of 天问星 tools. */
export type TianwenErrorCode =
  | 'TIANWEN_NO_ROUTE'
  | 'TIANWEN_TIMEOUT'
  | 'TIANWEN_MODEL_FAILED'
  | 'TIANWEN_MODEL_OUTPUT_INVALID'
  | 'TIANWEN_STATE'
  | 'TIANWEN_CLOUD_AUTH'
  | 'TIANWEN_CLOUD_UNAVAILABLE'

/** Expected 天问星 tool failure with a stable code. */
export class TianwenError extends HarnessError {
  /**
   * @param message - actionable model-facing description.
   * @param code - stable failure code.
   * @param options - optional cause.
   */
  constructor(message: string, code: TianwenErrorCode, options?: ErrorOptions) {
    super(message, code, options)
  }
}

/** Which reasoning effort an auxiliary call selects on routes that support several. */
export type ReasoningChoice = 'lowest' | 'default' | 'highest'

/** Execution controls of one kind of auxiliary call. */
export interface CallControls {
  /** Output-token cap, reasoning included. */
  readonly maxOutputTokens: number
  /** End-to-end deadline of one attempt in milliseconds. */
  readonly timeoutMs: number
  /** Reasoning effort selection. */
  readonly reasoning: ReasoningChoice
}

/** Explicit route, or undefined to reuse the Session's logged conversation route. */
export interface RouteOverride {
  readonly provider: string
  readonly model: string
}

/** Parsed result of one structured call. */
export interface StructuredResult<T> {
  readonly value: T
  /** Route that produced the value. */
  readonly route: RouteOverride
}

function selectEffort(model: Readonly<LlmResolvedModelInfo>, choice: ReasoningChoice): ReasoningEffortId | undefined {
  const efforts = model.reasoning?.efforts
  if (efforts === undefined || efforts.length === 0 || choice === 'default') return undefined
  return choice === 'lowest' ? efforts[0]?.id : efforts.at(-1)?.id
}

/**
 * Resolve the route of an auxiliary call.
 * @param session - Session whose conversation route is reused.
 * @param override - explicit route, if configured.
 * @returns the route.
 * @throws {TianwenError} when no route is configured or logged yet.
 */
export function resolveRoute(session: Session, override: RouteOverride | undefined): RouteOverride {
  if (override !== undefined) return override
  const config = session.requestHeader()?.config
  if (config === undefined) {
    throw new TianwenError('No model route is logged for this Session yet; configure provider and model on the tianwen-coach row.', 'TIANWEN_NO_ROUTE')
  }
  return { provider: config.provider, model: config.model }
}

/**
 * Extract the outermost JSON object from model text, tolerating code fences
 * and prose around it.
 * @param text - raw model text.
 * @returns the parsed value, or undefined when no JSON object parses.
 */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch (_error: unknown) {
    // Not JSON: the caller retries or reports invalid output.
    return undefined
  }
}

/** Inputs of one structured auxiliary call. */
export interface StructuredCall<T> {
  readonly session: Session
  readonly route: RouteOverride
  readonly controls: CallControls
  readonly system: string
  readonly input: string
  /** Attempts after the first when the answer does not parse; 0 disables retry. */
  readonly retries: number
  /** Converts parsed JSON into the result, returning a reason string when it is unusable. */
  readonly accept: (value: unknown) => T | string
  readonly signal: AbortSignal
}

/**
 * Run one structured auxiliary call.
 * @param ctx - context exposing `ctx.llm`.
 * @param call - prompt, route, controls, acceptance, and cancellation.
 * @returns the accepted value and route.
 * @throws {TianwenError} on timeout, model failure, or an answer that never satisfies `accept`.
 */
export async function callStructured<T>(ctx: Context, call: StructuredCall<T>): Promise<StructuredResult<T>> {
  let lastProblem = ''
  for (let attempt = 0; attempt <= call.retries; attempt += 1) {
    const input = attempt === 0
      ? call.input
      : `${call.input}\n\n上一次的输出不符合协议（${lastProblem}）。这一次只输出一个符合协议的 JSON 对象。`
    const text = await generateText(ctx, call, input)
    const parsed = extractJson(text)
    if (parsed === undefined) {
      lastProblem = '没有可解析的 JSON 对象'
      continue
    }
    const accepted = call.accept(parsed)
    if (typeof accepted !== 'string') return { value: accepted, route: call.route }
    lastProblem = accepted
  }
  throw new TianwenError(`The counterpart model did not return valid structured output: ${lastProblem}. Retry the tool call.`, 'TIANWEN_MODEL_OUTPUT_INVALID')
}

async function generateText<T>(ctx: Context, call: StructuredCall<T>, input: string): Promise<string> {
  call.signal.throwIfAborted()
  const timeout = AbortSignal.timeout(call.controls.timeoutMs)
  const signal = AbortSignal.any([call.signal, timeout])
  try {
    const prepared = await ctx.llm.prepareCall(
      { ...call.route, maxTokens: call.controls.maxOutputTokens },
      signal,
      (controls, model) => {
        const effort = selectEffort(model, call.controls.reasoning)
        return { ...controls, ...effort === undefined ? {} : { reasoningEffort: effort } }
      },
    )
    const options: GenerateOptions = {
      ...prepared.config,
      messages: [createUserMessage({ content: [{ type: 'text', text: input }], source: { kind: 'tianwen-star' } })],
      system: call.system,
      sessionId: call.session.id,
      purpose: 'tianwen-star',
      signal,
    }
    const assembler = new BlockAssembler()
    for await (const chunk of prepared.stream(options)) {
      signal.throwIfAborted()
      assembler.push(chunk)
    }
    const finish = assembler.finish
    if (finish.kind === 'error' || finish.kind === 'aborted') {
      signal.throwIfAborted()
      throw new TianwenError(`The counterpart model call failed: ${finish.failure.message}`, 'TIANWEN_MODEL_FAILED')
    }
    return assembler.blocks().flatMap(block => block.type === 'text' ? [block.text] : []).join('')
  } catch (error: unknown) {
    if (timeout.aborted && !call.signal.aborted) {
      throw new TianwenError(`The counterpart model did not answer within ${call.controls.timeoutMs} ms. Retry the tool call.`, 'TIANWEN_TIMEOUT', { cause: error })
    }
    throw error
  }
}
