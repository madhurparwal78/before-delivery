import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { store } from "./store";
import { Bean, Icon, PanelDialog } from "./ui";
import { RailBody } from "./rail";
import { LobbyView, PartyView, ResultsView } from "./stage";
import { MatchView } from "./match";
import { DockBody } from "./dock";
import { PhotoFinishPage } from "./photo";
import { ForgotPasswordPage, ResetPasswordPage, SigninPage, SignupPage, VerifyPage } from "./auth";
import { ProfilePage, MatchSummaryPage } from "./pages";

type Route =
  | { name: "app" }
  | { name: "signup" }
  | { name: "signin" }
  | { name: "forgot" }
  | { name: "reset"; token: string }
  | { name: "verify"; token: string }
  | { name: "profile"; handle: string }
  | { name: "match"; id: number }
  | { name: "photo-finish"; matchId: number; round: number; tick: number | null };

function parseRoute(): Route {
  const hash = location.hash.replace(/^#/, "") || "/";
  const path = hash.split("?")[0] ?? "/";
  const params = new URLSearchParams(hash.split("?")[1] ?? "");
  if (path === "/signup") return { name: "signup" };
  if (path === "/signin") return { name: "signin" };
  if (path === "/forgot-password") return { name: "forgot" };
  if (path === "/reset-password") return { name: "reset", token: params.get("token") ?? "" };
  if (path === "/verify") return { name: "verify", token: params.get("token") ?? "" };
  const profile = /^\/u\/([^/]+)$/.exec(path);
  if (profile) return { name: "profile", handle: decodeURIComponent(profile[1] ?? "") };
  const photo = /^\/matches\/(\d+)\/rounds\/(\d+)$/.exec(path);
  if (photo) {
    const tickRaw = params.get("tick");
    return {
      name: "photo-finish",
      matchId: Number(photo[1]),
      round: Number(photo[2]),
      tick: tickRaw !== null && /^\d+$/.test(tickRaw) ? Number(tickRaw) : null
    };
  }
  const match = /^\/matches\/(\d+)$/.exec(path);
  if (match) return { name: "match", id: Number(match[1]) };
  return { name: "app" };
}

function Notices(): JSX.Element {
  return (
    <div className="notices" role="status" aria-live="polite" aria-label="Notices">
      {store.notices.map((notice) => (
        <span key={notice.id} style={{ color: notice.kind === "error" ? "var(--red)" : "var(--ink)" }}>
          {notice.text}
        </span>
      ))}
    </div>
  );
}

function TopBar({ onOpenFriends, onOpenDock }: { onOpenFriends: () => void; onOpenDock: () => void }): JSX.Element {
  const [narrow, setNarrow] = useState(window.innerWidth <= 767);
  useEffect(() => {
    const onResize = (): void => setNarrow(window.innerWidth <= 767);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <header className="topbar">
      <a className="brand" href="#/">
        <Bean userId={store.me?.id ?? 1} size={26} /> Pratfall Cup
      </a>
      <div className="topbar-right">
        {narrow && (
          <span className="topbar-buttons" style={{ display: "flex" }}>
            <button type="button" className="btn btn-small" aria-label="Friends" onClick={onOpenFriends}>
              <Icon name="users" /> Friends
            </button>
            <button type="button" className="btn btn-small" aria-label="Party dock" onClick={onOpenDock}>
              <Icon name="message" /> Party dock
            </button>
          </span>
        )}
        {!narrow && window.innerWidth <= 1279 && (
          <span className="topbar-buttons" style={{ display: "flex" }}>
            <button type="button" className="btn btn-small" aria-label="Party dock" onClick={onOpenDock}>
              <Icon name="message" /> Party dock
            </button>
          </span>
        )}
        {store.me && (
          <span className="who">
            Signed in as <a href={`#/u/${store.me.handle}`}>{store.me.handle}</a>
          </span>
        )}
        <button
          type="button"
          className="btn btn-small"
          onClick={() => {
            void store.signOut();
            location.hash = "#/signin";
          }}
        >
          <Icon name="logOut" size={16} /> Sign out
        </button>
      </div>
    </header>
  );
}

function VerifyBanner(): JSX.Element | null {
  const me = store.me;
  const [busy, setBusy] = useState(false);
  if (!me || me.emailVerified) return null;

  const resend = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.post("/api/auth/verification/resend");
      store.notify(`Verification email sent to ${me.email}.`, "success");
    } catch (e) {
      store.notify(e instanceof ApiError ? e.message : "Something went wrong. Try again.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      role="region"
      aria-label="Verify your email"
      className="banner"
      style={{ margin: "0 16px", marginTop: 12, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}
    >
      <span style={{ flex: 1 }}>Verify your email to add friends and find matches.</span>
      <button type="button" className="btn btn-small" disabled={busy} aria-busy={busy} onClick={() => void resend()}>
        {busy ? "Sending…" : "Resend verification email"}
      </button>
    </section>
  );
}

function StageSelector(): JSX.Element {
  const party = store.party;
  const matchOver = store.matchOver;

  if (party?.state === "in_match" && store.match) {
    return <MatchView />;
  }
  if (matchOver && store.match) {
    return <ResultsView onBack={() => {
      store.matchOver = null;
      store.match = null;
      store.emit();
    }} />;
  }
  if (party?.state === "in_lobby" || party?.state === "queued") {
    return <LobbyView />;
  }
  return <PartyView />;
}

export function AppShell(): JSX.Element {
  const [, setTickState] = useState(0);
  const [ready, setReady] = useState(false);
  const [route, setRoute] = useState<Route>(parseRoute());
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [dockOpen, setDockOpen] = useState(false);
  const [dockCollapsed, setDockCollapsed] = useState(() => localStorage.getItem("pc-dock-collapsed") === "1");

  useEffect(() => {
    void store.bootstrap().then(() => setReady(true));
    return store.subscribe(() => setTickState((n) => n + 1));
  }, []);

  useEffect(() => {
    const onHash = (): void => setRoute(parseRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    store.dockExpanded = !dockCollapsed && !dockOpen;
  }, [dockCollapsed, dockOpen]);

  if (!ready) {
    return <div className="page">Loading…</div>;
  }

  if (!store.me) {
    if (route.name !== "signin" && route.name !== "signup" && route.name !== "forgot" && route.name !== "reset" && route.name !== "verify") {
      location.hash = "#/signin";
      return <SigninPage onSignedIn={() => setRoute({ name: "app" })} />;
    }
  }

  const toggleDock = (): void => {
    const next = !dockCollapsed;
    setDockCollapsed(next);
    localStorage.setItem("pc-dock-collapsed", next ? "1" : "0");
  };

  const signedIn = (): void => {
    location.hash = "#/";
    setRoute({ name: "app" });
  };

  return (
    <>
      {route.name === "signup" && <SignupPage onSignedIn={signedIn} />}
      {route.name === "signin" && <SigninPage onSignedIn={signedIn} />}
      {route.name === "forgot" && <ForgotPasswordPage />}
      {route.name === "reset" && <ResetPasswordPage token={route.token} />}
      {route.name === "verify" && <VerifyPage token={route.token} />}
      {route.name === "profile" && store.me && <ProfilePage handle={route.handle} />}
      {route.name === "match" && store.me && <MatchSummaryPage matchId={route.id} />}
      {route.name === "photo-finish" && store.me && (
        <PhotoFinishPage matchId={route.matchId} roundN={route.round} initialTick={route.tick} />
      )}

      {(route.name === "app" || route.name === "profile" || route.name === "match") && store.me && (
        <>
          <div className="app-shell">
            <TopBar onOpenFriends={() => setFriendsOpen(true)} onOpenDock={() => setDockOpen(true)} />
            <aside className="rail" aria-label="Friends" role="complementary">
              <h3 className="rail-heading">Friends</h3>
              <RailBody />
            </aside>
            <main className="stage">
              <VerifyBanner />
              {route.name === "profile" ? (
                <div className="stage-inner">
                  <ProfilePage handle={route.handle} embedded />
                </div>
              ) : route.name === "match" ? (
                <div className="stage-inner">
                  <MatchSummaryPage matchId={route.id} embedded />
                </div>
              ) : (
                <StageSelector />
              )}
            </main>
            <aside className="dock dock-column" role="complementary" aria-label="Party dock" data-collapsed={dockCollapsed ? "true" : "false"}>
              {!dockCollapsed && <DockBody />}
              <button
                type="button"
                className="btn btn-small"
                style={{ margin: 10, alignSelf: "flex-end" }}
                aria-expanded={!dockCollapsed}
                onClick={toggleDock}
              >
                {dockCollapsed ? "Expand dock" : "Collapse dock"}
              </button>
            </aside>
            <footer className="notices" style={{ gridArea: "topbar", display: "none" }} />
          </div>
          <Notices />
          {friendsOpen && (
            <PanelDialog label="Friends" onClose={() => setFriendsOpen(false)} side="full">
              <RailBody />
            </PanelDialog>
          )}
          {dockOpen && (
            <PanelDialog label="Party dock" onClose={() => setDockOpen(false)} side="right">
              <DockBody />
            </PanelDialog>
          )}
        </>
      )}
    </>
  );
}
