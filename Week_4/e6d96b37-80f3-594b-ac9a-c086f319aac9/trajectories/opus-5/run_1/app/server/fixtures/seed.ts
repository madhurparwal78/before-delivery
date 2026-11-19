import { randomUUID } from 'node:crypto';
import { app, limits } from '../config.ts';
import { tx, type Sql } from '../providers/db.ts';
import { objectKeys, putObject, sha256Hex } from '../providers/storage.ts';
import { fetchVarietyImage, lookupAlbum, lookupVariety } from '../providers/register.ts';
import { ensureNamespace, namespaceNow } from '../domain/clock.ts';
import { drawCoin } from './coin.ts';
import type { Holder, Role, Workflow } from '../../shared/types.ts';

/**
 * The invented fixture every namespace starts from, plus the per-workflow
 * overlays the grading seed applies. Each overlay is independent of any other
 * test, and the seed never calls another workflow's product operations.
 */

interface FixtureSpecimen {
  key: string;
  owner: Role;
  reference: string;
  mintmark: string;
  holder: Holder;
  wear: number;
  quarantined: boolean;
  certainty: 'certain' | 'uncertain';
  note: string | null;
}

const FIXTURES: FixtureSpecimen[] = [
  {
    key: 'A',
    owner: 'dealer',
    reference: 'ALD-A',
    mintmark: 'A',
    holder: { kind: 'flip', width_mm: 50, height_mm: 50 },
    wear: 0,
    quarantined: false,
    certainty: 'certain',
    note: null,
  },
  {
    key: 'B',
    owner: 'dealer',
    reference: 'ALD-A',
    mintmark: 'A',
    holder: { kind: 'flip', width_mm: 50, height_mm: 50 },
    // Visibly more worn than A, so the two duplicates compare at one scale.
    wear: 0.85,
    quarantined: false,
    certainty: 'certain',
    note: null,
  },
  {
    key: 'C',
    owner: 'dealer',
    reference: 'ALD-A',
    mintmark: 'A',
    holder: { kind: 'slab', width_mm: 70, height_mm: 90 },
    wear: 0.3,
    quarantined: false,
    certainty: 'certain',
    note: null,
  },
  {
    key: 'U',
    owner: 'dealer',
    reference: 'ALD-K',
    mintmark: 'K',
    holder: { kind: 'flip', width_mm: 50, height_mm: 50 },
    wear: 0.5,
    quarantined: true,
    certainty: 'uncertain',
    note: 'Mintmark punch is doubtful under the loupe.',
  },
  {
    key: 'O',
    owner: 'dealer',
    reference: 'ALD-O',
    mintmark: 'O',
    holder: { kind: 'capsule', width_mm: 46, height_mm: 46 },
    wear: 0.2,
    quarantined: false,
    certainty: 'certain',
    note: null,
  },
  {
    key: 'X',
    owner: 'counterpart',
    reference: 'ALD-K',
    mintmark: 'K',
    holder: { kind: 'flip', width_mm: 50, height_mm: 50 },
    wear: 0.15,
    quarantined: false,
    certainty: 'certain',
    note: null,
  },
  {
    key: 'Y',
    owner: 'outsider',
    reference: 'ALD-A',
    mintmark: 'A',
    holder: { kind: 'flip', width_mm: 50, height_mm: 50 },
    wear: 0.4,
    quarantined: false,
    certainty: 'certain',
    note: null,
  },
];

const TRAY_CELLS = [
  { cell: 'A1', row_index: 0, col_index: 0 },
  { cell: 'A2', row_index: 0, col_index: 1 },
  { cell: 'B1', row_index: 1, col_index: 0 },
  { cell: 'B2', row_index: 1, col_index: 1 },
];

export interface SeedReport {
  photosStored: boolean;
  registerStored: boolean;
}

interface StoredPhoto {
  objectKey: string;
  sha256: string;
  contentType: string;
}

