import {
  createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type KeyboardEvent, type RefObject,
} from 'react';
import type { CommentSort, CommentView, CommunityView, PostView } from '../shared/types.js';
import { utcLabel } from '../shared/format.js';
import './comments.css';
import { ApiError, api, get, newKey } from './api.js';
import { announce } from './announce.js';
import { prefersReducedMotion } from './data.js';
import { useLive } from './live.js';
import { ReportDialog } from './report.js';
import { RemoveDialog } from './moderation.js';
import { Link, navigate, useSearch, useSetParam } from './router.js';
import { useSession } from './session.js';
import { Button, Html, MenuButton, Modal, TriangleRight, type MenuItem } from './ui.js';
import { useRoll, VoteControl } from './votes.js';

/** A reply posted deeper than the page shows leads to the continue page; this names the comment to focus there. */
export const pendingFocus: { id: string | null } = { id: null };

const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const WIDE_LEVELS = 8;
const PHONE_LEVELS = 5;

/** How many reply levels the page shows: 8 at 768 px and wider, 5 below. */
export function useLevels(): number {
  const query = '(min-width: 768px)';
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const change = (): void => setWide(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  return wide ? WIDE_LEVELS : PHONE_LEVELS;
}

/* ---------- pure tree operations ---------- */

const order = (sort: CommentSort) => (a: CommentView, b: CommentView): number => {
  const primary = sort === 'top' ? b.score - a.score : Date.parse(b.createdAt) - Date.parse(a.createdAt);
  return primary || Number(BigInt(b.id) - BigInt(a.id));
};

function mapNodes(nodes: CommentView[], change: (node: CommentView) => CommentView | null): CommentView[] {
  const out: CommentView[] = [];
  for (const node of nodes) {
    const next = change(node);
    if (next === null) continue;
    out.push({ ...next, replies: mapNodes(next.replies, change) });
  }
  return out;
}

function find(nodes: CommentView[], id: string): CommentView | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const inner = find(node.replies, id);
    if (inner) return inner;
  }
  return null;
}

/** Adds `comment` under its parent in sort order and raises the descendant count of every ancestor. Null when the parent is not shown. */
function addReply(tree: CommentView[], comment: CommentView, sort: CommentSort): CommentView[] | null {
  const sorted = (list: CommentView[]): CommentView[] => [...list, comment].sort(order(sort));
  if (comment.parentId === null) return sorted(tree);
  const down = (nodes: CommentView[]): CommentView[] | null => {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i] as CommentView;
      if (node.id === comment.parentId) {
        const copy = [...nodes];
        copy[i] = { ...node, descendantCount: node.descendantCount + 1, replies: sorted(node.replies) };
        return copy;
      }
      const inner = down(node.replies);
      if (inner) {
        const copy = [...nodes];
        copy[i] = { ...node, descendantCount: node.descendantCount + 1, replies: inner };
        return copy;
      }
    }
    return null;
  };
  return down(tree);
}

/* ---------- the model: loads a tree and keeps it live ---------- */

export interface TreeModel {
  tree: CommentView[] | null;
  error: ApiError | null;
  /** The post the comments belong to (known once the tree has loaded when the tree is a thread). */
  postId: string | null;
  /** The shallowest depth the tree shows (1 on a post page, the root's depth on a thread page). */
  baseDepth: number;
  levels: number;
  sort: CommentSort;
  reload: () => Promise<void>;
  /** Adds a comment under its parent, or refreshes it when it is already shown. */
  receive: (comment: CommentView) => 'inserted' | 'known' | 'orphan';
  patch: (id: string, fields: Partial<CommentView>) => void;
  arrivals: RefObject<Set<string>>;
  glow: Record<string, number>;
}

interface ModelOptions {
  postId: string;
  rootId: string | null;
  sort: CommentSort;
  onCommentCount: (count: number) => void;
}

