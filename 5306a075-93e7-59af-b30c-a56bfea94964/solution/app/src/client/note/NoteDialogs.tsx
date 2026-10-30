// Log, edit, snooze and delete dialogs of the inbox.
import { useEffect, useId, useRef, useState } from "react";
import type { Attachment, Company, Note, NoteSource } from "../../shared/api.js";
import { api, isFailure } from "../api.js";
import { useFeedback } from "../feedback.js";
import { localTime, SOURCE_LABELS } from "../format.js";
import { Dialog } from "../ui/Dialog.js";

interface ContactOption { id: string; label: string }

/** The workspace's contacts as select options; a label repeats the email only when two names collide. */
function useContacts(): ContactOption[] {
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  useEffect(() => {
    api.get<{ companies: Company[] }>("/api/companies").then(({ companies }) => {
      const all = companies.flatMap((c) => c.contacts).sort((a, b) => a.name.localeCompare(b.name));
      const counts = new Map<string, number>();
      for (const c of all) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
      setContacts(all.map((c) => ({ id: c.id, label: (counts.get(c.name) ?? 0) > 1 ? `${c.name} (${c.email})` : c.name })));
    }, () => undefined);
  }, []);
  return contacts;
}

const NO_CONTACT = "No contact";

function FieldError({ id, text }: { id: string; text: string | undefined }) {
  return text ? <p id={id} className="field-error">{text}</p> : null;
}

/** A rich-text box: pasted formatting is kept here and reduced to the allowlist by the server on save. */
function BodyEditor({ id, label, initial, error, onInput }: { id: string; label: string; initial: string; error?: string; onInput: (html: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = initial;
  }, [initial]);
  return (
    <div className="field">
      <span id={`${id}-label`} className="label">{label}</span>
      <div
        ref={ref}
        id={id}
        role="textbox"
        aria-multiline="true"
        aria-labelledby={`${id}-label`}
        aria-describedby={error ? `${id}-error` : undefined}
        contentEditable="true"
        suppressContentEditableWarning
        className="editor"
        onInput={(event) => onInput(event.currentTarget.innerHTML)}
      />
      <FieldError id={`${id}-error`} text={error} />
    </div>
  );
}

