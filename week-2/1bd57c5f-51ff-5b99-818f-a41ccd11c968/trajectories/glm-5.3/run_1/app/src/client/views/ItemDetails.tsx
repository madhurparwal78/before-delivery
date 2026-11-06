/** The selected row's details region: fields, photos, notes and controls. */

import { useState } from "react";
import { api, TRADE_LABELS, type Item, type JobData, type Note, type TradeKey, type User } from "../api.js";
import { money } from "../components.js";
import { queueNote, queueNoteEdit } from "../store.js";
import { tradeLabel } from "./JobView.js";

const STATUS_LABELS: Record<Item["status"], string> = {
  open: "Open", in_progress: "In progress", ready_for_check: "Ready for check", verified: "Verified",
};

export function ItemDetails({ item, data, user, online, patchItem, startPlacement, announce, refresh, onClose, setDialog }: {
  item: Item;
  data: JobData;
  user: User | null;
  online: boolean;
  patchItem: (changes: Record<string, unknown>) => Promise<void>;
  startPlacement: () => void;
  announce: (message: string) => void;
  refresh: () => Promise<void>;
  onClose: () => void;
  setDialog: (dialog: { title: string; body: React.ReactNode } | null) => void;
}): JSX.Element {
  const [noteBody, setNoteBody] = useState("");
  const [noteAudience, setNoteAudience] = useState("everyone");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editNote, setEditNote] = useState<{ id: string; original: string; base: number } | null>(null);
  const [editBody, setEditBody] = useState("");
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);

  const role = data.job.my_role;
  const job = data.job;
  const crew = role === "owner" || role === "lead";
  const itemNumber = item.number === -1 ? "" : item.number;

  const mayPin = crew || (role === "homeowner" && item.created_by.name === user?.name && item.created_by.role === "homeowner");
  const mayDefectPhoto = crew;
  const mayCompletionPhoto = crew || (role === "trade" && item.trade === job.my_trade);
  const mayDelete = role === "owner" ? item.status !== "verified" : role === "lead" && item.status === "open" && item.created_by.name === user?.name && item.created_by.role === "lead";
  const mayEditNote = (note: Note): boolean => crew || note.author.name === user?.name;

  const postNote = async (): Promise<void> => {
    if (noteBody.trim() === "") return;
    const body = noteBody.trim();
    const audience = role === "homeowner" ? "everyone" : noteAudience;
    if (!online) {
      queueNote(job.id, item.id, body, audience, replyTo ?? undefined);
      announce("Waiting to sync");
      setNoteBody("");
      return;
    }
    try {
      await api("POST", `/api/jobs/${job.id}/items/${item.id}/notes`, { body, audience, parent_id: replyTo ?? undefined });
      announce("Note posted.");
      setNoteBody("");
      setReplyTo(null);
      await refresh();
    } catch (err) {
      announce(`Not saved: ${(err as { message?: string }).message}`);
    }
  };

  const saveNoteEdit = async (): Promise<void> => {
    if (editNote === null) return;
    // One edit: the longest common start, then the longest common end of the
    // rest, counting code points.
    const a = [...editNote.original];
    const b = [...editBody];
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    let end = 0;
    while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
    const pos = start;
    const del = a.length - start - end;
    const insert = b.slice(start, b.length - end).join("");
    if (!online) {
      queueNoteEdit(job.id, item.id, editNote.id, editNote.base, pos, del, insert);
      announce("Waiting to sync");
      setEditNote(null);
      return;
    }
    try {
      await api("POST", `/api/jobs/${job.id}/items/${item.id}/notes/${editNote.id}/edits`, { base_rev: editNote.base, pos, delete: del, insert });
      announce("Note updated.");
      setEditNote(null);
      await refresh();
    } catch (err) {
      announce(`Not saved: ${(err as { message?: string }).message}`);
    }
  };

  const noteAction = async (note: Note, action: "undo" | "redo"): Promise<void> => {
    try {
      await api("POST", `/api/jobs/${job.id}/items/${item.id}/notes/${note.id}/${action}`);
      announce(action === "undo" ? "Edit undone." : "Edit redone.");
      await refresh();
    } catch (err) {
      announce(`Not saved: ${(err as { message?: string }).message}`);
    }
  };

  const uploadPhoto = async (file: File, kind: "defect" | "completion"): Promise<void> => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("kind", kind);
      await api("POST", `/api/jobs/${job.id}/items/${item.id}/photos`, undefined, { multipart: form });
      announce("Photo saved.");
      await refresh();
    } catch (err) {
      announce(`Not saved: ${(err as { message?: string }).message}`);
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = async (photoId: string): Promise<void> => {
    setRemoving(true);
    try {
      await api("DELETE", `/api/jobs/${job.id}/photos/${photoId}`);
      announce("Photo removed.");
      await refresh();
    } catch (err) {
      announce(`Not saved: ${(err as { message?: string }).message}`);
    } finally {
      setRemoving(false);
    }
  };

  const itemAction = async (action: string, reason?: string): Promise<void> => {
    try {
      const updated = await api<Item>("POST", `/api/jobs/${job.id}/items/${item.id}/actions`, { action, reason });
      announce(`Item ${itemNumber}: ${STATUS_LABELS[updated.status]}.`);
      await refresh();
    } catch (err) {
      announce(`Not saved: ${(err as { message?: string }).message}`);
    }
  };

  return (
    <div className="item-details" role="region" aria-label={`Item ${itemNumber} details`}>
      <div className="grid2">
        {crew ? (
          <>
            <div className="field">
              <label htmlFor={`title-${item.id}`}>Title</label>
              <input
                id={`title-${item.id}`} type="text" defaultValue={item.title}
                onBlur={(e) => { if (e.target.value !== item.title) void patchItem({ title: e.target.value }); }}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
              />
            </div>
            <div className="field">
              <label htmlFor={`room-${item.id}`}>Room</label>
              <select id={`room-${item.id}`} value={item.room_id} onChange={(e) => { void patchItem({ room_id: e.target.value }); }}>
                {data.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`trade-${item.id}`}>Trade</label>
              <select
                id={`trade-${item.id}`} value={item.trade ?? "none"}
                onChange={(e) => { void patchItem({ trade: e.target.value === "none" ? null : e.target.value }); }}
              >
                <option value="none">No trade</option>
                {(Object.keys(TRADE_LABELS) as TradeKey[]).map((t) => <option key={t} value={t}>{TRADE_LABELS[t]}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`costnote-${item.id}`}>Cost note</label>
              <input
                id={`costnote-${item.id}`} type="text" defaultValue={item.cost_note ?? ""}
                onBlur={(e) => { if (e.target.value !== (item.cost_note ?? "")) void patchItem({ cost_note: e.target.value }); }}
              />
            </div>
            <div className="field">
              <label htmlFor={`qty-${item.id}`}>Quantity</label>
              <input
                id={`qty-${item.id}`} type="text" defaultValue={item.quantity ?? ""}
                onBlur={(e) => { if (e.target.value !== (item.quantity ?? "")) void patchItem({ quantity: e.target.value === "" ? null : e.target.value }); }}
              />
            </div>
            <div className="field">
              <label htmlFor={`unit-${item.id}`}>Unit cost</label>
              <input
                id={`unit-${item.id}`} type="text" defaultValue={item.unit_cost ?? ""}
                onBlur={(e) => { if (e.target.value !== (item.unit_cost ?? "")) void patchItem({ unit_cost: e.target.value === "" ? null : e.target.value }); }}
              />
            </div>
          </>
        ) : (
          <>
            <p><strong>Title</strong> {item.title}</p>
            <p><strong>Trade</strong> {tradeLabel(item.trade)}</p>
          </>
        )}
      </div>

      {crew && <p className="line-total">Line total {money(item.line_total ?? "0.00")}</p>}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "10px 0" }}>
        {mayPin && <button type="button" onClick={startPlacement}>Place pin</button>}
        {crew && (
          <button type="button" disabled={!online} onClick={() => {
            setDialog({
              title: `Waits on item ${itemNumber}`,
              body: (
                <WaitsOnDialog item={item} data={data} onClose={() => setDialog(null)} onConfirm={async (ids) => {
                  await api("PUT", `/api/jobs/${job.id}/items/${item.id}/blocked-by`, { item_ids: ids });
                  announce(`Item ${itemNumber} saved.`);
                  setDialog(null);
                  await refresh();
                }} />
              ),
            });
          }}>Waits on</button>
        )}
        {crew && item.status === "ready_for_check" && (
          <button type="button" onClick={() => {
            setDialog({
              title: `Send back item ${itemNumber}`,
              body: (
                <SendBackDialog onClose={() => setDialog(null)} onConfirm={async (reason) => {
                  await itemAction("send_back", reason);
                  setDialog(null);
                }} />
              ),
            });
          }}>Send back</button>
        )}
        {role === "owner" && item.status === "verified" && (
          <button type="button" onClick={() => { void itemAction("reopen"); }}>Reopen item {itemNumber}</button>
        )}
        {mayDelete && (
          <button type="button" disabled={!online} onClick={() => {
            setDialog({
              title: `Delete item ${itemNumber}`,
              body: (
                <DeleteDialog onClose={() => setDialog(null)} onConfirm={async () => {
                  await api("DELETE", `/api/jobs/${job.id}/items/${item.id}`);
                  announce(`Item ${itemNumber} deleted.`);
                  setDialog(null);
                  onClose();
                  await refresh();
                }} />
              ),
            });
          }}>Delete item {itemNumber}</button>
        )}
      </div>

      {(mayDefectPhoto || mayCompletionPhoto) && (
        <div style={{ display: "flex", gap: 14, margin: "10px 0", flexWrap: "wrap" }}>
          {mayDefectPhoto && (
            <span>
              <label htmlFor={`defect-${item.id}`}>Add defect photo</label>
              <input
                id={`defect-${item.id}`} type="file" accept="image/jpeg,image/png,image/webp" disabled={!online}
                onChange={(e) => { const f = e.target.files?.[0]; if (f !== undefined) void uploadPhoto(f, "defect"); }}
              />
            </span>
          )}
          {mayCompletionPhoto && (
            <span>
              <label htmlFor={`completion-${item.id}`}>Add completion photo</label>
              <input
                id={`completion-${item.id}`} type="file" accept="image/jpeg,image/png,image/webp" disabled={!online}
                onChange={(e) => { const f = e.target.files?.[0]; if (f !== undefined) void uploadPhoto(f, "completion"); }}
              />
            </span>
          )}
          {!online && <span className="item-pending">Photos need a connection.</span>}
          {uploading && <span className="item-pending">Photo uploading</span>}
        </div>
      )}

      {item.photos.length > 0 && (
        <div>
          <p><strong>Photos</strong></p>
          <div className="photos-list" aria-label="Photos">
            {item.photos.map((photo, index) => (
              <span key={photo.id}>
                <img src={photo.url} alt={`${photo.kind} photo`} />
                <br />
                <button
                  type="button" className="quiet" disabled={removing}
                  onClick={() => { void removePhoto(photo.id); }}
                  aria-label={`Remove photo ${index + 1}`}
                >
                  Remove photo {index + 1}
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <p><strong>Notes</strong></p>
        {item.notes.map((note) => (
          <div key={note.id}>
            <NoteBlock
              note={note} online={online} mayEdit={mayEditNote(note)}
              editing={editNote?.id === note.id} editValue={editBody}
              onStartEdit={() => {
                setEditNote({ id: note.id, original: note.body, base: note.rev });
                setEditBody(note.body);
              }}
              onEditChange={setEditBody}
              onSave={() => { void saveNoteEdit(); }}
              onCancel={() => setEditNote(null)}
              onUndo={() => { void noteAction(note, "undo"); }}
              onRedo={() => { void noteAction(note, "redo"); }}
              onReply={() => { setReplyTo(note.id); }}
            />
            {(note.replies ?? []).map((reply) => (
              <NoteBlock
                key={reply.id} note={reply} online={online} mayEdit={mayEditNote(reply)}
                editing={editNote?.id === reply.id} editValue={editBody}
                onStartEdit={() => {
                  setEditNote({ id: reply.id, original: reply.body, base: reply.rev });
                  setEditBody(reply.body);
                }}
                onEditChange={setEditBody}
                onSave={() => { void saveNoteEdit(); }}
                onCancel={() => setEditNote(null)}
                onUndo={() => { void noteAction(reply, "undo"); }}
                onRedo={() => { void noteAction(reply, "redo"); }}
                onReply={() => undefined}
              />
            ))}
          </div>
        ))}
        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          <label htmlFor={`note-${item.id}`}>{replyTo === null ? "Add a note" : "Reply"}</label>
          <textarea id={`note-${item.id}`} value={noteBody} onChange={(e) => setNoteBody(e.target.value)} />
          {role !== "homeowner" && (
            <span>
              <label htmlFor={`audience-${item.id}`}>Who can see this</label>
              <select id={`audience-${item.id}`} value={noteAudience} onChange={(e) => setNoteAudience(e.target.value)}>
                <option value="crew">Crew only</option>
                <option value="everyone">Everyone</option>
              </select>
            </span>
          )}
          <div>
            <button type="button" className="primary" onClick={() => { void postNote(); }}>
              {replyTo === null ? "Post note" : "Reply"}
            </button>
            {replyTo !== null && <button type="button" className="quiet" onClick={() => setReplyTo(null)}>Cancel reply</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function NoteBlock({ note, online, mayEdit, editing, editValue, onStartEdit, onEditChange, onSave, onCancel, onUndo, onRedo, onReply }: {
  note: Note;
  online: boolean;
  mayEdit: boolean;
  editing: boolean;
  editValue: string;
  onStartEdit: () => void;
  onEditChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onReply: () => void;
}): JSX.Element {
  return (
    <div className="note">
      {editing ? (
        <div>
          <label htmlFor={`edit-note-${note.id}`}>Edit note</label>
          <textarea id={`edit-note-${note.id}`} value={editValue} onChange={(e) => onEditChange(e.target.value)} />
          <div style={{ marginTop: 6 }}>
            <button type="button" className="primary" onClick={onSave}>Save note</button>
            <button type="button" className="quiet" onClick={onCancel}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <p>{note.body}</p>
          <p className="note-meta">{note.author.name} · {note.audience === "crew" ? "Crew only" : "Everyone"} · rev {note.rev}</p>
          <div className="row-actions" style={{ margin: "4px 0" }}>
            {mayEdit && <button type="button" className="quiet" onClick={onStartEdit}>Edit note</button>}
            {mayEdit && <button type="button" className="quiet" disabled={!online} onClick={onUndo}>Undo my edit</button>}
            {mayEdit && <button type="button" className="quiet" disabled={!online} onClick={onRedo}>Redo my edit</button>}
            {note.replies !== undefined && <button type="button" className="quiet" onClick={onReply}>Reply</button>}
          </div>
        </>
      )}
    </div>
  );
}

function WaitsOnDialog({ item, data, onClose, onConfirm }: {
  item: Item; data: JobData; onClose: () => void; onConfirm: (ids: string[]) => Promise<void>;
}): JSX.Element {
  const [checked, setChecked] = useState<string[]>(
    data.items.filter((other) => item.blocked_by.includes(other.number)).map((other) => other.id),
  );
  return (
    <div>
      {data.items.filter((other) => other.id !== item.id).map((other) => (
        <div className="field" key={other.id}>
          <label>
            <input
              type="checkbox" checked={checked.includes(other.id)}
              onChange={(e) => {
                setChecked((prev) => (e.target.checked ? [...prev, other.id] : prev.filter((id) => id !== other.id)));
              }}
            />
            {`Item ${other.number}: ${other.title}`}
          </label>
        </div>
      ))}
      <div className="row">
        <button type="button" className="primary" onClick={() => { void onConfirm(checked); }}>Save</button>
      </div>
    </div>
  );
}

function SendBackDialog({ onClose, onConfirm }: { onClose: () => void; onConfirm: (reason: string) => Promise<void> }): JSX.Element {
  const [reason, setReason] = useState("");
  return (
    <div>
      <div className="field">
        <label htmlFor="send-back-reason">Reason</label>
        <input id="send-back-reason" type="text" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className="row">
        <button type="button" className="primary" onClick={() => { void onConfirm(reason); }}>Send back item</button>
      </div>
    </div>
  );
}

function DeleteDialog({ onClose, onConfirm }: { onClose: () => void; onConfirm: () => Promise<void> }): JSX.Element {
  return (
    <div>
      <p>Delete this item? Its photos go too.</p>
      <div className="row">
        <button type="button" className="primary" onClick={() => { void onConfirm(); }}>Delete item</button>
      </div>
    </div>
  );
}
