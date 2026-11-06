import { useEffect, useRef, useState } from "react";
import type { Member, Session, User } from "../../shared/types";
import type { FileWithContent } from "./state";
import { api, ApiCallError } from "../lib/api";
import { NewFileDialog, RenameFileDialog, RenameFolderDialog, DeleteDialog, ImportDialog, ReviewImportDialog } from "../components/file-dialogs";

interface TreeNode {
  name: string;
  path: string;
  file: FileWithContent | null;
  children: Map<string, TreeNode>;
}

function buildTree(files: FileWithContent[]): TreeNode {
  const root: TreeNode = { name: "", path: "", file: null, children: new Map() };
  for (const f of files) {
    const parts = f.path.split("/");
    let node = root;
    let acc = "";
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i] as string;
      acc = acc ? `${acc}/${part}` : part;
      const isFile = i === parts.length - 1;
      let child = node.children.get(part);
      if (!child) {
        child = { name: part, path: acc, file: isFile ? f : null, children: new Map() };
        node.children.set(part, child);
      } else if (isFile) {
        child.file = f;
      }
      node = child;
    }
  }
  return root;
}

export interface ImportPlanView {
  id: string;
  entries: { path: string; status: string; file_id: string | null }[];
  only_in_project: string[];
  ignored: string[];
  expires_at: string;
}

