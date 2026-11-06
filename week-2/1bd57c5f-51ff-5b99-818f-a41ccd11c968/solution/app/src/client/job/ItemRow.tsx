import { Camera, Check, CheckCheck, Link2, MapPin, Pencil, Play, Redo2, RotateCcw, Trash2, Undo2 } from "lucide-react";
import { useEffect, useId, useState, type KeyboardEvent } from "react";
import {
  STATUS_LABELS,
  TRADES,
  TRADE_LABELS,
  isCrew,
  isTrade,
  tradeLabel,
  type Item,
  type ItemAction,
  type Note,
  type NoteAudience,
  mayEditNote,
  type Reply,
} from "../../shared/domain";
import { PHOTO_UPLOADERS, actionsFrom, deletion } from "../../shared/lifecycle";
import { formatDollars, lineTotal } from "../../shared/money";
import { Dialog } from "../components/Dialog";
import { StatusGlyph } from "../components/Glyphs";
import { COPY, numberText } from "../copy";
import { isMe, isTextField, useJob } from "./context";

/** A text field that saves when focus leaves it or on Enter, keeping the typed value while editing. */
function InlineText({ label, value, multiline, wide, required, mono, onSave }: {
  label: string;
  value: string;
  multiline?: boolean;
  wide?: boolean;
  required?: boolean;
  mono?: boolean;
  onSave: (value: string) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);
  const commit = () => {
    const next = draft.trim();
    if (next === value.trim() || (required && next === "")) {
      if (required && next === "") setDraft(value);
      return;
    }
    onSave(next);
  };
  const shared = {
    id,
    className: mono ? "input mono" : "input",
    value: draft,
    onFocus: () => setEditing(true),
    onBlur: () => {
      setEditing(false);
      commit();
    },
  };
  return (
    <div className={multiline || wide ? "field field--wide" : "field"}>
      <label htmlFor={id}>{label}</label>
      {multiline ? (
        <textarea {...shared} rows={2} onChange={(event) => setDraft(event.target.value)} />
      ) : (
        <input
          {...shared}
          inputMode={mono ? "decimal" : undefined}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
          }}
        />
      )}
    </div>
  );
}

