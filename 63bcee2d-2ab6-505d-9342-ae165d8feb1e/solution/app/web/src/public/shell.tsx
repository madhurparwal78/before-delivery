import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { linkClick, useLocation } from "../router";

// The public frame: the fixed header whose tone follows the section under its midpoint, the Main
// navigation, the two public live regions, the footer and the full-height panel that wipes between pages.

export const EASE = "cubic-bezier(0.62, 0, 0.08, 1)";
export const reducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

interface Notices {
  announce: (text: string) => void;
  alert: (text: string) => void;
}

const NoticeContext = createContext<Notices | null>(null);

export function useNotices(): Notices {
  const notices = useContext(NoticeContext);
  if (!notices) throw new Error("useNotices outside PublicShell");
  return notices;
}

/** An internal public link navigating without a reload. */
export function PublicLink({ href, className, children, draggable }: { href: string; className?: string; children: ReactNode; draggable?: boolean }) {
  return <a href={href} className={className} draggable={draggable} onClick={(event) => linkClick(event, href)}>{children}</a>;
}

/** A primary link whose label rolls up on hover and focus; the rolling copy is hidden from assistive technology. */
export function RollLink({ href, label, className = "" }: { href: string; label: string; className?: string }) {
  return (
    <PublicLink href={href} className={`primary roll ${className}`}>
      <RollLabel label={label} />
    </PublicLink>
  );
}

export function RollLabel({ label }: { label: string }) {
  return (
    <span className="roll-window">
      <span className="roll-track">
        <span className="roll-text">{label}</span>
        <span className="roll-text" aria-hidden="true">{label}</span>
      </span>
    </span>
  );
}

function headerTone(header: HTMLElement): "light" | "dark" {
  const box = header.getBoundingClientRect();
  const middle = box.top + box.height / 2;
  for (const section of document.querySelectorAll<HTMLElement>(".public-content [data-tone], .public-footer[data-tone]")) {
    const area = section.getBoundingClientRect();
    if (area.top <= middle && area.bottom >= middle) return section.dataset.tone === "dark" ? "dark" : "light";
  }
  return "light";
}

export function PublicShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const header = useRef<HTMLElement>(null);
  const [tone, setTone] = useState<"light" | "dark">("light");
  const [status, setStatus] = useState({ text: "", path: "" });
  const [problem, setProblem] = useState({ text: "", path: "" });

  const update = useCallback(() => {
    if (header.current) setTone(headerTone(header.current));
  }, []);

  useEffect(() => {
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [update]);

  // Re-read the tone whenever the page's sections change under the header.
  useLayoutEffect(() => {
    update();
    const observer = new MutationObserver(update);
    const content = document.querySelector(".public-content");
    if (content) observer.observe(content, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [update, location.key]);

  const notices = useMemo<Notices>(() => ({
    announce: (text) => flushSync(() => setStatus({ text, path: window.location.pathname })),
    alert: (text) => flushSync(() => setProblem({ text, path: window.location.pathname })),
  }), []);
  const statusText = status.path === location.pathname ? status.text : "";
  const problemText = problem.path === location.pathname ? problem.text : "";

  return (
    <NoticeContext.Provider value={notices}>
      <div className="public-root">
        <a className="skip-link" href="#page" onClick={(event) => {
          event.preventDefault();
          document.querySelector<HTMLElement>(".public-content h1")?.focus();
        }}>Skip to content</a>
        <header ref={header} className="public-header" data-tone={tone}>
          <PublicLink href="/" className="public-brand">Marrow Hall</PublicLink>
          <nav aria-label="Main" className="public-nav">
            <ul>
              <li><PublicLink href="/work" className="nav-link">Work</PublicLink></li>
              <li><RollLink href="/start?step=1" label="Start a project" /></li>
            </ul>
          </nav>
        </header>
        <div className="public-notices">
          <p className="public-notice" role="status" aria-live="polite" aria-label="Site announcements">{statusText}</p>
          <p className="public-notice public-notice-alert" role="alert" aria-live="assertive" aria-label="Site problems">{problemText}</p>
        </div>
        <main id="page" className="public-content">{children}</main>
        <footer className="public-footer" data-tone="dark">
          <div className="grid">
            <div className="footer-mark">
              <p className="footer-brand">Marrow Hall Interiors</p>
              <p>Commercial interiors for multi-store rollouts across Hong Kong, Singapore and Macao.</p>
            </div>
            <dl className="footer-studios">
              <div><dt>Hong Kong</dt><dd>Studio and site office, Quarry Bay</dd></div>
              <div><dt>Singapore</dt><dd>Project office, Tanjong Pagar</dd></div>
              <div><dt>Macao</dt><dd>Site office, Senado</dd></div>
            </dl>
            <ul className="footer-links">
              <li><PublicLink href="/work">Work</PublicLink></li>
              <li><PublicLink href="/start?step=1">Enquire</PublicLink></li>
              <li><a href="/sign-in">Studio sign-in</a></li>
            </ul>
          </div>
        </footer>
        <div className="wipe" aria-hidden="true" />
      </div>
    </NoticeContext.Provider>
  );
}
