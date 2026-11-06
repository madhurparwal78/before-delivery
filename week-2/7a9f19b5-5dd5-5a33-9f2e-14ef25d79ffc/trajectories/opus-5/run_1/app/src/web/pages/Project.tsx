/**
 * The project screen: the light-pool room, the mirrored light-pools table, project
 * lines, unplaced fittings, collaborators, "Viewing now", comments, the cover image
 * and the quote shares.
 *
 * Placement works entirely from the keyboard: arrow keys move a fitting 100 mm,
 * Shift+arrow 500 mm, Delete or Backspace removes it, Escape moves focus to the
 * ceiling slider, and Tab always leaves the room. The canvas never takes focus.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api.js";
import { PROJECTS } from "../../shared/copy.js";
import { CEILING_SLIDER_STEP_MM, clamp, LIMITS, snapToGrid } from "../../shared/domain.js";
import type { Comment, Placement, PresenceViewer, Project, QuoteShare } from "../../shared/types.js";
import { useAnnouncer, usePrefersReducedMotion, useSession } from "../state/app.js";
import { Dialog } from "../components/Dialog.js";
import { RoomViewer } from "../three/RoomViewer.js";
import { RoomPlan, type PlanPool } from "../three/FittingDrawing.js";
import { hasWebGl, sceneAmbient } from "../three/ProductViewer.js";

/** The whole entry sequence takes no more than 1.5 seconds. */
const SEQUENCE_MS = 1_400;
type Phase = "cone" | "pool" | "tint" | "count" | "settled";

/** Which phase a progress value falls in, matching the room's four steps. */
function phaseFor(t: number): Phase {
  if (t >= 1) return "settled";
  if (t < 0.35) return "cone";
  if (t < 0.55) return "pool";
  if (t < 0.75) return "tint";
  return "count";
}

