// The season state machine (Business rules · Season state machine) and the season checks it implies.

import { type SeasonState } from "../../shared/roles.js";

export { type SeasonState } from "../../shared/roles.js";

export const SEASON_ACTIONS = ["start", "close", "reopen", "archive"] as const;
export type SeasonAction = (typeof SEASON_ACTIONS)[number];

const TRANSITIONS: Record<SeasonAction, { from: SeasonState; to: SeasonState }> = {
  start: { from: "draft", to: "in_season" },
  close: { from: "in_season", to: "locked" },
  reopen: { from: "locked", to: "in_season" },
  archive: { from: "locked", to: "archived" },
};

/** The state an action leads to, or null when the pair is illegal. */
export function transition(state: SeasonState, action: SeasonAction): SeasonState | null {
  const t = TRANSITIONS[action];
  return t.from === state ? t.to : null;
}

type SeasonBlock = "season_locked" | "season_archived";

/** Edit check 2: a locked workbook or anything at or after the cutoff instant is locked; archived is archived. */
export function editBlock(state: SeasonState, closesAtUtc: Date | null, now: Date): SeasonBlock | null {
  return settingsBlock(state) ?? (closesAtUtc !== null && now.getTime() >= closesAtUtc.getTime() ? "season_locked" : null);
}

/** Rename and cutoff changes are allowed only in draft and in season. */
export function settingsBlock(state: SeasonState): SeasonBlock | null {
  if (state === "archived") return "season_archived";
  if (state === "locked") return "season_locked";
  return null;
}

export const SEASON_LABEL: Record<SeasonState, string> = {
  draft: "draft",
  in_season: "in season",
  locked: "locked",
  archived: "archived",
};
