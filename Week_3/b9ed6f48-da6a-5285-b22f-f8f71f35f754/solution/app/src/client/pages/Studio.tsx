// The studio (brief: Screens and layout › Studio; Business rules › Editorial lifecycle). Each row
// shows only the moves the lifecycle allows the signed-in curator; publish times are entered as
// Lisbon wall-clock time on any device.

import { useState, type FormEvent } from "react";
import { api, ApiFailure, type StudioItem, type TimelineEvent } from "../api.js";
import { useApi } from "../hooks.js";
import { useApp } from "../state.js";
import { Dialog } from "../components/Dialog.js";
import { StaffActions } from "../components/StaffActions.js";
import { EmptyMark, ErrorSummary, Field, Skeleton, TextArea, type FieldErrors } from "../components/ui.js";
import { LISBON_ENTRY_HINT, readLisbonEntry } from "../entries.js";
import { COPY, NUMERALS, copyFor } from "../../shared/copy.js";
import { ITEM_STATUSES, STATUS_LABELS, movesFor, type ItemStatus } from "../../shared/lifecycle.js";
import { formatLisbonDateTime } from "../../shared/lisbon.js";

const MOVE_LABELS: Partial<Record<`${ItemStatus}>${ItemStatus}`, string>> = {
  "draft>review": "Send to review",
  "review>draft": "Return to draft",
  "review>scheduled": "Schedule",
  "scheduled>draft": "Unschedule",
  "published>withdrawn": "Withdraw",
  "withdrawn>draft": "Move to draft",
};
const KINDS = [
  { value: "narration", label: "Narration" },
  { value: "image", label: "Image" },
  { value: "scan", label: "Scan" },
];

interface Failure {
  errors: FieldErrors;
  message: string;
}

function failureOf(error: unknown): Failure {
  if (error instanceof ApiFailure) return { errors: error.error.fields ?? {}, message: error.error.fields ? COPY.validation : error.error.message };
  return { errors: {}, message: COPY.mediaUnavailable };
}

function NewEventDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const app = useApp();
  const [form, setForm] = useState({ chapter: "1", year: "", title: "", summary: "" });
  const [failure, setFailure] = useState<Failure>({ errors: {}, message: "" });
  const [busy, setBusy] = useState(false);
  const set = (name: keyof typeof form) => (e: { currentTarget: { value: string } }) => {
    const value = e.currentTarget.value;
    setForm((f) => ({ ...f, [name]: value }));
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailure({ errors: {}, message: "" });
    try {
      await api("/api/curator/events", {
        body: { chapter: Number(form.chapter), year: /^\d+$/.test(form.year) ? Number(form.year) : form.year, title: form.title, summary: form.summary, source_ids: [] },
      });
      app.announce(COPY.draftSaved);
      setForm({ chapter: form.chapter, year: "", title: "", summary: "" });
      onSaved();
      onClose();
    } catch (error) {
      setFailure(failureOf(error));
    } finally {
      setBusy(false);
    }
  };
  const ids = { chapter: "event-chapter", year: "event-year", title: "event-title", summary: "event-summary" };
  return (
    <Dialog open={open} label="New timeline event" onClose={onClose}>
      <h2>New timeline event</h2>
      <p className="dialog-lede">Saved as a draft you own. Send it to review when it's ready.</p>
      <ErrorSummary errors={failure.errors} message={failure.message} ids={ids} />
      <form noValidate onSubmit={(e) => void save(e)}>
        <div className="field select-field">
          <label htmlFor={ids.chapter}>Chapter</label>
          {failure.errors.chapter && <p className="field-error">{failure.errors.chapter}</p>}
          <select id={ids.chapter} value={form.chapter} onChange={set("chapter")}>
            {NUMERALS.map((numeral, i) => (
              <option key={numeral} value={i + 1}>
                Chapter {numeral}
              </option>
            ))}
          </select>
        </div>
        <Field id={ids.year} label="Year" type="number" min={1600} max={2100} inputMode="numeric" value={form.year} onChange={set("year")} error={failure.errors.year} />
        <Field id={ids.title} label="Title" value={form.title} onChange={set("title")} error={failure.errors.title} />
        <TextArea id={ids.summary} label="Summary" rows={4} value={form.summary} onChange={set("summary")} error={failure.errors.summary} />
        <div className="actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            Save draft
          </button>
        </div>
      </form>
    </Dialog>
  );
}

