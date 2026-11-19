import { Errors, expectObject, visibleRepo, type RequestContext , parseBodyWithLimit } from './context.js';
import { STORAGE_OUTAGE_PUSH, STORAGE_OUTAGE_ARCHIVE } from '../storage.js';
import { isValidBranchName, isValidPath } from '../../shared/rules.js';
import { isHex12 } from '../../shared/bytes.js';
import { getBranch, revisionFileRows, revisionFileTexts, type ChangeRow } from '../store/revisions.js';
import { performPush } from '../store/push.js';
import { type ServiceDeps } from '../store/domain.js';

function parseBody(ctx: { cfg: { pushSizeLimitBytes: number }; req: { body: Buffer; url: URL } }): unknown {
  return parseBodyWithLimit(ctx);
}

interface PushEntry { path: string; content?: string; content_base64?: string; delete?: boolean }

/**
 * POST /api/repos/<org>/<repo>/push — one route, the published error order:
 * auth, not found, forbidden, size, stale head, invalid input, outage.
 */
export async function push(ctx: RequestContext, org: string, repoName: string): Promise<{ status: number; body: unknown }> {
  const body = expectObject(parseBody(ctx));
  // Order: the branch must exist or be created from `from`.
  const branch = typeof body.branch === 'string' ? body.branch : '';
  if (!branch) throw Errors.invalid({ branch: 'branch is required' });
  const expectedHead = body.expected_head === null || body.expected_head === undefined ? null : body.expected_head;
  const from = typeof body.from === 'string' ? body.from : null;
  const message = typeof body.message === 'string' ? body.message : '';
  const filesRaw = body.files;
  const repo = await visibleRepo(ctx, org, repoName, 'write');
  // Branch validation
  if (!isValidBranchName(branch)) throw Errors.invalid({ branch: 'Invalid branch name' });
  // Files validation
  if (!Array.isArray(filesRaw) || filesRaw.length < 1 || filesRaw.length > 200) {
    throw Errors.invalid({ files: 'files is required' });
  }
  const errors: Record<string, string> = {};
  const entries: PushEntry[] = filesRaw as PushEntry[];
  const seen = new Set<string>();
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e === null || typeof e !== 'object') { errors[`files.${i}.path`] = 'Invalid path'; continue; }
    const path = typeof e.path === 'string' ? e.path : '';
    if (!isValidPath(path)) errors[`files.${i}.path`] = 'Invalid path';
    else if (seen.has(path)) errors[`files.${i}.path`] = 'Duplicate path';
    else seen.add(path);
  }
  if (!message || message.length < 1 || message.length > 500) errors.message = 'Message is required';
  if (Object.keys(errors).length > 0) throw Errors.invalid(errors);
  const branchRow = await getBranch(ctx.tx, repo.id, branch);
  let parentRevision: string | null;
  let creatingBranch = false;
  if (expectedHead !== null) {
    if (typeof expectedHead !== 'string' || !isHex12(expectedHead)) {
      throw Errors.invalid({ expected_head: 'expected_head is required' });
    }
    if (!branchRow) throw Errors.notFound();
    if (branchRow.revision_id !== expectedHead) throw Errors.staleHead(branchRow.revision_id);
    parentRevision = expectedHead;
  } else {
    // null expected_head creates the branch from `from`
    if (branchRow) {
      if (!from) throw Errors.staleHead(branchRow.revision_id);
      if (from === branch) throw Errors.staleHead(branchRow.revision_id);
    }
    const fromName = from ?? 'main';
    const fromRow = await getBranch(ctx.tx, repo.id, fromName);
    if (!fromRow) throw Errors.notFound();
    if (branchRow && fromRow.revision_id !== branchRow.revision_id) {
      throw Errors.staleHead(branchRow.revision_id);
    }
    parentRevision = fromRow.revision_id;
    creatingBranch = !branchRow;
  }
  // Deletes of absent paths are invalid.
  const snapshotPaths = new Set<string>();
  for (const row of await revisionFileRows(ctx.tx, repo.id, parentRevision)) snapshotPaths.add(row.path);
  const pushFiles: Array<{ path: string; content: string | null }> = [];
  const deleteErrors: Record<string, string> = {};
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e === null || typeof e !== 'object') continue;
    const path = typeof e.path === 'string' ? e.path : '';
    let content: string | null | undefined;
    if (e.delete === true) {
      if (!snapshotPaths.has(path) && !entries.some((x, j) => j < i && x.path === path && 'content' in x)) {
        deleteErrors[`files.${i}.path`] = 'Path does not exist';
      }
      pushFiles.push({ path, content: null });
    } else if (typeof e.content === 'string') {
      pushFiles.push({ path, content: e.content });
    } else if (typeof e.content_base64 === 'string') {
      const decoded = Buffer.from(e.content_base64, 'base64');
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(decoded);
      } catch {
        throw Errors.invalid({ [`files.${i}.content_base64`]: `File ${path} is not UTF-8 text` });
      }
      pushFiles.push({ path, content: decoded.toString('utf8') });
    } else {
      throw Errors.invalid({ [`files.${i}.path`]: 'Invalid path' });
    }
  }
  if (Object.keys(deleteErrors).length > 0) throw Errors.invalid(deleteErrors);
  // Storage outage: refuse before creating anything.
  const storageOk = await ctx.storage.healthy();
  if (!storageOk) throw Errors.outage(STORAGE_OUTAGE_PUSH);
  const author = ctx.auth.token
    ? { username: `token:${ctx.auth.token.name}`, name: ctx.auth.token.name }
    : { username: ctx.auth.user!.username, name: ctx.auth.user!.name };
  if (creatingBranch) {
    await ctx.tx.query('INSERT INTO branches (repo_id, name, revision_id) VALUES ($1,$2,$3)', [repo.id, branch, parentRevision]);
  }
  const outcome = await performPush(depsOf(ctx), ctx.tx, repo.id, branch, parentRevision, message, pushFiles, author);
  // Live updates for the new revision and restacks.
  for (const change of await openChangesOnBranch(ctx, repo.id, branch)) {
    announce(ctx, repo.id, { kind: 'change', number: change.number, event: 'new_revision', revision: outcome.revision, author: author.name });
  }
  for (const ev of outcome.restackEvents) {
    announce(ctx, repo.id, { kind: 'change', number: ev.changeNumber, event: 'restack', result: ev.result, notice: ev.notice });
  }
  return { status: 201, body: { revision: outcome.revision, branch, parent: parentRevision } };
}

