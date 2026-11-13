import { plateFor } from '../shared/copy.js';
import { passages } from '../shared/tale.js';
import { config } from './config.js';
import { applySchema, query } from './db.js';
import { SEED_RATE_BASIS_POINTS } from './rates.js';
import { ensureRealm, type SeededStaff } from './services/identity.js';
import { brokerChannel } from './services/broker.js';
import { ensureIndexes, putPassages, putPublicBoxes, putStaffBoxes } from './services/search.js';
import { ensureBucket } from './services/storage.js';
import { ensureApplication, setCharityEndpoint } from './services/webhooks.js';

export const seededStaff: readonly SeededStaff[] = [
  { username: 'maker', password: 'Maker-Press-2026!', role: 'maker' },
  { username: 'packer', password: 'Packer-Press-2026!', role: 'packer' },
  { username: 'treasurer', password: 'Treasurer-Press-2026!', role: 'treasurer' },
];

export const CHARITY_ENDPOINT_SETTING = 'charity_endpoint_url';

async function seedPostgres(): Promise<void> {
  await applySchema();
  const numbers = Array.from({ length: 240 }, (unused, index) => index + 1);
  await query(
    `INSERT INTO boxes (number, plate, state)
       SELECT n, p, 'available' FROM unnest($1::int[], $2::text[]) AS t(n, p)
       ON CONFLICT (number) DO NOTHING`,
    [numbers, numbers.map((number) => plateFor(number))],
  );
  for (const [index, passage] of passages.entries()) {
    await query(
      `INSERT INTO passages (passage_id, chapter, text, ordinal) VALUES ($1, $2, $3, $4)
         ON CONFLICT (passage_id) DO UPDATE SET chapter = $2, text = $3, ordinal = $4`,
      [passage.passageId, passage.chapter, passage.text, index],
    );
  }
  const rates = await query('SELECT 1 FROM charity_rates LIMIT 1');
  if (rates.length === 0) {
    await query(
      "INSERT INTO charity_rates (rate_basis_points, effective_from) VALUES ($1, '1970-01-01T00:00:00Z')",
      [SEED_RATE_BASIS_POINTS],
    );
  }
  for (const threshold of config.lowStockThresholds) {
    await query(
      'INSERT INTO stock_thresholds (threshold, armed) VALUES ($1, true) ON CONFLICT (threshold) DO NOTHING',
      [threshold],
    );
  }
  if (config.charityWebhookUrl !== null) {
    await query(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
      [CHARITY_ENDPOINT_SETTING, config.charityWebhookUrl],
    );
  }
}

async function seedSearch(): Promise<void> {
  await ensureIndexes();
  await putPassages(
    passages.map((passage) => ({
      id: `passage-${passage.passageId}`,
      kind: 'passage' as const,
      passageId: passage.passageId,
      chapter: passage.chapter,
      text: passage.text,
    })),
  );
  const rows = await query<{
    number: number;
    state: string;
    recipient_name: string | null;
    reference: string | null;
  }>(
    `SELECT b.number, b.state,
            CASE WHEN o.reference IS NULL THEN NULL
                 WHEN o.is_gift THEN o.recipient_name ELSE o.buyer_name END AS recipient_name,
            o.reference
       FROM boxes b LEFT JOIN orders o ON o.box_number = b.number AND o.live_claim`,
  );
  await putPublicBoxes(
    rows
      .filter((row) => row.state === 'available' || row.state === 'held')
      .map((row) => ({
        id: `box-${row.number}`,
        kind: 'box' as const,
        number: row.number,
        plate: plateFor(row.number),
      })),
  );
  await putStaffBoxes(
    rows.map((row) => ({
      id: `box-${row.number}`,
      number: row.number,
      plate: plateFor(row.number),
      state: row.state,
      recipientName: row.recipient_name,
      reference: row.reference,
    })),
  );
}

async function seedWebhooks(): Promise<void> {
  await ensureApplication();
  const rows = await query<{ value: string }>('SELECT value FROM settings WHERE key = $1', [
    CHARITY_ENDPOINT_SETTING,
  ]);
  const url = rows[0]?.value ?? config.charityWebhookUrl;
  if (url !== null && url !== undefined) await setCharityEndpoint(url);
}

interface SeedStep {
  name: string;
  run: () => Promise<void>;
}

const steps: SeedStep[] = [
  { name: 'postgres', run: seedPostgres },
  { name: 'identity', run: () => ensureRealm(seededStaff) },
  { name: 'storage', run: ensureBucket },
  { name: 'broker', run: async () => void (await brokerChannel()) },
  { name: 'search', run: seedSearch },
  { name: 'webhooks', run: seedWebhooks },
];

/** Applied idempotently on every serve, retrying for services not yet up. */
export function startSeeding(): void {
  const pending = new Map(steps.map((step) => [step.name, step]));
  const attempt = async (): Promise<void> => {
    for (const [name, step] of [...pending]) {
      if (name !== 'postgres' && pending.has('postgres')) continue;
      try {
        await step.run();
        pending.delete(name);
      } catch {
        /* retried on the next pass */
      }
    }
  };
  void attempt();
  const timer = setInterval(() => {
    if (pending.size === 0) {
      clearInterval(timer);
      return;
    }
    void attempt();
  }, 5000);
  timer.unref();
}
