/**
 * The seeded history. A fresh database replays it to exactly the versions,
 * audit entries, computations and current figures in the brief; a later start
 * against the same database replays and duplicates nothing.
 */
import { Transaction, query, transact, withAdvisoryLock } from './db';
import { readAppState, writeAppState } from './schema';
import { hashPassword } from './auth';
import { RowKey, ShareEventKind } from '../shared/labels';
import { formatDateString, parseDateString, wallTimeToInstant } from '../shared/nytime';
import { closesUpTo } from '../domain/calendar';
import { marketClockNow } from './marketClock';
import { seededExhibitFor } from './seedExhibits';
import { appendAuditEntry, processOneSessionClose, publishRestatementById } from './restatementActions';
import { storeMnavAt } from './computations';

const SEED_LOCK = 718_264_302;
const SEED_MARKER = 'seeded_history';
const SEED_VERSION = 'v1';

interface SeedStaff {
  id: string;
  name: string;
  email: string;
  roles: string[];
}

const STAFF: readonly SeedStaff[] = [
  {
    id: 'usr_tamsin_okafor',
    name: 'Tamsin Okafor',
    email: 'tamsin.okafor@vellichor.example',
    roles: ['treasury_analyst'],
  },
  {
    id: 'usr_imre_castellanos',
    name: 'Imre Castellanos',
    email: 'imre.castellanos@vellichor.example',
    roles: ['treasury_analyst', 'disclosure_counsel', 'disclosure_officer'],
  },
  {
    id: 'usr_rafe_lindqvist',
    name: 'Rafe Lindqvist',
    email: 'rafe.lindqvist@vellichor.example',
    roles: ['disclosure_counsel'],
  },
  {
    id: 'usr_wren_adeyemi',
    name: 'Wren Adeyemi',
    email: 'wren.adeyemi@vellichor.example',
    roles: ['disclosure_counsel', 'disclosure_officer'],
  },
  {
    id: 'usr_noor_halvorsen',
    name: 'Noor Halvorsen',
    email: 'noor.halvorsen@vellichor.example',
    roles: ['disclosure_officer'],
  },
  {
    id: 'usr_basil_ferreira',
    name: 'Basil Ferreira',
    email: 'basil.ferreira@vellichor.example',
    roles: ['operator'],
  },
];

const SEED_PASSWORD = 'tracewell-rehearsal-26';

const PREPARER = 'usr_tamsin_okafor';
const CLEARER = 'usr_rafe_lindqvist';
const RELEASER = 'usr_noor_halvorsen';

const CORRECTION_REASON =
  'Staking rewards understated by 10 ETH; the validator reward export omitted epochs for 2026-10-17.';

interface SeedShareEvent {
  kind: ShareEventKind;
  shares: string;
  effectiveDate: string;
}

interface SeedRestatement {
  id: string;
  weekEnding: string;
  accession: string;
  page: number;
  rows: Record<RowKey, string>;
  shareEvents: SeedShareEvent[];
  publishedAt: string;
  supersedes: string | null;
  correctionReason: string | null;
}

const SEED_RESTATEMENTS: readonly SeedRestatement[] = [
  {
    id: 'rst_w20261011',
    weekEnding: '2026-10-11',
    accession: '0002093117-26-000041',
    page: 1,
    rows: {
      'beginning-balance': '401250',
      'eth-acquired': '6120.5',
      'staking-rewards': '412.375',
      'ending-balance': '407782.875',
      'cumulative-staking-rewards': '10256.625',
      'diluted-shares': '148250000',
    },
    shareEvents: [],
    publishedAt: '2026-10-12 17:30:05',
    supersedes: null,
    correctionReason: null,
  },
  {
    id: 'rst_w20261018',
    weekEnding: '2026-10-18',
    accession: '0002093117-26-000044',
    page: 1,
    rows: {
      'beginning-balance': '407782.875',
      'eth-acquired': '4980.25',
      'staking-rewards': '408.0625',
      'ending-balance': '413171.1875',
      'cumulative-staking-rewards': '10664.6875',
      'diluted-shares': '150650000',
    },
    shareEvents: [{ kind: 'atm_settlement', shares: '2400000', effectiveDate: '2026-10-14' }],
    publishedAt: '2026-10-19 17:30:05',
    supersedes: null,
    correctionReason: null,
  },
  {
    id: 'rst_w20261018c',
    weekEnding: '2026-10-18',
    accession: '0002093117-26-000046',
    page: 1,
    rows: {
      'beginning-balance': '407782.875',
      'eth-acquired': '4980.25',
      'staking-rewards': '418.0625',
      'ending-balance': '413181.1875',
      'cumulative-staking-rewards': '10674.6875',
      'diluted-shares': '150650000',
    },
    shareEvents: [{ kind: 'atm_settlement', shares: '2400000', effectiveDate: '2026-10-14' }],
    publishedAt: '2026-10-21 18:00:05',
    supersedes: 'rst_w20261018',
    correctionReason: CORRECTION_REASON,
  },
  {
    id: 'rst_w20261025',
    weekEnding: '2026-10-25',
    accession: '0002093117-26-000049',
    page: 1,
    rows: {
      'beginning-balance': '413181.1875',
      'eth-acquired': '0',
      'staking-rewards': '421.5',
      'ending-balance': '413602.6875',
      'cumulative-staking-rewards': '11096.1875',
      'diluted-shares': '150150000',
    },
    shareEvents: [{ kind: 'buyback', shares: '500000', effectiveDate: '2026-10-22' }],
    publishedAt: '2026-10-26 17:30:05',
    supersedes: null,
    correctionReason: null,
  },
];

