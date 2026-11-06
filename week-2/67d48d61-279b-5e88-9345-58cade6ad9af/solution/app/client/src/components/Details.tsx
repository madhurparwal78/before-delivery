// Task details: properties, links, sub-tasks, attachments and the activity feed.

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  CREW,
  CYCLES,
  FIELD_MESSAGES,
  OPEN_STATUSES,
  PRIORITY_NAMES,
  canMove,
  STATUS_NAMES,
  crewByHandle,
  cycleName,
  departmentByKey,
  isEditable,
  type ActivityEntry,
  type Attachment,
  type AttachmentKind,
  type StatusKey,
  type Task,
} from "../../../shared/catalog";
import { Unreachable, get, upload } from "../api";
import { copy, stamp } from "../copy";
import { announce, editTask, linkTasks, navigate, noteAttachment, openDialog, shown, unlinkTasks, useApp } from "../store";
import { ErrorSummary, FieldError, Icon, StatusChip, Tape } from "./bits";
import { Modal, type ModalHandle } from "./Modal";

const EDITABLE_STATUSES: StatusKey[] = [...OPEN_STATUSES, "done", "cancelled"];

const valueName = (field: string, value: unknown): string => {
  if (value === null || value === "" || value === undefined) return "none";
  if (field === "status") return STATUS_NAMES[value as StatusKey] ?? String(value);
  if (field === "priority") return PRIORITY_NAMES[value as number] ?? String(value);
  if (field === "owner") return crewByHandle(value as string)?.name ?? String(value);
  if (field === "cycle") return cycleName(value as string) ?? String(value);
  if (field === "department") return departmentByKey(value as string)?.name ?? String(value);
  if (field === "details") return "new text";
  return String(value);
};

const describe = (entry: ActivityEntry): string => {
  const changes = Object.entries(entry.changes);
  const list = changes.map(([field, c]) => `${field.replace("_", " ")} ${valueName(field, c.from)} → ${valueName(field, c.to)}`).join("; ");
  switch (entry.kind) {
    case "created":
      return "Created the task";
    case "auto_closed":
      return "Closed it when its last sub-task was done";
    case "auto_reopened":
      return "Reopened it when a sub-task opened";
    case "linked":
      return changes[0]?.[0] === "blocks" ? `Now blocks ${String(changes[0][1].to)}` : `Now blocked by ${String(changes[0]?.[1].to)}`;
    case "unlinked":
      return changes[0]?.[0] === "blocks" ? `No longer blocks ${String(changes[0][1].from)}` : `No longer blocked by ${String(changes[0]?.[1].from)}`;
    case "attached":
      return `Attached ${String(changes[0]?.[1].to)}`;
    case "rolled":
      return `Rolled over to ${valueName("cycle", entry.changes.cycle?.to)}`;
    case "decided":
      return `Decided the request: ${list}`;
    case "undo":
      return `Undid a change: ${list}`;
    default:
      return list;
  }
};

const defaultKind = (dept: string | null): AttachmentKind => (dept === "lighting" ? "plot" : dept === "wardrobe" ? "rendering" : "sketch");

// A text field that saves when it loses focus or on Enter. The title is a one-line textarea that
// grows to show the whole title in the narrow properties column.
const TextProperty = ({ task, field, multiline }: { task: Task; field: "title" | "details"; multiline?: boolean }) => {
  const saved = task[field];
  const [draft, setDraft] = useState(saved);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setDraft(saved), [saved]);
  useLayoutEffect(() => {
    const el = box.current;
    if (multiline || !el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [draft, multiline]);
  const save = (): void => {
    if (draft !== saved) void editTask(task.id, { [field]: field === "title" ? draft.trim() : draft });
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && !(multiline && e.shiftKey)) {
      e.preventDefault();
      save();
    }
  };
  const id = `detail-${field}`;
  return (
    <div className="prop">
      <label htmlFor={id}>{field === "title" ? "Title" : "Details"}</label>
      <textarea
        ref={box}
        id={id}
        className={multiline ? undefined : "title-input"}
        rows={multiline ? 3 : 1}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={onKey}
      />
    </div>
  );
};

