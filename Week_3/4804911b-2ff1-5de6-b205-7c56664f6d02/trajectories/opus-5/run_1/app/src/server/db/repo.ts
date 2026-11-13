import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool, query } from './pool.js';
import { hashPassword } from './seed.js';
import type { PrintState, PublishedVersion, RowKind } from '../domain/price.js';
import type { SvixAttempt } from '../services/svix.js';

type Runner = Pick<PoolClient, 'query'>;

function runner(client?: Runner): Runner {
  return client ?? (pool as unknown as Runner);
}

export interface AccountRecord {
  id: string;
  role: 'editor' | 'stockist';
  displayName: string;
  email: string;
}

interface AccountRowShape {
  id: string;
  role: 'editor' | 'stockist';
  display_name: string;
  email: string;
  password_hash: string;
  password_salt: string;
}

export async function accountForCredentials(email: string, password: string): Promise<AccountRecord | null> {
  const result = await query<AccountRowShape>('select * from accounts where lower(email) = lower($1)', [email]);
  const row = result.rows[0];
  if (!row) return null;
  const given = Buffer.from(hashPassword(password, row.password_salt), 'hex');
  const stored = Buffer.from(row.password_hash, 'hex');
  if (given.length !== stored.length || !timingSafeEqual(given, stored)) return null;
  return { id: row.id, role: row.role, displayName: row.display_name, email: row.email };
}

export async function createSession(accountId: string): Promise<string> {
  const token = randomBytes(24).toString('hex');
  await query('insert into sessions (token, account_id) values ($1, $2)', [token, accountId]);
  return token;
}

export async function accountForSession(token: string): Promise<AccountRecord | null> {
  const result = await query<AccountRowShape>(
    `select a.* from sessions s join accounts a on a.id = s.account_id where s.token = $1`,
    [token],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { id: row.id, role: row.role, displayName: row.display_name, email: row.email };
}

export async function deleteSession(token: string): Promise<void> {
  await query('delete from sessions where token = $1', [token]);
}

export async function stockistAccounts(): Promise<AccountRecord[]> {
  const result = await query<AccountRowShape>("select * from accounts where role = 'stockist'");
  return result.rows.map((row) => ({
    id: row.id,
    role: row.role,
    displayName: row.display_name,
    email: row.email,
  }));
}

export async function accountById(id: string): Promise<AccountRecord | null> {
  const result = await query<AccountRowShape>('select * from accounts where id = $1', [id]);
  const row = result.rows[0];
  if (!row) return null;
  return { id: row.id, role: row.role, displayName: row.display_name, email: row.email };
}

export interface VersionRecord extends PublishedVersion {
  supersededBy: number | null;
}

interface VersionRowShape {
  notice_id: string;
  number: string;
  version: number;
  title: string;
  effective_date: string;
  run_out_until: string | null;
  published_at: Date;
  reason: string | null;
  print_state: PrintState;
  pdf_sha256: string | null;
  sheet_id: string | null;
  sheet_sha256: string | null;
}

interface NoticeRowShape {
  sku_code: string;
  name: string;
  kind: RowKind;
  old_mrp_paise: number;
  revised_mrp_paise: number;
  old_rate: number | null;
  new_rate: number | null;
}

export async function loadVersion(
  number: string,
  version: number,
  client?: Runner,
): Promise<VersionRecord | null> {
  const run = runner(client);
  const result = await run.query<VersionRowShape>(
    `select n.id as notice_id, n.number, v.*, s.sha256 as sheet_sha256
       from notices n join notice_versions v on v.notice_id = n.id
       left join sheets s on s.id = v.sheet_id
      where n.number = $1 and v.version = $2`,
    [number, version],
  );
  const row = result.rows[0];
  if (!row) return null;
  const rows = await run.query<NoticeRowShape>(
    'select * from notice_rows where notice_id = $1 and version = $2 order by position',
    [row.notice_id, version],
  );
  const latest = await run.query<{ max: number }>(
    'select max(version)::int as max from notice_versions where notice_id = $1',
    [row.notice_id],
  );
  const highest = latest.rows[0].max;
  return {
    noticeId: row.notice_id,
    number: row.number,
    version: row.version,
    title: row.title,
    effectiveDate: row.effective_date,
    runOutUntil: row.run_out_until,
    publishedAt: row.published_at.toISOString(),
    reason: row.reason,
    printState: row.print_state,
    pdfSha256: row.pdf_sha256,
    sheet: row.sheet_id === null ? null : { id: row.sheet_id, sha256: row.sheet_sha256 ?? '' },
    rows: rows.rows.map((entry) => ({
      skuCode: entry.sku_code,
      name: entry.name,
      kind: entry.kind,
      oldMrpPaise: entry.old_mrp_paise,
      revisedMrpPaise: entry.revised_mrp_paise,
      oldRate: entry.old_rate,
      newRate: entry.new_rate,
    })),
    supersededBy: highest > row.version ? row.version + 1 : null,
  };
}

export async function setPrintState(
  noticeId: string,
  version: number,
  state: PrintState,
  pdfSha256: string | null,
  client?: Runner,
): Promise<void> {
  await runner(client).query(
    'update notice_versions set print_state = $3, pdf_sha256 = coalesce($4, pdf_sha256) where notice_id = $1 and version = $2',
    [noticeId, version, state, pdfSha256],
  );
}

export async function pendingOrFailedVersions(): Promise<{ number: string; version: number }[]> {
  const result = await query<{ number: string; version: number }>(
    `select n.number, v.version from notices n join notice_versions v on v.notice_id = n.id
      where v.print_state in ('pending', 'failed') order by n.number, v.version`,
  );
  return result.rows;
}

export interface EndpointRecord {
  id: string;
  accountId: string;
  url: string;
  normalisedUrl: string;
  signingSecret: string;
  registered: boolean;
  svixEndpointId: string | null;
  rotating: boolean;
  createdAt: string;
  removedAt: string | null;
}

interface EndpointRowShape {
  id: string;
  account_id: string;
  url: string;
  normalised_url: string;
  signing_secret: string;
  registered: boolean;
  svix_endpoint_id: string | null;
  rotating: boolean;
  created_at: Date;
  removed_at: Date | null;
}

function endpointFrom(row: EndpointRowShape): EndpointRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    url: row.url,
    normalisedUrl: row.normalised_url,
    signingSecret: row.signing_secret,
    registered: row.registered,
    svixEndpointId: row.svix_endpoint_id,
    rotating: row.rotating,
    createdAt: row.created_at.toISOString(),
    removedAt: row.removed_at === null ? null : row.removed_at.toISOString(),
  };
}

