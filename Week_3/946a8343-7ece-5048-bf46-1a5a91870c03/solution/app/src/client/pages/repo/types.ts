// Response shapes of the repository, wiki and lint endpoints, parsed from `unknown` (no assertions).
import { asNumber, asString, isRecord } from "../../util.ts";

export interface BranchRef {
  name: string;
  commit: string;
  protected: boolean;
}

export interface TagRef {
  name: string;
  commit: string;
  message: string;
}

export interface Refs {
  branches: BranchRef[];
  tags: TagRef[];
}

export interface TreeEntry {
  name: string;
  type: "blob" | "tree";
  id: string;
}

export interface FileBody {
  path: string;
  size: number;
  content: string;
}

export interface CommitInfo {
  id: string;
  parents: string[];
  author: string;
  authoredAt: string;
  message: string;
}

export interface DiffLine {
  type: "context" | "add" | "del";
  old: number | null;
  new: number | null;
  text: string;
}

interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export type FileStatus = "added" | "modified" | "deleted" | "moved";

export interface FileDiff {
  path: string;
  oldPath: string | null;
  status: FileStatus;
  hunks: DiffHunk[];
}

export interface CommitDetail extends CommitInfo {
  diffs: FileDiff[];
}

export interface Compared {
  commits: CommitInfo[];
  diffs: FileDiff[];
}

export interface BlameLine {
  line: number;
  commit: string;
  author: string;
  text: string;
}

export interface WikiPageBody {
  slug: string;
  version: number;
  title: string;
  content: string;
  html: string;
}

export interface WikiListEntry {
  slug: string;
  title: string;
}

export interface WikiVersion {
  version: number;
  title: string;
  content: string;
  author: string;
  createdAt: string;
}

export interface LintBody {
  valid: boolean;
  errors: string[];
  summary: string;
  jobs: LintJob[];
}

export interface LintJob {
  name: string;
  stage: string;
  variables: Array<[string, string]>;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function parseRefs(raw: unknown): Refs {
  const body = isRecord(raw) ? raw : {};
  const branches: BranchRef[] = [];
  for (const item of list(body.branches)) {
    if (!isRecord(item)) continue;
    const name = asString(item.name);
    if (name === null) continue;
    branches.push({ name, commit: asString(item.commit) ?? "", protected: item.protected === true });
  }
  const tags: TagRef[] = [];
  for (const item of list(body.tags)) {
    if (!isRecord(item)) continue;
    const name = asString(item.name);
    if (name === null) continue;
    tags.push({ name, commit: asString(item.commit) ?? "", message: asString(item.message) ?? "" });
  }
  return { branches, tags };
}

export function parseTree(raw: unknown): TreeEntry[] {
  const entries: TreeEntry[] = [];
  for (const item of list(isRecord(raw) ? raw.entries : null)) {
    if (!isRecord(item)) continue;
    const name = asString(item.name);
    if (name === null) continue;
    entries.push({ name, type: item.type === "tree" ? "tree" : "blob", id: asString(item.id) ?? "" });
  }
  return entries;
}

export function parseFile(raw: unknown): FileBody {
  const body = isRecord(raw) ? raw : {};
  return { path: asString(body.path) ?? "", size: asNumber(body.size) ?? 0, content: asString(body.content) ?? "" };
}

function parseCommitInfo(raw: unknown): CommitInfo | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  if (id === null) return null;
  return {
    id,
    parents: list(raw.parents).filter((item): item is string => typeof item === "string"),
    author: asString(raw.author) ?? "",
    authoredAt: asString(raw.authored_at) ?? "",
    message: asString(raw.message) ?? "",
  };
}

function parseCommits(raw: unknown): CommitInfo[] {
  const commits: CommitInfo[] = [];
  for (const item of list(raw)) {
    const commit = parseCommitInfo(item);
    if (commit) commits.push(commit);
  }
  return commits;
}

export function parseCommitList(raw: unknown): CommitInfo[] {
  return parseCommits(isRecord(raw) ? raw.commits : null);
}

