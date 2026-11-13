import { db } from './routes.js';

/**
 * Seed data for the invented Tidewater Nocturne commission, inserted at start
 * only when missing. Every person, ensemble and piece here is invented.
 */
const SCORE_ID = 'sc-tidewater';

interface SeedStaff {
  id: string;
  name: string;
  clef: string;
  transpose: { diatonic: number; chromatic: number };
  partId: string;
  partName: string;
}

const SEED_STAVES: SeedStaff[] = [
  { id: 'st-fl', name: 'Flute', clef: 'treble', transpose: { diatonic: 0, chromatic: 0 }, partId: 'p-fl', partName: 'Flute' },
  { id: 'st-ob', name: 'Oboe', clef: 'treble', transpose: { diatonic: 0, chromatic: 0 }, partId: 'p-ob', partName: 'Oboe' },
  { id: 'st-cl', name: 'Clarinet in B♭', clef: 'treble', transpose: { diatonic: -1, chromatic: -2 }, partId: 'p-cl', partName: 'Clarinet in B♭' },
  { id: 'st-bn', name: 'Bassoon', clef: 'bass', transpose: { diatonic: 0, chromatic: 0 }, partId: 'p-bn', partName: 'Bassoon' },
  { id: 'st-hn', name: 'Horn in F', clef: 'treble', transpose: { diatonic: -4, chromatic: -7 }, partId: 'p-hn', partName: 'Horn in F' },
  { id: 'st-tp', name: 'Trumpet in B♭', clef: 'treble', transpose: { diatonic: -1, chromatic: -2 }, partId: 'p-tp', partName: 'Trumpet in B♭' },
  { id: 'st-timp', name: 'Timpani', clef: 'bass', transpose: { diatonic: 0, chromatic: 0 }, partId: 'p-timp', partName: 'Timpani' },
  { id: 'st-hp-r', name: 'Harp (right hand)', clef: 'treble', transpose: { diatonic: 0, chromatic: 0 }, partId: 'p-hp', partName: 'Harp' },
  { id: 'st-hp-l', name: 'Harp (left hand)', clef: 'bass', transpose: { diatonic: 0, chromatic: 0 }, partId: 'p-hp', partName: 'Harp' },
  { id: 'st-vn1', name: 'Violin I', clef: 'treble', transpose: { diatonic: 0, chromatic: 0 }, partId: 'p-vn1', partName: 'Violin I' },
  { id: 'st-vn2', name: 'Violin II', clef: 'treble', transpose: { diatonic: 0, chromatic: 0 }, partId: 'p-vn2', partName: 'Violin II' },
  { id: 'st-va', name: 'Viola', clef: 'alto', transpose: { diatonic: 0, chromatic: 0 }, partId: 'p-va', partName: 'Viola' },
  { id: 'st-vc', name: 'Cello', clef: 'bass', transpose: { diatonic: 0, chromatic: 0 }, partId: 'p-vc', partName: 'Cello' },
  { id: 'st-db', name: 'Double Bass', clef: 'bass', transpose: { diatonic: -7, chromatic: -12 }, partId: 'p-db', partName: 'Double Bass' },
];

interface SeedEvent {
  lamport: number;
  staffId: string;
  kind: 'note' | 'rest';
  pitch?: { step: string; alter: number; octave: number };
  duration: string;
  dots: number;
  dynamic?: string;
  dynamicPlacement?: 'above' | 'below';
  text?: string;
  tie?: boolean;
  after: number | null; // lamport of the previous event in this voice
}

