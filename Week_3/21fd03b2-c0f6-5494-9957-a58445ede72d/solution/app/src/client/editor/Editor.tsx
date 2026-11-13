import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { BANNER } from "../../shared/copy";
import { NotFoundPage } from "../pages/screens";
import { Muted, useMe } from "../ui";
import { CommandsDialog, ConflictDialog, PublishDialog, RestoreDialog, ShareDialog, ShortcutsDialog } from "./Dialogs";
import { InspectorBody, AssetsBody, OutlineBody, PanelFrame, PropsBody, type Layout } from "./Panels";
import { CameraWidget, StageHost, TelemetryCard, reducedMotion, useStore } from "./StageHost";
import { EditorToolbar } from "./Toolbar";
import { EditorStore, type PanelName } from "./store";

function useLayout(): Layout {
  const compute = (): Layout => (window.innerWidth >= 1000 ? "floating" : window.innerWidth >= 600 ? "docked" : "phone");
  const [layout, setLayout] = useState<Layout>(compute);
  useEffect(() => {
    const onResize = (): void => setLayout(compute());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return layout;
}

function isTextEntry(target: HTMLElement): boolean {
  if (target.isContentEditable) return true;
  if (target.tagName === "TEXTAREA" || target.tagName === "SELECT") return true;
  if (target.tagName !== "INPUT") return false;
  return !["checkbox", "radio", "button", "submit", "range", "file"].includes((target as HTMLInputElement).type);
}

const PANELS: Array<[PanelName, string]> = [
  ["outline", "Outline"],
  ["inspector", "Inspector"],
  ["props", "Props"],
  ["assets", "Assets"],
];

export function EditorScreen({ wid, sid }: { wid: string; sid: string }): JSX.Element {
  const store = useMemo(() => new EditorStore(sid, wid), [sid, wid]);
  const state = useStore(store);
  const me = useMe();
  const layout = useLayout();
  const area = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [sheetTab, setSheetTab] = useState<PanelName>("outline");
  const tabs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    void store.init();
    return () => store.dispose();
  }, [store]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement;
      if (target.closest('[aria-modal="true"], [role="menu"], [role="dialog"], [role="alertdialog"]')) return;
      const key = event.key;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && key.toLowerCase() === "k") {
        event.preventDefault();
        store.openDialog("commands");
        return;
      }
      if (isTextEntry(target)) return;
      if (mod && key.toLowerCase() === "z") {
        event.preventDefault();
        void (event.shiftKey ? store.redo() : store.undo());
        return;
      }
      if (mod && key.toLowerCase() === "y") {
        event.preventDefault();
        void store.redo();
        return;
      }
      if (mod || event.altKey) return;
      if (key === "?") {
        event.preventDefault();
        store.openDialog("shortcuts");
        return;
      }
      if (key === "F2") {
        event.preventDefault();
        store.startRename(store.state.selection);
        return;
      }
      if (key === "Delete" || key === "Backspace") {
        event.preventDefault();
        store.removeSelected();
        return;
      }
      if (key === "Escape") {
        if (store.state.mode === "run") store.stopRun();
        else store.select(null);
        return;
      }
      if (event.shiftKey || key.length !== 1) return;
      switch (key.toLowerCase()) {
        case "r":
          store.state.mode === "run" ? store.stopRun() : store.startRun();
          break;
        case "p":
          store.togglePause();
          break;
        case "n":
          store.stepOnce();
          break;
        case "w":
          store.setTool("move");
          break;
        case "e":
          store.setTool("rotate");
          break;
        case "t":
          store.setTool("scale");
          break;
        case "s":
          store.toggleSnap();
          break;
        case "g":
          store.toggleGrid();
          break;
        case "f":
          if (store.state.selection) store.stage?.frameObject(store.state.selection);
          break;
        default:
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);

  const onNudge = (event: ReactKeyboardEvent): void => {
    if (store.state.mode === "run") return;
    const map: Record<string, ["x" | "y" | "z", 1 | -1]> = {
      ArrowLeft: ["x", -1],
      ArrowRight: ["x", 1],
      ArrowUp: ["z", -1],
      ArrowDown: ["z", 1],
      PageUp: ["y", 1],
      PageDown: ["y", -1],
    };
    const step = map[event.key];
    if (!step) return;
    event.preventDefault();
    store.nudge(step[0], step[1], event.shiftKey);
  };

  if (state.phase === "missing") return <NotFoundPage />;
  if (state.phase === "loading") return <Muted>Loading...</Muted>;

  const running = state.mode === "run";
  const bodies: Record<PanelName, JSX.Element> = {
    outline: <OutlineBody store={store} state={state} onAdd={() => store.setPanel("props", { open: true })} />,
    inspector: <InspectorBody store={store} state={state} />,
    props: <PropsBody store={store} state={state} />,
    assets: <AssetsBody store={store} state={state} />,
  };
  const frame = (name: PanelName, title: string): JSX.Element => (
    <PanelFrame key={name} store={store} state={state} name={name} title={title} layout={layout} area={area} collapsed={layout === "docked" ? collapsed[name] : undefined} onToggle={() => setCollapsed({ ...collapsed, [name]: !collapsed[name] })}>
      {bodies[name]}
    </PanelFrame>
  );
  const onSheetKey = (event: ReactKeyboardEvent): void => {
    const order = PANELS.map(([name]) => name);
    const at = order.indexOf(sheetTab);
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const next = order[(at + (event.key === "ArrowRight" ? 1 : -1) + order.length) % order.length];
      setSheetTab(next);
      tabs.current[next]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      tabs.current[sheetTab]?.focus();
    }
  };

  return (
    <div className={`editor layout-${layout}${running ? " running" : ""}`}>
      <EditorToolbar store={store} me={me} actions={{ openPublish: () => store.openDialog("publish"), openShare: () => store.openDialog("share"), openShortcuts: () => store.openDialog("shortcuts") }} />
      {state.services.locks === "down" ? (
        <div role="alert" className="banner">
          {BANNER.locks}
        </div>
      ) : null}
      {state.services.storage === "down" ? (
        <div role="alert" className="banner">
          {BANNER.storage}
        </div>
      ) : null}
      <div className="workarea">
        <div className="stage-area" ref={area}>
          <StageHost store={store} onNudge={onNudge} />
          <TelemetryCard store={store} />
          {!running ? <CameraWidget store={store} /> : null}
          {running ? (
            <div role="status" aria-label="Mode" className="mode-pill">
              {state.paused ? "PAUSED" : "RUNNING"}
            </div>
          ) : null}
          <div className="status-strip">
            <div role="status" aria-label="Save status">
              {store.displayedSave()}
            </div>
            <div role="status" aria-label="Collaboration">
              {state.collab}
            </div>
          </div>
          {layout === "floating" ? PANELS.map(([name, title]) => frame(name, title)) : null}
        </div>
        {layout === "docked" ? (
          <div className="dock-column" hidden={running}>
            {PANELS.map(([name, title]) => frame(name, title))}
          </div>
        ) : null}
      </div>
      {layout === "phone" ? (
        <div className="sheet" hidden={running} onKeyDown={onSheetKey}>
          <div role="tablist" aria-label="Panels" className="tabs">
            {PANELS.map(([name, title]) => (
              <button
                key={name}
                ref={(el) => {
                  tabs.current[name] = el;
                }}
                type="button"
                role="tab"
                aria-selected={sheetTab === name}
                tabIndex={sheetTab === name ? 0 : -1}
                className={`tab${sheetTab === name ? " on" : ""}`}
                onClick={() => setSheetTab(name)}
              >
                {title}
              </button>
            ))}
          </div>
          {PANELS.filter(([name]) => name === sheetTab).map(([name, title]) => frame(name, title))}
        </div>
      ) : null}
      {running ? (
        <svg className="centre-mark" role="img" aria-label="Centre mark" width="14" height="14" viewBox="0 0 14 14">
          <path d="M7 0V14M0 7H14" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      ) : null}
      {state.dialog === "commands" ? <CommandsDialog store={store} /> : null}
      {state.dialog === "shortcuts" ? <ShortcutsDialog store={store} /> : null}
      {state.dialog === "publish" ? <PublishDialog store={store} /> : null}
      {state.dialog === "share" ? <ShareDialog store={store} /> : null}
      {state.dialog === "restore" ? <RestoreDialog store={store} /> : null}
      {state.conflict ? <ConflictDialog store={store} /> : null}
    </div>
  );
}
