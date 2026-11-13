import { ArrowRight } from 'lucide-react'
import { useState } from 'react'
import { CHART_KINDS } from '../../shared/symbols.ts'
import { ApiFail, call } from '../api.ts'
import { navigate } from '../router.ts'
import { useSession } from '../session.tsx'
import { Dialog } from './Dialog.tsx'

const TINTS = ['green', 'rose', 'tan', 'butter', 'blue', 'lilac']
const TILE_LABELS = ['Knit', 'Rnd', 'Rnd', 'US', 'UK', 'Tap']

export function NewPattern({ onClose }: { onClose(): void }) {
  const { config } = useSession()
  const [name, setName] = useState('')
  const [kind, setKind] = useState(CHART_KINDS[0].label)
  const [rows, setRows] = useState('24')
  const [columns, setColumns] = useState('24')
  const [castOn, setCastOn] = useState('24')
  const [error, setError] = useState<{ field: string; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const limits = config!.limits

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const made = await call<{ id: string }>('POST', '/api/patterns', {
        name, kind, rows: Number(rows), columns: Number(columns), castOn: Number(castOn),
      })
      onClose()
      navigate(`/patterns/${made.id}`)
    } catch (failure) {
      if (failure instanceof ApiFail && failure.body.field) setError({ field: failure.body.field, message: failure.body.message ?? '' })
      else setError({ field: 'name', message: 'That change was not saved. Try again.' })
    } finally {
      setBusy(false)
    }
  }

  const invalid = (field: string) => (error?.field === field ? true : undefined)
  return (
    <Dialog label="New pattern" onClose={onClose}>
      <form className="stack" onSubmit={(event) => { event.preventDefault(); void create() }} noValidate>
        <h2>New pattern</h2>
        <label className="field">Pattern name
          <input type="text" aria-label="Pattern name" aria-invalid={invalid('name')} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div role="radiogroup" aria-label="Chart kind" className="kinds">
          {CHART_KINDS.map((k, i) => (
            <label key={k.label} className={`card kind${kind === k.label ? ' chosen' : ''}`}>
              <input type="radio" name="kind" className="cover" aria-label={k.label} checked={kind === k.label} onChange={() => setKind(k.label)} />
              <span className={`tile tint-${TINTS[i]}`} aria-hidden="true">{TILE_LABELS[i]}</span>
              <span className="card-label">{k.label}</span>
              <ArrowRight className="arrow" size={16} aria-hidden="true" />
            </label>
          ))}
        </div>
        <div className="numbers">
          <label className="field">Rows
            <input type="number" aria-label="Rows" aria-invalid={invalid('rows')} min={1} max={limits.maxChartRows} value={rows} onChange={(e) => setRows(e.target.value)} />
          </label>
          <label className="field">Columns
            <input type="number" aria-label="Columns" aria-invalid={invalid('columns')} min={1} max={limits.maxChartCols} value={columns} onChange={(e) => setColumns(e.target.value)} />
          </label>
          <label className="field">Cast on
            <input type="number" aria-label="Cast on" aria-invalid={invalid('castOn')} min={1} value={castOn} onChange={(e) => setCastOn(e.target.value)} />
          </label>
        </div>
        {error && <p role="alert" aria-label="Pattern error" className="error">{error.message}</p>}
        <div className="actions">
          <button type="submit" className="primary" disabled={busy} aria-busy={busy}>Create</button>
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Dialog>
  )
}
