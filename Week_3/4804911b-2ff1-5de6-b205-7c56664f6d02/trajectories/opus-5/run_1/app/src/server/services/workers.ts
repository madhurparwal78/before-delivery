import { createHash } from 'node:crypto';
import { query } from '../db/pool.js';
import {
  bumpHeldWork,
  deferredEndpoints,
  deliveryById,
  endpointById,
  endpointsAwaitingRemoval,
  loadVersion,
  markEndpointRegistered,
  markHandedOver,
  pendingOrFailedVersions,
  setPrintState,
  undeliveredForNoticeEndpoint,
  accountById,
} from '../db/repo.js';
import { redeliveryOutstanding } from '../domain/delivery.js';
import { noticeHtml, noticePdfTitle } from '../print/noticeHtml.js';
import { startBroker, type JobOutcome } from './broker.js';
import { renderPdf } from './gotenberg.js';
import { enqueue, indexJob, renderJob, startRelay, type JobBody } from './outbox.js';
import {
  ensureIndex,
  indexDocumentCount,
  pingSearch,
  putDocuments,
  searchDown,
  SearchUnavailable,
  taskState,
} from './search.js';
import {
  createEndpoint,
  deleteEndpoint,
  ensureApplication,
  pingSvix,
  resendMessage,
  sendMessage,
  SvixUnavailable,
} from './svix.js';
import { getObject, headObject, noticePdfKey, pingStorage, putObject, StorageUnavailable } from './storage.js';
import { withTransaction } from '../db/pool.js';

let copyId = '';

function parseJob(raw: Buffer): JobBody | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const body = parsed as Record<string, unknown>;
  if (body.kind === 'render' && typeof body.number === 'string' && typeof body.version === 'number') {
    return { jobId: String(body.jobId), kind: 'render', number: body.number, version: body.version };
  }
  if (body.kind === 'index' && typeof body.skuCode === 'string') {
    return { jobId: String(body.jobId), kind: 'index', skuCode: body.skuCode };
  }
  if (body.kind === 'send' && typeof body.eventId === 'string') {
    return { jobId: String(body.jobId), kind: 'send', eventId: body.eventId };
  }
  return null;
}

async function runRender(number: string, version: number): Promise<JobOutcome> {
  const record = await loadVersion(number, version);
  if (record === null) return 'dead';
  if (record.printState !== 'pending') return 'done';
  const key = noticePdfKey(copyId, number, version);
  try {
    const existing = await headObject(key);
    if (existing !== null) {
      const bytes = await getObject(key);
      if (bytes !== null) {
        await setPrintState(record.noticeId, version, 'printable', createHash('sha256').update(bytes).digest('hex'));
        return 'done';
      }
    }
  } catch (error) {
    if (error instanceof StorageUnavailable) {
      await setPrintState(record.noticeId, version, 'failed', null);
      return 'done';
    }
    throw error;
  }
  let bytes: Buffer;
  try {
    bytes = await renderPdf(noticeHtml(record), noticePdfTitle(record));
  } catch {
    await setPrintState(record.noticeId, version, 'failed', null);
    return 'done';
  }
  try {
    await putObject(key, bytes, 'application/pdf');
  } catch {
    await setPrintState(record.noticeId, version, 'failed', null);
    return 'done';
  }
  await setPrintState(record.noticeId, version, 'printable', createHash('sha256').update(bytes).digest('hex'));
  return 'done';
}

interface DocumentRowShape {
  sku_code: string;
  sku_name: string;
  drink_name: string;
  aliases: string[];
  notice_titles: string[];
}

async function runIndex(skuCode: string): Promise<JobOutcome> {
  const result = await query<DocumentRowShape>(
    `select s.code as sku_code,
            d.name || ' ' || s.variant as sku_name,
            d.name as drink_name,
            coalesce((select array_agg(a.normalised) from aliases a where a.sku_code = s.code), '{}') as aliases,
            coalesce((select array_agg(distinct v.title)
                        from notice_rows r
                        join notice_versions v on v.notice_id = r.notice_id and v.version = r.version
                       where r.sku_code = s.code
                         and v.version = (select max(v2.version) from notice_versions v2 where v2.notice_id = r.notice_id)
                     ), '{}') as notice_titles
       from skus s join drinks d on d.id = s.drink_id
      where s.code = $1`,
    [skuCode],
  );
  const row = result.rows[0];
  if (!row) return 'dead';
  try {
    await ensureIndex(copyId);
    const task = await putDocuments(copyId, [
      {
        skuCode: row.sku_code,
        skuName: row.sku_name,
        drinkName: row.drink_name,
        aliases: row.aliases,
        noticeTitles: row.notice_titles,
      },
    ]);
    const settled = await waitForTask(task);
    if (settled !== 'succeeded') return 'retry';
  } catch (error) {
    if (error instanceof SearchUnavailable) return 'retry';
    throw error;
  }
  await query('delete from index_pending where sku_code = $1', [skuCode]);
  return 'done';
}

