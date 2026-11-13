import { useEffect, useState, type FormEvent } from 'react'
import type { Colour, NoteEntry, Repeat, Row, TesterEntry, VersionEntry } from '../../shared/api.ts'
import { ApiFail, call } from '../api.ts'
import { Dialog } from '../components/Dialog.tsx'
import { navigate } from '../router.ts'

function invalidIf(error: { field: string } | null, field: string): true | undefined {
  return error?.field === field ? true : undefined
}

function failure(error: unknown): { field: string; message: string } {
  if (error instanceof ApiFail) return { field: error.body.field ?? '', message: error.body.message ?? 'That change was not saved. Try again.' }
  throw error
}

export function RepeatsPanel({ repeats, setTimes, expand }: { repeats: Repeat[]; setTimes(id: string, times: number): Promise<void>; expand(box: Repeat): void }) {
  return (
    <section id="repeats" className="side">
      <h2>Repeats</h2>
      <ul role="list" aria-label="Repeats" className="plain-list">
        {repeats.length === 0 && <li>No repeats yet.</li>}
        {repeats.map((box) => <RepeatItem key={box.id} box={box} setTimes={setTimes} expand={expand} />)}
      </ul>
    </section>
  )
}

function RepeatItem({ box, setTimes, expand }: { box: Repeat; setTimes(id: string, times: number): Promise<void>; expand(box: Repeat): void }) {
  const [draft, setDraft] = useState(String(box.times))
  useEffect(() => setDraft(String(box.times)), [box.times])
  const commit = () => {
    if (Number(draft) === box.times) return
    setTimes(box.id, Number(draft)).catch(() => setDraft(String(box.times)))
  }
  return (
    <li className="repeat-item">
      <span>Repeat {box.id}</span>
      <input type="number" min={2} max={20} aria-label={`Times for ${box.id}`} value={draft} onChange={(e) => setDraft(e.target.value)}
        onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit() }} />
      <button type="button" className="small" aria-label={`Expand repeat ${box.id}`} onClick={() => expand(box)}>Expand</button>
    </li>
  )
}

export function ColourPanel({ patternId, colours, onAdded }: { patternId: string; colours: Colour[]; onAdded(colour: Colour): void }) {
  const [name, setName] = useState('')
  const [hex, setHex] = useState('')
  const [error, setError] = useState<{ field: string; message: string } | null>(null)
  const add = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      const made = await call<{ letter: string }>('POST', `/api/patterns/${patternId}/colours`, { name, hex })
      onAdded({ letter: made.letter, name: name.trim(), hex: hex.toLowerCase() })
      setName('')
      setHex('')
    } catch (failed) {
      setError(failure(failed))
    }
  }
  return (
    <section id="colours" className="side">
      <h2>Colour key</h2>
      <ul role="list" aria-label="Colour key" className="plain-list">
        {colours.map((c) => (
          <li key={c.letter} className="swatch-item"><span className="swatch" style={{ backgroundColor: c.hex }} aria-hidden="true" /><span>{c.letter} {c.name}</span></li>
        ))}
      </ul>
      <form className="stack" onSubmit={add} noValidate>
        <label className="field">Colour name<input type="text" aria-label="Colour name" aria-invalid={invalidIf(error, 'name')} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field">Colour hex<input type="text" aria-label="Colour hex" placeholder="#aabbcc" aria-invalid={invalidIf(error, 'hex')} value={hex} onChange={(e) => setHex(e.target.value)} /></label>
        <div><button type="submit">Add colour</button></div>
        {error && <p role="alert" aria-label="Colour error" className="error">{error.message}</p>}
      </form>
    </section>
  )
}

export function ErrorsPanel({ rows, goTo }: { rows: Row[]; goTo(row: number): void }) {
  const errors = rows.flatMap((r) => r.errors.map((message) => ({ row: r.row, message })))
  return (
    <section id="errors" className="side">
      <h2>Row errors</h2>
      <ul role="list" aria-label="Row errors" className="plain-list">
        {errors.length === 0 && <li>All rows check out.</li>}
        {errors.map((e, i) => (
          <li key={i} data-row={e.row}><button type="button" className="linkish" onClick={() => goTo(e.row)}>{e.message}</button></li>
        ))}
      </ul>
    </section>
  )
}

