/**
 * Evaluation methodology: default behaviorally anchored rubrics, verdict
 * scales, weighted scoring, grades, and transcript metrics.
 *
 * Interview rubrics follow the structured-interview practice of
 * competency dimensions scored against behavioral anchors (BARS) with
 * evidence; business rubrics follow consultative-selling stages (discovery,
 * value, credibility, objections, rapport, advancing the deal).
 * @module dsh-tianwen-star/rubric
 */

import type { Exchange, Grade, Metrics, RubricDimension, Scenario } from './model.js'

/** Default interview rubric. */
export const INTERVIEW_RUBRIC: readonly RubricDimension[] = [
  {
    key: 'expertise',
    name: '岗位专业能力',
    weight: 30,
    description: '与 JD 要求相关的知识、技能深度与实战经验',
    anchors: {
      low: '概念含糊或答错，经验与岗位要求明显不匹配',
      mid: '能正确回答核心问题，有相关经验但深度一般',
      high: '理解深入、能讲清原理与取舍，经验高度匹配且有超出要求的亮点',
    },
  },
  {
    key: 'problem-solving',
    name: '分析与解决问题',
    weight: 20,
    description: '拆解问题、权衡方案、在约束下做决策的能力',
    anchors: {
      low: '思路跳跃，无法拆解问题或只给结论',
      mid: '能给出合理方案，考虑了主要约束',
      high: '结构化拆解、主动比较多种方案并说明取舍与风险',
    },
  },
  {
    key: 'evidence',
    name: '成果与证据（STAR）',
    weight: 15,
    description: '用具体情境、任务、行动、结果和量化数据支撑自己的说法',
    anchors: {
      low: '只有空泛描述或口号，没有具体案例',
      mid: '有案例但细节或个人贡献不够清晰',
      high: '案例完整、个人行动清楚、结果可量化且可信',
    },
  },
  {
    key: 'communication',
    name: '沟通表达',
    weight: 15,
    description: '听懂问题、结论先行、简洁有条理、与面试官互动',
    anchors: {
      low: '答非所问、冗长或频繁卡壳',
      mid: '基本清楚，偶有冗余或偏题',
      high: '结论先行、层次分明、根据追问灵活调整',
    },
  },
  {
    key: 'motivation-fit',
    name: '动机与文化匹配',
    weight: 10,
    description: '求职动机、对公司和岗位的理解、价值观与团队匹配度',
    anchors: {
      low: '动机模糊或只谈薪资，对公司缺乏了解',
      mid: '动机合理，对公司有基本了解',
      high: '动机真诚且与岗位发展高度契合，对公司业务有独到理解',
    },
  },
  {
    key: 'professionalism',
    name: '职业素养与应变',
    weight: 10,
    description: '压力下的情绪稳定、诚实、礼貌，以及反问的质量',
    anchors: {
      low: '紧张失态、夸大或回避问题、没有反问',
      mid: '表现得体，能应对一般追问',
      high: '从容自信、诚实面对短板，反问有洞察',
    },
  },
]

/** Default business-negotiation rubric. */
export const BUSINESS_RUBRIC: readonly RubricDimension[] = [
  {
    key: 'discovery',
    name: '需求洞察',
    weight: 20,
    description: '通过提问挖掘对方的痛点、目标、预算、时间表与决策链',
    anchors: {
      low: '一上来就推销，几乎不了解对方需求',
      mid: '问了一些需求问题，但没挖到痛点或决策信息',
      high: '用有层次的提问摸清痛点、影响、预算与决策流程',
    },
  },
  {
    key: 'value',
    name: '价值主张',
    weight: 20,
    description: '把方案与对方的业务目标挂钩，讲清收益与投资回报',
    anchors: {
      low: '只讲功能和自己公司，与对方业务无关',
      mid: '讲到了对方收益，但不具体或缺乏量化',
      high: '价值主张贴合对方目标，有量化 ROI 或可类比的成功案例',
    },
  },
  {
    key: 'credibility',
    name: '专业可信度',
    weight: 15,
    description: '行业理解、方案专业度、交付能力与成功案例的说服力',
    anchors: {
      low: '对行业或技术一知半解，承诺不可信',
      mid: '方案基本专业，有一定案例',
      high: '专业判断让对方信服，案例和交付保障具体可信',
    },
  },
  {
    key: 'objections',
    name: '异议处理',
    weight: 15,
    description: '面对价格、风险、竞品、时间等质疑时的回应质量',
    anchors: {
      low: '回避、争辩或轻易让步',
      mid: '能回应质疑但说服力一般',
      high: '先确认顾虑，再用证据与方案化解，守住关键条件',
    },
  },
  {
    key: 'rapport',
    name: '沟通与关系',
    weight: 15,
    description: '倾听、尊重对方身份和时间、说话方式与对方层级匹配',
    anchors: {
      low: '打断对方、说教或过度推销，让人反感',
      mid: '礼貌得体，但互动平淡',
      high: '让对方感到被理解和尊重，建立了信任感',
    },
  },
  {
    key: 'advance',
    name: '推进与收尾',
    weight: 15,
    description: '争取明确的下一步：会议、试点、报价、时间表与对接人',
    anchors: {
      low: '没有提出任何下一步，谈话不了了之',
      mid: '提出了下一步但不具体或对方未承诺',
      high: '与对方达成具体、有时间点和责任人的下一步',
    },
  },
]

