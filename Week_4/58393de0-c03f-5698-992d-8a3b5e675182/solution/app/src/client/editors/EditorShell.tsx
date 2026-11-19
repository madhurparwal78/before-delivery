import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { WifiOff } from "lucide-react";
import { copy } from "../../shared/copy";
import type { ProjectKind } from "../../shared/types";
import BlockLab from "../blocks/BlockLab";
import CircuitBench from "../circuit/CircuitBench";
import { useCountdown } from "../lib/countdown";
import { Link } from "../lib/router";
import { homePath, useSession } from "../lib/session";
import Workshop3D from "../workshop/Workshop3D";
import type { EditorController, EditorProps, ExportSource } from "./contract";
import { ExportDialog, type ExportReport } from "./ExportDialog";
import { HandInDialog } from "./HandInDialog";
import { Toolbar } from "./Toolbar";
import { useEditorSession, type EditorDocument, type EditorSession, type EditorTarget } from "./useEditorSession";
import "./editor-shell.css";

const BODIES: Record<ProjectKind, ComponentType<EditorProps>> = { "3d": Workshop3D, circuit: CircuitBench, blocks: BlockLab };
const TEXT_FIELDS = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";
const ACTIVATING = "button, a[href], summary, [role='button']";

interface ExportOpening {
  id: number;
  source: ExportSource;
  open: boolean;
}

interface WorkspaceProps {
  session: EditorSession;
  doc: EditorDocument;
}

function Workspace({ session, doc }: WorkspaceProps) {
  const kind = doc.snapshot.kind;
  const { account } = useSession();
  const student = account?.kind === "student";
  const countdown = useCountdown(account?.kind === "student" ? account.classroomId : null);
  const controllerRef = useRef<EditorController | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const exportButton = useRef<HTMLButtonElement>(null);
  const handInButton = useRef<HTMLButtonElement>(null);
  const [history, setHistory] = useState({ undo: false, redo: false });
  const [opening, setOpening] = useState<ExportOpening | null>(null);
  const [handingIn, setHandingIn] = useState(false);
  const [report, setReport] = useState<ExportReport>({
    state: "idle", format: kind === "circuit" ? "svg" : "stl", unit: "mm", triangleCount: null, bytes: null,
  });
  const { save } = session;
  const readOnly = session.freeze !== null;

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return undefined;
    const sync = () => setHistory({ undo: controller.canUndo(), redo: controller.canRedo() });
    sync();
    return controller.subscribe(sync);
  }, [doc.key]);

  useEffect(() => {
    const page = pageRef.current;
    if (!page) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save("manual");
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(TEXT_FIELDS)) return;
      if ((event.key === "Enter" || event.key === " ") && target?.closest(ACTIVATING)) return;
      if (controllerRef.current?.handleKey(event)) event.preventDefault();
    };
    page.addEventListener("keydown", onKeyDown);
    return () => page.removeEventListener("keydown", onKeyDown);
  }, [save]);

  const openExport = () => {
    const controller = controllerRef.current;
    if (!controller) return;
    setOpening((current) => ({ id: (current?.id ?? 0) + 1, source: controller.exportSource(), open: true }));
  };
  const closeExport = useCallback(() => setOpening((current) => (current ? { ...current, open: false } : current)), []);
  const Body = BODIES[kind];

  return (
    <div className="editor-page" data-field={kind} ref={pageRef}>
      <Toolbar
        kind={kind}
        name={session.name}
        onName={session.setName}
        onCommitName={session.commitName}
        indicator={session.indicator}
        readOnly={readOnly}
        canUndo={history.undo}
        canRedo={history.redo}
        onUndo={() => controllerRef.current?.undo()}
        onRedo={() => controllerRef.current?.redo()}
        onSave={() => void save("manual")}
        onExport={openExport}
        exportRef={exportButton}
        handIn={student ? { onClick: () => setHandingIn(true), countdown: countdown.text, buttonRef: handInButton } : null}
      />
      <div className="editor-body">
        <Body snapshot={doc.snapshot} documentKey={doc.key} readOnly={readOnly} onChange={session.onChange} controllerRef={controllerRef} />
      </div>
      <div
        id="qy-export"
        className="sr-only"
        aria-hidden="true"
        data-state={report.state}
        data-format={report.format}
        data-unit={report.unit}
        data-triangle-count={report.triangleCount ?? ""}
        data-bytes={report.bytes ?? ""}
      />
      {opening ? (
        <ExportDialog
          key={opening.id}
          source={opening.source}
          open={opening.open}
          name={session.name.trim() || session.project?.name || ""}
          projectId={session.exportProjectId}
          onClose={closeExport}
          returnFocus={() => exportButton.current}
          onReport={setReport}
        />
      ) : null}
      {student ? (
        <HandInDialog
          open={handingIn}
          projectName={session.project?.name ?? session.name}
          onConfirm={session.handIn}
          onClose={() => setHandingIn(false)}
          returnFocus={() => (readOnly ? exportButton.current : handInButton.current)}
        />
      ) : null}
    </div>
  );
}

function ProjectUnavailable({ onRetry }: { onRetry: () => void }) {
  const { account } = useSession();
  return (
    <div className="column section">
      <div className="empty-state">
        <WifiOff size={48} strokeWidth={1.25} aria-hidden="true" />
        <p>{copy.openStorage}</p>
        <div className="pill-row">
          <button type="button" className="pill" onClick={onRetry}>Try again</button>
          <Link className="pill pill--outline" to={account ? homePath(account) : "/"}>Back to home</Link>
        </div>
      </div>
    </div>
  );
}

function ProjectMissing() {
  const { account } = useSession();
  return (
    <div className="column section">
      <h1>{copy.projectNotFound}</h1>
      <p>This project does not exist, or it belongs to someone else.</p>
      <Link className="pill" to={account ? homePath(account) : "/"}>Back to home</Link>
    </div>
  );
}

interface EditorShellProps {
  target: EditorTarget;
  onCreated: (id: string) => void;
}

/** Opens the project named by `target` and shows the toolbar and the editor body for its kind. */
export function EditorShell({ target, onCreated }: EditorShellProps) {
  const [opened] = useState(target);
  const session = useEditorSession(opened, onCreated);
  if (session.phase === "missing") return <ProjectMissing />;
  if (session.phase === "unavailable") return <ProjectUnavailable onRetry={session.retry} />;
  if (session.phase !== "ready" || !session.doc) return <div className="editor-page" data-field={opened.kind} aria-busy="true" />;
  return <Workspace session={session} doc={session.doc} />;
}
