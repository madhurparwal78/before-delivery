import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { LogOut } from "lucide-react";
import type { Member, Workspace } from "../shared/types.js";
import { api, ApiFailure } from "./api.js";
import { announce, useAnnouncement } from "./announce.js";
import { Daybook } from "./screens/Daybook.js";
import { Join, SignIn, StartTrial } from "./screens/Entry.js";
import { Operations } from "./screens/Operations.js";
import { Settings } from "./screens/Settings.js";
import { WorkspacePage } from "./screens/WorkspacePage.js";

export type Me = { member: Member; workspace: Workspace | null; today: string };

export type Navigate = (path: string) => void;

const DAY = 86_400_000;

function SubscriptionBanner({ workspace }: { workspace: Workspace }) {
  let copy: string;
  switch (workspace.state) {
    case "active":
      return null;
    case "trialing": {
      const days = Math.max(0, Math.ceil((Date.parse(workspace.trialEndsAt) - Date.now()) / DAY));
      copy = days === 1 ? "Trial: 1 day left" : `Trial: ${days} days left`;
      break;
    }
    case "past_due":
      copy = "Payment failed. Planning stays open while billing retries.";
      break;
    case "read_only":
      copy = "This workspace is read-only. Planning resumes when the subscription is active.";
      break;
    case "cancelled":
      copy = "This subscription is cancelled. Your plans stay readable.";
      break;
  }
  return (
    <section className={`subscription subscription-${workspace.state}`} aria-label="Subscription">
      <p>{copy}</p>
    </section>
  );
}

function Header({ me, path, navigate, onSignOut }: { me: Me; path: string; navigate: Navigate; onSignOut: () => void }) {
  const role = me.member.role;
  const links =
    role === "operator"
      ? [{ to: "/operations", label: "Operations" }]
      : [
          { to: "/", label: "Daybook" },
          { to: "/settings", label: "Settings" },
          ...(role === "owner" ? [{ to: "/workspace", label: "Workspace" }] : []),
        ];
  const go = (to: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    navigate(to);
  };
  return (
    <header className="masthead">
      <div className="masthead-title">
        <span className="brand">Tidemark Daybook</span>
        <span className="workspace-name">{me.workspace ? me.workspace.name : "Operator"}</span>
      </div>
      <nav className="mainnav" aria-label="Main">
        {links.map((link) => (
          <a key={link.to} href={link.to} className="navlink" aria-current={path === link.to ? "page" : undefined} onClick={go(link.to)}>
            {link.label}
          </a>
        ))}
        <button type="button" className="navlink" onClick={onSignOut}>
          <LogOut aria-hidden="true" size={18} /> Sign out
        </button>
      </nav>
    </header>
  );
}

export function App() {
  const [path, setPath] = useState(window.location.pathname);
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const message = useAnnouncement();

  const navigate: Navigate = useCallback((to) => {
    if (to !== window.location.pathname) window.history.pushState(null, "", to);
    setPath(to);
    window.scrollTo(0, 0);
  }, []);

  const refreshMe = useCallback(async () => {
    try {
      setMe(await api<Me>("GET", "/api/me"));
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 401) setMe(null);
    }
  }, []);

  useEffect(() => {
    void refreshMe();
    const timer = setInterval(() => void refreshMe(), 60_000);
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => {
      clearInterval(timer);
      window.removeEventListener("popstate", onPop);
    };
  }, [refreshMe]);

  const signedIn = useCallback(
    async (to = "/") => {
      await refreshMe();
      navigate(to);
    },
    [navigate, refreshMe],
  );

  const signOut = async () => {
    try {
      await api("POST", "/api/auth/sign-out");
    } finally {
      setMe(null);
      navigate("/");
      announce("Signed out.");
    }
  };

  const join = /^\/join\/([^/]+)$/.exec(path);
  // Until /api/me answers, nothing of the page is drawn but the boot line: the masthead and banner
  // then arrive with the screen in one paint instead of pushing an already-drawn main down.
  if (me === undefined && !join) {
    return (
      <div className="page page-entry">
        <p className="boot" aria-busy="true">Opening your Daybook…</p>
      </div>
    );
  }

  let screen = null;
  if (join) screen = <Join token={decodeURIComponent(join[1])} onJoined={() => void signedIn("/")} />;
  else if (me === undefined) screen = null;
  else if (me === null) screen = path === "/start" ? <StartTrial onCreated={() => void signedIn("/")} navigate={navigate} /> : <SignIn onSignedIn={(operator) => void signedIn(operator ? "/operations" : "/")} navigate={navigate} />;
  else if (me.member.role === "operator") screen = <Operations />;
  else if (path === "/settings") screen = <Settings me={me} onSaved={refreshMe} />;
  else if (path === "/workspace" && me.member.role === "owner") screen = <WorkspacePage me={me} />;
  else screen = <Daybook key={me.member.timeZone} zone={me.member.timeZone} email={me.member.email} />;

  const planner = me && me.member.role !== "operator" && me.workspace && !join;
  const showChrome = me && !join;
  return (
    <div className={`page${showChrome ? "" : " page-entry"}`}>
      {showChrome && <Header me={me} path={me.member.role === "operator" ? "/operations" : path} navigate={navigate} onSignOut={() => void signOut()} />}
      {planner && me.workspace && <SubscriptionBanner workspace={me.workspace} />}
      <div className="status-line" role="status" aria-live="polite" aria-label="Planner updates">
        {message}
      </div>
      <main className="main">{screen}</main>
    </div>
  );
}
