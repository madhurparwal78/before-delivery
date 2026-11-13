// Loaders and address helpers for the repository pages.
import { api } from "../../api.ts";
import {
  parseBlame,
  parseCommitDetail,
  parseCommitList,
  parseCompared,
  parseFile,
  parseRefs,
  parseTree,
  type BlameLine,
  type CommitDetail,
  type CommitInfo,
  type Compared,
  type FileBody,
  type Refs,
  type TreeEntry,
} from "./types.ts";

const SHORT = 7;

export function short(id: string): string {
  return id.slice(0, SHORT);
}

function projectBase(id: string | number): string {
  return `/projects/${id}`;
}

function query(values: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) params.set(key, value);
  return params.toString();
}

export function repoPath(id: string | number, page: "files" | "blame" | "commits" | "edit", ref: string, path: string): string {
  return `${projectBase(id)}/-/${page}?${query(path === "" ? { ref } : { ref, path })}`;
}

export function commitPath(id: string | number, commit: string): string {
  return `${projectBase(id)}/-/commit/${commit}`;
}

export function dirname(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? "" : path.slice(0, cut);
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function joinPath(dir: string, name: string): string {
  return dir === "" ? name : `${dir}/${name}`;
}

export function ancestors(path: string): string[] {
  const parts = path.split("/").filter((part) => part !== "");
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join("/"));
  return out;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function loadRefs(project: string | number, signal?: AbortSignal): Promise<Refs> {
  return parseRefs(await api.get(`/api/projects/${project}/refs`, { signal }));
}

export async function loadTree(project: string | number, ref: string, path: string, signal?: AbortSignal): Promise<TreeEntry[]> {
  return parseTree(await api.get(`/api/projects/${project}/tree?${query({ ref, path })}`, { signal }));
}

export async function loadFile(project: string | number, ref: string, path: string, signal?: AbortSignal): Promise<FileBody> {
  return parseFile(await api.get(`/api/projects/${project}/files?${query({ ref, path })}`, { signal }));
}

export async function loadBlame(project: string | number, ref: string, path: string, signal?: AbortSignal): Promise<BlameLine[]> {
  return parseBlame(await api.get(`/api/projects/${project}/blame?${query({ ref, path })}`, { signal }));
}

export async function loadHistory(project: string | number, ref: string, path: string, signal?: AbortSignal): Promise<CommitInfo[]> {
  return parseCommitList(await api.get(`/api/projects/${project}/commits?${query(path === "" ? { ref } : { ref, path })}`, { signal }));
}

export async function loadCommit(project: string | number, id: string, signal?: AbortSignal): Promise<CommitDetail | null> {
  return parseCommitDetail(await api.get(`/api/projects/${project}/commits/${encodeURIComponent(id)}`, { signal }));
}

export async function loadCompare(project: string | number, from: string, to: string, signal?: AbortSignal): Promise<Compared> {
  return parseCompared(await api.get(`/api/projects/${project}/compare?${query({ from, to })}`, { signal }));
}

export function wikiPath(id: string | number, slug: string, tail: "" | "history" = ""): string {
  return `${projectBase(id)}/-/wiki/${encodeURIComponent(slug)}${tail === "" ? "" : `/${tail}`}`;
}
