import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Menu as MenuIcon } from "lucide-react";
import { Brand } from "../components/Brand";
import { MenuButton } from "../components/Menu";
import type { MenuEntry } from "../components/Menu";
import { navigate } from "../router";
import { contentsOf } from "./contents";
import type { NotebookState } from "./model";
import type { NotebookStore } from "./store";

interface Props {
  store: NotebookStore;
  state: NotebookState;
  narrow: boolean;
}

function menus(store: NotebookStore, state: NotebookState): Record<string, MenuEntry[]> {
  const cmd = (work: () => Promise<void>) => () => store.command(work);
  const cursor = state.cells.find((m) => m.server.id === state.cursor);
  const leave = (path: string) => () => store.command(async () => void ((await store.flush()) && navigate(path)));
  const file: MenuEntry[] = [
    { label: "New notebook", run: leave("/notebooks?new=1") },
    { label: "Import notebook", run: leave("/notebooks?import=1") },
    { label: "Export", run: cmd(() => store.exportFile()) },
    ...(state.meta?.imported ? [{ label: "Download original", run: cmd(() => store.downloadOriginal()) }] : []),
    { label: "Save checkpoint", run: cmd(() => store.saveCheckpoint()), disabled: !store.canEdit },
  ];
  if (!store.canEdit) return { File: file.filter((entry) => ["Export", "Download original"].includes(entry.label)) };
  return {
    File: file,
    Edit: [
      { label: "Cut cells", run: cmd(() => store.cut()) },
      { label: "Copy cells", run: () => store.copy() },
      { label: "Paste cells below", run: cmd(() => store.paste()) },
      { label: "Delete cells", run: cmd(() => store.remove()) },
      { label: "Undo delete", run: cmd(() => store.undoDelete()) },
      { label: "Merge selected cells", run: cmd(() => store.merge()) },
      {
        label: "Split cell",
        run: () => {
          const box = document.querySelector<HTMLTextAreaElement>(`[data-source="${state.cursor}"]`);
          if (box && state.mode === "edit") store.command(() => store.split(box.value.slice(0, box.selectionStart).split("\n").length));
        },
        disabled: state.mode !== "edit",
      },
    ],
    Cell: [
      { label: "Run", run: cmd(() => store.run("stay")) },
      { label: "Run all", run: cmd(() => store.runAll()) },
      { label: "Change to code", run: () => store.retype("code") },
      { label: "Change to markdown", run: () => store.retype("markdown") },
      { label: "Move cell up", run: cmd(() => store.shift(-1)) },
      { label: "Move cell down", run: cmd(() => store.shift(1)) },
      { label: "Insert code cell below", run: cmd(async () => void (await store.insert("below"))), disabled: cursor === undefined },
    ],
    Kernel: [
      { label: "Interrupt kernel", run: () => store.interrupt() },
      { label: "Restart kernel", run: () => store.open({ kind: "restart" }) },
    ],
  };
}

