// The `.spurpack` project export format: field encoding, canonical writing and validating reading
// (see "Search, export and import").
import { commitId, compareUtf8, normalizeMessage, shortId, treeIdFromFiles } from "./objects.ts";
import { isValidWeight } from "./quick-actions.ts";
import { FLAG_SETTINGS, MERGE_METHODS, VISIBILITIES, isFlagSetting, type FlagSetting } from "../../shared/settings.ts";

const PACK_HEADER = "spurpack 1";
const MAX_PACK_ERRORS = 20;

type ConfigKey = FlagSetting | "default_branch" | "merge_method" | "visibility";
const UNSORTED_KEYS: readonly ConfigKey[] = [...FLAG_SETTINGS, "default_branch", "merge_method", "visibility"];
export const CONFIG_KEYS: readonly ConfigKey[] = UNSORTED_KEYS.toSorted();

const REF_KINDS = ["branch", "tag"] as const;
const MILESTONE_STATES = ["active", "closed"] as const;
const ISSUE_STATES = ["opened", "closed"] as const;
const REQUEST_STATES = ["opened", "closed", "merged"] as const;

type RefKind = (typeof REF_KINDS)[number];
type MilestoneState = (typeof MILESTONE_STATES)[number];
export type IssueState = (typeof ISSUE_STATES)[number];
type RequestState = (typeof REQUEST_STATES)[number];

/** `<username> <unix seconds>` on a commit. */
interface PackActor {
  readonly username: string;
  readonly at: number;
}

export interface PackCommit {
  readonly id: string;
  readonly parents: readonly string[];
  readonly author: PackActor;
  readonly committer: PackActor;
  /** Trailing whitespace already removed. */
  readonly message: string;
  /** The commit's full tree snapshot: path to text content. */
  readonly files: ReadonlyMap<string, string>;
}

export interface PackRef {
  readonly kind: RefKind;
  readonly name: string;
  readonly commit: string;
}

export interface PackLabel {
  readonly name: string;
  readonly description: string;
}

export interface PackMilestone {
  readonly title: string;
  readonly start: string;
  readonly due: string;
  readonly zone: string;
  readonly state: MilestoneState;
}

export interface PackIssue {
  readonly iid: number;
  readonly title: string;
  readonly state: IssueState;
  readonly author: string;
  readonly labels: readonly string[];
  readonly milestone: string | null;
  readonly weight: number | null;
  readonly confidential: boolean;
  readonly description: string;
}

export interface PackRequest {
  readonly iid: number;
  readonly title: string;
  readonly state: RequestState;
  readonly author: string;
  readonly source: string;
  readonly target: string;
  readonly description: string;
}

/** A thread's first note. `path` and `line` are null when it is on the request itself. */
export interface PackThread {
  readonly request: number;
  readonly path: string | null;
  readonly line: number | null;
  readonly resolved: boolean;
  readonly author: string;
  readonly body: string;
}

export interface PackWikiPage {
  readonly slug: string;
  readonly version: number;
  readonly author: string;
  readonly title: string;
  readonly content: string;
}

/** Values are `true`/`false` for the boolean keys, the merge method, the visibility or the default branch name. */
export interface PackConfigEntry {
  readonly key: ConfigKey;
  readonly value: string;
}

export interface PackModel {
  readonly users: readonly string[];
  readonly commits: readonly PackCommit[];
  readonly refs: readonly PackRef[];
  readonly labels: readonly PackLabel[];
  readonly milestones: readonly PackMilestone[];
  readonly issues: readonly PackIssue[];
  readonly requests: readonly PackRequest[];
  /** In creation order; the writer keeps that order within a request. */
  readonly threads: readonly PackThread[];
  readonly wikiPages: readonly PackWikiPage[];
  readonly config: readonly PackConfigEntry[];
}

interface PackPreview {
  readonly commits: number;
  readonly issues: number;
  readonly requests: number;
}

