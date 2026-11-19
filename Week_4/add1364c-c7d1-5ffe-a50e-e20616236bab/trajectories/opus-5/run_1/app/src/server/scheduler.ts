import { config } from './config.js';
import { now } from './clock.js';
import { query, one } from './db.js';
import { withAudit } from './audit.js';
import { sendTo } from './events.js';
import {
  nthOfficeBusinessDayFrom,
  officeDate,
  officeMidnight,
  quarterFirstDay,
  quarterOf,
} from './officeTime.js';
import { newId } from './secretStore.js';
import { setUserEnabled } from './services/keycloak.js';
import { deskStaffIds, loadPeople, scopeIds, termEndsAt, termStartsAt, travelWindows } from './domain/people.js';
import { REVIEW_OVERDUE_BUSINESS_DAY, openReview } from './domain/reviews.js';
import { loadRules, rulesOfVault } from './domain/rules.js';
import { nextRuns, dueByAfter, overdueFrom, type RotationRow } from './domain/turns.js';
import { allVaults, visibleVaultIds } from './domain/visibility.js';
import { applyLeave, announceLeave, announceReviewChange } from './domain/scopeChanges.js';
import { retryWaitingSeats } from './domain/seats.js';
import { runBreachCheck } from './domain/health.js';
import { ensureSeededSeats, ensureSeededUsers } from './seed.js';
import type { RuleRow, TurnRow } from './types.js';

const TICK_MS = 1_000;
const BILLING_RETRY_MS = 2_000;
const SEED_RETRY_MS = 30_000;

const travelOpen = new Map<string, boolean>();
let seedingComplete = false;

async function readMeta(key: string): Promise<string | null> {
  return (await one<{ value: string }>('select value from meta where key = $1', [key]))?.value ?? null;
}

async function writeMeta(key: string, value: string): Promise<void> {
  await query('insert into meta (key, value) values ($1,$2) on conflict (key) do update set value = $2', [key, value]);
}

/** Scheduled rules take force at the office midnight on their effective date, never earlier. */
async function takeRulesIntoForce(at: Date): Promise<void> {
  const rules = await loadRules();
  const due = rules.filter(
    (rule) => rule.state === 'scheduled' && officeMidnight(rule.effective_on).getTime() <= at.getTime(),
  );
  if (due.length === 0) return;
  const vaults = await allVaults();
  const inDrawerOrder = vaults.flatMap((vault) => due.filter((rule) => rule.vault_id === vault.id));
  const announced: { vault_id: string; rule_id: string; name: string }[] = [];
  for (const rule of inDrawerOrder) {
    const vault = vaults.find((entry) => entry.id === rule.vault_id);
    if (vault === undefined) continue;
    const superseded = previousInForce(rules, rule);
    const taken = await withAudit(async (client, write) => {
      const updated = await client.query(
        "update rules set state = 'in_force', took_force_at = $2 where id = $1 and state = 'scheduled'",
        [rule.id, at],
      );
      if ((updated.rowCount ?? 0) === 0) return false;
      await write({
        actor: 'Lockset',
        action: 'rule_in_force',
        subject: { kind: 'vault', id: vault.id, name: vault.name },
        details: { rule_id: rule.id, min_length: rule.min_length, effective_on: rule.effective_on },
      });
      if (superseded !== null) {
        await client.query("update rules set state = 'superseded' where id = $1", [superseded.id]);
        await write({
          actor: 'Lockset',
          action: 'rule_superseded',
          subject: { kind: 'vault', id: vault.id, name: vault.name },
          details: { rule_id: superseded.id },
        });
      }
      return true;
    });
    if (taken) announced.push({ vault_id: vault.id, rule_id: rule.id, name: vault.name });
  }
  if (announced.length === 0) return;
  const staff = await deskStaffIds();
  for (const entry of announced) sendTo(staff, { name: 'rule-in-force', data: entry });
}

function previousInForce(rules: readonly RuleRow[], taking: RuleRow): RuleRow | null {
  const inForce = rulesOfVault(rules, taking.vault_id).filter((rule) => rule.state === 'in_force');
  let chosen: RuleRow | null = null;
  for (const rule of inForce) {
    if (chosen === null || rule.effective_on > chosen.effective_on) chosen = rule;
  }
  return chosen;
}

