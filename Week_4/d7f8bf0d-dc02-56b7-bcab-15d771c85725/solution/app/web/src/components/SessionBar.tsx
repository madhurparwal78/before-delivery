import { useRef, useState } from 'react'
import { openSheet, openWorkspace, signOut } from '../actions'
import { SHEET_TITLES, store, useAppState, type SheetName } from '../state'
import { CameraIcon, ChevronIcon, GearIcon } from '../ui/icons'
import { useLayer } from '../ui/overlay'
import { resetCamera } from './Stage'

const MENU: SheetName[] = ['layouts', 'versions', 'timetable', 'members', 'standards', 'history', 'trash']

function SheetsMenu({ onClose, anchor }: { onClose: () => void; anchor: React.RefObject<HTMLButtonElement | null> }) {
  const menu = useRef<HTMLDivElement>(null)
  useLayer(onClose, anchor.current)

  function onKeyDown(event: React.KeyboardEvent, index: number): void {
    const items = menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')
    if (items === undefined) return
    if (event.key === 'ArrowDown') items[(index + 1) % items.length].focus()
    else if (event.key === 'ArrowUp') items[(index + items.length - 1) % items.length].focus()
    else return
    event.preventDefault()
  }

  return (
    <div ref={menu} role="menu" aria-label="Sheets" className="sheets-menu">
      {MENU.map((name, index) => (
        <button
          key={name}
          type="button"
          role="menuitem"
          className="menu-item"
          autoFocus={index === 0}
          onKeyDown={event => onKeyDown(event, index)}
          onClick={() => {
            anchor.current?.focus()
            onClose()
            openSheet(name)
          }}
        >
          {SHEET_TITLES[name]}
        </button>
      ))}
    </div>
  )
}

export function SessionBar() {
  const state = useAppState()
  const [menu, setMenu] = useState(false)
  const sheets = useRef<HTMLButtonElement>(null)
  const founder = state.role === 'founder'
  return (
    <nav aria-label="Session bar" data-testid="session-bar" className="session-bar">
      <div className="bar-menu">
        <button ref={sheets} type="button" className="sticker" aria-label="Sheets" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(open => !open)}>
          <GearIcon size={30} />
        </button>
        {menu ? <SheetsMenu anchor={sheets} onClose={() => setMenu(false)} /> : null}
      </div>
      <button type="button" className="sticker" aria-label="Reset view" onClick={resetCamera}>
        <CameraIcon size={32} />
      </button>
      <button type="button" className="sticker sticker-text" onClick={() => openSheet('sessions')}>Sessions</button>
      <button type="button" className="sticker sticker-text" onClick={() => openSheet('crew-packets')}>Crew packets</button>
      <span className="bar-select-wrap">
        <select
          className="bar-select"
          aria-label="Workspace"
          data-testid="workspace-switcher"
          value={state.workspaceId ?? ''}
          onChange={event => void openWorkspace(event.target.value)}
        >
          {state.memberships.map(membership => (
            <option key={membership.workspace_id} value={membership.workspace_id}>{membership.workspace_name}</option>
          ))}
        </select>
        <ChevronIcon size={16} className="bar-chevron" />
      </span>
      {founder ? (
        <button type="button" className="sticker sticker-text" data-testid="new-workspace" onClick={() => store.set({ dialog: { kind: 'new-workspace' } })}>New workspace</button>
      ) : null}
      <button type="button" className="sticker sticker-text" data-testid="sign-out" onClick={() => void signOut()}>Sign out</button>
    </nav>
  )
}
