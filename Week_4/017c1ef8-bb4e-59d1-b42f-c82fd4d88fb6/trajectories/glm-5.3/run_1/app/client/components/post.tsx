import { useEffect, useState, useRef } from 'react';
import type { Post, FeedEntry } from '../types.js';
import { api, uploadFile } from '../api.js';
import { useApp } from '../app-context.js';
import { announce, } from '../main.js';
import { relativeTime, counterText, renderBody, REACTION_TYPES } from '../format.js';
import { Dialog, Menu, MenuItem } from '../dialog.js';
import { makeIdempotencyKey } from '../live.js';

export const TimeLink = ({ post, entryCreatedAt }: { post: Post; entryCreatedAt?: string }): JSX.Element => {
  const { businessNow, config, navigate } = useApp();
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 30_000);
    const onClock = (): void => force((n) => n + 1);
    window.addEventListener('pw-clock', onClock);
    return () => { clearInterval(id); window.removeEventListener('pw-clock', onClock); };
  }, []);
  const createdAt = entryCreatedAt ?? post.created_at;
  const label = `${relativeTime(createdAt, businessNow(), config?.time_zone ?? 'UTC')}${post.edited_at ? ' • Edited' : ''}`;
  return (
    <a
      href={`/posts/${post.id}`}
      onClick={(e) => { e.preventDefault(); navigate(`/posts/${post.id}`); }}
      className="entry-time"
    >
      <time dateTime={createdAt}>{label}</time>
    </a>
  );
};

export const RenderedText = ({ text, mentions }: { text: string; mentions: { handle: string; member_id: string; name: string }[] }): JSX.Element => {
  const { navigate } = useApp();
  return (
    <>
      {renderBody(text, mentions).map((part, index) => {
        if (part.kind === 'mention') {
          return (
            <a key={index} href={`/in/${part.handle}`} data-mention-id={part.id}
              onClick={(e) => { e.preventDefault(); navigate(`/in/${part.handle}`); }}>{part.name}</a>
          );
        }
        if (part.kind === 'hashtag') {
          const tag = part.value.slice(1);
          return (
            <a key={index} href={`/hashtag/${tag.toLowerCase()}`}
              onClick={(e) => { e.preventDefault(); navigate(`/hashtag/${tag.toLowerCase()}`); }}>{part.value}</a>
          );
        }
        if (part.kind === 'link') {
          return <a key={index} href={part.value.trim()} rel="noreferrer" target="_blank" referrerPolicy="no-referrer">{part.value.trim()}</a>;
        }
        return <span key={index}>{part.value}</span>;
      })}
    </>
  );
};

