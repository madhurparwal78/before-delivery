import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { db, isUniqueViolation, Queryable, withTransaction } from '../db.js';
import { conflict, notFound, storageUnavailable, unprocessable } from '../http.js';
import { emitEvent, flushEvents } from '../live.js';
import { flushOutbox, queueMail } from '../mail.js';
import { blobObjectKey, putObject, StorageUnavailable } from '../storage.js';
import { feeForGas, gasForShares, parseFern } from '../../shared/fees.js';
import { formatFern, withThousands, zonedDateKey } from '../../shared/format.js';
import { validateNamespace } from '../../shared/namespace.js';
import { maxBlobBytes, shareCount } from '../../shared/shares.js';
import { balancesFor, lockPerson } from '../domain/accounts.js';
import { latestHeight } from '../domain/blocks.js';
import { now } from '../domain/engine.js';
import { confidenceAfter, lightNodesOf, samplesOf } from '../domain/sampling.js';
import { TransactionRow } from '../domain/types.js';
import { membersOf } from '../domain/workspaces.js';
import {
  readString,
  replayIdempotent,
  RequestContext,
  requireWorkspace,
  requireWrite,
  storeIdempotent,
  StoredResponse,
} from './context.js';
import { blobView, transactionView, transactionWriteView, ufern } from './serialize.js';

const STORAGE_SUBMIT_COPY =
  "Storage is unavailable, so blobs can't be submitted right now. The explorer still works.";

export async function getWorkspace(ctx: RequestContext, id: string): Promise<StoredResponse> {
  const { workspace, role } = await requireWorkspace(ctx, id);
  return {
    status: 200,
    body: {
      id: workspace.id,
      name: workspace.name,
      role,
      height: await latestHeight(db, workspace.id),
      clock: now().toISOString(),
      nextBlock: workspace.next_block,
    },
  };
}

/** Backs the Network stats trio and the light node spotlight readouts. */
export async function getStats(ctx: RequestContext, id: string): Promise<StoredResponse> {
  const { workspace } = await requireWorkspace(ctx, id);
  const height = await latestHeight(db, workspace.id);
  const { rows: latest } = await db.query<{ square_width: number }>(
    'SELECT square_width FROM blocks WHERE workspace_id = $1 ORDER BY height DESC LIMIT 1',
    [workspace.id],
  );
  const today = zonedDateKey(now().toISOString(), config.timeZone);
  const { rows: included } = await db.query<{ height: number; produced_at: Date; count: string }>(
    `SELECT b.height, b.produced_at, count(*)::text AS count
     FROM blocks b JOIN transactions t
       ON t.workspace_id = b.workspace_id AND t.height = b.height
     WHERE b.workspace_id = $1 AND t.kind = 'blob' AND t.status = 'included'
     GROUP BY b.height, b.produced_at`,
    [workspace.id],
  );
  const includedToday = included
    .filter((row) => zonedDateKey(row.produced_at.toISOString(), config.timeZone) === today)
    .reduce((sum, row) => sum + Number(row.count), 0);

  const nodes = [];
  for (const node of await lightNodesOf(db, workspace.id)) {
    const { rows } = await db.query<{ height: number; square_width: number }>(
      `SELECT s.height, b.square_width FROM samples s
         JOIN blocks b ON b.workspace_id = s.workspace_id AND b.height = s.height
       WHERE s.light_node_id = $1 ORDER BY s.height DESC, s.index DESC LIMIT 1`,
      [node.id],
    );
    const latestSampled = rows[0];
    const samples = latestSampled ? await samplesOf(db, node.id, latestSampled.height) : [];
    nodes.push({
      id: node.id,
      height: latestSampled ? latestSampled.height : null,
      confidence: latestSampled
        ? confidenceAfter(latestSampled.square_width, samples, samples.length)
        : '0.0000',
    });
  }
  return {
    status: 200,
    body: {
      height,
      squareWidth: latest[0]?.square_width ?? 0,
      includedToday,
      nodes,
    },
  };
}

export async function setProducer(ctx: RequestContext, id: string): Promise<StoredResponse> {
  const { workspace, role } = await requireWorkspace(ctx, id);
  requireWrite(role, 'producer');
  const nextBlock = readString(ctx, 'nextBlock');
  if (nextBlock !== 'honest' && nextBlock !== 'withhold' && nextBlock !== 'bad-encoding') {
    throw unprocessable('nextBlock', 'Choose Honest, Withhold shares or Bad encoding.');
  }
  await db.query('UPDATE workspaces SET next_block = $2 WHERE id = $1', [workspace.id, nextBlock]);
  emitEvent(workspace.id, { kind: 'producer', nextBlock });
  flushEvents();
  return { status: 200, body: { nextBlock } };
}

