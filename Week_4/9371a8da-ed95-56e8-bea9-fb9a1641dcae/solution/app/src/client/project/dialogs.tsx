import type { ComponentChildren, JSX } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { CitationReport, CitationWarning, Export, ProjectFile, Readiness, TextFile } from "../../shared/api.ts";
import { api, post, upload } from "../api.ts";
import { storageOrder } from "../latest.ts";
import { Dialog, Field } from "../dialog.tsx";
import { MentionField } from "../mention.tsx";
import { looksUnstorable } from "../text.ts";
import { canEdit, PATH_RULE, SOMETHING_WRONG, STORAGE_DOWN, UNSTORABLE_FIELD, type ViewContext } from "./model.ts";

export function SelectionDialog(props: {
  kind: "suggest" | "comment";
  quote: string;
  handles: string[];
  onClose: () => void;
  onSubmit: (value: string) => Promise<{ field?: string } | void>;
}): JSX.Element {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const suggest = props.kind === "suggest";
  const fieldId = suggest ? "replacement-text" : "comment-text";
  const submit = async (event: Event) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    const outcome = await props.onSubmit(value);
    setPending(false);
    if (outcome && outcome.field) {
      setError(looksUnstorable(value) ? UNSTORABLE_FIELD : suggest ? "Write replacement text of up to 10,000 characters." : "Write a comment of 1 to 4,000 characters.");
      document.getElementById(fieldId)?.focus();
    }
  };
  return (
    <Dialog title={suggest ? "Suggest edit" : "New comment"} onClose={props.onClose} initial={`#${fieldId}`}>
      <form onSubmit={submit} noValidate>
        <figure class="quote">
          <figcaption>{suggest ? (props.quote ? "Replacing" : "Inserting at the caret") : "On the passage"}</figcaption>
          {props.quote ? <blockquote class="mono">{props.quote}</blockquote> : null}
        </figure>
        <Field id={fieldId} label={suggest ? "Replacement text" : "Comment"} error={error}>
          {(described) =>
            suggest ? (
              <textarea id={fieldId} rows={3} value={value} aria-describedby={described} aria-invalid={error ? "true" : undefined}
                onInput={(e) => setValue(e.currentTarget.value)} />
            ) : (
              <MentionField id={fieldId} value={value} onValue={setValue} handles={props.handles} describedBy={described} rows={4} />
            )
          }
        </Field>
        <div class="dialog-actions">
          <button type="submit" class="primary" disabled={pending} aria-busy={pending ? "true" : undefined}>
            {suggest ? "Add suggestion" : "Post comment"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function StaleDialog(props: { path: string; unsaved: string; onClose: () => void; onLoad: () => void }): JSX.Element {
  return (
    <Dialog title="Newer version on the server" role="alertdialog" onClose={props.onClose}>
      <p>Someone saved {props.path} after you opened it. Your changes were not saved; copy them from below.</p>
      <div class="field">
        <label for="stale-text">Your unsaved text</label>
        <textarea id="stale-text" class="mono" rows={8} readOnly value={props.unsaved} />
      </div>
      <div class="dialog-actions">
        <button type="button" class="primary" onClick={props.onLoad}>
          Load latest
        </button>
      </div>
    </Dialog>
  );
}

export function NewFileDialog(props: { context: ViewContext; onClose: () => void; onCreated: (file: TextFile) => void }): JSX.Element {
  const { context } = props;
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submit = async (event: Event) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    const wanted = path;
    context.say(`Creating ${wanted}…`);
    const answer = await context.act(() => post<{ file: TextFile }>(`${context.base}/files`, { path: wanted, content: "" }));
    setPending(false);
    if (!answer) return context.say(SOMETHING_WRONG);
    if (answer.ok) {
      context.say(`Created ${answer.data.file.path}`);
      props.onCreated(answer.data.file);
    } else if (answer.status === 409) context.say(`${wanted} already exists`);
    else if (answer.status === 422) {
      setError(PATH_RULE);
      document.getElementById("new-file-path")?.focus();
    } else if (answer.status >= 500) context.say(SOMETHING_WRONG);
  };
  return (
    <Dialog title="New file" onClose={props.onClose}>
      <form onSubmit={submit} noValidate>
        <Field id="new-file-path" label="File path" error={error}>
          {(described) => (
            <input id="new-file-path" type="text" class="mono" value={path} placeholder="chapters/06-discussion.tex" aria-describedby={described}
              aria-invalid={error ? "true" : undefined} onInput={(e) => setPath(e.currentTarget.value)} />
          )}
        </Field>
        <p class="hint">Text files end in .tex, .bib, .sty, .cls, .bst or .txt.</p>
        <div class="dialog-actions">
          <button type="submit" class="primary" disabled={pending} aria-busy={pending ? "true" : undefined}>
            Create file
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function UploadDialog(props: { context: ViewContext; onClose: () => void; onUploaded: (file: ProjectFile) => void }): JSX.Element {
  const { context } = props;
  const [chosen, setChosen] = useState<File | null>(null);
  const [folder, setFolder] = useState("figures");
  const [folderTouched, setFolderTouched] = useState(false);
  const [errors, setErrors] = useState<{ file?: string; folder?: string }>({});
  const [pending, setPending] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  useLayoutEffect(() => {
    if (refocus.current && !pending) {
      refocus.current = false;
      button.current?.focus();
    }
  });
  const submit = async (event: Event) => {
    event.preventDefault();
    if (pending) return;
    if (!chosen) {
      setErrors({ file: "Choose a file to upload." });
      return;
    }
    const name = chosen.name;
    const target = folder.trim() ? `${folder.trim()}/${name}` : name;
    const form = new FormData();
    form.append("file", chosen, name);
    if (folder.trim()) form.append("folder", folder.trim());
    setPending(true);
    setErrors({});
    context.say(`Uploading ${name}…`);
    const stamp = storageOrder.stamp();
    const answer = await context.act(() => upload<{ file: ProjectFile }>(`${context.base}/assets`, form));
    setPending(false);
    if (!answer) return context.say(SOMETHING_WRONG);
    // A storage action sent after this one has answered already: this answer changes nothing here.
    if (!storageOrder.applies(stamp)) return;
    refocus.current = true;
    if (answer.ok) {
      refocus.current = false;
      context.sayStorage("");
      context.say(`Uploaded ${answer.data.file.path}`);
      props.onUploaded(answer.data.file);
      return;
    }
    switch (answer.status) {
      case 409:
        context.say(`${target} already exists`);
        break;
      case 413:
        context.say(`${name} is too large for its file type`);
        break;
      case 415:
        context.say(`${name} is not an allowed file type`);
        break;
      case 422:
        if (answer.error.errors?.folder) setErrors({ folder: PATH_RULE });
        else context.say(`${name} is not an allowed file name`);
        break;
      case 503:
        context.sayStorage(STORAGE_DOWN);
        break;
      default:
        if (answer.status >= 500) context.say(SOMETHING_WRONG);
    }
  };
  return (
    <Dialog title="Upload file" onClose={props.onClose}>
      <form onSubmit={submit} noValidate>
        <Field id="upload-file" label="File" error={errors.file ?? null}>
          {(described) => (
            <input id="upload-file" type="file" accept=".png,.jpg,.jpeg,.pdf,.svg,.bib" aria-describedby={described}
              onChange={(e) => {
                const file = e.currentTarget.files?.[0] ?? null;
                setChosen(file);
                if (file && !folderTouched) setFolder(file.name.toLowerCase().endsWith(".bib") ? "" : "figures");
              }} />
          )}
        </Field>
        <Field id="upload-folder" label="Folder" error={errors.folder ?? null}>
          {(described) => (
            <input id="upload-folder" type="text" class="mono" value={folder} aria-describedby={described}
              onInput={(e) => {
                setFolderTouched(true);
                setFolder(e.currentTarget.value);
              }} />
          )}
        </Field>
        <p class="hint">PNG, JPEG, PDF and SVG figures up to 10 MB; .bib files up to 1 MB. Leave Folder empty for the project root.</p>
        <div class="dialog-actions">
          <button ref={button} type="submit" class="primary" disabled={pending} aria-busy={pending ? "true" : undefined}>
            Upload
          </button>
          <button type="button" onClick={props.onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function DeleteDialog(props: { context: ViewContext; file: ProjectFile; onClose: () => void; onDeleted: () => void }): JSX.Element {
  const { context, file } = props;
  const [pending, setPending] = useState(false);
  const remove = async () => {
    if (pending) return;
    setPending(true);
    context.say(`Deleting ${file.path}…`);
    const answer = await context.act(() => api<{ projectRevision: number }>("DELETE", `${context.base}/files/${file.id}`));
    setPending(false);
    if (!answer) return context.say(SOMETHING_WRONG);
    if (answer.ok) {
      context.say(`Deleted ${file.path}`);
      props.onDeleted();
    } else if (answer.status >= 500) context.say(SOMETHING_WRONG);
  };
  return (
    <Dialog title={`Delete ${file.path}?`} role="alertdialog" onClose={props.onClose} initial="#delete-cancel">
      <p>This removes {file.path} from the current files. Restoring an earlier label that holds it brings it back.</p>
      <div class="dialog-actions">
        <button id="delete-cancel" type="button" onClick={props.onClose}>
          Cancel
        </button>
        <button type="button" class="primary" disabled={pending} aria-busy={pending ? "true" : undefined} onClick={remove}>
          Delete
        </button>
      </div>
    </Dialog>
  );
}

interface WarningLinks {
  hrefFor: (path: string, line: number) => string;
  onChoose: (path: string, line: number) => void;
}

/** A warning's identity across refreshes: its list and key, plus which definition it is for repeated duplicates. */
function warningIds(list: string, items: CitationWarning[]): string[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const nth = seen.get(item.key) ?? 0;
    seen.set(item.key, nth + 1);
    return `${list}:${item.key}:${nth}`;
  });
}

function WarningList(props: { id: string; title: string; items: CitationWarning[] } & WarningLinks): JSX.Element {
  const ids = warningIds(props.id, props.items);
  return (
    <section class="warning-group">
      <h3 id={`${props.id}-heading`}>{props.title}</h3>
      <ul aria-label={props.title} class="ruled">
        {props.items.map((item, index) => (
          <li key={ids[index]}>
            <a class="warning" data-warning={ids[index]} href={props.hrefFor(item.path, item.line)}
              onClick={(event) => {
                event.preventDefault();
                props.onChoose(item.path, item.line);
              }}>
              <span class="mono key">{item.key}</span> <span class="mono where">{item.path}:{item.line}</span>
            </a>
          </li>
        ))}
      </ul>
      {props.items.length === 0 ? <p class="muted">None.</p> : null}
    </section>
  );
}

export function CitationsDialog(props: { report: CitationReport | null; onClose: () => void } & WarningLinks): JSX.Element {
  const report = props.report;
  const body = useRef<HTMLDivElement>(null);
  // Read before the lists re-render: the warning holding focus, kept when a refresh still lists it.
  const focused = useRef<string | null>(null);
  const active = document.activeElement as HTMLElement | null;
  if (active?.dataset.warning && body.current?.contains(active)) focused.current = active.dataset.warning;
  useLayoutEffect(() => {
    const root = body.current;
    const dialog = root?.closest<HTMLElement>('[role="dialog"]');
    if (!root || !dialog || focused.current === null) return;
    if (dialog.contains(document.activeElement) && document.activeElement !== dialog) return;
    const same = root.querySelector<HTMLElement>(`[data-warning="${focused.current}"]`);
    const next = same ?? root.querySelector<HTMLElement>("[data-warning]") ?? dialog;
    focused.current = next.dataset.warning ?? null;
    next.focus();
  }, [report]);
  return (
    <Dialog title="Citation warnings" onClose={props.onClose} wide>
      <div ref={body}>
        {report ? (
          <>
            <p class="muted">Checked at <span class="mono">r{report.projectRevision}</span>, from main.tex and the files it includes.</p>
            <WarningList id="undefined" title="Undefined citations" items={report.undefined} hrefFor={props.hrefFor} onChoose={props.onChoose} />
            <WarningList id="unused" title="Unused entries" items={report.unused} hrefFor={props.hrefFor} onChoose={props.onChoose} />
            <WarningList id="duplicate" title="Duplicate keys" items={report.duplicate} hrefFor={props.hrefFor} onChoose={props.onChoose} />
          </>
        ) : (
          <p class="muted">Checking citations…</p>
        )}
      </div>
    </Dialog>
  );
}

function readinessOf(context: ViewContext): Readiness {
  const review = context.review;
  return {
    openSuggestions: review?.openSuggestions ?? 0,
    openThreads: review ? review.threads.filter((thread) => thread.status === "open").length : 0,
    undefinedCitations: context.citations?.undefined.length ?? 0,
    duplicateKeys: context.citations?.duplicate.length ?? 0,
  };
}

const READY_COPY = (r: Readiness) =>
  `Not ready to export: ${r.openSuggestions} open suggestions, ${r.openThreads} open threads, ${r.undefinedCitations} undefined citations, ${r.duplicateKeys} duplicate keys`;

export function SubmissionDialog(props: { context: ViewContext; onClose: () => void }): JSX.Element {
  const { context } = props;
  const [pending, setPending] = useState(false);
  const [made, setMade] = useState<Export | null>(null);
  /** Counts from a 409 `not_ready` body, shown until the next refresh brings the view's own counts. */
  const [refused, setRefused] = useState<Readiness | null>(null);
  const urls = useRef<string[]>([]);
  const exportButton = useRef<HTMLButtonElement>(null);
  const link = useRef<HTMLAnchorElement>(null);
  const focusLink = useRef(false);
  useLayoutEffect(() => () => urls.current.forEach((url) => URL.revokeObjectURL(url)), []);
  useLayoutEffect(() => setRefused(null), [context.review, context.citations]);

  const counts = refused ?? readinessOf(context);
  const ready = counts.openSuggestions + counts.openThreads + counts.undefinedCitations + counts.duplicateKeys === 0;
  const exporter = canEdit(context.role);
  // A download link stays only while the project revision it was made at is still the current one.
  const shown = made && made.projectRevision >= context.projectRevision ? made : null;

  // Read before this render changes the DOM: whether focus sits on a control this render may disable or remove.
  const active = document.activeElement;
  const focusWas = active && active === exportButton.current ? "export" : active && active === link.current ? "link" : null;
  useLayoutEffect(() => {
    const dialog = (exportButton.current ?? link.current)?.closest<HTMLElement>('[role="dialog"]');
    if (focusLink.current && link.current) {
      focusLink.current = false;
      link.current.focus();
    } else if (focusWas === "link" && !shown) {
      (ready && exportButton.current ? exportButton.current : dialog)?.focus();
    } else if (focusWas === "export" && !ready) dialog?.focus();
  });
  useLayoutEffect(() => {
    if (made && !shown) setMade(null);
  }, [made, shown]);

  const exportNow = async () => {
    if (pending || !ready) return;
    setPending(true);
    setMade(null);
    context.say("Running submission check…");
    const stamp = storageOrder.stamp();
    const answer = await context.act(() => post<{ export: Export }>(`${context.base}/exports`));
    setPending(false);
    if (!answer) return context.say(SOMETHING_WRONG);
    if (!answer.ok && answer.status === 409 && answer.error.readiness) {
      setRefused(answer.error.readiness);
      context.say(READY_COPY(answer.error.readiness));
      return;
    }
    if (!storageOrder.applies(stamp)) return;
    if (answer.ok) {
      focusLink.current = true;
      setMade(answer.data.export);
      context.sayStorage("");
      context.say(`Export of r${answer.data.export.projectRevision} ready to download`);
    } else if (answer.status === 503) context.sayStorage(STORAGE_DOWN);
    else if (answer.status >= 500) context.say(SOMETHING_WRONG);
  };
  const download = async (event: MouseEvent) => {
    event.preventDefault();
    if (!shown) return;
    const stamp = storageOrder.stamp();
    let response: Response;
    try {
      response = await fetch(shown.downloadUrl, { credentials: "same-origin" });
    } catch {
      context.say(SOMETHING_WRONG);
      return;
    }
    if (!storageOrder.applies(stamp)) return;
    if (!response.ok) {
      if (response.status === 503) {
        context.sayStorage(STORAGE_DOWN);
        setMade(null);
      } else context.say(SOMETHING_WRONG);
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    urls.current.push(url);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = shown.filename;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    context.sayStorage("");
  };
  return (
    <Dialog title="Submission check" onClose={props.onClose}>
      <p class="muted">Unused entries never block an export.</p>
      <ul class="ruled readiness">
        <li>{`Open suggestions: ${counts.openSuggestions}`}</li>
        <li>{`Open threads: ${counts.openThreads}`}</li>
        <li>{`Undefined citations: ${counts.undefinedCitations}`}</li>
        <li>{`Duplicate keys: ${counts.duplicateKeys}`}</li>
      </ul>
      {exporter ? (
        <div class="dialog-actions">
          <button ref={exportButton} id="export-source" type="button" class="primary" disabled={!ready}
            aria-disabled={pending ? "true" : undefined} aria-busy={pending ? "true" : undefined} onClick={exportNow}>
            Export source
          </button>
        </div>
      ) : (
        <p class="muted">Owners and editors export the source.</p>
      )}
      {shown ? (
        <p class="download">
          <span>{`Export of r${shown.projectRevision} ready to download`}</span>{" "}
          <a ref={link} href={shown.downloadUrl} onClick={download}>
            Download {shown.filename}
          </a>
        </p>
      ) : null}
    </Dialog>
  );
}

export function FilesDialog(props: { onClose: () => void; children: ComponentChildren }): JSX.Element {
  return (
    <Dialog title="Project files" onClose={props.onClose} initial='[role="treeitem"][tabindex="0"]'>
      <div class="files-dialog">{props.children}</div>
    </Dialog>
  );
}

