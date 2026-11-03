// The app shell: top bar, Friends rail, stage and Party dock, rearranged for each viewport.
import type { ComponentChildren, RefObject } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { LogOut, MessageCircle, PanelRightClose, PanelRightOpen, Users, X } from "lucide";
import { post } from "./api.js";
import { COPY } from "./copy.js";
import { type DockTab, DockContent } from "./dock.js";
import { Icon } from "./icon.js";
import { announce, announceFailure } from "./notices.js";
import { MatchPage, ProfilePage } from "./pages.js";
import { PhotoFinishPage } from "./photo-finish.js";
import { RailContent } from "./rail.js";
import { navigate, type Route } from "./router.js";
import { Stage } from "./stage.js";
import { loadConversation, me, showLogs } from "./state.js";
import { useStore } from "./store.js";
import { ActionButton, focusables, trapKeys } from "./ui.js";

const DOCK_KEY = "pc-dock";
type Panel = "friends" | "dock" | null;

function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const change = () => setMatches(list.matches);
    change();
    list.addEventListener("change", change);
    return () => list.removeEventListener("change", change);
  }, [query]);
  return matches;
}

function VerifyBanner() {
  const self = useStore(me);
  if (self === null || self === undefined || self.emailVerified) return null;
  return (
    <section role="region" aria-label="Verify your email" class="verify-banner">
      <p>{COPY.banner}</p>
      <ActionButton label="Resend verification email" pendingLabel={COPY.sending} kind="primary" run={async () => {
        try {
          await post("/api/auth/verification/resend");
          announce(COPY.resent(self.email));
        } catch (error) {
          announceFailure(error, { already_verified: COPY.alreadyVerified, mail_unavailable: COPY.mailDown });
        }
      }} />
    </section>
  );
}

// A side panel that is a landmark on wide screens and a modal dialog over the page on narrow ones;
// while open as a dialog it owns Tab and Escape for the whole document, even if focus has dropped to the page.
function SidePanel({ label, side, asDialog, open, opener, onClose, children, class: className = "" }: {
  label: string; side: "left" | "right"; asDialog: boolean; open: boolean; opener: RefObject<HTMLButtonElement>;
  onClose: () => void; children: ComponentChildren; class?: string;
}) {
  const panel = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (!asDialog || !open || panel.current === null) return undefined;
    const root = panel.current;
    focusables(root)[0]?.focus();
    const keys = (event: KeyboardEvent) => trapKeys(event, root, onClose);
    document.addEventListener("keydown", keys);
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      root.animate([{ transform: `translateX(${side === "left" ? "-100%" : "100%"})` }, { transform: "translateX(0)" }],
        { duration: 250, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
    }
    return () => {
      document.removeEventListener("keydown", keys);
      opener.current?.focus();
    };
  }, [asDialog, open]);
  if (asDialog && !open) return null;
  return (
    <aside ref={panel} class={`side ${side} ${asDialog ? "as-dialog" : ""} ${className}`} role={asDialog ? "dialog" : "complementary"}
      aria-label={label} aria-modal={asDialog ? "true" : undefined}>
      {asDialog ? (
        <div class="dialog-head">
          <h2>{label}</h2>
          <button type="button" class="button quiet" onClick={onClose}><Icon node={X} /><span>Close</span></button>
        </div>
      ) : null}
      {children}
    </aside>
  );
}

function Page({ current }: { current: Route }) {
  if (current.page === "profile") return <ProfilePage handle={current.handle} />;
  if (current.page === "match") return <MatchPage matchId={current.matchId} />;
  if (current.page === "replay") {
    return <PhotoFinishPage key={`${current.matchId}-${current.round}`} matchId={current.matchId} roundNumber={current.round} initialTick={current.tick} />;
  }
  return <HomeStage />;
}

function HomeStage() {
  const self = useStore(me);
  if (!self?.emailVerified) {
    return (
      <section class="card welcome">
        <h2 class="display">Welcome to Pratfall Cup</h2>
        <p>Open the link we emailed you, then add friends, form a party and queue for the cup.</p>
      </section>
    );
  }
  return <Stage />;
}

