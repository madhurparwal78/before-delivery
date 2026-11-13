// The console chrome: ingest bar, header with space menu and account dialog, workspace tabs, announcements, footer.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiFailure } from "../lib/api";
import { Modal } from "../lib/dialog";
import { useShown } from "../lib/format";
import { disconnectLive } from "../lib/live";
import { Menu } from "../lib/menu";
import { EASE_OUT, play } from "../lib/motion";
import { Link, navigate, useLocation } from "../lib/router";
import { announce, update, useAppState, type Me } from "../lib/store";
import { Button, ErrorSummary, Field, useBusy, useFocusableScrollers } from "../lib/ui";

const TABS: Array<{ label: string; to: string }> = [
  { label: "Explore", to: "/explore" }, { label: "Pipes", to: "/pipes" }, { label: "Streams", to: "/streams" },
  { label: "Pipelines", to: "/pipelines" }, { label: "Alerts", to: "/alerts" }, { label: "Inbox", to: "/inbox" },
  { label: "Cases", to: "/cases" }, { label: "Traces", to: "/traces" }, { label: "Objectives", to: "/objectives" },
  { label: "Spaces", to: "/spaces" }, { label: "Keys", to: "/keys" },
];

function IngestBar() {
  const ingest = useAppState((s) => s.ingest);
  return (
    <div className="ingest" role="region" aria-label="Ingest status">
      {ingest ? `${ingest.stored} events stored, ${ingest.failed} in failure store` : " "}
    </div>
  );
}

function SpaceMenu({ me }: { me: Me }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const choose = async (slug: string): Promise<void> => {
    if (slug === me.space.slug) return;
    const next = await api.patch<Me>("/api/me", { space: slug });
    update((s) => ({ me: next, seq: next.seq, spaceVersion: s.spaceVersion + 1, ingest: null }));
  };
  return (
    <div className="menu-host">
      <button ref={button} type="button" className="btn btn-outline" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        Space
      </button>
      {open ? (
        <Menu
          label="Spaces" radio anchor={button} onClose={() => setOpen(false)}
          items={me.spaces.map((space) => ({ label: space.name, checked: space.slug === me.space.slug, onSelect: () => void choose(space.slug) }))}
        />
      ) : null}
    </div>
  );
}

function zoneNames(current: string): string[] {
  const names = new Set<string>(["UTC", current, ...Intl.supportedValuesOf("timeZone")]);
  return [...names].sort();
}

function AccountDialog({ me, onClose }: { me: Me; onClose: () => void }) {
  const [zone, setZone] = useState(me.time_zone);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [busy, run] = useBusy();
  const save = (): Promise<void> =>
    run(async () => {
      try {
        const next = await api.patch<Me>("/api/me", { time_zone: zone });
        update({ me: next });
        announce(`Time zone set to ${next.time_zone}.`);
        onClose();
      } catch (error) {
        setFailure(error as ApiFailure);
      }
    });
  const signOut = (): Promise<void> =>
    run(async () => {
      await api.post("/api/signout");
      disconnectLive();
      update({ me: null, seq: 0, ingest: null, announcement: "" });
      navigate("/signin");
    });
  return (
    <Modal label="Account" onClose={onClose}>
      <p className="muted">Signed in as {me.username}.</p>
      <ErrorSummary failure={failure} />
      <Field label="Time zone">
        {(props) => (
          <select {...props} data-field="time_zone" role="combobox" value={zone} onChange={(event) => setZone(event.target.value)}>
            {zoneNames(me.time_zone).map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        )}
      </Field>
      <div className="dialog-actions">
        <Button primary busy={busy} onClick={() => void save()}>Save account</Button>
        <Button busy={busy} onClick={() => void signOut()}>Sign out</Button>
      </div>
    </Modal>
  );
}

function Header({ me }: { me: Me }) {
  const shown = useShown();
  const serverNow = useAppState((s) => s.serverNowMs);
  const [account, setAccount] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  return (
    <header className="header">
      <Link to="/explore" className="brand">Spoorline</Link>
      <span className="server-time">Server time {serverNow === null ? "" : shown(serverNow)}</span>
      <div className="header-actions">
        <SpaceMenu me={me} />
        <button ref={opener} type="button" className="btn btn-outline" aria-haspopup="dialog" onClick={() => setAccount(true)}>Account</button>
      </div>
      {account ? <AccountDialog me={me} onClose={() => setAccount(false)} /> : null}
    </header>
  );
}

function Tabs() {
  const { path } = useLocation();
  const nav = useRef<HTMLElement>(null);
  const underline = useRef<HTMLSpanElement>(null);
  const previous = useRef<{ left: number; width: number } | null>(null);
  const current = path.startsWith("/rules") ? null : (TABS.find((tab) => path === tab.to || path.startsWith(`${tab.to}/`)) ?? null);

  useLayoutEffect(() => {
    const line = underline.current as HTMLSpanElement;
    const link = current ? nav.current?.querySelector<HTMLElement>(`[data-tab="${current.to}"]`) : null;
    if (!link) {
      line.style.display = "none";
      previous.current = null;
      return;
    }
    line.style.display = "block";
    const next = { left: link.offsetLeft, width: link.offsetWidth };
    line.style.transform = `translateX(${next.left}px)`;
    line.style.width = `${next.width}px`;
    const old = previous.current;
    if (old && (old.left !== next.left || old.width !== next.width)) {
      play(line, "tab-slide", [{ transform: `translateX(${old.left}px)`, width: `${old.width}px` }, { transform: `translateX(${next.left}px)`, width: `${next.width}px` }], 240, EASE_OUT);
    }
    previous.current = next;
  }, [current]);

  return (
    <nav ref={nav} className="tabs" aria-label="Workspace">
      {TABS.map((tab) => (
        <Link key={tab.to} to={tab.to} data-tab={tab.to} className="tab" aria-current={current === tab ? "page" : undefined}>{tab.label}</Link>
      ))}
      <span ref={underline} className="tab-underline" aria-hidden="true" />
    </nav>
  );
}

export function Shell({ me, children }: { me: Me; children: ReactNode }) {
  const announcement = useAppState((s) => s.announcement);
  const seq = useAppState((s) => s.seq);
  const pending = useAppState((s) => s.pending);
  useFocusableScrollers();
  useEffect(() => {
    api.get<{ now_ms: number }>("/api/time").then((time) => update({ serverNowMs: time.now_ms }), () => undefined);
  }, []);
  return (
    <div className="shell">
      <IngestBar />
      <Header me={me} />
      <Tabs />
      <div className="announcements" role="status" aria-label="Announcements" aria-live="polite">{announcement}</div>
      <main className="main" data-seq={seq} data-pending={pending}>{children}</main>
      <footer className="footer">
        <span className="footer-name">Spoorline</span>
        <Link to="/rules">Published rules</Link>
      </footer>
    </div>
  );
}
