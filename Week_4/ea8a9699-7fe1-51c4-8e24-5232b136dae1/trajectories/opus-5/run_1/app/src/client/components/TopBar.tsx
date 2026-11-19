import { useEffect, useRef, useState } from 'react';
import { Link, useRouter } from '../lib/router.js';
import { useSession } from '../lib/session.js';
import { useInlineChrome } from '../lib/hooks.js';

interface NavLink {
  label: string;
  to: string;
}

interface TopBarProps {
  /** The workspace whose name or switcher the bar shows, when the screen has one. */
  workspaceSlug?: string;
  /** The review page has no way into a workspace. */
  bare?: boolean;
}

export function TopBar({ workspaceSlug, bare }: TopBarProps): JSX.Element {
  const { account, signOut } = useSession();
  const { navigate } = useRouter();
  const inline = useInlineChrome();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (inline) {
      setMenuOpen(false);
    }
  }, [inline]);

  const links: NavLink[] = [{ label: 'Explore', to: '/explore' }];
  if (bare !== true && account !== null && account.workspaces.length > 0) {
    links.push({ label: 'Wall', to: `/w/${workspaceSlug ?? account.workspaces[0].slug}` });
    if (account.role === 'ops_lead') {
      links.push({ label: 'Admin', to: `/w/${workspaceSlug ?? account.workspaces[0].slug}/admin` });
    }
  }
  if (account === null) {
    links.push({ label: 'Sign in', to: '/signin' });
  }

  const closeMenu = (): void => {
    setMenuOpen(false);
    requestAnimationFrame(() => menuButton.current?.focus());
  };

  const isOpsLead = account !== null && account.role === 'ops_lead' && !bare;

  return (
    <header
      className="topbar"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && menuOpen) {
          closeMenu();
        }
      }}
    >
      <Link to="/explore" className="wordmark">
        Rushes
      </Link>

      {inline ? (
        <nav aria-label="Main">
          <ul>
            {links.map((link) => (
              <li key={link.to}>
                <Link to={link.to}>{link.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : (
        <button type="button" ref={menuButton} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
          Menu
        </button>
      )}

      <span className="topbar-spacer" />

      {isOpsLead && account !== null ? (
        <select
          aria-label="Brand workspace"
          value={workspaceSlug ?? account.workspaces[0]?.slug ?? ''}
          onChange={(event) => navigate(`/w/${event.target.value}`)}
        >
          {account.workspaces.map((workspace) => (
            <option key={workspace.slug} value={workspace.slug}>
              {workspace.name}
            </option>
          ))}
        </select>
      ) : workspaceSlug !== undefined && account !== null && !bare ? (
        <span className="brand-name">
          {account.workspaces.find((workspace) => workspace.slug === workspaceSlug)?.name ?? workspaceSlug}
        </span>
      ) : null}

      {account !== null ? (
        <button
          type="button"
          className="quiet"
          onClick={() => {
            void signOut().then(() => navigate('/signin'));
          }}
        >
          Sign out
        </button>
      ) : null}

      {!inline && menuOpen ? (
        <div className="menu-sheet">
          <nav aria-label="Main">
            <ul>
              {links.map((link) => (
                <li key={link.to}>
                  <Link to={link.to} onClick={closeMenu}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
