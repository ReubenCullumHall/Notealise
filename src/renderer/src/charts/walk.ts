// Walking through a flow chart: which box you're on, which ways you can go, how you got
// here. Pure, with no screen and no drawing tool in it. A walk lives only in the open tab
// and never changes the note (Reuben, 2026-11-22).

export interface WalkNode {
  id: string
  label: string
}

export interface WalkEdge {
  /** The id the drawing carries on this arrow, to light it. */
  id: string
  from: string
  to: string
  label: string
}

export interface WalkGraph {
  nodes: Map<string, WalkNode>
  /** Arrows leaving each box, in the order the chart wrote them. */
  out: Map<string, WalkEdge[]>
  /** Boxes a walk can sensibly start from, best first. */
  starts: string[]
}

/** The parts of the drawing tool's flow chart this needs. */
export interface FlowModel {
  nodes: ReadonlyMap<string, { id: string; text?: string }>
  edges: readonly { id?: string; start: string; end: string; text?: string; type?: string; stroke?: string }[]
  subgraphs?: readonly { id: string; nodes: readonly string[]; title?: string }[]
}

/** Box text as a person reads it: the line breaks and tags a label may be written with go. */
const readable = (t: string | undefined): string =>
  (t ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

export function graphFromModel(model: FlowModel): WalkGraph {
  const groups = new Map((model.subgraphs ?? []).map((s) => [s.id, s]))
  const nodes = new Map<string, WalkNode>()
  for (const n of model.nodes.values()) {
    if (groups.has(n.id)) continue
    nodes.set(n.id, { id: n.id, label: readable(n.text) || n.id })
  }

  // The arrows as drawn, without the invisible spacing links (`~~~`).
  const raw = model.edges.filter((e) => e.stroke !== 'invisible')

  /** Every real box inside a group, through groups nested in it. */
  const inside = (id: string, seen = new Set<string>()): string[] => {
    const g = groups.get(id)
    if (!g || seen.has(id)) return nodes.has(id) ? [id] : []
    seen.add(id)
    return g.nodes.flatMap((m) => inside(m, seen))
  }
  const within = (a: string, members: Set<string>, way: 'start' | 'end'): boolean =>
    raw.some((e) => (way === 'end' ? e.end === a && members.has(e.start) : e.start === a && members.has(e.end)))

  /** An arrow into a group enters at its first box with nothing leading to it from inside. */
  const entry = (id: string): string[] => {
    if (!groups.has(id)) return nodes.has(id) ? [id] : []
    const members = inside(id)
    const set = new Set(members)
    const first = members.find((m) => !within(m, set, 'end')) ?? members[0]
    return first ? [first] : []
  }
  /** An arrow out of a group leaves from each of its boxes with no way on inside it. */
  const exits = (id: string): string[] => {
    if (!groups.has(id)) return nodes.has(id) ? [id] : []
    const members = inside(id)
    const set = new Set(members)
    const last = members.filter((m) => !within(m, set, 'start'))
    return last.length ? last : members.slice(-1)
  }

  const out = new Map<string, WalkEdge[]>()
  const add = (from: string, to: string, id: string, label: string): void => {
    const list = out.get(from) ?? []
    list.push({ id, from, to, label })
    out.set(from, list)
  }
  raw.forEach((e, i) => {
    const id = e.id ?? `edge-${i}`
    const label = readable(e.text)
    for (const from of exits(e.start)) for (const to of entry(e.end)) add(from, to, id, label)
    // `A <--> B` goes both ways.
    if (e.type?.startsWith('double_')) {
      for (const from of exits(e.end)) for (const to of entry(e.start)) add(from, to, id, label)
    }
  })

  const incoming = new Set<string>()
  for (const list of out.values()) for (const e of list) if (e.from !== e.to) incoming.add(e.to)
  const ids = [...nodes.keys()]
  const leads = (id: string): boolean => (out.get(id) ?? []).some((e) => e.to !== id)
  // A box nothing points at, preferring one that goes somewhere over a loose box.
  const open = ids.filter((id) => !incoming.has(id))
  const starts = [...open.filter(leads), ...open.filter((id) => !leads(id))]
  // A chart that is one big loop has no natural start, so it begins at the box written first.
  return { nodes, out, starts: starts.length ? starts : ids.slice(0, 1) }
}

export interface WalkStep {
  node: string
  /** The arrow taken to reach this box. */
  edge: string | null
}

export interface WalkState {
  /** Every step so far. The last one is where you are. */
  path: WalkStep[]
}

export function startWalk(graph: WalkGraph, from?: string): WalkState {
  const node = from && graph.nodes.has(from) ? from : graph.starts[0]
  return { path: node ? [{ node, edge: null }] : [] }
}

export const currentNode = (w: WalkState): string | null => w.path[w.path.length - 1]?.node ?? null

export interface WalkChoice {
  edge: WalkEdge
  /** What its button says: the arrow's label, else the box it leads to. */
  label: string
}

export function choices(graph: WalkGraph, w: WalkState): WalkChoice[] {
  const here = currentNode(w)
  if (here === null) return []
  return (graph.out.get(here) ?? []).map((edge) => ({
    edge,
    label: edge.label || graph.nodes.get(edge.to)?.label || edge.to
  }))
}

/** Take an arrow out of the current box. An arrow that doesn't leave it changes nothing. */
export function choose(graph: WalkGraph, w: WalkState, edgeId: string, to?: string): WalkState {
  const pick = choices(graph, w).find((c) => c.edge.id === edgeId && (to === undefined || c.edge.to === to))
  if (!pick) return w
  return { path: [...w.path, { node: pick.edge.to, edge: pick.edge.id }] }
}

export const back = (w: WalkState): WalkState => (w.path.length > 1 ? { path: w.path.slice(0, -1) } : w)

export const restart = (w: WalkState): WalkState => (w.path.length > 1 ? { path: w.path.slice(0, 1) } : w)

/** Boxes and arrows already walked, for marking your path on the drawing. */
export function walked(w: WalkState): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set<string>()
  const edges = new Set<string>()
  for (const s of w.path) {
    nodes.add(s.node)
    if (s.edge) edges.add(s.edge)
  }
  return { nodes, edges }
}

/** Keep a walk across an edit of the chart: as much of the path as still exists. */
export function carryWalk(graph: WalkGraph, w: WalkState): WalkState {
  const kept: WalkStep[] = []
  for (const s of w.path) {
    if (!graph.nodes.has(s.node)) break
    if (kept.length) {
      const prev = kept[kept.length - 1].node
      const still = (graph.out.get(prev) ?? []).find((e) => e.to === s.node && e.id === s.edge)
        ?? (graph.out.get(prev) ?? []).find((e) => e.to === s.node)
      if (!still) break
      kept.push({ node: s.node, edge: still.id })
    } else {
      kept.push({ node: s.node, edge: null })
    }
  }
  return kept.length ? { path: kept } : startWalk(graph)
}
