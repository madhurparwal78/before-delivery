import { useEffect, useState, type FormEvent } from "react";
import { ApiFailure, call, get } from "./api";
import { Dialog, useDialogClose } from "./Dialog";
import { StaticFrame } from "./Frame";
import { Link, navigate } from "./router";
import { boardFieldErrors, LIMITS } from "../shared/rules";
import type { Account, Board, BoardSummary, FieldErrors, Listing, Post } from "../shared/types";

interface Props {
  me: Account;
  onSignedOut: () => void;
}

const FIRST_FRAMES = 8;

export function Dashboard({ me, onSignedOut }: Props) {
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [frames, setFrames] = useState<Record<string, Post[]>>({});
  const [making, setMaking] = useState(false);

  useEffect(() => {
    let current = true;
    void get<{ boards: BoardSummary[] }>("/api/boards").then(async (found) => {
      if (!current) return;
      setBoards(found.boards);
      const listings = await Promise.all(found.boards.map((board) => get<Listing>(`/api/boards/${board.id}/posts`)));
      if (current) setFrames(Object.fromEntries(found.boards.map((board, index) => [board.id, (listings[index]?.sections ?? []).flatMap((section) => section.posts).slice(0, FIRST_FRAMES)])));
    });
    return () => {
      current = false;
    };
  }, []);

  const signOut = async (): Promise<void> => {
    await call("POST", "/api/auth/signout");
    onSignedOut();
    navigate("/");
  };
  const waiting = (boards ?? []).filter((board) => board.held > 0);

  return (
    <div className="screen">
      <header className="bar">
        <Link href="/" className="brand">
          Pinsheet
        </Link>
        <nav className="controls" aria-label="Account">
          <button type="button" className="quiet" onClick={() => void signOut()}>
            Sign out
          </button>
        </nav>
      </header>
      <section className="band-text">
        <div>
          <p className="title">{me.display_name}</p>
          <p className="small muted">{boards ? `${boards.length} ${boards.length === 1 ? "board" : "boards"}` : "\u00a0"}</p>
          <button type="button" onClick={() => setMaking(true)}>
            Make a board
          </button>
        </div>
        <div>
          <h1>Your boards</h1>
          <ul aria-label="Your boards" className="board-list">
            {(boards ?? []).map((board) => (
              <li key={board.id}>
                <Link href={`/b/${board.id}`}>{board.title}</Link>
              </li>
            ))}
          </ul>
        </div>
        {waiting.length > 0 && (
          <div>
            <h2>Waiting on you</h2>
            <ul aria-label="Waiting on you" className="board-list">
              {waiting.map((board) => (
                <li key={board.id}>
                  <Link href={`/b/${board.id}`}>{`${board.title}: ${board.held} waiting`}</Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
      <div className="sheet">
        {(boards ?? []).map((board) => (
          <section className="run-section" key={board.id} aria-label={`${board.title} frames`}>
            <h2 className="run-title">
              <Link href={`/b/${board.id}`}>{board.title}</Link>
            </h2>
            <div className="run">
              {(frames[board.id] ?? []).map((post) => (
                <StaticFrame key={post.id} post={post} />
              ))}
            </div>
          </section>
        ))}
      </div>
      {making && <MakeBoard onClose={() => setMaking(false)} />}
    </div>
  );
}

function MakeBoard({ onClose }: { onClose: () => void }) {
  return (
    <Dialog label="Make a board" onClose={onClose}>
      <MakeBoardForm />
    </Dialog>
  );
}

function MakeBoardForm() {
  const close = useDialogClose();
  const [title, setTitle] = useState("");
  const [sections, setSections] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const names = sections.split(",").map((name) => name.trim()).filter(Boolean);
    const found = boardFieldErrors(title, names);
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      const board = await call<Board>("POST", "/api/boards", { title, sections: names });
      navigate(`/b/${board.id}`);
    } catch (error) {
      if (!(error instanceof ApiFailure) || error.status !== 422) throw error;
      setErrors(error.body.errors ?? {});
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form" onSubmit={(event) => void submit(event)} noValidate>
      <h2 className="form-heading">Make a board</h2>
      <div className="field">
        <label htmlFor="board-title">Board title</label>
        <input id="board-title" data-autofocus value={title} onChange={(event) => setTitle(event.target.value)} autoComplete="off" maxLength={LIMITS.boardTitle * 2} />
        {errors["title"] && <p className="field-error">{errors["title"]}</p>}
      </div>
      <div className="field">
        <label htmlFor="board-sections">Sections</label>
        <input id="board-sections" value={sections} onChange={(event) => setSections(event.target.value)} autoComplete="off" aria-describedby="sections-hint" />
        <p id="sections-hint" className="small muted">
          Comma-separated, for example Ideas, Booked, Done
        </p>
        {errors["sections"] && <p className="field-error">{errors["sections"]}</p>}
      </div>
      <div className="form-actions">
        <button type="button" className="quiet" onClick={close}>
          Cancel
        </button>
        <button type="submit" aria-busy={busy}>
          {busy ? "Creating…" : "Create board"}
        </button>
      </div>
    </form>
  );
}
