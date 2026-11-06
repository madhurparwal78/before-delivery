// Seed data for an empty database: invented organisations, people, credentials, requests and rates.
import { randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { ORGANISATIONS, type CredentialType, type Role, type Setting } from "../shared/domain.js";
import { agencyDate } from "../shared/time.js";
import { addDays } from "./dates.js";
import { pool, rows } from "./db.js";
import { textPdf } from "./pdf.js";
import { putObject } from "./storage.js";

export const PASSCODE = "weave-demo-2026";

const HOUR = 3_600_000;
const MINUTE = 60_000;

const PEOPLE: { key: string; name: string; email: string; role: Role; org: string | null }[] = [
  { key: "rowan", name: "Rowan Ilsley", email: "rowan@fernhollow.test", role: "coordinator", org: null },
  { key: "priya", name: "Priya Castellanos", email: "priya@fernhollow.test", role: "coordinator", org: null },
  { key: "marguerite", name: "Marguerite Osei", email: "marguerite@fernhollow.test", role: "billing", org: null },
  { key: "joel", name: "Joel Haverty", email: "joel@birchmere.test", role: "requester", org: "birchmere-clinic" },
  { key: "anita", name: "Anita Ruiz", email: "anita@kestrelcourt.test", role: "requester", org: "kestrel-court" },
  { key: "tomasz", name: "Tomasz Wren", email: "tomasz@larchfield.test", role: "requester", org: "larchfield-schools" },
  { key: "bea", name: "Bea Lindqvist", email: "bea@consumers.test", role: "consumer", org: null },
  { key: "marcus", name: "Marcus Tull", email: "marcus@consumers.test", role: "consumer", org: null },
  { key: "dana", name: "Dana Okafor", email: "dana@interpreters.test", role: "interpreter", org: null },
  { key: "theo", name: "Theo Marchetti", email: "theo@interpreters.test", role: "interpreter", org: null },
  { key: "imani", name: "Imani Brooks", email: "imani@interpreters.test", role: "interpreter", org: null },
  { key: "lior", name: "Lior Feld", email: "lior@interpreters.test", role: "interpreter", org: null },
  { key: "sam", name: "Sam Whitlock", email: "sam@interpreters.test", role: "interpreter", org: null },
  { key: "callum", name: "Callum Reyes", email: "callum@interpreters.test", role: "interpreter", org: null },
  { key: "noor", name: "Noor Haddad", email: "noor@interpreters.test", role: "interpreter", org: null },
];

const CREDENTIALS: [string, CredentialType, string, number][] = [
  ["dana", "NIC", "N-40211", 400],
  ["dana", "SC:L", "L-1187", 400],
  ["theo", "NIC", "N-38870", 600],
  ["theo", "SC:L", "L-1203", 600],
  ["imani", "CDI", "C-5521", 700],
  ["lior", "EIPA-4.0", "E-7730", 300],
  ["sam", "NIC", "N-41902", 20],
  ["callum", "NIC", "N-39954", 500],
  ["callum", "SC:L", "L-1150", -2],
  ["noor", "NIC", "N-42617", 900],
];

const RATES: Record<Setting, number> = { medical: 8000, legal: 10500, education: 7000, community: 7500 };

interface SeedRequest {
  ref: number;
  org: string;
  setting: Setting;
  title: string;
  location: string;
  start: number;
  end: number;
  consumer: string;
  status: string;
  loggedAfter?: boolean;
  accepted: (string | null)[];
}

const REQUESTS: SeedRequest[] = [
  { ref: 1001, org: "birchmere-clinic", setting: "medical", title: "Cardiology follow-up", location: "14 Alder Row, Suite 2", start: 26 * 60, end: 27 * 60, consumer: "bea", status: "submitted", accepted: [null] },
  { ref: 1002, org: "kestrel-court", setting: "legal", title: "Arraignment, Courtroom 3B", location: "Kestrel County Courthouse", start: 30 * 60, end: 31 * 60 + 30, consumer: "marcus", status: "submitted", accepted: [null, null] },
  { ref: 1003, org: "larchfield-schools", setting: "education", title: "IEP annual review", location: "Larchfield Middle, Room 112", start: 44 * 60, end: 47 * 60, consumer: "marcus", status: "partially_staffed", accepted: ["lior", null] },
  { ref: 1004, org: "birchmere-clinic", setting: "community", title: "Diabetes support group", location: "Birchmere Library hall", start: 52 * 60, end: 53 * 60 + 30, consumer: "bea", status: "staffed", accepted: ["dana"] },
  { ref: 1005, org: "birchmere-clinic", setting: "medical", title: "Emergency department visit", location: "Birchmere Community Clinic, ED", start: -24 * 60, end: -23 * 60, consumer: "bea", status: "completed", loggedAfter: true, accepted: ["sam"] },
  { ref: 1006, org: "kestrel-court", setting: "legal", title: "Bench trial, day one", location: "Kestrel County Courthouse", start: 120 * 60, end: 123 * 60, consumer: "marcus", status: "submitted", accepted: [null, null] },
];

/** Inserts every seeded row; seeded files are marked pending and stored by `storePendingSeedFiles`. */
export async function seed(client: PoolClient): Promise<void> {
  // T: the seeding moment rounded down to the hour (agency offsets are whole hours); D: its agency date.
  const t = Math.floor(Date.now() / HOUR) * HOUR;
  const d = agencyDate(new Date(t));
  const at = (minutes: number): Date => new Date(t + minutes * MINUTE);

  for (const org of ORGANISATIONS) await client.query("INSERT INTO orgs (id, name) VALUES ($1, $2)", [org.id, org.name]);
  const id: Record<string, string> = {};
  for (const person of PEOPLE) {
    id[person.key] = randomUUID();
    await client.query("INSERT INTO users (id, name, email, role, org_id) VALUES ($1, $2, $3, $4, $5)", [
      id[person.key],
      person.name,
      person.email,
      person.role,
      person.org,
    ]);
  }
  for (const [who, type, number, days] of CREDENTIALS) {
    const credentialId = randomUUID();
    const filename = `${number.toLowerCase()}-scan.pdf`;
    await client.query(
      `INSERT INTO credentials (id, interpreter_id, type, number, expires_on, scan_filename, scan_content_type, scan_key, scan_pending)
       VALUES ($1, $2, $3, $4, $5, $6, 'application/pdf', $7, true)`,
      [credentialId, id[who], type, number, addDays(d, days), filename, `credentials/${id[who]}/${credentialId}/${filename}`],
    );
  }
  await client.query("INSERT INTO preferences (consumer_id, interpreter_id, kind, position) VALUES ($1, $2, 'preferred', 0), ($1, $3, 'blocked', 0)", [
    id.bea,
    id.dana,
    id.noor,
  ]);
  for (const [setting, cents] of Object.entries(RATES)) await client.query("INSERT INTO rates (setting, cents) VALUES ($1, $2)", [setting, cents]);

  for (const r of REQUESTS) {
    const requestId = randomUUID();
    await client.query(
      `INSERT INTO requests (id, ref_no, org_id, title, setting, location, start_at, end_at, consumer_id, status, logged_after)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [requestId, r.ref, r.org, r.title, r.setting, r.location, at(r.start), at(r.end), id[r.consumer], r.status, r.loggedAfter ?? false],
    );
    for (const [index, interpreter] of r.accepted.entries()) {
      const seatId = randomUUID();
      await client.query("INSERT INTO seats (id, request_id, position) VALUES ($1, $2, $3)", [seatId, requestId, index + 1]);
      if (!interpreter) continue;
      await client.query(
        `INSERT INTO offers (id, seat_id, interpreter_id, held_by, token, status, sent_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, 'accepted', $6, $7)`,
        [randomUUID(), seatId, id[interpreter], id.rowan, randomBytes(32).toString("base64url"), at(r.start - 7 * 24 * 60), at(r.start - 6 * 24 * 60)],
      );
      if (r.ref === 1005) {
        await client.query(
          `INSERT INTO timesheets (id, seat_id, interpreter_id, actual_start, actual_end, signature_name, billed_hundredths, status, submitted_at)
           VALUES ($1, $2, $3, $4, $5, 'Sam Whitlock', 200, 'submitted', $5)`,
          [randomUUID(), seatId, id[interpreter], at(-24 * 60), at(-22 * 60 - 40)],
        );
      }
    }
    if (r.ref === 1003) {
      const fileId = randomUUID();
      await client.query(
        `INSERT INTO prep_files (id, request_id, filename, size, content_type, object_key, object_pending)
         VALUES ($1, $2, 'fa-1003-agenda.pdf', $3, 'application/pdf', $4, true)`,
        [fileId, requestId, agendaPdf().length, `prep/${r.org}/${requestId}/${fileId}/fa-1003-agenda.pdf`],
      );
    }
  }
}

function agendaPdf(): Buffer {
  return textPdf("FA-1003 IEP annual review: agenda", [
    "Larchfield Middle, Room 112",
    "1. Welcome and introductions",
    "2. Present levels of performance",
    "3. Goals for the coming year",
    "4. Services, accommodations and placement",
    "5. Questions and signatures",
  ]);
}

/** Stores seeded scans and the seeded agenda that are not yet in MinIO; safe to repeat. */
export async function storePendingSeedFiles(): Promise<void> {
  const scans = await rows<{ id: string; scan_key: string; type: string; number: string; expires_on: string; name: string }>(
    pool,
    `SELECT c.id, c.scan_key, c.type, c.number, c.expires_on, u.name FROM credentials c JOIN users u ON u.id = c.interpreter_id
     WHERE c.scan_pending`,
  );
  for (const scan of scans) {
    await putObject(
      scan.scan_key,
      textPdf("Credential scan", [`Interpreter: ${scan.name}`, `Credential: ${scan.type}`, `Number: ${scan.number}`, `Valid through: ${scan.expires_on}`]),
      "application/pdf",
    );
    await pool.query("UPDATE credentials SET scan_pending = false WHERE id = $1", [scan.id]);
  }
  const preps = await rows<{ id: string; object_key: string }>(pool, "SELECT id, object_key FROM prep_files WHERE object_pending");
  for (const prep of preps) {
    await putObject(prep.object_key, agendaPdf(), "application/pdf");
    await pool.query("UPDATE prep_files SET object_pending = false WHERE id = $1", [prep.id]);
  }
}