export function useCommentTree({ postId, rootId, sort, onCommentCount }: ModelOptions): TreeModel {
  const { user } = useSession();
  const levels = useLevels();
  const [tree, setTree] = useState<CommentView[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [glow, setGlow] = useState<Record<string, number>>({});
  const arrivals = useRef<Set<string>>(new Set());
  const counter = useRef(0);
  const treeRef = useRef<CommentView[] | null>(null);
  treeRef.current = tree;
  const counted = useRef(onCommentCount);
  counted.current = onCommentCount;

  const path = rootId === null
    ? `/api/posts/${postId}/comments?sort=${sort}&depth=${levels}`
    : `/api/comments/${rootId}/thread?sort=${sort}&depth=${levels}`;

  const reload = useCallback(async () => {
    const mine = ++counter.current;
    try {
      const result = await get<{ tree: CommentView[] }>(path);
      if (mine !== counter.current) return;
      setTree(result.tree);
      setError(null);
    } catch (caught) {
      if (mine === counter.current) setError(caught instanceof ApiError ? caught : new ApiError(0, 'UNKNOWN', 'Something went wrong'));
    }
  }, [path]);

  useEffect(() => {
    void reload();
    return () => { counter.current++; };
  }, [reload]);

  const livePost = rootId === null ? postId : tree?.[0]?.postId ?? null;

  const receive = useCallback((comment: CommentView): 'inserted' | 'known' | 'orphan' => {
    const current = treeRef.current;
    if (current === null) return 'orphan';
    if (find(current, comment.id)) {
      setTree(mapNodes(current, (n) => (n.id === comment.id ? { ...n, ...comment, replies: n.replies, descendantCount: n.descendantCount } : n)));
      return 'known';
    }
    const next = addReply(current, comment, sort);
    if (next === null) return 'orphan';
    arrivals.current.add(comment.id);
    if (comment.parentId !== null) setGlow((g) => ({ ...g, [comment.parentId as string]: (g[comment.parentId as string] ?? 0) + 1 }));
    treeRef.current = next;
    setTree(next);
    return 'inserted';
  }, [sort]);

  const patch = useCallback((id: string, fields: Partial<CommentView>) => {
    setTree((current) => (current === null ? current : mapNodes(current, (n) => (n.id === id ? { ...n, ...fields } : n))));
  }, []);

  useLive(livePost === null ? [] : [`post:${livePost}`], (event, data) => {
    if (event === 'resync') {
      void reload();
    } else if (event === 'comments') {
      const payload = data as { postId: string; commentCount: number };
      if (payload.postId === livePost) counted.current(payload.commentCount);
    } else if (event === 'comment') {
      const payload = data as { postId: string; parentId: string | null; comment: CommentView };
      if (payload.postId !== livePost) return;
      const result = receive(payload.comment);
      if (result === 'orphan' && rootId === null) void reload();
      if (result === 'inserted' && payload.comment.author && payload.comment.author.username !== user?.username) {
        announce(`New reply from ${payload.comment.author.username}`);
      }
    }
  });

  const baseDepth = rootId === null ? 1 : tree?.[0]?.depth ?? 1;
  return { tree, error, postId: livePost, baseDepth, levels, sort, reload, receive, patch, arrivals, glow };
}

/* ---------- tree context ---------- */

interface FocusRequest { id: string; what: 'item' | 'pill' | 'rail'; tick: number }

interface TreeContext {
  model: TreeModel;
  post: PostView;
  community: CommunityView;
  folded: Set<string>;
  setFolded: (id: string, folded: boolean) => void;
  current: string | null;
  setCurrent: (id: string) => void;
  highlight: string | null;
  request: FocusRequest | null;
  requestFocus: (id: string, what: FocusRequest['what']) => void;
  commentCount: (count: number) => void;
  /** The reader's own reply was stored: show it, or lead to the continue page when it sits too deep. */
  replied: (comment: CommentView, parent: CommentView, commentCount: number) => void;
}

const Context = createContext<TreeContext | null>(null);

function useTree(): TreeContext {
  const value = useContext(Context);
  if (!value) throw new Error('CommentTree context missing');
  return value;
}

function foldedFromUrl(text: string | null): Set<string> {
  return new Set((text ?? '').split(',').map((s) => s.trim()).filter((s) => /^\d+$/.test(s)));
}

/* ---------- animations ---------- */

function cancelAll(...nodes: Array<Element | null>): void {
  for (const node of nodes) node?.getAnimations().forEach((a) => a.cancel());
}

function play(node: Element | null, frames: Keyframe[], options: KeyframeAnimationOptions): Animation | null {
  if (!node) return null;
  return node.animate(frames, { easing: EASE, ...options });
}

/* ---------- one comment ---------- */

interface NodeProps { node: CommentView; index: number; size: number; parentId: string | null }

function placeholderLabel(node: CommentView): string | null {
  if (node.state === 'deleted') return '[deleted]';
  if (node.state === 'removed') return '[removed by moderators]';
  return null;
}

function ReplyBox({ parent, onClose }: { parent: CommentView; onClose: () => void }): React.JSX.Element {
  const ctx = useTree();
  const { post } = ctx;
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useRef(newKey());
  const box = useRef<HTMLTextAreaElement>(null);
  const sending = useRef(false);
  const id = useId();
  const name = parent.author?.username ?? 'comment';

  useEffect(() => { box.current?.focus(); }, []);

  const send = async (): Promise<void> => {
    if (sending.current) return;
    const bodyMd = text.trim();
    if (bodyMd.length < 1 || bodyMd.length > 10_000) {
      setError('Comments are 1 to 10,000 characters');
      box.current?.focus();
      return;
    }
    sending.current = true;
    setBusy(true);
    try {
      const made = await api<{ comment: CommentView; commentCount: number }>(
        'POST', `/api/posts/${post.id}/comments`, { bodyMd, parentId: parent.id }, { key: key.current });
      ctx.replied(made.comment, parent, made.commentCount);
      onClose();
    } catch (caught) {
      setError(commentError(caught));
      box.current?.focus();
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="reply-box">
      <textarea
        id={id} ref={box} rows={3} aria-label={`Reply to ${name}`} value={text}
        aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => { setText(e.target.value); setError(null); }}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}
      />
      {error && <p id={`${id}-error`} className="field-error">{error}</p>}
      <div className="form-actions">
        <Button variant="primary" busy={busy} aria-disabled={busy || undefined} onClick={() => void send()}>{busy ? 'Posting...' : 'Post reply'}</Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}

export function commentError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.fields.bodyMd) return error.fields.bodyMd;
    if (error.code === 'LOCKED') return 'Locked by moderators';
    if (error.code === 'EMAIL_UNVERIFIED') return 'Verify your email to reply';
    if (error.code === 'RATE_LIMITED') return `Slow down — try again in ${error.retryAfter ?? 1} s`;
    if (error.code === 'ARCHIVED') return 'This thread is archived. Voting and replies are closed.';
  }
  return "The comment didn't send";
}