async function storeFace(
  ns: string,
  key: string,
  label: 'obverse' | 'reverse' | 'arrival' | 'dispatch',
  bytes: Buffer,
): Promise<StoredPhoto> {
  const digest = sha256Hex(bytes);
  const objectKey = objectKeys.specimenPhoto(ns, key, label, digest, 'png');
  const stored = await putObject(objectKey, bytes, 'image/png');
  return { objectKey: stored.objectKey, sha256: stored.sha256, contentType: stored.contentType };
}

async function nextSequence(sql: Sql, ns: string): Promise<number> {
  const bumped = await sql.query<{ next_sequence: string }>(
    `UPDATE namespaces SET next_sequence = next_sequence + 1
      WHERE ns = $1 RETURNING next_sequence - 1 AS next_sequence`,
    [ns],
  );
  return Number(bumped.rows[0]?.next_sequence ?? 0);
}

/** Clears every record of a namespace so a reseed is deterministic. */
async function wipe(sql: Sql, ns: string): Promise<void> {
  for (const table of [
    'dispute_markers',
    'disputes',
    'evidence_links',
    'receipts',
    'manifests',
    'offer_holds',
    'offers',
    'annotations',
    'photos',
    'album_holes',
    'albums',
    'tray_cells',
    'trays',
    'keeper_orders',
    'register_records',
    'audit_marks',
    'desk_events',
    'command_replies',
    'specimens',
  ]) {
    await sql.query(`DELETE FROM ${table} WHERE ns = $1`, [ns]);
  }
  await sql.query('UPDATE namespaces SET next_sequence = 1 WHERE ns = $1', [ns]);
  await sql.query('DELETE FROM app_sessions WHERE ns = $1', [ns]);
}

