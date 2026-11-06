import { ApiError, type Ctx } from '../api_types';
import { q } from '../db';
import { isUuid } from '../../shared/domain';
import {
  requireAccount, withDeviceApproved, vaultFor, revisionJson,
  idemKey, idemLookup, idemStore, base64Decode, checkEnvelope, pushRevisionInner, restoreInner,
} from './core';
import { readAddon } from '../billing';
import { getObject } from '../s3';
import { route } from './auth_routes';

const requestFingerprint = (path: string, body: unknown): string =>
  JSON.stringify([path, body ?? null]);

const requireVault = async (ctx: Ctx, vaultId: string) => {
  const account = requireAccount(ctx);
  await vaultFor(account.id, vaultId);
  await withDeviceApproved(ctx.deviceId as string);
  return { account, vault: await vaultFor(account.id, vaultId) };
};

const writableCheck = async (ownerId: string): Promise<void> => {
  const sync = await readAddon(ownerId, 'sync');
  if (sync.source === 'cache' && sync.state === 'none')
    throw new ApiError('billing_unavailable', 'Billing is unavailable. Try again shortly.');
  if (sync.state === 'lapsed' || sync.state === 'none')
    throw new ApiError('vault_read_only', 'Vault is read-only — Sync has lapsed.');
};

const pushEndpoint = (vaultId: string): string => `push:${vaultId}`;

route('POST', '/api/vaults/<vault_id>/notes/<note_id>/revisions', async (ctx, params) => {
  const [vaultId, noteId] = params;
  const { vault } = await requireVault(ctx, vaultId);
  if (!isUuid(noteId)) throw new ApiError('not_found', 'Note not found.');
  const key = idemKey(ctx);
  const body = ctx.body?.json() as { base_revision?: unknown; ciphertext?: unknown; ciphertext_sha256?: unknown };
  const endpoint = pushEndpoint(vault.id);
  const prior = await idemLookup(ctx.deviceId as string, endpoint, key);
  const fp = requestFingerprint(endpoint, body);
  if (prior) {
    if (prior.request_hash !== fp)
      throw new ApiError('idempotency_key_reused', 'This Idempotency-Key was used with a different body.');
    return {
      status: prior.status,
      body: prior.body,
      headers: { 'Cairn-Replayed': 'true' },
    };
  }
  await writableCheck(vault.owner_id);
  const fields: Record<string, string> = {};
  const baseRevision = body?.base_revision;
  if (baseRevision !== null && typeof baseRevision !== 'number')
    { fields.base_revision = 'must be an integer or null'; }
  const ciphertextRaw = body?.ciphertext;
  if (typeof ciphertextRaw !== 'string') fields.ciphertext = 'must be base64';
  const sha = body?.ciphertext_sha256;
  if (typeof sha !== 'string' || !/^[0-9a-f]{64}$/.test(sha))
    fields.ciphertext_sha256 = 'must be the SHA-256 of the decoded ciphertext bytes';
  if (Object.keys(fields).length) throw new ApiError('validation_failed', 'Check the highlighted fields.', { fields });
  const blob = base64Decode(ciphertextRaw as string);
  checkEnvelope(blob);
  const { createHash } = await import('crypto');
  const actual = createHash('sha256').update(blob).digest('hex');
  if (actual !== sha)
    throw new ApiError('validation_failed', 'Check the highlighted fields.', { fields: { ciphertext_sha256: 'does not match the ciphertext' } });
  try {
    const result = await pushRevisionInner(ctx, vault, noteId, (baseRevision as number | null), blob, null);
    await idemStore(ctx.deviceId as string, endpoint, key, fp, result.status, result.body);
    return result;
  } catch (e) {
    if (e instanceof ApiError && e.code === 'revision_conflict') {
      return {
        status: 409,
        body: { error: { code: 'revision_conflict', message: e.message, head_revision: (e.extra as { head_revision: number | null }).head_revision } },
      };
    }
    if (e instanceof ApiError && e.status >= 500) return {
      status: e.status,
      body: { error: { code: e.code, message: e.message } },
    };
    throw e;
  }
}, { limit: 4_000_000 });

route('POST', '/api/vaults/<vault_id>/notes/<note_id>/restore', async (ctx, params) => {
  const [vaultId, noteId] = params;
  const { vault } = await requireVault(ctx, vaultId);
  if (!isUuid(noteId)) throw new ApiError('not_found', 'Note not found.');
  const key = idemKey(ctx);
  const body = ctx.body?.json() as { revision?: unknown; base_revision?: unknown };
  const endpoint = `restore:${vault.id}`;
  const prior = await idemLookup(ctx.deviceId as string, endpoint, key);
  const fp = requestFingerprint(endpoint, body);
  if (prior) {
    if (prior.request_hash !== fp)
      throw new ApiError('idempotency_key_reused', 'This Idempotency-Key was used with a different body.');
    return { status: prior.status, body: prior.body, headers: { 'Cairn-Replayed': 'true' } };
  }
  await writableCheck(vault.owner_id);
  const fields: Record<string, string> = {};
  const revision = body?.revision;
  const baseRevision = body?.base_revision;
  if (typeof revision !== 'number' || !Number.isInteger(revision)) fields.revision = 'must be an integer';
  if (typeof baseRevision !== 'number' || !Number.isInteger(baseRevision)) fields.base_revision = 'must be an integer';
  if (Object.keys(fields).length) throw new ApiError('validation_failed', 'Check the highlighted fields.', { fields });
  const result = await restoreInner(ctx, vault, noteId, revision as number, baseRevision as number);
  await idemStore(ctx.deviceId as string, endpoint, key, fp, result.status, result.body);
  return result;
}, { limit: 4_000_000 });

