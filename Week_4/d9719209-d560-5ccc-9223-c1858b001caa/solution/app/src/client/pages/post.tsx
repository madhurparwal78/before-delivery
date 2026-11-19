import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { CommunityView, PostView } from '../../shared/types.js';
import { utcLabel } from '../../shared/format.js';
import { ApiError, api, get } from '../api.js';
import { announce } from '../announce.js';
import { CommentSection } from '../comments.js';
import { CommunitySidebar, useCommunity } from '../community.js';
import { useLoad } from '../data.js';
import { commentsLabel, Byline } from '../feed.js';
import { Gallery } from '../gallery.js';
import { useLive } from '../live.js';
import { LockDialog, raceLost, RemoveDialog, ReplacePinDialog, type PostCurrent } from '../moderation.js';
import { ReportDialog } from '../report.js';
import { navigate } from '../router.js';
import { Banner, Button, Empty, Field, Html, MenuButton, Modal, Skeleton, pageTitle, type MenuItem } from '../ui.js';
import { VoteControl, voteKeys } from '../votes.js';

type Dialog = 'report' | 'remove' | 'lock' | 'delete' | { replace: Array<{ id: string; title: string }> } | null;

function EditForm({ post, onCancel, onSaved }: { post: PostView; onCancel: () => void; onSaved: (post: PostView) => void }): React.JSX.Element {
  const [body, setBody] = useState(post.bodyMd ?? '');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    try {
      const updated = await api<PostView>('PATCH', `/api/posts/${post.id}`, { bodyMd: body });
      announce('Post updated');
      onSaved(updated);
    } catch (caught) {
      if (caught instanceof ApiError && caught.fields.bodyMd) {
        setError(caught.fields.bodyMd);
        field.current?.focus();
      } else {
        announce("The post didn't save", true);
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(e) => void save(e)} className="edit-form" noValidate>
      <p className="muted">Titles can't be edited</p>
      <Field label="Body" error={error}>
        {(props) => <textarea {...props} ref={field} rows={8} value={body} onChange={(e) => setBody(e.target.value)} autoFocus />}
      </Field>
      <div className="form-actions">
        <Button type="submit" variant="primary" busy={busy}>{busy ? 'Saving...' : 'Save'}</Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function PostBody({ initial, community, reload }: {
  initial: PostView; community: CommunityView; reload: () => Promise<void>;
}): React.JSX.Element {
  const [post, setPost] = useState(initial);
  const [count, setCount] = useState(initial.commentCount);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [editing, setEditing] = useState(false);
  const probed = useRef(false);
  const latest = useRef(post);
  latest.current = post;
  useEffect(() => {
    setPost(initial);
    setCount(initial.commentCount);
  }, [initial]);

  const isAuthor = post.bodyMd !== undefined;
  const mod = community.viewer.isModerator;
  const live = post.state === 'published';

  useLive([`post:${post.id}`], (event, data) => {
    if (event === 'comments') {
      const p = data as { postId: string; commentCount: number };
      if (p.postId === post.id) setCount(p.commentCount);
    } else if (event === 'post-state') {
      const s = data as { postId: string; state: PostView['state']; locked: boolean; lockedUntil: string | null; pinned: boolean; version: number };
      const now = latest.current;
      if (s.postId !== now.id) return;
      const changed = s.version > now.version || s.state !== now.state || s.locked !== now.locked || s.pinned !== now.pinned;
      if (!changed) return;
      if (s.locked !== now.locked && s.state === now.state) announce(s.locked ? 'Thread locked' : 'Thread unlocked');
      if (s.state === 'removed' && now.state !== 'removed') announce('Post removed by moderators');
      setPost({ ...now, state: s.state, locked: s.locked, lockedUntil: s.lockedUntil, pinned: s.pinned, version: s.version });
      void reload();
    } else if (event === 'resync') {
      void reload();
    }
  });

  const apply = (current: PostCurrent): void => {
    setPost((p) => ({ ...p, ...current }));
    void reload();
  };

  const act = async (method: 'POST' | 'DELETE', action: string, message: string, extra: Record<string, unknown> = {}): Promise<void> => {
    try {
      const updated = await api<PostView>(method, `/api/posts/${post.id}/${action}`, { version: post.version, ...extra });
      setPost(updated);
      announce(message);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'SLOT_TAKEN') {
        const pinned = (error.current as { pinned?: Array<{ id: string; title: string }> } | null)?.pinned ?? [];
        setDialog({ replace: pinned });
      } else if (!raceLost(error, apply)) {
        announce("That action didn't go through", true);
      }
    }
  };

  const guardModerator = async (): Promise<boolean> => {
    if (probed.current) return true;
    try {
      await get(`/api/communities/${community.name}/moderators`);
      probed.current = true;
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.code === 'TOTP_REQUIRED') {
        navigate(`/settings/2fa?next=${encodeURIComponent(location.pathname)}`);
        return false;
      }
      return true;
    }
  };

  const modItems: MenuItem[] = [];
  if (post.state === 'published') {
    modItems.push({ label: 'Remove post', onSelect: () => setDialog('remove') });
    modItems.push(post.locked
      ? { label: 'Unlock thread', onSelect: () => void act('DELETE', 'lock', 'Thread unlocked') }
      : { label: 'Lock thread', onSelect: () => setDialog('lock') });
    modItems.push(post.pinned
      ? { label: 'Unpin post', onSelect: () => void act('DELETE', 'pin', 'Post unpinned') }
      : { label: 'Pin post', onSelect: () => void act('POST', 'pin', 'Post pinned') });
  } else if (post.state === 'removed') {
    modItems.push({ label: 'Restore post', onSelect: () => void act('DELETE', 'removal', 'Post restored') });
  }

  const moreItems: MenuItem[] = [{ label: 'Report illegal content', onSelect: () => setDialog('report') }];
  if (isAuthor && live && !post.archived) moreItems.push({ label: 'Edit post', onSelect: () => setEditing(true) });
  if (isAuthor && post.state !== 'deleted') moreItems.push({ label: 'Delete post', onSelect: () => setDialog('delete') });

  const remove = async (): Promise<void> => {
    try {
      const updated = await api<PostView>('DELETE', `/api/posts/${post.id}`);
      setPost(updated);
      setDialog(null);
      announce('Post deleted');
    } catch {
      announce("The post wasn't deleted", true);
    }
  };

  const reason = post.removal?.publicReason ?? null;
  const heading = post.state === 'removed' ? `Removed by moderators: ${reason ?? ''}` : (post.title ?? '[deleted by author]');
  pageTitle(post.title ?? heading);

  return (
    <>
      <div className="page-head">
        <article id={`post-${post.id}`} className="post-head" tabIndex={0} aria-label={post.title ?? heading} onKeyDown={voteKeys}>
          <VoteControl kind="post" id={post.id} score={post.score} myVote={post.myVote} />
          <div className="post-head-main">
            <h1 className="post-heading">{heading}</h1>
            {post.state === 'removed' && post.title !== null && <h2 className="post-original-title">{post.title}</h2>}
            {post.state !== 'deleted' && post.author !== null && <Byline post={post} />}
            {post.state !== 'deleted' && post.author === null && <p className="byline"><span className="num">{utcLabel(post.createdAt)}</span></p>}
            <div className="post-meta">
              <span id={`comments-post-${post.id}`} className="num">{commentsLabel(count)}</span>
              {post.editedAt !== null && <span className="tag">edited</span>}
              {post.pinned && <span className="tag">Pinned</span>}
              <span className="post-menus">
                <MenuButton label="More actions" items={moreItems} />
                {mod && <MenuButton label="Moderator actions" items={modItems} beforeOpen={guardModerator} className="menu-button-text">Moderator actions</MenuButton>}
              </span>
            </div>
          </div>
        </article>
      </div>
      <div className="page-side"><CommunitySidebar community={community} /></div>
      <div className="page-main">
        {post.locked && (
          <Banner tone="warn" role="note">
            <p><strong>Locked by moderators</strong></p>
            {post.lockedUntil !== null && <p>Replies reopen <span className="num">{utcLabel(post.lockedUntil)}</span></p>}
          </Banner>
        )}
        {post.archived && <Banner role="note">This thread is archived. Voting and replies are closed.</Banner>}
        {post.state === 'removed' && post.title !== null && <Banner tone="warn" role="note">{`Removed by moderators: ${reason ?? ''}`}</Banner>}
        {post.state === 'published' || (post.state === 'removed' && post.bodyHtml !== null) ? (
          editing && post.bodyMd !== undefined
            ? <EditForm post={post} onCancel={() => setEditing(false)} onSaved={(p) => { setPost(p); setEditing(false); }} />
            : <>
              {post.bodyHtml !== null && post.bodyHtml !== '' && <div className="post-body"><Html html={post.bodyHtml} /></div>}
              {post.images.length > 0 && <Gallery post={post} />}
            </>
        ) : null}
        <CommentSection post={{ ...post, commentCount: count }} community={community} onCommentCount={setCount} />
      </div>
      {dialog === 'report' && <ReportDialog targetType="post" targetId={post.id} onClose={() => setDialog(null)} />}
      {dialog === 'remove' && (
        <RemoveDialog kind="post" targetId={post.id} version={post.version} community={community} onClose={() => setDialog(null)} onDone={() => void reload()} onConflict={apply} />
      )}
      {dialog === 'lock' && <LockDialog post={post} onClose={() => setDialog(null)} onDone={setPost} onConflict={apply} />}
      {typeof dialog === 'object' && dialog !== null && (
        <ReplacePinDialog post={post} pinned={dialog.replace} onClose={() => setDialog(null)} onDone={setPost} onConflict={apply} />
      )}
      {dialog === 'delete' && (
        <Modal title="Delete post" role="alertdialog" onClose={() => setDialog(null)}>
          <p>This replaces the post with a placeholder. Its comments stay.</p>
          <div className="form-actions">
            <Button variant="danger" onClick={() => void remove()}>Delete</Button>
            <Button onClick={() => setDialog(null)}>Cancel</Button>
          </div>
        </Modal>
      )}
    </>
  );
}

export function PostPage({ name, postId }: { name: string; postId: string }): React.JSX.Element {
  const community = useCommunity(name);
  const post = useLoad(() => get<PostView>(`/api/posts/${postId}`), postId);
  if (post.error?.status === 404 || community.error?.status === 404) return <Empty title="Post not found">This post does not exist.</Empty>;
  if (!post.data || !community.data) return <Skeleton rows={3} />;
  return (
    <div className="page-grid">
      <PostBody initial={post.data} community={community.data} reload={post.reload} />
    </div>
  );
}
