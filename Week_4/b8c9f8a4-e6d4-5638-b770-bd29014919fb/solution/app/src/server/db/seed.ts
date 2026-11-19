// The published seed. It runs once: an instance that cannot reach the object store, the renderer
// or the record API skips it, and exactly one instance that can reach them completes it.

import { createHash, randomBytes, randomUUID } from 'node:crypto';

/** A stable UUID for a seeded row, so the same seed gives the same ids on every start. */
function seedId(name: string): string {
  const h = createHash('sha256').update(`open-bonnet-seed:${name}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
import { lockKey, one, query, withSessionLock } from '../db/pool.js';
import { passphraseHash } from '../routes/owner-cars.js';
import { advisoryId } from '../domain/record.js';
import { contentHash } from '../domain/findings.js';
import { insertLink } from '../domain/links.js';
import { publishCar } from '../domain/publish.js';
import { storeUpload } from '../domain/uploads.js';
import { lapsesAt } from '../domain/offers.js';
import { pullRecord, recordApiReachable } from '../services/record-api.js';
import { renderPdf, rendererReachable } from '../services/render.js';
import { storeReachable } from '../services/store.js';
import { buildExifSegment, withExif } from '../services/exif.js';
import { seedPhoto, invoiceHtml } from './seed-art.js';
import { localStartOf, saturdaysAt } from '../../shared/london.js';

const PASSPHRASE = 'bonnet-up-at-dawn';
const SEED_MASK = { x: 0.35, y: 0.7, w: 0.3, h: 0.12 };

const CAR_ONE = {
  name: '1998 Calder Merrow GT',
  registration: 'S482 KVT',
  askingPounds: 16950,
  viewingArea: 'Near Hexham',
  homeAddress: '7 Larkfield Close, Hexham NE46 9ZZ',
  story: 'Twenty-two years in one family, used on dry weekends. Every mark on it is listed here.',
};

const CAR_TWO = {
  name: '1999 Calder Tern 1.8',
  registration: 'T317 HJN',
  askingPounds: 6200,
  viewingArea: 'Near Hexham',
  homeAddress: '7 Larkfield Close, Hexham NE46 9ZZ',
  story: 'A daily driver that never let anyone down.',
};

const READINGS: [string, number][] = [
  ['bonnet', 96],
  ['os-front-wing', 236],
  ['os-door', 121],
  ['os-sill', 428],
  ['os-rear-quarter', 124],
  ['boot-lid', 104],
  ['ns-rear-quarter', 117],
  ['ns-sill', 122],
  ['ns-door', 119],
  ['ns-front-wing', 116],
  ['roof', 118],
];

export interface SeedFinding {
  panelId: string;
  u: number;
  v: number;
  severity: 'cosmetic' | 'moderate' | 'serious';
  title: string;
  wording: string;
}

const FINDINGS: SeedFinding[] = [
  { panelId: 'bonnet', u: 0.5, v: 0.12, severity: 'cosmetic', title: 'Stone chips',
    wording: 'Stone chips along the leading edge, touched in by hand.' },
  { panelId: 'os-front-wing', u: 0.42, v: 0.61, severity: 'moderate', title: 'Resprayed wing',
    wording: 'Wing resprayed in 2019 after a car park scrape. Invoice on file.' },
  { panelId: 'os-door', u: 0.7, v: 0.55, severity: 'cosmetic', title: 'Door dent',
    wording: 'Small dent below the handle, paint unbroken.' },
  { panelId: 'os-sill', u: 0.72, v: 0.4, severity: 'serious', title: 'Sill filler',
    wording: 'Filler in the rear third of the sill over a repaired rust patch.' },
  { panelId: 'boot-lid', u: 0.5, v: 0.8, severity: 'cosmetic', title: 'Lid lacquer',
    wording: 'Lacquer dulled around the badge.' },
  { panelId: 'rear-bumper', u: 0.85, v: 0.5, severity: 'cosmetic', title: 'Corner scuff',
    wording: 'Scuffing on the nearside corner of the bumper.' },
  { panelId: 'ns-rear-quarter', u: 0.65, v: 0.7, severity: 'moderate', title: 'Arch bubbling',
    wording: 'Paint bubbling starting at the arch lip.' },
  { panelId: 'ns-door', u: 0.15, v: 0.9, severity: 'cosmetic', title: 'Window rubber',
    wording: 'Window rubber perished at the rear edge.' },
  { panelId: 'roof', u: 0.5, v: 0.5, severity: 'moderate', title: 'Faded clear coat',
    wording: 'Clear coat fading across the centre of the roof.' },
];

const RESPONSES: [string, string, string, string][] = [
  ['730000000106', 'Nearside front tyre worn close to legal limit', 'repaired', 'Pair of new tyres fitted in March 2021'],
  ['730000000612', 'Front brake disc slightly pitted', 'repaired', 'Discs and pads replaced in April 2026'],
  ['730000000612', 'Offside sill corroded but not seriously weakened', 'monitoring', 'This is the repaired area listed on the sill'],
];

const LINKS: { name: string; role: 'buyer' | 'inspector'; token: string }[] = [
  { name: 'Rowan Hale', role: 'buyer', token: 'seed-buyer-rowan-7f3c9a1e' },
  { name: 'Dev Marlowe', role: 'buyer', token: 'seed-buyer-dev-91ae57f3' },
  { name: 'Imogen Achebe', role: 'buyer', token: 'seed-buyer-imogen-42d8b06c' },
  { name: 'Tam Okafor', role: 'inspector', token: 'seed-inspector-tam-2b81d4c6' },
];

const IMOGEN_OFFER_POUNDS = 15400;

async function alreadySeeded(): Promise<boolean> {
  return (await one('SELECT 1 AS found FROM seed_state WHERE id = 1')) !== null;
}

export async function seedIfNeeded(): Promise<void> {
  if (await alreadySeeded()) return;
  const reachable = await Promise.all([storeReachable(), rendererReachable(), recordApiReachable()]);
  if (reachable.some((ok) => !ok)) {
    process.stdout.write('seed skipped: a backing service is not reachable\n');
    return;
  }
  const outcome = await withSessionLock(lockKey('seed', 'open-bonnet'), async () => {
    if (await alreadySeeded()) return 'already';
    await seed();
    await query('INSERT INTO seed_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
    return 'seeded';
  });
  process.stdout.write(`seed ${outcome === 'busy' ? 'left to another instance' : outcome}\n`);
}

async function seed(): Promise<void> {
  const salt = randomBytes(16).toString('hex');
  await query(
    'INSERT INTO owner_secret (id, passphrase_hash) VALUES (1, $1) ON CONFLICT (id) DO NOTHING',
    [`${salt}:${passphraseHash(PASSPHRASE, salt)}`],
  );

  const carOneId = await insertCar(CAR_ONE);
  await insertCar(CAR_TWO);

  for (const [panelId, microns] of READINGS) {
    await query('INSERT INTO reading (car_id, panel_id, microns) VALUES ($1, $2, $3)', [carOneId, panelId, microns]);
  }

  for (const finding of FINDINGS) {
    const art = await seedPhoto(finding);
    const data = withExif(art, buildExifSegment(1, true));
    const photo = await storeUpload({
      carId: carOneId,
      kind: 'photo',
      fileName: `${finding.panelId}.jpg`,
      bytes: data,
      contentType: 'image/jpeg',
      mask: SEED_MASK,
      label: null,
      id: seedId(`photo:${finding.panelId}`),
    });
    await query(
      `INSERT INTO finding (id, car_id, panel_id, u, v, title, wording, severity, photo_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [randomUUID(), carOneId, finding.panelId, finding.u, finding.v, finding.title, finding.wording,
        finding.severity, photo.id],
    );
  }

  const invoice = await renderPdf(invoiceHtml());
  await storeUpload({
    carId: carOneId,
    kind: 'invoice',
    fileName: 'wing-respray-2019.pdf',
    bytes: invoice,
    contentType: 'application/pdf',
    mask: null,
    label: 'Wing respray invoice, 2019',
  });

  const pulled = await pullRecord('S482KVT');
  if (pulled.kind !== 'ok') throw new Error('the record service did not answer at seed time');
  await query('INSERT INTO record_pull (id, car_id, payload) VALUES ($1, $2, $3)', [
    randomUUID(),
    carOneId,
    JSON.stringify(pulled.payload),
  ]);
  for (const [testNumber, text, stance, note] of RESPONSES) {
    await query(
      'INSERT INTO advisory_response (car_id, advisory_id, stance, note) VALUES ($1, $2, $3, $4)',
      [carOneId, advisoryId(testNumber, text), stance, note],
    );
  }

  await publishCar(carOneId);

  const issued = new Map<string, string>();
  for (const link of LINKS) {
    const row = await insertLink(carOneId, link.role, link.name, link.token);
    issued.set(link.name, row.id);
  }

  const slots = saturdaysAt(new Date(), 7, 10, 30, 3);
  const slotIds: string[] = [];
  for (const start of slots) {
    const id = randomUUID();
    slotIds.push(id);
    await query(
      'INSERT INTO slot (id, car_id, local_start, starts_at, duration_minutes) VALUES ($1, $2, $3, $4, 45)',
      [id, carOneId, localStartOf(start), start],
    );
  }

  const findings = await query<{ id: string; panel_id: string; u: number; v: number; title: string; wording: string; severity: 'cosmetic' | 'moderate' | 'serious'; photo_id: string | null }>(
    'SELECT * FROM finding WHERE car_id = $1',
    [carOneId],
  );
  // every seeded finding was inserted above, and both links were issued above
  const inOrder = FINDINGS.map((wanted) =>
    findings.find((row) => row.panel_id === wanted.panelId && row.title === wanted.title) as (typeof findings)[number],
  );

  const dev = issued.get('Dev Marlowe') as string;
  const imogen = issued.get('Imogen Achebe') as string;
  for (const [index, finding] of inOrder.entries()) {
    const hash = contentHash(finding);
    if (index < 4) {
      await query('INSERT INTO seen_record (link_id, finding_id, content_hash) VALUES ($1, $2, $3)',
        [dev, finding.id, hash]);
    }
    await query('INSERT INTO seen_record (link_id, finding_id, content_hash) VALUES ($1, $2, $3)',
      [imogen, finding.id, hash]);
  }

  const stampedAt = new Date();
  await query(
    `INSERT INTO offer (id, car_id, link_id, amount_pounds, status, stamped_at, lapses_at)
     VALUES ($1, $2, $3, $4, 'open', $5, $6)`,
    [randomUUID(), carOneId, imogen, IMOGEN_OFFER_POUNDS, stampedAt, lapsesAt(stampedAt)],
  );
  await query('UPDATE slot SET holder_link_id = $2 WHERE id = $1', [slotIds[0], imogen]);
}

async function insertCar(car: typeof CAR_ONE): Promise<string> {
  const id = randomUUID();
  await query(
    `INSERT INTO car (id, name, registration, asking_pounds, viewing_area, home_address, story, listing_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft')`,
    [id, car.name, car.registration.replace(/\s+/g, '').toUpperCase(), car.askingPounds, car.viewingArea,
      car.homeAddress, car.story],
  );
  return id;
}
