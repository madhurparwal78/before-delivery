import { randomInt } from "node:crypto";

// Standings order and join codes (brief: Standings and totals, Join codes).
interface Ranked {
  manager_id: string;
  team_name: string;
  season_total: number;
}

export function rankStandings<T extends Ranked>(rows: readonly T[]): (T & { rank: number })[] {
  const ordered = [...rows].sort((a, b) => {
    if (a.season_total !== b.season_total) return b.season_total - a.season_total;
    const nameA = a.team_name.toLowerCase();
    const nameB = b.team_name.toLowerCase();
    if (nameA !== nameB) return nameA < nameB ? -1 : 1;
    return a.manager_id < b.manager_id ? -1 : a.manager_id > b.manager_id ? 1 : 0;
  });
  return ordered.map((row, index) => ({ ...row, rank: index + 1 }));
}

// Capital letters and digits without the look-alikes O, 0, I and 1.
const JOIN_CODE_ALPHABET = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"].filter((c) => !"O0I1".includes(c)).join("");

export function newJoinCode(): string {
  return Array.from({ length: 6 }, () => JOIN_CODE_ALPHABET[randomInt(JOIN_CODE_ALPHABET.length)]).join("");
}