function SendBack({ item }: { item: Item }) {
  const { session } = useJob();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const id = useId();
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        <Undo2 size={16} aria-hidden="true" />
        Send back
      </button>
      <Dialog open={open} title={`Send back item ${numberText(item.number)}`} onClose={() => setOpen(false)}>
        <form
          className="stack"
          noValidate
          onSubmit={async (event) => {
            event.preventDefault();
            if (reason.trim() === "") {
              setError("Say what needs another look.");
              return;
            }
            setOpen(false);
            setReason("");
            setError("");
            await session.act(item, "send_back", reason.trim());
          }}
        >
          <div className="field">
            <label htmlFor={id}>Reason</label>
            <textarea id={id} className="input" value={reason} onChange={(event) => setReason(event.target.value)} aria-invalid={error ? true : undefined} />
            {error && <p className="field-error">{error}</p>}
          </div>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary">
              Send back item
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

function WaitsOn({ item }: { item: Item }) {
  const { session, online } = useJob();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const others = session.view().items.filter((other) => other.id !== item.id && other.number > 0).sort((a, b) => a.number - b.number);
  return (
    <>
      <button
        type="button"
        className="btn"
        disabled={!online}
        onClick={() => {
          setChosen(new Set(others.filter((other) => item.blocked_by.includes(other.number)).map((other) => other.id)));
          setOpen(true);
        }}
      >
        <Link2 size={16} aria-hidden="true" />
        Waits on
      </button>
      <Dialog open={open} title={`Waits on item ${numberText(item.number)}`} onClose={() => setOpen(false)}>
        <form
          className="stack"
          onSubmit={async (event) => {
            event.preventDefault();
            setPending(true);
            const saved = await session.setBlockers(item, [...chosen]);
            setPending(false);
            if (saved) setOpen(false);
          }}
        >
          <fieldset className="fieldset">
            <legend>Items this one waits on (up to 10)</legend>
            <div className="checks">
              {others.map((other) => (
                <label key={other.id} className="check">
                  <input
                    type="checkbox"
                    checked={chosen.has(other.id)}
                    onChange={(event) => {
                      const next = new Set(chosen);
                      if (event.target.checked) next.add(other.id);
                      else next.delete(other.id);
                      setChosen(next);
                    }}
                  />
                  <span>
                    Item <span className="mono">{numberText(other.number)}</span>: {other.title}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={pending} aria-busy={pending}>
              Save
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

function DeleteItem({ item }: { item: Item }) {
  const { session, online, clearSelection } = useJob();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const remove = async () => {
    const rows = [...document.querySelectorAll<HTMLElement>("[data-row-id]")];
    const index = rows.findIndex((row) => row.dataset.rowId === item.id);
    const next = rows[index + 1] ?? rows[index - 1] ?? null;
    setPending(true);
    const deleted = await session.deleteItem(item);
    setPending(false);
    if (!deleted) return;
    setOpen(false);
    clearSelection();
    requestAnimationFrame(() => (next?.isConnected ? next : document.querySelector<HTMLElement>("[data-quick-add]"))?.focus());
  };
  return (
    <>
      <button type="button" className="btn btn--danger" disabled={!online} onClick={() => setOpen(true)}>
        <Trash2 size={16} aria-hidden="true" />
        Delete item {numberText(item.number)}
      </button>
      <Dialog open={open} title={`Delete item ${numberText(item.number)}`} onClose={() => setOpen(false)}>
        <p>
          “{item.title}” leaves the punch list for everyone, with its photos and notes. Its number is not used again.
        </p>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={pending} aria-busy={pending} onClick={() => void remove()}>
            Delete item
          </button>
        </div>
      </Dialog>
    </>
  );
}

/** A note's text with its edit, undo and redo controls for those who may edit it. */
function NoteText({ item, note }: { item: Item; note: Reply }) {
  const { session, role, user, online, readOnly } = useJob();
  const [editing, setEditing] = useState<{ base: number; original: string; draft: string } | null>(null);
  const [pending, setPending] = useState(false);
  const fieldId = useId();
  const mayEdit = !readOnly && mayEditNote(role, isMe(note.author, user, role));
  return (
    <>
      {editing ? (
        <form
          className="stack"
          onSubmit={async (event) => {
            event.preventDefault();
            setPending(true);
            const saved = await session.editNote(item, note, editing.base, editing.original, editing.draft);
            setPending(false);
            if (saved) setEditing(null);
          }}
        >
          <div className="field">
            <label htmlFor={fieldId}>Edit note</label>
            <textarea
              id={fieldId}
              className="input"
              rows={3}
              value={editing.draft}
              onChange={(event) => setEditing({ ...editing, draft: event.target.value })}
            />
          </div>
          <div className="note-tools">
            <button type="submit" className="btn btn--primary btn--small" disabled={pending} aria-busy={pending}>
              Save note
            </button>
            <button type="button" className="btn btn--small" onClick={() => setEditing(null)}>
              Cancel edit
            </button>
          </div>
        </form>
      ) : (
        <p className="note-body">{note.body}</p>
      )}
      {mayEdit && !editing && (
        <div className="note-tools">
          <button type="button" className="btn btn--quiet btn--small" onClick={() => setEditing({ base: note.rev, original: note.body, draft: note.body })}>
            <Pencil size={14} aria-hidden="true" />
            Edit note
          </button>
          <button type="button" className="btn btn--quiet btn--small" disabled={!online} onClick={() => void session.undoRedo(item, note, "undo")}>
            <Undo2 size={14} aria-hidden="true" />
            Undo my edit
          </button>
          <button type="button" className="btn btn--quiet btn--small" disabled={!online} onClick={() => void session.undoRedo(item, note, "redo")}>
            <Redo2 size={14} aria-hidden="true" />
            Redo my edit
          </button>
        </div>
      )}
    </>
  );
}

function NoteThread({ item, note }: { item: Item; note: Note }) {
  const { session, readOnly, role } = useJob();
  const [replying, setReplying] = useState(false);
  const [body, setBody] = useState("");
  const id = useId();
  const meta = (author: Note["author"], audience: NoteAudience, at: string) => (
    <span className="note-meta">
      {author.name} · <span className="audience-tag">{audience === "crew" ? "Crew only" : "Everyone"}</span> ·{" "}
      <span className="mono">{new Date(at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span>
    </span>
  );
  const canReply = !readOnly && !(role === "homeowner" && note.audience === "crew");
  return (
    <li className="note">
      {meta(note.author, note.audience, note.created_at)}
      <NoteText item={item} note={note} />
      {note.replies.length > 0 && (
        <ul className="replies">
          {note.replies.map((reply) => (
            <li key={reply.id} className="note">
              {meta(reply.author, reply.audience, reply.created_at)}
              <NoteText item={item} note={reply} />
            </li>
          ))}
        </ul>
      )}
      {canReply &&
        (replying ? (
          <form
            className="note-form"
            onSubmit={async (event) => {
              event.preventDefault();
              if (body.trim() === "") return;
              const text = body.trim();
              setBody("");
              setReplying(false);
              await session.note(item, text, note.audience, note.id);
            }}
          >
            <div className="field">
              <label htmlFor={id}>Reply</label>
              <input id={id} className="input" value={body} onChange={(event) => setBody(event.target.value)} />
            </div>
            <button type="submit" className="btn">
              Post reply
            </button>
          </form>
        ) : (
          <div>
            <button type="button" className="btn btn--quiet btn--small" onClick={() => setReplying(true)}>
              Reply
            </button>
          </div>
        ))}
    </li>
  );
}

function Notes({ item }: { item: Item }) {
  const { session, readOnly, role } = useJob();
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<NoteAudience>(role === "homeowner" ? "everyone" : "crew");
  const bodyId = useId();
  const audienceId = useId();
  return (
    <div className="stack">
      <h3 className="section-title">Notes</h3>
      {item.notes.length > 0 ? (
        <ul className="notes">
          {item.notes.map((note) => (
            <NoteThread key={note.id} item={item} note={note} />
          ))}
        </ul>
      ) : (
        <p className="muted">No notes yet.</p>
      )}
      {!readOnly && (
        <form
          className="stack"
          onSubmit={async (event) => {
            event.preventDefault();
            if (body.trim() === "") return;
            const text = body.trim();
            setBody("");
            await session.note(item, text, audience, null);
          }}
        >
          <div className="field">
            <label htmlFor={bodyId}>Add a note</label>
            <textarea id={bodyId} className="input" rows={2} value={body} onChange={(event) => setBody(event.target.value)} />
          </div>
          <div className="note-form">
            {role !== "homeowner" ? (
              <div className="field">
                <label htmlFor={audienceId}>Who can see this</label>
                <select id={audienceId} className="input" value={audience} onChange={(event) => setAudience(event.target.value as NoteAudience)}>
                  <option value="crew">Crew only</option>
                  <option value="everyone">Everyone</option>
                </select>
              </div>
            ) : (
              <p className="hint">Everyone on the job can see your notes.</p>
            )}
            <button type="submit" className="btn btn--primary">
              Post note
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function Photos({ item }: { item: Item }) {
  const { session, role, online, readOnly, user } = useJob();
  const crew = isCrew(role);
  const kinds = readOnly ? [] : (["defect", "completion"] as const).filter((kind) => PHOTO_UPLOADERS[kind].includes(role));
  const listId = useId();
  return (
    <div className="stack">
      <h3 className="section-title" id={listId}>
        Photos
      </h3>
      <ul className="photos" aria-labelledby={listId}>
        {item.photos.map((photo, index) => (
          <li key={photo.id} className="photo">
            <img src={photo.url} alt={`${photo.kind === "defect" ? "Defect" : "Completion"} photo ${index + 1} of item ${numberText(item.number)}`} loading="lazy" />
            <span className="photo-meta">
              {photo.kind === "defect" ? "Defect" : "Completion"} · {photo.uploaded_by.name}
            </span>
            {!readOnly && (crew || photo.uploaded_by.name === user.name) && (
              <button type="button" className="btn btn--small" disabled={!online} onClick={() => void session.removePhoto(item, photo)}>
                Remove photo {index + 1}
              </button>
            )}
          </li>
        ))}
      </ul>
      {item.photos.length === 0 && <p className="muted">No photos yet.</p>}
      {kinds.length > 0 && (
        <div className="detail-actions">
          {kinds.map((kind) => {
            const label = kind === "defect" ? "Add defect photo" : "Add completion photo";
            return (
              <label key={kind} className={online ? "btn file-button" : "btn file-button is-disabled"}>
                <Camera size={16} aria-hidden="true" />
                {label}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  aria-label={label}
                  disabled={!online || item.number === 0}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void session.uploadPhoto(item, kind, file);
                  }}
                />
              </label>
            );
          })}
          {!online && <p className="hint">{COPY.photosOffline}</p>}
        </div>
      )}
    </div>
  );
}

function Details({ item }: { item: Item }) {
  const { session, role, readOnly, canPlace, startPlacement, job, user } = useJob();
  const rooms = session.view().rooms;
  const crew = isCrew(role);
  const editable = crew && !readOnly;
  const roomId = useId();
  const tradeId = useId();
  const roomName = rooms.find((room) => room.id === item.room_id)?.name ?? "";
  const actions = actionsFrom(item.status, role);
  return (
    <section className="details" aria-label={`Item ${numberText(item.number)} details`} onClick={(event) => event.stopPropagation()}>
      {editable ? (
        <div className="details-grid">
          <InlineText label="Title" value={item.title} wide required onSave={(title) => void session.edit(item, { title })} />
          <div className="field">
            <label htmlFor={roomId}>Room</label>
            <select id={roomId} className="input" value={item.room_id} onChange={(event) => void session.edit(item, { room_id: event.target.value })}>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={tradeId}>Trade</label>
            <select
              id={tradeId}
              className="input"
              value={item.trade ?? ""}
              onChange={(event) => void session.edit(item, { trade: isTrade(event.target.value) ? event.target.value : null })}
            >
              <option value="">No trade</option>
              {TRADES.map((trade) => (
                <option key={trade} value={trade}>
                  {TRADE_LABELS[trade]}
                </option>
              ))}
            </select>
          </div>
          <InlineText
            label="Cost note"
            value={item.cost_note ?? ""}
            multiline
            onSave={(note) => void session.edit(item, { cost_note: note === "" ? null : note })}
          />
          <InlineText label="Quantity" value={item.quantity ?? ""} mono onSave={(quantity) => void session.edit(item, { quantity: quantity === "" ? null : quantity })} />
          <InlineText label="Unit cost" value={item.unit_cost ?? ""} mono onSave={(cost) => void session.edit(item, { unit_cost: cost === "" ? null : cost })} />
          <p className="line-total field--wide">
            Line total <span className="mono">{formatDollars(lineTotal(item.quantity ?? null, item.unit_cost ?? null))}</span>
          </p>
        </div>
      ) : (
        <dl className="readonly-list">
          <dt>Room</dt>
          <dd>{roomName}</dd>
          <dt>Trade</dt>
          <dd>{tradeLabel(item.trade)}</dd>
          <dt>Status</dt>
          <dd>{STATUS_LABELS[item.status]}</dd>
          {crew && item.cost_note && (
            <>
              <dt>Cost note</dt>
              <dd>{item.cost_note}</dd>
            </>
          )}
        </dl>
      )}
      {readOnly && crew && (
        <p className="line-total">
          Line total <span className="mono">{formatDollars(lineTotal(item.quantity ?? null, item.unit_cost ?? null))}</span>
        </p>
      )}
      {item.sent_back_reason && (
        <p className="form-error">
          <strong>Sent back:</strong> {item.sent_back_reason}
        </p>
      )}
      {!readOnly && (
        <div className="detail-actions">
          {canPlace(item) && (
            <button type="button" className="btn" onClick={(event) => startPlacement(item, event.currentTarget.closest("li"))}>
              <MapPin size={16} aria-hidden="true" />
              Place pin
            </button>
          )}
          {crew && item.number > 0 && <WaitsOn item={item} />}
          {actions.includes("send_back") && <SendBack item={item} />}
          {actions.includes("reopen") && (
            <button type="button" className="btn" onClick={() => void session.act(item, "reopen")}>
              <RotateCcw size={16} aria-hidden="true" />
              Reopen item {numberText(item.number)}
            </button>
          )}
          {item.number > 0 && deletion(role, item.status, isMe(item.created_by, user, role)) === "allowed" && <DeleteItem item={item} />}
        </div>
      )}
      <Photos item={item} />
      <Notes item={item} />
      <p className="hint">
        Added by {item.created_by.name} on {job.name}.
      </p>
    </section>
  );
}

const ROW_ACTIONS: Array<{ action: ItemAction; label: (n: string) => string; text: string; icon: typeof Play }> = [
  { action: "start", label: (n) => `Start item ${n}`, text: "Start", icon: Play },
  { action: "mark_done", label: (n) => `Mark item ${n} done`, text: "Done", icon: CheckCheck },
  { action: "verify", label: (n) => `Check off item ${n}`, text: "Check off", icon: Check },
];

export function ItemRow({ item, waiting, note, uploading }: { item: Item; waiting: boolean; note: string | undefined; uploading: boolean }) {
  const { session, role, readOnly, reduced, selectedId, select, clearSelection, startPlacement, canPlace } = useJob();
  const selected = selectedId === item.id;
  const roomName = session.view().rooms.find((room) => room.id === item.room_id)?.name ?? "";
  const draggable = !readOnly && canPlace(item) && matchMedia("(pointer: fine)").matches;
  const n = numberText(item.number);

  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>) => {
    const own = event.target === event.currentTarget;
    if ((event.key === "p" || event.key === "P") && !event.ctrlKey && !event.metaKey && !event.altKey && !isTextField(event.target)) {
      if (!readOnly && canPlace(item)) {
        event.preventDefault();
        startPlacement(item, event.currentTarget);
      }
    } else if (own && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      select(item);
    } else if (event.key === "Escape" && selected && !isTextField(event.target)) {
      event.preventDefault();
      clearSelection();
      event.currentTarget.focus();
    }
  };

  return (
    <li
      className="row"
      tabIndex={0}
      aria-label={`Item ${n}: ${item.title}`}
      aria-current={selected ? "true" : undefined}
      data-row-id={item.id}
      draggable={draggable}
      onDragStart={(event) => {
        event.dataTransfer.setData("application/x-snaglight-item", item.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      onKeyDown={onKeyDown}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button, a, input, select, textarea, label, .details")) return;
        select(item);
      }}
    >
      <div className="row-main">
        <span className="row-num mono" aria-hidden="true">
          {n}
        </span>
        <div className="row-body">
          <span className="row-title">{item.title}</span>
          <span className="row-meta">
            <span>{tradeLabel(item.trade)}</span>
            <span className={`status status--${item.status}`}>
              <StatusGlyph status={item.status} />
              {STATUS_LABELS[item.status]}
            </span>
            {item.pin && (
              <span className="pin-glyph" aria-hidden="true">
                <MapPin size={14} />
              </span>
            )}
            {item.pin_status === "needs_review" && <span className="review-text">{COPY.needsReview}</span>}
            {item.blocked_by.length > 0 && <span className="mono">Waiting on {item.blocked_by.join(", ")}</span>}
          </span>
          {waiting && <span className="row-text row-text--sync">{COPY.waiting}</span>}
          {note && <span className="row-text row-text--error">{note}</span>}
          {uploading && <span className="row-text">{COPY.uploading}</span>}
          {selected && reduced && item.pin && <span className="row-text">Pinned in {roomName}</span>}
        </div>
        {!readOnly && (
          <div className="row-actions">
            {ROW_ACTIONS.filter((spec) => actionsFrom(item.status, role).includes(spec.action)).map((spec) => {
              const { action, icon: Icon } = spec;
              return (
                <button key={action} type="button" className="btn btn--small" aria-label={spec.label(n)} onClick={() => void session.act(item, action)}>
                  <Icon size={16} aria-hidden="true" />
                  <span className="row-action-text">{spec.text}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      {selected && <Details item={item} />}
    </li>
  );
}
