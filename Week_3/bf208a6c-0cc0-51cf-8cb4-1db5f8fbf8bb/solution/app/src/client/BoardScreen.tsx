import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { call } from "./api";
import { Approvals, WaitingForApproval } from "./Approvals";
import { BoardContext, type BoardUi } from "./context";
import { Frame } from "./Frame";
import { lines, placeOf, withHold } from "./layout";
import { MembersDialog } from "./MembersDialog";
import { NotFound, PasswordScreen } from "./Screens";
import { PostDialog } from "./PostDialog";
import { Link, navigate } from "./router";
import { may } from "../shared/permissions";
import { SettingsDialog } from "./SettingsDialog";
import { Slideshow } from "./Slideshow";
import { Toolbar } from "./Toolbar";
import { frameSelector, useMover } from "./useMover";
import { useBoardData, type Snapshot, type Source } from "./useBoardData";
import { useSettle } from "./useSettle";
import type { Account, Board, BoardEvent, Listing, Post } from "../shared/types";

type DialogState =
  | { kind: "add"; sectionId: string }
  | { kind: "edit"; post: Post }
  | { kind: "settings" }
  | { kind: "members" }
  | { kind: "slideshow" }
  | null;

interface Props {
  source: Source;
  me: Account | null;
  onSignedOut: () => void;
}

