// The horse panel: comparison stage, hoof and visit pickers, visit list, the open visit's photos, marks and close,
// and the farrier's vet links (brief: Screens and layout, Horse panel; Interactions, Marking; Feedback states).
import { type CSSProperties, type FormEvent, type MouseEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  type Comparison,
  type HoofMarks,
  type Hoof,
  type Horse,
  type Line,
  type LinkView,
  type MarksVersion,
  type Phase,
  type Photo,
  type UploadSession,
  type Visit,
  type VetLinkEntry,
  type WorkCode,
  freshKey,
  get,
  request,
} from "./api";
import { failure } from "./days";
import { HOOF_NAMES, HOOVES, SERVICE_NAMES, WORK_CODES, degrees, dollars, visitStatusText, wallClock } from "./format";
import { horsePath, navigate } from "./router";
import { useSession } from "./session";
import { ComparisonStage, HoofPicker, Readout } from "./stage";
import {
  Button,
  StatusTag,
  Field,
  Modal,
  NotAvailable,
  Skeleton,
  billingCopy,
  focusFirstInvalid,
  focusKey,
  focusWhenReady,
  useAction,
  useEventStream,
  useAnnounce,
  useNotify,
  usePendingFlag,
  useReconciled,
  useRefresh,
} from "./ui";

const HORSE_NOT_AVAILABLE = "This horse isn't available.";
/** Signed photo paths last PHOTO_URL_TTL_SECONDS (300 s by default); a cached comparison is reused for less. */
const COMPARISON_REUSE_MS = 120_000;

interface Pair {
  previous: string;
  current: string;
}

type ComparisonEntry = { data: Comparison | null; at: number };

export function dueText(horse: Horse): string {
  const date = horse.next_due_date ?? "";
  switch (horse.due_status) {
    case "current":
      return `Next due ${date}`;
    case "due":
      return `Due ${date}`;
    case "overdue":
      return `Overdue, was due ${date}`;
    default:
      return "No visits yet";
  }
}