export async function getMembers(ctx: RequestContext, id: string): Promise<StoredResponse> {
  const { workspace } = await requireWorkspace(ctx, id);
  const members = await membersOf(db, workspace.id);
  return {
    status: 200,
    body: members.map((member) => ({
      id: member.id,
      name: member.name,
      email: member.email,
      role: member.role,
    })),
  };
}

export async function createInvite(ctx: RequestContext, id: string): Promise<StoredResponse> {
  const { workspace, role } = await requireWorkspace(ctx, id);
  requireWrite(role, 'members');
  const email = readString(ctx, 'email').trim();
  const inviteRole = readString(ctx, 'role');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw unprocessable('email', 'Enter a valid email address.');
  }
  if (inviteRole !== 'developer' && inviteRole !== 'viewer') {
    throw unprocessable('role', 'Choose Developer or Viewer.');
  }
  const members = await membersOf(db, workspace.id);
  if (members.some((member) => member.email.toLowerCase() === email.toLowerCase())) {
    throw conflict(`${email} is already a member of this workspace.`);
  }
  const at = now();
  const expiresAt = new Date(at.getTime() + config.inviteTtlHours * 3600 * 1000);
  const inviteId = randomUUID();
  const token = randomUUID();
  await withTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO invites (id, workspace_id, email, role, token, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [inviteId, workspace.id, email, inviteRole, token, at, expiresAt],
    );
    await queueMail(
      tx,
      workspace.id,
      {
        recipient: email,
        subject: `Join ${workspace.name} on Fernsquare`,
        body: `You have been invited to ${workspace.name} on Fernsquare as a ${
          inviteRole === 'developer' ? 'Developer' : 'Viewer'
        }.\n\nOpen this link to accept the invite:\n${config.appPublicUrl}/invites/${token}\n\nThe link works once and expires in ${config.inviteTtlHours} hours.`,
      },
      at,
    );
  });
  void flushOutbox();
  return {
    status: 201,
    body: { id: inviteId, email, role: inviteRole, expiresAt: expiresAt.toISOString() },
  };
}

async function namespaceBlobCounts(
  tx: Queryable,
  workspaceId: string,
): Promise<Map<string, number>> {
  const { rows } = await tx.query<{ namespace_hex: string; count: string }>(
    `SELECT b.namespace_hex, count(*)::text AS count
     FROM blobs b JOIN transactions t ON t.id = b.tx_id
     WHERE b.workspace_id = $1 AND t.status = 'included'
     GROUP BY b.namespace_hex`,
    [workspaceId],
  );
  return new Map(rows.map((row) => [row.namespace_hex, Number(row.count)]));
}

export async function listNamespaces(ctx: RequestContext, id: string): Promise<StoredResponse> {
  const { workspace } = await requireWorkspace(ctx, id);
  const counts = await namespaceBlobCounts(db, workspace.id);
  const { rows } = await db.query<{ id: string; name: string; hex: string }>(
    'SELECT id, name, hex FROM namespaces WHERE workspace_id = $1 ORDER BY hex',
    [workspace.id],
  );
  return {
    status: 200,
    body: rows.map((row) => ({
      id: row.id,
      name: row.name,
      hex: row.hex,
      blobCount: counts.get(row.hex) ?? 0,
    })),
  };
}

export async function registerNamespace(
  ctx: RequestContext,
  id: string,
): Promise<StoredResponse> {
  const { workspace, role } = await requireWorkspace(ctx, id);
  requireWrite(role, 'transaction');
  const name = readString(ctx, 'name');
  const hex = readString(ctx, 'hex').trim().toLowerCase();
  const refusal = validateNamespace(hex, name);
  if (refusal) throw unprocessable(refusal.field, refusal.message);
  const namespaceId = randomUUID();
  try {
    await db.query(
      'INSERT INTO namespaces (id, workspace_id, name, hex, created_at) VALUES ($1, $2, $3, $4, $5)',
      [namespaceId, workspace.id, name.trim(), hex, now()],
    );
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    throw conflict(`Namespace ${hex} is already registered.`);
  }
  emitEvent(workspace.id, { kind: 'transactions' });
  flushEvents();
  return { status: 201, body: { id: namespaceId, name: name.trim(), hex } };
}

