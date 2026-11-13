import { useEffect, useMemo, useState } from 'react'
import type { PublicPattern } from '../../shared/api.ts'
import { call } from '../api.ts'
import { Shell } from '../components/Shell.tsx'
import { Grid, EMPTY_VIEW, type GridView } from '../chart/Grid.tsx'
import { Lines, type TextEditing } from '../chart/Lines.tsx'
import { type ChartModel, modelOf } from '../chart/model.ts'
import { useTwinLift } from '../chart/useTwinLift.ts'
import { NotFound } from './Account.tsx'

const NO_EDITOR: TextEditing = { apply: async () => null, close: () => undefined }

export function Public({ id }: { id: string }) {
  const [pattern, setPattern] = useState<PublicPattern | null | 'missing'>(null)
  useEffect(() => { call<PublicPattern>('GET', `/api/public/${id}`).then(setPattern, () => setPattern('missing')) }, [id])
  const model: ChartModel | null = useMemo(() => (pattern && pattern !== 'missing'
    ? modelOf({ ...pattern, rows: pattern.rows.map((r) => ({ ...r, notes: 0, textBlock: null })) }) : null), [pattern])
  const lift = useTwinLift(model)
  if (pattern === 'missing') return <NotFound />
  if (!pattern || !model) return <Shell lead="Loading..." live={null}><div /></Shell>
  const view: GridView = { ...EMPTY_VIEW, lifted: lift.lifted, pinned: lift.pinned }
  return (
    <Shell lead={`${pattern.name}, version ${pattern.version}.`} live={null}>
      <div className="stack">
        <div className="heading-row">
          <h1>{pattern.name}</h1>
          <a className="button primary" href={`/api/patterns/${pattern.id}/sheet.pdf`} download>Download sheet</a>
        </div>
        <Grid label="Stitch chart" model={model} view={view} {...lift.events} />
        <Lines rows={model.rows} view={lift.lines} readOnly editingRow={null} editor={NO_EDITOR} onPin={lift.pinRow} onEdit={() => undefined} {...lift.events} />
      </div>
    </Shell>
  )
}
