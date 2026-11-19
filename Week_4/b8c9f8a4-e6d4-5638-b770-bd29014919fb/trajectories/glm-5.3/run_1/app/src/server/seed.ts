import pg from 'pg';
import sharp from 'sharp';
import bcrypt from 'bcryptjs';
import type { Config } from './db.js';
import { pool } from './db.js';
import type { Store } from './store.js';
import { seedUuid, tokenHash, sha256Hex, uuid } from './crypto.js';
import { type PanelId } from './panels.js';
import { conditionReportHtml, diagramSvg, type ReportBody } from './reports.js';
import { renderPdf } from './providers.js';
import { pullRecord } from './providerRecord.js';
import { advisoryIdentity } from './record.js';
import { readFindings, readPanels, readWorkingRecord, findingFingerprint } from './model.js';

const OWNER_PASSPHRASE = 'bonnet-up-at-dawn';

/** Generated photo bytes: an invented gradient scene with GPS EXIF and no real photograph. */
async function generatePhoto(seedText: string): Promise<Buffer> {
  const w = 1280;
  const h = 960;
  const hue = (sha256Hex(seedText).charCodeAt(0) * 3) % 360;
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="hsl(${hue}, 45%, 78%)"/>
        <stop offset="1" stop-color="hsl(${(hue + 60) % 360}, 38%, 62%)"/>
      </linearGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>
    ${panelShapes(seedText, w, h)}
  </svg>`);
  const png = await sharp(svg).png().toBuffer();
  const jpeg = await sharp(png).jpeg({ quality: 80 }).toBuffer();
  return withGpsExif(jpeg);
}

/**
 * Insert a minimal EXIF APP1 segment holding a GPS IFD pointer so the original carries
 * location data, as the seed photos require. The bytes are written directly into the JPEG.
 */
function withGpsExif(jpeg: Buffer): Buffer {
  // TIFF header (big endian) with one IFD entry: tag 0x8825 (GPSInfo IFD pointer).
  const tiff = Buffer.alloc(26);
  tiff.write('MM\x00\x2a', 0, 'binary');
  tiff.writeUInt32BE(8, 4);      // first IFD offset
  tiff.writeUInt16BE(1, 8);     // one entry
  tiff.writeUInt16BE(0x8825, 10); // GPSInfo IFD pointer
  tiff.writeUInt16BE(4, 12);    // LONG
  tiff.writeUInt32BE(1, 14);    // count
  tiff.writeUInt32BE(26, 18);   // value: offset of the GPS IFD
  tiff.writeUInt32BE(0, 22);    // next IFD: none
  const gpsIfd = Buffer.from([0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]); // one-entry GPS IFD
  const app1Body = Buffer.concat([Buffer.from('Exif\x00\x00', 'binary'), tiff, gpsIfd]);
  const lengthBytes = Buffer.alloc(2);
  lengthBytes.writeUInt16BE(app1Body.length + 2, 0);
  const segment = Buffer.concat([Buffer.from([0xff, 0xe1]), lengthBytes, app1Body]);
  // Insert after the SOI marker.
  const insertAt = 2;
  return Buffer.concat([jpeg.subarray(0, insertAt), segment, jpeg.subarray(insertAt)]);
}

function panelShapes(seed: string, w: number, h: number): string {
  const n = 7;
  let out = '';
  for (let i = 0; i < n; i++) {
    const r = sha256Hex(`${seed}:${i}`);
    const x = (parseInt(r.slice(0, 4), 16) % (w - 240));
    const y = (parseInt(r.slice(4, 8), 16) % (h - 240));
    const s = 120 + (parseInt(r.slice(8, 12), 16) % 100);
    out += `<rect x="${x}" y="${y}" width="${s}" height="${s * 0.6}" rx="18" fill="hsl(${(i * 47) % 360}, 30%, 40%)" opacity="0.5"/>`;
  }
  return out;
}

async function generateInvoice(): Promise<Buffer> {
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1100">
    <rect width="800" height="1100" fill="#f7f5fb"/>
    <text x="60" y="120" font-family="Helvetica" font-size="44" fill="#181830">Wing respray invoice, 2019</text>
    <text x="60" y="200" font-family="Helvetica" font-size="24" fill="#181830">Offside front wing, respray and blend.</text>
  </svg>`);
  return sharp(svg).png().toBuffer();
}

