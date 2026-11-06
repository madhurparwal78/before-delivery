import { createHash } from 'node:crypto';
import { envelopeProblem } from '../../shared/envelope';
import { validateBaseRevision, validateIdempotencyKey, type FieldErrors } from '../../shared/validation';
import { requireCaller, type Caller } from '../auth';
import { ApiError, notFound, storageUnavailable, validationFailed } from '../errors';
import { jsonReply, REVISION_BODY_LIMIT, type Reply, type RequestContext, type Router } from '../http';
import { bodyFingerprint, rememberResponse, replayedResponse } from '../idempotency';
import { revisionJson, type RevisionRow } from '../serialize';
import type { Services } from '../services';
import { StorageUnavailableError, vaultBlobKey } from '../storage';
import { requireApprovedDevice, requireUuid, requireVaultMember, requireWritableVault, type VaultAccess } from '../vaultAccess';

const REVISION_COLUMNS = `r.rev, r.note_id, r.base_revision, r.ciphertext_sha256, r.byte_length,
  r.device_id, d.name as device_name, r.created_at, r.restored_from`;

interface RecordedRevision {
  revision: RevisionRow;
  cursor: number;
}

/** Runs a push or restore under its Idempotency-Key, storing the answer for replays. */
async function withIdempotencyKey(
  services: Services,
  caller: Caller,
  endpoint: string,
  ctx: RequestContext,
  run: (key: string) => Promise<Reply>,
): Promise<Reply> {
  const header = ctx.headers['idempotency-key'];
  const key = typeof header === 'string' ? header : '';
  const fingerprint = bodyFingerprint(ctx.rawBody);
  const keyProblem = validateIdempotencyKey(key);

  if (!keyProblem) {
    const replayed = await replayedResponse(services.db, caller.device.id, endpoint, key, fingerprint);
    if (replayed) {
      return { status: replayed.status, json: replayed.body, headers: { 'Cairn-Replayed': 'true' } };
    }
  }

  try {
    const reply = await run(key);
    if (!keyProblem) {
      await rememberResponse(services.db, caller.device.id, endpoint, key, fingerprint, reply.status, reply.json);
    }
    return reply;
  } catch (error) {
    if (!keyProblem && error instanceof ApiError && error.status >= 400 && error.status < 500) {
      await rememberResponse(
        services.db,
        caller.device.id,
        endpoint,
        key,
        fingerprint,
        error.status,
        error.body(),
      );
    }
    throw error;
  }
}

async function headRevision(services: Services, vaultId: string, noteId: string): Promise<number | null> {
  const row = await services.db.one<{ head: number | null }>(
    'select max(rev) as head from revisions where vault_id = $1 and note_id = $2',
    [vaultId, noteId],
  );
  return row?.head ?? null;
}

function conflict(head: number | null): ApiError {
  return new ApiError(409, 'revision_conflict', 'Another device saved this note first.', { head_revision: head });
}

/**
 * Records one revision while holding the vault's row lock, so simultaneous pushes from
 * the same base produce exactly one winner.
 */
async function recordRevision(
  services: Services,
  vault: VaultAccess,
  caller: Caller,
  noteId: string,
  input: {
    baseRevision: number | null;
    bytes: Buffer;
    sha256: string;
    restoredFrom: number | null;
  },
): Promise<RecordedRevision> {
  return services.db.transaction(async (client) => {
    await client.query('select id from vaults where id = $1 for update', [vault.id]);
    const headRow = await client.query<{ head: number | null }>(
      'select max(rev) as head from revisions where vault_id = $1 and note_id = $2',
      [vault.id, noteId],
    );
    const head = headRow.rows[0]?.head ?? null;
    if (head !== input.baseRevision) throw conflict(head);

    const nextRow = await client.query<{ next: number }>(
      'select coalesce(max(rev), 0) + 1 as next from revisions where vault_id = $1',
      [vault.id],
    );
    const rev = nextRow.rows[0]?.next ?? 1;

    await services.store.put(vaultBlobKey(vault.id, noteId, rev), input.bytes, 'application/octet-stream');

    const inserted = await client.query<RevisionRow>(
      `insert into revisions (vault_id, rev, note_id, base_revision, ciphertext_sha256, byte_length, device_id, restored_from)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         returning rev, note_id, base_revision, ciphertext_sha256, byte_length, device_id, created_at, restored_from`,
      [
        vault.id,
        rev,
        noteId,
        input.baseRevision,
        input.sha256,
        input.bytes.length,
        caller.device.id,
        input.restoredFrom,
      ],
    );
    const cursorRow = await client.query<{ cursor: number }>(
      `insert into device_cursors (vault_id, device_id, cursor) values ($1, $2, $3)
         on conflict (vault_id, device_id) do update set cursor = greatest(device_cursors.cursor, excluded.cursor)
         returning cursor`,
      [vault.id, caller.device.id, rev],
    );
    const revision = inserted.rows[0];
    if (!revision) throw new ApiError(500, 'internal_error', 'Could not record the revision.');
    return {
      revision: { ...revision, device_name: caller.device.name },
      cursor: cursorRow.rows[0]?.cursor ?? rev,
    };
  });
}

