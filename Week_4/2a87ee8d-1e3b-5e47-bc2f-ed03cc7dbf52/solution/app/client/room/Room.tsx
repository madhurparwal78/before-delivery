// The room: one page for the facilitator and participants. It holds the last rendered server board, the
// optimistic changes laid over it, the live stream and the reveal comparison, and hands actions to the canvas,
// the rail, the toolbar and the drawer.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Frame as FrameIcon, PanelRight, Search as SearchIcon } from "lucide-react";
import { api, ApiFailure, onFailure, opId, reason } from "../api.js";
import { BillingBanner, useBilling } from "../account.js";
import { takeCreatedFlash, UpgradeDialog, type PlanLimit } from "../pages/Workshops.js";
import { Link, navigate, useFocusTrap, useTitle } from "../ui.js";
import { reducedMotion, slideIn } from "../motion.js";
import { STATUS_LABELS, isLive } from "../../shared/states.js";
import { isFacilitatorWorkshop, type Board, type Note, type Presence } from "../types.js";
import { buildView, flippedCards, frameCounter, freeSpot, newNoteKey, revealAnnouncements, waveFires, type NewNote, type NotePatch, type Pending } from "./model.js";
import { openLive } from "./live.js";
import { Canvas, type CanvasHandle, type Cursor } from "./Canvas.js";
import { Drawer } from "./Drawer.js";
import { Rail } from "./Rail.js";
import { Toolbar } from "./Toolbar.js";
import { NoteEditor, TitlePrompt, type EditorState } from "./Editors.js";
import { SearchBox } from "./Search.js";

export interface Wave {
  token: number;
  ids: Set<string>;
  counter: string;
}

export interface RoomActions {
  board: Board;
  view: ReturnType<typeof buildView>;
  facilitator: boolean;
  say: (text: string) => void;
  complain: (text: string) => void;
  failed: (e: unknown) => string;
  refresh: () => Promise<void>;
  move: (noteId: string, patch: NotePatch, onFail?: () => void) => Promise<boolean>;
  edit: (noteId: string, text: string, facilitatorOnly: boolean | undefined) => void;
  remove: (noteId: string) => void;
  openEditor: (state: EditorState) => void;
  planLimit: (limit: PlanLimit, opener: HTMLElement | null) => void;
  undoable: (text: string, undo: () => void) => void;
  clockOffset: () => number;
  connecting: boolean;
  setConnecting: (on: boolean) => void;
}

const SHEET_PHONE = 640;
const SHEET_TABLET = 1100;

