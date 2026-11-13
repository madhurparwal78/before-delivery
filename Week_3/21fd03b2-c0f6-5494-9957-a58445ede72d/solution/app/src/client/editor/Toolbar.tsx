import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { EMPTY, PAGES } from "../../shared/copy";
import { AccountPill, Glyph, Menu } from "../ui";
import { Link } from "../router";
import { useStore } from "./StageHost";
import type { EditorStore, PanelName } from "./store";
import type { Me } from "../api";

const PANEL_TITLES: Array<[PanelName, string]> = [
  ["outline", "Outline"],
  ["inspector", "Inspector"],
  ["props", "Props"],
  ["assets", "Assets"],
];

interface ToolbarActions {
  openPublish: () => void;
  openShare: () => void;
  openShortcuts: () => void;
}

/** Roving tab stop: one Tab stop for the whole toolbar, arrows and Home/End move between enabled items. */
function useRoving(bar: React.RefObject<HTMLDivElement>): (event: ReactKeyboardEvent) => void {
  const items = useCallback((): HTMLElement[] => [...(bar.current?.querySelectorAll<HTMLElement>("[data-tool]") ?? [])].filter((el) => !(el as HTMLButtonElement).disabled), [bar]);
  useEffect(() => {
    const sync = (): void => {
      const all = items();
      const active = all.find((el) => el === document.activeElement) ?? all.find((el) => el.tabIndex === 0) ?? all[0];
      for (const el of bar.current?.querySelectorAll<HTMLElement>("[data-tool]") ?? []) el.tabIndex = el === active ? 0 : -1;
    };
    sync();
    const observer = new MutationObserver(sync);
    if (bar.current) observer.observe(bar.current, { subtree: true, attributes: true, attributeFilter: ["disabled"], childList: true });
    bar.current?.addEventListener("focusin", sync);
    const node = bar.current;
    return () => {
      observer.disconnect();
      node?.removeEventListener("focusin", sync);
    };
  }, [bar, items]);
  return (event) => {
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    let next = -1;
    if (event.key === "ArrowRight") next = (at + 1) % all.length;
    else if (event.key === "ArrowLeft") next = (at - 1 + all.length) % all.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = all.length - 1;
    if (next >= 0) {
      event.preventDefault();
      all[next].focus();
    }
  };
}

export function EditorToolbar({ store, me, actions }: { store: EditorStore; me: Me | null; actions: ToolbarActions }): JSX.Element {
  const state = useStore(store);
  const bar = useRef<HTMLDivElement>(null);
  const onKeyDown = useRoving(bar);
  const [windows, setWindows] = useState(false);
  const windowsAnchor = useRef<HTMLButtonElement>(null);
  const running = state.mode === "run";
  const owner = state.role === "owner";
  const chip = (pressed: boolean): string => `chip${pressed ? " on" : ""}`;
  const viewOnly = state.role === "viewer";
  return (
    <div className="toolbar editor-toolbar" role="toolbar" aria-label="Bench tools" ref={bar} onKeyDown={onKeyDown}>
      <button type="button" data-tool className={`chip run${running ? " go" : ""}`} onClick={() => (running ? store.stopRun() : store.startRun())} disabled={!state.webgl && !running}>
        {running ? "Stop" : "Run"}
      </button>
      <button type="button" data-tool className="chip" disabled={!running} onClick={() => store.togglePause()}>
        {state.paused ? "Resume" : "Pause"}
      </button>
      <button type="button" data-tool className="chip" disabled={!running} onClick={() => store.stepOnce()}>
        Step
      </button>
      <span className="divider" aria-hidden="true" />
      {(["move", "rotate", "scale"] as const).map((tool) => (
        <button key={tool} type="button" data-tool className={chip(state.tool === tool)} aria-pressed={state.tool === tool} onClick={() => store.setTool(tool)}>
          {tool === "move" ? "Move" : tool === "rotate" ? "Rotate" : "Scale"}
        </button>
      ))}
      <span className="divider" aria-hidden="true" />
      <button type="button" data-tool className={chip(state.snap)} aria-pressed={state.snap} onClick={() => store.toggleSnap()}>
        Snap
      </button>
      <button type="button" data-tool className={chip(state.grid)} aria-pressed={state.grid} onClick={() => store.toggleGrid()}>
        Grid
      </button>
      <button type="button" data-tool className={chip(state.colliders)} aria-pressed={state.colliders} onClick={() => store.toggleColliders()}>
        Colliders
      </button>
      <span className="divider" aria-hidden="true" />
      <Link href={`/w/${state.workspace.id}/p/${state.projectId}`} data-tool className="chip lilac">
        Labs
      </Link>
      <button type="button" data-tool className="chip lilac" aria-pressed={state.panels.assets.open} onClick={() => store.setPanel("assets", { open: !state.panels.assets.open })}>
        Assets
      </button>
      <button type="button" data-tool className="chip" disabled={!owner} aria-describedby={owner ? undefined : "owner-only-note"} onClick={actions.openShare} aria-haspopup="dialog">
        {owner ? null : <Glyph name="lock" size={12} />}
        Share
      </button>
      <button type="button" data-tool className="chip lilac publish" disabled={!owner} aria-describedby={owner ? undefined : "owner-only-note"} onClick={actions.openPublish} aria-haspopup="dialog">
        {owner ? null : <Glyph name="lock" size={12} />}
        Publish
      </button>
      <span id="owner-only-note" className="sr-only">
        {PAGES.ownerOnly}
      </span>
      <button ref={windowsAnchor} type="button" data-tool className="chip" aria-haspopup="menu" aria-expanded={windows} onClick={() => setWindows((w) => !w)}>
        Windows
      </button>
      {windows ? (
        <Menu anchor={windowsAnchor} label="Windows" onClose={() => setWindows(false)}>
          {PANEL_TITLES.map(([name, title]) => (
            <button
              key={name}
              type="button"
              role="menuitemcheckbox"
              aria-checked={state.panels[name].open}
              className="menu-item"
              onClick={() => {
                store.setPanel(name, { open: !state.panels[name].open });
                setWindows(false);
              }}
            >
              {title}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              store.resetLayout();
              setWindows(false);
            }}
          >
            Reset layout
          </button>
        </Menu>
      ) : null}
      <button type="button" data-tool className="chip" aria-haspopup="dialog" onClick={actions.openShortcuts}>
        Shortcuts
      </button>
      <span className="divider" aria-hidden="true" />
      {viewOnly ? (
        <span role="status" aria-label="View only" className="pill view-only">
          View only
        </span>
      ) : null}
      <ul className="people" aria-label="People here">
        {state.services.locks === "down" ? (
          <li className="muted">{EMPTY.presenceDown}</li>
        ) : (
          state.people.map((p) => (
            <li key={p.userId}>
              <span className="avatar small" aria-hidden="true">
                {p.displayName.slice(0, 1).toUpperCase()}
              </span>
              {p.displayName}
            </li>
          ))
        )}
      </ul>
      {me ? <AccountPill me={me} workspaceId={state.workspace.id} roving /> : null}
      <span className="spacer" />
      <span className="wordmark">Rampwright</span>
    </div>
  );
}
