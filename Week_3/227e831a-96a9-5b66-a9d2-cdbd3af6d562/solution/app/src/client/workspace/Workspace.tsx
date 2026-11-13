import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import type { CarryMode, Line } from '../../shared/api-types'
import { CATEGORIES } from '../../shared/categories'
import { formatDelta, formatWeight } from '../../shared/display'
import { legalMoves } from '../../shared/list-state'
import { useStore } from '../status'
import { Status } from '../ui'
import { availableGear } from './display'
import { WorkspaceController } from './controller'
import { ShareDialog } from './ShareDialog'
import { syncState } from './sync-queue'
import { Chip, COLUMN_PHONE, COLUMN_WIDE, snapOf, StrataColumn, useStrataSequence } from './strata'

const PACKED_BANNER = 'Packed — weights are frozen. Return to planning to change this list.'
const WALKED_BANNER = "Walked — this list is kept for history and can't be changed."
const OUT_OF_DATE = 'This pack sheet is out of date. Print again to include your latest changes.'

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (callback) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', callback)
      return () => list.removeEventListener('change', callback)
    },
    () => window.matchMedia(query).matches,
  )
}

const MODES: readonly { value: CarryMode; label: string }[] = [
  { value: 'base', label: 'Base' },
  { value: 'worn', label: 'Worn' },
  { value: 'consumable', label: 'Consumable' },
]

function focusKeyOf(target: EventTarget | null): string | null {
  return target instanceof HTMLElement ? (target.closest<HTMLElement>('[data-focus-key]')?.dataset.focusKey ?? null) : null
}

function QuantityField({ line, owned, onCommit }: { line: Line; owned: number; onCommit: (quantity: number) => void }) {
  const [text, setText] = useState(String(line.quantity))
  useEffect(() => setText(String(line.quantity)), [line.quantity])
  return (
    <input
      type="text" inputMode="numeric" role="spinbutton" className="quantity" data-focus-key={`qty:${line.itemId}`}
      aria-label={`Quantity of ${line.name}`} aria-valuemin={1} aria-valuemax={owned} aria-valuenow={line.quantity}
      value={text}
      onKeyDown={(event) => {
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault()
          onCommit(line.quantity + (event.key === 'ArrowUp' ? 1 : -1))
        } else if (event.key.length === 1 && !/\d/.test(event.key) && !event.ctrlKey && !event.metaKey) event.preventDefault()
      }}
      onChange={(event) => {
        const digits = event.target.value.replace(/\D/g, '')
        setText(digits)
        const wanted = Number.parseInt(digits, 10)
        if (!Number.isNaN(wanted) && wanted >= 1) {
          onCommit(wanted)
          if (wanted > owned) setText(String(owned))
        }
      }}
      onBlur={() => setText(String(line.quantity))}
    />
  )
}

