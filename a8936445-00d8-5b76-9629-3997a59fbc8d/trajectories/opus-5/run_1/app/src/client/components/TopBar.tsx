import { useEffect, useState } from 'react';
import { LogOut, Menu as MenuIcon } from 'lucide-react';
import { formatClock } from '../kitchenTime';
import type { User, UserRole } from '../types';

const NAV: { label: string; path: string; roles: UserRole[] }[] = [
  { label: 'Dial', path: '/', roles: ['operator', 'owner', 'cook'] },
  { label: 'Bookings', path: '/bookings', roles: ['operator', 'owner', 'cook'] },
  { label: 'Documents', path: '/documents', roles: ['operator', 'owner'] },
  { label: 'Billing', path: '/billing', roles: ['operator', 'owner'] },
  { label: 'Tenants', path: '/tenants', roles: ['operator'] },
  { label: 'Settings', path: '/settings', roles: ['operator'] },
];

export function navPathsFor(role: UserRole): string[] {
  return NAV.filter((item) => item.roles.includes(role)).map((item) => item.path);
}

function useKitchenClock(): string {
  const [text, setText] = useState(() => formatClock());
  useEffect(() => {
    let timer: number;
    const tick = (): void => {
      setText(formatClock());
      const now = new Date();
      const untilNextMinute = 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds());
      timer = window.setTimeout(tick, untilNextMinute + 20);
    };
    const now = new Date();
    timer = window.setTimeout(tick, 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 20);
    return () => window.clearTimeout(timer);
  }, []);
  return text;
}

export function TopBar({
  user,
  path,
  navigate,
  onSignOut,
}: {
  user: User;
  path: string;
  navigate: (path: string) => void;
  onSignOut: () => void;
}): JSX.Element {
  const clock = useKitchenClock();
  const [menuOpen, setMenuOpen] = useState(false);
  const items = NAV.filter((item) => item.roles.includes(user.role));

  return (
    <header className="topbar">
      <span className="brand">Stationkeeper</span>
      <span className="kitchen-clock">Kitchen time {clock}</span>
      <button
        type="button"
        className="menu-button"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <MenuIcon size={16} aria-hidden="true" />
        Menu
      </button>
      <nav aria-label="Main" className={menuOpen ? 'open' : ''}>
        {items.map((item) => (
          <a
            key={item.path}
            href={item.path}
            aria-current={path === item.path ? 'page' : undefined}
            onClick={(event) => {
              event.preventDefault();
              setMenuOpen(false);
              navigate(item.path);
            }}
          >
            {item.label}
          </a>
        ))}
      </nav>
      <span className="spacer" />
      <button type="button" onClick={onSignOut}>
        <LogOut size={16} aria-hidden="true" />
        Sign out
      </button>
    </header>
  );
}