export async function seedNamespace(
  ns: string,
  workflow: Workflow,
  gradingClock: boolean,
): Promise<SeedReport> {
  await tx(async (sql) => {
    await ensureNamespace(sql, ns, gradingClock ? 'grading' : 'real');
    if (gradingClock) {
      await sql.query(
        `UPDATE namespaces SET clock_mode = 'grading', clock_base = $2, advanced_s = 0 WHERE ns = $1`,
        [ns, new Date(limits.gradeClockIso)],
      );
    }
    await wipe(sql, ns);
  });

  // The seed fetches register records through the register, exactly as the
  // product does. Where it cannot be reached, attributions stay pending.
  const records = new Map<string, { mintmark: string; revision: number; issue: string }>();
  const registerImages = new Map<string, Buffer>();
  let registerStored = true;
  try {
    for (const reference of ['ALD-A', 'ALD-K', 'ALD-O']) {
      const record = await lookupVariety(reference);
      records.set(reference, {
        mintmark: record.mintmark,
        revision: record.revision,
        issue: record.issue,
      });
      registerImages.set(reference, await fetchVarietyImage(record.imagePath));
    }
  } catch {
    registerStored = false;
  }

  let album: Awaited<ReturnType<typeof lookupAlbum>> | null = null;
  if (registerStored) {
    try {
      album = await lookupAlbum('ALD-CROWN');
    } catch {
      album = null;
    }
  }

  // Photographs live in MinIO; without it the screens show their pending state.
  const faces = new Map<string, { obverse: StoredPhoto; reverse: StoredPhoto }>();
  const extras = new Map<string, StoredPhoto>();
  let photosStored = true;
  try {
    for (const fixture of FIXTURES) {
      faces.set(fixture.key, {
        obverse: await storeFace(
          ns,
          fixture.key,
          'obverse',
          drawCoin({ mintmark: fixture.mintmark, face: 'obverse', wear: fixture.wear }),
        ),
        reverse: await storeFace(
          ns,
          fixture.key,
          'reverse',
          drawCoin({ mintmark: fixture.mintmark, face: 'reverse', wear: fixture.wear }),
        ),
      });
    }
    if (workflow === 'condition_comparison' || workflow === 'cross-cutting') {
      extras.set(
        'A/arrival',
        await storeFace(
          ns,
          'A',
          'arrival',
          drawCoin({ mintmark: 'A', face: 'obverse', wear: 0.2, overlay: 'scratch' }),
        ),
      );
    }
    if (workflow === 'receipt' || workflow === 'disputes') {
      extras.set(
        'A/arrival',
        await storeFace(
          ns,
          'A',
          'arrival',
          drawCoin({
            mintmark: 'A',
            face: 'obverse',
            overlay: workflow === 'disputes' ? 'gouge' : 'none',
          }),
        ),
      );
      extras.set(
        'X/arrival',
        await storeFace(ns, 'X', 'arrival', drawCoin({ mintmark: 'K', face: 'obverse', wear: 0.15 })),
      );
    }
    if (registerStored) {
      for (const [reference, image] of registerImages) {
        const record = records.get(reference);
        if (record) {
          await putObject(
            objectKeys.registerImage(ns, reference, record.revision),
            image,
            'image/svg+xml',
          );
        }
      }
    }
  } catch {
    photosStored = false;
  }

  await tx(async (sql) => {
    const now = await namespaceNow(sql, ns);

    for (const [reference, record] of records) {
      await sql.query(
        `INSERT INTO register_records (ns, reference, revision, issue, mintmark, image_key)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (ns, reference, revision) DO NOTHING`,
        [
          ns,
          reference,
          record.revision,
          record.issue,
          record.mintmark,
          objectKeys.registerImage(ns, reference, record.revision),
        ],
      );
    }

    for (const fixture of FIXTURES) {
      // The attribution workflow leaves A unconfirmed, and catalogue
      // reconciliation leaves it pending with a correction draft.
      const unresolved =
        (workflow === 'attribution' && fixture.key === 'A') ||
        (workflow === 'catalog_reconciliation' && fixture.key === 'A') ||
        !registerStored;
      const record = records.get(fixture.reference);
      const sequence = await nextSequence(sql, ns);

      await sql.query(
        `INSERT INTO specimens
           (ns, key, display_label, owner, status, version, holder, attribution,
            quarantined, missing, created_seq)
         VALUES ($1,$2,$3,$4,'attributed',1,$5,$6,$7,false,$8)`,
        [
          ns,
          fixture.key,
          `Specimen ${fixture.key}`,
          fixture.owner,
          fixture.holder,
          {
            reference: unresolved ? null : fixture.reference,
            mintmark: unresolved ? null : (record?.mintmark ?? fixture.mintmark),
            revision: unresolved ? null : (record?.revision ?? 1),
            certainty: fixture.certainty,
            note: fixture.note,
            correction:
              workflow === 'catalog_reconciliation' && fixture.key === 'A' ? 'ALD-A' : null,
            register: unresolved ? 'pending' : 'stored',
          },
          fixture.quarantined,
          sequence,
        ],
      );

      const stored = faces.get(fixture.key);
      if (stored) {
        for (const [label, photo] of [
          ['obverse', stored.obverse],
          ['reverse', stored.reverse],
        ] as const) {
          await sql.query(
            `INSERT INTO photos
               (ns, id, specimen, label, object_key, sha256, width, height, content_type, created_seq)
             VALUES ($1,$2,$3,$4,$5,$6,1000,1000,$7,$8)`,
            [ns, randomUUID(), fixture.key, label, photo.objectKey, photo.sha256, photo.contentType, sequence],
          );
        }
      }
    }

    for (const [slot, photo] of extras) {
      const [key, label] = slot.split('/') as [string, 'arrival'];
      await sql.query(
        `INSERT INTO photos
           (ns, id, specimen, label, object_key, sha256, width, height, content_type, created_seq)
         VALUES ($1,$2,$3,$4,$5,$6,1000,1000,$7,$8)`,
        [ns, randomUUID(), key, label, photo.objectKey, photo.sha256, photo.contentType, await nextSequence(sql, ns)],
      );
    }

    /* -- tray, album and keepers at baseline -- */

    await sql.query('INSERT INTO trays (ns, version) VALUES ($1, 1)', [ns]);
    const trayLayout =
      workflow === 'stock_audit'
        ? { A1: 'A', A2: 'B', B1: 'U', B2: null }
        : { A1: null, A2: 'B', B1: null, B2: null };
    for (const cell of TRAY_CELLS) {
      await sql.query(
        `INSERT INTO tray_cells
           (ns, cell, specimen, audit_mark, audit_version, row_index, col_index, width_mm, height_mm)
         VALUES ($1,$2,$3,NULL,0,$4,$5,60,60)`,
        [
          ns,
          cell.cell,
          (trayLayout as Record<string, string | null>)[cell.cell] ?? null,
          cell.row_index,
          cell.col_index,
        ],
      );
    }

    await sql.query('INSERT INTO albums (ns, set_key, revision, version) VALUES ($1,$2,$3,1)', [
      ns,
      album?.set ?? null,
      album?.revision ?? null,
    ]);
    if (album) {
      let position = 0;
      for (const hole of album.holes) {
        await sql.query(
          `INSERT INTO album_holes (ns, label, reference, mintmark, specimen, position)
           VALUES ($1,$2,$3,$4,NULL,$5)`,
          [ns, hole.label, hole.reference, hole.mintmark, position],
        );
        position += 1;
      }
    }

    await sql.query(
      `INSERT INTO keeper_orders (ns, ordering, previous, version) VALUES ($1,$2,NULL,1)`,
      [ns, JSON.stringify(['A', 'B', 'C'])],
    );

    /* -- offer-0 exists in every namespace -- */

    await sql.query(
      `INSERT INTO offers
         (ns, key, version, status, dealer_items, counterpart_items,
          accept_dealer, accept_counterpart, expires_at, created_seq)
       VALUES ($1,'offer-0',1,'accepted',$2,'[]',1,1,NULL,$3)`,
      [ns, JSON.stringify(['O']), await nextSequence(sql, ns)],
    );
    for (const party of ['dealer', 'counterpart'] as const) {
      await sql.query(
        `INSERT INTO manifests (ns, offer, party, version, ordering, frozen, evidence)
         VALUES ($1,'offer-0',$2,1,$3,false,'[]')`,
        [ns, party, JSON.stringify(party === 'dealer' ? ['O'] : [])],
      );
    }

    await applyOverlay(sql, ns, workflow, now, faces, extras);
  });

  return { photosStored, registerStored };
}