export function ProjectPage({ id }: { id: string }) {
  const { lightState } = useSession();
  const reduced = usePrefersReducedMotion();
  const { message, announce } = useAnnouncer();
  const [roomMessage, setRoomMessage] = useState("");
  const [liveMessage, setLiveMessage] = useState("");

  const [project, setProject] = useState<Project | null>(null);
  const [missing, setMissing] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [viewers, setViewers] = useState<PresenceViewer[]>([]);
  const [shares, setShares] = useState<QuoteShare[]>([]);
  const [webgl] = useState(hasWebGl);

  // Entry-sequence progress per placement, and the room's reported phase.
  const [growth, setGrowth] = useState<Record<string, number>>({});
  const [phase, setPhase] = useState<Phase>("settled");
  const animatingRef = useRef<Map<string, number>>(new Map());

  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [collaboratorEmail, setCollaboratorEmail] = useState("");
  const [commentDraft, setCommentDraft] = useState("");
  const [posting, setPosting] = useState(false);

  const placeButtonRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());
  const fittingButtonRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());
  const ceilingRef = useRef<HTMLInputElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  // Whether live collaboration is connected, so only a change announces itself.
  const liveRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const { project: loaded } = await api.project(id);
      setProject(loaded);
      liveRef.current = loaded.live;
      // Placements already saved are settled, not re-animated.
      setGrowth((current) => {
        const next: Record<string, number> = {};
        for (const placement of loaded.placements) next[placement.id] = current[placement.id] ?? 1;
        return next;
      });
    } catch {
      setMissing(true);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadShares = useCallback(async () => {
    try {
      const { shares: loaded } = await api.shares(id);
      setShares(loaded);
    } catch {
      setShares([]);
    }
  }, [id]);

  useEffect(() => {
    void loadShares();
  }, [loadShares]);

  const loadComments = useCallback(async () => {
    try {
      const { comments: loaded } = await api.comments(id);
      setComments(loaded);
      return true;
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      return false;
    }
  }, [id]);

  useEffect(() => {
    void loadComments();
  }, [loadComments]);

  // A share that is still being prepared is re-read until it is ready.
  useEffect(() => {
    if (!shares.some((share) => share.pdf_status !== "ready")) return;
    const timer = setInterval(() => void loadShares(), 3_000);
    return () => clearInterval(timer);
  }, [shares, loadShares]);

  /** The live stream carries presence, comments and placement changes. */
  useEffect(() => {
    const source = new EventSource(`/api/projects/${id}/live`);
    source.onmessage = (event) => {
      const data = JSON.parse(event.data) as
        | { type: "presence"; viewers: PresenceViewer[] }
        | { type: "comment"; comment: Comment }
        | { type: "placement"; action: string; placement: Placement }
        | { type: "status"; live: boolean };

      if (data.type === "presence") setViewers(data.viewers);
      else if (data.type === "comment") {
        setComments((current) =>
          current.some((held) => held.id === data.comment.id) ? current : [...current, data.comment],
        );
      } else if (data.type === "placement") {
        void load();
      } else if (data.type === "status") {
        if (liveRef.current !== data.live) {
          liveRef.current = data.live;
          setLiveMessage(data.live ? PROJECTS.liveBack : PROJECTS.livePaused);
          if (data.live) void loadComments();
        }
      }
    };
    return () => source.close();
  }, [id, load, loadComments]);

  /** Runs the four-step entry sequence for one placement. */
  const runSequence = useCallback(
    (placementId: string) => {
      if (reduced) {
        // Under reduced motion the cone and pool appear at full size in one frame.
        setGrowth((current) => ({ ...current, [placementId]: 1 }));
        setPhase("settled");
        return;
      }
      const start = performance.now();
      const step = (now: number): void => {
        const t = Math.min(1, (now - start) / SEQUENCE_MS);
        setGrowth((current) => ({ ...current, [placementId]: t }));
        setPhase(phaseFor(t));
        if (t < 1) {
          animatingRef.current.set(placementId, requestAnimationFrame(step));
        } else {
          animatingRef.current.delete(placementId);
        }
      };
      animatingRef.current.set(placementId, requestAnimationFrame(step));
    },
    [reduced],
  );

  useEffect(
    () => () => {
      for (const frame of animatingRef.current.values()) cancelAnimationFrame(frame);
    },
    [],
  );

  if (missing) {
    return (
      <div className="wrap section">
        <h1>Project not found</h1>
      </div>
    );
  }
  if (!project) {
    return (
      <div className="wrap section">
        <h1 />
      </div>
    );
  }

  const unplaced = project.lines.flatMap((line) =>
    Array.from({ length: Math.max(0, line.quantity - line.placed) }, (_, index) => ({
      code: line.variant_code,
      key: `${line.variant_code}-${index}`,
    })),
  );

  const place = async (code: string): Promise<void> => {
    // "Place <code>" puts the fitting at the centre of the room, rounded to 100 mm.
    const x = snapToGrid(project.room_width_mm / 2);
    const y = snapToGrid(project.room_depth_mm / 2);
    try {
      const { placement } = await api.createPlacement(project.id, { variant_code: code, x_mm: x, y_mm: y });
      await load();
      setGrowth((current) => ({ ...current, [placement.id]: 0 }));
      runSequence(placement.id);
      setRoomMessage(
        PROJECTS.placed(code, placement.x_mm, placement.y_mm, placement.pool_diameter_mm, placement.centre_lux),
      );
      // Focus moves to the new fitting's button.
      requestAnimationFrame(() => fittingButtonRefs.current.get(placement.id)?.focus());
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (error.failure.code === "placement_exceeds_quantity") setRoomMessage(PROJECTS.allPlaced(code));
    }
  };

  const move = async (placement: Placement, dx: number, dy: number): Promise<void> => {
    const x = clamp(placement.x_mm + dx, 0, project.room_width_mm);
    const y = clamp(placement.y_mm + dy, 0, project.room_depth_mm);
    if (x === placement.x_mm && y === placement.y_mm) return;
    const { placement: moved } = await api.movePlacement(project.id, placement.id, { x_mm: x, y_mm: y });
    await load();
    setRoomMessage(PROJECTS.moved(moved.variant_code, moved.x_mm, moved.y_mm));
    requestAnimationFrame(() => fittingButtonRefs.current.get(moved.id)?.focus());
  };

  const remove = async (placement: Placement): Promise<void> => {
    await api.deletePlacement(project.id, placement.id);
    await load();
    setRoomMessage(PROJECTS.removed(placement.variant_code));
    // Focus returns to the matching "Place <code>" button.
    requestAnimationFrame(() => placeButtonRefs.current.get(placement.variant_code)?.focus());
  };

  const setCeiling = async (value: number): Promise<void> => {
    const { project: updated } = await api.patchProject(project.id, { ceiling_height_mm: value });
    setProject(updated);
  };

  const postComment = async (): Promise<void> => {
    if (commentDraft.trim() === "") return;
    setPosting(true);
    try {
      const { comment } = await api.postComment(project.id, commentDraft);
      setComments((current) => [...current, comment]);
      setCommentDraft("");
      announce(PROJECTS.commentPosted);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (error.failure.code === "collaboration_unavailable") announce(PROJECTS.commentsUnavailable);
      else if (error.field("body")) announce(PROJECTS.commentTooLong);
    } finally {
      setPosting(false);
    }
  };

  const invite = async (): Promise<void> => {
    try {
      const { collaborator } = await api.addCollaborator(project.id, collaboratorEmail.trim());
      announce(PROJECTS.collaboratorAdded(collaborator.name));
      setCollaboratorEmail("");
      await load();
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      announce(PROJECTS.notTradeAccount);
    }
  };

  const uploadCover = async (file: File): Promise<void> => {
    announce(PROJECTS.uploadingCover);
    try {
      await api.uploadCover(project.id, file);
      announce(PROJECTS.coverReady);
      await load();
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (error.failure.code === "storage_unavailable") announce(PROJECTS.coverStorageDown);
      else announce(PROJECTS.coverRejected);
    }
  };

  const pools: PlanPool[] = project.placements.map((placement) => ({
    id: placement.id,
    code: placement.variant_code,
    xMm: placement.x_mm,
    yMm: placement.y_mm,
    diameterMm: placement.pool_diameter_mm,
    cctK: placement.cct_k,
  }));

  return (
    <div className="wrap section">
      <div className="spread" style={{ marginBottom: 16 }}>
        <div>
          <h1>{project.name}</h1>
          {project.client_name && <p className="muted">{project.client_name}</p>}
        </div>
        {project.is_owner && (
          <button type="button" className="button" onClick={() => setShareDialogOpen(true)}>
            Share quote
          </button>
        )}
      </div>

      <p role="status" aria-label="Project updates" className="small muted">
        {message}
      </p>

      <div className="room-layout">
        <div className="room-main">
          <section
            aria-label="Light-pool room"
            data-phase={phase}
            className="stack"
          >
            <div className="room-stage" ref={stageRef}>
              {webgl ? (
                <RoomViewer
                  widthMm={project.room_width_mm}
                  depthMm={project.room_depth_mm}
                  ceilingHeightMm={project.ceiling_height_mm}
                  placements={project.placements}
                  ambient={sceneAmbient(lightState)}
                  growth={growth}
                />
              ) : (
                <RoomPlan
                  widthMm={project.room_width_mm}
                  depthMm={project.room_depth_mm}
                  pools={pools}
                  className="room-plan"
                />
              )}

              {/* One button per placed fitting, over its position on the canvas. */}
              {project.placements.map((placement) => (
                <button
                  key={placement.id}
                  type="button"
                  className="fitting-button"
                  ref={(element) => {
                    fittingButtonRefs.current.set(placement.id, element);
                  }}
                  style={{
                    left: `${(placement.x_mm / project.room_width_mm) * 100}%`,
                    top: `${(placement.y_mm / project.room_depth_mm) * 100}%`,
                  }}
                  onKeyDown={(event) => {
                    const stepMm = event.shiftKey ? LIMITS.shiftNudgeMm : LIMITS.nudgeMm;
                    if (event.key === "ArrowRight") {
                      event.preventDefault();
                      void move(placement, stepMm, 0);
                    } else if (event.key === "ArrowLeft") {
                      event.preventDefault();
                      void move(placement, -stepMm, 0);
                    } else if (event.key === "ArrowDown") {
                      event.preventDefault();
                      void move(placement, 0, stepMm);
                    } else if (event.key === "ArrowUp") {
                      event.preventDefault();
                      void move(placement, 0, -stepMm);
                    } else if (event.key === "Delete" || event.key === "Backspace") {
                      event.preventDefault();
                      void remove(placement);
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      ceilingRef.current?.focus();
                    }
                  }}
                >
                  <span className="visually-hidden">
                    {`${placement.variant_code} #${placement.ordinal} at ${placement.x_mm} mm, ${placement.y_mm} mm`}
                  </span>
                  <span aria-hidden="true">{placement.ordinal}</span>
                </button>
              ))}
            </div>

            <div className="field">
              <label htmlFor="ceiling-height">Ceiling height</label>
              <input
                id="ceiling-height"
                type="range"
                ref={ceilingRef}
                min={LIMITS.ceilingHeightMm.min}
                max={LIMITS.ceilingHeightMm.max}
                step={CEILING_SLIDER_STEP_MM}
                value={project.ceiling_height_mm}
                aria-valuetext={`${(project.ceiling_height_mm / 1000).toFixed(1)} m`}
                onChange={(event) => void setCeiling(Number(event.target.value))}
              />
              <span className="numeric small">{`${(project.ceiling_height_mm / 1000).toFixed(1)} m`}</span>
            </div>

            <p role="status" aria-label="Room updates" className="small muted">
              {roomMessage}
            </p>
          </section>

          <div className="table-frame" style={{ marginTop: 16 }}>
            <table aria-label="Light pools">
              <thead>
                <tr>
                  <th scope="col">Code</th>
                  <th scope="col">X (mm)</th>
                  <th scope="col">Y (mm)</th>
                  <th scope="col">Beam</th>
                  <th scope="col">Pool diameter (mm)</th>
                  <th scope="col">Centre lux</th>
                </tr>
              </thead>
              <tbody>
                {project.placements.map((placement) => (
                  <tr key={placement.id}>
                    <td className="numeric">{placement.variant_code}</td>
                    <td className="numeric">{placement.x_mm}</td>
                    <td className="numeric">{placement.y_mm}</td>
                    <td className="numeric">{`${placement.beam_deg}\u00b0`}</td>
                    <td className="numeric">{placement.pool_diameter_mm}</td>
                    <td className="numeric">{placement.centre_lux}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="room-side stack" style={{ gap: 24 }}>
          <section className="framed">
            <h3>Viewing now</h3>
            <ul className="viewing-now" aria-label="Viewing now">
              {viewers.map((viewer) => (
                <li key={viewer.user_id}>
                  <span className="avatar" role="img" aria-label={viewer.name}>
                    {viewer.initials}
                  </span>
                </li>
              ))}
            </ul>
            <p role="status" aria-label="Live collaboration" className="small muted">
              {liveMessage}
            </p>
          </section>

          <section className="framed">
            <h3>Fittings</h3>
            <div className="table-frame">
              <table aria-label="Project lines">
                <thead>
                  <tr>
                    <th scope="col">Code</th>
                    <th scope="col">Qty</th>
                    <th scope="col">Placed</th>
                  </tr>
                </thead>
                <tbody>
                  {project.lines.map((line) => (
                    <tr key={line.variant_code}>
                      <td className="numeric">{line.variant_code}</td>
                      <td>
                        <label className="visually-hidden" htmlFor={`pqty-${line.variant_code}`}>
                          {`Quantity for ${line.variant_code}`}
                        </label>
                        <input
                          id={`pqty-${line.variant_code}`}
                          type="number"
                          min={0}
                          max={999}
                          value={line.quantity}
                          style={{ maxWidth: 80 }}
                          onChange={(event) => {
                            const next = Number(event.target.value);
                            if (!Number.isFinite(next) || next < 0) return;
                            void api
                              .setProjectLine(project.id, line.variant_code, next)
                              .then(({ project: updated }) => setProject(updated))
                              .catch(() => undefined);
                          }}
                        />
                      </td>
                      <td className="numeric">{line.placed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h4 style={{ marginTop: 16 }}>Unplaced fittings</h4>
            <ul className="unplaced-list" aria-label="Unplaced fittings">
              {unplaced.map((entry, index) => (
                <li key={entry.key}>
                  <button
                    type="button"
                    className="button button-quiet small"
                    ref={(element) => {
                      // The first button of each code is the focus target after a removal.
                      if (index === unplaced.findIndex((candidate) => candidate.code === entry.code)) {
                        placeButtonRefs.current.set(entry.code, element);
                      }
                    }}
                    onClick={() => void place(entry.code)}
                  >
                    {`Place ${entry.code}`}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="framed" aria-label="Comments">
            <h3>Comments</h3>
            <ul className="comment-thread" aria-label="Comment thread">
              {comments.map((comment) => (
                <li key={comment.id} className="comment">
                  <div className="small muted">{comment.author_name}</div>
                  <div className="comment-body">{comment.body}</div>
                </li>
              ))}
            </ul>
            <div className="field" style={{ marginTop: 12 }}>
              <label htmlFor="comment-body">Add a comment</label>
              {/* Enter inserts a new line; the button posts. */}
              <textarea
                id="comment-body"
                value={commentDraft}
                onChange={(event) => setCommentDraft(event.target.value)}
              />
            </div>
            <button
              type="button"
              className="button"
              disabled={posting}
              onClick={() => void postComment()}
            >
              {posting ? PROJECTS.posting : "Post comment"}
            </button>
          </section>

          <section className="framed">
            <h3>Cover image</h3>
            {project.cover && (
              <img className="cover-image" src={project.cover.url} alt="Project cover" />
            )}
            <div className="field" style={{ marginTop: 10 }}>
              <label htmlFor="cover-input">Cover image</label>
              <input
                id="cover-input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadCover(file);
                }}
              />
            </div>
            <button
              type="button"
              className="button"
              onClick={() => document.getElementById("cover-input")?.click()}
            >
              Upload cover
            </button>
          </section>

          {project.is_owner && (
            <section className="framed">
              <h3>Collaborators</h3>
              <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {project.collaborators.map((collaborator) => (
                  <li key={collaborator.user_id} className="small">
                    {`${collaborator.name} \u00b7 ${collaborator.email}`}
                  </li>
                ))}
              </ul>
              <div className="field" style={{ marginTop: 12 }}>
                <label htmlFor="collaborator-email">Collaborator email</label>
                <input
                  id="collaborator-email"
                  type="email"
                  value={collaboratorEmail}
                  onChange={(event) => setCollaboratorEmail(event.target.value)}
                />
              </div>
              <button type="button" className="button" onClick={() => void invite()}>
                Invite
              </button>
            </section>
          )}

          <section className="framed">
            <h3>Quote shares</h3>
            <div className="table-frame">
              <table aria-label="Quote shares">
                <thead>
                  <tr>
                    <th scope="col">Recipients</th>
                    <th scope="col">Prices</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {shares.map((share) => (
                    <tr key={share.id}>
                      <td className="small">{share.recipients.join(", ")}</td>
                      <td className="small">{share.price_display}</td>
                      <td className="small">
                        {share.pdf_status === "ready"
                          ? PROJECTS.shareReady
                          : share.pdf_status === "waiting_for_storage"
                            ? PROJECTS.shareWaitingForStorage
                            : PROJECTS.sharePending}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>

      {shareDialogOpen && (
        <ShareQuoteDialog
          projectId={project.id}
          onClose={() => setShareDialogOpen(false)}
          onQueued={(count) => {
            announce(PROJECTS.quoteQueued(count));
            setShareDialogOpen(false);
            void loadShares();
          }}
          onInvalid={() => announce(PROJECTS.recipientsInvalid)}
        />
      )}
    </div>
  );
}

function ShareQuoteDialog({
  projectId,
  onClose,
  onQueued,
  onInvalid,
}: {
  projectId: string;
  onClose: () => void;
  onQueued: (count: number) => void;
  onInvalid: () => void;
}) {
  const [recipients, setRecipients] = useState("");
  const [priceDisplay, setPriceDisplay] = useState<"trade" | "retail" | "none">("trade");
  const [messageText, setMessageText] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    const list = recipients
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    setBusy(true);
    try {
      await api.createShare(projectId, {
        recipients: list,
        price_display: priceDisplay,
        ...(messageText.trim() === "" ? {} : { message: messageText.trim() }),
      });
      onQueued(list.length);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      onInvalid();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Share quote" onClose={onClose}>
      <div className="stack">
        <div className="field">
          <label htmlFor="share-recipients">Recipients</label>
          <input
            id="share-recipients"
            type="text"
            value={recipients}
            onChange={(event) => setRecipients(event.target.value)}
          />
        </div>

        <fieldset className="radio-set" role="radiogroup" aria-label="Price display">
          <legend>Price display</legend>
          {(
            [
              ["trade", "Trade prices"],
              ["retail", "Retail prices"],
              ["none", "No prices"],
            ] as const
          ).map(([value, label]) => (
            <label className="chip" key={value}>
              <input
                type="radio"
                name="price_display"
                checked={priceDisplay === value}
                onChange={() => setPriceDisplay(value)}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>

        <div className="field">
          <label htmlFor="share-message">Message</label>
          <textarea
            id="share-message"
            value={messageText}
            onChange={(event) => setMessageText(event.target.value)}
          />
        </div>
      </div>
      <div className="dialog-actions">
        <button type="button" className="button button-primary" disabled={busy} onClick={() => void submit()}>
          {busy ? PROJECTS.sending : "Send quote"}
        </button>
      </div>
    </Dialog>
  );
}
