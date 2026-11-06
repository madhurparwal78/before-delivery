// The command palette: type to filter, Up and Down to choose, Enter to run, Escape to close.
// Task commands apply to the selection, or to the current row when nothing is selected.

import { useRef, useState, type KeyboardEvent } from "react";
import { CREW, DEPARTMENTS, PRIORITY_NAMES, STATUS_NAMES, type StatusKey } from "../../../shared/catalog";
import { bulkSet, closePalette, navigate, openDialog, state, undoLast, useApp } from "../store";
import { DEFAULT_VIEW, type Grouping } from "../url";
import { Modal, type ModalHandle } from "./Modal";
import { commandTargets } from "./Tasks";

interface Command {
  label: string;
  onTasks?: (ids: string[]) => void;
  run?: () => void;
  // Commands that open another dialog wait until the palette has closed.
  opensDialog?: boolean;
}

const MOVES: StatusKey[] = ["backlog", "todo", "in_progress", "done", "cancelled"];
const GROUPS: Array<[Grouping, string]> = [
  ["status", "Status"],
  ["cycle", "Cycle"],
  ["department", "Department"],
  ["owner", "Owner"],
];

const commands = (opener: Element | null): Command[] => [
  ...CREW.map((m) => ({ label: `Assign to ${m.name}`, onTasks: (ids: string[]) => void bulkSet(ids, { owner: m.handle }) })),
  { label: "Unassign", onTasks: (ids) => void bulkSet(ids, { owner: null }) },
  ...PRIORITY_NAMES.map((name, i) => ({ label: `Set priority: ${name}`, onTasks: (ids: string[]) => void bulkSet(ids, { priority: i }) })),
  ...MOVES.map((s) => ({ label: `Move to ${STATUS_NAMES[s]}`, onTasks: (ids: string[]) => void bulkSet(ids, { status: s }) })),
  { label: "Undo last change", run: () => void undoLast() },
  { label: "New task", opensDialog: true, run: () => openDialog({ kind: "new-task", parent: null, opener }) },
  { label: "File a request", opensDialog: true, run: () => openDialog({ kind: "file-request", opener }) },
  { label: "Go to All tasks", run: () => navigate("/tasks", { ...state.view, dept: null, row: null, task: null }) },
  { label: "Go to Triage", run: () => navigate("/triage") },
  { label: "Go to Requests", run: () => navigate("/requests") },
  ...DEPARTMENTS.map((d) => ({
    label: `Go to ${d.name}`,
    run: () => navigate("/tasks", { ...(state.path === "/tasks" ? state.view : DEFAULT_VIEW), dept: d.key, row: null, task: null }),
  })),
  ...GROUPS.map(([group, name]) => ({ label: `Group by ${name}`, run: () => navigate("/tasks", { group }) })),
  { label: "Show blocked only", run: () => navigate("/tasks", { blocked: true }) },
  { label: "Show all", run: () => navigate("/tasks", { blocked: false }) },
  { label: "List view", run: () => navigate("/tasks", { view: "list" }) },
  { label: "Board view", run: () => navigate("/tasks", { view: "board" }) },
];

export const Palette = () => {
  const app = useApp();
  const modal = useRef<ModalHandle>(null);
  const opener = app.palette?.opener ?? null;
  const [query, setQuery] = useState(app.palette?.prefix ?? "");
  const [active, setActive] = useState(0);
  const after = useRef<Command | null>(null);
  const targets = app.path === "/tasks" ? commandTargets() : [];
  const visible = commands(opener).filter(
    (c) => (!c.onTasks || targets.length > 0) && c.label.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const chosen = Math.min(active, Math.max(0, visible.length - 1));

  const runCommand = (command: Command | undefined): void => {
    if (!command) return;
    if (command.onTasks) command.onTasks(targets);
    else if (command.opensDialog) after.current = command;
    else command.run?.();
    modal.current?.close();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((chosen + step + visible.length) % Math.max(1, visible.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runCommand(visible[chosen]);
    }
  };

  return (
    <Modal
      ref={modal}
      label="Command palette"
      variant="palette"
      opener={opener}
      onClosed={() => {
        closePalette();
        after.current?.run?.();
      }}
    >
      <div className="palette">
        <input
          className="palette-input"
          type="text"
          role="combobox"
          aria-label="Command"
          aria-expanded="true"
          aria-controls="palette-commands"
          aria-autocomplete="list"
          aria-activedescendant={visible.length ? `command-${chosen}` : undefined}
          value={query}
          placeholder="Type a command"
          data-autofocus
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
        />
        <ul className="palette-list" id="palette-commands" role="listbox" aria-label="Commands">
          {visible.map((c, i) => (
            <li
              key={c.label}
              id={`command-${i}`}
              role="option"
              aria-selected={i === chosen}
              className={i === chosen ? "is-active" : undefined}
              onMouseMove={() => setActive(i)}
              onClick={() => runCommand(c)}
            >
              {c.label}
            </li>
          ))}
        </ul>
        {visible.length ? null : <p className="muted palette-empty">No command matches.</p>}
        {targets.length > 1 ? <p className="palette-note num">{`Applies to ${targets.length} selected tasks`}</p> : null}
      </div>
    </Modal>
  );
};