export const Composer = ({
  open, onClose, sharedPost,
}: {
  open: boolean; onClose: () => void; sharedPost?: Post | null;
}): JSX.Element => {
  const { config } = useApp();
  const [text, setText] = useState('');
  const [suggestions, setSuggestions] = useState<{ handle: string; name: string; id: string }[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const maxChars = config?.post_max_chars ?? 3000;
  const used = [...text].length;
  const blank = text.trim().length === 0;
  const over = used > maxChars;

  const matchFragment = (): { fragment: string; start: number } | null => {
    const caret = textareaRef.current?.selectionStart ?? text.length;
    const before = text.slice(0, caret);
    const match = /(?:^|\s)@([a-z0-9-]*)$/.exec(before);
    if (!match) return null;
    return { fragment: match[1], start: caret - match[1].length - 1 };
  };

  const refreshSuggestions = async (): Promise<void> => {
    const fragment = matchFragment();
    if (fragment === null || fragment.fragment.length === 0) { setSuggestions([]); return; }
    try {
      const network = await api.get<{ connections: { id: string; handle: string; name: string }[] }>('/api/network');
      const q = fragment.fragment.toLowerCase();
      const matches = network.connections
        .filter((c) => c.handle.startsWith(q) || c.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)))
        .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
        .slice(0, 5);
      setSuggestions(matches);
      setActiveIndex(0);
    } catch { setSuggestions([]); }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        applySuggestion(suggestions[activeIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setSuggestions([]);
        return;
      }
      if (e.key === 'Tab') {
        setSuggestions([]);
        return;
      }
    }
  };

  const applySuggestion = (person: { handle: string; name: string; id: string }): void => {
    const fragment = matchFragment();
    const textarea = textareaRef.current;
    if (!fragment || !textarea) return;
    const caret = textarea.selectionStart ?? text.length;
    const before = text.slice(0, fragment.start);
    const after = text.slice(caret);
    const inserted = `@${person.handle} `;
    const next = `${before}${inserted}${after}`;
    setText(next);
    setSuggestions([]);
    requestAnimationFrame(() => {
      const pos = (before + inserted).length;
      textarea.setSelectionRange(pos, pos);
      textarea.focus();
    });
  };

  const submit = async (): Promise<void> => {
    if (blank || over || sending || photoUploading) return;
    setSending(true);
    try {
      const body: Record<string, unknown> = { text };
      if (photoId) body.photo_id = photoId;
      if (sharedPost) body.shared_post_id = sharedPost.id;
      await api.post('/api/posts', body, makeIdempotencyKey());
      announce('Feed announcements', 'Post published.');
      setText('');
      setPhotoId(null);
      onClose();
      const opener = document.querySelector('button[aria-label="Start a post"]') as HTMLElement | null;
      opener?.focus();
    } catch (err) {
      const e2 = err as { status?: number; body?: { error?: string } };
      if (e2.body?.error === 'photo_too_large') {
        announce('Feed announcements', `Photos can be up to ${(config?.photo_max_bytes ?? 0).toLocaleString('en-US')} bytes.`);
      } else if (e2.body?.error === 'storage_unavailable') {
        announce('Feed announcements', 'Uploads are unavailable right now. Try again later.');
      } else {
        announce('Feed announcements', 'Post not published.');
      }
    } finally {
      setSending(false);
    }
  };

  if (!open) return <></>;
  return (
    <Dialog label="Create a post" onClose={() => { onClose(); }} closeButton={false}>
      {sharedPost && (
        <div role="region" aria-label="Shared post" className="entry">
          <PostBody post={sharedPost} />
        </div>
      )}
      <label className="label" htmlFor="composer-text">What do you want to talk about?</label>
      <textarea
        id="composer-text"
        ref={textareaRef}
        className="field"
        rows={5}
        value={text}
        onChange={(e) => { setText(e.target.value); void refreshSuggestions(); }}
        onKeyDown={onKeyDown}
        aria-describedby="composer-count"
      />
      <div id="composer-count" role="status" aria-label="Character count">{counterText(used, maxChars)}</div>
      {photoError && <div role="alert">{photoError}</div>}
      {suggestions.length > 0 && (
        <div role="listbox" aria-label="Mention suggestions" className="menu" style={{ position: 'static' }}>
          {suggestions.map((person, index) => (
            <button
              key={person.id}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className="menu-item"
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => applySuggestion(person)}
            >
              {person.name} (@{person.handle})
            </button>
          ))}
        </div>
      )}
      <div className="dialog-actions">
        <button
          type="button"
          className="text-button"
          onClick={() => fileRef.current?.click()}
          disabled={photoUploading || photoId !== null}
        >
          Add a photo
        </button>
        {photoUploading && <span aria-live="polite">Uploading…</span>}
        {photoId && <span>Photo attached.</span>}
        {photoId && (
          <button type="button" className="text-button" onClick={() => setPhotoId(null)}>Remove photo</button>
        )}
        <input
          ref={fileRef}
          type="file"
          aria-label="Photo"
          accept="image/jpeg,image/png"
          className="visually-hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setPhotoError(null);
            if (file.size > (config?.photo_max_bytes ?? 5000000)) {
              setPhotoError(`Photos can be up to ${(config?.photo_max_bytes ?? 0).toLocaleString('en-US')} bytes.`);
              return;
            }
            if (file.type !== 'image/jpeg' && file.type !== 'image/png') {
              setPhotoError('Choose a JPEG or PNG image.');
              return;
            }
            setPhotoUploading(true);
            announce('Feed announcements', 'Uploading…');
            const result = await uploadFile('/api/uploads/photo', file);
            setPhotoUploading(false);
            if (result.ok) {
              const data = result.data as { photo_id: string };
              setPhotoId(data.photo_id);
              announce('Feed announcements', 'Photo attached.');
            } else {
              const body = result.body as { error?: string };
              if (body?.error === 'photo_too_large') setPhotoError(`Photos can be up to ${(config?.photo_max_bytes ?? 0).toLocaleString('en-US')} bytes.`);
              else if (body?.error === 'storage_unavailable') setPhotoError('Uploads are unavailable right now. Try again later.');
              else setPhotoError('Choose a JPEG or PNG image.');
            }
          }}
        />
        <button type="button" className="pink-button" onClick={() => { void submit(); }} disabled={blank || over || sending || photoUploading}>
          Post
        </button>
      </div>
    </Dialog>
  );
};

