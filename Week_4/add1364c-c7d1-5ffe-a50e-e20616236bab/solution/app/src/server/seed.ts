import { db, write, type Tx } from "./db.js";
import { now } from "./clock.js";
import { newId, seal, secretLength } from "./crypto.js";
import { KeycloakUnavailable, createUser, findUserId } from "./keycloak.js";
import { addDays, officeDate } from "./office-time.js";
import { openReviewFor } from "./reviews.js";
import type { Role } from "./model.js";

const SEED_PASSWORD = "KeysKept-2026";
const EMAIL_DOMAIN = "brannocklyle.example";

interface SeedPerson {
  name: string;
  handle: string;
  email: string;
  role: Role;
  aliases: string[];
  vaults: string[] | "all";
}

const SEED_PEOPLE: SeedPerson[] = [
  { name: "Marta Lindqvist", handle: "marta", email: "marta.lindqvist", role: "office_manager", aliases: ["Marta"], vaults: "all" },
  { name: "Graham Brannock", handle: "graham", email: "graham.brannock", role: "managing_partner", aliases: ["Graham"], vaults: "all" },
  { name: "Deandra Okafor", handle: "deandra", email: "deandra.okafor", role: "staff_accountant", aliases: ["Dee", "Deandra"], vaults: ["Payroll", "Banking", "Vendor portals"] },
  { name: "Desmond Okafor", handle: "desmond", email: "desmond.okafor", role: "staff_accountant", aliases: ["Des", "Desmond"], vaults: ["Vendor portals", "Office"] },
  { name: "Theo Vasquez", handle: "theo", email: "theo.vasquez", role: "staff_accountant", aliases: ["Theo"], vaults: ["Banking", "Hosting", "Office"] },
  { name: "Sam Whitfield", handle: "sam", email: "sam.whitfield", role: "staff_accountant", aliases: ["Sam"], vaults: ["Hosting", "Vendor portals"] },
  { name: "Samantha Lyle", handle: "samantha", email: "samantha.lyle", role: "staff_accountant", aliases: ["Sam", "Samantha"], vaults: ["Payroll", "Vendor portals"] },
  { name: "Priya Raman", handle: "priya", email: "priya.raman", role: "outside_bookkeeper", aliases: ["Priya"], vaults: ["Payroll", "Banking"] },
];

const VAULTS: Array<{ name: string; off: boolean; min: number }> = [
  { name: "Payroll", off: true, min: 14 },
  { name: "Banking", off: true, min: 12 },
  { name: "Hosting", off: false, min: 12 },
  { name: "Vendor portals", off: false, min: 12 },
  { name: "Office", off: false, min: 10 },
];

const VENDORS: Array<[string, string]> = [
  ["Paystride Payroll", "paystride.example"],
  ["First Prairie Bank", "firstprairie.example"],
  ["Missouri Valley Credit Union", "mvcu.example"],
  ["E-File Gateway", "efilegateway.example"],
  ["Gridhaven Hosting", "gridhaven.example"],
  ["Tallyroom Practice Suite", "tallyroom.example"],
  ["Inkwell Printers", "inkwell.example"],
];

const LOGINS: Array<{ vault: string; vendor: string; label: string; username: string; secret: string; holders: string[] }> = [
  { vault: "Payroll", vendor: "Paystride Payroll", label: "Payroll admin", username: "payroll@brannocklyle.example", secret: "Tw9-harbor-quill-58", holders: ["deandra", "priya"] },
  { vault: "Banking", vendor: "First Prairie Bank", label: "Business portal", username: "bl-treasury", secret: "Prairie-wind-7731", holders: ["deandra", "theo"] },
  { vault: "Banking", vendor: "Missouri Valley Credit Union", label: "Operating account", username: "brannocklyle", secret: "Ledger-oak-221", holders: ["theo"] },
  { vault: "Banking", vendor: "First Prairie Bank", label: "Payroll funding", username: "bl-payroll-fund", secret: "Cornfield-tax-90", holders: ["deandra", "priya"] },
  { vault: "Banking", vendor: "Missouri Valley Credit Union", label: "Card admin", username: "bl-cards", secret: "Silo-river-3344", holders: ["theo"] },
  { vault: "Hosting", vendor: "Gridhaven Hosting", label: "Website host", username: "webmaster@brannocklyle.example", secret: "Gh-stack-plum-8812", holders: ["sam"] },
  { vault: "Vendor portals", vendor: "E-File Gateway", label: "EFIN account", username: "bl-efile", secret: "Efile-maple-2020!", holders: ["deandra", "samantha"] },
  { vault: "Vendor portals", vendor: "Tallyroom Practice Suite", label: "Practice admin", username: "marta.lindqvist", secret: "Tally-room-door-41", holders: ["marta"] },
  { vault: "Office", vendor: "Inkwell Printers", label: "Front desk printer admin", username: "admin", secret: "password", holders: ["desmond", "theo"] },
];

