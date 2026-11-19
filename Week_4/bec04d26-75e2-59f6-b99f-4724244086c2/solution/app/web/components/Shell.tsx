import { useEffect, useRef, useState } from "react";
import { Link, navigate, useLocation } from "../router";
import { registerRegion } from "../announce";
import { request } from "../api";
import { MAIL_BANNER, PDF_BANNER } from "../copy";
import { stopLive } from "../live";
import { setApp, useApp } from "../store";

/** The one announcement region of every screen. */
export function Announcements() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    registerRegion(ref.current);
    return () => registerRegion(null);
  }, []);
  return <div ref={ref} role="status" aria-label="Duefield announcements" aria-live="polite" className="announcements" />;
}

/** How long the emptied notice landmark stays in place after recovery, so a screen reader
 * reading it is not pulled out of a region that vanished mid-read. */
const NOTICE_WITHDRAW_MS = 1500;

export function ServiceNotice() {
  const services = useApp((s) => s.services);
  const healthy = services.mail && services.pdf;
  const [present, setPresent] = useState(!healthy);
  useEffect(() => {
    if (!healthy) {
      setPresent(true);
      return;
    }
    const timer = window.setTimeout(() => setPresent(false), NOTICE_WITHDRAW_MS);
    return () => window.clearTimeout(timer);
  }, [healthy]);
  return (
    <section aria-label="Service notice" className={healthy ? "service-notice" : "banner service-notice"} hidden={!present}>
      {!services.mail && <p>{MAIL_BANNER}</p>}
      {!services.pdf && <p>{PDF_BANNER}</p>}
    </section>
  );
}

const NAV = [["Today", "/today"], ["Catalogue", "/catalogue"], ["Month", "/month"], ["Year", "/year"],
  ["Clients", "/clients"], ["States", "/states"], ["Settings", "/settings"]] as const;

export function TopBar({ wordmark = true }: { wordmark?: boolean }) {
  const me = useApp((s) => s.me)!;
  const { path } = useLocation();
  const signOut = async (): Promise<void> => {
    await request("POST", "/api/auth/signout");
    stopLive();
    setApp({ me: null, clock: null });
    navigate("/sign-in");
  };
  return (
    <header className="topbar">
      {wordmark && (me.user.role === "bookkeeper"
        ? <Link href="/today" className="wordmark small">Duefield</Link>
        : <span className="wordmark small">Duefield</span>)}
      {me.user.role === "bookkeeper" ? (
        <nav aria-label="Main">
          {NAV.map(([name, href]) => (
            <Link key={name} href={href} aria-current={path === href || path.startsWith(`${href}/`) ? "page" : undefined}>{name}</Link>
          ))}
        </nav>
      ) : <p className="client-name">{me.client_name}</p>}
      <button type="button" className="button" onClick={signOut}>Sign out</button>
    </header>
  );
}
