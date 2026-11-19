// The wall's dialogs: Add to cluster, New cluster and Clip details (brief: Public screens; Interactions >
// Add to cluster, New cluster).
import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import type { ClusterSummary } from "../../shared/api.js";
import { api, isAbort } from "../lib/api.js";
import { useModal } from "../lib/dialog.js";
import { ErrorSummary, FieldError, fieldAttrs, useFieldErrors, type FieldErrors } from "../components/ErrorSummary.js";
import { Pending } from "../components/bits.js";

const DEBOUNCE_MS = 250;

export function AddToCluster({ slug, referenceTitle, opener, onPick, onClose }: { slug: string; referenceTitle: string; opener: RefObject<HTMLElement | null>; onPick: (cluster: ClusterSummary) => void; onClose: () => void }) {
  const dialog = useModal(true, onClose, opener);
  const [text, setText] = useState("");
  const [options, setOptions] = useState<ClusterSummary[]>([]);
  const [answered, setAnswered] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(-1);
  const current = useRef("");

  // Only the answer to the text now in the field is ever shown (brief: latest text wins).
  useEffect(() => {
    current.current = text;
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        const query = text ? `?q=${encodeURIComponent(text)}` : "";
        api<{ clusters: ClusterSummary[] }>("GET", `/api/workspaces/${slug}/clusters${query}`, { signal: controller.signal })
          .then((result) => {
            if (current.current !== text) return;
            setOptions(result.ok ? result.data.clusters : []);
            setAnswered(text);
            setHighlight(-1);
          })
          .catch((error: unknown) => {
            if (!isAbort(error)) throw error;
          });
      },
      text ? DEBOUNCE_MS : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text, slug]);

  const shown = answered === text ? options : [];
  const pick = (index: number): void => {
    const option = shown[index];
    if (option) onPick(option);
  };

  return (
    <dialog ref={dialog} className="dialog" aria-labelledby="add-title">
      <h2 id="add-title" className="dialog__title">
        Add to cluster
      </h2>
      <p className="dialog__lede">{referenceTitle}</p>
      <label className="field">
        <span className="field__label">Find a cluster</span>
        <input
          type="text"
          role="combobox"
          aria-expanded={shown.length > 0}
          aria-controls="add-options"
          aria-autocomplete="list"
          aria-activedescendant={highlight >= 0 ? `add-option-${highlight}` : undefined}
          value={text}
          data-autofocus=""
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const step = e.key === "ArrowDown" ? 1 : -1;
              setHighlight((h) => Math.max(0, Math.min(shown.length - 1, h + step)));
            } else if (e.key === "Enter") {
              e.preventDefault();
              pick(highlight >= 0 ? highlight : 0);
            }
          }}
        />
      </label>
      <ul id="add-options" role="listbox" aria-label="Clusters" className="picker">
        {shown.map((c, i) => (
          <li
            key={c.id}
            id={`add-option-${i}`}
            role="option"
            aria-selected={i === highlight}
            className="picker__option"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(i)}
          >
            <span className="picker__title">{c.title}</span>
            <span className="mono"> · {c.itemCount} items</span>
          </li>
        ))}
      </ul>
      {answered === text && !shown.length && <p className="dialog__note">No clusters match {text}.</p>}
      <div className="dialog__actions">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}

interface NewClusterProps {
  workspaceName: string;
  opener: RefObject<HTMLElement | null>;
  onClose: () => void;
  onCreate: (fields: { title: string; publicDescription: string; internalNote: string }) => Promise<FieldErrors | null>;
}

