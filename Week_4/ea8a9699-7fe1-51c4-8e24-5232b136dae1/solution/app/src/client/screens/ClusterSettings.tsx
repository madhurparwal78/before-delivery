// Cluster settings (brief: Screens > Cluster settings; Interactions > Status actions, Review link form,
// Withdraw, Settings refresh, Clock-driven updates, Privacy toggle).
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Download, ExternalLink, RefreshCw, Trash2 } from "lucide-react";
import type { Account, Cluster, Comment, EntryResult, ReviewLink, Status, WorkspaceRef } from "../../shared/api.js";
import { canRequest, isLocked, mayWithdraw, seated, STATUSES } from "../../shared/lifecycle.js";
import { api } from "../lib/api.js";
import { SEAT_COPY } from "../lib/copy.js";
import { useModal } from "../lib/dialog.js";
import { LiveRegion, useLive } from "../lib/live.js";
import { linkClick } from "../lib/router.js";
import { LinkTag, Pending, STATUS_LABEL, StatusTag, Thumb, utcMinute } from "../components/bits.js";
import { ErrorSummary, FieldError, fieldAttrs, useFieldErrors } from "../components/ErrorSummary.js";
import { NotFound } from "./NotFound.js";

const REFRESH_MS = 30_000;

const liftText = (liftLocal: string): string => liftLocal.replace("T", " ");

const MOVE_LABEL: Record<Status, string> = {
  draft: "Back to draft",
  in_review: "Send to review",
  embargoed: "Schedule embargo",
  public: "",
  withdrawn: "Withdraw cluster",
};
const moveLabel = (from: Status, to: Status): string => (from === "embargoed" && to === "in_review" ? "Cancel embargo" : MOVE_LABEL[to]);

const DONE_COPY: Record<string, (c: Cluster) => string> = {
  "draft>in_review": () => "Sent to review.",
  "in_review>draft": () => "Back to draft. Review links are no longer active.",
  "in_review>embargoed": (c) => `Embargo set. Goes public at ${liftText(c.liftLocal ?? "")} ${c.timeZone}.`,
  "embargoed>in_review": () => "Embargo cancelled. Back in review.",
  "public>withdrawn": () => "Withdrawn. The public page is gone.",
};

