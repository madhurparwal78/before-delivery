import { ChevronRight, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { Dialect, ExportJson } from '../../shared/domain.ts'
import { COPY } from '../../shared/copy.ts'
import { exportDdl } from '../../shared/export.ts'
import type { Model } from '../../shared/mortise.ts'
import { useAlerts } from '../alerts.tsx'
import { useAnnounce } from '../announce.tsx'
import { ApiFailure, api } from '../api.ts'
import { downloadFile } from './download.ts'

interface ExportPanelProps {
  projectId: string
  model: Model | null
  hasErrors: boolean
  onClose: () => void
}

const DIALECT_NAME: Record<Dialect, string> = { postgresql: 'PostgreSQL', mysql: 'MySQL' }
const STORAGE_DOWN = 'Export storage is unavailable. Your diagram is safe and still saving; try the export again shortly.'

export function ExportPanel({ projectId, model, hasErrors, onClose }: ExportPanelProps) {
  const { say } = useAnnounce()
  const { raise } = useAlerts()
  const [dialect, setDialect] = useState<Dialect>('postgresql')
  const [pending, setPending] = useState(false)
  const [exports, setExports] = useState<Partial<Record<Dialect, ExportJson>>>({})
  const preview = useMemo(() => (model ? exportDdl(model, dialect) : 'Nothing to export yet.'), [model, dialect])
  const current = exports[dialect]

  const expire = (which: Dialect): void => setExports((all) => ({ ...all, [which]: undefined }))

  useEffect(() => {
    const timer = window.setInterval(() => {
      const found = exports[dialect]
      if (found && Date.parse(found.downloadExpiresAt) <= Date.now()) expire(dialect)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [exports, dialect])

  const save = async (): Promise<void> => {
    setPending(true)
    say('studio', 'Saving export...')
    try {
      const saved = await api<ExportJson>('POST', `/api/projects/${projectId}/exports`, { dialect })
      setExports((all) => ({ ...all, [dialect]: saved }))
      say('studio', `${DIALECT_NAME[dialect]} export saved. Download is ready.`)
    } catch (error) {
      say('studio', '')
      if (error instanceof ApiFailure) raise(error.body.error === 'storage_unavailable' ? STORAGE_DOWN : error.message)
    }
    setPending(false)
  }

  const download = async (file: ExportJson): Promise<void> => {
    if (Date.parse(file.downloadExpiresAt) <= Date.now()) {
      expire(file.dialect)
      raise(COPY.exportExpired)
      return
    }
    const response = await downloadFile(file.downloadUrl, file.fileName)
    if (response.ok) return
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    if (body?.error === 'export_expired') {
      expire(file.dialect)
      raise(COPY.exportExpired)
    } else raise(body?.error === 'storage_unavailable' ? STORAGE_DOWN : 'The export could not be downloaded.')
  }

  return (
    <section aria-label="Export DDL" className="export-panel">
      <h2 className="export-title">Export DDL</h2>
      <div className="field">
        <span className="field-label" id="export-dialect-label">
          Dialect
        </span>
        <div role="radiogroup" aria-labelledby="export-dialect-label" className="radio-row">
          <label>
            <input type="radio" name="export-dialect" checked={dialect === 'postgresql'} onChange={() => setDialect('postgresql')} />
            PostgreSQL
          </label>
          <label>
            <input type="radio" name="export-dialect" checked={dialect === 'mysql'} onChange={() => setDialect('mysql')} />
            MySQL
          </label>
        </div>
      </div>
      {hasErrors ? <p className="export-note">The text has errors; the preview shows the last valid diagram.</p> : null}
      <section aria-label="DDL preview" className="export-preview" tabIndex={0}>
        <pre>{preview}</pre>
      </section>
      <div className="export-actions">
        <button type="button" className="btn btn-primary" disabled={pending} onClick={() => void save()}>
          {pending ? 'Saving export...' : 'Save export'}
        </button>
        {current ? (
          <a
            href={current.downloadUrl}
            className="link-chevron"
            onClick={(event) => {
              event.preventDefault()
              void download(current)
            }}
          >
            {`Download ${current.fileName}`}
            <ChevronRight size={14} aria-hidden="true" />
          </a>
        ) : null}
      </div>
        <button type="button" className="export-close" aria-label="Close export panel" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
    </section>
  )
}
