import { q, tx } from '../db';
import { ApiError, type Ctx } from '../api_types';
import { hashPassword, verifyPassword, newToken, tokenHash, requestFingerprint, sha256Hex } from '../crypt';
import {
  deviceApprovalEmail, inviteEmail,
} from '../mail';
import { config } from '../config';
import { isUuid, computeManifest, validateCandidates, MAX_CIPHER_BYTES } from '../../shared/domain';
import {
  readAddon, buildBilling, setSubscription, syncWritableUntil, publishTakedownAt, publishWarningAt,
  type AddonInfo,
} from '../billing';
import { putObject, getObject, deletePrefix } from '../s3';
import { renderDossierPages } from '../../shared/render';

const ts = (d: Date | null): string | null => (d ? d.toISOString().replace(/\.\d{3}Z$/, 'Z') : null);

interface AccountRow {
  id: string; email: string; display_name: string; time_zone: string; operator: boolean;
}

const accountOf = async (ctx: Ctx): Promise<AccountRow | null> => {
  const token = ctx.cookies['cairn_session'];
  if (!token) return null;
  const r = await q<AccountRow & { device_id: string }>(
    `select a.id, a.email, a.display_name, a.time_zone, a.operator, s.device_id
     from sessions s join accounts a on a.id = s.account_id where s.token = $1`,
    [tokenHash(token)],
  );
  return r.rows[0] ?? null;
};

const vaultRole = async (accountId: string, vaultId: string): Promise<'owner' | 'partner' | null> => {
  const r = await q<{ role: string }>('select role from vault_members where vault_id = $1 and account_id = $2', [vaultId, accountId]);
  const role = r.rows[0]?.role;
  return role === 'owner' || role === 'partner' ? role : null;
};

const requireAccount = (ctx: Ctx): AccountRow & { device_id: string } => {
  if (!ctx.accountId || !ctx.deviceId) throw new ApiError('unauthenticated', 'Sign in to continue.');
  return {
    id: ctx.accountId, email: ctx.accountEmail as string, display_name: '',
    time_zone: ctx.accountTimeZone as string, operator: ctx.accountOperator, device_id: ctx.deviceId,
  };
};

interface VaultRow { id: string; name: string; owner_id: string; created_at: Date }

const vaultFor = async (accountId: string, vaultId: string): Promise<VaultRow> => {
  if (!isUuid(vaultId)) throw new ApiError('not_found', 'Vault not found.');
  const role = await vaultRole(accountId, vaultId);
  if (!role) throw new ApiError('not_found', 'Vault not found.');
  const r = await q<VaultRow>('select id, name, owner_id, created_at from vaults where id = $1', [vaultId]);
  if (!r.rows[0]) throw new ApiError('not_found', 'Vault not found.');
  return r.rows[0];
};

interface DeviceRow { id: string; name: string; approved: boolean; created_at: Date }

const deviceJson = (d: DeviceRow) => ({ id: d.id, name: d.name, approved: d.approved, created_at: ts(d.created_at) });

const vaultJson = (id: string, name: string, role: 'owner' | 'partner', created_at: Date) => ({
  id, name, role, created_at: ts(created_at),
});

interface RevisionRow {
  rev: number; note_id: string; base_revision: number | null; ciphertext_sha256: string;
  byte_length: number; device_id: string; device_name: string; restored_from: number | null; created_at: Date;
}

const revisionJson = (r: RevisionRow) => ({
  rev: r.rev, note_id: r.note_id, base_revision: r.base_revision, ciphertext_sha256: r.ciphertext_sha256,
  byte_length: r.byte_length, device_id: r.device_id, device_name: r.device_name,
  created_at: ts(r.created_at), restored_from: r.restored_from,
});

interface DossierRow {
  id: string; account_id: string; slug: string; root_note_id: string; state: string;
  radius: number | null; publish_id: string | null; created_at: Date; published_at: Date | null;
}

const previewLinkJson = (row: { id: string; state: string; created_at: Date; expires_at: Date }) => ({
  id: row.id, state: row.state, created_at: ts(row.created_at), expires_at: ts(row.expires_at),
});

const dossierJson = async (d: DossierRow): Promise<Record<string, unknown>> => {
  let preview_link: Record<string, unknown> | null = null;
  const pl = await q<{ id: string; state: string; created_at: Date; expires_at: Date }>(
    'select id, state, created_at, expires_at from preview_links where dossier_id = $1 and state = $2 order by created_at desc limit 1',
    [d.id, 'active'],
  );
  if (pl.rows[0]) preview_link = previewLinkJson(pl.rows[0]);
  return {
    id: d.id, slug: d.slug, root_note_id: d.root_note_id, state: d.state,
    radius: d.radius, public_count: null, severed_count: null,
    published_at: ts(d.published_at), url: `/d/${d.slug}/`, preview_link,
  };
};

