// `/projects/<id>/-/edit?ref=&path=`: the web editor. A live page. Open files keep their edits in tabs until one commit sends them
// all; unsaved text is kept in local storage; a stale base is reapplied with a three-way merge.
import "../styles/repo.css";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { Sheet } from "../a11y/dialog.tsx";
import { announce } from "../announce.tsx";
import { api, asApiError, idempotencyKey, useAction } from "../api.ts";
import { useBreakpoint } from "../hooks.ts";
import { addNavigationGuard, navigate, requestFocusOnArrival, setQuery, useRoute } from "../router.ts";
import { useProject } from "../role.ts";
import { useProjectLive } from "../live.ts";
import { LiveMain } from "../shell/main.tsx";
import { Button } from "../ui/button.tsx";
import { Notice, Skeleton } from "../ui/feedback.tsx";
import { Select, TextArea, TextField } from "../ui/fields.tsx";
import { useTitle } from "../ui/page.tsx";
import { asString, isRecord } from "../util.ts";
import { hasConflictMarkers } from "../../shared/merge.ts";
import { commitPath, loadFile, loadRefs, short } from "./repo/data.ts";
import { readDrafts, writeDrafts } from "./repo/drafts.ts";
import { actionsOf, describeAction, draftOf, isChanged, reapply, type Draft, type OpenFile } from "./repo/editor-model.ts";
import { FileTabs, PathDialog, UnsavedDialog, tabName } from "./repo/editor-parts.tsx";
import { RepoTitle } from "./repo/chrome.tsx";
import { FileTree } from "./repo/tree.tsx";
import type { Refs } from "./repo/types.ts";

const CONFLICT_TEXT = "Remove all conflict markers before committing.";

interface Say {
  tone: "error" | "warning" | "success";
  text: string;
}

async function readText(project: string, at: string, path: string): Promise<string | null> {
  try {
    return (await loadFile(project, at, path)).content;
  } catch (cause) {
    const failure = asApiError(cause);
    if (failure.status === 404) return null;
    throw failure;
  }
}