export function registerRevisionRoutes(router: Router, services: Services): void {
  const { db } = services;

  router.add(
    'POST',
    '/api/vaults/:vault_id/notes/:note_id/revisions',
    async (ctx) => {
      const caller = await requireCaller(db, ctx);
      const vault = await requireVaultMember(db, caller.account.id, ctx.params.vault_id);
      const noteId = requireUuid(ctx.params.note_id);

      return withIdempotencyKey(services, caller, 'push', ctx, async (key) => {
        requireApprovedDevice(caller);
        await requireWritableVault(db, services.entitlement, vault);

        const body = (ctx.body ?? {}) as {
          base_revision?: unknown;
          ciphertext?: unknown;
          ciphertext_sha256?: unknown;
        };
        const baseProblem = validateBaseRevision(body.base_revision === undefined ? null : body.base_revision);
        if (baseProblem) throw validationFailed({ base_revision: baseProblem });
        const baseRevision = (body.base_revision ?? null) as number | null;

        const head = await headRevision(services, vault.id, noteId);
        if (head !== baseRevision) throw conflict(head);

        const fields: FieldErrors = {};
        const keyProblem = validateIdempotencyKey(key);
        if (keyProblem) fields['Idempotency-Key'] = keyProblem;

        let bytes = Buffer.alloc(0);
        if (typeof body.ciphertext !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.ciphertext)) {
          fields.ciphertext = 'must be base64 of an encrypted envelope';
        } else {
          bytes = Buffer.from(body.ciphertext, 'base64');
          const problem = envelopeProblem(bytes);
          if (problem) fields.ciphertext = `must be an encrypted envelope: it ${problem}`;
        }
        if (typeof body.ciphertext_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(body.ciphertext_sha256)) {
          fields.ciphertext_sha256 = 'must be the lowercase hex SHA-256 of the ciphertext bytes';
        } else if (!fields.ciphertext) {
          const digest = createHash('sha256').update(bytes).digest('hex');
          if (digest !== body.ciphertext_sha256) {
            fields.ciphertext_sha256 = 'does not match the SHA-256 of the ciphertext bytes';
          }
        }
        if (Object.keys(fields).length > 0) throw validationFailed(fields);

        try {
          const recorded = await recordRevision(services, vault, caller, noteId, {
            baseRevision,
            bytes,
            sha256: String(body.ciphertext_sha256),
            restoredFrom: null,
          });
          return jsonReply(201, { revision: revisionJson(recorded.revision), cursor: recorded.cursor });
        } catch (error) {
          if (error instanceof StorageUnavailableError) throw storageUnavailable();
          throw error;
        }
      });
    },
    REVISION_BODY_LIMIT,
  );

  router.add('POST', '/api/vaults/:vault_id/notes/:note_id/restore', async (ctx) => {
    const caller = await requireCaller(db, ctx);
    const vault = await requireVaultMember(db, caller.account.id, ctx.params.vault_id);
    const noteId = requireUuid(ctx.params.note_id);
    const body = (ctx.body ?? {}) as { revision?: unknown; base_revision?: unknown };

    const chosen = await db.one<{ rev: number; ciphertext_sha256: string; byte_length: number }>(
      'select rev, ciphertext_sha256, byte_length from revisions where vault_id = $1 and note_id = $2 and rev = $3',
      [vault.id, noteId, Number.isInteger(body.revision) ? body.revision : -1],
    );
    if (!chosen) throw notFound();

    return withIdempotencyKey(services, caller, 'restore', ctx, async (key) => {
      requireApprovedDevice(caller);
      await requireWritableVault(db, services.entitlement, vault);

      const baseProblem = validateBaseRevision(body.base_revision === undefined ? null : body.base_revision);
      if (baseProblem) throw validationFailed({ base_revision: baseProblem });
      const baseRevision = (body.base_revision ?? null) as number | null;

      const head = await headRevision(services, vault.id, noteId);
      if (head !== baseRevision) throw conflict(head);

      const keyProblem = validateIdempotencyKey(key);
      if (keyProblem) throw validationFailed({ 'Idempotency-Key': keyProblem });

      try {
        const stored = await services.store.get(vaultBlobKey(vault.id, noteId, chosen.rev));
        if (!stored) throw notFound();
        const recorded = await recordRevision(services, vault, caller, noteId, {
          baseRevision,
          bytes: stored.body,
          sha256: chosen.ciphertext_sha256,
          restoredFrom: chosen.rev,
        });
        return jsonReply(201, { revision: revisionJson(recorded.revision), cursor: recorded.cursor });
      } catch (error) {
        if (error instanceof StorageUnavailableError) throw storageUnavailable();
        throw error;
      }
    });
  });

  router.add('GET', '/api/vaults/:vault_id/revisions', async (ctx) => {
    const caller = await requireCaller(db, ctx);
    const vault = await requireVaultMember(db, caller.account.id, ctx.params.vault_id);
    requireApprovedDevice(caller);

    const fields: FieldErrors = {};
    const afterRaw = ctx.query.get('after') ?? '0';
    const limitRaw = ctx.query.get('limit') ?? '100';
    const after = Number(afterRaw);
    const limit = Number(limitRaw);
    if (!/^\d+$/.test(afterRaw)) fields.after = 'must be a whole number of 0 or more';
    if (!/^\d+$/.test(limitRaw) || limit < 1 || limit > 500) fields.limit = 'must be a whole number from 1 to 500';
    if (Object.keys(fields).length > 0) throw validationFailed(fields);

    const revisions = await db.query<RevisionRow>(
      `select ${REVISION_COLUMNS}
         from revisions r join devices d on d.id = r.device_id
        where r.vault_id = $1 and r.rev > $2
        order by r.rev
        limit $3`,
      [vault.id, after, limit],
    );
    const nextAfter = revisions.length > 0 ? (revisions[revisions.length - 1]?.rev ?? after) : after;
    const cursorRow = await db.one<{ cursor: number }>(
      `insert into device_cursors (vault_id, device_id, cursor) values ($1, $2, $3)
         on conflict (vault_id, device_id) do update set cursor = greatest(device_cursors.cursor, excluded.cursor)
         returning cursor`,
      [vault.id, caller.device.id, nextAfter],
    );

    return jsonReply(200, {
      revisions: revisions.map(revisionJson),
      next_after: nextAfter,
      cursor: cursorRow?.cursor ?? nextAfter,
    });
  });

  router.add('GET', '/api/vaults/:vault_id/revisions/:rev/blob', async (ctx) => {
    const caller = await requireCaller(db, ctx);
    const vault = await requireVaultMember(db, caller.account.id, ctx.params.vault_id);
    requireApprovedDevice(caller);

    const rev = Number(ctx.params.rev);
    if (!Number.isInteger(rev) || rev <= 0) throw notFound();
    const row = await db.one<{ note_id: string; byte_length: number }>(
      'select note_id, byte_length from revisions where vault_id = $1 and rev = $2',
      [vault.id, rev],
    );
    if (!row) throw notFound();

    try {
      const stored = await services.store.get(vaultBlobKey(vault.id, row.note_id, rev));
      if (!stored) throw notFound();
      return { status: 200, body: stored.body, contentType: 'application/octet-stream' };
    } catch (error) {
      if (error instanceof StorageUnavailableError) throw storageUnavailable();
      throw error;
    }
  });

  router.add('GET', '/api/vaults/:vault_id/notes/:note_id/history', async (ctx) => {
    const caller = await requireCaller(db, ctx);
    const vault = await requireVaultMember(db, caller.account.id, ctx.params.vault_id);
    const noteId = requireUuid(ctx.params.note_id);
    requireApprovedDevice(caller);

    const revisions = await db.query<RevisionRow>(
      `select ${REVISION_COLUMNS}
         from revisions r join devices d on d.id = r.device_id
        where r.vault_id = $1 and r.note_id = $2
        order by r.rev desc`,
      [vault.id, noteId],
    );
    return jsonReply(200, { note_id: noteId, revisions: revisions.map(revisionJson) });
  });

  router.add('GET', '/api/vaults/:vault_id/cursor', async (ctx) => {
    const caller = await requireCaller(db, ctx);
    const vault = await requireVaultMember(db, caller.account.id, ctx.params.vault_id);
    requireApprovedDevice(caller);
    const row = await db.one<{ cursor: number }>(
      'select cursor from device_cursors where vault_id = $1 and device_id = $2',
      [vault.id, caller.device.id],
    );
    return jsonReply(200, { device_id: caller.device.id, cursor: row?.cursor ?? 0 });
  });
}
