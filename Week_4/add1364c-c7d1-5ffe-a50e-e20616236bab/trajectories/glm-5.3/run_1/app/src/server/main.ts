import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { loadSettings } from './config.js';
import { Store } from './store.js';
import { Seeder } from './seed.js';
import { buildRoutes, dispatch } from './apiRoutes.js';
import { ApiError, notFound, writeError } from './errors.js';
import { addDays, isBusinessDay, officeDateString, officeMidnightInstant } from './officeTime.js';
import { rotationRunInstant } from './handlersRotations.js';

const settings = loadSettings();
const store = new Store(settings);
const routes = buildRoutes(store);
const seeder = new Seeder(store);

const DIST = new URL('./client/', import.meta.url).pathname;
const ASSETS = new URL('./client/assets/', import.meta.url).pathname;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

function serveFile(res: ServerResponse, path: string): void {
  try {
    const data = readFileSync(path);
    const type = MIME[extname(path)] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    writeError(res, notFound());
  }
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  void handleRequest(req, res);
});

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname;
    if (pathname.startsWith('/api/')) {
      await dispatch(store, routes, req, res);
      return;
    }
    // Only built client assets are served: assets/ and fonts/ inside the built client.
    if (pathname.startsWith('/assets/') || pathname.startsWith('/fonts/')) {
      const relative = pathname.replace(/^\//, '');
      if (relative.includes('..')) {
        writeError(res, notFound());
        return;
      }
      serveFile(res, join(DIST, relative));
      return;
    }
    if (pathname === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }
    // The single-page app: index.html for the client routes in the route table.
    if (isClientRoute(pathname)) {
      serveFile(res, join(DIST, 'index.html'));
      return;
    }
    writeError(res, notFound());
  } catch (error) {
    console.error('request error', error instanceof Error ? error.message : String(error));
    if (!res.headersSent) {
      writeError(res, new ApiError(500, 'internal', 'Something went wrong. Try again.'));
    } else {
      res.end();
    }
  }
}

/** The client routes the single-page app answers. */
function isClientRoute(pathname: string): boolean {
  if (pathname === '/' || pathname === '/sign-in') return true;
  if (pathname === '/desk' || pathname.startsWith('/desk/vaults/')) return true;
  const simple = ['/rotations', '/reviews', '/people', '/travel', '/billing', '/health', '/import', '/audit'];
  return simple.includes(pathname);
}

async function main(): Promise<void> {
  await store.ready();
  const seeded = await seeder.seedIfEmpty();
  if (seeded) {
    console.log('seeded first-start data');
  }
  // A first start with Kill Bill reachable confirms each seeded person's seat;
  // with Kill Bill down the waiting-seat retry picks them up without a restart.
  void seeder.ensureSeededSeats().catch(() => undefined);
  // ensure Keycloak users exist for seeded people; retries while Keycloak is down
  void ensureSeededKeycloakUsers();
  void store.killbill.ensureCatalog().then((ok) => {
    if (ok) return store.killbill.ensureAccount();
    return null;
  });
  void store.runBreachCheckNow().catch(() => undefined);
  startBackgroundJobs();
  server.listen(settings.port, '0.0.0.0', () => {
    console.log(`lockset listening on ${settings.port}`);
  });
}

/** Create any seeded Keycloak user that is missing; leave existing users unchanged. */
async function ensureSeededKeycloakUsers(): Promise<void> {
  const people = await store.pool.query("SELECT * FROM people WHERE status <> 'left' ORDER BY created_seq");
  for (const row of people.rows) {
    const username = `${settings.officeKey}.${String(row.handle)}`;
    const existing = await store.keycloak.findUser(username);
    if (existing) continue;
    const words = String(row.full_name).split(/\s+/);
    const firstName = words[0] ?? String(row.full_name);
    const lastName = words.length > 1 ? words.slice(1).join(' ') : firstName;
    const created = await store.keycloak.createUser(
      username,
      firstName,
      lastName,
      `${settings.officeKey}.${String(row.handle)}@people.lockset.example`,
      'KeysKept-2026'
    );
    if ('unreachable' in created) {
      scheduleKeycloakSeedRetry();
      return;
    }
    if (row.role === 'outside_bookkeeper' && row.term_starts_on) {
      const start = officeMidnightInstant(String(row.term_starts_on).slice(0, 10));
      if (start.getTime() > store.clock.now().getTime()) {
        await store.keycloak.setEnabled(username, false);
      }
    }
  }
}