export async function liveEndpoints(accountId: string, client?: Runner): Promise<EndpointRecord[]> {
  const result = await runner(client).query<EndpointRowShape>(
    'select * from endpoints where account_id = $1 and removed_at is null order by created_at, id',
    [accountId],
  );
  return result.rows.map(endpointFrom);
}

export async function allLiveEndpoints(client?: Runner): Promise<EndpointRecord[]> {
  const result = await runner(client).query<EndpointRowShape>(
    'select * from endpoints where removed_at is null order by created_at, id',
  );
  return result.rows.map(endpointFrom);
}

export async function endpointById(id: string, client?: Runner): Promise<EndpointRecord | null> {
  const result = await runner(client).query<EndpointRowShape>('select * from endpoints where id = $1', [id]);
  const row = result.rows[0];
  return row ? endpointFrom(row) : null;
}

export async function deferredEndpoints(): Promise<EndpointRecord[]> {
  const result = await query<EndpointRowShape>(
    'select * from endpoints where registered = false and removed_at is null order by created_at',
  );
  return result.rows.map(endpointFrom);
}

export async function endpointsAwaitingRemoval(): Promise<EndpointRecord[]> {
  const result = await query<EndpointRowShape>(
    'select * from endpoints where removed_at is not null and registered = true order by removed_at',
  );
  return result.rows.map(endpointFrom);
}

export async function markEndpointRegistered(id: string, svixEndpointId: string): Promise<void> {
  await query('update endpoints set registered = true, svix_endpoint_id = $2 where id = $1', [id, svixEndpointId]);
}

export async function markEndpointGone(id: string): Promise<void> {
  await query('update endpoints set registered = false where id = $1', [id]);
}

export interface DeliveryRecord {
  eventId: string;
  accountId: string;
  endpointId: string;
  eventType: string;
  noticeNumber: string | null;
  noticeVersion: number | null;
  payload: Record<string, unknown>;
  handedOver: boolean;
  svixMessageId: string | null;
  attempts: SvixAttempt[];
  redeliveryRequested: boolean;
  redeliveryFrom: number | null;
  cancelled: boolean;
  createdAt: string;
}

interface DeliveryRowShape {
  event_id: string;
  account_id: string;
  endpoint_id: string;
  event_type: string;
  notice_number: string | null;
  notice_version: number | null;
  payload: Record<string, unknown>;
  handed_over: boolean;
  svix_message_id: string | null;
  attempts: SvixAttempt[];
  redelivery_requested: boolean;
  redelivery_from: number | null;
  cancelled: boolean;
  created_at: Date;
}