export function WarningsPanel({ warnings }: { warnings: { row: number; message: string }[] }) {
  return (
    <section id="warnings" className="side">
      <h2>Colour warnings</h2>
      <ul role="list" aria-label="Colour warnings" className="plain-list">
        {warnings.length === 0 && <li>No colour warnings.</li>}
        {warnings.map((w, i) => <li key={i} data-row={w.row}>{w.message}</li>)}
      </ul>
    </section>
  )
}

export function HerePanel({ me, users }: { me: { id: string; name: string }; users: { id: string; name: string }[] }) {
  const others = users.filter((u) => u.id !== me.id).sort((a, b) => a.name.localeCompare(b.name))
  return (
    <section id="here" className="side">
      <h2>Here now</h2>
      <ul role="list" aria-label="Here now" className="plain-list">
        <li>{me.name} (you)</li>
        {others.map((u) => <li key={u.id}>{u.name}</li>)}
      </ul>
    </section>
  )
}

export interface VersionActions {
  save(note: string): Promise<void>
  restore(version: number): Promise<void>
  publish(): Promise<void>
}

export function VersionsPanel({ patternId, versions, actions }: { patternId: string; versions: VersionEntry[]; actions: VersionActions }) {
  const latest = versions.length ? versions[versions.length - 1].version : 0
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [saving, setSaving] = useState(false)
  const [restoring, setRestoring] = useState<number | null>(null)
  const [publishError, setPublishError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setFrom(String(versions.length > 1 ? versions[versions.length - 2].version : latest || ''))
    setTo(String(latest || ''))
  }, [latest, versions.length])
  const publish = async () => {
    setBusy(true)
    setPublishError('')
    try { await actions.publish() } catch (error) { setPublishError(failure(error).message) } finally { setBusy(false) }
  }
  return (
    <section id="versions" className="side wide-side">
      <h2>Versions</h2>
      <div className="actions">
        <button type="button" onClick={() => setSaving(true)}>Save version</button>
        <button type="button" className="primary" disabled={busy} aria-busy={busy} onClick={() => void publish()}>Publish</button>
      </div>
      {publishError && <p role="alert" aria-label="Publish error" className="error">{publishError}</p>}
      <div className="actions compare-row">
        <label className="field">From<select aria-label="From version" value={from} onChange={(e) => setFrom(e.target.value)}>
          {versions.map((v) => <option key={v.version} value={v.version}>{`Version ${v.version}`}</option>)}
        </select></label>
        <label className="field">To<select aria-label="To version" value={to} onChange={(e) => setTo(e.target.value)}>
          {versions.map((v) => <option key={v.version} value={v.version}>{`Version ${v.version}`}</option>)}
        </select></label>
        <button type="button" disabled={!versions.length} onClick={() => navigate(`/patterns/${patternId}/compare?a=${from}&b=${to}`)}>Compare</button>
      </div>
      <div className="table-wrap">
        <table aria-label="Versions">
          <thead><tr><th scope="col">Version</th><th scope="col">Note</th><th scope="col">Saved on</th><th scope="col">Stitches</th></tr></thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.version}>
                <td>{v.version} <button type="button" className="small" aria-label={`Restore version ${v.version}`} onClick={() => setRestoring(v.version)}>Restore</button></td>
                <td>{v.note}</td><td>{v.savedOn}</td><td>{v.stitches}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {saving && <SaveVersion onSave={actions.save} onClose={() => setSaving(false)} />}
      {restoring !== null && <RestoreVersion version={restoring} next={latest + 1} onRestore={actions.restore} onClose={() => setRestoring(null)} />}
    </section>
  )
}

