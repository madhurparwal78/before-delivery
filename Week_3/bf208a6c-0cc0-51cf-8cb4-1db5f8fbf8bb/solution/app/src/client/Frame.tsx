import { ArrowDown, ArrowUp, ArrowUpDown, Heart, MessageCircle } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ApiFailure, call, get } from "./api";
import { FileCard, Field } from "./art";
import { useBoardUi } from "./context";
import { may } from "../shared/permissions";
import { commentErrors, isImageType, length, LIMITS } from "../shared/rules";
import type { Comment, Post, Reactions } from "../shared/types";

interface Props {
  post: Post;
  /** The id of the section or author group the frame is displayed in. */
  groupId?: string;
  /** Its 1-based place in that group. */
  position?: number;
  /** Frames on the sheet are tabbable and movable; held frames in Approvals and Waiting for approval are not. */
  onSheet: boolean;
}

const isImage = (post: Post): boolean => post.attachment !== null && isImageType(post.attachment.content_type);

export function Art({ post }: { post: Post }) {
  const [broken, setBroken] = useState(false);
  if (post.attachment && isImage(post) && !broken) return <img className="art-image" src={post.attachment.url} alt="" onError={() => setBroken(true)} />;
  if (post.attachment) return <FileCard label={post.attachment.file_name} type={post.attachment.content_type} />;
  if (post.file_card) return <FileCard label={post.title} />;
  return <Field seed={post.id} />;
}

export function Counts({ post }: { post: Post }) {
  return (
    <span className="counts">
      <span>
        <Heart size={13} aria-hidden="true" /> {post.likes}
      </span>
      <span>
        <ArrowUpDown size={13} aria-hidden="true" /> {post.score}
      </span>
      <span>
        <MessageCircle size={13} aria-hidden="true" /> {post.comments}
      </span>
    </span>
  );
}

export function Frame({ post, groupId, position, onSheet }: Props) {
  const ui = useBoardUi();
  const open = ui.loupe?.id === post.id;
  const moving = ui.hold?.postId === post.id;
  const handlers = onSheet ? ui.bind(post) : {};
  const style: CSSProperties & { "--loupe-w"?: string } = {};
  if (open && ui.loupe) style["--loupe-w"] = `${ui.loupe.width}px`;
  if (moving && ui.hold?.mode === "pointer") style.transform = `translate(${ui.hold.offset.x}px, ${ui.hold.offset.y}px)`;
  return (
    <article
      className={`frame${isImage(post) && post.attachment ? " frame-image" : ""}`}
      aria-label={post.title}
      tabIndex={onSheet ? 0 : undefined}
      style={style}
      data-post-id={post.id}
      data-section-id={groupId ?? post.section_id}
      data-position={post.state === "published" ? position : undefined}
      data-author-id={post.author.id}
      data-state={post.state}
      data-likes={post.likes}
      data-score={post.score}
      data-comments={post.comments}
      data-loupe={open ? "open" : "closed"}
      data-moving={moving ? "true" : undefined}
      {...handlers}
    >
      {open ? (
        <LoupeBody post={post} />
      ) : (
        <>
          <div className="art">
            <Art post={post} />
          </div>
          <div className="band">
            <span className="title">{post.title}</span>
            {post.state === "awaiting_approval" ? <span className="small">Awaiting approval</span> : <Counts post={post} />}
          </div>
        </>
      )}
    </article>
  );
}