const LinkDialog = ({ task, opener, onClosed }: { task: Task; opener: Element | null; onClosed: () => void }) => {
  const app = useApp();
  const modal = useRef<ModalHandle>(null);
  const [choice, setChoice] = useState("");
  const [errors, setErrors] = useState<Record<string, string> | null>(null);
  const [sending, setSending] = useState(false);
  const candidates = [...app.tasks.values()]
    .filter((t) => t.id !== task.id && t.status !== "triage" && t.status !== "duplicate" && !task.blocks.includes(t.id))
    .sort((a, b) => a.number - b.number);
  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!choice) {
      setErrors({ blocks: FIELD_MESSAGES.blocksUnknown });
      return;
    }
    setSending(true);
    const outcome = await linkTasks(task.id, choice);
    setSending(false);
    if (outcome.fields) setErrors(outcome.fields);
    if (outcome.done) modal.current?.close();
  };
  return (
    <Modal ref={modal} label="Add blocked task" variant="dialog" opener={opener} onClosed={onClosed}>
      <form className="dialog-form" onSubmit={(e) => void submit(e)} noValidate>
        <h2>Add blocked task</h2>
        <p className="dialog-lede">
          <span className="num">{task.id}</span> must finish before the task you choose can start.
        </p>
        {errors ? <ErrorSummary errors={errors} fieldIds={{ blocks: "link-task" }} /> : null}
        <div className="prop">
          <label htmlFor="link-task">Task</label>
          <select id="link-task" value={choice} onChange={(e) => setChoice(e.target.value)} data-autofocus aria-describedby={errors?.blocks ? "link-task-error" : undefined}>
            <option value="">Choose a task</option>
            {candidates.map((t) => (
              <option key={t.id} value={t.id}>
                {`${t.id} ${t.title}`}
              </option>
            ))}
          </select>
          <FieldError id="link-task-error" message={errors?.blocks} />
        </div>
        <div className="dialog-actions">
          <button type="submit" className="button primary" disabled={sending}>
            Add link
          </button>
          <button type="button" className="button" onClick={() => modal.current?.close()}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
};

const TaskRef = ({ id }: { id: string }) => {
  const t = shown(id);
  return (
    <>
      <span className="num">{id}</span>
      <span className="ref-title">{t?.title ?? ""}</span>
      {t ? <StatusChip status={t.status} /> : null}
    </>
  );
};

