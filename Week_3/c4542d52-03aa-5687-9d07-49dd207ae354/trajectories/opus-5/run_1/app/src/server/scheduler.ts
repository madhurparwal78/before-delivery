import { db, isRegisterReady } from "./db.js";
import { serverDate } from "./domain/dates.js";
import { cumulativeAt, markOn } from "./domain/vesting.js";
import { grantAudience, personAudience } from "./flows/audiences.js";
import { emitCapTable, writeLedgerEntry } from "./flows/ledger.js";
import { expireOffer } from "./flows/offers.js";
import { closeAndAllocate } from "./flows/tenderClose.js";
import { writeWithEvents, type Emit } from "./live/events.js";
import { buildGrant, grantContext, GRANT_COLUMNS, type GrantRow } from "./model/grants.js";
import { loadPerson, type PersonRow } from "./model/people.js";
import { TENDER_COLUMNS, type TenderRow } from "./model/tenders.js";
import type { Transaction } from "./db.js";

const TICK_MS = 250;

async function expireOffers(now: Date): Promise<void> {
  const rows = await db.query<GrantRow>(
    `select ${GRANT_COLUMNS} from grants where state = 'offered' and offer_expires_at <= $1`,
    [now],
  );
  for (const row of rows) {
    await writeWithEvents(async (tx, emit) => {
      const current = await tx.queryOne<GrantRow>(
        `select ${GRANT_COLUMNS} from grants where id = $1 and state = 'offered' for update`,
        [row.id],
      );
      if (current === null) return;
      await expireOffer(tx, emit, current);
    });
  }
}

async function warnOffers(now: Date): Promise<void> {
  const rows = await db.query<GrantRow>(
    `select ${GRANT_COLUMNS} from grants
      where state = 'offered' and warning_sent = false and offer_warning_at <= $1`,
    [now],
  );
  for (const row of rows) {
    await writeWithEvents(async (tx, emit) => {
      const updated = await tx.query<{ id: string }>(
        "update grants set warning_sent = true where id = $1 and warning_sent = false returning id",
        [row.id],
      );
      if (updated.length === 0) return;
      await emit(
        "offer_warning",
        {
          grant_id: row.id,
          offer_expires_at: row.offer_expires_at === null ? null : row.offer_expires_at.toISOString(),
        },
        grantAudience(row.holder_id),
      );
    });
  }
}

async function vestTranches(now: Date): Promise<void> {
  const today = serverDate(now);
  const state = await db.queryOne<{ value: string }>("select value from register_state where key = 'last_vesting_date'");
  if (state === null) {
    await db.query("insert into register_state (key, value) values ('last_vesting_date', $1)", [today]);
    return;
  }
  if (state.value === today) return;
  const previous = state.value;
  const rows = await db.query<GrantRow>(`select ${GRANT_COLUMNS} from grants where state = 'accepted'`);
  await writeWithEvents(async (tx, emit) => {
    await tx.query("update register_state set value = $1 where key = 'last_vesting_date'", [today]);
    for (const row of rows) {
      if (row.options === null || row.vesting_type === null || row.vesting_start === null) continue;
      const before = cumulativeAt(row.options, row.vesting_type, markOn(row.vesting_start, previous));
      const after = cumulativeAt(row.options, row.vesting_type, markOn(row.vesting_start, today));
      if (after <= before) continue;
      await emit(
        "tranche_vested",
        { grant_id: row.id, options_vested: after - before, vested: after },
        grantAudience(row.holder_id),
      );
    }
  });
}

async function leaverWarnings(now: Date): Promise<void> {
  const people = await db.query<PersonRow>(
    "select * from people where role = 'leaver' and window_closed = false and window_ends_at is not null",
  );
  for (const person of people) {
    const passed = person.warnings_at.filter((at) => at.getTime() <= now.getTime());
    if (passed.length <= person.warnings_sent) continue;
    const windowEnds = person.window_ends_at;
    const latest = passed[passed.length - 1];
    if (windowEnds === null || latest === undefined) continue;
    await writeWithEvents(async (tx, emit) => {
      const updated = await tx.query<{ id: string }>(
        "update people set warnings_sent = $2 where id = $1 and warnings_sent = $3 returning id",
        [person.id, passed.length, person.warnings_sent],
      );
      if (updated.length === 0) return;
      const grants = await tx.query<GrantRow>(
        `select ${GRANT_COLUMNS} from grants where holder_id = $1 and state = 'accepted' order by seq`,
        [person.id],
      );
      for (const grant of grants) {
        await emit(
          "window_warning",
          {
            grant_id: grant.id,
            warning_seconds: Math.round((windowEnds.getTime() - latest.getTime()) / 1000),
            window_ends_at: windowEnds.toISOString(),
          },
          personAudience(person.id),
        );
      }
    });
  }
}

async function closeWindows(now: Date): Promise<void> {
  const people = await db.query<PersonRow>(
    "select * from people where role = 'leaver' and window_closed = false and window_ends_at <= $1",
    [now],
  );
  for (const person of people) {
    await writeWithEvents(async (tx, emit) => {
      const updated = await tx.query<{ id: string }>(
        "update people set window_closed = true where id = $1 and window_closed = false returning id",
        [person.id],
      );
      if (updated.length === 0) return;
      await cancelRemaining(tx, emit, person, now);
    });
  }
}

async function cancelRemaining(tx: Transaction, emit: Emit, person: PersonRow, now: Date): Promise<void> {
  const rows = await tx.query<GrantRow>(
    `select ${GRANT_COLUMNS} from grants where holder_id = $1 and state = 'accepted' for update`,
    [person.id],
  );
  const refreshed = await loadPerson(tx, person.id);
  const context = await grantContext(tx, now);
  if (refreshed !== null) context.people.set(refreshed.id, refreshed);
  for (const row of rows) {
    const grant = buildGrant(row, context);
    const cancelled = grant.exercisable;
    if (cancelled > 0) {
      await tx.query("update grants set cancelled = cancelled + $2 where id = $1", [row.id, cancelled]);
      await writeLedgerEntry(tx, {
        at: now,
        holderId: person.id,
        kind: "options_cancelled",
        optionsDelta: -cancelled,
        reference: row.id,
      });
    }
    await emit("window_closed", { grant_id: row.id, cancelled }, personAudience(person.id));
  }
  await emitCapTable(emit);
}

async function closeTenders(now: Date): Promise<void> {
  const rows = await db.query<TenderRow>(
    `select ${TENDER_COLUMNS} from tenders where state = 'open' and closes_at <= $1`,
    [now],
  );
  for (const row of rows) {
    await writeWithEvents(async (tx, emit) => {
      const current = await tx.queryOne<TenderRow>(
        `select ${TENDER_COLUMNS} from tenders where id = $1 and state = 'open' for update`,
        [row.id],
      );
      if (current === null) return;
      await closeAndAllocate(tx, emit, current, now);
    });
  }
}

let running = false;

async function tick(): Promise<void> {
  if (running || !isRegisterReady()) return;
  running = true;
  const now = new Date();
  try {
    await expireOffers(now);
    await warnOffers(now);
    await vestTranches(now);
    await leaverWarnings(now);
    await closeWindows(now);
    await closeTenders(now);
  } catch (error) {
    process.stderr.write(`scheduler tick failed: ${String(error)}\n`);
  } finally {
    running = false;
  }
}

/** Every timed change on the register is decided here, on the server clock. */
export function startScheduler(): void {
  setInterval(() => void tick(), TICK_MS);
}
