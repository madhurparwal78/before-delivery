export interface StandingCandidate {
  manager_id: string;
  team_name: string;
  season_total: number;
}

/** The one place the standings order is decided. */
export const standingsOrder = <T extends StandingCandidate>(members: T[]): T[] =>
  [...members].sort(
    (a, b) =>
      b.season_total - a.season_total ||
      a.team_name.toLocaleLowerCase().localeCompare(b.team_name.toLocaleLowerCase()) ||
      (a.manager_id < b.manager_id ? -1 : a.manager_id > b.manager_id ? 1 : 0),
  );