async function openChangesOnBranch(ctx: RequestContext, repoId: number, branch: string): Promise<ChangeRow[]> {
  const r = await ctx.tx.query(
    "SELECT * FROM changes WHERE repo_id = $1 AND head_branch = $2 AND state IN ('draft','open','removed','queued')",
    [repoId, branch],
  );
  return r.rows;
}

function announce(ctx: RequestContext, repoId: number, payload: Record<string, unknown>): void {
  ctx.live.publish({ repoId, kind: 'update', payload });
}

function depsOf(ctx: RequestContext): ServiceDeps {
  return {
    db: ctx.db.pool,
    cfg: ctx.cfg,
    clock: ctx.clock,
    storage: ctx.storage,
    mailer: ctx.mailer,
    live: ctx.live,
  };
}

/** GET /api/repos/<org>/<repo>/branches/<branch> */
export async function getBranchRoute(ctx: RequestContext, org: string, name: string, branch: string): Promise<{ status: number; body: unknown }> {
  await visibleRepo(ctx, org, name, 'read');
  const repo = await getRepoByNameOrThrow(ctx, org, name);
  const row = await getBranch(ctx.tx, repo.id, branch);
  if (!row) throw Errors.notFound();
  return { status: 200, body: { name: row.name, revision: row.revision_id } };
}

async function getRepoByNameOrThrow(ctx: RequestContext, org: string, name: string) {
  const { getRepoByPath } = await import('../store/revisions.js');
  const repo = await getRepoByPath(ctx.tx, org, name);
  if (!repo) throw Errors.notFound();
  return repo;
}

