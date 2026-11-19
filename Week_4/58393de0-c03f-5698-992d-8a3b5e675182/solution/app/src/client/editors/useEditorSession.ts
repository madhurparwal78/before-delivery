import { useCallback, useEffect, useRef, useState } from "react";
import { copy } from "../../shared/copy";
import { isValidName } from "../../shared/rules";
import type { Classroom, Project, ProjectKind, Snapshot, StudentClassroomView } from "../../shared/types";
import { api, ApiError } from "../lib/api";
import { useConfig } from "../lib/config";
import { REMOVED_NOTICE_ID, useNotices, type NoticeAction } from "../lib/notices";
import { useSession } from "../lib/session";
import { useStatus } from "../lib/status";
import { useStreamEvent } from "../lib/stream";
import { starterSnapshot } from "../starters";
import { blankSnapshot, DEFAULT_NAMES } from "./blank";
import { clearKept, keptKey, readKept, writeKept, type KeptEdits } from "./kept";

type Phase = "loading" | "ready" | "missing" | "unavailable";
/** Why the document cannot be edited: its classroom or the Student handed it in, or someone else owns it. */
type Freeze = "classroom" | "project" | "viewing";

export interface EditorTarget {
  /** The project to open; null for a new design. */
  id: string | null;
  kind: ProjectKind;
  starter: string | null;
}

export interface EditorDocument {
  snapshot: Snapshot;
  key: number;
}

export const NOTICE = {
  stale: "stale",
  handedIn: "handed-in",
  unverified: "unverified-save",
  saveFailed: "save-failed",
  storageDown: "storage-down",
  openFailed: "open-failed",
  exportFailed: "export-failed",
  kept: "kept-edits",
  viewing: "viewing",
  removed: REMOVED_NOTICE_ID,
} as const;

type SaveOrigin = "manual" | "auto";
type LoadedProject = { project: Project; snapshot: Snapshot };

function randomKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : copy.serverError;
}

/**
 * Everything the editor shell does with the stored project: opening it, saving (by hand or after a pause),
 * the stale-tab and read-only states, kept edits in this browser, and live updates from other tabs.
 */
