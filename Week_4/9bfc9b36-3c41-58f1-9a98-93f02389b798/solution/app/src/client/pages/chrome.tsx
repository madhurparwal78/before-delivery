/** Page furniture shared by the screens: the heading that takes focus on arrival and the navigation band. */
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Link, useRouter } from "../router.js";
import { HOME, useSession } from "../session.js";
import type { Role } from "../../shared/types.js";

export function PageHeading({ children, level = 1, className }: { children: ReactNode; level?: 1 | 2; className?: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const { location } = useRouter();
  const arrived = (location.state as { focus?: boolean } | null)?.focus === true;
  useLayoutEffect(() => {
    if (arrived) ref.current?.focus();
  }, [arrived]);
  const Tag = level === 1 ? "h1" : "h2";
  return (
    <Tag ref={ref} tabIndex={-1} className={className}>
      {children}
    </Tag>
  );
}

const LINKS: Record<Role, [string, string][]> = {
  sailmaker: [["Loft", "/loft"], ["Stock", "/stock"], ["Ledger", "/ledger"], ["Console", "/console"], ["Rule sets", "/rulesets"], ["Accounts", "/accounts"]],
  "loft-hand": [["Cutting floor", "/floor"]],
  "yacht-owner": [["My boats", "/owner"], ["Cut sheets", "/owner#sheets"]],
};

export function Nav() {
  const { account, signOut } = useSession();
  const { location } = useRouter();
  if (!account) return null;
  return (
    <header className="nav-band">
      <Link to={HOME[account.role]} className="wordmark" aria-label="Boltrope home">
        Boltrope
      </Link>
      <nav aria-label="Loft">
        <ul>
          {LINKS[account.role].map(([label, to]) => (
            <li key={label}>
              <Link to={to} aria-current={location.path === to.split("#")[0] && label !== "Cut sheets" ? "page" : undefined}>
                {label}
              </Link>
            </li>
          ))}
          <li>
            <button type="button" className="nav-button" onClick={signOut}>
              Sign out
            </button>
          </li>
        </ul>
      </nav>
    </header>
  );
}
