import { useRef, useState } from "preact/hooks";
import { api } from "../api";
import { useLive, useMount } from "../hooks";
import { Icon } from "../icons";
import { indentParent, orderTasks, SAVE_FAILED, withIndent, withOutdent, type Bundle, type ProjectData } from "../project-data";
import { announce, openModal, toast } from "../store";
import type { Field, FieldValue, Task } from "../types";
import { Pill, Status } from "../ui";
import { AddFieldDialog, ConfirmDelete, EditFieldDialog, FormulaDialog, SetOptionsDialog } from "./dialogs";
import { FormulaCell } from "./FormulaCell";
import { TraceLine } from "./TraceLine";

export interface FocusRequest { nonce: number; target: { row?: string; add?: boolean; section?: string; field?: string; addField?: boolean } }

interface Props {
  data: ProjectData;
  bundle: Bundle;
  onOpen: (task: Task) => void;
  focusRequest: FocusRequest | null;
  afterDelete: (kind: "section" | "field", request: FocusRequest["target"]) => void;
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

function cellText(task: Task, field: Field): string {
  const value = task.values[field.name];
  if (value === null || value === undefined || value === "") return "";
  return Array.isArray(value) ? value.join(", ") : String(value);
}

export function ListView({ data, bundle, onOpen, focusRequest, afterDelete }: Props) {
  const { project, tasks } = bundle;
  const [selected, setSelected] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; col: number } | null>(null);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [current, setCurrent] = useState<{ id: string; col: number }>({ id: "", col: 0 });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [addErrors, setAddErrors] = useState<Record<string, string>>({});
  const grid = useRef<HTMLDivElement>(null);
  const traceBox = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<{ id: string; col: number } | null>(null);
  const addQueue = useRef(new Map<string, Promise<unknown>>());
  const customFields = project.fields;
  const columns = ["Name", "Assignee", "Due", "Effort", ...customFields.map((f) => f.name)];
  const ordered = orderTasks(tasks, project.sections);
  const members = new Map(project.members.map((m) => [m.id, m.name]));
  const visibleRows = ordered.filter((t) => !collapsed.includes(t.section));
  const firstId = visibleRows[0]?.id ?? "";

  /* focus bookkeeping: put focus back when a re-render dropped it, and honour requests from the page */
  useMount(() => {
    const el = grid.current;
    if (!el) return;
    const active = document.activeElement;
    if ((!active || active === document.body) && lastFocus.current) focusCell(lastFocus.current.id, lastFocus.current.col);
  });
  useMount(() => {
    if (!focusRequest) return;
    const { target } = focusRequest;
    const root = grid.current ?? document;
    const find = (selector: string) => root.querySelector<HTMLElement>(selector);
    const el = target.row ? find(`[data-open-id="${target.row}"]`) : target.section ? find(`[data-section-button="${target.section}"]`)
      : target.field ? find(`[data-field-button="${target.field}"]`) : target.addField ? find(".add-field-button") : find(".add-task-input");
    el?.focus();
  }, [focusRequest?.nonce]);

  function focusCell(id: string, col: number): void {
    const el = grid.current?.querySelector<HTMLElement>(`[data-task="${id}"] [data-nav-col="${col}"]`)
      ?? grid.current?.querySelector<HTMLElement>(`[data-task="${id}"] [data-nav-col]`);
    el?.focus();
  }

  useLive((event) => {
    if (event.t === "repeat" && event.project === project.id) announce("List status", event.text as string);
  });

  const track = (id: string, col: number) => {
    lastFocus.current = { id, col };
    setCurrent({ id, col });
  };

  /* ------------------------------------------------------------ keyboard */

  const rowElements = (): HTMLElement[] => [...(grid.current?.querySelectorAll<HTMLElement>("[data-nav-row]") ?? [])];

