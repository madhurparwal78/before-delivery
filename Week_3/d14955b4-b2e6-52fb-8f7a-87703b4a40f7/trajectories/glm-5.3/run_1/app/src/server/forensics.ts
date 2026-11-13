// Shared message intake: sanitiser, verdicts and forensics shaping.
import { query } from './db';
import { computeSanitiser, type RemovedSpan } from './sanitiser';
import { firstAddress } from './linkChecks';

export interface VerdictRecord {
  signature_verdict: string;
  signature_secret: 'current' | 'previous';
  bucket_previous: number | null;
  bucket_level: number | null;
  bucket_capacity: number | null;
  sanitiser_verdict: string;
  sanitiser_before: string | null;
  sanitiser_after: string | null;
  sanitiser_removed: RemovedSpan[];
  link_verdict: string;
  link_url: string | null;
  link_address: string | null;
  link_title: string | null;
  link_description: string | null;
}

export interface StoredVerdict extends VerdictRecord {
  settled: boolean;
}

export async function insertVerdict(messageId: string, record: VerdictRecord): Promise<void> {
  await query(
    `INSERT INTO verdicts (message_id, settled, signature_verdict, signature_secret, bucket_previous, bucket_level, bucket_capacity,
      sanitiser_verdict, sanitiser_before, sanitiser_after, sanitiser_removed, link_verdict, link_url, link_address, link_title, link_description)
     VALUES ($1, false, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14, $15)`,
    [
      messageId, record.signature_verdict, record.signature_secret, record.bucket_previous, record.bucket_level, record.bucket_capacity,
      record.sanitiser_verdict, record.sanitiser_before, record.sanitiser_after,
      JSON.stringify(record.sanitiser_removed), record.link_verdict, record.link_url, record.link_address, record.link_title, record.link_description,
    ],
  );
}

export async function settleLink(
  messageId: string,
  verdict: string,
  address: string | null,
  title: string | null,
  description: string | null,
  url: string | null,
): Promise<void> {
  await query(
    `UPDATE verdicts SET link_verdict = $2, link_address = $3, link_title = $4, link_description = $5, link_url = $6, settled = true, updated_at = now()
      WHERE message_id = $1`,
    [messageId, verdict, address, title, description, url],
  );
}

export function playerVerdictBase(body: string, bucket: { previous: number; level: number }): VerdictRecord {
  const sanitiser = computeSanitiser(body);
  const link = firstAddress(sanitiser.after);
  return {
    signature_verdict: 'signature valid',
    signature_secret: 'current',
    bucket_previous: bucket.previous,
    bucket_level: bucket.level,
    bucket_capacity: 8,
    sanitiser_verdict: sanitiser.verdict,
    sanitiser_before: sanitiser.before,
    sanitiser_after: sanitiser.after,
    sanitiser_removed: sanitiser.removed,
    link_verdict: link === null ? 'no link' : 'checking',
    link_url: link,
    link_address: null,
    link_title: null,
    link_description: null,
  };
}

export function eventVerdict(signatureVerdict: string, signatureSecret: 'current' | 'previous'): VerdictRecord {
  return {
    signature_verdict: signatureVerdict,
    signature_secret: signatureSecret,
    bucket_previous: null,
    bucket_level: null,
    bucket_capacity: null,
    sanitiser_verdict: 'no player text',
    sanitiser_before: null,
    sanitiser_after: null,
    sanitiser_removed: [],
    link_verdict: 'no link',
    link_url: null,
    link_address: null,
    link_title: null,
    link_description: null,
  };
}

export interface ForensicsLine {
  stage: 'signature' | 'bucket' | 'sanitiser' | 'link';
  state: 'checking' | 'settled';
  verdict: string;
  previous?: number | null;
  level?: number | null;
  capacity?: number | null;
  before?: string | null;
  after?: string | null;
  removed?: RemovedSpan[];
  url?: string | null;
  address?: string | null;
}

export interface ForensicsBody {
  message_id: string;
  settled: boolean;
  lines: ForensicsLine[];
}

interface VerdictRow {
  message_id: string;
  settled: boolean;
  signature_verdict: string;
  signature_secret: string;
  bucket_previous: number | null;
  bucket_level: number | null;
  bucket_capacity: number | null;
  sanitiser_verdict: string;
  sanitiser_before: string | null;
  sanitiser_after: string | null;
  sanitiser_removed: unknown;
  link_verdict: string;
  link_url: string | null;
  link_address: string | null;
}

export async function loadForensics(messageId: string): Promise<ForensicsBody | null> {
  const result = await query<VerdictRow>('SELECT * FROM verdicts WHERE message_id = $1', [messageId]);
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  const removed = Array.isArray(row.sanitiser_removed) ? (row.sanitiser_removed as RemovedSpan[]) : [];
  const lines: ForensicsLine[] = [
    { stage: 'signature', state: 'settled', verdict: row.signature_verdict },
    {
      stage: 'bucket',
      state: 'settled',
      verdict: row.bucket_level === null ? 'not metered' : `${row.bucket_level} of ${row.bucket_capacity}`,
      previous: row.bucket_previous,
      level: row.bucket_level,
      capacity: row.bucket_capacity,
    },
    { stage: 'sanitiser', state: 'settled', verdict: row.sanitiser_verdict, before: row.sanitiser_before, after: row.sanitiser_after, removed },
    { stage: 'link', state: 'settled', verdict: row.link_verdict, url: row.link_url, address: row.link_address },
  ];
  return { message_id: row.message_id, settled: row.settled, lines };
}

export function emptyForensics(messageId: string): ForensicsBody {
  const checking: ForensicsLine[] = [
    { stage: 'signature', state: 'checking', verdict: 'checking' },
    { stage: 'bucket', state: 'checking', verdict: 'checking', previous: null, level: null, capacity: null },
    { stage: 'sanitiser', state: 'checking', verdict: 'checking', before: null, after: null, removed: [] },
    { stage: 'link', state: 'checking', verdict: 'checking', url: null, address: null },
  ];
  return { message_id: messageId, settled: false, lines: checking };
}

export function replyForensics(messageId: string): ForensicsBody {
  return { message_id: messageId, settled: true, lines: [] };
}