const addonInfoFrom = (snap: { state: string; period_end: Date | null; checked_at: Date | null; source: string }): AddonInfo => ({
  state: snap.state as AddonInfo['state'],
  period_end: ts(snap.period_end),
  checked_at: ts(snap.checked_at),
  source: snap.source as 'killbill' | 'cache',
});

/** Vault owner's sync state governs pushes to a shared vault. */
const vaultSyncState = async (ownerId: string): Promise<'active' | 'ending' | 'grace' | 'lapsed' | 'none'> => {
  const s = await readAddon(ownerId, 'sync');
  return s.state === 'none' ? 'none' : s.state;
};

const withDeviceApproved = async (deviceId: string): Promise<void> => {
  const r = await q<{ approved: boolean }>('select approved from devices where id = $1', [deviceId]);
  if (!r.rows[0]?.approved) throw new ApiError('device_not_approved', 'This device is waiting for approval.');
};

const idemKey = (ctx: Ctx): string => {
  const raw = ctx.headers['idempotency-key'];
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v || v.length < 8 || v.length > 128 || !/^[A-Za-z0-9_-]+$/.test(v))
    throw new ApiError('validation_failed', 'Bad Idempotency-Key.', { fields: { 'Idempotency-Key': 'must be 8 to 128 letters, digits, - and _' } });
  return v;
};

interface IdemRow { status: number; body: unknown; extra: unknown; request_hash: string }

const idemLookup = async (deviceId: string, endpoint: string, key: string): Promise<IdemRow | null> => {
  await q('delete from idempotency where created_at < now() - ($1 || \' seconds\')::interval', [String(config.timers.idempotencyTtl)]);
  const r = await q<IdemRow>('select status, body, extra, request_hash from idempotency where device_id = $1 and endpoint = $2 and key = $3',
    [deviceId, endpoint, key]);
  return r.rows[0] ?? null;
};

const idemStore = async (deviceId: string, endpoint: string, key: string, hash: string, status: number, body: unknown, extra?: unknown): Promise<void> => {
  await q(
    `insert into idempotency(device_id, endpoint, key, request_hash, status, body, extra)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (device_id, endpoint, key) do nothing`,
    [deviceId, endpoint, key, hash, status, JSON.stringify(body), extra ? JSON.stringify(extra) : null],
  );
};

const base64Decode = (b64: string): Buffer => {
  try {
    const buf = Buffer.from(b64, 'base64');
    if (buf.toString('base64').replace(/=+$/, '') !== b64.replace(/=+$/, '')) throw new Error('bad');
    return buf;
  } catch {
    throw new ApiError('validation_failed', 'Bad ciphertext.', { fields: { ciphertext: 'must be base64' } });
  }
};

const envelopeError = (): ApiError =>
  new ApiError('validation_failed', 'Bad ciphertext.', {
    fields: { ciphertext: 'must be an encrypted envelope (CRN1 header, IV and tag)' },
  });

const checkEnvelope = (buf: Buffer): void => {
  if (buf.length < 32 || buf.length > MAX_CIPHER_BYTES || buf.subarray(0, 4).toString('ascii') !== 'CRN1') throw envelopeError();
};

const whenInZone = (d: Date, timeZone: string): string => {
  try {
    return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(d);
  } catch {
    return d.toISOString();
  }
};

export interface Route {
  method: string;
  pattern: RegExp;
  handler: (ctx: Ctx, params: string[]) => Promise<{ status: number; body?: unknown; headers?: Record<string, string> } | undefined>;
  auth?: boolean;
  limit?: number;
}

