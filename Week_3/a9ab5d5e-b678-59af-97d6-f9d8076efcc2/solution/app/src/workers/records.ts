import { createHash } from 'node:crypto';
import { logFault } from '../log';
import { appendLog, inHousehold, rows, transaction } from '../db';
import { Household, loadHousehold, mapCost, mapSwap, costColumns, swapColumns, costOwedMinor, parentName } from '../db/repo';
import { currencyExponent } from '../domain/money';
import { ParentRole, otherRole } from '../domain/plan';
import { dateYear } from '../domain/time';
import { lastNightOf } from '../lib/format';
import { queueNotices, recordReadyNotice } from '../services/notices';
import { RendererUnavailable, renderPdf } from '../services/gotenberg';
import { StorageUnavailable, deleteObject, getObject, putObject, recordKey } from '../services/storage';
import { YearRecordContent, yearRecordHtml } from '../services/yearRecordHtml';
import { FAILING_PROCESS_WAIT_MS, LEASE_SECONDS, RETRY_DELAY_SECONDS } from './schedule';

const cooldown = new Map<string, number>();

interface ClaimedRecord {
  id: string;
  householdId: string;
  year: number;
  stepsDone: number;
  attempts: number;
  fencingToken: string;
  yearDoc: string;
  yearDigest: string;
  pdf: Buffer | null;
}

