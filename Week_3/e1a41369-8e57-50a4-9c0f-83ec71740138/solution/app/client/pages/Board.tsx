import { Users } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Task } from "../../shared/api";
import { focusWhenPresent } from "../focus";
import { PartyPanel } from "../components/PartyPanel";
import { Sheet } from "../components/Sheet";
import { TaskDialog, type DialogTarget } from "../components/TaskDialog";
import { LISTS, TaskList, type ListName } from "../components/TaskList";
import { setState, useStore } from "../store";
import { useLayout } from "../useLayout";

const ORDER: ListName[] = ["habits", "dailies", "todos", "rewards"];

function Tabs() {
  const tab = useStore((state) => state.tab);
  const select = (name: ListName): void => {
    setState({ tab: name });
    requestAnimationFrame(() => document.getElementById(`tab-${name}`)?.focus());
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = ORDER[ORDER.indexOf(tab) + step];
    if (next) select(next);
  };
  return (
    <div className="tabs" role="tablist" aria-label="Lists" onKeyDown={onKeyDown}>
      {ORDER.map((name) => (
        <button key={name} id={`tab-${name}`} type="button" role="tab" className="tab" aria-selected={tab === name} tabIndex={tab === name ? 0 : -1} onClick={() => select(name)}>
          {LISTS[name].title}
        </button>
      ))}
    </div>
  );
}

export function Board() {
  const lists = useStore((state) => state.tasks);
  const tab = useStore((state) => state.tab);
  const layout = useLayout();
  const [dialog, setDialog] = useState<{ target: DialogTarget; key: number } | null>(null);
  const opened = useRef(0);
  const [partyOpen, setPartyOpen] = useState(false);
  const partyButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (layout === "desktop") setPartyOpen(false);
  }, [layout]);

  if (!lists) return null;
  const onAdd = (name: ListName, returnTo = `[data-add="${name}"]`): void =>
    setDialog({ target: { mode: "new", type: LISTS[name].type, returnTo }, key: ++opened.current });
  const onEdit = (task: Task): void => setDialog({ target: { mode: "edit", task }, key: ++opened.current });
  const shown = layout === "phone" ? ORDER.filter((name) => name === tab) : ORDER;
  const tone = (name: ListName): "blush" | "ink" => (layout === "phone" ? "blush" : layout === "tablet" ? ({ habits: "blush", dailies: "ink", todos: "ink", rewards: "blush" } as const)[name] : ({ habits: "blush", dailies: "ink", todos: "blush", rewards: "blush" } as const)[name]);

  return (
    <main className={`board board-${layout}`}>
      {layout === "phone" && <Tabs />}
      {layout !== "desktop" && (
        <div className="party-bar">
          <button type="button" className="btn" ref={partyButton} onClick={() => setPartyOpen(true)}>
            <Users aria-hidden="true" size={18} /> Party
          </button>
        </div>
      )}
      <div className="lists">
        {shown.map((name) => (
          <TaskList key={name} name={name} tasks={lists[name]} tone={tone(name)} onAdd={onAdd} onEdit={onEdit} />
        ))}
      </div>
      {layout === "desktop" && (
        <aside className="rail" aria-label="Party rail">
          <PartyPanel />
        </aside>
      )}
      {dialog && (
        <TaskDialog
          key={dialog.key}
          target={dialog.target}
          onClose={(focus) => {
            setDialog(null);
            focusWhenPresent(focus);
          }}
        />
      )}
      {partyOpen && (
        <Sheet
          ink
          title="Party"
          onClose={() => {
            setPartyOpen(false);
            partyButton.current?.focus();
          }}
        >
          <PartyPanel />
        </Sheet>
      )}
    </main>
  );
}
