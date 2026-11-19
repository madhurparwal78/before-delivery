import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { fieldSpec, pathExists, referencePaths, TABLE_FIELDS, type FieldSpec } from "../../../shared/fields.js";
import { parseFilter, type Builder, type FilterOperator, type FilterValue } from "../../../shared/filtertext.js";
import type { Table } from "../../../shared/types.js";
import { useAnnounce } from "../../lib/announce.js";
import { failureText, post } from "../../lib/api.js";
import { Modal } from "../../lib/dialog.js";
import { Button } from "../../lib/ui.js";

interface Row {
  id: number;
  path: string;
  op: FilterOperator;
  valueText: string;
}

interface Group {
  id: number;
  connector: "and" | "or";
  rows: Row[];
}

interface Draft {
  connector: "and" | "or";
  groups: Group[];
}

const OPERATORS: Array<{ op: FilterOperator; label: string }> = [
  { op: "=", label: "=" },
  { op: "!=", label: "!=" },
  { op: "<", label: "<" },
  { op: "<=", label: "<=" },
  { op: ">", label: ">" },
  { op: ">=", label: ">=" },
  { op: "contains", label: "contains" },
  { op: "startswith", label: "startswith" },
  { op: "in", label: "in" },
  { op: "is_empty", label: "is empty" },
  { op: "not_is_empty", label: "is not empty" },
];

let nextId = 1;

const blankRow = (): Row => ({ id: nextId++, path: "", op: "=", valueText: "" });
const blankGroup = (): Group => ({ id: nextId++, connector: "and", rows: [blankRow()] });

const isEmptyOp = (op: FilterOperator): boolean => op === "is_empty" || op === "not_is_empty";

/** A connector with nothing to join is `and`: one group, or a group with one condition, shows All groups or All conditions. */
function withJoiningConnectors(draft: Draft): Draft {
  return {
    connector: draft.groups.filter((g) => g.rows.length > 0).length > 1 ? draft.connector : "and",
    groups: draft.groups.map((g) => (g.rows.length > 1 ? g : { ...g, connector: "and" })),
  };
}

