import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { chartEdit, chartNames, chartTabNote, findCharts, insertChartEdit } from '../../../shared/charts'
import { motionOn } from '../tabs/tabStyles'
import { chartProblem, drawChart, type ChartDrawing } from './chartEngine'
import {
  chartTabTitle,
  chartUi,
  expectChartSource,
  keepChartUi,
  lastChartPosition,
  onChartNote,
  rememberChart,
  resolveChart,
  type ChartBridge
} from './chartTabs'
import {
  back,
  carryWalk,
  choices,
  choose,
  currentNode,
  graphFromModel,
  restart,
  startWalk,
  walked,
  type WalkGraph,
  type WalkState
} from './walk'

// A chart's own tab (docs/plans/flow-charts.md): the chart large, a walk along the bottom, and
// its text behind a button. The tab holds a working copy; the note is the truth. Every save
// finds the block again first, and your typing is never overwritten while it is on its way.

type Good = Extract<ChartDrawing, { ok: true }>

const norm = (s: string): string => s.replace(/\r\n?/g, '\n').replace(/\n+$/, '')
const titleOf = (note: string): string => (note.split('/').pop() ?? '').replace(/\.md$/i, '') || 'Note'
const SAVE_AFTER_MS = 350
const DRAW_AFTER_MS = 90
const ZOOM_MIN = 0.2
const ZOOM_MAX = 4

interface Camera {
  x: number
  y: number
  scale: number
  moved: boolean
}

