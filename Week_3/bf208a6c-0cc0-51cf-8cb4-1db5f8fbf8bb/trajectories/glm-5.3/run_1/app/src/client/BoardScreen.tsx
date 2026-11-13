import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  roleAtLeast,
  SORT_LABELS,
  type Board,
  type CommentItem,
  type Post,
  type PostsListing,
  type Section,
  type SessionUser,
} from './api.js';
import { FrameVisual, HeartIcon, UpIcon, DownIcon, BubbleIcon, FileIcon } from './icons.js';
import { NotFoundScreen, PasswordScreen } from './StateScreens.js';
import type { JSX } from 'react';

type BoardMode = 'board' | 'share' | 'embed';

interface BoardScreenProps {
  boardId: string;
  me: SessionUser | null;
  navigate: (path: string) => void;
  mode: BoardMode;
  onSignedOut: () => void;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'password' }
  | { kind: 'missing' }
  | { kind: 'open'; board: Board; posts: PostsListing };

export function BoardScreen({ boardId, me, navigate, mode, onSignedOut }: BoardScreenProps): JSX.Element {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [announcement, setAnnouncement] = useState('');
  const [serviceNotice, setServiceNotice] = useState<string | null>(null);
  const [loupePostId, setLoupePostId] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, CommentItem[]>>({});
  const [movingPostId, setMovingPostId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState<'add' | 'edit' | 'settings' | 'members' | 'slideshow' | 'delete' | null>(null);
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [health, setHealth] = useState<{ storage: boolean; mail: boolean; push: boolean } | null>(null);
  const heldRef = useRef<string | null>(null);

  const announce = useCallback((line: string) => {
    setAnnouncement(line);
  }, []);

  const refreshHealth = useCallback(() => {
    api<{ status: string }>('/api/health')
      .then((r) => setHealth({ storage: r.status === 'ok', mail: r.status === 'ok', push: r.status === 'ok' }))
      .catch(() => setHealth(null));
  }, []);

  const load = useCallback(async () => {
    try {
      if (mode === 'board') {
        const board = await api<Board>(`/api/boards/${boardId}`);
        const posts = await api<PostsListing>(`/api/boards/${boardId}/posts`);
        setState({ kind: 'open', board, posts });
      } else {
        const r = await api<{ board: Board; posts: PostsListing }>(`/api/links/${boardId}`);
        setState({ kind: 'open', board: r.board, posts: r.posts });
      }
    } catch (err) {
      const e = err as Error & { status: number };
      if (e.status === 403) setState({ kind: 'password' });
      else setState({ kind: 'missing' });
    }
  }, [boardId, mode]);

  useEffect(() => {
    void load();
    refreshHealth();
  }, [load, refreshHealth]);

  useEffect(() => {
    if (state.kind !== 'open') return;
    const board = state.board;
    const path = mode === 'board' ? `/api/boards/${board.id}/events` : `/api/links/${boardId}/events`;
    const es = new EventSource(path);
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as Record<string, unknown>;
        if (data.type === 'access_lost') {
          const reason = data.reason as string;
          es.close();
          if (reason === 'password_required') {
            setState((prev) => (prev.kind === 'open' ? { kind: 'password' } : prev));
          } else {
            setState({ kind: 'missing' });
          }
          return;
        }
        void handleLiveEvent(data, board, me, announce, setState, setComments, setServiceNotice);
      } catch {
        void load();
      }
    };
    es.onerror = () => {
      es.close();
      void load();
    };
    return () => es.close();
  }, [state.kind === 'open' ? state.board.id : null, mode, boardId, me?.id, load, announce]);

  useEffect(() => {
    const timer = setInterval(refreshHealth, 8000);
    return () => clearInterval(timer);
  }, [refreshHealth]);

  useEffect(() => {
    if (state.kind !== 'open') return;
    const board = state.board;
    const role = board.role;
    if (health && !health.storage && roleAtLeast(role, 'contributor')) {
      setServiceNotice('File uploads are unavailable right now. Posts without files still work.');
    } else if (health && !health.push && (role === 'moderator' || role === 'owner')) {
      setServiceNotice("Moderator alerts can't be sent right now. Held posts still wait in Approvals.");
    } else {
      setServiceNotice(null);
    }
  }, [health, state.kind === 'open' ? state.board.role : null]);

  useEffect(() => {
    heldRef.current = movingPostId;
  }, [movingPostId]);

  if (state.kind === 'loading') return <p className="empty-line">Loading…</p>;
  if (state.kind === 'missing') return <NotFoundScreen navigate={navigate} me={me} />;
  if (state.kind === 'password') {
    return (
      <PasswordScreen
        alert=""
        onSubmit={(password) => {
          const path = mode === 'board' ? `/api/boards/${boardId}/unlock` : `/api/links/${boardId}/unlock`;
          void api(path, { method: 'POST', body: JSON.stringify({ password }) })
            .then(() => {
              void load();
            })
            .catch(() => {
              setState({ kind: 'password' });
              announceWrongPassword();
            });
        }}
      />
    );
  }

  const board = state.board;
  const posts = state.posts;
  const role = board.role;

  return (
    <div className={board.layout === 'rows' ? 'rows' : 'columns-page'}>
      {mode !== 'embed' && (
        <header className="top">
          <a className="brand" href="/">
            Pinsheet
          </a>
          <h1 className="board-title">{board.title}</h1>
          <button className="btn secondary" name="Present" onClick={() => setDialogOpen('slideshow')}>
            Present
          </button>
          {roleAtLeast(role, 'moderator') && (
            <button className="btn secondary" name="Export CSV" onClick={() => {
              window.location.href = `/api/boards/${board.id}/export.csv`;
            }}>
              Export CSV
            </button>
          )}
          {role === 'owner' && (
            <>
              <button className="btn secondary" name="Board settings" onClick={() => setDialogOpen('settings')}>
                Board settings
              </button>
              <button className="btn secondary" name="Members" onClick={() => setDialogOpen('members')}>
                Members
              </button>
            </>
          )}
          {me ? (
            <button
              className="btn secondary"
              name="Sign out"
              onClick={() => {
                void api('/api/auth/signout', { method: 'POST' }).then(() => {
                  onSignedOut();
                  navigate('/');
                });
              }}
            >
              Sign out
            </button>
          ) : (
            <a className="btn secondary" href="/signin">
              Sign in
            </a>
          )}
        </header>
      )}
      {serviceNotice && (
        <div className="service-notice" role="region" aria-label="Service notice">
          {serviceNotice}
        </div>
      )}
      {mode !== 'embed' && role === 'owner' && (
        <div className="toolbar" role="toolbar" aria-label="Board view">
          <fieldset>
            <legend className="hint">Layout</legend>
            <div className="radio-row" role="radiogroup" aria-label="Layout">
              {(['columns', 'rows'] as const).map((value) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="Layout"
                    checked={board.layout === value}
                    onChange={() => {
                      void api<Board>(`/api/boards/${board.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ layout: value }),
                      }).then(() => void load());
                    }}
                  />
                  {value === 'columns' ? 'Columns' : 'Rows'}
                </label>
              ))}
            </div>
          </fieldset>
          <label>
            <span className="hint">Sort posts</span>
            <select
              className="field"
              name="Sort posts"
              value={board.sort}
              onChange={(e) => {
                void api<Board>(`/api/boards/${board.id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ sort: e.target.value }),
                }).then(() => void load());
              }}
            >
              <option value="by_hand">By hand</option>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="most_liked">Most liked</option>
            </select>
          </label>
          <label>
            <span className="hint">Group posts</span>
            <select
              className="field"
              name="Group posts"
              value={board.group}
              onChange={(e) => {
                void api<Board>(`/api/boards/${board.id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ group: e.target.value }),
                }).then(() => void load());
              }}
            >
              <option value="section">By section</option>
              <option value="author">By author</option>
            </select>
          </label>
        </div>
      )}
      <div aria-live="polite" role="status" aria-label="Board announcements" className="status-line">
        {announcement}
      </div>
      {roleAtLeast(role, 'moderator') && posts.held.length > 0 && (
        <section className="approvals" aria-label="Approvals">
          <h2>Approvals ({posts.held.length})</h2>
          <div className="frames">
            {posts.held.map((post) => (
              <article key={post.id} className="frame" data-post-id={post.id} data-state="awaiting_approval">
                <FrameVisual post={post} />
                <div className="approval-buttons">
                  <button
                    className="btn"
                    name={`Approve ${post.title}`}
                    onClick={() => {
                      void api(`/api/posts/${post.id}/approve`, { method: 'POST' }).then(() => {
                        announce(`Your post ${post.title} was approved.`);
                        void load();
                      });
                    }}
                  >
                    Approve
                  </button>
                  <button
                    className="btn secondary"
                    name={`Reject ${post.title}`}
                    onClick={() => {
                      void api(`/api/posts/${post.id}/reject`, { method: 'POST' }).then(() => {
                        announce(`Your post ${post.title} was not approved.`);
                        void load();
                      });
                    }}
                  >
                    Reject
                  </button>
                </div>
                {post.push === 'pending' && <span className="push-pending">Push pending</span>}
              </article>
            ))}
          </div>
        </section>
      )}
      {me !== null && posts.held.length > 0 && posts.held.every((p) => p.author.id === me.id) && !roleAtLeast(role, 'moderator') && (
        <section className="approvals" aria-label="Waiting for approval">
          <p className="held-note">
            Only you and the people who moderate this board can see these posts until they're approved.
          </p>
          <div className="frames">
            {posts.held.map((post) => (
              <article key={post.id} className="frame" data-post-id={post.id} data-state="awaiting_approval">
                <FrameVisual post={post} />
                <span className="held-tag">Awaiting approval</span>
              </article>
            ))}
          </div>
        </section>
      )}
      <main className={`sheet ${board.layout}`}>
        {posts.sections.map((section) => (
          <SectionRegion
            key={section.id}
            section={section}
            board={board}
            me={me}
            mode={mode}
            loupePostId={loupePostId}
            comments={comments}
            announcement={announcement}
            announce={announce}
            reload={load}
            setState={setState}
            setLoupePostId={setLoupePostId}
            setComments={setComments}
            movingPostId={movingPostId}
            setMovingPostId={setMovingPostId}
            openEdit={(post) => {
              setEditingPost(post);
              setDialogOpen('edit');
            }}
          />
        ))}
      </main>
      {mode !== 'embed' && roleAtLeast(role, 'contributor') && (
        <div className="add-post-bar">
          <button className="btn" name="Add post" onClick={() => setDialogOpen('add')}>
            Add post
          </button>
        </div>
      )}
      {dialogOpen === 'add' && (
        <AddPostDialog
          board={board}
          onClose={() => setDialogOpen(null)}
          onDone={(postId) => {
            setDialogOpen(null);
            void load().then(() => {
              const el = document.querySelector(`[data-post-id="${postId}"]`) as HTMLElement | null;
              el?.focus();
            });
          }}
          announce={announce}
          storageUp={health?.storage ?? true}
          reload={load}
        />
      )}
      {dialogOpen === 'edit' && editingPost && (
        <EditPostDialog
          post={editingPost}
          onClose={() => setDialogOpen(null)}
          onDone={() => {
            setDialogOpen(null);
            void load();
          }}
          announce={announce}
        />
      )}
      {dialogOpen === 'slideshow' && <SlideshowDialog posts={posts} board={board} onClose={() => setDialogOpen(null)} reload={load} />}
      {dialogOpen === 'settings' && (
        <SettingsDialog board={board} onClose={() => setDialogOpen(null)} reload={load} navigate={navigate} announce={announce} />
      )}
      {dialogOpen === 'members' && <MembersDialog board={board} onClose={() => setDialogOpen(null)} reload={load} announce={announce} />}
    </div>
  );
}

function announceWrongPassword(): void {
  const alert = document.querySelector('.password-screen .alert') as HTMLElement | null;
  if (alert) {
    alert.setAttribute('data-shown', 'true');
    alert.textContent = "That password didn't open this board.";
  }
}

async function handleLiveEvent(
  data: Record<string, unknown>,
  board: Board,
  me: SessionUser | null,
  announce: (line: string) => void,
  setState: React.Dispatch<React.SetStateAction<LoadState>>,
  setComments: React.Dispatch<React.SetStateAction<Record<string, CommentItem[]>>>,
  _setServiceNotice: (notice: string | null) => void,
): Promise<void> {
  const type = data.type as string;
  const postId = data.post_id as string | undefined;
  const boardId = board.id;
  if (type === 'post_added' || type === 'post_moved' || type === 'post_deleted' || type === 'post_approved' || type === 'post_rejected' || type === 'reaction' || type === 'comment_added' || type === 'post_changed' || type === 'board_update' || type === 'push_sent' || type === 'role_changed') {
    const posts = await api<PostsListing>(`/api/boards/${boardId}/posts`);
    setState((prev) => (prev.kind === 'open' ? { ...prev, posts } : prev));
    if (type === 'post_added' && data.author_id !== me?.id) {
      const post = posts.sections.flatMap((s) => s.posts).find((p) => p.id === postId);
      if (post) announce(`${post.author.display_name} added ${post.title}.`);
    }
    if (type === 'comment_added' && postId) {
      const list = await api<{ comments: CommentItem[] }>(`/api/posts/${postId}/comments`);
      setComments((prev) => ({ ...prev, [postId]: list.comments }));
    }
  }
}

interface SectionRegionProps {
  section: Section;
  board: Board;
  me: SessionUser | null;
  mode: BoardMode;
  loupePostId: string | null;
  comments: Record<string, CommentItem[]>;
  announcement: string;
  announce: (line: string) => void;
  reload: () => Promise<void>;
  setState: React.Dispatch<React.SetStateAction<LoadState>>;
  setLoupePostId: (id: string | null) => void;
  setComments: React.Dispatch<React.SetStateAction<Record<string, CommentItem[]>>>;
  movingPostId: string | null;
  setMovingPostId: (id: string | null) => void;
  openEdit: (post: Post) => void;
}

function SectionRegion(props: SectionRegionProps): JSX.Element {
  const { section, board, me, loupePostId, comments, announce, reload, setState, setComments, movingPostId } = props;
  return (
    <section
      className="section-region"
      aria-label={section.title}
      data-section-id={section.id}
      data-count={section.count}
    >
      <div className="section-heading">
        <h2>{section.title}</h2>
        <span className="hint">{section.count}</span>
      </div>
      <div className="frames">
        {section.posts.map((post, index) => (
          <PostFrame
            key={post.id}
            post={post}
            section={section}
            position={index + 1}
            board={board}
            me={me}
            loupeOpen={loupePostId === post.id}
            comments={comments[post.id] ?? []}
            announce={announce}
            reload={reload}
            setState={setState}
            setLoupePostId={props.setLoupePostId}
            setComments={setComments}
            moving={movingPostId === post.id}
            setMovingPostId={props.setMovingPostId}
            openEdit={props.openEdit}
          />
        ))}
        {section.posts.length === 0 && <p className="empty-line">Nothing on this board yet.</p>}
      </div>
    </section>
  );
}

interface PostFrameProps {
  post: Post;
  section: Section;
  position: number;
  board: Board;
  me: SessionUser | null;
  loupeOpen: boolean;
  comments: CommentItem[];
  announce: (line: string) => void;
  reload: () => Promise<void>;
  setState: React.Dispatch<React.SetStateAction<LoadState>>;
  setLoupePostId: (id: string | null) => void;
  setComments: React.Dispatch<React.SetStateAction<Record<string, CommentItem[]>>>;
  moving: boolean;
  setMovingPostId: (id: string | null) => void;
  openEdit: (post: Post) => void;
}

function PostFrame(props: PostFrameProps): JSX.Element {
  const { post, section, position, board, me, loupeOpen, comments, announce, reload, setState, setLoupePostId, setComments, openEdit, setMovingPostId } = props;
  const frameRef = useRef<HTMLElement | null>(null);
  const [commentText, setCommentText] = useState('');
  const [commentError, setCommentError] = useState('');
  const canMove =
    (board.role === 'owner' || board.role === 'moderator' || (board.role === 'contributor' && post.author.id === me?.id)) &&
    board.group !== 'author';

  const openLoupe = () => {
    setLoupePostId(post.id);
    void api<{ comments: CommentItem[] }>(`/api/posts/${post.id}/comments`)
      .then((r) => setComments((prev) => ({ ...prev, [post.id]: r.comments })))
      .catch(() => undefined);
    setTimeout(() => {
      const heading = frameRef.current?.querySelector('h2') as HTMLElement | null;
      heading?.focus();
    }, 40);
  };

  const closeLoupe = () => {
    setLoupePostId(null);
    frameRef.current?.focus();
  };

  const sendComment = async () => {
    const text = commentText.trim();
    if (text.length < 1) {
      setCommentError('Write a comment first.');
      return;
    }
    if (text.length > 500) {
      setCommentError('Comments can be at most 500 characters.');
      return;
    }
    const r = await api<CommentItem>(`/api/posts/${post.id}/comments`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
    setComments((prev) => ({ ...prev, [post.id]: [...(prev[post.id] ?? []), r] }));
    setCommentText('');
    setCommentError('');
    void reload();
  };

  const toggleLike = async () => {
    if (post.liked) {
      await api(`/api/posts/${post.id}/like`, { method: 'DELETE' });
    } else {
      await api(`/api/posts/${post.id}/like`, { method: 'PUT' });
    }
    void reload();
  };

  const vote = async (value: number) => {
    if (post.my_vote === value) {
      await api(`/api/posts/${post.id}/vote`, { method: 'DELETE' });
    } else {
      await api(`/api/posts/${post.id}/vote`, { method: 'PUT', body: JSON.stringify({ value }) });
    }
    void reload();
  };

  const deletePost = async () => {
    await api(`/api/posts/${post.id}`, { method: 'DELETE' });
    announce(`Deleted ${post.title}.`);
    void reload();
  };

  const moveBy = (direction: 'up' | 'down' | 'prevSection' | 'nextSection' | 'drop') => {
    const sections = board.sections;
    void (async () => {
      const listing = await api<PostsListing>(`/api/boards/${board.id}/posts`);
      const sectionIds = board.group === 'section' ? sections.map((s) => s.id) : listing.sections.map((s) => s.id);
      const currentSectionIndex = sectionIds.indexOf(post.section_id);
      const sameSection = direction === 'up' || direction === 'down' || direction === 'drop';
      const targetSectionId = direction === 'prevSection'
          ? sectionIds[Math.max(0, currentSectionIndex - 1)]
          : direction === 'nextSection'
            ? sectionIds[Math.min(sectionIds.length - 1, currentSectionIndex + 1)]
            : post.section_id;
      const targetPosts = listing.sections.find((s) => s.id === targetSectionId)?.posts ?? [];
      let targetPosition: number;
      if (direction === 'up') {
        targetPosition = Math.max(1, position - 1);
      } else if (direction === 'down') {
        targetPosition = Math.min(targetPosts.length + (targetSectionId === post.section_id ? 0 : 1), position + 1);
      } else if (direction === 'prevSection' || direction === 'nextSection') {
        targetPosition = Math.min(position, targetPosts.length + 1);
      } else {
        targetPosition = position;
      }
      void sameSection;
      try {
        await api(`/api/posts/${post.id}/move`, {
          method: 'PATCH',
          body: JSON.stringify({ section_id: targetSectionId, position: targetPosition, version: post.version }),
        });
        const sectionTitle = listing.sections.find((s) => s.id === targetSectionId)?.title ?? section.title;
        const count = targetPosts.length + (targetSectionId === post.section_id ? 0 : 1);
        announce(`Dropped ${post.title}: ${sectionTitle}, position ${targetPosition} of ${Math.max(count, targetPosition)}.`);
        await reload();
        setState((prev) => prev);
      } catch (err) {
        const e = err as Error & { status: number; body: { errors?: Record<string, string> } };
        if (e.body?.errors?.position) {
          announce(e.body.errors.position);
        }
      }
    })();
  };

  return (
    <article
      ref={frameRef}
      className="frame"
      tabIndex={0}
      aria-label={post.title}
      data-post-id={post.id}
      data-section-id={post.section_id}
      data-position={post.state === 'awaiting_approval' ? undefined : position}
      data-author-id={post.author.id}
      data-state={post.state}
      data-likes={post.likes}
      data-score={post.score}
      data-comments={post.comments}
      data-loupe={loupeOpen ? 'open' : 'closed'}
      data-moving={props.moving ? 'true' : undefined}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          openLoupe();
        }
        if (e.key === ' ' && canMove) {
          e.preventDefault();
          if (loupeOpen) {
            closeLoupe();
            return;
          }
          if (props.moving) {
            setMovingPostId(null);
            moveBy('drop');
          } else {
            const line = `Picked up ${post.title}. ${section.title}, position ${position} of ${section.count}.`;
            announce(line);
            setMovingPostId(post.id);
          }
        }
        if (e.key === 'Escape' && loupeOpen) {
          e.preventDefault();
          closeLoupe();
        }
        if (props.moving) {
          const layout = board.layout;
          if (e.key === 'ArrowUp' && layout === 'columns') {
            e.preventDefault();
            moveBy('up');
          }
          if (e.key === 'ArrowDown' && layout === 'columns') {
            e.preventDefault();
            moveBy('down');
          }
          if (e.key === 'ArrowLeft') {
            e.preventDefault();
            moveBy(layout === 'columns' ? 'prevSection' : 'up');
          }
          if (e.key === 'ArrowRight') {
            e.preventDefault();
            moveBy(layout === 'columns' ? 'nextSection' : 'down');
          }
        }
      }}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest('button') || target.closest('input') || target.closest('textarea') || target.closest('a')) return;
        if (loupeOpen) return;
        openLoupe();
      }}
    >
      {loupeOpen ? (
        <div className="loupe-body">
          <h2 tabIndex={-1}>{post.title}</h2>
          <p className="hint">{post.author.display_name}</p>
          <p>{post.body}</p>
          {post.attachment && (
            <div className="loupe-attachment">
              {post.attachment.content_type.startsWith('image/') ? (
                <img src={post.attachment.url} alt={post.attachment.file_name} />
              ) : (
                <a href={post.attachment.url}>{post.attachment.file_name}</a>
              )}
            </div>
          )}
          <p className="count-line">
            <HeartIcon /> {post.likes} <UpIcon /> {post.score} <BubbleIcon /> {post.comments}
          </p>
          {(roleCanReact(board, me) || true) && (
            <div className="loupe-actions">
              {roleCanReact(board, me) && (
                <>
                  <button className="reaction-btn" name={`Like ${post.title}`} aria-pressed={post.liked} onClick={() => void toggleLike()}>
                    <HeartIcon /> {post.likes}
                  </button>
                  <button className="reaction-btn" name={`Vote up ${post.title}`} aria-pressed={post.my_vote === 1} onClick={() => void vote(1)}>
                    <UpIcon /> {post.score}
                  </button>
                  <button className="reaction-btn" name={`Vote down ${post.title}`} aria-pressed={post.my_vote === -1} onClick={() => void vote(-1)}>
                    <DownIcon />
                  </button>
                </>
              )}
              {(board.role === 'owner' || (board.role === 'contributor' && post.author.id === me?.id)) && (
                <button className="btn secondary" name={`Edit ${post.title}`} onClick={() => openEdit(post)}>
                  Edit
                </button>
              )}
              {(board.role === 'owner' || board.role === 'moderator' || (board.role === 'contributor' && post.author.id === me?.id)) && (
                <button className="btn secondary" name={`Delete ${post.title}`} onClick={() => void deletePost()}>
                  Delete
                </button>
              )}
              <button className="btn" name="Close" onClick={closeLoupe}>
                Close
              </button>
            </div>
          )}
          <ul className="comments-list" aria-label="Comments">
            {comments.map((c) => (
              <li key={c.id}>
                <span className="who">{c.author.display_name}</span>
                {c.text}
              </li>
            ))}
          </ul>
          {roleAtLeast(board.role, 'contributor') && (
            <div className="comment-form">
              <label className="visually-hidden" htmlFor={`comment-${post.id}`}>
                Add a comment
              </label>
              <textarea
                id={`comment-${post.id}`}
                className="field"
                name="Add a comment"
                value={commentText}
                placeholder="Add a comment"
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void sendComment();
                  }
                }}
              />
              <button className="btn" name="Send comment" onClick={() => void sendComment()}>
                Send comment
              </button>
            </div>
          )}
          <p className="field-msg">{commentError}</p>
          <span className="hint">{`${commentText.length}/500`}</span>
        </div>
      ) : (
        <>
          <FrameVisual post={post} />
          {!post.attachment && (
            <span className="frame-counts">
              {post.likes} {post.score} {post.comments}
            </span>
          )}
        </>
      )}
    </article>
  );
}

function roleCanReact(board: Board, me: SessionUser | null): boolean {
  return roleAtLeast(board.role, 'viewer') && (me !== null || board.privacy === 'public');
}

interface AddPostDialogProps {
  board: Board;
  onClose: () => void;
  onDone: (postId: string) => void;
  announce: (line: string) => void;
  storageUp: boolean;
  reload: () => Promise<void>;
}

function AddPostDialog({ board, onClose, onDone, announce, storageUp }: AddPostDialogProps): JSX.Element {
  const [sectionId, setSectionId] = useState(board.sections[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alertText, setAlertText] = useState('');
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
    dialogRef.current?.querySelector('input')?.focus();
  }, []);

  const submit = async () => {
    setBusy(true);
    setErrors({});
    setAlertText('');
    if (file) {
      announce(`Uploading ${file.name}…`);
    }
    const form = new FormData();
    form.append('section_id', sectionId);
    form.append('title', title);
    form.append('body', body);
    if (file) form.append('file', file);
    try {
      const post = await api<Post>(`/api/boards/${board.id}/posts`, { method: 'POST', body: form });
      if (post.state === 'awaiting_approval') {
        announce(`Sent ${post.title} for approval.`);
      } else {
        announce(`Posted ${post.title}.`);
      }
      onDone(post.id);
    } catch (err) {
      const e = err as Error & { status: number; body: { errors?: Record<string, string>; error?: string } };
      if (e.status === 503) {
        setAlertText('Uploads are unavailable right now. Your post was not saved.');
      } else if (e.status === 413) {
        setAlertText(`${file?.name ?? 'file'} is over the ${200000} byte limit.`);
      } else if (e.status === 415) {
        setAlertText(`${file?.name ?? 'file'} isn't a PNG, JPEG, GIF, WebP, PDF or plain-text file.`);
      } else if (e.body?.errors) {
        setErrors(e.body.errors);
      }
      setBusy(false);
    }
  };

  return (
    <dialog className={window.innerWidth < 768 ? 'bottom-sheet' : 'centered-dialog'} ref={dialogRef} onClose={onClose}>
      <div className="panel">
        <h2>Add post</h2>
        <label>
          <span className="hint">Section</span>
          <select className="field" name="Section" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
            {board.sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="hint">Title</span>
          <input
            className="field"
            name="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <p className="field-msg">{errors.title ?? ''}</p>
          <span className="counter">{title.length}/80</span>
        </label>
        <label>
          <span className="hint">Text</span>
          <textarea
            className="field"
            name="Text"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <p className="field-msg">{errors.body ?? ''}</p>
          <span className="counter">{body.length.toLocaleString('en-US')}/2,000</span>
        </label>
        <label>
          <span className="hint">File</span>
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void submit();
              }
            }}
          />
        </label>
        <button className="btn secondary" name="Attach a file" onClick={() => {
          const input = dialogRef.current?.querySelector('input[type="file"]') as HTMLInputElement | null;
          input?.click();
        }}>
          Attach a file
        </button>
        {!storageUp && <p className="field-msg">File uploads are unavailable right now. Posts without files still work.</p>}
        <div className="row">
          <button className="btn" name="Post" onClick={() => void submit()} disabled={busy}>
            {busy ? 'Posting…' : 'Post'}
          </button>
          <button className="btn secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
        <div className="alert" data-shown={alertText ? 'true' : 'false'} role="alert">
          {alertText}
        </div>
      </div>
    </dialog>
  );
}

