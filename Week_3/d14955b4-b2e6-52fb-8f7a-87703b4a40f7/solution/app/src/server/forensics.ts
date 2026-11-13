import type { PoolClient } from 'pg';
import { BUCKET_CAPACITY, STAGES } from '../shared/types.js';
import type { ForensicsBody, ForensicsLine, Stage } from '../shared/types.js';
import type { Db } from './db.js';
import type { LinkOutcome } from './link-preview.js';
import type { Sanitised } from '../shared/sanitiser.js';
import { sanitiserVerdict } from '../shared/sanitiser.js';

function checkingLine(stage: Stage): ForensicsLine {
  switch (stage) {
    case 'signature':
      return { stage, state: 'checking', verdict: 'checking' };
    case 'bucket':
      return { stage, state: 'checking', verdict: 'checking', previous: null, level: null, capacity: null };
    case 'sanitiser':
      return { stage, state: 'checking', verdict: 'checking', before: null, after: null, removed: [] };
    case 'link':
      return { stage, state: 'checking', verdict: 'checking', url: null, address: null };
  }
}

export function signatureLine(verdict: string): ForensicsLine {
  return { stage: 'signature', state: 'settled', verdict };
}

export function bucketLine(previous: number, level: number): ForensicsLine {
  return { stage: 'bucket', state: 'settled', verdict: `${level} of ${BUCKET_CAPACITY}`, previous, level, capacity: BUCKET_CAPACITY };
}

export const unmeteredBucketLine = (): ForensicsLine => ({
  stage: 'bucket', state: 'settled', verdict: 'not metered', previous: null, level: null, capacity: null,
});

export function sanitiserLine(result: Sanitised): ForensicsLine {
  return { stage: 'sanitiser', state: 'settled', verdict: sanitiserVerdict(result.removed), before: result.before, after: result.after, removed: result.removed };
}

export const noTextSanitiserLine = (): ForensicsLine => ({
  stage: 'sanitiser', state: 'settled', verdict: 'no player text', before: null, after: null, removed: [],
});

export function linkLine(outcome: Pick<LinkOutcome, 'verdict' | 'url' | 'address'>): ForensicsLine {
  return { stage: 'link', state: 'settled', verdict: outcome.verdict, url: outcome.url, address: outcome.address };
}

export const noLinkLine = (): ForensicsLine => linkLine({ verdict: 'no link', url: null, address: null });

export async function storeVerdict(db: Db | PoolClient, messageId: string, line: ForensicsLine): Promise<void> {
  await db.query('insert into verdicts (message_id, stage, line) values ($1, $2, $3) on conflict do nothing', [messageId, line.stage, JSON.stringify(line)]);
}

export async function loadForensics(db: Db, messageId: string, kind: 'player' | 'reply' | 'event'): Promise<ForensicsBody> {
  if (kind === 'reply') return { message_id: messageId, settled: true, lines: [] };
  const { rows } = await db.query<{ stage: Stage; line: ForensicsLine }>('select stage, line from verdicts where message_id = $1', [messageId]);
  const byStage = new Map(rows.map((row) => [row.stage, row.line]));
  const lines = STAGES.map((stage) => byStage.get(stage) ?? checkingLine(stage));
  return { message_id: messageId, settled: lines.every((line) => line.state === 'settled'), lines };
}
