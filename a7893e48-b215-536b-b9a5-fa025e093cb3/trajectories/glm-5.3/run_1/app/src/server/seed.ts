import crypto from "node:crypto";
import { pool, q } from "./db.js";
import { SCHEMA_SQL } from "./schema.js";
import { resolveWallTime, localDate } from "../shared/time.js";
import { putObject, ensureBucket } from "./s3.js";

export function hashPassword(password: string, salt: string): string {
  const h = crypto.scryptSync(password, salt, 32);
  return `scrypt$${h.toString("hex")}`;
}

export function verifyPassword(password: string, salt: string, stored: string): boolean {
  return hashPassword(password, salt) === stored;
}

export function uid(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(9).toString("base64url")}`;
}

export function token(bytes = 18): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

const OPERATORS: { id: string; name: string }[] = [
  { id: "op-ember", name: "Ember Row Kitchens" },
  { id: "op-cedar", name: "Cedar Commons" },
];

const SITES = [
  { id: "site-halsted", operator_id: "op-ember", name: "Ember Row — Halsted", time_zone: "America/Chicago", deposit_cents: 7500, cleaning_fee_cents: 3500 },
  { id: "site-corktown", operator_id: "op-ember", name: "Ember Row — Corktown", time_zone: "America/Detroit", deposit_cents: 7500, cleaning_fee_cents: 3500 },
  { id: "site-fremont", operator_id: "op-cedar", name: "Cedar Commons — Fremont", time_zone: "America/Los_Angeles", deposit_cents: 6000, cleaning_fee_cents: 3000 },
];

const STATIONS = [
  ["st-deck-1", "site-halsted", "Deck oven 1", 3800, 1],
  ["st-deck-2", "site-halsted", "Deck oven 2", 3800, 2],
  ["st-range-a", "site-halsted", "Range line A", 3200, 3],
  ["st-prep-3", "site-halsted", "Prep table 3", 2000, 4],
  ["st-walkin-4", "site-halsted", "Walk-in shelf 4", 600, 5],
  ["st-ct-deck", "site-corktown", "Deck oven", 3600, 1],
  ["st-ct-range", "site-corktown", "Range line", 3000, 2],
  ["st-ct-prep", "site-corktown", "Prep table", 1800, 3],
  ["st-fr-deck", "site-fremont", "Deck oven", 4000, 1],
  ["st-fr-range", "site-fremont", "Range line", 3400, 2],
  ["st-fr-prep", "site-fremont", "Prep table", 2200, 3],
] as const;

const PASSWORD = "hearth-demo-2026";

const STAFF = [
  { id: "usr-odile", operator_id: "op-ember", name: "Odile Marchetti", email: "odile@emberrow.test", role: "manager", site_ids: ["site-halsted", "site-corktown"], renter_id: null },
  { id: "usr-priya", operator_id: "op-ember", name: "Priya Lindqvist", email: "desk.halsted@emberrow.test", role: "front_desk", site_ids: ["site-halsted"], renter_id: null },
  { id: "usr-marcus", operator_id: "op-ember", name: "Marcus Feld", email: "desk.corktown@emberrow.test", role: "front_desk", site_ids: ["site-corktown"], renter_id: null },
  { id: "usr-wen", operator_id: "op-cedar", name: "Wen Hollis", email: "wen@cedarcommons.test", role: "manager", site_ids: ["site-fremont"], renter_id: null },
  { id: "usr-ada", operator_id: "op-cedar", name: "Ada Moreno", email: "desk@cedarcommons.test", role: "front_desk", site_ids: ["site-fremont"], renter_id: null },
];

const RENTERS = [
  { id: "rn-juniper", operator_id: "op-ember", home_site_id: "site-halsted", user_id: "usr-tamsin", name: "Tamsin Okoro", business: "Juniper Crumb Bakery", email: "tamsin@junipercrumb.test", phone: "+1-312-555-0141" },
  { id: "rn-saltbox", operator_id: "op-ember", home_site_id: "site-halsted", user_id: "usr-rafa", name: "Rafa Quintero", business: "Saltbox Tacos", email: "rafa@saltboxtacos.test", phone: "+1-312-555-0172" },
  { id: "rn-ledger", operator_id: "op-ember", home_site_id: "site-corktown", user_id: "usr-june", name: "June Abernathy", business: "Little Ledger Meal Prep", email: "june@littleledger.test", phone: "+1-313-555-0118" },
  { id: "rn-nightjar", operator_id: "op-ember", home_site_id: "site-halsted", user_id: "usr-ike", name: "Ike Brennan", business: "Nightjar Pies", email: "ike@nightjarpies.test", phone: "+1-312-555-0190" },
  { id: "rn-fennel", operator_id: "op-cedar", home_site_id: "site-fremont", user_id: "usr-noor", name: "Noor Haddad", business: "Fennel & Fig Catering", email: "noor@fennelfig.test", phone: "+1-510-555-0133" },
];

const RENTER_USERS = RENTERS.map(r => ({
  id: r.user_id, operator_id: r.operator_id, name: r.name, email: r.email,
  role: "renter" as const, site_ids: [], renter_id: r.id,
}));

const DOCS = [
  { id: "doc-juniper-liab", renter_id: "rn-juniper", kind: "liability", valid_from: "2026-01-01", expires_on: "2030-12-31", type: "pdf" },
  { id: "doc-juniper-food", renter_id: "rn-juniper", kind: "food_handler", valid_from: "2026-01-01", expires_on: "2030-06-30", type: "png" },
  { id: "doc-saltbox-liab", renter_id: "rn-saltbox", kind: "liability", valid_from: "2026-01-01", expires_on: "2030-12-31", type: "pdf" },
  { id: "doc-saltbox-food", renter_id: "rn-saltbox", kind: "food_handler", valid_from: "2026-01-01", expires_on: "2030-12-31", type: "pdf" },
  { id: "doc-ledger-food", renter_id: "rn-ledger", kind: "food_handler", valid_from: "2026-01-01", expires_on: "2030-12-31", type: "pdf" },
  { id: "doc-nightjar-liab", renter_id: "rn-nightjar", kind: "liability", valid_from: "2025-02-01", expires_on: "2026-01-31", type: "pdf" },
  { id: "doc-nightjar-food", renter_id: "rn-nightjar", kind: "food_handler", valid_from: "2026-01-01", expires_on: "2030-12-31", type: "pdf" },
  { id: "doc-fennel-liab", renter_id: "rn-fennel", kind: "liability", valid_from: "2026-01-01", expires_on: "2030-12-31", type: "pdf" },
  { id: "doc-fennel-food", renter_id: "rn-fennel", kind: "food_handler", valid_from: "2026-01-01", expires_on: "2030-12-31", type: "pdf" },
];

/** A small valid one-page PDF with a text line. */
export function seedPdf(text: string): Buffer {
  const esc = text.replace(/([()\\])/g, "\\$1");
  const content = `BT /F1 14 Tf 72 720 Td (${esc}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xrefPos = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** A small valid 1x1 PNG. */
export function seedPng(): Buffer {
  const ihdr = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  function chunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const typeB = Buffer.from(type, "latin1");
    const crcTable: number[] = [];
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
    let crc = 0xffffffff;
    for (const b of Buffer.concat([typeB, data])) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
    crc = (crc ^ 0xffffffff) >>> 0;
    const crcB = Buffer.alloc(4); crcB.writeUInt32BE(crc);
    return Buffer.concat([len, typeB, data, crcB]);
  }
  const ihdrData = Buffer.concat([
    Buffer.from([0, 0, 0, 1]), Buffer.from([0, 0, 0, 1]), Buffer.from([8, 6, 0, 0, 0]),
  ]);
  return Buffer.concat([ihdr, chunk("IHDR", ihdrData), chunk("IDAT", Buffer.from("eJxjYmBgYAZiDiAEIIEWUAKqAItaxCY=", "base64")), chunk("IEND", Buffer.alloc(0))]);
}

