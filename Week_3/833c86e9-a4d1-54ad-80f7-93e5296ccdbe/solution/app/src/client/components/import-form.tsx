import { Fragment, useState, type ReactNode } from 'react'
import { ApiFailure, api } from '../api'
import { announce } from '../live'
import { useApp } from '../state'
import { Button, Money } from '../ui'
import { OutageBand } from './outage'

interface Change { room: string; date: string; old_minor: number; new_minor: number }
interface Preview { count: number; changes: Change[] }
interface ErrorLine { line: number; key: string; params: Record<string, string | number> }

/** The size limit the server enforces by default (`KIP_IMPORT_MAX_BYTES`); the 413 answer does not carry it. */

/** Rate import: choose a file, Preview shows the errors or the changes, Apply is enabled only after an error-free preview. */
export function ImportForm({ code, onMissing }: { code: string; onMissing: () => void }) {
  const app = useApp()
  const [file, setFile] = useState<ArrayBuffer | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [outage, setOutage] = useState(false)
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null)
  const path = `/api/manage/${code}/imports`

  const choose = async (picked: File | undefined): Promise<void> => {
    setPreview(null)
    setErrors([])
    setOutage(false)
    setFile(picked ? await picked.arrayBuffer() : null)
  }

  const send = async (apply: boolean): Promise<void> => {
    if (!file) return
    setBusy(apply ? 'apply' : 'preview')
    setOutage(false)
    try {
      const answer = await api<Preview>('POST', apply ? path : `${path}/preview`, undefined, { raw: file, contentType: 'text/plain' })
      setErrors([])
      if (apply) {
        announce('toast', app.t('toast.imported'))
        setPreview(null)
      } else setPreview(answer)
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error
      if (error.status === 404) onMissing()
      else if (error.status === 503) setOutage(true)
      else if (error.status === 413) setErrors([app.t('import.too_large', { n: window.__KIP__.importMaxBytes })])
      else if (error.status === 422 && error.body.error === 'import_invalid') {
        setPreview(null)
        setErrors((error.body.lines as ErrorLine[]).map((line) => app.t(line.key, line.params)))
      } else throw error
    } finally {
      setBusy(null)
    }
  }

  /** `import.row` with its two rates as Money elements. */
  const row = (change: Change): ReactNode =>
    app.t('import.row', { room: change.room, 'iso date': change.date }).split(/(\{old\}|\{new\})/).map((part, i) => (
      <Fragment key={i}>{part === '{old}' ? <Money minor={change.old_minor} currency="EUR" /> : part === '{new}' ? <Money minor={change.new_minor} currency="EUR" /> : part}</Fragment>
    ))

  return (
    <section className="import">
      <OutageBand text={outage ? app.t('storage.import') : null} />
      <label className="stack file-field">
        <span>{app.t('ui.rateFile')}</span>
        <input type="file" className="field" accept=".kiprates,.txt,text/plain" onChange={(event) => void choose(event.target.files?.[0])} />
      </label>
      <div className="btn-row">
        <Button busy={busy === 'preview'} disabled={!file || busy !== null} onClick={() => void send(false)}>{app.t('ui.preview')}</Button>
        <Button busy={busy === 'apply'} disabled={!preview || busy !== null} onClick={() => void send(true)}>{app.t('ui.apply')}</Button>
      </div>
      {errors.length > 0 && (
        <ul aria-label={app.t('ui.importErrors')} className="import-errors">
          {errors.map((message, i) => <li key={i}>{message}</li>)}
        </ul>
      )}
      {preview && (
        <div className="import-preview">
          <p className="import-count">{app.t('import.count', { 'count:night': preview.count })}</p>
          <table aria-label={app.t('ui.importPreview')}>
            <tbody>
              {preview.changes.map((change) => <tr key={`${change.room}|${change.date}`}><td className="num">{row(change)}</td></tr>)}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