export function useEditorSession(target: EditorTarget, onCreated: (id: string) => void) {
  const { announce } = useStatus();
  const { setNotice, clearNotice } = useNotices();
  const { account } = useSession();
  const { autosaveMs } = useConfig();
  const { kind } = target;

  const [phase, setPhase] = useState<Phase>("loading");
  const [attempt, setAttempt] = useState(0);
  const [project, setProject] = useState<Project | null>(null);
  const [doc, setDoc] = useState<EditorDocument | null>(null);
  const [name, setNameState] = useState(DEFAULT_NAMES[kind]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [freeze, setFreeze] = useState<Freeze | null>(null);

  const projectRef = useRef<Project | null>(null);
  const latest = useRef<Snapshot | null>(null);
  const edits = useRef({ made: 0, saved: 0 });
  const nameRef = useRef(name);
  const committedName = useRef(name);
  const freezeRef = useRef<Freeze | null>(null);
  const timer = useRef<number | null>(null);
  const running = useRef<Promise<boolean> | null>(null);
  const waiting = useRef<Promise<boolean> | null>(null);
  const attemptKey = useRef<{ signature: string; key: string } | null>(null);
  const lateRevision = useRef(0);
  const reloading = useRef(false);
  const prefetched = useRef<LoadedProject | null>(null);

  const accountRef = useRef(account);
  accountRef.current = account;
  const createdRef = useRef(onCreated);
  createdRef.current = onCreated;

  const hasUnsaved = useCallback(() => edits.current.made !== edits.current.saved
    || (isValidName(nameRef.current) && nameRef.current.trim() !== (projectRef.current?.name ?? DEFAULT_NAMES[kind])), [kind]);

  /** Posts the notice and its copy to Status again even when the same notice already stands. */
  const raise = useCallback((id: string, message: string, actions?: NoticeAction[]) => {
    clearNotice(id);
    setNotice({ id, message, actions });
  }, [clearNotice, setNotice]);

  const cancelTimer = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const persistKept = useCallback(() => {
    if (latest.current) writeKept(keptKey(projectRef.current?.id ?? null, kind), { snapshot: latest.current, name: nameRef.current });
  }, [kind]);

  const install = useCallback((next: Project | null, snapshot: Snapshot, nextName: string, startDirty: boolean) => {
    projectRef.current = next;
    setProject(next);
    latest.current = snapshot;
    edits.current = { made: startDirty ? 1 : 0, saved: 0 };
    setDirty(startDirty);
    nameRef.current = nextName;
    committedName.current = nextName;
    setNameState(nextName);
    cancelTimer();
    setDoc((current) => ({ snapshot, key: (current?.key ?? 0) + 1 }));
  }, [cancelTimer]);

  const freezeWith = useCallback((reason: Freeze, nickname: string | null = null) => {
    if (freezeRef.current) return;
    freezeRef.current = reason;
    setFreeze(reason);
    cancelTimer();
    clearNotice(NOTICE.stale);
    if (reason === "viewing") raise(NOTICE.viewing, copy.viewingStudentProject(nickname));
    else raise(NOTICE.handedIn, reason === "classroom" ? copy.classroomHandedIn : copy.projectHandedIn);
  }, [cancelTimer, clearNotice, raise]);

  const adopt = useCallback((loaded: LoadedProject) => {
    prefetched.current = null;
    clearKept(keptKey(loaded.project.id, kind));
    install(loaded.project, loaded.snapshot, loaded.project.name, false);
    clearNotice(NOTICE.stale);
    clearNotice(NOTICE.kept);
  }, [clearNotice, install, kind]);

  /** Fetches the newest stored revision ahead of time so that Reload can swap it in at once. */
  const prefetchLatest = useCallback(async () => {
    const current = projectRef.current;
    if (!current) return;
    try {
      prefetched.current = await api.get<LoadedProject>(`/api/projects/${current.id}`);
    } catch {
      prefetched.current = null;
    }
  }, []);

  const reloadLatest = useCallback(async () => {
    const current = projectRef.current;
    if (!current || reloading.current) return;
    if (prefetched.current && prefetched.current.project.revision > current.revision) {
      adopt(prefetched.current);
      return;
    }
    reloading.current = true;
    try {
      adopt(await api.get<LoadedProject>(`/api/projects/${current.id}`));
    } catch (error) {
      announce(messageOf(error));
    } finally {
      reloading.current = false;
    }
  }, [adopt, announce]);

  const failSave = useCallback((error: unknown, origin: SaveOrigin) => {
    const post = origin === "manual" ? raise : (id: string, message: string, actions?: NoticeAction[]) => setNotice({ id, message, actions });
    if (!(error instanceof ApiError)) {
      announce(copy.serverError);
      return;
    }
    switch (error.code) {
      case "stale_revision":
        void prefetchLatest();
        post(NOTICE.stale, copy.staleRevision, [{ label: "Reload", onClick: () => void reloadLatest() }]);
        break;
      case "classroom_handed_in":
        freezeWith("classroom");
        break;
      case "project_handed_in":
        freezeWith("project");
        break;
      case "email_unverified":
        post(NOTICE.unverified, copy.unverifiedSave);
        break;
      case "storage_unavailable":
        post(NOTICE.saveFailed, copy.saveStorage);
        post(NOTICE.storageDown, copy.storageDown);
        break;
      default:
        announce(error.message);
    }
  }, [announce, freezeWith, prefetchLatest, raise, reloadLatest, setNotice]);

  const run = useCallback(async (origin: SaveOrigin): Promise<boolean> => {
    if (freezeRef.current || !latest.current) return false;
    if (origin === "auto" && !hasUnsaved()) return true;
    const seq = edits.current.made;
    const snapshot = latest.current;
    const saveName = isValidName(nameRef.current) ? nameRef.current.trim() : committedName.current;
    const existing = projectRef.current;
    setSaving(true);
    try {
      let saved: Project;
      if (existing) {
        const body = { baseRevision: existing.revision, snapshot, name: saveName };
        const signature = JSON.stringify(body);
        if (attemptKey.current?.signature !== signature) attemptKey.current = { signature, key: randomKey() };
        saved = (await api.put<{ project: Project }>(`/api/projects/${existing.id}`, body, { "Idempotency-Key": attemptKey.current.key })).project;
      } else {
        saved = (await api.post<{ project: Project }>("/api/projects", { kind, name: saveName, snapshot })).project;
      }
      attemptKey.current = null;
      prefetched.current = null;
      projectRef.current = saved;
      setProject(saved);
      committedName.current = saved.name;
      if (!existing) clearKept(keptKey(null, kind));
      if (edits.current.made === seq) {
        edits.current.saved = seq;
        setDirty(false);
        clearKept(keptKey(saved.id, kind));
      } else {
        persistKept();
      }
      if (origin === "manual") announce(copy.savedRevision(saved.revision));
      for (const id of [NOTICE.stale, NOTICE.saveFailed, NOTICE.storageDown, NOTICE.unverified, NOTICE.kept]) clearNotice(id);
      if (!existing) createdRef.current(saved.id);
      if (lateRevision.current > saved.revision && !hasUnsaved()) void reloadLatest();
      lateRevision.current = 0;
      return true;
    } catch (error) {
      failSave(error, origin);
      return false;
    } finally {
      setSaving(false);
    }
  }, [announce, clearNotice, failSave, hasUnsaved, kind, persistKept, reloadLatest]);

  /** Saves now (a new revision even when nothing changed). A save asked for during another one runs right after it. */
  const save = useCallback((origin: SaveOrigin = "manual"): Promise<boolean> => {
    if (!running.current) {
      const started = run(origin).finally(() => { running.current = null; });
      running.current = started;
      return started;
    }
    if (!waiting.current) {
      waiting.current = running.current.then(() => {
        waiting.current = null;
        return save(origin);
      });
    }
    return waiting.current;
  }, [run]);

  const scheduleAutosave = useCallback(() => {
    cancelTimer();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void save("auto");
    }, autosaveMs);
  }, [autosaveMs, cancelTimer, save]);

  const onChange = useCallback((next: Snapshot) => {
    if (freezeRef.current) return;
    clearNotice(NOTICE.kept);
    latest.current = next;
    edits.current.made += 1;
    setDirty(true);
    persistKept();
    scheduleAutosave();
  }, [clearNotice, persistKept, scheduleAutosave]);

  const setName = useCallback((value: string) => {
    nameRef.current = value;
    setNameState(value);
  }, []);

  /** A blank or too long name goes back to the last good one; a good one is kept for the next save. */
  const commitName = useCallback(() => {
    if (isValidName(nameRef.current)) {
      committedName.current = nameRef.current.trim();
      persistKept();
    }
    setName(committedName.current);
  }, [persistKept, setName]);

  const handIn = useCallback(async (): Promise<boolean> => {
    if (!projectRef.current && !(await save("manual"))) return false;
    const current = projectRef.current;
    if (!current) return false;
    try {
      const handed = (await api.post<{ project: Project }>(`/api/projects/${current.id}/hand-in`)).project;
      projectRef.current = handed;
      setProject(handed);
      announce(copy.handedIn(handed.name));
      freezeWith("project");
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.code === "classroom_handed_in") freezeWith("classroom");
      else if (error instanceof ApiError && error.code === "project_handed_in") freezeWith("project");
      else announce(messageOf(error));
      return false;
    }
  }, [announce, freezeWith, save]);

  const offerKept = useCallback((key: string, loadedSnapshot: Snapshot, loadedName: string) => {
    const kept: KeptEdits | null = readKept(key);
    if (!kept) return;
    if (kept.name === loadedName && JSON.stringify(kept.snapshot) === JSON.stringify(loadedSnapshot)) {
      clearKept(key);
      return;
    }
    raise(NOTICE.kept, copy.keptEdits, [
      {
        label: "Restore",
        onClick: () => {
          install(projectRef.current, kept.snapshot, kept.name, true);
          clearNotice(NOTICE.kept);
          scheduleAutosave();
        },
      },
      {
        label: "Discard",
        onClick: () => {
          clearKept(key);
          clearNotice(NOTICE.kept);
        },
      },
    ]);
  }, [clearNotice, install, raise, scheduleAutosave]);

  /** Who may not edit this project and why, decided once when it opens. */
  const decideFreeze = useCallback(async (loaded: Project): Promise<{ reason: Freeze; nickname: string | null } | null> => {
    const viewer = accountRef.current;
    if (viewer && viewer.kind !== "student" && loaded.ownerId !== viewer.id) {
      let nickname: string | null = null;
      if (loaded.classroomId) {
        try {
          const classroom = await api.get<Classroom>(`/api/classrooms/${loaded.classroomId}`);
          nickname = classroom.students.find((student) => student.id === loaded.ownerId)?.nickname ?? null;
        } catch {
          nickname = null;
        }
      }
      return { reason: "viewing", nickname };
    }
    if (loaded.state !== "handed_in") return null;
    try {
      const view = await api.get<StudentClassroomView>("/api/class");
      return { reason: view.state === "handed_in" || view.state === "archived" ? "classroom" : "project", nickname: null };
    } catch {
      return { reason: "project", nickname: null };
    }
  }, []);

  const open = useCallback(async (isCancelled: () => boolean) => {
    if (target.id === null) {
      const starter = target.starter ? starterSnapshot(target.starter) : null;
      const snapshot = starter && starter.kind === kind ? starter : blankSnapshot(kind);
      install(null, snapshot, DEFAULT_NAMES[kind], snapshot === starter);
      offerKept(keptKey(null, kind), snapshot, DEFAULT_NAMES[kind]);
      setPhase("ready");
      return;
    }
    try {
      const loaded = await api.get<LoadedProject>(`/api/projects/${target.id}`);
      const frozen = await decideFreeze(loaded.project);
      if (isCancelled()) return;
      install(loaded.project, loaded.snapshot, loaded.project.name, false);
      if (frozen) freezeWith(frozen.reason, frozen.nickname);
      else offerKept(keptKey(loaded.project.id, kind), loaded.snapshot, loaded.project.name);
      setPhase("ready");
    } catch (error) {
      if (isCancelled()) return;
      if (error instanceof ApiError && error.code === "not_found") {
        announce(copy.projectNotFound);
        setPhase("missing");
      } else if (error instanceof ApiError && error.code === "storage_unavailable") {
        raise(NOTICE.openFailed, copy.openStorage);
        setPhase("unavailable");
      } else {
        announce(messageOf(error));
        setPhase("unavailable");
      }
    }
  }, [announce, decideFreeze, freezeWith, install, kind, offerKept, raise, target.id, target.starter]);
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    let cancelled = false;
    setPhase("loading");
    clearNotice(NOTICE.openFailed);
    void openRef.current(() => cancelled);
    return () => { cancelled = true; };
  }, [attempt, clearNotice]);

  useEffect(() => () => {
    cancelTimer();
    for (const id of Object.values(NOTICE)) clearNotice(id);
  }, [cancelTimer, clearNotice]);

  useStreamEvent("project-saved", (event) => {
    const current = projectRef.current;
    if (!current || event.projectId !== current.id || event.revision <= current.revision) return;
    if (running.current) {
      lateRevision.current = Math.max(lateRevision.current, event.revision);
      return;
    }
    if (hasUnsaved()) void prefetchLatest();
    else void reloadLatest();
  });

  useStreamEvent("project-handed-in", (event) => {
    if (event.projectId === projectRef.current?.id) freezeWith("project");
  });

  useStreamEvent("classroom-state", (event) => {
    if (account?.kind !== "student" || event.classroomId !== account.classroomId) return;
    if (event.state === "handed_in" || event.state === "archived") freezeWith("classroom");
  });

  useStreamEvent("access-ended", (event) => {
    if (account?.classroomId === event.classroomId) raise(NOTICE.removed, event.message);
  });

  const nameDirty = isValidName(name) && name.trim() !== (project?.name ?? DEFAULT_NAMES[kind]);
  let indicator: string | null = null;
  if (saving) indicator = copy.saving;
  else if (dirty || nameDirty) indicator = copy.unsavedChanges;
  else if (project) indicator = copy.savedIndicator(project.revision);

  return {
    phase,
    project,
    doc,
    name,
    setName,
    commitName,
    indicator,
    freeze,
    save,
    onChange,
    handIn,
    retry: () => setAttempt((count) => count + 1),
    /** The project id exports are attached to: only the owner may attach, and a new design has none yet. */
    exportProjectId: project && account && project.ownerId === account.id ? project.id : null,
  };
}

export type EditorSession = ReturnType<typeof useEditorSession>;
