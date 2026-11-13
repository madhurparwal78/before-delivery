import { memo, useLayoutEffect, useMemo, useRef, type HTMLAttributes } from 'react'
import type { Colour, Row } from '../../shared/api.ts'
import { symbolsFor, type Craft, type Terms } from '../../shared/symbols.ts'
import { Glyph } from '../components/Glyph.tsx'
import { type CellState, type ChartModel, labelOf } from './model.ts'

export type Mark = 'flash' | 'outline'

export interface GridView {
  cursor: { row: number; col: number } | null
  selection: { fromRow: number; toRow: number; fromCol: number; toCol: number } | null
  peers: Map<number, Record<number, string>>
  lifted: Map<number, ReadonlySet<number>>
  pinned: Map<number, ReadonlySet<number>>
  marks: Map<number, ReadonlyMap<number, Mark>>
  preview: Map<number, ReadonlySet<number>>
  diffs: Map<number, readonly string[]>
}

export const EMPTY_VIEW: GridView = {
  cursor: null, selection: null, peers: new Map(), lifted: new Map(), pinned: new Map(), marks: new Map(), preview: new Map(), diffs: new Map(),
}

interface RowProps {
  meta: Row
  cells: CellState[]
  width: number
  craft: Craft
  terms: Terms | null
  yarns: Map<string, Colour> | null
  cursorCol: number
  selFrom: number
  selTo: number
  peers: Record<number, string> | null
  lifted: ReadonlySet<number> | null
  pinned: ReadonlySet<number> | null
  marks: ReadonlyMap<number, Mark> | null
  preview: ReadonlySet<number> | null
  diffs: readonly string[] | null
  follow: 'current' | 'done' | 'todo' | undefined
  round: boolean
}

function ink(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.45 ? '#ffffff' : '#2b3340'
}

const GridRow = memo(function GridRow(p: RowProps) {
  const names = useMemo(() => new Map(symbolsFor(p.craft, p.terms).map((s) => [s.key, s.name])), [p.craft, p.terms])
  const { meta } = p
  return (
    <div role="row" className="grow" data-row={meta.row} data-side={meta.side} data-used={meta.used} data-made={meta.made}
      data-count-state={meta.state} data-notes={meta.notes > 0 ? meta.notes : undefined} data-follow={p.follow}>
      <div role="rowheader" className="rowhead">{p.round ? 'Rnd' : 'Row'} {meta.row}</div>
      {p.cells.map((cell, i) => {
        const col = i + 1
        const lift = p.lifted?.has(col) && cell.stitch !== 'ns'
        const yarn = p.yarns && cell.stitch !== 'ns' ? p.yarns.get(cell.colour)?.hex : undefined
        const mark = p.marks?.get(col)
        const selected = col >= p.selFrom && col <= p.selTo
        const cursor = p.cursorCol === col
        return (
          <div key={col} role="gridcell" className={`cell${selected ? ' selected' : ''}${p.preview?.has(col) ? ' preview' : ''}`}
            data-row={meta.row} data-col={col} data-stitch={cell.stitch} data-colour={cell.colour} data-repeat={cell.repeat} data-rev={cell.rev}
            aria-label={labelOf(meta.row, col, names.get(cell.stitch) ?? cell.stitch, cell.colour, cell.repeat)}
            aria-selected={selected ? true : undefined} aria-current={p.pinned?.has(col) && cell.stitch !== 'ns' ? true : undefined}
            tabIndex={cursor ? 0 : -1} data-cursor={cursor ? 'true' : undefined} data-peer={p.peers?.[col]}
            data-lift={lift ? 'twin' : undefined} data-motion={mark === 'flash' ? 'flash' : undefined}
            data-outline={mark === 'outline' ? 'static' : undefined} data-diff={p.diffs?.[i]}
            style={yarn ? ({ backgroundColor: yarn, color: ink(yarn) } as React.CSSProperties) : undefined}>
            <Glyph stitch={cell.stitch} />
          </div>
        )
      })}
      <div role="gridcell" className="count" data-count>{meta.state === 'empty' ? '' : meta.made}</div>
    </div>
  )
})

interface GridProps extends HTMLAttributes<HTMLDivElement> {
  label: string
  model: Pick<ChartModel, 'craft' | 'terms' | 'width' | 'height' | 'colours' | 'grid' | 'rows' | 'mode'>
  view?: GridView
  /** The follow page: the current row, whose band moves and which the scroll keeps in the middle. */
  followRow?: number
  motion?: 'row'
  padded?: boolean
}

export function Grid({ label, model, view = EMPTY_VIEW, followRow, motion, padded, ...events }: GridProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const band = useRef<HTMLDivElement>(null)
  const yarns = useMemo(() => (model.colours.length > 1 ? new Map(model.colours.map((c) => [c.letter, c])) : null), [model.colours])
  const { selection } = view
  const order: number[] = []
  for (let r = model.height; r >= 1; r--) order.push(r)

  useLayoutEffect(() => {
    const box = scroller.current
    const target = followRow ? box?.querySelector<HTMLElement>(`[data-row="${followRow}"].grow`) : null
    if (!box || !target || !band.current) return
    const top = target.offsetTop
    band.current.style.transform = `translateY(${top}px)`
    band.current.style.height = `${target.offsetHeight}px`
    box.scrollTop = (target.parentElement as HTMLElement).offsetTop + top - box.clientHeight / 2 + target.offsetHeight / 2
  }, [followRow, model.height])

  return (
    <div className={`chart-scroll${padded ? ' padded' : ''}`} ref={scroller}>
      {padded && <div className="pad" aria-hidden="true" />}
      <div role="grid" aria-label={label} aria-rowcount={model.height} aria-colcount={model.width} className="grid" data-motion={motion} {...events}>
        {followRow !== undefined && <div className="band" ref={band} aria-hidden="true" />}
        {order.map((r) => {
          const inSel = selection && r >= selection.fromRow && r <= selection.toRow
          return (
            <GridRow key={r} meta={model.rows[r - 1]} cells={model.grid[r - 1]} width={model.width} craft={model.craft} terms={model.terms}
              yarns={yarns} cursorCol={view.cursor?.row === r ? view.cursor.col : 0} selFrom={inSel ? selection!.fromCol : 0}
              selTo={inSel ? selection!.toCol : -1} peers={view.peers.get(r) ?? null} lifted={view.lifted.get(r) ?? null}
              pinned={view.pinned.get(r) ?? null} marks={view.marks.get(r) ?? null} preview={view.preview.get(r) ?? null}
              diffs={view.diffs.get(r) ?? null} round={model.mode === 'round'}
              follow={followRow === undefined ? undefined : r === followRow ? 'current' : r < followRow ? 'done' : 'todo'} />
          )
        })}
      </div>
      {padded && <div className="pad" aria-hidden="true" />}
    </div>
  )
}