type Pending = { item: StudioItem; to: "scheduled" | "withdrawn" } | null;

function MoveDialog({ pending, onClose, onMoved }: { pending: Pending; onClose: () => void; onMoved: (item: StudioItem) => void }) {
  const [entry, setEntry] = useState("");
  const [failure, setFailure] = useState<Failure>({ errors: {}, message: "" });
  const [busy, setBusy] = useState(false);
  const scheduling = pending?.to === "scheduled";
  const field = scheduling ? "publish_at" : "reason";
  const close = () => {
    setEntry("");
    setFailure({ errors: {}, message: "" });
    onClose();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!pending || busy) return;
    setFailure({ errors: {}, message: "" });
    let body: Record<string, string> = { to: pending.to, reason: entry };
    if (scheduling) {
      const read = readLisbonEntry(entry);
      if ("error" in read) return setFailure({ errors: { publish_at: read.error }, message: COPY.validation });
      body = { to: pending.to, publish_at: read.iso };
    }
    setBusy(true);
    try {
      const { item } = await api<{ item: StudioItem }>(`/api/curator/items/${pending.item.id}/transitions`, { body });
      setEntry("");
      onMoved(item);
      onClose();
    } catch (error) {
      setFailure(failureOf(error));
    } finally {
      setBusy(false);
    }
  };
  const label = scheduling ? "Schedule" : "Withdraw";
  return (
    <Dialog open={pending !== null} label={label} onClose={close}>
      <h2>{label}</h2>
      <p className="dialog-lede">{pending?.item.title}</p>
      <ErrorSummary errors={failure.errors} message={failure.message} ids={{ [field]: "move-entry" }} />
      <form noValidate onSubmit={(e) => void submit(e)}>
        {scheduling ? (
          <Field id="move-entry" label="Publish at (Lisbon time)" autoComplete="off" hint={LISBON_ENTRY_HINT} value={entry} onChange={(e) => setEntry(e.currentTarget.value)} error={failure.errors.publish_at} />
        ) : (
          <TextArea id="move-entry" label="Reason" rows={3} value={entry} onChange={(e) => setEntry(e.currentTarget.value)} error={failure.errors.reason} />
        )}
        <div className="actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            {label}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function UploadForm({ items }: { items: StudioItem[] }) {
  const app = useApp();
  const [kind, setKind] = useState("image");
  const [itemId, setItemId] = useState("");
  const [transcript, setTranscript] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState("");
  const [failure, setFailure] = useState<Failure>({ errors: {}, message: "" });
  const [busy, setBusy] = useState(false);
  const [inputKey, setInputKey] = useState(0);
  const chosen = itemId || items[0]?.id || "";

  const upload = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setFailure({ errors: {}, message: "" });
    const form = new FormData();
    form.set("kind", kind);
    form.set("item_id", chosen);
    form.set("transcript", transcript);
    if (file) form.set("file", file, file.name);
    setBusy(true);
    if (file) setStatus(copyFor.uploading(file.name));
    try {
      await api("/api/curator/media", { form });
      setStatus(copyFor.uploaded(file?.name ?? ""));
      app.announce(copyFor.uploaded(file?.name ?? ""));
      setFile(null);
      setTranscript("");
      setInputKey((k) => k + 1);
    } catch (error) {
      setStatus("");
      const failed = failureOf(error);
      setFailure(error instanceof ApiFailure && error.error.code === "storage_unavailable" ? { errors: {}, message: COPY.storageUpload } : failed);
    } finally {
      setBusy(false);
    }
  };
  const ids = { kind: "upload-kind", item_id: "upload-item", file: "upload-file", transcript: "upload-transcript" };
  return (
    <form aria-label="Upload media" className="museum-card upload-form" noValidate onSubmit={(e) => void upload(e)}>
      <p className="catalogue">HRR-MEDIA</p>
      <h2 className="card-title">Upload media</h2>
      <p className="card-text">Images (PNG, JPEG, WebP), scans (PNG, JPEG, PDF) and narration (MP3, Ogg) up to 20,000,000 bytes. Narration needs its transcript.</p>
      <ErrorSummary errors={failure.errors} message={failure.message} ids={ids} />
      <div className="form-grid">
        <div className="field select-field">
          <label htmlFor={ids.kind}>Kind</label>
          <select id={ids.kind} value={kind} onChange={(e) => setKind(e.currentTarget.value)}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field select-field">
          <label htmlFor={ids.item_id}>Item</label>
          <select id={ids.item_id} value={chosen} onChange={(e) => setItemId(e.currentTarget.value)}>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.title}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor={ids.file}>File</label>
        {failure.errors.file && (
          <p className="field-error" id="upload-file-error">
            {failure.errors.file}
          </p>
        )}
        <input key={inputKey} id={ids.file} type="file" aria-invalid={failure.errors.file ? true : undefined} onChange={(e) => setFile(e.currentTarget.files?.[0] ?? null)} />
      </div>
      <TextArea id={ids.transcript} label="Transcript" rows={3} value={transcript} onChange={(e) => setTranscript(e.currentTarget.value)} error={failure.errors.transcript} />
      <div className="actions">
        <button type="submit" className="button button-primary" disabled={busy}>
          Upload
        </button>
      </div>
      <div role="status" aria-label="Upload status" className="inline-status">
        {status}
      </div>
    </form>
  );
}

