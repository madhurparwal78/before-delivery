import { ProjectRow, defaultSettings, loadGroup } from './access';
import { Sql } from './db';
import { ApiError, errors } from './errors';
import { Tx, emit } from './live';
import { filesOfCommit, hashCommit, setBranch, storeCommit, writeTree } from './repo';

export const packHeader = 'spurpack 1';

export function encodeField(value: string | null): string {
  if (value === null || value === '') return '-';
  const escaped = value.split('\\').join('\\\\').split('\t').join('\\t').split('\n').join('\\n');
  return escaped === '-' ? '\\-' : escaped;
}

export function decodeField(value: string): string {
  if (value === '-') return '';
  let out = '';
  let index = 0;
  while (index < value.length) {
    const char = value[index];
    if (char === '\\' && index + 1 < value.length) {
      const next = value[index + 1];
      if (next === 't') out += '\t';
      else if (next === 'n') out += '\n';
      else if (next === '\\') out += '\\';
      else out += next;
      index += 2;
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

export function encodeList(values: string[]): string {
  if (values.length === 0) return '-';
  return values.map((value) => encodeField(value).split(',').join('\\,')).join(',');
}

export function decodeList(value: string): string[] {
  if (value === '-') return [];
  const out: string[] = [];
  let current = '';
  let index = 0;
  while (index < value.length) {
    const char = value[index];
    if (char === '\\' && index + 1 < value.length && value[index + 1] === ',') {
      current += ',';
      index += 2;
      continue;
    }
    if (char === ',') {
      out.push(decodeField(current));
      current = '';
      index += 1;
      continue;
    }
    current += char;
    index += 1;
  }
  out.push(decodeField(current));
  return out;
}

const recordFieldCounts: Record<string, number> = {
  user: 2,
  file: 3,
  commit: 6,
  ref: 4,
  label: 3,
  milestone: 6,
  issue: 10,
  request: 8,
  thread: 7,
  wikipage: 6,
  config: 3,
};

const configKeys = [
  'author_can_approve',
  'auto_resolve_outdated',
  'default_branch',
  'merge_method',
  'merge_trains',
  'pipelines_must_succeed',
  'reset_approvals_on_push',
  'visibility',
];

export async function exportProject(sql: Sql, project: ProjectRow): Promise<string> {
  const lines: string[] = [packHeader];
  const refs = await sql.query<{ kind: string; name: string; commit_id: string; message: string | null }>(
    'select kind, name, commit_id, message from refs where project_id = $1',
    [project.id],
  );
  const reachable = new Map<string, { id: string; parents: string[]; author: string; authored_at: number; committer: string; committed_at: number; message: string; tree: string }>();
  const queue = refs.map((ref) => ref.commit_id);
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (reachable.has(id)) continue;
    const commit = await sql.one<{
      id: string;
      parents: string[];
      author: string;
      authored_at: string;
      committer: string;
      committed_at: string;
      message: string;
      tree: string;
    }>(
      'select id, parents, author, authored_at, committer, committed_at, message, tree from commits where project_id = $1 and id = $2',
      [project.id, id],
    );
    if (commit === null) continue;
    reachable.set(id, {
      ...commit,
      authored_at: Number(commit.authored_at),
      committed_at: Number(commit.committed_at),
    });
    queue.push(...commit.parents);
  }

  const issues = await sql.query<{
    iid: number;
    title: string;
    state: string;
    author: string;
    labels: string[];
    milestone_id: string | null;
    weight: number | null;
    confidential: boolean;
    description: string;
    id: string;
  }>(
    `select id, iid, title, state, author, labels, milestone_id, weight, confidential, description
     from issues where project_id = $1 order by iid`,
    [project.id],
  );
  const requests = await sql.query<{
    id: string;
    iid: number;
    title: string;
    state: string;
    author: string;
    source: string;
    target: string;
    description: string;
  }>(
    `select id, iid, title, state, author, source, target, description from merge_requests
     where project_id = $1 order by iid`,
    [project.id],
  );
  const threads = await sql.query<{
    mr_id: string;
    position: { path: string; new_line: number | null; old_line: number | null } | null;
    resolved: boolean;
    id: string;
  }>('select id, mr_id, position, resolved from threads where project_id = $1 order by id', [project.id]);
  const wiki = await sql.query<{ slug: string; version: number; author: string; title: string; content: string }>(
    'select slug, version, author, title, content from wiki_pages where project_id = $1 order by slug, version',
    [project.id],
  );
  const milestones = await sql.query<{ id: string; title: string; start_date: string | null; due_date: string | null; time_zone: string; state: string }>(
    `select id, title, start_date::text as start_date, due_date::text as due_date, time_zone, state
     from milestones where project_id = $1 order by title`,
    [project.id],
  );

  const usernames = new Set<string>();
  for (const commit of reachable.values()) {
    usernames.add(commit.author);
    usernames.add(commit.committer);
  }
  for (const issue of issues) usernames.add(issue.author);
  for (const request of requests) usernames.add(request.author);
  for (const page of wiki) usernames.add(page.author);
  const threadAuthors = new Map<number, { author: string; body: string }>();
  for (const thread of threads) {
    const note = await sql.one<{ author: string; body: string }>(
      'select author, body from notes where thread_id = $1 and system = false order by id limit 1',
      [Number(thread.id)],
    );
    if (note === null) continue;
    threadAuthors.set(Number(thread.id), note);
    usernames.add(note.author);
  }
  for (const username of [...usernames].sort()) {
    lines.push(`user\t${encodeField(username)}`);
  }

  const sorted = topologicalCommits([...reachable.values()]);
  for (const commit of sorted) {
    const files = await filesOfCommit(sql, project.id, commit.id);
    for (const path of [...files.keys()].sort()) {
      lines.push(`file\t${encodeField(path)}\t${encodeField(files.get(path) ?? '')}`);
    }
    lines.push(
      [
        'commit',
        encodeField(commit.id),
        encodeList(commit.parents),
        encodeField(`${commit.author} ${commit.authored_at}`),
        encodeField(`${commit.committer} ${commit.committed_at}`),
        encodeField(commit.message),
      ].join('\t'),
    );
  }

  const branchRefs = refs.filter((ref) => ref.kind === 'branch').sort((a, b) => (a.name < b.name ? -1 : 1));
  const tagRefs = refs.filter((ref) => ref.kind === 'tag').sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const ref of [...branchRefs, ...tagRefs]) {
    lines.push(`ref\t${encodeField(ref.kind)}\t${encodeField(ref.name)}\t${encodeField(ref.commit_id)}`);
  }

  const projectLabels = await sql.query<{ name: string; description: string }>(
    'select name, description from labels where project_id = $1',
    [project.id],
  );
  const groupLabels = await sql.query<{ name: string; description: string }>(
    `with recursive chain as (
       select id, parent_id from groups where id = $1
       union all select g.id, g.parent_id from groups g join chain c on g.id = c.parent_id
     )
     select name, description from labels where group_id in (select id from chain)`,
    [project.group_id],
  );
  const usedLabels = new Set<string>();
  for (const issue of issues) {
    for (const label of issue.labels) usedLabels.add(label);
  }
  const labelMap = new Map<string, string>();
  for (const label of groupLabels) {
    if (usedLabels.has(label.name)) labelMap.set(label.name, label.description);
  }
  for (const label of projectLabels) labelMap.set(label.name, label.description);
  for (const name of [...labelMap.keys()].sort()) {
    lines.push(`label\t${encodeField(name)}\t${encodeField(labelMap.get(name) ?? '')}`);
  }

  for (const milestone of milestones) {
    lines.push(
      [
        'milestone',
        encodeField(milestone.title),
        encodeField(milestone.start_date),
        encodeField(milestone.due_date),
        encodeField(milestone.time_zone),
        encodeField(milestone.state),
      ].join('\t'),
    );
  }

  const milestoneTitles = new Map<number, string>();
  for (const milestone of milestones) milestoneTitles.set(Number(milestone.id), milestone.title);
  for (const issue of issues) {
    lines.push(
      [
        'issue',
        String(issue.iid),
        encodeField(issue.title),
        encodeField(issue.state),
        encodeField(issue.author),
        encodeList(issue.labels),
        encodeField(issue.milestone_id === null ? null : milestoneTitles.get(Number(issue.milestone_id)) ?? null),
        issue.weight === null ? '-' : String(issue.weight),
        issue.confidential ? 'true' : 'false',
        encodeField(issue.description),
      ].join('\t'),
    );
  }

  for (const request of requests) {
    lines.push(
      [
        'request',
        String(request.iid),
        encodeField(request.title),
        encodeField(request.state),
        encodeField(request.author),
        encodeField(request.source),
        encodeField(request.target),
        encodeField(request.description),
      ].join('\t'),
    );
  }

  const requestIids = new Map<number, number>();
  for (const request of requests) requestIids.set(Number(request.id), Number(request.iid));
  const sortedThreads = threads
    .filter((thread) => threadAuthors.has(Number(thread.id)))
    .sort((a, b) => (requestIids.get(Number(a.mr_id)) ?? 0) - (requestIids.get(Number(b.mr_id)) ?? 0) || Number(a.id) - Number(b.id));
  for (const thread of sortedThreads) {
    const note = threadAuthors.get(Number(thread.id));
    if (note === undefined) continue;
    const line = thread.position === null ? null : thread.position.new_line ?? thread.position.old_line;
    lines.push(
      [
        'thread',
        String(requestIids.get(Number(thread.mr_id)) ?? 0),
        thread.position === null ? '-' : encodeField(thread.position.path),
        line === null || line === undefined ? '-' : String(line),
        thread.resolved ? 'true' : 'false',
        encodeField(note.author),
        encodeField(note.body),
      ].join('\t'),
    );
  }

  for (const page of wiki) {
    lines.push(
      [
        'wikipage',
        encodeField(page.slug),
        String(page.version),
        encodeField(page.author),
        encodeField(page.title),
        encodeField(page.content),
      ].join('\t'),
    );
  }

  const settings = { ...defaultSettings, ...project.settings } as Record<string, unknown>;
  for (const key of configKeys) {
    const value =
      key === 'default_branch'
        ? project.default_branch
        : key === 'visibility'
          ? project.visibility
          : String(settings[key] ?? false);
    lines.push(`config\t${encodeField(key)}\t${encodeField(String(value))}`);
  }

  return `${lines.join('\n')}\n`;
}

type ExportCommit = {
  id: string;
  parents: string[];
  author: string;
  authored_at: number;
  committer: string;
  committed_at: number;
  message: string;
  tree: string;
};

function topologicalCommits(commits: ExportCommit[]): ExportCommit[] {
  const byId = new Map(commits.map((commit) => [commit.id, commit]));
  const out: ExportCommit[] = [];
  const placed = new Set<string>();
  const ready = (): ExportCommit[] =>
    commits
      .filter((commit) => !placed.has(commit.id))
      .filter((commit) => commit.parents.every((parent) => placed.has(parent) || !byId.has(parent)))
      .sort((a, b) => a.committed_at - b.committed_at || (a.id < b.id ? -1 : 1));
  for (;;) {
    const next = ready()[0];
    if (next === undefined) break;
    out.push(next);
    placed.add(next.id);
  }
  return out;
}

export type ParsedPack = {
  errors: string[];
  users: string[];
  commits: { id: string; parents: string[]; author: string; authored_at: number; committer: string; committed_at: number; message: string; files: Map<string, string> }[];
  refs: { kind: string; name: string; commit: string }[];
  labels: { name: string; description: string }[];
  milestones: { title: string; start: string | null; due: string | null; zone: string; state: string }[];
  issues: {
    iid: number;
    title: string;
    state: string;
    author: string;
    labels: string[];
    milestone: string | null;
    weight: number | null;
    confidential: boolean;
    description: string;
  }[];
  requests: { iid: number; title: string; state: string; author: string; source: string; target: string; description: string }[];
  threads: { request: number; path: string | null; line: number | null; resolved: boolean; author: string; body: string }[];
  wiki: { slug: string; version: number; author: string; title: string; content: string }[];
  config: { key: string; value: string }[];
};

const usernamePattern = /^[a-z0-9_]{3,24}$/;

function validPath(path: string): boolean {
  if (path === '') return false;
  if (path.startsWith('/')) return false;
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

export async function parsePack(sql: Sql, text: string): Promise<ParsedPack> {
  const out: ParsedPack = {
    errors: [],
    users: [],
    commits: [],
    refs: [],
    labels: [],
    milestones: [],
    issues: [],
    requests: [],
    threads: [],
    wiki: [],
    config: [],
  };
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  if (lines[0] !== packHeader) {
    out.errors.push('Line 1: not a spurpack file.');
    return out;
  }
  const seen = {
    users: new Set<string>(),
    commits: new Set<string>(),
    refs: new Set<string>(),
    labels: new Set<string>(),
    milestones: new Set<string>(),
    issues: new Set<number>(),
    requests: new Set<number>(),
    wiki: new Set<string>(),
    config: new Set<string>(),
  };
  let pendingFiles: { path: string; content: string }[] = [];
  let pendingFilesLine = 0;
  const push = (line: number, text2: string): void => {
    if (out.errors.length < 20) out.errors.push(`Line ${line}: ${text2}`);
  };
  const wikiVersions = new Map<string, number>();

  for (let index = 1; index < lines.length; index += 1) {
    const line = index + 1;
    const fields = lines[index].split('\t');
    const record = fields[0];
    if (recordFieldCounts[record] === undefined) {
      push(line, `unknown record "${record}".`);
      continue;
    }
    if (record !== 'file' && pendingFiles.length > 0 && record !== 'commit') {
      push(pendingFilesLine, 'file belongs to no commit.');
      pendingFiles = [];
    }
    if (fields.length !== recordFieldCounts[record]) {
      push(line, `${record} needs ${recordFieldCounts[record]} fields, got ${fields.length}.`);
      continue;
    }
    if (record === 'user') {
      const username = decodeField(fields[1]);
      if (!(usernamePattern.test(username) || username === 'spurline-train')) {
        push(line, 'bad value for username.');
        continue;
      }
      if (seen.users.has(username)) {
        push(line, `duplicate user ${username}.`);
        continue;
      }
      seen.users.add(username);
      const existing = await sql.one<{ id: string }>('select id from users where username = $1', [username]);
      if (existing === null) {
        push(line, `user "${username}" doesn't exist here.`);
        continue;
      }
      out.users.push(username);
      continue;
    }
    if (record === 'file') {
      const path = decodeField(fields[1]);
      if (!validPath(path)) {
        push(line, 'bad value for path.');
        continue;
      }
      if (pendingFiles.some((file) => file.path === path)) {
        push(line, `duplicate file ${path}.`);
        continue;
      }
      if (pendingFiles.length === 0) pendingFilesLine = line;
      pendingFiles.push({ path, content: decodeField(fields[2]) });
      continue;
    }
    if (record === 'commit') {
      const id = decodeField(fields[1]);
      const parents = decodeList(fields[2]);
      const author = decodeField(fields[3]);
      const committer = decodeField(fields[4]);
      const message = decodeField(fields[5]);
      if (!/^[0-9a-f]{64}$/.test(id)) {
        push(line, 'bad value for id.');
        pendingFiles = [];
        continue;
      }
      if (!parents.every((parent) => /^[0-9a-f]{64}$/.test(parent))) {
        push(line, 'bad value for parents.');
        pendingFiles = [];
        continue;
      }
      const authorParts = /^(\S+) (\d+)$/.exec(author);
      const committerParts = /^(\S+) (\d+)$/.exec(committer);
      if (authorParts === null) {
        push(line, 'bad value for author.');
        pendingFiles = [];
        continue;
      }
      if (committerParts === null) {
        push(line, 'bad value for committer.');
        pendingFiles = [];
        continue;
      }
      if (message.replace(/\s+$/u, '') === '') {
        push(line, 'bad value for message.');
        pendingFiles = [];
        continue;
      }
      if (!out.users.includes(authorParts[1])) {
        push(line, 'bad value for author.');
        pendingFiles = [];
        continue;
      }
      if (!out.users.includes(committerParts[1])) {
        push(line, 'bad value for committer.');
        pendingFiles = [];
        continue;
      }
      if (seen.commits.has(id)) {
        push(line, `duplicate commit ${id}.`);
        pendingFiles = [];
        continue;
      }
      seen.commits.add(id);
      const unknownParent = parents.find((parent) => !out.commits.some((commit) => commit.id === parent));
      if (unknownParent !== undefined) {
        push(line, `commit ${id.slice(0, 7)} has unknown parent ${unknownParent.slice(0, 7)}.`);
        pendingFiles = [];
        continue;
      }
      const files = new Map(pendingFiles.map((file) => [file.path, file.content]));
      pendingFiles = [];
      const { treeIdOf } = await import('./packtree');
      const tree = treeIdOf(files);
      const expected = hashCommit({
        tree,
        parents,
        author: authorParts[1],
        authored_at: Number(authorParts[2]),
        committer: committerParts[1],
        committed_at: Number(committerParts[2]),
        message,
      });
      if (expected !== id) {
        push(line, "commit id doesn't match its contents.");
        continue;
      }
      out.commits.push({
        id,
        parents,
        author: authorParts[1],
        authored_at: Number(authorParts[2]),
        committer: committerParts[1],
        committed_at: Number(committerParts[2]),
        message,
        files,
      });
      continue;
    }
    if (record === 'ref') {
      const kind = decodeField(fields[1]);
      const name = decodeField(fields[2]);
      const commit = decodeField(fields[3]);
      if (kind !== 'branch' && kind !== 'tag') {
        push(line, 'bad value for kind.');
        continue;
      }
      if (name === '') {
        push(line, 'bad value for name.');
        continue;
      }
      if (!/^[0-9a-f]{64}$/.test(commit)) {
        push(line, 'bad value for commit.');
        continue;
      }
      if (seen.refs.has(`${kind} ${name}`)) {
        push(line, `duplicate ref ${kind} ${name}.`);
        continue;
      }
      seen.refs.add(`${kind} ${name}`);
      if (!out.commits.some((item) => item.id === commit)) {
        push(line, `ref ${name} points to unknown commit ${commit.slice(0, 7)}.`);
        continue;
      }
      out.refs.push({ kind, name, commit });
      continue;
    }
    if (record === 'label') {
      const name = decodeField(fields[1]);
      if (name === '' || name.includes('\t') || name.includes('\n')) {
        push(line, 'bad value for name.');
        continue;
      }
      if (seen.labels.has(name)) {
        push(line, `duplicate label ${name}.`);
        continue;
      }
      seen.labels.add(name);
      out.labels.push({ name, description: decodeField(fields[2]) });
      continue;
    }
    if (record === 'milestone') {
      const title = decodeField(fields[1]);
      const start = decodeField(fields[2]);
      const due = decodeField(fields[3]);
      const zone = decodeField(fields[4]);
      const state = decodeField(fields[5]);
      if (title === '' || title.length > 255) {
        push(line, 'bad value for title.');
        continue;
      }
      if (start !== '' && !validDate(start)) {
        push(line, 'bad value for start.');
        continue;
      }
      if (due !== '' && !validDate(due)) {
        push(line, 'bad value for due.');
        continue;
      }
      if (start !== '' && due !== '' && start > due) {
        push(line, 'bad value for start.');
        continue;
      }
      let zoneOk = true;
      try {
        new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date());
      } catch {
        zoneOk = false;
      }
      if (!zoneOk) {
        push(line, 'bad value for zone.');
        continue;
      }
      if (state !== 'active' && state !== 'closed') {
        push(line, 'bad value for state.');
        continue;
      }
      if (seen.milestones.has(title)) {
        push(line, `duplicate milestone ${title}.`);
        continue;
      }
      seen.milestones.add(title);
      out.milestones.push({
        title,
        start: start === '' ? null : start,
        due: due === '' ? null : due,
        zone,
        state,
      });
      continue;
    }
    if (record === 'issue') {
      const iid = Number(fields[1]);
      const title = decodeField(fields[2]);
      const state = decodeField(fields[3]);
      const author = decodeField(fields[4]);
      const labels = decodeList(fields[5]);
      const milestone = decodeField(fields[6]);
      const weightRaw = fields[7];
      const confidential = fields[8];
      if (!Number.isInteger(iid) || iid <= 0) {
        push(line, 'bad value for iid.');
        continue;
      }
      if (title === '' || title.length > 255) {
        push(line, 'bad value for title.');
        continue;
      }
      if (state !== 'opened' && state !== 'closed') {
        push(line, 'bad value for state.');
        continue;
      }
      if (!out.users.includes(author)) {
        push(line, 'bad value for author.');
        continue;
      }
      if (!labels.every((label) => out.labels.some((item) => item.name === label))) {
        push(line, 'bad value for labels.');
        continue;
      }
      if (milestone !== '' && !out.milestones.some((item) => item.title === milestone)) {
        push(line, 'bad value for milestone.');
        continue;
      }
      let weight: number | null = null;
      if (weightRaw !== '-') {
        weight = Number(weightRaw);
        if (!Number.isInteger(weight) || weight < 0 || weight > 100) {
          push(line, 'bad value for weight.');
          continue;
        }
      }
      if (confidential !== 'true' && confidential !== 'false') {
        push(line, 'bad value for confidential.');
        continue;
      }
      if (seen.issues.has(iid)) {
        push(line, `duplicate issue ${iid}.`);
        continue;
      }
      seen.issues.add(iid);
      out.issues.push({
        iid,
        title,
        state,
        author,
        labels,
        milestone: milestone === '' ? null : milestone,
        weight,
        confidential: confidential === 'true',
        description: decodeField(fields[9]),
      });
      continue;
    }
    if (record === 'request') {
      const iid = Number(fields[1]);
      const title = decodeField(fields[2]);
      const state = decodeField(fields[3]);
      const author = decodeField(fields[4]);
      const source = decodeField(fields[5]);
      const target = decodeField(fields[6]);
      if (!Number.isInteger(iid) || iid <= 0) {
        push(line, 'bad value for iid.');
        continue;
      }
      if (title === '' || title.length > 255) {
        push(line, 'bad value for title.');
        continue;
      }
      if (!['opened', 'closed', 'merged'].includes(state)) {
        push(line, 'bad value for state.');
        continue;
      }
      if (!out.users.includes(author)) {
        push(line, 'bad value for author.');
        continue;
      }
      if (source === '') {
        push(line, 'bad value for source.');
        continue;
      }
      if (target === '') {
        push(line, 'bad value for target.');
        continue;
      }
      if (seen.requests.has(iid)) {
        push(line, `duplicate request ${iid}.`);
        continue;
      }
      seen.requests.add(iid);
      out.requests.push({ iid, title, state, author, source, target, description: decodeField(fields[7]) });
      continue;
    }
    if (record === 'thread') {
      const request = Number(fields[1]);
      const path = fields[2] === '-' ? null : decodeField(fields[2]);
      const lineRaw = fields[3];
      const resolved = fields[4];
      const author = decodeField(fields[5]);
      const body = decodeField(fields[6]);
      if (!out.requests.some((item) => item.iid === request)) {
        push(line, 'bad value for request.');
        continue;
      }
      if (path !== null && !validPath(path)) {
        push(line, 'bad value for path.');
        continue;
      }
      const hasLine = lineRaw !== '-';
      if ((path === null) === hasLine) {
        push(line, 'bad value for line.');
        continue;
      }
      if (hasLine && (!Number.isInteger(Number(lineRaw)) || Number(lineRaw) <= 0)) {
        push(line, 'bad value for line.');
        continue;
      }
      if (resolved !== 'true' && resolved !== 'false') {
        push(line, 'bad value for resolved.');
        continue;
      }
      if (!out.users.includes(author)) {
        push(line, 'bad value for author.');
        continue;
      }
      if (body === '') {
        push(line, 'bad value for body.');
        continue;
      }
      out.threads.push({
        request,
        path,
        line: hasLine ? Number(lineRaw) : null,
        resolved: resolved === 'true',
        author,
        body,
      });
      continue;
    }
    if (record === 'wikipage') {
      const slug = decodeField(fields[1]);
      const version = Number(fields[2]);
      const author = decodeField(fields[3]);
      const title = decodeField(fields[4]);
      if (slug === '' || !/^[a-z0-9\-/]+$/.test(slug)) {
        push(line, 'bad value for slug.');
        continue;
      }
      const expected = (wikiVersions.get(slug) ?? 0) + 1;
      if (version !== expected) {
        push(line, 'bad value for version.');
        continue;
      }
      if (!out.users.includes(author)) {
        push(line, 'bad value for author.');
        continue;
      }
      if (title === '' || title.length > 255) {
        push(line, 'bad value for title.');
        continue;
      }
      if (seen.wiki.has(`${slug} ${version}`)) {
        push(line, `duplicate wikipage ${slug} ${version}.`);
        continue;
      }
      seen.wiki.add(`${slug} ${version}`);
      wikiVersions.set(slug, version);
      out.wiki.push({ slug, version, author, title, content: decodeField(fields[5]) });
      continue;
    }
    const key = decodeField(fields[1]);
    const value = decodeField(fields[2]);
    if (!configKeys.includes(key)) {
      push(line, 'bad value for key.');
      continue;
    }
    const booleanKeys = [
      'author_can_approve',
      'auto_resolve_outdated',
      'merge_trains',
      'pipelines_must_succeed',
      'reset_approvals_on_push',
    ];
    if (key === 'merge_method' && !['merge_commit', 'squash', 'fast_forward', 'rebase'].includes(value)) {
      push(line, 'bad value for value.');
      continue;
    }
    if (key === 'visibility' && !['private', 'internal', 'public'].includes(value)) {
      push(line, 'bad value for value.');
      continue;
    }
    if (key === 'default_branch' && !out.refs.some((ref) => ref.kind === 'branch' && ref.name === value)) {
      push(line, 'bad value for value.');
      continue;
    }
    if (booleanKeys.includes(key) && value !== 'true' && value !== 'false') {
      push(line, 'bad value for value.');
      continue;
    }
    if (seen.config.has(key)) {
      push(line, `duplicate config ${key}.`);
      continue;
    }
    seen.config.add(key);
    out.config.push({ key, value });
  }
  if (pendingFiles.length > 0) {
    push(pendingFilesLine, 'file belongs to no commit.');
  }
  return out;
}

export function packValidation(parsed: ParsedPack): ApiError | null {
  if (parsed.errors.length === 0) return null;
  return new ApiError(422, 'invalid_pack', parsed.errors[0], { errors: parsed.errors });
}

export async function applyPack(t: Tx, project: ProjectRow, parsed: ParsedPack): Promise<void> {
  for (const commit of parsed.commits) {
    const tree = await writeTree(t, project.id, commit.files);
    await storeCommit(t, project.id, {
      tree,
      parents: commit.parents,
      author: commit.author,
      authored_at: commit.authored_at,
      committer: commit.committer,
      committed_at: commit.committed_at,
      message: commit.message,
    });
  }
  for (const ref of parsed.refs) {
    if (ref.kind === 'branch') {
      await setBranch(t, project.id, ref.name, ref.commit);
    } else {
      await t.sql.query(
        `insert into refs (project_id, kind, name, commit_id) values ($1, 'tag', $2, $3)
         on conflict (project_id, kind, name) do update set commit_id = $3`,
        [project.id, ref.name, ref.commit],
      );
    }
  }
  for (const label of parsed.labels) {
    await t.sql.query('insert into labels (project_id, name, description) values ($1, $2, $3)', [
      project.id,
      label.name,
      label.description,
    ]);
  }
  const milestoneIds = new Map<string, number>();
  for (const milestone of parsed.milestones) {
    const row = await t.sql.one<{ id: string }>(
      `insert into milestones (project_id, title, start_date, due_date, time_zone, state)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [project.id, milestone.title, milestone.start, milestone.due, milestone.zone, milestone.state],
    );
    milestoneIds.set(milestone.title, Number(row?.id));
  }
  for (const issue of parsed.issues) {
    await t.sql.query(
      `insert into issues (project_id, iid, title, description, author, state, labels, assignees, milestone_id,
                           weight, confidential, position, created_ms)
       values ($1, $2, $3, $4, $5, $6, $7, '[]', $8, $9, $10, $2, 0)`,
      [
        project.id,
        issue.iid,
        issue.title,
        issue.description,
        issue.author,
        issue.state,
        JSON.stringify(issue.labels),
        issue.milestone === null ? null : milestoneIds.get(issue.milestone) ?? null,
        issue.weight,
        issue.confidential,
      ],
    );
  }
  const maxIssue = parsed.issues.reduce((max, issue) => Math.max(max, issue.iid), 0);
  const requestIds = new Map<number, number>();
  for (const request of parsed.requests) {
    const row = await t.sql.one<{ id: string }>(
      `insert into merge_requests (project_id, iid, title, description, author, source, target, state)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [project.id, request.iid, request.title, request.description, request.author, request.source, request.target, request.state],
    );
    requestIds.set(request.iid, Number(row?.id));
  }
  const maxRequest = parsed.requests.reduce((max, request) => Math.max(max, request.iid), 0);
  for (const thread of parsed.threads) {
    const mrId = requestIds.get(thread.request);
    if (mrId === undefined) continue;
    const row = await t.sql.one<{ id: string }>(
      `insert into threads (project_id, mr_id, position, current_line, resolved, outdated)
       values ($1, $2, $3, $4, $5, false) returning id`,
      [
        project.id,
        mrId,
        thread.path === null
          ? null
          : JSON.stringify({ path: thread.path, old_line: null, new_line: thread.line, end_line: null, version: 1 }),
        thread.line,
        thread.resolved,
      ],
    );
    await t.sql.query(
      `insert into notes (project_id, mr_id, thread_id, author, body, system, created_ms)
       values ($1, $2, $3, $4, $5, false, 0)`,
      [project.id, mrId, Number(row?.id), thread.author, thread.body],
    );
  }
  for (const page of parsed.wiki) {
    await t.sql.query(
      'insert into wiki_pages (project_id, slug, version, title, content, author) values ($1, $2, $3, $4, $5, $6)',
      [project.id, page.slug, page.version, page.title, page.content, page.author],
    );
  }
  const settings: Record<string, unknown> = { ...defaultSettings };
  let defaultBranch = project.default_branch;
  let visibility = project.visibility;
  for (const entry of parsed.config) {
    if (entry.key === 'default_branch') {
      defaultBranch = entry.value;
      continue;
    }
    if (entry.key === 'visibility') {
      visibility = entry.value;
      continue;
    }
    if (entry.key === 'merge_method') {
      settings.merge_method = entry.value;
      continue;
    }
    settings[entry.key] = entry.value === 'true';
  }
  await t.sql.query(
    `update projects set settings = $2, default_branch = $3, visibility = $4, next_issue_iid = $5, next_mr_iid = $6
     where id = $1`,
    [project.id, JSON.stringify(settings), defaultBranch, visibility, maxIssue + 1, maxRequest + 1],
  );
  for (const request of parsed.requests) {
    const mrId = requestIds.get(request.iid);
    if (mrId === undefined) continue;
    const head = parsed.refs.find((ref) => ref.kind === 'branch' && ref.name === request.source);
    if (head === undefined) continue;
    await t.sql.query(
      'insert into mr_versions (mr_id, number, base, head, start_commit) values ($1, 1, $2, $2, $2)',
      [mrId, head.commit],
    );
  }
  await emit(t, project.id, 'import', { project: project.id, status: 'finished' });
}

export async function importGroupProject(
  t: Tx,
  groupId: number,
  slug: string,
  defaultBranch: string,
): Promise<ProjectRow> {
  const group = await loadGroup(t.sql, groupId);
  if (group === null) throw errors.notFound();
  const path = `${group.path}/${slug}`;
  const row = await t.sql.one<{ id: string }>(
    `insert into projects (group_id, slug, path, visibility, default_branch, settings)
     values ($1, $2, $3, $4, $5, '{}') returning id`,
    [groupId, slug, path, group.visibility, defaultBranch],
  );
  const { loadProject } = await import('./access');
  const project = await loadProject(t.sql, Number(row?.id));
  if (project === null) throw errors.notFound();
  return project;
}
