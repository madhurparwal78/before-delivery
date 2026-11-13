import { caseFold } from "../shared/text";

export const NIGHT = 4;

export const LEAGUE = { name: "Snug Thursday League", season: "Autumn 2026", pub: "The Snug, Little Brampton" } as const;

export const SEED_TEAMS: ReadonlyArray<readonly [id: number, name: string, past: readonly [number, number, number]]> = [
  [1, "Tequila Mockingbird", [51, 48, 53]],
  [2, "Les Quizérables", [50, 49, 50]],
  [3, "Sherlock Ohms", [47, 52, 46]],
  [4, "The Quizzly Bears", [45, 50, 50]],
  [5, "The Mitochondriacs", [44, 46, 48]],
  [6, "Universally Challenged", [43, 45, 44]],
  [7, "Spelling Bees", [41, 44, 43]],
  [8, "Norfolk Enchants", [40, 42, 41]],
  [9, "Half Past Pints", [38, 40, 41]],
  [10, "The Lemon Tops", [36, 39, 40]],
  [11, "Dot's Lot", [35, 37, 36]],
  [12, "Bad Losers", [30, 33, 31]],
];

export const SEED_ROUNDS: ReadonlyArray<readonly [number, string, "standard" | "picture"]> = [
  [1, "General Knowledge", "standard"],
  [2, "History", "standard"],
  [3, "Picture Round: Doorways", "picture"],
  [4, "Music", "standard"],
  [5, "Science and Nature", "standard"],
  [6, "Picture Round: Shop Fronts", "picture"],
  [7, "Sport", "standard"],
  [8, "Final Round: Local Knowledge", "standard"],
];

export const QUIZMASTER_CODE = "HOST-4417";
export const MARKER_CODE = "MARK-2093";

export function captainCode(teamId: number): string {
  return `CAP-${String(teamId).padStart(2, "0")}`;
}

export function captainEmail(teamId: number): string {
  return `captain${String(teamId).padStart(2, "0")}@snug-league.test`;
}

export function nameKey(name: string): string {
  return caseFold(name);
}
