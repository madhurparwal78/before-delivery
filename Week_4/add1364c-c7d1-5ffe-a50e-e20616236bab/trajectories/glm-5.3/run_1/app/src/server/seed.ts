import type { Store } from './store.js';
import type { PoolClient } from 'pg';
import {
  addDays,
  isBusinessDay,
  nthWeekdayOfMonth,
  officeDateString,
  officeMidnightInstant,
  pad2
} from './officeTime.js';

interface SeedPerson {
  id: string;
  full_name: string;
  handle: string;
  email: string;
  role: string;
  aliases: string[];
  vaults: string[];
  term?: { starts_on: string; ends_on: string };
}

interface SeedVendor {
  id: string;
  name: string;
  domain: string;
}

interface SeedCredential {
  id: string;
  vault_id: string;
  vendor_id: string;
  label: string;
  username: string;
  secret: string;
  held_by: string[];
}

interface SeedRotation {
  credential_id: string;
  interval_days: number;
  at_time: string;
  first_run: (t: string) => string;
}

/**
 * Seed data for Brannock & Lyle, applied on the first start with an empty
 * database. `T` is the office date at that first start; the audit trail starts empty.
 */
export class Seeder {
  constructor(private readonly store: Store) {}

  async seedIfEmpty(): Promise<boolean> {
    const existing = await this.store.pool.query('SELECT id FROM people LIMIT 1');
    if (existing.rows.length > 0) return false;
    await this.store.transaction(async (client) => {
      await this.seedAll(client);
    });
    return true;
  }

