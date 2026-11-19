import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { announce } from '../../announce';
import { ApiError, api } from '../../api';
import { useConfig, useNow } from '../../clock';
import { countCodePoints, plural, relativeTime, takeCodePoints } from '../../format';
import { useLive } from '../../live';
import { useMember } from '../../session';
import type { MemberRef, Post } from '../../types';
import { Alert, LinkButton, Menu } from '../../ui';
import { CommentForm } from './CommentForm';
import { Composer } from './Composer';
import { EditPostDialog, DeletePostDialog } from './PostDialogs';
import { ReactionControls } from './ReactionControls';
import { toggleReact } from './reactions';
import { RichText } from './richtext';
import { SharedPost } from './SharedPost';
import { markDeletedHere } from './store';
import './feed.css';

const GENERIC_FAILURE = 'Something went wrong. Try again.';

/** DOM events the feed shortcuts send to the focused entry. */
export const ENTRY_REACT = 'entry:react';
export const ENTRY_COMMENT = 'entry:comment';

interface PostEntryProps {
  post: Post;
  entryId?: string;
  kind?: 'post' | 'repost';
  reposter?: MemberRef | null;
  /** On the post's own page the comment box is always open and the post is not an entry in a list. */
  standalone?: boolean;
  /** The post is gone (deleted, or no longer visible to the viewer). */
  onGone?: (postId: string) => void;
  /** This member published something (a repost or a repost with thoughts) from this entry. */
  onPublished?: () => void;
}

