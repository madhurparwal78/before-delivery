import { ArrowRight } from 'lucide-react'
import { memo, useLayoutEffect, useRef, useState, type HTMLAttributes } from 'react'
import type { Row } from '../../shared/api.ts'

export interface LinesView {
  /** token index lifted on a row (-1 for none) */
  lifted: Map<number, number>
  pinnedToken: Map<number, number>
  pinnedRow: number | null
  followRow?: number
}

export interface TextEditing {
  /** applies the text; resolves to an error to show, or null when it applied */
  apply(row: number, text: string): Promise<{ message: string; position: number | null } | null>
  close(row: number): void
}

const FAMILY: Record<string, { label: string; tint: string }> = {
  RS: { label: 'RS', tint: 'green' }, WS: { label: 'WS', tint: 'rose' }, RND: { label: 'Rnd', tint: 'butter' },
}

interface CardProps {
  row: Row
  lift: number
  pinToken: number
  rowPinned: boolean
  active: number
  readOnly: boolean
  editing: boolean
  current: boolean
  onActive(row: number, index: number): void
  onPin(row: number): void
  onEdit(row: number): void
  editor: TextEditing
  message: string | null
}

function EditBox({ row, editor, blocked }: { row: Row; editor: TextEditing; blocked: string | null }) {
  const [value, setValue] = useState(row.text)
  const [error, setError] = useState<{ message: string; position: number | null } | null>(blocked ? { message: blocked, position: null } : null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => {
    input.current?.focus()
    input.current?.setSelectionRange(value.length, value.length)
  }, [])
  useLayoutEffect(() => {
    if (error?.position) {
      input.current?.focus()
      input.current?.setSelectionRange(error.position - 1, error.position - 1)
    }
  }, [error])
  const apply = async () => {
    if (busy) return
    setBusy(true)
    const failure = await editor.apply(row.row, value)
    setBusy(false)
    if (failure) setError({ ...failure })
  }
  return (
    <div className="editbox">
      <input ref={input} type="text" aria-label={`Row ${row.row} instructions`} aria-invalid={error ? true : undefined} value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); void apply() }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); editor.close(row.row) }
        }} />
      <button type="button" className="primary" onClick={() => void apply()} aria-busy={busy}>Apply text</button>
      {error && <p role="alert" aria-label="Text error" className="error">{error.message}</p>}
    </div>
  )
}

const Card = memo(function Card(p: CardProps) {
  const { row } = p
  const family = FAMILY[row.side]
  let token = -1
  const lit = p.rowPinned || p.lift >= 0 || p.pinToken >= 0
  return (
    <li data-row={row.row} className={`card rowcard${p.current ? ' current' : ''}`}>
      <span className={`tile tint-${family.tint}`}>{family.label}</span>
      <div className="line-box">
        <p data-line className="line" aria-current={p.rowPinned || p.current ? true : undefined}>
          {row.segments.map((seg, i) => {
            if (!seg.cols) return seg.text
            token++
            const index = token
            return (
              <span key={i} data-token="" data-index={index} className="token" tabIndex={index === p.active ? 0 : -1}
                data-lift={p.lift === index || p.pinToken === index || p.rowPinned || p.current ? 'twin' : undefined}
                aria-current={p.pinToken === index ? true : undefined}
                onFocus={() => p.onActive(row.row, index)}>{seg.text}</span>
            )
          })}
        </p>
        {p.editing && <EditBox row={row} editor={p.editor} blocked={p.message} />}
      </div>
      <div className="card-actions">
        {!p.readOnly && <button type="button" className="small" onClick={() => p.onEdit(row.row)}>{`Edit row ${row.row}`}</button>}
        <button type="button" className={`pin${lit ? ' lit' : ''}`} aria-label={`Pin row ${row.row}`} onClick={() => p.onPin(row.row)}>
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    </li>
  )
})

interface LinesProps extends HTMLAttributes<HTMLUListElement> {
  rows: Row[]
  view: LinesView
  readOnly: boolean
  editingRow: number | null
  editor: TextEditing
  onPin(row: number): void
  onEdit(row: number): void
}

export function Lines({ rows, view, readOnly, editingRow, editor, onPin, onEdit, ...events }: LinesProps) {
  const [active, setActive] = useState<Record<number, number>>({})
  const onActive = (row: number, index: number) => setActive((a) => (a[row] === index ? a : { ...a, [row]: index }))
  return (
    <ul role="list" aria-label="Written instructions" className="lines" {...events}>
      {rows.filter((r) => r.state !== 'empty').map((row) => (
        <Card key={row.row} row={row} lift={view.lifted.get(row.row) ?? -1} pinToken={view.pinnedToken.get(row.row) ?? -1}
          rowPinned={view.pinnedRow === row.row} active={active[row.row] ?? 0} readOnly={readOnly} editing={editingRow === row.row}
          current={view.followRow === row.row} onActive={onActive} onPin={onPin} onEdit={onEdit} editor={editor}
          message={row.textBlock} />
      ))}
    </ul>
  )
}
