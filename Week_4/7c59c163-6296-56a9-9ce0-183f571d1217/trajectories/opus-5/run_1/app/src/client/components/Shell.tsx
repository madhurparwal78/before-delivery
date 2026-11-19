import { useState } from 'react';
import { Dialog } from './Dialog.js';
import { Sticker } from './Stickers.js';
import type { StickerKind } from './Stickers.js';
import { del } from '../api.js';
import type { Me, Role } from '../api.js';

export interface NavItem {
  label: string;
  href: string;
  role?: Role;
}

const ITEMS: NavItem[] = [
  { label: 'Markets', href: '/markets' },
  { label: 'Balance', href: '/balance' },
  { label: 'Orders', href: '/orders' },
  { label: 'Statements', href: '/statements' },
  { label: 'Profile', href: '/profile' },
  { label: 'Builder', href: '/builder', role: 'builder' },
  { label: 'Admin', href: '/admin', role: 'market_admin' },
  { label: 'Owner', href: '/owner', role: 'org_owner' },
  { label: 'Platform', href: '/platform', role: 'founder_operator' },
];

const FOUNDER_ITEMS: NavItem[] = [{ label: 'Platform', href: '/platform', role: 'founder_operator' }];

function itemsFor(me: Me): NavItem[] {
  if (me.roles.includes('founder_operator')) return FOUNDER_ITEMS;
  return ITEMS.filter((item) => item.role === undefined || me.roles.includes(item.role));
}

function Links(props: { me: Me; path: string }): React.JSX.Element {
  return (
    <nav className="nav" aria-label="Venue">
      {itemsFor(props.me).map((item) => (
        <a key={item.href} href={item.href} aria-current={props.path === item.href ? 'page' : undefined}>
          {item.label}
        </a>
      ))}
    </nav>
  );
}

export interface ShellProps {
  me: Me;
  path: string;
  field: 'slate' | 'sage' | 'blush' | 'olive';
  /** Scroll-chapter screens lay out their own full-bleed fields. */
  bare?: boolean;
  stickers?: StickerKind[];
  children: React.ReactNode;
}

export function Shell(props: ShellProps): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);

  const signOut = async (): Promise<void> => {
    await del('/api/session').catch(() => undefined);
    window.location.assign('/');
  };

  return (
    <>
      <header className="topbar">
        <span className="topbar__venue">{props.me.venue?.name ?? 'Plumtide Venue'}</span>
        <div className="topbar__right">
          <Links me={props.me} path={props.path} />
          <button type="button" className="pill menu-button" onClick={() => setMenuOpen(true)}>
            Menu
          </button>
          <button type="button" className="pill pill--quiet" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>
      {props.bare === true ? (
        <main>{props.children}</main>
      ) : (
        <main className={`field field--${props.field}`}>
          <div className="wrap">{props.children}</div>
          {(props.stickers ?? []).map((kind, index) => (
            <Sticker
              key={kind}
              kind={kind}
              size={150}
              className={`hero__sticker hero__sticker--${index === 0 ? 'right' : 'left'}`}
            />
          ))}
        </main>
      )}
      {menuOpen ? (
        <Dialog label="Menu" variant="sheet" onClose={() => setMenuOpen(false)}>
          <h2>Menu</h2>
          <Links me={props.me} path={props.path} />
          <button type="button" className="pill pill--quiet" onClick={() => setMenuOpen(false)}>
            Close menu
          </button>
        </Dialog>
      ) : null}
    </>
  );
}