const Attachments = ({ task }: { task: Task }) => {
  const app = useApp();
  const serial = app.attachments.get(task.id) ?? 0;
  const [items, setItems] = useState<Attachment[] | null>(null);
  const [kind, setKind] = useState<AttachmentKind>(defaultKind(task.department));
  const [uploading, setUploading] = useState<{ name: string; progress: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let live = true;
    get<{ attachments: Attachment[] }>(`/api/tasks/${task.id}/attachments`)
      .then((r) => live && setItems(r.attachments))
      .catch(() => live && setItems([]));
    return () => {
      live = false;
    };
  }, [task.id, serial]);
  const send = async (file: File): Promise<void> => {
    const form = new FormData();
    form.append("kind", kind);
    form.append("file", file);
    setUploading({ name: file.name, progress: 0 });
    try {
      const reply = await upload(`/api/tasks/${task.id}/attachments`, form, {
        onProgress: (progress) => setUploading({ name: file.name, progress }),
      });
      if (reply.ok) {
        noteAttachment((reply.body as { attachment: Attachment }).attachment);
        announce(copy.attached(file.name, task.id));
      } else {
        announce(reply.error?.code === "storage_unavailable" ? copy.storageDown(file.name) : copy.notAttached(file.name));
      }
    } catch (error) {
      if (!(error instanceof Unreachable)) throw error;
      announce(copy.notAttached(file.name));
    } finally {
      setUploading(null);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <section className="detail-section" aria-labelledby="attachments-heading">
      <h3 id="attachments-heading">Attachments</h3>
      {items && items.length ? (
        <ul className="attachments" aria-label="Attachments">
          {items.map((a) => (
            <li key={a.id}>
              <a href={`/api/attachments/${a.id}/download`} target="_blank" rel="noreferrer">
                {a.file_name}
              </a>
              <span className="attachment-kind">{a.kind}</span>
              {a.current ? <span className="current-mark">Current</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{items ? copy.noAttachments : ""}</p>
      )}
      {uploading ? (
        <div className="uploading">
          <p>{`Uploading ${uploading.name}`}</p>
          <progress aria-label="Upload progress" max={1} value={uploading.progress} />
        </div>
      ) : null}
      <div className="attach-row">
        <div className="prop">
          <label htmlFor="attachment-kind">Attachment kind</label>
          <select id="attachment-kind" value={kind} onChange={(e) => setKind(e.target.value as AttachmentKind)}>
            <option value="sketch">Sketch</option>
            <option value="plot">Plot</option>
            <option value="rendering">Rendering</option>
          </select>
        </div>
        <label htmlFor="attach-file" className="button file-button">
          Attach file
        </label>
        <input
          ref={input}
          id="attach-file"
          className="visually-hidden"
          type="file"
          accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"
          disabled={uploading !== null}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void send(file);
          }}
        />
      </div>
    </section>
  );
};

const Activity = ({ task }: { task: Task }) => {
  const app = useApp();
  const serial = app.touched.get(task.id) ?? 0;
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  useEffect(() => {
    let live = true;
    get<{ activity: ActivityEntry[] }>(`/api/tasks/${task.id}/activity`)
      .then((r) => live && setEntries(r.activity))
      .catch(() => live && setEntries([]));
    return () => {
      live = false;
    };
  }, [task.id, serial]);
  const zone = app.production?.time_zone;
  return (
    <section className="detail-section activity" aria-labelledby="activity-heading">
      <h3 id="activity-heading">Activity</h3>
      <ol className="activity-list" aria-label="Activity">
        {(entries ?? []).map((e) => (
          <li key={e.id}>
            <span className="activity-who">{e.actor?.name ?? "Promptside"}</span>
            <time className="num" dateTime={e.at}>
              {zone ? stamp(e.at, zone) : ""}
            </time>
            <span className="activity-what">{describe(e)}</span>
          </li>
        ))}
        {entries && !entries.length ? <li className="muted">Nothing recorded yet.</li> : null}
      </ol>
    </section>
  );
};

export const DetailBody = ({ id, onClose, focusOnOpen }: { id: string; onClose: () => void; focusOnOpen: boolean }) => {
  const app = useApp();
  const task = shown(id);
  const heading = useRef<HTMLHeadingElement>(null);
  const [linking, setLinking] = useState<Element | null>(null);
  useLayoutEffect(() => {
    if (focusOnOpen) heading.current?.focus();
  }, [id, focusOnOpen]);
  if (!task) return null;
  const department = departmentByKey(task.department);
  const current = app.snapshot?.cycles.findIndex((c) => c.current) ?? 0;
  const editable = isEditable(task.status);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === "Escape" && !linking) {
      e.preventDefault();
      onClose();
    }
  };
  return (
    <div className="detail" onKeyDown={onKeyDown}>
      <div className="detail-head">
        <h2 ref={heading} tabIndex={-1} data-autofocus>
          <span className="num detail-id">{task.id}</span> {task.title}
        </h2>
        <button type="button" className="button icon-button" aria-label="Close details" onClick={onClose}>
          <Icon.close />
        </button>
      </div>
      <div className="detail-columns">
        <div className="properties">
          <TextProperty task={task} field="title" />
          <TextProperty task={task} field="details" multiline />
          <div className="prop">
            <label htmlFor="detail-status">Status</label>
            <select id="detail-status" value={task.status} disabled={!editable} onChange={(e) => void editTask(task.id, { status: e.target.value as StatusKey })}>
              {(editable ? EDITABLE_STATUSES : [task.status]).map((s) => (
                <option key={s} value={s} disabled={s !== task.status && !canMove(task.status, s)}>
                  {STATUS_NAMES[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="prop">
            <label htmlFor="detail-priority">Priority</label>
            <select id="detail-priority" value={task.priority} disabled={!editable} onChange={(e) => void editTask(task.id, { priority: Number(e.target.value) })}>
              {PRIORITY_NAMES.map((name, i) => (
                <option key={name} value={i}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div className="prop">
            <label htmlFor="detail-owner">Owner</label>
            <select id="detail-owner" value={task.owner ?? ""} disabled={!editable} onChange={(e) => void editTask(task.id, { owner: e.target.value || null })}>
              <option value="">No owner</option>
              {CREW.map((m) => (
                <option key={m.handle} value={m.handle}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div className="prop">
            <label htmlFor="detail-label">Label</label>
            <select id="detail-label" value={task.label ?? ""} disabled={!editable} onChange={(e) => void editTask(task.id, { label: e.target.value || null })}>
              <option value="">No label</option>
              {(department?.labels ?? []).map((l) => (
                <option key={l.key} value={l.key}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div className="prop">
            <label htmlFor="detail-cycle">Cycle</label>
            <select id="detail-cycle" value={task.cycle ?? ""} disabled={!editable || task.cycle === null} onChange={(e) => void editTask(task.id, { cycle: e.target.value })}>
              {task.cycle === null ? <option value="">No cycle</option> : null}
              {CYCLES.map((c, i) => (
                <option key={c.key} value={c.key} disabled={c.key !== task.cycle && i < current}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <dl className="facts">
            <div>
              <dt>Department</dt>
              <dd>{department ? <Tape dept={department.key} /> : "None"}</dd>
            </div>
            <div>
              <dt>Parent</dt>
              <dd>
                {task.parent ? (
                  <button type="button" className="link-button" onClick={() => navigate("/tasks", { row: task.parent, task: task.parent })}>
                    <TaskRef id={task.parent} />
                  </button>
                ) : (
                  "None"
                )}
              </dd>
            </div>
          </dl>
          <section className="detail-section" aria-labelledby="blocked-by-heading">
            <h3 id="blocked-by-heading">Blocked by</h3>
            <ul className="links" aria-label="Blocked by">
              {task.blocked_by.length ? (
                task.blocked_by.map((b) => (
                  <li key={b}>
                    <TaskRef id={b} />
                    <button type="button" className="button small" aria-label={`Remove link to ${b}`} onClick={() => void unlinkTasks(b, task.id)}>
                      <Icon.close />
                    </button>
                  </li>
                ))
              ) : (
                <li className="muted">Nothing blocks it.</li>
              )}
            </ul>
          </section>
          <section className="detail-section" aria-labelledby="blocks-heading">
            <h3 id="blocks-heading">Blocks</h3>
            <ul className="links" aria-label="Blocks">
              {task.blocks.length ? (
                task.blocks.map((b) => (
                  <li key={b}>
                    <TaskRef id={b} />
                    <button type="button" className="button small" aria-label={`Remove link to ${b}`} onClick={() => void unlinkTasks(task.id, b)}>
                      <Icon.close />
                    </button>
                  </li>
                ))
              ) : (
                <li className="muted">It blocks nothing.</li>
              )}
            </ul>
            {editable ? (
              <button type="button" className="button" onClick={(e) => setLinking(e.currentTarget)}>
                Add blocked task
              </button>
            ) : null}
          </section>
          <section className="detail-section" aria-labelledby="subtasks-heading">
            <h3 id="subtasks-heading">Sub-tasks</h3>
            {task.subtasks ? <p className="rollup num">{copy.rollup(task.subtasks.done, task.subtasks.total)}</p> : null}
            <ul className="links" aria-label="Sub-tasks">
              {[...app.tasks.values()]
                .filter((t) => t.parent === task.id)
                .sort((a, b) => a.number - b.number)
                .map((t) => (
                  <li key={t.id}>
                    <TaskRef id={t.id} />
                  </li>
                ))}
              {task.subtasks ? null : <li className="muted">No sub-tasks.</li>}
            </ul>
            {task.parent === null && editable ? (
              <button type="button" className="button" onClick={(e) => openDialog({ kind: "new-task", parent: task.id, opener: e.currentTarget })}>
                Add sub-task
              </button>
            ) : null}
          </section>
          <Attachments task={task} />
        </div>
        <Activity task={task} />
      </div>
      {linking ? <LinkDialog task={task} opener={linking} onClosed={() => setLinking(null)} /> : null}
    </div>
  );
};
