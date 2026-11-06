import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { api, Refusal, UNEXPECTED } from "../api";
import { focusables } from "../dialog";
import { AppHeader } from "../header";
import { BatonDrawing, Icon } from "../icons";
import { MenuButton } from "../menu";
import { navigate } from "../router";
import { mayPass, type SessionAction, TRANSITIONS, writeRefusal } from "../../../shared/rules";
import type { Checkpoint, Cursor, FileMeta, ImportPlan, Member, Project, ServerFrame, Session, User } from "../types";
import {
  DeleteDialog,
  type ImportReport,
  ImportDialog,
  MembersDialog,
  NewFileDialog,
  RenameDialog,
  type RenameTarget,
  ReviewImportDialog,
  ScheduleDialog,
} from "./dialogs";
import { Editor, type EditorHandle, REMOVED_NOTICE } from "./editor";
import { useBand } from "./layout";
import { Ledger, type LedgerHandle } from "./ledger";
import { usePanel } from "./panel";
import { Rail, tintOf } from "./rail";
import { FileTree, type Selection } from "./tree";

const STATE_WORD: Record<Session["state"], string> = { scheduled: "Scheduled", live: "Live", paused: "Paused", ended: "Ended" };
const ACTIONS = ["start", "pause", "resume", "end"] as const satisfies readonly SessionAction[];
type Action = (typeof ACTIONS)[number];
const ACTION_LABEL: Record<Action, string> = { start: "Start session", pause: "Pause session", resume: "Resume session", end: "End session" };
const ACTION_ICON = { start: "play", pause: "pause", resume: "play", end: "stop" } as const;
const REDIRECT_MS = 3000;

function currentSession(sessions: Session[], endedOrder: string[]): Session | null {
  const running = sessions.find((s) => s.state === "live" || s.state === "paused");
  if (running) return running;
  const next = sessions.filter((s) => s.state === "scheduled").sort((a, b) => (a.scheduled_for < b.scheduled_for ? -1 : 1))[0];
  if (next) return next;
  const ended = sessions.filter((s) => s.state === "ended");
  return ended.sort((a, b) => endedOrder.indexOf(b.id) - endedOrder.indexOf(a.id))[0] ?? null;
}

function byNewest(a: Checkpoint, b: Checkpoint): number {
  return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;
}

