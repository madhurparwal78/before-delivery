import type { Clef, DurationName, Pitch, Role } from '../../shared/types.js';
import { query, transact } from './pool.js';

export const SEED_SCORE_ID = 'sc-tidewater';

interface SeedStaff {
  id: string;
  name: string;
  clef: Clef;
  diatonic: number;
  chromatic: number;
  partId: string;
  partName: string;
}

const STAVES: SeedStaff[] = [
  { id: 'st-fl', name: 'Flute', clef: 'treble', diatonic: 0, chromatic: 0, partId: 'p-fl', partName: 'Flute' },
  { id: 'st-ob', name: 'Oboe', clef: 'treble', diatonic: 0, chromatic: 0, partId: 'p-ob', partName: 'Oboe' },
  { id: 'st-cl', name: 'Clarinet in B\u266D', clef: 'treble', diatonic: -1, chromatic: -2, partId: 'p-cl', partName: 'Clarinet in B\u266D' },
  { id: 'st-bn', name: 'Bassoon', clef: 'bass', diatonic: 0, chromatic: 0, partId: 'p-bn', partName: 'Bassoon' },
  { id: 'st-hn', name: 'Horn in F', clef: 'treble', diatonic: -4, chromatic: -7, partId: 'p-hn', partName: 'Horn in F' },
  { id: 'st-tp', name: 'Trumpet in B\u266D', clef: 'treble', diatonic: -1, chromatic: -2, partId: 'p-tp', partName: 'Trumpet in B\u266D' },
  { id: 'st-timp', name: 'Timpani', clef: 'bass', diatonic: 0, chromatic: 0, partId: 'p-timp', partName: 'Timpani' },
  { id: 'st-hp-r', name: 'Harp (right hand)', clef: 'treble', diatonic: 0, chromatic: 0, partId: 'p-hp', partName: 'Harp' },
  { id: 'st-hp-l', name: 'Harp (left hand)', clef: 'bass', diatonic: 0, chromatic: 0, partId: 'p-hp', partName: 'Harp' },
  { id: 'st-vn1', name: 'Violin I', clef: 'treble', diatonic: 0, chromatic: 0, partId: 'p-vn1', partName: 'Violin I' },
  { id: 'st-vn2', name: 'Violin II', clef: 'treble', diatonic: 0, chromatic: 0, partId: 'p-vn2', partName: 'Violin II' },
  { id: 'st-va', name: 'Viola', clef: 'alto', diatonic: 0, chromatic: 0, partId: 'p-va', partName: 'Viola' },
  { id: 'st-vc', name: 'Cello', clef: 'bass', diatonic: 0, chromatic: 0, partId: 'p-vc', partName: 'Cello' },
  { id: 'st-db', name: 'Double Bass', clef: 'bass', diatonic: -7, chromatic: -12, partId: 'p-db', partName: 'Double Bass' },
];

interface SeedEvent {
  lamport: number;
  staffId: string;
  kind: 'note' | 'rest';
  pitch: Pitch | null;
  duration: DurationName;
  dots: number;
  fields: Record<string, { value: unknown; stamp: { lamport: number; site: string } }>;
}

function note(
  lamport: number,
  staffId: string,
  step: Pitch['step'],
  alter: number,
  octave: number,
  duration: DurationName,
  dots = 0,
  fields: Record<string, unknown> = {},
): SeedEvent {
  const stamped: SeedEvent['fields'] = {};
  for (const [field, value] of Object.entries(fields)) {
    stamped[field] = { value, stamp: { lamport, site: 'seed' } };
  }
  return { lamport, staffId, kind: 'note', pitch: { step, alter, octave }, duration, dots, fields: stamped };
}

function rest(lamport: number, staffId: string, duration: DurationName): SeedEvent {
  return { lamport, staffId, kind: 'rest', pitch: null, duration, dots: 0, fields: {} };
}

const MUSIC: SeedEvent[] = [
  rest(1, 'st-ob', 'whole'),
  rest(2, 'st-ob', 'whole'),
  note(3, 'st-ob', 'E', 0, 5, 'quarter', 0, { dynamic: 'p', dynamicPlacement: 'below', text: '<i>dolce</i>' }),
  note(4, 'st-ob', 'F', 1, 5, 'quarter'),
  note(5, 'st-ob', 'G', 0, 5, 'half'),
  note(6, 'st-ob', 'A', 0, 5, 'half', 1),
  note(7, 'st-ob', 'B', 0, 5, 'quarter', 0, { tie: true }),
  note(8, 'st-ob', 'B', 0, 5, 'whole'),
  note(9, 'st-vn1', 'G', 0, 4, 'whole'),
  note(10, 'st-vn1', 'A', 0, 4, 'whole'),
  note(11, 'st-vn1', 'B', 0, 4, 'half'),
  note(12, 'st-vn1', 'D', 0, 5, 'half'),
  note(13, 'st-cl', 'C', 0, 5, 'whole'),
];