export function LogNoteDialog({ onClosed, onSaved }: { onClosed: () => void; onSaved: (note: Note) => void }) {
  const feedback = useFeedback();
  const contacts = useContacts();
  const id = useId();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [contact, setContact] = useState(NO_CONTACT);
  const [source, setSource] = useState<NoteSource>("support_ticket");
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const saved = useRef<Note | null>(null);

  const submit = async (close: () => void): Promise<void> => {
    setBusy(true);
    setErrors({});
    feedback.clearAlert();
    try {
      let note = saved.current;
      if (!note) {
        const contactId = contacts.find((c) => c.label === contact)?.id;
        note = (await api.post<{ note: Note }>("/api/notes", { title, body, source, ...(contactId ? { contactId } : {}) })).note;
        saved.current = note;
      }
      if (file) {
        const form = new FormData();
        form.append("file", file, file.name);
        try {
          const { attachment } = await api.upload<{ attachment: Attachment }>(`/api/notes/${note.id}/attachments`, form);
          feedback.say("save", attachment.status === "pending" ? `Note saved. ${attachment.filename} will upload when storage is back.` : "Note saved.");
        } catch (error) {
          if (isFailure(error, 413)) setErrors({ file: `${file.name} is larger than 10 MB.` });
          else if (isFailure(error, 415)) setErrors({ file: "Attach a .txt, .vtt, .pdf, .png or .jpg file." });
          else if (isFailure(error, 422)) setErrors({ file: error.fields.file ?? error.message });
          else throw error;
          feedback.say("save", "Note saved.");
          onSaved(note);
          setBusy(false);
          return;
        }
      } else {
        feedback.say("save", "Note saved.");
      }
      onSaved(note);
      close();
    } catch (error) {
      if (isFailure(error, 422)) setErrors(error.fields);
      else feedback.fail(error);
      setBusy(false);
    }
  };

  return (
    <Dialog title="Log note" onClosed={onClosed}>
      {(close) => (
        <form className="dialog-body" onSubmit={(event) => { event.preventDefault(); void submit(close); }}>
          <div className="field">
            <label htmlFor={`${id}-title`}>Title</label>
            <input id={`${id}-title`} type="text" value={title} onChange={(e) => setTitle(e.target.value)} aria-describedby={errors.title ? `${id}-title-error` : undefined} />
            <FieldError id={`${id}-title-error`} text={errors.title} />
          </div>
          <BodyEditor id={`${id}-body`} label="Note body" initial="" error={errors.body} onInput={setBody} />
          <div className="field-row">
            <div className="field">
              <label htmlFor={`${id}-contact`}>Contact</label>
              <select id={`${id}-contact`} value={contact} onChange={(e) => setContact(e.target.value)}>
                <option value={NO_CONTACT}>{NO_CONTACT}</option>
                {contacts.map((c) => <option key={c.id} value={c.label}>{c.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`${id}-source`}>Source</label>
              <select id={`${id}-source`} value={SOURCE_LABELS[source]}
                onChange={(e) => setSource((["support_ticket", "sales_call", "email"] as const).find((s) => SOURCE_LABELS[s] === e.target.value) ?? "support_ticket")}>
                {(["support_ticket", "sales_call", "email"] as const).map((s) => <option key={s} value={SOURCE_LABELS[s]}>{SOURCE_LABELS[s]}</option>)}
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor={`${id}-file`}>Attach transcript or file</label>
            <input id={`${id}-file`} type="file" accept=".txt,.vtt,.pdf,.png,.jpg,.jpeg" aria-describedby={errors.file ? `${id}-file-error` : undefined}
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); setErrors((x) => ({ ...x, file: "" })); }} />
            <FieldError id={`${id}-file-error`} text={errors.file} />
          </div>
          <div className="dialog-actions">
            <button type="button" className="button-quiet" onClick={close}>Cancel</button>
            <button type="submit" className="button" aria-busy={busy} disabled={busy}>{busy ? "Saving note…" : "Save note"}</button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

export function EditNoteDialog({ note, onClosed, onSaved }: { note: Note; onClosed: () => void; onSaved: (note: Note) => void }) {
  const feedback = useFeedback();
  const contacts = useContacts();
  const id = useId();
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [contact, setContact] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const current = contact ?? contacts.find((c) => c.id === note.contact?.id)?.label ?? NO_CONTACT;

  const submit = async (close: () => void): Promise<void> => {
    setBusy(true);
    setErrors({});
    feedback.clearAlert();
    const changes: Record<string, unknown> = { title, body };
    if (contact !== null) changes.contactId = contacts.find((c) => c.label === contact)?.id ?? null;
    try {
      const updated = (await api.patch<{ note: Note }>(`/api/notes/${note.id}`, changes)).note;
      feedback.say("save", "Note updated.");
      onSaved(updated);
      close();
    } catch (error) {
      if (isFailure(error, 422)) setErrors(error.fields);
      else feedback.fail(error);
      setBusy(false);
    }
  };

  return (
    <Dialog title="Edit note" onClosed={onClosed}>
      {(close) => (
        <form className="dialog-body" onSubmit={(event) => { event.preventDefault(); void submit(close); }}>
          <div className="field">
            <label htmlFor={`${id}-title`}>Title</label>
            <input id={`${id}-title`} type="text" value={title} onChange={(e) => setTitle(e.target.value)} aria-describedby={errors.title ? `${id}-title-error` : undefined} />
            <FieldError id={`${id}-title-error`} text={errors.title} />
          </div>
          <BodyEditor id={`${id}-body`} label="Note body" initial={note.body} error={errors.body} onInput={setBody} />
          <div className="field">
            <label htmlFor={`${id}-contact`}>Contact</label>
            <select id={`${id}-contact`} value={current} onChange={(e) => setContact(e.target.value)}>
              <option value={NO_CONTACT}>{NO_CONTACT}</option>
              {contacts.map((c) => <option key={c.id} value={c.label}>{c.label}</option>)}
            </select>
          </div>
          <div className="dialog-actions">
            <button type="button" className="button-quiet" onClick={close}>Cancel</button>
            <button type="submit" className="button" aria-busy={busy} disabled={busy}>{busy ? "Saving changes…" : "Save changes"}</button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

export function SnoozeDialog({ note, timeZone, onClosed, onSaved }: { note: Note; timeZone: string; onClosed: () => void; onSaved: (note: Note) => void }) {
  const feedback = useFeedback();
  const id = useId();
  const [until, setUntil] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const zoneName = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "long" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? timeZone;

  const submit = async (close: () => void): Promise<void> => {
    setBusy(true);
    setError("");
    feedback.clearAlert();
    try {
      const updated = (await api.post<{ note: Note }>(`/api/notes/${note.id}/snooze`, { until })).note;
      feedback.say("save", `Snoozed until ${localTime(updated.snoozedUntil ?? "", timeZone)}.`);
      onSaved(updated);
      close();
    } catch (failure) {
      if (isFailure(failure, 422)) setError(failure.fields.until ?? failure.message);
      else feedback.fail(failure);
      setBusy(false);
    }
  };

  return (
    <Dialog title="Snooze note" onClosed={onClosed}>
      {(close) => (
        <form className="dialog-body" onSubmit={(event) => { event.preventDefault(); void submit(close); }}>
          <div className="field">
            <label htmlFor={`${id}-until`}>Snooze until</label>
            <input id={`${id}-until`} type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} aria-describedby={`${id}-zone${error ? ` ${id}-error` : ""}`} />
            <p id={`${id}-zone`} className="hint">{zoneName} ({timeZone})</p>
            <FieldError id={`${id}-error`} text={error} />
          </div>
          <div className="dialog-actions">
            <button type="button" className="button-quiet" onClick={close}>Cancel</button>
            <button type="submit" className="button" aria-busy={busy} disabled={busy}>{busy ? "Snoozing…" : "Snooze note"}</button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

export function DeleteNoteDialog({ note, onClosed, onDeleted }: { note: Note; onClosed: () => void; onDeleted: () => void }) {
  const feedback = useFeedback();
  const [busy, setBusy] = useState(false);
  const remove = async (close: () => void): Promise<void> => {
    setBusy(true);
    feedback.clearAlert();
    try {
      await api.delete(`/api/notes/${note.id}`);
      feedback.say("save", "Note deleted.");
      onDeleted();
      close();
    } catch (error) {
      feedback.fail(error);
      setBusy(false);
    }
  };
  return (
    <Dialog title="Delete note?" role="alertdialog" onClosed={onClosed}>
      {(close) => (
        <div className="dialog-body">
          <p>This also removes its {note.insights.length} linked insights.</p>
          <div className="dialog-actions">
            <button type="button" className="button-quiet" onClick={close}>Cancel</button>
            <button type="button" className="button button-danger" aria-busy={busy} disabled={busy} onClick={() => void remove(close)}>
              {busy ? "Deleting note…" : "Delete"}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
