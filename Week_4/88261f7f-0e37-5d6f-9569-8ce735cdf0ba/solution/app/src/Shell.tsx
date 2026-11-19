import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import type { Role } from "../shared/api";
import { call } from "./api";
import { connectLive, disconnectLive, useLive } from "./live";
import { useSession } from "./session";
import { KeyTag } from "./ui";

const LINKS: { href: string; label: string; roles: readonly Role[] }[] = [
  { href: "/desk", label: "Desk", roles: ["owner", "front_desk"] },
  { href: "/guests", label: "Guests", roles: ["owner", "front_desk"] },
  { href: "/rates", label: "Rates", roles: ["owner"] },
  { href: "/reports", label: "Reports", roles: ["owner"] },
  { href: "/board", label: "Board", roles: ["owner", "front_desk", "housekeeper"] },
];

/** Keeps the live stream open and turns pushed notices into the desk's messages. */
export function useShellLive(): void {
  const { user, setNotice, setCloseStatus } = useSession();
  useEffect(() => {
    connectLive();
    return disconnectLive;
  }, []);
  useLive((event) => {
    if (user.role === "housekeeper" || !event.notice) return;
    if (event.type === "close") setCloseStatus(event.notice);
    else setNotice(event.notice);
  });
}

export function TopBar({ children }: { children?: ReactNode }) {
  const { user } = useSession();
  const path = window.location.pathname;
  const header = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = header.current;
    if (!element) return;
    const measure = (): void => document.documentElement.style.setProperty("--header-h", `${element.offsetHeight}px`);
    measure();
    const watcher = new ResizeObserver(measure);
    watcher.observe(element);
    return () => watcher.disconnect();
  }, []);
  return (
    <header className="topbar" ref={header}>
      <a className="brand" href={user.role === "housekeeper" ? "/board" : "/desk"}>
        <KeyTag />
        <span>Tallybell Nightroll</span>
      </a>
      <nav aria-label="Main">
        {LINKS.filter((link) => link.roles.includes(user.role)).map((link) => (
          <a key={link.href} href={link.href} aria-current={path === link.href ? "page" : undefined}>
            {link.label}
          </a>
        ))}
      </nav>
      <div className="topbar-items">{children}</div>
      <button
        type="button"
        className="quiet sign-out"
        onClick={async () => {
          await call("DELETE", "/api/session");
          window.location.assign("/");
        }}
      >
        Sign out
      </button>
    </header>
  );
}

export function LiveLine({ withClose }: { withClose: boolean }) {
  const { notice, closeStatus } = useSession();
  return (
    <div className="live-line">
      <div role="status" aria-label="Desk notices" className="notice">{notice}</div>
      {withClose ? <div role="status" aria-label="Close status" className="notice">{closeStatus}</div> : null}
    </div>
  );
}

export function NotFound() {
  return (
    <main className="page">
      <h1>Page not found.</h1>
    </main>
  );
}
