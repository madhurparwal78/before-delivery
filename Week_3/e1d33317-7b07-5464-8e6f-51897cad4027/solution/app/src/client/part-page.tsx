// One instrument's part as portrait pages (a sideways strip on phones), with the break controls and the PDF status chip.

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { Part, PartLayout } from '../shared/protocol.js'
import { api, ApiFailure } from './api.js'
import { byPage, SystemFigure } from './score-view.js'
import { PartChip } from './tools.js'
import { Icon, useMedia, useSession, useSnapshot } from './ui.js'

interface Props {
  partId: string
  onBack: () => void
  onExtract: (part: Part) => void
  /** Hidden while the Helix peel is still settling. */
  settled: boolean
  /** True when the page stands in front of the Helix drum. */
  inHelix?: boolean
}

/** The part page fades in over about a fifth of a second when it appears (brief: Motion and effects, reduced motion). */
const CROSSFADE_MS = 200

interface BreakItem { measure: number; kind: 'system' | 'page' }

const breakItems = (layout: PartLayout): BreakItem[] =>
  [...layout.systemBreaks.map((measure) => ({ measure, kind: 'system' as const })), ...layout.pageBreaks.map((measure) => ({ measure, kind: 'page' as const }))]
    .sort((a, b) => a.measure - b.measure || (a.kind === 'page' ? 1 : -1))

export function PartPage({ partId, onBack, onExtract, settled, inHelix = false }: Props): ReactNode {
  const session = useSession()
  const snap = useSnapshot()
  const phone = useMedia('(max-width: 767px)')
  const part = snap.parts.find((p) => p.id === partId)
  const entry = snap.partSystems[partId]
  const [after, setAfter] = useState('1')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const afterId = useId()
  const layoutKey = JSON.stringify(part?.layout)
  const canBreak = snap.me?.role !== 'player'
  const region = useRef<HTMLDivElement>(null)
  const hasPart = part !== undefined

  useEffect(() => {
    if (settled) region.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: CROSSFADE_MS, easing: 'ease-out' })
  }, [settled, partId, hasPart])

  useEffect(() => {
    const timer = window.setTimeout(() => void session.loadPartSystems(partId), 20)
    return () => window.clearTimeout(timer)
  }, [session, partId, snap.score?.lamport, snap.score?.measureCount, layoutKey, part?.revision])

  if (!part) return <div className="part-page"><p className="engraving-empty">This part is not in the score.</p></div>

  const saveLayout = async (next: PartLayout, copy: string): Promise<void> => {
    setBusy(true)
    setProblem('')
    try {
      await api('PUT', `/api/scores/${session.scoreId}/parts/${part.id}/layout`, next)
      session.notice('Layout', copy)
    } catch (error) {
      const message = error instanceof ApiFailure ? error.detail : 'The server could not be reached.'
      setProblem(message)
      session.notice('Layout', message)
    } finally {
      setBusy(false)
    }
  }

  const add = (kind: 'system' | 'page'): void => {
    const measure = Number(after)
    const layout = part.layout
    const next: PartLayout = kind === 'system'
      ? { systemBreaks: [...new Set([...layout.systemBreaks, measure])], pageBreaks: layout.pageBreaks }
      : { systemBreaks: layout.systemBreaks, pageBreaks: [...new Set([...layout.pageBreaks, measure])] }
    void saveLayout(next, kind === 'system' ? `System break after measure ${measure} added.` : `Page turn after measure ${measure} added.`)
  }

  const remove = (measure: number): void =>
    void saveLayout(
      { systemBreaks: part.layout.systemBreaks.filter((m) => m !== measure), pageBreaks: part.layout.pageBreaks.filter((m) => m !== measure) },
      `Removed break after measure ${measure}.`,
    )

  const extract = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await api<{ part: Part }>('POST', `/api/scores/${session.scoreId}/parts/${part.id}/extract`, {})
      session.notice('Parts', `Engraving ${result.part.name}…`)
      onExtract(result.part)
    } catch (error) {
      session.notice('Parts', error instanceof ApiFailure ? error.body.message : 'The server could not be reached.')
    } finally {
      setBusy(false)
    }
  }

  const pages = entry ? byPage(entry.systems) : []
  const title = `${snap.score?.title ?? ''} — ${part.name}`
  return (
    <div ref={region} role="region" aria-label={`${part.name} part`} className={`part-page${inHelix ? ' in-helix' : ''}`} style={settled ? undefined : { visibility: 'hidden' }}>
      <header className="part-header">
        <h2>{part.name}</h2>
        <div className="actions">
          <button type="button" className="btn on-paper" onClick={onBack}><Icon name="arrow-left" />Back to score</button>
          <button type="button" className="btn" disabled={busy} onClick={() => void extract()}>{busy ? `Extract ${part.name}…` : `Extract ${part.name}`}</button>
        </div>
        <div className="chip-row"><PartChip part={part} /></div>
        {canBreak && (
          <>
            <div className="breaks" style={{ gridColumn: '1 / -1' }}>
              <label>After measure
                <input id={afterId} type="number" min={1} value={after} onChange={(e) => setAfter(e.target.value)} />
              </label>
              <button type="button" className="btn on-paper small" disabled={busy} onClick={() => add('system')}>Add system break</button>
              <button type="button" className="btn on-paper small" disabled={busy} onClick={() => add('page')}>Add page turn</button>
            </div>
            {problem && <p className="field-error" style={{ gridColumn: '1 / -1' }}><span className="marker" aria-hidden="true" />{problem}</p>}
            <ul className="break-list" aria-label="Breaks">
              {breakItems(part.layout).map((b) => (
                <li key={`${b.kind}-${b.measure}`}>
                  {b.kind === 'system' ? `System break after measure ${b.measure}` : `Page turn after measure ${b.measure}`}
                  <button type="button" className="btn on-paper small icon-only" aria-label={`Remove break after measure ${b.measure}`} disabled={busy} onClick={() => remove(b.measure)}><Icon name="x" /></button>
                </li>
              ))}
            </ul>
          </>
        )}
      </header>
      {!entry && <p className="engraving-empty">Engraving {part.name}…</p>}
      <div className="part-pages">
      {phone ? (
        <div role="region" aria-label="System strip" className="strip" tabIndex={0}>
          {pages.map((page, i) => (
            <div key={i} role="group" aria-label={`Page ${i + 1}`} className="part-strip-page">
              {page.map((s) => <div className="strip-system" key={s.index}><SystemFigure system={s} role="part" /></div>)}
            </div>
          ))}
        </div>
      ) : (
        pages.map((page, i) => (
          <div key={i} role="group" aria-label={`Page ${i + 1}`} className="page-sheet">
            <div className="page-title">{title}</div>
            <div className="page-body">{page.map((s) => <SystemFigure key={s.index} system={s} role="part" />)}</div>
            <div className="page-foot">{i + 1}</div>
          </div>
        ))
      )}
      </div>
    </div>
  )
}