export function WorkspacePage({ user, projectId }: { user: User; projectId: string }) {
  const band = useBand();
  const [project, setProject] = useState<Project | null>(null);
  const [missing, setMissing] = useState(false);
  const [participants, setParticipants] = useState<Member[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [endedOrder, setEndedOrder] = useState<string[]>([]);
  const [files, setFiles] = useState<Map<string, FileMeta>>(new Map());
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [cursors, setCursors] = useState<Map<string, Cursor>>(new Map());
  const [following, setFollowing] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);
  const [landed, setLanded] = useState<string | null>(null);
  const [stripeFrom, setStripeFrom] = useState<{ tint: string; key: number } | null>(null);
  const [ledgerOpen, setLedgerOpen] = useState(band === "wide");
  const [filesOpen, setFilesOpen] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [batonStatus, setBatonStatus] = useState("");
  const [sessionMessage, setSessionMessage] = useState("");
  const [sessionBusy, setSessionBusy] = useState(false);
  const [importReport, setImportReport] = useState<ImportReport>({ text: "" });
  const [dialog, setDialog] = useState<"members" | "schedule" | "new-file" | "import" | null>(null);
  const [renaming, setRenaming] = useState<RenameTarget | null>(null);
  const [deleting, setDeleting] = useState<FileMeta | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const editor = useRef<EditorHandle>(null);
  const ledger = useRef<LedgerHandle>(null);
  const socket = useRef<WebSocket | null>(null);
  const lastCursor = useRef("");
  const filesPanel = useRef<HTMLDivElement>(null);
  const ledgerPanel = useRef<HTMLElement>(null);
  const showFiles = useRef<HTMLButtonElement>(null);
  const ledgerButton = useRef<HTMLButtonElement>(null);
  const state = useRef({ files, participants, following, sessions, checkpoints });
  state.current = { files, participants, following, sessions, checkpoints };

  const isMentor = project?.owner.id === user.id;
  const current = currentSession(sessions, endedOrder);
  const running = current && (current.state === "live" || current.state === "paused") ? current : null;
  const driverId = running?.driver_id ?? null;
  const nameOf = useCallback((id: string | null) => participants.find((p) => p.user_id === id)?.name ?? "Someone", [participants]);
  const canWrite = !removed && writeRefusal(running, user.id) === null;

  usePanel(filesPanel, band === "wide" || filesOpen, band === "narrow" ? { x: 0, y: -8 } : { x: -12, y: 0 });
  usePanel(ledgerPanel, ledgerOpen, band === "wide" ? null : band === "narrow" ? { x: 0, y: 24 } : { x: 16, y: 0 });

  useEffect(() => {
    setLedgerOpen(band === "wide");
    setFilesOpen(false);
  }, [band]);

  const loadAll = useCallback(async () => {
    try {
      const [p, f, c] = await Promise.all([
        api<{ project: Project }>(`/api/projects/${projectId}`),
        api<{ files: FileMeta[] }>(`/api/projects/${projectId}/files`),
        api<{ checkpoints: Checkpoint[] }>(`/api/projects/${projectId}/checkpoints`),
      ]);
      setProject(p.project);
      setSessions(p.project.sessions);
      setParticipants((list) => (list.length ? list : p.project.members));
      setFiles(new Map(f.files.map((file) => [file.id, file])));
      setCheckpoints(c.checkpoints);
      document.title = `${p.project.title} — Relay Bench`;
      return f.files;
    } catch (error) {
      if (error instanceof Refusal && error.status === 404) setMissing(true);
      return [];
    }
  }, [projectId]);

  const [firstFile, setFirstFile] = useState<string | null>(null);

  useEffect(() => {
    void loadAll().then((list) => setFirstFile([...list].sort((a, b) => (a.path < b.path ? -1 : 1))[0]?.id ?? null));
  }, [loadAll]);

  // The workspace renders once its data is in, then opens the first file so the editor shows text at once.
  useEffect(() => {
    if (!firstFile || !editor.current || editor.current.activeId()) return;
    setSelection({ kind: "file", id: firstFile });
    void editor.current.open(firstFile);
  }, [firstFile, project]);

  const onFrame = useCallback(
    (frame: ServerFrame) => {
      switch (frame.type) {
        case "hello":
        case "presence":
          setParticipants(frame.participants);
          if (frame.type === "hello" && frame.session) {
            const session = frame.session;
            setSessions((list) => (list.some((s) => s.id === session.id) ? list.map((s) => (s.id === session.id ? session : s)) : [...list, session]));
          }
          return;
        case "session": {
          const before = state.current.sessions.find((s) => s.id === frame.session.id);
          flushSync(() => {
            setSessions((list) =>
              list.some((s) => s.id === frame.session.id) ? list.map((s) => (s.id === frame.session.id ? frame.session : s)) : [...list, frame.session],
            );
            if (frame.session.state === "ended") setEndedOrder((order) => [...order.filter((id) => id !== frame.session.id), frame.session.id]);
          });
          if (frame.session.driver_id && frame.session.driver_id !== before?.driver_id) {
            const name = state.current.participants.find((p) => p.user_id === frame.session.driver_id)?.name ?? "Someone";
            setBatonStatus(`${name} is now driving`);
          } else if (frame.session.state === "ended") {
            setBatonStatus("");
          }
          return;
        }
        case "file":
          setFiles((map) => new Map(map).set(frame.file.id, frame.file));
          editor.current?.fileChanged(frame.file);
          ledger.current?.fileEvent(frame.file);
          return;
        case "file_deleted": {
          const path = state.current.files.get(frame.file_id)?.path ?? "";
          setFiles((map) => {
            const next = new Map(map);
            next.delete(frame.file_id);
            return next;
          });
          editor.current?.fileDeleted(frame.file_id, path);
          ledger.current?.fileEvent(null, frame.file_id);
          return;
        }
        case "checkpoint": {
          const before = state.current.checkpoints.find((c) => c.id === frame.checkpoint.id);
          setCheckpoints((list) => [frame.checkpoint, ...list.filter((c) => c.id !== frame.checkpoint.id)].sort(byNewest));
          if (frame.checkpoint.created_by.id === user.id && frame.checkpoint.state !== "pending_upload" && before?.state === "pending_upload") {
            ledger.current?.announce(frame.checkpoint);
          }
          return;
        }
        case "cursor": {
          const { type: _type, ...cursor } = frame;
          setCursors((map) => new Map(map).set(cursor.user_id, cursor));
          if (state.current.following === cursor.user_id) void editor.current?.follow(cursor);
          return;
        }
        case "access_revoked":
          setRemoved(true);
          window.setTimeout(() => navigate("/"), REDIRECT_MS);
          return;
        case "edit_rejected":
          return;
      }
    },
    [user.id],
  );

  useEffect(() => {
    let closed = false;
    let retry: number | undefined;
    const connect = () => {
      const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/projects/${projectId}/socket`);
      socket.current = ws;
      ws.onmessage = (event) => onFrame(JSON.parse(String(event.data)) as ServerFrame);
      ws.onclose = (event) => {
        if (closed || event.code === 4403) return;
        retry = window.setTimeout(() => {
          void loadAll();
          connect();
        }, 1500);
      };
    };
    connect();
    return () => {
      closed = true;
      window.clearTimeout(retry);
      socket.current?.close();
    };
  }, [projectId, onFrame, loadAll]);

  const sendCursor = useCallback((fileId: string, line: number, column: number) => {
    const key = `${fileId}:${line}:${column}`;
    if (key === lastCursor.current || socket.current?.readyState !== WebSocket.OPEN) return;
    lastCursor.current = key;
    socket.current.send(JSON.stringify({ type: "cursor", file_id: fileId, line, column }));
  }, []);

  const follow = (userId: string) => {
    if (following === userId) return setFollowing(null);
    setFollowing(userId);
    const cursor = cursors.get(userId);
    if (cursor) void editor.current?.follow(cursor);
  };

  const onLanded = useCallback(
    (driver: string | null, previous: string | null) => {
      setLanded(driver);
      if (driver && previous) setStripeFrom((s) => ({ tint: tintOf(state.current.participants, previous), key: (s?.key ?? 0) + 1 }));
    },
    [],
  );

  const act = async (action: Action) => {
    if (!current) return;
    setSessionBusy(true);
    setSessionMessage("Updating session…");
    try {
      const r = await api<{ session: Session }>(`/api/sessions/${current.id}/${action}`, { method: "POST" });
      setSessions((list) => list.map((s) => (s.id === r.session.id ? r.session : s)));
      if (r.session.state === "ended") setEndedOrder((order) => [...order.filter((id) => id !== r.session.id), r.session.id]);
      setSessionMessage("");
    } catch (error) {
      const code = error instanceof Refusal ? error.code : "";
      setSessionMessage(
        code === "illegal_transition"
          ? `That change isn't possible while the session is ${String((error as Refusal).body.from)}.`
          : code === "session_already_live"
            ? "Another session in this project is already running."
            : UNEXPECTED,
      );
    } finally {
      setSessionBusy(false);
    }
  };

  const batonFailure = (error: unknown) => {
    const code = error instanceof Refusal ? error.code : "";
    if (code === "baton_taken") return setBatonStatus(`${String((error as Refusal).body.driver_name)} took the baton first.`);
    if (code === "session_not_live") return setBatonStatus("The baton is only passed during a live session.");
    if (code === "already_driving") return;
    setBatonStatus(UNEXPECTED);
  };

  const take = async () => {
    if (!running) return;
    setBatonStatus("Claiming the baton…");
    try {
      await api(`/api/sessions/${running.id}/baton/claim`, { method: "POST", body: { version: running.version } });
      setBatonStatus(`${user.name} is now driving`);
    } catch (error) {
      batonFailure(error);
    }
  };

  const passTo = async (target: string) => {
    if (!running) return;
    try {
      await api(`/api/sessions/${running.id}/baton/pass`, { method: "POST", body: { to_user_id: target, version: running.version } });
    } catch (error) {
      batonFailure(error);
    }
  };

  const onRestored = useCallback((list: FileMeta[]) => {
    setFiles(new Map(list.map((f) => [f.id, f])));
    void editor.current?.reloadAll();
  }, []);

  useEffect(() => {
    if (!filesOpen || band === "wide") return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!filesPanel.current?.contains(target) && !showFiles.current?.contains(target) && !(target as Element).closest?.("dialog")) {
        setFilesOpen(false);
      }
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [filesOpen, band]);

  useEffect(() => {
    if (!following) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFollowing(null);
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [following]);

  // The workspace's Tab order is a cycle: past its last control focus returns to "Skip to editor", and back.
  useEffect(() => {
    const cycle = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || event.defaultPrevented || document.querySelector("dialog[open]")) return;
      const order = focusables(document.body).filter((e) => !e.closest("dialog"));
      const first = order[0];
      const last = order[order.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (active === first || active === document.body)) {
        event.preventDefault();
        last.focus();
      }
    };
    document.addEventListener("keydown", cycle);
    return () => document.removeEventListener("keydown", cycle);
  }, []);

  const sheetDrag = useRef<number | null>(null);

  if (missing) {
    return (
      <div className="page">
        <AppHeader user={user} />
        <main className="projects">
          <div className="empty">
            <BatonDrawing />
            <p className="empty-title">This project isn't available</p>
            <button type="button" className="button" onClick={() => navigate("/")}>
              Back to projects
            </button>
          </div>
        </main>
      </div>
    );
  }

  if (!project) return <div className="boot" aria-busy="true" />;

  const notice = removed
    ? REMOVED_NOTICE
    : running?.state === "paused"
      ? "Session paused — editing resumes when the mentor resumes."
      : running && running.driver_id !== user.id
        ? `You are viewing — ${nameOf(running.driver_id)} is driving.`
        : "";
  const followed = following ? cursors.get(following) : undefined;
  const followLabel = following
    ? `Following ${nameOf(following)}${followed ? ` · ${files.get(followed.file_id)?.path ?? followed.path}` : ""}`
    : "";
  const fileList = [...files.values()];
  const selectedFile = selection?.kind === "file" ? (files.get(selection.id) ?? null) : null;
  const canTake = running?.state === "live" && driverId !== user.id && !removed;
  const canPass = running?.state === "live" && mayPass(isMentor ? "mentor" : "student", driverId, user.id) && !removed;
  const passTargets = participants.filter((p) => p.user_id !== driverId);

  return (
    <div className={`workspace band-${band}${ledgerOpen ? " ledger-open" : " ledger-closed"}`}>
      <AppHeader user={user} workspace>
        <div className="session-head">
          <p className="project-name">{project.title}</p>
          {current ? (
            <h1 className="display session-title">{current.title}</h1>
          ) : (
            <div className="session-empty-row">
              <BatonDrawing />
              <h1 className="display session-title session-empty">No session scheduled</h1>
            </div>
          )}
          <p role="status" aria-label="Session status" className="session-status">
            {current && <span className={`session-state state-session-${current.state}`}>{STATE_WORD[current.state]}</span>}
            {sessionMessage && <span className="session-message">{sessionMessage}</span>}
          </p>
        </div>
        {isMentor && (
          <div className="session-controls">
            <button type="button" className="button" onClick={() => setDialog("schedule")}>
              <Icon name="calendar" />
              Schedule session
            </button>
            {current &&
              ACTIONS.filter((a) => TRANSITIONS[a].from.includes(current.state)).map((action) => (
                <button
                  key={action}
                  type="button"
                  className={action === "start" || action === "resume" ? "button button-primary" : "button"}
                  disabled={sessionBusy}
                  onClick={() => void act(action)}
                >
                  <Icon name={ACTION_ICON[action]} />
                  {ACTION_LABEL[action]}
                </button>
              ))}
            <button type="button" className="button" onClick={() => setDialog("members")}>
              <Icon name="users" />
              Members
            </button>
          </div>
        )}
      </AppHeader>
      <main className="room">
        <Rail participants={participants} me={user.id} driverId={driverId} following={following} band={band} onFollow={follow} onLanded={onLanded} />
        <section className="editor" aria-label="Editor">
          <div className="editor-bar">
            {canTake && (
              <button type="button" className="button button-baton" onClick={() => void take()}>
                <Icon name="hand" />
                Take the baton
              </button>
            )}
            {canPass && (
              <MenuButton
                label="Pass the baton"
                menuLabel="Pass to"
                className="button"
                items={passTargets.map((p) => ({ label: p.name, onSelect: () => void passTo(p.user_id) }))}
              >
                <Icon name="pass" />
                Pass the baton
              </MenuButton>
            )}
            <p role="status" aria-label="Baton status" className="baton-status">
              {batonStatus}
            </p>
            {!batonStatus && current?.state !== "live" && <p className="baton-hint">The baton is handed out once the session starts.</p>}
            {band !== "wide" && (
              <button
                ref={showFiles}
                type="button"
                className="button button-quiet"
                aria-expanded={filesOpen}
                aria-controls="files-panel"
                onClick={() => setFilesOpen((v) => !v)}
              >
                <Icon name="files" />
                Show files
              </button>
            )}
          </div>
          <div className="editor-body">
            <div
              ref={filesPanel}
              id="files-panel"
              className="files-panel"
              onKeyDown={(event) => {
                if (event.key === "Escape" && band !== "wide" && filesOpen) {
                  event.stopPropagation();
                  setFilesOpen(false);
                  showFiles.current?.focus();
                }
              }}
            >
              <FileTree
                files={fileList}
                selection={selection}
                activeId={activeFile}
                onSelect={setSelection}
                onOpen={(id) => {
                  void editor.current?.open(id);
                  if (band !== "wide") setFilesOpen(false);
                }}
              />
              <div className="file-actions">
                {canWrite && (
                  <button type="button" className="button button-quiet tool-button" title="New file" onClick={() => setDialog("new-file")}>
                    <Icon name="plus" />
                    <span className="visually-hidden">New file</span>
                  </button>
                )}
                {isMentor && (
                  <button
                    type="button"
                    className="button button-quiet tool-button"
                    title="Rename"
                    disabled={!selection}
                    onClick={() =>
                      selection &&
                      setRenaming(
                        selection.kind === "folder"
                          ? { kind: "folder", path: selection.path }
                          : { kind: "file", id: selection.id, path: files.get(selection.id)?.path ?? "" },
                      )
                    }
                  >
                    <Icon name="pencil" />
                    <span className="visually-hidden">Rename</span>
                  </button>
                )}
                {canWrite && (
                  <button type="button" className="button button-quiet tool-button" title="Delete file" disabled={!selectedFile} onClick={() => setDeleting(selectedFile)}>
                    <Icon name="trash" />
                    <span className="visually-hidden">Delete file</span>
                  </button>
                )}
                {isMentor && (
                  <button type="button" className="button button-quiet tool-button" title="Import zip" onClick={() => setDialog("import")}>
                    <Icon name="upload" />
                    <span className="visually-hidden">Import zip</span>
                  </button>
                )}
              </div>
            </div>
            <Editor
              ref={editor}
              projectId={projectId}
              files={files}
              canWrite={canWrite}
              notice={notice}
              followLabel={followLabel}
              participants={participants}
              cursors={cursors}
              me={user.id}
              landedDriver={running?.state === "live" ? landed : null}
              stripeFrom={stripeFrom}
              onCursor={sendCursor}
              onStopFollow={() => setFollowing(null)}
              statusEnd={
                <button
                  ref={ledgerButton}
                  type="button"
                  className="button button-quiet ledger-toggle"
                  aria-expanded={ledgerOpen}
                  aria-controls="ledger"
                  onClick={() => setLedgerOpen((v) => !v)}
                >
                  <Icon name="ledger" />
                  Ledger
                </button>
              }
              onActiveChange={(id) => {
                setActiveFile(id);
                if (id) setSelection((s) => (s?.kind === "folder" ? s : { kind: "file", id }));
              }}
            />
          </div>
          <div role="status" aria-label="Import status" className={importReport.text ? "import-status" : "import-status is-empty"}>
            {importReport.text}
            {importReport.lines && importReport.lines.length > 0 && (
              <ul className="import-lines">
                {importReport.lines.map((line, i) => (
                  <li key={i} className="mono">
                    {line}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
        <aside
          ref={ledgerPanel}
          id="ledger"
          className="ledger"
          aria-label="Checkpoint ledger"
          onKeyDown={(event) => {
            if (event.key === "Escape" && band !== "wide" && !(event.target as Element).closest("dialog")) {
              setLedgerOpen(false);
              ledgerButton.current?.focus();
            }
          }}
        >
          {band === "narrow" && (
            <div
              className="sheet-handle"
              aria-hidden="true"
              onPointerDown={(event) => {
                sheetDrag.current = event.clientY;
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerUp={(event) => {
                if (sheetDrag.current !== null && event.clientY - sheetDrag.current > 48) setLedgerOpen(false);
                sheetDrag.current = null;
              }}
            >
              <span />
            </div>
          )}
          <h2 className="ledger-title">Checkpoints</h2>
          <Ledger ref={ledger} checkpoints={checkpoints} files={files} projectId={projectId} isMentor={isMentor} canWrite={canWrite} onRestored={onRestored} />
        </aside>
      </main>
      {isMentor && (
        <>
          <MembersDialog
            open={dialog === "members"}
            onClose={() => setDialog(null)}
            project={project}
            members={participants}
          />
          <ScheduleDialog
            open={dialog === "schedule"}
            onClose={() => setDialog(null)}
            projectId={projectId}
            onScheduled={(s) => setSessions((list) => (list.some((x) => x.id === s.id) ? list : [...list, s]))}
          />
          <RenameDialog target={renaming} onClose={() => setRenaming(null)} projectId={projectId} />
          <ImportDialog
            open={dialog === "import"}
            onClose={() => setDialog(null)}
            projectId={projectId}
            onReport={setImportReport}
            onPlanned={(p) => {
              setDialog(null);
              setPlan(p);
            }}
          />
          <ReviewImportDialog plan={plan} onClose={() => setPlan(null)} onReport={setImportReport} onApplied={onRestored} />
        </>
      )}
      <NewFileDialog
        open={dialog === "new-file"}
        onClose={() => setDialog(null)}
        projectId={projectId}
        onCreated={(f) => {
          setFiles((map) => new Map(map).set(f.id, f));
          setSelection({ kind: "file", id: f.id });
          void editor.current?.open(f.id);
        }}
      />
      <DeleteDialog file={deleting} onClose={() => setDeleting(null)} projectId={projectId} />
    </div>
  );
}