const SEED_EVENTS: SeedEvent[] = [
  { lamport: 1, staffId: 'st-ob', kind: 'rest', duration: 'whole', dots: 0, after: null },
  { lamport: 2, staffId: 'st-ob', kind: 'rest', duration: 'whole', dots: 0, after: 1 },
  { lamport: 3, staffId: 'st-ob', kind: 'note', pitch: { step: 'E', alter: 0, octave: 5 }, duration: 'quarter', dots: 0, dynamic: 'p', dynamicPlacement: 'below', text: '<i>dolce</i>', after: 2 },
  { lamport: 4, staffId: 'st-ob', kind: 'note', pitch: { step: 'F', alter: 1, octave: 5 }, duration: 'quarter', dots: 0, after: 3 },
  { lamport: 5, staffId: 'st-ob', kind: 'note', pitch: { step: 'G', alter: 0, octave: 5 }, duration: 'half', dots: 0, after: 4 },
  { lamport: 6, staffId: 'st-ob', kind: 'note', pitch: { step: 'A', alter: 0, octave: 5 }, duration: 'half', dots: 1, after: 5 },
  { lamport: 7, staffId: 'st-ob', kind: 'note', pitch: { step: 'B', alter: 0, octave: 5 }, duration: 'quarter', dots: 0, tie: true, after: 6 },
  { lamport: 8, staffId: 'st-ob', kind: 'note', pitch: { step: 'B', alter: 0, octave: 5 }, duration: 'whole', dots: 0, after: 7 },
  { lamport: 9, staffId: 'st-vn1', kind: 'note', pitch: { step: 'G', alter: 0, octave: 4 }, duration: 'whole', dots: 0, after: null },
  { lamport: 10, staffId: 'st-vn1', kind: 'note', pitch: { step: 'A', alter: 0, octave: 4 }, duration: 'whole', dots: 0, after: 9 },
  { lamport: 11, staffId: 'st-vn1', kind: 'note', pitch: { step: 'B', alter: 0, octave: 4 }, duration: 'half', dots: 0, after: 10 },
  { lamport: 12, staffId: 'st-vn1', kind: 'note', pitch: { step: 'D', alter: 0, octave: 5 }, duration: 'half', dots: 0, after: 11 },
  { lamport: 13, staffId: 'st-cl', kind: 'note', pitch: { step: 'C', alter: 0, octave: 5 }, duration: 'whole', dots: 0, after: null },
];

interface SeedCollaborator {
  id: string;
  name: string;
  role: string;
  status: string;
  staffIds: string[];
  seatToken: string | null;
  inviteToken?: string;
}

const SEED_COLLABORATORS: SeedCollaborator[] = [
  { id: 'c-mara', name: 'Mara Lindqvist', role: 'composer', status: 'active', staffIds: [], seatToken: 'seat-composer-7f3a' },
  { id: 'c-jun', name: 'Jun Okafor', role: 'copyist', status: 'active', staffIds: [], seatToken: 'seat-copyist-2c9e' },
  { id: 'c-ines', name: 'Inès Varga', role: 'player', status: 'active', staffIds: ['st-ob'], seatToken: 'seat-oboe-5b1d' },
  { id: 'c-theo', name: 'Theo Brandt', role: 'player', status: 'active', staffIds: ['st-vn1'], seatToken: 'seat-violin1-8e4f' },
  { id: 'c-ruth', name: 'Ruth Abara', role: 'player', status: 'invited', staffIds: ['st-va'], seatToken: null, inviteToken: 'inv-viola-3a6c' },
];

export async function seedIfMissing(): Promise<void> {
  const existing = await db.query('SELECT id FROM scores WHERE id = $1', [SCORE_ID]);
  if (existing.rows.length > 0) return;
  await seedAll();
}

