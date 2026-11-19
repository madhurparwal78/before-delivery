import { Pause, Play, SkipForward, Square, PanelRight } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { LAYER_KINDS } from "../../shared/types.ts";
import type { LayerKind, SetListing } from "../../shared/types.ts";
import { KIND_LABELS } from "../../shared/layers.ts";
import type { Account } from "../../shared/types.ts";
import { COLLAB_BANNER, STORAGE_BANNER } from "../../shared/messages.ts";
import type { EditorStore } from "../store/editor.ts";
import { ConflictDialog, NewSetDialog, ShortcutsDialog } from "./Dialogs.tsx";
import { ConsolePane } from "./ConsolePane.tsx";
import { GraphPane } from "./GraphPane.tsx";
import { useEditor } from "./hooks.ts";
import { DOCK_ICONS } from "./icons.tsx";
import { Inspector } from "./Inspector.tsx";
import { AssetsPane, ActivityPane, SetList, ShowsPane } from "./RigPanes.tsx";
import { ScriptPane } from "./ScriptPane.tsx";
import { ShaderPane } from "./ShaderPane.tsx";
import { StageView } from "./StageView.tsx";
import { TimelinePane } from "./TimelinePane.tsx";
import { LayerTree } from "./Tree.tsx";


type Tile = "Layers" | "Assets" | "Shaders" | "Graph" | "Scripts" | "Shows" | "Activity";
type Tab = "Timeline" | "Shader editor" | "Node graph" | "Script editor" | "Console";
const TILES: Tile[] = ["Layers", "Assets", "Shaders", "Graph", "Scripts", "Shows", "Activity"];
const TABS: Tab[] = ["Timeline", "Shader editor", "Node graph", "Script editor", "Console"];
const TILE_TAB: Partial<Record<Tile, Tab>> = { Shaders: "Shader editor", Graph: "Node graph", Scripts: "Script editor" };
const DRAWER_QUERY = "(max-width: 1023px)";
const DRAWER_SLIDE_MS = 450;

interface ShellProps {
  user: Account | null;
  store: EditorStore | null;
  sets: SetListing[];
  onSignOut: () => void;
  onOpenSet: (id: string) => void;
  onWorkspace: () => void;
  onImport: (file: File) => void;
  onBooth: () => void;
  opening: boolean;
  overlay: ReactNode;
}

