// The tools rail: Parts, History, Holds, Sample banks and People, as a side rail or a bottom sheet.

import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { formatBeat } from '../shared/music.js'
import { ROLE_WORD, STATUS_WORD, type Bank, type Collaborator, type HistoryEntry, type LogEntry, type Part } from '../shared/protocol.js'
import { api, ApiFailure, downloadPdf } from './api.js'
import { EmptyStave, Icon, Status, useSession, useSnapshot } from './ui.js'

const TABS = ['Parts', 'History', 'Holds', 'Sample banks', 'People'] as const
export type Tab = (typeof TABS)[number]

export interface WorkspaceActions {
  holdSelected: () => void
  releaseMine: () => void
  openStaffSettings: () => void
  openInvite: () => void
  openStavesFor: (person: Collaborator) => void
  openRemove: (person: Collaborator) => void
  openPart: (partId: string) => void
}

export const ActionsContext = createContext<WorkspaceActions | null>(null)
const useActions = (): WorkspaceActions => {
  const actions = useContext(ActionsContext)
  if (!actions) throw new Error('No actions')
  return actions
}

const PART_STATUS_WORD: Record<Part['status'], string> = { draft: 'Draft', engraving: 'Engraving', rendering: 'Rendering', ready: 'Ready', pdf_pending: 'PDF pending' }

export function PartChip({ part }: { part: Part }): ReactNode {
  return (
    <span role="status" aria-label={`${part.name} PDF status`} className="chip" data-status={part.status}>
      {PART_STATUS_WORD[part.status]}{part.stale ? ' · Score changed since this PDF' : ''}
    </span>
  )
}

