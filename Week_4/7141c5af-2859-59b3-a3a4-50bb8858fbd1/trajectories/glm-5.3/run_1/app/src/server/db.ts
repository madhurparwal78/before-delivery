import pg from "pg";
import { config } from "./config.js";
import { addDaysISO, localDate, mondayOfISO, wallTimeToInstant } from "./time.js";
import { sha256 } from "./config.js";
import { generatePhotograph } from "./png.js";
import { luhnValid } from "./stamps.js";
import { seedMaterials, seedRates, type SeedMaterial } from "./seed-data.js";
import { s3 } from "./providers/s3.js";
import { LABEL_BYTES } from "./courier-label.js";
import { renderDossierPdf } from "./dossier-pdf.js";
import { newToken } from "./config.js";

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });

export async function q<T extends pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query(text, params as never[]);
  return res.rows as T[];
}
export async function q1<T extends pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(text, params);
  return rows[0] ?? null;
}
export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}
export const SCHEMA_VERSION = 1;

const DDL = `
CREATE TABLE IF NOT EXISTS desks (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  desk_id text NOT NULL REFERENCES desks(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  ended_at timestamptz
);
CREATE TABLE IF NOT EXISTS clients (
  id text PRIMARY KEY,
  desk_id text NOT NULL REFERENCES desks(id) ON DELETE CASCADE,
  name text NOT NULL,
  town text NOT NULL,
  language text NOT NULL,
  email text NOT NULL,
  state text NOT NULL DEFAULT 'active',
  closes_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pieces (
  id text PRIMARY KEY,
  desk_id text NOT NULL REFERENCES desks(id) ON DELETE CASCADE,
  client_id text REFERENCES clients(id) ON DELETE SET NULL,
  title text NOT NULL,
  maker text,
  year text,
  stamp_number text,
  width_cm numeric,
  depth_cm numeric,
  height_cm numeric,
  weight_kg numeric,
  due_date date,
  notes text,
  state text NOT NULL DEFAULT 'received',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pieces_stamp_desk ON pieces (desk_id, stamp_number) WHERE stamp_number IS NOT NULL;
CREATE TABLE IF NOT EXISTS pins (
  id text PRIMARY KEY,
  piece_id text NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
  desk_id text NOT NULL,
  number int NOT NULL,
  x numeric NOT NULL,
  y numeric NOT NULL,
  kind text NOT NULL,
  note text NOT NULL DEFAULT '',
  signed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pins_piece_number ON pins (piece_id, number);
CREATE TABLE IF NOT EXISTS photographs (
  id text PRIMARY KEY,
  piece_id text NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
  desk_id text NOT NULL,
  number int NOT NULL,
  side text NOT NULL,
  sha256 text NOT NULL,
  bytes int NOT NULL,
  state text NOT NULL DEFAULT 'waiting',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS photos_piece_sha ON photographs (piece_id, sha256);
CREATE TABLE IF NOT EXISTS layouts (
  piece_id text PRIMARY KEY REFERENCES pieces(id) ON DELETE CASCADE,
  desk_id text NOT NULL,
  version int NOT NULL DEFAULT 1,
  placements jsonb NOT NULL,
  used_sqft numeric NOT NULL DEFAULT 0,
  used_percent numeric NOT NULL DEFAULT 0,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS materials (
  id text PRIMARY KEY,
  desk_id text NOT NULL REFERENCES desks(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  family text NOT NULL,
  unit text NOT NULL,
  prices jsonb NOT NULL,
  position int NOT NULL DEFAULT 0,
  UNIQUE (desk_id, code)
);
CREATE TABLE IF NOT EXISTS stock_cache (
  desk_id text NOT NULL,
  code text NOT NULL,
  fetched_at timestamptz NOT NULL,
  lots jsonb NOT NULL,
  PRIMARY KEY (desk_id, code)
);
CREATE TABLE IF NOT EXISTS hold_calls (
  desk_id text NOT NULL,
  piece_id text NOT NULL,
  code text NOT NULL,
  lot text NOT NULL,
  hold_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (desk_id, piece_id, code, lot)
);
CREATE TABLE IF NOT EXISTS holds (
  id text PRIMARY KEY,
  piece_id text NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
  desk_id text NOT NULL,
  hold_id text NOT NULL,
  code text NOT NULL,
  lot text NOT NULL,
  quantity text NOT NULL,
  unit text NOT NULL,
  state text NOT NULL DEFAULT 'held',
  ends_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS estimates (
  id text PRIMARY KEY,
  piece_id text NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
  desk_id text NOT NULL,
  version int NOT NULL,
  state text NOT NULL DEFAULT 'open',
  currency text NOT NULL,
  material_code text,
  lot text,
  pattern_area_sq_ft text,
  hides int,
  metres text,
  labour_hours text NOT NULL,
  labour_rate_minor int NOT NULL,
  material_minor int NOT NULL,
  labour_minor int NOT NULL,
  subtotal_minor int NOT NULL,
  tax_percent int NOT NULL,
  tax_minor int NOT NULL,
  total_minor int NOT NULL,
  milestones jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rates (
  id text PRIMARY KEY,
  desk_id text NOT NULL REFERENCES desks(id) ON DELETE CASCADE,
  takes_effect_on date NOT NULL,
  eur text NOT NULL,
  gbp text NOT NULL,
  usd text NOT NULL,
  jpy text NOT NULL,
  aed text NOT NULL,
  UNIQUE (desk_id, takes_effect_on)
);
CREATE TABLE IF NOT EXISTS client_pages (
  piece_id text NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
  desk_id text NOT NULL,
  token text PRIMARY KEY,
  address text NOT NULL,
  ends_at timestamptz NOT NULL,
  sent_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'live',
  answer jsonb,
  sign_off jsonb,
  reminder_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS bench_jobs (
  id text PRIMARY KEY,
  desk_id text NOT NULL,
  piece_id text NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
  bench text NOT NULL,
  day date NOT NULL,
  glue_laid_at timestamptz,
  glue_cures_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (desk_id, bench, day)
);
CREATE TABLE IF NOT EXISTS collections (
  id text PRIMARY KEY,
  piece_id text NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
  desk_id text NOT NULL,
  quote_id text NOT NULL,
  collect_at timestamptz NOT NULL,
  local_date text NOT NULL,
  local_time text NOT NULL,
  town text NOT NULL,
  state text NOT NULL DEFAULT 'waiting',
  label_sha256 text,
  label_bytes int,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS collection_calls (
  desk_id text NOT NULL,
  piece_id text NOT NULL,
  quote_id text NOT NULL,
  collection_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (desk_id, piece_id, quote_id)
);
CREATE TABLE IF NOT EXISTS dossiers (
  id text PRIMARY KEY,
  piece_id text NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
  desk_id text NOT NULL,
  state text NOT NULL DEFAULT 'waiting',
  message text,
  signed_by text,
  signed_at timestamptz,
  pdf_sha256 text,
  history jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS download_counts (
  desk_id text NOT NULL,
  window_start timestamptz NOT NULL,
  count int NOT NULL DEFAULT 0,
  PRIMARY KEY (desk_id, window_start)
);
CREATE TABLE IF NOT EXISTS enquiries_log (
  email text NOT NULL,
  window_start timestamptz NOT NULL,
  count int NOT NULL DEFAULT 0,
  PRIMARY KEY (email, window_start)
);
CREATE TABLE IF NOT EXISTS workbooks (
  desk_id text PRIMARY KEY,
  sha256 text NOT NULL,
  bytes int NOT NULL,
  rows int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS search_sync (
  desk_id text NOT NULL,
  kind text NOT NULL,
  ref_id text NOT NULL,
  label text NOT NULL,
  href text NOT NULL,
  pending boolean NOT NULL DEFAULT true,
  PRIMARY KEY (desk_id, kind, ref_id)
);
CREATE TABLE IF NOT EXISTS answers (
  id text PRIMARY KEY,
  page_token text NOT NULL REFERENCES client_pages(token) ON DELETE CASCADE,
  desk_id text NOT NULL,
  seat_height text NOT NULL,
  typed text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS seed_marker (
  id int PRIMARY KEY DEFAULT 1,
  started_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

export async function applySchema(): Promise<void> {
  await q(DDL);
}

export type SeededPieceSpec = {
  title: string;
  stamp: string;
  maker: string;
  year: string;
  w: number; d: number; h: number; kg: number;
  dueDays: number;
  state: "inSurvey" | "onTheBench" | "ready";
  clientKey: string;
};

export async function seedIfEmpty(): Promise<void> {
  const marker = await q1<{ id: number }>("SELECT id FROM seed_marker WHERE id = 1");
  if (marker) return;
  // Take an advisory lock so concurrent copies seed once.
  const lock = await q1<{ locked: boolean }>("SELECT pg_try_advisory_lock(918273645) AS locked");
  if (!lock?.locked) return;
  try {
    const again = await q1<{ id: number }>("SELECT id FROM seed_marker WHERE id = 1");
    if (again) return;
    await seedAll();
    await q("INSERT INTO seed_marker (id, started_on) VALUES (1, $1) ON CONFLICT DO NOTHING", [todayTurin()]);
  } finally {
    await q("SELECT pg_advisory_unlock(918273645)");
  }
}

export const todayTurin = () => localDate(new Date(), "Europe/Rome");

const hashPassword = (pw: string): string => sha256(`semenza:${pw}`);

export async function seedAll(): Promise<void> {
  const start = todayTurin();
  const id = () => Math.random().toString(36).slice(2, 14);
  const desks: { key: string; name: string; email: string; password: string }[] = [
    { key: "agnese", name: "Agnese Ferrero", email: "agnese@bottega-semenza.example", password: "tacks-and-hide-2027" },
    { key: "ruben", name: "Ruben Marchetti", email: "ruben@bottega-semenza.example", password: "second-desk-2027" },
  ];
  const deskIds: Record<string, string> = {};
  for (const d of desks) {
    const did = id();
    deskIds[d.key] = did;
    await q("INSERT INTO desks (id, name, email, password_hash) VALUES ($1,$2,$3,$4) ON CONFLICT (email) DO NOTHING", [did, d.name, d.email, hashPassword(d.password)]);
  }
  const clients: { key: string; desk: string; name: string; town: string; language: string; email: string }[] = [
    { key: "giulia", desk: "agnese", name: "Giulia Ricci", town: "Turin", language: "it", email: "giulia@clients.example" },
    { key: "harriet", desk: "agnese", name: "Harriet Osei", town: "London", language: "en", email: "harriet@clients.example" },
    { key: "dana", desk: "agnese", name: "Dana Whitlock", town: "New York", language: "en", email: "dana@clients.example" },
    { key: "aoi", desk: "agnese", name: "中村 葵", town: "Kyoto", language: "ja", email: "aoi@clients.example" },
    { key: "sara", desk: "agnese", name: "سارة المنصوري", town: "Dubai", language: "ar", email: "sara@clients.example" },
    { key: "zoe", desk: "agnese", name: "Zoë Ørsted", town: "London", language: "en", email: "zoe@clients.example" },
    { key: "manifattura", desk: "agnese", name: "MANIFATTURATESSILEEPELLETTERIADELLEVALLISUPERIORIDIBIELLAETORINO", town: "Turin", language: "it", email: "manifattura@clients.example" },
    { key: "ivo", desk: "ruben", name: "Ivo Kranjc", town: "London", language: "en", email: "ivo@clients.example" },
  ];
  const clientIds: Record<string, string> = {};
  for (const c of clients) {
    const cid = id();
    clientIds[c.key] = cid;
    await q("INSERT INTO clients (id, desk_id, name, town, language, email) VALUES ($1,$2,$3,$4,$5,$6)", [cid, deskIds[c.desk]!, c.name, c.town, c.language, c.email]);
  }
  const pieces: { key: string; desk: string; spec: SeededPieceSpec }[] = [
    { key: "lounge", desk: "agnese", spec: { title: "Lounge chair", stamp: "48201768", maker: "Officina Bressan", year: "1957", w: 66, d: 70, h: 78, kg: 12.5, dueDays: 21, state: "onTheBench", clientKey: "giulia" } },
    { key: "tubular", desk: "agnese", spec: { title: "Tubular armchair", stamp: "60319522", maker: "Atelier Lindqvist", year: "1931", w: 60, d: 64, h: 74, kg: 9, dueDays: 28, state: "inSurvey", clientKey: "harriet" } },
    { key: "cantilever", desk: "agnese", spec: { title: "Cantilever side chair", stamp: "71540835", maker: "Harlan & Vance", year: "1949", w: 48, d: 54, h: 80, kg: 6.5, dueDays: 35, state: "inSurvey", clientKey: "dana" } },
    { key: "folding", desk: "agnese", spec: { title: "Folding deck chair", stamp: "30972186", maker: "Kobo Tanizawa", year: "1962", w: 58, d: 90, h: 84, kg: 7, dueDays: 42, state: "inSurvey", clientKey: "aoi" } },
    { key: "swivel", desk: "agnese", spec: { title: "Swivel desk chair", stamp: "52166048", maker: "Studio Marchand", year: "1968", w: 62, d: 62, h: 92, kg: 14, dueDays: 49, state: "inSurvey", clientKey: "sara" } },
    { key: "bentwood", desk: "agnese", spec: { title: "Bentwood armchair", stamp: "83407197", maker: "Werkstatt Adler", year: "1926", w: 56, d: 58, h: 82, kg: 5.5, dueDays: 14, state: "ready", clientKey: "zoe" } },
    { key: "slat", desk: "agnese", spec: { title: "Slat bench", stamp: "26750414", maker: "Falegnameria Conti", year: "1953", w: 120, d: 44, h: 42, kg: 18, dueDays: 56, state: "inSurvey", clientKey: "manifattura" } },
    { key: "stool", desk: "ruben", spec: { title: "Walnut stool", stamp: "91283564", maker: "Dom Novak", year: "1960", w: 36, d: 36, h: 44, kg: 3, dueDays: 30, state: "inSurvey", clientKey: "ivo" } },
  ];
  const pieceIds: Record<string, string> = {};
  for (const p of pieces) {
    if (!luhnValid(p.spec.stamp)) throw new Error(`seed stamp ${p.spec.stamp} invalid`);
    const pid = id();
    pieceIds[p.key] = pid;
    await q(
      `INSERT INTO pieces (id, desk_id, client_id, title, maker, year, stamp_number, width_cm, depth_cm, height_cm, weight_kg, due_date, notes, state)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [pid, deskIds[p.desk]!, clientIds[p.spec.clientKey]!, p.spec.title, p.spec.maker, p.spec.year, p.spec.stamp, p.spec.w, p.spec.d, p.spec.h, p.spec.kg, addDaysISO(start, p.spec.dueDays), "", p.spec.state]
    );
  }
  // Photographs, pins, layouts per seeded piece.
  for (const p of pieces) {
    const pid = pieceIds[p.key]!;
    const did = deskIds[p.desk]!;
    for (let n = 1; n <= 2; n++) {
      const side = n === 1 ? "before" : "after";
      const bytes = generatePhotograph(480, 360, n);
      const sha = sha256(bytes);
      const stored = await s3.put(`photographs/${did}/${pid}/${sha}`, bytes, "image/png");
      await q("INSERT INTO photographs (id, piece_id, desk_id, number, side, sha256, bytes, state) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [id(), pid, did, n, side, sha, bytes.length, stored ? "stored" : "waiting"]);
    }
    await q("INSERT INTO search_sync (desk_id, kind, ref_id, label, href, pending) VALUES ($1,'piece',$2,$3,$4,true) ON CONFLICT DO NOTHING", [did, pid, p.spec.title, `/pieces/${pid}`]);
    const pins: { n: number; kind: string; x: number; y: number; note: string; signed: boolean }[] = [
      { n: 1, kind: "tear", x: 20.0, y: 30.0, note: "**Tear** along the front seam", signed: true },
      { n: 2, kind: "stain", x: 50.0, y: 60.0, note: "*Stain* under the left arm", signed: true },
      { n: 3, kind: "looseJoint", x: 80.0, y: 30.0, note: "Check again before quoting", signed: false },
    ];
    for (const pin of pins) {
      await q("INSERT INTO pins (id, piece_id, desk_id, number, x, y, kind, note, signed) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [id(), pid, did, pin.n, pin.x, pin.y, pin.kind, pin.note, pin.signed]);
    }
    await q("INSERT INTO layouts (piece_id, desk_id, version, placements, used_sqft, used_percent) VALUES ($1,$2,1,$3,$4,$5)", [
      pid, did, JSON.stringify([{ name: "Seat", x: 0, y: 0, rotation: 0, state: "placed" }]), "3.87", "7.5",
    ]);
  }
  // Materials and rates on each desk.
  for (const key of Object.keys(deskIds)) {
    const did = deskIds[key]!;
    await seedMaterials(did);
    await seedRates(did);
    const rows = await q<SeedMaterial>("SELECT code, name, family, unit, prices FROM materials WHERE desk_id = $1 ORDER BY position", [did]);
    for (const m of rows) {
      await q("INSERT INTO search_sync (desk_id, kind, ref_id, label, href, pending) VALUES ($1,'material',$2,$3,$4,true) ON CONFLICT DO NOTHING", [did, m.code, `${m.name} ${m.code}`, `/library?material=${m.code}`]);
    }
    const cs = await q<{ id: string; name: string }>("SELECT id, name FROM clients WHERE desk_id = $1", [did]);
    for (const c of cs) {
      await q("INSERT INTO search_sync (desk_id, kind, ref_id, label, href, pending) VALUES ($1,'client',$2,$3,$4,true) ON CONFLICT DO NOTHING", [did, c.id, c.name, `/clients/${c.id}`]);
    }
    const ps = await q<{ id: string; title: string }>("SELECT id, title FROM pieces WHERE desk_id = $1", [did]);
    for (const p of ps) {
      await q("INSERT INTO search_sync (desk_id, kind, ref_id, label, href, pending) VALUES ($1,'piece',$2,$3,$4,true) ON CONFLICT DO NOTHING", [did, p.id, p.title, `/pieces/${p.id}`]);
    }
  }
  // Holds
  await q("INSERT INTO holds (id, piece_id, desk_id, hold_id, code, lot, quantity, unit, state, ends_on) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'held',$9)", [id(), pieceIds.lounge!, deskIds.agnese!, "H-6001", "VM-2041", "L-2041-A", "2", "hides", addDaysISO(start, 1)]);
  await q("INSERT INTO holds (id, piece_id, desk_id, hold_id, code, lot, quantity, unit, state, ends_on) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ended',$9)", [id(), pieceIds.tubular!, deskIds.agnese!, "H-6002", "VM-2044", "L-2044-A", "1", "hides", addDaysISO(start, -1)]);
  // Estimates
  const est = (piece: string, material: string, lot: string, area: string, hours: string, currency: string, materialMinor: number, labourMinor: number, taxPercent: number, taxMinor: number, totalMinor: number, state: string, milestones: { percent: number; amountMinor: number }[]) =>
    q(`INSERT INTO estimates (id, piece_id, desk_id, version, state, currency, material_code, lot, pattern_area_sq_ft, hides, metres, labour_hours, labour_rate_minor, material_minor, labour_minor, subtotal_minor, tax_percent, tax_minor, total_minor, milestones)
       VALUES ($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [id(), pieceIds[piece]!, deskIds.agnese!, state, currency, material, lot, area, material.startsWith("VM-3") ? null : 1, material.startsWith("VM-3") ? area : null, hours, rateMinor(currency), materialMinor, labourMinor, materialMinor + labourMinor, taxPercent, taxMinor, totalMinor, JSON.stringify(milestones)]);
  const rateMinor = (c: string) => (c === "EUR" ? 8500 : c === "GBP" ? 7200 : c === "USD" ? 9200 : c === "JPY" ? 13800 : 34000);
  const split = (total: number) => {
    const shares = [30, 40, 30].map((p) => Math.floor((total * p) / 100));
    let rem = total - shares.reduce((a, b) => a + b, 0);
    for (let i = 0; i < 3 && rem > 0; i++, rem--) shares[i]! += 1;
    return shares.map((s, i) => ({ percent: [30, 40, 30][i]!, amountMinor: s }));
  };
  await est("lounge", "VM-2041", "L-2041-A", "14.54", "12.50", "EUR", 66103, 106250, 22, 37918, 210271, "open", split(210271));
  await est("tubular", "VM-2044", "L-2044-A", "14.54", "10.00", "GBP", 16033, 72000, 20, 17607, 105640, "open", split(105640));
  await est("cantilever", "VM-2047", "L-2000-A", "14.54", "8.00", "USD", 58624, 73600, 0, 0, 132224, "open", split(132224));
  await est("folding", "VM-2041", "L-2041-B", "14.54", "6.00", "JPY", 104973, 82800, 0, 0, 187773, "open", split(187773));
  await est("swivel", "VM-2043", "L-2000-A", "14.54", "5.00", "AED", 322793, 170000, 0, 0, 492793, "open", split(492793));
  await est("bentwood", "VM-2042", "L-2000-A", "14.54", "9.00", "GBP", 63690, 64800, 20, 25698, 154188, "signedOff", split(154188));
  // Bench jobs in the current Turin week
  const monday = mondayOfISO(start);
  await q("INSERT INTO bench_jobs (id, desk_id, piece_id, bench, day) VALUES ($1,$2,$3,'frame',$4)", [id(), deskIds.agnese!, pieceIds.lounge!, monday]);
  await q("INSERT INTO bench_jobs (id, desk_id, piece_id, bench, day) VALUES ($1,$2,$3,'cover',$4)", [id(), deskIds.agnese!, pieceIds.tubular!, addDaysISO(monday, 2)]);
  // Collections on Cantilever side chair around the next New York clock change
  const nyChange = nextNyClockChange(start);
  const seededCollections: { ref: string; date: string }[] = [
    { ref: "C-8001", date: mondayBefore(nyChange) },
    { ref: "C-8002", date: mondayAfter(nyChange) },
  ];
  for (const c of seededCollections) {
    const at = wallTimeToInstant("America/New_York", c.date, "09:00");
    if (!at) continue;
    const id = c.ref.toLowerCase();
    const labelOk = await s3.put(`labels/${deskIds.agnese!}/${pieceIds.cantilever!}/${id}.pdf`, LABEL_BYTES, "application/pdf");
    await q(
      "INSERT INTO collections (id, piece_id, desk_id, quote_id, collect_at, local_date, local_time, town, state, label_sha256, label_bytes) VALUES ($1,$2,$3,$4,$5,$6,$7,'New York',$8,$9,$10)",
      [id, pieceIds.cantilever!, deskIds.agnese!, "Q-5001", at.toISOString(), c.date, "09:00", labelOk ? "booked" : "waiting", labelOk ? sha256(LABEL_BYTES) : null, labelOk ? LABEL_BYTES.length : null]
    );
    await q("INSERT INTO collection_calls (desk_id, piece_id, quote_id, collection_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [deskIds.agnese!, pieceIds.cantilever!, "Q-5001", id]);
  }
  // A dossier on Bentwood armchair: rendered and stored on start, signed the day before.
  const dossierId = newToken(8);
  const yesterday = new Date(Date.now() - 86400_000).toISOString();
  await q(
    "INSERT INTO dossiers (id, piece_id, desk_id, state, signed_by, signed_at, history) VALUES ($1,$2,$3,'stored',NULL,NULL,$4)",
    [dossierId, pieceIds.bentwood!, deskIds.agnese!, JSON.stringify([
      { at: yesterday, who: "Agnese Ferrero", what: "asked" },
      { at: yesterday, who: "Agnese Ferrero", what: "rendered" },
      { at: yesterday, who: "Agnese Ferrero", what: "stored" },
    ])]
  );
  const seededDossierPdf = await renderDossierPdf(deskIds.agnese!, pieceIds.bentwood!);
  const pdfOk = seededDossierPdf ? await s3.put(`dossiers/${deskIds.agnese!}/${pieceIds.bentwood!}/${dossierId}.pdf`, seededDossierPdf, "application/pdf") : false;
  if (pdfOk) {
    const signedAt = new Date(Date.now() - 86400_000).toISOString();
    await q("UPDATE dossiers SET state='signed', signed_by=$1, signed_at=$2, history=$3 WHERE id=$4", [
      "Agnese Ferrero", signedAt,
      JSON.stringify([
        { at: signedAt, who: "Agnese Ferrero", what: "asked" },
        { at: signedAt, who: "Agnese Ferrero", what: "rendered" },
        { at: signedAt, who: "Agnese Ferrero", what: "stored" },
        { at: signedAt, who: "Agnese Ferrero", what: "signed" },
      ]),
      dossierId,
    ]);
  } else {
    await q("UPDATE dossiers SET state='waiting' WHERE id=$1", [dossierId]);
  }
  void deskIds;
}

/** Next New York clock-change date (March second Sunday / November first Sunday) on or after start. */
function nextNyClockChange(start: string): string {
  const year = Number(start.slice(0, 4));
  for (let yy = year; yy <= year + 2; yy++) {
    const march = nthSunday(yy, 3, 2);
    const nov = nthSunday(yy, 11, 1);
    if (march >= start) return march;
    if (nov >= start) return nov;
  }
  return nthSunday(year + 1, 3, 2);
}
function nthSunday(year: number, month: number, n: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (7 - first.getUTCDay()) % 7;
  return `${year}-${String(month).padStart(2, "0")}-${String(1 + offset + (n - 1) * 7).padStart(2, "0")}`;
}
function mondayBefore(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  const back = dow === 1 ? -7 : -((dow + 6) % 7);
  return addDaysISO(date, back);
}
function mondayAfter(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  const forward = dow === 1 ? 0 : (8 - dow) % 7 || 7;
  return addDaysISO(date, forward);
}

