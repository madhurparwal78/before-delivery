import { useEffect, useState } from 'react'
import type { DesignerPattern, VersionEntry, VersionPayload } from '../../shared/api.ts'
import { ApiFail, call } from '../api.ts'
import { Shell } from '../components/Shell.tsx'
import { Grid, EMPTY_VIEW, type GridView } from '../chart/Grid.tsx'
import { type ChartModel, modelOf } from '../chart/model.ts'
import { useTwinLift } from '../chart/useTwinLift.ts'
import { useLive } from '../live.ts'
import { navigate, useLocation } from '../router.ts'
import { NotFound, useRequireUser } from './Account.tsx'

interface Comparison { a: number; b: number; summary: string; cells: { row: number; col: number; diff: string }[] }

export function Compare({ id }: { id: string }) {
  const me = useRequireUser()
  const { search } = useLocation()
  const { live } = useLive(null, () => undefined)
  const [versions, setVersions] = useState<VersionEntry[] | null>(null)
  const [missing, setMissing] = useState(false)
  const [failed, setFailed] = useState(false)
  const [result, setResult] = useState<{ summary: string; model: ChartModel; diffs: Map<number, string[]> } | null>(null)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const lift = useTwinLift(result?.model ?? null)
  const query = `${search.get('a') ?? ''}/${search.get('b') ?? ''}`

  useEffect(() => {
    if (!me) return
    call<{ versions: VersionEntry[] }>('GET', `/api/patterns/${id}/versions`).then((r) => setVersions(r.versions), () => setMissing(true))
  }, [me, id])

  useEffect(() => {
    if (!versions) return
    if (!versions.length) { setResult(null); return }
    const last = versions[versions.length - 1].version
    const a = search.get('a') ?? String(versions.length > 1 ? versions[versions.length - 2].version : last)
    const b = search.get('b') ?? String(last)
    setFrom(a)
    setTo(b)
    void (async () => {
      try {
        const compared = await call<Comparison>('GET', `/api/patterns/${id}/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`)
        const chart = await call<VersionPayload>('GET', `/api/patterns/${id}/versions/${compared.b}`)
        const shape = await call<DesignerPattern>('GET', `/api/patterns/${id}`)
        const diffs = new Map<number, string[]>()
        for (const c of compared.cells) {
          if (!diffs.has(c.row)) diffs.set(c.row, [])
          diffs.get(c.row)![c.col - 1] = c.diff
        }
        setResult({ summary: compared.summary, diffs, model: modelOf({ ...chart, craft: shape.craft, mode: shape.mode, terms: shape.terms }) })
      } catch (error) {
        if (error instanceof ApiFail && error.status === 404) setMissing(true)
        else setFailed(true)
      }
    })()
  }, [versions, query, id])

  if (!me) return null
  if (missing) return <NotFound />
  const view: GridView = { ...EMPTY_VIEW, diffs: result?.diffs ?? new Map(), lifted: lift.lifted, pinned: lift.pinned }
  // The page is laid out once: with versions to compare it waits for the comparison itself, so nothing below it moves later.
  const loading = !versions || (versions.length > 0 && !result && !failed)
  const lead = failed ? 'This page could not be loaded. Reload to try again.' : loading ? 'Loading...' : 'Compare two saved versions.'
  return (
    <Shell lead={lead} live={live}>
      {versions && !loading && (
        <div className="stack">
          <h1>Compare versions</h1>
          <div className="actions compare-row">
            <label className="field">From
              <select aria-label="From version" value={from} onChange={(e) => setFrom(e.target.value)}>
                {versions.map((v) => <option key={v.version} value={v.version}>{`Version ${v.version}`}</option>)}
              </select>
            </label>
            <label className="field">To
              <select aria-label="To version" value={to} onChange={(e) => setTo(e.target.value)}>
                {versions.map((v) => <option key={v.version} value={v.version}>{`Version ${v.version}`}</option>)}
              </select>
            </label>
            <button type="button" disabled={!versions.length} onClick={() => navigate(`/patterns/${id}/compare?a=${from}&b=${to}`)}>Compare</button>
          </div>
          <div role="status" aria-label="Compare result">{result?.summary ?? ''}</div>
          {result && <Grid label="Compare chart" model={result.model} view={view} {...lift.events} />}
        </div>
      )}
    </Shell>
  )
}
