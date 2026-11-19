import { useCallback, useEffect, useState } from "react";
import { counted } from "../../shared/relativeTime";
import type { BoardCard, Pin, Profile as ProfileData, SearchResult } from "../../shared/types";
import { EmptyState } from "../components/EmptyState";
import { Grid } from "../components/Grid";
import { usePinActions } from "../components/usePinActions";
import { CreateBoardDialog } from "../dialogs/CreateBoardDialog";
import { api, ApiFailure, GENERIC_ERROR } from "../lib/api";
import { showAlert } from "../lib/feedback";
import { useLive } from "../lib/hooks";
import { watch } from "../lib/live";
import { navigate, params, useLocation } from "../lib/router";
import { useMe } from "../session";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Link } from "../ui/Link";
import { EmptyPrint } from "../ui/Prints";
import { NotFound } from "./NotFound";

function BoardTile({ board }: { board: BoardCard }) {
  return (
    <li className="board-tile">
      <Link to={`/b/${board.id}`} className="board-tile-link" aria-label={`${board.name}, ${counted(board.pin_count, "pin", "pins")}`}>
        <span className="board-cover">
          {board.cover ? <img src={board.cover.url} alt="" draggable={false} /> : <EmptyPrint seed={`cover-${board.id}`} />}
        </span>
      </Link>
      <div className="board-tile-text">
        <Link to={`/b/${board.id}`} className="board-tile-name" tabIndex={-1} aria-hidden="true">{board.name}</Link>
        <p className="meta">{counted(board.pin_count, "pin", "pins")}</p>
        {board.visibility === "secret" ? <p className="meta">Secret</p> : null}
        {board.cover ? null : <p className="meta">No pins yet</p>}
      </div>
    </li>
  );
}

export function Boards() {
  const [boards, setBoards] = useState<BoardCard[] | null>(null);
  const [creating, setCreating] = useState(false);
  const load = useCallback(async (): Promise<void> => {
    setBoards((await api.get<{ boards: BoardCard[] }>("/api/boards/mine?all=1")).boards);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="page">
      <header className="page-head">
        <h1 className="page-title">Boards</h1>
        <Button onClick={() => setCreating(true)}>Create board</Button>
      </header>
      {boards !== null && boards.length === 0 ? <EmptyState sentence="No boards yet" seed="boards" /> : null}
      <ul className="board-tiles">
        {(boards ?? []).map((board) => (
          <BoardTile key={board.id} board={board} />
        ))}
      </ul>
      {creating ? <CreateBoardDialog onClose={() => setCreating(false)} onCreated={() => void load()} /> : null}
    </div>
  );
}

type SortKey = "last_saved" | "az" | "newest";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "last_saved", label: "Last saved to" },
  { key: "az", label: "A to Z" },
  { key: "newest", label: "Newest" },
];