export function NewCluster({ workspaceName, opener, onClose, onCreate }: NewClusterProps) {
  const dialog = useModal(true, onClose, opener);
  const form = useFieldErrors();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const errors = await onCreate({ title, publicDescription: description, internalNote: note });
    setBusy(false);
    if (errors) form.show(errors);
  };
  const e = form.errors;
  return (
    <dialog ref={dialog} className="dialog" aria-label="New cluster">
      <form onSubmit={(ev) => void submit(ev)} noValidate>
        <h2 id="new-title" className="dialog__title">
          New cluster in {workspaceName}
        </h2>
        <ErrorSummary errors={e} shown={form.shown} targets={{ title: "new-cluster-title", publicDescription: "new-cluster-description", internalNote: "new-cluster-note" }} />
        <div className="field">
          <label className="field__label" htmlFor="new-cluster-title">
            Title
          </label>
          <input type="text" {...fieldAttrs("new-cluster-title", e.title)} value={title} data-autofocus="" onChange={(ev) => setTitle(ev.target.value)} />
          <FieldError id="new-cluster-title" message={e.title} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="new-cluster-description">
            Public description
          </label>
          <textarea {...fieldAttrs("new-cluster-description", e.publicDescription)} rows={3} value={description} onChange={(ev) => setDescription(ev.target.value)} />
          <FieldError id="new-cluster-description" message={e.publicDescription} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="new-cluster-note">
            Internal note
          </label>
          <textarea {...fieldAttrs("new-cluster-note", e.internalNote)} rows={3} value={note} onChange={(ev) => setNote(ev.target.value)} />
          <FieldError id="new-cluster-note" message={e.internalNote} />
        </div>
        <div className="dialog__actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? (
              <>
                Creating <Pending />
              </>
            ) : (
              "Create cluster"
            )}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export interface ClipFields {
  title: string;
  frameRate: string;
}

export function ClipDetails({ fileName, opener, onClose, onUpload }: { fileName: string; opener: RefObject<HTMLElement | null>; onClose: () => void; onUpload: (fields: ClipFields) => Promise<FieldErrors | null> }) {
  const dialog = useModal(true, onClose, opener);
  const form = useFieldErrors();
  const [title, setTitle] = useState(fileName.replace(/\.[^.]+$/, ""));
  const [rate, setRate] = useState("25");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const errors = await onUpload({ title, frameRate: rate });
    setBusy(false);
    if (errors) form.show(errors);
  };
  const e = form.errors;
  return (
    <dialog ref={dialog} className="dialog" aria-labelledby="clip-title">
      <form onSubmit={(ev) => void submit(ev)} noValidate>
        <h2 id="clip-title" className="dialog__title">
          Clip details
        </h2>
        <p className="dialog__lede">{fileName}</p>
        <ErrorSummary errors={e} shown={form.shown} targets={{ title: "clip-title-field", frameRate: "clip-rate-24", durationMs: "clip-title-field", file: "clip-title-field" }} />
        <div className="field">
          <label className="field__label" htmlFor="clip-title-field">
            Title
          </label>
          <input type="text" {...fieldAttrs("clip-title-field", e.title)} value={title} data-autofocus="" onChange={(ev) => setTitle(ev.target.value)} />
          <FieldError id="clip-title-field" message={e.title} />
        </div>
        <fieldset className="field">
          <legend className="field__label" id="clip-rate-label">
            Frame rate
          </legend>
          <div role="radiogroup" aria-labelledby="clip-rate-label" className="segmented" aria-describedby={e.frameRate ? "clip-rate-24-error" : undefined}>
            {["24", "25", "30"].map((value) => (
              <label key={value} className="segmented__option">
                <input type="radio" name="frame-rate" id={`clip-rate-${value}`} value={value} checked={rate === value} aria-invalid={e.frameRate ? true : undefined} onChange={() => setRate(value)} />
                <span className="mono">{value}</span>
              </label>
            ))}
          </div>
          <FieldError id="clip-rate-24" message={e.frameRate ?? e.durationMs} />
        </fieldset>
        <div className="dialog__actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? (
              <>
                Uploading <Pending />
              </>
            ) : (
              "Upload clip"
            )}
          </button>
        </div>
      </form>
    </dialog>
  );
}