/** The notebook's workspace header: brand, menus, title, who is here, the mode and the kernel status. */
export function NotebookHeader({ store, state, narrow }: Props): ReactNode {
  const [folded, setFolded] = useState(false);
  const all = menus(store, state);
  const owner = state.meta?.role === "owner";
  const people = [...new Map(state.present.map((p) => [p.user_id, p])).values()];
  const mode = state.meta?.role === "viewer" ? "View only" : state.mode === "edit" ? "Edit mode" : "Command mode";
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!narrow) setFolded(false);
  }, [narrow]);

  const items = (
    <>
      {Object.entries(all).map(([label, entries]) => (
        <MenuButton key={label} label={label} items={entries} caret={label === "Kernel"} />
      ))}
      {owner && (
        <button type="button" className="menu-button" onClick={() => store.open({ kind: "share" })}>
          Share
        </button>
      )}
    </>
  );

  return (
    <header className="site-header nb-header">
      <div className="header-row">
        <Brand markOnly={narrow} />
        <h1 className="nb-title">{state.meta?.title}</h1>
        <span className="header-spacer" />
        <ul className="people" aria-label="People here">
          {people.map((person) => (
            <li key={person.user_id}>{person.display_name}</li>
          ))}
        </ul>
        <span className="mode-indicator">{mode}</span>
        <span className="kernel-status">{state.reconnecting ? "Reconnecting…" : `Kernel ${state.kernel}`}</span>
        {narrow && (
          <button
            ref={toggle}
            type="button"
            className="menu-button hamburger"
            aria-label="Open menu"
            aria-expanded={folded}
            onClick={() => setFolded(!folded)}
            onKeyDown={(event) => event.key === "Escape" && (setFolded(false), toggle.current?.focus())}
          >
            <MenuIcon size={24} aria-hidden="true" />
          </button>
        )}
      </div>
      {(!narrow || folded) && (
        <nav className={narrow ? "phone-menu" : "nb-menus"} aria-label="Notebook menus" onKeyDown={(event) => event.key === "Escape" && narrow && (setFolded(false), toggle.current?.focus())}>
          {items}
        </nav>
      )}
    </header>
  );
}

/** The toolbar under the header. */
export function Toolbar({ store, state }: Omit<Props, "narrow">): ReactNode {
  const editor = store.canEdit;
  const cmd = (work: () => Promise<void>) => () => store.command(work);
  return (
    <div className="toolbar-row">
      <div role="toolbar" aria-label="Notebook actions" className="toolbar">
        {editor && <button type="button" className="btn btn-accent" onClick={cmd(() => store.run("stay"))}>Run</button>}
        {editor && <button type="button" className="btn" onClick={cmd(() => store.runAll())}>Run all</button>}
        {editor && <button type="button" className="btn" onClick={() => store.interrupt()}>Interrupt kernel</button>}
        {editor && <button type="button" className="btn" onClick={() => store.open({ kind: "restart" })}>Restart kernel</button>}
        {editor && <button type="button" className="btn btn-accent" onClick={cmd(() => store.saveCheckpoint())}>Save checkpoint</button>}
        <button type="button" className="btn" aria-expanded={state.panelOpen} onClick={cmd(() => store.togglePanel())}>Checkpoints</button>
        <button type="button" className="btn" onClick={cmd(() => store.exportFile())}>Export</button>
        {state.meta?.imported && <button type="button" className="btn" onClick={cmd(() => store.downloadOriginal())}>Download original</button>}
      </div>
      <div role="status" aria-label="Save status" aria-live="polite" className="save-status">{state.saveStatus}</div>
    </div>
  );
}

/** Announces notebook status; a repeated message is cleared first so it is announced again. */
export function Announcer({ state }: { state: NotebookState }): ReactNode {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!box.current || state.status.n === 0) return;
    box.current.textContent = "";
    box.current.textContent = state.status.text;
  }, [state.status]);
  return <div ref={box} role="status" aria-label="Notebook status" aria-live="polite" className="sr-only" />;
}

export function Outage({ state }: { state: NotebookState }): ReactNode {
  return state.outage ? (
    <div role="alert" className="outage-banner">
      Storage is unavailable. Your edits are kept in this page and will be saved when storage returns.
    </div>
  ) : null;
}

/** The table of contents navigation; activating an entry moves focus to its heading's cell. */
export function Contents({ store, state }: Omit<Props, "narrow">): ReactNode {
  const entries = contentsOf(state.cells);
  return (
    <nav aria-label="Table of contents" className="toc">
      {entries.length === 0 ? (
        <p className="muted toc-empty">No headings yet</p>
      ) : (
        <ol>
          {entries.map((entry, index) => (
            <li key={`${entry.cellId}-${index}`}>
              <a
                href={`#cell-${entry.cellId}`}
                onClick={(event) => {
                  event.preventDefault();
                  store.goToCell(entry.cellId);
                }}
              >
                {`${entry.number} ${entry.text}`}
              </a>
            </li>
          ))}
        </ol>
      )}
    </nav>
  );
}