async function seedDocuments(): Promise<void> {
  for (const d of DOCS) {
    const bytes = d.type === "pdf" ? seedPdf(`Hearthshift seeded document ${d.id}`) : seedPng();
    const contentType = d.type === "pdf" ? "application/pdf" : "image/png";
    const key = `renters/${d.renter_id}/documents/${d.id}`;
    const existing = await q(`SELECT id FROM documents WHERE id = $1`, [d.id]);
    // Always ensure the object is readable, even if the row exists.
    await putObject(key, bytes, contentType);
    if (existing.rowCount === 0) {
      await q(
        `INSERT INTO documents (id, renter_id, kind, valid_from, expires_on, content_type, size_bytes, storage_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
        [d.id, d.renter_id, d.kind, d.valid_from, d.expires_on, contentType, bytes.length, key],
      );
    }
  }
}

export async function migrateAndSeed(): Promise<void> {
  await pool.query(SCHEMA_SQL);
  await ensureBucket();

  for (const o of OPERATORS) {
    await q(`INSERT INTO operators (id, name) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING`, [o.id, o.name]);
  }
  for (const s of SITES) {
    await q(
      `INSERT INTO sites (id, operator_id, name, time_zone, deposit_cents, cleaning_fee_cents)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
      [s.id, s.operator_id, s.name, s.time_zone, s.deposit_cents, s.cleaning_fee_cents],
    );
  }
  for (const st of STATIONS) {
    await q(
      `INSERT INTO stations (id, site_id, name, rate_cents, ordinal) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO NOTHING`,
      [st[0], st[1], st[2], st[3], st[4]],
    );
  }

  const users = [...STAFF, ...RENTER_USERS];
  for (const u of users) {
    const hash = hashPassword(PASSWORD, u.id + u.email);
    await q(
      `INSERT INTO app_users (id, operator_id, name, email, password_hash, role, site_ids, renter_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
      [u.id, u.operator_id, u.name, u.email, hash, u.role, u.site_ids, u.renter_id],
    );
  }
  for (const r of RENTERS) {
    await q(
      `INSERT INTO renters (id, operator_id, home_site_id, user_id, name, business, email, phone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
      [r.id, r.operator_id, r.home_site_id, r.user_id, r.name, r.business, r.email, r.phone],
    );
  }

  // Policy versions in force at start: 24h from 2026-01-01 (Ember), 48h (Cedar).
  const policies = [
    { id: "pol-halsted-24", site_id: "site-halsted", notice: 24, from: "2026-01-01", by: "usr-odile" },
    { id: "pol-corktown-24", site_id: "site-corktown", notice: 24, from: "2026-01-01", by: "usr-odile" },
    { id: "pol-fremont-48", site_id: "site-fremont", notice: 48, from: "2026-01-01", by: "usr-wen" },
  ];
  const zoneOf: Record<string, string> = { "site-halsted": "America/Chicago", "site-corktown": "America/Detroit", "site-fremont": "America/Los_Angeles" };
  for (const p of policies) {
    const tz = zoneOf[p.site_id];
    const midnight = resolveWallTime(tz, { y: 2026, m: 1, d: 1, hh: 0, mm: 0 });
    await q(
      `INSERT INTO policy_versions (id, site_id, notice_hours, effective_from, effective_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
      [p.id, p.site_id, p.notice, p.from, new Date(midnight).toISOString(), p.by],
    );
  }

  await seedDocuments();

  // Seeded bookings on the day after the seed, then the packs that pay for them.
  await seedBookings();
  await seedPackLedger();
}

interface SeedBooking {
  id: string;
  renter: string;
  station: string;
  site: string;
  tz: string;
  start: string;
  end: string;
  packMinutes: number;
  policyId: string;
  settledPast?: boolean;
}

function addDays(date: string, days: number): string {
  const t = Date.parse(date + "T00:00:00Z") + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

function seedDateFor(tz: string): string {
  return addDays(localDate(tz, Date.now()), 1);
}

async function seedPackLedger(): Promise<void> {
  // Juniper: purchase 1200; reserve+use 360 on bk-seed-juniper-0; reserve 240 on bk-seed-juniper-1.
  const rows: { packId: string; renter: string; movements: { id: string; reason: string; booking: string | null; from: string; to: string; minutes: number }[] }[] = [
    {
      packId: "pk-juniper-1", renter: "rn-juniper", movements: [
        { id: "mv-juniper-buy", reason: "purchase", booking: null, from: "purchased", to: "available", minutes: 1200 },
        { id: "mv-juniper-res0", reason: "reserve", booking: "bk-seed-juniper-0", from: "available", to: "reserved", minutes: 360 },
        { id: "mv-juniper-use0", reason: "use", booking: "bk-seed-juniper-0", from: "reserved", to: "used", minutes: 360 },
        { id: "mv-juniper-res1", reason: "reserve", booking: "bk-seed-juniper-1", from: "available", to: "reserved", minutes: 240 },
      ],
    },
    {
      packId: "pk-fennel-1", renter: "rn-fennel", movements: [
        { id: "mv-fennel-buy", reason: "purchase", booking: null, from: "purchased", to: "available", minutes: 1200 },
        { id: "mv-fennel-res1", reason: "reserve", booking: "bk-seed-fennel-1", from: "available", to: "reserved", minutes: 240 },
      ],
    },
  ];
  for (const p of rows) {
    await q(
      `INSERT INTO packs (id, renter_id, minutes, price_cents) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`,
      [p.packId, p.renter, 1200, 56000],
    );
    for (const mv of p.movements) {
    const ins = await q(
        `INSERT INTO pack_movements (id, pack_id, booking_id, reason)
         VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING RETURNING id`,
        [mv.id, p.packId, mv.booking, mv.reason],
      );
      if (ins.rowCount === 0) continue;
      // Double entry: outgoing account negative, incoming account positive.
      await q(`INSERT INTO pack_entries (id, movement_id, account, minutes) VALUES ($1,$2,$3,$4)`,
        [`${mv.id}-a`, mv.id, mv.from, -mv.minutes]);
      await q(`INSERT INTO pack_entries (id, movement_id, account, minutes) VALUES ($1,$2,$3,$4)`,
        [`${mv.id}-b`, mv.id, mv.to, mv.minutes]);
    }
  }
}

async function seedBookings(): Promise<void> {
  const juniperDate = seedDateFor("America/Chicago");
  const fennelDate = seedDateFor("America/Los_Angeles");
  const juniperPast = "2026-10-01";
  const seeds: SeedBooking[] = [
    {
      id: "bk-seed-juniper-0", renter: "rn-juniper", station: "st-deck-1", site: "site-halsted",
      tz: "America/Chicago", start: `${juniperPast} 04:00`, end: `${juniperPast} 10:00`,
      packMinutes: 360, policyId: "pol-halsted-24", settledPast: true,
    },
    {
      id: "bk-seed-juniper-1", renter: "rn-juniper", station: "st-deck-1", site: "site-halsted",
      tz: "America/Chicago", start: `${juniperDate} 04:00`, end: `${juniperDate} 08:00`,
      packMinutes: 240, policyId: "pol-halsted-24",
    },
    {
      id: "bk-seed-fennel-1", renter: "rn-fennel", station: "st-fr-deck", site: "site-fremont",
      tz: "America/Los_Angeles", start: `${fennelDate} 05:00`, end: `${fennelDate} 09:00`,
      packMinutes: 240, policyId: "pol-fremont-48",
    },
  ];
  for (const b of seeds) {
    const [datePart, hhmmStart] = b.start.split(" ");
    const endParts = b.end.split(" ");
    const sy = Number(datePart.slice(0, 4)), sm = Number(datePart.slice(5, 7)), sd = Number(datePart.slice(8, 10));
    const [sh, smi] = hhmmStart.split(":").map(Number);
    const [eh, emi] = endParts[1].split(":").map(Number);
    const startAt = resolveWallTime(b.tz, { y: sy, m: sm, d: sd, hh: sh, mm: smi });
    let endDate = datePart;
    if (eh * 60 + emi <= sh * 60 + smi) endDate = addDays(datePart, 1);
    const ey = Number(endDate.slice(0, 4)), em = Number(endDate.slice(5, 7)), ed = Number(endDate.slice(8, 10));
    const endAt = resolveWallTime(b.tz, { y: ey, m: em, d: ed, hh: eh, mm: emi });
    const minutes = Math.round((endAt - startAt) / 60000);
    const status = b.settledPast ? "settled" : "confirmed";
    const holdId = `hold-${b.id}`;
    const renterOp = b.renter === "rn-fennel" ? "op-cedar" : "op-ember";
    await q(
      `INSERT INTO holds (id, station_id, site_id, renter_id, status, created_at, expires_at, confirmed_at)
       VALUES ($1,$2,$3,$4,'confirmed',$5,$5,$5) ON CONFLICT (id) DO NOTHING`,
      [holdId, b.station, b.site, b.renter, new Date(Math.min(startAt, Date.now() - 86400000)).toISOString()],
    );
    const ins = await q(
      `INSERT INTO bookings (id, hold_id, site_id, station_id, renter_id, status, start_at, end_at, minutes,
         pack_minutes, card_minutes, card_cents, deposit_cents, policy_version_id, confirmed_at,
         checked_in_at, checked_out_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,0,0,$11,$12,$13,$14) ON CONFLICT (id) DO NOTHING RETURNING id`,
      [
        b.id, holdId, b.site, b.station, b.renter, status,
        new Date(startAt).toISOString(), new Date(endAt).toISOString(), minutes,
        b.packMinutes, b.policyId, new Date(Math.min(startAt, Date.now()) - 3600000).toISOString(),
        b.settledPast ? new Date(startAt).toISOString() : null,
        b.settledPast ? new Date(endAt).toISOString() : null,
      ],
    );
    if (ins.rowCount === 0) continue;
    const auditActions = b.settledPast
      ? [["confirm", "confirmed"], ["check_in", "checked_in"], ["check_out", "checked_out"], ["settle", "settled"]]
      : [["confirm", "confirmed"]];
    let from = "held";
    for (const [action, to] of auditActions) {
      await q(
        `INSERT INTO audit_events (id, booking_id, actor_name, actor_role, action, from_status, to_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [uid("au"), b.id, "System seed", "system", action, from, to],
      );
      from = to;
    }
    void renterOp;
  }
}
