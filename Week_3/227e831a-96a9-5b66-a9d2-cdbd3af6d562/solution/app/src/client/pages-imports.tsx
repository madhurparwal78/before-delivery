import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ImportRun } from '../shared/api-types'
import { REJECTION_WORDS } from '../shared/csv'
import { api, ApiError } from './api'
import { Dialog, FieldError, Status } from './ui'

const STORAGE_DOWN = 'File storage is unavailable, so nothing was imported. Try again later.'

function outcomeText(row: NonNullable<ImportRun['rows']>[number]): string {
  if (row.outcome === 'matched') return 'Matched'
  if (row.outcome === 'created') return 'New'
  return `Rejected: ${REJECTION_WORDS[row.reason ?? 'missing_name']}`
}

interface ImportDialogProps {
  onClose: () => void
  onPreviewed: () => void
  announce: (text: string) => void
  opener: React.RefObject<HTMLButtonElement | null>
}

function ImportDialog({ onClose, onPreviewed, announce, opener }: ImportDialogProps) {
  const [file, setFile] = useState<File | null>(null)
  const [message, setMessage] = useState<string | undefined>()
  const [run, setRun] = useState<ImportRun | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const [focusField, setFocusField] = useState(0)

  useLayoutEffect(() => {
    if (focusField > 0) input.current?.focus()
  }, [focusField])

  async function preview() {
    if (!file) {
      setMessage('Choose a CSV file.')
      announce('Choose a CSV file.')
      setFocusField((n) => n + 1)
      return
    }
    announce('Reading file...')
    try {
      const previewed = await api.previewImport(file)
      setRun(previewed)
      onPreviewed()
      const { matched, created, rejected } = previewed.counts
      announce(`Import ready: ${matched} matched, ${created} new, ${rejected} rejected. Nothing is saved until you confirm.`)
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      const text = error.code === 'storage_unavailable' ? STORAGE_DOWN : (error.fields.file ?? error.message)
      if (error.code !== 'storage_unavailable') setMessage(text)
      announce(text)
      setFocusField((n) => n + 1)
    }
  }

  async function commitPreview() {
    if (!run) return
    try {
      const done = await api.commitImport(run.id)
      const { matched, created, rejected } = done.counts
      announce(`Imported: ${matched} matched, ${created} new, ${rejected} rejected.`)
      onClose()
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      announce(error.message)
    }
  }

  return (
    <Dialog name="Import gear list" onClose={onClose} initialFocus={input} returnFocus={() => opener.current}>
      <h2>Import gear list</h2>
      <div className="stack">
        <div className="field">
          <label htmlFor="csv-file">CSV file</label>
          <input
            id="csv-file" ref={input} type="file" accept=".csv,text/csv"
            aria-invalid={message ? true : undefined} aria-describedby={message ? 'csv-file-error' : undefined}
            onChange={(event) => { setFile(event.target.files?.[0] ?? null); setMessage(undefined); setRun(null) }}
          />
          <FieldError id="csv-file-error" message={message} />
        </div>
        {run?.rows && (
          <div className="table-scroll">
            <table className="ledger" aria-label="Import preview" role="table">
              <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Row</th><th role="columnheader" scope="col">Name</th><th role="columnheader" scope="col">Category</th><th role="columnheader" scope="col">Result</th></tr></thead>
              <tbody role="rowgroup">
                {run.rows.map((row) => (
                  <tr key={row.row} role="row">
                    <td role="cell" className="num">{row.row}</td>
                    <td role="cell">{row.name}</td>
                    <td role="cell">{row.category}</td>
                    <td role="cell">{outcomeText(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="actions">
          <button type="button" className={run ? '' : 'primary'} onClick={() => void preview()}>Preview import</button>
          <button type="button" className={run ? 'primary' : ''} disabled={!run} onClick={() => void commitPreview()}>Confirm import</button>
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Dialog>
  )
}

export function Imports() {
  const [runs, setRuns] = useState<ImportRun[] | null>(null)
  const [open, setOpen] = useState<boolean>(window.history.state?.openImport === true)
  const [message, setMessage] = useState('')
  const opener = useRef<HTMLButtonElement>(null)

  const load = () => api.imports().then(setRuns, () => undefined)
  useEffect(() => { void load() }, [])

  function close() {
    setOpen(false)
    window.history.replaceState(null, '', window.location.pathname)
    void load()
  }

  return (
    <main className="page">
      <div className="page-head">
        <h1 tabIndex={-1}>Imports</h1>
        <button type="button" ref={opener} className="primary" onClick={() => setOpen(true)}>Import gear list</button>
      </div>
      <Status name="Import" text={message} />
      {runs === null ? <p className="hint">Loading imports…</p> : runs.length === 0 ? (
        <p className="empty">No gear lists imported yet.</p>
      ) : (
        <table className="ledger" aria-label="Import history" role="table">
          <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">File</th><th role="columnheader" scope="col">Uploaded</th><th role="columnheader" scope="col">Status</th><th role="columnheader" scope="col">Counts</th><th role="columnheader" scope="col"><span className="visually-hidden">Original</span></th></tr></thead>
          <tbody role="rowgroup">
            {runs.map((run) => (
              <tr key={run.id} role="row">
                <td role="cell" className="name-cell">{run.filename}</td>
                <td role="cell">{new Date(run.uploadedAt).toLocaleString()}</td>
                <td role="cell">{run.status === 'committed' ? 'Imported' : 'Not imported'}</td>
                <td role="cell">{run.counts.matched} matched, {run.counts.created} new, {run.counts.rejected} rejected</td>
                <td role="cell"><a href={`/api/imports/${run.id}/original`} download aria-label={`Download original ${run.filename}`}>Download</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open && <ImportDialog onClose={close} onPreviewed={() => void load()} announce={setMessage} opener={opener} />}
    </main>
  )
}
