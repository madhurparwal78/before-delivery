import { ChevronRight } from 'lucide-react'
import { useState, type ChangeEvent, type FormEvent } from 'react'
import type { Dialect, ImportJson, ImportReportItem, ProjectJson } from '../../shared/domain.ts'
import { parseMortise } from '../../shared/mortise.ts'
import { useAlerts } from '../alerts.tsx'
import { useAnnounce } from '../announce.tsx'
import { ApiFailure, api, apiBytes } from '../api.ts'
import { Dialog } from '../ui/Dialog.tsx'
import { downloadFile } from './download.ts'

type Mode = 'merge' | 'replace'

interface ImportDialogProps {
  projectId: string
  getRevision: () => number
  onClose: () => void
  onImported: () => void
}

interface Report {
  result: ImportJson
  existing: string[]
}

const STORAGE_DOWN = 'Import storage is unavailable, so nothing was imported. Your diagram is safe; try again shortly.'

function describe(item: ImportReportItem, existing: string[]): string {
  if (item.kind === 'statement') return `Line ${item.line}: ${item.name} skipped`
  if (item.status === 'ambiguous') {
    const match = existing.find((name) => name.toLowerCase() === item.name.toLowerCase())
    return `Line ${item.line}: table ${item.name} ambiguous, it matches ${match ?? item.name} only by letter case, not imported`
  }
  return `Line ${item.line}: ${item.kind} ${item.name} ${item.status}`
}

export function ImportDialog({ projectId, getRevision, onClose, onImported }: ImportDialogProps) {
  const { say } = useAnnounce()
  const { raise } = useAlerts()
  const [dialect, setDialect] = useState<Dialect>('postgresql')
  const [mode, setMode] = useState<Mode>('merge')
  const [ddl, setDdl] = useState('')
  const [pending, setPending] = useState(false)
  const [lines, setLines] = useState<string[] | null>(null)
  const [report, setReport] = useState<Report | null>(null)

  const readFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]
    if (file) setDdl(new TextDecoder('utf-8').decode(await file.arrayBuffer()))
  }

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setPending(true)
    say('studio', 'Importing...')
    setLines(null)
    try {
      const project = await api<ProjectJson>('GET', `/api/projects/${projectId}`)
      const existing = parseMortise(project.text).model.entities.map((entity) => entity.name)
      const result = await apiBytes<ImportJson>('POST', `/api/projects/${projectId}/imports?dialect=${dialect}&mode=${mode}&baseRevision=${getRevision()}`, ddl)
      const { added, merged, skipped, ambiguous } = result.counts
      say(
        'studio',
        result.changed
          ? `Imported ${added} new and ${merged} merged entities. ${skipped} statements skipped, ${ambiguous} ambiguous.`
          : 'Nothing changed: the text already matches this DDL.',
      )
      setReport({ result, existing })
      onImported()
    } catch (error) {
      say('studio', '')
      if (error instanceof ApiFailure && error.body.error === 'import_failed') {
        setLines(error.body.lines ?? [])
        raise('The import was not applied. Fix the lines below and try again.')
      } else if (error instanceof ApiFailure && error.body.error === 'storage_unavailable') raise(STORAGE_DOWN)
      else if (error instanceof ApiFailure) raise(error.message)
    }
    setPending(false)
  }

  return (
    <Dialog name="Import DDL" onClose={onClose} className="dialog-wide import">
      <form onSubmit={(event) => void submit(event)}>
        <div className="import-options">
          <div className="field">
            <span className="field-label" id="import-dialect-label">
              DDL dialect
            </span>
            <div role="radiogroup" aria-labelledby="import-dialect-label" className="radio-row">
              <label>
                <input type="radio" name="import-dialect" checked={dialect === 'postgresql'} onChange={() => setDialect('postgresql')} />
                PostgreSQL
              </label>
              <label>
                <input type="radio" name="import-dialect" checked={dialect === 'mysql'} onChange={() => setDialect('mysql')} />
                MySQL
              </label>
            </div>
          </div>
          <div className="field">
            <span className="field-label" id="import-mode-label">
              Import mode
            </span>
            <div role="radiogroup" aria-labelledby="import-mode-label" className="radio-row">
              <label>
                <input type="radio" name="import-mode" checked={mode === 'merge'} onChange={() => setMode('merge')} />
                Merge by table name
              </label>
              <label>
                <input type="radio" name="import-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />
                Replace all text
              </label>
            </div>
          </div>
        </div>
        <div className="field">
          <label htmlFor="import-ddl">DDL to import</label>
          <textarea id="import-ddl" className="input" value={ddl} onChange={(event) => setDdl(event.target.value)} spellCheck={false} rows={8} />
        </div>
        <div className="field">
          <label htmlFor="import-file">SQL file</label>
          <input id="import-file" type="file" accept=".sql,text/plain,application/sql" className="import-file" onChange={(event) => void readFile(event)} />
        </div>
        {lines ? (
          <ul className="import-errors" aria-label="Import errors">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? 'Importing...' : 'Import'}
          </button>
        </div>
      </form>
      {report ? (
        <section aria-label="Import report" className="import-report">
          <ul aria-label="Import results" className="import-results">
            {report.result.report.map((item, index) => (
              <li key={`${index}-${item.line}-${item.name}`}>{describe(item, report.existing)}</li>
            ))}
          </ul>
          <ul aria-label="Import notes" className="import-notes">
            {report.result.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          <a
            href={`/api/projects/${projectId}/imports/${report.result.id}/original`}
            className="link-chevron"
            onClick={(event) => {
              event.preventDefault()
              void downloadFile(`/api/projects/${projectId}/imports/${report.result.id}/original`, 'import.sql').then((response) => {
                if (!response.ok) raise(response.status === 503 ? STORAGE_DOWN : 'The original DDL could not be downloaded.')
              })
            }}
          >
            Download original DDL
            <ChevronRight size={14} aria-hidden="true" />
          </a>
        </section>
      ) : null}
      <div className="dialog-actions">
        <button type="button" className="btn btn-quiet" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  )
}
