import { useRef, useState } from "preact/hooks";
import { api, get } from "./api";
import { useLive, useMount } from "./hooks";
import { Icon, LogoMark } from "./icons";
import { startLive, stopLive } from "./live";
import { navigate, useRoute } from "./router";
import { announce, outageStore, session, unreadStore } from "./store";
import type { InboxItem, Me } from "./types";
import { LiveRegions, ModalHost } from "./ui";
import { useModals } from "./store";
import { Account } from "./pages/Account";
import { Goals } from "./pages/Goals";
import { Inbox } from "./pages/Inbox";
import { Intake } from "./pages/Intake";
import { MyWork } from "./pages/MyWork";
import { NotFoundPage } from "./pages/NotFound";
import { ProjectPage } from "./pages/Project";
import { RulesPage } from "./pages/Rules";
import { WorkloadPage } from "./pages/Workload";
import { Welcome, PublicHeader } from "./pages/Welcome";

const PHONE = "(max-width: 639px)";

function usePhone(): boolean {
  const [phone, setPhone] = useState(() => matchMedia(PHONE).matches);
  useMount(() => {
    const query = matchMedia(PHONE);
    const update = () => setPhone(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return phone;
}

function useScrolled(): boolean {
  const [scrolled, setScrolled] = useState(() => scrollY > 0);
  useMount(() => {
    const update = () => setScrolled(scrollY > 0);
    addEventListener("scroll", update, { passive: true });
    return () => removeEventListener("scroll", update);
  }, []);
  return scrolled;
}

async function signOut(): Promise<void> {
  await api("POST", "/api/signout");
  stopLive();
  session.set(null);
  unreadStore.set(0);
  navigate("/");
}

function TopBar({ me }: { me: Me }) {
  const phone = usePhone();
  const scrolled = useScrolled();
  const unread = unreadStore.use();
  const [menu, setMenu] = useState(false);
  const [account, setAccount] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const accountButton = useRef<HTMLButtonElement>(null);
  const route = useRoute();
  useMount(() => setMenu(false), [route.path]);

  const keydown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    if (account) {
      setAccount(false);
      accountButton.current?.focus();
    } else if (menu) {
      setMenu(false);
      menuButton.current?.focus();
    }
  };
  const linksHidden = phone && !menu;
  return (
    <header class={`topbar${scrolled ? " is-scrolled" : ""}`} onKeyDown={keydown}>
      <a class="brand" href="/" aria-label="Everyweek home"><LogoMark /><span class="wordmark">Everyweek</span></a>
      {phone && (
        <button ref={menuButton} type="button" class="menu-toggle" aria-expanded={menu} aria-controls="top-links" onClick={() => setMenu(!menu)}>
          <Icon name="menu" size={20} />Menu
        </button>
      )}
      <nav id="top-links" class="top-links" aria-label="Main" hidden={linksHidden}>
        <a href="/" aria-current={route.path === "/" ? "page" : undefined}>My work</a>
        <a href="/goals" aria-current={route.path === "/goals" ? "page" : undefined}>Goals</a>
        <a href="/inbox" aria-label={`Inbox, ${unread} unread`} aria-current={route.path === "/inbox" ? "page" : undefined}>
          Inbox{" "}<span class="count-pill" aria-hidden="true">{unread}</span>
        </a>
        {phone ? (
          <div class="account-inline">
            <p class="muted">{me.name}</p>
            <a href="/account">Account</a>
            <button type="button" class="link-button" onClick={() => void signOut()}>Sign out</button>
          </div>
        ) : (
          <div class="account-menu">
            <button ref={accountButton} type="button" class="avatar-button" aria-expanded={account} aria-controls="account-panel"
              aria-label="Account menu" onClick={() => setAccount(!account)}>
              <span aria-hidden="true">{me.name.slice(0, 1).toUpperCase()}</span>
            </button>
            <div id="account-panel" class="account-panel" hidden={!account}>
              <p class="strong">{me.name}</p>
              <p class="muted">{me.email}</p>
              <a href="/account">Account</a>
              <button type="button" class="link-button" onClick={() => void signOut()}>Sign out</button>
            </div>
          </div>
        )}
      </nav>
    </header>
  );
}

function useShell(me: Me | null): void {
  const refresh = async () => {
    const inbox = await get<{ unread: number; items: InboxItem[] }>("/api/inbox");
    if (inbox.ok) unreadStore.set(inbox.data.unread);
  };
  useMount(() => {
    if (!me) return undefined;
    startLive();
    void refresh();
    return undefined;
  }, [me?.id]);
  useLive((event) => {
    if (!me) return;
    if (event.t === "inbox" || event.t === "resync") void refresh();
    if (event.t === "inbox" && event.added) announce("Inbox status", `New in inbox: ${event.text as string}`);
  });
}

const PUBLIC_PATHS = [/^\/$/, /^\/account$/, /^\/f\/[^/]+$/];

function Page({ me }: { me: Me | null }) {
  const route = useRoute();
  const path = route.path;
  const isPublic = PUBLIC_PATHS.some((p) => p.test(path));
  useMount(() => {
    if (!me && !isPublic) navigate("/account", true);
  }, [me?.id, path]);
  if (path === "/") return me ? <MyWork me={me} /> : <Welcome />;
  if (path === "/account") return <Account me={me} />;
  const form = /^\/f\/([^/]+)$/.exec(path);
  if (form) return <Intake slug={form[1]} />;
  if (!me) return null;
  const rules = /^\/projects\/([^/]+)\/rules$/.exec(path);
  if (rules) return <RulesPage projectId={rules[1]} />;
  const project = /^\/projects\/([^/]+)$/.exec(path);
  if (project) return <ProjectPage projectId={project[1]} me={me} />;
  const workload = /^\/workload\/([^/]+)$/.exec(path);
  if (workload) return <WorkloadPage teamId={workload[1]} />;
  if (path === "/goals") return <Goals me={me} />;
  if (path === "/inbox") return <Inbox />;
  return <NotFoundPage title="Page not found" />;
}

export function App() {
  const me = session.use();
  const outage = outageStore.use();
  const modals = useModals();
  useShell(me);
  return (
    <>
      <div class="app-content" inert={modals.length > 0} onClick={interceptClicks}>
        {me ? <TopBar me={me} /> : <PublicHeader />}
        {outage && <div class="outage-band" role="status">File storage is unavailable. Everything else keeps working.</div>}
        <main id="main" tabIndex={-1}>
          <Page me={me} />
        </main>
      </div>
      <ModalHost />
      <LiveRegions />
    </>
  );
}

import { interceptLinks } from "./router";
function interceptClicks(event: MouseEvent): void {
  interceptLinks(event);
}