async function claim(): Promise<ClaimedRecord | null> {
  const blocked = [...cooldown.entries()].filter(([, until]) => until > Date.now()).map(([id]) => id);
  for (const [id, until] of cooldown) {
    if (until <= Date.now()) cooldown.delete(id);
  }
  return transaction(async (client) => {
    const found = await client.query(
      `SELECT id::text AS id, household_id::text AS household_id, year, steps_done, attempts, year_doc, year_digest, pdf
       FROM year_records
       WHERE ((state = 'requested' AND next_attempt_at <= now() AND (lease_until IS NULL OR lease_until < now()))
              OR (state = 'rendering' AND lease_until < now()))
         AND NOT (id::text = ANY($1::text[]))
       ORDER BY year_records.id LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [blocked],
    );
    const row = found.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    const updated = await client.query(
      `UPDATE year_records SET state = 'rendering', lease_until = now() + make_interval(secs => $2),
          fencing_token = fencing_token + 1, waiting_on = null
       WHERE id = $1 RETURNING fencing_token::text AS fencing_token`,
      [row.id as string, LEASE_SECONDS],
    );
    return {
      id: row.id as string,
      householdId: row.household_id as string,
      year: row.year as number,
      stepsDone: row.steps_done as number,
      attempts: row.attempts as number,
      fencingToken: (updated.rows[0] as { fencing_token: string }).fencing_token,
      yearDoc: row.year_doc as string,
      yearDigest: row.year_digest as string,
      pdf: (row.pdf as Buffer | null) ?? null,
    };
  });
}

/** Commits a step only while this worker still holds the record's fencing token. */
async function commitStep(
  record: ClaimedRecord,
  run: (client: Parameters<Parameters<typeof inHousehold>[1]>[0], household: Household) => Promise<void>,
): Promise<boolean> {
  const household = await loadHousehold(record.householdId);
  if (!household) return false;
  return inHousehold(record.householdId, async (client) => {
    const current = await client.query(
      "SELECT state, fencing_token::text AS fencing_token FROM year_records WHERE id = $1 FOR UPDATE",
      [record.id],
    );
    const row = current.rows[0] as { state: string; fencing_token: string } | undefined;
    if (!row || row.fencing_token !== record.fencingToken || row.state !== 'rendering') return false;
    await run(client, household);
    return true;
  });
}

async function failAttempt(record: ClaimedRecord, service: 'renderer' | 'storage'): Promise<void> {
  cooldown.set(record.id, Date.now() + FAILING_PROCESS_WAIT_MS);
  const household = await loadHousehold(record.householdId);
  if (!household) return;
  await inHousehold(record.householdId, async (client) => {
    const current = await client.query(
      "SELECT state, attempts, fencing_token::text AS fencing_token FROM year_records WHERE id = $1 FOR UPDATE",
      [record.id],
    );
    const row = current.rows[0] as { state: string; attempts: number; fencing_token: string } | undefined;
    if (!row || row.fencing_token !== record.fencingToken || row.state !== 'rendering') return;
    const attempts = row.attempts + 1;
    if (attempts >= 3) {
      await client.query(
        `UPDATE year_records SET state = 'failed', attempts = $2, failure = $3, waiting_on = null, lease_until = null
         WHERE id = $1`,
        [record.id, attempts, `${service}_unavailable`],
      );
      await appendLog(client, household.id, 'system', 'record.failed', record.id);
      return;
    }
    await client.query(
      `UPDATE year_records SET state = 'requested', attempts = $2, waiting_on = $3, lease_until = null,
          next_attempt_at = now() + make_interval(secs => $4)
       WHERE id = $1`,
      [record.id, attempts, service, RETRY_DELAY_SECONDS],
    );
  });
}

async function contentFor(record: ClaimedRecord, household: Household): Promise<YearRecordContent> {
  const document = JSON.parse(record.yearDoc) as {
    days: { date: string; owner: ParentRole | null }[];
    nights: { planning: number; other: number };
  };
  const swapRows = await rows(
    `SELECT ${swapColumns} FROM swaps WHERE household_id = $1 AND state IN ('accepted','settled') ORDER BY swaps.id`,
    [household.id],
  );
  const costRows = await rows(
    `SELECT ${costColumns} FROM costs WHERE household_id = $1 AND state IN ('accepted','settled') ORDER BY costs.id`,
    [household.id],
  );
  const swaps = swapRows
    .map(mapSwap)
    .filter((swap) => {
      const years = [dateYear(swap.nights.start), dateYear(lastNightOf(swap.nights.end))];
      if (swap.makeupNights) {
        years.push(dateYear(swap.makeupNights.start), dateYear(lastNightOf(swap.makeupNights.end)));
      }
      return years.includes(record.year);
    })
    .map((swap) => ({
      firstNight: swap.nights.start,
      lastNight: lastNightOf(swap.nights.end),
      toParentName: parentName(household, swap.toParent),
      makeup: swap.makeupNights
        ? {
            firstNight: swap.makeupNights.start,
            lastNight: lastNightOf(swap.makeupNights.end),
            giverName: parentName(household, otherRole(swap.toParent)),
          }
        : null,
    }));
  const costs = costRows
    .map(mapCost)
    .filter((cost) => dateYear(cost.custodyDay) === record.year)
    .map((cost) => ({
      custodyDay: cost.custodyDay,
      description: cost.description,
      amountMinor: cost.amountMinor,
      payerName: parentName(household, cost.paidBy),
      planningShare: cost.sharePlanning,
      otherShare: cost.shareOther,
      owedMinor: costOwedMinor(cost),
    }));
  return {
    year: record.year,
    householdName: household.name,
    planningName: household.planning.name,
    otherName: household.other.name,
    digest: record.yearDigest,
    nights: document.nights,
    days: document.days,
    swaps,
    costs,
    currency: household.currency,
    currencyExponent: currencyExponent(household.currency),
  };
}

/** The three idempotent steps: render, write, read back and compare. */
export async function runRecordWorkerOnce(): Promise<void> {
  const record = await claim();
  if (!record) return;
  const household = await loadHousehold(record.householdId);
  if (!household) return;
  const key = recordKey(record.householdId, record.id);
  try {
    let pdf = record.pdf;
    if (record.stepsDone < 1) {
      const html = yearRecordHtml(await contentFor(record, household));
      pdf = await renderPdf(html);
      const digest = createHash('sha256').update(pdf).digest('hex');
      const stored = await commitStep(record, async (client) => {
        await client.query(
          'UPDATE year_records SET steps_done = 1, pdf = $2, bytes = $3, sha256 = $4 WHERE id = $1',
          [record.id, pdf as Buffer, (pdf as Buffer).length, digest],
        );
      });
      if (!stored) return;
      record.stepsDone = 1;
    }
    if (record.stepsDone < 2) {
      await putObject(key, pdf as Buffer, 'application/pdf');
      const stored = await commitStep(record, async (client) => {
        await client.query('UPDATE year_records SET steps_done = 2 WHERE id = $1', [record.id]);
      });
      if (!stored) {
        await deleteObject(key).catch((error: unknown) => logFault('record object cleanup', error));
        return;
      }
      record.stepsDone = 2;
    }
    const readBack = await getObject(key);
    const digest = createHash('sha256').update(pdf as Buffer).digest('hex');
    if (!readBack || readBack.length !== (pdf as Buffer).length || createHash('sha256').update(readBack).digest('hex') !== digest) {
      throw new StorageUnavailable('stored copy did not match');
    }
    const stored = await commitStep(record, async (client, home) => {
      await client.query(
        "UPDATE year_records SET steps_done = 3, state = 'stored', stored_at = now(), lease_until = null, waiting_on = null WHERE id = $1",
        [record.id],
      );
      await appendLog(client, home.id, 'system', 'record.stored', record.id);
      await queueNotices(client, home, [recordReadyNotice(home, 'planning'), recordReadyNotice(home, 'other')]);
    });
    if (!stored) await deleteObject(key).catch((error: unknown) => logFault('record object cleanup', error));
  } catch (error) {
    if (error instanceof RendererUnavailable) {
      await failAttempt(record, 'renderer');
      return;
    }
    if (error instanceof StorageUnavailable) {
      await failAttempt(record, 'storage');
      return;
    }
    throw error;
  }
}

/** A cancelled record keeps no stored object. */
export async function cleanCancelledRecords(): Promise<void> {
  const found = await rows(
    `SELECT id::text AS id, household_id::text AS household_id FROM year_records
     WHERE state = 'cancelled' AND object_removed = false AND steps_done >= 2 LIMIT 10`,
  );
  for (const row of found) {
    try {
      await deleteObject(recordKey(row.household_id as string, row.id as string));
      await rows('UPDATE year_records SET object_removed = true WHERE id = $1', [row.id as string]);
    } catch (error) {
      logFault('cancelled record cleanup', error);
      return;
    }
  }
}
