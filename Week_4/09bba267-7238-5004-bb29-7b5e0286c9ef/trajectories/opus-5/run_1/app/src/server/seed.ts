import { HALL_SEATS, type SectionCode } from '../shared/hall';
import { instantFromVenueWallTime } from '../shared/venueTime';
import type { Db } from './db';
import { createPerformance, type PerformanceDefinition, type TierDefinition } from './domain/performances';

export const OWNER_PASSCODE_KEY = 'owner_passcode';
const SEEDED_OWNER_PASSCODE = 'brass-rail-1897';

function seatsInRows(section: SectionCode, firstRow: string, lastRow: string): string[] {
  return HALL_SEATS.filter((seat) => seat.section === section && seat.row >= firstRow && seat.row <= lastRow).map(
    (seat) => seat.id,
  );
}

const standardTiers: readonly TierDefinition[] = [
  { tierId: 'a-reserve', name: 'A Reserve', faceCents: 6800, seatIds: seatsInRows('ST', 'A', 'H') },
  {
    tierId: 'b-reserve',
    name: 'B Reserve',
    faceCents: 4500,
    seatIds: [...seatsInRows('ST', 'I', 'P'), ...seatsInRows('CI', 'A', 'D')],
  },
  {
    tierId: 'c-reserve',
    name: 'C Reserve',
    faceCents: 2900,
    seatIds: [...seatsInRows('CI', 'E', 'H'), ...seatsInRows('BA', 'A', 'F')],
  },
];

function at(wallTime: string): Date {
  const resolved = instantFromVenueWallTime(wallTime);
  if (!resolved.ok) throw new Error(`seed start ${wallTime} is not a venue wall time`);
  return resolved.instant;
}

const SEEDED_PERFORMANCES: readonly PerformanceDefinition[] = [
  {
    id: 'lantern-and-tide',
    title: 'Lantern & Tide',
    startsAt: at('2027-02-12T20:00'),
    tiers: standardTiers,
  },
  {
    id: 'ostrava-strings',
    title: 'Ostrava Strings',
    startsAt: at('2027-03-14T19:30'),
    tiers: standardTiers,
  },
  {
    id: 'fen-and-lark',
    title: 'Fen & Lark',
    startsAt: at('2027-05-21T21:00'),
    tiers: [
      { tierId: 'front-pair', name: 'Front Pair', faceCents: 9500, seatIds: ['ST-A-15', 'ST-A-16'] },
      { tierId: 'stalls', name: 'Stalls', faceCents: 4500, seatIds: seatsInRows('ST', 'B', 'P') },
    ],
  },
  {
    id: 'marrow-quartet-late-set',
    title: 'Marrow Quartet: The Late Set',
    startsAt: at('2027-11-07T01:30'),
    tiers: standardTiers,
  },
];

export async function applySeed(db: Db): Promise<void> {
  await db.query(`insert into settings (key, value) values ($1, $2) on conflict do nothing`, [
    OWNER_PASSCODE_KEY,
    SEEDED_OWNER_PASSCODE,
  ]);
  for (const performance of SEEDED_PERFORMANCES) {
    await createPerformance(db, performance);
  }
}