function Menu({ label, children, open, onOpen }: { label: string; children: ReactNode; open: boolean; onOpen: (open: boolean) => void }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-haspopup]):not([disabled])')];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") {
      onOpen(false);
      trigger.current?.focus();
    } else if (event.key === "ArrowDown") {
      items[(index + 1) % items.length]?.focus();
    } else if (event.key === "ArrowUp") {
      items[(index - 1 + items.length) % items.length]?.focus();
    } else {
      return;
    }
    event.preventDefault();
  };
  return (
    <div className="menu-wrap" onKeyDown={onKeyDown}>
      <button
        ref={trigger}
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        className="menu-trigger"
        onClick={() => onOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            onOpen(true);
          }
        }}
      >
        {label}
      </button>
      {open ? (
        <div role="menu" aria-label={label} className="menu popover" onClick={() => onOpen(false)}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

function Item({ children, onSelect, disabled, pressed }: { children: ReactNode; onSelect: () => void; disabled?: boolean; pressed?: boolean }) {
  return (
    <button type="button" role="menuitem" className="menu-item" tabIndex={-1} disabled={disabled} aria-checked={pressed === undefined ? undefined : pressed} onClick={onSelect}>
      {children}
    </button>
  );
}

function Presence({ store }: { store: EditorStore }) {
  return (
    <ul aria-label="In this set" className="presence">
      {store.presence.map((member) => {
        const layer = store.doc.layers.find((candidate) => candidate.id === member.selection);
        return (
          <li key={member.user_id} className="presence-item">
            <span role="img" aria-label={`Cursor colour ${member.colour}`} className={`dot dot-${member.colour}`} />
            <span className="presence-name">{member.display_name}</span>
            <span className="muted presence-layer">{layer ? layer.name : "nothing selected"}</span>
          </li>
        );
      })}
    </ul>
  );
}

function MenuBar({ props, store, setTile, setTab }: { props: ShellProps; store: EditorStore | null; setTile: (tile: Tile) => void; setTab: (tab: Tab) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [shortcuts, setShortcuts] = useState(false);
  const [creating, setCreating] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  const importer = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent): void => {
      if (bar.current && !bar.current.contains(event.target as Node)) setOpen(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const live = store?.mode === "live";
  const edit = Boolean(store?.canEdit);
  const menu = (label: string, body: ReactNode): ReactNode => (
    <Menu key={label} label={label} open={open === label} onOpen={(value) => setOpen(value ? label : null)}>{body}</Menu>
  );
  const select = store?.selected;
  return (
    <div className="menubar-strip">
      <div role="menubar" aria-label="Set menu" className="menubar" ref={bar}>
        {menu("Set", props.user ? (
          <>
            <Item onSelect={props.onWorkspace}>Workspace</Item>
            <Item onSelect={() => setCreating(true)}>New set…</Item>
            <Item onSelect={() => importer.current?.click()}>Import set…</Item>
            <Item disabled={!live} onSelect={() => { setTile("Shows"); }}>Export set</Item>
          </>
        ) : (
          <Item onSelect={props.onBooth}>Sign in or create account</Item>
        ))}
        {menu("Edit", (
          <>
            <Item disabled={!edit || !select} onSelect={() => select && store?.removeLayer(select.id)}>Delete layer</Item>
            <Item disabled={!edit || !select} onSelect={() => select && store?.setLayerValue(select.id, "visible", !select.visible)}>
              {select && !select.visible ? "Show layer" : "Hide layer"}
            </Item>
          </>
        ))}
        {menu("Add", (
          <>
            {LAYER_KINDS.map((kind: LayerKind) => (
              <Item key={kind} disabled={!edit} onSelect={() => store?.addLayer(kind)}>{KIND_LABELS[kind]}</Item>
            ))}
          </>
        ))}
        {menu("Stage", (
          <>
            <Item disabled={!store} onSelect={() => store?.setGizmoMode("move")}>Move tool</Item>
            <Item disabled={!store} onSelect={() => store?.setGizmoMode("rotate")}>Rotate tool</Item>
            <Item disabled={!store} onSelect={() => store?.setGizmoMode("scale")}>Scale tool</Item>
            <Item disabled={!store} onSelect={() => store?.toggleSnap("grid")}>Toggle grid snap</Item>
            <Item disabled={!store} onSelect={() => store?.toggleSnap("angle")}>Toggle angle snap</Item>
          </>
        ))}
        {menu("Timeline", (
          <>
            <Item disabled={!store} onSelect={() => (store?.transport.isPlaying() ? store.transport.pause() : store?.transport.play())}>Play or pause</Item>
            <Item disabled={!store} onSelect={() => store?.transport.step()}>Step one beat</Item>
            <Item disabled={!store} onSelect={() => store?.transport.stop()}>Back to 1:1</Item>
            <Item disabled={!store} onSelect={() => setTab("Timeline")}>Show timeline</Item>
          </>
        ))}
        {menu("Share", (
          <>
            <Item disabled={!live} onSelect={() => setTile("Shows")}>Publish and invite…</Item>
            <Item disabled={!live} onSelect={() => setTile("Activity")}>Activity log</Item>
          </>
        ))}
        {menu("Help", <Item onSelect={() => setShortcuts(true)}>Keyboard shortcuts</Item>)}
      </div>
      <input
        ref={importer}
        type="file"
        className="visually-hidden"
        accept=".zip,application/zip"
        aria-label="Choose export zip"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) props.onImport(file);
        }}
      />
      {shortcuts ? <ShortcutsDialog onClose={() => setShortcuts(false)} /> : null}
      {creating ? <NewSetDialog onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); props.onOpenSet(id); }} /> : null}
    </div>
  );
}

function TransportGroup({ store }: { store: EditorStore | null }) {
  const playing = store?.transport.isPlaying() ?? false;
  return (
    <div role="group" aria-label="Beat transport" className="transport">
      <button type="button" className="tbtn" aria-label="Play" aria-pressed={playing} disabled={!store} onClick={() => store?.transport.play()}>
        <Play size={13} aria-hidden="true" />
      </button>
      <button type="button" className="tbtn" aria-label="Pause" disabled={!store} onClick={() => store?.transport.pause()}>
        <Pause size={13} aria-hidden="true" />
      </button>
      <button type="button" className="tbtn" aria-label="Step beat" disabled={!store} onClick={() => store?.transport.step()}>
        <SkipForward size={13} aria-hidden="true" />
      </button>
      <button type="button" className="tbtn" aria-label="Stop" disabled={!store} onClick={() => store?.transport.stop()}>
        <Square size={13} aria-hidden="true" />
      </button>
    </div>
  );
}