export function ProfilePage({ handle }: { handle: string }) {
  const me = useMe();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [missing, setMissing] = useState(false);
  const [sort, setSort] = useState<SortKey>("last_saved");
  const [tab, setTab] = useState<"boards" | "pins">("boards");
  const [pins, setPins] = useState<Pin[] | null>(null);
  const [busy, setBusy] = useState(false);
  const actions = usePinActions();

  useEffect(() => {
    let current = true;
    setMissing(false);
    void api
      .get<ProfileData>(`/api/users/${encodeURIComponent(handle)}?sort=${sort}`)
      .then((loaded) => current && setProfile(loaded))
      .catch((failure: unknown) => {
        if (failure instanceof ApiFailure && failure.status === 404 && current) setMissing(true);
      });
    return () => {
      current = false;
    };
  }, [handle, sort]);

  useEffect(() => {
    setPins(null);
    if (tab !== "pins") return;
    void api.get<{ pins: Pin[] }>(`/api/users/${encodeURIComponent(handle)}/pins`).then((loaded) => setPins(loaded.pins));
  }, [tab, handle]);

  const userId = profile?.user.id;
  useEffect(() => (userId === undefined ? undefined : watch({ user: userId })), [userId]);
  useLive((message) => {
    if (message.type === "follow" && message.target === "user" && message.id === userId) {
      setProfile((held) => (held ? { ...held, followers: message.followers } : held));
    }
  });

  const toggleFollow = async (): Promise<void> => {
    if (!profile) return;
    setBusy(true);
    try {
      const reply = profile.following_user
        ? await api.delete<{ following: boolean; followers: number }>(`/api/follows/users/${profile.user.id}`)
        : await api.put<{ following: boolean; followers: number }>(`/api/follows/users/${profile.user.id}`);
      setProfile({ ...profile, following_user: reply.following, followers: reply.followers });
    } catch {
      showAlert(GENERIC_ERROR);
    }
    setBusy(false);
  };

  if (missing) return <div className="page"><NotFound heading="Page not found" /></div>;
  if (!profile) return <div className="page" aria-busy="true" />;

  return (
    <div className="page">
      <header className="profile-head">
        <h1 className="page-title">{profile.user.name}</h1>
        <p className="meta">{`@${profile.user.handle}`}</p>
        <p className="profile-counts">
          <span>{counted(profile.followers, "follower", "followers")}</span>
          <span>{`${profile.following} following`}</span>
          <span>{counted(profile.pin_total, "pin", "pins")}</span>
          <span>{counted(profile.board_total, "board", "boards")}</span>
        </p>
        {profile.user.id !== me.id ? (
          <div className="board-actions">
            <Button aria-pressed={profile.following_user} busy={busy} onClick={() => void toggleFollow()}>
              {profile.following_user ? "Following" : "Follow"}
            </Button>
          </div>
        ) : null}
      </header>
      <div role="tablist" aria-label="Profile" className="tabs">
        {(["boards", "pins"] as const).map((key) => (
          <button key={key} type="button" role="tab" id={`tab-${key}`} aria-selected={tab === key} aria-controls={`panel-${key}`} className="tab" onClick={() => setTab(key)}>
            {key === "boards" ? "Boards" : "Pins"}
          </button>
        ))}
      </div>
      {tab === "boards" ? (
        <div role="tabpanel" id="panel-boards" aria-labelledby="tab-boards">
          <div className="sort">
            <Field label="Sort boards">
              {(props) => (
                <select {...props} value={sort} onChange={(event) => setSort(SORTS.find((option) => option.key === event.target.value)?.key ?? "last_saved")}>
                  {SORTS.map((option) => (
                    <option key={option.key} value={option.key}>{option.label}</option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          {profile.boards.length === 0 ? <EmptyState sentence="No boards yet" seed={`profile-${handle}`} /> : null}
          <ul className="board-tiles">
            {profile.boards.map((board) => (
              <BoardTile key={board.id} board={board} />
            ))}
          </ul>
        </div>
      ) : (
        <div role="tabpanel" id="panel-pins" aria-labelledby="tab-pins">
          {pins !== null && pins.length === 0 ? <EmptyState sentence="No pins yet" seed={`pins-${handle}`} /> : null}
          {pins !== null && pins.length > 0 ? <Grid name="Pins" pins={pins} onOpen={actions.open} onSave={actions.save} /> : null}
        </div>
      )}
      {actions.dialog}
    </div>
  );
}

export function SearchPage() {
  const location = useLocation();
  const query = params(location.search);
  const q = query.get("q") ?? "";
  const tag = query.get("tag") ?? "";
  const board = query.get("board") ?? "";
  const [result, setResult] = useState<SearchResult | null>(null);
  const actions = usePinActions();

  useEffect(() => {
    let current = true;
    void api
      .get<SearchResult>(`/api/search?q=${encodeURIComponent(q)}&tag=${encodeURIComponent(tag)}&board=${encodeURIComponent(board)}`)
      .then((loaded) => current && setResult(loaded));
    return () => {
      current = false;
    };
  }, [q, tag, board]);

  const refine = (next: { tag?: string; board?: string }): void => {
    const target = new URLSearchParams();
    if (q) target.set("q", q);
    const nextTag = next.tag ?? tag;
    const nextBoard = next.board ?? board;
    if (nextTag) target.set("tag", nextTag);
    if (nextBoard) target.set("board", nextBoard);
    navigate(`/search${target.size > 0 ? `?${target}` : ""}`, { replace: true });
  };

  const trimmed = q.trim();
  const wanted = trimmed !== "" || tag !== "";
  return (
    <div className="page">
      <h1 className="page-title">Search</h1>
      <div className="filters">
        <Field label="Tag">
          {(props) => (
            <select {...props} value={tag} onChange={(event) => refine({ tag: event.target.value })}>
              <option value="">All tags</option>
              {(result?.tags ?? []).map((entry) => (
                <option key={entry.tag} value={entry.tag}>{`#${entry.tag} (${entry.count})`}</option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Board">
          {(props) => (
            <select {...props} value={board} onChange={(event) => refine({ board: event.target.value })}>
              <option value="">All boards</option>
              {(result?.boards ?? []).map((entry) => (
                <option key={entry.id} value={String(entry.id)}>{`${entry.name} (${entry.count})`}</option>
              ))}
            </select>
          )}
        </Field>
      </div>
      {result !== null && wanted && result.pins.length === 0 ? (
        <EmptyState sentence={`No pins match "${trimmed !== "" ? trimmed : `#${tag}`}".`} seed="search" />
      ) : null}
      {result !== null && result.pins.length > 0 ? <Grid name="Pins" pins={result.pins} onOpen={actions.open} onSave={actions.save} /> : null}
      {actions.dialog}
    </div>
  );
}