interface SeedTick {
  date: string;
  instrument: 'ETH-USD' | 'VLCH';
  price: string;
  time: string;
}

const SEED_TICKS: readonly SeedTick[] = [
  { date: '2026-10-12', instrument: 'VLCH', price: '13.94', time: '15:59:00' },
  { date: '2026-10-12', instrument: 'ETH-USD', price: '3382.40', time: '17:30:00' },
  { date: '2026-10-19', instrument: 'VLCH', price: '14.21', time: '15:59:00' },
  { date: '2026-10-19', instrument: 'ETH-USD', price: '3401.15', time: '17:30:00' },
  { date: '2026-10-21', instrument: 'VLCH', price: '14.35', time: '15:59:00' },
  { date: '2026-10-21', instrument: 'ETH-USD', price: '3396.80', time: '18:00:00' },
  { date: '2026-10-26', instrument: 'VLCH', price: '14.62', time: '15:59:00' },
  { date: '2026-10-26', instrument: 'ETH-USD', price: '3410.05', time: '17:30:00' },
  { date: '2026-10-27', instrument: 'VLCH', price: '14.71', time: '15:59:00' },
  { date: '2026-10-28', instrument: 'VLCH', price: '14.58', time: '15:59:00' },
  { date: '2026-10-29', instrument: 'VLCH', price: '14.90', time: '15:59:00' },
  { date: '2026-10-30', instrument: 'VLCH', price: '14.77', time: '15:59:00' },
  { date: '2026-10-30', instrument: 'ETH-USD', price: '3415.90', time: '17:00:00' },
];

const FIRST_CLOSE_DATE = '2026-10-12';

function stampToInstant(stamp: string): number {
  const [datePart, timePart] = stamp.split(' ');
  const date = parseDateString(datePart ?? '');
  const pieces = (timePart ?? '').split(':').map(Number);
  if (date === null || pieces.length !== 3) throw new Error('seed stamp is not a wall time');
  const instant = wallTimeToInstant({
    ...date,
    hour: pieces[0] as number,
    minute: pieces[1] as number,
    second: pieces[2] as number,
  });
  if (instant === null) throw new Error('seed stamp does not exist in America/New_York');
  return instant;
}

async function seedStaff(): Promise<void> {
  for (const member of STAFF) {
    await query(
      `INSERT INTO staff_user (id, name, email, password_hash, roles)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (email) DO NOTHING`,
      [member.id, member.name, member.email, hashPassword(SEED_PASSWORD), member.roles],
    );
  }
}

const PRE_PUBLICATION_AUDIT: readonly {
  action: 'create' | 'edit' | 'exhibit_pending' | 'exhibit_verified' | 'submit' | 'clear';
  actorId: string;
  fromState: 'draft' | 'in_review' | null;
  toState: 'draft' | 'in_review' | 'cleared';
}[] = [
  { action: 'create', actorId: PREPARER, fromState: null, toState: 'draft' },
  { action: 'edit', actorId: PREPARER, fromState: 'draft', toState: 'draft' },
  { action: 'exhibit_pending', actorId: PREPARER, fromState: 'draft', toState: 'draft' },
  { action: 'exhibit_verified', actorId: PREPARER, fromState: 'draft', toState: 'draft' },
  { action: 'submit', actorId: PREPARER, fromState: 'draft', toState: 'in_review' },
  { action: 'clear', actorId: CLEARER, fromState: 'in_review', toState: 'cleared' },
];