let keycloakRetryScheduled = false;
function scheduleKeycloakSeedRetry(): void {
  if (keycloakRetryScheduled) return;
  keycloakRetryScheduled = true;
  setTimeout(() => {
    keycloakRetryScheduled = false;
    void ensureSeededKeycloakUsers();
  }, 30000);
}

/**
 * Background jobs: midnight rule transitions with pushes, rotation runs becoming
 * due, turns becoming overdue, session ends with pushes, billing retries, and
 * the scheduled breach checks. All time decisions use the server clock.
 */
function startBackgroundJobs(): void {
  setInterval(() => {
    void tick().catch((error) => console.error('tick error', error instanceof Error ? error.message : String(error)));
  }, 1000).unref();
}


async function tick(): Promise<void> {
  const now = store.clock.now();
  const today = officeDateString(now);
  await applyMidnightRules(now, today);
  await openReviews(today);
  await makeRotationRunsDue(now, today);
  await makeTurnsOverdue(now, today);
  await endSessionsAndPush(now);
  await retryWaitingSeats();
  await scheduledBreachCheck(now);
}

async function applyMidnightRules(now: Date, today: string): Promise<void> {
  const scheduled = await store.pool.query(
    "SELECT * FROM rules WHERE state = 'scheduled' AND effective_on <= $1",
    [today]
  );
  const midnight = officeMidnightInstant(today);
  for (const rule of scheduled.rows) {
    if (now.getTime() < midnight.getTime()) continue;
    const vaultRow = await store.pool.query('SELECT name FROM vaults WHERE id = $1', [String(rule.vault_id)]);
    const vaultName = vaultRow.rows.length > 0 ? String(vaultRow.rows[0].name) : '';
    let tookForce = false;
    await store.transaction(async (client) => {
      // supersede the vault's previous in-force rule
      const previous = await client.query(
        "SELECT id FROM rules WHERE vault_id = $1 AND state = 'in_force' AND id <> $2",
        [String(rule.vault_id), String(rule.id)]
      );
      const drafts: Array<{ action: string; subject: { kind: string; id: string; name: string } }> = [];
      for (const prev of previous.rows) {
        await client.query("UPDATE rules SET state = 'superseded' WHERE id = $1", [String(prev.id)]);
        drafts.push({ action: 'rule_superseded', subject: { kind: 'vault', id: String(rule.vault_id), name: vaultName } });
      }
      const updated = await client.query(
        "UPDATE rules SET state = 'in_force', state_changed_at = $2 WHERE id = $1 AND state = 'scheduled' RETURNING id",
        [String(rule.id), now]
      );
      if (updated.rows.length === 0) return;
      tookForce = true;
      drafts.push({ action: 'rule_in_force', subject: { kind: 'vault', id: String(rule.vault_id), name: vaultName } });
      await store.writeAudit(client, { system: 'Lockset' }, drafts);
    });
    if (!tookForce) continue;
    // one event per vault, in drawer order, within five seconds of the midnight
    await pushRuleInForce(String(rule.vault_id), String(rule.id), vaultName);
  }
}

async function pushRuleInForce(vaultId: string, ruleId: string, name: string): Promise<void> {
  const rows = await store.pool.query("SELECT id FROM people WHERE role IN ('office_manager','managing_partner') AND status <> 'left' ORDER BY created_seq");
  const vault = await store.pool.query('SELECT position FROM vaults WHERE id = $1', [vaultId]);
  const order = await store.pool.query("SELECT id FROM vaults ORDER BY position");
  const index = order.rows.findIndex((row) => String(row.id) === vaultId);
  const delay = Math.max(0, index) * 250;
  setTimeout(() => {
    for (const row of rows.rows) {
      store.events.send(String(row.id), 'rule-in-force', { vault_id: vaultId, rule_id: ruleId, name });
    }
  }, delay);
  void vault;
}

