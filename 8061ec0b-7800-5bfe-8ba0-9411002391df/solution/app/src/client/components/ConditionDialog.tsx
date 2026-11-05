// Record condition: a check-out, exchange or return check with notes and up to six photos, uploaded in one request.
// A refused photo is named and marked "Not saved"; every chosen photo stays chosen and focus goes to its Remove.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ImagePlus, X } from "lucide-react";
import { CONDITION_KINDS, CONDITION_KIND_WORDS, type ConditionKind } from "../../shared/vocabulary.js";
import { NETWORK_COPY, upload } from "../api.js";
import { errorNotice, Dialog, Field, info, quiet, Status, type Notice } from "./ui.js";

interface Chosen { key: number; file: File; preview: string; refused: boolean }

let nextKey = 0;

export function ConditionDialog({ open, contractId, returnFocus, onClose, onDone }: {
  open: boolean; contractId: string; returnFocus: () => HTMLElement | null; onClose: () => void;
  onDone: (count: number) => void;
}): ReactNode {
  const [kind, setKind] = useState<ConditionKind | null>(null);
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<Chosen[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(quiet);
  const removers = useRef(new Map<number, HTMLButtonElement>());
  const save = useRef<HTMLButtonElement>(null);
  const focusTarget = useRef<number | "save" | null>(null);
  const previews = useRef<string[]>([]);
  previews.current = photos.map((p) => p.preview);

  useEffect(() => {
    if (!open) return;
    setKind(null);
    setNotes("");
    setPhotos([]);
    setNotice(quiet);
  }, [open]);
  useEffect(() => () => previews.current.forEach((url) => URL.revokeObjectURL(url)), []);

  useLayoutEffect(() => {
    if (focusTarget.current === null) return;
    if (focusTarget.current === "save") save.current?.focus();
    else removers.current.get(focusTarget.current)?.focus();
    focusTarget.current = null;
  });

  const remove = (key: number): void => {
    const index = photos.findIndex((p) => p.key === key);
    const gone = photos[index];
    URL.revokeObjectURL(gone.preview);
    const rest = photos.filter((p) => p.key !== key);
    focusTarget.current = rest[index]?.key ?? "save";
    setPhotos(rest);
    if (gone.refused) setNotice(quiet);
  };

  return (
    <Dialog open={open} title="Record condition" onClose={onClose} returnFocus={returnFocus} wide>
      <form className="form" noValidate onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData();
        if (kind) form.append("kind", kind);
        form.append("notes", notes);
        photos.forEach((p) => form.append("photos", p.file, p.file.name));
        setBusy(true);
        setNotice(info("Uploading photos…"));
        setPhotos((all) => all.map((p) => ({ ...p, refused: false })));
        void upload<{ event: { photos: unknown[] } }>(`/api/contracts/${contractId}/condition-events`, form).then((r) => {
          setBusy(false);
          if (r.ok) {
            onDone(r.data.event.photos.length);
            return;
          }
          const index = r.error?.photo_index;
          const name = index === undefined ? "" : photos[index]?.file.name ?? "";
          if (index !== undefined && photos[index]) {
            setPhotos((all) => all.map((p, i) => ({ ...p, refused: i === index })));
            focusTarget.current = photos[index].key;
          }
          const fields = r.error?.fields ?? {};
          if (r.status === 415) setNotice(errorNotice(`${name} isn't a JPEG, PNG or WebP photo. Nothing was saved.`));
          else if (r.status === 413 && r.error?.code === "photo_too_large") setNotice(errorNotice(`${name} is over 5,000,000 bytes. Nothing was saved.`));
          else if (r.status === 413) setNotice(errorNotice("These photos are too large to send together. Nothing was saved."));
          else if (r.status === 422 && fields.photos === "dimensions") setNotice(errorNotice(`${name} is over 8,000 pixels on a side. Nothing was saved.`));
          else if (r.status === 422 && fields.photos === "count") setNotice(errorNotice("Add between 1 and 6 photos."));
          else if (r.status === 422 && fields.kind) setNotice(errorNotice("Choose Check-out, Exchange or Return."));
          else if (r.status === 422) setNotice(errorNotice("Keep the notes under 1,000 characters."));
          else if (r.status === 409) setNotice(errorNotice("Condition can't be recorded on this contract."));
          else if (r.status === 503) setNotice(errorNotice("File storage is unreachable. Nothing was saved; try again in a moment."));
          else setNotice(errorNotice(NETWORK_COPY));
        });
      }}>
        <fieldset className="picker">
          <legend className="picker__legend">Condition check</legend>
          <div role="radiogroup" aria-label="Condition check" className="picker__options">
            {CONDITION_KINDS.map((k) => (
              <label key={k} className="choice">
                <input type="radio" name="condition-kind" checked={kind === k} onChange={() => setKind(k)} />
                <span className="choice__text">{CONDITION_KIND_WORDS[k]}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Notes" htmlFor="condition-notes">
          <textarea id="condition-notes" rows={3} value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />
        </Field>
        <div className="field">
          <label htmlFor="condition-photos" className="photo-picker">
            <ImagePlus size={20} aria-hidden="true" />
            <span>Photos</span>
          </label>
          <input id="condition-photos" className="visually-hidden photo-input" type="file" multiple
            accept="image/jpeg,image/png,image/webp" onChange={(e) => {
              const files = Array.from(e.currentTarget.files ?? []);
              setPhotos((all) => [...all, ...files.map((file) => ({ key: nextKey++, file, preview: URL.createObjectURL(file), refused: false }))]);
              e.currentTarget.value = "";
            }} />
          <span className="muted">JPEG, PNG or WebP; up to six, 5,000,000 bytes and 8,000 pixels on a side each.</span>
        </div>
        {photos.length > 0 && (
          <ul className="thumbs">
            {photos.map((p) => (
              <li key={p.key} className={`thumb ${p.refused ? "thumb--refused" : ""}`}>
                <img src={p.preview} alt={p.file.name} />
                {p.refused && <span className="thumb__refused">Not saved</span>}
                <button type="button" className="button button--icon" aria-label={`Remove ${p.file.name}`}
                  ref={(node) => { if (node) removers.current.set(p.key, node); else removers.current.delete(p.key); }}
                  onClick={() => remove(p.key)}>
                  <X size={18} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <Status label="Condition status" notice={notice} />
        <div className="dialog__actions">
          <button ref={save} type="submit" className="button button--primary" disabled={busy}>Save condition</button>
          <button type="button" className="button button--secondary" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Dialog>
  );
}