export const ReactionToolbar = ({
  post, onApply,
}: { post: Post; onApply: (type: string) => Promise<void> }): JSX.Element => {
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const openToolbar = (): void => {
    const current = post.reactions.mine;
    const index = current ? REACTION_TYPES.findIndex((t) => t.value === current) : 0;
    setFocusIndex(index < 0 ? 0 : index);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const nodes = listRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [];
    nodes[focusIndex]?.focus();
  }, [open, focusIndex]);

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowRight') { e.preventDefault(); setFocusIndex((i) => (i + 1) % REACTION_TYPES.length); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); setFocusIndex((i) => (i - 1 + REACTION_TYPES.length) % REACTION_TYPES.length); }
    else if (e.key === 'Home') { e.preventDefault(); setFocusIndex(0); }
    else if (e.key === 'End') { e.preventDefault(); setFocusIndex(REACTION_TYPES.length - 1); }
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      void onApply(REACTION_TYPES[focusIndex].value);
      setOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    }
  };

  return (
    <>
      <button
        type="button"
        className="text-button"
        aria-pressed={Boolean(post.reactions.mine)}
        onClick={() => { void onApply(post.reactions.mine ?? 'like'); }}
      >
        React
      </button>
      <button ref={buttonRef} type="button" className="text-button" onClick={openToolbar}>Choose reaction</button>
      {open && (
        <div
          ref={listRef}
          role="toolbar"
          aria-label="Reactions"
          onKeyDown={onKey}
          className="menu"
          style={{ position: 'static' }}
        >
          {REACTION_TYPES.map((type, index) => (
            <button
              key={type.value}
              type="button"
              className="menu-item"
              aria-pressed={post.reactions.mine === type.value}
              onFocus={() => setFocusIndex(index)}
              onClick={() => {
                void onApply(type.value);
                setOpen(false);
                buttonRef.current?.focus();
              }}
            >
              {type.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
};

export const PostBody = ({ post }: { post: Post }): JSX.Element => {
  const { config } = useApp();
  const [expanded, setExpanded] = useState(false);
  const seeMore = config?.see_more_chars ?? 210;
  const codePoints = [...post.text];
  const isLong = codePoints.length > seeMore;
  const shown = expanded || !isLong ? post.text : `${codePoints.slice(0, seeMore).join('')}…`;

  return (
    <>
      <div className="entry-header">
        <a href={`/in/${post.author.handle}`} className="entry-author-name">{post.author.name}</a>
        <span className="entry-headline">{post.author.headline}</span>
      </div>
      <TimeLink post={post} />
      <p className="entry-text"><RenderedText text={shown} mentions={post.mentions} />{' '}
        {isLong && !expanded && (
          <button type="button" className="text-button" onClick={() => setExpanded(true)}>see more</button>
        )}
      </p>
      {post.photo_url && <img src={post.photo_url} alt="" className="post-photo" />}
      {post.shared && ('unavailable' in post.shared ? (
        <p className="deleted-comment">This post is no longer available.</p>
      ) : (
        <div className="shared-post">
          <PostBody post={post.shared} />
        </div>
      ))}
      {post.reactions.count > 0 && (
        <p className="reaction-summary" data-reaction-summary data-count={post.reactions.count} data-top-types={post.reactions.top_types.join(',')}>
          {post.reactions.text}
        </p>
      )}
      {post.reactions.count === 0 && (
        <p className="reaction-summary" data-reaction-summary data-count={0} data-top-types="" aria-hidden="true" />
      )}
      <p className="count-line">
        {post.comment_count > 0 && `${post.comment_count} comment${post.comment_count === 1 ? '' : 's'}`}
        {post.comment_count > 0 && post.repost_count > 0 && ' · '}
        {post.repost_count > 0 && `${post.repost_count} repost${post.repost_count === 1 ? '' : 's'}`}
      </p>
    </>
  );
};

export const Entry = ({
  entry, focused, onFocus, onComment, onChanged,
}: {
  entry: FeedEntry;
  focused: boolean;
  onFocus: () => void;
  onComment?: (post: Post) => void;
  onChanged: () => void;
}): JSX.Element => {
  const { me } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const [repostMenu, setRepostMenu] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [commentBoxOpen, setCommentBoxOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const post = entry.post;
  const isAuthor = me?.id === post.author.id;

  const applyReaction = async (type: string): Promise<void> => {
    const current = post.reactions.mine;
    try {
      if (current === type) {
        await api.delete(`/api/posts/${post.id}/reaction`);
        announce('Feed announcements', 'Reaction removed');
      } else {
        await api.put(`/api/posts/${post.id}/reaction`, { type });
        const label = REACTION_TYPES.find((t) => t.value === type)?.label ?? type;
        announce('Feed announcements', `Reaction: ${label}`);
      }
      onChanged();
    } catch {
      announce('Feed announcements', 'Something went wrong. Try again.');
    }
  };

  const postComment = async (): Promise<void> => {
    if (commentText.trim().length === 0 || busy) return;
    setBusy(true);
    try {
      await api.post(`/api/posts/${post.id}/comments`, { text: commentText }, makeIdempotencyKey());
      setCommentText('');
      announce('Feed announcements', 'Comment posted.');
      onChanged();
    } catch {
      announce('Feed announcements', 'Comment not posted.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <article
      className={`entry ${focused ? 'entry-focused' : ''}`}
      tabIndex={-1}
      data-entry-id={entry.entry_id}
      data-entry-kind={entry.kind}
      data-post-id={post.id}
      data-author-id={post.author.id}
      data-repost-of={entry.kind === 'repost' ? post.id : ''}
      data-reposter-id={entry.reposter?.id ?? ''}
      onFocus={onFocus}
    >
      {entry.kind === 'repost' && entry.reposter && (
        <p className="credit-line">{entry.reposter.name} reposted this</p>
      )}
      <PostBody post={post} />
      <div className="entry-actions">
        <ReactionToolbar post={post} onApply={applyReaction} />
        <button
          type="button"
          className="text-button"
          onClick={() => {
            if (onComment) onComment(post);
            else setCommentBoxOpen(true);
          }}
        >
          Comment
        </button>
        <button type="button" className="text-button" onClick={() => setRepostMenu(true)}>Repost</button>
        {isAuthor && <button type="button" className="text-button" onClick={() => setMenuOpen(true)}>Post actions</button>}
      </div>
      {(commentBoxOpen || onComment === undefined) && (
        <>
          <label className="label visually-hidden" htmlFor={`comment-${post.id}`}>Add a comment</label>
          <textarea
            id={`comment-${post.id}`}
            className="field"
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
          />
          <button type="button" className="pink-button" onClick={() => { void postComment(); }} disabled={commentText.trim().length === 0 || busy}>
            Post comment
          </button>
        </>
      )}
      {repostMenu && (
        <Menu label="Repost options" onClose={() => setRepostMenu(false)}>
          <MenuItem label="Repost" onSelect={() => {
            setRepostMenu(false);
            void (async () => {
              try {
                await api.post(`/api/posts/${post.id}/reposts`, {});
                announce('Feed announcements', 'Reposted.');
                onChanged();
              } catch (err) {
                const e2 = err as { status?: number; body?: { error?: string } };
                if (e2.body?.error === 'already_reposted') {
                  announce('Feed announcements', 'Something went wrong. Try again.');
                } else {
                  announce('Feed announcements', 'Something went wrong. Try again.');
                }
              }
            })();
          }} />
          <MenuItem label="Repost with your thoughts" onSelect={() => { setRepostMenu(false); setComposerOpen(true); }} />
        </Menu>
      )}
      {menuOpen && (
        <Menu label="Post actions menu" onClose={() => setMenuOpen(false)} align="right">
          {post.editable && (
            <MenuItem label="Edit post" onSelect={() => { setMenuOpen(false); setEditOpen(true); }} />
          )}
          <MenuItem label="Delete post" danger onSelect={() => { setMenuOpen(false); setDeleteOpen(true); }} />
        </Menu>
      )}
      {composerOpen && (
        <Composer open onClose={() => setComposerOpen(false)} sharedPost={post} />
      )}
      {editOpen && <EditPostDialog post={post} onClose={() => setEditOpen(false)} onSaved={onChanged} />}
      {deleteOpen && (
        <Dialog label="Delete post?" onClose={() => setDeleteOpen(false)} closeButton={false}>
          <h2>Delete post?</h2>
          <div className="dialog-actions">
            <button type="button" className="pink-button" onClick={() => {
              void (async () => {
                try {
                  await api.delete(`/api/posts/${post.id}`);
                  announce('Feed announcements', 'Post deleted.');
                  setDeleteOpen(false);
                  onChanged();
                } catch {
                  announce('Feed announcements', 'Something went wrong. Try again.');
                }
              })();
            }}>Delete</button>
            <button type="button" className="text-button" onClick={() => setDeleteOpen(false)}>Cancel</button>
          </div>
        </Dialog>
      )}
    </article>
  );
};

export const EditPostDialog = ({ post, onClose, onSaved }: { post: Post; onClose: () => void; onSaved: () => void }): JSX.Element => {
  const { config } = useApp();
  const [text, setText] = useState(post.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const maxChars = config?.post_max_chars ?? 3000;
  const used = [...text].length;
  const over = used > maxChars;
  const blank = text.trim().length === 0;

  return (
    <Dialog label="Edit post" onClose={onClose} closeButton={false}>
      <h2>Edit post</h2>
      <label className="label" htmlFor={`edit-${post.id}`}>What do you want to talk about?</label>
      <textarea id={`edit-${post.id}`} className="field" rows={5} value={text} onChange={(e) => setText(e.target.value)} />
      <div role="status" aria-label="Character count">{counterText(used, maxChars)}</div>
      {error && <div role="alert">{error}</div>}
      <div className="dialog-actions">
        <button
          type="button"
          className="pink-button"
          disabled={blank || over || busy}
          onClick={() => {
            void (async () => {
              setBusy(true);
              try {
                await api.patch(`/api/posts/${post.id}`, { text });
                announce('Feed announcements', 'Post updated.');
                setBusy(false);
                onClose();
                onSaved();
              } catch (err) {
                const e2 = err as { status?: number; body?: { error?: string } };
                setBusy(false);
                if (e2.body?.error === 'edit_window_closed') setError('The edit window for this post has closed.');
                else setError('Something went wrong. Try again.');
              }
            })();
          }}
        >
          Save changes
        </button>
      </div>
    </Dialog>
  );
};