function headOf(refs: Refs | null, branch: string): string | null {
  return refs?.branches.find((candidate) => candidate.name === branch)?.commit ?? null;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function Editor({ id }: { id: string }) {
  const route = useRoute();
  const project = useProject();
  const phone = useBreakpoint() === "phone";
  const ref = route.query.get("ref") ?? project.defaultBranch ?? "";
  const requestedPath = route.query.get("path") ?? "";

  const [refs, setRefs] = useState<Refs | null>(null);
  const [at, setAt] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const [files, setFilesState] = useState<OpenFile[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailure, setLoadFailure] = useState<string | null>(null);
  const [newBranch, setNewBranch] = useState("");
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<Say | null>(null);
  const [stale, setStale] = useState(false);
  const [dialog, setDialog] = useState<"new" | "rename" | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [pendingTo, setPendingTo] = useState<string | null>(null);

  const filesRef = useRef<OpenFile[]>([]);
  const refsRef = useRef<Refs | null>(null);
  const nextKey = useRef(1);
  const ready = useRef(false);
  const committed = useRef(false);
  const focusKey = useRef<number | null>(null);
  const serverAnnounced = useRef(false);

  useProjectLive(id, (live) => {
    if ((live.data.say ?? []).some((say) => say.text.startsWith("Committed "))) serverAnnounced.current = true;
  });

  const setFiles = (next: OpenFile[]): void => {
    filesRef.current = next;
    setFilesState(next);
    if (ready.current) {
      const wanted = new Map<string, Draft>();
      for (const file of next) {
        const draft = draftOf(file);
        if (draft) wanted.set(file.path, draft);
      }
      writeDrafts(id, ref, wanted);
    }
  };
  const applyRefs = (next: Refs): void => {
    refsRef.current = next;
    setRefs(next);
  };
  const changeFile = (key: number, change: (file: OpenFile) => OpenFile): void => {
    setFiles(filesRef.current.map((file) => (file.key === key ? change(file) : file)));
  };

  useLayoutEffect(
    () =>
      addNavigationGuard((to) => {
        if (committed.current || !filesRef.current.some(isChanged)) return true;
        setPendingTo(to);
        return false;
      }),
    [],
  );

  useLayoutEffect(() => {
    if (ref === "") return;
    let alive = true;
    ready.current = false;
    setLoading(true);
    void (async () => {
      try {
        const fetched = await loadRefs(id);
        const branch = fetched.branches.find((candidate) => candidate.name === ref);
        const tag = fetched.tags.find((candidate) => candidate.name === ref);
        const commitId = branch?.commit ?? tag?.commit ?? (fetched.branches.length === 0 ? null : ref);
        const drafts = readDrafts(id, ref);
        const paths = [...new Set([...(requestedPath === "" ? [] : [requestedPath]), ...drafts.keys()])];
        const opened: OpenFile[] = [];
        let restored = 0;
        for (const path of paths) {
          const draft = drafts.get(path);
          const original = draft?.created === true || commitId === null ? null : await readText(id, commitId, path);
          if (original === null && draft === undefined) throw new Error(`File ${path} does not exist.`);
          const text = draft?.text ?? original ?? "";
          if (draft !== undefined && (original === null || draft.text !== original)) restored++;
          opened.push({
            key: nextKey.current++,
            path,
            originPath: original === null ? null : path,
            original,
            text,
            deleted: false,
            conflicted: false,
          });
        }
        if (!alive) return;
        refsRef.current = fetched;
        setRefs(fetched);
        setAt(commitId);
        const defaultBranch = project.defaultBranch ?? ref;
        setTarget(
          branch
            ? ref
            : (fetched.branches.find((candidate) => candidate.name === defaultBranch)?.name ?? fetched.branches[0]?.name ?? defaultBranch),
        );
        filesRef.current = opened;
        setFilesState(opened);
        setActive((opened.find((file) => file.path === requestedPath) ?? opened[0])?.key ?? null);
        ready.current = true;
        setLoading(false);
        if (restored > 0) announce(`Restored unsaved changes in ${restored} ${plural(restored, "file", "files")}.`);
      } catch (cause) {
        if (!alive) return;
        setLoadFailure(asApiError(cause).message);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, ref]);

  const activeFile = files.find((file) => file.key === active) ?? null;
  const activeOrigin = activeFile?.originPath ?? null;
  useLayoutEffect(() => {
    if (!ready.current || (route.query.get("path") ?? "") === (activeOrigin ?? "")) return;
    setQuery({ path: activeOrigin }, { replace: true });
  }, [activeOrigin]);

  const openFromTree = async (path: string): Promise<void> => {
    setDrawer(false);
    const existing = filesRef.current.find((file) => file.originPath === path || file.path === path);
    if (existing) {
      setActive(existing.key);
      return;
    }
    if (at === null) return;
    try {
      const body = await loadFile(id, at, path);
      const again = filesRef.current.find((file) => file.originPath === path);
      if (again) {
        setActive(again.key);
        return;
      }
      const file: OpenFile = {
        key: nextKey.current++,
        path,
        originPath: path,
        original: body.content,
        text: body.content,
        deleted: false,
        conflicted: false,
      };
      setFiles([...filesRef.current, file]);
      setActive(file.key);
    } catch (cause) {
      setNotice({ tone: "error", text: asApiError(cause).message });
    }
  };

  const takenBy = (path: string, except: number | null): boolean =>
    filesRef.current.some((file) => file.key !== except && file.path === path && !file.deleted);
  const cleanPath = (raw: string): string => raw.trim().replace(/^\/+/, "");

  const addFile = (raw: string): string | null => {
    const path = cleanPath(raw);
    if (path === "") return "File path can't be blank.";
    if (takenBy(path, null)) return `File ${path} already exists.`;
    const file: OpenFile = { key: nextKey.current++, path, originPath: null, original: null, text: "", deleted: false, conflicted: false };
    focusKey.current = file.key;
    setFiles([...filesRef.current, file]);
    setActive(file.key);
    setDialog(null);
    return null;
  };

  const renameActive = (raw: string): string | null => {
    if (!activeFile) return null;
    const path = cleanPath(raw);
    if (path === "") return "File path can't be blank.";
    if (takenBy(path, activeFile.key)) return `File ${path} already exists.`;
    changeFile(activeFile.key, (file) => ({ ...file, path }));
    setDialog(null);
    return null;
  };

  const removeActive = (): void => {
    if (!activeFile) return;
    if (activeFile.originPath === null) {
      const index = filesRef.current.findIndex((file) => file.key === activeFile.key);
      const rest = filesRef.current.filter((file) => file.key !== activeFile.key);
      setFiles(rest);
      setActive((rest[Math.min(index, rest.length - 1)] ?? null)?.key ?? null);
    } else {
      changeFile(activeFile.key, (file) => ({ ...file, deleted: true }));
    }
  };

  const send = useAction(
    async () => {
      setNotice(null);
      setFieldErrors({});
      const current = filesRef.current;
      const actions = actionsOf(current);
      if (actions.length === 0) {
        const text = "There are no changes to commit.";
        setNotice({ tone: "error", text });
        announce(text, "error");
        return;
      }
      if (current.some((file) => !file.deleted && hasConflictMarkers(file.text))) {
        setNotice({ tone: "error", text: CONFLICT_TEXT });
        announce(CONFLICT_TEXT, "error");
        return;
      }
      const branch = newBranch.trim();
      const body = {
        branch: branch === "" ? target : branch,
        ...(branch === "" ? {} : { start_ref: target }),
        base_commit: headOf(refsRef.current, target),
        message,
        actions,
      };
      try {
        const result: unknown = await api.post(`/api/projects/${id}/commits`, body, { idempotencyKey: idempotencyKey() });
        const commit = isRecord(result) ? asString(result.commit) : null;
        if (commit === null) return;
        writeDrafts(id, ref, new Map());
        committed.current = true;
        if (!serverAnnounced.current) announce(`Committed ${short(commit)} to ${body.branch}.`);
        const where = commitPath(id, commit);
        requestFocusOnArrival(where);
        navigate(where, { force: true });
      } catch (cause) {
        const failure = asApiError(cause);
        const fields = failure.status === 422 ? failure.fieldErrors() : {};
        announce(failure.message, "error");
        setStale(failure.code === "stale_base");
        if (fields["message"] !== undefined || fields["branch"] !== undefined) setFieldErrors(fields);
        else setNotice({ tone: "error", text: failure.message });
      }
    },
    { announce: false },
  );

  const refresh = useAction(
    async () => {
      setNotice(null);
      try {
        const fresh = await loadRefs(id);
        applyRefs(fresh);
        const head = headOf(fresh, target);
        const next: OpenFile[] = [];
        for (const file of filesRef.current) {
          const ours = head === null ? null : await readText(id, head, file.originPath ?? file.path);
          const moved = reapply(file, ours, target);
          if (moved) next.push(moved);
        }
        setFiles(next);
        setStale(false);
        if (target === ref) setAt(head);
        const clashes = next.filter((file) => file.conflicted).length;
        const text =
          clashes > 0
            ? `${clashes} ${plural(clashes, "file conflicts", "files conflict")} with ${target}. Resolve the markers, then commit.`
            : `Your changes are reapplied on ${target} at ${head === null ? "none" : short(head)}.`;
        setNotice({ tone: clashes > 0 ? "warning" : "success", text });
        announce(text);
      } catch (cause) {
        const failure = asApiError(cause);
        setNotice({ tone: "error", text: failure.message });
        announce(failure.message, "error");
      }
    },
    { announce: false },
  );

  if (loadFailure !== null) return <Notice>{loadFailure}</Notice>;
  if (loading) return <Skeleton rows={8} height={40} />;

  const branches = refs?.branches ?? [];
  const targetNames = branches.length === 0 ? [target] : branches.map((branch) => branch.name);
  const changes = actionsOf(files);
  const conflicting = (file: OpenFile): boolean => file.conflicted && hasConflictMarkers(file.text);
  const tree =
    at === null ? (
      <p class="sp-tree__empty">This project has no files yet.</p>
    ) : (
      <FileTree project={id} at={at} selected={activeOrigin ?? ""} reveal={[]} onOpenFile={(path) => void openFromTree(path)} />
    );

  return (
    <>
      <div class="sp-editor__toolbar">
        {phone ? (
          <Button variant="secondary" onClick={() => setDrawer(true)}>
            Show files
          </Button>
        ) : null}
        <Button variant="secondary" onClick={() => setDialog("new")}>
          New file
        </Button>
      </div>
      <div class="sp-editor">
        {phone ? (
          <Sheet name="Files" open={drawer} onClose={() => setDrawer(false)}>
            {tree}
          </Sheet>
        ) : (
          <div data-landmark="files" class="sp-editor__side">
            {tree}
          </div>
        )}
        <div class="sp-editor__main">
          {files.length === 0 ? (
            <p class="sp-repo-hint">No file is open. Pick one in the tree or add a new file.</p>
          ) : (
            <>
              <FileTabs files={files} active={active} conflicting={conflicting} onSelect={setActive} />
              {activeFile ? (
                <div
                  role="tabpanel"
                  id={`editor-panel-${activeFile.key}`}
                  aria-labelledby={`editor-tab-${activeFile.key}`}
                  class="sp-editor__panel"
                >
                  <div class="sp-filebar">
                    <span class="sp-filebar__path">{tabName(activeFile, false)}</span>
                    <span class="sp-filebar__links">
                      <Button variant="secondary" disabled={activeFile.deleted} onClick={() => setDialog("rename")}>
                        {`Rename ${activeFile.path}`}
                      </Button>
                      <Button variant="danger" disabled={activeFile.deleted} onClick={removeActive}>
                        {`Delete ${activeFile.path}`}
                      </Button>
                    </span>
                  </div>
                  {activeFile.deleted ? (
                    <div class="sp-editor__deleted">
                      <p>The commit will delete this file.</p>
                      <Button variant="secondary" onClick={() => changeFile(activeFile.key, (file) => ({ ...file, deleted: false }))}>
                        Undo delete
                      </Button>
                    </div>
                  ) : (
                    <textarea
                      key={activeFile.key}
                      ref={(element) => {
                        if (element && focusKey.current === activeFile.key) {
                          focusKey.current = null;
                          element.focus();
                        }
                      }}
                      class="sp-editor__text"
                      aria-label={`Edit ${activeFile.path}`}
                      spellcheck={false}
                      wrap="off"
                      value={activeFile.text}
                      onInput={(event) => {
                        const text = event.currentTarget.value;
                        changeFile(activeFile.key, (file) => ({ ...file, text }));
                      }}
                    />
                  )}
                </div>
              ) : null}
            </>
          )}
          <section class="sp-editor__commit" aria-label="Changes">
            {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
            <div class="sp-editor__commit-body">
              <h2 class="sp-editor__commit-title">
                {changes.length === 0 ? "No changes yet" : plural(changes.length, "1 change", `${changes.length} changes`)}
              </h2>
              {changes.length > 0 ? (
                <ul class="sp-editor__changes">
                  {changes.map((action) => (
                    <li key={`${action.action}:${action.path}`}>{describeAction(action)}</li>
                  ))}
                </ul>
              ) : null}
              <form
                class="sp-editor__form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void send.run();
                }}
              >
                <Select
                  label="Target branch"
                  name="target-branch"
                  value={target}
                  onChange={(event) => setTarget(event.currentTarget.value)}
                >
                  {targetNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </Select>
                <TextField
                  label="New branch name"
                  name="new-branch-name"
                  value={newBranch}
                  error={fieldErrors["branch"] ?? null}
                  autoComplete="off"
                  onInput={(event) => setNewBranch(event.currentTarget.value)}
                />
                <TextArea
                  label="Commit message"
                  name="commit-message"
                  rows={3}
                  value={message}
                  error={fieldErrors["message"] ?? null}
                  onInput={(event) => setMessage(event.currentTarget.value)}
                />
                <div class="sp-editor__form-actions">
                  <Button type="submit" pending={send.pending}>
                    Commit
                  </Button>
                  {stale ? (
                    <Button variant="secondary" pending={refresh.pending} onClick={() => void refresh.run()}>
                      Refresh and reapply
                    </Button>
                  ) : null}
                </div>
              </form>
            </div>
          </section>
        </div>
      </div>
      {dialog === "new" ? (
        <PathDialog name="New file" field="File path" submit="Add file" initial="" onSubmit={addFile} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "rename" && activeFile ? (
        <PathDialog
          name="Rename file"
          field="File path"
          submit="Rename"
          initial={activeFile.path}
          onSubmit={renameActive}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {pendingTo !== null ? (
        <UnsavedDialog
          onKeep={() => setPendingTo(null)}
          onDiscard={() => {
            const to = pendingTo;
            writeDrafts(id, ref, new Map());
            committed.current = true;
            setPendingTo(null);
            navigate(to, { force: true });
          }}
        />
      ) : null}
    </>
  );
}

export default function EditPage() {
  const { id } = useRoute().params;
  useTitle("Edit");
  return (
    <LiveMain project={id} pageKeys={["project"]} class="sp-repo-page">
      <div class="sp-container">
        <RepoTitle title="Edit" />
        <Editor id={id} />
      </div>
    </LiveMain>
  );
}
