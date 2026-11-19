import { useRef, useState } from "preact/hooks";
import { api } from "../api";
import { useLive, useMount } from "../hooks";
import { outageStore, toast } from "../store";
import type { Field, FieldType } from "../types";
import { Dialog, FieldError, Pill, useBusy } from "../ui";

/** `Delete <name>?` with Delete and Cancel; Cancel and Escape return focus to the opener. */
export function ConfirmDelete({ name, onConfirm, close }: { name: string; onConfirm: () => Promise<(() => void) | void>; close: () => void }) {
  const [busy, run] = useBusy();
  const confirmed = useRef(false);
  return (
    <Dialog label={`Delete ${name}?`} onClose={close} class="dialog-small" returnTo={() => (confirmed.current ? false : null)}>
      <h2>{`Delete ${name}?`}</h2>
      <p class="muted">This cannot be undone.</p>
      <div class="dialog-actions">
        <Pill kind="danger" busy={busy} onClick={() => void run(async () => {
          const afterClose = await onConfirm();
          confirmed.current = true;
          close();
          afterClose?.();
        })}>Delete</Pill>
        <Pill kind="outline" onClick={close} data-autofocus>Cancel</Pill>
      </div>
    </Dialog>
  );
}

export function SetOptionsDialog({ field, selectedValues, onApply, close }: {
  field: Field; selectedValues: string[]; onApply: (chosen: string[]) => void; close: () => void;
}) {
  const [chosen, setChosen] = useState<string[]>(selectedValues);
  const toggle = (option: string) => setChosen(chosen.includes(option) ? chosen.filter((o) => o !== option) : [...chosen, option]);
  return (
    <Dialog label={`Set ${field.name}`} onClose={close} class="dialog-small">
      <h2>{`Set ${field.name}`}</h2>
      <fieldset class="check-list">
        <legend class="sr-only">{field.name}</legend>
        {field.options.map((option) => (
          <label key={option} class="check-row">
            <input type="checkbox" checked={chosen.includes(option)} onChange={() => toggle(option)} />
            <span>{option}</span>
          </label>
        ))}
      </fieldset>
      <div class="dialog-actions">
        <Pill onClick={() => { onApply(chosen); close(); }}>{`Apply ${field.name.toLowerCase()}`}</Pill>
        <Pill kind="outline" onClick={close}>Cancel</Pill>
      </div>
    </Dialog>
  );
}

const TYPE_LABELS: Array<[FieldType, string]> = [
  ["text", "Text"], ["number", "Number"], ["date", "Date"], ["single_select", "Single select"], ["multi_select", "Multi select"], ["formula", "Formula"],
];

