/**
 * 天问星 Web client: below the Turn that ended or reviewed a simulation stage,
 * a card shows the stage's dialogue, the counterpart's inner thoughts beside
 * each exchange, and the evaluation report. The `tianwenStar` projection seals
 * transcripts until their stage has ended, so the card never appears earlier.
 *
 * The host concatenates client modules into one classic script, so every
 * binding stays inside this function scope.
 */
;(() => {
const ZH = {
  brand: '天问星复盘',
  'tab.dialogue': '沟通记录',
  'tab.thoughts': '内心想法',
  'tab.report': '评估报告',
  you: '你',
  opening: '开场',
  round: '第 {n} 轮',
  innerThought: '{name}心里想',
  'signal.plus': '加分',
  'signal.minus': '踩雷',
  'signal.neutral': '中性',
  impression: '印象 {n}',
  trigger: '触发：「{text}」',
  trajectory: '印象变化',
  none: '无',
  better: '更好的说法：{text}',
  verdict: '结论',
  likelihood: '成功概率',
  duration: '用时',
  minutes: '{used}/{limit} 分钟',
  talkShare: '你的发言占比',
  signals: '加分/踩雷',
  signalCounts: '{plus} / {minus}',
  comment: '{name}的内部评语',
  dimensions: '维度评分',
  weight: '权重 {n}',
  evidence: '证据：{text}',
  landmines: '踩雷时刻',
  highlights: '加分时刻',
  improvements: '改进建议',
  nextSteps: '下一步准备',
}

const EN = {
  brand: 'Tianwen review',
  'tab.dialogue': 'Dialogue',
  'tab.thoughts': 'Inner thoughts',
  'tab.report': 'Evaluation',
  you: 'You',
  opening: 'Opening',
  round: 'Round {n}',
  innerThought: '{name} thought',
  'signal.plus': 'Gained',
  'signal.minus': 'Landmine',
  'signal.neutral': 'Neutral',
  impression: 'Impression {n}',
  trigger: 'Triggered by "{text}"',
  trajectory: 'Impression over time',
  none: 'None',
  better: 'Better: {text}',
  verdict: 'Verdict',
  likelihood: 'Likelihood',
  duration: 'Time',
  minutes: '{used}/{limit} min',
  talkShare: 'Your talk share',
  signals: 'Gained/landmines',
  signalCounts: '{plus} / {minus}',
  comment: "{name}'s internal notes",
  dimensions: 'Dimension scores',
  weight: 'Weight {n}',
  evidence: 'Evidence: {text}',
  landmines: 'Landmines',
  highlights: 'Highlights',
  improvements: 'Improvements',
  nextSteps: 'Prepare next',
}

const STYLE = `
.tw-root { display: flex; flex-direction: column; gap: 12px; margin: 8px 0; }
.tw-card { border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg, 12px); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); overflow: hidden; }
.tw-card-head { display: flex; align-items: center; gap: 8px; padding: 10px 14px; cursor: pointer; list-style: none; flex-wrap: wrap; }
.tw-card-head::-webkit-details-marker { display: none; }
.tw-brand { font-weight: 600; }
.tw-title { flex: 1 1 200px; min-width: 0; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tw-badge { padding: 2px 8px; border-radius: 999px; font-size: 12px; border: 1px solid currentColor; white-space: nowrap; }
.tw-grade-A, .tw-grade-B { color: var(--dsw-alias-state-success-primary); }
.tw-grade-C { color: var(--dsw-alias-state-warn-primary); }
.tw-grade-D { color: var(--dsw-alias-state-error-primary); }
.tw-tabs { display: flex; gap: 4px; padding: 0 14px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.tw-tab { appearance: none; background: none; border: 0; border-bottom: 2px solid transparent; padding: 8px 10px; color: var(--dsw-alias-label-secondary); cursor: pointer; font: inherit; }
.tw-tab-active { color: var(--dsw-alias-label-primary); border-bottom-color: currentColor; font-weight: 600; }
.tw-panel { padding: 12px 14px; max-height: 560px; overflow: auto; }
.tw-list { display: flex; flex-direction: column; gap: 10px; }
.tw-line { display: flex; flex-direction: column; gap: 2px; max-width: 88%; }
.tw-line-user { align-self: flex-end; text-align: right; }
.tw-who { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.tw-said { margin: 0; padding: 8px 10px; border-radius: var(--dsw-radius-md, 8px); background: var(--dsw-alias-bg-module-platform, var(--dsw-alias-card-fill)); white-space: pre-wrap; text-align: left; }
.tw-line-user .tw-said { background: var(--dsw-alias-state-business-tertiary, var(--dsw-alias-card-fill)); }
.tw-exchange { display: flex; flex-direction: column; gap: 6px; padding-bottom: 10px; border-bottom: 1px dashed var(--dsw-alias-border-l2); }
.tw-exchange-head { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-tertiary); }
.tw-thought { border-left: 3px solid var(--dsw-alias-border-l3, var(--dsw-alias-border-l2)); padding: 6px 10px; border-radius: var(--dsw-radius-md, 8px); background: var(--dsw-alias-card-fill); }
.tw-signal-plus { border-left-color: var(--dsw-alias-state-success-primary); background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 7%, transparent); }
.tw-signal-minus { border-left-color: var(--dsw-alias-state-error-primary); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 6%, transparent); }
.tw-thought-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.tw-chip { padding: 0 6px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2); }
.tw-signal-plus .tw-chip-signal { color: var(--dsw-alias-state-success-primary); border-color: currentColor; }
.tw-signal-minus .tw-chip-signal { color: var(--dsw-alias-state-error-primary); border-color: currentColor; }
.tw-impression { display: inline-flex; align-items: center; gap: 4px; margin-left: auto; }
.tw-meter { display: inline-block; width: 64px; height: 4px; border-radius: 2px; background: var(--dsw-alias-border-l1); overflow: hidden; vertical-align: middle; }
.tw-meter > span { display: block; height: 100%; background: currentColor; }
.tw-thought-text { margin: 4px 0 0; font-style: italic; white-space: pre-wrap; }
.tw-trigger { margin: 4px 0 0; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.tw-report { display: flex; flex-direction: column; gap: 12px; }
.tw-score-row { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
.tw-score strong { font-size: 32px; line-height: 1; }
.tw-score span { margin-left: 4px; }
.tw-facts { display: grid; grid-template-columns: auto auto; gap: 2px 10px; margin: 0; font-size: 13px; }
.tw-facts dt { color: var(--dsw-alias-label-tertiary); }
.tw-facts dd { margin: 0; }
.tw-trajectory { margin: 0; }
.tw-trajectory svg { width: 240px; height: 48px; }
.tw-trajectory figcaption { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.tw-midline { stroke: var(--dsw-alias-border-l2); stroke-dasharray: 3 3; }
.tw-polyline { fill: none; stroke: var(--dsw-alias-label-secondary); stroke-width: 2; }
.tw-section h4 { margin: 0 0 6px; font-size: 14px; }
.tw-section p, .tw-section ul, .tw-section ol { margin: 0; }
.tw-section ul, .tw-section ol { padding-left: 18px; display: flex; flex-direction: column; gap: 6px; }
.tw-dimensions { list-style: none; padding-left: 0 !important; gap: 12px !important; }
.tw-dimensions li { display: flex; flex-direction: column; gap: 4px; }
.tw-dimension-head { display: flex; gap: 8px; align-items: baseline; }
.tw-dimension-head strong { margin-left: auto; }
.tw-dimensions .tw-meter { width: 100%; color: var(--dsw-alias-label-secondary); }
.tw-muted { color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.tw-better { margin-top: 2px; color: var(--dsw-alias-state-success-primary); }
`

window.__ModuleLoader__.load({
  id: 'dsh-tianwen-star',
  factory(require) {
    // The 0.2 module system inventories tagged <style> elements a factory adds while it materializes.
    if (document.querySelector('style[data-plugin="dsh-tianwen-star"]') === null) {
      const style = document.createElement('style')
      style.setAttribute('data-plugin', 'dsh-tianwen-star')
      style.setAttribute('data-plugin-css', 'dsh-tianwen-star/style.css')
      style.textContent = STYLE
      document.head.appendChild(style)
    }
    const React = require('react')
    const h = React.createElement

    function Tabs({ tab, setTab, t }) {
      const item = (id) => h('button', {
        type: 'button',
        role: 'tab',
        'aria-selected': tab === id,
        className: 'tw-tab' + (tab === id ? ' tw-tab-active' : ''),
        onClick: () => setTab(id),
      }, t('tab.' + id))
      return h('div', { role: 'tablist', className: 'tw-tabs' }, item('dialogue'), item('thoughts'), item('report'))
    }

    function Line({ who, text, mine }) {
      return h('div', { className: 'tw-line' + (mine ? ' tw-line-user' : '') },
        h('span', { className: 'tw-who' }, who),
        h('p', { className: 'tw-said' }, text))
    }

    function Dialogue({ stage, t }) {
      return h('div', { className: 'tw-list' }, stage.exchanges.flatMap(exchange => [
        exchange.userText === null ? null : h(Line, { key: exchange.index + 'u', who: t('you'), text: exchange.userText, mine: true }),
        h(Line, { key: exchange.index + 'c', who: stage.counterpartName, text: exchange.reply, mine: false }),
      ]))
    }

    function Thoughts({ stage, t }) {
      return h('div', { className: 'tw-list' }, stage.exchanges.map(exchange => h('div', { key: exchange.index, className: 'tw-exchange' },
        h('div', { className: 'tw-exchange-head' }, exchange.index === 0 ? t('opening') : t('round', { n: exchange.index })),
        exchange.userText === null ? null : h(Line, { who: t('you'), text: exchange.userText, mine: true }),
        h(Line, { who: stage.counterpartName, text: exchange.reply, mine: false }),
        h('div', { className: 'tw-thought tw-signal-' + (exchange.userText === null ? 'neutral' : exchange.signal) },
          h('div', { className: 'tw-thought-head' },
            h('span', null, t('innerThought', { name: stage.counterpartName })),
            exchange.mood ? h('span', { className: 'tw-chip' }, exchange.mood) : null,
            exchange.userText === null ? null : h('span', { className: 'tw-chip tw-chip-signal' }, t('signal.' + exchange.signal)),
            h('span', { className: 'tw-impression' }, t('impression', { n: exchange.impression }),
              h('span', { className: 'tw-meter', 'aria-hidden': true }, h('span', { style: { width: exchange.impression + '%' } })))),
          h('p', { className: 'tw-thought-text' }, exchange.innerThought),
          exchange.trigger ? h('p', { className: 'tw-trigger' }, t('trigger', { text: exchange.trigger })) : null))))
    }

    function Trajectory({ exchanges, t }) {
      if (exchanges.length < 2) return null
      const width = 240
      const height = 48
      const step = width / (exchanges.length - 1)
      const points = exchanges.map((exchange, index) => `${Math.round(index * step)},${Math.round(height - exchange.impression / 100 * height)}`).join(' ')
      return h('figure', { className: 'tw-trajectory' },
        h('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': t('trajectory') },
          h('line', { x1: 0, x2: width, y1: height / 2, y2: height / 2, className: 'tw-midline' }),
          h('polyline', { points, className: 'tw-polyline' })),
        h('figcaption', null, t('trajectory')))
    }

    function Moments({ title, items, better, t }) {
      return h('section', { className: 'tw-section' },
        h('h4', null, title),
        items.length === 0
          ? h('p', { className: 'tw-muted' }, t('none'))
          : h('ul', null, items.map((item, index) => h('li', { key: index },
            h('span', { className: 'tw-muted' }, t('round', { n: item.exchange }) + ' '),
            item.quote ? h('q', null, item.quote) : null,
            h('span', null, ' ' + item.why),
            better && item.better ? h('div', { className: 'tw-better' }, t('better', { text: item.better })) : null))))
    }

    function Report({ stage, t }) {
      const e = stage.evaluation
      const m = e.metrics
      return h('div', { className: 'tw-report' },
        h('div', { className: 'tw-score-row' },
          h('div', { className: 'tw-score tw-grade-' + e.grade }, h('strong', null, e.totalScore), h('span', null, '/100 · ' + e.grade)),
          h('dl', { className: 'tw-facts' },
            h('dt', null, t('verdict')), h('dd', null, e.verdict),
            h('dt', null, t('likelihood')), h('dd', null, e.likelihood + '%'),
            h('dt', null, t('duration')), h('dd', null, t('minutes', { used: m.durationMinutes, limit: m.timeLimitMinutes })),
            h('dt', null, t('talkShare')), h('dd', null, Math.round(m.userTalkShare * 100) + '%'),
            h('dt', null, t('signals')), h('dd', null, t('signalCounts', { plus: m.plusCount, minus: m.minusCount })))),
        h(Trajectory, { exchanges: stage.exchanges, t }),
        h('section', { className: 'tw-section' }, h('h4', null, t('comment', { name: stage.counterpartName })), h('p', null, e.inCharacterComment)),
        h('section', { className: 'tw-section' },
          h('h4', null, t('dimensions')),
          h('ul', { className: 'tw-dimensions' }, e.dimensions.map(d => h('li', { key: d.key },
            h('div', { className: 'tw-dimension-head' },
              h('span', null, d.name), h('span', { className: 'tw-muted' }, t('weight', { n: d.weight })), h('strong', null, d.score + '/5')),
            h('span', { className: 'tw-meter', 'aria-hidden': true }, h('span', { style: { width: d.score * 20 + '%' } })),
            d.comment ? h('p', null, d.comment) : null,
            d.evidence ? h('p', { className: 'tw-muted' }, t('evidence', { text: d.evidence })) : null)))),
        h(Moments, { title: t('landmines'), items: e.landmines, better: true, t }),
        h(Moments, { title: t('highlights'), items: e.highlights, better: false, t }),
        h('section', { className: 'tw-section' }, h('h4', null, t('improvements')),
          h('ol', null, e.improvements.map((item, index) => h('li', { key: index }, item)))),
        e.nextSteps ? h('section', { className: 'tw-section' }, h('h4', null, t('nextSteps')), h('p', null, e.nextSteps)) : null)
    }

    function StageCard({ simulation, stage, t }) {
      const [tab, setTab] = React.useState('dialogue')
      const body = tab === 'dialogue' ? h(Dialogue, { stage, t }) : tab === 'thoughts' ? h(Thoughts, { stage, t }) : h(Report, { stage, t })
      return h('details', { className: 'tw-card', open: true, 'data-tianwen-stage': simulation.id + '/' + stage.id },
        h('summary', { className: 'tw-card-head' },
          h('span', { className: 'tw-brand' }, t('brand')),
          h('span', { className: 'tw-title' }, simulation.title + ' · ' + stage.name + ' · ' + stage.counterpartName + '（' + stage.counterpartTitle + '）'),
          h('span', { className: 'tw-badge tw-grade-' + stage.evaluation.grade }, stage.evaluation.totalScore + ' · ' + stage.evaluation.verdict)),
        h(Tabs, { tab, setTab, t }),
        h('div', { role: 'tabpanel', className: 'tw-panel' }, body))
    }

    function TianwenReview({ turn, useProjection, t }) {
      const view = useProjection('tianwenStar')
      if (view === undefined || turn.end === undefined) return null
      const cards = []
      for (const simulation of view.simulations) {
        for (const stage of simulation.stages) {
          if (stage.exchanges !== null && stage.evaluation !== null && stage.revealTurns.includes(turn.turn)) {
            cards.push(h(StageCard, { key: simulation.id + '/' + stage.id, simulation, stage, t }))
          }
        }
      }
      return cards.length === 0 ? null : h('div', { className: 'tw-root' }, cards)
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register('tianwenStar', { zh: ZH, en: EN }))
        ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
          name: 'conversation.chat.turnTail', id: 'dsh-tianwen-star', order: 30, locale: 'tianwenStar',
        }, TianwenReview))
      },
    }
  },
})
})()