async function openReviews(today: string): Promise<void> {
  const quarterStart = `${today.slice(0, 4)}-${String(Math.floor((Number(today.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
  const existing = await store.pool.query('SELECT id FROM reviews WHERE quarter = $1', [
    `Q${Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1} ${today.slice(0, 4)}`
  ]);
  if (existing.rows.length === 0 && today === firstBusinessDay(quarterStart)) {
    await openQuarterReview(quarterStart, today);
  }
  const overdue = await store.pool.query(
    "SELECT * FROM reviews WHERE status = 'open' AND overdue_from <= $1",
    [today]
  );
  for (const review of overdue.rows) {
    await store.transaction(async (client) => {
      const updated = await client.query(
        "UPDATE reviews SET status = 'overdue' WHERE id = $1 AND status = 'open' RETURNING id",
        [String(review.id)]
      );
      if (updated.rows.length === 0) return;
      await store.writeAudit(client, { system: 'Lockset' }, [
        { action: 'review_overdue', subject: { kind: 'review', id: String(review.id), name: String(review.quarter) } }
      ]);
    });
    void notifyReviewOpened(String(review.id));
  }
}

function firstBusinessDay(dateStr: string): string {
  let cursor = dateStr;
  while (!isBusinessDay(cursor)) cursor = addDays(cursor, 1);
  return cursor;
}

async function openQuarterReview(quarterStart: string, today: string): Promise<void> {
  const { isBusinessDay, addDays, quarterOfDate, pad2 } = await import('./officeTime.js');
  let overdueCursor = quarterStart;
  let found = 0;
  while (found < 10) {
    overdueCursor = addDays(overdueCursor, 1);
    if (isBusinessDay(overdueCursor)) found += 1;
  }
  const quarter = quarterOfDate(quarterStart);
  const id = `rev-${quarterStart}`;
  await store.transaction(async (client) => {
    const existing = await client.query('SELECT id FROM reviews WHERE id = $1', [id]);
    if (existing.rows.length > 0) return;
    await client.query('INSERT INTO reviews (id, quarter, opened_on, overdue_from, status) VALUES ($1,$2,$3,$4,$5)', [
      id,
      quarter,
      quarterStart,
      overdueCursor,
      'open'
    ]);
    const people = await client.query(
      "SELECT * FROM people WHERE role IN ('staff_accountant','outside_bookkeeper') AND status <> 'left' ORDER BY created_seq"
    );
    const vaults = await client.query('SELECT * FROM vaults ORDER BY position');
    const drafts: Array<{ action: string; subject: { kind: string; id: string; name: string } }> = [
      { action: 'review_open', subject: { kind: 'review', id, name: quarter } }
    ];
    for (const person of people.rows) {
      const scopes = await client.query('SELECT vault_id FROM vault_scopes WHERE person_id = $1', [String(person.id)]);
      const scopeSet = new Set(scopes.rows.map((row) => String(row.vault_id)));
      let position = 1;
      for (const vault of vaults.rows) {
        if (!scopeSet.has(String(vault.id))) continue;
        await client.query(
          "INSERT INTO review_lines (id, review_id, person_id, vault_id, decision, decided_by, decided_via, position) VALUES ($1,$2,$3,$4,'undecided',NULL,NULL,$5)",
          [`rl-${quarterStart}-${String(person.id)}-${String(vault.id)}`, id, String(person.id), String(vault.id), position]
        );
        position += 1;
        drafts.push({ action: 'review_line_added', subject: { kind: 'person', id: String(person.id), name: String(person.full_name) } });
      }
    }
    await store.writeAudit(client, { system: 'Lockset' }, drafts);
  });
  void notifyReviewOpened(id);
  void pad2;
  void today;
}

function notifyReviewOpened(reviewId: string): Promise<void> {
  return store.pool
    .query("SELECT id FROM people WHERE role IN ('office_manager','managing_partner') AND status <> 'left'")
    .then((rows) => {
      for (const row of rows.rows) {
        store.events.send(String(row.id), 'review-opened', { review_id: reviewId });
      }
    });
}

/** A scheduled run becomes due at its instant, exactly once, and writes one rotation_due entry. */
async function makeRotationRunsDue(now: Date, today: string): Promise<void> {
  const rotations = await store.pool.query('SELECT * FROM rotations');
  const { addDays, secondBusinessDayAfter, offsetAbbreviation: offsetAbbr } = await import('./officeTime.js');
  for (const rotation of rotations.rows) {
    const firstRunOn = String(rotation.first_run_on).slice(0, 10);
    const interval = Number(rotation.interval_days);
    const atTime = String(rotation.at_time);
    let cursor = firstRunOn;
    for (let guard = 0; guard < 5000; guard++) {
      const { at, shifted } = rotationRunInstant(cursor, atTime);
      if (at.getTime() > now.getTime()) break;
      const dueBy = secondBusinessDayAfter(cursor);
      const existing = await store.pool.query(
        'SELECT id FROM turns WHERE rotation_id = $1 AND office_date = $2 AND state <> $3',
        [String(rotation.id), cursor, 'turned']
      );
      if (existing.rows.length === 0) {
        await store.transaction(async (client) => {
          const inserted = await client.query(
            `INSERT INTO turns (id, credential_id, rotation_id, kind, due_by, at, state, shifted, became_due_at, confirmed_by, created_seq, office_date, office_time, offset_abbrev)
             VALUES ($1,$2,$3,'scheduled',$4,$5,'due',$6,$7,NULL,nextval('row_seq_seq'::regclass),$8,$9,$10)
             ON CONFLICT DO NOTHING
             RETURNING id`,
            [`${String(rotation.id)}-${cursor}`, String(rotation.credential_id), String(rotation.id), dueBy, at, shifted, now, cursor, atTime, offsetAbbr(at)]
          );
          if (inserted.rows.length === 0) return;
          const label = await client.query('SELECT label FROM credentials WHERE id = $1', [String(rotation.credential_id)]);
          await store.writeAudit(client, { system: 'Lockset' }, [
            { action: 'rotation_due', subject: { kind: 'credential', id: String(rotation.credential_id), name: String(label.rows[0]?.label ?? '') } }
          ]);
        });
      }
      cursor = addDays(cursor, interval);
    }
  }
  void today;
}

/** A due turn becomes overdue at the office midnight after its due_by. */
async function makeTurnsOverdue(now: Date, today: string): Promise<void> {
  const due = await store.pool.query("SELECT * FROM turns WHERE state = 'due' AND due_by < $1", [today]);
  for (const turn of due.rows) {
    const midnightAfter = officeMidnightInstant(String(turn.due_by).slice(0, 10));
    // overdue at the office midnight after its due_by: the next midnight strictly after due_by's day
    const nextMidnight = new Date(midnightAfter.getTime() + 24 * 3600 * 1000);
    if (now.getTime() < nextMidnight.getTime()) continue;
    await store.transaction(async (client) => {
      const updated = await client.query(
        "UPDATE turns SET state = 'overdue' WHERE id = $1 AND state = 'due' RETURNING id",
        [String(turn.id)]
      );
      if (updated.rows.length === 0) return;
      const label = await client.query('SELECT label FROM credentials WHERE id = $1', [String(turn.credential_id)]);
      await store.writeAudit(client, { system: 'Lockset' }, [
        { action: 'rotation_overdue', subject: { kind: 'credential', id: String(turn.credential_id), name: String(label.rows[0]?.label ?? '') } }
      ]);
    });
  }
}

/** End sessions at their time limit and send session-ended within five seconds. */
async function endSessionsAndPush(now: Date): Promise<void> {
  const expired = await store.pool.query(
    'SELECT s.*, p.role FROM sessions s JOIN people p ON p.id = s.person_id WHERE s.ended_reason IS NULL AND s.ends_at <= $1',
    [now]
  );
  for (const session of expired.rows) {
    await store.transaction(async (client) => {
      await client.query("UPDATE sessions SET ended_reason = 'time_limit' WHERE id = $1", [String(session.id)]);
    });
    store.events.send(String(session.person_id), 'session-ended', {});
  }
  // travel windows and term boundaries: push access-changed with cause boundary
  await pushBoundaryChanges(now);
}

async function pushBoundaryChanges(now: Date): Promise<void> {
  const travellers = await store.pool.query(
    "SELECT * FROM people WHERE status <> 'left' AND role IN ('staff_accountant','outside_bookkeeper')"
  );
  for (const person of travellers.rows) {
    const travels = await store.pool.query(
      'SELECT * FROM travel_windows WHERE person_id = $1 AND starts_at <= $2 AND ends_at > $2',
      [String(person.id), now]
    );
    if (travels.rows.length > 0) {
      store.events.send(String(person.id), 'access-changed', { vault_ids: [], ended: [], cause: 'boundary' });
    }
  }
  // engagement term ends: record the person as left, with the actor Lockset
  const bookkeepers = await store.pool.query(
    "SELECT * FROM people WHERE role = 'outside_bookkeeper' AND status <> 'left' AND term_ends_on IS NOT NULL"
  );
  for (const person of bookkeepers.rows) {
    const termEnd = officeMidnightInstant(String(person.term_ends_on).slice(0, 10));
    const endInstant = new Date(termEnd.getTime() + 23 * 3600 * 1000 + 59 * 60 * 1000);
    if (now.getTime() < endInstant.getTime()) continue;
    await endTerm(store, String(person.id));
  }
}

async function endTerm(store: Store, personId: string): Promise<void> {
  const person = await store.pool.query('SELECT * FROM people WHERE id = $1', [personId]);
  if (person.rows.length === 0) return;
  const row = person.rows[0];
  if (String(row.status) === 'left') return;
  await store.keycloak.setEnabled(`${store.settings.officeKey}.${String(row.handle)}`, false).catch(() => undefined);
  await store.keycloak.endSessions(`${store.settings.officeKey}.${String(row.handle)}`).catch(() => undefined);
  const now = store.clock.now();
  await store.transaction(async (client) => {
    const updated = await client.query(
      "UPDATE people SET status = 'left', left_at = $2 WHERE id = $1 AND status <> 'left' RETURNING id",
      [personId, now]
    );
    if (updated.rows.length === 0) return;
    const scopes = await client.query('SELECT vault_id FROM vault_scopes WHERE person_id = $1', [personId]);
    const dropped = scopes.rows.map((r) => String(r.vault_id));
    await client.query('DELETE FROM vault_scopes WHERE person_id = $1', [personId]);
    await client.query('UPDATE credential_holders SET holder_left = true WHERE person_id = $1', [personId]);
    const { closePersonSessions, applyScopeLoss } = await import('./domain/scopeChanges.js');
    await closePersonSessions(client, personId);
    const turnsDue = await applyScopeLoss(
      store,
      client,
      { personId, personName: String(row.full_name), vaultIds: dropped, confirmedBy: null, cause: 'term' },
      { system: 'Lockset' }
    );
    await store.writeAudit(client, { system: 'Lockset' }, [
      { action: 'term_end', subject: { kind: 'person', id: personId, name: String(row.full_name) }, details: { turns_due: turnsDue.length } }
    ]);
    await client.query("UPDATE seat_changes SET state = 'release_waiting' WHERE person_id = $1 AND state = 'confirmed' AND change = 'add'", [personId]);
  });
  // request the seat release; retried by the waiting-seat job when Kill Bill is unreachable
  const subscription = await store.pool.query(
    "SELECT kb_subscription_id FROM seat_changes WHERE person_id = $1 AND change = 'add' ORDER BY since DESC",
    [personId]
  );
  if (subscription.rows.length > 0 && subscription.rows[0].kb_subscription_id) {
    const cancelled = await store.killbill.cancelSeat(String(subscription.rows[0].kb_subscription_id));
    if (cancelled !== 'unreachable' && cancelled !== null) {
      await store.transaction(async (client) => {
        await client.query("UPDATE seat_changes SET state = 'confirmed', confirmed_at = $2 WHERE person_id = $1 AND state = 'release_waiting'", [personId, now]);
        await store.writeAudit(client, { system: 'Lockset' }, [
          { action: 'seat_released', subject: { kind: 'person', id: personId, name: String(row.full_name) } }
        ]);
      });
    }
  }
  store.events.send(personId, 'access-changed', { vault_ids: [], ended: [], cause: 'boundary' });
  void notifySeatReleased(personId, String(row.full_name));
}

function notifySeatReleased(personId: string, name: string): Promise<void> {
  return store.pool
    .query("SELECT id FROM people WHERE role IN ('office_manager','managing_partner') AND status <> 'left'")
    .then((rows) => {
      for (const r of rows.rows) {
        store.events.send(String(r.id), 'seat-confirmed', { person_id: personId, name, change: 'release' });
        store.events.send(String(r.id), 'billing-changed', {});
      }
    });
}

/** Re-check every waiting seat change every 2 seconds without a restart. */
let seatRetryBusy = false;
async function retryWaitingSeats(): Promise<void> {
  if (seatRetryBusy) return;
  seatRetryBusy = true;
  try {
    const waiting = await store.pool.query("SELECT * FROM seat_changes WHERE state = 'waiting'");
    const waitingRelease = await store.pool.query("SELECT * FROM seat_changes WHERE state = 'release_waiting'");
    const accountId = await store.killbill.ensureAccount();
    if (!accountId) return;
    for (const row of waiting.rows) {
      const person = await store.pool.query('SELECT handle, full_name FROM people WHERE id = $1', [String(row.person_id)]);
      if (person.rows.length === 0) continue;
      const bundleKey = `${settings.officeKey}-seat-${String(person.rows[0].handle)}`;
      // a retry first looks up the bundle by its external key and never creates a second subscription
      const bundle = await store.killbill.officeSubscriptions(accountId);
      if (bundle === null) continue;
      const found = bundle.find((sub) => sub.bundleExternalKey === bundleKey && sub.state === 'ACTIVE' && sub.chargedThroughDate);
      if (!found) continue;
      await store.transaction(async (client) => {
        await client.query(
          "UPDATE seat_changes SET state = 'confirmed', kb_subscription_id = $3, confirmed_at = $2 WHERE id = $1",
          [String(row.id), store.clock.now(), found.subscriptionId]
        );
        await store.writeAudit(client, { system: 'Lockset' }, [
          { action: 'seat_confirmed', subject: { kind: 'person', id: String(row.person_id), name: String(person.rows[0].full_name) } }
        ]);
      });
      void notifySeatConfirmedJob(String(row.person_id), String(person.rows[0].full_name), 'add');
    }
    for (const row of waitingRelease.rows) {
      if (!row.kb_subscription_id) continue;
      const sub = await store.killbill.subscription(String(row.kb_subscription_id));
      if (!sub) continue;
      const confirmed = sub.state === 'CANCELLED' && sub.billingEndDate === sub.chargedThroughDate;
      if (!confirmed) {
        const cancelled = await store.killbill.cancelSeat(String(row.kb_subscription_id));
        if (cancelled === null || cancelled === 'unreachable') continue;
      }
      const fresh = await store.killbill.subscription(String(row.kb_subscription_id));
      if (!fresh || fresh.state !== 'CANCELLED' || fresh.billingEndDate !== fresh.chargedThroughDate) continue;
      const person = await store.pool.query('SELECT full_name FROM people WHERE id = $1', [String(row.person_id)]);
      await store.transaction(async (client) => {
        await client.query(
          "UPDATE seat_changes SET state = 'confirmed', confirmed_at = $2 WHERE id = $1",
          [String(row.id), store.clock.now()]
        );
        await store.writeAudit(client, { system: 'Lockset' }, [
          { action: 'seat_released', subject: { kind: 'person', id: String(row.person_id), name: String(person.rows[0]?.full_name ?? '') } }
        ]);
      });
      void notifySeatConfirmedJob(String(row.person_id), String(person.rows[0]?.full_name ?? ''), 'release');
    }
  } finally {
    seatRetryBusy = false;
  }
}

function notifySeatConfirmedJob(personId: string, name: string, change: 'add' | 'release'): Promise<void> {
  return store.pool
    .query("SELECT id FROM people WHERE role IN ('office_manager','managing_partner') AND status <> 'left'")
    .then((rows) => {
      for (const row of rows.rows) {
        store.events.send(String(row.id), 'seat-confirmed', { person_id: personId, name, change });
        store.events.send(String(row.id), 'billing-changed', {});
      }
    });
}

/** The scheduled breach check, which shares one run with any overlapping check. */
let lastBreachCheckAt = 0;
async function scheduledBreachCheck(now: Date): Promise<void> {
  if (now.getTime() - lastBreachCheckAt < settings.breachCheckSeconds * 1000) return;
  lastBreachCheckAt = now.getTime();
  void store.runBreachCheckNow().catch(() => undefined);
}

void existsSync;

main().catch((error) => {
  console.error('failed to start', error);
  process.exit(1);
});
