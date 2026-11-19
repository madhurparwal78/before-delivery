import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../app-context.js';
import { announce } from '../main.js';
import type { Comment, FeedEntry, Profile } from '../types.js';
import { Composer, Entry, RenderedText } from '../components/post.js';
import { Dialog } from '../dialog.js';
import { useNavigationCounts } from '../chrome/counts.js';

type FeedResponse = { entries: FeedEntry[]; next_cursor: string | null; top_cursor: string | null };

export const Feed = (): JSX.Element => {
  const { me, navigate, liveEvents } = useApp();
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [waiting, setWaiting] = useState<FeedEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [topCursor, setTopCursor] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [connectionCount, setConnectionCount] = useState(0);
  const [empty, setEmpty] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const entriesRef = useRef<HTMLDivElement | null>(null);
  const postButtonRef = useRef<HTMLButtonElement | null>(null);

  useNavigationCounts();

  const load = useCallback(async (): Promise<void> => {
    try {
      const feed = await api.get<FeedResponse>('/api/feed');
      setEntries(feed.entries);
      setNextCursor(feed.next_cursor);
      setTopCursor(feed.top_cursor);
      setEmpty(feed.entries.length === 0);
      setLoaded(true);
      if (window.location.hash === '#compose') {
        setComposerOpen(true);
        window.history.replaceState({}, '', '/feed');
      }
    } catch {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const refreshWaiting = useCallback(async (): Promise<void> => {
    if (!topCursor) return;
    try {
      const fresh = await api.get<FeedResponse>(`/api/feed?newer_than=${encodeURIComponent(topCursor)}`);
      const ownEntries = fresh.entries.filter((e) => e.post.author.id === me?.id);
      const others = fresh.entries.filter((e) => e.post.author.id !== me?.id);
      if (others.length > 0) setWaiting((prev) => [...prev, ...others]);
      if (ownEntries.length > 0) {
        setEntries((prev) => [...ownEntries, ...prev]);
      }
      if (fresh.top_cursor) setTopCursor(fresh.top_cursor);
    } catch { /* offline */ }
  }, [topCursor, me]);

  useEffect(() => {
    const handler = (event: string): void => {
      void (async () => {
        if (event === 'post_update' || event === 'notification' || event === 'connection' || event === 'blocked' || event === 'blocked_by') {
          await load();
        } else if (event === 'clock') {
          await refreshWaiting();
        }
      })();
    };
    return liveEvents.subscribe(handler);
  }, [liveEvents, load, refreshWaiting]);

  const sideProfile = useRef<Profile | null>(null);
  useEffect(() => {
    void (async () => {
      if (!me) return;
      try {
        const profile = await api.get<Profile>('/api/me');
        sideProfile.current = profile;
        const network = await api.get<{ connections: unknown[]; received: unknown[] }>('/api/network');
        setConnectionCount(network.connections.length);
      } catch { /* ignore */ }
    })();
  }, [me]);

  const showMore = async (): Promise<void> => {
    if (!nextCursor) return;
    const feed = await api.get<FeedResponse>(`/api/feed?cursor=${encodeURIComponent(nextCursor)}`);
    setEntries((prev) => [...prev, ...feed.entries]);
    setNextCursor(feed.next_cursor);
    const first = entriesRef.current?.querySelectorAll('[tabindex="-1"]')[feed.entries.length] as HTMLElement | undefined;
    first?.focus();
    const index = entries.length + 1;
    setFocusedIndex(index);
  };

  const showNewPosts = (): void => {
    const inserted = [...waiting, ...entries];
    setEntries(inserted);
    setWaiting([]);
    if (waiting.length > 0) {
      requestAnimationFrame(() => {
        const first = entriesRef.current?.querySelector<HTMLElement>('[data-entry-id]');
        first?.focus();
        setFocusedIndex(0);
      });
    }
  };

  const shortcuts = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable]')) return;
    const nodes = Array.from(entriesRef.current?.querySelectorAll<HTMLElement>('[data-entry-id]') ?? []);
    const current = focusedIndex ?? -1;
    if (e.key === 'j') {
      e.preventDefault();
      const next = current < 0 ? 0 : Math.min(current + 1, nodes.length - 1);
      nodes[next]?.focus();
      setFocusedIndex(next);
    } else if (e.key === 'k') {
      e.preventDefault();
      const prev = current <= 0 ? 0 : current - 1;
      nodes[prev]?.focus();
      setFocusedIndex(prev);
    } else if (e.key === 'l') {
      e.preventDefault();
      const node = nodes[current < 0 ? 0 : current];
      node?.querySelector<HTMLButtonElement>('button[aria-pressed]')?.click();
    } else if (e.key === 'c') {
      e.preventDefault();
      const node = nodes[current < 0 ? 0 : current];
      const box = node?.querySelector<HTMLTextAreaElement>('textarea');
      box?.focus();
    } else if (e.key === '?') {
      setShortcutsOpen(true);
    }
  };

  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const waitingCount = waiting.length;
  useEffect(() => {
    if (waitingCount > 0) {
      announce('Feed announcements', waitingCount === 1 ? '1 new post available' : `${waitingCount} new posts available`);
    }
  }, [waitingCount]);

  return (
    <div onKeyDown={shortcuts}>
      <div className="feed-layout">
        <div className="feed-column" ref={entriesRef}>
          <button
            ref={postButtonRef}
            type="button"
            className="pill-button"
            aria-label="Start a post"
            onClick={() => setComposerOpen(true)}
          >
            Start a post
          </button>
          {waitingCount > 0 && (
            <button type="button" className="pill-button" onClick={showNewPosts}>
              {waitingCount === 1 ? 'Show 1 new post' : `Show ${waitingCount} new posts`}
            </button>
          )}
          {loaded && empty && (
            <div className="big-empty">
              <p>Your feed is empty.</p>
              <a href="/search?type=people&q=" onClick={(e) => { e.preventDefault(); navigate('/search?type=people&q='); }}>Find people</a>
            </div>
          )}
          {entries.map((entry, index) => (
            <Entry
              key={entry.entry_id}
              entry={entry}
              focused={focusedIndex === index}
              onFocus={() => setFocusedIndex(index)}
              onChanged={() => { void load(); }}
            />
          ))}
          {nextCursor && (
            <button type="button" className="pill-button" aria-label="Show more posts" onClick={() => { void showMore(); }}>
              Show more posts
            </button>
          )}
        </div>
        <div className="side-panel" role="complementary" aria-label="Your network">
          <p className="profile-name">{me?.name}</p>
          <p className="count-line">{connectionCount} connection{connectionCount === 1 ? '' : 's'}</p>
          <a href="/network" onClick={(e) => { e.preventDefault(); navigate('/network'); }}>Invitations</a>
        </div>
      </div>
      {composerOpen && <Composer open onClose={() => setComposerOpen(false)} />}
      {shortcutsOpen && (
        <Dialog label="Keyboard shortcuts" onClose={() => setShortcutsOpen(false)} closeButton={false}>
          <h2>Keyboard shortcuts</h2>
          <ul>
            <li>J — next post</li>
            <li>K — previous post</li>
            <li>L — react</li>
            <li>C — comment</li>
            <li>? — this dialog</li>
          </ul>
          <div className="dialog-actions">
            <button type="button" className="text-button" onClick={() => setShortcutsOpen(false)}>Close</button>
          </div>
        </Dialog>
      )}
    </div>
  );
};

/** The comment tree: a keyboard tree with collapsed replies. */
export const CommentTree = ({ postId, onChanged }: { postId: string; onChanged: () => void }): JSX.Element => {
  const { me } = useApp();
  const [comments, setComments] = useState<Comment[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [replyBox, setReplyBox] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [newComment, setNewComment] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    const result = await api.get<{ comments: Comment[] }>(`/api/posts/${postId}/comments`);
    setComments(result.comments);
  }, [postId]);

  useEffect(() => { void load(); }, [load]);

  const visibleReplies = (comment: Comment): Comment[] =>
    collapsed.has(comment.id) ? [] : comment.replies;

  const flatTreeitems = (): { id: string; node: HTMLElement | null }[] => {
    const out: { id: string; node: HTMLElement | null }[] = [];
    for (const comment of comments) {
      out.push({ id: comment.id, node: document.querySelector(`[data-comment-id="${comment.id}"]`) });
      for (const reply of visibleReplies(comment)) {
        out.push({ id: reply.id, node: document.querySelector(`[data-comment-id="${reply.id}"]`) });
      }
    }
    return out;
  };

  const moveFocus = (currentId: string, delta: number): void => {
    const items = flatTreeitems();
    const index = items.findIndex((i) => i.id === currentId);
    const next = items[index + delta];
    next?.node?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent, comment: Comment, isReply: boolean, parent: Comment | null): void => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(comment.id, 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus(comment.id, -1); }
    else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (isReply) return;
      if (comment.replies.length > 0) {
        if (collapsed.has(comment.id)) {
          setCollapsed((prev) => { const n = new Set(prev); n.delete(comment.id); return n; });
        }
        const first = document.querySelector(`[data-comment-id="${comment.replies[0].id}"]`) as HTMLElement | null;
        first?.focus();
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (isReply && parent) {
        const parentNode = document.querySelector(`[data-comment-id="${parent.id}"]`) as HTMLElement | null;
        parentNode?.focus();
      } else if (!isReply) {
        setCollapsed((prev) => new Set(prev).add(comment.id));
      }
    } else if (e.key === 'Home') {
      e.preventDefault();
      const items = flatTreeitems();
      items[0]?.node?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      const items = flatTreeitems();
      items[items.length - 1]?.node?.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      setReplyBox(comment.id);
        setReplyText(`@${comment.author?.handle ?? ''} `);
    }
  };

  const postComment = async (): Promise<void> => {
    if (newComment.trim().length === 0 || busy) return;
    setBusy(true);
    try {
      await api.post(`/api/posts/${postId}/comments`, { text: newComment }, `${Date.now()}-${Math.random()}`);
      setNewComment('');
      announce('Feed announcements', 'Comment posted.');
      await load();
      onChanged();
    } catch {
      announce('Feed announcements', 'Comment not posted.');
    } finally {
      setBusy(false);
    }
  };

  const postReply = async (parent: Comment): Promise<void> => {
    if (replyText.trim().length === 0 || busy) return;
    setBusy(true);
    try {
      await api.post(`/api/posts/${postId}/comments`, { text: replyText, parent_id: parent.id }, `${Date.now()}-${Math.random()}`);
      setReplyText('');
      setReplyBox(null);
      announce('Feed announcements', 'Comment posted.');
      await load();
      onChanged();
    } catch {
      announce('Feed announcements', 'Comment not posted.');
    } finally {
      setBusy(false);
    }
  };

  const deleteComment = async (comment: Comment): Promise<void> => {
    try {
      await api.delete(`/api/comments/${comment.id}`);
      announce('Feed announcements', 'Comment deleted.');
      await load();
      onChanged();
    } catch {
      announce('Feed announcements', 'Something went wrong. Try again.');
    }
  };

  const renderComment = (comment: Comment, isReply: boolean, parent: Comment | null): JSX.Element => {
    const shownReplies = visibleReplies(comment);
    const hidden = comment.replies.length - shownReplies.length;
    return (
      <div
        key={comment.id}
        className={`comment ${isReply ? 'reply' : ''}`}
        data-comment-id={comment.id}
        data-parent-id={parent?.id ?? ''}
        data-deleted={comment.deleted ? 'true' : 'false'}
      >
        <div
          role="treeitem"
          aria-expanded={isReply ? undefined : comment.replies.length > 0 ? !collapsed.has(comment.id) : undefined}
          aria-label={comment.deleted ? 'Deleted comment' : `Comment by ${comment.author?.name ?? ''}`}
          tabIndex={-1}
          onKeyDown={(e) => onKeyDown(e, comment, isReply, parent)}
        >
          {comment.deleted ? (
            <p className="deleted-comment">This comment was deleted.</p>
          ) : (
            <>
              <p className="entry-header">
                <a href={`/in/${comment.author?.handle}`} className="entry-author-name">{comment.author?.name}</a>
              </p>
              <p className="comment-text"><RenderedText text={comment.text} mentions={comment.mentions} /></p>
            </>
          )}
          {!comment.deleted && (
            <div className="entry-actions">
              <button type="button" className="text-button" onClick={() => {
                setReplyBox(comment.id);
                            setReplyText(`@${comment.author?.handle ?? ''} `);
              }}>Reply</button>
              {(me?.id === comment.author?.id) && (
                <button type="button" className="text-button" onClick={() => { void deleteComment(comment); }}>Delete comment</button>
              )}
            </div>
          )}
        </div>
        {replyBox === comment.id && (
          <div className="reply-box">
            <label className="label visually-hidden" htmlFor={`reply-${comment.id}`}>Add a comment</label>
            <textarea
              id={`reply-${comment.id}`}
              className="field"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setReplyBox(null);
                  const node = document.querySelector(`[data-comment-id="${comment.id}"]`) as HTMLElement | null;
                  (node?.querySelector('[role="treeitem"]') as HTMLElement | null)?.focus();
                }
              }}
            />
            <button type="button" className="pink-button" onClick={() => { void postReply(comment); }}>Post comment</button>
          </div>
        )}
        {!isReply && comment.replies.length > 0 && (
          <div role="group">
            {shownReplies.map((reply) => renderComment(reply, true, comment))}
            {hidden > 0 && (
              <button type="button" className="text-button" onClick={() => {
                setCollapsed((prev) => { const n = new Set(prev); n.delete(comment.id); return n; });
                const firstHidden = comment.replies[shownReplies.length];
                requestAnimationFrame(() => {
                  const node = document.querySelector(`[data-comment-id="${firstHidden.id}"] [role="treeitem"]`) as HTMLElement | null;
                  node?.focus();
                });
              }}>
                Show {hidden} more repl{hidden === 1 ? 'y' : 'ies'}
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="comments-tree" role="tree" aria-label="Comments">
      {comments.map((comment) => renderComment(comment, false, null))}
      <div className="new-comment">
        <label className="label" htmlFor={`new-comment-${postId}`}>Add a comment</label>
        <textarea
          id={`new-comment-${postId}`}
          className="field"
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
        />
        <button
          type="button"
          className="pink-button"
          aria-label="Post comment"
          disabled={newComment.trim().length === 0 || busy}
          onClick={() => { void postComment(); }}
        >
          Post comment
        </button>
      </div>
    </div>
  );
};