function EditBox({ node, onClose }: { node: CommentView; onClose: () => void }): React.JSX.Element {
  const ctx = useTree();
  const [text, setText] = useState(node.bodyMd ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  useEffect(() => { box.current?.focus(); }, []);

  const save = async (): Promise<void> => {
    const bodyMd = text.trim();
    if (bodyMd.length < 1 || bodyMd.length > 10_000) {
      setError('Comments are 1 to 10,000 characters');
      box.current?.focus();
      return;
    }
    setBusy(true);
    try {
      const updated = await api<CommentView>('PATCH', `/api/comments/${node.id}`, { bodyMd });
      ctx.model.patch(node.id, { bodyHtml: updated.bodyHtml, bodyMd: updated.bodyMd, editedAt: updated.editedAt, canEdit: updated.canEdit });
      announce('Comment updated');
      onClose();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'CONFLICT') {
        setError('The edit window has closed');
        ctx.model.patch(node.id, { canEdit: false });
      } else {
        setError(commentError(caught));
      }
      box.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="reply-box">
      <textarea
        id={id} ref={box} rows={3} aria-label="Body" value={text} aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => { setText(e.target.value); setError(null); }}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}
      />
      {error && <p id={`${id}-error`} className="field-error">{error}</p>}
      <div className="form-actions">
        <Button variant="primary" busy={busy} onClick={() => void save()}>{busy ? 'Saving...' : 'Save'}</Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}