export async function feeEstimate(ctx: RequestContext, id: string): Promise<StoredResponse> {
  await requireWorkspace(ctx, id);
  const size = Math.max(0, Math.floor(Number(ctx.query.get('bytes') ?? '0')));
  const shares = shareCount(size);
  const gas = gasForShares(shares);
  return {
    status: 200,
    body: { size, shares, gas, feeUfern: ufern(feeForGas(gas, config.minGasPrice)) },
  };
}

export async function submitBlob(ctx: RequestContext, id: string): Promise<StoredResponse> {
  const { workspace, role, person } = await requireWorkspace(ctx, id);
  const replay = await replayIdempotent(ctx, workspace.id, person.id);
  if (replay) return replay;
  requireWrite(role, 'transaction');

  const namespaceHex = readString(ctx, 'namespace').trim().toLowerCase();
  const { rows: namespaceRows } = await db.query<{ hex: string }>(
    'SELECT hex FROM namespaces WHERE workspace_id = $1 AND hex = $2',
    [workspace.id, namespaceHex],
  );
  if (!namespaceRows[0]) throw unprocessable('namespace', 'Choose a namespace.');

  const data = new Uint8Array(Buffer.from(readString(ctx, 'dataBase64'), 'base64'));
  if (data.length === 0) throw unprocessable('data', 'A blob must contain at least 1 byte.');
  const maxBytes = maxBlobBytes(config.maxSquareWidth);
  if (data.length > maxBytes) {
    throw unprocessable(
      'data',
      `This blob is ${withThousands(data.length)} bytes; a block holds at most ${withThousands(
        maxBytes,
      )} bytes of blob data.`,
    );
  }
  const shares = shareCount(data.length);
  const gas = gasForShares(shares);
  const minimumFee = feeForGas(gas, config.minGasPrice);
  const feeUfern = parseFern(readString(ctx, 'fee'));
  if (feeUfern === null) {
    throw unprocessable('fee', 'Fee must be an amount in FERN with at most 6 decimals.');
  }
  if (feeUfern < minimumFee) {
    throw unprocessable('fee', `Fee too low: this blob needs at least ${formatFern(minimumFee)} FERN.`);
  }

  const blobId = randomUUID();
  const txId = randomUUID();
  const at = now();
  const result = await withTransaction(async (tx) => {
    await lockPerson(tx, person.id);
    const balances = await balancesFor(tx, workspace.id, person.id);
    if (balances.availableUfern < feeUfern) {
      throw unprocessable(
        'fee',
        `Insufficient balance: available ${formatFern(
          balances.availableUfern,
        )} FERN, this blob needs ${formatFern(feeUfern)} FERN.`,
      );
    }
    await tx.query(
      `INSERT INTO transactions
         (id, workspace_id, kind, sender_id, status, fee_ufern, gas, held_ufern, payload, submitted_at)
       VALUES ($1, $2, 'blob', $3, 'pending', $4, $5, $4, $6, $7)`,
      [
        txId,
        workspace.id,
        person.id,
        feeUfern,
        gas,
        JSON.stringify({ blobId, namespace: namespaceHex, size: data.length, shares }),
        at,
      ],
    );
    await tx.query(
      `INSERT INTO blobs (id, workspace_id, tx_id, namespace_hex, size, shares, payload, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [blobId, workspace.id, txId, namespaceHex, data.length, shares, Buffer.from(data), at],
    );
    try {
      await putObject(blobObjectKey(blobId), data);
    } catch (error) {
      if (!(error instanceof StorageUnavailable)) throw error;
      throw storageUnavailable(STORAGE_SUBMIT_COPY);
    }
    const body = {
      ...transactionWriteView({ id: txId, kind: 'blob', feeUfern, gas, submittedAt: at }),
      blobId,
      size: data.length,
      shares,
    };
    const stored: StoredResponse = { status: 201, body };
    await storeIdempotent(tx, ctx, workspace.id, person.id, stored);
    return stored;
  });
  emitEvent(workspace.id, { kind: 'transactions' });
  flushEvents();
  return result;
}

export async function listBlobs(ctx: RequestContext, id: string): Promise<StoredResponse> {
  const { workspace, person } = await requireWorkspace(ctx, id);
  const mine = ctx.query.get('mine') === 'true';
  const { rows } = await db.query<{ id: string }>(
    `SELECT b.id FROM blobs b JOIN transactions t ON t.id = b.tx_id
     WHERE b.workspace_id = $1 AND ($2::boolean IS FALSE OR t.sender_id = $3)
     ORDER BY t.sequence DESC`,
    [workspace.id, mine, person.id],
  );
  const views = [];
  for (const row of rows) views.push(await blobView(db, workspace.id, row.id));
  return { status: 200, body: views };
}

export async function getBlob(
  ctx: RequestContext,
  id: string,
  blobId: string,
): Promise<StoredResponse> {
  const { workspace } = await requireWorkspace(ctx, id);
  const view = await blobView(db, workspace.id, blobId);
  if (!view) throw notFound();
  return { status: 200, body: view };
}

async function transactionRows(
  workspaceId: string,
  mine: boolean,
  personId: string,
): Promise<(TransactionRow & { sender_name: string })[]> {
  const { rows } = await db.query<TransactionRow & { sender_name: string }>(
    `SELECT t.id, t.workspace_id, t.kind, t.sender_id, t.status, t.height, t.fee_ufern::text,
            t.gas, t.held_ufern::text, t.payload, t.rejection_reason, t.submitted_at,
            p.name AS sender_name
     FROM transactions t JOIN people p ON p.id = t.sender_id
     WHERE t.workspace_id = $1 AND ($2::boolean IS FALSE OR t.sender_id = $3)
     ORDER BY t.sequence DESC`,
    [workspaceId, mine, personId],
  );
  return rows;
}

export async function listTransactions(ctx: RequestContext, id: string): Promise<StoredResponse> {
  const { workspace, person } = await requireWorkspace(ctx, id);
  const rows = await transactionRows(workspace.id, ctx.query.get('mine') === 'true', person.id);
  return { status: 200, body: rows.map((row) => transactionView(row, row.sender_name)) };
}

export async function getTransaction(
  ctx: RequestContext,
  id: string,
  txId: string,
): Promise<StoredResponse> {
  const { workspace } = await requireWorkspace(ctx, id);
  const { rows } = await db.query<TransactionRow & { sender_name: string }>(
    `SELECT t.id, t.workspace_id, t.kind, t.sender_id, t.status, t.height, t.fee_ufern::text,
            t.gas, t.held_ufern::text, t.payload, t.rejection_reason, t.submitted_at,
            p.name AS sender_name
     FROM transactions t JOIN people p ON p.id = t.sender_id
     WHERE t.workspace_id = $1 AND t.id = $2`,
    [workspace.id, txId],
  );
  const row = rows[0];
  if (!row) throw notFound();
  return { status: 200, body: transactionView(row, row.sender_name) };
}

export async function getMempool(ctx: RequestContext, id: string): Promise<StoredResponse> {
  const { workspace } = await requireWorkspace(ctx, id);
  const { rows } = await db.query<{ id: string }>(
    `SELECT b.id FROM blobs b JOIN transactions t ON t.id = b.tx_id
     WHERE b.workspace_id = $1 AND t.status = 'pending' ORDER BY t.sequence`,
    [workspace.id],
  );
  const blobs = [];
  for (const row of rows) blobs.push(await blobView(db, workspace.id, row.id));
  return { status: 200, body: { count: blobs.length, blobs } };
}

export async function getLedger(ctx: RequestContext, id: string): Promise<StoredResponse> {
  const { workspace } = await requireWorkspace(ctx, id);
  const account = ctx.query.get('account');
  const { rows } = await db.query<{
    id: string;
    pair_id: string;
    account: string;
    counter_account: string;
    kind: string;
    label: string;
    amount_ufern: string;
    height: number | null;
    at: Date;
  }>(
    `SELECT id, pair_id, account, counter_account, kind, label, amount_ufern::text, height, at
     FROM ledger_entries
     WHERE workspace_id = $1 AND ($2::text IS NULL OR account = $2)
     ORDER BY at DESC, sequence DESC`,
    [workspace.id, account],
  );
  const balanceUfern = rows
    .filter((row) => account === null || row.account === account)
    .reduce((sum, row) => sum + BigInt(row.amount_ufern), 0n);
  return {
    status: 200,
    body: {
      account,
      balanceUfern: account === null ? 0 : ufern(balanceUfern),
      entries: rows.map((row) => ({
        id: row.id,
        pairId: row.pair_id,
        account: row.account,
        counterAccount: row.counter_account,
        kind: row.kind,
        label: row.label,
        amountUfern: Number(row.amount_ufern),
        height: row.height,
        at: row.at.toISOString(),
      })),
    },
  };
}
