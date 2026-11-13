import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { DesignerPattern } from '../../shared/api.ts'
import { symbolsFor } from '../../shared/symbols.ts'
import { call, newId } from '../api.ts'
import { Glyph } from '../components/Glyph.tsx'
import { Shell } from '../components/Shell.tsx'
import { Grid } from '../chart/Grid.tsx'
import { Lines, type TextEditing } from '../chart/Lines.tsx'
import { ColourPanel, ErrorsPanel, HerePanel, NotesPanel, RepeatsPanel, TestersPanel, VersionsPanel, WarningsPanel, type VersionActions } from '../chart/Panels.tsx'
import { useDesigner } from '../chart/useDesigner.ts'
import { useSession } from '../session.tsx'
import { NotFound, useRequireUser } from './Account.tsx'

type Tab = 'chart' | 'instructions' | 'testers'
const TAB_OF: Record<string, Tab> = { chart: 'chart', instructions: 'instructions', versions: 'testers', testers: 'testers', notes: 'testers' }
const PANELS = [
  { id: 'chart', label: 'Chart' }, { id: 'instructions', label: 'Instructions' }, { id: 'versions', label: 'Versions' },
  { id: 'testers', label: 'Testers' }, { id: 'notes', label: 'Row notes' },
]

function Choice({ group, label, checked, onChange, children }: { group: string; label: string; checked: boolean; onChange(): void; children?: ReactNode }) {
  return (
    <label className={`choice${checked ? ' chosen' : ''}`}>
      <input type="radio" name={group} className="cover" checked={checked} onChange={onChange} />
      {children}
      <span>{label}</span>
    </label>
  )
}

export function Designer({ id }: { id: string }) {
  const me = useRequireUser()
  if (!me) return null
  return <DesignerPage id={id} />
}