  const move = (event: KeyboardEvent, rowDelta: number, colDelta: number, extend: boolean) => {
    const rowEl = (event.target as HTMLElement).closest<HTMLElement>("[data-nav-row]");
    if (!rowEl) return;
    const rows = rowElements();
    const at = rows.indexOf(rowEl);
    const stop = (event.target as HTMLElement).closest<HTMLElement>("[data-nav-col]");
    const col = Number(stop?.dataset.navCol ?? 0);
    const nextRow = rows[Math.max(0, Math.min(rows.length - 1, at + rowDelta))];
    const stops = [...nextRow.querySelectorAll<HTMLElement>("[data-nav-col]")];
    const target = stops.find((s) => Number(s.dataset.navCol) === Math.max(0, col + colDelta)) ?? stops[stops.length - 1];
    if (!target) return;
    event.preventDefault();
    target.focus();
    const id = nextRow.dataset.task;
    if (extend && id) {
      const fromId = anchor ?? rowEl.dataset.task!;
      const ids = visibleRows.map((t) => t.id);
      const [a, b] = [ids.indexOf(fromId), ids.indexOf(id)].sort((x, y) => x - y);
      const range = ids.slice(a, b + 1);
      setAnchor(fromId);
      setSelected(range);
      announce("List status", `${plural(range.length, "task")} selected`);
    } else {
      setAnchor(null);
      setSelected([]);
    }
  };

  const toggleComplete = (task: Task) => {
    const completed = !task.completed;
    void data.save(task.id, { completed }, (all) => all.map((t) => (t.id === task.id ? { ...t, completed } : t)));
    announce("List status", `${task.name} marked ${completed ? "complete" : "not complete"}`);
  };

  const indent = (task: Task) => {
    const parent = indentParent(tasks, task.id);
    if (!parent) return announce("List status", `Can't indent ${task.name}`);
    void data.save(task.id, { parentId: parent.id }, (all) => withIndent(all, task.id, parent));
    announce("List status", `${task.name} is now a subtask of ${parent.name}`);
  };

  const outdent = (task: Task) => {
    if (!task.parentId) return announce("List status", `Can't outdent ${task.name}`);
    void data.save(task.id, { parentId: null }, (all) => withOutdent(all, task.id));
    announce("List status", `${task.name} is no longer a subtask`);
  };

