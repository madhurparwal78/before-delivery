// The public site frame (header, Tray link with its rolling count, tray announcements) and the plain
// frame of the account pages.

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "./router.js";
import { trayAnnouncer, useTray } from "./tray.js";
import { StatusLine } from "./ui/status.js";
import { prefersReducedMotion } from "./ui/media.js";

function TrayLink() {
  const count = useTray().length;
  const previous = useRef(count);
  const digit = useRef<HTMLSpanElement>(null);
  const [ghost, setGhost] = useState<number | null>(null);
  const ghostRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (previous.current === count) return;
    const old = previous.current;
    previous.current = count;
    if (prefersReducedMotion()) {
      digit.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, easing: "ease-out" });
      return;
    }
    setGhost(old);
  }, [count]);

  useLayoutEffect(() => {
    if (ghost === null) return;
    const timing = { duration: 300, easing: "cubic-bezier(0.16, 1, 0.3, 1)" };
    const rising = count > ghost;
    digit.current?.animate([{ transform: `translateY(${rising ? 100 : -100}%)` }, { transform: "translateY(0)" }], timing);
    const leaving = ghostRef.current?.animate(
      [{ transform: "translateY(0)" }, { transform: `translateY(${rising ? -100 : 100}%)` }], { ...timing, fill: "forwards" });
    if (leaving) leaving.onfinish = () => setGhost(null);
  }, [ghost, count]);

  return (
    <Link href="/tray" data-tray-link="">
      Tray{" "}
      <span className="tray-count num">
        <span ref={digit}>{count}</span>
        {ghost !== null ? <span ref={ghostRef} className="ghost" aria-hidden="true">{ghost}</span> : null}
      </span>
    </Link>
  );
}

export function PublicLayout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const message = trayAnnouncer.useMessage();
  return (
    <>
      <header className="site-header">
        <Link href="/boards" className="brand">Vesper &amp; Rowe Talent</Link>
        <nav aria-label="Site" className="site-nav">
          <Link href="/boards" aria-current={pathname.startsWith("/boards") ? "page" : undefined}>Boards</Link>
          <TrayLink />
          <Link href="/apply" aria-current={pathname === "/apply" ? "page" : undefined}>Apply</Link>
        </nav>
      </header>
      <main className="page">
        <StatusLine name="Tray" message={message} />
        {children}
      </main>
      <footer className="site-footer">
        <p>Vesper &amp; Rowe Talent represents fashion and commercial models and creators from Toronto and Vancouver.</p>
      </footer>
    </>
  );
}

export function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="site-header">
        <Link href="/boards" className="brand">Vesper &amp; Rowe Talent</Link>
      </header>
      <main className="page account-page">{children}</main>
    </>
  );
}