export function StudioPage() {
  const app = useApp();
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [version, setVersion] = useState(0);
  const [newOpen, setNewOpen] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [rowMessage, setRowMessage] = useState("");
  const isCurator = app.user?.role === "curator" || app.user?.role === "lead_curator";
  const params = new URLSearchParams({ type, status, v: String(version) });
  const items = useApi<{ items: StudioItem[] }>(isCurator ? `/api/curator/items?${params}` : null);
  const all = useApi<{ items: StudioItem[] }>(isCurator ? `/api/curator/items?v=${version}` : null);
  const timeline = useApi<{ events: TimelineEvent[] }>(`/api/timeline?v=${version}`);
  const refresh = () => setVersion((v) => v + 1);

  if (!app.userLoaded) return <div className="page" aria-busy="true" />;
  if (!app.user || !isCurator)
    return (
      <div className="page">
        <div className="museum-card signed-out-card">
          <h1>Studio</h1>
          <p>{app.user ? COPY.forbidden : COPY.unauthenticated}</p>
          {!app.user && (
            <button type="button" className="button button-primary" onClick={(e) => app.openSignIn(e.currentTarget)}>
              Sign in
            </button>
          )}
        </div>
      </div>
    );

  const user = app.user;
  const isLead = user.role === "lead_curator";
  const moved = (item: StudioItem) => {
    setRowMessage("");
    app.announce(copyFor.moved(STATUS_LABELS[item.status]));
    refresh();
  };
  const move = async (item: StudioItem, to: ItemStatus) => {
    if (to === "scheduled" || to === "withdrawn") return setPending({ item, to });
    try {
      const { item: next } = await api<{ item: StudioItem }>(`/api/curator/items/${item.id}/transitions`, { body: { to } });
      moved(next);
    } catch (error) {
      const failed = failureOf(error);
      setRowMessage(failed.message);
      app.announce(failed.message);
      refresh();
    }
  };

  return (
    <div className="page studio-page">
      <header className="page-intro">
        <p className="eyebrow">{isLead ? "Lead curator" : "Curator"} · {user.name}</p>
        <h1>Studio</h1>
        <p className="lede">Draft, review, schedule and withdraw the chapters and timeline events. Visitors see only what is published.</p>
        <button type="button" className="button button-primary" onClick={() => setNewOpen(true)}>
          New event
        </button>
      </header>
      <section aria-label="Items" className="studio-items">
        <div className="filters">
          <div className="field select-field">
            <label htmlFor="studio-type">Type</label>
            <select id="studio-type" value={type} onChange={(e) => setType(e.currentTarget.value)}>
              <option value="">All types</option>
              <option value="chapter">Chapters</option>
              <option value="event">Timeline events</option>
            </select>
          </div>
          <div className="field select-field">
            <label htmlFor="studio-status">Status</label>
            <select id="studio-status" value={status} onChange={(e) => setStatus(e.currentTarget.value)}>
              <option value="">All statuses</option>
              {ITEM_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <ErrorSummary errors={{}} message={rowMessage} ids={{}} />
        {!items.data ? (
          <Skeleton lines={6} />
        ) : (
          <div className="table-scroll">
            <table aria-label="Items" className="data-table stack-on-phone">
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">Type</th>
                  <th scope="col">Chapter</th>
                  <th scope="col">Status</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Publish at</th>
                  <th scope="col">Moves</th>
                </tr>
              </thead>
              <tbody>
                {items.data.items.map((item) => (
                  <tr key={item.id}>
                    <th scope="row" data-label="Item">
                      {item.title}
                    </th>
                    <td data-label="Type">{item.type === "chapter" ? "Chapter" : "Event"}</td>
                    <td data-label="Chapter">{NUMERALS[item.chapter - 1]}</td>
                    <td data-label="Status">
                      <span className={`badge status-${item.status}`}>{STATUS_LABELS[item.status]}</span>
                    </td>
                    <td data-label="Owner">{item.owner_email}</td>
                    <td data-label="Publish at">{item.publish_at ? formatLisbonDateTime(Date.parse(item.publish_at)) : "—"}</td>
                    <td data-label="Moves" className="row-actions">
                      {movesFor(item.status, { isOwner: item.owner_email === user.email, isLead }).map((to) => (
                        <button key={to} type="button" className="button button-small" onClick={() => void move(item, to)}>
                          {MOVE_LABELS[`${item.status}>${to}`]}
                        </button>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {/* What follows the items table appears once the table has its height, so the table never pushes it down. */}
      {(items.data || !items.loading) && (
        <>
          <section aria-label="Chapter events" className="band chapter-panels">
            <h2>Published events by chapter</h2>
            <ol className="card-grid">
              {NUMERALS.map((numeral, i) => {
                const events = timeline.data?.events.filter((e) => e.chapter === i + 1) ?? [];
                return (
                  <li key={numeral}>
                    <section aria-label={`Chapter ${numeral} events`} className="museum-card chapter-panel">
                      <p className="catalogue">HRR-{numeral}</p>
                      <h3 className="card-title">Chapter {numeral}</h3>
                      {!timeline.data ? (
                        <Skeleton lines={2} />
                      ) : events.length ? (
                        <ul className="panel-events">
                          {events.map((e) => (
                            <li key={e.id}>
                              <span className="figure">{e.year}</span> {e.title}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="empty-inline">
                          <EmptyMark />
                          <p>{COPY.emptyEvents}</p>
                        </div>
                      )}
                    </section>
                  </li>
                );
              })}
            </ol>
          </section>
          <UploadForm items={all.data?.items ?? []} />
          {isLead && <StaffActions version={version} />}
        </>
      )}
      <NewEventDialog open={newOpen} onClose={() => setNewOpen(false)} onSaved={refresh} />
      <MoveDialog pending={pending} onClose={() => setPending(null)} onMoved={moved} />
    </div>
  );
}
