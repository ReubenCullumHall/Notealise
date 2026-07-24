import { useState } from 'react'
import { monogram, hexToChannels, type Space } from './model'

// Custom drag type so the rail can tell a space-reorder drag from a note drag
// (notes carry 'text/plain' = their vault path, set by the tree rows).
const SPACE_DND = 'application/x-space'

interface Props {
  spaces: Space[]
  activeName: string
  onSelect: (name: string) => void
  /** right-click a space → colour/rename/delete popover (never for Home). */
  onContext: (e: React.MouseEvent, space: Space) => void
  /** persist a new left-to-right order for the real spaces (Home excluded). */
  onReorder: (orderedNames: string[]) => void
  /** a note was dropped on a space → move it into that space's folder. */
  onDropNote: (fromPath: string, toSpace: string) => void
  /** the trailing "+" → create a new top-level folder (a new space). */
  onNewSpace: () => void
}

/** The Arc-style spaces rail: one icon square per space, pinned at the bottom of
 *  the sidebar. Click or two-finger-swipe (handled in App) to switch; drag to
 *  reorder; drag a note onto a space to move it there. */
export function SpaceRail({
  spaces,
  activeName,
  onSelect,
  onContext,
  onReorder,
  onDropNote,
  onNewSpace
}: Props): React.JSX.Element {
  const [dragName, setDragName] = useState<string | null>(null)
  const [overName, setOverName] = useState<string | null>(null)
  const [noteOver, setNoteOver] = useState<string | null>(null)

  const realOrder = (): string[] => spaces.filter((s) => !s.isHome).map((s) => s.name)

  // Reorder: drop the dragged space just before `targetName` (or at the end when
  // targetName is null), then hand the full new order up for persistence.
  const reorderTo = (targetName: string | null): void => {
    if (dragName == null || targetName === dragName) return // dropped on itself → no-op
    const names = realOrder().filter((n) => n !== dragName)
    const at = targetName == null ? names.length : names.indexOf(targetName)
    names.splice(at < 0 ? names.length : at, 0, dragName)
    onReorder(names)
  }

  const clearDrag = (): void => {
    setDragName(null)
    setOverName(null)
    setNoteOver(null)
  }

  const isSpaceDrag = (e: React.DragEvent): boolean => e.dataTransfer.types.includes(SPACE_DND)
  const isNoteDrag = (e: React.DragEvent): boolean =>
    !isSpaceDrag(e) && e.dataTransfer.types.includes('text/plain')

  return (
    <div className="space-rail" role="tablist" aria-label="Spaces">
      <div className="space-rail-track">
        {spaces.map((space) => {
          const active = space.name === activeName
          const channels = space.color ? hexToChannels(space.color) : null
          const cls =
            'space-btn' +
            (active ? ' on' : '') +
            (overName === space.name ? ' reorder-over' : '') +
            (noteOver === space.name ? ' note-over' : '') +
            (dragName === space.name ? ' dragging' : '')
          return (
            <button
              key={space.name || '__home__'}
              className={cls}
              role="tab"
              aria-selected={active}
              title={space.label}
              style={channels ? ({ ['--btn-accent' as string]: channels } as React.CSSProperties) : undefined}
              draggable={!space.isHome}
              onClick={() => onSelect(space.name)}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (!space.isHome) onContext(e, space)
              }}
              onDragStart={(e) => {
                if (space.isHome) return
                setDragName(space.name)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData(SPACE_DND, space.name)
              }}
              onDragEnd={clearDrag}
              onDragOver={(e) => {
                if (isSpaceDrag(e) && dragName != null && !space.isHome) {
                  e.preventDefault()
                  setOverName(space.name)
                } else if (isNoteDrag(e)) {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setNoteOver(space.name)
                }
              }}
              onDragLeave={() => {
                setOverName((n) => (n === space.name ? null : n))
                setNoteOver((n) => (n === space.name ? null : n))
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (isSpaceDrag(e)) {
                  reorderTo(space.name)
                } else {
                  const from = e.dataTransfer.getData('text/plain')
                  if (from) onDropNote(from, space.name)
                }
                clearDrag()
              }}
            >
              <span className="space-glyph" aria-hidden="true">
                {space.icon || monogram(space)}
              </span>
            </button>
          )
        })}

        {/* trailing drop zone so a dragged space can be moved to the very end */}
        <div
          className={'space-rail-end' + (dragName != null && overName == null ? ' active' : '')}
          onDragOver={(e) => {
            if (dragName != null) {
              e.preventDefault()
              setOverName(null)
            }
          }}
          onDrop={(e) => {
            e.preventDefault()
            if (dragName != null) reorderTo(null)
            clearDrag()
          }}
        >
          <button className="space-add" title="New space" aria-label="New space" onClick={onNewSpace}>
            +
          </button>
        </div>
      </div>
    </div>
  )
}
