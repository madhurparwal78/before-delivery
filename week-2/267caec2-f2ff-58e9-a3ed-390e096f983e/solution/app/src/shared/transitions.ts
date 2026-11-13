// Which entry and round actions are legal from which state (brief: Business rules, Entry states and Round states).
// The server's guards and the client's "only when legal" controls both read these tables.

const ENTRY_MOVES = {
  edit: ["draft"],
  delete: ["draft"],
  upload: ["draft"],
  remove_image: ["draft"],
  submit: ["draft"],
  withdraw: ["submitted"],
  pass: ["submitted"],
  disqualify: ["submitted", "screened"],
  reinstate: ["disqualified"],
} as const;
export type EntryAction = keyof typeof ENTRY_MOVES;

const ROUND_MOVES = {
  open: ["scheduled"],
  close: ["open"],
  confirm: ["closed"],
  add_juror: ["scheduled", "open"],
} as const;
export type RoundAction = keyof typeof ROUND_MOVES;

export function entryActionLegal(state: string, action: EntryAction): boolean {
  return (ENTRY_MOVES[action] as readonly string[]).includes(state);
}

export function roundActionLegal(state: string, action: RoundAction): boolean {
  return (ROUND_MOVES[action] as readonly string[]).includes(state);
}

export type FeeTier = "early_bird" | "standard";

export const TIER_LABEL: Record<FeeTier, string> = { early_bird: "Early-bird", standard: "Standard" };