export function Workspace({ id, arrivedByCreate }: { id: string; arrivedByCreate: boolean }) {
  const controller = useMemo(() => new WorkspaceController(id), [id])
  const snap = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const sync = useStore(syncState)
  const wide = useMedia('(min-width: 768px)')
  const reduced = useMedia('(prefers-reduced-motion: reduce)')
  const [phoneOpen, setPhoneOpen] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [sharingMessage, setSharingMessage] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)
  const arrived = useRef(arrivedByCreate)

  useEffect(() => {
    void controller.load()
    return () => controller.dispose()
  }, [controller])

  useLayoutEffect(() => {
    if (!snap.focus) return
    document.querySelector<HTMLElement>(`[data-focus-key="${snap.focus.key}"]`)?.focus()
  }, [snap.focus])

  useLayoutEffect(() => {
    if (snap.phase === 'ready' && arrived.current) {
      arrived.current = false
      heading.current?.focus()
    }
  }, [snap.phase])

  useLayoutEffect(() => {
    if (sync.headingFocus > 0) heading.current?.focus()
  }, [sync.headingFocus])

  const { confirmed, profile, displayed } = snap
  const columnPx = wide ? COLUMN_WIDE : COLUMN_PHONE
  const collapsed = !wide && !phoneOpen
  const zero = useMemo(() => ({ baseGrams: 0, wornGrams: 0, consumableGrams: 0, skinOutGrams: 0, goalGrams: 1, deltaGrams: 1, display: { base: '', worn: '', consumable: '', skinOut: '', goal: '', delta: '' } }), [])
  const target = useMemo(() => snapOf(displayed?.totals ?? zero, displayed?.categories ?? [], columnPx), [displayed, zero, columnPx])
  const { shown, chip } = useStrataSequence(target, snap.change, { collapsed, reduced, columnPx, unit: profile?.unit ?? 'g', loaded: displayed !== null })

  // The loading frame is the workspace's own, so the page does not jump when the list arrives.
  if (snap.phase === 'loading') {
    return <main className="workspace"><header className="ws-head"><div className="ws-title"><h1 tabIndex={-1}>Loading list…</h1></div></header></main>
  }
  if (snap.phase === 'missing' || !confirmed || !profile || !displayed) {
    return <main className="page"><h1 tabIndex={-1}>List not found</h1><p className="empty">This list isn't available. It may have been removed, or it was never opened on this device.</p></main>
  }

  const planning = confirmed.state === 'planning'
  const { totals } = displayed
  const unit = profile.unit
  const available = availableGear(snap.items, displayed.lines)
  const over = shown.base > totals.goalGrams
  const itemOf = (itemId: string) => snap.items.find((item) => item.id === itemId)

  function packFromRow(itemId: string, row: HTMLElement | null) {
    const rect = row?.getBoundingClientRect()
    controller.pack(itemId, rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null)
  }

  function onLineKey(event: KeyboardEvent<HTMLElement>, line: Line) {
    if (event.ctrlKey || event.altKey || event.metaKey || !planning) return
    const target = event.target as HTMLElement
    if (target.getAttribute('role') === 'spinbutton') return
    const control = focusKeyOf(target) ?? `inc:${line.itemId}`
    const key = event.key.toLowerCase()
    const toggle = (mode: CarryMode) => controller.setMode(line.itemId, line.mode === mode ? 'base' : mode, control)
    const actions: Record<string, () => void> = {
      w: () => toggle('worn'),
      c: () => toggle('consumable'),
      b: () => controller.setMode(line.itemId, 'base', control),
      u: () => controller.unpack(line.itemId),
      '+': () => controller.setQuantity(line.itemId, line.quantity + 1, control),
      '=': () => controller.setQuantity(line.itemId, line.quantity + 1, control),
      '-': () => controller.setQuantity(line.itemId, line.quantity - 1, control),
    }
    const action = actions[key]
    if (!action) return
    event.preventDefault()
    action()
  }

  const stateButtons = legalMoves(confirmed.state).map((to) => ({
    to,
    label: to === 'packed' ? 'Mark packed' : to === 'planning' ? 'Return to planning' : 'Mark walked',
  }))
  const banner = confirmed.state === 'packed' ? PACKED_BANNER : confirmed.state === 'walked' ? WALKED_BANNER : null

  return (
    <main className="workspace" data-state={confirmed.state}>
      <header className="ws-head">
        <div className="ws-title">
          <h1 ref={heading} tabIndex={-1} data-focus-key="heading">{confirmed.name}</h1>
          <span className="state-badge">{confirmed.state}</span>
        </div>
        {banner && <p className="banner">{banner}</p>}
      </header>

      <section className="totals" aria-label="Pack totals">
        <dl>
          <div><dt>Base</dt><dd className="weight">{formatWeight(shown.base, unit)}</dd></div>
          <div><dt>Worn</dt><dd className="weight">{formatWeight(shown.wornGrams, unit)}</dd></div>
          <div><dt>Consumable</dt><dd className="weight">{formatWeight(shown.consumableGrams, unit)}</dd></div>
          <div><dt>Skin-out</dt><dd className="weight">{formatWeight(shown.skinOut, unit)}</dd></div>
        </dl>
        <div className="goal-figure">
          <span className="figure-label">Goal {totals.display.goal}</span>
          <p className={`delta ${over ? 'over' : 'under'}`}>{formatDelta(shown.base, totals.goalGrams, unit)}</p>
        </div>
      </section>

      <div className="ws-actions">
        <div className="actions">
          {stateButtons.map(({ to, label }) => (
            <button key={to} type="button" data-focus-key={`state:${to}`} onClick={() => void controller.changeState(to, `state:${to}`)}>{label}</button>
          ))}
          <button type="button" onClick={() => void controller.print()}>Print pack sheet</button>
          {snap.sheet && <a className="download" href={snap.sheet.url} download>Download pack sheet</a>}
          <button type="button" onClick={() => setSharing(true)}>Share list</button>
        </div>
        {snap.sheet && !snap.sheet.current && <p className="notice">{OUT_OF_DATE}</p>}
        <div className="messages">
          <Status name="Pack updates" text={snap.messages.pack} />
          <Status name="Sync results" text={sync.summary} />
          <Status name="List state" text={snap.messages.listState} />
          <Status name="Pack sheet" text={snap.messages.sheet} />
          <Status name="Sharing" text={sharingMessage} />
        </div>
      </div>

      {!wide && (
        <div className="strata-strip">
          <button type="button" aria-expanded={phoneOpen} onClick={() => setPhoneOpen((open) => !open)}>Pack Strata<span className={`glyph ${phoneOpen ? 'open' : ''}`} aria-hidden="true" /></button>
          <p className="summary">{`Base ${totals.display.base}, ${totals.display.delta}.`}</p>
        </div>
      )}

      <section className="zone closet-zone" aria-label="Closet" tabIndex={-1} data-focus-key="region:closet">
        <h2>Closet</h2>
        {available.length === 0 ? <p className="hint">Everything you own is on this list.</p> : (
          <table className="ledger" aria-label="Available gear" role="table">
            <tbody role="rowgroup">
              {CATEGORIES.flatMap((category) => {
                const rows = available.filter((row) => row.item.category === category)
                if (rows.length === 0) return []
                return [
                  <tr key={`g-${category}`} role="row" className="group"><th role="columnheader" colSpan={3} scope="colgroup">{category}</th></tr>,
                  ...rows.map(({ item, left, showLeft }) => (
                    <tr key={item.id} role="row" className="entering" data-closet-row={item.id}
                      onKeyDown={(event) => {
                        if (!planning || event.ctrlKey || event.altKey || event.metaKey || event.key.toLowerCase() !== 'p') return
                        event.preventDefault()
                        packFromRow(item.id, event.currentTarget)
                      }}>
                      <td role="cell" className="name-cell"><span className="item-name">{item.name}</span>{showLeft && <span className="left">{left} left</span>}</td>
                      <td role="cell" className="weight">{item.weightDisplay}</td>
                      <td role="cell" className="row-actions">
                        {planning && (
                          <button type="button" data-focus-key={`pack:${item.id}`} aria-label={`Pack ${item.name}`}
                            onClick={(event) => packFromRow(item.id, event.currentTarget.closest('tr'))}>Pack</button>
                        )}
                      </td>
                    </tr>
                  )),
                ]
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="zone list-zone" aria-label="Pack list" tabIndex={-1} data-focus-key="region:list">
        <h2>Pack list</h2>
        {displayed.lines.length === 0 ? <p className="hint">Nothing packed yet.</p> : (
          <table className="ledger pack-ledger" aria-label="Pack list" role="table">
            <tbody role="rowgroup">
              {CATEGORIES.flatMap((category) => {
                const lines = displayed.lines.filter((line) => line.category === category)
                if (lines.length === 0) return []
                const entry = displayed.categories.find((candidate) => candidate.category === category)
                return [
                  <tr key={`g-${category}`} role="row" className="group">
                    <th role="columnheader" colSpan={5} scope="colgroup"><h3><span className="cat">{category}</span> <span className="fig">{entry?.subtotalDisplay ?? formatWeight(0, unit)}</span></h3></th>
                  </tr>,
                  ...lines.map((line) => {
                    const owned = itemOf(line.itemId)?.unitsOwned ?? line.quantity
                    return (
                      <tr key={line.itemId} role="row" className="entering line" onKeyDown={(event) => onLineKey(event, line)}>
                        <td role="cell" className="qty-cell">
                          {planning && (
                            <>
                              <button type="button" className="step" data-focus-key={`dec:${line.itemId}`} aria-label={`Decrease ${line.name}`} aria-disabled={line.quantity <= 1 ? true : undefined}
                                onClick={() => controller.setQuantity(line.itemId, line.quantity - 1, `dec:${line.itemId}`)}>−</button>
                              <QuantityField line={line} owned={owned} onCommit={(quantity) => controller.setQuantity(line.itemId, quantity, `qty:${line.itemId}`)} />
                              <button type="button" className="step" data-focus-key={`inc:${line.itemId}`} aria-label={`Increase ${line.name}`} aria-disabled={line.quantity >= owned ? true : undefined}
                                onClick={() => controller.setQuantity(line.itemId, line.quantity + 1, `inc:${line.itemId}`)}>+</button>
                            </>
                          )}
                          {!planning && <span className="num">{line.quantity}</span>}
                        </td>
                        <td role="cell" className="name-cell">
                          <span className="item-name">{line.name}</span>
                          {line.carryNote && <span className="carry-note">{line.carryNote}</span>}
                          {!line.inCloset && <span className="not-in-closet">Not in closet</span>}
                        </td>
                        <td role="cell" className="mode-cell">
                          {planning && (
                            <div role="radiogroup" aria-label={`Carry mode for ${line.name}`} className="radios compact">
                              {MODES.map((mode) => (
                                <label key={mode.value} className="radio">
                                  <input type="radio" name={`mode-${line.itemId}`} data-focus-key={`mode:${line.itemId}:${mode.value}`} checked={line.mode === mode.value}
                                    onChange={() => controller.setMode(line.itemId, mode.value, `mode:${line.itemId}:${mode.value}`)} />
                                  <span>{mode.label}</span>
                                </label>
                              ))}
                            </div>
                          )}
                        </td>
                        <td role="cell" className="weight">{line.weightDisplay}</td>
                        <td role="cell" className="row-actions">
                          {planning && <button type="button" data-focus-key={`unpack:${line.itemId}`} aria-label={`Unpack ${line.name}`} onClick={() => controller.unpack(line.itemId)}>Unpack</button>}
                        </td>
                      </tr>
                    )
                  }),
                ]
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="zone strata-zone" aria-label="Pack Strata">
        <h2 className="zone-title">Pack Strata</h2>
        {!collapsed && <StrataColumn categories={displayed.categories} totals={totals} shown={shown} columnPx={columnPx} unit={unit} />}
      </section>

      {chip && <Chip view={chip} />}
      {sharing && (
        <ShareDialog listId={id} onClose={() => setSharing(false)} announce={setSharingMessage} />
      )}
    </main>
  )
}