function AccountMenu({ props }: { props: ShellProps }) {
  const [open, setOpen] = useState(false);
  if (!props.user) {
    return <button type="button" className="account" aria-label="Welcome" onClick={props.onBooth}>Welcome</button>;
  }
  return (
    <div className="menu-wrap account-wrap">
      <span className="account-name" title={props.user.email}>{props.user.display_name}</span>
      <button type="button" className="account" aria-label="Account" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        Account
      </button>
      {open ? (
        <div role="menu" aria-label="Account" className="menu popover right" onClick={() => setOpen(false)}>
          <button type="button" role="menuitem" className="menu-item" onClick={props.onSignOut}>Sign out</button>
        </div>
      ) : null}
    </div>
  );
}

function Dock({ tile, onTile }: { tile: Tile; onTile: (tile: Tile) => void }) {
  return (
    <nav aria-label="Workbench" className="dock">
      {TILES.map((name) => {
        const Icon = DOCK_ICONS[name];
        return (
          <button key={name} type="button" className="tile" aria-current={tile === name ? "true" : undefined} onClick={() => onTile(name)}>
            <Icon size={26} strokeWidth={1.4} aria-hidden="true" />
            <span className="pt">{name}</span>
          </button>
        );
      })}
    </nav>
  );
}

function RigPanel({ props, store, tile, drawerOpen }: { props: ShellProps; store: EditorStore | null; tile: Tile; drawerOpen: boolean }) {
  const [filter, setFilter] = useState("");
  const title = !store ? "Sets" : tile === "Assets" || tile === "Shows" || tile === "Activity" ? tile : "Layers";
  const body = ((): ReactNode => {
    if (!store) return props.opening ? <p className="muted pad">Opening the set…</p> : <SetList sets={props.sets} onOpen={props.onOpenSet} filter={filter} />;
    if (tile === "Assets") return <AssetsPane store={store} filter={filter} />;
    if (tile === "Shows") return <ShowsPane store={store} />;
    if (tile === "Activity") return <ActivityPane store={store} filter={filter} />;
    return (
      <>
        <div className="tree-wrap"><LayerTree store={store} filter={filter} /></div>
        <Inspector store={store} />
      </>
    );
  })();
  const aside = useRef<HTMLElement>(null);
  const wasOpen = useRef(drawerOpen);
  useLayoutEffect(() => {
    // The drawer slides only when the Rig panel button toggles it, never when the viewport crosses the breakpoint.
    if (wasOpen.current === drawerOpen) return;
    wasOpen.current = drawerOpen;
    const element = aside.current;
    if (!element || !window.matchMedia(DRAWER_QUERY).matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const closed = { transform: "translateX(100%)", visibility: "visible" };
    const open = { transform: "none", visibility: "visible" };
    element.animate(drawerOpen ? [closed, open] : [open, closed], { duration: DRAWER_SLIDE_MS, easing: "ease" });
  }, [drawerOpen]);
  return (
    <aside ref={aside} role="complementary" aria-label="Rig panel" className="rig" data-open={drawerOpen ? "true" : "false"}>
      <div className="title-bar">{title}</div>
      <div className="search-row">
        <input type="search" className="text-input" aria-label={`Search ${title.toLowerCase()}`} placeholder="search…" value={filter} onChange={(event) => setFilter(event.target.value)} />
      </div>
      <div className="rig-body">{body}</div>
      <div className="rig-status">
        <div role="status" aria-label="Asset upload">{store?.assetStatus ?? ""}</div>
        <div role="status" aria-label="Show status">{store?.showStatus ?? ""}</div>
        <div role="status" aria-label="Export status">{store?.exportStatus ?? ""}</div>
      </div>
    </aside>
  );
}

function DockTabs({ store, tab, setTab }: { store: EditorStore | null; tab: Tab; setTab: (tab: Tab) => void }) {
  const body = ((): ReactNode => {
    if (!store) return <p className="muted pad">Open a set to edit its timeline, shaders, graph and scripts.</p>;
    if (tab === "Timeline") return <TimelinePane store={store} />;
    if (tab === "Shader editor") return <ShaderPane store={store} />;
    if (tab === "Node graph") return <GraphPane store={store} />;
    if (tab === "Script editor") return <ScriptPane store={store} />;
    return <ConsolePane store={store} />;
  })();
  return (
    <section className="timeline-dock">
      <div className="tab-strip">
        <div role="tablist" aria-label="Workbench tabs" className="tabs">
          {TABS.map((name) => (
            <button key={name} type="button" role="tab" aria-selected={tab === name} className="tab" onClick={() => setTab(name)}>{name}</button>
          ))}
        </div>
        <div role="status" aria-label="Shader compile" className="strip-status">{store?.shaderStatus ?? ""}</div>
        <div role="status" aria-label="Script status" className="strip-status">{store?.scriptStatus ?? ""}</div>
      </div>
      <div role="tabpanel" aria-label={tab} className="tab-body">{body}</div>
    </section>
  );
}

function Banners({ store }: { store: EditorStore | null }) {
  const connection = store?.offline
    ? `Connection lost. ${store.queued} ${store.queued === 1 ? "change" : "changes"} waiting to sync.`
    : "";
  const down = [
    store?.mode === "live" && store.services.storage === "unreachable" ? STORAGE_BANNER : "",
    store?.mode === "live" && store.services.collab === "unreachable" ? COLLAB_BANNER : "",
  ].filter(Boolean);
  return (
    <div className="banner-strip">
      <div role="status" aria-label="Connection" className="banner">{connection}</div>
      <div role="status" aria-label="Service status" className="banner">
        {down.map((line) => <div key={line}>{line}</div>)}
      </div>
    </div>
  );
}

function WorkspaceStage({ sets, onNew }: { sets: SetListing[]; onNew: () => void }) {
  const headline = sets.length === 0 ? "No sets yet" : "Pick a set to open";
  return (
    <div className="stage empty-stage">
      <div className="embossed" aria-hidden="true" data-text={headline} />
      <p className="empty-copy">{headline}</p>
      <button type="button" className="btn big" onClick={onNew}>New set</button>
    </div>
  );
}

export function Shell(props: ShellProps) {
  const { store } = props;
  const [tile, setTile] = useState<Tile>("Layers");
  const [tab, setTab] = useState<Tab>("Timeline");
  const [drawer, setDrawer] = useState(false);
  const [creating, setCreating] = useState(false);
  useEditor(store);

  const chooseTile = (next: Tile): void => {
    setTile(next);
    const target = TILE_TAB[next];
    if (target) setTab(target);
    else setDrawer(true);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!store || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable='true']") || target.closest('[role="dialog"], [role="alertdialog"]')) return;
      if (event.key === " " && !target.closest('button, a, [role="tab"], [role="menuitem"], [role="radio"], [role="option"], [role="checkbox"]')) {
        event.preventDefault();
        if (store.transport.isPlaying()) store.transport.pause();
        else store.transport.play();
        return;
      }
      const mode = ({ w: "move", e: "rotate", r: "scale" } as const)[event.key.toLowerCase() as "w" | "e" | "r"];
      if (mode && target.closest('[data-region="stage"], [role="tree"]')) {
        event.preventDefault();
        store.setGizmoMode(mode);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [store]);

  const notice = store?.notice ?? "";
  return (
    <div className="shell" data-drawer={drawer ? "open" : "closed"}>
      <Dock tile={tile} onTile={chooseTile} />
      <header className="menubar-row">
        <MenuBar props={props} store={store} setTile={chooseTile} setTab={setTab} />
        <TransportGroup store={store} />
        {store?.mode === "live" ? <div role="status" aria-label="Autosave" className="autosave">{store.autosave}</div> : null}
        {store ? <Presence store={store} /> : null}
        <button type="button" className="tbtn rig-toggle" aria-label="Rig panel" aria-expanded={drawer} onClick={() => setDrawer(!drawer)}>
          <PanelRight size={14} aria-hidden="true" />
          <span>Rig</span>
        </button>
        <AccountMenu props={props} />
      </header>
      <Banners store={store} />
      {store ? <StageView key={store.setId} store={store} /> : props.opening ? <div className="stage" /> : <WorkspaceStage sets={props.sets} onNew={() => setCreating(true)} />}
      <DockTabs store={store} tab={tab} setTab={setTab} />
      <RigPanel props={props} store={store} tile={tile} drawerOpen={drawer} />
      <div role="status" aria-label="Notifications" className="toast">{notice}</div>
      {store?.conflict ? <ConflictDialog store={store} conflict={store.conflict} /> : null}
      {creating ? <NewSetDialog onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); props.onOpenSet(id); }} /> : null}
      {props.overlay}
    </div>
  );
}