interface SeedCollaborator {
  id: string;
  name: string;
  role: Role;
  status: 'invited' | 'active';
  staffIds: string[];
  allStaves: boolean;
  seatToken: string | null;
  inviteToken: string | null;
}

const COLLABORATORS: SeedCollaborator[] = [
  { id: 'c-mara', name: 'Mara Lindqvist', role: 'composer', status: 'active', staffIds: [], allStaves: true, seatToken: 'seat-composer-7f3a', inviteToken: null },
  { id: 'c-jun', name: 'Jun Okafor', role: 'copyist', status: 'active', staffIds: [], allStaves: true, seatToken: 'seat-copyist-2c9e', inviteToken: null },
  { id: 'c-ines', name: 'In\u00e8s Varga', role: 'player', status: 'active', staffIds: ['st-ob'], allStaves: false, seatToken: 'seat-oboe-5b1d', inviteToken: null },
  { id: 'c-theo', name: 'Theo Brandt', role: 'player', status: 'active', staffIds: ['st-vn1'], allStaves: false, seatToken: 'seat-violin1-8e4f', inviteToken: null },
  { id: 'c-ruth', name: 'Ruth Abara', role: 'player', status: 'invited', staffIds: ['st-va'], allStaves: false, seatToken: null, inviteToken: 'inv-viola-3a6c' },
];

export async function seedIfMissing(): Promise<void> {
  const existing = await query<{ id: string }>('select id from scores where id = $1', [SEED_SCORE_ID]);
  if (existing.length > 0) return;

  await transact(async (client) => {
    await client.query(
      `insert into scores (id, title, measure_count, lamport, last_seq)
       values ($1, $2, $3, $4, $5) on conflict (id) do nothing`,
      [SEED_SCORE_ID, 'Tidewater Nocturne', 48, 13, 0],
    );
    await client.query(
      `insert into time_signatures (score_id, measure, beats, beat_type)
       values ($1, 1, 4, 4), ($1, 25, 3, 4) on conflict do nothing`,
      [SEED_SCORE_ID],
    );
    await client.query(
      `insert into tempos (score_id, measure, bpm) values ($1, 1, 72), ($1, 25, 96)
       on conflict do nothing`,
      [SEED_SCORE_ID],
    );

    const parts = new Map<string, string>();
    for (const staff of STAVES) parts.set(staff.partId, staff.partName);
    let partOrder = 0;
    for (const [partId, name] of parts) {
      partOrder += 1;
      await client.query(
        `insert into parts (id, score_id, name, status, revision, layout, ord)
         values ($1, $2, $3, 'draft', 0, '{"systemBreaks":[],"pageBreaks":[]}'::jsonb, $4)
         on conflict (id) do nothing`,
        [partId, SEED_SCORE_ID, name, partOrder],
      );
    }

    let staffOrder = 0;
    for (const staff of STAVES) {
      staffOrder += 1;
      await client.query(
        `insert into staves (id, score_id, name, clef, transpose_diatonic, transpose_chromatic, part_id, ord)
         values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (id) do nothing`,
        [staff.id, SEED_SCORE_ID, staff.name, staff.clef, staff.diatonic, staff.chromatic, staff.partId, staffOrder],
      );
    }

    for (const person of COLLABORATORS) {
      await client.query(
        `insert into collaborators (id, score_id, name, role, status, staff_ids, all_staves, seat_token, invite_token, acked_lamport)
         values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, 0) on conflict (id) do nothing`,
        [
          person.id,
          SEED_SCORE_ID,
          person.name,
          person.role,
          person.status,
          JSON.stringify(person.staffIds),
          person.allStaves,
          person.seatToken,
          person.inviteToken,
        ],
      );
    }

    const previous = new Map<string, number>();
    for (const event of MUSIC) {
      const after = previous.get(event.staffId) ?? null;
      await client.query(
        `insert into elements (score_id, staff_id, voice, lamport, site, after_lamport, after_site,
            kind, pitch, duration, dots, fields)
         values ($1, $2, 1, $3, 'seed', $4, $5, $6, $7::jsonb, $8, $9, $10::jsonb)
         on conflict do nothing`,
        [
          SEED_SCORE_ID,
          event.staffId,
          event.lamport,
          after,
          after === null ? null : 'seed',
          event.kind,
          event.pitch === null ? null : JSON.stringify(event.pitch),
          event.duration,
          event.dots,
          JSON.stringify(event.fields),
        ],
      );
      previous.set(event.staffId, event.lamport);
    }
  });
}