/** GET /api/repos/<org>/<repo>/revisions/<id> */
export async function getRevisionRoute(ctx: RequestContext, org: string, name: string, id: string): Promise<{ status: number; body: unknown }> {
  await visibleRepo(ctx, org, name, 'read');
  const repo = await getRepoByNameOrThrow(ctx, org, name);
  const { getRevision } = await import('../store/revisions.js');
  const rev = await getRevision(ctx.tx, repo.id, id);
  if (!rev) throw Errors.notFound();
  const files = await revisionFileRows(ctx.tx, repo.id, id);
  return {
    status: 200,
    body: {
      id: rev.id,
      parents: [rev.parent1, rev.parent2].filter((p) => p !== null),
      message: rev.message,
      author: rev.author_username,
      created_at: new Date(rev.created_at_ms).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      files: files.map((f) => ({ path: f.path, size: f.size })).sort((a, b) => (a.path < b.path ? -1 : 1)),
    },
  };
}

/** GET /api/repos/<org>/<repo>/revisions/<id>/files/<path> */
export async function getRevisionFile(ctx: RequestContext, org: string, name: string, id: string, path: string): Promise<{ status: number; body: string; type: string }> {
  await visibleRepo(ctx, org, name, 'read');
  const repo = await getRepoByNameOrThrow(ctx, org, name);
  const { getRevision } = await import('../store/revisions.js');
  const rev = await getRevision(ctx.tx, repo.id, id);
  if (!rev) throw Errors.notFound();
  const rows = await ctx.tx.query(
    'SELECT key FROM revision_files WHERE repo_id = $1 AND revision_id = $2 AND path = $3',
    [repo.id, id, path],
  );
  if (rows.rows.length === 0) throw Errors.notFound();
  const storageOk = await ctx.storage.healthy();
  if (!storageOk) throw Errors.outage(STORAGE_OUTAGE_PUSH);
  const content = await ctx.storage.get(rows.rows[0].key);
  return { status: 200, body: content, type: 'text/plain; charset=utf-8' };
}

/** POST /api/repos/<org>/<repo>/revisions/<id>/archive */
export async function exportArchive(ctx: RequestContext, org: string, name: string, id: string): Promise<{ status: number; body: unknown }> {
  await visibleRepo(ctx, org, name, 'maintainer');
  const repo = await getRepoByNameOrThrow(ctx, org, name);
  const { getRevision } = await import('../store/revisions.js');
  const rev = await getRevision(ctx.tx, repo.id, id);
  if (!rev) throw Errors.notFound();
  const storageOk = await ctx.storage.healthy();
  if (!storageOk) throw Errors.outage(STORAGE_OUTAGE_ARCHIVE);
  const files = await revisionFileTexts(ctx.tx, ctx.storage, repo.id, id);
  const prefix = `${repo.name}-${id}`;
  const entries: Array<{ name: string; content: string | null }> = [];
  for (const path of [...files.keys()].sort((a, b) => (a < b ? -1 : 1))) {
    entries.push({ name: `${prefix}/${path}`, content: files.get(path)! });
  }
  const revisionTxt = [
    `revision: ${id}`,
    rev.parent1 === null ? 'parents: none' : `parents: ${[rev.parent1, rev.parent2].filter((p) => p !== null).join(', ')}`,
    `author: ${rev.author_username}`,
    `message: ${rev.message}`,
    `time: ${new Date(rev.created_at_ms).toISOString().replace(/\.\d{3}Z$/, 'Z')}`,
    `files: ${files.size}`,
  ].join('\n');
  entries.push({ name: `${prefix}/REVISION.txt`, content: revisionTxt });
  const zip = await buildZip(entries);
  const key = `archives/${repo.id}/${id}.zip`;
  await ctx.storage.putZip(key, zip);
  const names = entries.map((e) => e.name).sort((a, b) => (Buffer.from(a) < Buffer.from(b) ? -1 : Buffer.from(a) > Buffer.from(b) ? 1 : 0));
  return { status: 201, body: { key, revision: id, entries: names } };
}

