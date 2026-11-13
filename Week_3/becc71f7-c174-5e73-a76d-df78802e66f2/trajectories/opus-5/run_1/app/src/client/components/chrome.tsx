import { del } from '../lib/api.js';
import { useOverlay } from '../lib/overlay.js';
import { useWidth } from '../lib/viewport.js';
import { CATEGORIES } from '../../shared/options.js';
import type { Session } from '../lib/types.js';
import { Garment } from './Garment.js';
import { Icon } from './Icon.js';
import { Overlay } from './Overlay.js';
import { Link } from './layout.js';

/** The public top bar: the wordmark, the Categories menu and the appointment link. */
export function PublicTopBar() {
  const width = useWidth();
  const categories = useOverlay();
  const menu = useOverlay();

  return (
    <header class="topbar">
      <Link href="/" class="wordmark">
        Atelier Ourlet
      </Link>
      {width === 'narrow' ? (
        <>
          <button
            type="button"
            class="button button--quiet topbar__action"
            ref={menu.openerRef}
            aria-expanded={menu.isOpen}
            onClick={() => (menu.isOpen ? menu.close() : menu.open())}
          >
            <Icon name="menu" />
            Menu
          </button>
          {menu.mounted ? (
            <Overlay state={menu} name="Menu" kind="sheet-bottom">
              <nav class="menu-sheet" aria-label="Menu">
                <ul class="menu-sheet__list">
                  {CATEGORIES.map((category) => (
                    <li key={category.value}>
                      <Link href={`/?category=${category.value}`}>{category.label}</Link>
                    </li>
                  ))}
                  <li>
                    <Link href="/appointments">Book an intake slot</Link>
                  </li>
                </ul>
              </nav>
            </Overlay>
          ) : null}
        </>
      ) : (
        <>
          <button
            type="button"
            class="button button--quiet topbar__action"
            ref={categories.openerRef}
            aria-expanded={categories.isOpen}
            onClick={() => (categories.isOpen ? categories.close() : categories.open())}
          >
            Categories
          </button>
          <Link href="/appointments" class="topbar__link">
            Book an intake slot
          </Link>
          {categories.mounted ? (
            <Overlay
              state={categories}
              name="Categories"
              kind="menu"
              modal={false}
              role="none"
              className="category-panel"
            >
              <nav aria-label="Categories">
                <ul class="category-panel__tiles">
                  {CATEGORIES.map((category) => (
                    <li key={category.value}>
                      <Link href={`/?category=${category.value}`} class="category-tile">
                        <Garment category={category.value} seed={category.value} tile />
                        <span class="category-tile__label">{category.label}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            </Overlay>
          ) : null}
        </>
      )}
    </header>
  );
}

const STAFF_LINKS = [
  { href: '/staff/pieces', label: 'Pieces', roles: ['owner', 'assistant'] },
  { href: '/staff/till', label: 'Till', roles: ['owner', 'assistant'] },
  { href: '/staff/holds', label: 'Holds', roles: ['owner', 'assistant'] },
  { href: '/staff/appointments', label: 'Appointments', roles: ['owner', 'assistant'] },
  { href: '/staff/consignors', label: 'Consignors', roles: ['owner', 'assistant'] },
  { href: '/staff/ladder', label: 'Ladder', roles: ['owner'] },
  { href: '/staff/payouts', label: 'Payouts', roles: ['owner', 'bookkeeper'] },
  { href: '/staff/import', label: 'Spreadsheet', roles: ['owner'] },
  { href: '/staff/sales-book', label: 'Sales book', roles: ['owner', 'bookkeeper'] },
  { href: '/staff/members', label: 'Members', roles: ['owner'] },
] as const;

/** The staff top bar: the links this role may use and Sign out. */
export function StaffTopBar({ session, current }: { session: Session; current: string }) {
  const width = useWidth();
  const menu = useOverlay();
  const links = STAFF_LINKS.filter((link) =>
    (link.roles as readonly string[]).includes(session.member.role),
  );

  const signOut = async (): Promise<void> => {
    await del('/api/session').catch(() => undefined);
    window.location.assign('/sign-in');
  };

  const list = (
    <ul class="staffnav__list">
      {links.map((link) => (
        <li key={link.href}>
          <Link
            href={link.href}
            class="staffnav__link"
            {...(current.startsWith(link.href) ? { ariaCurrent: 'page' as const } : {})}
          >
            {link.label}
          </Link>
        </li>
      ))}
    </ul>
  );

  return (
    <header class="topbar topbar--staff">
      <Link href={session.homeRoute} class="wordmark">
        Atelier Ourlet
      </Link>
      {width === 'narrow' ? (
        <>
          <button
            type="button"
            class="button button--quiet topbar__action"
            ref={menu.openerRef}
            aria-expanded={menu.isOpen}
            onClick={() => (menu.isOpen ? menu.close() : menu.open())}
          >
            <Icon name="menu" />
            Menu
          </button>
          {menu.mounted ? (
            <Overlay state={menu} name="Menu" kind="sheet-bottom">
              <nav class="staffnav" aria-label="Staff">
                {list}
              </nav>
              <button type="button" class="button button--quiet" onClick={() => void signOut()}>
                Sign out
              </button>
            </Overlay>
          ) : null}
        </>
      ) : (
        <>
          <nav class="staffnav" aria-label="Staff">
            {list}
          </nav>
          <button type="button" class="button button--quiet" onClick={() => void signOut()}>
            Sign out
          </button>
        </>
      )}
    </header>
  );
}