export function ChartView({ path, bridge }: { path: string; bridge: ChartBridge }): React.JSX.Element {
  const note = chartTabNote(path)
  const [source, setSource] = useState<string | null>(null)
  const [gone, setGone] = useState(false)
  const [good, setGood] = useState<Good | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [saveFailed, setSaveFailed] = useState(false)
  // Back as you left them when the tab returns from another column or from behind another tab.
  const [textOpen, setTextOpen] = useState(() => chartUi(path).textOpen)
  const [walk, setWalk] = useState<WalkState | null>(() => chartUi(path).walk)
  const [percent, setPercent] = useState(100)

  const pathRef = useRef(path)
  pathRef.current = path
  const noteRef = useRef(note)
  noteRef.current = note
  const bridgeRef = useRef(bridge)
  bridgeRef.current = bridge
  const sourceRef = useRef<string | null>(null)
  /** Typed here and not yet in the note. While it is set, the note can't overwrite the panel. */
  const pending = useRef<string | null>(null)
  const saving = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // --- reading the note --------------------------------------------------------------
  const sync = useCallback(async (given?: string): Promise<void> => {
    const at = noteRef.current
    let text = given
    if (text === undefined) {
      try {
        text = await bridgeRef.current.read(() => noteRef.current)
      } catch {
        return // The note going away closes this tab (App); nothing to do here.
      }
    }
    if (noteRef.current !== at || pending.current !== null) return
    const charts = findCharts(text)
    const index = resolveChart(pathRef.current, charts)
    if (index === null) {
      setGone(true)
      return
    }
    setGone(false)
    if (rememberChart(pathRef.current, charts, index, chartNames(charts, titleOf(at))[index])) bridgeRef.current.named()
    const next = charts[index].source
    if (sourceRef.current === null || norm(sourceRef.current) !== next) {
      sourceRef.current = next
      setSource(next)
    }
  }, [])

  useEffect(() => {
    void sync()
    return onChartNote(note, (text) => void sync(text))
  }, [note, sync])

  // --- saving into the note ----------------------------------------------------------
  const save = useCallback(async (): Promise<void> => {
    if (saving.current) return
    const next = pending.current
    if (next === null) return
    saving.current = true
    const tab = pathRef.current
    let ok = false
    let refused = false
    try {
      ok = await bridgeRef.current.edit(() => noteRef.current, (text) => {
        const charts = findCharts(text)
        const i = resolveChart(tab, charts)
        if (i === null) {
          refused = true
          return null
        }
        expectChartSource(tab, norm(next))
        return chartEdit(charts[i], next)
      })
    } catch {
      ok = false
    }
    saving.current = false
    if (ok) setSaveFailed(false)
    if (refused) {
      pending.current = null
      setGone(true)
      return
    }
    if (!ok) {
      // Keep the text and say so. The next keystroke, or leaving the tab, tries again.
      setSaveFailed(true)
      return
    }
    if (pending.current === next) pending.current = null
    else if (pending.current !== null) void save()
  }, [])

  // Whatever is still waiting goes in when the tab closes or moves on.
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      void save()
    },
    [save]
  )

  const onType = (value: string): void => {
    sourceRef.current = value
    setSource(value)
    pending.current = value
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void save(), SAVE_AFTER_MS)
  }

  const putBack = async (): Promise<void> => {
    const text = sourceRef.current
    if (text === null) return
    const clean = norm(text)
    expectChartSource(path, clean)
    const ok = await bridge
      .edit(() => noteRef.current, (now) => insertChartEdit(now, lastChartPosition(pathRef.current), clean))
      .catch(() => false)
    if (ok) {
      setSaveFailed(false)
      void sync()
    } else setSaveFailed(true)
  }

  // --- drawing -----------------------------------------------------------------------
  useEffect(() => {
    if (source === null) return
    let stale = false
    const t = setTimeout(() => {
      void drawChart(norm(source)).then((d) => {
        if (stale) return
        if (d.ok) {
          setGood(d)
          setProblem(null)
        } else setProblem(chartProblem(d))
      })
    }, DRAW_AFTER_MS)
    return () => {
      stale = true
      clearTimeout(t)
    }
  }, [source])

  const graph: WalkGraph | null = useMemo(() => (good?.flow ? graphFromModel(good.flow) : null), [good])
  useEffect(() => {
    // Nothing drawn yet: leave the walk this tab came back with alone.
    if (!good) return
    setWalk((w) => (!graph ? null : w ? carryWalk(graph, w) : startWalk(graph)))
  }, [good, graph])

  useEffect(() => keepChartUi(path, { walk, textOpen }), [path, walk, textOpen])

  // --- the picture, and moving round it ----------------------------------------------
  const canvas = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const camera = useRef<Camera>({ x: 0, y: 0, scale: 1, moved: false })
  const size = useRef({ w: 0, h: 0 })

  const applyCamera = useCallback((): void => {
    const el = stage.current
    if (!el) return
    const c = camera.current
    el.style.left = `${Math.round(c.x)}px`
    el.style.top = `${Math.round(c.y)}px`
    const svg = el.querySelector('svg')
    if (svg) {
      // Sized rather than scaled, so the words stay sharp at any zoom.
      svg.style.width = `${size.current.w * c.scale}px`
      svg.style.height = `${size.current.h * c.scale}px`
    }
    setPercent(Math.round(c.scale * 100))
  }, [])

  const fit = useCallback((): void => {
    const box = canvas.current
    const { w, h } = size.current
    if (!box || !w || !h) return
    const room = 48
    const scale = Math.min(Math.max(box.clientWidth - room, 40) / w, Math.max(box.clientHeight - room, 40) / h, 1.25)
    camera.current = {
      scale,
      x: (box.clientWidth - w * scale) / 2,
      y: (box.clientHeight - h * scale) / 2,
      moved: false
    }
    applyCamera()
  }, [applyCamera])

  useLayoutEffect(() => {
    const el = stage.current
    if (!el || !good) return
    el.innerHTML = good.svg
    const svg = el.querySelector('svg')
    if (svg) {
      svg.removeAttribute('width')
      svg.removeAttribute('height')
      svg.style.maxWidth = 'none'
      svg.style.display = 'block'
    }
    size.current = { w: good.width, h: good.height }
    if (camera.current.moved) applyCamera()
    else fit()
  }, [good, fit, applyCamera])

  useEffect(() => {
    const box = canvas.current
    if (!box) return
    const watch = new ResizeObserver(() => {
      if (!camera.current.moved) fit()
    })
    watch.observe(box)
    return () => watch.disconnect()
  }, [fit])

  const zoomBy = useCallback(
    (factor: number, atX?: number, atY?: number): void => {
      const box = canvas.current
      if (!box) return
      const c = camera.current
      const scale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, c.scale * factor))
      const px = atX ?? box.clientWidth / 2
      const py = atY ?? box.clientHeight / 2
      camera.current = {
        scale,
        x: px - ((px - c.x) / c.scale) * scale,
        y: py - ((py - c.y) / c.scale) * scale,
        moved: true
      }
      applyCamera()
    },
    [applyCamera]
  )

  // Added by hand so it can stop the page: a sideways scroll here must not swipe to another space.
  useEffect(() => {
    const box = canvas.current
    if (!box) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        const r = box.getBoundingClientRect()
        zoomBy(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top)
        return
      }
      const c = camera.current
      camera.current = { ...c, x: c.x - e.deltaX, y: c.y - e.deltaY, moved: true }
      applyCamera()
    }
    box.addEventListener('wheel', onWheel, { passive: false })
    return () => box.removeEventListener('wheel', onWheel)
  }, [zoomBy, applyCamera])

  const drag = useRef<{ id: number; x: number; y: number } | null>(null)
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const c = camera.current
    camera.current = { ...c, x: c.x + e.clientX - d.x, y: c.y + e.clientY - d.y, moved: true }
    drag.current = { ...d, x: e.clientX, y: e.clientY }
    applyCamera()
  }
  const endDrag = (): void => {
    drag.current = null
  }

  // --- the walk on the picture ---------------------------------------------------------
  useLayoutEffect(() => {
    const el = stage.current
    if (!el) return
    el.querySelectorAll('.is-here, .is-walked').forEach((n) => n.classList.remove('is-here', 'is-walked'))
    if (!walk) return
    const seen = walked(walk)
    const byId = (cls: string, id: string): Element[] => [...el.querySelectorAll(`.${cls}[data-id="${CSS.escape(id)}"]`)]
    for (const id of seen.nodes) byId('pele-node', id).forEach((n) => n.classList.add('is-walked'))
    for (const id of seen.edges) {
      byId('pele-edge', id).forEach((n) => n.classList.add('is-walked'))
      byId('pele-edge-label', id).forEach((n) => n.classList.add('is-walked'))
    }
    const here = currentNode(walk)
    const box = canvas.current
    const node = here ? byId('pele-node', here)[0] : null
    if (!node || !box) return
    node.classList.add('is-here')
    // Keep the lit box on screen as you walk a chart bigger than the window.
    const r = node.getBoundingClientRect()
    const b = box.getBoundingClientRect()
    const margin = 32
    if (r.left < b.left + margin || r.right > b.right - margin || r.top < b.top + margin || r.bottom > b.bottom - margin) {
      const c = camera.current
      camera.current = {
        ...c,
        x: c.x + (b.left + b.width / 2) - (r.left + r.width / 2),
        y: c.y + (b.top + b.height / 2) - (r.top + r.height / 2),
        moved: true
      }
      if (stage.current && motionOn()) {
        const s = stage.current
        s.classList.add('chart-following')
        setTimeout(() => s.classList.remove('chart-following'), 220)
      }
      applyCamera()
    }
  }, [walk, good, applyCamera])

  // --- the walk's controls ---------------------------------------------------------------
  const options = graph && walk ? choices(graph, walk) : []
  const here = graph && walk ? graph.nodes.get(currentNode(walk) ?? '') : undefined
  const step = walk?.path.length ?? 0
  const take = (i: number): void => {
    const c = options[i]
    if (c && graph && walk) setWalk(choose(graph, walk, c.edge.id, c.edge.to))
  }
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if ((e.target as HTMLElement).closest('textarea') || e.metaKey || e.ctrlKey || e.altKey) return
    if (!walk) return
    if (/^[1-9]$/.test(e.key)) {
      if (options[Number(e.key) - 1]) {
        e.preventDefault()
        take(Number(e.key) - 1)
      }
    } else if (e.key === 'Enter' && options.length === 1 && !(e.target as HTMLElement).closest('button')) {
      e.preventDefault()
      take(0)
    } else if (e.key === 'ArrowLeft' || e.key === 'Backspace') {
      e.preventDefault()
      setWalk(back(walk))
    }
  }

  const otherStarts = graph && step === 1 ? graph.starts.filter((s) => s !== currentNode(walk as WalkState)) : []
  const name = chartTabTitle(path)

  return (
    <div className="chart-view" onKeyDown={onKeyDown} tabIndex={-1} aria-label={name}>
      <div className="chart-bar">
        <button
          type="button"
          className={'chart-btn' + (textOpen ? ' on' : '')}
          aria-pressed={textOpen}
          data-tip="Show or hide this chart’s text"
          onClick={() => setTextOpen((o) => !o)}
        >
          Text
        </button>
        <div className="chart-zoom">
          <button type="button" className="chart-btn" aria-label="Zoom out" data-tip="Zoom out" onClick={() => zoomBy(1 / 1.25)}>
            −
          </button>
          <span className="chart-percent">{percent}%</span>
          <button type="button" className="chart-btn" aria-label="Zoom in" data-tip="Zoom in" onClick={() => zoomBy(1.25)}>
            +
          </button>
          <button type="button" className="chart-btn" data-tip="Fit the whole chart" onClick={fit}>
            Fit
          </button>
        </div>
      </div>

      {gone && (
        <div className="chart-line" role="status">
          <span>No longer in this note.</span>
          <button type="button" className="chart-btn" onClick={() => void putBack()}>
            Put back
          </button>
        </div>
      )}
      {!gone && problem && (
        <div className="chart-line chart-line-problem" role="status">
          {problem}
        </div>
      )}
      {saveFailed && (
        <div className="chart-line chart-line-problem" role="alert">
          Couldn’t save this change to the note. Your text is still here.
        </div>
      )}

      <div className="chart-main">
        {textOpen && (
          <textarea
            className="chart-text"
            aria-label="Chart text"
            spellCheck={false}
            readOnly={gone}
            value={source ?? ''}
            onChange={(e) => onType(e.target.value)}
          />
        )}
        <div
          ref={canvas}
          className={'chart-canvas' + (problem || gone ? ' chart-dim' : '')}
          tabIndex={0}
          aria-label="Chart picture"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <div ref={stage} className="chart-stage chart-svg" />
        </div>
      </div>

      {graph && walk && here && (
        <div className="chart-walk" role="group" aria-label="Walk through this chart">
          <div className="chart-walk-here" aria-live="polite">
            <span className="chart-walk-step">Step {step}</span>
            <span className="chart-walk-box">{here.label}</span>
          </div>
          <div className="chart-walk-ways">
            {options.length === 0 && <span className="chart-walk-end">End of this path</span>}
            {options.map((o, i) => (
              <button key={`${o.edge.id}-${o.edge.to}`} type="button" className="chart-way" onClick={() => take(i)}>
                {o.label}
              </button>
            ))}
            {otherStarts.length > 0 && (
              <span className="chart-walk-starts">
                <span>Or start at</span>
                {otherStarts.slice(0, 4).map((id) => (
                  <button key={id} type="button" className="chart-btn" onClick={() => graph && setWalk(startWalk(graph, id))}>
                    {graph.nodes.get(id)?.label ?? id}
                  </button>
                ))}
              </span>
            )}
          </div>
          <div className="chart-walk-nav">
            <button type="button" className="chart-btn" disabled={step < 2} onClick={() => setWalk(back(walk))}>
              Back
            </button>
            <button type="button" className="chart-btn" disabled={step < 2} onClick={() => setWalk(restart(walk))}>
              Restart
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