function DeleteDialog({ node, onClose }: { node: CommentView; onClose: () => void }): React.JSX.Element {
  const ctx = useTree();
  const [busy, setBusy] = useState(false);
  const remove = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await api<{ commentCount: number }>('DELETE', `/api/comments/${node.id}`);
      announce('Comment deleted');
      onClose();
      ctx.commentCount(result.commentCount);
      await ctx.model.reload();
    } catch {
      announce("The comment couldn't be deleted", true);
      setBusy(false);
    }
  };
  return (
    <Modal title="Delete comment" role="alertdialog" onClose={onClose}>
      <p>This replaces your comment with a placeholder. Replies to it stay.</p>
      <div className="form-actions">
        <Button variant="danger" busy={busy} onClick={() => void remove()}>Delete</Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </Modal>
  );
}

function PillCount({ count }: { count: number }): React.JSX.Element {
  const roll = useRoll(count);
  return <><span ref={roll} className="num pill-count">{count}</span>{count === 1 ? ' reply folded' : ' replies folded'}</>;
}

function NewTag({ id }: { id: string }): React.JSX.Element | null {
  const [shown, setShown] = useState(true);
  const tag = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const row = document.getElementById(`comment-${id}`);
    const away = (): void => setShown(false);
    row?.addEventListener('focusin', away);
    let seen = false;
    const watcher = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) seen = true;
        else if (seen && entry.boundingClientRect.bottom < 0) setShown(false);
      }
    });
    if (tag.current) watcher.observe(tag.current);
    return () => { row?.removeEventListener('focusin', away); watcher.disconnect(); };
  }, [id]);
  return shown ? <span ref={tag} className="new-tag">New</span> : null;
}