function LoupeBody({ post }: { post: Post }) {
  const ui = useBoardUi();
  const { role, me } = ui;
  const userId = me?.id ?? null;
  const canReact = me !== null && may("react", role, userId);
  const canComment = may("contribute", role, userId);
  const canEdit = may("editPost", role, userId, post.author.id);
  const canDelete = may("changePost", role, userId, post.author.id);
  const tick = ui.ticks[post.id] ?? 0;
  const [comments, setComments] = useState<Comment[]>([]);
  useEffect(() => {
    let current = true;
    void get<{ comments: Comment[] }>(`/api/posts/${post.id}/comments`).then((found) => current && setComments(found.comments));
    return () => {
      current = false;
    };
  }, [post.id, tick]);

  const react = async (method: "PUT" | "DELETE", path: "like" | "vote", body?: { value: 1 | -1 }): Promise<void> => {
    await call<Reactions>(method, `/api/posts/${post.id}/${path}`, body);
    await ui.reload();
  };
  const upVoted = post.my_vote === 1;
  const downVoted = post.my_vote === -1;
  const attachment = post.attachment;

  return (
    <div className="loupe">
      {!post.attachment && !post.file_card && (
        <div className="loupe-art">
          <Field seed={post.id} />
        </div>
      )}
      <h2 className="loupe-heading" tabIndex={-1} data-loupe-heading>
        {post.title}
      </h2>
      <p className="small muted">{post.author.display_name}</p>
      {post.body && <p className="loupe-text">{post.body}</p>}
      {attachment && (isImage(post) ? <img className="loupe-image" src={attachment.url} alt="" /> : <a href={attachment.url}>{attachment.file_name}</a>)}
      <Counts post={post} />
      {canReact && (
        <div className="actions">
          <button type="button" className="pressable" aria-label={`Like ${post.title}`} aria-pressed={post.liked} onClick={() => void react(post.liked ? "DELETE" : "PUT", "like")}>
            <Heart size={16} aria-hidden="true" /> <span>{post.likes}</span>
          </button>
          <button type="button" className="pressable" aria-label={`Vote up ${post.title}`} aria-pressed={upVoted} onClick={() => void react(upVoted ? "DELETE" : "PUT", "vote", { value: 1 })}>
            <ArrowUp size={16} aria-hidden="true" />
          </button>
          <span className="score">{post.score}</span>
          <button type="button" className="pressable" aria-label={`Vote down ${post.title}`} aria-pressed={downVoted} onClick={() => void react(downVoted ? "DELETE" : "PUT", "vote", { value: -1 })}>
            <ArrowDown size={16} aria-hidden="true" />
          </button>
        </div>
      )}
      {(canEdit || canDelete) && (
        <div className="actions">
          {canEdit && (
            <button type="button" className="quiet" aria-label={`Edit ${post.title}`} onClick={() => ui.edit(post)}>
              Edit
            </button>
          )}
          {canDelete && (
            <button type="button" className="quiet" aria-label={`Delete ${post.title}`} onClick={() => ui.remove(post)}>
              Delete
            </button>
          )}
        </div>
      )}
      <ul className="comments" aria-label="Comments">
        {comments.map((comment) => (
          <li key={comment.id}>
            <span className="comment-author small muted">{comment.author.display_name}</span> <span>{comment.text}</span>
          </li>
        ))}
      </ul>
      {canComment && <CommentBox postId={post.id} />}
      <button type="button" className="quiet" onClick={() => ui.closeLoupe(post.id)}>
        Close
      </button>
    </div>
  );
}

function CommentBox({ postId }: { postId: string }) {
  const ui = useBoardUi();
  const [value, setValue] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  const send = async (): Promise<void> => {
    const errors = commentErrors(value);
    if (errors["text"]) {
      setMessage(errors["text"]);
      return;
    }
    setSending(true);
    try {
      await call("POST", `/api/posts/${postId}/comments`, { text: value });
      setValue("");
      setMessage("");
      await ui.reload();
    } catch (error) {
      if (!(error instanceof ApiFailure) || error.status !== 422) throw error;
      setMessage(error.firstError);
    } finally {
      setSending(false);
      box.current?.focus();
    }
  };

  return (
    <div className="comment-box">
      <textarea
        ref={box}
        aria-label="Add a comment"
        value={value}
        rows={2}
        onChange={(event) => {
          setValue(event.target.value);
          setMessage("");
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void send();
          }
        }}
      />
      <span className="small muted">
        {length(value.trim())}/{LIMITS.comment}
      </span>
      {message && <p className="field-error">{message}</p>}
      <button type="button" aria-busy={sending} onClick={() => void send()}>
        {sending ? "Sending…" : "Send comment"}
      </button>
    </div>
  );
}

/** A frame with no behaviour: the dashboard's runs of a board's first posts. */
export function StaticFrame({ post }: { post: Post }) {
  return (
    <article className={`frame${isImage(post) ? " frame-image" : ""}`} aria-label={post.title}>
      <div className="art">
        <Art post={post} />
      </div>
      <div className="band">
        <span className="title">{post.title}</span>
        <Counts post={post} />
      </div>
    </article>
  );
}