/** Each scheduled run becomes due exactly once. */
async function makeRunsDue(at: Date): Promise<void> {
  const sweepRaw = await readMeta('rotation_sweep');
  const since = sweepRaw === null ? at : new Date(sweepRaw);
  const rotations = await query<RotationRow>('select * from rotations');
  for (const rotation of rotations) {
    for (const run of nextRuns(rotation, since, 50)) {
      if (run.at.getTime() > at.getTime()) break;
      const credential = await one<{ label: string }>('select label from credentials where id = $1', [
        rotation.credential_id,
      ]);
      if (credential === null) continue;
      await withAudit(async (client, write) => {
        const inserted = await client.query<{ id: string }>(
          `insert into turns (id, credential_id, rotation_id, kind, run_at, run_office_date, due_by, state)
           values ($1,$2,$3,'scheduled',$4,$5,$6,'due')
           on conflict (rotation_id, run_at) do nothing
           returning id`,
          [newId(), rotation.credential_id, rotation.id, run.at, run.office_date, dueByAfter(run.office_date)],
        );
        if (inserted.rows.length === 0) return;
        await write({
          actor: 'Lockset',
          action: 'rotation_due',
          subject: { kind: 'credential', id: rotation.credential_id, name: credential.label },
          details: { run_at: run.at.toISOString(), office_date: run.office_date },
        });
      });
    }
  }
  await writeMeta('rotation_sweep', at.toISOString());
}

/** A due turn becomes overdue at the office midnight after its due-by date. */
async function makeTurnsOverdue(at: Date): Promise<void> {
  const due = await query<TurnRow>("select * from turns where state = 'due'");
  for (const turn of due) {
    if (officeMidnight(overdueFrom(turn.due_by)).getTime() > at.getTime()) continue;
    const credential = await one<{ label: string }>('select label from credentials where id = $1', [
      turn.credential_id,
    ]);
    if (credential === null) continue;
    await withAudit(async (client, write) => {
      const updated = await client.query("update turns set state = 'overdue' where id = $1 and state = 'due'", [
        turn.id,
      ]);
      if ((updated.rowCount ?? 0) === 0) return;
      await write({
        actor: 'Lockset',
        action: 'rotation_overdue',
        subject: { kind: 'credential', id: turn.credential_id, name: credential.label },
        details: { turn_id: turn.id, due_by: turn.due_by },
      });
    });
  }
}

/** A review opens on the first office business day of each quarter. */
async function openQuarterReview(at: Date): Promise<void> {
  const today = officeDate(at);
  const { year, quarter } = quarterOf(today);
  const existing = await one<{ id: string }>('select id from reviews where year = $1 and quarter = $2', [
    year,
    quarter,
  ]);
  if (existing !== null) return;
  const openedOn = nthOfficeBusinessDayFrom(quarterFirstDay(year, quarter), 1);
  if (officeMidnight(openedOn).getTime() > at.getTime()) return;
  const overdue = nthOfficeBusinessDayFrom(openedOn, REVIEW_OVERDUE_BUSINESS_DAY);
  const reviewId = newId();
  const vaults = await allVaults();
  const people = (await loadPeople()).filter(
    (person) =>
      person.left_at === null && (person.role === 'staff_accountant' || person.role === 'outside_bookkeeper'),
  );
  const created = await withAudit(async (client, write) => {
    const inserted = await client.query<{ id: string }>(
      `insert into reviews (id, year, quarter, opened_on, overdue_from, status)
       values ($1,$2,$3,$4,$5,'open') on conflict (year, quarter) do nothing returning id`,
      [reviewId, year, quarter, openedOn, overdue],
    );
    if (inserted.rows.length === 0) return false;
    await write({
      actor: 'Lockset',
      action: 'review_open',
      subject: { kind: 'review', id: reviewId, name: `Q${quarter} ${year}` },
      details: { opened_on: openedOn },
    });
    for (const person of people) {
      const scopes = await scopeIds(person.id);
      for (const vault of vaults) {
        if (!scopes.includes(vault.id)) continue;
        await client.query(
          "insert into review_lines (id, review_id, person_id, vault_id, decision) values ($1,$2,$3,$4,'undecided')",
          [newId(), reviewId, person.id, vault.id],
        );
      }
    }
    return true;
  });
  if (created) sendTo(await deskStaffIds(), { name: 'review-opened', data: { review_id: reviewId } });
}

async function makeReviewOverdue(at: Date): Promise<void> {
  const review = await openReview();
  if (review === null || review.status !== 'open') return;
  if (officeMidnight(review.overdue_from).getTime() > at.getTime()) return;
  await withAudit(async (client, write) => {
    const updated = await client.query("update reviews set status = 'overdue' where id = $1 and status = 'open'", [
      review.id,
    ]);
    if ((updated.rowCount ?? 0) === 0) return;
    await write({
      actor: 'Lockset',
      action: 'review_overdue',
      subject: { kind: 'review', id: review.id, name: `Q${review.quarter} ${review.year}` },
      details: {},
    });
  });
  await announceReviewChange(review.id);
}

