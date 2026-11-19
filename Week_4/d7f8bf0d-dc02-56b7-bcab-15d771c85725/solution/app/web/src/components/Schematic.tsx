import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { selectBlock, setOutOfService } from '../actions'
import { usePresented } from '../presenter'
import { canManage, canRun, store, useAppState } from '../state'
import { Sheet } from '../ui/primitives'
import { RoutePanel } from './RoutePanel'

const WORDS = { free: 'Free', reserved: 'Reserved', occupied: 'Occupied', out_of_service: 'Out of service' } as const

// Brings the selected row, its action line included, wholly into view inside its own scroller, never moving the page.
function revealRow(row: HTMLElement): void {
  row.scrollLeft = 0
  const scroller = row.closest<HTMLElement>('.schematic-scroll, .sheet-body')
  if (scroller === null) return
  const pad = 10
  const top = row.getBoundingClientRect().top - scroller.getBoundingClientRect().top
  const bottom = top + row.offsetHeight
  if (top < pad) scroller.scrollTop += top - pad
  else if (bottom > scroller.clientHeight - pad) scroller.scrollTop += Math.min(top - pad, bottom - scroller.clientHeight + pad)
}

// An unselected row that was swiped or tabbed sideways to its actions slides back once the pointer or focus leaves it.
function settleRow(row: HTMLElement): void {
  if (row.getAttribute('aria-selected') !== 'true' && !row.contains(document.activeElement)) row.scrollTo({ left: 0, behavior: 'smooth' })
}

function SchematicTable() {
  const { session, selection, role } = useAppState()
  const presented = usePresented()
  const body = useRef<HTMLTableSectionElement>(null)
  const selected = selection.blockNumber
  const shown = session !== null
  useLayoutEffect(() => {
    const row = body.current?.querySelector<HTMLElement>(`[data-testid="block-row-${selected}"]`)
    if (row) revealRow(row)
  }, [selected, shown])
  if (session === null) return null
  const blocks = [...session.blocks].sort((a, b) => a.number - b.number)
  return (
    <table role="table" aria-label="Block schematic" className="schematic">
      <thead role="rowgroup">
        <tr role="row" className="schematic-head">
          <th role="columnheader">Block</th>
          <th role="columnheader">Name</th>
          <th role="columnheader">State</th>
          <th role="columnheader">Train</th>
          <th role="columnheader"><span className="sr-only">Actions</span></th>
        </tr>
      </thead>
      <tbody role="rowgroup" ref={body}>
        {blocks.map(block => {
          const state = presented.blockStates[block.number] ?? block.state
          return (
            <tr key={block.id} role="row" data-testid={`block-row-${block.number}`} className={`schematic-row state-${state}`} aria-selected={selection.blockNumber === block.number} onClick={() => selectBlock(block.number)} onPointerLeave={event => settleRow(event.currentTarget)} onBlur={event => { const row = event.currentTarget; requestAnimationFrame(() => settleRow(row)) }}>
              <td role="cell" className="num">{block.number}</td>
              <td role="cell" className="schematic-name" title={block.name}>{block.name}</td>
              <td role="cell" data-testid={`block-state-${block.number}`}><span className={`block-word word-${state}`}>{WORDS[state]}</span></td>
              <td role="cell" className="schematic-train">{block.train_number === null ? '' : `Train ${block.train_number}`}</td>
              <td role="cell" className="schematic-actions">
                {canManage(role) ? (
                  <button type="button" className="btn btn-ghost btn-small" onClick={() => { store.set({ dialog: { kind: 'rename', target: 'block', id: block.id, name: block.name } }) }}>Rename</button>
                ) : null}
                {canRun(role) ? (
                  <button type="button" className="btn btn-ghost btn-small" onClick={() => { void setOutOfService(block.id, block.state !== 'out_of_service') }}>
                    {block.state === 'out_of_service' ? 'Return to service' : 'Out of service'}
                  </button>
                ) : null}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// Operate mode: the route panel and the block schematic on the right edge; on phones a Schematic button opens a bottom sheet.
export function SchematicDock() {
  const state = useAppState()
  const [phone, setPhone] = useState(() => window.matchMedia('(max-width: 767px)').matches)
  const [open, setOpen] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)')
    const listener = (): void => setPhone(query.matches)
    query.addEventListener('change', listener)
    return () => query.removeEventListener('change', listener)
  }, [])
  if (state.mode !== 'operate' || state.session === null) return null
  if (phone) {
    return (
      <>
        <button ref={opener} type="button" className="btn schematic-button" onClick={() => setOpen(true)}>Schematic</button>
        {open ? (
          <Sheet title="Block schematic" testId="sheet-block-schematic" onClose={() => setOpen(false)}>
            <RoutePanel />
            <SchematicTable />
          </Sheet>
        ) : null}
      </>
    )
  }
  return (
    <aside className="schematic-dock">
      <RoutePanel />
      <div className="schematic-card"><div className="schematic-scroll"><SchematicTable /></div></div>
    </aside>
  )
}
