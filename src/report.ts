/**
 * Model-visible Markdown of 天问星 tool results: the evaluation report with
 * the full transcript and inner thoughts, and the status overview.
 * @module dsh-tianwen-star/report
 */

import type { Evaluation, Exchange, ProjectionState, SimulationState, StageSpec, StageState } from './model.js'

const SIGNAL_LABEL = { plus: '加分', minus: '踩雷', neutral: '中性' } as const

const END_REASON_LABEL = {
  counterpart: '角色结束了对话',
  time: '时间到',
  user: '用户结束',
  limit: '达到轮次上限',
} as const

function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function cell(text: string): string {
  return text.replaceAll('|', '\\|').replaceAll(/\r?\n/gu, ' ')
}

/**
 * Transcript with inner thoughts, one section per exchange.
 * @param spec - stage plan naming the counterpart.
 * @param exchanges - opening plus answered turns.
 * @returns Markdown lines.
 */
export function transcriptMarkdown(spec: StageSpec, exchanges: readonly Exchange[]): string[] {
  const name = spec.counterpart.name
  const lines: string[] = []
  for (const exchange of exchanges) {
    lines.push(`### 第 ${exchange.index} 轮${exchange.userText === null ? '（开场）' : ''}`)
    if (exchange.userText !== null) lines.push(`- 你说：${exchange.userText}`)
    lines.push(`- ${name}说：${exchange.reply}`)
    const signal = exchange.userText === null ? '' : ` · ${SIGNAL_LABEL[exchange.signal]}`
    const trigger = exchange.trigger.length > 0 ? ` · 触发：「${exchange.trigger}」` : ''
    lines.push(`- ${name}心里想：${exchange.innerThought}（${exchange.mood || '无明显情绪'} · 印象 ${exchange.impression}${signal}${trigger}）`)
  }
  return lines
}

/**
 * Complete report of one ended stage.
 * @param spec - stage plan.
 * @param stage - ended stage state.
 * @param evaluation - the stage's evaluation.
 * @returns Markdown text.
 */
export function stageReport(spec: StageSpec, stage: StageState, evaluation: Evaluation): string {
  const { counterpart } = spec
  const m = evaluation.metrics
  const lines = [
    `# 「${spec.name}」评估报告：${counterpart.name}（${counterpart.title}）`,
    '',
    `**总分 ${evaluation.totalScore}/100（${evaluation.grade}）** · 结论：${evaluation.verdict} · ${counterpart.name}估计的成功概率 ${evaluation.likelihood}%`,
    '',
    `用时 ${m.durationMinutes}/${m.timeLimitMinutes} 分钟 · 结束原因：${stage.endReason === null ? '未知' : END_REASON_LABEL[stage.endReason]} · 你发言 ${m.userTurns} 次 · 发言占比 ${percent(m.userTalkShare)} · 平均每次 ${m.averageAnswerChars} 字 · 印象 ${m.impressionStart} → ${m.impressionEnd}（最低 ${m.impressionLow}，最高 ${m.impressionHigh}）· 加分 ${m.plusCount} 次 · 踩雷 ${m.minusCount} 次`,
    '',
    `## ${counterpart.name}的内部评语`,
    evaluation.inCharacterComment,
    '',
    '## 维度评分',
    '| 维度 | 权重 | 得分 | 证据 | 评价 |',
    '| --- | --- | --- | --- | --- |',
    ...evaluation.dimensions.map(d => `| ${cell(d.name)} | ${d.weight} | ${d.score}/5 | ${cell(d.evidence)} | ${cell(d.comment)} |`),
    '',
    '## 加分时刻',
    ...evaluation.highlights.length === 0
      ? ['- 无']
      : evaluation.highlights.map(h => `- 第 ${h.exchange} 轮「${h.quote}」：${h.why}`),
    '',
    '## 踩雷时刻',
    ...evaluation.landmines.length === 0
      ? ['- 无']
      : evaluation.landmines.map(l => `- 第 ${l.exchange} 轮「${l.quote}」：${l.why}\n  - 更好的说法：${l.better}`),
    '',
    '## 改进建议',
    ...evaluation.improvements.map((item, index) => `${index + 1}. ${item}`),
    '',
    '## 下一步准备',
    evaluation.nextSteps,
    '',
    '## 沟通记录与内心想法',
    ...transcriptMarkdown(spec, stage.exchanges),
  ]
  return lines.join('\n')
}

function stageLine(simulation: SimulationState, stage: StageState, index: number, now: number): string {
  const spec = simulation.spec.stages[index]
  const name = spec === undefined ? stage.id : `${spec.name}（${spec.counterpart.name}，${spec.timeLimitMinutes} 分钟）`
  switch (stage.status) {
    case 'pending':
      return `  - ${stage.id} ${name}：未开始`
    case 'active': {
      const elapsed = stage.startedAt === null ? 0 : Math.round((now - stage.startedAt) / 6_000) / 10
      return `  - ${stage.id} ${name}：进行中，已用时 ${elapsed} 分钟，${stage.exchanges.length - 1} 轮对话`
    }
    case 'ended': {
      const evaluation = stage.evaluation
      const score = evaluation === null ? '' : `，${evaluation.totalScore} 分（${evaluation.grade}），${evaluation.verdict}`
      return `  - ${stage.id} ${name}：已结束${score}`
    }
  }
}

/**
 * Overview of every simulation in the Session.
 * @param state - projection state.
 * @param now - current Unix epoch milliseconds.
 * @returns Markdown text.
 */
export function statusReport(state: ProjectionState, now: number): string {
  if (state.simulations.length === 0) return '本会话还没有创建任何模拟。'
  return state.simulations.map(simulation => [
    `- ${simulation.spec.id}「${simulation.spec.title}」（${simulation.spec.scenario === 'interview' ? '面试' : '商务洽谈'}）`,
    ...simulation.stages.map((stage, index) => stageLine(simulation, stage, index, now)),
  ].join('\n')).join('\n')
}