export function PostEntry({ post: initial, entryId, kind = 'post', reposter = null, standalone = false, onGone, onPublished }: PostEntryProps) {
  const member = useMember();
  const config = useConfig();
  const now = useNow();
  const article = useRef<HTMLElement>(null);
  const [post, setPost] = useState(initial);
  const [expanded, setExpanded] = useState(false);
  const [commentOpen, setCommentOpen] = useState(standalone);
  const [commentFocus, setCommentFocus] = useState(0);
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const latest = useRef(post);
  latest.current = post;

  useEffect(() => setPost(initial), [initial]);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setPost(await api.get<Post>(`/api/posts/${latest.current.id}`));
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) onGone?.(latest.current.id);
    }
  }, [onGone]);

  useLive('post', (event) => {
    const shared = latest.current.shared;
    if (event.post_id === latest.current.id || (shared && 'id' in shared && shared.id === event.post_id)) void refresh();
  });
  useLive('clock', () => {
    if (latest.current.editable) void refresh();
  });
  useLive('reconnected', () => void refresh());

  const react = useCallback(async (): Promise<void> => {
    try {
      const reactions = await toggleReact(latest.current);
      setPost((current) => ({ ...current, reactions }));
    } catch {
      setProblem(GENERIC_FAILURE);
    }
  }, []);

  const openComment = useCallback((): void => {
    setCommentOpen(true);
    setCommentFocus((value) => value + 1);
  }, []);

  useEffect(() => {
    const element = article.current;
    if (!element) return undefined;
    const onReact = (): void => void react();
    const onComment = (): void => openComment();
    element.addEventListener(ENTRY_REACT, onReact);
    element.addEventListener(ENTRY_COMMENT, onComment);
    return () => {
      element.removeEventListener(ENTRY_REACT, onReact);
      element.removeEventListener(ENTRY_COMMENT, onComment);
    };
  }, [react, openComment]);

  const repost = async (): Promise<void> => {
    setProblem(null);
    setPending(true);
    try {
      await api.post(`/api/posts/${post.id}/reposts`);
      announce('Feed announcements', 'Reposted.');
      await refresh();
      onPublished?.();
    } catch {
      setProblem(GENERIC_FAILURE);
    } finally {
      setPending(false);
    }
  };

  const limit = config.see_more_chars;
  const long = countCodePoints(post.text) > limit;
  const cut = long && !expanded;
  const shared = post.shared;
  const repostOf = kind === 'repost' ? post.id : shared && 'id' in shared ? shared.id : '';
  const isAuthor = post.author.id === member.id;
  const actions = [
    ...(post.editable ? [{ label: 'Edit post', onSelect: () => setEditing(true) }] : []),
    { label: 'Delete post', onSelect: () => setDeleting(true) },
  ];

  return (
    <article
      ref={article}
      tabIndex={-1}
      aria-label={`Post by ${post.author.name}`}
      className="entry surface"
      data-entry-id={entryId ?? post.id}
      data-entry-kind={kind}
      data-post-id={post.id}
      data-author-id={post.author.id}
      data-repost-of={repostOf}
      data-reposter-id={reposter?.id ?? ''}
    >
      {kind === 'repost' && reposter ? <p className="muted entry-credit">{`${reposter.name} reposted this`}</p> : null}
      <header className="entry-head">
        <p className="entry-author t-heading">
          <Link to={`/in/${post.author.handle}`}>{post.author.name}</Link>
        </p>
        <p className="muted">{post.author.headline}</p>
        <p className="muted entry-time">
          <Link to={`/posts/${post.id}`} data-entry-time-link>
            <time dateTime={post.created_at}>{relativeTime(post.created_at, now, config.time_zone)}</time>
          </Link>
          {post.edited_at ? ' • Edited' : ''}
        </p>
      </header>
      <p className="post-text">
        <RichText text={cut ? takeCodePoints(post.text, limit) : post.text} mentions={post.mentions} />
        {cut ? (
          <>
            {'… '}
            <LinkButton onClick={() => setExpanded(true)}>see more</LinkButton>
          </>
        ) : null}
      </p>
      {post.photo_url ? <img className="post-photo" src={post.photo_url} alt="Attached to the post" /> : null}
      {shared ? <SharedPost post={shared} /> : null}
      <p
        className="reaction-summary"
        data-reaction-summary
        data-count={post.reactions.count}
        data-top-types={post.reactions.top_types.join(',')}
      >
        {post.reactions.text}
      </p>
      {post.comment_count > 0 || post.repost_count > 0 ? (
        <p className="entry-counts muted">
          {post.comment_count > 0 ? <span>{plural(post.comment_count, 'comment')}</span> : null}
          {post.repost_count > 0 ? <span>{plural(post.repost_count, 'repost')}</span> : null}
        </p>
      ) : null}
      <div className="entry-actions">
        <ReactionControls post={post} onChange={(reactions) => setPost((current) => ({ ...current, reactions }))} onFailure={() => setProblem(GENERIC_FAILURE)} />
        <LinkButton className="entry-action" onClick={standalone ? () => setCommentFocus((value) => value + 1) : openComment} aria-expanded={commentOpen}>
          Comment
        </LinkButton>
        <Menu
          label="Repost"
          triggerClassName="link-button entry-action"
          items={[
            { label: 'Repost', onSelect: () => void repost(), disabled: pending },
            { label: 'Repost with your thoughts', onSelect: () => setComposing(true) },
          ]}
        />
        {isAuthor ? (
          <Menu label="Post actions" triggerClassName="link-button entry-action" items={actions} onOpenChange={(open) => open && void refresh()} />
        ) : null}
      </div>
      {problem ? <Alert>{problem}</Alert> : null}
      {commentOpen ? (
        <CommentForm
          postId={post.id}
          label="Add a comment"
          submitLabel="Post comment"
          focusSignal={commentFocus}
          onPosted={() => void refresh()}
        />
      ) : null}
      <Composer
        open={composing}
        onClose={() => setComposing(false)}
        shared={post}
        onPublished={() => {
          void refresh();
          onPublished?.();
        }}
      />
      <EditPostDialog post={post} open={editing} onClose={() => setEditing(false)} onSaved={setPost} />
      <DeletePostDialog
        post={post}
        open={deleting}
        onClose={() => setDeleting(false)}
        onDeleted={(id) => {
          markDeletedHere(id);
          onGone?.(id);
        }}
      />
    </article>
  );
}
