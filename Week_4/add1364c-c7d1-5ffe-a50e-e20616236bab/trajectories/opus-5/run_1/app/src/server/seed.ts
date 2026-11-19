import { now } from './clock.js';
import { inTransaction, one, query } from './db.js';
import {
  addOfficeDays,
  nthOfficeBusinessDayFrom,
  officeDate,
  officeDayOfWeek,
  officeMidnight,
  quarterFirstDay,
  quarterOf,
  type OfficeDate,
} from './officeTime.js';
import { newId, sealSecret } from './secretStore.js';
import { createUser, findUserId } from './services/keycloak.js';
import { REVIEW_OVERDUE_BUSINESS_DAY } from './domain/reviews.js';
import { bundleKeyFor } from './services/killbill.js';
import { requestSeat } from './domain/seats.js';
import type { Role } from './types.js';

const SEED_PASSWORD = 'KeysKept-2026';
const EMAIL_DOMAIN = 'brannocklyle.example';

type SeedPerson = {
  fullName: string;
  handle: string;
  role: Role;
  aliases: string[];
  vaults: string[] | 'all';
};

const PEOPLE: SeedPerson[] = [
  { fullName: 'Marta Lindqvist', handle: 'marta', role: 'office_manager', aliases: ['Marta'], vaults: 'all' },
  { fullName: 'Graham Brannock', handle: 'graham', role: 'managing_partner', aliases: ['Graham'], vaults: 'all' },
  {
    fullName: 'Deandra Okafor',
    handle: 'deandra',
    role: 'staff_accountant',
    aliases: ['Dee', 'Deandra'],
    vaults: ['Payroll', 'Banking', 'Vendor portals'],
  },
  {
    fullName: 'Desmond Okafor',
    handle: 'desmond',
    role: 'staff_accountant',
    aliases: ['Des', 'Desmond'],
    vaults: ['Vendor portals', 'Office'],
  },
  {
    fullName: 'Theo Vasquez',
    handle: 'theo',
    role: 'staff_accountant',
    aliases: ['Theo'],
    vaults: ['Banking', 'Hosting', 'Office'],
  },
  {
    fullName: 'Sam Whitfield',
    handle: 'sam',
    role: 'staff_accountant',
    aliases: ['Sam'],
    vaults: ['Hosting', 'Vendor portals'],
  },
  {
    fullName: 'Samantha Lyle',
    handle: 'samantha',
    role: 'staff_accountant',
    aliases: ['Sam', 'Samantha'],
    vaults: ['Payroll', 'Vendor portals'],
  },
  {
    fullName: 'Priya Raman',
    handle: 'priya',
    role: 'outside_bookkeeper',
    aliases: ['Priya'],
    vaults: ['Payroll', 'Banking'],
  },
];

const VAULTS: { name: string; offWhenTravelling: boolean; minLength: number }[] = [
  { name: 'Payroll', offWhenTravelling: true, minLength: 14 },
  { name: 'Banking', offWhenTravelling: true, minLength: 12 },
  { name: 'Hosting', offWhenTravelling: false, minLength: 12 },
  { name: 'Vendor portals', offWhenTravelling: false, minLength: 12 },
  { name: 'Office', offWhenTravelling: false, minLength: 10 },
];

const VENDORS: { name: string; domain: string }[] = [
  { name: 'Paystride Payroll', domain: 'paystride.example' },
  { name: 'First Prairie Bank', domain: 'firstprairie.example' },
  { name: 'Missouri Valley Credit Union', domain: 'mvcu.example' },
  { name: 'E-File Gateway', domain: 'efilegateway.example' },
  { name: 'Gridhaven Hosting', domain: 'gridhaven.example' },
  { name: 'Tallyroom Practice Suite', domain: 'tallyroom.example' },
  { name: 'Inkwell Printers', domain: 'inkwell.example' },
];

