import { ChevronDown, FileCode, Keyboard, Layers, Menu as MenuIcon, PenLine, Share2, Table2, X, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Link } from '../router.tsx'
import { useSession } from '../session.tsx'
import { Dialog, wrapTab } from './Dialog.tsx'

interface Item {
  label: string
  description: string
  href: string
  icon: LucideIcon
}

const PRODUCT: Item[] = [
  { label: 'Text language', description: 'Entities, columns, choices and links as plain text', href: '/#language', icon: Table2 },
  { label: 'Drawing links', description: 'Drag from one column to another and a line appears', href: '/#links', icon: PenLine },
  { label: 'Import DDL', description: 'Bring in PostgreSQL or MySQL statements', href: '/#import', icon: FileCode },
  { label: 'Sharing and versions', description: 'View or edit links you can take back, numbered versions', href: '/#sharing', icon: Share2 },
]

const LEARN: Item[] = [
  { label: 'Keyboard guide', description: 'Every shortcut in one table', href: '/#keyboard', icon: Keyboard },
  { label: 'Sample editor', description: 'Type into the live sample', href: '/#sample', icon: Layers },
]

type MenuName = 'Product' | 'Learn'
const MENUS: Array<{ name: MenuName; items: Item[] }> = [
  { name: 'Product', items: PRODUCT },
  { name: 'Learn', items: LEARN },
]

function MenuItems({ items, onChoose }: { items: Item[]; onChoose: () => void }) {
  return (
    <>
      {items.map(({ label, description, href, icon: Icon }) => (
        <Link key={label} href={href} role="menuitem" className="menu-item" onClick={onChoose}>
          <Icon size={18} aria-hidden="true" />
          <span>
            <span className="menu-item-title">{label}</span>
            <span className="menu-item-description">{description}</span>
          </span>
        </Link>
      ))}
    </>
  )
}

function DropdownMenu({ name, items, open, onToggle, onClose }: { name: MenuName; items: Item[]; open: boolean; onToggle: () => void; onClose: () => void }) {
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }, [open])

  const move = (event: KeyboardEvent<HTMLDivElement>): void => {
    const entries = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const at = entries.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      button.current?.focus()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      entries[(at + step + entries.length) % entries.length]?.focus()
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      entries[event.key === 'Home' ? 0 : entries.length - 1]?.focus()
    } else if (menu.current) wrapTab(event, menu.current)
  }

  return (
    <div className="nav-menu" data-menu={name}>
      <button
        type="button"
        ref={button}
        className="nav-button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault()
            onToggle()
          }
        }}
      >
        {name}
        <ChevronDown size={14} aria-hidden="true" className="caret" />
      </button>
      {open && (
        <div role="menu" aria-label={name} className="menu nav-popover" ref={menu} onKeyDown={move}>
          <MenuItems items={items} onChoose={onClose} />
        </div>
      )}
    </div>
  )
}

function AccountLinks({ onChoose }: { onChoose?: () => void }) {
  const { user, signOut } = useSession()
  if (user === undefined) return null
  return (
    <>
      {user ? (
        <Link href="/projects" className="nav-app-link" onClick={onChoose}>
          Your projects
        </Link>
      ) : (
        <Link href="/signin" className="nav-app-link" onClick={onChoose}>
          Sign in
        </Link>
      )}
      {user && (
        <button type="button" className="nav-signout" onClick={() => void signOut()}>
          Sign out
        </button>
      )}
    </>
  )
}

/** The pinned dark nav: wordmark, two menus and the account links; a Menu sheet below 768 pixels. */
export function NavBar() {
  const [openMenu, setOpenMenu] = useState<MenuName | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  useEffect(() => {
    if (!openMenu) return
    const outside = (event: PointerEvent): void => {
      if (!(event.target as Element).closest(`[data-menu="${openMenu}"]`)) setOpenMenu(null)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [openMenu])

  return (
    <nav aria-label="Main" className="studio-nav">
      <div className="nav-inner">
        <Link href="/" className="nav-logo" aria-label="Joinery home">
          <span className="logo-tile" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 4v10a4 4 0 0 0 8 0V9" />
              <path d="M12 9h6" />
            </svg>
          </span>
          <span className="nav-wordmark">Joinery</span>
        </Link>
        <div className="nav-desktop">
          {MENUS.map(({ name, items }) => (
            <DropdownMenu key={name} name={name} items={items} open={openMenu === name} onToggle={() => setOpenMenu(openMenu === name ? null : name)} onClose={() => setOpenMenu(null)} />
          ))}
          <span className="nav-divider" aria-hidden="true" />
          <AccountLinks />
        </div>
        <button type="button" className="nav-menu-button" aria-label="Menu" aria-haspopup="dialog" onClick={() => setSheetOpen(true)}>
          <MenuIcon size={24} aria-hidden="true" />
        </button>
      </div>
      {sheetOpen && (
        <Dialog name="Menu" onClose={() => setSheetOpen(false)} className="dialog-menu">
          <button type="button" className="sheet-close" data-dialog-close aria-label="Close menu" onClick={() => setSheetOpen(false)}>
            <X size={22} aria-hidden="true" />
          </button>
          {MENUS.map(({ name, items }) => (
            <div key={name} className="sheet-group">
              <p className="sheet-label">{name}</p>
              <MenuItems items={items} onChoose={() => setSheetOpen(false)} />
            </div>
          ))}
          <div className="sheet-account">
            <AccountLinks onChoose={() => setSheetOpen(false)} />
          </div>
        </Dialog>
      )}
    </nav>
  )
}