export function Shell({ current }: { current: Route }) {
  const self = useStore(me);
  const wide = useMedia("(min-width: 1024px)");
  const railColumn = useMedia("(min-width: 640px)");
  const [panel, setPanel] = useState<Panel>(null);
  const [collapsed, setCollapsed] = useState(() => window.localStorage.getItem(DOCK_KEY) === "collapsed");
  const [tab, setTab] = useState<DockTab>("party");
  const [openUser, setOpenUser] = useState<number | null>(null);
  const friendsOpener = useRef<HTMLButtonElement>(null);
  const dockOpener = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (railColumn && panel === "friends") setPanel(null);
    if (wide && panel === "dock") setPanel(null);
  }, [wide, railColumn]);

  useEffect(() => {
    const open = (event: Event) => {
      const userId = (event as CustomEvent<number>).detail;
      setTab("messages");
      setOpenUser(userId);
      void loadConversation(userId).catch(() => undefined);
      if (wide) {
        setCollapsed(false);
        window.localStorage.setItem(DOCK_KEY, "expanded");
      } else {
        setPanel("dock");
      }
    };
    window.addEventListener("pc:open-dm", open);
    return () => window.removeEventListener("pc:open-dm", open);
  }, [wide]);

  const dockOpen = (wide ? !collapsed : panel === "dock") && self?.emailVerified === true;
  useEffect(() => {
    showLogs({ party: dockOpen && tab === "party", dmWith: dockOpen && tab === "messages" ? openUser : null });
  }, [dockOpen, tab, openUser]);

  const setDock = (next: boolean) => {
    setCollapsed(next);
    window.localStorage.setItem(DOCK_KEY, next ? "collapsed" : "expanded");
  };

  if (self === null || self === undefined) return <main class="loading"><p>Loading Pratfall Cup…</p></main>;
  return (
    <div class={`shell ${wide && collapsed ? "dock-collapsed" : ""}`}>
      <header class="topbar">
        <a class="brand" href="/">Pratfall Cup</a>
        <p class="identity">Signed in as {self.handle}</p>
        <div class="topbar-actions">
          {!railColumn ? (
            <button ref={friendsOpener} type="button" class="button quiet" onClick={() => setPanel("friends")}>
              <Icon node={Users} /><span>Friends</span>
            </button>
          ) : null}
          {!wide ? (
            <button ref={dockOpener} type="button" class="button quiet" onClick={() => setPanel("dock")}>
              <Icon node={MessageCircle} /><span>Party dock</span>
            </button>
          ) : null}
          <button type="button" class="button quiet" onClick={() => {
            void post("/api/auth/logout").then(() => {
              me.set(null);
              navigate("/signin");
            }).catch((error: unknown) => announceFailure(error));
          }}>
            <Icon node={LogOut} /><span>Sign out</span>
          </button>
        </div>
      </header>
      <VerifyBanner />
      <div class="columns">
        <SidePanel label="Friends" side="left" asDialog={!railColumn} open={panel === "friends"} opener={friendsOpener}
          onClose={() => setPanel(null)} class="rail">
          {railColumn ? <h2>Friends</h2> : null}
          <RailContent />
        </SidePanel>
        <main class="stage" id="stage">
          <Page current={current} />
        </main>
        {wide ? (
          <aside role="complementary" aria-label="Party dock" class={`side right dock ${collapsed ? "collapsed" : ""}`}>
            <button type="button" class="button quiet dock-toggle" aria-expanded={collapsed ? "false" : "true"}
              onClick={() => setDock(!collapsed)}>
              <Icon node={collapsed ? PanelRightOpen : PanelRightClose} />
              <span class={collapsed ? "visually-hidden" : ""}>{collapsed ? "Expand dock" : "Collapse dock"}</span>
            </button>
            {collapsed ? null : <DockContent tab={tab} onTab={setTab} openUser={openUser} onOpen={setOpenUser} />}
          </aside>
        ) : (
          <SidePanel label="Party dock" side="right" asDialog open={panel === "dock"} opener={dockOpener} onClose={() => setPanel(null)} class="dock">
            <DockContent tab={tab} onTab={setTab} openUser={openUser} onOpen={setOpenUser} />
          </SidePanel>
        )}
      </div>
    </div>
  );
}
