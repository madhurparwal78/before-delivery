import { SignOutButton } from '../App';

export function TopBar({ session, route }: {
  session: { signOut: () => Promise<void> };
  route: { path: string; navigate: (path: string) => void };
}): React.ReactNode {
  const links: Array<[string, string]> = [
    ['Today', '/today'],
    ['Catalogue', '/catalogue'],
    ['Month', '/month'],
    ['Year', '/year'],
    ['Clients', '/clients'],
    ['States', '/states'],
    ['Settings', '/settings'],
  ];
  return (
    <header className="topbar">
      <a href="/today" className="wordmark-link" onClick={(event) => {
        event.preventDefault();
        route.navigate('/today');
      }}>
        <span className="wordmark">Duefield</span>
      </a>
      <nav aria-label="Main" className="main-nav">
        {links.map(([label, href]) => (
          <a
            key={href}
            href={href}
            className={route.path.startsWith(href) ? 'nav-link nav-link-current' : 'nav-link'}
            aria-current={route.path.startsWith(href) ? 'page' : undefined}
            onClick={(event) => {
              event.preventDefault();
              route.navigate(href);
            }}
          >
            {label}
          </a>
        ))}
      </nav>
      <SignOutButton session={session} route={route} />
    </header>
  );
}

export function OwnerTopBar({ clientName, session, route }: {
  clientName: string;
  session: { signOut: () => Promise<void> };
  route: { path: string; navigate: (path: string) => void };
}): React.ReactNode {
  return (
    <header className="topbar topbar-owner">
      <span className="wordmark">Duefield</span>
      <span className="topbar-owner-name">{clientName}</span>
      <SignOutButton session={session} route={route} />
    </header>
  );
}
