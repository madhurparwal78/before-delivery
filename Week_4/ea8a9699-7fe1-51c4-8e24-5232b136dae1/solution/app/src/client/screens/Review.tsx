// The freelancer's review page (brief: Screens > Review; Interactions > Review comment wait, Clock-driven
// updates). Whether the link works is learned only from server answers, never from the device clock.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Clock } from "lucide-react";
import type { Comment, ReviewView } from "../../shared/api.js";
import { api } from "../lib/api.js";
import { LiveRegion, useLive } from "../lib/live.js";
import { Pending, Thumb, utcMinute } from "../components/bits.js";
import { ErrorSummary, FieldError, fieldAttrs, useFieldErrors } from "../components/ErrorSummary.js";

const GONE: Record<string, string> = {
  link_expired: "This review link has expired.",
  link_revoked: "This review link was revoked.",
  link_inactive: "This cluster is no longer in review.",
  not_found: "This review link does not exist.",
};

export function Review({ token }: { token: string }) {
  const live = useLive();
  const [view, setView] = useState<ReviewView | null>(null);
  const [gone, setGone] = useState<{ message: string; unsent: string } | null>(null);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const form = useFieldErrors();
  const wait = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void api<ReviewView>("GET", `/api/review/${encodeURIComponent(token)}`).then((answer) => {
      if (answer.ok) setView(answer.data);
      else setGone({ message: GONE[answer.error?.error ?? ""] ?? GONE.not_found ?? "", unsent: "" });
    });
    return () => {
      if (wait.current) clearTimeout(wait.current);
    };
  }, [token]);

  const post = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (posting || waiting) return;
    setPosting(true);
    const answer = await api<Comment>("POST", `/api/review/${encodeURIComponent(token)}/comments`, { body: { authorName: name, body } });
    setPosting(false);
    if (answer.ok) {
      form.clear();
      setBody("");
      setView((v) => (v ? { ...v, comments: [...v.comments, answer.data] } : v));
      live.say("Comment posted.");
      return;
    }
    const code = answer.error?.error ?? "";
    if (answer.error?.errors) form.show(answer.error.errors);
    else if (code === "rate_limited") {
      const seconds = answer.error?.retryAfter ?? 1;
      live.say(`You're commenting too fast. Try again in ${seconds} seconds.`, true);
      setWaiting(true);
      document.getElementById("review-comment")?.focus(); // the brief: focus moves to the Comment field on the refusal
      wait.current = setTimeout(() => setWaiting(false), seconds * 1000);
    } else if (GONE[code]) setGone({ message: GONE[code] ?? "", unsent: body });
    else if (code === "read_only_link") live.say("This link is view-only.", true);
    else live.say("The comment could not be posted. Try again.", true);
  };

  if (gone) {
    return (
      <main className="review review--gone" id="main">
        <h1 className="page-title">{gone.message}</h1>
        {gone.unsent && (
          <section className="panel" aria-label="Unsent comment">
            <h2 className="section-title">Your unsent comment</h2>
            <p className="comment__body">{gone.unsent}</p>
          </section>
        )}
      </main>
    );
  }
  if (!view) {
    return (
      <main className="review" id="main">
        <div className="skeleton-block" aria-hidden="true" />
      </main>
    );
  }
  const { cluster, comments, link } = view;
  return (
    <main className="review" id="main">
      <p className="review__banner">
        <Clock size={16} aria-hidden="true" />
        <span>
          Review: {cluster.title} · expires <span className="mono">{utcMinute(link.expiresAt)}</span> UTC
        </span>
      </p>
      <h1 className="page-title">{cluster.title}</h1>
      {cluster.publicDescription && <p className="lede">{cluster.publicDescription}</p>}
      <p className="mono muted">{cluster.itemCount} items</p>
      <ol className="review__entries" aria-label="Entries">
        {cluster.entries.map((e) => (
          <li key={e.id} className="card card--review">
            <div className="card__media">
              <Thumb src={e.mediaUrl} kind={e.kind} alt={e.title} />
            </div>
            <div className="card__body">
              <p className="card__title">
                <span className="mono card__slot">{e.position}</span> {e.title}
              </p>
              {e.kind === "still" && (
                <p className="card__meta mono">
                  {e.sourceClipTitle} · {e.timecode}
                </p>
              )}
              {e.isPrivate && <span className="tag tag--small">Private</span>}
            </div>
          </li>
        ))}
      </ol>
      <section className="panel" aria-labelledby="review-comments">
        <h2 className="section-title" id="review-comments">
          Comments
        </h2>
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
        <LiveRegion live={live} name="Review status" />
        {link.canComment ? (
          <form onSubmit={(e) => void post(e)} noValidate>
            <ErrorSummary errors={form.errors} shown={form.shown} targets={{ authorName: "review-name", body: "review-comment" }} />
            <div className="field">
              <label className="field__label" htmlFor="review-name">
                Your name
              </label>
              <input type="text" {...fieldAttrs("review-name", form.errors.authorName)} value={name} onChange={(e) => setName(e.target.value)} />
              <FieldError id="review-name" message={form.errors.authorName} />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="review-comment">
                Comment
              </label>
              <textarea {...fieldAttrs("review-comment", form.errors.body)} rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
              <FieldError id="review-comment" message={form.errors.body} />
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn--primary" disabled={posting || waiting}>
                Post comment
                {posting && <Pending />}
              </button>
            </div>
          </form>
        ) : (
          <p className="muted">This link is view-only.</p>
        )}
      </section>
    </main>
  );
}