/** The per-workflow overlay, applied by the seed route only. */
async function applyOverlay(
  sql: Sql,
  ns: string,
  workflow: Workflow,
  now: Date,
  faces: Map<string, { obverse: StoredPhoto; reverse: StoredPhoto }>,
  extras: Map<string, StoredPhoto>,
): Promise<void> {
  const makeOffer = async (
    key: string,
    status: string,
    dealerItems: string[],
    counterpartItems: string[],
    options: {
      acceptDealer?: number | null;
      acceptCounterpart?: number | null;
      expiresInS?: number | null;
      version?: number;
    } = {},
  ): Promise<void> => {
    await sql.query(
      `INSERT INTO offers
         (ns, key, version, status, dealer_items, counterpart_items,
          accept_dealer, accept_counterpart, expires_at, created_seq)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        ns,
        key,
        options.version ?? 1,
        status,
        JSON.stringify(dealerItems),
        JSON.stringify(counterpartItems),
        options.acceptDealer ?? null,
        options.acceptCounterpart ?? null,
        options.expiresInS === null || options.expiresInS === undefined
          ? null
          : new Date(now.getTime() + options.expiresInS * 1000),
        await nextSequence(sql, ns),
      ],
    );
  };

  const makeManifests = async (
    offer: string,
    dealerOrder: string[],
    counterpartOrder: string[],
    frozen: boolean,
  ): Promise<void> => {
    for (const [party, order] of [
      ['dealer', dealerOrder],
      ['counterpart', counterpartOrder],
    ] as const) {
      const evidence = frozen
        ? order.map((key) => {
            const photo = faces.get(key)?.obverse;
            return {
              specimen: key,
              label: 'dispatch',
              object_key: photo?.objectKey ?? '',
              sha256: photo?.sha256 ?? '',
            };
          })
        : [];
      await sql.query(
        `INSERT INTO manifests (ns, offer, party, version, ordering, frozen, evidence)
         VALUES ($1,$2,$3,1,$4,$5,$6)`,
        [ns, offer, party, JSON.stringify(order), frozen, JSON.stringify(evidence)],
      );
    }
  };

  switch (workflow) {
    case 'intake':
      // No specimen <ns>-I exists; the staged media are handed to the browser.
      break;

    case 'offer_assembly':
      // Two empty drafts, with X available to both.
      await makeOffer('offer-1', 'draft', [], [], { expiresInS: null });
      await makeOffer('offer-2', 'draft', [], [], { expiresInS: null });
      break;

    case 'counteroffers':
      // Accepted by both at version 1, A for X, so N09 reads the accepted copy
      // until a replacement starts a new window. B stays available.
      await makeOffer('offer-1', 'accepted', ['A'], ['X'], {
        acceptDealer: 1,
        acceptCounterpart: 1,
        expiresInS: null,
      });
      await makeManifests('offer-1', ['A'], ['X'], false);
      break;

    case 'dispatch':
      await makeOffer('offer-1', 'accepted', ['A', 'B', 'C'], ['X'], {
        acceptDealer: 1,
        acceptCounterpart: 1,
        expiresInS: null,
      });
      // The dealer manifest is in order A, B, C; the sleeves read C, A, B.
      await makeManifests('offer-1', ['A', 'B', 'C'], ['X'], false);
      break;

    case 'receipt':
      await makeOffer('offer-1', 'dispatched', ['A'], ['X'], {
        acceptDealer: 1,
        acceptCounterpart: 1,
        expiresInS: null,
      });
      await makeManifests('offer-1', ['A'], ['X'], true);
      break;

    case 'disputes':
      await makeOffer('offer-1', 'received', ['A'], ['X'], {
        acceptDealer: 1,
        acceptCounterpart: 1,
        expiresInS: null,
      });
      await makeManifests('offer-1', ['A'], ['X'], true);
      // The dealer's receipt of X is already recorded as matching.
      await sql.query(
        `INSERT INTO receipts (ns, offer, party, confirmed, matches)
         VALUES ($1,'offer-1','dealer',true,true)`,
        [ns],
      );
      break;

    case 'cross-cutting':
      // The counterpart's exchange view of a sent offer-1, A for X.
      await makeOffer('offer-1', 'sent', ['A'], ['X'], { expiresInS: limits.offerWindowS });
      break;

    case 'attribution':
    case 'catalog_reconciliation':
    case 'tray_placement':
    case 'set_tracking':
    case 'condition_comparison':
    case 'duplicate_selection':
    case 'stock_audit':
      break;
  }

  void extras;
}

/** The default namespace carries the fixture plus one sent offer, `offer-1`. */
export async function seedDefaultNamespace(): Promise<void> {
  const already = await tx(async (sql) => {
    const found = await sql.query('SELECT 1 FROM namespaces WHERE ns = $1', [app.defaultNamespace]);
    return (found.rowCount ?? 0) > 0;
  });
  if (already) return;

  await seedNamespace(app.defaultNamespace, 'cross-cutting', false);
  await tx(async (sql) => {
    const now = await namespaceNow(sql, app.defaultNamespace);
    // offer-1 is C for X, with a fresh 48-hour window.
    await sql.query(
      `UPDATE offers SET dealer_items = $2, counterpart_items = $3, expires_at = $4
        WHERE ns = $1 AND key = 'offer-1'`,
      [
        app.defaultNamespace,
        JSON.stringify(['C']),
        JSON.stringify(['X']),
        new Date(now.getTime() + limits.offerWindowS * 1000),
      ],
    );
  });
}

export { FIXTURES };
