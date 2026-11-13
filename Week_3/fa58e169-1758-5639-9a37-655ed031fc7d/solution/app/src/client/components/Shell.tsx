import { AlignLeft, ArrowRight, Grid3x3, History, LayoutList, Menu, MessageSquare, Settings, Users } from 'lucide-react'
import { createContext, useContext, useState, type ReactNode } from 'react'
import { navigate, useLocation } from '../router.ts'
import { useSession } from '../session.tsx'
import { Link } from './Link.tsx'
import { NewPattern } from './NewPattern.tsx'

interface PanelLink { id: string; label: string }

const ICONS: Record<string, ReactNode> = {
  chart: <Grid3x3 size={18} aria-hidden="true" />,
  instructions: <AlignLeft size={18} aria-hidden="true" />,
  versions: <History size={18} aria-hidden="true" />,
  testers: <Users size={18} aria-hidden="true" />,
  notes: <MessageSquare size={18} aria-hidden="true" />,
}

const NewPatternContext = createContext<() => void>(() => undefined)
export const useNewPattern = () => useContext(NewPatternContext)

interface ShellProps {
  lead: string
  /** null on pages without a live socket (signed out or public). */
  live: boolean | null
  panels?: PanelLink[]
  activePanel?: string
  onPanel?(id: string): void
  wide?: boolean
  children: ReactNode
}

const LIVE_OFF = 'Live updates are off. Your work is still saved.'

export function Shell({ lead, live, panels = [], activePanel, onPanel, wide, children }: ShellProps) {
  const { layout, me } = useSession()
  const { path } = useLocation()
  const [railOpen, setRailOpen] = useState(true)
  const [creating, setCreating] = useState(false)
  // The stacked nav sits under the panel: while the panel is still empty it would move down when the page arrives, so it waits.
  const loading = lead === 'Loading...'
  const openNew = () => (me ? setCreating(true) : navigate('/signin?next=%2F'))

  const nav = railOpen && (
    <nav aria-label="Workspace" className="rail">
      <h2 className="rail-title">Workspace</h2>
      <ul>
        <li><Link to="/" aria-current={path === '/' ? 'page' : undefined} className="navrow"><LayoutList size={18} aria-hidden="true" />Your patterns</Link></li>
        <li><Link to="/settings" aria-current={path === '/settings' ? 'page' : undefined} className="navrow"><Settings size={18} aria-hidden="true" />Settings</Link></li>
        {panels.map((p) => (
          <li key={p.id}>
            <a href={`#${p.id}`} className="navrow" aria-current={activePanel === p.id ? 'page' : undefined} onClick={(event) => { event.preventDefault(); onPanel?.(p.id) }}>{ICONS[p.id]}{p.label}</a>
          </li>
        ))}
      </ul>
    </nav>
  )

  return (
    <div className="app" data-layout={layout}>
      <header className="topbar">
        <button type="button" className="plain toggle" aria-label="Toggle workspace rail" aria-expanded={railOpen} onClick={() => setRailOpen(!railOpen)}>
          <Menu size={22} aria-hidden="true" />
        </button>
        <span className="brand">Twinrow</span>
        {layout !== 'phone' && <button type="button" className="primary new" onClick={openNew}>New pattern</button>}
      </header>
      <div className="frame">
        {layout === 'desktop' && nav}
        <div className="column">
 {live === null && <div className="live" aria-hidden="true" />}
          {live !== null && <div role="status" aria-label="Live" className={`live${live ? '' : ' off'}`}>{live ? 'Live' : LIVE_OFF}</div>}
          <p className="lead">{lead}</p>
          <NewPatternContext.Provider value={openNew}>
            <main className={`panel${wide ? ' wide' : ''}`}>{children}</main>
          </NewPatternContext.Provider>
          {layout !== 'desktop' && nav && !loading && <div className="stacked">{nav}</div>}
        </div>
      </div>
      {creating && <NewPattern onClose={() => setCreating(false)} />}
    </div>
  )
}

export function Card({ to, label, tile, tint, badge }: { to: string; label: string; tile: ReactNode; tint: string; badge?: string }) {
  return (
    <li className="card link-card">
      <span className={`tile tint-${tint}`} aria-hidden="true">{tile}</span>
      <Link to={to} className="card-label stretch">{label}</Link>
      {badge && <span className="badge">{badge}</span>}
      <ArrowRight className="arrow" size={16} aria-hidden="true" />
    </li>
  )
}