/** A value as the person reads and types it: strings bare unless they would be read as something else. */
function valueToText(value: FilterValue): string {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return `[${value.map((item) => (typeof item === "string" ? JSON.stringify(item) : String(item))).join(", ")}]`;
  if (typeof value !== "string") return "me()";
  const reserved = /^(-?\d+(\.\d+)?|true|false|null|me\(\)|\[.*|".*)$/.test(value);
  return value === "" || reserved || value !== value.trim() ? JSON.stringify(value) : value;
}

function valueFromText(text: string): FilterValue {
  const trimmed = text.trim();
  if (trimmed === "me()") return { call: "me" };
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith("[") || trimmed.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === "string" || (Array.isArray(parsed) && parsed.every((item) => item === null || ["string", "number", "boolean"].includes(typeof item)))) return parsed as FilterValue;
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

function toDraft(builder: Builder): Draft {
  if (builder.groups.length === 0) return { connector: "and", groups: [blankGroup()] };
  return {
    connector: builder.connector,
    groups: builder.groups.map((group) => ({
      id: nextId++,
      connector: group.connector,
      rows: group.conditions.map((c) => ({ id: nextId++, path: c.path, op: c.op, valueText: isEmptyOp(c.op) ? "" : valueToText(c.value) })),
    })),
  };
}

const complete = (row: Row): boolean => row.path !== "" && (isEmptyOp(row.op) || row.valueText.trim() !== "");

function toBuilder(draft: Draft): Builder {
  return {
    connector: draft.connector,
    groups: draft.groups.map((group) => ({
      connector: group.connector,
      conditions: group.rows.filter(complete).map((row) => ({ path: row.path, op: row.op, value: isEmptyOp(row.op) ? null : valueFromText(row.valueText) })),
    })),
  };
}

interface Option {
  value: string;
  text: string;
}

function referenceOptions(spec: FieldSpec): string[] {
  if (!spec.reference) return [];
  return referencePaths(spec.reference).flatMap((path) => (path === "department" ? [`${spec.name}.department`, `${spec.name}.department.name`] : [`${spec.name}.${path}`]));
}

function optionsFor(table: Table, query: string): Option[] {
  const q = query.trim().toLowerCase();
  const specs = TABLE_FIELDS[table].filter((spec) => spec.kind !== "object");
  if (q.includes(".")) {
    const head = specs.find((spec) => spec.name === q.split(".")[0]);
    return (head ? referenceOptions(head) : []).filter((path) => path.startsWith(q)).map((path) => ({ value: path, text: path }));
  }
  return specs.filter((spec) => q === "" || spec.name.includes(q) || spec.label.toLowerCase().includes(q)).map((spec) => ({ value: spec.name, text: spec.label }));
}

/** The path a typed text names: a field name, a field label or a reference path such as `caller.department`. */
function resolvePath(table: Table, text: string): string | null {
  const typed = text.trim().toLowerCase();
  const specs = TABLE_FIELDS[table].filter((spec) => spec.kind !== "object");
  const named = specs.find((spec) => spec.name === typed || spec.label.toLowerCase() === typed);
  if (named) return named.name;
  const parts = typed.split(".");
  return parts.length > 1 && specs.some((spec) => spec.name === parts[0]) && pathExists(table, parts) ? typed : null;
}

function displayOf(table: Table, path: string): string {
  const spec = fieldSpec(table, path);
  return spec ? spec.label : path;
}

/** An ARIA combobox for a field path: typing filters the fields, `caller.` lists the fields of the caller. */
function FieldCombobox({ table, path, onPick, dataKey, first }: { table: Table; path: string; onPick: (path: string) => void; dataKey: string; first: boolean }): JSX.Element {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const options = optionsFor(table, draft ?? "");
  const shown = draft ?? (path === "" ? "" : displayOf(table, path));

  const pick = (value: string): void => {
    onPick(value);
    setDraft(null);
    setOpen(false);
    setActive(-1);
  };

  const commit = (): void => {
    if (draft !== null) {
      const resolved = resolvePath(table, draft);
      if (resolved) onPick(resolved);
    }
    setDraft(null);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.altKey) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(options.length > 0 ? 0 : -1);
      } else if (options.length > 0) setActive((a) => (event.key === "ArrowDown" ? (a + 1) % options.length : (a - 1 + options.length) % options.length));
    } else if (event.key === "Enter") {
      const chosen = options[active];
      if (open && chosen) {
        event.preventDefault();
        event.stopPropagation();
        pick(chosen.value);
      } else if (draft !== null) {
        commit();
      }
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setActive(-1);
    }
  };

  return (
    <div className="combo">
      <input
        id={id}
        role="combobox"
        aria-label="Field"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        data-key={dataKey}
        data-first-field={first ? "" : undefined}
        value={shown}
        onChange={(event) => {
          setDraft(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onClick={() => setOpen(true)}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      {open ? (
        <ul id={`${id}-list`} role="listbox" aria-label="Fields" className="combo-list">
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${id}-${index}`}
              role="option"
              aria-selected={index === active}
              className="combo-option"
              onMouseDown={(event) => {
                event.preventDefault();
                pick(option.value);
              }}
            >
              {option.text}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** The Filter dialog: the condition builder, the canonical filter text and Apply, Save and Close. */
export function FilterDialog({
  table,
  filter,
  sheet,
  onClose,
  onApply,
  onSaved,
}: {
  table: Table;
  filter: string;
  sheet: boolean;
  onClose: () => void;
  onApply: (filter: string) => void;
  onSaved: () => void;
}): JSX.Element {
  const announce = useAnnounce();
  const content = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      return toDraft(parseFilter(filter));
    } catch {
      return toDraft({ connector: "and", groups: [] });
    }
  });
  const [text, setText] = useState(filter);
  const [textDirty, setTextDirty] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const skipRewrite = useRef(true);
  const generation = useRef(0);

  const fail = (reason: unknown): void => {
    const message = failureText(reason);
    setError(message);
    announce(message);
  };

  useEffect(() => {
    const mine = ++generation.current;
    post<{ filter: string }>("/api/filters/parse", { table, filter }).then(
      (parsed) => mine === generation.current && setText(parsed.filter),
      (reason: unknown) => mine === generation.current && fail(reason),
    );
  }, []);

  useEffect(() => {
    if (skipRewrite.current) {
      skipRewrite.current = false;
      return undefined;
    }
    const mine = ++generation.current;
    const timer = setTimeout(() => {
      post<{ filter: string }>("/api/filters/compose", { table, builder: toBuilder(draft) }).then(
        (composed) => {
          if (mine !== generation.current) return;
          setText(composed.filter);
          setTextDirty(false);
          setError("");
        },
        (reason: unknown) => mine === generation.current && fail(reason),
      );
    }, 120);
    return () => clearTimeout(timer);
  }, [draft]);

  useLayoutEffect(() => {
    if (focusKey) {
      content.current?.querySelector<HTMLElement>(`[data-key="${focusKey}"]`)?.focus();
      setFocusKey(null);
    }
  }, [focusKey, draft]);

  const change = (next: Draft, focus?: string): void => {
    setDraft(withJoiningConnectors(next));
    if (focus) setFocusKey(focus);
  };

  const updateGroup = (groupId: number, edit: (group: Group) => Group, focus?: string): void =>
    change({ ...draft, groups: draft.groups.map((g) => (g.id === groupId ? edit(g) : g)) }, focus);

  const updateRow = (groupId: number, rowId: number, edit: Partial<Row>): void =>
    updateGroup(groupId, (g) => ({ ...g, rows: g.rows.map((r) => (r.id === rowId ? { ...r, ...edit } : r)) }));

  const addRow = (group: Group): void => {
    const row = blankRow();
    updateGroup(group.id, (g) => ({ ...g, rows: [...g.rows, row] }), `${row.id}:field`);
  };

  const addGroup = (): void => {
    const group = blankGroup();
    change({ ...draft, groups: [...draft.groups, group] }, `${group.rows[0]!.id}:field`);
  };

  const removeRow = (group: Group, index: number): void => {
    const rest = group.rows.filter((_, i) => i !== index);
    const neighbour = rest[Math.max(0, index - 1)];
    updateGroup(group.id, (g) => ({ ...g, rows: rest }), neighbour ? `${neighbour.id}:field` : `add:${group.id}`);
  };

  const moveRow = (group: Group, index: number, by: -1 | 1, control: string): void => {
    const target = index + by;
    const row = group.rows[index];
    if (!row || target < 0 || target >= group.rows.length) {
      setFocusKey(`${row?.id}:${control}`);
      return;
    }
    const rows = [...group.rows];
    rows.splice(index, 1);
    rows.splice(target, 0, row);
    updateGroup(group.id, (g) => ({ ...g, rows }), `${row.id}:${control}`);
  };

  const rebuild = async (): Promise<void> => {
    const mine = ++generation.current;
    try {
      const parsed = await post<{ builder: Builder; filter: string }>("/api/filters/parse", { table, filter: text });
      if (mine !== generation.current) return;
      skipRewrite.current = true;
      setDraft(toDraft(parsed.builder));
      setText(parsed.filter);
      setTextDirty(false);
      setError("");
    } catch (reason) {
      fail(reason);
    }
  };

  const currentFilter = async (): Promise<string | null> => {
    try {
      const result = textDirty
        ? await post<{ filter: string }>("/api/filters/parse", { table, filter: text })
        : await post<{ filter: string }>("/api/filters/compose", { table, builder: toBuilder(draft) });
      return result.filter;
    } catch (reason) {
      fail(reason);
      return null;
    }
  };

  const apply = async (): Promise<void> => {
    const result = await currentFilter();
    if (result !== null) onApply(result);
  };

  const save = async (): Promise<void> => {
    if (name.trim() === "") {
      setError("Name the filter before saving.");
      return;
    }
    const result = await currentFilter();
    if (result === null) return;
    try {
      await post("/api/filters", { name: name.trim(), table, filter: result, shared });
      announce(`Filter ${name.trim()} saved.`);
      setName("");
      setError("");
      onSaved();
    } catch (reason) {
      fail(reason);
    }
  };

  const onRowKey = (event: KeyboardEvent<HTMLDivElement>, group: Group, index: number): void => {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    const control = (document.activeElement as HTMLElement | null)?.dataset.key?.split(":")[1] ?? "field";
    moveRow(group, index, event.key === "ArrowUp" ? -1 : 1, control);
  };

  return (
    <Modal label="Filter" onClose={onClose} sheet={sheet} initialFocus="[data-first-field]" className="filter-dialog">
      <div ref={content} className="stack">
        <h2 className="dialog-title">Filter</h2>
        <div role="radiogroup" aria-label="Groups match" className="choices">
          {(["and", "or"] as const).map((connector) => (
            <label key={connector} className="choice">
              <input type="radio" name="groups-match" checked={draft.connector === connector} onChange={() => change({ ...draft, connector })} />
              {connector === "and" ? "All groups" : "Any group"}
            </label>
          ))}
        </div>
        {draft.groups.map((group, gi) => (
          <div key={group.id} role="group" aria-label={`Group ${gi + 1}`} className="builder-group">
            <div role="radiogroup" aria-label={`Group ${gi + 1} match`} className="choices">
              {(["and", "or"] as const).map((connector) => (
                <label key={connector} className="choice">
                  <input type="radio" name={`group-${group.id}-match`} checked={group.connector === connector} onChange={() => updateGroup(group.id, (g) => ({ ...g, connector }))} />
                  {connector === "and" ? "All conditions" : "Any condition"}
                </label>
              ))}
            </div>
            {group.rows.map((row, ri) => (
              <div key={row.id} role="group" aria-label={`Condition ${ri + 1} of group ${gi + 1}`} className="condition" onKeyDown={(event) => onRowKey(event, group, ri)}>
                <div className="condition-field">
                  <FieldCombobox table={table} path={row.path} dataKey={`${row.id}:field`} first={gi === 0 && ri === 0} onPick={(path) => updateRow(group.id, row.id, { path })} />
                </div>
                <select
                  aria-label="Operator"
                  data-key={`${row.id}:operator`}
                  value={row.op}
                  onChange={(event) => updateRow(group.id, row.id, { op: event.target.value as FilterOperator })}
                >
                  {OPERATORS.map((o) => (
                    <option key={o.op} value={o.op}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  aria-label="Value"
                  data-key={`${row.id}:value`}
                  value={row.valueText}
                  disabled={isEmptyOp(row.op)}
                  spellCheck={false}
                  onChange={(event) => updateRow(group.id, row.id, { valueText: event.target.value })}
                />
                <div className="condition-actions">
                  <Button variant="outline" data-key={`${row.id}:up`} aria-label="Move condition up" onClick={() => moveRow(group, ri, -1, "up")}>
                    Up
                  </Button>
                  <Button variant="outline" data-key={`${row.id}:down`} aria-label="Move condition down" onClick={() => moveRow(group, ri, 1, "down")}>
                    Down
                  </Button>
                  <Button variant="outline" aria-label="Remove condition" onClick={() => removeRow(group, ri)}>
                    Remove
                  </Button>
                </div>
              </div>
            ))}
            <div>
              <Button variant="outline" data-key={`add:${group.id}`} aria-label={`Add condition to group ${gi + 1}`} onClick={() => addRow(group)}>
                Add condition
              </Button>
            </div>
          </div>
        ))}
        <div>
          <Button variant="outline" onClick={addGroup}>
            Add group
          </Button>
        </div>
        <div className="field">
          <label htmlFor="filter-text">
            <span className="field-label">Filter text</span>
          </label>
          <textarea
            id="filter-text"
            value={text}
            rows={3}
            spellCheck={false}
            onChange={(event) => {
              generation.current++;
              setText(event.target.value);
              setTextDirty(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void rebuild();
              }
            }}
          />
        </div>
        <div>
          <Button variant="outline" onClick={() => void rebuild()}>
            Use filter text
          </Button>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="save-row">
          <div className="field">
            <label htmlFor="filter-name">
              <span className="field-label">Filter name</span>
            </label>
            <input id="filter-name" type="text" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <label className="choice">
            <input type="checkbox" checked={shared} onChange={(event) => setShared(event.target.checked)} />
            Share as a queue
          </label>
        </div>
        <div className="row dialog-actions">
          <Button onClick={() => void apply()}>Apply filter</Button>
          <Button variant="outline" onClick={() => void save()}>
            Save filter
          </Button>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
