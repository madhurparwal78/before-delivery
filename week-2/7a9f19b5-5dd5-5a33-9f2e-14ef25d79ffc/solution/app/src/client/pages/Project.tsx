import { Send, Upload, UserPlus, X } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { roomFigures } from "../../shared/lightpool";
import type { Comment, Placement, Project, Share, Viewer } from "../../shared/types";
import { Dialog } from "../components/Dialog";
import { request } from "../lib/api";
import { formatDate } from "../lib/format";
import { prefersReducedMotion, useDesktop } from "../lib/hooks";
import { useSession } from "../lib/session";
import { NotFound } from "./NotFound";
import { Room, type RoomHandle } from "./project/Room";

const PAUSED = "Live collaboration paused. Your changes are saved and will sync when it reconnects.";
const BACK = "Live collaboration is back.";
const COVER_TYPES = ["image/jpeg", "image/png", "image/webp"];
const COVER_LIMIT = 5_000_000;
const COVER_ERROR = "Choose a JPEG, PNG or WebP image up to 5,000,000 bytes.";
const SHARE_POLL_MS = 1500;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SHARE_STATUS: Record<Share["pdf_status"], string> = {
  pending: "Preparing PDF",
  waiting_for_storage: "Waiting for file storage",
  ready: "Ready",
};
const DISPLAY_LABEL: Record<Share["price_display"], string> = {
  trade: "Trade prices",
  retail: "Retail prices",
  none: "No prices",
};

/** The centre of the room, each coordinate rounded to the nearest 100 mm with halves up. */
function centre(size: number): number {
  return Math.floor(size / 2 / 100 + 0.5) * 100;
}

type PendingFocus = { kind: "fitting"; id: string } | { kind: "place"; code: string } | null;

