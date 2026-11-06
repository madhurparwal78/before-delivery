import { Layers, Plus, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { Job, PlanRevision, Room } from "../../shared/domain";
import { useAnnounce } from "../activity";
import { ApiFailure, api } from "../api";
import { Dialog } from "../components/Dialog";
import { ErrorSummary, FieldError, type FieldProblem } from "../components/ErrorSummary";
import { COPY, cornersText, parseCorners, percentToFraction } from "../copy";
import { localDateTime } from "../time";
import { useJob } from "./context";

const CORNERS_HINT = "Each corner as x,y in percent of the plan's width and height, in order, separated by semicolons.";

function AddRoom({ disabled }: { disabled: boolean }) {
  const { session, job } = useJob();
  const announce = useAnnounce();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [corners, setCorners] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const outline = parseCorners(corners);
    if (!outline) {
      setErrors({ outline: "Write the corners as x,y pairs in percent from 0 to 100, separated by semicolons." });
      return;
    }
    setPending(true);
    announce(COPY.saving);
    try {
      const room = await api<Room>("POST", `/api/jobs/${job.id}/rooms`, { name, outline });
      if (!session.snapshot?.rooms.some((existing) => existing.id === room.id)) {
        session.setSnapshot({ rooms: [...(session.snapshot?.rooms ?? []), room] });
      }
      setErrors({});
      setName("");
      setCorners("");
      setOpen(false);
      announce("Room saved.");
    } catch (error) {
      if (error instanceof ApiFailure) {
        setErrors(error.body.fields ?? {});
        announce(error.message);
      } else announce("Saving a room needs a connection.");
    } finally {
      setPending(false);
    }
  };

  const problems: FieldProblem[] = Object.entries(errors).map(([field, message]) => ({
    target: field === "name" ? "room-name" : "room-corners",
    message,
  }));

  return (
    <>
      <button type="button" className="btn btn--primary" disabled={disabled} onClick={() => setOpen(true)}>
        <Plus size={16} aria-hidden="true" />
        Add room
      </button>
      <Dialog open={open} title="Add room" onClose={() => setOpen(false)}>
        <form className="stack" onSubmit={submit} noValidate>
          <ErrorSummary problems={problems} />
          <div className="field">
            <label htmlFor="room-name">Room name</label>
            <input id="room-name" className="input" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={errors.name ? true : undefined} />
            <FieldError id="room-name-error" message={errors.name} />
          </div>
          <div className="field">
            <label htmlFor="room-corners">Corners</label>
            <textarea
              id="room-corners"
              className="input mono"
              rows={2}
              value={corners}
              placeholder="4,5; 52,5; 52,30; 40,30; 40,47; 4,47"
              aria-describedby="room-corners-hint"
              aria-invalid={errors.outline ? true : undefined}
              onChange={(e) => setCorners(e.target.value)}
            />
            <p className="hint" id="room-corners-hint">
              {CORNERS_HINT}
            </p>
            <FieldError id="room-corners-error" message={errors.outline} />
          </div>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={pending} aria-busy={pending}>
              Save room
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/** Reads `old x,old y > new x,new y; …` in percent into reference point pairs; null when it doesn't read. */
function parseReferencePoints(text: string) {
  const pairs = text.split(";").filter((part) => part.trim() !== "").map((part) => {
    const [from, to, ...rest] = part.split(">");
    const read = (point: string | undefined) => {
      const [x, y, ...more] = (point ?? "").split(",");
      const fx = percentToFraction(x ?? "");
      const fy = percentToFraction(y ?? "");
      return more.length === 0 && fx !== null && fy !== null ? { x: fx, y: fy } : null;
    };
    const old = read(from);
    const next = read(to);
    return rest.length === 0 && old && next ? { old, new: next } : null;
  });
  return pairs.every((pair) => pair !== null) ? pairs : null;
}

function UploadRevision({ disabled, onUploaded }: { disabled: boolean; onUploaded: () => void }) {
  const { session, job } = useJob();
  const announce = useAnnounce();
  const rooms = session.view().rooms;
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [points, setPoints] = useState("");
  const [outlines, setOutlines] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  const start = () => {
    setOutlines(Object.fromEntries(rooms.map((room) => [room.id, cornersText(room.outline)])));
    setErrors({});
    setOpen(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const local: Record<string, string> = {};
    const pairs = parseReferencePoints(points);
    if (!pairs) local.reference_points = "Write three pairs as old x,old y > new x,new y in percent, separated by semicolons.";
    const roomOutlines = rooms.map((room) => ({ room_id: room.id, outline: parseCorners(outlines[room.id] ?? "") }));
    const unreadable = rooms.find((_, index) => roomOutlines[index]!.outline === null);
    if (unreadable) local.rooms = `Write ${unreadable.name}'s corners as x,y pairs in percent, separated by semicolons.`;
    if (!file) local.file = "Choose the revision image.";
    if (Object.keys(local).length > 0) {
      setErrors(local);
      return;
    }
    const form = new FormData();
    form.append("file", file!);
    form.append("reference_points", JSON.stringify(pairs));
    form.append("rooms", JSON.stringify(roomOutlines));
    setPending(true);
    announce(COPY.saving);
    try {
      const result = await api<{ revision: number; job: Job; moved: number; needs_review: number }>(
        "POST",
        `/api/jobs/${job.id}/plan/revisions`,
        form,
      );
      session.setSnapshot({ job: result.job });
      void session.refresh();
      setOpen(false);
      setFile(null);
      setPoints("");
      announce(`Plan revision ${result.revision} uploaded: ${result.moved} pins moved, ${result.needs_review} need review.`);
      onUploaded();
    } catch (error) {
      if (error instanceof ApiFailure) {
        setErrors(error.body.fields ?? {});
        announce(error.message);
      } else announce("Uploading a revision needs a connection.");
    } finally {
      setPending(false);
    }
  };

  const problems: FieldProblem[] = Object.entries(errors).map(([field, message]) => ({
    target: field === "file" ? "revision-image" : field === "reference_points" ? "revision-points" : `revision-room-${rooms[0]?.id ?? ""}`,
    message,
  }));

  return (
    <>
      <button type="button" className="btn" disabled={disabled || !job.plan_url} onClick={start}>
        <Layers size={16} aria-hidden="true" />
        Upload revision
      </button>
      <Dialog open={open} title="Upload plan revision" onClose={() => setOpen(false)}>
        <form className="stack" onSubmit={submit} noValidate>
          <ErrorSummary problems={problems} />
          <div className="field">
            <label htmlFor="revision-image">Revision image</label>
            <input
              id="revision-image"
              className="input"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              aria-invalid={errors.file ? true : undefined}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <FieldError id="revision-image-error" message={errors.file} />
          </div>
          <div className="field">
            <label htmlFor="revision-points">Reference points</label>
            <textarea
              id="revision-points"
              className="input mono"
              rows={2}
              value={points}
              placeholder="10,10 > 12,10; 90,10 > 92,10; 10,90 > 12,90"
              aria-describedby="revision-points-hint"
              aria-invalid={errors.reference_points ? true : undefined}
              onChange={(event) => setPoints(event.target.value)}
            />
            <p className="hint" id="revision-points-hint">
              Three spots that appear on both drawings, each as old x,old y &gt; new x,new y in percent.
            </p>
            <FieldError id="revision-points-error" message={errors.reference_points} />
          </div>
          {rooms.map((room) => (
            <div className="field" key={room.id}>
              <label htmlFor={`revision-room-${room.id}`}>{room.name} corners</label>
              <textarea
                id={`revision-room-${room.id}`}
                className="input mono"
                rows={2}
                value={outlines[room.id] ?? ""}
                aria-invalid={errors.rooms ? true : undefined}
                onChange={(event) => setOutlines({ ...outlines, [room.id]: event.target.value })}
              />
            </div>
          ))}
          <FieldError id="revision-rooms-error" message={errors.rooms} />
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={pending} aria-busy={pending}>
              Upload revision
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function SetupTab() {
  const { session, job, online, readOnly } = useJob();
  const announce = useAnnounce();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [revisions, setRevisions] = useState<PlanRevision[]>([]);
  const rooms = session.view().rooms;
  const disabled = !online || readOnly;

  const loadRevisions = useCallback(async () => {
    try {
      setRevisions((await api<{ revisions: PlanRevision[] }>("GET", `/api/jobs/${job.id}/plan/revisions`)).revisions);
    } catch (error) {
      if (!(error instanceof ApiFailure)) return;
    }
  }, [job.id]);

  useEffect(() => {
    void loadRevisions();
  }, [loadRevisions, job.plan_revision]);

  const upload = async (file: File) => {
    setPending(true);
    announce(COPY.saving);
    const form = new FormData();
    form.append("file", file);
    try {
      session.setSnapshot({ job: await api<Job>("PUT", `/api/jobs/${job.id}/plan`, form) });
      announce("Plan uploaded.");
    } catch (error) {
      announce(error instanceof ApiFailure ? error.message : "Uploading a plan needs a connection.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="panel">
      <section className="panel-section" aria-labelledby="setup-plan">
        <div className="panel-head">
          <h2 id="setup-plan">Floor plan</h2>
          <div className="panel-actions">
            <button type="button" className="btn btn--primary" disabled={disabled || pending} aria-busy={pending} onClick={() => fileInput.current?.click()}>
              <Upload size={16} aria-hidden="true" />
              Upload plan
            </button>
            <UploadRevision disabled={disabled} onUploaded={() => void loadRevisions()} />
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-label="Upload plan"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void upload(file);
            }}
          />
        </div>
        <p className="muted">
          {job.plan_url
            ? "Upload plan replaces the drawing as a new revision with every pin kept in place. Upload revision maps every pin onto a redrawn plan from three reference points."
            : "Upload a JPEG, PNG or WebP image of the floor plan, up to 10,000,000 bytes."}
        </p>
        {!online && <p className="hint">Setup needs a connection.</p>}
        {revisions.length > 0 && (
          <div className="table-wrap">
            <table aria-label="Plan revisions">
              <thead>
                <tr>
                  <th scope="col">Revision</th>
                  <th scope="col">Uploaded by</th>
                  <th scope="col">Uploaded at</th>
                  <th scope="col" className="num">
                    Pins moved
                  </th>
                  <th scope="col" className="num">
                    Need review
                  </th>
                </tr>
              </thead>
              <tbody>
                {revisions.map((revision) => (
                  <tr key={revision.revision}>
                    <td className="mono">{revision.revision}</td>
                    <td className="wrap">{revision.uploaded_by.name}</td>
                    <td className="mono">{localDateTime(revision.created_at, job.time_zone)}</td>
                    <td className="mono num">{revision.moved}</td>
                    <td className="mono num">{revision.needs_review}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="panel-section" aria-labelledby="setup-rooms">
        <div className="panel-head">
          <h2 id="setup-rooms">Rooms</h2>
          <AddRoom disabled={disabled} />
        </div>
        {rooms.length === 0 ? (
          <p className="muted">No rooms yet. Add each room by typing its corners in order.</p>
        ) : (
          <div className="table-wrap">
            <table aria-label="Rooms">
              <thead>
                <tr>
                  <th scope="col">Room</th>
                  <th scope="col">Corners</th>
                </tr>
              </thead>
              <tbody>
                {rooms.map((room) => (
                  <tr key={room.id}>
                    <td className="wrap">{room.name}</td>
                    <td className="mono wrap">{cornersText(room.outline)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
