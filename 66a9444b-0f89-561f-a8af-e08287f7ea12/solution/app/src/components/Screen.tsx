// Shared pieces of the staff, group and account screens: the lime-on-ink header, tabs and the signed-out panel.
import { useRef, type ReactNode } from "react";
import { navigate } from "../router.ts";
import type { Role, User } from "../types.ts";

export function ScreenHeader({ title, lede }: { title: string; lede?: string }) {
  return (
    <header className="screen__header">
      <div className="grid">
        <h1 className="display screen__title">{title}</h1>
        {lede && <p className="screen__lede">{lede}</p>}
      </div>
    </header>
  );
}

/** Shown instead of a screen the caller may not use. */
export function Gate({ user, roles, children }: { user: User | null; roles: Role[]; children: ReactNode }) {
  if (!user) {
    return (
      <div className="grid screen__body gate">
        <p>Sign in to use this screen.</p>
        <a className="button button--primary" href="/signin" onClick={(e) => { e.preventDefault(); navigate(`/signin?next=${encodeURIComponent(window.location.pathname)}`); }}>Sign in</a>
      </div>
    );
  }
  if (!roles.includes(user.role)) return <div className="grid screen__body gate"><p>This screen is for {roles.join(" or ").replace(/_/g, " ")} accounts.</p></div>;
  return <>{children}</>;
}

export function Tabs<T extends string>({ tabs, current, onChange, label }: { tabs: [T, string][]; current: T; onChange: (id: T) => void; label: string }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const move = (delta: number) => {
    const i = tabs.findIndex(([id]) => id === current);
    const next = tabs[(i + delta + tabs.length) % tabs.length]![0];
    onChange(next);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className="tabs" onKeyDown={(e) => {
      if (e.key === "ArrowRight") { e.preventDefault(); move(1); }
      if (e.key === "ArrowLeft") { e.preventDefault(); move(-1); }
    }}>
      {tabs.map(([id, name]) => (
        <button key={id} ref={(el) => { refs.current[id] = el; }} type="button" role="tab" id={`tab-${id}`}
          aria-controls={id === current ? `panel-${id}` : undefined}
          aria-selected={id === current} tabIndex={id === current ? 0 : -1} className="tabs__tab" onClick={() => onChange(id)}>
          {name}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({ id, children }: { id: string; children: ReactNode }) {
  return <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} className="tabpanel">{children}</div>;
}
