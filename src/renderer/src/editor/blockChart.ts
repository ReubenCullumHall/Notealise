import { EditorSelection, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import { chartNames } from '../../../shared/charts'
import { chartProblem, drawChart } from '../charts/chartEngine'
import { blockAt, pickFromClick, addsToPick } from './blockPick'
import { chartsField } from './chartsField'
import { linkEnv, linkHandlersFacet, setLinkEnv } from './linkEnv'
import { isRaw } from './rawView'
import { depthOfLine, findToggles, hiddenLine } from './toggleModel'

// A Mermaid chart in a note, drawn as a card (docs/plans/flow-charts.md). The file keeps its
// standard ```mermaid block; the card is only how it looks here. It is a block like a formula or
// a table (docs/feature-done-checklist.md section 9): one thing on screen, picked whole, with its
// text showing only in Markdown pro. blockGuard.ts keeps the cursor off its lines.
//
// The card is a fixed height. Its picture arrives a moment after the note opens, and a block
// that grew then would throw every line below it off where the editor thinks it is.

const titleOfPath = (path: string): string => (path.split('/').pop() ?? '').replace(/\.md$/i, '') || 'Note'

/** Which chart in the note a position is inside. */
function chartIndexAt(state: EditorState, pos: number): number {
  return state.field(chartsField).findIndex((c) => pos >= c.from && pos <= c.to)
}

class ChartCardWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly name: string,
    readonly depth: number
  ) {
    super()
  }

  eq(other: ChartCardWidget): boolean {
    return other.source === this.source && other.name === this.name && other.depth === this.depth
  }

  get estimatedHeight(): number {
    return 224
  }

  toDOM(view: EditorView): HTMLElement {
    const frame = document.createElement('div')
    frame.className = 'cm-block-frame'
    const outer = document.createElement('div')
    outer.className = 'cm-chart'
    const card = document.createElement('div')
    card.className = 'cm-chart-card'
    card.setAttribute('role', 'group')

    const picture = document.createElement('div')
    picture.className = 'cm-chart-picture chart-svg'
    const foot = document.createElement('div')
    foot.className = 'cm-chart-foot'
    const name = document.createElement('span')
    name.className = 'cm-chart-name'
    const count = document.createElement('span')
    count.className = 'cm-chart-count'
    const open = document.createElement('button')
    open.type = 'button'
    open.className = 'cm-chart-open'
    open.textContent = 'Open'
    open.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      let pos: number
      try {
        pos = view.posAtDOM(frame)
      } catch {
        return
      }
      const index = chartIndexAt(view.state, pos)
      const path = view.state.field(linkEnv).path
      if (index >= 0 && path) view.state.facet(linkHandlersFacet)?.current?.openChart?.(path, index)
    })
    foot.append(name, count, open)
    card.append(picture, foot)
    outer.append(card)
    frame.append(outer)

    // A press on the card picks it, as a press on a picture does. Its button keeps its own click.
    card.addEventListener(
      'mousedown',
      (e) => {
        if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
        e.preventDefault()
        e.stopPropagation()
        let pos: number
        try {
          pos = view.posAtDOM(frame)
        } catch {
          return
        }
        const block = blockAt(view.state, pos)
        if (block.from === block.to) return
        if ((addsToPick(e) || e.shiftKey) && pickFromClick(view, e, block)) return
        view.dispatch({ selection: EditorSelection.single(block.from, block.to), userEvent: 'select.pick' })
        view.focus()
      },
      true
    )
    this.fill(frame)
    return frame
  }

  updateDOM(dom: HTMLElement): boolean {
    if (!dom.querySelector('.cm-chart-card')) return false
    this.fill(dom)
    return true
  }

  private fill(frame: HTMLElement): void {
    const outer = frame.querySelector<HTMLElement>('.cm-chart')!
    const card = frame.querySelector<HTMLElement>('.cm-chart-card')!
    const picture = frame.querySelector<HTMLElement>('.cm-chart-picture')!
    const count = frame.querySelector<HTMLElement>('.cm-chart-count')!
    frame.querySelector<HTMLElement>('.cm-chart-name')!.textContent = this.name
    frame.querySelector<HTMLElement>('.cm-chart-open')!.setAttribute('aria-label', `Open ${this.name}`)
    card.setAttribute('aria-label', this.name)
    outer.classList.toggle('cm-in-toggle', this.depth > 0)
    if (this.depth) outer.style.setProperty('--toggle-depth', String(this.depth))
    else outer.style.removeProperty('--toggle-depth')

    const source = this.source
    if (card.dataset.source === source) return
    card.dataset.source = source
    void drawChart(source).then((d) => {
      // The chart was edited while this drawing was on its way.
      if (card.dataset.source !== source) return
      if (d.ok) {
        card.classList.remove('cm-chart-broken')
        picture.innerHTML = d.svg
        const svg = picture.querySelector('svg')
        if (svg) {
          svg.removeAttribute('width')
          svg.removeAttribute('height')
          svg.style.width = '100%'
          svg.style.height = '100%'
          svg.style.maxWidth = `${d.width}px`
          svg.style.maxHeight = `${d.height}px`
        }
        count.textContent = d.boxes === null ? '' : d.boxes === 1 ? '1 box' : `${d.boxes} boxes`
      } else {
        card.classList.add('cm-chart-broken')
        picture.textContent = d.failure === 'empty' ? chartProblem(d) : 'Can’t draw this chart.'
        count.textContent = ''
      }
    })
  }

  ignoreEvent(): boolean {
    return true
  }
}

function build(state: EditorState): DecorationSet {
  if (isRaw(state)) return Decoration.none // Markdown pro shows the text
  const charts = state.field(chartsField)
  if (!charts.length) return Decoration.none
  const names = chartNames(charts, titleOfPath(state.field(linkEnv).path))
  const toggles = findToggles(state)
  const out = []
  for (let i = 0; i < charts.length; i++) {
    const c = charts[i]
    const line = state.doc.lineAt(c.from).number
    // Inside a shut toggle the toggle hides its lines.
    if (hiddenLine(toggles, line)) continue
    out.push(
      Decoration.replace({
        widget: new ChartCardWidget(c.source, names[i], depthOfLine(toggles, line)),
        block: true
      }).range(c.from, c.to)
    )
  }
  return Decoration.set(out, true)
}

const chartCards = StateField.define<DecorationSet>({
  create: build,
  update(value, tr) {
    const pathChanged = tr.effects.some((e) => e.is(setLinkEnv)) && tr.startState.field(linkEnv).path !== tr.state.field(linkEnv).path
    if (!tr.docChanged && !tr.reconfigured && !pathChanged) return value
    if (!tr.state.field(chartsField).length && value === Decoration.none) return value
    return build(tr.state)
  },
  provide: (f) => EditorView.decorations.from(f)
})

export const blockChart: Extension = [chartsField, chartCards]
