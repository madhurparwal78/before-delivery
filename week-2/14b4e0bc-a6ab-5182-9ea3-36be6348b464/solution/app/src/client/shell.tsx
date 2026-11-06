import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { activity, motion, services, session, syncedSeq, watchViewport } from "./app-state.ts";
import { api, isAdmin, useStore } from "./lib.ts";
import { Icon } from "./ui.tsx";

type Screen = "catalog" | "glossary" | "admin";

function TopBar({ screen }: { screen: Screen }) {
  const user = useStore(session)!;
  const bar = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = bar.current!;
    const sync = () => document.documentElement.style.setProperty("--topbar", `${Math.ceil(el.getBoundingClientRect().height)}px`);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    const unwatch = watchViewport(sync);
    return () => {
      observer.disconnect();
      unwatch();
    };
  }, []);
  const signOut = async () => {
    await api("DELETE", "/api/session").catch(() => undefined);
    location.assign("/signin");
  };
  const link = (name: string, href: string, current: boolean) => (
    <a href={href} class="nav-link" aria-current={current ? "page" : undefined}>
      {name}
    </a>
  );
  return (
    <header class="topbar" ref={bar}>
      <a class="wordmark" href="/catalog">
        Quarrystone Strata
      </a>
      <nav aria-label="Main" class="nav">
        {link("Catalog", "/catalog", screen === "catalog")}
        {link("Glossary", "/glossary", screen === "glossary")}
        {isAdmin(user.role) && link("Admin", "/admin", screen === "admin")}
      </nav>
      <div class="who">
        <span class="who-name">{user.name}</span>
        <span class="who-role">{user.role}</span>
      </div>
      <button type="button" class="btn btn-quiet signout" onClick={signOut}>
        <Icon name="logout" />
        Sign out
      </button>
    </header>
  );
}

/** Outage banners in flow under the top bar, evidence before mail, one element each (DP-66). */
function Banners() {
  const s = useStore(services);
  return (
    <>
      {s.evidence === "down" && (
        <div role="alert" aria-label="Evidence storage outage" class="note-band banner">
          <p>Evidence storage is unreachable. Verification is paused; everything else works.</p>
        </div>
      )}
      {s.mail === "down" && (
        <div role="alert" aria-label="Mail relay outage" class="note-band banner">
          <p>The mail relay is unreachable. Deprecation notices are queued and will send when it returns.</p>
          <p>
            Queued notices: <span class="mono" data-queued-notices="">{s.queued}</span>
          </p>
        </div>
      )}
    </>
  );
}

function ActivityLine({ after }: { after?: ComponentChildren }) {
  const a = useStore(activity);
  return (
    <div class={`activity-line${a.text ? " has-text" : ""}`}>
      <div role="status" aria-label="Activity" class="activity-text">
        {a.text}
      </div>
      {after}
    </div>
  );
}

interface ShellProps {
  screen: Screen;
  pointInTime?: ComponentChildren;
  afterActivity?: ComponentChildren;
  children: ComponentChildren;
}

/** The signed-in frame: sticky top bar, in-flow notes, then the screen inside `main`. */
export function Shell(props: ShellProps) {
  const motionValue = useStore(motion);
  const seq = useStore(syncedSeq);
  return (
    <div id="shell" class={`shell shell-${props.screen}`}>
      <TopBar screen={props.screen} />
      <div class="notes">
        <Banners />
        {props.pointInTime}
      </div>
      <main class={`main main-${props.screen}`} data-motion={motionValue} data-synced-seq={seq === null ? undefined : String(seq)}>
        <ActivityLine after={props.afterActivity} />
        {props.children}
      </main>
    </div>
  );
}