export function ProjectPage({ id }: { id: string }) {
  const { user } = useSession();
  const desktop = useDesktop();
  const formId = useId();
  const room = useRef<RoomHandle>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [missing, setMissing] = useState(false);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [ceiling, setCeiling] = useState(2700);
  const [sequences, setSequences] = useState<ReadonlyMap<string, number>>(new Map());
  const [roomStatus, setRoomStatus] = useState("");
  const [projectStatus, setProjectStatus] = useState("");
  const [liveStatus, setLiveStatus] = useState("");
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [shares, setShares] = useState<Share[]>([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const pendingFocus = useRef<PendingFocus>(null);
  const live = useRef<boolean | null>(null);
  // Positions this view has sent recently: live echoes of our own moves must not pull a fitting back.
  const sent = useRef(new Map<string, string[]>());
  const saving = useRef(new Map<string, { x: number; y: number } | null>());
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const reply = await request<{ project: Project }>(`/api/projects/${encodeURIComponent(id)}`);
    if (!reply.ok) {
      setMissing(true);
      return;
    }
    setProject(reply.data.project);
    setPlacements(reply.data.project.placements);
    setCeiling(reply.data.project.ceiling_height_mm);
    document.title = `${reply.data.project.name} · Lightfall`;
  }, [id]);

  useEffect(() => {
    void load();
    void request<{ comments: Comment[] }>(`/api/projects/${encodeURIComponent(id)}/comments`).then(
      (reply) => reply.ok && setComments(reply.data.comments),
    );
  }, [id, load]);

  // Live stream: presence, comments, placement changes from other views and the collaboration status.
  useEffect(() => {
    if (!project) return;
    const source = new EventSource(`/api/projects/${encodeURIComponent(id)}/live`);
    source.addEventListener("status", (event) => {
      const { live: now } = JSON.parse((event as MessageEvent<string>).data) as { live: boolean };
      if (!now) setLiveStatus(PAUSED);
      else if (live.current === false) {
        setLiveStatus(BACK);
        void request<{ comments: Comment[] }>(`/api/projects/${encodeURIComponent(id)}/comments`).then(
          (reply) => reply.ok && setComments(reply.data.comments),
        );
      }
      if (!now) setViewers([]);
      live.current = now;
    });
    source.addEventListener("presence", (event) => {
      setViewers((JSON.parse((event as MessageEvent<string>).data) as { viewers: Viewer[] }).viewers);
    });
    source.addEventListener("comment", (event) => {
      const { comment } = JSON.parse((event as MessageEvent<string>).data) as { comment: Comment };
      setComments((current) => (current.some((c) => c.id === comment.id) ? current : [...current, comment]));
    });
    source.addEventListener("placement", (event) => {
      const { action, placement } = JSON.parse((event as MessageEvent<string>).data) as {
        action: "created" | "updated" | "deleted";
        placement: Placement;
      };
      if (action === "deleted") {
        setPlacements((current) => current.filter((p) => p.id !== placement.id));
        return;
      }
      if (saving.current.has(placement.id)) return;
      const echo = sent.current.get(placement.id) ?? [];
      setPlacements((current) => {
        const existing = current.find((p) => p.id === placement.id);
        if (!existing) return action === "created" ? [...current, placement] : current;
        const here = `${existing.x_mm},${existing.y_mm}`;
        const there = `${placement.x_mm},${placement.y_mm}`;
        if (there === here || echo.includes(there)) return current;
        return current.map((p) => (p.id === placement.id ? { ...p, x_mm: placement.x_mm, y_mm: placement.y_mm } : p));
      });
    });
    return () => source.close();
  }, [project?.id, id]);

  // Quote shares are polled while any is still preparing or waiting for storage.
  const refreshShares = useCallback(async () => {
    const reply = await request<{ shares: Share[] }>(`/api/projects/${encodeURIComponent(id)}/shares`);
    if (reply.ok) setShares(reply.data.shares);
  }, [id]);

  useEffect(() => {
    void refreshShares();
  }, [refreshShares]);

  useEffect(() => {
    if (!shares.some((share) => share.pdf_status !== "ready")) return;
    const timer = setTimeout(() => void refreshShares(), SHARE_POLL_MS);
    return () => clearTimeout(timer);
  }, [shares, refreshShares]);

  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    if (target.kind === "fitting") room.current?.focusFitting(target.id);
    else document.querySelector<HTMLButtonElement>(`[data-place="${target.code}"]`)?.focus();
  });

  if (missing) return <NotFound />;
  if (!project || !user) return <div className="page-loading" aria-busy="true" />;

  const figures = roomFigures(placements, ceiling);
  const unplaced = project.lines.flatMap((line) => {
    const left = line.quantity - placements.filter((p) => p.variant_code === line.variant_code).length;
    return Array.from({ length: Math.max(0, left) }, (_, index) => ({ code: line.variant_code, key: `${line.variant_code}-${index}` }));
  });

  const place = async (code: string) => {
    const reply = await request<{ placement: Placement; live: boolean }>(`/api/projects/${project.id}/placements`, {
      method: "POST",
      body: { variant_code: code, x_mm: centre(project.room_width_mm), y_mm: centre(project.room_depth_mm) },
    });
    if (!reply.ok) {
      if (reply.error.error === "placement_exceeds_quantity") setRoomStatus(`All ${code} fittings are already placed.`);
      return;
    }
    const placement = reply.data.placement;
    const figure = roomFigures([...placements.filter((p) => p.id !== placement.id), placement], ceiling).find((p) => p.id === placement.id)!;
    setPlacements((current) => [...current.filter((p) => p.id !== placement.id), placement]);
    if (!prefersReducedMotion()) setSequences((current) => new Map(current).set(placement.id, performance.now()));
    pendingFocus.current = { kind: "fitting", id: placement.id };
    setRoomStatus(`${code} placed at ${placement.x_mm} mm, ${placement.y_mm} mm. Pool ${figure.pool_diameter_mm} mm, ${figure.centre_lux} lux.`);
  };

  /** Saves a fitting's latest position; moves made while a save is in flight are sent once it returns. */
  const save = async (placementId: string) => {
    const queued = saving.current.get(placementId);
    if (!queued) return;
    saving.current.set(placementId, null);
    const history = [...(sent.current.get(placementId) ?? []), `${queued.x},${queued.y}`].slice(-20);
    sent.current.set(placementId, history);
    await request(`/api/projects/${project.id}/placements/${placementId}`, {
      method: "PATCH",
      body: { x_mm: queued.x, y_mm: queued.y },
    });
    if (saving.current.get(placementId)) await save(placementId);
    else saving.current.delete(placementId);
  };

  const move = (placement: Placement, x: number, y: number, commit: boolean) => {
    setPlacements((current) => current.map((p) => (p.id === placement.id ? { ...p, x_mm: x, y_mm: y } : p)));
    if (!commit) return;
    setRoomStatus(`${placement.variant_code} moved to ${x} mm, ${y} mm.`);
    const idle = !saving.current.has(placement.id);
    saving.current.set(placement.id, { x, y });
    if (idle) void save(placement.id);
  };

  const remove = (placement: Placement) => {
    setPlacements((current) => current.filter((p) => p.id !== placement.id));
    setSequences((current) => {
      const next = new Map(current);
      next.delete(placement.id);
      return next;
    });
    pendingFocus.current = { kind: "place", code: placement.variant_code };
    setRoomStatus(`${placement.variant_code} removed.`);
    void request(`/api/projects/${project.id}/placements/${placement.id}`, { method: "DELETE" });
  };

  const changeCeiling = (next: number) => {
    setCeiling(next);
    // Each change is sent straight away (keepalive), so the last one lands even if the page closes next.
    void request(`/api/projects/${project.id}`, { method: "PATCH", body: { ceiling_height_mm: next }, keepalive: true });
  };

  const changeQuantity = async (code: string, value: string) => {
    const quantity = Number.parseInt(value, 10);
    if (!(quantity >= 0 && quantity <= 999)) return;
    const reply = await request<{ project: Project }>(`/api/projects/${project.id}/lines/${encodeURIComponent(code)}`, {
      method: "PATCH",
      body: { quantity },
    });
    if (reply.ok) setProject({ ...project, lines: reply.data.project.lines });
  };

  const postComment = async () => {
    if (draft.length > 2000) {
      setProjectStatus("Comments can be up to 2,000 characters.");
      return;
    }
    if (!draft.trim()) return;
    setPosting(true);
    const reply = await request<{ comment: Comment }>(`/api/projects/${project.id}/comments`, { method: "POST", body: { body: draft } });
    setPosting(false);
    if (reply.ok) {
      setComments((current) => (current.some((c) => c.id === reply.data.comment.id) ? current : [...current, reply.data.comment]));
      setDraft("");
      setProjectStatus("Comment posted.");
    } else if (reply.status === 422) setProjectStatus("Comments can be up to 2,000 characters.");
    else setProjectStatus("Comments are unavailable while live collaboration is paused.");
  };

  const invite = async (event: FormEvent) => {
    event.preventDefault();
    setInviting(true);
    const reply = await request<{ collaborator: Project["collaborators"][number] }>(`/api/projects/${project.id}/collaborators`, {
      method: "POST",
      body: { email: inviteEmail.trim() },
    });
    setInviting(false);
    if (reply.ok) {
      const added = reply.data.collaborator;
      setProject({ ...project, collaborators: [...project.collaborators.filter((c) => c.user_id !== added.user_id), added] });
      setInviteEmail("");
      setProjectStatus(`${added.name} can now work on this project.`);
    } else setProjectStatus("That email is not an approved trade account.");
  };

  const removeCollaborator = async (userId: string) => {
    const reply = await request(`/api/projects/${project.id}/collaborators/${userId}`, { method: "DELETE" });
    if (reply.ok) setProject({ ...project, collaborators: project.collaborators.filter((c) => c.user_id !== userId) });
  };

  const uploadCover = async (file: File) => {
    if (!COVER_TYPES.includes(file.type) || file.size > COVER_LIMIT) {
      setProjectStatus(COVER_ERROR);
      return;
    }
    setUploading(true);
    setProjectStatus("Uploading cover");
    const form = new FormData();
    form.append("image", file);
    const reply = await request<{ cover: { status: "ready"; url: string } }>(`/api/projects/${project.id}/cover`, {
      method: "POST",
      body: form,
    });
    setUploading(false);
    if (reply.ok) {
      setProject({ ...project, cover: reply.data.cover });
      setProjectStatus("Cover ready.");
    } else if (reply.status === 503 || reply.status === 0) {
      setProjectStatus("File storage is unavailable. Your cover was not saved; try again shortly.");
    } else setProjectStatus(COVER_ERROR);
  };

  const unplacedList = (
    <section className="panel" aria-labelledby={`${formId}-unplaced`}>
      <h2 id={`${formId}-unplaced`} className="section-title">
        Unplaced fittings
      </h2>
      <ul aria-label="Unplaced fittings" className="unplaced">
        {unplaced.map((item) => (
          <li key={item.key}>
            <button type="button" className="chip-button" data-place={item.code} onClick={() => void place(item.code)}>
              Place {item.code}
            </button>
          </li>
        ))}
      </ul>
      {unplaced.length === 0 && <p className="empty-note">Every fitting in the project lines is placed.</p>}
    </section>
  );

  return (
    <div className="project">
      <header className="page-head">
        <p className="eyebrow">{project.client_name ?? "Project"}</p>
        <h1>{project.name}</h1>
        <p className="page-head__lede mono">
          {project.room_width_mm} × {project.room_depth_mm} mm room · {(ceiling / 1000).toFixed(1)} m ceiling ·{" "}
          {figures.length} placed
        </p>
      </header>
      <p role="status" aria-label="Live collaboration" className={liveStatus === PAUSED ? "banner" : "form-status"}>
        {liveStatus}
      </p>
      <div className="project__layout">
        <div className="project__main">
          <Room
            ref={room}
            widthMm={project.room_width_mm}
            depthMm={project.room_depth_mm}
            ceilingMm={ceiling}
            placements={placements}
            sequences={sequences}
            status={roomStatus}
            onCeiling={changeCeiling}
            onMove={move}
            onRemove={remove}
          />
          {!desktop && unplacedList}
        </div>
        <aside className="project__side">
          <section className="panel" aria-labelledby={`${formId}-viewing`}>
            <h2 id={`${formId}-viewing`} className="section-title">
              Viewing now
            </h2>
            <ul aria-label="Viewing now" className="viewers">
              {viewers.map((viewer) => (
                <li key={viewer.user_id}>
                  <span role="img" aria-label={viewer.name} className="avatar" title={viewer.name}>
                    <span aria-hidden="true">{viewer.initials}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section className="panel" aria-labelledby={`${formId}-lines`}>
            <h2 id={`${formId}-lines`} className="section-title">
              Lines
            </h2>
            <table aria-label="Project lines" className="data-table data-table--compact">
              <thead>
                <tr>
                  <th scope="col">Code</th>
                  <th scope="col">Quantity</th>
                  <th scope="col" className="numeric">Placed</th>
                </tr>
              </thead>
              <tbody>
                {project.lines.map((line) => (
                  <tr key={line.variant_code}>
                    <td>
                      <span className="mono">{line.variant_code}</span>
                      <span className="cart__code">{line.product_name}</span>
                    </td>
                    <td>
                      <input
                        type="number"
                        className="quantity-input"
                        min={0}
                        max={999}
                        aria-label={`Quantity for ${line.variant_code}`}
                        defaultValue={line.quantity}
                        onBlur={(event) => void changeQuantity(line.variant_code, event.target.value)}
                      />
                    </td>
                    <td className="numeric mono">{placements.filter((p) => p.variant_code === line.variant_code).length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {project.lines.length === 0 && <p className="empty-note">Add fittings from a product page with Add to project.</p>}
          </section>
          {desktop && unplacedList}
          <section className="panel" aria-labelledby={`${formId}-team`}>
            <h2 id={`${formId}-team`} className="section-title">
              Collaborators
            </h2>
            <ul className="collaborators">
              {project.collaborators.map((person) => (
                <li key={person.user_id}>
                  <span>{person.name}</span>
                  <span className="mono collaborators__email">{person.email}</span>
                  {project.is_owner && (
                    <button type="button" className="icon-button" aria-label={`Remove ${person.name}`} onClick={() => void removeCollaborator(person.user_id)}>
                      <X aria-hidden="true" size={16} strokeWidth={1.5} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {project.is_owner && (
              <form className="inline-form" onSubmit={(event) => void invite(event)}>
                <div className="field">
                  <label htmlFor={`${formId}-invite`}>Collaborator email</label>
                  <input id={`${formId}-invite`} type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
                </div>
                <button type="submit" className="button button--quiet" disabled={inviting}>
                  <UserPlus aria-hidden="true" size={16} strokeWidth={1.5} />
                  {inviting ? "Inviting" : "Invite"}
                </button>
              </form>
            )}
          </section>
          <section aria-label="Comments" className="panel comments">
            <h2 className="section-title">Comments</h2>
            <ul aria-label="Comment thread" className="comment-thread">
              {comments.map((comment) => (
                <li key={comment.id} className="comment">
                  <p className="comment__meta">
                    <span>{comment.author_name}</span> <time dateTime={comment.created_at}>{formatDate(comment.created_at)}</time>
                  </p>
                  <p className="comment__body">{comment.body}</p>
                </li>
              ))}
            </ul>
            <div className="field">
              <label htmlFor={`${formId}-comment`}>Add a comment</label>
              <textarea id={`${formId}-comment`} rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} />
            </div>
            <button type="button" className="button button--quiet" disabled={posting} onClick={() => void postComment()}>
              <Send aria-hidden="true" size={16} strokeWidth={1.5} />
              {posting ? "Posting" : "Post comment"}
            </button>
          </section>
          <section className="panel" aria-labelledby={`${formId}-cover`}>
            <h2 id={`${formId}-cover`} className="section-title">
              Cover image
            </h2>
            {project.cover && <img src={project.cover.url} alt="Project cover" className="project-cover" />}
            <label htmlFor={`${formId}-file`} className="visually-hidden">
              Cover image
            </label>
            <input
              ref={fileInput}
              id={`${formId}-file`}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="visually-hidden"
              tabIndex={-1}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void uploadCover(file);
              }}
            />
            <button type="button" className="button button--quiet" disabled={uploading} onClick={() => fileInput.current?.click()}>
              <Upload aria-hidden="true" size={16} strokeWidth={1.5} />
              Upload cover
            </button>
          </section>
          <section className="panel" aria-labelledby={`${formId}-shares`}>
            <h2 id={`${formId}-shares`} className="section-title">
              Quote shares
            </h2>
            {project.is_owner && (
              <button type="button" className="button button--primary" onClick={() => setShareOpen(true)}>
                Share quote
              </button>
            )}
            <table aria-label="Quote shares" className="data-table data-table--compact">
              <thead>
                <tr>
                  <th scope="col">Sent</th>
                  <th scope="col">Recipients</th>
                  <th scope="col">Prices</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {shares.map((share) => (
                  <tr key={share.id}>
                    <td>{formatDate(share.created_at)}</td>
                    <td className="shares__recipients">{share.recipients.join(", ")}</td>
                    <td>{DISPLAY_LABEL[share.price_display]}</td>
                    <td>
                      {share.pdf_status === "ready" ? (
                        <a href={`/api/shares/${share.id}/pdf`} target="_blank" rel="noreferrer" className="status-pill status-pill--ready">
                          Ready
                        </a>
                      ) : (
                        <span className={`status-pill status-pill--${share.pdf_status}`}>{SHARE_STATUS[share.pdf_status]}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <p role="status" aria-label="Project updates" className="form-status">
            {projectStatus}
          </p>
        </aside>
      </div>
      {project.is_owner && (
        <ShareQuote
          open={shareOpen}
          projectId={project.id}
          onClose={() => setShareOpen(false)}
          onShared={(count) => {
            setShareOpen(false);
            setProjectStatus(`Quote queued for ${count} recipients. Emails go out as soon as the PDF is ready.`);
            void refreshShares();
          }}
          onInvalid={() => setProjectStatus("Add between 1 and 10 valid email addresses.")}
        />
      )}
    </div>
  );
}

function ShareQuote({
  open,
  projectId,
  onClose,
  onShared,
  onInvalid,
}: {
  open: boolean;
  projectId: string;
  onClose: () => void;
  onShared: (count: number) => void;
  onInvalid: () => void;
}) {
  const id = useId();
  const [recipients, setRecipients] = useState("");
  const [display, setDisplay] = useState<Share["price_display"]>("trade");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const list = recipients.split(",").map((item) => item.trim()).filter(Boolean);
    if (list.length < 1 || list.length > 10 || !list.every((email) => EMAIL.test(email))) {
      onInvalid();
      return;
    }
    setSending(true);
    const reply = await request(`/api/projects/${projectId}/shares`, {
      method: "POST",
      body: { recipients: list, price_display: display, ...(message.trim() ? { message: message.trim() } : {}) },
    });
    setSending(false);
    if (reply.ok) {
      setRecipients("");
      setMessage("");
      onShared(list.length);
    } else onInvalid();
  };

  return (
    <Dialog title="Share quote" open={open} onClose={onClose}>
      <form className="form-stack" onSubmit={(event) => void submit(event)} noValidate>
        <div className="field">
          <label htmlFor={`${id}-recipients`}>Recipients</label>
          <input id={`${id}-recipients`} value={recipients} onChange={(e) => setRecipients(e.target.value)} aria-describedby={`${id}-hint`} />
          <p id={`${id}-hint`} className="field__hint">
            Separate addresses with commas, up to ten.
          </p>
        </div>
        <fieldset role="radiogroup" aria-label="Price display" className="choice-group">
          <legend>Price display</legend>
          {(["trade", "retail", "none"] as const).map((option) => (
            <label key={option} className="choice">
              <input type="radio" name={`${id}-display`} checked={display === option} onChange={() => setDisplay(option)} />
              <span>{DISPLAY_LABEL[option]}</span>
            </label>
          ))}
        </fieldset>
        <div className="field">
          <label htmlFor={`${id}-message`}>Message</label>
          <textarea id={`${id}-message`} rows={3} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} />
        </div>
        <button type="submit" className="button button--primary" disabled={sending}>
          {sending ? "Sending" : "Send quote"}
        </button>
      </form>
    </Dialog>
  );
}
