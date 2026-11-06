import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useMediaQuery, usePrefersReducedMotion } from "../lib/hooks";
import type { User, Member, Session, Checkpoint } from "../../shared/types";
import type { WorkspaceProject, FileWithContent, CheckpointRow } from "./state";
import { ProjectSocket } from "../lib/socket";
import { PresenceRail } from "./presence-rail";
import { EditorPanel } from "./editor";
import { LedgerPanel } from "./ledger";
import { SessionControls } from "./session-controls";

export function Workspace({
  projectId,
  user,
  navigate,
  accountSlot,
}: {
  projectId: string;
  user: User;
  navigate: (to: string) => void;
  accountSlot: React.ReactNode;
}): React.ReactElement {
  const [project, setProject] = useState<WorkspaceProject | null>(null);
  const [files, setFiles] = useState<FileWithContent[]>([]);
  const [checkpoints, setCheckpoints] = useState<CheckpointRow[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [participants, setParticipants] = useState<Member[]>([]);
  const [removed, setRemoved] = useState(false);
  const [wide] = useState(() => window.matchMedia("(min-width: 1280px)").matches);
  const [ledgerOpen, setLedgerOpen] = useState(wide);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [editorStatus, setEditorStatus] = useState<string[]>([]);
  const [followTarget, setFollowTarget] = useState<string | null>(null);
  const [selectedTreePath, setSelectedTreePath] = useState<string | null>(null);
  const [batonPass, setBatonPass] = useState<{ from: string | null; to: string } | null>(null);
  const socketRef = useRef<ProjectSocket | null>(null);
  const remoteCursors = useRef<Map<string, { path: string; line: number; column: number }>>(new Map());
  const activeFileIdRef = useRef<string | null>(null);
  activeFileIdRef.current = activeFileId;
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;
  const projectRef = useRef<WorkspaceProject | null>(null);
  projectRef.current = project;
  const reduced = usePrefersReducedMotion();
  const isWide = useMediaQuery("(min-width: 1280px)");
  const isMedium = useMediaQuery("(min-width: 768px)");
  const bandWidth: "narrow" | "medium" | "wide" = isWide ? "wide" : isMedium ? "medium" : "narrow";
  const [band, setBand] = useState<"narrow" | "medium" | "wide">(bandWidth);
  useEffect(() => setBand(bandWidth), [bandWidth]);

  const loadFiles = useCallback(async () => {
    const fileRes = await api<{ files: FileWithContent[] }>("GET", `/api/projects/${projectId}/files`);
    const metas = fileRes.data?.files ?? [];
    const detailed = await Promise.all(
      metas.map(async (f) => {
        const r = await api<{ file: FileWithContent }>("GET", `/api/projects/${projectId}/files/${f.id}`);
        return r.data?.file ?? f;
      }),
    );
    setFiles(detailed);
    return detailed;
  }, [projectId]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const proj = await api<{ project: WorkspaceProject }>("GET", `/api/projects/${projectId}`);
        if (!alive || !proj.data) return;
        setProject(proj.data.project);
        setSession(proj.data.project.sessions.find((s) => s.state === "live" || s.state === "paused") ?? null);
        const detailed = await loadFiles();
        const first = detailed.find((f) => f.path === "src/tip.js") ?? detailed[0];
        if (first) {
          setActiveFileId(first.id);
          setOpenTabs([first.id]);
          setSelectedTreePath(first.path);
        }
        const cpRes = await api<{ checkpoints: CheckpointRow[] }>("GET", `/api/projects/${projectId}/checkpoints`);
        if (alive && cpRes.data) setCheckpoints(cpRes.data.checkpoints);
      } catch {
        if (alive) navigate("/");
      }
    })();
    return () => {
      alive = false;
    };
  }, [projectId, loadFiles, navigate]);

  useEffect(() => {
    const prevDriverRef = { id: sessionRef.current?.driver_id ?? null };
    const socket = new ProjectSocket(
      projectId,
      (frame) => {
        const type = frame["type"] as string;
        if (type === "hello") {
          setSession((frame["session"] as Session | null) ?? null);
          setParticipants(frame["participants"] as Member[]);
        } else if (type === "presence") {
          setParticipants(frame["participants"] as Member[]);
        } else if (type === "session") {
          const next = frame["session"] as Session;
          const from = prevDriverRef.id;
          if (next.driver_id && from !== next.driver_id) {
            setBatonPass({ from, to: next.driver_id });
            if (reduced) {
              setBatonPass(null);
            } else {
              window.setTimeout(() => setBatonPass(null), 340);
            }
          }
          prevDriverRef.id = next.driver_id;
          setSession(next);
        } else if (type === "file") {
          const file = frame["file"] as { id: string; path: string; revision: number; sha256: string; size: number };
          setFiles((prev) => {
            const idx = prev.findIndex((f) => f.id === file.id);
            if (idx === -1) return [...prev, { ...file, content: "" }].sort((a, b) => a.path.localeCompare(b.path));
            const next = [...prev];
            next[idx] = { ...(next[idx] as FileWithContent), ...file } as FileWithContent;
            return next;
          });
          void (async () => {
            const r = await api<{ file: FileWithContent }>("GET", `/api/projects/${projectId}/files/${file.id}`);
            if (r.data?.file) {
              setFiles((prev) => prev.map((f) => (f.id === file.id ? ({ ...f, ...r.data!.file } as FileWithContent) : f)));
            }
          })();
        } else if (type === "file_deleted") {
          const id = frame["file_id"] as string;
          setFiles((prev) => prev.filter((f) => f.id !== id));
          setOpenTabs((prev) => prev.filter((t) => t !== id));
          setActiveFileId((prev) => (prev === id ? null : prev));
        } else if (type === "checkpoint") {
          const cp = frame["checkpoint"] as Checkpoint;
          setCheckpoints((prev) => {
            const idx = prev.findIndex((c) => c.id === cp.id);
            if (idx === -1) return [cp as CheckpointRow, ...prev];
            const next = [...prev];
            next[idx] = { ...(next[idx] as CheckpointRow), ...cp } as CheckpointRow;
            return next;
          });
        } else if (type === "cursor") {
          remoteCursors.current.set(frame["user_id"] as string, {
            path: frame["path"] as string,
            line: frame["line"] as number,
            column: frame["column"] as number,
          });
        } else if (type === "edit_rejected") {
          const code = frame["code"] as string;
          const fileId = frame["file_id"] as string;
          const current = frame["current_revision"] as number | undefined;
          if (code === "stale_revision" && current !== undefined) {
            setFiles((prev) => prev.map((f) => (f.id === fileId ? ({ ...f, revision: current } as FileWithContent) : f)));
            void (async () => {
              const r = await api<{ file: FileWithContent }>("GET", `/api/projects/${projectId}/files/${fileId}`);
              if (r.data?.file) {
                setFiles((prev) => prev.map((f) => (f.id === fileId ? ({ ...f, ...r.data!.file } as FileWithContent) : f)));
              }
            })();
            setEditorStatus((prev) => [
              ...prev.filter((s) => !s.startsWith("A newer version")),
              "A newer version was saved. Your change wasn't applied — the editor now shows the latest version.",
            ]);
          } else if (code === "not_driver") {
            setEditorStatus((prev) => [...prev.filter((s) => !s.startsWith("You are viewing")), `You are viewing — ${driverName()} is driving.`]);
          } else if (code === "session_paused") {
            setEditorStatus((prev) => [...prev.filter((s) => !s.startsWith("Session paused")), "Session paused — editing resumes when the mentor resumes."]);
          }
        }
      },
      () => {
        setRemoved(true);
        setEditorStatus((prev) => [...prev.filter((s) => !s.startsWith("You were removed")), "You were removed from this project."]);
        window.setTimeout(() => navigate("/"), 3000);
      },
      () => {
        // dropped sockets reconnect when the workspace remounts
      },
    );
    socket.connect();
    socketRef.current = socket;
    return () => {
      socket.close();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const driverName = (): string => {
    const driverId = sessionRef.current?.driver_id;
    return projectRef.current?.members.find((m) => m.user_id === driverId)?.name ?? "";
  };

  const canWrite =
    !session || session.state === "ended" || session.state === "scheduled"
      ? true
      : session.state === "paused"
        ? false
        : session.driver_id === user.id;
  const isMentor = project?.members.some((m) => m.user_id === user.id && m.role === "mentor") ?? false;

  const sendCursor = useCallback((line: number, column: number) => {
    const fileId = activeFileIdRef.current;
    const path = projectRef.current ? (files.find((f) => f.id === fileId)?.path ?? null) : null;
    socketRef.current?.send({ type: "cursor", file_id: fileId, path, line, column });
  }, [files]);

  if (removed) {
    return (
      <div className="removed-screen">
        <p role="status">You were removed from this project.</p>
      </div>
    );
  }

  return (
    <div className={`workspace band-${band}`}>
      <a href="#editor-panel" className="skip-link">
        Skip to editor
      </a>
      <header className="workspace-header">
        <div className="header-title">
          <div className="project-title">{project?.title ?? ""}</div>
          <h1 className="serif">{session?.title ?? "No session scheduled"}</h1>
        </div>
        <SessionControls
          project={project}
          session={session}
          setSession={setSession}
          isMentor={isMentor}
          accountSlot={accountSlot}
        />
      </header>
      <div className="workspace-body">
        <PresenceRail
          participants={participants}
          user={user}
          session={session}
          isMentor={isMentor}
          band={band}
          followTarget={followTarget}
          setFollowTarget={setFollowTarget}
          batonPass={batonPass}
          reduced={reduced}
        />
        <EditorPanel
          projectId={projectId}
          user={user}
          participants={participants}
          files={files}
          setFiles={setFiles}
          activeFileId={activeFileId}
          setActiveFileId={setActiveFileId}
          openTabs={openTabs}
          setOpenTabs={setOpenTabs}
          canWrite={canWrite}
          isMentor={isMentor}
          session={session}
          driverName={driverName()}
          band={band}
          selectedTreePath={selectedTreePath}
          setSelectedTreePath={setSelectedTreePath}
          editorStatus={editorStatus}
          setEditorStatus={setEditorStatus}
          sendCursor={sendCursor}
          followTarget={followTarget}
          setFollowTarget={setFollowTarget}
          remoteCursors={remoteCursors.current}
          loadFiles={loadFiles}
        />
        <LedgerPanel
          projectId={projectId}
          user={user}
          checkpoints={checkpoints}
          setCheckpoints={setCheckpoints}
          files={files}
          band={band}
          ledgerOpen={ledgerOpen}
          setLedgerOpen={setLedgerOpen}
          isMentor={isMentor}
          session={session}
          setActiveFileId={setActiveFileId}
          setOpenTabs={setOpenTabs}
          setSelectedTreePath={setSelectedTreePath}
          loadFiles={loadFiles}
        />
      </div>
    </div>
  );
}