  private async seedAll(client: PoolClient): Promise<void> {
    const now = this.store.clock.now();
    const T = officeDateString(now);
    const officeKey = this.store.settings.officeKey;

    // vaults, in drawer order
    const vaults = [
      { id: 'v-payroll', name: 'Payroll', formerly: null, off: true, position: 1 },
      { id: 'v-banking', name: 'Banking', formerly: null, off: true, position: 2 },
      { id: 'v-hosting', name: 'Hosting', formerly: null, off: false, position: 3 },
      { id: 'v-vendors', name: 'Vendor portals', formerly: null, off: false, position: 4 },
      { id: 'v-office', name: 'Office', formerly: null, off: false, position: 5 }
    ];
    for (const vault of vaults) {
      await client.query(
        'INSERT INTO vaults (id, name, formerly, off_when_travelling, position, created_seq) VALUES ($1,$2,$3,$4,$5,$6)',
        [vault.id, vault.name, vault.formerly, vault.off, vault.position, 1]
      );
    }

    // rules
    const marta = 'p-marta';
    const graham = 'p-graham';
    const rules: Array<{ id: string; vault: string; min: number; on: string; state: string; signed: boolean }> = [
      { id: 'r-payroll', vault: 'v-payroll', min: 14, on: '2025-01-01', state: 'in_force', signed: true },
      { id: 'r-banking-1', vault: 'v-banking', min: 12, on: '2025-01-01', state: 'in_force', signed: true },
      { id: 'r-hosting', vault: 'v-hosting', min: 12, on: '2025-01-01', state: 'in_force', signed: true },
      { id: 'r-vendors', vault: 'v-vendors', min: 12, on: '2025-01-01', state: 'in_force', signed: true },
      { id: 'r-office-1', vault: 'v-office', min: 8, on: '2025-01-01', state: 'superseded', signed: true },
      { id: 'r-office-2', vault: 'v-office', min: 10, on: addDays(T, -20), state: 'in_force', signed: true }
    ];
    const nextJan1 = `${Number(T.slice(0, 4)) + 1}-01-01`;
    rules.push({ id: 'r-banking-2', vault: 'v-banking', min: 16, on: nextJan1, state: 'scheduled', signed: true });
    for (const rule of rules) {
      await client.query(
        `INSERT INTO rules (id, vault_id, min_length, effective_on, state, version, drafted_by, signed_by, created_seq, state_changed_at)
         VALUES ($1,$2,$3,$4,$5,2,$6,$7,1,$8)`,
        [rule.id, rule.vault, rule.min, rule.on, rule.state, marta, rule.signed ? graham : null, now]
      );
    }

    // people
    const people: SeedPerson[] = [
      { id: 'p-marta', full_name: 'Marta Lindqvist', handle: 'marta', email: 'marta.lindqvist@brannocklyle.example', role: 'office_manager', aliases: ['Marta'], vaults: vaults.map((v) => v.id) },
      { id: 'p-graham', full_name: 'Graham Brannock', handle: 'graham', email: 'graham.brannock@brannocklyle.example', role: 'managing_partner', aliases: ['Graham'], vaults: vaults.map((v) => v.id) },
      { id: 'p-deandra', full_name: 'Deandra Okafor', handle: 'deandra', email: 'deandra.okafor@brannocklyle.example', role: 'staff_accountant', aliases: ['Dee', 'Deandra'], vaults: ['v-payroll', 'v-banking', 'v-vendors'] },
      { id: 'p-desmond', full_name: 'Desmond Okafor', handle: 'desmond', email: 'desmond.okafor@brannocklyle.example', role: 'staff_accountant', aliases: ['Des', 'Desmond'], vaults: ['v-vendors', 'v-office'] },
      { id: 'p-theo', full_name: 'Theo Vasquez', handle: 'theo', email: 'theo.vasquez@brannocklyle.example', role: 'staff_accountant', aliases: ['Theo'], vaults: ['v-banking', 'v-hosting', 'v-office'] },
      { id: 'p-sam', full_name: 'Sam Whitfield', handle: 'sam', email: 'sam.whitfield@brannocklyle.example', role: 'staff_accountant', aliases: ['Sam'], vaults: ['v-hosting', 'v-vendors'] },
      { id: 'p-samantha', full_name: 'Samantha Lyle', handle: 'samantha', email: 'samantha.lyle@brannocklyle.example', role: 'staff_accountant', aliases: ['Sam', 'Samantha'], vaults: ['v-payroll', 'v-vendors'] },
      { id: 'p-priya', full_name: 'Priya Raman', handle: 'priya', email: 'priya.raman@brannocklyle.example', role: 'outside_bookkeeper', aliases: ['Priya'], vaults: ['v-payroll', 'v-banking'], term: { starts_on: addDays(T, -30), ends_on: addDays(T, 60) } }
    ];
    let seq = 2;
    for (const person of people) {
      await client.query(
        `INSERT INTO people (id, full_name, email, handle, role, status, aliases, term_starts_on, term_ends_on, first_signed_in_at, created_seq)
         VALUES ($1,$2,$3,$4,$5,'active',$6,$7,$8,$9,$10)`,
        [
          person.id,
          person.full_name,
          person.email,
          person.handle,
          person.role,
          person.aliases,
          person.term?.starts_on ?? null,
          person.term?.ends_on ?? null,
          now,
          seq
        ]
      );
      seq += 1;
      for (const vaultId of person.vaults) {
        await client.query('INSERT INTO vault_scopes (person_id, vault_id) VALUES ($1,$2)', [person.id, vaultId]);
      }
    }

    // vendors
    const vendors: SeedVendor[] = [
      { id: 'vd-paystride', name: 'Paystride Payroll', domain: 'paystride.example' },
      { id: 'vd-firstprairie', name: 'First Prairie Bank', domain: 'firstprairie.example' },
      { id: 'vd-mvcu', name: 'Missouri Valley Credit Union', domain: 'mvcu.example' },
      { id: 'vd-efile', name: 'E-File Gateway', domain: 'efilegateway.example' },
      { id: 'vd-gridhaven', name: 'Gridhaven Hosting', domain: 'gridhaven.example' },
      { id: 'vd-tallyroom', name: 'Tallyroom Practice Suite', domain: 'tallyroom.example' },
      { id: 'vd-inkwell', name: 'Inkwell Printers', domain: 'inkwell.example' }
    ];
    for (const vendor of vendors) {
      await client.query('INSERT INTO vendors (id, name, domain, created_seq) VALUES ($1,$2,$3,1)', [
        vendor.id,
        vendor.name,
        vendor.domain
      ]);
    }

    // credentials
    const credentials: SeedCredential[] = [
      { id: 'c-payroll-admin', vault_id: 'v-payroll', vendor_id: 'vd-paystride', label: 'Payroll admin', username: 'payroll@brannocklyle.example', secret: 'Tw9-harbor-quill-58', held_by: ['p-deandra', 'p-priya'] },
      { id: 'c-business-portal', vault_id: 'v-banking', vendor_id: 'vd-firstprairie', label: 'Business portal', username: 'bl-treasury', secret: 'Prairie-wind-7731', held_by: ['p-deandra', 'p-theo'] },
      { id: 'c-operating', vault_id: 'v-banking', vendor_id: 'vd-mvcu', label: 'Operating account', username: 'brannocklyle', secret: 'Ledger-oak-221', held_by: ['p-theo'] },
      { id: 'c-payroll-funding', vault_id: 'v-banking', vendor_id: 'vd-firstprairie', label: 'Payroll funding', username: 'bl-payroll-fund', secret: 'Cornfield-tax-90', held_by: ['p-deandra', 'p-priya'] },
      { id: 'c-card-admin', vault_id: 'v-banking', vendor_id: 'vd-mvcu', label: 'Card admin', username: 'bl-cards', secret: 'Silo-river-3344', held_by: ['p-theo'] },
      { id: 'c-website-host', vault_id: 'v-hosting', vendor_id: 'vd-gridhaven', label: 'Website host', username: 'webmaster@brannocklyle.example', secret: 'Gh-stack-plum-8812', held_by: ['p-sam'] },
      { id: 'c-efin', vault_id: 'v-vendors', vendor_id: 'vd-efile', label: 'EFIN account', username: 'bl-efile', secret: 'Efile-maple-2020!', held_by: ['p-deandra', 'p-samantha'] },
      { id: 'c-practice-admin', vault_id: 'v-vendors', vendor_id: 'vd-tallyroom', label: 'Practice admin', username: 'marta.lindqvist', secret: 'Tally-room-door-41', held_by: ['p-marta'] },
      { id: 'c-printer-admin', vault_id: 'v-office', vendor_id: 'vd-inkwell', label: 'Front desk printer admin', username: 'admin', secret: 'password', held_by: ['p-desmond', 'p-theo'] }
    ];
    for (const credential of credentials) {
      const secretBox = this.store.secrets.encrypt(credential.secret);
      await client.query(
        `INSERT INTO credentials (id, vault_id, vendor_id, label, username, secret_enc, secret_fingerprint, last_turned_on, created_seq)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1)`,
        [
          credential.id,
          credential.vault_id,
          credential.vendor_id,
          credential.label,
          credential.username,
          secretBox,
          this.store.secrets.fingerprint(credential.secret),
          addDays(T, -40)
        ]
      );
      for (const personId of credential.held_by) {
        await client.query('INSERT INTO credential_holders (credential_id, person_id, holder_left) VALUES ($1,$2,false)', [
          credential.id,
          personId
        ]);
      }
    }

    // The printer admin's secret is out of policy since the Office rule took force (T-20).
    await client.query('UPDATE credentials SET out_of_policy_since = $2 WHERE id = $1', [
      'c-printer-admin',
      addDays(T, -20)
    ]);

    // rotations
    const firstMarchSpring = this.firstSpringForwardAfter(T);
    const firstNovFallBack = this.firstFallBackAfter(T);
    const rotations: SeedRotation[] = [
      { credential_id: 'c-business-portal', interval_days: 90, at_time: '02:30', first_run: () => firstMarchSpring },
      { credential_id: 'c-website-host', interval_days: 28, at_time: '01:30', first_run: () => firstNovFallBack },
      { credential_id: 'c-payroll-admin', interval_days: 30, at_time: '09:00', first_run: () => addDays(T, 3) }
    ];
    for (const rotation of rotations) {
      await client.query(
        'INSERT INTO rotations (id, credential_id, interval_days, at_time, first_run_on, created_seq) VALUES ($1,$2,$3,$4,$5,1)',
        [randomRotationId(), rotation.credential_id, rotation.interval_days, rotation.at_time, rotation.first_run(T)]
      );
    }

    // open scope-loss turns (exempt from the two-business-day computation)
    const openTurns = [
      { credential_id: 'c-operating', due_by: addDays(T, -7), state: 'overdue' },
      { credential_id: 'c-card-admin', due_by: T, state: 'due' }
    ];
    for (const turn of openTurns) {
      await client.query(
        `INSERT INTO turns (id, credential_id, rotation_id, kind, due_by, at, state, shifted, became_due_at, confirmed_by, created_seq, office_date, office_time, offset_abbrev)
         VALUES ($1,$2,NULL,'scope_loss',$3,NULL,$4,false,$5,NULL,1,$3,'00:00',$6)`,
        [randomTurnId(), turn.credential_id, turn.due_by, turn.state, now, 'CST']
      );
    }

    // the review for the quarter containing T, opened on that quarter's first office business day
    const quarterStart = `${T.slice(0, 4)}-${pad2((Math.floor((Number(T.slice(5, 7)) - 1) / 3)) * 3 + 1)}-01`;
    const openedOn = firstBusinessDayOnOrAfter(quarterStart);
    const overdueFrom = nBusinessDaysAfter(openedOn, 10);
    const reviewId = 'rev-current';
    await client.query(
      'INSERT INTO reviews (id, quarter, opened_on, overdue_from, status) VALUES ($1,$2,$3,$4,$5)',
      [reviewId, quarterLabel(quarterStart), openedOn, overdueFrom, now >= officeMidnightOf(overdueFrom) ? 'overdue' : 'open']
    );
    let linePosition = 1;
    for (const person of people) {
      if (person.role !== 'staff_accountant' && person.role !== 'outside_bookkeeper') continue;
      for (const vaultId of person.vaults) {
        await client.query(
          'INSERT INTO review_lines (id, review_id, person_id, vault_id, decision, decided_by, decided_via, position) VALUES ($1,$2,$3,$4,\'undecided\',NULL,NULL,$5)',
          [randomLineId(), reviewId, person.id, vaultId, linePosition]
        );
        linePosition += 1;
      }
    }

    // seats: every seeded person holds a confirmed seat
    for (const person of people) {
      await client.query(
        `INSERT INTO seat_changes (id, person_id, change, state, since, confirmed_at)
         VALUES ($1,$2,'add','confirmed',$3,$3)`,
        [randomSeatId(), person.id, now]
      );
    }

    void officeKey;
  }

