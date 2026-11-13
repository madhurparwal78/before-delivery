import { useEffect, useState } from 'react';
import { api, type SessionUser, type Post, type Section } from './api.js';
import { FrameVisual } from './icons.js';
import type { JSX } from 'react';

interface DashboardProps {
  me: SessionUser;
  navigate: (path: string) => void;
  onSignedOut: () => void;
}

interface BoardSummary {
  id: string;
  title: string;
  role: string;
  count: number;
  held: number;
}

export function Dashboard({ me, navigate, onSignedOut }: DashboardProps): JSX.Element {
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [makeOpen, setMakeOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [sections, setSections] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [previews, setPreviews] = useState<Record<string, Post[]>>({});

  useEffect(() => {
    api<{ boards: BoardSummary[] }>('/api/boards')
      .then((r) => {
        setBoards(r.boards);
        for (const b of r.boards) {
          api<{ sections: Section[] }>(`/api/boards/${b.id}/posts`)
            .then((listing) => {
              const first = listing.sections.flatMap((s) => s.posts).slice(0, 8);
              setPreviews((prev) => ({ ...prev, [b.id]: first }));
            })
            .catch(() => undefined);
        }
      })
      .catch(() => setBoards([]));
  }, []);

  const waiting = (boards ?? []).filter((b) => b.held > 0);

  const createBoard = async () => {
    setBusy(true);
    setErrors({});
    const sectionList = sections
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    try {
      const board = await api<{ id: string }>('/api/boards', {
        method: 'POST',
        body: JSON.stringify({ title, sections: sectionList }),
      });
      setBusy(false);
      setMakeOpen(false);
      navigate(`/b/${board.id}`);
    } catch (err) {
      const e = err as Error & { body: { errors?: Record<string, string> } };
      setErrors(e.body?.errors ?? {});
      setBusy(false);
    }
  };

  return (
    <>
      <header className="top">
        <a className="brand" href="/">Pinsheet</a>
        <span className="hint">{me.display_name}</span>
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
      </header>
      <section className="dashboard-band">
        <p>{me.display_name}</p>
        <p className="hint">
          {boards?.length === 1 ? '1 board' : `${boards?.length ?? 0} boards`}
        </p>
        <h2>Your boards</h2>
        <ul style={{ listStyle: 'none' }}>
          {(boards ?? []).map((b) => (
            <li key={b.id}>
              <a href={`/b/${b.id}`}>{b.title}</a>
            </li>
          ))}
        </ul>
        {waiting.length > 0 && (
          <>
            <h2>Waiting on you</h2>
            <ul style={{ listStyle: 'none' }}>
              {waiting.map((b) => (
                <li key={b.id}>
                  {b.title} — {b.held}
                </li>
              ))}
            </ul>
          </>
        )}
        <button className="btn" name="Make a board" onClick={() => setMakeOpen(true)}>
          Make a board
        </button>
      </section>
      <section className="sheet">
        {(boards ?? []).map((b) => (
          <div className="board-run" key={b.id}>
            <a className="run-title" href={`/b/${b.id}`}>
              {b.title}
            </a>
            <div className="frames">
              {(previews[b.id] ?? []).map((post) => (
                <article key={post.id} className="frame" aria-label={post.title}>
                  <FrameVisual post={post} />
                </article>
              ))}
            </div>
          </div>
        ))}
      </section>
      {makeOpen && (
        <dialog className="centered-dialog" open>
          <div className="panel">
            <h2>Make a board</h2>
            <label>
              <span className="hint">Board title</span>
              <input className="field" name="Board title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
              <p className="field-msg">{errors.title ?? ''}</p>
            </label>
            <label>
              <span className="hint">Sections</span>
              <input className="field" name="Sections" value={sections} onChange={(e) => setSections(e.target.value)} />
              <p className="hint">Comma-separated, for example Ideas, Booked, Done</p>
              <p className="field-msg">{errors.sections ?? ''}</p>
            </label>
            <div className="row">
              <button className="btn" name="Create board" onClick={() => void createBoard()} disabled={busy}>
                Create board
              </button>
              <button className="btn secondary" onClick={() => setMakeOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </dialog>
      )}
    </>
  );
}
