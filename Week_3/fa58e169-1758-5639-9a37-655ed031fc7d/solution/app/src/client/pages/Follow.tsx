import { useEffect, useMemo, useRef, useState } from 'react'
import type { FollowPattern, LiveMessage, NoteEntry } from '../../shared/api.ts'
import { ApiFail, call, failureText, newId } from '../api.ts'
import { Dialog } from '../components/Dialog.tsx'
import { Shell } from '../components/Shell.tsx'
import { Grid, EMPTY_VIEW, type GridView } from '../chart/Grid.tsx'
import { Lines, type TextEditing } from '../chart/Lines.tsx'
import { type ChartModel, modelOf } from '../chart/model.ts'
import { useTwinLift } from '../chart/useTwinLift.ts'
import { useLive } from '../live.ts'
import { useSession } from '../session.tsx'
import { NotFound, useRequireUser } from './Account.tsx'

const NO_EDITOR: TextEditing = { apply: async () => null, close: () => undefined }
const NO_STITCHES = 'This row has no stitches.'

export function Follow({ id }: { id: string }) {
  const me = useRequireUser()
  return me ? <FollowPage id={id} /> : null
}

function FollowPage({ id }: { id: string }) {
  const { layout, me, config, reduceMotion } = useSession()
  const [state, setState] = useState<'loading' | 'ready' | 'failed' | 'missing'>('loading')
  const [pattern, setPattern] = useState<FollowPattern | null>(null)
  const [row, setRow] = useState(1)
  const rowRef = useRef(1)
  const [latest, setLatest] = useState(0)
  const [moved, setMoved] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [noteStatus, setNoteStatus] = useState('')
  const [notes, setNotes] = useState<NoteEntry[]>([])
  const [adding, setAdding] = useState<number | null>(null)
  const [rowMotion, setRowMotion] = useState(false)
  const [noticeMotion, setNoticeMotion] = useState(false)
  const chain = useRef<Promise<void>>(Promise.resolve())
  const patternRef = useRef<FollowPattern | null>(null)
  const quiet = useRef(reduceMotion)
  quiet.current = reduceMotion
  const limits = config!.limits

  const model: ChartModel | null = useMemo(() => (pattern ? modelOf(pattern) : null), [pattern])
  const lift = useTwinLift(model, row)

  const showRow = (next: number, motion: boolean) => {
    rowRef.current = next
    setRow(next)
    const line = patternRef.current?.rows[next - 1]
    setAnnouncement(line && line.state !== 'empty' ? line.text : NO_STITCHES)
    if (motion && !quiet.current) {
      setRowMotion(true)
      window.setTimeout(() => setRowMotion(false), limits.rowMotionMs)
    }
  }

  const load = async () => {
    const fresh = await call<FollowPattern>('GET', `/api/patterns/${id}/follow`)
    patternRef.current = fresh
    setPattern(fresh)
    setLatest(fresh.latestVersion)
    rowRef.current = fresh.row
    setRow(fresh.row)
    const own = await call<{ notes: NoteEntry[] }>('GET', `/api/patterns/${id}/notes`)
    setNotes(own.notes)
  }

  useEffect(() => {
    load().then(() => setState('ready'), (error) => setState(error instanceof ApiFail && error.status === 404 ? 'missing' : 'failed'))
  }, [id])

  const { live } = useLive(id, (message: LiveMessage) => {
    const current = patternRef.current
    if (!current) return
    if (message.type === 'counter' && message.user.id === me?.id && message.row !== rowRef.current) showRow(message.row, true)
    else if (message.type === 'followed' && message.user.id === me?.id) {
      void load().then(() => setMoved(message.movedFrom ? `Version ${message.version}. Row ${message.movedFrom} is not in this version.` : `Version ${message.version}`))
    } else if (message.type === 'versions') {
      setLatest(message.latest)
      setMoved(null)
      if (message.latest > current.version && !quiet.current) {
        setNoticeMotion(true)
        window.setTimeout(() => setNoticeMotion(false), 250)
      }
    } else if (message.type === 'note' && message.user.id === me?.id) {
      if (message.version === current.version) {
        setNotes((old) => [...old, { row: message.row, text: message.text, tester: message.user.name, version: message.version }])
        setPattern((p) => (p ? { ...p, rows: p.rows.map((r) => (r.row === message.row ? { ...r, notes: message.ownRowNotes } : r)) } : p))
      }
    }
  })

  const step = (delta: number) => {
    chain.current = chain.current.then(async () => {
      const current = patternRef.current
      const from = rowRef.current
      if (!current || from + delta < 1 || from + delta > current.height) return
      try {
        const answer = await call<{ row: number }>('POST', `/api/patterns/${id}/counter`, { from, step: delta, stepId: newId() })
        if (answer.row !== rowRef.current) showRow(answer.row, true)
      } catch (error) {
        setNoteStatus(failureText(error))
      }
    }).catch(() => undefined)
  }
  const stepRef = useRef(step)
  stepRef.current = step

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (e.ctrlKey || e.metaKey || e.altKey || target.closest('[role=dialog]') || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (e.key === 'n') stepRef.current(1)
      else if (e.key === 'p') stepRef.current(-1)
      else if (e.key === ' ' && !target.closest('button')) { e.preventDefault(); stepRef.current(1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const swipe = useRef<{ x: number; y: number } | null>(null)
  const swipeEvents = {
    onPointerDown: (e: React.PointerEvent) => { swipe.current = e.pointerType === 'mouse' ? null : { x: e.clientX, y: e.clientY } },
    onPointerCancel: () => { swipe.current = null },
    onPointerUp: (e: React.PointerEvent) => {
      const start = swipe.current
      swipe.current = null
      if (!start) return
      const dx = e.clientX - start.x
      const dy = e.clientY - start.y
      if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1)
    },
  }

  const move = async () => {
    try {
      const result = await call<{ version: number; row: number; movedFrom: number | null }>('POST', `/api/patterns/${id}/follow`, { version: latest })
      await load()
      setMoved(result.movedFrom ? `Version ${result.version}. Row ${result.movedFrom} is not in this version.` : `Version ${result.version}`)
    } catch (error) {
      setNoteStatus(failureText(error))
    }
  }

  if (state === 'missing') return <NotFound />
  if (state !== 'ready' || !pattern || !model) {
    return <Shell lead={state === 'failed' ? 'This page could not be loaded. Reload to try again.' : 'Loading...'} live={live}><div /></Shell>
  }

  const line = pattern.rows[row - 1]
  const hasLine = line.state !== 'empty'
  const newer = latest > pattern.version
  const versionText = moved ?? (newer ? `Version ${latest} is out. You are following version ${pattern.version}.` : `Version ${pattern.version}`)
  const view: GridView = { ...EMPTY_VIEW, lifted: lift.lifted, pinned: lift.pinned }

  const counter = (
    <>
      <div role="status" aria-label="Row counter" className="counter">{`Row ${row} of ${pattern.height}`}</div>
      <section aria-label="Current row" className="current-row" {...swipeEvents}>
        {hasLine ? <Lines rows={[line]} view={lift.lines} readOnly editingRow={null} editor={NO_EDITOR} onPin={() => undefined} onEdit={() => undefined} {...lift.events} /> : <p>{NO_STITCHES}</p>}
      </section>
    </>
  )
  const buttons = (
    <div className="actions step-buttons">
      <button type="button" onClick={() => step(-1)} disabled={row <= 1}>Previous row</button>
      <button type="button" className="primary" onClick={() => step(1)} disabled={row >= pattern.height}>Next row</button>
      <button type="button" onClick={() => setAdding(row)}>Add note</button>
    </div>
  )
  const mine = (
    <section className="side">
      <h2>Your notes</h2>
      <ul role="list" aria-label="Your notes" className="plain-list">
        {notes.map((n, i) => <li key={i}>{`Row ${n.row}: ${n.text}`}</li>)}
      </ul>
    </section>
  )
  const grid = <Grid label="Stitch chart" model={model} view={view} followRow={row} motion={rowMotion ? 'row' : undefined} padded {...lift.events} />

  return (
    <Shell lead={`Follow ${pattern.name} row by row.`} live={live}>
      <h1>{pattern.name}</h1>
      <div role="status" aria-label="Version" className={`version${newer ? ' newer' : ''}`} data-motion={noticeMotion ? 'notice' : undefined}>{versionText}</div>
      {newer && !moved && <div><button type="button" onClick={() => void move()}>{`Move to version ${latest}`}</button></div>}
      <div role="status" aria-label="Row announcement" className="sr-only">{announcement}</div>
      <div role="status" aria-label="Note status">{noteStatus}</div>
      {layout === 'desktop' ? (
        <div className="follow-desktop">
          <div className="follow-grid">{grid}</div>
          <aside className="follow-side">{counter}{buttons}{mine}</aside>
        </div>
      ) : (
        <>
          <div className="follow-grid">{grid}</div>
          {mine}
          <div className="dock">{counter}{buttons}</div>
        </>
      )}
      {adding !== null && <AddNote patternId={id} row={adding} onClose={() => setAdding(null)} onSaved={(r) => setNoteStatus(`Note saved on row ${r}.`)} />}
    </Shell>
  )
}

function AddNote({ patternId, row, onClose, onSaved }: { patternId: string; row: number; onClose(): void; onSaved(row: number): void }) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await call('POST', `/api/patterns/${patternId}/notes`, { row, text })
      onSaved(row)
      onClose()
    } catch (failed) {
      setError(failed instanceof ApiFail ? failed.body.message ?? failureText(failed) : failureText(failed))
      setBusy(false)
    }
  }
  return (
    <Dialog label="Add note" onClose={onClose}>
      <form className="stack" onSubmit={save} noValidate>
        <h2>{`Add note on row ${row}`}</h2>
        <label className="field">{`Note for row ${row}`}
          <textarea aria-label={`Note for row ${row}`} aria-invalid={error ? true : undefined} rows={4} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        {error && <p role="alert" aria-label="Note error" className="error">{error}</p>}
        <div className="actions">
          <button type="submit" className="primary" disabled={busy} aria-busy={busy}>Save note</button>
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Dialog>
  )
}