  /** After seeding, create each seeded person's Kill Bill seat subscription. */
  async ensureSeededSeats(): Promise<void> {
    const accountId = await this.store.killbill.ensureAccount();
    if (!accountId) return;
    const people = await this.store.pool.query("SELECT handle, full_name FROM people WHERE status <> 'left' ORDER BY created_seq");
    for (const person of people.rows) {
      const handle = String(person.handle);
      const existing = await this.store.pool.query(
        "SELECT id FROM seat_changes WHERE person_id = $1 AND state = 'confirmed' AND kb_subscription_id IS NOT NULL",
        [String(person.id)]
      );
      void existing;
      const created = await this.store.killbill.createSeat(accountId, handle);
      if (created === null || created === 'unreachable') continue;
      const deadline = Date.now() + 5000;
      let subscriptionId: string | null = null;
      while (Date.now() < deadline) {
        const sub = await this.store.killbill.subscription(created.subscriptionId);
        if (sub && sub.state === 'ACTIVE' && sub.chargedThroughDate) {
          subscriptionId = sub.subscriptionId;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (subscriptionId) {
        await this.store.pool.query(
          "UPDATE seat_changes SET kb_subscription_id = $2 WHERE person_id = $1 AND state = 'confirmed' AND change = 'add'",
          [String(person.id), subscriptionId]
        );
      }
    }
  }

  /** The first second Sunday of March after `T` (a spring-forward night). */
  firstSpringForwardAfter(T: string): string {
    const year = Number(T.slice(0, 4));
    const candidate = nthWeekdayOfMonth(year, 3, 0, 2);
    if (candidate > T) return candidate;
    return nthWeekdayOfMonth(year + 1, 3, 0, 2);
  }

  /** The first first Sunday of November after `T` (a fall-back night). */
  firstFallBackAfter(T: string): string {
    const year = Number(T.slice(0, 4));
    const candidate = nthWeekdayOfMonth(year, 11, 0, 1);
    if (candidate > T) return candidate;
    return nthWeekdayOfMonth(year + 1, 11, 0, 1);
  }
}

function randomRotationId(): string {
  return `rot-${randomHex(8)}`;
}

function randomTurnId(): string {
  return `t-${randomHex(8)}`;
}

function randomLineId(): string {
  return `rl-${randomHex(8)}`;
}

function randomSeatId(): string {
  return `sc-${randomHex(8)}`;
}

function randomHex(n: number): string {
  let out = '';
  const chars = '0123456789abcdef';
  for (let i = 0; i < n; i++) out += chars[Math.floor(Math.random() * 16)];
  return out;
}

function officeMidnightOf(dateStr: string): Date {
  return officeMidnightInstant(dateStr);
}

function firstBusinessDayOnOrAfter(dateStr: string): string {
  let cursor = dateStr;
  while (!isBusinessDay(cursor)) {
    cursor = addDays(cursor, 1);
  }
  return cursor;
}

function nBusinessDaysAfter(dateStr: string, n: number): string {
  let cursor = dateStr;
  let found = 0;
  while (found < n) {
    cursor = addDays(cursor, 1);
    if (isBusinessDay(cursor)) found += 1;
  }
  return cursor;
}

function quarterLabel(quarterStart: string): string {
  const year = quarterStart.slice(0, 4);
  const month = Number(quarterStart.slice(5, 7));
  return `Q${Math.floor((month - 1) / 3) + 1} ${year}`;
}