const pushRevisionInner = async (
  ctx: Ctx, vault: VaultRow, noteId: string, baseRevision: number | null,
  blob: Buffer, restoredFrom: number | null,
): Promise<{ status: number; body: Record<string, unknown> }> => {
  const deviceName = (await q<{ name: string }>('select name from devices where id = $1', [ctx.deviceId])).rows[0]?.name ?? 'device';
  try {
    const result = await tx(async (client) => {
      // one writer per vault at a time: simultaneous same-base pushes queue here,
      // and every one after the first sees the new head and answers conflict
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [vault.id]);
      const head = await client.query<{ rev: number }>(
        'select max(rev) as rev from revisions where vault_id = $1 and note_id = $2',
        [vault.id, noteId],
      );
      const headRev = head.rows[0]?.rev ?? null;
      const ok = headRev === null ? baseRevision === null : headRev === baseRevision;
      if (!ok) throw new ApiError('revision_conflict', 'This note changed on another device.', {
        extra: { head_revision: headRev },
      });
      const vaultMax = await client.query<{ rev: number }>('select max(rev) as rev from revisions where vault_id = $1', [vault.id]);
      const next = (vaultMax.rows[0]?.rev ?? 0) + 1;
      const hash = sha256Hex(blob);
      await client.query(
        `insert into revisions(vault_id, rev, note_id, base_revision, ciphertext_sha256, byte_length, device_id, device_name, restored_from)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [vault.id, next, noteId, baseRevision, hash, blob.length, ctx.deviceId, deviceName, restoredFrom],
      );
      await client.query(
        `insert into device_cursors(vault_id, device_id, cursor) values ($1, $2, $3)
         on conflict (vault_id, device_id) do update set cursor = greatest(device_cursors.cursor, excluded.cursor)`,
        [vault.id, ctx.deviceId, next],
      );
      return { next, hash, deviceName, created: new Date() };
    });
    try {
      await putObject(`vault-blobs/${vault.id}/${noteId}/${result.next}.bin`, blob, 'application/octet-stream');
    } catch {
      // roll the revision back so the retry can succeed cleanly
      await q('delete from revisions where vault_id = $1 and rev = $2', [vault.id, result.next]);
      throw new ApiError('storage_unavailable', 'Sync paused: storage unavailable.');
    }
    return {
      status: 201,
      body: {
        revision: {
          rev: result.next, note_id: noteId, base_revision: baseRevision, ciphertext_sha256: result.hash,
          byte_length: blob.length, device_id: ctx.deviceId, device_name: result.deviceName,
          created_at: ts(result.created), restored_from: restoredFrom,
        },
        cursor: result.next,
      },
    };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw e;
  }
};

const restoreInner = async (ctx: Ctx, vault: VaultRow, noteId: string, revision: number, baseRevision: number) => {
  const rows = await q<{ byte_length: number }>(
    'select byte_length from revisions where vault_id = $1 and note_id = $2 and rev = $3',
    [vault.id, noteId, revision],
  );
  if (!rows.rows[0]) throw new ApiError('not_found', 'Revision not found.');
  let blob: Buffer;
  try {
    const got = await getObject(`vault-blobs/${vault.id}/${noteId}/${revision}.bin`);
    if (!got) throw new ApiError('storage_unavailable', 'Restore paused: storage unavailable.');
    blob = got;
  } catch {
    throw new ApiError('storage_unavailable', 'Restore paused: storage unavailable.');
  }
  return pushRevisionInner(ctx, vault, noteId, baseRevision, blob, revision);
};

/** All-or-nothing publish: render every object under a new publish id, write all, then flip the live pointer. */
export const publishDossier = async (
  dossier: DossierRow,
  radius: number,
  notes: ReturnType<typeof validateCandidates>['notes'],
  root: NonNullable<ReturnType<typeof validateCandidates>['root']>,
): Promise<void> => {
  const manifest = computeManifest({ radius, notes });
  const rendered = renderDossierPages(manifest, notes, root.id);
  const { buildPublishObjects } = await import('../publish/objects');
  const key = newToken(16);
  const objects = buildPublishObjects(dossier.slug, `publish/${dossier.slug}/${key}/`, rendered, root.id, 'd');
  try {
    for (const o of objects) await putObject(o.key, o.body, o.contentType);
  } catch {
    // nothing switched: the previously live dossier keeps serving unchanged
    throw new ApiError('storage_unavailable', 'Publish paused: storage unavailable.');
  }
  await q('insert into publishes(id, dossier_id, publish_key) values (gen_random_uuid(), $1, $2)', [dossier.id, key]);
  const old = dossier.publish_id;
  await q(
    'update dossiers set state = $2, radius = $3, publish_id = $4, published_at = $5 where id = $1',
    [dossier.id, 'published', radius, key, new Date()],
  );
  if (old && old !== key) await deletePrefix(`publish/${dossier.slug}/${old}/`).catch(() => undefined);
};

export {
  accountOf, vaultRole, requireAccount, vaultFor, deviceJson, vaultJson, revisionJson,
  dossierJson, previewLinkJson, addonInfoFrom, vaultSyncState, withDeviceApproved,
  idemKey, idemLookup, idemStore, base64Decode, checkEnvelope, whenInZone,
  pushRevisionInner, restoreInner,
  hashPassword, verifyPassword, newToken, tokenHash, requestFingerprint,
  deviceApprovalEmail, inviteEmail, config, buildBilling, setSubscription,
  syncWritableUntil, publishTakedownAt, publishWarningAt,
};
export type { AccountRow, DossierRow, RevisionRow, VaultRow, DeviceRow };