async function waitForTask(task: number): Promise<'succeeded' | 'failed' | 'pending'> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const state = await taskState(task);
    if (state !== 'pending') return state;
    if (Date.now() > deadline) return 'pending';
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function runSend(eventId: string): Promise<JobOutcome> {
  const delivery = await deliveryById(eventId);
  if (delivery === null) return 'dead';
  const endpoint = await endpointById(delivery.endpointId);
  if (endpoint === null) return 'dead';
  if (endpoint.removedAt !== null || delivery.cancelled) return 'done';
  const account = await accountById(delivery.accountId);
  if (account === null) return 'dead';

  try {
    if (!endpoint.registered) {
      await ensureApplication(account.id, account.displayName);
      const svixEndpointId = await createEndpoint(account.id, endpoint.id, endpoint.url, endpoint.signingSecret);
      await markEndpointRegistered(endpoint.id, svixEndpointId);
    }
    if (delivery.noticeNumber !== null && delivery.noticeVersion !== null) {
      const earlier = await undeliveredForNoticeEndpoint(
        delivery.noticeNumber,
        delivery.endpointId,
        delivery.noticeVersion,
      );
      if (earlier.length > 0) return 'retry';
    }
    if (!delivery.handedOver) {
      const messageId = await sendMessage(
        account.id,
        endpoint.id,
        delivery.eventId,
        delivery.eventType,
        delivery.payload,
      );
      await markHandedOver(delivery.eventId, messageId);
      return 'done';
    }
    if (redeliveryOutstanding(delivery)) {
      await resendMessage(account.id, delivery.eventId, endpoint.id);
    }
    return 'done';
  } catch (error) {
    if (error instanceof SvixUnavailable) return 'retry';
    throw error;
  }
}

async function handleJob(raw: Buffer): Promise<JobOutcome> {
  const job = parseJob(raw);
  if (job === null) {
    await bumpHeldWork();
    return 'dead';
  }
  let outcome: JobOutcome;
  if (job.kind === 'render') outcome = await runRender(job.number, job.version);
  else if (job.kind === 'index') outcome = await runIndex(job.skuCode);
  else outcome = await runSend(job.eventId);
  if (outcome === 'dead') await bumpHeldWork();
  return outcome;
}

/** Registers endpoints deferred during an outage and applies removals made then. */
async function reconcileEndpoints(): Promise<void> {
  for (const endpoint of await deferredEndpoints()) {
    const account = await accountById(endpoint.accountId);
    if (account === null) continue;
    try {
      await ensureApplication(account.id, account.displayName);
      const svixEndpointId = await createEndpoint(account.id, endpoint.id, endpoint.url, endpoint.signingSecret);
      await markEndpointRegistered(endpoint.id, svixEndpointId);
    } catch {
      return;
    }
  }
  for (const endpoint of await endpointsAwaitingRemoval()) {
    try {
      await deleteEndpoint(endpoint.accountId, endpoint.id);
      await query('update endpoints set registered = false where id = $1', [endpoint.id]);
    } catch {
      return;
    }
  }
}

export async function startWork(id: string): Promise<void> {
  copyId = id;
  startBroker(id, handleJob);
  startRelay();

  const versions = await pendingOrFailedVersions();
  await withTransaction(async (client) => {
    for (const version of versions) {
      await client.query(
        `update notice_versions set print_state = 'pending'
          where version = $2 and notice_id = (select id from notices where number = $1)`,
        [version.number, version.version],
      );
      await enqueue(client, renderJob(version.number, version.version));
    }
    const skus = await client.query<{ code: string }>('select code from skus order by position');
    for (const sku of skus.rows) {
      await client.query(
        `insert into index_pending (sku_code, requested_at) values ($1, now())
         on conflict (sku_code) do update set requested_at = now()`,
        [sku.code],
      );
      await enqueue(client, indexJob(sku.code));
    }
  });

  setInterval(() => {
    void pingSvix();
    void pingSearch();
    void pingStorage();
  }, 8_000).unref();
  void pingSvix();
  void pingSearch();
  void pingStorage();

  setInterval(() => {
    void reconcileEndpoints();
  }, 5_000).unref();

  setInterval(() => {
    void reindexWhatIsMissing();
  }, 10_000).unref();
}

/** Keeps the index matching Postgres after a search outage or a wiped index. */
async function reindexWhatIsMissing(): Promise<void> {
  if (searchDown()) return;
  const pending = await query<{ sku_code: string }>('select sku_code from index_pending');
  const stale =
    pending.rows.length > 0 ? pending.rows.map((row) => row.sku_code) : await skusMissingFromIndex();
  if (stale.length === 0) return;
  await withTransaction(async (client) => {
    for (const skuCode of stale) {
      await client.query(
        `insert into index_pending (sku_code, requested_at) values ($1, now())
         on conflict (sku_code) do update set requested_at = now()`,
        [skuCode],
      );
      await enqueue(client, indexJob(skuCode));
    }
  });
}

async function skusMissingFromIndex(): Promise<string[]> {
  const skus = await query<{ code: string }>('select code from skus order by position');
  try {
    await ensureIndex(copyId);
    if ((await indexDocumentCount(copyId)) >= skus.rows.length) return [];
  } catch {
    return [];
  }
  return skus.rows.map((row) => row.code);
}
