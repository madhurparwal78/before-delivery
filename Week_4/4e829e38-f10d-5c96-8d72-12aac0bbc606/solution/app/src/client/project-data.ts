import { useRef } from "preact/hooks";
import { api, get } from "./api";
import { useResource } from "./hooks";
import { toast } from "./store";
import type { LiveEvent, ProjectInfo, Section, Task } from "./types";

const STALE_TOAST = "This task changed. Try again.";
export const SAVE_FAILED = "Couldn't save. Nothing changed.";

/* ------------------------------------------------------------------ ordering */

export function orderTasks(tasks: Task[], sections: Section[]): Task[] {
  const rank = new Map(sections.map((s) => [s.id, s.position]));
  const tops = tasks.filter((t) => !t.parentId).sort((a, b) => (rank.get(a.section) ?? 0) - (rank.get(b.section) ?? 0) || a.position - b.position);
  return tops.flatMap((t) => [t, ...tasks.filter((c) => c.parentId === t.id).sort((a, b) => a.position - b.position)]);
}

export const topLevelIn = (tasks: Task[], sectionId: string): Task[] =>
  tasks.filter((t) => !t.parentId && t.section === sectionId).sort((a, b) => a.position - b.position);

const subtasksOf = (tasks: Task[], parentId: string): Task[] =>
  tasks.filter((t) => t.parentId === parentId).sort((a, b) => a.position - b.position);

function renumber(tasks: Task[], ids: string[]): Task[] {
  const place = new Map(ids.map((id, index) => [id, index + 1]));
  return tasks.map((t) => (place.has(t.id) ? { ...t, position: place.get(t.id)! } : t));
}

/** A top-level task moved to a section at a 1-based position, as the server will save it. */
export function withMove(tasks: Task[], id: string, sectionId: string, position: number): Task[] {
  const task = tasks.find((t) => t.id === id)!;
  const from = topLevelIn(tasks, task.section).filter((t) => t.id !== id).map((t) => t.id);
  const into = sectionId === task.section ? from : topLevelIn(tasks, sectionId).map((t) => t.id);
  const index = Math.min(position - 1, into.length);
  const next = [...into.slice(0, index), id, ...into.slice(index)];
  const moved = tasks.map((t) => (t.id === id || t.parentId === id ? { ...t, section: sectionId } : t));
  return renumber(renumber(moved, from), next);
}

/** The top-level task directly above `id` in its section, when `id` may be indented under it. */
export function indentParent(tasks: Task[], id: string): Task | null {
  const task = tasks.find((t) => t.id === id)!;
  if (task.parentId || subtasksOf(tasks, id).length) return null;
  const above = topLevelIn(tasks, task.section).filter((t) => t.position < task.position);
  return above.length ? above[above.length - 1] : null;
}

export function withIndent(tasks: Task[], id: string, parent: Task): Task[] {
  const task = tasks.find((t) => t.id === id)!;
  const rest = topLevelIn(tasks, task.section).filter((t) => t.id !== id).map((t) => t.id);
  const moved = tasks.map((t) => (t.id === id ? { ...t, parentId: parent.id, position: subtasksOf(tasks, parent.id).length + 1 } : t));
  return renumber(moved, rest);
}

export function withOutdent(tasks: Task[], id: string): Task[] {
  const task = tasks.find((t) => t.id === id)!;
  const parent = tasks.find((t) => t.id === task.parentId)!;
  const siblings = subtasksOf(tasks, parent.id).filter((t) => t.id !== id).map((t) => t.id);
  const tops = topLevelIn(tasks, parent.section).map((t) => t.id);
  const next = [...tops.slice(0, parent.position), id, ...tops.slice(parent.position)];
  const moved = tasks.map((t) => (t.id === id ? { ...t, parentId: null } : t));
  return renumber(renumber(moved, siblings), next);
}

/* ------------------------------------------------------------------ loading */

export interface Bundle { project: ProjectInfo; tasks: Task[] }
type Loaded = Bundle | "missing";

async function loadBundle(projectId: string): Promise<Loaded | undefined> {
  const info = await get<ProjectInfo>(`/api/projects/${projectId}`);
  if (info.status === 404) return "missing";
  if (!info.ok) return undefined;
  const tasks: Task[] = [];
  for (let page = 1; page < 200; page += 1) {
    const batch = await get<{ tasks: Task[]; total: number }>(`/api/projects/${projectId}/tasks?page=${page}`);
    if (!batch.ok) return undefined;
    tasks.push(...batch.data.tasks);
    if (!batch.data.tasks.length || tasks.length >= batch.data.total) break;
  }
  return { project: info.data, tasks: orderTasks(tasks, info.data.sections) };
}

const touches = (projectId: string) => (event: LiveEvent) =>
  event.project === projectId && ["tasks", "structure", "rules", "approval"].includes(event.t);

export function useProjectData(projectId: string) {
  const latest = useRef<Loaded | undefined>(undefined);
  const saving = useRef(0);
  const resource = useResource<Loaded>(async () => {
    const loaded = await loadBundle(projectId);
    // A load that raced a save would show the old order; keep what the screen has and load again once saves settle.
    return saving.current > 0 && latest.current ? latest.current : loaded;
  }, [projectId], touches(projectId));
  latest.current = resource.data;
  const queues = useRef(new Map<string, Promise<unknown>>());

  const bundle = (): Bundle | null => (latest.current && latest.current !== "missing" ? latest.current : null);

  /** Replaces what the screen shows at once; the server's answer and live events correct it. */
  const setBundle = (change: (current: Bundle) => Bundle) => {
    const current = bundle();
    if (!current) return;
    const next = change(current);
    latest.current = next;
    resource.set(next);
  };
  const setTasks = (change: (tasks: Task[]) => Task[]) => setBundle((current) => ({ ...current, tasks: change(current.tasks) }));

  /**
   * Saves a patch after the task's earlier saves. The screen already shows the change (`optimistic`);
   * a refusal puts the server's truth back and says so with a toast.
   */
  const save = (id: string, patch: Record<string, unknown>, optimistic?: (tasks: Task[]) => Task[]) => {
    if (optimistic) setTasks(optimistic);
    saving.current += 1;
    const run = async () => {
      const task = bundle()?.tasks.find((t) => t.id === id);
      if (!task) return null;
      const result = await api<Task>("PATCH", `/api/tasks/${id}`, { version: task.version, ...patch });
      if (result.ok) {
        setTasks((tasks) => tasks.map((t) => (t.id === id ? { ...result.data, blocks: result.data.blocks ?? t.blocks } : t)));
      } else {
        toast(result.status === 409 && result.code === "stale_task" ? STALE_TOAST : SAVE_FAILED);
        resource.reload();
      }
      return result;
    };
    const settled = async () => {
      const result = await run();
      saving.current -= 1;
      if (saving.current === 0) resource.reload();
      return result;
    };
    const chained = (queues.current.get(id) ?? Promise.resolve()).then(settled, settled);
    queues.current.set(id, chained);
    return chained;
  };

  return { ...resource, bundle: bundle(), missing: resource.data === "missing", setBundle, setTasks, save };
}

export type ProjectData = ReturnType<typeof useProjectData>;