const LOGINS: {
  vault: string;
  vendor: string;
  label: string;
  username: string;
  secret: string;
  heldBy: string[];
}[] = [
  {
    vault: 'Payroll',
    vendor: 'Paystride Payroll',
    label: 'Payroll admin',
    username: 'payroll@brannocklyle.example',
    secret: 'Tw9-harbor-quill-58',
    heldBy: ['Deandra Okafor', 'Priya Raman'],
  },
  {
    vault: 'Banking',
    vendor: 'First Prairie Bank',
    label: 'Business portal',
    username: 'bl-treasury',
    secret: 'Prairie-wind-7731',
    heldBy: ['Deandra Okafor', 'Theo Vasquez'],
  },
  {
    vault: 'Banking',
    vendor: 'Missouri Valley Credit Union',
    label: 'Operating account',
    username: 'brannocklyle',
    secret: 'Ledger-oak-221',
    heldBy: ['Theo Vasquez'],
  },
  {
    vault: 'Banking',
    vendor: 'First Prairie Bank',
    label: 'Payroll funding',
    username: 'bl-payroll-fund',
    secret: 'Cornfield-tax-90',
    heldBy: ['Deandra Okafor', 'Priya Raman'],
  },
  {
    vault: 'Banking',
    vendor: 'Missouri Valley Credit Union',
    label: 'Card admin',
    username: 'bl-cards',
    secret: 'Silo-river-3344',
    heldBy: ['Theo Vasquez'],
  },
  {
    vault: 'Hosting',
    vendor: 'Gridhaven Hosting',
    label: 'Website host',
    username: 'webmaster@brannocklyle.example',
    secret: 'Gh-stack-plum-8812',
    heldBy: ['Sam Whitfield'],
  },
  {
    vault: 'Vendor portals',
    vendor: 'E-File Gateway',
    label: 'EFIN account',
    username: 'bl-efile',
    secret: 'Efile-maple-2020!',
    heldBy: ['Deandra Okafor', 'Samantha Lyle'],
  },
  {
    vault: 'Vendor portals',
    vendor: 'Tallyroom Practice Suite',
    label: 'Practice admin',
    username: 'marta.lindqvist',
    secret: 'Tally-room-door-41',
    heldBy: ['Marta Lindqvist'],
  },
  {
    vault: 'Office',
    vendor: 'Inkwell Printers',
    label: 'Front desk printer admin',
    username: 'admin',
    secret: 'password',
    heldBy: ['Desmond Okafor', 'Theo Vasquez'],
  },
];

function seedEmail(fullName: string): string {
  return `${fullName.toLowerCase().replace(/\s+/g, '.')}@${EMAIL_DOMAIN}`;
}

function nextNewYear(today: OfficeDate): OfficeDate {
  return `${Number(today.slice(0, 4)) + 1}-01-01`;
}

/** The first nth-weekday-of-month strictly after the given office date. */
function nextNthWeekday(today: OfficeDate, month: number, weekday: number, nth: number): OfficeDate {
  for (let year = Number(today.slice(0, 4)); year <= Number(today.slice(0, 4)) + 2; year += 1) {
    let seen = 0;
    for (let day = 1; day <= 31; day += 1) {
      const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (Number(date.slice(8, 10)) !== day) break;
      if (officeDayOfWeek(date) !== weekday) continue;
      seen += 1;
      if (seen === nth && date > today) return date;
    }
  }
  throw new Error('No such day in the office calendar.');
}