export function AddFieldDialog({ projectId, close }: { projectId: string; close: () => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<FieldType>("text");
  const [options, setOptions] = useState("");
  const [formula, setFormula] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, run] = useBusy();
  const selects = type === "single_select" || type === "multi_select";
  const submit = (event: Event) => {
    event.preventDefault();
    void run(async () => {
      const result = await api("POST", `/api/projects/${projectId}/fields`, {
        name, type, options: options.split(",").map((o) => o.trim()).filter(Boolean), ...(type === "formula" ? { formula } : {}),
      });
      setErrors(result.errors);
      if (result.ok) close();
      else if (!Object.keys(result.errors).length) toast("Couldn't save. Nothing changed.");
    });
  };
  return (
    <Dialog label="Add field" onClose={close}>
      <form onSubmit={submit} noValidate>
        <h2>Add field</h2>
        <div class="field">
          <label for="new-field-name">Field name</label>
          <input id="new-field-name" data-autofocus value={name} aria-invalid={errors.name ? "true" : undefined}
            aria-describedby={errors.name ? "new-field-name-error" : undefined} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          <FieldError id="new-field-name-error" text={errors.name} />
        </div>
        <div class="field">
          <label for="new-field-type">Field type</label>
          <select id="new-field-type" value={type} onChange={(e) => setType((e.target as HTMLSelectElement).value as FieldType)}>
            {TYPE_LABELS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <FieldError id="new-field-type-error" text={errors.type} />
        </div>
        {selects && (
          <div class="field">
            <label for="new-field-options">Options</label>
            <input id="new-field-options" value={options} aria-describedby="new-field-options-hint" onInput={(e) => setOptions((e.target as HTMLInputElement).value)} />
            <p id="new-field-options-hint" class="muted">Comma separated</p>
          </div>
        )}
        {type === "formula" && (
          <div class="field">
            <label for="new-field-formula">Formula</label>
            <input id="new-field-formula" value={formula} aria-invalid={errors.formula ? "true" : undefined}
              aria-describedby={errors.formula ? "new-field-formula-error" : undefined} onInput={(e) => setFormula((e.target as HTMLInputElement).value)} />
            <FieldError id="new-field-formula-error" text={errors.formula} />
          </div>
        )}
        <div class="dialog-actions">
          <Pill type="submit" busy={busy} onClick={submit}>Add field</Pill>
          <Pill kind="outline" onClick={close}>Cancel</Pill>
        </div>
      </form>
    </Dialog>
  );
}

export function EditFieldDialog({ field, close }: { field: Field; close: () => void }) {
  const [name, setName] = useState(field.name);
  const [error, setError] = useState("");
  const [busy, run] = useBusy();
  const submit = (event: Event) => {
    event.preventDefault();
    void run(async () => {
      const result = await api("PATCH", `/api/fields/${field.id}`, { name });
      setError(result.errors.name ?? "");
      if (result.ok) close();
    });
  };
  return (
    <Dialog label={`Edit field: ${field.name}`} onClose={close} class="dialog-small">
      <form onSubmit={submit} noValidate>
        <h2>{`Edit field: ${field.name}`}</h2>
        <div class="field">
          <label for="edit-field-name">Field name</label>
          <input id="edit-field-name" data-autofocus value={name} aria-invalid={error ? "true" : undefined}
            aria-describedby={error ? "edit-field-name-error" : undefined} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          <FieldError id="edit-field-name-error" text={error} />
        </div>
        <div class="dialog-actions">
          <Pill type="submit" busy={busy} onClick={submit}>Save field</Pill>
          <Pill kind="outline" onClick={close}>Cancel</Pill>
        </div>
      </form>
    </Dialog>
  );
}

/** The formula editor: suggestions open at `{`, arrows move through them, Enter inserts a reference. */
export function FormulaDialog({ field, fields, close }: { field: Field; fields: Field[]; close: () => void }) {
  const [text, setText] = useState(field.formula ?? "");
  const [error, setError] = useState("");
  const [query, setQuery] = useState<{ start: number; text: string } | null>(null);
  const [active, setActive] = useState(-1);
  const [busy, run] = useBusy();
  const box = useRef<HTMLTextAreaElement>(null);
  const names = ["Start", "Due", "Effort", ...fields.filter((f) => f.id !== field.id).map((f) => f.name)];
  const matches = query ? names.filter((n) => n.toLowerCase().startsWith(query.text.toLowerCase())) : [];

  const inspect = (value: string, caret: number) => {
    const open = value.lastIndexOf("{", caret - 1);
    const closed = value.lastIndexOf("}", caret - 1);
    if (open >= 0 && open > closed) setQuery({ start: open, text: value.slice(open + 1, caret) });
    else setQuery(null);
    setActive(-1);
  };
  const insert = (name: string) => {
    if (!query) return;
    const el = box.current!;
    const caret = el.selectionStart;
    const rest = text.slice(caret).replace(/^[^{}]*\}/, "");
    const next = `${text.slice(0, query.start)}{${name}}${rest}`;
    setText(next);
    setQuery(null);
    const at = query.start + name.length + 2;
    queueMicrotask(() => {
      el.focus();
      el.setSelectionRange(at, at);
    });
  };
  const keydown = (event: KeyboardEvent) => {
    if (!query || !matches.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((active + 1) % matches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((active - 1 + matches.length) % matches.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      insert(matches[active < 0 ? 0 : active]);
    } else if (event.key === "Escape") {
      event.stopPropagation();
      setQuery(null);
    }
  };
  const save = () => void run(async () => {
    const result = await api("PATCH", `/api/fields/${field.id}`, { formula: text });
    if (result.ok) close();
    else setError(result.errors.formula ?? "Couldn't save. Nothing changed.");
  });
  return (
    <Dialog label={`Edit formula: ${field.name}`} onClose={close} class="formula-dialog">
      <h2>{`Edit formula: ${field.name}`}</h2>
      <div class="field">
        <label for="formula-text">Formula</label>
        <div class="suggest-wrap">
          <textarea id="formula-text" ref={box} data-autofocus rows={3} value={text} spellcheck={false} role="textbox"
            aria-autocomplete="list" aria-controls={query && matches.length ? "formula-suggestions" : undefined}
            aria-activedescendant={active >= 0 ? `suggest-${active}` : undefined}
            onInput={(e) => {
              const el = e.target as HTMLTextAreaElement;
              setText(el.value);
              setError("");
              inspect(el.value, el.selectionStart);
            }}
            onKeyDown={keydown} />
          {query && matches.length > 0 && (
            <ul id="formula-suggestions" role="listbox" aria-label="Field suggestions" class="suggestions">
              {matches.map((name, i) => (
                <li key={name} id={`suggest-${i}`} role="option" aria-selected={i === active} class={i === active ? "is-active" : ""}
                  onMouseDown={(e) => { e.preventDefault(); insert(name); }}>{name}</li>
              ))}
            </ul>
          )}
        </div>
        <p class="muted">Type {"{"} to insert a field. Functions: ROUND, IF, ISBLANK, DAYS, CONCAT.</p>
      </div>
      {error && <p role="alert" class="formula-alert">{error}</p>}
      <div class="dialog-actions">
        <Pill busy={busy} onClick={save}>Save formula</Pill>
        <Pill kind="outline" onClick={close}>Cancel</Pill>
      </div>
    </Dialog>
  );
}

type FileStatus = "idle" | "preparing" | "ready" | "failed";

const FAILED_COPY = "Download failed: file storage is unavailable. Nothing was saved.";

export function DownloadDialog({ projectId, close }: { projectId: string; close: () => void }) {
  const [format, setFormat] = useState<"csv" | "json">("csv");
  const [status, setStatus] = useState<FileStatus>("idle");
  const [url, setUrl] = useState("");
  const [busy, run] = useBusy();
  const job = useRef("");
  const settle = (state: FileStatus, link = "") => {
    setStatus(state);
    setUrl(link);
    if (state === "failed") outageStore.set(true);
    if (state === "ready") outageStore.set(false);
  };
  const check = async (id: string) => {
    if (job.current !== id) return;
    const result = await api<{ status: FileStatus; url?: string }>("GET", `/api/files/${id}`);
    if (job.current !== id) return;
    if (result.ok && result.data.status !== "preparing") settle(result.data.status, result.data.url ?? "");
    else setTimeout(() => void check(id), 400);
  };
  useLive((event) => {
    if (event.t === "file" && event.file === job.current) void check(job.current);
  });
  useMount(() => () => { job.current = ""; }, []);
  const prepare = () => void run(async () => {
    setStatus("preparing");
    setUrl("");
    const result = await api<{ id: string }>("POST", `/api/projects/${projectId}/files`, { format });
    if (result.ok) {
      job.current = result.data.id;
      void check(result.data.id);
    } else settle("failed");
  });
  const text = status === "preparing" ? "Preparing" : status === "ready" ? "Ready" : status === "failed" ? FAILED_COPY : "";
  return (
    <Dialog label="Download project" onClose={close} class="dialog-small">
      <h2>Download project</h2>
      <fieldset class="radio-row">
        <legend class="sr-only">Format</legend>
        {(["csv", "json"] as const).map((value) => (
          <label key={value} class="check-row">
            <input type="radio" name="download-format" checked={format === value} onChange={() => setFormat(value)} />
            <span>{value.toUpperCase()}</span>
          </label>
        ))}
      </fieldset>
      <Pill busy={busy || status === "preparing"} onClick={prepare}>Prepare file</Pill>
      <div role="status" aria-label="Download status" aria-live="polite" class="download-status">{text}</div>
      {status === "ready" && url && <a class="pill pill-outline" href={url} download>{`Download ${format.toUpperCase()}`}</a>}
      <div class="dialog-actions"><Pill kind="outline" onClick={close}>Close</Pill></div>
    </Dialog>
  );
}
