import type { Position } from "../shared/api.ts";

// Seed data (brief: Seed data). Every club, player and person is invented.

type Tier = "A" | "B" | "C";

export const CLUBS: readonly { code: string; name: string; tier: Tier }[] = [
  { code: "HAR", name: "Harbour Rovers", tier: "A" },
  { code: "KIL", name: "Kilbarrow Celtic", tier: "A" },
  { code: "DRU", name: "Drumlin United", tier: "A" },
  { code: "LOU", name: "Lough Athletic", tier: "B" },
  { code: "SAL", name: "Saltmarsh Town", tier: "B" },
  { code: "FER", name: "Ferrybank FC", tier: "B" },
  { code: "GLE", name: "Glencarra Wanderers", tier: "B" },
  { code: "RAT", name: "Rathmoyle Albion", tier: "C" },
  { code: "BRA", name: "Brackenford City", tier: "C" },
  { code: "COR", name: "Corrib Vale", tier: "C" },
];

const SLOTS = ["GK1", "DEF1", "DEF2", "DEF3", "MID1", "MID2", "MID3", "FWD1", "FWD2"] as const;

const PRICES: Record<Tier, readonly number[]> = {
  A: [50, 60, 50, 45, 100, 70, 55, 105, 70],
  B: [45, 50, 45, 40, 80, 60, 50, 80, 60],
  C: [40, 45, 40, 40, 65, 50, 45, 65, 50],
};

const NAMES: Record<string, readonly string[]> = {
  HAR: ["Ronan Tierney", "Cathal Brophy", "Eoin Madigan", "Shane Folan", "Ciaran Doyle", "Darragh Whelan", "Fiachra Nolan", "Oisin Rafferty", "Tadhg Lenihan"],
  KIL: ["Padraig Hession", "Kevin Mulvey", "Liam Garvan", "Aaron Coyle", "Senan Gilroy", "Jamie Corcoran", "Niall Prendergast", "Conall Breen", "Mark Duignan"],
  DRU: ["Alan Furlong", "Dylan Keaveney", "Robbie Tansey", "Cian Hegarty", "Evan Moriarty", "Luke Fahy", "Rory Geraghty", "Sean Kinsella", "Adam Mullery"],
  LOU: ["Brian Cosgrave", "Paul Devane", "Owen Lally", "Ross Mannion", "Jack Treacy", "Killian Dolan", "Fionn Hughes", "Daniel Costigan", "Cormac Feeney"],
  SAL: ["Gavin Harte", "Ethan Loughran", "Ben Mahony", "Colm Ruane", "Dara Kerins", "Eamon Sheridan", "Patrick Quill", "Josh Merrigan", "Tom Gaughan"],
  FER: ["Declan Ormsby", "Conor Byrne", "Ryan Cuddihy", "Kyle Diskin", "Odhran Phelan", "Sam Fogarty", "Ultan Healy", "Noel Tuohy", "Jordan Kilkelly"],
  GLE: ["Martin Scully", "Ian Rowley", "Fergal Daly", "Neil Corkery", "Diarmuid Quigley", "Alex Morrin", "Cillian Galvin", "Barry Hanrahan", "Matthew Joyce"],
  RAT: ["Stephen Kearns", "Philip Nestor", "Gary Mulhern", "Lorcan Daws", "Hugh Barrett", "Nathan Clancy", "Peter Moran", "Chris Larkin", "Leon Coughlan"],
  BRA: ["Eddie Walshe", "Kieran Brennock", "Joe Stapleton", "David Ferris", "Jake Holohan", "Tiernan Keogh", "Michael Rabbitte", "Aidan Cullinane", "Shay Delahunt"],
  COR: ["Frank Gildea", "Tony Mulcahy", "Rob Kenneally", "Danny Spillane", "Gearoid Ward", "Lee Hennelly", "Mikey Grehan", "Callum Dineen", "Emmet Furey"],
};

interface SeedPlayer {
  id: string;
  name: string;
  club: string;
  position: Position;
  price_tenths: number;
}

export const PLAYERS: readonly SeedPlayer[] = CLUBS.flatMap((club) =>
  SLOTS.map((slot, index) => ({
    id: `${club.code}-${slot}`,
    name: NAMES[club.code]![index]!,
    club: club.code,
    position: slot.replace(/\d/g, "") as Position,
    price_tenths: PRICES[club.tier][index]!,
  })),
);

export const OPERATOR = {
  email: "operator@sideline.test",
  password: "chalk-and-floodlights-26",
  teamName: "Operations",
} as const;

export const LAST_GAMEWEEK = 36;
