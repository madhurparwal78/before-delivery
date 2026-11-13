import type { Position } from '../shared/domain';

export interface ClubSeed {
  code: string;
  name: string;
  tier: 'A' | 'B' | 'C';
}

export const CLUBS: ClubSeed[] = [
  { code: 'HAR', name: 'Harbour Rovers', tier: 'A' },
  { code: 'KIL', name: 'Kilbarrow Celtic', tier: 'A' },
  { code: 'DRU', name: 'Drumlin United', tier: 'A' },
  { code: 'LOU', name: 'Lough Athletic', tier: 'B' },
  { code: 'SAL', name: 'Saltmarsh Town', tier: 'B' },
  { code: 'FER', name: 'Ferrybank FC', tier: 'B' },
  { code: 'GLE', name: 'Glencarra Wanderers', tier: 'B' },
  { code: 'RAT', name: 'Rathmoyle Albion', tier: 'C' },
  { code: 'BRA', name: 'Brackenford City', tier: 'C' },
  { code: 'COR', name: 'Corrib Vale', tier: 'C' },
];

export const TIER_PRICES: Record<'A' | 'B' | 'C', Record<string, number>> = {
  A: { GK1: 50, DEF1: 60, DEF2: 50, DEF3: 45, MID1: 100, MID2: 70, MID3: 55, FWD1: 105, FWD2: 70 },
  B: { GK1: 45, DEF1: 50, DEF2: 45, DEF3: 40, MID1: 80, MID2: 60, MID3: 50, FWD1: 80, FWD2: 60 },
  C: { GK1: 40, DEF1: 45, DEF2: 40, DEF3: 40, MID1: 65, MID2: 50, MID3: 45, FWD1: 65, FWD2: 50 },
};

export const PLAYER_NAMES: Record<string, string[]> = {
  HAR: ['Ronan Tierney', 'Cathal Brophy', 'Eoin Madigan', 'Shane Folan', 'Ciaran Doyle', 'Darragh Whelan', 'Fiachra Nolan', 'Oisin Rafferty', 'Tadhg Lenihan'],
  KIL: ['Padraig Hession', 'Kevin Mulvey', 'Liam Garvan', 'Aaron Coyle', 'Senan Gilroy', 'Jamie Corcoran', 'Niall Prendergast', 'Conall Breen', 'Mark Duignan'],
  DRU: ['Alan Furlong', 'Dylan Keaveney', 'Robbie Tansey', 'Cian Hegarty', 'Evan Moriarty', 'Luke Fahy', 'Rory Geraghty', 'Sean Kinsella', 'Adam Mullery'],
  LOU: ['Brian Cosgrave', 'Paul Devane', 'Owen Lally', 'Ross Mannion', 'Jack Treacy', 'Killian Dolan', 'Fionn Hughes', 'Daniel Costigan', 'Cormac Feeney'],
  SAL: ['Gavin Harte', 'Ethan Loughran', 'Ben Mahony', 'Colm Ruane', 'Dara Kerins', 'Eamon Sheridan', 'Patrick Quill', 'Josh Merrigan', 'Tom Gaughan'],
  FER: ['Declan Ormsby', 'Conor Byrne', 'Ryan Cuddihy', 'Kyle Diskin', 'Odhran Phelan', 'Sam Fogarty', 'Ultan Healy', 'Noel Tuohy', 'Jordan Kilkelly'],
  GLE: ['Martin Scully', 'Ian Rowley', 'Fergal Daly', 'Neil Corkery', 'Diarmuid Quigley', 'Alex Morrin', 'Cillian Galvin', 'Barry Hanrahan', 'Matthew Joyce'],
  RAT: ['Stephen Kearns', 'Philip Nestor', 'Gary Mulhern', 'Lorcan Daws', 'Hugh Barrett', 'Nathan Clancy', 'Peter Moran', 'Chris Larkin', 'Leon Coughlan'],
  BRA: ['Eddie Walshe', 'Kieran Brennock', 'Joe Stapleton', 'David Ferris', 'Jake Holohan', 'Tiernan Keogh', 'Michael Rabbitte', 'Aidan Cullinane', 'Shay Delahunt'],
  COR: ['Frank Gildea', 'Tony Mulcahy', 'Rob Kenneally', 'Danny Spillane', 'Gearoid Ward', 'Lee Hennelly', 'Mikey Grehan', 'Callum Dineen', 'Emmet Furey'],
};

const SLOTS: { slot: string; position: Position }[] = [
  { slot: 'GK1', position: 'GK' },
  { slot: 'DEF1', position: 'DEF' },
  { slot: 'DEF2', position: 'DEF' },
  { slot: 'DEF3', position: 'DEF' },
  { slot: 'MID1', position: 'MID' },
  { slot: 'MID2', position: 'MID' },
  { slot: 'MID3', position: 'MID' },
  { slot: 'FWD1', position: 'FWD' },
  { slot: 'FWD2', position: 'FWD' },
];

export interface PlayerSeed {
  id: string;
  name: string;
  club: string;
  position: Position;
  price_tenths: number;
}

export const PLAYERS: PlayerSeed[] = CLUBS.flatMap((club) =>
  SLOTS.map((entry, index) => ({
    id: `${club.code}-${entry.slot}`,
    name: PLAYER_NAMES[club.code][index],
    club: club.code,
    position: entry.position,
    price_tenths: TIER_PRICES[club.tier][entry.slot],
  })),
);
