import { describe, expect, it } from 'vitest'
import { parse, register } from 'pele/core'
import flowchart from 'pele/diagrams/flowchart'
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
  type FlowModel,
  type WalkState
} from './walk'

register(flowchart)

// Real charts through the real parser, never a hand-made model (the shape is the drawing tool's).
const graph = (text: string) => graphFromModel(parse(text) as unknown as FlowModel)
const go = (g: ReturnType<typeof graph>, w: WalkState, label: string): WalkState => {
  const c = choices(g, w).find((x) => x.label === label)
  if (!c) throw new Error(`no choice "${label}" in ${choices(g, w).map((x) => x.label).join(', ')}`)
  return choose(g, w, c.edge.id, c.edge.to)
}

const REVISE = `flowchart TD
  A[Start] --> B{Revised?}
  B -->|Yes| C[Do a test]
  B -->|No| D[Read notes]
  D --> B
  C --> E((Done))
`

describe('a walk', () => {
  it('starts at the box nothing points to', () => {
    const g = graph(REVISE)
    expect(currentNode(startWalk(g))).toBe('A')
  })

  it('offers the arrow labels at a decision', () => {
    const g = graph(REVISE)
    const w = go(g, startWalk(g), 'Revised?')
    expect(choices(g, w).map((c) => c.label)).toEqual(['Yes', 'No'])
  })

  it('names an unlabelled arrow after the box it leads to', () => {
    const g = graph(REVISE)
    expect(choices(g, startWalk(g)).map((c) => c.label)).toEqual(['Revised?'])
  })

  it('walks a loop as many times as you like, and Back retraces it', () => {
    const g = graph(REVISE)
    let w = go(g, startWalk(g), 'Revised?')
    w = go(g, w, 'No')
    w = go(g, w, 'Revised?')
    w = go(g, w, 'No')
    expect(currentNode(w)).toBe('D')
    expect(w.path).toHaveLength(5)
    w = back(w)
    expect(currentNode(w)).toBe('B')
    w = back(w)
    expect(currentNode(w)).toBe('D')
  })

  it('reaches an end with nowhere to go', () => {
    const g = graph(REVISE)
    let w = go(g, startWalk(g), 'Revised?')
    w = go(g, w, 'Yes')
    w = go(g, w, 'Done')
    expect(choices(g, w)).toEqual([])
  })

  it('Back at the start and Restart at the start change nothing', () => {
    const g = graph(REVISE)
    const w = startWalk(g)
    expect(back(w)).toBe(w)
    expect(restart(w)).toBe(w)
  })

  it('Restart returns to the box you started from', () => {
    const g = graph(REVISE)
    const w = go(g, go(g, startWalk(g, 'B'), 'Yes'), 'Done')
    expect(currentNode(restart(w))).toBe('B')
  })

  it('marks the boxes and arrows you walked', () => {
    const g = graph(REVISE)
    const w = go(g, go(g, startWalk(g), 'Revised?'), 'No')
    const seen = walked(w)
    expect([...seen.nodes]).toEqual(['A', 'B', 'D'])
    expect(seen.edges.size).toBe(2)
  })

  it('ignores an arrow that does not leave the current box', () => {
    const g = graph(REVISE)
    const w = startWalk(g)
    expect(choose(g, w, 'L_C_E_0')).toBe(w)
  })
})

describe('awkward charts', () => {
  it('begins a chart that is one loop at the first box', () => {
    const g = graph('flowchart TD\n  A --> B\n  B --> C\n  C --> A\n')
    expect(g.starts).toEqual(['A'])
  })

  it('prefers a start that leads somewhere over a loose box', () => {
    const g = graph('flowchart TD\n  Loose\n  A --> B\n')
    expect(g.starts).toEqual(['A', 'Loose'])
  })

  it('does not count a box pointing at itself as having a way in', () => {
    const g = graph('flowchart TD\n  A --> A\n  A --> B\n')
    expect(g.starts[0]).toBe('A')
  })

  it('skips invisible spacing links', () => {
    const g = graph('flowchart TD\n  A ~~~ B\n  A --> C\n')
    expect(choices(g, startWalk(g, 'A')).map((c) => c.label)).toEqual(['C'])
  })

  it('walks a two-way arrow in both directions', () => {
    const g = graph('flowchart LR\n  A <--> B\n')
    expect(choices(g, startWalk(g, 'A')).map((c) => c.edge.to)).toEqual(['B'])
    expect(choices(g, startWalk(g, 'B')).map((c) => c.edge.to)).toEqual(['A'])
  })

  it('follows a plain line with no arrowhead the way it was written', () => {
    const g = graph('flowchart LR\n  A --- B\n')
    expect(choices(g, startWalk(g, 'A')).map((c) => c.edge.to)).toEqual(['B'])
  })

  it('splits one written arrow to several boxes', () => {
    const g = graph('flowchart TD\n  A --> B & C\n')
    expect(choices(g, startWalk(g)).map((c) => c.edge.to)).toEqual(['B', 'C'])
  })

  it('walks two arrows to the same box as two choices', () => {
    const g = graph('flowchart TD\n  A -->|one| B\n  A -->|two| B\n')
    const w = startWalk(g)
    expect(choices(g, w).map((c) => c.label)).toEqual(['one', 'two'])
    const second = choices(g, w)[1]
    expect(choose(g, w, second.edge.id, second.edge.to).path[1].edge).toBe(second.edge.id)
  })

  it('enters a group at its first box and leaves from its last', () => {
    const g = graph(`flowchart TD
  A --> S
  subgraph S [Group]
    X --> Y
  end
  S --> Z
`)
    expect(g.nodes.has('S')).toBe(false)
    expect(choices(g, startWalk(g)).map((c) => c.edge.to)).toEqual(['X'])
    expect(choices(g, startWalk(g, 'Y')).map((c) => c.edge.to)).toEqual(['Z'])
  })

  it('reads a label written with a line break or tags', () => {
    const g = graph('flowchart TD\n  A["First<br/>line"] --> B["<b>Bold</b> box"]\n')
    expect(g.nodes.get('A')?.label).toBe('First line')
    expect(g.nodes.get('B')?.label).toBe('Bold box')
  })
})

describe('editing the chart mid-walk', () => {
  it('keeps your place when the chart still has that path', () => {
    const g = graph(REVISE)
    const w = go(g, go(g, startWalk(g), 'Revised?'), 'No')
    const next = graph(REVISE.replace('Read notes', 'Read them again'))
    expect(currentNode(carryWalk(next, w))).toBe('D')
  })

  it('steps back to the last box that still exists', () => {
    const g = graph(REVISE)
    const w = go(g, go(g, startWalk(g), 'Revised?'), 'No')
    const next = graph('flowchart TD\n  A[Start] --> B{Revised?}\n  B -->|Yes| C[Do a test]\n')
    expect(currentNode(carryWalk(next, w))).toBe('B')
  })

  it('starts again if nothing from the walk survives', () => {
    const g = graph(REVISE)
    const w = go(g, startWalk(g), 'Revised?')
    const next = graph('flowchart TD\n  P --> Q\n')
    expect(currentNode(carryWalk(next, w))).toBe('P')
  })
})