export function EditorPanel(props: {
  projectId: string;
  user: User;
  participants: Member[];
  files: FileWithContent[];
  setFiles: React.Dispatch<React.SetStateAction<FileWithContent[]>>;
  activeFileId: string | null;
  setActiveFileId: (id: string | null) => void;
  openTabs: string[];
  setOpenTabs: (ids: string[] | ((prev: string[]) => string[])) => void;
  canWrite: boolean;
  isMentor: boolean;
  session: Session | null;
  driverName: string;
  band: "narrow" | "medium" | "wide";
  selectedTreePath: string | null;
  setSelectedTreePath: (p: string | null) => void;
  editorStatus: string[];
  setEditorStatus: React.Dispatch<React.SetStateAction<string[]>>;
  sendCursor: (line: number, column: number) => void;
  followTarget: string | null;
  setFollowTarget: (id: string | null) => void;
  remoteCursors: Map<string, { path: string; line: number; column: number }>;
  loadFiles: () => Promise<FileWithContent[]>;
}): React.ReactElement {
  const {
    projectId, participants, files, setFiles, activeFileId, setActiveFileId,
    openTabs, setOpenTabs, canWrite, isMentor, session, driverName, band,
    selectedTreePath, setSelectedTreePath, setEditorStatus, sendCursor,
    followTarget, setFollowTarget, remoteCursors, loadFiles,
  } = props;
  const [filesOpen, setFilesOpen] = useState(false);
  const [newFileOpen, setNewFileOpen] = useState(false);
  const [renameFileOpen, setRenameFileOpen] = useState(false);
  const [renameFolderOpen, setRenameFolderOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FileWithContent | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [reviewPlan, setReviewPlan] = useState<ImportPlanView | null>(null);
  const [importStatus, setImportStatus] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const saveTimer = useRef<number | null>(null);
  const dirtyRef = useRef(false);
  const tree = buildTree(files);
  const activeFile = files.find((f) => f.id === activeFileId) ?? null;
  const filesOverlayOpen = band === "wide" ? true : filesOpen;

  // Follow: open the followed participant's file and keep their cursor line in view.
  useEffect(() => {
    if (!followTarget) return;
    const cursor = remoteCursors.get(followTarget);
    if (!cursor) return;
    const target = files.find((f) => f.path === cursor.path);
    if (target && target.id !== activeFileId) {
      setActiveFileId(target.id);
      setOpenTabs((prev) => (prev.includes(target.id) ? prev : [...prev, target.id]));
    }
    const el = textareaRef.current;
    if (el && target && target.id === activeFileId) {
      const lineHeight = 20;
      el.scrollTop = Math.max(0, (cursor.line - 3) * lineHeight);
    }
  }, [followTarget, remoteCursors, files, activeFileId, setActiveFileId, setOpenTabs]);

  const pushStatus = (line: string, predicate: (s: string) => boolean) => {
    setEditorStatus((prev) => [...prev.filter((s) => !predicate(s)), line].slice(-3));
  };

  const scheduleSave = () => {
    dirtyRef.current = true;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void (async () => {
        const file = files.find((f) => f.id === activeFileId);
        const text = textareaRef.current?.value;
        if (!file || text === undefined || !dirtyRef.current) return;
        dirtyRef.current = false;
        try {
          const res = await api<{ file: FileWithContent }>(
            "PUT",
            `/api/projects/${projectId}/files/${file.id}`,
            { content: text, base_revision: file.revision },
          );
          if (res.data?.file) {
            setFiles((prev) => prev.map((f) => (f.id === file.id ? { ...f, ...res.data!.file } : f)));
          }
        } catch (err) {
          if (err instanceof ApiCallError) {
            if (err.code === "stale_revision") {
              const r = await api<{ file: FileWithContent }>("GET", `/api/projects/${projectId}/files/${file.id}`);
              if (r.data?.file) {
                setFiles((prev) => prev.map((f) => (f.id === file.id ? { ...f, ...r.data!.file } : f)));
                if (textareaRef.current) textareaRef.current.value = r.data.file.content;
              }
              pushStatus(
                `A newer version of ${file.path} was saved. Your change wasn't applied — the editor now shows the latest version.`,
                (s) => s.startsWith("A newer version"),
              );
            } else if (err.code === "too_large") {
              pushStatus(`${file.path} is too large to save.`, (s) => s.endsWith("is too large to save."));
            } else if (err.code === "not_driver") {
              pushStatus(`You are viewing — ${driverName} is driving.`, (s) => s.startsWith("You are viewing"));
            } else if (err.code === "session_paused") {
              pushStatus("Session paused — editing resumes when the mentor resumes.", (s) => s.startsWith("Session paused"));
            } else {
              pushStatus("Something went wrong. Try again.", (s) => s === "Something went wrong. Try again.");
            }
          } else {
            pushStatus("Something went wrong. Try again.", (s) => s === "Something went wrong. Try again.");
          }
        }
      })();
    }, 500);
  };

  const followedName = followTarget
    ? (participants.find((p) => p.user_id === followTarget)?.name ?? "")
    : "";
  const followCursor = followTarget ? remoteCursors.get(followTarget) : undefined;

  const statusParts: string[] = [];
  if (session?.state === "paused") {
    statusParts.push("Session paused — editing resumes when the mentor resumes.");
  } else if (session?.state === "live" && !canWrite) {
    statusParts.push(`You are viewing — ${driverName} is driving.`);
  }
  if (followTarget && followCursor) {
    statusParts.push(`Following ${followedName} · ${followCursor.path}`);
  }
  statusParts.push(...props.editorStatus.filter((st) => !statusParts.includes(st)));

  const treeItems: { node: TreeNode; depth: number }[] = [];
  const walk = (node: TreeNode, depth: number) => {
    const children = [...node.children.values()].sort((a, b) => {
      const aFile = a.file ? 1 : 0;
      const bFile = b.file ? 1 : 0;
      if (aFile !== bFile) return aFile - bFile;
      return a.name.localeCompare(b.name);
    });
    for (const c of children) {
      treeItems.push({ node: c, depth });
      walk(c, depth + 1);
    }
  };
  walk(tree, 0);
  const selectedFile = selectedTreePath ? (files.find((f) => f.path === selectedTreePath) ?? null) : null;
  const selectedIsFolder = selectedTreePath !== null && !selectedFile;

  const onTreeKeyDown = (e: React.KeyboardEvent) => {
    const currentIdx = treeItems.findIndex((t) => t.node.path === (selectedTreePath ?? treeItems[0]?.node.path));
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const dir = e.key === "ArrowDown" ? 1 : -1;
      const base = currentIdx >= 0 ? currentIdx : 0;
      const next = treeItems[(base + dir + treeItems.length) % treeItems.length];
      if (next) setSelectedTreePath(next.node.path);
    } else if (e.key === "Enter") {
      const current = treeItems[currentIdx >= 0 ? currentIdx : 0];
      if (current?.node.file) openFile(current.node.file.id);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (followTarget && (e.key.length === 1 || e.key === "Backspace" || e.key === "Enter" || e.key === "Tab")) {
      setFollowTarget(null);
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const el = e.currentTarget;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      el.value = `${el.value.slice(0, start)}  ${el.value.slice(end)}`;
      el.selectionStart = el.selectionEnd = start + 2;
      scheduleSave();
    } else if (e.key === "Escape") {
      if (followTarget) setFollowTarget(null);
      else e.currentTarget.blur();
    } else if (e.key === "Enter" || e.key.length === 1 || e.key === "Backspace") {
      window.setTimeout(scheduleSave, 0);
    }
  };

  const onSelectLine = () => {
    const el = textareaRef.current;
    if (!el) return;
    const before = el.value.slice(0, el.selectionStart);
    const line = before.split("\n").length;
    const column = before.length - (before.lastIndexOf("\n") + 1) + 1;
    sendCursor(line, column);
  };

  const openFile = (id: string) => {
    setActiveFileId(id);
    setOpenTabs((prev) => (prev.includes(id) ? prev : [...prev, id]));
    const f = files.find((x) => x.id === id);
    if (f) setSelectedTreePath(f.path);
  };

  const closeTab = (id: string) => {
    setOpenTabs((prev) => prev.filter((t) => t !== id));
    if (activeFileId === id) {
      const remaining = openTabs.filter((t) => t !== id);
      setActiveFileId(remaining[remaining.length - 1] ?? null);
    }
  };

  return (
    <section className="editor-panel" id="editor-panel">
      {band !== "wide" ? (
        <button className="show-files" aria-expanded={filesOpen} onClick={() => setFilesOpen((v) => !v)}>
          Show files
        </button>
      ) : null}
      {filesOverlayOpen ? (
        <div className={`file-tree-wrap${band !== "wide" ? " overlay" : ""}`}>
          <div
            role="tree"
            aria-label="Files"
            className="file-tree"
            tabIndex={0}
            onKeyDown={onTreeKeyDown}
          >
            {treeItems.map(({ node, depth }) => (
              <div
                key={node.path}
                role="treeitem"
                aria-level={depth + 1}
                aria-selected={node.path === selectedTreePath}
                tabIndex={-1}
                className={`tree-item${node.path === selectedTreePath ? " selected" : ""}`}
                style={{ paddingLeft: `${depth * 12 + 8}px` }}
                onClick={() => setSelectedTreePath(node.path)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && node.file) openFile(node.file.id);
                }}
              >
                {node.file ? "· " : "▸ "}
                {node.name}
              </div>
            ))}
          </div>
          <div className="file-actions">
            <button onClick={() => setNewFileOpen(true)}>New file</button>
            {isMentor && selectedFile ? (
              <button onClick={() => setRenameFileOpen(true)}>Rename</button>
            ) : null}
            {isMentor && selectedIsFolder ? (
              <button onClick={() => setRenameFolderOpen(true)}>Rename</button>
            ) : null}
            <button
              onClick={() => {
                if (selectedFile) setDeleteTarget(selectedFile);
              }}
              disabled={!selectedFile}
            >
              Delete file
            </button>
            {isMentor ? <button onClick={() => setImportOpen(true)}>Import zip</button> : null}
          </div>
        </div>
      ) : null}
      <div className="editor-main">
        <div role="tablist" aria-label="Open files" className="open-tabs">
          {openTabs.map((id) => {
            const f = files.find((x) => x.id === id);
            if (!f) return null;
            return (
              <div
                key={id}
                role="tab"
                aria-selected={id === activeFileId}
                tabIndex={id === activeFileId ? 0 : -1}
                className={`tab${id === activeFileId ? " active" : ""}`}
                onClick={() => setActiveFileId(id)}
                onKeyDown={(e) => {
                  if (e.key === "Delete") {
                    e.preventDefault();
                    closeTab(id);
                  } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                    e.preventDefault();
                    const idx = openTabs.indexOf(id);
                    const nextIdx = (idx + (e.key === "ArrowRight" ? 1 : -1) + openTabs.length) % openTabs.length;
                    const next = openTabs[nextIdx];
                    if (next) {
                      setActiveFileId(next);
                      const el = (e.currentTarget.parentElement?.children[nextIdx] ?? undefined) as HTMLElement | undefined;
                      el?.focus();
                    }
                  }
                }}
              >
                <span className="tab-name">{f.path}</span>
                <button aria-label={`Close ${f.path}`} className="tab-close" onClick={(e) => { e.stopPropagation(); closeTab(id); }}>
                  ×
                </button>
              </div>
            );
          })}
        </div>
        <div className="code-area">
          {activeFile ? (
            <textarea
              ref={textareaRef}
              className="code-editor"
              aria-label="Code editor"
              aria-readonly={!canWrite}
              readOnly={!canWrite}
              key={`${activeFile.id}-${activeFile.revision}`}
              defaultValue={activeFile.content}
              onKeyDown={onKeyDown}
              onKeyUp={onSelectLine}
              onClick={() => setFollowTarget(null)}
              spellCheck={false}
            />
          ) : (
            <p className="serif empty">No file open</p>
          )}
        </div>
        <p className="status" role="status" aria-label="Editor status">
          {statusParts.join(" · ")}
        </p>
        <p className="status mono" role="status" aria-label="Import status">
          {importStatus}
        </p>
      </div>
      {newFileOpen ? (
        <NewFileDialog
          projectId={projectId}
          onClose={() => setNewFileOpen(false)}
          onCreated={(file) => {
            setNewFileOpen(false);
            setFiles((prev) => [...prev, file].sort((a, b) => a.path.localeCompare(b.path)));
            openFile(file.id);
          }}
        />
      ) : null}
      {renameFileOpen && selectedFile ? (
        <RenameFileDialog
          projectId={projectId}
          file={selectedFile}
          onClose={() => setRenameFileOpen(false)}
          onRenamed={(file) => {
            setRenameFileOpen(false);
            setFiles((prev) => prev.map((f) => (f.id === file.id ? { ...f, ...file } : f)));
            setSelectedTreePath(file.path);
          }}
        />
      ) : null}
      {renameFolderOpen && selectedTreePath ? (
        <RenameFolderDialog
          projectId={projectId}
          from={selectedTreePath}
          onClose={() => setRenameFolderOpen(false)}
          onRenamed={() => {
            setRenameFolderOpen(false);
            void loadFiles();
          }}
        />
      ) : null}
      {deleteTarget ? (
        <DeleteDialog
          file={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDelete={async () => {
            const f = deleteTarget;
            setDeleteTarget(null);
            try {
              await api("DELETE", `/api/projects/${projectId}/files/${f.id}`);
              setFiles((prev) => prev.filter((x) => x.id !== f.id));
              setOpenTabs((prev) => prev.filter((t) => t !== f.id));
              if (activeFileId === f.id) setActiveFileId(null);
              pushStatus(`${f.path} was deleted.`, (s) => s.endsWith("was deleted."));
            } catch (err) {
              if (err instanceof ApiCallError && err.code === "not_driver") {
                pushStatus(`You are viewing — ${driverName} is driving.`, (s) => s.startsWith("You are viewing"));
              } else {
                pushStatus("Something went wrong. Try again.", (s) => s === "Something went wrong. Try again.");
              }
            }
          }}
        />
      ) : null}
      {importOpen ? (
        <ImportDialog
          projectId={projectId}
          onClose={() => setImportOpen(false)}
          onPlanned={(plan, status) => {
            setImportOpen(false);
            setImportStatus(status);
            if (plan) setReviewPlan({ ...plan, expires_at: "" });
          }}
        />
      ) : null}
      {reviewPlan ? (
        <ReviewImportDialog
          projectId={projectId}
          plan={reviewPlan}
          onClose={() => setReviewPlan(null)}
          onApplied={(summary) => {
            setReviewPlan(null);
            setImportStatus(summary);
            void loadFiles();
          }}
        />
      ) : null}
    </section>
  );
}