type UserExists = (username: string) => boolean;

type PackParseResult =
  | { readonly ok: true; readonly model: PackModel; readonly preview: PackPreview }
  | { readonly ok: false; readonly errors: string[] };

export function previewSentence(preview: PackPreview): string {
  return `Adds ${preview.commits} commits, ${preview.issues} issues, ${preview.requests} requests.`;
}

// ---- Field encoding ----

function escapeText(value: string, inList: boolean): string {
  return value.replace(/[\\\t\n,]/gu, (char) => {
    if (char === "\\") return "\\\\";
    if (char === "\t") return "\\t";
    if (char === "\n") return "\\n";
    return inList ? "\\," : char;
  });
}

/** Reverses `escapeText`; null for an unknown or unfinished escape. */
function unescapeText(raw: string, inList: boolean): string | null {
  let value = "";
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charAt(i);
    if (char !== "\\") {
      value += char;
      continue;
    }
    const escaped = raw.charAt(++i);
    if (escaped === "t") value += "\t";
    else if (escaped === "n") value += "\n";
    else if (escaped === "\\") value += "\\";
    else if (escaped === "," && inList) value += ",";
    else return null;
  }
  return value;
}

export function encodeField(value: string): string {
  if (value === "") return "-";
  if (value === "-") return "\\-";
  return escapeText(value, false);
}

/** The text of a field; null when it holds a malformed escape. */
export function decodeField(raw: string): string | null {
  if (raw === "-") return "";
  if (raw === "\\-") return "-";
  return unescapeText(raw, false);
}

export function encodeList(items: readonly string[]): string {
  if (items.length === 0) return "-";
  const joined = items.map((item) => escapeText(item, true)).join(",");
  return joined === "-" ? "\\-" : joined;
}

