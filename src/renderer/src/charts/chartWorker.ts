// Draws charts away from the window. The drawing tool has no time limit of its own, and a
// chart is a note's content, so a chart that takes forever must never be able to freeze typing:
// here, chartEngine.ts can stop it. The app's own font is loaded so boxes are sized for the
// words as they will really look.

import { detectType, load, parse, render, type RenderOptions } from 'pele/lazy'
import inter400 from '../assets/fonts/inter-400.woff2?url'

export interface ChartJob {
  id: number
  source: string
}

export type ChartReply =
  | {
      id: number
      ok: true
      svg: string
      width: number
      height: number
      boxes: number | null
      flow: {
        nodes: { id: string; text?: string }[]
        edges: { id?: string; start: string; end: string; text?: string; type?: string; stroke?: string }[]
        subgraphs: { id: string; nodes: string[]; title?: string }[]
      } | null
    }
  | { id: number; ok: false; code: string; line: number | null; column: number | null }

// Pictures and links are off: a chart can't reach the disk, a network share or the web.
const OPTIONS: RenderOptions = {
  images: false,
  links: false,
  maxEdges: 500,
  limit: 50_000,
  fontFamily: 'Inter'
}

interface WorkerScope {
  fonts: FontFaceSet
  onmessage: ((e: MessageEvent<ChartJob>) => void) | null
  postMessage(message: ChartReply): void
}
const scope = self as unknown as WorkerScope

const font = (async () => {
  try {
    const face = new FontFace('Inter', `url("${new URL(inter400, import.meta.url).href}")`, { weight: '400' })
    scope.fonts.add(face)
    await face.load()
  } catch {
    // Boxes are then sized for a fallback font: slightly off, never broken.
  }
})()

async function draw({ id, source }: ChartJob): Promise<ChartReply> {
  await font
  try {
    const type = detectType(source)
    if (!type || !(await load(type))) return { id, ok: false, code: 'unknown-type', line: null, column: null }
    const r = render(source, OPTIONS)
    if (type !== 'flowchart') {
      return { id, ok: true, svg: r.svg, width: r.width, height: r.height, boxes: null, flow: null }
    }
    const m = parse(source, OPTIONS) as unknown as {
      nodes: Map<string, { id: string; text?: string }>
      edges: { id?: string; start: string; end: string; text?: string; type?: string; stroke?: string }[]
      subgraphs: { id: string; nodes: string[]; title?: string }[]
    }
    const flow = {
      nodes: [...m.nodes.values()].map((n) => ({ id: n.id, text: n.text })),
      edges: m.edges.map((e) => ({ id: e.id, start: e.start, end: e.end, text: e.text, type: e.type, stroke: e.stroke })),
      subgraphs: m.subgraphs.map((s) => ({ id: s.id, nodes: [...s.nodes], title: s.title }))
    }
    const groups = new Set(flow.subgraphs.map((s) => s.id))
    const boxes = flow.nodes.filter((n) => !groups.has(n.id)).length
    return { id, ok: true, svg: r.svg, width: r.width, height: r.height, boxes, flow }
  } catch (e) {
    const err = e as { code?: string; line?: number; column?: number }
    return { id, ok: false, code: err.code ?? 'failed', line: err.line ?? null, column: err.column ?? null }
  }
}

scope.onmessage = (e) => {
  void draw(e.data).then((reply) => scope.postMessage(reply))
}
