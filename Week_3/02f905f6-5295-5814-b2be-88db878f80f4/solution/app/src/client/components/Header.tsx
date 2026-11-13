// The header strip: studio name, the role's links and Sign out. It stays at the top while scrolling.
import { useEffect, useRef } from "react";
import type { Role, User } from "../../shared/api";
import { Link } from "../router";
import { SignOutIcon } from "./Icons";

const NAV: Record<Role, { href: string; label: string }[]> = {
  member: [
    { href: "/intake", label: "Intake" },
    { href: "/pieces", label: "My pieces" },
  ],
  tech: [
    { href: "/board", label: "Load board" },
    { href: "/counter", label: "Counter" },
    { href: "/pickup", label: "Pickup shelf" },
  ],
  owner: [
    { href: "/studio", label: "Studio" },
    { href: "/board", label: "Load board" },
    { href: "/counter", label: "Counter" },
    { href: "/pickup", label: "Pickup shelf" },
    { href: "/rates", label: "Rates" },
  ],
};

export function Header({ user, path, onSignOut }: { user: User; path: string; onSignOut: () => void }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const header = ref.current;
    if (!header) return;
    const observer = new ResizeObserver(() => document.documentElement.style.setProperty("--header-h", `${header.offsetHeight}px`));
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  return (
    <header className="app-header" ref={ref}>
      <div className="brand">
        <span className="brand-mark">Shelfmark</span>
        <span className="brand-studio">Brickfield Lane Clayhouse</span>
      </div>
      <nav className="app-nav" aria-label="Studio">
        <ul>
          {NAV[user.role].map((item) => (
            <li key={item.href}>
              <Link href={item.href} aria-current={path === item.href || path.startsWith(`${item.href}/`) ? "page" : undefined}>
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <span className="who small muted">{user.name}</span>
      <button type="button" className="btn" onClick={onSignOut}>
        <SignOutIcon />
        Sign out
      </button>
    </header>
  );
}