function deliveryFrom(row: DeliveryRowShape): DeliveryRecord {
  return {
    eventId: row.event_id,
    accountId: row.account_id,
    endpointId: row.endpoint_id,
    eventType: row.event_type,
    noticeNumber: row.notice_number,
    noticeVersion: row.notice_version,
    payload: row.payload,
    handedOver: row.handed_over,
    svixMessageId: row.svix_message_id,
    attempts: row.attempts,
    redeliveryRequested: row.redelivery_requested,
    redeliveryFrom: row.redelivery_from,
    cancelled: row.cancelled,
    createdAt: row.created_at.toISOString(),
  };
}

export async function insertDelivery(
  client: PoolClient,
  record: {
    eventId: string;
    accountId: string;
    endpointId: string;
    eventType: string;
    noticeNumber: string | null;
    noticeVersion: number | null;
    payload: unknown;
  },
): Promise<void> {
  await client.query(
    `insert into deliveries (event_id, account_id, endpoint_id, event_type, notice_number, notice_version, payload)
     values ($1, $2, $3, $4, $5, $6, $7) on conflict (event_id) do nothing`,
    [
      record.eventId,
      record.accountId,
      record.endpointId,
      record.eventType,
      record.noticeNumber,
      record.noticeVersion,
      JSON.stringify(record.payload),
    ],
  );
}

export async function deliveryById(eventId: string, client?: Runner): Promise<DeliveryRecord | null> {
  const result = await runner(client).query<DeliveryRowShape>('select * from deliveries where event_id = $1', [
    eventId,
  ]);
  const row = result.rows[0];
  return row ? deliveryFrom(row) : null;
}

export async function deliveriesForAccount(accountId: string): Promise<DeliveryRecord[]> {
  const result = await query<DeliveryRowShape>(
    'select * from deliveries where account_id = $1 order by seq desc',
    [accountId],
  );
  return result.rows.map(deliveryFrom);
}

export async function deliveriesForEndpoint(endpointId: string): Promise<DeliveryRecord[]> {
  const result = await query<DeliveryRowShape>(
    'select * from deliveries where endpoint_id = $1 order by seq desc',
    [endpointId],
  );
  return result.rows.map(deliveryFrom);
}

export async function undeliveredForNoticeEndpoint(
  noticeNumber: string,
  endpointId: string,
  belowVersion: number,
  client?: Runner,
): Promise<DeliveryRecord[]> {
  const result = await runner(client).query<DeliveryRowShape>(
    `select * from deliveries
      where notice_number = $1 and endpoint_id = $2 and notice_version < $3 and handed_over = false
        and cancelled = false`,
    [noticeNumber, endpointId, belowVersion],
  );
  return result.rows.map(deliveryFrom);
}

export async function markHandedOver(eventId: string, svixMessageId: string): Promise<void> {
  await query('update deliveries set handed_over = true, svix_message_id = $2 where event_id = $1', [
    eventId,
    svixMessageId,
  ]);
}

export async function storeAttempts(eventId: string, attempts: SvixAttempt[]): Promise<void> {
  await query('update deliveries set attempts = $2 where event_id = $1', [eventId, JSON.stringify(attempts)]);
}

export async function requestRedelivery(
  client: PoolClient,
  eventId: string,
  finishedAttempts: number,
): Promise<void> {
  await client.query(
    'update deliveries set redelivery_requested = true, redelivery_from = $2 where event_id = $1',
    [eventId, finishedAttempts],
  );
}

export async function cancelUndelivered(client: PoolClient, endpointId: string): Promise<void> {
  await client.query(
    `update deliveries set cancelled = true
      where endpoint_id = $1 and cancelled = false
        and not exists (
          select 1 from jsonb_array_elements(attempts) a where a->>'outcome' = 'success'
        )`,
    [endpointId],
  );
}

export async function bumpHeldWork(): Promise<void> {
  await query(
    `insert into counters (name, value) values ('held_work', 1)
     on conflict (name) do update set value = counters.value + 1`,
  );
}

export async function insertBatch(
  client: PoolClient,
  code: string,
  skuCode: string,
  packedDate: string,
  oldWrapper: boolean,
): Promise<void> {
  await client.query('insert into batches (code, sku_code, packed_date, old_wrapper) values ($1, $2, $3, $4)', [
    code,
    skuCode,
    packedDate,
    oldWrapper,
  ]);
}

export async function skuHistory(
  skuCode: string,
): Promise<{ at: string; field: string; from: string; to: string }[]> {
  const result = await query<{ at: Date; field: string; from_value: string; to_value: string }>(
    'select at, field, from_value, to_value from sku_history where sku_code = $1 order by id',
    [skuCode],
  );
  return result.rows.map((row) => ({
    at: row.at.toISOString(),
    field: row.field,
    from: row.from_value,
    to: row.to_value,
  }));
}

export function newId(): string {
  return randomUUID();
}
