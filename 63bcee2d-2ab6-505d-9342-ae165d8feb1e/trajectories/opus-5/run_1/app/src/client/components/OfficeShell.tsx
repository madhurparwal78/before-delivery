/** The office frame: skip link, workspace navigation, live regions and main. */

import type { ReactNode } from 'react';
import { refusal } from '../lib/copy.js';
import { LiveRegions } from '../lib/announce.jsx';
import { Link, useRouter } from '../lib/router.jsx';
import { useWorkspace } from '../lib/workspace.jsx';

interface NavItem {
  label: string;
  to: string;
  directorOnly?: boolean;
}

const NAV: NavItem[] = [
  { label: 'Rollouts', to: '/office' },
  { label: 'Members', to: '/office/members' },
  { label: 'Case studies', to: '/office/case-studies', directorOnly: true },
  { label: 'Enquiries', to: '/office/enquiries', directorOnly: true },
];

export function OfficeShell({ children }: { children: ReactNode }): JSX.Element {
  const { member, signOut, accessRemoved } = useWorkspace();
  const { pathname } = useRouter();
  const items = NAV.filter((item) => !item.directorOnly || member?.role === 'director');

  return (
    <div className="office">
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <header className="office-header">
        <Link to="/office" className="office-mark">
          Plumbline
        </Link>
        <nav className="office-nav" aria-label="Workspace">
          <ul>
            {items.map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  {...(pathname === item.to ? { 'aria-current': 'page' as const } : {})}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="office-identity">
          {member ? <span>{`${member.name} · ${member.organisation}`}</span> : null}
          <button type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>
      <LiveRegions scope="office" />
      <main className="office-main" id="content" tabIndex={-1}>
        {accessRemoved ? (
          <section className="removed-notice">
            <h1>Access removed</h1>
            <p>{refusal.accessRemoved}</p>
            <Link to="/sign-in">Back to sign in</Link>
          </section>
        ) : (
          children
        )}
      </main>
    </div>
  );
}

/** A bare frame for the screens that sit outside the signed-in workspace. */
export function PlainShell({
  children,
  scope = 'office',
}: {
  children: ReactNode;
  scope?: 'office' | 'public';
}): JSX.Element {
  return (
    <div className="office">
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <LiveRegions scope={scope} />
      <main className="office-main" id="content" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
