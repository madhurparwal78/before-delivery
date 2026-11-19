import { useId, useRef, useState } from 'react';
import type { CommentSort, CommentView, CommunityView, PostView } from '../shared/types.js';
import { api, newKey } from './api.js';
import { announce } from './announce.js';
import { CommentTree, commentError, pendingFocus, useCommentTree } from './comment-tree.js';
import { Link } from './router.js';
import { useSession } from './session.js';
import { Button, Empty, Skeleton, Tabs } from './ui.js';

function TopLevelComposer({ post, onPosted }: { post: PostView; onPosted: (comment: CommentView, count: number) => void }): React.JSX.Element {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useRef(newKey());
  const sending = useRef(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const id = useId();

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
        'POST', `/api/posts/${post.id}/comments`, { bodyMd, parentId: null }, { key: key.current });
      setText('');
      key.current = newKey();
      announce('Reply posted');
      onPosted(made.comment, made.commentCount);
    } catch (caught) {
      setError(commentError(caught));
      box.current?.focus();
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  return (
    <form className="comment-composer" onSubmit={(e) => { e.preventDefault(); void send(); }} noValidate>
      <label htmlFor={id} className="field-label">Add a comment</label>
      <textarea
        id={id} ref={box} rows={3} value={text} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => { setText(e.target.value); setError(null); }}
      />
      {error && <p id={`${id}-error`} className="field-error">{error}</p>}
      <div className="form-actions">
        <Button type="submit" variant="primary" busy={busy} aria-disabled={busy || undefined} onClick={(e) => { e.preventDefault(); void send(); }}>
          {busy ? 'Posting...' : 'Comment'}
        </Button>
      </div>
    </form>
  );
}

interface CommentSectionProps {
  post: PostView;
  community: CommunityView;
  /** Keeps the post header's comment count in step with the tree. */
  onCommentCount: (count: number) => void;
}

/** The post page's comments: composer, sort tabs and the tree. */
export function CommentSection({ post, community, onCommentCount }: CommentSectionProps): React.JSX.Element {
  const { user } = useSession();
  const [sort, setSort] = useState<CommentSort>('top');
  const model = useCommentTree({ postId: post.id, rootId: null, sort, onCommentCount });
  const open = !post.locked && !post.archived && post.state === 'published';

  const posted = (comment: CommentView, count: number): void => {
    onCommentCount(count);
    model.receive(comment);
    pendingFocus.id = comment.id;
  };

  return (
    <section className="comments" aria-label="Comments section">
      {user && open && <TopLevelComposer post={post} onPosted={posted} />}
      {!user && open && <p className="muted"><Link to={`/login?next=${encodeURIComponent(location.pathname)}`}>Sign in to join the conversation</Link>.</p>}
      <Tabs
        label="Sort comments" value={sort} onChange={setSort} className="comment-sort"
        options={[{ value: 'top', label: 'Top' }, { value: 'new', label: 'New' }]}
      />
      {model.tree === null && !model.error && <Skeleton rows={3} />}
      {model.error && <Empty title="The comments could not load"><Button onClick={() => void model.reload()}>Try again</Button></Empty>}
      {model.tree !== null && model.tree.length === 0 && <p className="muted">No comments yet.</p>}
      {model.tree !== null && model.tree.length > 0 && <CommentTree model={model} post={post} community={community} onCommentCount={onCommentCount} />}
    </section>
  );
}