export function HorsePanel({ id, hoof }: { id: string; hoof: Hoof }) {
  const { user } = useSession();
  const { tick } = useRefresh();
  const notify = useNotify();
  const announce = useAnnounce();
  const reconciled = useReconciled();
  const [horse, setHorse] = useState<Horse | null | "missing">(null);
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [pair, setPair] = useState<Pair | null>(null);
  const [glideToken, setGlideToken] = useState(0);
  const [epoch, setEpoch] = useState(0);
  const [comparison, setComparison] = useState<ComparisonEntry | null>(null);
  const cache = useRef(new Map<string, ComparisonEntry>());
  /** Marks versions this page already shows (its own saves, or the marks a stale refusal returned): never announced. */
  const shownMarks = useRef(new Set<string>());
  const pendingAnnouncements = useRef(new Set<string>());
  const staff = user.role === "farrier" || user.role === "apprentice";
  const base = `/api/horses/${encodeURIComponent(id)}`;

  useEffect(() => {
    let live = true;
    void Promise.all([get<Horse>(base), get<Visit[]>(`${base}/visits`)]).then(([found, list]) => {
      if (!live) return;
      if (!found.ok) {
        if (found.status === 404) setHorse("missing");
        return;
      }
      setHorse(found.data);
      if (!list.ok) return;
      setVisits(list.data);
      if (user.role !== "apprentice") {
        reconciled(
          list.data.flatMap((visit) =>
            visit.invoice
              ? [
                  {
                    id: visit.invoice.id,
                    pending: visit.invoice.status === "pending",
                    copy: billingCopy("visit", visit.horse.name, visit.invoice.total_cents),
                    element: () => document.querySelector<HTMLElement>(`[data-visit="${CSS.escape(visit.id)}"]`),
                  },
                ]
              : [],
          ),
        );
      }
      for (const key of [...pendingAnnouncements.current]) {
        const [visitId, hoofCode, version] = key.split("|");
        const marks = list.data.find((visit) => visit.id === visitId)?.marks.find((m) => m.hoof === hoofCode);
        if (!marks || String(marks.version) !== version) continue;
        pendingAnnouncements.current.delete(key);
        announce(`Marks updated by ${marks.saved_by?.name ?? "someone"}: hoof wall ${degrees(marks.hoof_wall.angle)}, pastern ${degrees(marks.pastern.angle)}.`);
      }
    });
    return () => {
      live = false;
    };
  }, [base, tick, epoch, reconciled, user.role, announce]);

  /** Marks or visits changed on another device: lines and numerals update in place, nothing else moves. */
  useEventStream(`${base}/events`, (event, data) => {
    if (event === "marks_saved") {
      const saved = data as { visit_id: string; hoof: Hoof; version: number | null };
      const key = `${saved.visit_id}|${saved.hoof}|${saved.version}`;
      if (saved.version !== null && !shownMarks.current.has(key) && staff) pendingAnnouncements.current.add(key);
    }
    cache.current.clear();
    setEpoch((value) => value + 1);
  });

  const fetchComparison = useCallback(
    async (forHoof: Hoof, forPair: Pair | null): Promise<ComparisonEntry> => {
      const query = new URLSearchParams({ hoof: forHoof, ...(forPair ?? {}) }).toString();
      const key = `${epoch}|${query}`;
      const cached = cache.current.get(key);
      if (cached && performance.now() - cached.at < COMPARISON_REUSE_MS) return cached;
      const result = await get<Comparison>(`${base}/comparison?${query}`);
      const entry = { data: result.ok ? result.data : null, at: performance.now() };
      cache.current.set(key, entry);
      return entry;
    },
    [base, epoch],
  );

  useEffect(() => {
    if (horse === null || horse === "missing" || visits === null) return;
    // Only hooves the visit list shows marked on two visits can be compared; the others need no request.
    const comparable = (code: Hoof): boolean => visits.filter((visit) => visit.marks.some((marks) => marks.hoof === code)).length >= 2;
    if (!comparable(hoof)) {
      setComparison({ data: null, at: performance.now() });
      return;
    }
    let live = true;
    void fetchComparison(hoof, pair).then((entry) => {
      if (!live) return;
      setComparison(entry);
      // The pair on screen is pinned, so a visit marked later adds an option without changing the selection.
      if (pair === null && entry.data?.previous.visit_id && entry.data.current.visit_id) {
        setPair({ previous: entry.data.previous.visit_id, current: entry.data.current.visit_id });
      }
    });
    return () => {
      live = false;
    };
  }, [horse, visits, hoof, pair, fetchComparison]);

  const pendingVisits = (visits ?? []).some((visit) => visit.status === "invoice_pending" || visit.status === "closed");
  usePendingFlag("horse-visits", pendingVisits);

  if (horse === "missing") return <NotAvailable copy={HORSE_NOT_AVAILABLE} />;
  if (horse === null) return <Skeleton rows={6} />;

  function pickHoof(next: Hoof): void {
    setPair(null);
    setGlideToken((value) => value + 1);
    navigate(horsePath(id, next), true);
  }

  function pickPair(next: Pair): void {
    setPair(next);
    setGlideToken((value) => value + 1);
  }

  const shown = comparison?.data ?? null;
  const openVisit = staff ? (visits ?? []).find((visit) => visit.status === "open") : undefined;
  const changed = (): void => {
    cache.current.clear();
    setEpoch((value) => value + 1);
  };
  const thumbs = thumbnailsOf(visits ?? []);

  return (
    <article className="horse-panel" aria-labelledby="horse-title">
      <header className="horse-header">
        <h1 id="horse-title">{horse.name}</h1>
        <dl className="facts">
          <div>
            <dt>Barn</dt>
            <dd>{horse.barn.name}</dd>
          </div>
          <div>
            <dt>Stall</dt>
            <dd className="num">{horse.stall}</dd>
          </div>
          <div>
            <dt>Cycle</dt>
            <dd className="num">{horse.cycle_weeks} weeks</dd>
          </div>
          {horse.owner ? (
            <div>
              <dt>Owner</dt>
              <dd>{horse.owner.name}</dd>
            </div>
          ) : null}
        </dl>
        <p className="due num" data-due={horse.due_status}>
          {dueText(horse)}
        </p>
      </header>
      <ComparisonStage comparison={shown} hoof={hoof} glideToken={glideToken} loading={comparison === null} />
      <div className="stage-under">
        <HoofPicker hoof={hoof} onPick={pickHoof} name="panel-hoof" thumbnails={thumbs} />
        <Readout comparison={shown} />
      </div>
      {shown?.marked_visits && shown.marked_visits.length >= 2 ? <VisitPickers comparison={shown} onPick={pickPair} /> : null}
      <VisitList visits={visits} />
      {openVisit ? (
        <VisitWork
          key={openVisit.id}
          visit={openVisit}
          startHoof={hoof}
          onChanged={changed}
          onSaved={(visitId, code, version) => {
            const key = `${visitId}|${code}|${version}`;
            shownMarks.current.add(key);
            pendingAnnouncements.current.delete(key);
          }}
        />
      ) : null}
      {user.role === "farrier" ? <VetLinks horseId={id} /> : null}
    </article>
  );
}

/** The newest ready thumbnail of each hoof's after photo, for the hoof picker. */
function thumbnailsOf(visits: Visit[]): Partial<Record<Hoof, string>> {
  const out: Partial<Record<Hoof, string>> = {};
  for (const visit of visits) {
    for (const photo of visit.photos) {
      if (photo.phase === "after" && photo.thumbnail_url && !out[photo.hoof]) out[photo.hoof] = photo.thumbnail_url;
    }
  }
  return out;
}