function PartsPanel(): ReactNode {
  const session = useSession()
  const { parts } = useSnapshot()
  const { openPart } = useActions()
  return (
    <div>
      <h3 className="panel-title">Parts</h3>
      <ul className="items" aria-label="Parts">
        {parts.map((part) => (
          <li key={part.id}>
            <span className="grow">{part.name}</span>
            <PartChip part={part} />
            <button type="button" className="btn quiet small" aria-label={`Open ${part.name}`} onClick={() => openPart(part.id)}>Open</button>
            {part.status === 'ready' && (
              <a
                className="btn quiet small"
                href={`/api/scores/${session.scoreId}/parts/${part.id}/pdf`}
                aria-label={`Download ${part.name} PDF`}
                onClick={(event) => {
                  event.preventDefault()
                  void downloadPdf(`/api/scores/${session.scoreId}/parts/${part.id}/pdf`).catch(() => session.notice('Parts', `${part.name} PDF could not be downloaded. Try again.`))
                }}
              >
                <Icon name="download" />PDF
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

const FILTERS: { label: string; query: string; match: (e: LogEntry) => boolean }[] = [
  { label: 'All changes', query: '', match: () => true },
  { label: 'Notes added', query: 'type=insert', match: (e) => e.op.type === 'insert' },
  { label: 'Notes deleted', query: 'type=delete', match: (e) => e.op.type === 'delete' },
  { label: 'Pitch and spelling', query: 'field=pitch', match: (e) => e.op.type === 'set' && e.op.field === 'pitch' },
  { label: 'Ties', query: 'field=tie', match: (e) => e.op.type === 'set' && e.op.field === 'tie' },
  { label: 'Dynamics', query: 'field=dynamic,dynamicPlacement', match: (e) => e.op.type === 'set' && (e.op.field === 'dynamic' || e.op.field === 'dynamicPlacement') },
  { label: 'Text', query: 'field=text', match: (e) => e.op.type === 'set' && e.op.field === 'text' },
]

const clock = (at: string): string => new Date(at).toISOString().slice(11, 19)

function HistoryPanel(): ReactNode {
  const session = useSession()
  const [filter, setFilter] = useState(0)
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [fresh, setFresh] = useState(0)
  const filterRef = useRef(0)
  filterRef.current = filter

  const load = async (index: number): Promise<void> => {
    try {
      const page = await session.fetchHistory(`limit=50${FILTERS[index]?.query ? `&${FILTERS[index]?.query}` : ''}`)
      setEntries(page.entries)
      setCursor(page.nextCursor)
      setFresh(0)
    } catch {
      session.notice('History', 'Could not load history. Try again.')
    }
  }

  useEffect(() => {
    void load(filter)
    const listener = (arrived: LogEntry[]): void => {
      const match = FILTERS[filterRef.current]?.match
      setFresh((n) => n + arrived.filter((e) => match?.(e)).length)
    }
    session.historyListeners.add(listener)
    return () => void session.historyListeners.delete(listener)
  }, [filter])

  const older = async (): Promise<void> => {
    if (!cursor) {
      session.notice('History', 'No older changes.')
      return
    }
    try {
      const page = await session.fetchHistory(`limit=50&before=${cursor}${FILTERS[filter]?.query ? `&${FILTERS[filter]?.query}` : ''}`)
      setEntries((current) => [...current, ...page.entries])
      setCursor(page.nextCursor)
      session.notice('History', page.entries.length ? `Loaded ${page.entries.length} older changes.` : 'No older changes.')
    } catch {
      session.notice('History', 'Could not load history. Try again.')
    }
  }

  const id = useId()
  return (
    <div>
      <h3 className="panel-title">History</h3>
      <label className="field">Show
        <select id={id} value={filter} onChange={(e) => setFilter(Number(e.target.value))}>
          {FILTERS.map((f, i) => <option key={f.label} value={i}>{f.label}</option>)}
        </select>
      </label>
      {fresh > 0 && <div className="new-changes"><button type="button" className="btn small" onClick={() => void load(filter)}>{`Show ${fresh} new changes`}</button></div>}
      <div role="feed" aria-label="Operation history" className="feed" aria-busy="false" style={{ marginTop: 12 }}>
        {entries.map((e) => (
          <article key={e.seq} aria-posinset={undefined}>
            {`${e.author.name} · ${e.summary} · ${e.staffName}, measure ${e.measure}, beat ${formatBeat(e.beat)} · ${clock(e.at)}`}
          </article>
        ))}
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button type="button" className="btn quiet small" onClick={() => void older()}>Load older changes</button>
      </div>
      {entries.length === 0 && <EmptyStave>No changes recorded yet. Typed notes appear here with who changed them.</EmptyStave>}
    </div>
  )
}

function HoldsPanel(): ReactNode {
  const { holds, score, selection } = useSnapshot()
  const { holdSelected, releaseMine, openStaffSettings } = useActions()
  const nameOf = (id: string): string => score?.staves.find((s) => s.id === id)?.name ?? id
  return (
    <div>
      <h3 className="panel-title">Holds</h3>
      <div className="row">
        <button type="button" className="btn small" onClick={holdSelected}>Hold selected staves</button>
        <button type="button" className="btn quiet small" onClick={releaseMine}>Release my holds</button>
        <button type="button" className="btn quiet small" onClick={openStaffSettings} disabled={selection.length !== 1}>Staff settings</button>
      </div>
      <p className="hint">Choose staves in the Staves list, then hold them. Holds mark who is working where; they never block note entry.</p>
      <ul className="items" aria-label="Current holds">
        {holds.map((h) => <li key={h.staffId}>{`${nameOf(h.staffId)} — ${h.holder.name}`}</li>)}
      </ul>
      {holds.length === 0 && <EmptyStave>No staves are held. Select staves, then hold them to mark where you are working.</EmptyStave>}
    </div>
  )
}

interface PendingBank { key: string; fileName: string; staffName: string }

function BanksPanel(): ReactNode {
  const session = useSession()
  const { banks, score, me } = useSnapshot()
  const [staffId, setStaffId] = useState(score?.staves[0]?.id ?? '')
  const [root, setRoot] = useState('A4')
  const [file, setFile] = useState<File | null>(null)
  const [pending, setPending] = useState<PendingBank | null>(null)
  const nameOf = (id: string): string => score?.staves.find((s) => s.id === id)?.name ?? id

  const upload = async (): Promise<void> => {
    if (!file || pending) return
    const target = { key: crypto.randomUUID(), fileName: file.name, staffName: nameOf(staffId) }
    setPending(target)
    session.notice('Sample banks', `Uploading ${file.name}…`)
    try {
      const query = new URLSearchParams({ fileName: file.name, staffId, root })
      const result = await api<{ bank: Bank }>('POST', `/api/scores/${session.scoreId}/banks?${query}`, undefined, { raw: file, headers: { 'Content-Type': 'application/octet-stream' } })
      session.addBank(result.bank)
      session.notice('Sample banks', `${file.name} loaded.`)
    } catch (error) {
      session.notice('Sample banks', `${file.name} was refused: ${error instanceof ApiFailure ? error.detail : 'the server could not be reached.'}`)
    } finally {
      setPending(null)
    }
  }

  return (
    <div>
      <h3 className="panel-title">Sample banks</h3>
      {me?.role === 'composer' && (
        <div className="stack">
          <label className="field">Staff for bank
            <select value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              {score?.staves.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="field">Root pitch
            <input type="text" value={root} onChange={(e) => setRoot(e.target.value)} autoComplete="off" />
          </label>
          <label className="field">Sample bank file
            <input type="file" accept=".wav,.sfz,audio/wav" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <div className="row">
            <button type="button" className="btn small" disabled={!!pending} onClick={() => void upload()}>{pending ? 'Upload sample bank…' : 'Upload sample bank'}</button>
          </div>
        </div>
      )}
      <ul className="items" aria-label="Sample banks">
        {pending && <li key={pending.key}>{`${pending.fileName} · ${pending.staffName} · Uploading…`}</li>}
        {banks.map((b) => <li key={b.id}>{`${b.fileName} · ${nameOf(b.staffId)} · Loaded`}</li>)}
      </ul>
      {banks.length === 0 && !pending && <EmptyStave>No sample bank yet. Staves without one play with the built-in synth.</EmptyStave>}
    </div>
  )
}

function PeoplePanel(): ReactNode {
  const { collaborators, me } = useSnapshot()
  const { openInvite, openStavesFor, openRemove } = useActions()
  const composer = me?.role === 'composer'
  return (
    <div>
      <h3 className="panel-title">People</h3>
      {composer && <div className="row"><button type="button" className="btn small" onClick={openInvite}><Icon name="plus" />Invite collaborator</button></div>}
      <ul className="items" aria-label="People">
        {collaborators.map((p) => (
          <li key={p.id}>
            <span className="grow">{`${p.name} · ${ROLE_WORD[p.role]} · ${STATUS_WORD[p.status]}`}</span>
            {composer && p.role === 'player' && p.status !== 'removed' && (
              <button type="button" className="btn quiet small" aria-label={`Change staves for ${p.name}`} onClick={() => openStavesFor(p)}>Staves</button>
            )}
            {composer && p.role !== 'composer' && p.status !== 'removed' && (
              <button type="button" className="btn quiet small" aria-label={`Remove ${p.name}`} onClick={() => openRemove(p)}>Remove</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

const PANELS: Record<Tab, () => ReactNode> = { Parts: PartsPanel, History: HistoryPanel, Holds: HoldsPanel, 'Sample banks': BanksPanel, People: PeoplePanel }

interface ToolsProps {
  sheet: boolean
  open: boolean
  setOpen: (open: boolean) => void
  tab: Tab
  setTab: (tab: Tab) => void
  /** The staves list, which lives in the sheet on phones. */
  staves?: ReactNode
}

export function ToolsRail({ sheet, open, setOpen, tab, setTab, staves }: ToolsProps): ReactNode {
  const Panel = PANELS[tab]
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const onKeyDown = (event: React.KeyboardEvent): void => {
    const at = TABS.indexOf(tab)
    const next = event.key === 'ArrowRight' ? at + 1 : event.key === 'ArrowLeft' ? at - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : null
    if (next === null) return
    event.preventDefault()
    const index = (next + TABS.length) % TABS.length
    setTab(TABS[index] as Tab)
    tabs.current[index]?.focus()
  }
  return (
    <aside className="tools" aria-label="Score tools" data-closed={!open}>
      {sheet && (
        <button type="button" className="sheet-handle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon name={open ? 'chevron-down' : 'chevron-up'} />{tab}
        </button>
      )}
      {(open || sheet) && (
        <div className="tools-head" hidden={!open}>
          <div className="tabs" role="tablist" aria-label="Score tools" onKeyDown={onKeyDown}>
            {TABS.map((name, i) => (
              <button
                key={name} ref={(el) => void (tabs.current[i] = el)} type="button" role="tab" id={`tab-${name}`} className="tab" aria-selected={tab === name}
                aria-controls="tools-panel" tabIndex={tab === name ? 0 : -1} onClick={() => setTab(name)}
              >
                {name}
              </button>
            ))}
          </div>
          {!sheet && <button type="button" className="btn quiet icon-only tools-toggle" aria-label="Hide tools" onClick={() => setOpen(false)}><Icon name="panel-close" /></button>}
        </div>
      )}
      {!sheet && !open && (
        <button type="button" className="btn quiet icon-only tools-toggle" aria-label="Show tools" onClick={() => setOpen(true)}><Icon name="panel-open" /></button>
      )}
      {open && (
        <div className="tools-body" role="tabpanel" id="tools-panel" aria-labelledby={`tab-${tab}`}>
          {staves}
          <Panel />
        </div>
      )}
    </aside>
  )
}

export function NoticeRegions(): ReactNode {
  const { notices } = useSnapshot()
  return (
    <>
      <Status label="Holds" text={notices.Holds} />
      <Status label="Score changes" text={notices['Score changes']} />
      <Status label="Team" text={notices.Team} />
      <Status label="Parts" text={notices.Parts} />
      <Status label="Sample banks" text={notices['Sample banks']} />
      <Status label="History" text={notices.History} />
      <Status label="Layout" text={notices.Layout} />
      <Status label="Text" text={notices.Text} />
      <Status label="View" text={notices.View} />
    </>
  )
}