function useLayoutMode(): "phone" | "tablet" | "desktop" {
  const read = (): "phone" | "tablet" | "desktop" => (window.innerWidth < SHEET_PHONE ? "phone" : window.innerWidth < SHEET_TABLET ? "tablet" : "desktop");
  const [mode, setMode] = useState(read);
  useEffect(() => {
    const on = () => setMode(read());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return mode;
}

function Sheet({ side, label, onClose, children }: { side: "left" | "right" | "bottom"; label: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useFocusTrap(onClose);
  useEffect(() => {
    if (ref.current) slideIn(ref.current, side === "left" ? "translateX(-100%)" : side === "right" ? "translateX(100%)" : "translateY(100%)");
  }, [ref, side]);
  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`sheet sheet-${side}`} aria-modal="true" role="dialog" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

export function Room({ workshopId }: { workshopId: string }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [missing, setMissing] = useState(false);
  const [ended, setEnded] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [creating, setCreating] = useState<NewNote[]>([]);
  const [preview, setPreview] = useState<Pending | null>(null);
  const [status, setStatus] = useState<{ text: string; undo?: () => void }>(() => ({ text: takeCreatedFlash() ?? "" }));
  const [problem, setProblem] = useState("");
  const [down, setDown] = useState(false);
  const [cursors, setCursors] = useState<Map<string, Cursor>>(new Map());
  const [waves, setWaves] = useState<Map<string, Wave>>(new Map());
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [limit, setLimit] = useState<{ limit: PlanLimit; opener: HTMLElement | null } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sheet, setSheet] = useState<"rail" | "drawer" | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const mode = useLayoutMode();
  const canvas = useRef<CanvasHandle>(null);
  const lastRendered = useRef<Board | null>(null);
  const dropped = useRef(false);
  const offset = useRef(0);
  const focusHeading = useRef<string | null>(null);
  const landed = useRef(new Set<string>());
  const waveToken = useRef(0);
  const inflight = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const undoTimer = useRef(0);
  const facilitator = board?.viewer.role === "facilitator";
  const [billing, setBilling] = useBilling(facilitator);
  useTitle(board?.workshop.title ?? "Room");

  const say = useCallback((text: string) => setStatus({ text }), []);
  const complain = useCallback((text: string) => setProblem(text), []);

  const apply = useCallback((next: Board) => {
    const prev = lastRendered.current;
    if (prev && next.workshop.version < prev.workshop.version) return;
    offset.current = Date.parse(next.serverTime) - Date.now();
    const messages: string[] = [];
    if (dropped.current) {
      messages.push("Back online");
      dropped.current = false;
    }
    if (prev && waveFires(prev, next)) {
      const flipped = flippedCards(prev, next);
      const announced = revealAnnouncements(prev, next);
      messages.push(...announced.map((a) => a.text));
      focusHeading.current = announced[0]?.frameId ?? null;
      if (flipped.size) {
        waveToken.current += 1;
        const token = waveToken.current;
        const counters = new Map(prev.frames.map((f) => [f.id, frameCounter(f, true)]));
        setWaves((old) => {
          const out = new Map(old);
          for (const [frameId, ids] of flipped) out.set(frameId, { token, ids: new Set(ids), counter: counters.get(frameId) ?? "" });
          return out;
        });
      }
    }
    lastRendered.current = next;
    setBoard(next);
    if (messages.length) setStatus({ text: messages.join(" ") });
  }, []);

  const refresh = useCallback(async () => {
    if (inflight.current) {
      again.current = true;
      return inflight.current;
    }
    const run = (async () => {
      do {
        again.current = false;
        try {
          apply(await api<Board>("GET", `/api/workshops/${workshopId}/board`));
        } catch (e) {
          if (e instanceof ApiFailure && e.status === 404) setMissing(true);
          else if (e instanceof ApiFailure && e.status === 401 && e.code !== "session_ended") navigate("/signin", true);
        }
      } while (again.current);
    })();
    inflight.current = run;
    try {
      await run;
    } finally {
      inflight.current = null;
    }
  }, [apply, workshopId]);

  useEffect(() => onFailure((f) => f.code === "session_ended" && setEnded(true)), []);

  useEffect(() => {
    void refresh();
    // Cursor updates from the whole room are applied once per animation frame, so a burst renders once.
    const pendingCursors = new Map<string, Cursor>();
    let cursorFrame = 0;
    const flushCursors = () => {
      cursorFrame = 0;
      const batch = [...pendingCursors.values()];
      pendingCursors.clear();
      setCursors((old) => {
        const out = new Map(old);
        for (const c of batch) out.set(c.cursorId, c);
        return out;
      });
    };
    const close = openLive(workshopId, {
      board: (version) => {
        if (!lastRendered.current || version > lastRendered.current.workshop.version) void refresh();
      },
      presence: (p: Presence) => {
        pendingCursors.set(p.cursorId, { ...p, at: Date.now() });
        if (!cursorFrame) cursorFrame = requestAnimationFrame(flushCursors);
      },
      ended: () => setEnded(true),
      down: () => {
        dropped.current = true;
        setDown(true);
        setStatus({ text: "Reconnecting to the board…" });
      },
      up: () => {
        setDown(false);
        void refresh();
      },
    });
    const sweep = window.setInterval(() => {
      setCursors((old) => {
        const now = Date.now();
        const kept = [...old].filter(([, c]) => now - c.at < 10_000);
        return kept.length === old.size ? old : new Map(kept);
      });
    }, 1000);
    return () => {
      close();
      cancelAnimationFrame(cursorFrame);
      clearInterval(sweep);
    };
  }, [refresh, workshopId]);

  useEffect(() => {
    if (board?.viewer.role === "participant" && board.workshop.status === "silent_round" && cursors.size) setCursors(new Map());
  }, [board, cursors.size]);

  const failed = useCallback((e: unknown): string => {
    if (e instanceof ApiFailure && e.code === "rate_limited") return `Slow down — too many changes in a row. Try again in ${e.retryAfter ?? "a few"} seconds.`;
    return e instanceof ApiFailure ? e.message : reason(e);
  }, []);

  /** Lays a change over the board until the board that includes it has been fetched. */
  const optimistic = useCallback(
    async (noteId: string, patch: NotePatch, send: () => Promise<unknown>): Promise<unknown> => {
      const key = opId();
      setPending((p) => [...p, { key, noteId, patch }]);
      try {
        await send();
        await refresh();
        return null;
      } catch (e) {
        return e;
      } finally {
        setPending((p) => p.filter((x) => x.key !== key));
      }
    },
    [refresh],
  );

  const move = useCallback(
    async (noteId: string, patch: NotePatch, onFail?: () => void) => {
      const body: Record<string, unknown> = { clientOpId: opId() };
      if (patch.x !== undefined && patch.y !== undefined) body.position = { x: Math.round(patch.x), y: Math.round(patch.y) };
      if (patch.frameId !== undefined) body.placement = { frameId: patch.frameId, clusterId: patch.clusterId ?? null, ...(patch.index !== undefined ? { index: patch.index } : {}) };
      const error = await optimistic(noteId, patch, () => api("PATCH", `/api/notes/${noteId}`, body));
      if (!error) return true;
      onFail?.();
      const why = error instanceof ApiFailure && error.code === "rate_limited" ? failed(error) : `Move not saved — ${reason(error)}. The note is back where everyone else sees it.`;
      setProblem(why);
      void refresh();
      return false;
    },
    [optimistic, failed, refresh],
  );

  const edit = useCallback(
    (noteId: string, text: string, facilitatorOnly: boolean | undefined) => {
      const current = lastRendered.current?.notes.find((n) => n.id === noteId);
      const patch: NotePatch = {};
      const body: Record<string, unknown> = { clientOpId: opId() };
      if (current?.text !== text && current?.kind !== "image") {
        patch.text = text;
        body.text = text;
      }
      if (facilitatorOnly !== undefined && facilitatorOnly !== (current?.facilitatorOnly ?? false)) {
        patch.facilitatorOnly = facilitatorOnly;
        body.facilitatorOnly = facilitatorOnly;
      }
      if (Object.keys(patch).length === 0) return;
      void optimistic(noteId, patch, () => api("PATCH", `/api/notes/${noteId}`, body)).then((error) => {
        if (!error) return;
        setProblem(error instanceof ApiFailure && error.code === "rate_limited" ? failed(error) : `Edit not saved — ${reason(error)}. The note shows its saved text.`);
        void refresh();
      });
    },
    [optimistic, failed, refresh],
  );

  const remove = useCallback(
    (noteId: string) => {
      void optimistic(noteId, { deleted: true }, () => api("DELETE", `/api/notes/${noteId}`)).then((error) => {
        if (!error) say("Note deleted");
        else {
          setProblem(error instanceof ApiFailure && error.code === "rate_limited" ? failed(error) : `Note not deleted — ${reason(error)}.`);
          void refresh();
        }
      });
    },
    [optimistic, failed, refresh, say],
  );

  /** Creates a note at once in its saving state and retries a network failure with the same operation id. */
  const create = useCallback(
    async (note: NewNote, frameTitle: string): Promise<void> => {
      setCreating((c) => [...c, note]);
      for (;;) {
        try {
          const r = await api<{ note: Note }>("POST", `/api/workshops/${workshopId}/notes`, { clientOpId: note.clientOpId, ...note.body });
          landed.current.add(r.note.id);
          await refresh();
          setCreating((c) => c.filter((x) => x.key !== note.key));
          say(`Note added to ${frameTitle}`);
          return;
        } catch (e) {
          if (e instanceof ApiFailure && e.offline) {
            setProblem("Couldn't reach the board — retrying your note.");
            await new Promise((resolve) => window.setTimeout(resolve, 1000));
            continue;
          }
          setCreating((c) => c.filter((x) => x.key !== note.key));
          setProblem(e instanceof ApiFailure && e.code === "rate_limited" ? failed(e) : `Note not added — ${reason(e)}.`);
          if (note.body.kind === "text")
            setEditor({ mode: "new", frameId: note.body.frameId, text: note.body.text ?? "", facilitatorOnly: note.body.facilitatorOnly ?? false });
          return;
        }
      }
    },
    [workshopId, refresh, say, failed],
  );

  const view = useMemo(() => (board ? buildView(board, pending, creating, preview) : null), [board, pending, creating, preview]);

  const nearestFrame = useCallback(() => {
    if (!view) return null;
    const id = canvas.current?.nearestFrame();
    return view.frames.find((f) => f.id === id) ?? view.frames[0] ?? null;
  }, [view]);

  const saveNew = (text: string, facilitatorOnly: boolean, frameId: string) => {
    if (!view) return;
    const frame = view.frames.find((f) => f.id === frameId);
    if (!frame) return;
    const spot = freeSpot(frame, view);
    const clientOpId = opId();
    setEditor(null);
    void create(
      {
        key: newNoteKey(clientOpId),
        clientOpId,
        body: { frameId, kind: "text", text, x: spot.x, y: spot.y, ...(facilitator ? { facilitatorOnly } : {}) },
        imageUrl: null,
      },
      frame.title,
    );
  };

  const addImage = async (file: File) => {
    const frame = nearestFrame();
    if (!frame || !view) return;
    setUploading(true);
    try {
      const r = await api<{ imageId: string }>("POST", `/api/workshops/${workshopId}/images`, undefined, { bytes: file, type: file.type });
      const spot = freeSpot(frame, view);
      const clientOpId = opId();
      void create({ key: newNoteKey(clientOpId), clientOpId, body: { frameId: frame.id, kind: "image", imageId: r.imageId, x: spot.x, y: spot.y }, imageUrl: URL.createObjectURL(file) }, frame.title);
    } catch (e) {
      const copy: Record<string, string> = {
        too_large: "Images must be 5,000,000 bytes or smaller.",
        unsupported_media_type: "Use a PNG, JPEG or WebP image.",
        storage_unavailable: "Image storage is unavailable. Your image was not added — try again shortly.",
      };
      setProblem(e instanceof ApiFailure ? (copy[e.code] ?? (e.code === "validation" ? (Object.values(e.fields)[0] ?? e.message) : failed(e))) : `Note not added — ${reason(e)}.`);
    } finally {
      setUploading(false);
    }
  };

  const trashUndo = useCallback(
    (text: string, undo: () => void) => {
      clearTimeout(undoTimer.current);
      setStatus({ text, undo });
      undoTimer.current = window.setTimeout(() => setStatus((s) => (s.undo === undo ? { text: s.text } : s)), 10_000);
    },
    [],
  );

  if (ended)
    return (
      <main className="ended">
        <h1 className="display-sm">This join link is no longer active. Ask your facilitator for a new one.</h1>
      </main>
    );
  if (missing)
    return (
      <main className="ended">
        <h1 className="display-sm">We couldn't find that workshop.</h1>
        <p>
          <Link to="/workshops">Back to your workshops</Link>
        </p>
      </main>
    );
  if (!board || !view)
    return (
      <main className="ended" aria-busy="true">
        <p className="muted">Loading the board…</p>
      </main>
    );

  const actions: RoomActions = {
    board,
    view,
    facilitator,
    say,
    complain,
    failed,
    refresh,
    move,
    edit,
    remove,
    openEditor: setEditor,
    planLimit: (l, opener) => setLimit({ limit: l, opener }),
    undoable: trashUndo,
    clockOffset: () => offset.current,
    connecting,
    setConnecting,
  };
  const live = isLive(board.workshop.status);
  const railInline = mode !== "phone";
  const drawerInline = mode === "desktop";
  const centreFrame = (id: string) => {
    if (sheet === "rail") setSheet(null);
    canvas.current?.centreFrame(id);
  };

  const drawer = (
    <Drawer
      actions={actions}
      banner={
        facilitator && isFacilitatorWorkshop(board.workshop) ? (
          <BillingBanner billing={billing} zone={board.workshop.timeZone} onBilling={setBilling} report={(kind, text) => (kind === "ok" ? say(text) : complain(text))} />
        ) : null
      }
    />
  );
  const rail = <Rail actions={actions} onPick={centreFrame} />;

  return (
    <div className={`room room-${mode}`}>
      <header className="topbar">
        {!railInline && (
          <button type="button" className="icon-btn" aria-label="Frames" onClick={() => setSheet("rail")}>
            <FrameIcon aria-hidden="true" size={20} strokeWidth={1.75} />
          </button>
        )}
        {facilitator && (
          <Link to="/workshops" className="topbar-back">
            Workshops
          </Link>
        )}
        <div className="topbar-title">
          <h1 className="room-title">{board.workshop.title}</h1>
          <span className="status-label">
            <span className={live && !down ? "live-dot on" : "live-dot"} aria-hidden="true" />
            {STATUS_LABELS[board.workshop.status]}
          </span>
          {down && <span className="reconnecting">Reconnecting to the board…</span>}
        </div>
        {mode === "phone" && !searchOpen ? (
          <button type="button" className="icon-btn" aria-label="Search" onClick={() => setSearchOpen(true)}>
            <SearchIcon aria-hidden="true" size={20} strokeWidth={1.75} />
          </button>
        ) : (
          <SearchBox workshopId={workshopId} onPick={(id) => canvas.current?.centreNote(id)} autoFocus={mode === "phone"} />
        )}
        {!drawerInline && (
          <button type="button" className="icon-btn" aria-label="Session" onClick={() => setSheet("drawer")}>
            <PanelRight aria-hidden="true" size={20} strokeWidth={1.75} />
          </button>
        )}
      </header>
      {railInline && rail}
      <Canvas
        ref={canvas}
        actions={actions}
        waves={waves}
        landed={landed.current}
        cursors={cursors}
        reduced={reducedMotion()}
        focusHeading={focusHeading}
        onWaveDone={(frameId, token) =>
          setWaves((old) => {
            if (old.get(frameId)?.token !== token) return old;
            const out = new Map(old);
            out.delete(frameId);
            return out;
          })
        }
        onPreview={setPreview}
      />
      <Toolbar
        actions={actions}
        uploading={uploading}
        onAddNote={() => {
          const frame = nearestFrame();
          if (frame) setEditor({ mode: "new", frameId: frame.id, text: "", facilitatorOnly: false });
        }}
        onAddImage={(file) => void addImage(file)}
        onAddCluster={() => {
          const frame = nearestFrame();
          if (frame) setEditor({ mode: "cluster", frameId: frame.id });
        }}
        canvas={canvas}
      />
      <div className="messages">
        <div role="status" aria-label="Board activity" className={status.text ? "message message-ok" : "message idle"}>
          {status.text}
          {status.undo && (
            <button
              type="button"
              className="btn btn-quiet btn-small"
              onClick={() => {
                const undo = status.undo;
                setStatus({ text: "" });
                undo?.();
              }}
            >
              Undo
            </button>
          )}
        </div>
        <div role="alert" aria-label="Board problems" className={problem ? "message message-error" : "message idle"}>
          {problem}
        </div>
      </div>
      {drawerInline && drawer}
      {sheet === "rail" && (
        <Sheet side="left" label="Frames" onClose={() => setSheet(null)}>
          {rail}
        </Sheet>
      )}
      {sheet === "drawer" && (
        <Sheet side={mode === "phone" ? "bottom" : "right"} label="Session" onClose={() => setSheet(null)}>
          {drawer}
        </Sheet>
      )}
      {editor?.mode === "new" || editor?.mode === "edit" ? (
        <NoteEditor
          state={editor}
          facilitator={facilitator}
          onCancel={() => {
            const back = editor.mode === "edit" ? editor.noteId : null;
            setEditor(null);
            if (back) canvas.current?.focusNote(back);
          }}
          onSave={(text, fo) => {
            if (editor.mode === "new") saveNew(text, fo, editor.frameId);
            else {
              setEditor(null);
              edit(editor.noteId, text, facilitator ? fo : undefined);
              canvas.current?.focusNote(editor.noteId);
            }
          }}
        />
      ) : null}
      {editor?.mode === "cluster" && (
        <TitlePrompt
          label="Cluster title"
          submit="Create cluster"
          initial=""
          onCancel={() => setEditor(null)}
          onSubmit={async (title) => {
            if (!view) return;
            const frame = view.frames.find((f) => f.id === editor.frameId);
            if (!frame) return;
            const spot = freeSpot(frame, view);
            try {
              await api("POST", `/api/workshops/${workshopId}/clusters`, { clientOpId: opId(), frameId: frame.id, title, x: spot.x, y: spot.y });
              setEditor(null);
              say(`Cluster ${title} added to ${frame.title}`);
              void refresh();
            } catch (e) {
              complain(e instanceof ApiFailure && e.code === "validation" ? (Object.values(e.fields)[0] ?? e.message) : failed(e));
            }
          }}
        />
      )}
      {limit && <UpgradeDialog limit={limit.limit} onClose={() => setLimit(null)} returnTo={() => limit.opener} />}
    </div>
  );
}