interface EditPostDialogProps {
  post: Post;
  onClose: () => void;
  onDone: () => void;
  announce: (line: string) => void;
}

function EditPostDialog({ post, onClose, onDone, announce }: EditPostDialogProps): JSX.Element {
  const [title, setTitle] = useState(post.title);
  const [body, setBody] = useState(post.body);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alertText, setAlertText] = useState('');
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
    dialogRef.current?.querySelector('input')?.focus();
  }, []);

  const submit = async () => {
    setBusy(true);
    setErrors({});
    setAlertText('');
    try {
      await api(`/api/posts/${post.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title, body, version: post.version }),
      });
      announce(`Posted ${title}.`);
      onDone();
    } catch (err) {
      const e = err as Error & { status: number; body: { errors?: Record<string, string> } };
      if (e.status === 409) {
        setAlertText('Someone changed this post first. Your edit was not saved.');
      } else if (e.body?.errors) {
        setErrors(e.body.errors);
      }
      setBusy(false);
    }
  };

  return (
    <dialog className="centered-dialog" ref={dialogRef} onClose={onClose}>
      <div className="panel">
        <h2>Edit post</h2>
        <label>
          <span className="hint">Title</span>
          <input className="field" name="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <p className="field-msg">{errors.title ?? ''}</p>
          <span className="counter">{title.length}/80</span>
        </label>
        <label>
          <span className="hint">Text</span>
          <textarea className="field" name="Text" value={body} onChange={(e) => setBody(e.target.value)} />
          <p className="field-msg">{errors.body ?? ''}</p>
          <span className="counter">{body.length.toLocaleString('en-US')}/2,000</span>
        </label>
        <div className="row">
          <button className="btn" name="Save post" onClick={() => void submit()} disabled={busy}>
            Save post
          </button>
          <button className="btn secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
        <div className="alert" data-shown={alertText ? 'true' : 'false'} role="alert">
          {alertText}
        </div>
      </div>
    </dialog>
  );
}

interface SlideshowDialogProps {
  posts: PostsListing;
  board: Board;
  onClose: () => void;
  reload: () => Promise<void>;
}

function SlideshowDialog({ posts, board, onClose, reload }: SlideshowDialogProps): JSX.Element {
  const slides = posts.sections.flatMap((s) => s.posts);
  const [index, setIndex] = useState(0);
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => void reload(), 2000);
    return () => clearInterval(timer);
  }, [reload]);

  const go = (delta: number) => {
    setIndex((i) => {
      const next = i + delta;
      if (next < 0) return i;
      if (next >= slides.length) return i;
      return next;
    });
  };

  const current = slides[index];

  return (
    <dialog className="sheet-dialog" ref={dialogRef} onClose={onClose} onKeyDown={(e) => {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
        e.preventDefault();
        go(1);
      }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        go(-1);
      }
      if (e.key === 'Home') {
        e.preventDefault();
        setIndex(0);
      }
      if (e.key === 'End') {
        e.preventDefault();
        setIndex(Math.max(0, slides.length - 1));
      }
      if (e.key === 'Escape') {
        onClose();
      }
    }}>
      <div className="slideshow-panel">
        <span className="visually-hidden" role="status" aria-label="Slide position">
          {slides.length === 0 ? 'No posts to show yet.' : `Post ${index + 1} of ${slides.length}`}
        </span>
        {current ? (
          <div className="slide">
            <h2>{current.title}</h2>
            <div className="slide-media">
              {current.attachment && current.attachment.content_type.startsWith('image/') ? (
                <img src={current.attachment.url} alt={current.title} />
              ) : (
                <FrameVisual post={current} />
              )}
            </div>
            <p>{current.body}</p>
          </div>
        ) : (
          <p>No posts to show yet.</p>
        )}
        <div className="slide-controls">
          <button className="btn secondary" name="Previous post" onClick={() => go(-1)}>
            Previous post
          </button>
          <span aria-live="polite" className="hint">
            {slides.length === 0 ? 'No posts to show yet.' : `Post ${index + 1} of ${slides.length}`}
          </span>
          <button className="btn secondary" name="Next post" onClick={() => go(1)}>
            Next post
          </button>
        </div>
      </div>
    </dialog>
  );
}

interface SettingsDialogProps {
  board: Board;
  onClose: () => void;
  reload: () => Promise<void>;
  navigate: (path: string) => void;
  announce: (line: string) => void;
}

function SettingsDialog({ board, onClose, reload, navigate }: SettingsDialogProps): JSX.Element {
  const [privacy, setPrivacy] = useState(board.privacy);
  const [password, setPassword] = useState('');
  const [linkAccess, setLinkAccess] = useState(board.link_access);
  const [approval, setApproval] = useState(board.approval);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const save = async () => {
    const patch: Record<string, unknown> = { privacy, link_access: linkAccess, approval };
    if (privacy === 'password' && password) patch.password = password;
    try {
      await api(`/api/boards/${board.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      await reload();
      onClose();
    } catch (err) {
      const e = err as Error & { body: { errors?: Record<string, string> } };
      setError(e.body?.errors?.password ?? 'Passwords are 8 to 64 characters.');
    }
  };

  const rotate = async () => {
    await api(`/api/boards/${board.id}/rotate-link`, { method: 'POST' });
    await reload();
  };

  const deleteBoard = async () => {
    await api(`/api/boards/${board.id}`, { method: 'DELETE' });
    navigate('/');
  };

  return (
    <dialog className="centered-dialog" ref={dialogRef} onClose={onClose}>
      <div className="panel">
        <h2>Board settings</h2>
        <div role="radiogroup" aria-label="Privacy">
          {(['private', 'password', 'public'] as const).map((value) => (
            <label key={value}>
              <input type="radio" name="Privacy" checked={privacy === value} onChange={() => setPrivacy(value)} />
              {value === 'private' ? 'Private' : value === 'password' ? 'Password' : 'Public'}
            </label>
          ))}
        </div>
        {privacy === 'password' && (
          <label>
            <span className="hint">Board password</span>
            <input className="field" name="Board password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <p className="field-msg">{error}</p>
          </label>
        )}
        <div role="radiogroup" aria-label="Link access">
          {(['off', 'view', 'contribute'] as const).map((value) => (
            <label key={value}>
              <input type="radio" name="Link access" checked={linkAccess === value} onChange={() => setLinkAccess(value)} />
              {value === 'off' ? 'Off' : value === 'view' ? 'Can view' : 'Can contribute'}
            </label>
          ))}
        </div>
        {linkAccess !== 'off' && board.share_path && <p className="hint">{board.share_path}</p>}
        <button className="btn secondary" name="Rotate link" onClick={() => void rotate()}>
          Rotate link
        </button>
        <label>
          <input type="checkbox" name="Require approval" checked={approval} onChange={(e) => setApproval(e.target.checked)} />
          Require approval
        </label>
        <div className="row">
          <button className="btn" name="Save settings" onClick={() => void save()}>
            Save settings
          </button>
          <button className="btn secondary" name="Delete board" onClick={() => setConfirmDelete(true)}>
            Delete board
          </button>
        </div>
        {confirmDelete && (
          <div role="alertdialog" aria-label="Delete this board?">
            <p>{`Every post, comment and file on ${board.title} will be removed.`}</p>
            <div className="row">
              <button className="btn" name="Delete for good" onClick={() => void deleteBoard()}>
                Delete for good
              </button>
              <button className="btn secondary" name="Keep board" onClick={() => setConfirmDelete(false)}>
                Keep board
              </button>
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}

interface MembersDialogProps {
  board: Board;
  onClose: () => void;
  reload: () => Promise<void>;
  announce: (line: string) => void;
}

interface MemberRowData {
  user_id: string;
  display_name: string;
  email: string;
  role: string;
}

function MembersDialog({ board, onClose, reload, announce }: MembersDialogProps): JSX.Element {
  const [members, setMembers] = useState<MemberRowData[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('contributor');
  const [inviteStatus, setInviteStatus] = useState('');
  const [inviteError, setInviteError] = useState('');
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
    api<{ members: MemberRowData[] }>(`/api/boards/${board.id}/members`)
      .then((r) => setMembers(r.members))
      .catch(() => undefined);
  }, [board.id]);

  const changeRole = async (userId: string, role: string) => {
    await api(`/api/boards/${board.id}/members/${userId}`, { method: 'PATCH', body: JSON.stringify({ role }) });
    await reload();
  };

  const removeMember = async (userId: string) => {
    await api(`/api/boards/${board.id}/members/${userId}`, { method: 'DELETE' });
    setMembers((prev) => prev.filter((m) => m.user_id !== userId));
    await reload();
  };

  const sendInvite = async () => {
    setInviteStatus('');
    setInviteError('');
    if (!inviteEmail.trim()) {
      setInviteError('Enter an email address.');
      return;
    }
    try {
      await api(`/api/boards/${board.id}/invites`, {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      setInviteStatus(`Invite sent to ${inviteEmail.trim()}.`);
      setInviteEmail('');
    } catch (err) {
      const e = err as Error & { status: number; body: { errors?: Record<string, string>; error?: string } };
      if (e.status === 503) {
        setInviteError("Invites can't be sent right now. Try again in a few minutes.");
      } else if (e.body?.errors?.email) {
        setInviteError(e.body.errors.email);
      }
    }
  };

  return (
    <dialog className="centered-dialog" ref={dialogRef} onClose={onClose}>
      <div className="panel">
        <h2>Members</h2>
        <ul className="members-list">
          {members.map((m) => (
            <li className="member-row" key={m.user_id}>
              <span className="who">
                {m.display_name} <span className="hint">{m.email}</span>
              </span>
              {m.role === 'owner' ? (
                <span>Owner</span>
              ) : (
                <>
                  <select
                    className="field"
                    style={{ width: 'auto' }}
                    name={`Role for ${m.display_name}`}
                    value={m.role}
                    onChange={(e) => void changeRole(m.user_id, e.target.value)}
                  >
                    <option value="viewer">Viewer</option>
                    <option value="contributor">Contributor</option>
                    <option value="moderator">Moderator</option>
                  </select>
                  <button className="btn secondary" name={`Remove ${m.display_name}`} onClick={() => void removeMember(m.user_id)}>
                    Remove
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
        <label>
          <span className="hint">Invite by email</span>
          <input
            className="field"
            name="Invite by email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void sendInvite();
              }
            }}
          />
        </label>
        <label>
          <span className="hint">Invite role</span>
          <select className="field" name="Invite role" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
            <option value="viewer">Viewer</option>
            <option value="contributor">Contributor</option>
            <option value="moderator">Moderator</option>
          </select>
        </label>
        <button className="btn" name="Send invite" onClick={() => void sendInvite()}>
          Send invite
        </button>
        <span role="status" aria-label="Invite status" className="hint">
          {inviteStatus}
        </span>
        <div className="alert" data-shown={inviteError ? 'true' : 'false'} role="alert">
          {inviteError}
        </div>
      </div>
    </dialog>
  );
}
