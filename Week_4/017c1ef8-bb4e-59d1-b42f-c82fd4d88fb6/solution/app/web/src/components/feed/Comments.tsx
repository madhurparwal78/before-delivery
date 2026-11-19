import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { announce } from '../../announce';
import { api } from '../../api';
import { useConfig, useNow } from '../../clock';
import { relativeTime } from '../../format';
import { useLive } from '../../live';
import { useMember } from '../../session';
import type { Comment } from '../../types';
import { LinkButton } from '../../ui';
import { CommentForm } from './CommentForm';
import { RichText } from './richtext';
import './feed.css';

const FIRST_REPLIES = 2;

interface ReplyTarget {
  commentId: string;
  prefill: string;
}

interface TreeState {
  comments: Comment[];
  /** How many replies each top-level comment shows. */
  shown: Record<string, number>;
}

/** Decides how many replies each comment shows after a load: two at first; a reply arriving while none are hidden joins them. */
function nextState(previous: TreeState | null, comments: Comment[]): TreeState {
  const shown: Record<string, number> = {};
  for (const comment of comments) {
    const total = comment.replies.length;
    const before = previous?.shown[comment.id];
    const beforeTotal = previous?.comments.find((c) => c.id === comment.id)?.replies.length ?? 0;
    if (before === undefined) shown[comment.id] = Math.min(FIRST_REPLIES, total);
    else if (before >= beforeTotal) shown[comment.id] = total;
    else shown[comment.id] = Math.min(before, total);
  }
  return { comments, shown };
}

export function CommentTree({ postId, postAuthorId }: { postId: string; postAuthorId: string }) {
  const member = useMember();
  const [state, setState] = useState<TreeState | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [tabStop, setTabStop] = useState<string | null>(null);
  const [reply, setReply] = useState<ReplyTarget | null>(null);
  const tree = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<string | null>(null);
  const [focusTick, setFocusTick] = useState(0);

  const load = useCallback(async (): Promise<void> => {
    const loaded = await api.get<{ comments: Comment[] }>(`/api/posts/${postId}/comments`);
    setState((previous) => nextState(previous, loaded.comments));
  }, [postId]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  useLive('post', (event) => {
    if (event.post_id === postId) void load().catch(() => undefined);
  });
  useLive('reconnected', () => void load().catch(() => undefined));

  useEffect(() => {
    if (!pendingFocus.current) return;
    const target = tree.current?.querySelector<HTMLElement>(`[data-comment-id="${pendingFocus.current}"]`);
    pendingFocus.current = null;
    target?.focus();
  }, [focusTick, state]);

  const items = (): HTMLElement[] => [...(tree.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])];

  const focusItem = (element: HTMLElement | undefined): void => {
    if (!element) return;
    setTabStop(element.dataset.commentId ?? null);
    element.focus();
  };

  const requestFocus = (commentId: string): void => {
    pendingFocus.current = commentId;
    setFocusTick((tick) => tick + 1);
  };

  const onItemKeyDown = (event: KeyboardEvent<HTMLDivElement>, comment: Comment, topLevel: boolean): void => {
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
    const all = items();
    const index = all.indexOf(event.currentTarget);
    const hasReplies = topLevel && comment.replies.length > 0;
    const isCollapsed = collapsed.has(comment.id);
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusItem(all[index + 1]);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusItem(all[index - 1]);
        break;
      case 'Home':
        event.preventDefault();
        focusItem(all[0]);
        break;
      case 'End':
        event.preventDefault();
        focusItem(all[all.length - 1]);
        break;
      case 'ArrowRight':
        if (!hasReplies) break;
        event.preventDefault();
        if (isCollapsed) setCollapsed((current) => new Set([...current].filter((id) => id !== comment.id)));
        else focusItem(all[index + 1]);
        break;
      case 'ArrowLeft':
        if (topLevel && hasReplies && !isCollapsed) {
          event.preventDefault();
          setCollapsed((current) => new Set(current).add(comment.id));
        } else if (!topLevel) {
          event.preventDefault();
          focusItem(event.currentTarget.parentElement?.closest<HTMLElement>('[role="treeitem"]') ?? undefined);
        }
        break;
      case 'Enter':
        if (comment.deleted || !comment.author) break;
        event.preventDefault();
        openReply(comment, topLevel);
        break;
      default:
    }
  };

  const openReply = (comment: Comment, topLevel: boolean): void => {
    if (!comment.author) return;
    setReply({ commentId: comment.id, prefill: topLevel ? '' : `@${comment.author.handle} ` });
  };

  const closeReply = (): void => {
    if (reply) requestFocus(reply.commentId);
    setReply(null);
  };

  const remove = async (comment: Comment): Promise<void> => {
    const all = items();
    const index = all.findIndex((element) => element.dataset.commentId === comment.id);
    const neighbour = all[index + 1] ?? all[index - 1];
    await api.delete(`/api/comments/${comment.id}`);
    announce('Feed announcements', 'Comment deleted.');
    if (neighbour?.dataset.commentId) requestFocus(neighbour.dataset.commentId);
    await load();
  };

  const comments = state?.comments ?? [];
  const stop = tabStop && comments.some((c) => c.id === tabStop || c.replies.some((r) => r.id === tabStop)) ? tabStop : comments[0]?.id;

  const rowProps = (comment: Comment, topLevel: boolean) => ({
    key: comment.id,
    comment,
    topLevel,
    tabIndex: stop === comment.id ? 0 : -1,
    canDelete: !comment.deleted && (comment.author?.id === member.id || postAuthorId === member.id),
    reply,
    onFocus: () => setTabStop(comment.id),
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => onItemKeyDown(event, comment, topLevel),
    onReply: () => openReply(comment, topLevel),
    onRemove: () => void remove(comment),
    onPosted: () => {
      closeReply();
      void load();
    },
    onCloseReply: closeReply,
  });

  return (
    <div ref={tree} role="tree" aria-label="Comments" className="comment-tree">
      {comments.map((comment) => {
        const replies = comment.replies;
        const visible = replies.slice(0, state?.shown[comment.id] ?? 0);
        const hidden = replies.length - visible.length;
        const open = !collapsed.has(comment.id);
        const { key, ...props } = rowProps(comment, true);
        return (
          <CommentRow key={key} {...props} expanded={replies.length > 0 ? open : undefined}>
            {replies.length > 0 && open ? (
              <div role="group" className="comment-group">
                {visible.map((replyComment) => {
                  const { key: replyKey, ...replyProps } = rowProps(replyComment, false);
                  return <CommentRow key={replyKey} {...replyProps} />;
                })}
                {hidden > 0 ? (
                  <LinkButton
                    onClick={() => {
                      const firstNew = replies[visible.length];
                      setState((current) => (current ? { ...current, shown: { ...current.shown, [comment.id]: replies.length } } : current));
                      if (firstNew) requestFocus(firstNew.id);
                    }}
                  >
                    {hidden === 1 ? 'Show 1 more reply' : `Show ${hidden} more replies`}
                  </LinkButton>
                ) : null}
              </div>
            ) : null}
          </CommentRow>
        );
      })}
    </div>
  );
}