route('GET', '/api/vaults/<vault_id>/revisions', async (ctx, params) => {
  const [vaultId] = params;
  const { vault } = await requireVault(ctx, vaultId);
  const afterStr = ctx.url.searchParams.get('after') ?? '0';
  const limitStr = ctx.url.searchParams.get('limit') ?? '100';
  const after = Number(afterStr);
  const limit = Number(limitStr);
  const fields: Record<string, string> = {};
  if (!Number.isInteger(after) || after < 0) fields.after = 'must be an integer from 0';
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) fields.limit = 'must be 1 to 500';
  if (Object.keys(fields).length) throw new ApiError('validation_failed', 'Check the highlighted fields.', { fields });
  const rows = await q<Parameters<typeof revisionJson>[0]>(
    'select rev, note_id, base_revision, ciphertext_sha256, byte_length, device_id, device_name, restored_from, created_at from revisions where vault_id = $1 and rev > $2 order by rev limit $3',
    [vault.id, after, limit],
  );
  const cursor = await q<{ cursor: number }>(
    'select cursor from device_cursors where vault_id = $1 and device_id = $2', [vault.id, ctx.deviceId],
  );
  const last = rows.rows[rows.rows.length - 1]?.rev;
  if (last !== undefined) {
    await q(
      `insert into device_cursors(vault_id, device_id, cursor) values ($1, $2, $3)
       on conflict (vault_id, device_id) do update set cursor = greatest(device_cursors.cursor, excluded.cursor)`,
      [vault.id, ctx.deviceId, last],
    );
  }
  return {
    status: 200,
    body: {
      revisions: rows.rows.map(revisionJson),
      next_after: rows.rows.length === limit ? last : null,
      cursor: Math.max(cursor.rows[0]?.cursor ?? 0, last ?? 0),
    },
  };
});

route('GET', '/api/vaults/<vault_id>/revisions/<rev>/blob', async (ctx, params) => {
  const [vaultId, revStr] = params;
  const { vault } = await requireVault(ctx, vaultId);
  const rev = Number(revStr);
  if (!Number.isInteger(rev) || rev < 1) throw new ApiError('not_found', 'Revision not found.');
  const row = await q('select 1 from revisions where vault_id = $1 and rev = $2', [vault.id, rev]);
  if (!row.rows.length) throw new ApiError('not_found', 'Revision not found.');
  const noteRow = await q<{ note_id: string }>('select note_id from revisions where vault_id = $1 and rev = $2', [vault.id, rev]);
  let blob: Buffer | null;
  try {
    blob = await getObject(`vault-blobs/${vault.id}/${noteRow.rows[0].note_id}/${rev}.bin`);
  } catch {
    throw new ApiError('storage_unavailable', 'Sync paused: storage unavailable.');
  }
  if (!blob) throw new ApiError('not_found', 'Revision not found.');
  return {
    status: 200,
    body: blob,
    headers: { 'Content-Type': 'application/octet-stream' },
  };
});

route('GET', '/api/vaults/<vault_id>/notes/<note_id>/history', async (ctx, params) => {
  const [vaultId, noteId] = params;
  const { vault } = await requireVault(ctx, vaultId);
  if (!isUuid(noteId)) throw new ApiError('not_found', 'Note not found.');
  const rows = await q<Parameters<typeof revisionJson>[0]>(
    `select rev, note_id, base_revision, ciphertext_sha256, byte_length, device_id, device_name, restored_from, created_at
     from revisions where vault_id = $1 and note_id = $2 order by rev desc`,
    [vault.id, noteId],
  );
  return { status: 200, body: { note_id: noteId, revisions: rows.rows.map(revisionJson) } };
});

route('GET', '/api/vaults/<vault_id>/cursor', async (ctx, params) => {
  const [vaultId] = params;
  const { vault } = await requireVault(ctx, vaultId);
  const cursor = await q<{ cursor: number }>(
    'select cursor from device_cursors where vault_id = $1 and device_id = $2', [vault.id, ctx.deviceId],
  );
  return { status: 200, body: { device_id: ctx.deviceId, cursor: cursor.rows[0]?.cursor ?? 0 } };
});
