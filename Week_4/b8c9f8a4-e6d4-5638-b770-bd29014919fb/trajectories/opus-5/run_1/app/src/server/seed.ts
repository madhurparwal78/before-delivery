import { randomUUID } from 'node:crypto';
import { londonParts } from '../shared/format';
import { panelById } from '../shared/panels';
import type { Severity, Stance } from '../shared/types';
import { config } from './config';
import { pool, query, queryOne } from './db';
import { resolveLondonLocalStart } from './domain/london';
import { contentHashOfFrozen, loadVersion } from './repo/versions';
import { insertLink } from './repo/links';
import { transaction } from './db';
import { hashPassphrase } from './http/session';
import { publishCar } from './services/publishing';
import { recordApiReachable } from './services/recordApi';
import { gotenbergReachable } from './services/gotenberg';
import { ensureBucket, storageReachable } from './services/storage';
import { pullVehicleRecord } from './services/recordApi';
import { seedInvoiceBytes, seedPhotoBytes } from './services/seedImages';
import { storeUpload } from './services/uploads';

const OWNER_PASSPHRASE = 'bonnet-up-at-dawn';

const CAR_ONE_READINGS: readonly (readonly [string, number])[] = [
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

interface SeedFinding {
  panelId: string;
  u: number;
  v: number;
  severity: Severity;
  title: string;
  wording: string;
}

const CAR_ONE_FINDINGS: readonly SeedFinding[] = [
  {
    panelId: 'bonnet',
    u: 0.5,
    v: 0.12,
    severity: 'cosmetic',
    title: 'Stone chips',
    wording: 'Stone chips along the leading edge, touched in by hand.',
  },
  {
    panelId: 'os-front-wing',
    u: 0.42,
    v: 0.61,
    severity: 'moderate',
    title: 'Resprayed wing',
    wording: 'Wing resprayed in 2019 after a car park scrape. Invoice on file.',
  },
  {
    panelId: 'os-door',
    u: 0.7,
    v: 0.55,
    severity: 'cosmetic',
    title: 'Door dent',
    wording: 'Small dent below the handle, paint unbroken.',
  },
  {
    panelId: 'os-sill',
    u: 0.72,
    v: 0.4,
    severity: 'serious',
    title: 'Sill filler',
    wording: 'Filler in the rear third of the sill over a repaired rust patch.',
  },
  {
    panelId: 'boot-lid',
    u: 0.5,
    v: 0.8,
    severity: 'cosmetic',
    title: 'Lid lacquer',
    wording: 'Lacquer dulled around the badge.',
  },
  {
    panelId: 'rear-bumper',
    u: 0.85,
    v: 0.5,
    severity: 'cosmetic',
    title: 'Corner scuff',
    wording: 'Scuffing on the nearside corner of the bumper.',
  },
  {
    panelId: 'ns-rear-quarter',
    u: 0.65,
    v: 0.7,
    severity: 'moderate',
    title: 'Arch bubbling',
    wording: 'Paint bubbling starting at the arch lip.',
  },
  {
    panelId: 'ns-door',
    u: 0.15,
    v: 0.9,
    severity: 'cosmetic',
    title: 'Window rubber',
    wording: 'Window rubber perished at the rear edge.',
  },
  {
    panelId: 'roof',
    u: 0.5,
    v: 0.5,
    severity: 'moderate',
    title: 'Faded clear coat',
    wording: 'Clear coat fading across the centre of the roof.',
  },
];

const SEED_PLATE_MASK = { x: 0.35, y: 0.7, w: 0.3, h: 0.12 } as const;

const ADVISORY_RESPONSES: readonly (readonly [string, Stance, string])[] = [
  ['Nearside front tyre worn close to legal limit', 'repaired', 'Pair of new tyres fitted in March 2021'],
  ['Front brake disc slightly pitted', 'repaired', 'Discs and pads replaced in April 2026'],
  [
    'Offside sill corroded but not seriously weakened',
    'monitoring',
    'This is the repaired area listed on the sill',
  ],
];

const SEED_LINKS: readonly { name: string; role: 'buyer' | 'inspector'; token: string }[] = [
  { name: 'Rowan Hale', role: 'buyer', token: 'seed-buyer-rowan-7f3c9a1e' },
  { name: 'Dev Marlowe', role: 'buyer', token: 'seed-buyer-dev-91ae57f3' },
  { name: 'Imogen Achebe', role: 'buyer', token: 'seed-buyer-imogen-42d8b06c' },
  { name: 'Tam Okafor', role: 'inspector', token: 'seed-inspector-tam-2b81d4c6' },
];

/** The first three Saturdays that fall at least 7 days after seed time, at 10:30 London. */
const seedSlotStarts = (now: Date): { localStart: string; startsAt: Date }[] => {
  const earliest = now.getTime() + 7 * 86_400_000;
  const out: { localStart: string; startsAt: Date }[] = [];
  let probe = new Date(earliest);
  while (out.length < 3) {
    const parts = londonParts(probe);
    if (parts.weekday === 6) {
      const localStart = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}T10:30`;
      const resolved = resolveLondonLocalStart(localStart);
      if (resolved.startsAt !== null && resolved.startsAt.getTime() >= earliest) {
        out.push({ localStart, startsAt: resolved.startsAt });
      }
    }
    probe = new Date(probe.getTime() + 86_400_000);
  }
  return out;
};

const seedCarOne = async (now: Date): Promise<void> => {
  const carId = randomUUID();
  await query(
    `INSERT INTO car (id, name, registration, asking_pounds, viewing_area, home_address, story, listing_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft')`,
    [
      carId,
      '1998 Calder Merrow GT',
      'S482KVT',
      16_950,
      'Near Hexham',
      '7 Larkfield Close, Hexham NE46 9ZZ',
      'Twenty-two years in one family, used on dry weekends. Every mark on it is listed here.',
    ],
  );

  for (const [panelId, microns] of CAR_ONE_READINGS) {
    await query('INSERT INTO panel_reading (car_id, panel_id, microns) VALUES ($1, $2, $3)', [
      carId,
      panelId,
      microns,
    ]);
  }

  for (const [index, finding] of CAR_ONE_FINDINGS.entries()) {
    const panel = panelById(finding.panelId);
    if (panel === undefined) throw new Error(`Unknown seed panel ${finding.panelId}`);
    const photo = await storeUpload({
      carId,
      kind: 'photo',
      fileName: `${finding.panelId}-${index + 1}.jpg`,
      bytes: await seedPhotoBytes(index, panel.label),
      mask: { ...SEED_PLATE_MASK },
      label: null,
    });
    await query(
      `INSERT INTO finding (id, car_id, panel_id, u, v, title, wording, severity, photo_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        randomUUID(),
        carId,
        finding.panelId,
        finding.u,
        finding.v,
        finding.title,
        finding.wording,
        finding.severity,
        photo.id,
      ],
    );
  }

  await storeUpload({
    carId,
    kind: 'invoice',
    fileName: 'wing-respray-2019.png',
    bytes: await seedInvoiceBytes(),
    mask: null,
    label: 'Wing respray invoice, 2019',
  });

  const payload = await pullVehicleRecord('S482KVT');
  await query('INSERT INTO record_pull (id, car_id, pulled_at, first_used_date, payload) VALUES ($1, $2, $3, $4, $5)', [
    randomUUID(),
    carId,
    now,
    payload.firstUsedDate,
    JSON.stringify(payload),
  ]);

  for (const [text, stance, note] of ADVISORY_RESPONSES) {
    const test = payload.motTests.find((candidate) =>
      candidate.defects.some((defect) => defect.type === 'ADVISORY' && defect.text === text),
    );
    if (test === undefined) throw new Error(`The seeded advisory "${text}" is not in the record`);
    await query(
      `INSERT INTO advisory_response (car_id, mot_test_number, advisory_text, stance, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [carId, test.motTestNumber, text, stance, note],
    );
  }

  await publishCar(carId);

  const links = new Map<string, string>();
  await transaction(async (tx) => {
    for (const seedLink of SEED_LINKS) {
      const row = await insertLink(tx, carId, seedLink.role, seedLink.name, now, seedLink.token);
      links.set(seedLink.name, row.id);
    }
  });

  const version = await loadVersion(carId, 1);
  if (version === null) throw new Error('The seeded car has no version 1');

  const writeSeen = async (linkName: string, count: number): Promise<void> => {
    const linkId = links.get(linkName);
    if (linkId === undefined) throw new Error(`The seeded link for ${linkName} is missing`);
    for (const finding of version.findings.slice(0, count)) {
      await query(
        `INSERT INTO seen_record (link_id, finding_id, content_hash, version_number, seen_at)
         VALUES ($1, $2, $3, 1, now())`,
        [linkId, finding.id, contentHashOfFrozen(finding)],
      );
    }
  };
  await writeSeen('Dev Marlowe', 4);
  await writeSeen('Imogen Achebe', version.findings.length);

  const slots = seedSlotStarts(now);
  const slotIds: string[] = [];
  for (const slot of slots) {
    const id = randomUUID();
    slotIds.push(id);
    await query(
      'INSERT INTO viewing_slot (id, car_id, local_start, starts_at, duration_minutes) VALUES ($1, $2, $3, $4, 45)',
      [id, carId, slot.localStart, slot.startsAt],
    );
  }

  const imogen = links.get('Imogen Achebe');
  if (imogen === undefined) throw new Error('The seeded link for Imogen Achebe is missing');
  await query('UPDATE viewing_slot SET holder_link_id = $2 WHERE id = $1', [slotIds[0], imogen]);
  await query(
    `INSERT INTO offer (id, car_id, link_id, amount_pounds, status, stamped_at, lapses_at)
     VALUES ($1, $2, $3, $4, 'open', $5, $6)`,
    [randomUUID(), carId, imogen, 15_400, now, new Date(now.getTime() + config.offerLapseSeconds * 1000)],
  );
};

const seedCarTwo = async (): Promise<void> => {
  await query(
    `INSERT INTO car (id, name, registration, asking_pounds, viewing_area, home_address, story, listing_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft')`,
    [
      randomUUID(),
      '1999 Calder Tern 1.8',
      'T317HJN',
      6_200,
      'Near Hexham',
      '7 Larkfield Close, Hexham NE46 9ZZ',
      'A daily driver that never let anyone down.',
    ],
  );
};

/**
 * Seeds all or nothing. An instance that cannot reach MinIO, Gotenberg or the record
 * API skips seeding, and exactly one instance that can reach them completes it.
 */
export const seedIfAbsent = async (): Promise<void> => {
  const already = await queryOne<{ id: number }>('SELECT id FROM seed_state WHERE id = 1');
  if (already !== null) return;

  const [storage, gotenberg, record] = await Promise.all([
    storageReachable(),
    gotenbergReachable(),
    recordApiReachable('S482KVT'),
  ]);
  if (!storage || !gotenberg || !record) {
    console.log('Seeding skipped: a dependency is not reachable');
    return;
  }

  const client = await pool.connect();
  try {
    const locked = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext('open-bonnet:seed')) AS locked",
    );
    if (!locked.rows[0].locked) return;
    try {
      const recheck = await client.query('SELECT id FROM seed_state WHERE id = 1');
      if (recheck.rowCount !== null && recheck.rowCount > 0) return;

      await ensureBucket();
      await query('INSERT INTO owner_credential (id, passphrase_hash) VALUES (1, $1)', [
        await hashPassphrase(OWNER_PASSPHRASE),
      ]);
      const now = new Date();
      await seedCarOne(now);
      await seedCarTwo();
      await query('INSERT INTO seed_state (id) VALUES (1)');
      console.log('Seeding finished');
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext('open-bonnet:seed'))");
    }
  } finally {
    client.release();
  }
};