async function moveTermBoundaries(at: Date): Promise<void> {
  const people = (await loadPeople()).filter(
    (person) => person.role === 'outside_bookkeeper' && person.left_at === null,
  );
  for (const person of people) {
    const starts = termStartsAt(person);
    const ends = termEndsAt(person);
    if (starts !== null && !person.term_started && at.getTime() >= starts.getTime()) {
      if (person.keycloak_id !== null) await setUserEnabled(person.keycloak_id, true);
      await withAudit(async (client, write) => {
        await client.query('update people set term_started = true, keycloak_enabled = true where id = $1', [
          person.id,
        ]);
        await write({
          actor: 'Lockset',
          action: 'term_start',
          subject: { kind: 'person', id: person.id, name: person.full_name },
          details: { starts_on: person.term_starts_on },
        });
      });
      sendTo([person.id], {
        name: 'access-changed',
        data: { vault_ids: await visibleVaultIds(person, at), ended: [], cause: 'boundary' },
      });
    }
    if (ends !== null && at.getTime() >= ends.getTime()) {
      const vaults = await allVaults();
      const scopes = await scopeIds(person.id);
      const held = vaults.filter((vault) => scopes.includes(vault.id));
      const claimed = await query<{ id: string }>(
        'update people set left_at = $2 where id = $1 and left_at is null returning id',
        [person.id, at],
      );
      if (claimed.length === 0) continue;
      await withAudit(async (client, write) =>
        applyLeave(client, write, { person, vaults: held, actor: 'Lockset', at, cause: 'term_end' }),
      );
      await announceLeave(person);
      const review = await openReview();
      if (review !== null) await announceReviewChange(review.id);
    }
  }
}

/** A travel window opening or closing is a server-decided access boundary. */
async function moveTravelBoundaries(at: Date): Promise<void> {
  const people = (await loadPeople()).filter((person) => person.left_at === null);
  for (const person of people) {
    const windows = await travelWindows(person.id);
    for (const window of windows) {
      const open = at.getTime() >= window.starts_at.getTime() && at.getTime() < window.ends_at.getTime();
      const known = travelOpen.get(window.id);
      travelOpen.set(window.id, open);
      if (known === undefined || known === open) continue;
      sendTo([person.id], {
        name: 'access-changed',
        data: { vault_ids: await visibleVaultIds(person, at), ended: [], cause: 'boundary' },
      });
    }
  }
}

async function pushSessionEnds(at: Date): Promise<void> {
  const ended = await query<{ id: string; person_id: string }>(
    'update sessions set end_pushed = true where ends_at <= $1 and signed_out_at is null and end_pushed = false returning id, person_id',
    [at],
  );
  for (const session of ended) sendTo([session.person_id], { name: 'session-ended', data: {} });
}

export function startScheduler(): void {
  let lastBilling = 0;
  let lastCheck = 0;
  let lastSeedTry = 0;
  let busy = false;

  const tick = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    const at = now();
    try {
      await takeRulesIntoForce(at);
      await makeRunsDue(at);
      await makeTurnsOverdue(at);
      await openQuarterReview(at);
      await makeReviewOverdue(at);
      await moveTermBoundaries(at);
      await moveTravelBoundaries(at);
      await pushSessionEnds(at);
      if (Date.now() - lastBilling >= BILLING_RETRY_MS) {
        lastBilling = Date.now();
        await retryWaitingSeats();
      }
      if (Date.now() - lastCheck >= config.breachCheckSeconds * 1_000) {
        lastCheck = Date.now();
        await runBreachCheck();
      }
      if (!seedingComplete && Date.now() - lastSeedTry >= SEED_RETRY_MS) {
        lastSeedTry = Date.now();
        const users = await ensureSeededUsers();
        const seats = await ensureSeededSeats();
        seedingComplete = users && seats;
      }
    } catch {
      // A failed sweep is retried on the next tick.
    } finally {
      busy = false;
    }
  };

  void tick();
  setInterval(() => void tick(), TICK_MS);
}

export async function warmUp(): Promise<void> {
  const at = now();
  const people = await loadPeople();
  for (const person of people) {
    for (const window of await travelWindows(person.id)) {
      travelOpen.set(window.id, at.getTime() >= window.starts_at.getTime() && at.getTime() < window.ends_at.getTime());
    }
  }
  const users = await ensureSeededUsers().catch(() => false);
  const seats = await ensureSeededSeats().catch(() => false);
  seedingComplete = users && seats;
}
