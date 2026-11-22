// The one door to the drawing tool. Everything else asks for a chart here, so the tool can be
// swapped without touching a note or a screen (docs/plans/flow-charts.md). It is loaded the first
// time a chart is drawn, in a worker, so a note without a chart pays nothing for it.

import DOMPurify from 'dompurify'
import type { ChartJob, ChartReply } from './chartWorker'
import type { FlowModel } from './walk'

export type ChartFailure = 'empty' | 'mistake' | 'too-big' | 'too-slow' | 'unknown-type' | 'failed'

export type ChartDrawing =
  | { ok: true; svg: string; width: number; height: number; boxes: number | null; flow: FlowModel | null }
  | { ok: false; failure: ChartFailure; line: number | null }

/** Long enough for any real chart (500 arrows take under 0.1 s), short enough to notice. */
const TIME_LIMIT_MS = 4000
const CACHE_SIZE = 64

// Its own cleaner: a hook on the shared DOMPurify would also change what Save as keeps.
let purifier: ReturnType<typeof DOMPurify> | null = null
function chartPurifier(): ReturnType<typeof DOMPurify> {
  if (purifier) return purifier
  const purify = DOMPurify(window)
  purify.addHook('uponSanitizeAttribute', (_node, data) => {
    const name = data.attrName.toLowerCase()
    const value = data.attrValue
    // Nothing in a chart may point outside it: no web address, no file, no network share.
    if ((name === 'href' || name === 'xlink:href') && !value.startsWith('#')) data.keepAttr = false
    if (/url\(\s*(?!["']?#)/i.test(value)) data.keepAttr = false
  })
  purifier = purify
  return purify
}

/** The drawing, with anything that could reach outside the chart taken out. Note text decides
 *  what goes in it, and on a packaged app the page's own origin is the whole disk
 *  (docs/security.md), so this runs on every drawing however clean the tool's output looks. */
export function cleanSvg(svg: string): string {
  return chartPurifier().sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['a', 'image', 'foreignObject', 'use', 'script', 'style', 'title', 'animate', 'animateTransform', 'animateMotion', 'set'],
    ADD_ATTR: ['aria-roledescription']
  })
}

interface Job extends ChartJob {
  done: (reply: ChartDrawing) => void
}

let worker: Worker | null = null
let running: Job | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let nextId = 1
const waiting: Job[] = []

function finish(result: ChartDrawing): void {
  if (timer) clearTimeout(timer)
  timer = null
  const job = running
  running = null
  job?.done(result)
  pump()
}

function dropWorker(): void {
  worker?.terminate()
  worker = null
}

function fromReply(r: ChartReply): ChartDrawing {
  if (!r.ok) {
    const failure: ChartFailure =
      r.code === 'syntax' ? 'mistake' : r.code === 'limit' ? 'too-big' : r.code === 'unknown-type' ? 'unknown-type' : 'failed'
    return { ok: false, failure, line: r.line }
  }
  const flow: FlowModel | null = r.flow
    ? { nodes: new Map(r.flow.nodes.map((n) => [n.id, n])), edges: r.flow.edges, subgraphs: r.flow.subgraphs }
    : null
  return { ok: true, svg: cleanSvg(r.svg), width: r.width, height: r.height, boxes: r.boxes, flow }
}

function spawn(): Worker {
  const w = new Worker(new URL('./chartWorker.ts', import.meta.url), { type: 'module' })
  w.onmessage = (e: MessageEvent<ChartReply>) => {
    if (running?.id === e.data.id) finish(fromReply(e.data))
  }
  w.onerror = () => {
    dropWorker()
    finish({ ok: false, failure: 'failed', line: null })
  }
  return w
}

function pump(): void {
  if (running) return
  const job = waiting.shift()
  if (!job) return
  running = job
  worker ??= spawn()
  timer = setTimeout(() => {
    // The only way to stop a drawing that never ends is to end its worker.
    dropWorker()
    finish({ ok: false, failure: 'too-slow', line: null })
  }, TIME_LIMIT_MS)
  worker.postMessage({ id: job.id, source: job.source } satisfies ChartJob)
}

const cache = new Map<string, Promise<ChartDrawing>>()

/** Draw a chart. Asking again for the same text is free. */
export function drawChart(source: string): Promise<ChartDrawing> {
  if (!source.trim()) return Promise.resolve({ ok: false, failure: 'empty', line: null })
  const hit = cache.get(source)
  if (hit) {
    cache.delete(source)
    cache.set(source, hit)
    return hit
  }
  const result = new Promise<ChartDrawing>((done) => {
    waiting.push({ id: nextId++, source, done })
    pump()
  })
  cache.set(source, result)
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string)
  // A slow or failed drawing may go better next time.
  void result.then((d) => {
    if (!d.ok && (d.failure === 'too-slow' || d.failure === 'failed')) cache.delete(source)
  })
  return result
}

/** One plain sentence for a chart that can't be drawn. */
export function chartProblem(d: Extract<ChartDrawing, { ok: false }>): string {
  switch (d.failure) {
    case 'empty':
      return 'Nothing to draw yet.'
    case 'mistake':
      return d.line ? `Line ${d.line} has a mistake, so this chart can’t be drawn.` : 'This chart has a mistake, so it can’t be drawn.'
    case 'too-big':
      return 'This chart has more than 500 arrows, which is too many to draw.'
    case 'too-slow':
      return 'This chart took too long to draw.'
    case 'unknown-type':
      return 'This isn’t a kind of chart that can be drawn here.'
    default:
      return 'This chart couldn’t be drawn.'
  }
}
