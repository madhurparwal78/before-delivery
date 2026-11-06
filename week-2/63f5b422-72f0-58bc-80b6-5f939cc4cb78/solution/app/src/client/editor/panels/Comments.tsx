import { useEffect, useRef, useState } from "react";
import { locateOnPage } from "../../../shared/tree.js";
import type { CommentThread } from "../../../shared/types.js";
import { Icon } from "../../ui/icons.js";
import { useEditor } from "../context.js";

function Thread({ thread }: { thread: CommentThread }) {
  const { state, act } = useEditor();
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");
  const replyBox = useRef<HTMLTextAreaElement>(null);
  const canToggle = state.role !== "viewer" || thread.author.id === state.meId;
  useEffect(() => {
    if (replying) replyBox.current?.focus();
  }, [replying]);
  const name = `Comment by ${thread.author.name} on ${thread.nodeName}`;
  return (
    <article aria-label={name} data-thread={thread.id} className={`pl-thread pl-thread-${thread.status}`}>
      <header className="pl-thread-head">
        <span className="pl-thread-author">{thread.author.name}</span>
        <span className="pl-muted">on {thread.nodeName}</span>
        <time className="pl-mono pl-muted" dateTime={thread.createdAt}>
          {new Date(thread.createdAt).toISOString().slice(11, 16)} UTC
        </time>
      </header>
      <p className="pl-thread-body">{thread.body}</p>
      {thread.replies.map((r) => (
        <div key={r.id} className="pl-reply">
          <span className="pl-thread-author">{r.author.name}</span> <span>{r.body}</span>
        </div>
      ))}
      {replying && (
        <form
          className="pl-reply-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!reply.trim()) return;
            if (await act.postReply(thread.id, reply)) {
              setReply("");
              setReplying(false);
            }
          }}
        >
          <textarea ref={replyBox} className="pl-input pl-textarea" aria-label="Reply text" value={reply} maxLength={2000} onChange={(e) => setReply(e.target.value)} />
          <div className="pl-form-row">
            <button type="submit" className="pl-primary">
              Post reply
            </button>
            <button type="button" className="pl-button" onClick={() => setReplying(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      <div className="pl-thread-actions">
        <button type="button" className="pl-button" data-reply onClick={() => setReplying(true)}>
          Reply
        </button>
        {canToggle && (
          <button type="button" className="pl-button" data-status-toggle onClick={() => act.setThreadStatus(thread.id, thread.status === "open" ? "resolved" : "open")}>
            {thread.status === "open" ? "Resolve" : "Reopen"}
          </button>
        )}
      </div>
    </article>
  );
}

/** The composer and the page's threads: the Comments region at 768 and wider, the bottom sheet below. */
export function CommentsBody() {
  const { state, act } = useEditor();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const target = state.selectedId ? locateOnPage(state.doc, state.selectedId) : null;
  const open = state.threads.filter((t) => t.status === "open");
  const resolved = state.threads.filter((t) => t.status === "resolved");
  const post = async () => {
    if (!body.trim() || !target || busy) return;
    setBusy(true);
    const ok = await act.postComment(body);
    setBusy(false);
    if (ok) setBody("");
  };
  return (
    <>
      <form
        className="pl-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void post();
        }}
      >
        <label htmlFor="comments-composer" className="pl-composer-label">
          {target ? (
            <>
              Comment on <strong>{target.node.name}</strong>
            </>
          ) : (
            "Select an element to comment on it"
          )}
        </label>
        <textarea
          id="comments-composer"
          key={state.composerFor}
          className="pl-input pl-textarea"
          aria-label="Comment"
          value={body}
          maxLength={2000}
          onChange={(e) => setBody(e.target.value)}
        />
        <p className="pl-hint">Mention a member with @ and their email address.</p>
        <button type="submit" className="pl-primary" disabled={!target || !body.trim() || busy} aria-busy={busy || undefined}>
          <Icon name="send" />
          Post comment
        </button>
      </form>
      {open.length === 0 && resolved.length === 0 && <p className="pl-panel-empty">No comments on this page yet.</p>}
      <div className="pl-threads">
        {open.map((t) => (
          <Thread key={t.id} thread={t} />
        ))}
      </div>
      {resolved.length > 0 && (
        <>
          <h3 className="pl-subhead">{`Resolved (${resolved.length})`}</h3>
          <div className="pl-threads">
            {resolved.map((t) => (
              <Thread key={t.id} thread={t} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