function SaveVersion({ onSave, onClose }: { onSave(note: string): Promise<void>; onClose(): void }) {
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try { await onSave(note); onClose() } catch (failed) { setError(failure(failed).message); setBusy(false) }
  }
  return (
    <Dialog label="Save version" onClose={onClose}>
      <form className="stack" onSubmit={save} noValidate>
        <h2>Save version</h2>
        <label className="field">Version note<input type="text" aria-label="Version note" aria-invalid={error ? true : undefined} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        {error && <p role="alert" aria-label="Version error" className="error">{error}</p>}
        <div className="actions">
          <button type="submit" className="primary" disabled={busy} aria-busy={busy}>Save</button>
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Dialog>
  )
}

function RestoreVersion({ version, next, onRestore, onClose }: { version: number; next: number; onRestore(version: number): Promise<void>; onClose(): void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const restore = async () => {
    setBusy(true)
    setError('')
    try { await onRestore(version); onClose() } catch (failed) { setError(failure(failed).message); setBusy(false) }
  }
  return (
    <Dialog label={`Restore version ${version}?`} onClose={onClose}>
      <div className="stack">
        <h2>{`Restore version ${version}?`}</h2>
        <p>{`This makes version ${next} from version ${version}. Nothing is deleted.`}</p>
        {error && <p role="alert" aria-label="Restore error" className="error">{error}</p>}
        <div className="actions">
          <button type="button" className="primary" disabled={busy} aria-busy={busy} onClick={() => void restore()}>Restore</button>
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Dialog>
  )
}

export function TestersPanel({ owner, testers, invite, addCoDesigner }: {
  owner: boolean; testers: TesterEntry[]; invite(email: string): Promise<void>; addCoDesigner(email: string): Promise<void>
}) {
  const [email, setEmail] = useState('')
  const [coEmail, setCoEmail] = useState('')
  const [error, setError] = useState<{ field: string; message: string } | null>(null)
  const [coError, setCoError] = useState<{ field: string; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const send = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try { await invite(email); setEmail('') } catch (failed) { setError(failure(failed)) } finally { setBusy(false) }
  }
  const add = async (event: FormEvent) => {
    event.preventDefault()
    setCoError(null)
    try { await addCoDesigner(coEmail); setCoEmail('') } catch (failed) { setCoError(failure(failed)) }
  }
  return (
    <section id="testers" className="side wide-side">
      <h2>Testers</h2>
      <form className="stack" onSubmit={send} noValidate>
        <label className="field">Tester email<input type="text" aria-label="Tester email" aria-invalid={error ? true : undefined} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <div><button type="submit" disabled={busy} aria-busy={busy}>Invite tester</button></div>
        {error && <p role="alert" aria-label="Tester error" className="error">{error.message}</p>}
      </form>
      {owner && (
        <form className="stack" onSubmit={add} noValidate>
          <label className="field">Co-designer email<input type="text" aria-label="Co-designer email" aria-invalid={coError ? true : undefined} value={coEmail} onChange={(e) => setCoEmail(e.target.value)} /></label>
          <div><button type="submit">Add co-designer</button></div>
          {coError && <p role="alert" aria-label="Co-designer error" className="error">{coError.message}</p>}
        </form>
      )}
      <div className="table-wrap">
        <table aria-label="Testers">
          <thead><tr><th scope="col">Name</th><th scope="col">Version</th><th scope="col">Row</th><th scope="col">Notes</th></tr></thead>
          <tbody>
            {testers.map((t) => <tr key={t.id}><td>{t.name}</td><td>{t.version}</td><td>{t.row}</td><td>{t.notes}</td></tr>)}
          </tbody>
        </table>
      </div>
      {testers.length === 0 && <p className="hint">No testers yet.</p>}
    </section>
  )
}

export function NotesPanel({ notes }: { notes: NoteEntry[] }) {
  return (
    <section id="notes" className="side">
      <h2>Row notes</h2>
      <ul role="list" aria-label="Row notes" className="plain-list">
        {notes.map((n, i) => <li key={i}>{`Row ${n.row}: ${n.text} (${n.tester})`}</li>)}
      </ul>
      {notes.length === 0 && <p className="hint">No notes yet.</p>}
    </section>
  )
}