/** Verdict labels for levels 1-5 of each scenario. */
export const VERDICT_SCALES: Readonly<Record<Scenario, readonly [string, string, string, string, string]>> = {
  interview: ['强烈不推荐', '不推荐', '待定', '推荐通过', '强烈推荐'],
  business: ['无合作意向', '观望', '有兴趣了解', '有意推进', '准备签约'],
}

/**
 * Default rubric of a scenario.
 * @param scenario - simulation scenario.
 * @returns a detached copy of the default dimensions.
 */
export function defaultRubric(scenario: Scenario): RubricDimension[] {
  const source = scenario === 'interview' ? INTERVIEW_RUBRIC : BUSINESS_RUBRIC
  return source.map(dimension => ({ ...dimension, anchors: { ...dimension.anchors } }))
}

/**
 * Label of one verdict level.
 * @param scenario - simulation scenario.
 * @param level - integer level 1-5.
 * @returns the scale label.
 */
export function verdictLabel(scenario: Scenario, level: number): string {
  const scale = VERDICT_SCALES[scenario]
  const index = Math.min(5, Math.max(1, Math.round(level))) - 1
  return scale[index] ?? scale[2]
}

/**
 * Weighted rubric score: each 1-5 score maps linearly onto 0-100 and the
 * weights normalize, so a uniform 3 scores 50 and a uniform 5 scores 100.
 * @param scores - dimension weights and integer scores.
 * @returns the rounded total, 0-100.
 */
export function totalScore(scores: readonly { readonly weight: number; readonly score: number }[]): number {
  const weightSum = scores.reduce((sum, item) => sum + item.weight, 0)
  if (weightSum <= 0) return 0
  const weighted = scores.reduce((sum, item) => sum + item.weight * (item.score - 1) / 4, 0)
  return Math.round(weighted / weightSum * 100)
}

/**
 * Letter grade of a total score.
 * @param score - total score, 0-100.
 * @returns A at 85 or above, B at 70, C at 55, otherwise D.
 */
export function gradeOf(score: number): Grade {
  if (score >= 85) return 'A'
  if (score >= 70) return 'B'
  if (score >= 55) return 'C'
  return 'D'
}

/**
 * Measure one stage transcript.
 * @param exchanges - opening plus answered turns, in order.
 * @param startedAt - stage start, Unix epoch milliseconds.
 * @param endedAt - stage end, Unix epoch milliseconds.
 * @param timeLimitMinutes - planned duration.
 * @returns the deterministic metrics.
 */
export function measure(
  exchanges: readonly Exchange[],
  startedAt: number,
  endedAt: number,
  timeLimitMinutes: number,
): Metrics {
  const answered = exchanges.filter(exchange => exchange.userText !== null)
  const userChars = answered.reduce((sum, exchange) => sum + [...(exchange.userText ?? '')].length, 0)
  const counterpartChars = exchanges.reduce((sum, exchange) => sum + [...exchange.reply].length, 0)
  const impressions = exchanges.map(exchange => exchange.impression)
  const spoken = userChars + counterpartChars
  return {
    durationMinutes: round1(Math.max(0, endedAt - startedAt) / 60_000),
    timeLimitMinutes,
    userTurns: answered.length,
    userChars,
    counterpartChars,
    userTalkShare: spoken === 0 ? 0 : round2(userChars / spoken),
    averageAnswerChars: answered.length === 0 ? 0 : Math.round(userChars / answered.length),
    impressionStart: impressions[0] ?? 50,
    impressionEnd: impressions.at(-1) ?? 50,
    impressionLow: impressions.length === 0 ? 50 : Math.min(...impressions),
    impressionHigh: impressions.length === 0 ? 50 : Math.max(...impressions),
    plusCount: answered.filter(exchange => exchange.signal === 'plus').length,
    minusCount: answered.filter(exchange => exchange.signal === 'minus').length,
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