interface CommentRowProps {
  comment: Comment;
  topLevel: boolean;
  tabIndex: number;
  expanded?: boolean;
  canDelete: boolean;
  reply: ReplyTarget | null;
  onFocus: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onReply: () => void;
  onRemove: () => void;
  onPosted: () => void;
  onCloseReply: () => void;
  children?: React.ReactNode;
}

function CommentRow({ comment, topLevel, tabIndex, expanded, canDelete, reply, onFocus, onKeyDown, onReply, onRemove, onPosted, onCloseReply, children }: CommentRowProps) {
  const config = useConfig();
  const now = useNow();
  const author = comment.author;
  const name = comment.deleted || !author ? 'Deleted comment' : `${topLevel ? 'Comment' : 'Reply'} by ${author.name}`;
  const replying = reply?.commentId === comment.id;
  return (
    <div
      role="treeitem"
      aria-label={name}
      aria-level={topLevel ? 1 : 2}
      aria-expanded={expanded}
      tabIndex={tabIndex}
      className="comment"
      data-comment-id={comment.id}
      data-parent-id={comment.parent_id ?? ''}
      data-deleted={comment.deleted ? 'true' : 'false'}
      onFocus={(event) => event.target === event.currentTarget && onFocus()}
      onKeyDown={onKeyDown}
    >
      {comment.deleted || !author ? (
        <p className="muted">This comment was deleted.</p>
      ) : (
        <>
          <p className="comment-head">
            <Link to={`/in/${author.handle}`} className="comment-author">
              {author.name}
            </Link>
            <span className="muted">
              {' '}
              <time dateTime={comment.created_at}>{comment.created_at ? relativeTime(comment.created_at, now, config.time_zone) : ''}</time>
            </span>
          </p>
          <p className="post-text">
            <RichText text={comment.text ?? ''} mentions={comment.mentions ?? []} />
          </p>
          <div className="row comment-actions">
            <LinkButton onClick={onReply}>Reply</LinkButton>
            {canDelete ? <LinkButton onClick={onRemove}>Delete comment</LinkButton> : null}
          </div>
          {reply && replying ? <CommentForm key={reply.prefill} postId={comment.post_id} parentId={comment.id} label="Add a reply" submitLabel="Post reply" initialText={reply.prefill} focusSignal={1} onPosted={onPosted} onEscape={onCloseReply} /> : null}
        </>
      )}
      {children}
    </div>
  );
}