export function BoardScreen({ source, me, onSignedOut }: Props) {
  const [announcement, setAnnouncement] = useState("");
  const [loupe, setLoupe] = useState<{ id: string; width: number } | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [, setRenders] = useState(0);
  const loupeRef = useRef(loupe);
  loupeRef.current = loupe;
  const boardRef = useRef<Board | null>(null);
  const afterNext = useRef<((snapshot: Snapshot) => string | null)[]>([]);
  const focusRequest = useRef<{ selector: string; tries: number } | null>(null);
  const lastTitles = useRef(new Map<string, string>());
  const sheet = useRef<HTMLDivElement>(null);
  const released = useRef<{ id: string; x: number; y: number } | null>(null);
  const moverRef = useRef<ReturnType<typeof useMover> | null>(null);
  const embed = source.kind === "link" && source.embed;
  const share = source.kind === "link" && !source.embed;

  const announce = useCallback((line: string) => setAnnouncement(line), []);
  const requestFocus = useCallback((selector: string) => {
    focusRequest.current = { selector, tries: 0 };
    setRenders((count) => count + 1);
  }, []);

  const onEvent = (event: BoardEvent): void => {
    const board = boardRef.current;
    if (event.type === "post_created" && event.actor.id !== me?.id) announce(lines.added(event.actor.display_name, event.title));
    else if (event.type === "post_published" && event.author_id === me?.id) announce(lines.approved(event.title));
    else if (event.type === "post_rejected" && event.author_id === me?.id) announce(lines.rejected(event.title));
    else if (event.type === "role_changed" && event.role && board && board.role !== event.role) announce(lines.role(board.title, event.role));
    else if (event.type === "post_moved" && event.actor.id !== me?.id && loupeRef.current?.id === event.post_id) {
      afterNext.current.push((snapshot) => {
        const at = placeOf(snapshot.listing.sections, event.post_id);
        return at ? lines.loupeMoved(event.title, at) : null;
      });
    }
  };

  const afterLoad = (snapshot: Snapshot): void => {
    boardRef.current = snapshot.board;
    const pending = afterNext.current;
    afterNext.current = [];
    for (const line of pending.map((work) => work(snapshot)).filter((line): line is string => line !== null)) announce(line);
    const held = moverRef.current?.holdRef.current;
    if (held && !placeOf(snapshot.listing.sections, held.postId)) {
      moverRef.current?.updateHold(null);
      announce(lines.deleted(held.title));
    }
    const open = loupeRef.current;
    if (open && !snapshot.listing.sections.some((section) => section.posts.some((post) => post.id === open.id))) {
      setLoupe(null);
      const title = lastTitles.current.get(open.id);
      if (title) announce(lines.deleted(title));
    }
    lastTitles.current = new Map(snapshot.listing.sections.flatMap((section) => section.posts).map((post) => [post.id, post.title] as const));
  };

  const data = useBoardData(source, onEvent, afterLoad);
  const { board, listing } = data;
  const role = embed ? null : (board?.role ?? null);

  const openLoupe = (post: Post, element: HTMLElement): void => {
    const section = element.closest<HTMLElement>(".run");
    const width = Math.min(element.getBoundingClientRect().width * 4, section?.clientWidth ?? Number.MAX_SAFE_INTEGER);
    setLoupe({ id: post.id, width });
    requestFocus(`${frameSelector(post.id)} [data-loupe-heading]`);
  };
  const closeLoupe = (postId: string): void => {
    if (loupeRef.current?.id !== postId) return;
    setLoupe(null);
    requestFocus(frameSelector(postId));
  };

  const mover = useMover({
    board: board ?? EMPTY_BOARD,
    listing: listing ?? EMPTY_LISTING,
    me,
    role,
    loupeId: loupe?.id ?? null,
    announce,
    reload: data.reload,
    openLoupe,
    closeLoupe,
    requestFocus,
  });
  moverRef.current = mover;
  const { hold } = mover;

  const groups = useMemo(() => (board && listing ? withHold(listing, board, hold) : []), [board, listing, hold]);
  useSettle(sheet, loupe?.id ?? null, hold?.mode === "pointer" ? hold.postId : null, released);

  // Focus: apply a pending request once its element exists and may take focus, and keep a key-held frame focused.
  useLayoutEffect(() => {
    const request = focusRequest.current;
    if (request) {
      const element = document.querySelector<HTMLElement>(request.selector);
      element?.focus();
      if (element && document.activeElement === element) focusRequest.current = null;
      else if (++request.tries > 150) focusRequest.current = null;
    }
    if (hold?.mode === "keyboard") {
      const frame = document.querySelector<HTMLElement>(frameSelector(hold.postId));
      if (frame && !frame.contains(document.activeElement)) frame.focus();
    }
  });

  useEffect(() => {
    if (!share || !me || data.status !== "ready" || source.kind !== "link") return;
    void call<{ board_id: string }>("POST", `/api/links/${source.token}/join`).then((joined) => navigate(`/b/${joined.board_id}`, true));
  }, [share, me, data.status, source]);

  const remove = async (post: Post): Promise<void> => {
    const at = listing && placeOf(listing.sections, post.id);
    const next = at?.section.posts[at.position];
    setLoupe(null);
    await call("DELETE", `/api/posts/${post.id}`);
    announce(lines.youDeleted(post.title));
    requestFocus(next ? frameSelector(next.id) : `[data-heading-for="${at?.section.id}"]`);
    await data.reload();
  };

  const ui: BoardUi | null = board
    ? { board, me, role, loupe, hold, ticks: data.ticks, bind: mover.bind, closeLoupe, announce, requestFocus, reload: data.reload, edit: (post) => setDialog({ kind: "edit", post }), remove: (post) => void remove(post) }
    : null;

  if (data.status === "not_found") return <NotFound />;
  if (data.status === "password") return <PasswordScreen onUnlock={data.unlock} />;

  const exportCsv = (): void => {
    const link = document.createElement("a");
    link.href = `/api/boards/${board?.id}/export.csv`;
    link.download = "";
    link.click();
  };
  const signOut = async (): Promise<void> => {
    await call("POST", "/api/auth/signout");
    onSignedOut();
    navigate("/");
  };

  const staff = may("moderate", role, null);
  const contributes = me !== null && may("contribute", role, me.id);
  const ownHeld = listing?.held ?? [];
  const empty = listing !== null && listing.sections.every((section) => section.posts.length === 0);

  const screen = (
    <div className={`screen${embed ? " screen-embed" : ""}`}>
      {!embed && board && (
        <header className="bar">
          <Link href="/" className="brand">
            Pinsheet
          </Link>
          <h1>{board.title}</h1>
          <nav className="controls" aria-label="Board">
            <button type="button" onClick={() => setDialog({ kind: "slideshow" })}>
              Present
            </button>
            {staff && (
              <button type="button" className="quiet" onClick={exportCsv}>
                Export CSV
              </button>
            )}
            {may("manage", role, null) && (
              <>
                <button type="button" className="quiet" onClick={() => setDialog({ kind: "settings" })}>
                  Board settings
                </button>
                <button type="button" className="quiet" onClick={() => setDialog({ kind: "members" })}>
                  Members
                </button>
              </>
            )}
            {me ? (
              <button type="button" className="quiet" onClick={() => void signOut()}>
                Sign out
              </button>
            ) : (
              <Link href={`/signin?next=${encodeURIComponent(location.pathname)}`} className="button quiet">
                Sign in
              </Link>
            )}
          </nav>
        </header>
      )}
      <p role="status" aria-label="Board announcements" className="announcements small">
        {announcement}
      </p>
      <div role="region" aria-label="Service notice" className="notice-region">
        {contributes && !data.services.storage && <p className="notice">File uploads are unavailable right now. Posts without files still work.</p>}
        {staff && !data.services.push && <p className="notice">Moderator alerts can't be sent right now. Held posts still wait in Approvals.</p>}
      </div>
      {may("manage", role, null) && board && <Toolbar board={board} applyBoard={data.applyBoard} reload={data.reload} />}
      {staff && <Approvals held={ownHeld} requestFocus={requestFocus} reload={data.reload} />}
      {!staff && ownHeld.length > 0 && <WaitingForApproval held={ownHeld} />}
      {ui && board ? (
        <>
          <div className="sheet" ref={sheet} data-layout={board.layout} data-loupe-open={loupe ? "true" : undefined}>
            <div className="sections">
              {groups.map((group, groupIndex) => (
                <section
                  key={group.id}
                  className="section"
                  aria-labelledby={`heading-${group.id}`}
                  data-section-id={group.id}
                  data-count={group.posts.length}
                  onDoubleClick={(event) => {
                    if (contributes && board.group === "section" && !(event.target as HTMLElement).closest("[data-post-id]")) setDialog({ kind: "add", sectionId: group.id });
                  }}
                >
                  <header className="section-head">
                    <h2 id={`heading-${group.id}`} tabIndex={-1} data-heading-for={group.id}>
                      {group.title}
                    </h2>
                    <span className="small muted count">{group.posts.length}</span>
                  </header>
                  <div className="run">
                    {empty && groupIndex === 0 && <p className="empty">Nothing on this board yet.</p>}
                    {group.posts.map((post, index) => (
                      <Frame key={post.id} post={post} groupId={group.id} position={index + 1} onSheet />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </>
      ) : (
        <Loading />
      )}
      {contributes && board && !embed && (
        <div className="add-bar">
          <button type="button" className="add-post" onClick={() => setDialog({ kind: "add", sectionId: board.sections[0]?.id ?? "" })}>
            Add post
          </button>
        </div>
      )}
      {dialog?.kind === "add" && board && (
        <PostDialog
          kind="add"
          boardId={board.id}
          sections={board.sections}
          sectionId={dialog.sectionId}
          announce={announce}
          onPosted={(post) => {
            announce(post.state === "awaiting_approval" ? lines.held(post.title) : lines.posted(post.title));
            requestFocus(frameSelector(post.id));
            void data.reload();
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "edit" && <PostDialog kind="edit" post={dialog.post} onSaved={() => void data.reload()} onClose={() => setDialog(null)} />}
      {dialog?.kind === "settings" && board && <SettingsDialog board={board} reload={data.reload} onClose={() => setDialog(null)} />}
      {dialog?.kind === "members" && board && <MembersDialog boardId={board.id} tick={data.membersTick} onClose={() => setDialog(null)} />}
      {dialog?.kind === "slideshow" && listing && <Slideshow listing={listing} onClose={() => setDialog(null)} />}
    </div>
  );
  return ui ? <BoardContext.Provider value={ui}>{screen}</BoardContext.Provider> : screen;
}

function Loading() {
  return (
    <div className="sheet" aria-busy="true">
      <div className="sections">
        {[0, 1, 2].map((section) => (
          <div className="section" key={section}>
            <div className="run">
              {[0, 1, 2].map((frame) => (
                <div className="frame frame-loading" key={frame} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const EMPTY_BOARD: Board = {
  id: "",
  title: "",
  layout: "columns",
  sort: "by_hand",
  group: "section",
  privacy: "private",
  approval: false,
  link_access: "off",
  role: null,
  sections: [],
  share_path: null,
  embed_path: null,
};
const EMPTY_LISTING: Listing = { sections: [], held: [] };