/** Inserts every seed row idempotently so a partially seeded database heals. */
async function seedAll(): Promise<void> {
  const timeSignatures = [
    { measure: 1, beats: 4, beatType: 4 },
    { measure: 25, beats: 3, beatType: 4 },
  ];
  const tempos = [
    { measure: 1, bpm: 72 },
    { measure: 25, bpm: 96 },
  ];
  await db.query(
    `INSERT INTO scores (id, title, measure_count, lamport, last_seq, time_signatures, tempos)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (id) DO NOTHING`,
    [SCORE_ID, 'Tidewater Nocturne', 48, 13, 0, JSON.stringify(timeSignatures), JSON.stringify(tempos)],
  );

  const partIds = new Map<string, string>();
  for (const staff of SEED_STAVES) {
    if (!partIds.has(staff.partId)) {
      await db.query(
        'INSERT INTO parts (id, score_id, name, status, revision, stale, layout, last_error) VALUES ($1,$2,$3,$4,0,false,$5,null) ON CONFLICT DO NOTHING',
        [staff.partId, SCORE_ID, staff.partName, 'draft', JSON.stringify({ systemBreaks: [], pageBreaks: [] })],
      );
      partIds.set(staff.partId, staff.partName);
    }
  }
  let order = 1;
  for (const staff of SEED_STAVES) {
    await db.query(
      'INSERT INTO staves (id, score_id, name, clef, transpose, part_id, "order") VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',
      [staff.id, SCORE_ID, staff.name, staff.clef, JSON.stringify(staff.transpose), staff.partId, order],
    );
    order++;
  }

  // seed music as recorded operations with site "seed"
  for (const ev of SEED_EVENTS) {
    const op = {
      id: { lamport: ev.lamport, site: 'seed' },
      type: 'insert',
      staffId: ev.staffId,
      voice: 1,
      after: ev.after === null ? null : { lamport: ev.after, site: 'seed' },
      event: {
        kind: ev.kind,
        ...(ev.kind === 'note' ? { pitch: ev.pitch } : {}),
        duration: ev.duration,
        dots: ev.dots,
      },
    };
    await db.query(
      'INSERT INTO operations (score_id, seq, lamport, site, author_id, op) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (score_id, seq) DO NOTHING',
      [SCORE_ID, ev.lamport, ev.lamport, 'seed', 'c-mara', JSON.stringify(op)],
    );
  }
  // seed field values as set operations so they follow the latest-stamp rule
  const seedSets: { lamport: number; staffId: string; field: string; value: unknown; target: number }[] = [
    { lamport: 100, staffId: 'st-ob', field: 'dynamic', value: 'p', target: 3 },
    { lamport: 101, staffId: 'st-ob', field: 'dynamicPlacement', value: 'below', target: 3 },
    { lamport: 102, staffId: 'st-ob', field: 'text', value: '<i>dolce</i>', target: 3 },
    { lamport: 103, staffId: 'st-ob', field: 'tie', value: true, target: 7 },
  ];
  let setSeq = 100;
  for (const s of seedSets) {
    const op = {
      id: { lamport: s.lamport, site: 'seed' },
      type: 'set',
      staffId: s.staffId,
      voice: 1,
      target: { lamport: s.target, site: 'seed' },
      field: s.field,
      value: s.value,
    };
    await db.query(
      'INSERT INTO operations (score_id, seq, lamport, site, author_id, op) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (score_id, seq) DO NOTHING',
      [SCORE_ID, setSeq, s.lamport, 'seed', 'c-mara', JSON.stringify(op)],
    );
    setSeq++;
  }

  for (const c of SEED_COLLABORATORS) {
    await db.query(
      'INSERT INTO collaborators (id, score_id, name, role, status, staff_ids, seat_token) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (score_id, id) DO NOTHING',
      [c.id, SCORE_ID, c.name, c.role, c.status, JSON.stringify(c.staffIds), c.seatToken],
    );
    if (c.status === 'active') {
      await db.query(
        'INSERT INTO acks (score_id, collaborator_id, seen) VALUES ($1,$2,0) ON CONFLICT DO NOTHING',
        [SCORE_ID, c.id],
      );
    }
    if (c.inviteToken) {
      await db.query('INSERT INTO invites (token, score_id, collaborator_id) VALUES ($1,$2,$3) ON CONFLICT (token) DO NOTHING', [
        c.inviteToken,
        SCORE_ID,
        c.id,
      ]);
    }
  }
  // the score's lastSeq covers the recorded operations
  await db.query('UPDATE scores SET last_seq = $1 WHERE id = $2', [setSeq - 1, SCORE_ID]);
}