function CommentNode({ node, index, size, parentId }: NodeProps): React.JSX.Element {
  const ctx = useTree();
  const { model, post, community } = ctx;
  const { user } = useSession();
  const reduced = prefersReducedMotion();
  const level = node.depth - model.baseDepth + 1;
  const folded = ctx.folded.has(node.id);
  const hasReplies = node.replies.length > 0;
  const atCut = level >= model.levels;
  const cutLink = atCut && node.replies.length === 0 && node.descendantCount > 0;
  const placeholder = placeholderLabel(node);
  const published = node.state === 'published';
  const username = node.author?.username ?? null;

  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<'report' | 'delete' | 'remove' | null>(null);
  const [prevFolded, setPrevFolded] = useState(folded);
  const [leaving, setLeaving] = useState(false);
  const arrival = useRef(model.arrivals.current.has(node.id));
  const showBody = !folded || leaving;

  if (prevFolded !== folded) {
    setPrevFolded(folded);
    setLeaving(folded && !reduced);
  }

  const item = useRef<HTMLLIElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const railButton = useRef<HTMLButtonElement>(null);
  const railLine = useRef<HTMLSpanElement>(null);
  const glowNode = useRef<HTMLSpanElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const replyBlock = useRef<HTMLUListElement>(null);
  const pill = useRef<HTMLButtonElement>(null);
  const replyButton = useRef<HTMLButtonElement>(null);
  const first = useRef(true);

  const isCurrent = ctx.current === node.id;
  const canReply = user !== null && !post.locked && !post.archived && published;

  /* the fold sequence: block shrinks and fades, rail retracts, header compacts into the pill (340 ms in all) */
  useLayoutEffect(() => {
    if (first.current) { first.current = false; return undefined; }
    if (reduced) return undefined;
    cancelAll(railLine.current, content.current, replyBlock.current, pill.current);
    const running: Array<Animation | null> = [];
    if (folded) {
      running.push(
        play(replyBlock.current, [{ opacity: 1, transform: 'scaleY(1)' }, { opacity: 0, transform: 'scaleY(0.6)' }], { duration: 220, fill: 'forwards' }),
        play(railLine.current, [{ transform: 'scaleY(1)' }, { transform: 'scaleY(0)' }], { duration: 160, delay: 100, fill: 'forwards' }),
        play(content.current, [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-6px)' }], { duration: 140, delay: 200, fill: 'forwards' }),
        play(pill.current, [{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 140, delay: 200, fill: 'backwards' }),
      );
      const live = running.filter((a): a is Animation => a !== null);
      void Promise.all(live.map((a) => a.finished)).then(() => setLeaving(false), () => undefined);
    } else {
      play(content.current, [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 140, fill: 'backwards' });
      play(railLine.current, [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], { duration: 160, delay: 80, fill: 'backwards' });
      play(replyBlock.current, [{ opacity: 0, transform: 'scaleY(0.6)' }, { opacity: 1, transform: 'scaleY(1)' }], { duration: 220, delay: 120, fill: 'backwards' });
    }
    return undefined;
  }, [folded, reduced]);

  /* a live or own reply grows into place */
  useLayoutEffect(() => {
    if (!arrival.current) return;
    model.arrivals.current.delete(node.id);
    if (!reduced) play(item.current, [{ opacity: 0, transform: 'translateY(-6px) scale(0.98)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }], { duration: 300 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* the parent's rail glows orange for about 1.2 s when a reply arrives */
  const glowTick = model.glow[node.id] ?? 0;
  useEffect(() => {
    if (glowTick === 0 || reduced) return;
    play(glowNode.current, [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 0 }], { duration: 1200 });
  }, [glowTick, reduced]);

  /* focus requests (after folding, unfolding, moving by key, or landing on a reply) */
  useLayoutEffect(() => {
    const req = ctx.request;
    if (!req || req.id !== node.id) return;
    const target = req.what === 'pill' ? pill.current : req.what === 'rail' ? railButton.current : item.current;
    if (target) target.focus();
  }, [ctx.request, node.id, folded]);

  /* roving tabindex: only the focused comment's own controls are in the Tab sequence */
  useEffect(() => {
    for (const control of row.current?.querySelectorAll<HTMLElement>('button, a[href], textarea, input') ?? []) {
      if (control.closest('dialog') || control.getAttribute('role') === 'menuitem') continue;
      control.tabIndex = isCurrent ? 0 : -1;
    }
  });

  const items: MenuItem[] = [{ label: 'Report illegal content', onSelect: () => setDialog('report') }];
  if (published && node.author && user && node.author.username === user.username) {
    if (node.canEdit) items.push({ label: 'Edit comment', onSelect: () => setEditing(true) });
    items.push({ label: 'Delete comment', onSelect: () => setDialog('delete') });
  }
  if (published && community.viewer.isModerator) items.push({ label: 'Remove comment', onSelect: () => setDialog('remove') });

  const fold = (): void => {
    ctx.setFolded(node.id, true);
    ctx.requestFocus(node.id, 'pill');
  };
  const unfold = (): void => {
    ctx.setFolded(node.id, false);
    ctx.requestFocus(node.id, 'rail');
  };

  const closeReply = (): void => {
    setReplying(false);
    replyButton.current?.focus();
  };

  return (
    <li
      ref={item} id={`comment-${node.id}`} role="treeitem" className={`c${ctx.highlight === node.id ? ' is-target' : ''}`}
      tabIndex={isCurrent ? 0 : -1} aria-label={username ? `Comment by ${username}` : `Comment ${placeholder ?? ''}`.trim()}
      aria-level={level} aria-setsize={size} aria-posinset={index + 1} aria-expanded={hasReplies ? !folded : undefined}
      data-parent={parentId ?? undefined} data-folded={folded || undefined}
    >
      <span ref={railLine} className="rail-line" aria-hidden="true" />
      <span ref={glowNode} className="rail-glow" aria-hidden="true" />
      <div ref={row} className="c-row" onFocus={() => ctx.setCurrent(node.id)}>
        {hasReplies && !folded && (
          <button ref={railButton} type="button" className="rail-btn" data-tree-key aria-label={`Fold replies to ${username ?? 'comment'}`} onClick={fold}>
            <span className="rail-bar" aria-hidden="true" />
          </button>
        )}
        <div className="c-head">
          {username ? <Link to={`/u/${username}`} className="c-author">{`u/${username}`}</Link> : <span className="c-author">{placeholder}</span>}
          <span className="num muted c-time">{utcLabel(node.createdAt)}</span>
          {node.editedAt && <span className="c-edited">edited</span>}
          {arrival.current && reduced && !folded && <NewTag id={node.id} />}
        </div>
        {folded && (
          <button ref={pill} type="button" className="fold-pill" data-tree-key onClick={unfold}>
            <TriangleRight size={12} />
            <span><PillCount count={node.descendantCount} /></span>
          </button>
        )}
        {showBody && (
          <div ref={content} className="c-content" inert={folded}>
            {placeholder && node.state === 'removed' && <p className="c-placeholder">{placeholder}</p>}
            {placeholder && node.state === 'deleted' && <p className="c-placeholder">{placeholder}</p>}
            {node.bodyHtml && !editing && <Html html={node.bodyHtml} className="c-body" />}
            {editing && <EditBox node={node} onClose={() => setEditing(false)} />}
            {published && (
              <div className="c-actions">
                <VoteControl kind="comment" id={node.id} score={node.score} myVote={node.myVote} label="Vote on comment" />
                {canReply && (
                  <button ref={replyButton} type="button" className="btn btn-plain c-reply" onClick={() => setReplying(true)}>Reply</button>
                )}
                <MenuButton label="More actions" items={items} />
                {cutLink && (
                  <Link to={`/c/${community.name}/post/${node.postId}/comment/${node.id}`} className="continue-link">Continue this thread</Link>
                )}
              </div>
            )}
            {!published && cutLink && (
              <Link to={`/c/${community.name}/post/${node.postId}/comment/${node.id}`} className="continue-link">Continue this thread</Link>
            )}
            {replying && <ReplyBox parent={node} onClose={closeReply} />}
          </div>
        )}
      </div>
      {dialog === 'report' && <ReportDialog targetType="comment" targetId={node.id} onClose={() => setDialog(null)} />}
      {dialog === 'delete' && <DeleteDialog node={node} onClose={() => setDialog(null)} />}
      {dialog === 'remove' && (
        <RemoveDialog kind="comment" targetId={node.id} community={community} onClose={() => setDialog(null)} onDone={() => void model.reload()} />
      )}
      {hasReplies && showBody && (
        <ul ref={replyBlock} role="group" className="c-replies" inert={folded}>
          {node.replies.map((child, i) => <CommentNode key={child.id} node={child} index={i} size={node.replies.length} parentId={node.id} />)}
        </ul>
      )}
    </li>
  );
}

/* ---------- the tree ---------- */

function visibleItems(tree: HTMLElement): HTMLElement[] {
  return [...tree.querySelectorAll<HTMLElement>('[role="treeitem"]')].filter((el) => !el.closest('[inert]'));
}

interface CommentTreeProps {
  model: TreeModel;
  post: PostView;
  community: CommunityView;
  onCommentCount: (count: number) => void;
}

export function CommentTree({ model, post, community, onCommentCount }: CommentTreeProps): React.JSX.Element {
  const search = useSearch();
  const setParam = useSetParam();
  const folded = useMemo(() => foldedFromUrl(search.get('fold')), [search]);
  const [current, setCurrent] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [request, setRequest] = useState<FocusRequest | null>(null);
  const tick = useRef(0);
  const treeNode = useRef<HTMLUListElement>(null);
  const tree = model.tree ?? [];

  const requestFocus = useCallback((id: string, what: FocusRequest['what']) => setRequest({ id, what, tick: ++tick.current }), []);

  const setFolded = useCallback((id: string, value: boolean) => {
    const next = foldedFromUrl(new URLSearchParams(location.search).get('fold'));
    if (value) next.add(id);
    else next.delete(id);
    setParam('fold', next.size === 0 ? null : [...next].join(','));
  }, [setParam]);

  const replied = useCallback((comment: CommentView, parent: CommentView, commentCount: number) => {
    announce('Reply posted');
    onCommentCount(commentCount);
    const level = parent.depth - model.baseDepth + 2;
    if (level > model.levels) {
      pendingFocus.id = comment.id;
      navigate(`/c/${community.name}/post/${comment.postId}/comment/${parent.id}`);
      return;
    }
    model.receive(comment);
    setHighlight(comment.id);
    requestFocus(comment.id, 'item');
  }, [model, community.name, onCommentCount, requestFocus]);

  /* land on a reply that was posted past the shown depth */
  useEffect(() => {
    const id = pendingFocus.id;
    if (id && model.tree && find(model.tree, id)) {
      pendingFocus.id = null;
      setHighlight(id);
      requestFocus(id, 'item');
    }
  }, [model.tree, requestFocus]);

  const firstId = tree[0]?.id ?? null;
  const active = current !== null && model.tree && find(model.tree, current) ? current : firstId;

  const ctx: TreeContext = {
    model, post, community, folded, setFolded, current: active,
    setCurrent: (id) => { setCurrent(id); if (id !== highlight) setHighlight(null); },
    highlight, request, requestFocus, replied, commentCount: onCommentCount,
  };

  const keys = (event: KeyboardEvent<HTMLUListElement>): void => {
    const target = event.target as HTMLElement;
    const item = target.closest<HTMLElement>('[role="treeitem"]');
    if (!item || event.ctrlKey || event.metaKey || event.altKey) return;
    if (target !== item && !target.hasAttribute('data-tree-key')) return;
    const id = item.id.slice('comment-'.length);
    const node = model.tree ? find(model.tree, id) : null;
    if (!node) return;
    const all = visibleItems(event.currentTarget);
    const at = all.indexOf(item);
    const go = (el: HTMLElement | undefined): void => {
      event.preventDefault();
      if (el) requestFocus(el.id.slice('comment-'.length), 'item');
    };
    const isFolded = folded.has(id);
    const hasReplies = node.replies.length > 0;
    switch (event.key) {
      case 'ArrowDown': go(all[at + 1]); break;
      case 'ArrowUp': go(all[at - 1]); break;
      case 'Home': go(all[0]); break;
      case 'End': go(all[all.length - 1]); break;
      case 'ArrowRight':
        event.preventDefault();
        if (isFolded) { setFolded(id, false); requestFocus(id, 'item'); } else if (hasReplies) go(item.querySelector<HTMLElement>(':scope > ul > [role="treeitem"]') ?? undefined);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        if (hasReplies && !isFolded) { setFolded(id, true); requestFocus(id, 'pill'); } else {
          const parent = item.parentElement?.closest<HTMLElement>('[role="treeitem"]');
          if (parent) go(parent);
        }
        break;
      default:
    }
  };

  return (
    <Context.Provider value={ctx}>
      <ul ref={treeNode} role="tree" aria-label="Comments" className="c-tree" onKeyDown={keys}>
        {tree.map((node, i) => <CommentNode key={node.id} node={node} index={i} size={tree.length} parentId={null} />)}
      </ul>
    </Context.Provider>
  );
}