function DesignerPage({ id }: { id: string }) {
  const { layout, me } = useSession()
  const d = useDesigner(id)
  const api = useRef(d)
  api.current = d
  const [tab, setTab] = useState<Tab>('chart')
  const [navPanel, setNavPanel] = useState('chart')
  const region = useRef<HTMLElement>(null)
  const pending = useRef<string | null>(null)

  const { model, meta } = d

  useLayoutEffect(() => {
    if (!d.focusWanted.current) return
    d.focusWanted.current = false
    region.current?.querySelector<HTMLElement>('[data-cursor="true"]')?.focus()
  }, [d.pos])
  useLayoutEffect(() => {
    const row = d.focusEdit.current
    if (row === null || d.editing !== null) return
    d.focusEdit.current = null
    document.querySelector<HTMLElement>(`li[data-row="${row}"] .card-actions button`)?.focus()
  }, [d.editing, d.focusEdit, model])
  useLayoutEffect(() => {
    if (pending.current) document.getElementById(pending.current)?.scrollIntoView({ block: 'nearest' })
    pending.current = null
  }, [tab])

  const editor = useMemo<TextEditing>(() => ({
    apply: (row, text) => api.current.applyText(row, text),
    close: (row) => { api.current.setEditing(null); api.current.focusEdit.current = row },
  }), [])
  const onPin = useMemo(() => (row: number) => api.current.lift.pinRow(row), [])
  const onEdit = useMemo(() => (row: number) => api.current.setEditing(row), [])

  const versionActions: VersionActions = {
    async save(note) {
      const made = await call<{ version: number }>('POST', `/api/patterns/${id}/versions`, { note })
      d.setSync(`Version ${made.version} saved.`)
      d.setVersions((await call<{ versions: typeof d.versions }>('GET', `/api/patterns/${id}/versions`)).versions)
      d.setMeta((m) => (m ? { ...m, version: made.version } : m))
    },
    async restore(version) {
      const op = newId()
      d.ownOps.current.add(op)
      const made = await call<{ version: number }>('POST', `/api/patterns/${id}/versions/${version}/restore`, undefined, op)
      const fresh = await call<DesignerPattern>('GET', `/api/patterns/${id}`)
      d.clearUndo()
      d.commitStructure(fresh, 'own')
      d.setVersions((await call<{ versions: typeof d.versions }>('GET', `/api/patterns/${id}/versions`)).versions)
      d.setMeta((m) => (m ? { ...m, version: made.version } : m))
      d.setSync(`Restored version ${version} as version ${made.version}.`)
    },
    async publish() {
      const published = await call<{ version: number }>('POST', `/api/patterns/${id}/publish`, {})
      d.setMeta((m) => (m ? { ...m, state: 'published' } : m))
      d.setSync(`Published version ${published.version}.`)
    },
  }

  if (d.state === 'missing') return <NotFound />
  const lead = d.state === 'failed' ? 'This page could not be loaded. Reload to try again.'
    : !model ? 'Loading...' : model.rows.flatMap((r) => r.errors)[0] ?? 'All rows check out.'

  const openPanel = (panel: string) => {
    pending.current = panel
    setNavPanel(panel)
    setTab(TAB_OF[panel])
    if (layout === 'desktop') document.getElementById(panel)?.scrollIntoView({ block: 'nearest' })
  }

  if (!model || !meta || !me) return <Shell lead={lead} live={d.live}><div /></Shell>

  const symbols = symbolsFor(model.craft, model.terms)
  const gridEvents = {
    onPointerDown: d.onPointerDown, onPointerMove: d.onPointerMove, onPointerUp: d.onPointerUp, onPointerCancel: d.onPointerCancel,
    onMouseDown: (e: React.MouseEvent) => { if ((e.target as HTMLElement).closest('[data-col]')) e.preventDefault() },
    ...d.lift.events,
  }
  const lineEvents = {
    ...d.lift.events,
    onKeyDown: (e: React.KeyboardEvent<HTMLUListElement>) => {
      const token = (e.target as HTMLElement).closest<HTMLElement>('[data-token]')
      if (!token) return
      const all = [...token.closest('[data-line]')!.querySelectorAll<HTMLElement>('[data-token]')]
      const at = all.indexOf(token)
      if (e.key === 'ArrowRight' && all[at + 1]) { e.preventDefault(); all[at + 1].focus() }
      else if (e.key === 'ArrowLeft' && all[at - 1]) { e.preventDefault(); all[at - 1].focus() }
      else if (e.key === 'Enter') {
        e.preventDefault()
        d.lift.pinToken(Number(token.closest<HTMLElement>('[data-row]')!.dataset.row), Number(token.dataset.index))
      }
    },
  }

  const toolbar = (
    <div className="toolbar">
      <div className="toolrow">
        <div role="radiogroup" aria-label="Tool" className="choices">
          <Choice group="tool" label="Paint" checked={d.tool === 'paint'} onChange={() => d.setTool('paint')} />
          <Choice group="tool" label="Select" checked={d.tool === 'select'} onChange={() => d.setTool('select')} />
        </div>
        <button type="button" onClick={d.addRepeat}>Add repeat</button>
        <button type="button" onClick={d.mirror}>Mirror</button>
      </div>
      <div role="radiogroup" aria-label="Symbols" className="choices symbols">
        {symbols.map((s) => (
          <Choice key={s.key} group="symbol" label={s.name} checked={d.symbol === s.key} onChange={() => d.setSymbol(s.key)}>
            <span className={`tile small-tile tint-${TINTS[s.family]}`}><Glyph stitch={s.key} size={20} /></span>
          </Choice>
        ))}
      </div>
      <div role="radiogroup" aria-label="Colours" className="choices">
        {model.colours.map((c) => (
          <Choice key={c.letter} group="colour" label={`${c.letter} ${c.name}`} checked={d.colour === c.letter} onChange={() => d.setColour(c.letter)}>
            <span className="swatch" style={{ backgroundColor: c.hex }} aria-hidden="true" />
          </Choice>
        ))}
      </div>
    </div>
  )

  const chartRegion = (
    <section aria-label="Chart" className="region" id="chart" ref={region} onKeyDown={d.onKeyDown}>
      {toolbar}
      <Grid label="Stitch chart" model={model} view={d.view} {...gridEvents} />
    </section>
  )
  const instructionsRegion = (
    <section aria-label="Instructions" className="region" id="instructions">
      <Lines rows={model.rows} view={d.lift.lines} readOnly={false} editingRow={d.editing} editor={editor}
        onPin={onPin} onEdit={onEdit} {...lineEvents} />
    </section>
  )
  const chartPanels = (
    <>
      <RepeatsPanel repeats={model.repeats} setTimes={d.setTimes} expand={d.expand} />
      <ColourPanel patternId={id} colours={model.colours} onAdded={d.addColour} />
      <ErrorsPanel rows={model.rows} goTo={(row) => d.moveTo({ row, col: 1 }, null, false)} />
      <WarningsPanel warnings={model.warnings} />
      <HerePanel me={me} users={d.users} />
    </>
  )
  const testPanels = (
    <>
      <VersionsPanel patternId={id} versions={d.versions} actions={versionActions} />
      <TestersPanel owner={meta.role === 'owner'} testers={d.testers}
        invite={async (email) => {
          const sent = await call<{ email: string }>('POST', `/api/patterns/${id}/testers`, { email })
          d.setSync(`Invitation sent to ${sent.email}.`)
        }}
        addCoDesigner={async (email) => {
          const added = await call<{ name: string }>('POST', `/api/patterns/${id}/co-designers`, { email })
          d.setSync(`${added.name} can now edit this pattern.`)
        }} />
      <NotesPanel notes={d.notes} />
    </>
  )

  const onTabKey = (e: React.KeyboardEvent) => {
    const order: Tab[] = ['chart', 'instructions', 'testers']
    const at = order.indexOf(document.activeElement?.getAttribute('data-tab') as Tab)
    const move = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!move || at < 0) return
    e.preventDefault()
    document.querySelector<HTMLElement>(`[data-tab="${order[(at + move + order.length) % order.length]}"]`)?.focus()
  }

  return (
    <Shell lead={lead} live={d.live} panels={PANELS} activePanel={layout === 'desktop' ? navPanel : tab === 'testers' && !['versions', 'testers', 'notes'].includes(navPanel) ? 'versions' : tab === 'testers' ? navPanel : tab} onPanel={openPanel} wide>
      <h1>{meta.name}</h1>
      <div className="notices">
        <div role="status" aria-label="Cell announcement">{d.announce}</div>
        <div role="status" aria-label="Row check">{d.check}</div>
        <div role="status" aria-label="Chart sync">{d.sync}</div>
        <div role="status" aria-label="Row changed">{d.rowChanged}</div>
        {d.conflict.length > 0 && <div role="alert" aria-label="Conflict">{d.conflict.map((l, i) => <p key={i}>{l}</p>)}</div>}
      </div>
      {layout === 'desktop' ? (
        <>
          <div className="workspace">{chartRegion}{instructionsRegion}</div>
          <div className="panels">{chartPanels}{testPanels}</div>
        </>
      ) : (
        <>
          <div role="tablist" aria-label="Pattern" className="tabs" onKeyDown={onTabKey}>
            {(['chart', 'instructions', 'testers'] as Tab[]).map((t) => (
              <button key={t} type="button" role="tab" data-tab={t} aria-selected={tab === t} tabIndex={tab === t ? 0 : -1} onClick={() => setTab(t)}>
                {t === 'chart' ? 'Chart' : t === 'instructions' ? 'Instructions' : 'Testers'}
              </button>
            ))}
          </div>
          <div role="tabpanel" className="tabpanel">
            {tab === 'chart' && <>{chartRegion}<div className="panels">{chartPanels}</div></>}
            {tab === 'instructions' && instructionsRegion}
            {tab === 'testers' && <div className="panels">{testPanels}</div>}
          </div>
        </>
      )}
    </Shell>
  )
}

const TINTS = ['green', 'rose', 'tan', 'butter', 'blue', 'lilac', 'sage', 'pink', 'teal', 'periwinkle']
