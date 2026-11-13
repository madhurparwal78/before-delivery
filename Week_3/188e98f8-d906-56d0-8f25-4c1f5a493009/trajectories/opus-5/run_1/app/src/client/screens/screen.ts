/** What every screen is, and what every poll brings it. */

import type { LeagueTable, Round } from '../../shared/model.js';

export interface PollState {
  rounds: Round[];
  night: number;
  table: LeagueTable;
}

export interface Screen {
  root: HTMLElement;
  signOut: HTMLElement | null;
  /** Called once the screen is on the page. */
  land(): void;
  /** Called on landing and then at every polling delay. */
  poll(state: PollState): Promise<void>;
}