  const keydown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    const rowEl = target.closest<HTMLElement>("[data-task]");
    const task = rowEl ? tasks.find((t) => t.id === rowEl.dataset.task) : undefined;
    const typing = target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
    if (task && event.ctrlKey && event.key === "]") {
      event.preventDefault();
      indent(task);
    } else if (task && event.ctrlKey && event.key === "[") {
      event.preventDefault();
      outdent(task);
    } else if (task && event.ctrlKey && event.key === "Enter") {
      event.preventDefault();
      toggleComplete(task);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (target instanceof HTMLSelectElement) return;
      move(event, event.key === "ArrowDown" ? 1 : -1, 0, event.shiftKey && !!task);
    } else if (!typing && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
      if (target.closest("[data-nav-col]") && !target.closest(".add-row")) move(event, 0, event.key === "ArrowRight" ? 1 : -1, false);
    } else if (!typing && event.key === "Enter" && task && target.dataset.navCol && target.dataset.navCol !== "0") {
      event.preventDefault();
      setEditing({ id: task.id, col: Number(target.dataset.navCol) });
    }
  };

  /* ------------------------------------------------------------ saving */

  const commit = (task: Task, col: number, raw: string) => {
    setEditing(null);
    focusSoon(task.id, col);
    const text = raw.trim();
    let patch: Record<string, unknown>;
    let local: Partial<Task> = {};
    if (col === 1) {
      patch = { assigneeId: text === "" ? null : text };
      local = { assigneeId: text === "" ? null : text };
    } else if (col === 2) {
      patch = { due: text === "" ? null : text };
      local = { due: text === "" ? null : text };
    } else if (col === 3) {
      const effort = text === "" ? null : Number(text);
      if (effort !== null && Number.isNaN(effort)) return toast(SAVE_FAILED);
      patch = { effort };
      local = { effort };
    } else {
      const field = customFields[col - 4];
      const value: FieldValue = text === "" ? null : field.type === "number" ? Number(text) : text;
      if (typeof value === "number" && Number.isNaN(value)) return toast(SAVE_FAILED);
      patch = { values: { [field.name]: value } };
      local = { values: { ...task.values, [field.name]: value } };
    }
    void data.save(task.id, patch, (all) => all.map((t) => (t.id === task.id ? { ...t, ...local } : t))).then((result) => {
      if (result?.ok) toast("Saved");
    });
  };

  const focusSoon = (id: string, col: number) => queueMicrotask(() => queueMicrotask(() => focusCell(id, col)));

  const addTask = (sectionId: string) => {
    const name = (drafts[sectionId] ?? "").trim();
    if (!name) {
      setAddErrors({ ...addErrors, [sectionId]: "Enter a task name" });
      return;
    }
    setAddErrors({ ...addErrors, [sectionId]: "" });
    setDrafts({ ...drafts, [sectionId]: "" });
    const run = async () => {
      const result = await api<Task>("POST", `/api/projects/${project.id}/tasks`, { name, section: sectionId });
      if (result.ok) data.setTasks((all) => (all.some((t) => t.id === result.data.id) ? all : [...all, { ...result.data, blocks: [] }]));
      else toast(SAVE_FAILED);
    };
    const chain = (addQueue.current.get(sectionId) ?? Promise.resolve()).then(run, run);
    addQueue.current.set(sectionId, chain);
  };

  /* ------------------------------------------------------------ dialogs */

  const deleteField = (field: Field) => {
    const index = customFields.findIndex((f) => f.id === field.id);
    const next = customFields[index + 1] ?? customFields[index - 1];
    openModal((close) => (
      <ConfirmDelete name={field.name} close={close} onConfirm={async () => {
        const result = await api("DELETE", `/api/fields/${field.id}`);
        if (!result.ok) return void toast(SAVE_FAILED);
        data.setBundle((b) => ({ ...b, project: { ...b.project, fields: b.project.fields.filter((f) => f.id !== field.id) } }));
        announce("List status", "Field deleted");
        return () => afterDelete("field", next ? { field: next.id } : { addField: true });
      }} />
    ));
  };

  const deleteSection = (sectionId: string) => {
    const index = project.sections.findIndex((s) => s.id === sectionId);
    const section = project.sections[index];
    const next = project.sections[index + 1] ?? project.sections[index - 1];
    openModal((close) => (
      <ConfirmDelete name={section.name} close={close} onConfirm={async () => {
        const result = await api("DELETE", `/api/sections/${sectionId}`);
        if (!result.ok) return void toast(SAVE_FAILED);
        data.setBundle((b) => ({
          project: { ...b.project, sections: b.project.sections.filter((s) => s.id !== sectionId) },
          tasks: b.tasks.filter((t) => t.section !== sectionId),
        }));
        announce("List status", "Section deleted");
        return () => afterDelete("section", { section: next.id });
      }} />
    ));
  };

  const addSection = () => {
    openModal((close) => <AddSectionDialog projectId={project.id} close={close} />);
  };

  const setOptions = (field: Field) => {
    const chosenSets = tasks.filter((t) => selected.includes(t.id)).map((t) => (Array.isArray(t.values[field.name]) ? (t.values[field.name] as string[]) : []));
    const shared = field.options.filter((o) => chosenSets.every((s) => s.includes(o)));
    openModal((close) => (
      <SetOptionsDialog field={field} selectedValues={shared} close={close} onApply={(chosen) => {
        for (const id of selected) {
          void data.save(id, { values: { [field.name]: chosen } }, (all) => all.map((t) => (t.id === id ? { ...t, values: { ...t.values, [field.name]: chosen } } : t)));
        }
        announce("List status", `${field.name} set on ${plural(selected.length, "task")}`);
      }} />
    ));
  };

  /* ------------------------------------------------------------ rendering */

  const multi = customFields.filter((f) => f.type === "multi_select");
  const rowFor = (task: Task) => {
    const level = task.parentId ? 2 : 1;
    const isSelected = selected.includes(task.id);
    const isCurrent = current.id ? current.id === task.id : task.id === firstId;
    return (
      <div role="row" key={task.id} data-task={task.id} data-nav-row aria-level={level === 2 ? 2 : undefined} aria-selected={isSelected}
        class={`g-row g-task${task.completed ? " is-done" : ""}${isSelected ? " is-selected" : ""}${level === 2 ? " is-sub" : ""}`}>
        <div role="gridcell" class="g-cell g-name" style={{ paddingLeft: level === 2 ? "32px" : undefined }}>
          <button type="button" class="check-button" tabIndex={-1} aria-label={`Mark ${task.name} ${task.completed ? "not complete" : "complete"}`}
            aria-pressed={task.completed} onClick={() => toggleComplete(task)}>
            {task.completed && <Icon name="check" size={16} />}
          </button>
          <button type="button" class="open-button" data-nav-col="0" data-open-id={task.id} aria-label={`Open ${task.name}`}
            tabIndex={isCurrent && current.col === 0 ? 0 : -1} onFocus={() => track(task.id, 0)} onClick={() => onOpen(task)}>
            {task.name}
          </button>
        </div>
        {columns.slice(1).map((name, index) => {
          const col = index + 1;
          const field = customFields[col - 4];
          const isEditing = editing?.id === task.id && editing.col === col;
          const readOnly = field?.type === "formula" || field?.type === "multi_select";
          const common = { "data-nav-col": col, tabIndex: isCurrent && current.col === col ? 0 : -1, onFocus: () => track(task.id, col) };
          if (field?.type === "formula") {
            return <FormulaCell key={name} field={field} value={task.values[field.name] ?? null} navProps={common} />;
          }
          const text = col === 1 ? (task.assigneeId ? members.get(task.assigneeId) ?? "" : "") : col === 2 ? task.due ?? "" : col === 3 ? (task.effort === null ? "" : String(task.effort)) : cellText(task, field);
          return (
            <div role="gridcell" key={name} class={`g-cell g-${col <= 3 ? ["", "assignee", "due", "effort"][col] : "value"}`} data-label={name}
              aria-readonly={readOnly ? "true" : undefined} {...(isEditing ? { "data-nav-col": col } : common)}>
              {isEditing ? (
                <CellEditor task={task} col={col} field={field} text={text} members={project.members}
                  onCommit={(value) => commit(task, col, value)} onCancel={() => { setEditing(null); focusSoon(task.id, col); }} />
              ) : field?.type === "multi_select" ? (
                <span class="tag-list">{(Array.isArray(task.values[field.name]) ? (task.values[field.name] as string[]) : []).map((tag) => <span class="tag" key={tag}>{tag}</span>)}</span>
              ) : (
                <span class={col === 2 || col === 3 ? "num" : ""}>{text}</span>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div class="list-view">
      <div class="list-toolbar">
        {multi.map((field) => (
          <Pill key={field.id} kind="outline" disabled={selected.length === 0} onClick={() => setOptions(field)}>{`Set ${field.name} for selection`}</Pill>
        ))}
        <Pill kind="outline" onClick={addSection}><Icon name="plus" size={16} />Add section</Pill>
      </div>
      <Status name="List status" />
      <div class="trace-wrap" ref={traceBox}>
      <div class="grid-scroll">
        <div role="grid" aria-label="Tasks" ref={grid} class="task-grid" style={{ "--field-cols": customFields.map(() => "170px").join(" ") }} onKeyDown={keydown}>
          <div role="row" class="g-row g-head">
            {columns.slice(0, 4).map((name) => <div role="columnheader" class="g-cell" key={name}>{name}</div>)}
            {customFields.map((field) => (
              <div role="columnheader" class="g-cell g-field-head" key={field.id}>
                <button type="button" class="head-button" data-field-button={field.id}
                  aria-label={field.type === "formula" ? `Edit formula for ${field.name}` : `Edit field ${field.name}`}
                  onClick={() => openModal((close) => field.type === "formula"
                    ? <FormulaDialog field={field} fields={customFields} close={close} />
                    : <EditFieldDialog field={field} close={close} />)}>
                  {field.name}
                </button>
                <button type="button" class="icon-button" aria-label="Delete field" onClick={() => deleteField(field)}><Icon name="trash" size={16} /></button>
              </div>
            ))}
            <div role="columnheader" class="g-cell g-add-field">
              <button type="button" class="head-button add-field-button" onClick={() => openModal((close) => <AddFieldDialog projectId={project.id} close={close} />)}>
                <Icon name="plus" size={16} />Add field
              </button>
            </div>
          </div>
          {project.sections.map((section) => {
            const here = ordered.filter((t) => t.section === section.id);
            const isCollapsed = collapsed.includes(section.id);
            return (
              <div role="rowgroup" key={section.id} class="g-section-group">
                <div role="row" class="g-row g-section">
                  <div role="gridcell" class="g-cell g-section-cell">
                    <button type="button" class="section-toggle" data-section-button={section.id} aria-expanded={!isCollapsed}
                      onClick={() => setCollapsed(isCollapsed ? collapsed.filter((c) => c !== section.id) : [...collapsed, section.id])}>
                      <Icon name={isCollapsed ? "chevron-right" : "chevron-down"} size={16} />{section.name}
                    </button>
                    <span class="muted num">{here.filter((t) => !t.parentId).length}</span>
                    <button type="button" class="icon-button" aria-label="Delete section" disabled={project.sections.length === 1}
                      onClick={() => deleteSection(section.id)}><Icon name="trash" size={16} /></button>
                  </div>
                </div>
                {!isCollapsed && here.map(rowFor)}
                {!isCollapsed && (
                  <div role="row" class="g-row g-add add-row" data-nav-row>
                    <div role="gridcell" class="g-cell g-name">
                      <input class="add-task-input" data-nav-col="0" aria-label="Add task" placeholder="Add task" value={drafts[section.id] ?? ""}
                        aria-invalid={addErrors[section.id] ? "true" : undefined} aria-describedby={addErrors[section.id] ? `add-error-${section.id}` : undefined}
                        onInput={(e) => setDrafts({ ...drafts, [section.id]: (e.target as HTMLInputElement).value })}
                        onKeyDown={(e) => { if (e.key === "Enter" && !e.ctrlKey) { e.preventDefault(); addTask(section.id); } }} />
                      {addErrors[section.id] && <span id={`add-error-${section.id}`} class="field-error">{addErrors[section.id]}</span>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <TraceLine ids={project.trace.filter((id) => visibleRows.some((t) => t.id === id))} container={traceBox} mode="list" />
      </div>
      {tasks.length === 0 && <p class="muted">No tasks yet. Type a name in an Add task row and press Enter.</p>}
    </div>
  );
}

function CellEditor({ task, col, field, text, members, onCommit, onCancel }: {
  task: Task; col: number; field: Field | undefined; text: string; members: Array<{ id: string; name: string }>;
  onCommit: (value: string) => void; onCancel: () => void;
}) {
  const [value, setValue] = useState(col === 1 ? task.assigneeId ?? "" : text);
  const done = useRef(false);
  const ref = useRef<HTMLInputElement & HTMLSelectElement>(null);
  useMount(() => ref.current?.focus(), []);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) onCommit(value);
    else onCancel();
  };
  const label = `${["Name", "Assignee", "Due", "Effort"][col] ?? field?.name} for ${task.name}`;
  const select = col === 1 || field?.type === "single_select";
  if (select) {
    const options = col === 1 ? members.map((m) => [m.id, m.name]) : (field?.options ?? []).map((o) => [o, o]);
    return (
      <select ref={ref} aria-label={label} value={value} onChange={(e) => { done.current = true; onCommit((e.target as HTMLSelectElement).value); }}
        onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); finish(false); } }} onBlur={() => finish(false)}>
        <option value="">{col === 1 ? "Unassigned" : "None"}</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    );
  }
  return (
    <input ref={ref} aria-label={label} value={value} inputMode={col === 3 || field?.type === "number" ? "decimal" : undefined}
      onInput={(e) => setValue((e.target as HTMLInputElement).value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); finish(true); }
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); }
      }}
      onBlur={() => finish(true)} />
  );
}

import { Dialog, FieldError, useBusy } from "../ui";
function AddSectionDialog({ projectId, close }: { projectId: string; close: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, run] = useBusy();
  const submit = (event: Event) => {
    event.preventDefault();
    void run(async () => {
      const result = await api("POST", `/api/projects/${projectId}/sections`, { name });
      setError(result.errors.name ?? "");
      if (result.ok) close();
    });
  };
  return (
    <Dialog label="Add section" onClose={close} class="dialog-small">
      <form onSubmit={submit} noValidate>
        <h2>Add section</h2>
        <div class="field">
          <label for="new-section-name">Section name</label>
          <input id="new-section-name" data-autofocus value={name} aria-invalid={error ? "true" : undefined}
            aria-describedby={error ? "new-section-error" : undefined} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          <FieldError id="new-section-error" text={error} />
        </div>
        <div class="dialog-actions">
          <Pill type="submit" busy={busy} onClick={submit}>Add section</Pill>
          <Pill kind="outline" onClick={close}>Cancel</Pill>
        </div>
      </form>
    </Dialog>
  );
}
