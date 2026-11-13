export interface DomainLimits {
  readonly teamNameMax: 40;
  readonly answerMax: 120;
  readonly searchQueryMax: 80;
  readonly disputeReasonMax: 280;
}

export const LIMITS: DomainLimits = {
  teamNameMax: 40,
  answerMax: 120,
  searchQueryMax: 80,
  disputeReasonMax: 280,
};

export const ARCHIVE_PAGE_DEFAULT = 25;
export const ARCHIVE_PAGE_CAP = 100;
export const SEARCH_RESULTS_CAP = 100;
export const SEARCH_TIME_BUDGET_MS = 1500;
export const SEARCH_MAX_DEPTH = 4;
export const NIGHT_NUMBER = 4;
export const TOTAL_ROUNDS = 8;
export const QUESTIONS_PER_ROUND = 8;
export const TABLE_VERSION_SEED = 1;
export const ID_KEY_MAX = 64;