function parseDiffLine(item: unknown): DiffLine | null {
  if (!isRecord(item)) return null;
  const type = item.type === "add" || item.type === "del" ? item.type : "context";
  return { type, old: asNumber(item.old), new: asNumber(item.new), text: asString(item.text) ?? "" };
}

function parseDiffs(raw: unknown): FileDiff[] {
  const diffs: FileDiff[] = [];
  for (const item of list(raw)) {
    if (!isRecord(item)) continue;
    const path = asString(item.path);
    if (path === null) continue;
    const hunks: DiffHunk[] = [];
    for (const hunk of list(item.hunks)) {
      if (!isRecord(hunk)) continue;
      const lines: DiffLine[] = [];
      for (const line of list(hunk.lines)) {
        const parsed = parseDiffLine(line);
        if (parsed) lines.push(parsed);
      }
      hunks.push({ header: asString(hunk.header) ?? "", lines });
    }
    const status = item.status === "added" || item.status === "deleted" || item.status === "moved" ? item.status : "modified";
    diffs.push({ path, oldPath: asString(item.old_path), status, hunks });
  }
  return diffs;
}

export function parseCommitDetail(raw: unknown): CommitDetail | null {
  const info = parseCommitInfo(raw);
  if (!info || !isRecord(raw)) return null;
  return { ...info, diffs: parseDiffs(raw.diffs) };
}

export function parseCompared(raw: unknown): Compared {
  const body = isRecord(raw) ? raw : {};
  return { commits: parseCommits(body.commits), diffs: parseDiffs(body.diffs) };
}

export function parseBlame(raw: unknown): BlameLine[] {
  const lines: BlameLine[] = [];
  for (const item of list(isRecord(raw) ? raw.lines : null)) {
    if (!isRecord(item)) continue;
    lines.push({
      line: asNumber(item.line) ?? lines.length + 1,
      commit: asString(item.commit) ?? "",
      author: asString(item.author) ?? "",
      text: asString(item.text) ?? "",
    });
  }
  return lines;
}

export function parseWikiPage(raw: unknown): WikiPageBody | null {
  if (!isRecord(raw)) return null;
  const slug = asString(raw.slug);
  const version = asNumber(raw.version);
  if (slug === null || version === null) return null;
  return { slug, version, title: asString(raw.title) ?? "", content: asString(raw.content) ?? "", html: asString(raw.html) ?? "" };
}

export function parseWikiList(raw: unknown): WikiListEntry[] {
  const pages: WikiListEntry[] = [];
  for (const item of list(isRecord(raw) ? raw.pages : null)) {
    if (!isRecord(item)) continue;
    const slug = asString(item.slug);
    if (slug !== null) pages.push({ slug, title: asString(item.title) ?? slug });
  }
  return pages;
}

export function parseWikiVersions(raw: unknown): WikiVersion[] {
  const versions: WikiVersion[] = [];
  for (const item of list(isRecord(raw) ? raw.versions : null)) {
    if (!isRecord(item)) continue;
    const version = asNumber(item.version);
    if (version === null) continue;
    versions.push({
      version,
      title: asString(item.title) ?? "",
      content: asString(item.content) ?? "",
      author: asString(item.author) ?? "",
      createdAt: asString(item.created_at) ?? "",
    });
  }
  return versions;
}

export function parseLint(raw: unknown): LintBody {
  const body = isRecord(raw) ? raw : {};
  const jobs: LintJob[] = [];
  for (const item of list(body.jobs)) {
    if (!isRecord(item)) continue;
    const name = asString(item.name);
    if (name === null) continue;
    const variables: Array<[string, string]> = [];
    if (isRecord(item.variables)) {
      for (const [key, value] of Object.entries(item.variables)) {
        if (key.startsWith("CI_")) continue;
        variables.push([key, typeof value === "string" ? value : String(value ?? "")]);
      }
    }
    variables.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    jobs.push({ name, stage: asString(item.stage) ?? "", variables });
  }
  return {
    valid: body.valid === true,
    errors: list(body.errors).filter((item): item is string => typeof item === "string"),
    summary: asString(body.summary) ?? "",
    jobs,
  };
}