interface SeedFinding { panelId: PanelId; u: number; v: number; severity: string; title: string; wording: string }

const CAR1_FINDINGS: SeedFinding[] = [
  { panelId: 'bonnet', u: 0.500, v: 0.120, severity: 'cosmetic', title: 'Stone chips', wording: 'Stone chips along the leading edge, touched in by hand.' },
  { panelId: 'os-front-wing', u: 0.420, v: 0.610, severity: 'moderate', title: 'Resprayed wing', wording: 'Wing resprayed in 2019 after a car park scrape. Invoice on file.' },
  { panelId: 'os-door', u: 0.700, v: 0.550, severity: 'cosmetic', title: 'Door dent', wording: 'Small dent below the handle, paint unbroken.' },
  { panelId: 'os-sill', u: 0.720, v: 0.400, severity: 'serious', title: 'Sill filler', wording: 'Filler in the rear third of the sill over a repaired rust patch.' },
  { panelId: 'boot-lid', u: 0.500, v: 0.800, severity: 'cosmetic', title: 'Lid lacquer', wording: 'Lacquer dulled around the badge.' },
  { panelId: 'rear-bumper', u: 0.850, v: 0.500, severity: 'cosmetic', title: 'Corner scuff', wording: 'Scuffing on the nearside corner of the bumper.' },
  { panelId: 'ns-rear-quarter', u: 0.650, v: 0.700, severity: 'moderate', title: 'Arch bubbling', wording: 'Paint bubbling starting at the arch lip.' },
  { panelId: 'ns-door', u: 0.150, v: 0.900, severity: 'cosmetic', title: 'Window rubber', wording: 'Window rubber perished at the rear edge.' },
  { panelId: 'roof', u: 0.500, v: 0.500, severity: 'moderate', title: 'Faded clear coat', wording: 'Clear coat fading across the centre of the roof.' },
];

const CAR1_READINGS: { panelId: PanelId; microns: number }[] = [
  { panelId: 'bonnet', microns: 96 },
  { panelId: 'os-front-wing', microns: 236 },
  { panelId: 'os-door', microns: 121 },
  { panelId: 'os-sill', microns: 428 },
  { panelId: 'os-rear-quarter', microns: 124 },
  { panelId: 'boot-lid', microns: 104 },
  { panelId: 'ns-rear-quarter', microns: 117 },
  { panelId: 'ns-sill', microns: 122 },
  { panelId: 'ns-door', microns: 119 },
  { panelId: 'ns-front-wing', microns: 116 },
  { panelId: 'roof', microns: 118 },
];

const ADVISORY_RESPONSES: { text: string; motTestNumber: string; stance: string; note: string }[] = [
  { text: 'Nearside front tyre worn close to legal limit', motTestNumber: '730000000106', stance: 'repaired', note: 'Pair of new tyres fitted in March 2021' },
  { text: 'Front brake disc slightly pitted', motTestNumber: '730000000612', stance: 'repaired', note: 'Discs and pads replaced in April 2026' },
  { text: 'Offside sill corroded but not seriously weakened', motTestNumber: '730000000612', stance: 'monitoring', note: 'This is the repaired area listed on the sill' },
];

/**
 * Seed all or nothing: an instance that cannot reach MinIO, Gotenberg or the record API
 * skips seeding, and exactly one instance that can reach them completes it.
 */
