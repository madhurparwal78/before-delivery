import { useEffect, useRef, type ReactNode } from "react";
import { navigate } from "../router";
import { bannerTexts, useStore } from "../store";
import type { Unit } from "../../shared/units";

interface ShellProps {
  section: "gallery" | "register";
  /** Header controls after the Units toggle (the View group, the Objects button). */
  headerEnd?: ReactNode;
  children: ReactNode;
}

export function Link({ href, children, ...rest }: { href: string; children: ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  return (
    <a
      href={href}
      {...rest}
      onClick={(e) => {
        rest.onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </a>
  );
}

export function SkipLink({ inert }: { inert?: boolean }) {
  return (
    <a
      className="skip-link"
      href="#main"
      inert={inert}
      onClick={(e) => {
        e.preventDefault();
        document.getElementById("main")?.focus();
      }}
    >
      Skip to main content
    </a>
  );
}

const ROLE_LABEL = { curator: "curator", registrar: "registrar", preparator: "preparator" } as const;

/** The staff page frame: skip link, service banners, header, live regions and the database hold. */
export function Shell({ section, headerEnd, children }: ShellProps) {
  const store = useStore();
  const banners = bannerTexts(store.services);
  const databaseDown = store.services?.database === "down";
  const tryAgain = useRef<HTMLButtonElement>(null);
  const wasDown = useRef(false);

  useEffect(() => {
    if (databaseDown) tryAgain.current?.focus();
    else if (wasDown.current) document.querySelector<HTMLElement>("main h1")?.focus();
    wasDown.current = databaseDown;
  }, [databaseDown]);

  return (
    <>
      <SkipLink inert={databaseDown} />
      <div className="banners">
        {banners.map((b) => (
          <div key={b.key} role="alert" className={`banner banner-${b.key}`}>
            <span className="banner-mark" aria-hidden="true" />
            <p>{b.text}</p>
            {b.key === "database" && (
              <button
                ref={tryAgain}
                type="button"
                className="btn btn-primary"
                onKeyDown={(e) => {
                  if (e.key === "Tab") e.preventDefault();
                }}
                onClick={() => {
                  void store.retryStatus();
                  tryAgain.current?.focus();
                }}
              >
                Try again
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="page" inert={databaseDown}>
        <header className="masthead">
          <span className="product">Hangline</span>
          <nav aria-label="Sections" className="sections">
            <Link href="/" aria-current={section === "gallery" ? "page" : undefined}>
              Gallery
            </Link>
            <Link href="/records" aria-current={section === "register" ? "page" : undefined}>
              Loan register
            </Link>
          </nav>
          <label className="picker">
            <span className="picker-label">Working as</span>
            <select value={store.staff?.id ?? ""} onChange={(e) => store.chooseStaff(e.target.value)} aria-label="Working as">
              {store.staffList.map((s) => (
                <option key={s.id} value={s.id}>
                  {`${s.name} (${ROLE_LABEL[s.role]})`}
                </option>
              ))}
            </select>
          </label>
          <div role="radiogroup" aria-label="Units" className="segmented">
            {(["cm", "in"] as Unit[]).map((u) => (
              <label key={u} className="segment">
                <input type="radio" name="units" value={u} checked={store.unit === u} onChange={() => store.chooseUnit(u)} />
                <span>{u}</span>
              </label>
            ))}
          </div>
          {headerEnd}
        </header>
        <div className="live-strip">
          <div role="status" aria-label="Announcements" aria-live="polite" className="live live-own">
            <span key={store.said.key}>{store.said.text}</span>
          </div>
          <div role="status" aria-label="Team updates" aria-live="polite" className="live live-team">
            {store.team.map((m) => (
              <p key={m.key}>{m.text}</p>
            ))}
          </div>
        </div>
        {children}
      </div>
    </>
  );
}