function VisitPickers({ comparison, onPick }: { comparison: Comparison; onPick: (pair: Pair) => void }) {
  const marked = [...(comparison.marked_visits ?? [])];
  const previous = comparison.previous.visit_id ?? "";
  const current = comparison.current.visit_id ?? "";
  const indexOf = (visitId: string): number => marked.findIndex((visit) => visit.visit_id === visitId);
  return (
    <div className="visit-pickers">
      <div className="field">
        <label htmlFor="pick-previous">Previous visit</label>
        <select id="pick-previous" value={previous} onChange={(event) => onPick({ previous: event.target.value, current })}>
          {marked
            .filter((_, index) => index < indexOf(current))
            .map((visit) => (
              <option key={visit.visit_id} value={visit.visit_id}>
                {visit.business_date}
              </option>
            ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="pick-current">Current visit</label>
        <select id="pick-current" value={current} onChange={(event) => onPick({ previous, current: event.target.value })}>
          {marked
            .filter((_, index) => index > indexOf(previous))
            .map((visit) => (
              <option key={visit.visit_id} value={visit.visit_id}>
                {visit.business_date}
              </option>
            ))}
        </select>
      </div>
    </div>
  );
}

function VisitList({ visits }: { visits: Visit[] | null }) {
  return (
    <section className="subsection" aria-labelledby="visits-title">
      <h2 id="visits-title" className="section-title">
        Visits
      </h2>
      {visits === null ? (
        <Skeleton rows={2} />
      ) : visits.length === 0 ? (
        <p className="muted">No visits yet.</p>
      ) : (
        <div className="table-scroll">
          <table className="ledger" aria-label="Visits">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Work</th>
                <th scope="col">Status</th>
                <th scope="col" className="right">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {visits.map((visit, index) => {
                const text = visitStatusText(visit.status, visit.invoice !== null);
                return (
                  <tr key={visit.id} data-visit={visit.id} className={index < 6 ? "row-enter" : undefined} style={{ "--i": String(index) } as CSSProperties}>
                    <td data-label="Date" className="num">
                      {visit.business_date}
                    </td>
                    <td data-label="Work">
                      {visit.invoice
                        ? visit.invoice.items
                            .filter((item) => item.amount_cents > 0)
                            .map((item) => item.description.split(" — ")[0])
                            .join(", ")
                        : visit.note || <span className="muted">—</span>}
                    </td>
                    <td data-label="Status">
                      <span className="chip" data-live={text === "Invoice pending" ? "pending" : undefined}>
                        {text}
                      </span>
                    </td>
                    <td data-label="Total" className="num right">
                      {visit.invoice && visit.invoice.status !== "pending" ? dollars(visit.invoice.total_cents) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---- The open visit: photos, marks, close ----

type Fields = Record<keyof Line, string>;
interface MarksForm {
  hoof_wall: Fields;
  pastern: Fields;
  version: number | null;
}

const EMPTY_FIELDS: Fields = { x1: "", y1: "", x2: "", y2: "" };
const toFields = (line: Line): Fields => ({ x1: String(line.x1), y1: String(line.y1), x2: String(line.x2), y2: String(line.y2) });
const formFrom = (marks: HoofMarks | null | undefined): MarksForm =>
  marks
    ? { hoof_wall: toFields(marks.hoof_wall), pastern: toFields(marks.pastern), version: marks.version }
    : { hoof_wall: { ...EMPTY_FIELDS }, pastern: { ...EMPTY_FIELDS }, version: null };
const lineOf = (fields: Fields): Record<keyof Line, number | null> => ({
  x1: fields.x1.trim() === "" ? null : Number(fields.x1),
  y1: fields.y1.trim() === "" ? null : Number(fields.y1),
  x2: fields.x2.trim() === "" ? null : Number(fields.x2),
  y2: fields.y2.trim() === "" ? null : Number(fields.y2),
});
const LINE_NAMES = { hoof_wall: "Hoof wall line", pastern: "Pastern line" } as const;
type LineKey = keyof typeof LINE_NAMES;

const UPLOAD_COPIES = (hoof: Hoof, phase: Phase): Record<string, string> => ({
  unsupported_image: "That file is not a JPEG, PNG or HEIC photo.",
  photo_too_large: "That photo is over 8,000,000 bytes.",
  payload_too_large: "That photo is over 8,000,000 bytes.",
  storage_unavailable: "Photo storage is unreachable. The photo was not saved; try again shortly.",
  upload_expired: "That upload ran out of time. Start it again.",
  photo_exists: `${HOOF_NAMES[hoof]} already has a ${phase} photo. Delete it first to replace it.`,
  visit_closed: "This visit is closed. Its photos can no longer change.",
});

const percent = (done: number, total: number): number => (total ? Math.floor((done / total) * 100) : 100);

function VisitWork({
  visit,
  startHoof,
  onChanged,
  onSaved,
}: {
  visit: Visit;
  startHoof: Hoof;
  onChanged: () => void;
  onSaved: (visitId: string, hoof: Hoof, version: number) => void;
}) {
  const { user } = useSession();
  const notify = useNotify();
  const { refresh } = useRefresh();
  const [workHoof, setWorkHoof] = useState<Hoof>(startHoof);
  const [phase, setPhase] = useState<Phase>("before");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sessions, setSessions] = useState<UploadSession[]>([]);
  const [historyEpoch, setHistoryEpoch] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<MarksForm>(() => formFrom(visit.marks.find((marks) => marks.hoof === startHoof)));
  const [markErrors, setMarkErrors] = useState<Partial<Record<LineKey, string>>>({});
  const [armed, setArmed] = useState<{ line: LineKey; point: 0 | 1 } | null>(null);
  const [saving, runSave] = useAction();
  const [removing, setRemoving] = useState<string | null>(null);
  const marksRef = useRef<HTMLDivElement>(null);
  const visitPath = `/api/visits/${encodeURIComponent(visit.id)}`;
  const after = visit.photos.find((photo) => photo.hoof === workHoof && photo.phase === "after");

  useEffect(() => {
    if (!armed) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setArmed(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [armed]);

  function chooseHoof(next: Hoof): void {
    setWorkHoof(next);
    setArmed(null);
    setMarkErrors({});
    setForm(formFrom(visit.marks.find((marks) => marks.hoof === next)));
  }

  useEffect(() => {
    let live = true;
    void get<UploadSession[]>(`${visitPath}/uploads`).then((result) => {
      if (live && result.ok) setSessions(result.data);
    });
    return () => {
      live = false;
    };
  }, [visitPath, uploading, visit]);

  const resumable = file ? sessions.find((session) => session.hoof === workHoof && session.phase === phase && session.size_bytes === file.size) : undefined;

  /**
   * Sends the file in chunks from the session's stored offset, updating Notices after each chunk. A dropped
   * connection leaves the session for "Resume upload", on this instance or any other.
   */
  async function sendChunks(session: UploadSession, chosen: File): Promise<void> {
    let offset = session.offset;
    const hoof = session.hoof;
    const side = session.phase;
    for (;;) {
      notify(`Uploading photo… ${percent(offset, chosen.size)}%`, "pending");
      const end = Math.min(offset + session.chunk_bytes, chosen.size);
      const result = await request<{ offset: number } | Photo>("PATCH", `/api/uploads/${encodeURIComponent(session.id)}`, {
        raw: { data: chosen.slice(offset, end), type: "application/octet-stream" },
        headers: { "upload-offset": String(offset) },
      });
      if (result.ok && result.status === 201) {
        notify(`Photo saved for ${HOOF_NAMES[hoof]} (${side}).`, "success");
        setFile(null);
        if (fileInput.current) fileInput.current.value = "";
        onChanged();
        return;
      }
      if (result.ok && "offset" in result.data) {
        offset = result.data.offset;
        continue;
      }
      if (!result.ok && result.error.error === "offset_mismatch" && typeof result.error.offset === "number") {
        offset = result.error.offset;
        continue;
      }
      if (!result.ok && result.status === 0) {
        notify(`Upload interrupted at ${percent(offset, chosen.size)}%. Choose the file again to resume.`, "error");
        return;
      }
      if (!result.ok) {
        notify(failure(result.error, UPLOAD_COPIES(hoof, side), result.retryAfter), "error");
        return;
      }
    }
  }

  async function upload(resume: UploadSession | undefined): Promise<void> {
    if (uploading) return;
    if (!file) {
      notify("Choose a photo file first.", "error");
      focusWhenReady("#photo-file");
      return;
    }
    setUploading(true);
    notify("Uploading photo… 0%", "pending");
    try {
      let session = resume;
      if (!session) {
        const created = await request<UploadSession>("POST", `${visitPath}/uploads`, { body: { hoof: workHoof, phase, size_bytes: file.size } });
        if (!created.ok) {
          notify(
            created.error.error === "visit_quota_exceeded"
              ? `This visit is out of photo storage: ${created.error.remaining_bytes ?? 0} bytes left.`
              : failure(created.error, UPLOAD_COPIES(workHoof, phase), created.retryAfter),
            "error",
          );
          return;
        }
        session = { ...created.data, hoof: workHoof, phase, size_bytes: file.size };
      }
      await sendChunks(session, file);
    } finally {
      setUploading(false);
    }
  }

  async function removePhoto(photoId: string, label: string): Promise<void> {
    setRemoving(photoId);
    notify("Deleting photo…", "pending");
    const result = await request("DELETE", `/api/photos/${encodeURIComponent(photoId)}`);
    setRemoving(null);
    if (result.ok) {
      notify(`Photo deleted for ${label}.`, "success");
      focusWhenReady("#photo-file");
      onChanged();
    } else notify(failure(result.error, { visit_closed: "This visit is closed. Its photos can no longer change." }), "error");
  }

  function setField(line: LineKey, key: keyof Line, value: string): void {
    setForm((current) => ({ ...current, [line]: { ...current[line], [key]: value } }));
  }

  function placePoint(event: MouseEvent<HTMLDivElement>): void {
    if (!armed || !after) return;
    const box = event.currentTarget.getBoundingClientRect();
    const x = Math.round(Math.max(0, Math.min(after.width, ((event.clientX - box.left) / box.width) * after.width)));
    const y = Math.round(Math.max(0, Math.min(after.height, ((event.clientY - box.top) / box.height) * after.height)));
    const [kx, ky] = armed.point === 0 ? (["x1", "y1"] as const) : (["x2", "y2"] as const);
    setForm((current) => ({ ...current, [armed.line]: { ...current[armed.line], [kx]: String(x), [ky]: String(y) } }));
    setArmed(armed.point === 0 ? { line: armed.line, point: 1 } : null);
  }

  function saveMarks(): void {
    void runSave("Saving marks…", async () => {
      const result = await request<HoofMarks>("PUT", `${visitPath}/hooves/${workHoof}/marks`, {
        body: { version: form.version, hoof_wall: lineOf(form.hoof_wall), pastern: lineOf(form.pastern) },
      });
      if (result.ok) {
        setMarkErrors({});
        setForm(formFrom(result.data));
        onSaved(visit.id, workHoof, result.data.version);
        notify(
          `Marks saved: hoof wall ${degrees(result.data.hoof_wall.angle)}, pastern ${degrees(result.data.pastern.angle)}, ${result.data.alignment}.`,
          "success",
        );
        setHistoryEpoch((value) => value + 1);
        onChanged();
      } else if (result.error.error === "stale_marks") {
        setMarkErrors({});
        setForm(formFrom(result.error.current));
        if (result.error.current) onSaved(visit.id, workHoof, result.error.current.version);
        notify(`Someone else saved marks for ${HOOF_NAMES[workHoof]} first. Their lines are now shown; check them and save again.`, "error");
        focusWhenReady("#mark-hoof_wall-x1");
        setHistoryEpoch((value) => value + 1);
        onChanged();
      } else if (result.error.error === "validation") {
        setMarkErrors(result.error.errors ?? {});
        notify("Check the highlighted lines.", "error");
        focusFirstInvalid(marksRef.current);
      } else
        notify(
          failure(result.error, {
            photo_required: "Upload the after photo for this hoof first.",
            visit_closed: "This visit is closed. Its photos can no longer change.",
          }),
          "error",
        );
    });
  }

  const drawn = (fields: Fields): Line | null => {
    const values = lineOf(fields);
    return values.x1 !== null && values.y1 !== null && values.x2 !== null && values.y2 !== null
      ? { x1: values.x1, y1: values.y1, x2: values.x2, y2: values.y2 }
      : null;
  };
  const wallLine = drawn(form.hoof_wall);
  const pasternLine = drawn(form.pastern);

  return (
    <section className="subsection visit-work" aria-labelledby="open-visit-title">
      <h2 id="open-visit-title" className="section-title">
        Open visit <span className="num muted">{visit.business_date}</span>
      </h2>
      <div className="work-grid">
        <form
          className="panel upload"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void upload(undefined);
          }}
          noValidate
        >
          <h3>Photos</h3>
          <div className="field">
            <label htmlFor="work-hoof">Hoof</label>
            <select id="work-hoof" value={workHoof} onChange={(event) => chooseHoof(event.target.value as Hoof)}>
              {HOOVES.map((code) => (
                <option key={code} value={code}>
                  {HOOF_NAMES[code]}
                </option>
              ))}
            </select>
          </div>
          <div className="choices phase" role="radiogroup" aria-label="Phase">
            {(["before", "after"] as const).map((value) => (
              <label key={value} className="choice">
                <input type="radio" name="phase" checked={phase === value} onChange={() => setPhase(value)} />
                <span>{value === "before" ? "Before" : "After"}</span>
              </label>
            ))}
          </div>
          <div className="field">
            <label htmlFor="photo-file">Photo file</label>
            <input
              ref={fileInput}
              id="photo-file"
              type="file"
              accept="image/jpeg,image/png,image/heic,.heic,.heif"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </div>
          <div className="row-actions">
            <Button type="submit" variant="primary" busy={uploading}>
              Upload photo
            </Button>
            {resumable ? (
              <Button busy={uploading} onClick={() => void upload(resumable)}>
                Resume upload
              </Button>
            ) : null}
          </div>
          <ul className="photo-grid" aria-label="Photos on this visit">
            {HOOVES.flatMap((code) =>
              (["before", "after"] as const).map((value) => {
                const photo = visit.photos.find((item) => item.hoof === code && item.phase === value);
                const label = `${HOOF_NAMES[code]} (${value})`;
                return (
                  <li key={`${code}-${value}`} className="photo-cell" data-filled={photo ? "true" : "false"}>
                    {photo ? (
                      <img src={photo.thumbnail_url ?? photo.url} alt={`${label} photo`} width={160} height={120} loading="lazy" />
                    ) : (
                      <span className="photo-missing" aria-hidden="true" />
                    )}
                    <span className="photo-label">{label}</span>
                    {photo ? (
                      <Button
                        variant="quiet"
                        busy={removing === photo.id}
                        onClick={() => void removePhoto(photo.id, label)}
                        aria-label={`Delete ${HOOF_NAMES[code]} ${value} photo`}
                      >
                        Delete
                      </Button>
                    ) : null}
                  </li>
                );
              }),
            )}
          </ul>
        </form>
        <div className="panel marks" ref={marksRef}>
          <h3>Marks · {HOOF_NAMES[workHoof]}</h3>
          {after ? (
            <div
              className="mark-photo"
              data-armed={armed ? "true" : "false"}
              style={{ aspectRatio: `${after.width} / ${after.height}` }}
              onClick={placePoint}
            >
              <img src={after.url} alt={`${HOOF_NAMES[workHoof]} after photo for marking`} draggable={false} />
              <svg viewBox={`0 0 ${after.width} ${after.height}`} aria-hidden="true" className="stage-lines lines-current">
                {[wallLine, pasternLine].map((line, index) =>
                  line ? (
                    <g key={index} data-line={index === 0 ? "hoof_wall" : "pastern"}>
                      <line className="outline" {...line} />
                      <line className="stroke" {...line} />
                    </g>
                  ) : null,
                )}
              </svg>
              {armed ? (
                <p className="arm-hint">
                  {LINE_NAMES[armed.line]}: click the {armed.point === 0 ? "start" : "end"} point. Escape stops.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="muted mark-missing">Upload the after photo for this hoof first.</p>
          )}
          {(Object.keys(LINE_NAMES) as LineKey[]).map((line) => (
            <fieldset key={line} className="line-group" aria-describedby={markErrors[line] ? `mark-${line}-error` : undefined}>
              <legend>{LINE_NAMES[line]}</legend>
              <div className="coords">
                {(
                  [
                    ["x1", "Start x"],
                    ["y1", "Start y"],
                    ["x2", "End x"],
                    ["y2", "End y"],
                  ] as const
                ).map(([key, label]) => (
                  <div className="field" key={key}>
                    <label htmlFor={`mark-${line}-${key}`}>{label}</label>
                    <input
                      id={`mark-${line}-${key}`}
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      value={form[line][key]}
                      aria-invalid={markErrors[line] ? true : undefined}
                      onChange={(event) => setField(line, key, event.target.value)}
                    />
                  </div>
                ))}
              </div>
              {markErrors[line] ? (
                <p className="field-error" id={`mark-${line}-error`}>
                  <span className="prefix">Error: </span>
                  {markErrors[line]}
                </p>
              ) : null}
            </fieldset>
          ))}
          <div className="mark-actions">
            <Button disabled={!after} aria-pressed={armed?.line === "hoof_wall"} onClick={() => setArmed({ line: "hoof_wall", point: 0 })}>
              Mark hoof wall
            </Button>
            <Button disabled={!after} aria-pressed={armed?.line === "pastern"} onClick={() => setArmed({ line: "pastern", point: 0 })}>
              Mark pastern
            </Button>
            <Button variant="primary" busy={saving} onClick={saveMarks}>
              Save marks
            </Button>
          </div>
          <MarksHistory
            visitId={visit.id}
            hoof={workHoof}
            epoch={historyEpoch}
            version={form.version}
            onRestored={(marks) => {
              onSaved(visit.id, workHoof, marks.version);
              setForm(formFrom(marks));
              setHistoryEpoch((value) => value + 1);
              onChanged();
            }}
            onStale={(current) => {
              if (current) onSaved(visit.id, workHoof, current.version);
              setForm(formFrom(current));
              focusWhenReady("#mark-hoof_wall-x1");
              setHistoryEpoch((value) => value + 1);
              onChanged();
            }}
          />
        </div>
        {user.role === "farrier" ? <CloseVisit visit={visit} onClosed={() => { onChanged(); refresh(); }} /> : null}
      </div>
    </section>
  );
}

/** The hoof's attributed marks history; restoring copies a version's stored lines, angles and label as a new one. */
function MarksHistory({
  visitId,
  hoof,
  epoch,
  version,
  onRestored,
  onStale,
}: {
  visitId: string;
  hoof: Hoof;
  epoch: number;
  version: number | null;
  onRestored: (marks: HoofMarks) => void;
  onStale: (current: HoofMarks | null) => void;
}) {
  const notify = useNotify();
  const [history, setHistory] = useState<MarksVersion[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const base = `/api/visits/${encodeURIComponent(visitId)}/hooves/${hoof}/marks`;
  useEffect(() => {
    let live = true;
    void get<MarksVersion[]>(`${base}/history`).then((result) => {
      if (live && result.ok) setHistory(result.data);
    });
    return () => {
      live = false;
    };
  }, [base, epoch]);

  async function restore(target: number): Promise<void> {
    if (busy !== null) return;
    setBusy(target);
    notify("Restoring marks…", "pending");
    const result = await request<HoofMarks>("POST", `${base}/restore`, { body: { version, restore_version: target } });
    setBusy(null);
    if (result.ok) {
      notify(`Restored version ${target} as version ${result.data.version}.`, "success");
      onRestored(result.data);
      focusWhenReady(() => document.querySelector<HTMLElement>(`[data-history="${result.data.version}"]`));
    } else if (result.error.error === "stale_marks") {
      notify(`Someone else saved marks for ${HOOF_NAMES[hoof]} first. Their lines are now shown; check them and save again.`, "error");
      onStale(result.error.current ?? null);
    } else notify(result.error.errors?.restore_version ?? failure(result.error, { visit_closed: "This visit is closed. Its photos can no longer change." }), "error");
  }

  if (!history || history.length === 0) return null;
  return (
    <div className="marks-history">
      <h4>Marks history</h4>
      <div className="table-scroll">
        <table className="ledger" aria-label="Marks history">
          <thead>
            <tr>
              {["Version", "Hoof wall", "Pastern", "Alignment", "Saved by", "Saved at", ""].map((column, index) => (
                <th key={index} scope="col">
                  {column || <span className="visually-hidden">Restore</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {history.map((entry) => (
              <tr key={entry.version} data-history={entry.version} tabIndex={-1}>
                <td data-label="Version" className="num">
                  {entry.version}
                  {entry.restored_from !== null ? <span className="muted"> (from {entry.restored_from})</span> : null}
                </td>
                <td data-label="Hoof wall" className="num">
                  {degrees(entry.hoof_wall.angle)}
                </td>
                <td data-label="Pastern" className="num">
                  {degrees(entry.pastern.angle)}
                </td>
                <td data-label="Alignment">{entry.alignment}</td>
                <td data-label="Saved by">{entry.saved_by.name}</td>
                <td data-label="Saved at" className="num">
                  {entry.saved_at.slice(0, 10)} {entry.saved_at.slice(11, 16)}
                </td>
                <td data-label="Restore">
                  {entry.version !== version ? (
                    <Button busy={busy === entry.version} aria-label={`Restore version ${entry.version}`} onClick={() => void restore(entry.version)}>
                      Restore
                    </Button>
                  ) : (
                    <span className="muted">Current</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CloseVisit({ visit, onClosed }: { visit: Visit; onClosed: () => void }) {
  const notify = useNotify();
  const [work, setWork] = useState<WorkCode[]>([]);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, run] = useAction();
  /** A resend after a lost answer reuses the key of the unanswered close with the same body. */
  const attempt = useRef<{ key: string; body: string } | null>(null);
  const root = useRef<HTMLFormElement>(null);

  function close(event: FormEvent): void {
    event.preventDefault();
    void run("Closing visit…", async () => {
      const body = { work, note };
      const text = JSON.stringify(body);
      if (attempt.current?.body !== text) attempt.current = { key: freshKey(), body: text };
      const result = await request<Visit>("POST", `/api/visits/${encodeURIComponent(visit.id)}/close`, {
        body,
        idempotencyKey: attempt.current.key,
      });
      if (result.status !== 0 && !(result.ok === false && result.error.error === "idempotency_in_progress")) attempt.current = null;
      if (result.ok) {
        setErrors({});
        notify(
          result.data.status === "invoiced" && result.data.invoice
            ? `Visit closed and invoiced: ${dollars(result.data.invoice.total_cents)}.`
            : "Visit closed — invoice pending. It will be invoiced when billing is back.",
          "success",
        );
        onClosed();
      } else if (result.error.error === "validation") {
        setErrors(result.error.errors ?? {});
        notify("Check the highlighted fields.", "error");
        focusFirstInvalid(root.current);
      } else {
        notify(
          failure(result.error, {
            idempotency_in_progress: "This visit is still closing. Its row will update shortly.",
            illegal_transition: "This visit is already closed.",
            photos_required: "Upload an after photo before closing this visit.",
          }),
          "error",
        );
        if (result.error.error === "illegal_transition") onClosed();
      }
    });
  }

  return (
    <form className="panel close-visit" ref={root} onSubmit={close} noValidate>
      <h3>Close visit</h3>
      <fieldset className="work-done" aria-describedby={errors.work ? "work-error" : undefined}>
        <legend>Work done</legend>
        <div className="choices checks">
          {WORK_CODES.map((code) => (
            <label key={code} className="choice">
              <input
                type="checkbox"
                checked={work.includes(code)}
                aria-invalid={errors.work ? true : undefined}
                onChange={(event) =>
                  setWork((current) => (event.target.checked ? [...current, code] : current.filter((item) => item !== code)))
                }
              />
              <span>{SERVICE_NAMES[code]}</span>
            </label>
          ))}
        </div>
        {errors.work ? (
          <p className="field-error" id="work-error">
            <span className="prefix">Error: </span>
            {errors.work}
          </p>
        ) : null}
      </fieldset>
      <Field label="Visit note" error={errors.note}>
        {(props) => <textarea {...props} rows={3} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />}
      </Field>
      <Button type="submit" variant="primary" busy={busy}>
        Close visit
      </Button>
    </form>
  );
}

// ---- Vet links (farrier) ----

/** A vet link's pair as `<previous date> → <current date>` (brief: Public screens, Vet links and Link views). */
const pairText = (previous: string | null, current: string | null): string => (previous && current ? `${previous} \u2192 ${current}` : "");

function VetLinks({ horseId }: { horseId: string }) {
  const { practice } = useSession();
  const notify = useNotify();
  const [links, setLinks] = useState<VetLinkEntry[] | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sending, runSend] = useAction();
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [views, setViews] = useState<{ link: VetLinkEntry; rows: LinkView[] } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const base = `/api/horses/${encodeURIComponent(horseId)}/vet-links`;

  async function showViews(link: VetLinkEntry): Promise<void> {
    setBusyRow(`views-${link.id}`);
    const result = await get<LinkView[]>(`/api/vet-links/${encodeURIComponent(link.id)}/views`);
    setBusyRow(null);
    if (result.ok) {
      setViews({ link, rows: result.data });
      focusWhenReady(() => document.querySelector<HTMLElement>("#link-views-title"));
    } else notify(failure(result.error), "error");
  }

  useEffect(() => {
    let live = true;
    void get<VetLinkEntry[]>(base).then((result) => {
      if (live && result.ok) setLinks(result.data);
    });
    return () => {
      live = false;
    };
  }, [base, epoch]);

  function dismiss(): void {
    setOpen(false);
    focusWhenReady(focusKey("send-vet-link"));
  }

  function send(event: FormEvent): void {
    event.preventDefault();
    void runSend("Sending link…", async () => {
      const result = await request("POST", base, { body: { vet_name: name, vet_email: email } });
      if (result.ok) {
        notify(`Comparison link sent to ${email.trim()}.`, "success");
        setErrors({});
        setName("");
        setEmail("");
        dismiss();
        setEpoch((value) => value + 1);
      } else if (result.error.error === "validation") {
        setErrors(result.error.errors ?? {});
        notify("Check the highlighted fields.", "error");
        focusFirstInvalid(formRef.current);
      } else notify(failure(result.error, { not_enough_visits: "This horse needs two closed visits before a vet link can be sent." }), "error");
    });
  }

  async function act(link: VetLinkEntry, action: "revoke" | "regenerate"): Promise<void> {
    setBusyRow(`${action}-${link.id}`);
    notify(action === "revoke" ? "Revoking…" : "Sending new link…", "pending");
    const result = await request("POST", `/api/vet-links/${encodeURIComponent(link.id)}/${action}`);
    setBusyRow(null);
    if (result.ok)
      notify(action === "revoke" ? "Link revoked." : `New link sent to ${link.vet_email}. The old link no longer works.`, "success");
    else notify(failure(result.error), "error");
    setEpoch((value) => value + 1);
  }

  return (
    <section className="subsection" aria-labelledby="vet-links-title">
      <div className="section-head">
        <h2 id="vet-links-title" className="section-title">
          Vet links
        </h2>
        <Button data-focus="send-vet-link" onClick={() => setOpen(true)}>
          Send vet link
        </Button>
      </div>
      {links === null ? (
        <Skeleton rows={1} />
      ) : links.length === 0 ? (
        <p className="muted">No comparison links sent for this horse yet.</p>
      ) : (
        <div className="table-scroll">
        <table className="ledger" role="table" aria-label="Vet links">
          <thead role="rowgroup">
            <tr role="row">
              {["Vet", "Email", "Status", "Works until", "Pair", "Views", "Actions"].map((column) => (
                <th key={column} role="columnheader" scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody role="rowgroup">
            {links.map((link) => (
              <tr key={link.id} role="row">
                <td role="cell" data-label="Vet">
                  {link.vet_name}
                </td>
                <td role="cell" data-label="Email" className="wrap">
                  {link.vet_email}
                </td>
                <td role="cell" data-label="Status">
                  <StatusTag status={link.status}>
                    {link.status === "active" ? "Active" : link.status === "revoked" ? "Revoked" : "Expired"}
                  </StatusTag>
                </td>
                <td role="cell" data-label="Works until" className="num">
                  {wallClock(link.expires_at, practice.time_zone)}
                </td>
                <td role="cell" data-label="Pair" className="num">
                  {pairText(link.previous_date, link.current_date)}
                </td>
                <td role="cell" data-label="Views" className="num">
                  {link.view_count}
                </td>
                <td role="cell" data-label="Actions">
                  <span className="row-actions">
                    {link.status === "active" ? (
                      <Button
                        busy={busyRow === `revoke-${link.id}`}
                        aria-label={`Revoke link to ${link.vet_email}`}
                        onClick={() => void act(link, "revoke")}
                      >
                        Revoke
                      </Button>
                    ) : null}
                    <Button
                      busy={busyRow === `regenerate-${link.id}`}
                      aria-label={`Regenerate link to ${link.vet_email}`}
                      onClick={() => void act(link, "regenerate")}
                    >
                      Regenerate
                    </Button>
                    <Button busy={busyRow === `views-${link.id}`} aria-label={`Views for ${link.vet_email}`} onClick={() => void showViews(link)}>
                      Views
                    </Button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      {views ? (
        <div className="link-views">
          <h3 id="link-views-title" tabIndex={-1}>
            Views of the link to <span className="wrap">{views.link.vet_email}</span>
          </h3>
          {views.rows.length === 0 ? (
            <p className="muted">Nobody has opened this link yet.</p>
          ) : (
            <div className="table-scroll">
              <table className="ledger" aria-label="Link views">
                <thead>
                  <tr>
                    {["At", "Address", "Outcome", "Pair", "User agent"].map((column) => (
                      <th key={column} scope="col">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {views.rows.map((view, index) => (
                    <tr key={`${view.at}-${index}`}>
                      <td data-label="At" className="num">
                        {view.at.slice(0, 10)} {view.at.slice(11, 19)}
                      </td>
                      <td data-label="Address" className="num wrap">
                        {view.address}
                      </td>
                      <td data-label="Outcome">
                        <span className="chip">{view.outcome === "viewed" ? "Viewed" : view.outcome === "expired" ? "Expired" : "Revoked"}</span>
                      </td>
                      <td data-label="Pair" className="num">
                        {view.outcome === "viewed" ? pairText(view.previous_date, view.current_date) : ""}
                      </td>
                      <td data-label="User agent" className="wrap muted">
                        {view.user_agent}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
      <Modal title="Send vet link" open={open} onDismiss={dismiss}>
        <form ref={formRef} className="dialog-form" onSubmit={send} noValidate>
          <p className="dialog-body">The vet gets a read-only comparison of this horse's two most recent closed visits.</p>
          <Field label="Vet name" error={errors.vet_name}>
            {(props) => <input {...props} type="text" autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} />}
          </Field>
          <Field label="Vet email" error={errors.vet_email}>
            {(props) => <input {...props} type="email" autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} />}
          </Field>
          <div className="dialog-actions">
            <Button type="submit" variant="primary" busy={sending}>
              Send link
            </Button>
            <Button onClick={dismiss}>Cancel</Button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
