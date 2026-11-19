import { useEffect, type ReactNode } from "react";
import { call } from "../lib/api";
import { Link, navigate, useLocation } from "../lib/router";
import { account, notices, pushed, showNotice, useStore } from "../lib/store";
import type { MeFrame } from "../../shared/protocol";
import { Icon, type IconName } from "./Icon";

/** The person's own socket: it keeps them online and pushes role changes, warnings and notices. */
function useOwnSocket(): void {
  useEffect(() => {
    let socket: WebSocket | null = null;
    let timer = 0;
    let stopped = false;
    const connect = (): void => {
      socket = new WebSocket(`${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws/me`);
      socket.onmessage = (event: MessageEvent<string>) => {
        const frame = JSON.parse(event.data) as MeFrame;
        if (frame.type === "notice") showNotice(frame.text);
        else pushed.set({ ...pushed.get(), [frame.type]: pushed.get()[frame.type] + 1 });
      };
      socket.onclose = () => {
        if (!stopped) timer = window.setTimeout(connect, 2000);
      };
    };
    connect();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      socket?.close();
    };
  }, []);
}

const LINKS: { to: string; label: string; icon: IconName }[] = [
  { to: "/sessions", label: "Sessions", icon: "sessions" },
  { to: "/friends", label: "Friends", icon: "friends" },
  { to: "/studio", label: "Studio", icon: "studio" },
  { to: "/communities", label: "Communities", icon: "communities" },
];

function Alerts() {
  const current = useStore(notices);
  return (
    <div className="alerts">
      {current.map((notice) => (
        <div key={notice.key} role="alert" className="alert">
          <Icon name="alert" size={20} />
          <span>{notice.text}</span>
        </div>
      ))}
    </div>
  );
}

/** The frame of every signed-in page: main navigation, notices and the person's own socket. */
export function SignedInLayout({ children }: { children: ReactNode }) {
  const state = useStore(account);
  const location = useLocation();
  useOwnSocket();
  const moderator = state.state === "in" && state.me.siteRole === "moderator";
  const links = moderator ? [...LINKS, { to: "/moderation", label: "Moderation", icon: "moderation" as IconName }] : LINKS;
  const signOut = async (): Promise<void> => {
    await call("POST", "/api/signout");
    account.set({ state: "out" });
    navigate("/");
  };
  return (
    <>
      <header className="topbar">
        <Link to="/sessions" className="brand">
          Hearthtile
        </Link>
        <nav aria-label="Main" className="nav">
          {links.map((link) => (
            <Link key={link.to} to={link.to} aria-current={location.startsWith(link.to) ? "page" : undefined}>
              <Icon name={link.icon} size={18} /> {link.label}
            </Link>
          ))}
          <button type="button" className="button quiet" onClick={signOut}>
            <Icon name="signout" size={18} /> Sign out
          </button>
        </nav>
      </header>
      <Alerts />
      <main className="page">{children}</main>
    </>
  );
}

export function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">
          Hearthtile
        </Link>
        <nav aria-label="Welcome" className="nav">
          <Link to="/signin">Sign in</Link>
          <Link to="/signup">Sign up</Link>
        </nav>
      </header>
      <Alerts />
      <main className="page">{children}</main>
    </>
  );
}
