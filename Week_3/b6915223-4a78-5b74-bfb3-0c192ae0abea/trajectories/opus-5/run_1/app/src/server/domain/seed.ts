import type { Position } from '../../shared/types.ts';

export const OPERATOR_EMAIL = 'operator@sideline.test';
export const OPERATOR_PASSWORD = 'chalk-and-floodlights-26';
export const OPERATOR_TEAM_NAME = 'Operations';

export const TOTAL_GAMEWEEKS = 36;

type Tier = 'A' | 'B' | 'C';
type Slot = 'GK1' | 'DEF1' | 'DEF2' | 'DEF3' | 'MID1' | 'MID2' | 'MID3' | 'FWD1' | 'FWD2';

const SLOTS: Slot[] = ['GK1', 'DEF1', 'DEF2', 'DEF3', 'MID1', 'MID2', 'MID3', 'FWD1', 'FWD2'];

const SLOT_POSITIONS: Record<Slot, Position> = {
  GK1: 'GK',
  DEF1: 'DEF',
  DEF2: 'DEF',
  DEF3: 'DEF',
  MID1: 'MID',
  MID2: 'MID',
  MID3: 'MID',
  FWD1: 'FWD',
  FWD2: 'FWD',
};

const TIER_PRICES_TENTHS: Record<Tier, Record<Slot, number>> = {
  A: { GK1: 50, DEF1: 60, DEF2: 50, DEF3: 45, MID1: 100, MID2: 70, MID3: 55, FWD1: 105, FWD2: 70 },
  B: { GK1: 45, DEF1: 50, DEF2: 45, DEF3: 40, MID1: 80, MID2: 60, MID3: 50, FWD1: 80, FWD2: 60 },
  C: { GK1: 40, DEF1: 45, DEF2: 40, DEF3: 40, MID1: 65, MID2: 50, MID3: 45, FWD1: 65, FWD2: 50 },
};

interface SeedClub {
  code: string;
  name: string;
  tier: Tier;
  names: Record<Slot, string>;
}

const named = (values: string[]): Record<Slot, string> =>
  Object.fromEntries(SLOTS.map((slot, index) => [slot, values[index]!])) as Record<Slot, string>;

export const SEED_CLUBS: SeedClub[] = [
  {
    code: 'HAR',
    name: 'Harbour Rovers',
    tier: 'A',
    names: named([
      'Ronan Tierney',
      'Cathal Brophy',
      'Eoin Madigan',
      'Shane Folan',
      'Ciaran Doyle',
      'Darragh Whelan',
      'Fiachra Nolan',
      'Oisin Rafferty',
      'Tadhg Lenihan',
    ]),
  },
  {
    code: 'KIL',
    name: 'Kilbarrow Celtic',
    tier: 'A',
    names: named([
      'Padraig Hession',
      'Kevin Mulvey',
      'Liam Garvan',
      'Aaron Coyle',
      'Senan Gilroy',
      'Jamie Corcoran',
      'Niall Prendergast',
      'Conall Breen',
      'Mark Duignan',
    ]),
  },
  {
    code: 'DRU',
    name: 'Drumlin United',
    tier: 'A',
    names: named([
      'Alan Furlong',
      'Dylan Keaveney',
      'Robbie Tansey',
      'Cian Hegarty',
      'Evan Moriarty',
      'Luke Fahy',
      'Rory Geraghty',
      'Sean Kinsella',
      'Adam Mullery',
    ]),
  },
  {
    code: 'LOU',
    name: 'Lough Athletic',
    tier: 'B',
    names: named([
      'Brian Cosgrave',
      'Paul Devane',
      'Owen Lally',
      'Ross Mannion',
      'Jack Treacy',
      'Killian Dolan',
      'Fionn Hughes',
      'Daniel Costigan',
      'Cormac Feeney',
    ]),
  },
  {
    code: 'SAL',
    name: 'Saltmarsh Town',
    tier: 'B',
    names: named([
      'Gavin Harte',
      'Ethan Loughran',
      'Ben Mahony',
      'Colm Ruane',
      'Dara Kerins',
      'Eamon Sheridan',
      'Patrick Quill',
      'Josh Merrigan',
      'Tom Gaughan',
    ]),
  },
  {
    code: 'FER',
    name: 'Ferrybank FC',
    tier: 'B',
    names: named([
      'Declan Ormsby',
      'Conor Byrne',
      'Ryan Cuddihy',
      'Kyle Diskin',
      'Odhran Phelan',
      'Sam Fogarty',
      'Ultan Healy',
      'Noel Tuohy',
      'Jordan Kilkelly',
    ]),
  },
  {
    code: 'GLE',
    name: 'Glencarra Wanderers',
    tier: 'B',
    names: named([
      'Martin Scully',
      'Ian Rowley',
      'Fergal Daly',
      'Neil Corkery',
      'Diarmuid Quigley',
      'Alex Morrin',
      'Cillian Galvin',
      'Barry Hanrahan',
      'Matthew Joyce',
    ]),
  },
  {
    code: 'RAT',
    name: 'Rathmoyle Albion',
    tier: 'C',
    names: named([
      'Stephen Kearns',
      'Philip Nestor',
      'Gary Mulhern',
      'Lorcan Daws',
      'Hugh Barrett',
      'Nathan Clancy',
      'Peter Moran',
      'Chris Larkin',
      'Leon Coughlan',
    ]),
  },
  {
    code: 'BRA',
    name: 'Brackenford City',
    tier: 'C',
    names: named([
      'Eddie Walshe',
      'Kieran Brennock',
      'Joe Stapleton',
      'David Ferris',
      'Jake Holohan',
      'Tiernan Keogh',
      'Michael Rabbitte',
      'Aidan Cullinane',
      'Shay Delahunt',
    ]),
  },
  {
    code: 'COR',
    name: 'Corrib Vale',
    tier: 'C',
    names: named([
      'Frank Gildea',
      'Tony Mulcahy',
      'Rob Kenneally',
      'Danny Spillane',
      'Gearoid Ward',
      'Lee Hennelly',
      'Mikey Grehan',
      'Callum Dineen',
      'Emmet Furey',
    ]),
  },
];

export interface SeedPlayer {
  id: string;
  name: string;
  club: string;
  position: Position;
  price_tenths: number;
}

export const SEED_PLAYERS: SeedPlayer[] = SEED_CLUBS.flatMap((club) =>
  SLOTS.map((slot) => ({
    id: `${club.code}-${slot}`,
    name: club.names[slot],
    club: club.code,
    position: SLOT_POSITIONS[slot],
    price_tenths: TIER_PRICES_TENTHS[club.tier][slot],
  })),
);
