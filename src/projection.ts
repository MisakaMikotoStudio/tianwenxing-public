/**
 * The `tianwenStar` session projection: a pure fold of the current turn, the
 * latest human message, and every 天问星 plugin record into simulation state,
 * plus the client view that keeps transcripts and inner thoughts sealed until
 * their stage has ended.
 * @module dsh-tianwen-star/projection
 */

import { pluginRecordOf } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionProjectionSummaryExcluded } from '@deepseek-ai/dsh-session-projection/types'
import {
  RECORD_TYPE,
  metaRecordSchema,
  type MetaRecord,
  type ProjectionState,
  type ProjectionView,
  type SimulationState,
  type StageState,
} from './model.js'

/** Projection key; also the client `useProjection` key. */
export const PROJECTION_KEY = 'tianwenStar'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** 天问星 simulations of the Session; excluded from Session list summaries. */
    tianwenStar: SessionProjectionSummaryExcluded<ProjectionView>
  }
}

/**
 * State of an empty log.
 * @returns a fresh initial state.
 */
export function initialState(): ProjectionState {
  return { currentTurn: 0, latestUser: null, simulations: [] }
}

/**
 * Fold one committed event. Unrelated events return the same reference.
 * @param state - state covering all prior events.
 * @param event - next committed event.
 * @returns the next state.
 */
export function applyEvent(state: ProjectionState, event: SessionEvent): ProjectionState {
  const record = pluginRecordOf(event)
  if (record !== undefined) {
    if (record.type !== RECORD_TYPE) return state
    const parsed = metaRecordSchema.safeParse(record.data)
    return parsed.success ? applyRecord(state, parsed.data, state.currentTurn, record.seq) : state
  }
  switch (event.type) {
    case 'turn/start':
      return { ...state, currentTurn: event.data.turn }
    case 'user/message': {
      if (event.data.source.kind !== 'user') return state
      const text = event.data.content
        .flatMap(block => block.type === 'text' ? [block.text] : [])
        .join('\n')
        .trim()
      if (text.length === 0) return state
      return { ...state, latestUser: { seq: event.seq, text } }
    }
    default:
      return state
  }
}

/**
 * Apply one validated record.
 * @param state - current state.
 * @param record - validated record.
 * @param turn - turn in which the record was written.
 * @param seq - log seq of the record.
 * @returns the next state; the same reference when the record does not apply.
 */
export function applyRecord(state: ProjectionState, record: MetaRecord, turn: number, seq: number): ProjectionState {
  if (record.op === 'create') {
    if (state.simulations.some(simulation => simulation.spec.id === record.simulation.id)) return state
    const created: SimulationState = {
      spec: record.simulation,
      stages: record.simulation.stages.map(stage => ({
        id: stage.id,
        status: 'pending',
        startedAt: null,
        openedSeq: null,
        endedAt: null,
        endReason: null,
        exchanges: [],
        evaluation: null,
        revealTurns: [],
      })),
    }
    return { ...state, simulations: [...state.simulations, created] }
  }
  if (record.op === 'review') {
    return updateSimulation(state, record.simulationId, simulation => {
      let changed = false
      const stages = simulation.stages.map(stage => {
        if (!record.stageIds.includes(stage.id) || stage.status !== 'ended' || stage.revealTurns.includes(turn)) return stage
        changed = true
        return { ...stage, revealTurns: [...stage.revealTurns, turn] }
      })
      return changed ? { ...simulation, stages } : simulation
    })
  }
  return updateStage(state, record.simulationId, record.stageId, stage => {
    switch (record.op) {
      case 'start':
        if (stage.status !== 'pending') return stage
        return { ...stage, status: 'active', startedAt: record.startedAt, openedSeq: seq, exchanges: [record.opening] }
      case 'exchange':
        if (stage.status !== 'active') return stage
        return { ...stage, exchanges: [...stage.exchanges, record.exchange] }
      case 'end':
        if (stage.status !== 'active') return stage
        return {
          ...stage,
          status: 'ended',
          endedAt: record.endedAt,
          endReason: record.reason,
          evaluation: record.evaluation,
          revealTurns: [...stage.revealTurns, turn],
        }
    }
  })
}

function updateSimulation(
  state: ProjectionState,
  simulationId: string,
  update: (simulation: SimulationState) => SimulationState,
): ProjectionState {
  const index = state.simulations.findIndex(simulation => simulation.spec.id === simulationId)
  const current = state.simulations[index]
  if (current === undefined) return state
  const next = update(current)
  if (next === current) return state
  const simulations = [...state.simulations]
  simulations[index] = next
  return { ...state, simulations }
}

function updateStage(
  state: ProjectionState,
  simulationId: string,
  stageId: string,
  update: (stage: StageState) => StageState,
): ProjectionState {
  return updateSimulation(state, simulationId, simulation => {
    const index = simulation.stages.findIndex(stage => stage.id === stageId)
    const current = simulation.stages[index]
    if (current === undefined) return simulation
    const next = update(current)
    if (next === current) return simulation
    const stages = [...simulation.stages]
    stages[index] = next
    return { ...simulation, stages }
  })
}

/**
 * Client view of a state's simulations. Inner thoughts, transcripts, and
 * evaluations of a stage that has not ended never leave the Host.
 * @param simulations - folded simulations.
 * @returns the client view.
 */
export function viewOf(simulations: readonly SimulationState[]): ProjectionView {
  return {
    simulations: simulations.map(simulation => ({
      id: simulation.spec.id,
      scenario: simulation.spec.scenario,
      title: simulation.spec.title,
      stages: simulation.stages.map((stage, index) => {
        const spec = simulation.spec.stages[index]
        const ended = stage.status === 'ended'
        return {
          id: stage.id,
          name: spec?.name ?? stage.id,
          counterpartName: spec?.counterpart.name ?? '',
          counterpartTitle: spec?.counterpart.title ?? '',
          timeLimitMinutes: spec?.timeLimitMinutes ?? 0,
          status: stage.status,
          startedAt: stage.startedAt,
          endedAt: stage.endedAt,
          exchangeCount: stage.exchanges.length,
          revealTurns: stage.revealTurns,
          exchanges: ended ? stage.exchanges : null,
          evaluation: ended ? stage.evaluation : null,
        }
      }),
    })),
  }
}

/**
 * Create a view function that keeps the view reference while the
 * simulations are unchanged, so a new human message alone publishes nothing.
 * @returns the memoized state-to-view function.
 */
export function createViewer(): (state: ProjectionState) => ProjectionView {
  let source: readonly SimulationState[] | undefined
  let view: ProjectionView | undefined
  return state => {
    if (view === undefined || source !== state.simulations) {
      source = state.simulations
      view = viewOf(state.simulations)
    }
    return view
  }
}

/**
 * Find one simulation.
 * @param state - projection state.
 * @param simulationId - simulation id.
 * @returns the simulation, or undefined.
 */
export function findSimulation(state: ProjectionState, simulationId: string): SimulationState | undefined {
  return state.simulations.find(simulation => simulation.spec.id === simulationId)
}

/**
 * The stage currently in progress across all simulations of the Session.
 * @param state - projection state.
 * @returns the simulation and stage, or undefined when none is active.
 */
export function activeStage(state: ProjectionState): { simulation: SimulationState; stage: StageState; index: number } | undefined {
  for (const simulation of state.simulations) {
    const index = simulation.stages.findIndex(stage => stage.status === 'active')
    const stage = simulation.stages[index]
    if (stage !== undefined) return { simulation, stage, index }
  }
  return undefined
}