/** The items of a list field; null when an escape is malformed. */
export function decodeList(raw: string): string[] | null {
  if (raw === "-") return [];
  if (raw === "\\-") return ["-"];
  const items: string[] = [];
  let current = "";
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charAt(i);
    if (char === "\\") {
      current += char + raw.charAt(++i);
    } else if (char === ",") {
      items.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  items.push(current);
  const decoded: string[] = [];
  for (const item of items) {
    const value = unescapeText(item, true);
    if (value === null) return null;
    decoded.push(value);
  }
  return decoded;
}

// ---- Writing ----

function packLine(...fields: string[]): string {
  return `${fields.join("\t")}\n`;
}

function byKey<T>(items: readonly T[], ...keys: ((item: T) => string | number)[]): T[] {
  return [...items].sort((a, b) => {
    for (const key of keys) {
      const left = key(a);
      const right = key(b);
      const order = typeof left === "number" && typeof right === "number" ? left - right : compareUtf8(String(left), String(right));
      if (order !== 0) return order;
    }
    return 0;
  });
}

function commitOrder(a: PackCommit, b: PackCommit): number {
  return a.committer.at - b.committer.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Parents first; among the commits that are ready, the earliest committer time and then the smallest id. */
function topologicalCommits(commits: readonly PackCommit[]): PackCommit[] {
  const known = new Set(commits.map((commit) => commit.id));
  const waiting = new Map<string, number>();
  const children = new Map<string, PackCommit[]>();
  const ready: PackCommit[] = [];
  // Kept sorted latest-first so the next commit to write is popped from the end.
  const push = (commit: PackCommit): void => {
    let low = 0;
    let high = ready.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (commitOrder(ready[middle], commit) > 0) low = middle + 1;
      else high = middle;
    }
    ready.splice(low, 0, commit);
  };
  for (const commit of commits) {
    const parents = new Set(commit.parents.filter((parent) => known.has(parent)));
    waiting.set(commit.id, parents.size);
    for (const parent of parents) children.set(parent, [...(children.get(parent) ?? []), commit]);
    if (parents.size === 0) push(commit);
  }
  const ordered: PackCommit[] = [];
  for (let next = ready.pop(); next !== undefined; next = ready.pop()) {
    ordered.push(next);
    for (const child of children.get(next.id) ?? []) {
      const left = (waiting.get(child.id) ?? 1) - 1;
      waiting.set(child.id, left);
      if (left === 0) push(child);
    }
  }
  if (ordered.length !== known.size) throw new Error("The commit graph has a cycle.");
  return ordered;
}

/** The users an export writes: every username in a commit actor, issue, request, thread or wiki page author. */
export function packUsers(parts: Omit<PackModel, "users">): string[] {
  const names = new Set<string>();
  for (const commit of parts.commits) {
    names.add(commit.author.username);
    names.add(commit.committer.username);
  }
  for (const issue of parts.issues) names.add(issue.author);
  for (const request of parts.requests) names.add(request.author);
  for (const thread of parts.threads) names.add(thread.author);
  for (const page of parts.wikiPages) names.add(page.author);
  return byKey([...names], (name) => name);
}

function actorText(actor: PackActor): string {
  return `${actor.username} ${actor.at}`;
}

export function serializePack(model: PackModel): string {
  let out = packLine(PACK_HEADER);
  for (const username of byKey(model.users, (name) => name)) out += packLine("user", encodeField(username));
  for (const commit of topologicalCommits(model.commits)) {
    for (const path of byKey([...commit.files.keys()], (name) => name)) {
      out += packLine("file", encodeField(path), encodeField(commit.files.get(path) ?? ""));
    }
    out += packLine(
      "commit",
      commit.id,
      encodeList(commit.parents),
      encodeField(actorText(commit.author)),
      encodeField(actorText(commit.committer)),
      encodeField(commit.message),
    );
  }
  for (const ref of byKey(model.refs, (r) => (r.kind === "branch" ? 0 : 1), (r) => r.name)) {
    out += packLine("ref", ref.kind, encodeField(ref.name), ref.commit);
  }
  for (const label of byKey(model.labels, (l) => l.name)) out += packLine("label", encodeField(label.name), encodeField(label.description));
  for (const m of byKey(model.milestones, (item) => item.title)) {
    out += packLine("milestone", encodeField(m.title), m.start, m.due, encodeField(m.zone), m.state);
  }
  for (const issue of byKey(model.issues, (i) => i.iid)) {
    out += packLine(
      "issue",
      String(issue.iid),
      encodeField(issue.title),
      issue.state,
      encodeField(issue.author),
      encodeList(issue.labels),
      issue.milestone === null ? "-" : encodeField(issue.milestone),
      issue.weight === null ? "-" : String(issue.weight),
      String(issue.confidential),
      encodeField(issue.description),
    );
  }
  for (const r of byKey(model.requests, (item) => item.iid)) {
    out += packLine("request", String(r.iid), encodeField(r.title), r.state, encodeField(r.author), encodeField(r.source), encodeField(r.target), encodeField(r.description));
  }
  for (const t of byKey(model.threads, (item) => item.request)) {
    out += packLine(
      "thread",
      String(t.request),
      t.path === null ? "-" : encodeField(t.path),
      t.line === null ? "-" : String(t.line),
      String(t.resolved),
      encodeField(t.author),
      encodeField(t.body),
    );
  }
  for (const page of byKey(model.wikiPages, (p) => p.slug, (p) => p.version)) {
    out += packLine("wikipage", encodeField(page.slug), String(page.version), encodeField(page.author), encodeField(page.title), encodeField(page.content));
  }
  for (const entry of byKey(model.config, (e) => e.key)) out += packLine("config", entry.key, encodeField(entry.value));
  return out;
}

// ---- Reading ----

const HEX_ID = /^[0-9a-f]{64}$/u;
const USERNAME = /^[a-z0-9_]{3,24}$/u;
const SYSTEM_USER = "spurline-train";
const SLUG = /^[a-z0-9/-]+$/u;
const ACTOR = /^([^ ]+) (0|[1-9][0-9]*)$/u;
const POSITIVE_INT = /^[1-9][0-9]*$/u;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const ZONE_NAME = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/u;

type Read<T> = { readonly record: T } | { readonly field: string };

interface FileRun {
  readonly firstLine: number;
  readonly files: Map<string, string>;
}

interface ParseState {
  line: number;
  run: FileRun | null;
  readonly errors: Map<number, string>;
  readonly users: Set<string>;
  readonly commitIds: Set<string>;
  readonly refKeys: Set<string>;
  readonly branches: Set<string>;
  readonly labelNames: Set<string>;
  readonly milestoneTitles: Set<string>;
  readonly issueIids: Set<number>;
  readonly requestIids: Set<number>;
  readonly configKeys: Set<string>;
  readonly lastWikiVersion: Map<string, number>;
  readonly model: {
    users: string[];
    commits: PackCommit[];
    refs: PackRef[];
    labels: PackLabel[];
    milestones: PackMilestone[];
    issues: PackIssue[];
    requests: PackRequest[];
    threads: PackThread[];
    wikiPages: PackWikiPage[];
    config: PackConfigEntry[];
  };
}

interface Spec<T> {
  readonly fields: readonly string[];
  read(values: readonly string[], state: ParseState): Read<T>;
  /** The key text when this record repeats an earlier one. */
  duplicate(record: T, state: ParseState): string | null;
  /** A problem with a well-formed record, in the brief's order. */
  check(record: T, state: ParseState, userExists: UserExists): string | null;
  store(record: T, state: ParseState): void;
}

type Processor = (raw: readonly string[], state: ParseState, userExists: UserExists) => string | null;

function field<T>(raw: string, parse: (value: string) => T | undefined): T | undefined {
  const value = decodeField(raw);
  return value === null ? undefined : parse(value);
}

/** `-` is none (null); anything else must parse. */
function optionalField<T>(raw: string, parse: (value: string) => T | undefined): T | null | undefined {
  return raw === "-" ? null : field(raw, parse);
}

function listField<T>(raw: string, parse: (value: string) => T | undefined): T[] | undefined {
  const items = decodeList(raw);
  if (items === null) return undefined;
  const values: T[] = [];
  for (const item of items) {
    const value = parse(item);
    if (value === undefined) return undefined;
    values.push(value);
  }
  return values;
}

function oneOf<T extends string>(allowed: readonly T[]): (value: string) => T | undefined {
  return (value) => allowed.find((candidate) => candidate === value);
}

function anyText(value: string): string {
  return value;
}

function nonEmpty(value: string): string | undefined {
  return value === "" ? undefined : value;
}

function username(value: string): string | undefined {
  return USERNAME.test(value) || value === SYSTEM_USER ? value : undefined;
}

function hexId(value: string): string | undefined {
  return HEX_ID.test(value) ? value : undefined;
}

function positiveInt(value: string): number | undefined {
  return POSITIVE_INT.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : undefined;
}

function boolean(value: string): boolean | undefined {
  return value === "true" ? true : value === "false" ? false : undefined;
}

function weight(value: string): number | undefined {
  return /^\d{1,3}$/u.test(value) && isValidWeight(Number(value)) ? Number(value) : undefined;
}

function title(value: string): string | undefined {
  const length = [...value].length;
  return length >= 1 && length <= 255 ? value : undefined;
}

function filePath(value: string): string | undefined {
  if (value === "" || value.startsWith("/")) return undefined;
  return value.split("/").some((segment) => segment === "" || segment === "." || segment === "..") ? undefined : value;
}

function isRealDate(value: string): boolean {
  const match = DATE.exec(value);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return year >= 1 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function date(value: string): string | undefined {
  return isRealDate(value) ? value : undefined;
}

function zone(value: string): string | undefined {
  if (!ZONE_NAME.test(value)) return undefined;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return undefined;
  }
}

function slug(value: string): string | undefined {
  return SLUG.test(value) ? value : undefined;
}

function declaredUser(state: ParseState): (value: string) => string | undefined {
  return (value) => (state.users.has(value) ? value : undefined);
}

function actor(state: ParseState): (value: string) => PackActor | undefined {
  return (value) => {
    const match = ACTOR.exec(value);
    const name = match?.[1];
    const at = Number(match?.[2]);
    return name !== undefined && state.users.has(name) && Number.isSafeInteger(at) ? { username: name, at } : undefined;
  };
}

function bad(name: string): { readonly field: string } {
  return { field: name };
}

function noDuplicate(): null {
  return null;
}

function noCheck(): null {
  return null;
}

const userSpec: Spec<{ readonly username: string }> = {
  fields: ["username"],
  read: ([raw]) => {
    const name = field(raw, username);
    return name === undefined ? bad("username") : { record: { username: name } };
  },
  duplicate: (record, state) => (state.users.has(record.username) ? record.username : null),
  check: (record, _state, userExists) => (userExists(record.username) ? null : `user "${record.username}" doesn't exist here`),
  store: (record, state) => {
    state.users.add(record.username);
    state.model.users.push(record.username);
  },
};

const fileSpec: Spec<{ readonly path: string; readonly content: string }> = {
  fields: ["path", "content"],
  read: ([rawPath, rawContent]) => {
    const path = field(rawPath, filePath);
    if (path === undefined) return bad("path");
    const content = field(rawContent, anyText);
    return content === undefined ? bad("content") : { record: { path, content } };
  },
  duplicate: (record, state) => (state.run?.files.has(record.path) ? record.path : null),
  check: noCheck,
  store: (record, state) => {
    state.run ??= { firstLine: state.line, files: new Map() };
    state.run.files.set(record.path, record.content);
  },
};

const commitSpec: Spec<Omit<PackCommit, "files">> = {
  fields: ["id", "parents", "author", "committer", "message"],
  read: ([rawId, rawParents, rawAuthor, rawCommitter, rawMessage], state) => {
    const id = field(rawId, hexId);
    if (id === undefined) return bad("id");
    const parents = listField(rawParents, hexId);
    if (parents === undefined) return bad("parents");
    const author = field(rawAuthor, actor(state));
    if (author === undefined) return bad("author");
    const committer = field(rawCommitter, actor(state));
    if (committer === undefined) return bad("committer");
    const message = field(rawMessage, (value) => nonEmpty(normalizeMessage(value)));
    return message === undefined ? bad("message") : { record: { id, parents, author, committer, message } };
  },
  duplicate: (record, state) => (state.commitIds.has(record.id) ? record.id : null),
  check: (record, state) => {
    const unknown = record.parents.find((parent) => !state.commitIds.has(parent));
    if (unknown !== undefined) return `commit ${shortId(record.id)} has unknown parent ${shortId(unknown)}`;
    const actual = commitId({
      tree: treeIdFromFiles(state.run?.files ?? new Map()),
      parents: record.parents,
      author: record.author.username,
      authoredAt: record.author.at,
      committer: record.committer.username,
      committedAt: record.committer.at,
      message: record.message,
    });
    return actual === record.id ? null : "commit id doesn't match its contents";
  },
  store: (record, state) => {
    state.commitIds.add(record.id);
    state.model.commits.push({ ...record, files: new Map(state.run?.files) });
  },
};

const refSpec: Spec<PackRef> = {
  fields: ["kind", "name", "commit"],
  read: ([rawKind, rawName, rawCommit]) => {
    const kind = field(rawKind, oneOf(REF_KINDS));
    if (kind === undefined) return bad("kind");
    const name = field(rawName, nonEmpty);
    if (name === undefined) return bad("name");
    const commit = field(rawCommit, hexId);
    return commit === undefined ? bad("commit") : { record: { kind, name, commit } };
  },
  duplicate: (record, state) => (state.refKeys.has(`${record.kind} ${record.name}`) ? `${record.kind} ${record.name}` : null),
  check: (record, state) =>
    state.commitIds.has(record.commit) ? null : `ref ${record.name} points to unknown commit ${shortId(record.commit)}`,
  store: (record, state) => {
    state.refKeys.add(`${record.kind} ${record.name}`);
    if (record.kind === "branch") state.branches.add(record.name);
    state.model.refs.push(record);
  },
};

function labelName(value: string): string | undefined {
  return value === "" || /[\t\n]/u.test(value) ? undefined : value;
}

const labelSpec: Spec<PackLabel> = {
  fields: ["name", "description"],
  read: ([rawName, rawDescription]) => {
    const name = field(rawName, labelName);
    if (name === undefined) return bad("name");
    const description = field(rawDescription, anyText);
    return description === undefined ? bad("description") : { record: { name, description } };
  },
  duplicate: (record, state) => (state.labelNames.has(record.name) ? record.name : null),
  check: noCheck,
  store: (record, state) => {
    state.labelNames.add(record.name);
    state.model.labels.push(record);
  },
};

const milestoneSpec: Spec<PackMilestone> = {
  fields: ["title", "start", "due", "zone", "state"],
  read: ([rawTitle, rawStart, rawDue, rawZone, rawState]) => {
    const milestoneTitle = field(rawTitle, title);
    if (milestoneTitle === undefined) return bad("title");
    const start = field(rawStart, date);
    if (start === undefined) return bad("start");
    const due = field(rawDue, date);
    if (due === undefined || due < start) return bad("due");
    const zoneName = field(rawZone, zone);
    if (zoneName === undefined) return bad("zone");
    const milestoneState = field(rawState, oneOf(MILESTONE_STATES));
    if (milestoneState === undefined) return bad("state");
    return { record: { title: milestoneTitle, start, due, zone: zoneName, state: milestoneState } };
  },
  duplicate: (record, state) => (state.milestoneTitles.has(record.title) ? record.title : null),
  check: noCheck,
  store: (record, state) => {
    state.milestoneTitles.add(record.title);
    state.model.milestones.push(record);
  },
};

const issueSpec: Spec<PackIssue> = {
  fields: ["iid", "title", "state", "author", "labels", "milestone", "weight", "confidential", "description"],
  read: ([rawIid, rawTitle, rawState, rawAuthor, rawLabels, rawMilestone, rawWeight, rawConfidential, rawDescription], state) => {
    const iid = positiveInt(rawIid);
    if (iid === undefined) return bad("iid");
    const issueTitle = field(rawTitle, title);
    if (issueTitle === undefined) return bad("title");
    const issueState = field(rawState, oneOf(ISSUE_STATES));
    if (issueState === undefined) return bad("state");
    const author = field(rawAuthor, declaredUser(state));
    if (author === undefined) return bad("author");
    const labels = listField(rawLabels, (name) => (state.labelNames.has(name) ? name : undefined));
    if (labels === undefined) return bad("labels");
    const milestone = optionalField(rawMilestone, (name) => (state.milestoneTitles.has(name) ? name : undefined));
    if (milestone === undefined) return bad("milestone");
    const issueWeight = rawWeight === "-" ? null : weight(rawWeight);
    if (issueWeight === undefined) return bad("weight");
    const confidential = field(rawConfidential, boolean);
    if (confidential === undefined) return bad("confidential");
    const description = field(rawDescription, anyText);
    if (description === undefined) return bad("description");
    return { record: { iid, title: issueTitle, state: issueState, author, labels, milestone, weight: issueWeight, confidential, description } };
  },
  duplicate: (record, state) => (state.issueIids.has(record.iid) ? String(record.iid) : null),
  check: noCheck,
  store: (record, state) => {
    state.issueIids.add(record.iid);
    state.model.issues.push(record);
  },
};

const requestSpec: Spec<PackRequest> = {
  fields: ["iid", "title", "state", "author", "source", "target", "description"],
  read: ([rawIid, rawTitle, rawState, rawAuthor, rawSource, rawTarget, rawDescription], state) => {
    const iid = positiveInt(rawIid);
    if (iid === undefined) return bad("iid");
    const requestTitle = field(rawTitle, title);
    if (requestTitle === undefined) return bad("title");
    const requestState = field(rawState, oneOf(REQUEST_STATES));
    if (requestState === undefined) return bad("state");
    const author = field(rawAuthor, declaredUser(state));
    if (author === undefined) return bad("author");
    const source = field(rawSource, nonEmpty);
    if (source === undefined) return bad("source");
    const target = field(rawTarget, nonEmpty);
    if (target === undefined) return bad("target");
    const description = field(rawDescription, anyText);
    if (description === undefined) return bad("description");
    return { record: { iid, title: requestTitle, state: requestState, author, source, target, description } };
  },
  duplicate: (record, state) => (state.requestIids.has(record.iid) ? String(record.iid) : null),
  check: noCheck,
  store: (record, state) => {
    state.requestIids.add(record.iid);
    state.model.requests.push(record);
  },
};

const threadSpec: Spec<PackThread> = {
  fields: ["request", "path", "line", "resolved", "author", "body"],
  read: ([rawRequest, rawPath, rawLine, rawResolved, rawAuthor, rawBody], state) => {
    const request = positiveInt(rawRequest);
    if (request === undefined || !state.requestIids.has(request)) return bad("request");
    const path = optionalField(rawPath, filePath);
    if (path === undefined) return bad("path");
    const line = optionalField(rawLine, (value) => positiveInt(value));
    if (line === undefined || (path === null) !== (line === null)) return bad("line");
    const resolved = field(rawResolved, boolean);
    if (resolved === undefined) return bad("resolved");
    const author = field(rawAuthor, declaredUser(state));
    if (author === undefined) return bad("author");
    const body = field(rawBody, nonEmpty);
    return body === undefined ? bad("body") : { record: { request, path, line, resolved, author, body } };
  },
  duplicate: noDuplicate,
  check: noCheck,
  store: (record, state) => {
    state.model.threads.push(record);
  },
};

const wikiPageSpec: Spec<PackWikiPage> = {
  fields: ["slug", "version", "author", "title", "content"],
  read: ([rawSlug, rawVersion, rawAuthor, rawTitle, rawContent], state) => {
    const pageSlug = field(rawSlug, slug);
    if (pageSlug === undefined) return bad("slug");
    const version = positiveInt(rawVersion);
    if (version === undefined || version !== (state.lastWikiVersion.get(pageSlug) ?? 0) + 1) return bad("version");
    const author = field(rawAuthor, declaredUser(state));
    if (author === undefined) return bad("author");
    const pageTitle = field(rawTitle, anyText);
    if (pageTitle === undefined) return bad("title");
    const content = field(rawContent, anyText);
    return content === undefined ? bad("content") : { record: { slug: pageSlug, version, author, title: pageTitle, content } };
  },
  // A repeated slug and version always fails the version rule first, so this record has no duplicate case.
  duplicate: noDuplicate,
  check: noCheck,
  store: (record, state) => {
    state.lastWikiVersion.set(record.slug, record.version);
    state.model.wikiPages.push(record);
  },
};

function configValue(key: ConfigKey, state: ParseState): (value: string) => string | undefined {
  if (key === "merge_method") return oneOf(MERGE_METHODS);
  if (key === "visibility") return oneOf(VISIBILITIES);
  if (key === "default_branch") return (value) => (state.branches.has(value) ? value : undefined);
  return (value) => (isFlagSetting(key) && boolean(value) !== undefined ? value : undefined);
}

const configSpec: Spec<PackConfigEntry> = {
  fields: ["key", "value"],
  read: ([rawKey, rawValue], state) => {
    const key = field(rawKey, oneOf(CONFIG_KEYS));
    if (key === undefined) return bad("key");
    const value = field(rawValue, configValue(key, state));
    return value === undefined ? bad("value") : { record: { key, value } };
  },
  duplicate: (record, state) => (state.configKeys.has(record.key) ? record.key : null),
  check: noCheck,
  store: (record, state) => {
    state.configKeys.add(record.key);
    state.model.config.push(record);
  },
};

function processor<T>(name: string, spec: Spec<T>): Processor {
  const count = spec.fields.length + 1;
  return (raw, state, userExists) => {
    if (raw.length !== count) return `${name} needs ${count} fields, got ${raw.length}`;
    const read = spec.read(raw.slice(1), state);
    if ("field" in read) return `bad value for ${read.field}`;
    const repeated = spec.duplicate(read.record, state);
    if (repeated !== null) return `duplicate ${name} ${repeated}`;
    const problem = spec.check(read.record, state, userExists);
    spec.store(read.record, state);
    return problem;
  };
}

const PROCESSORS = new Map<string, Processor>([
  ["user", processor("user", userSpec)],
  ["file", processor("file", fileSpec)],
  ["commit", processor("commit", commitSpec)],
  ["ref", processor("ref", refSpec)],
  ["label", processor("label", labelSpec)],
  ["milestone", processor("milestone", milestoneSpec)],
  ["issue", processor("issue", issueSpec)],
  ["request", processor("request", requestSpec)],
  ["thread", processor("thread", threadSpec)],
  ["wikipage", processor("wikipage", wikiPageSpec)],
  ["config", processor("config", configSpec)],
]);

function newState(): ParseState {
  return {
    line: 0,
    run: null,
    errors: new Map(),
    users: new Set(),
    commitIds: new Set(),
    refKeys: new Set(),
    branches: new Set(),
    labelNames: new Set(),
    milestoneTitles: new Set(),
    issueIids: new Set(),
    requestIids: new Set(),
    configKeys: new Set(),
    lastWikiVersion: new Map(),
    model: { users: [], commits: [], refs: [], labels: [], milestones: [], issues: [], requests: [], threads: [], wikiPages: [], config: [] },
  };
}

function report(state: ParseState, line: number, problem: string): void {
  if (!state.errors.has(line)) state.errors.set(line, `Line ${line}: ${problem}.`);
}

/** A run of `file` records that no `commit` record follows. */
function closeRun(state: ParseState): void {
  if (state.run === null) return;
  report(state, state.run.firstLine, "file belongs to no commit");
  state.run = null;
}

export function parsePack(text: string, userExists: UserExists): PackParseResult {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines[0] !== PACK_HEADER) return { ok: false, errors: ["Line 1: not a spurpack file."] };
  const state = newState();
  for (let index = 1; index < lines.length; index++) {
    state.line = index + 1;
    const raw = (lines[index] ?? "").split("\t");
    const name = raw[0] ?? "";
    if (name !== "file" && name !== "commit") closeRun(state);
    const handle = PROCESSORS.get(name);
    const problem = handle === undefined ? `unknown record "${name}"` : handle(raw, state, userExists);
    if (name === "commit") state.run = null;
    if (problem !== null) report(state, state.line, problem);
  }
  closeRun(state);
  if (state.errors.size > 0) {
    const errors = [...state.errors].sort((a, b) => a[0] - b[0]).slice(0, MAX_PACK_ERRORS).map(([, message]) => message);
    return { ok: false, errors };
  }
  const { model } = state;
  return { ok: true, model, preview: { commits: model.commits.length, issues: model.issues.length, requests: model.requests.length } };
}