/** The nth Sunday (1-based) of a month. */
function nthSunday(year: number, month: number, nth: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const day = 1 + ((7 - first) % 7) + (nth - 1) * 7;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function firstSundayAfter(today: string, month: number, nth: number): string {
  const year = Number(today.slice(0, 4));
  for (const candidate of [nthSunday(year, month, nth), nthSunday(year + 1, month, nth)]) {
    if (candidate > today) return candidate;
  }
  throw new Error("no Sunday found");
}

async function seedRecords(tx: Tx): Promise<void> {
  const at = now();
  const today = officeDate(at);
  const ids = new Map<string, string>();
  const idOf = (key: string): string => {
    const found = ids.get(key);
    if (!found) throw new Error(`unknown seed key ${key}`);
    return found;
  };
  for (const vault of VAULTS) {
    const id = newId();
    ids.set(`vault:${vault.name}`, id);
    await tx.query("INSERT INTO vaults (id, name, off_when_travelling, created_at) VALUES ($1,$2,$3,$4)", [id, vault.name, vault.off, at]);
  }
  const rule = async (vault: string, min: number, effective: string, state: string): Promise<void> => {
    await tx.query(
      `INSERT INTO rules (id, vault_id, min_length, effective_on, state, version, drafted_by, signed_by, created_at)
       VALUES ($1,$2,$3,$4,$5,2,'Marta Lindqvist','Graham Brannock',$6)`,
      [newId(), idOf(`vault:${vault}`), min, effective, state, at],
    );
  };
  for (const vault of VAULTS) {
    if (vault.name === "Office") {
      await rule("Office", 8, "2025-01-01", "superseded");
      await rule("Office", 10, addDays(today, -20), "in_force");
    } else await rule(vault.name, vault.min, "2025-01-01", "in_force");
  }
  await rule("Banking", 16, `${Number(today.slice(0, 4)) + 1}-01-01`, "scheduled");

  for (const [name, domain] of VENDORS) {
    const id = newId();
    ids.set(`vendor:${name}`, id);
    await tx.query("INSERT INTO vendors (id, name, domain, created_at) VALUES ($1,$2,$3,$4)", [id, name, domain, at]);
  }
  for (const person of SEED_PEOPLE) {
    const id = newId();
    ids.set(`person:${person.handle}`, id);
    const bookkeeper = person.role === "outside_bookkeeper";
    await tx.query(
      `INSERT INTO people (id, full_name, email, handle, role, aliases, first_sign_in_at, term_starts_on, term_ends_on, term_started,
         seat, seat_since, seat_silent, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'waiting_on_billing',$7,true,$7)`,
      [
        id,
        person.name,
        `${person.email}@${EMAIL_DOMAIN}`,
        person.handle,
        person.role,
        person.aliases,
        at,
        bookkeeper ? addDays(today, -30) : null,
        bookkeeper ? addDays(today, 60) : null,
        bookkeeper,
      ],
    );
    if (person.vaults !== "all") {
      for (const vault of person.vaults) {
        await tx.query("INSERT INTO person_vaults (person_id, vault_id) VALUES ($1,$2)", [id, idOf(`vault:${vault}`)]);
      }
    }
  }
  for (const login of LOGINS) {
    const id = newId();
    ids.set(`login:${login.label}`, id);
    await tx.query(
      `INSERT INTO credentials (id, vault_id, vendor_id, label, username, secret_sealed, secret_length, last_turned_on, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, idOf(`vault:${login.vault}`), idOf(`vendor:${login.vendor}`), login.label, login.username, seal(login.secret), secretLength(login.secret), addDays(today, -40), at],
    );
    for (const holder of login.holders) {
      await tx.query("INSERT INTO holders (credential_id, person_id) VALUES ($1,$2)", [id, idOf(`person:${holder}`)]);
    }
  }
  const turn = async (label: string, dueBy: string, state: string): Promise<void> => {
    await tx.query("INSERT INTO turns (id, credential_id, kind, due_by, state, created_at) VALUES ($1,$2,'scope_loss',$3,$4,$5)", [
      newId(),
      idOf(`login:${label}`),
      dueBy,
      state,
      at,
    ]);
  };
  await turn("Operating account", addDays(today, -7), "overdue");
  await turn("Card admin", today, "due");
  const rotation = async (label: string, days: number, time: string, first: string): Promise<void> => {
    await tx.query(
      "INSERT INTO rotations (id, credential_id, interval_days, at_time, first_run_on, since, created_at) VALUES ($1,$2,$3,$4,$5,$6,$6)",
      [newId(), idOf(`login:${label}`), days, time, first, at],
    );
  };
  await rotation("Business portal", 90, "02:30", firstSundayAfter(today, 3, 2));
  await rotation("Website host", 28, "01:30", firstSundayAfter(today, 11, 1));
  await rotation("Payroll admin", 30, "09:00", addDays(today, 3));
  await openReviewFor(tx, today, false);
  await tx.query("INSERT INTO meta (key, value) VALUES ('seeded', 'yes')");
}

/** On the first start with an empty database, files the seed records. Repeating it changes nothing. */
export async function seedIfEmpty(): Promise<void> {
  await write(async (tx) => {
    if (await tx.one("SELECT 1 FROM meta WHERE key = 'seeded'")) return;
    await seedRecords(tx);
  });
}

let usersDone = false;

/** Creates any seeded Keycloak user that is missing; existing users are left unchanged. Retried until Keycloak answers. */
export async function ensureSeedUsers(): Promise<void> {
  if (usersDone) return;
  try {
    for (const person of SEED_PEOPLE) {
      if (await findUserId(person.handle)) continue;
      const row = await db.one<{ term_starts_on: string | null }>("SELECT term_starts_on FROM people WHERE handle = $1", [person.handle]);
      if (!row) continue;
      const startsLater = row.term_starts_on !== null && row.term_starts_on > officeDate(now());
      await createUser({ handle: person.handle, fullName: person.name, password: SEED_PASSWORD, enabled: !startsLater });
    }
    usersDone = true;
  } catch (error) {
    if (!(error instanceof KeycloakUnavailable)) throw error;
  }
}