export function ClusterSettings({ account, workspace, clusterId }: { account: Account; workspace: WorkspaceRef; clusterId: string }) {
  const live = useLive();
  const [cluster, setCluster] = useState<Cluster | null | undefined>(undefined);
  const [heading, setHeading] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [note, setNote] = useState("");
  const [comments, setComments] = useState<Comment[]>([]);
  const [links, setLinks] = useState<ReviewLink[]>([]);
  const [pending, setPending] = useState<Status | null>(null);
  const [embargoOpen, setEmbargoOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [focusLabel, setFocusLabel] = useState(0);
  const label = useRef<HTMLDivElement | null>(null);
  const withdrawButton = useRef<HTMLButtonElement | null>(null);
  const details = useFieldErrors();
  const embargo = useFieldErrors();
  const linkForm = useFieldErrors();
  const commentForm = useFieldErrors();
  const [liftDate, setLiftDate] = useState("");
  const [liftTime, setLiftTime] = useState("");
  const [linkEmail, setLinkEmail] = useState("");
  const [expires, setExpires] = useState("");
  const [canComment, setCanComment] = useState(true);
  const [comment, setComment] = useState("");

  const isSeated = seated(account.role, workspace.hasSeat);

  const loadLinks = useCallback(async () => {
    const answer = await api<{ links: ReviewLink[] }>("GET", `/api/clusters/${clusterId}/review-links`);
    if (answer.ok) setLinks(answer.data.links);
  }, [clusterId]);

  useEffect(() => {
    void (async () => {
      // Commit the initial settings together: late links/comments would move the visible forms.
      const [answer, thread, reviewLinks] = await Promise.all([
        api<Cluster>("GET", `/api/clusters/${clusterId}`),
        api<{ comments: Comment[] }>("GET", `/api/clusters/${clusterId}/comments`),
        api<{ links: ReviewLink[] }>("GET", `/api/clusters/${clusterId}/review-links`),
      ]);
      if (!answer.ok) return setCluster(null);
      setCluster(answer.data);
      setHeading(answer.data.title);
      setTitle(answer.data.title);
      setDescription(answer.data.publicDescription);
      setNote(answer.data.internalNote);
      if (thread.ok) setComments(thread.data.comments);
      if (reviewLinks.ok) setLinks(reviewLinks.data.links);
    })();
  }, [clusterId]);

  // The re-read every 30 s: only server-owned parts change; typed text, dialogs, focus and pending controls stay.
  useEffect(() => {
    const timer = setInterval(() => {
      void api<Cluster>("GET", `/api/clusters/${clusterId}`).then((answer) => {
        if (answer.ok) setCluster(answer.data);
      });
      void loadLinks();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [clusterId, loadLinks]);

  // The created copy is announced once the screen (and its live region) is in place.
  const created = useRef((history.state as { created?: string } | null)?.created ?? null);
  useEffect(() => {
    if (!cluster || !created.current) return;
    live.say(`Created ${created.current} as a draft.`);
    created.current = null;
    history.replaceState(null, "", location.href);
  }, [cluster, live]);

  // After any status answer focus moves to the status label, after a closing dialog has returned its focus.
  useEffect(() => {
    if (focusLabel) label.current?.focus();
  }, [focusLabel]);

  if (cluster === null) return <NotFound />;
  if (cluster === undefined) {
    return (
      <main className="settings" id="main">
        <div className="skeleton-block" aria-hidden="true" />
      </main>
    );
  }

  const status = cluster.status;
  const locked = isLocked(status);
  const shownStatus = pending ?? status;
  const canWithdraw = mayWithdraw(account.role, account.handle === cluster.owner.handle);
  // The buttons are the requestable edges (shared/lifecycle.ts) the viewer may take; withdrawal also needs owner or ops lead.
  const moves = isSeated
    ? STATUSES.filter((to) => canRequest(status, to) && (to !== "withdrawn" || canWithdraw)).map((to) => ({
        to,
        label: moveLabel(status, to),
        // Forward steps carry the primary emphasis; stepping back stays secondary.
        forward: STATUSES.indexOf(to) > STATUSES.indexOf(status),
      }))
    : [];

  const act = async (to: Status, liftLocal?: string): Promise<void> => {
    const before = cluster.status;
    setPending(to);
    const answer = await api<Cluster>("POST", `/api/clusters/${clusterId}/status`, { body: liftLocal === undefined ? { status: to } : { status: to, liftLocal } });
    setPending(null);
    setWithdrawOpen(false);
    if (answer.ok) {
      setCluster(answer.data);
      embargo.clear();
      if (to === "embargoed") setEmbargoOpen(false);
      live.say(DONE_COPY[`${before}>${to}`]?.(answer.data) ?? "");
    } else if (answer.error?.error === "illegal_transition" && answer.error.from) {
      const from = answer.error.from;
      setCluster({ ...cluster, status: from });
      live.say(from !== before ? `This cluster is now ${STATUS_LABEL[from]}. Refresh to see its current state.` : "The status change could not be saved. Try again.", true);
      void api<Cluster>("GET", `/api/clusters/${clusterId}`).then((fresh) => fresh.ok && setCluster(fresh.data));
    } else if (answer.error?.errors) {
      embargo.show(answer.error.errors);
      return;
    } else {
      live.say(answer.error?.error === "seat_required" ? SEAT_COPY : "The status change could not be saved. Try again.", true);
    }
    setFocusLabel((n) => n + 1);
  };

  const saveDetails = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy("details");
    const body = locked ? { title, internalNote: note } : { title, publicDescription: description, internalNote: note };
    const answer = await api<Cluster>("PATCH", `/api/clusters/${clusterId}`, { body });
    setBusy(null);
    if (answer.ok) {
      details.clear();
      setCluster(answer.data);
      setHeading(answer.data.title);
      live.say("Details saved.");
    } else if (answer.error?.errors) details.show(answer.error.errors);
    else live.say(lockedOrFailed(answer.error?.error), true);
  };

  const lockedOrFailed = (code: string | undefined): string =>
    code === "cluster_locked" ? `This cluster is locked while ${STATUS_LABEL[cluster.status]}.` : code === "seat_required" ? SEAT_COPY : "The change could not be saved. Try again.";

  const togglePrivate = async (entryId: string, isPrivate: boolean): Promise<void> => {
    const answer = await api<EntryResult>("PATCH", `/api/clusters/${clusterId}/entries/${entryId}`, { body: { isPrivate } });
    if (answer.ok) {
      setCluster({ ...cluster, version: answer.data.version, entries: cluster.entries.map((e) => (e.id === entryId ? { ...e, isPrivate } : e)) });
    } else live.say(lockedOrFailed(answer.error?.error), true);
  };

  const setEmbargo = (event: FormEvent): void => {
    event.preventDefault();
    void act("embargoed", liftDate || liftTime ? `${liftDate}T${liftTime}` : "");
  };

  const createLink = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy("link");
    const expiresAt = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(expires) ? `${expires}:00.000Z` : expires;
    const answer = await api<ReviewLink>("POST", `/api/clusters/${clusterId}/review-links`, { body: { email: linkEmail, expiresAt, canComment } });
    setBusy(null);
    if (answer.ok) {
      linkForm.clear();
      setLinkEmail("");
      setExpires("");
      live.say(`Review link sent to ${answer.data.email}.`);
      void loadLinks();
    } else if (answer.error?.errors) linkForm.show(answer.error.errors);
    else if (answer.error?.error === "mail_unavailable") live.say("The review email could not be sent. No link was created.", true);
    else live.say(answer.error?.error === "seat_required" ? SEAT_COPY : (answer.error?.message ?? "The review link could not be created. Try again."), true);
  };

  const regenerate = async (link: ReviewLink): Promise<void> => {
    setBusy(`regen-${link.id}`);
    const answer = await api<ReviewLink>("POST", `/api/review-links/${link.id}/regenerate`);
    setBusy(null);
    if (answer.ok) live.say(`New link sent to ${link.email}. The old link no longer works.`);
    else if (answer.error?.error === "mail_unavailable") live.say("The new link could not be sent. The current link still works.", true);
    else live.say(answer.error?.message ?? "The link could not be regenerated. Try again.", true);
    void loadLinks();
  };

  const revoke = async (link: ReviewLink): Promise<void> => {
    setBusy(`revoke-${link.id}`);
    const answer = await api("DELETE", `/api/review-links/${link.id}`);
    setBusy(null);
    live.say(answer.ok ? `Link for ${link.email} revoked.` : (answer.error?.message ?? "The link could not be revoked. Try again."), !answer.ok);
    void loadLinks();
  };

  const postComment = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy("comment");
    const answer = await api<Comment>("POST", `/api/clusters/${clusterId}/comments`, { body: { body: comment } });
    setBusy(null);
    if (answer.ok) {
      commentForm.clear();
      setComment("");
      setComments((list) => [...list, answer.data]);
      live.say("Comment posted.");
    } else if (answer.error?.errors) commentForm.show(answer.error.errors);
    else live.say(answer.error?.error === "seat_required" ? SEAT_COPY : "The comment could not be posted. Try again.", true);
  };

  const entries = [...cluster.entries].sort((a, b) => a.position - b.position);
  const wall = `/w/${workspace.slug}`;

  return (
    <main className="settings" id="main">
      <div className="settings__head">
        <a className="back-link" href={wall} onClick={(e) => linkClick(e, wall)}>
          <ArrowLeft size={16} aria-hidden="true" />
          {workspace.name} wall
        </a>
        <h1 className="settings__title">{heading}</h1>
        <div className="settings__status">
          <div ref={label} className="status-label" role="group" aria-label="Status" tabIndex={-1}>
            <span className="status-label__name" aria-hidden="true">
              Status
            </span>
            <StatusTag status={shownStatus} />
            {pending && (
              <span className="status-label__saving">
                Saving <Pending />
              </span>
            )}
          </div>
          <div className="settings__actions">
            {moves.map((move) =>
              move.to === "withdrawn" ? (
                <button key={move.to} ref={withdrawButton} type="button" className="btn btn--danger" disabled={pending !== null} onClick={() => setWithdrawOpen(true)}>
                  <Trash2 size={16} aria-hidden="true" />
                  {move.label}
                </button>
              ) : move.to === "embargoed" ? (
                <button key={move.to} type="button" className="btn btn--primary" disabled={pending !== null} aria-expanded={embargoOpen} onClick={() => setEmbargoOpen(true)}>
                  {move.label}
                </button>
              ) : (
                <button key={move.to} type="button" className={move.forward ? "btn btn--primary" : "btn"} disabled={pending !== null} onClick={() => void act(move.to)}>
                  {move.label}
                </button>
              ),
            )}
          </div>
        </div>
        {cluster.status === "embargoed" && cluster.liftLocal && cluster.liftsAt && (
          <p className="embargo-summary mono-figures">
            Goes public at {liftText(cluster.liftLocal)} {cluster.timeZone} ({utcMinute(cluster.liftsAt)} UTC)
          </p>
        )}
        {cluster.status === "public" && (
          <a className="external-link" href={`/c/${cluster.id}`} onClick={(e) => linkClick(e, `/c/${cluster.id}`)}>
            <ExternalLink size={16} aria-hidden="true" />
            Open the public page
          </a>
        )}
        {embargoOpen && status === "in_review" && (
          <form className="embargo-form panel" onSubmit={setEmbargo} noValidate>
            <ErrorSummary errors={embargo.errors} shown={embargo.shown} targets={{ liftLocal: "lift-date" }} />
            <p className="field__hint">Times are in {cluster.timeZone}</p>
            <div className="field-row">
              <div className="field">
                <label className="field__label" htmlFor="lift-date">
                  Lift date
                </label>
                <input type="date" {...fieldAttrs("lift-date", embargo.errors.liftLocal)} value={liftDate} data-autofocus="" onChange={(e) => setLiftDate(e.target.value)} />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="lift-time">
                  Lift time
                </label>
                <input
                  type="time"
                  id="lift-time"
                  aria-invalid={embargo.errors.liftLocal ? true : undefined}
                  aria-describedby={embargo.errors.liftLocal ? "lift-date-error" : undefined}
                  value={liftTime}
                  onChange={(e) => setLiftTime(e.target.value)}
                />
              </div>
            </div>
            <FieldError id="lift-date" message={embargo.errors.liftLocal} />
            <div className="form-actions">
              <button type="submit" className="btn btn--primary" disabled={pending !== null}>
                Set embargo
              </button>
            </div>
          </form>
        )}
        <LiveRegion live={live} name="Cluster status" />
      </div>

      <div className="settings__grid">
        <div className="settings__main">
          <form className="panel" onSubmit={(e) => void saveDetails(e)} noValidate>
            <h2 className="section-title">Details</h2>
            <ErrorSummary errors={details.errors} shown={details.shown} targets={{ title: "cluster-title", publicDescription: "cluster-description", internalNote: "cluster-note" }} />
            <div className="field">
              <label className="field__label" htmlFor="cluster-title">
                Title
              </label>
              <input type="text" {...fieldAttrs("cluster-title", details.errors.title)} value={title} onChange={(e) => setTitle(e.target.value)} />
              <FieldError id="cluster-title" message={details.errors.title} />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="cluster-description">
                Public description
              </label>
              <textarea {...fieldAttrs("cluster-description", details.errors.publicDescription, locked ? "description-locked" : undefined)} rows={3} value={description} readOnly={locked} onChange={(e) => setDescription(e.target.value)} />
              {locked && (
                <p className="field__hint" id="description-locked">
                  Locked while {STATUS_LABEL[status]}.
                </p>
              )}
              <FieldError id="cluster-description" message={details.errors.publicDescription} />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="cluster-note">
                Internal note
              </label>
              <textarea {...fieldAttrs("cluster-note", details.errors.internalNote)} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
              <FieldError id="cluster-note" message={details.errors.internalNote} />
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn--primary" disabled={busy === "details"}>
                Save details
              </button>
            </div>
          </form>

          <section className="panel" aria-labelledby="entries-title">
            <div className="section-row">
              <h2 className="section-title" id="entries-title">
                Entries <span className="section-title__count mono">· {cluster.itemCount} items</span>
              </h2>
              <a className="btn" href={`/api/clusters/${cluster.id}/export.csv`} download>
                <Download size={16} aria-hidden="true" />
                Download cluster sheet
              </a>
            </div>
            {entries.length ? (
              <ol className="entry-list">
                {entries.map((e) => (
                  <li key={e.id} className="entry">
                    <span className="entry__slot mono">{e.position}</span>
                    <Thumb src={e.reference.mediaUrl} kind={e.reference.kind} alt="" className="entry__thumb" />
                    <span className="entry__text">
                      <span className="entry__title">{e.reference.title}</span>
                      {e.reference.kind === "still" && (
                        <span className="entry__meta mono">
                          {e.reference.sourceClipTitle} · {e.reference.timecode}
                        </span>
                      )}
                      {e.isPrivate && <span className="tag tag--small">Private</span>}
                    </span>
                    <label className="check">
                      <input type="checkbox" aria-label={`Keep ${e.reference.title} private`} checked={e.isPrivate} disabled={locked || !isSeated} onChange={(ev) => void togglePrivate(e.id, ev.target.checked)} />
                      <span aria-hidden="true">Private</span>
                    </label>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">No entries yet. Add references from the wall.</p>
            )}
          </section>
        </div>

        <div className="settings__side">
          <section className="panel" aria-labelledby="links-title">
            <h2 className="section-title" id="links-title">
              Review links
            </h2>
            {status === "in_review" ? (
              <form onSubmit={(e) => void createLink(e)} noValidate>
                <ErrorSummary errors={linkForm.errors} shown={linkForm.shown} targets={{ email: "link-email", expiresAt: "link-expires", canComment: "link-comments" }} />
                <div className="field">
                  <label className="field__label" htmlFor="link-email">
                    Freelancer email
                  </label>
                  <input type="email" {...fieldAttrs("link-email", linkForm.errors.email)} value={linkEmail} onChange={(e) => setLinkEmail(e.target.value)} />
                  <FieldError id="link-email" message={linkForm.errors.email} />
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="link-expires">
                    Expires
                  </label>
                  <input type="datetime-local" step={60} {...fieldAttrs("link-expires", linkForm.errors.expiresAt, "link-expires-hint")} value={expires} onChange={(e) => setExpires(e.target.value)} />
                  <p className="field__hint" id="link-expires-hint">
                    Expiry times are in UTC
                  </p>
                  <FieldError id="link-expires" message={linkForm.errors.expiresAt} />
                </div>
                <label className="check">
                  <input id="link-comments" type="checkbox" checked={canComment} onChange={(e) => setCanComment(e.target.checked)} />
                  <span>Allow comments</span>
                </label>
                <div className="form-actions">
                  <button type="submit" className="btn btn--primary" disabled={busy === "link"}>
                    Create review link
                  </button>
                </div>
              </form>
            ) : (
              <p className="muted">Review links need a cluster in review.</p>
            )}
            {links.length > 0 && (
              <ul className="link-list">
                {links.map((link) => (
                  <li key={link.id} className="link-row">
                    <span className="link-row__head">
                      <span className="link-row__email">{link.email}</span>
                      <LinkTag state={link.state} />
                    </span>
                    <span className="mono link-row__expiry">{utcMinute(link.expiresAt)} UTC</span>
                    <span className="link-row__actions">
                      {link.state === "live" && (
                        <button type="button" className="btn btn--small" aria-label={`Regenerate link for ${link.email}`} disabled={busy === `regen-${link.id}`} onClick={() => void regenerate(link)}>
                          <RefreshCw size={14} aria-hidden="true" />
                          Regenerate
                        </button>
                      )}
                      {link.state !== "revoked" && (
                        <button type="button" className="btn btn--small" aria-label={`Revoke link for ${link.email}`} disabled={busy === `revoke-${link.id}`} onClick={() => void revoke(link)}>
                          Revoke
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel" aria-label="Comments">
            <h2 className="section-title">Comments</h2>
            {comments.length ? (
              <ul className="comment-list">
                {comments.map((k) => (
                  <li key={k.id} className="comment">
                    <p className="comment__head">
                      <span className="comment__author">{k.authorName}</span>
                      <span className="mono">{utcMinute(k.createdAt)} UTC</span>
                    </p>
                    <p className="comment__body">{k.body}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted comments-empty">No comments yet.</p>
            )}
            <form onSubmit={(e) => void postComment(e)} noValidate>
              <ErrorSummary errors={commentForm.errors} shown={commentForm.shown} targets={{ body: "settings-comment" }} />
              <div className="field">
                <label className="field__label" htmlFor="settings-comment">
                  Comment
                </label>
                <textarea {...fieldAttrs("settings-comment", commentForm.errors.body)} rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
                <FieldError id="settings-comment" message={commentForm.errors.body} />
              </div>
              <div className="form-actions">
                <button type="submit" className="btn" disabled={busy === "comment"}>
                  Post comment
                </button>
              </div>
            </form>
          </section>
        </div>
      </div>
      {withdrawOpen && <WithdrawDialog opener={withdrawButton} pending={pending === "withdrawn"} onClose={() => setWithdrawOpen(false)} onConfirm={() => void act("withdrawn")} />}
    </main>
  );
}

function WithdrawDialog({ opener, pending, onClose, onConfirm }: { opener: React.RefObject<HTMLElement | null>; pending: boolean; onClose: () => void; onConfirm: () => void }) {
  const dialog = useModal(true, onClose, opener);
  return (
    <dialog ref={dialog} className="dialog" aria-labelledby="withdraw-title" aria-describedby="withdraw-text">
      <h2 id="withdraw-title" className="dialog__title">
        Withdraw cluster
      </h2>
      <p id="withdraw-text">Withdrawing removes the public page and feed entry now.</p>
      <div className="dialog__actions">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn--danger" disabled={pending} onClick={onConfirm}>
          {pending ? (
            <>
              Withdrawing <Pending />
            </>
          ) : (
            "Withdraw"
          )}
        </button>
      </div>
    </dialog>
  );
}
