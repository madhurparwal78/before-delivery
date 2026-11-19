import { useId, useState } from "react";
import { api, ApiFailure, apiMessage } from "../api";
import { Dialog, FieldError } from "../components/Dialog";
import { notify, putEntries, removeMessage, useMe } from "../store";
import { formatWhen } from "../../shared/when";
import type { Message } from "../types";

type Newer = { version: number; text: string; edited_by: { id: string; name: string }; edited_at: string };

// Edit with the version it started from. A stale save keeps the draft and shows the newer text;
// a closed window keeps the draft and leaves only Cancel.
export function EditDialog({ message, onClose }: { message: Message; onClose: () => void }) {
  const zone = useMe().workspace.time_zone;
  const [draft, setDraft] = useState(message.text);
  const [base, setBase] = useState(message.version);
  const [newer, setNewer] = useState<Newer | null>(null);
  const [closed, setClosed] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const ids = { text: useId(), error: useId(), newer: useId() };

  const save = async (against: number) => {
    setSaving(true);
    setError(undefined);
    try {
      const body = await api<{ message: Message }>("PATCH", `/api/messages/${message.id}`, { text: draft, expected_version: against });
      putEntries([body.message]);
      notify(`Edit saved as version ${body.message.version}.`);
      onClose();
    } catch (failure) {
      setSaving(false);
      if (!(failure instanceof ApiFailure) || !failure.body) {
        notify("Something went wrong on our side. Try again.");
        return;
      }
      if (failure.body.error === "stale_version" && failure.body.current) {
        setNewer(failure.body.current);
        notify("Someone saved a newer version. Your draft is still here.");
      } else if (failure.body.error === "edit_window_closed") {
        setClosed(failure.body.message);
        setNewer(null);
      } else if (failure.body.errors) {
        setError(failure.body.errors.text ?? Object.values(failure.body.errors)[0]);
      } else {
        notify(failure.body.message);
      }
    }
  };

  const fieldError = closed ?? error;
  return (
    <Dialog title="Edit message" onClose={onClose}>
      <div className="field">
        <label htmlFor={ids.text}>Message text</label>
        <textarea
          id={ids.text}
          rows={5}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={fieldError ? ids.error : undefined}
        />
        <FieldError id={ids.error} text={fieldError} />
      </div>
      {newer && !closed ? (
        <section className="newer" aria-labelledby={ids.newer}>
          <h3 id={ids.newer}>Newer version</h3>
          <p className="newer-text">{newer.text}</p>
          <p className="newer-by">
            Saved by {newer.edited_by.name} at {formatWhen(zone, newer.edited_at)}
          </p>
        </section>
      ) : null}
      <div className="dialog-actions">
        {!closed ? (
          <button className="button button-primary" type="button" disabled={saving} onClick={() => void save(base)}>
            {saving ? "Saving…" : "Save edit"}
          </button>
        ) : null}
        {newer && !closed ? (
          <>
            <button
              className="button button-quiet"
              type="button"
              onClick={() => {
                setDraft(newer.text);
                setBase(newer.version);
              }}
            >
              Use newer text
            </button>
            <button className="button button-quiet" type="button" disabled={saving} onClick={() => void save(newer.version)}>
              Save over it
            </button>
          </>
        ) : null}
        <button className="button button-quiet" type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

export function DeleteDialog({ message, onClose }: { message: Message; onClose: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const remove = async () => {
    setDeleting(true);
    try {
      await api("DELETE", `/api/messages/${message.id}`);
      removeMessage(message.id);
      notify("Message deleted.");
    } catch (failure) {
      notify(apiMessage(failure));
    }
    onClose();
  };
  return (
    <Dialog title="Delete this message?" onClose={onClose}>
      <p className="dialog-copy">It disappears for everyone in the channel, with its photos, receipts and search entries. This cannot be undone.</p>
      <blockquote className="quote">{message.text || message.attachments.map((a) => a.filename).join(", ")}</blockquote>
      <div className="dialog-actions">
        <button className="button button-danger" type="button" disabled={deleting} onClick={() => void remove()}>
          {deleting ? "Deleting…" : "Delete for everyone"}
        </button>
        <button className="button button-quiet" type="button" onClick={onClose}>
          Keep it
        </button>
      </div>
    </Dialog>
  );
}