export async function seedIfEmpty(): Promise<void> {
  const seeded = await one<{ value: string }>("select value from meta where key = 'seeded'");
  if (seeded !== null) return;
  const at = now();
  const today = officeDate(at);

  await inTransaction(async (client) => {
    const vaultIds = new Map<string, string>();
    for (const [index, vault] of VAULTS.entries()) {
      const id = newId();
      vaultIds.set(vault.name, id);
      await client.query('insert into vaults (id, name, off_when_travelling, drawer_order) values ($1,$2,$3,$4)', [
        id,
        vault.name,
        vault.offWhenTravelling,
        index + 1,
      ]);
    }

    const personIds = new Map<string, string>();
    for (const person of PEOPLE) {
      const id = newId();
      personIds.set(person.fullName, id);
      const isBookkeeper = person.role === 'outside_bookkeeper';
      await client.query(
        `insert into people (id, full_name, email, handle, role, aliases, has_signed_in, term_starts_on,
                             term_ends_on, term_started, seat, seat_bundle_key)
         values ($1,$2,$3,$4,$5,$6,true,$7,$8,$9,'waiting_on_billing',$10)`,
        [
          id,
          person.fullName,
          seedEmail(person.fullName),
          person.handle,
          person.role,
          person.aliases,
          isBookkeeper ? addOfficeDays(today, -30) : null,
          isBookkeeper ? addOfficeDays(today, 60) : null,
          isBookkeeper,
          bundleKeyFor(person.handle),
        ],
      );
      const held = person.vaults === 'all' ? VAULTS.map((vault) => vault.name) : person.vaults;
      for (const name of held) {
        await client.query('insert into person_vaults (person_id, vault_id) values ($1,$2)', [
          id,
          vaultIds.get(name),
        ]);
      }
    }
    const marta = personIds.get('Marta Lindqvist') as string;
    const graham = personIds.get('Graham Brannock') as string;
    const addRule = async (
      vaultName: string,
      minLength: number,
      effectiveOn: OfficeDate,
      state: 'in_force' | 'superseded' | 'scheduled',
    ): Promise<void> => {
      await client.query(
        `insert into rules (id, vault_id, min_length, effective_on, state, version, drafted_by, signed_by, took_force_at)
         values ($1,$2,$3,$4,$5,2,$6,$7,$8)`,
        [
          newId(),
          vaultIds.get(vaultName),
          minLength,
          effectiveOn,
          state,
          marta,
          graham,
          state === 'scheduled' ? null : officeMidnight(effectiveOn),
        ],
      );
    };
    await addRule('Payroll', 14, '2025-01-01', 'in_force');
    await addRule('Banking', 12, '2025-01-01', 'in_force');
    await addRule('Hosting', 12, '2025-01-01', 'in_force');
    await addRule('Vendor portals', 12, '2025-01-01', 'in_force');
    await addRule('Office', 8, '2025-01-01', 'superseded');
    await addRule('Office', 10, addOfficeDays(today, -20), 'in_force');
    await addRule('Banking', 16, nextNewYear(today), 'scheduled');

    const vendorIds = new Map<string, string>();
    for (const vendor of VENDORS) {
      const id = newId();
      vendorIds.set(vendor.name, id);
      await client.query('insert into vendors (id, name, domain) values ($1,$2,$3)', [id, vendor.name, vendor.domain]);
    }

    const credentialIds = new Map<string, string>();
    for (const login of LOGINS) {
      const id = newId();
      credentialIds.set(login.label, id);
      await client.query(
        `insert into credentials (id, vault_id, vendor_id, label, username, secret_cipher, secret_length,
                                  last_turned_on, secret_set_on)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
        [
          id,
          vaultIds.get(login.vault),
          vendorIds.get(login.vendor),
          login.label,
          login.username,
          sealSecret(login.secret),
          login.secret.length,
          addOfficeDays(today, -40),
        ],
      );
      for (const holder of login.heldBy) {
        await client.query('insert into credential_holders (credential_id, person_id) values ($1,$2)', [
          id,
          personIds.get(holder),
        ]);
      }
    }

    const addRotation = async (
      label: string,
      intervalDays: number,
      atTime: string,
      firstRunOn: OfficeDate,
    ): Promise<void> => {
      await client.query(
        'insert into rotations (id, credential_id, interval_days, at_time, first_run_on) values ($1,$2,$3,$4,$5)',
        [newId(), credentialIds.get(label), intervalDays, atTime, firstRunOn],
      );
    };
    await addRotation('Business portal', 90, '02:30', nextNthWeekday(today, 3, 0, 2));
    await addRotation('Website host', 28, '01:30', nextNthWeekday(today, 11, 0, 1));
    await addRotation('Payroll admin', 30, '09:00', addOfficeDays(today, 3));

    for (const [label, dueBy, state] of [
      ['Operating account', addOfficeDays(today, -7), 'overdue'],
      ['Card admin', today, 'due'],
    ] as const) {
      await client.query(
        `insert into turns (id, credential_id, rotation_id, kind, run_at, run_office_date, due_by, state)
         values ($1,$2,null,'scope_loss',null,null,$3,$4)`,
        [newId(), credentialIds.get(label), dueBy, state],
      );
    }

    const { year, quarter } = quarterOf(today);
    const openedOn = nthOfficeBusinessDayFrom(quarterFirstDay(year, quarter), 1);
    const overdueFrom = nthOfficeBusinessDayFrom(openedOn, REVIEW_OVERDUE_BUSINESS_DAY);
    const reviewId = newId();
    await client.query(
      `insert into reviews (id, year, quarter, opened_on, overdue_from, status) values ($1,$2,$3,$4,$5,$6)`,
      [reviewId, year, quarter, openedOn, overdueFrom, today >= overdueFrom ? 'overdue' : 'open'],
    );
    for (const person of PEOPLE) {
      if (person.role !== 'staff_accountant' && person.role !== 'outside_bookkeeper') continue;
      const held = person.vaults === 'all' ? VAULTS.map((vault) => vault.name) : person.vaults;
      for (const vaultName of VAULTS.map((vault) => vault.name)) {
        if (!held.includes(vaultName)) continue;
        await client.query(
          "insert into review_lines (id, review_id, person_id, vault_id, decision) values ($1,$2,$3,$4,'undecided')",
          [newId(), reviewId, personIds.get(person.fullName), vaultIds.get(vaultName)],
        );
      }
    }

    await client.query("insert into meta (key, value) values ('seeded', $1)", [at.toISOString()]);
    await client.query("insert into meta (key, value) values ('rotation_sweep', $1)", [at.toISOString()]);
  });
}

/** Creates any seeded Keycloak user that is missing and leaves existing users unchanged. */
export async function ensureSeededUsers(): Promise<boolean> {
  const people = await query<{ id: string; handle: string; full_name: string; keycloak_id: string | null; keycloak_enabled: boolean }>(
    'select id, handle, full_name, keycloak_id, keycloak_enabled from people where keycloak_id is null',
  );
  let complete = true;
  for (const person of people) {
    try {
      const existing = await findUserId(person.handle);
      const userId =
        existing ??
        (await (async () => {
          const created = await createUser({
            handle: person.handle,
            fullName: person.full_name,
            password: SEED_PASSWORD,
            enabled: person.keycloak_enabled,
          });
          return created.kind === 'created' ? created.id : await findUserId(person.handle);
        })());
      if (userId === null) {
        complete = false;
        continue;
      }
      await query('update people set keycloak_id = $2 where id = $1', [person.id, userId]);
    } catch {
      complete = false;
    }
  }
  return complete;
}

/** Makes sure every seeded person holds a confirmed seat, writing no audit entries. */
export async function ensureSeededSeats(): Promise<boolean> {
  const people = await query<{ id: string; handle: string }>(
    "select id, handle from people where seat = 'waiting_on_billing' and seat_change is null and left_at is null",
  );
  let complete = true;
  for (const person of people) {
    const outcome = await requestSeat(person.handle, 0);
    if (outcome.confirmed) {
      await query("update people set seat = 'confirmed', seat_subscription_id = $2 where id = $1", [
        person.id,
        outcome.subscriptionId,
      ]);
    } else {
      complete = false;
    }
  }
  return complete;
}