/** A minimal zip writer (store, no compression) for archive exports. */
async function buildZip(entries: Array<{ name: string; content: string | null }>): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const encoder = new TextEncoder();
  for (const e of entries) {
    const nameBytes = Buffer.from(e.name, 'utf8');
    const data = Buffer.from(e.content ?? '', 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBytes, data);
    const centralEntry = Buffer.alloc(46);
    centralEntry.writeUInt32LE(0x02014b50, 0);
    centralEntry.writeUInt16LE(20, 4);
    centralEntry.writeUInt16LE(20, 6);
    centralEntry.writeUInt16LE(0, 8);
    centralEntry.writeUInt16LE(0, 10);
    centralEntry.writeUInt16LE(0, 12);
    centralEntry.writeUInt16LE(0, 14);
    centralEntry.writeUInt32LE(crc, 16);
    centralEntry.writeUInt32LE(data.length, 20);
    centralEntry.writeUInt32LE(data.length, 24);
    centralEntry.writeUInt16LE(nameBytes.length, 28);
    centralEntry.writeUInt16LE(0, 30);
    centralEntry.writeUInt16LE(0, 32);
    centralEntry.writeUInt16LE(0, 34);
    centralEntry.writeUInt16LE(0, 36);
    centralEntry.writeUInt32LE(0, 38);
    centralEntry.writeUInt32LE(offset, 42);
    central.push(centralEntry, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  const all = Buffer.concat([...chunks, centralBuf, end]);
  return new Uint8Array(all);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** POST /api/repos/<org>/<repo>/checks */
export async function reportCheck(ctx: RequestContext, org: string, name: string): Promise<{ status: number; body: unknown }> {
  const body = expectObject(parseBody(ctx));
  const repo = await visibleRepo(ctx, org, name, 'write');
  const revision = typeof body.revision === 'string' ? body.revision : '';
  const checkName = typeof body.name === 'string' ? body.name : '';
  const state = typeof body.state === 'string' ? body.state : '';
  const summary = typeof body.summary === 'string' ? body.summary : '';
  const errors: Record<string, string> = {};
  if (!isHex12(revision)) errors.revision = 'Revision must be 12 hex characters';
  if (checkName === '') errors.name = 'Name is required';
  else if (checkName.length > 64) errors.name = 'Name must be 1 to 64 characters';
  if (!['queued', 'in_progress', 'success', 'failure'].includes(state)) errors.state = 'State must be one of queued, in_progress, success, failure';
  if (summary.length > 1000) errors.summary = 'Summary must be at most 1000 characters';
  if (Object.keys(errors).length > 0) throw Errors.invalid(errors);
  const { getRevision } = await import('../store/revisions.js');
  const rev = await getRevision(ctx.tx, repo.id, revision);
  if (!rev) throw Errors.notFound();
  // A report on a timed-out required check is refused.
  const deadline = rev.created_at_ms + ctx.cfg.checkTimeoutSeconds * 1000;
  if (repo.required_checks.includes(checkName) && ctx.clock.nowMs() >= deadline) {
    const existing = await ctx.tx.query(
      "SELECT 1 FROM checks WHERE repo_id = $1 AND revision = $2 AND name = $3 AND state IN ('success','failure')",
      [repo.id, revision, checkName],
    );
    if (existing.rows.length === 0) throw Errors.conflict(`Check ${checkName} timed out`);
  }
  await ctx.tx.query(
    'INSERT INTO checks (repo_id, revision, name, state, summary, created_at_ms) VALUES ($1,$2,$3,$4,$5,$6)',
    [repo.id, revision, checkName, state, summary, ctx.clock.nowMs()],
  );
  const stateWord = state === 'success' ? 'Passed' : state === 'failure' ? 'Failed' : state === 'in_progress' ? 'In progress' : 'Queued';
  announce(ctx, repo.id, { kind: 'check', revision, name: checkName, state, stateWord });
  return { status: 201, body: { revision, name: checkName, state } };
}
