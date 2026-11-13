// Board filters: the four URL parameters, the option lists behind the filter controls, and the group lookup by path.
import { useLayoutEffect, useRef } from "preact/hooks";
import { api, useResource, type Resource } from "../../api.ts";
import { useQuery } from "../../router.ts";
import { ROLE_LEVELS } from "../../role.ts";
import { asString, isRecord } from "../../util.ts";
import type { BoardList, NamedItem } from "./types.ts";
import { readNamedList } from "./types.ts";

const FILTER_KEYS = ["label", "assignee", "milestone", "search"] as const;
/** The board's filters as they appear in the address, in a fixed order. */
export function useFilterString(): string {
  const query = useQuery();
  const out = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = query.get(key);
    if (value !== null && value !== "") out.set(key, value);
  }
  return out.toString();
}

/** Loads again when the filters change, keeping the cards on screen until the filtered answer arrives. */
export function useReloadOnChange(resource: Resource<unknown>, key: string): void {
  const first = useRef(true);
  const latest = useRef(resource);
  latest.current = resource;
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void latest.current.reload();
  }, [key]);
}

interface GroupInfo {
  id: number;
  path: string;
}

export function useGroupByPath(path: string): Resource<GroupInfo | null> {
  return useResource<GroupInfo | null>(async (signal) => {
    const found: NamedItem | undefined = readNamedList(await api.get<unknown>("/api/me/groups", { signal }), "groups").find((group) => group.path === path);
    return found === undefined ? null : { id: found.id, path: found.path };
  }, [path]);
}

export interface FilterOptions {
  labels: string[];
  assignees: string[];
  milestones: string[];
  role: string | null;
}

function names(raw: unknown, key: string, field: string): string[] {
  const out: string[] = [];
  for (const item of isRecord(raw) && Array.isArray(raw[key]) ? raw[key] : []) {
    const value = isRecord(item) ? asString(item[field]) : null;
    if (value !== null) out.push(value);
  }
  return out;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

type BoardScope = { kind: "project"; projectId: string } | { kind: "group"; groupId: number | null };

/** What the filter controls offer: the project's (or group's) labels, its members and milestones. */
export function useFilterOptions(scope: BoardScope): FilterOptions {
  const key = scope.kind === "project" ? `p${scope.projectId}` : `g${scope.groupId ?? "none"}`;
  const loaded = useResource<FilterOptions>(async (signal) => {
    if (scope.kind === "project") {
      const base = `/api/projects/${encodeURIComponent(scope.projectId)}`;
      const [labels, members, milestones] = await Promise.all([
        api.get<unknown>(`${base}/labels`, { signal }),
        api.get<unknown>(`${base}/members`, { signal }),
        api.get<unknown>(`${base}/milestones`, { signal }),
      ]);
      return { labels: names(labels, "labels", "name"), assignees: names(members, "members", "username"), milestones: names(milestones, "milestones", "title"), role: null };
    }
    if (scope.groupId === null) return { labels: [], assignees: [], milestones: [], role: null };
    const base = `/api/groups/${scope.groupId}`;
    const [labels, group] = await Promise.all([api.get<unknown>(`${base}/labels`, { signal }), api.get<unknown>(base, { signal })]);
    return {
      labels: names(labels, "labels", "name"),
      assignees: names(group, "members", "username"),
      milestones: [],
      role: isRecord(group) ? asString(group.my_role) : null,
    };
  }, [key]);
  return loaded.data ?? { labels: [], assignees: [], milestones: [], role: null };
}

export function optionList(known: readonly string[], fromCards: readonly string[], current: string | null): string[] {
  return unique([...known, ...fromCards, ...(current ? [current] : [])]);
}

export function cardFacts(lists: readonly BoardList[]): { labels: string[]; assignees: string[]; milestones: string[] } {
  const labels: string[] = [];
  const assignees: string[] = [];
  const milestones: string[] = [];
  for (const list of lists) {
    for (const card of list.cards) {
      labels.push(...card.labels);
      assignees.push(...card.assignees);
      if (card.milestone !== null) milestones.push(card.milestone);
    }
  }
  return { labels, assignees, milestones };
}

export function mayMove(role: string | null): boolean {
  return role !== null && (ROLE_LEVELS[role] ?? 0) >= (ROLE_LEVELS["reporter"] ?? 20);
}