export async function seedIfEmpty(cfg: Config, store: Store): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(`SELECT value FROM app_config WHERE key = 'seed_done' FOR UPDATE`);
    if (existing.rows.length > 0) { await client.query('COMMIT'); return; }
    await client.query('COMMIT');
  } finally { client.release(); }

  // Check providers before writing anything.
  const probe1 = await pullRecord(cfg, 'S482KVT');
  const probe2 = await pullRecord(cfg, 'T317HJN');
  if ('failure' in probe1 || 'failure' in probe2) return;
  try {
    await store.put(`seed-probe/${uuid()}`, Buffer.from('ok'), 'text/plain');
  } catch { return; }

  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const hash = await bcrypt.hash(OWNER_PASSPHRASE, 10);
    await c.query(`INSERT INTO app_config (key, value) VALUES ('owner_passphrase_hash', $1) ON CONFLICT (key) DO NOTHING`, [hash]);

    const car1Id = seedUuid('car-1');
    const car2Id = seedUuid('car-2');
    await c.query(
      `INSERT INTO cars (id, name, registration, asking_pounds, viewing_area, home_address, story, seed_key)
       VALUES ($1,'1998 Calder Merrow GT','S482KVT',16950,'Near Hexham','7 Larkfield Close, Hexham NE46 9ZZ','Twenty-two years in one family, used on dry weekends. Every mark on it is listed here.','seed-car-1')
       ON CONFLICT (id) DO NOTHING`,
      [car1Id]);
    await c.query(
      `INSERT INTO cars (id, name, registration, asking_pounds, viewing_area, home_address, story, seed_key)
       VALUES ($1,'1999 Calder Tern 1.8','T317HJN',6200,'Near Hexham','7 Larkfield Close, Hexham NE46 9ZZ','A daily driver that never let anyone down.','seed-car-2')
       ON CONFLICT (id) DO NOTHING`,
      [car2Id]);

    for (const r of CAR1_READINGS) {
      await c.query(`INSERT INTO readings (car_id, panel_id, microns) VALUES ($1,$2,$3) ON CONFLICT (car_id, panel_id) DO NOTHING`, [car1Id, r.panelId, r.microns]);
    }

    // Findings with one generated photo each.
    const photoIds = new Map<number, string>();
    for (let i = 0; i < CAR1_FINDINGS.length; i++) {
      const bytes = await generatePhoto(`car1-finding-${i}`);
      const uploadId = seedUuid(`car1-photo-${i}`);
      const originalSha = sha256Hex(bytes);
      await store.put(store.originalKey(car1Id, uploadId), bytes, 'image/jpeg');
      const upright = await sharp(bytes, { failOn: 'error' }).rotate().toBuffer({ resolveWithObject: true });
      const mask = { x: 0.35, y: 0.70, w: 0.30, h: 0.12 };
      const rect = {
        left: Math.round(mask.x * upright.info.width), top: Math.round(mask.y * upright.info.height),
        width: Math.round(mask.w * upright.info.width), height: Math.round(mask.h * upright.info.height),
      };
      const maskSvg = Buffer.from(`<svg width="${upright.info.width}" height="${upright.info.height}"><rect x="${rect.left}" y="${rect.top}" width="${rect.width}" height="${rect.height}" fill="#141422"/></svg>`);
      const derivative = await sharp(upright.data, { failOn: 'error' }).composite([{ input: maskSvg, top: 0, left: 0 }]).jpeg({ quality: 84 }).toBuffer();
      const derivativeSha = sha256Hex(derivative);
      await store.put(store.derivativeKey(car1Id, uploadId), derivative, 'image/jpeg');
      await c.query(
        `INSERT INTO uploads (id, car_id, kind, file_name, sha256, bytes, content_type, derivative_sha256, location_removed, label)
         VALUES ($1,$2,'photo',$3,$4,$5,'image/jpeg',$6,true,null)`,
        [uploadId, car1Id, `finding-${i + 1}.jpg`, originalSha, bytes.length, derivativeSha]);
      photoIds.set(i, uploadId);
    }

    let position = 1;
    for (let i = 0; i < CAR1_FINDINGS.length; i++) {
      const f = CAR1_FINDINGS[i];
      const id = seedUuid(`car1-finding-${i}`);
      await c.query(
        `INSERT INTO findings (id, car_id, panel_id, u, v, title, wording, severity, photo_id, position)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, car1Id, f.panelId, f.u, f.v, f.title, f.wording, f.severity, photoIds.get(i) ?? null, position++]);
    }

    // One invoice.
    const invoiceBytes = await generateInvoice();
    const invoiceId = seedUuid('car1-invoice');
    await store.put(store.originalKey(car1Id, invoiceId), invoiceBytes, 'image/png');
    await c.query(
      `INSERT INTO uploads (id, car_id, kind, file_name, sha256, bytes, content_type, derivative_sha256, location_removed, label)
       VALUES ($1,$2,'invoice','wing-respray-2019.png',$3,$4,'image/png',null,false,$5)`,
      [invoiceId, car1Id, sha256Hex(invoiceBytes), invoiceBytes.length, 'Wing respray invoice, 2019']);

    // Pull records for car 1.
    await c.query('INSERT INTO record_pulls (car_id, first_used_date, payload) VALUES ($1,$2,$3)', [car1Id, probe1.record.firstUsedDate, JSON.stringify(probe1.record)]);
    await c.query('UPDATE cars SET pulled_at = now() WHERE id = $1', [car1Id]);
    for (const a of ADVISORY_RESPONSES) {
      await c.query(
        `INSERT INTO advisory_responses (car_id, advisory_key, stance, note) VALUES ($1,$2,$3,$4) ON CONFLICT (car_id, advisory_key) DO NOTHING`,
        [car1Id, advisoryIdentity(a.motTestNumber, a.text), a.stance, a.note]);
    }

    // Links.
    const links: { person: string; role: string; token: string; seedKey: string }[] = [
      { person: 'Rowan Hale', role: 'buyer', token: 'seed-buyer-rowan-7f3c9a1e', seedKey: 'link-rowan' },
      { person: 'Dev Marlowe', role: 'buyer', token: 'seed-buyer-dev-91ae57f3', seedKey: 'link-dev' },
      { person: 'Imogen Achebe', role: 'buyer', token: 'seed-buyer-imogen-42d8b06c', seedKey: 'link-imogen' },
      { person: 'Tam Okafor', role: 'inspector', token: 'seed-inspector-tam-2b81d4c6', seedKey: 'link-tam' },
    ];
    for (const l of links) {
      await c.query(
        `INSERT INTO links (id, car_id, role, name, token_hash, status, expires_at, seed_key)
         VALUES ($1,$2,$3,$4,$5,'active', now() + ($6 || ' seconds')::interval, $7)`,
        [seedUuid(l.seedKey), car1Id, l.role, l.person, tokenHash(l.token), String(cfg.linkTtlSeconds), `seed-${l.seedKey}`]);
    }

    // Seen records: Dev has seen findings 1 to 4; Imogen has seen all 9.
    const findingIds = CAR1_FINDINGS.map((_, i) => seedUuid(`car1-finding-${i}`));
    const devId = seedUuid('link-dev');
    const imogenId = seedUuid('link-imogen');
    const fingerprints = new Map<number, string>();
    for (let i = 0; i < CAR1_FINDINGS.length; i++) {
      const f = CAR1_FINDINGS[i];
      fingerprints.set(i, findingFingerprint({ panelId: f.panelId, u: f.u, v: f.v, title: f.title, wording: f.wording, severity: f.severity, photoId: photoIds.get(i) ?? null }));
    }
    for (let i = 0; i < 4; i++) {
      await c.query(`INSERT INTO seen_records (link_id, finding_id, finding_fingerprint) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [devId, findingIds[i], fingerprints.get(i)]);
    }
    for (let i = 0; i < 9; i++) {
      await c.query(`INSERT INTO seen_records (link_id, finding_id, finding_fingerprint) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [imogenId, findingIds[i], fingerprints.get(i)]);
    }
    await c.query('UPDATE links SET last_seen_at = now() WHERE id = ANY($1::uuid[])', [[devId, imogenId]]);

    // Three viewing slots, 45 minutes at 10:30 London on the first three Saturdays at least 7 days out.
    const saturdays = nextThreeSaturdays();
    let slotIdx = 0;
    let firstSlotId = '';
    for (const when of saturdays) {
      slotIdx += 1;
      const id = seedUuid(`slot-${slotIdx}`);
      if (slotIdx === 1) firstSlotId = id;
      await c.query(
        `INSERT INTO slots (id, car_id, starts_at, duration_minutes, seed_key) VALUES ($1,$2,$3,45,$4) ON CONFLICT (id) DO NOTHING`,
        [id, car1Id, when, `seed-slot-${slotIdx}`]);
    }
    // Imogen holds the first slot, written directly with no claim and no alert.
    await c.query(`UPDATE slots SET holder_link_id = $1 WHERE id = $2`, [imogenId, firstSlotId]);

    // Imogen's open offer, stamped at seed time with no offer action and no alert.
    const offerId = seedUuid('offer-imogen');
    await c.query(
      `INSERT INTO offers (id, car_id, link_id, amount_pounds, status, stamped_at, lapses_at)
       VALUES ($1,$2,$3,15400,'open', now(), now() + ($4 || ' seconds')::interval)`,
      [offerId, car1Id, imogenId, String(cfg.offerLapseSeconds)]);

    // Publish version 1: freeze findings, panels and record, render and store the report.
    const findings = await readFindings(c, car1Id);
    const { panels } = await readPanels(c, car1Id, 'owner');
    const record = await readWorkingRecord(c, car1Id);
    const findingsFrozen = findings.map(f => ({ ...f, fingerprint: findingFingerprint(f) }));
    const content = { findings: findingsFrozen, panels, record };
    const reportBody: ReportBody = {
      diagramSvg: '',
      findings: findings.map(f => ({ title: f.title, wording: f.wording, severity: f.severity, panelLabel: f.panelLabel, band: f.band })),
      readings: (panels as { label: string; owner: { microns: number; band: string } | null }[]).map(p => ({ panel: p.label, microns: p.owner ? String(p.owner.microns) : 'No reading', band: p.owner ? p.owner.band : 'No reading' })),
      tape: (record?.tape ?? []).map(t => ({ date: t.completedDate.slice(0, 10), result: t.testResult, value: t.odometerValue ?? '', unit: t.odometerUnit ?? '', flag: t.flag ?? '' })),
      advisories: (record?.advisories ?? []).map(a => ({ text: a.text, stance: a.stance ?? 'Unanswered', note: a.note ?? '' })),
      openAdvisories: record?.openAdvisories ?? 0,
    };
    const { svg } = diagramSvg(findings.map(f => ({ panelId: f.panelId, u: f.u, v: f.v, title: f.title })));
    const html = conditionReportHtml({ name: '1998 Calder Merrow GT', maskedRegistration: 'S4*****', version: 1 }, { ...reportBody, diagramSvg: svg });
    const pdf = await renderPdf(cfg, html);
    const reportSha = sha256Hex(pdf);
    await store.put(store.reportKey(car1Id, 1), pdf, 'application/pdf');
    await c.query('INSERT INTO versions (car_id, number, report_sha256, content) VALUES ($1,1,$2,$3)', [car1Id, reportSha, JSON.stringify(content)]);
    await c.query(`UPDATE cars SET listing_status = 'live', current_version = 1 WHERE id = $1`, [car1Id]);

    await c.query(`INSERT INTO app_config (key, value) VALUES ('seed_done', now()::text) ON CONFLICT (key) DO NOTHING`);
    await c.query('COMMIT');
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally { c.release(); }
}

/** The first three Saturdays that fall at least 7 days after now, at 10:30 London time. */
function nextThreeSaturdays(): Date[] {
  const out: Date[] = [];
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 7);
  while (d.getUTCDay() !== 6) d.setUTCDate(d.getUTCDate() + 1);
  for (let i = 0; i < 3; i++) {
    const sat = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + i * 7, 10, 30));
    out.push(sat);
  }
  return out;
}