async function insertSeedRestatement(
  tx: Transaction,
  restatement: SeedRestatement,
  publishedAtMs: number,
): Promise<void> {
  const exhibit = seededExhibitFor(restatement.accession);
  await tx.query(
    `INSERT INTO restatement
       (id, version, week_ending, state, supersedes, correction_reason,
        row_beginning_balance, row_eth_acquired, row_staking_rewards,
        row_ending_balance, row_cumulative_staking_rewards, row_diluted_shares,
        accession, exhibit_page, exhibit_status, exhibit_sha256, exhibit_bytes, exhibit_key,
        prepared_by, cleared_by, released_by, created_at, updated_at)
       VALUES ($1, 6, $2, 'cleared', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
               'verified', $13, $14, $15, $16, $17, $18, $19, $19)`,
    [
      restatement.id,
      restatement.weekEnding,
      restatement.supersedes,
      restatement.correctionReason,
      restatement.rows['beginning-balance'],
      restatement.rows['eth-acquired'],
      restatement.rows['staking-rewards'],
      restatement.rows['ending-balance'],
      restatement.rows['cumulative-staking-rewards'],
      restatement.rows['diluted-shares'],
      restatement.accession,
      restatement.page,
      exhibit.sha256,
      exhibit.bytes.length,
      `exhibits/${restatement.accession}/${exhibit.sha256}.pdf`,
      PREPARER,
      CLEARER,
      RELEASER,
      new Date(publishedAtMs),
    ],
  );
  for (let index = 0; index < restatement.shareEvents.length; index += 1) {
    const event = restatement.shareEvents[index] as SeedShareEvent;
    await tx.query(
      `INSERT INTO share_event (id, restatement_id, position, kind, shares, effective_date)
         VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        `she_${restatement.id}_${index}`,
        restatement.id,
        index,
        event.kind,
        event.shares,
        event.effectiveDate,
      ],
    );
  }
  for (let index = 0; index < PRE_PUBLICATION_AUDIT.length; index += 1) {
    const entry = PRE_PUBLICATION_AUDIT[index] as (typeof PRE_PUBLICATION_AUDIT)[number];
    await appendAuditEntry(tx, {
      restatementId: restatement.id,
      version: index + 1,
      action: entry.action,
      actorId: entry.actorId,
      atMs: publishedAtMs,
      fromState: entry.fromState,
      toState: entry.toState,
      note: null,
    });
  }
}

type SeedEvent =
  | { atMs: number; priority: 0; kind: 'tick'; id: string; instrument: string; price: string }
  | { atMs: number; priority: 1; kind: 'close'; date: string }
  | { atMs: number; priority: 2; kind: 'publish'; restatement: SeedRestatement };

async function buildTimeline(): Promise<SeedEvent[]> {
  const events: SeedEvent[] = [];
  for (const tick of SEED_TICKS) {
    events.push({
      atMs: stampToInstant(`${tick.date} ${tick.time}`),
      priority: 0,
      kind: 'tick',
      id: `seed-${tick.date}-${tick.instrument === 'VLCH' ? 'vlch' : 'eth'}`,
      instrument: tick.instrument,
      price: tick.price,
    });
  }
  for (const restatement of SEED_RESTATEMENTS) {
    events.push({
      atMs: stampToInstant(restatement.publishedAt),
      priority: 2,
      kind: 'publish',
      restatement,
    });
  }
  const nowMs = await marketClockNow();
  const firstCloseDate = parseDateString(FIRST_CLOSE_DATE);
  if (firstCloseDate !== null) {
    for (const day of closesUpTo(firstCloseDate, nowMs)) {
      if (day.closesAt === null) continue;
      events.push({
        atMs: day.closesAt,
        priority: 1,
        kind: 'close',
        date: formatDateString(day.date),
      });
    }
  }
  events.sort((left, right) =>
    left.atMs === right.atMs ? left.priority - right.priority : left.atMs - right.atMs,
  );
  return events;
}

async function replayTimeline(): Promise<void> {
  for (const event of await buildTimeline()) {
    if (event.kind === 'close') {
      await processOneSessionClose(event.date, event.atMs);
      continue;
    }
    if (event.kind === 'tick') {
      await transact(async (tx) => {
        await tx.query(
          `INSERT INTO tick (id, instrument, price, at) VALUES ($1, $2, $3, $4)
             ON CONFLICT (id) DO NOTHING`,
          [event.id, event.instrument, event.price, new Date(event.atMs)],
        );
        await storeMnavAt(tx, event.atMs);
      });
      continue;
    }
    await transact(async (tx) => {
      await insertSeedRestatement(tx, event.restatement, event.atMs);
      await publishRestatementById(tx, event.restatement.id, event.atMs, RELEASER);
    });
  }
}

export async function applySeed(): Promise<void> {
  await withAdvisoryLock(SEED_LOCK, async () => {
    await seedStaff();
    if ((await readAppState(SEED_MARKER)) === SEED_VERSION) return;
    await replayTimeline();
    await writeAppState(SEED_MARKER, SEED_VERSION);
  });
}
