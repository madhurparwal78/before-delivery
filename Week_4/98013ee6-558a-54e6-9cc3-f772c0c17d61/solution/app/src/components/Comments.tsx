import { useCallback, useEffect, useState, type ReactElement } from "react";
import { codePoints } from "../../shared/text";
import { api, ApiFailure, GENERIC_ERROR } from "../lib/api";
import { Link } from "../ui/Link";
import { Button } from "../ui/Button";
import { Counter } from "../ui/Counter";
import { Time } from "../ui/Time";
import { useMe, useSession } from "../session";
import type { CommentView, Pin } from "../../shared/types";

type Reply = CommentView["replies"][number];

function Composer({ pinId, parent, label, post, placeholder, onPosted }: {
  pinId: number;
  parent: number | null;
  label: string;
  post: string;
  placeholder?: string;
  onPosted: () => void;
}) {
  const { config } = useSession();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const over = codePoints(text) > config.limits.comment_max;

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/pins/${pinId}/comments`, { text, parent });
      setText("");
      onPosted();
    } catch (failure) {
      setError(failure instanceof ApiFailure && failure.field === "text" ? `Comments are 1 to ${config.limits.comment_max} characters.` : GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="comment-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className="field">
        <span className="visually-hidden">{label}</span>
        <textarea rows={2} aria-label={label} placeholder={placeholder ?? label} value={text} onChange={(event) => setText(event.target.value)} />
      </label>
      <div className="comment-form-row">
        <Counter value={text} max={config.limits.comment_max} />
        <Button type="submit" busy={busy} busyLabel={parent === null ? "Posting" : "Posting reply"} disabled={over}>
          {post}
        </Button>
      </div>
      {error ? <p role="alert" className="field-error">{error}</p> : null}
    </form>
  );
}

/** Comments with one level of replies; the list follows the pin's live comment count. */
export function Comments({ pin }: { pin: Pin }) {
  const me = useMe();
  const [thread, setThread] = useState<CommentView[]>([]);
  const [replyingTo, setReplyingTo] = useState<number | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setThread((await api.get<{ comments: CommentView[] }>(`/api/pins/${pin.id}/comments`)).comments);
  }, [pin.id]);

  useEffect(() => {
    void load();
  }, [load, pin.comments]);

  const remove = async (id: number): Promise<void> => {
    await api.remove(`/api/comments/${id}`);
    await load();
  };

  const row = (comment: CommentView | Reply, topLevel: number): ReactElement => (
    <div className="comment">
      <p className="comment-meta">
        <Link to={`/u/${comment.author.handle}`}>{comment.author.name}</Link> <Time iso={comment.created_at} />
      </p>
      {comment.deleted ? <p className="comment-text comment-text--deleted">This comment was deleted.</p> : <p className="comment-text">{comment.text}</p>}
      {!comment.deleted ? (
        <div className="comment-actions">
          <Button onClick={() => setReplyingTo(replyingTo === comment.id ? null : comment.id)} aria-label={`Reply to ${comment.author.name}`}>
            Reply
          </Button>
          {comment.author.id === me.id || pin.owner.id === me.id ? (
            <Button aria-label="Delete comment" onClick={() => void remove(comment.id)}>Delete</Button>
          ) : null}
        </div>
      ) : null}
      {replyingTo === comment.id ? (
        <Composer pinId={pin.id} parent={topLevel} label={`Reply to ${comment.author.name}`} post="Post reply" placeholder={`Reply to ${comment.author.name}`} onPosted={() => { setReplyingTo(null); void load(); }} />
      ) : null}
    </div>
  );

  return (
    <section className="comments" aria-label="Comments">
      <Composer pinId={pin.id} parent={null} label="Add a comment" post="Post" onPosted={() => void load()} />
      <ul className="comment-list">
        {thread.map((comment) => (
          <li key={comment.id} className="comment-thread">
            {row(comment, comment.id)}
            {comment.replies.length > 0 ? (
              <ul className="replies">
                {comment.replies.map((reply) => (
                  <li key={reply.id}>{row(reply, comment.id)}</li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
