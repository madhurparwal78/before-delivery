export const OUTAGE_BANNER = 'Online play is unavailable right now. Pass and play still works.';

export const NAME_ERRORS: Record<string, string> = {
  NAME_TAKEN: 'That name is taken. Try one of these:',
  NAME_BLOCKED: "That name isn't allowed. Try one of these:",
  NAME_INVALID: 'Use 3 to 16 letters, numbers or underscores.',
};

export const SHOT_ERRORS: Record<string, string> = {
  NOT_YOUR_TURN: "It's not your turn.",
  TURN_EXPIRED: 'Time ran out. The turn has passed.',
  ILLEGAL_PLACEMENT: 'Striker overlaps a coin.',
  INVALID_INTENT: "That shot isn't valid. Aim again.",
  RATE_LIMITED: 'Too many moves. Wait a moment.',
  CLIENT_OUTDATED: 'A new version is available. Reload to keep playing.',
};

export const PLACEMENT_ILLEGAL = 'Striker overlaps a coin.';

export const EMOTE_LABELS: { emote: string; label: string }[] = [
  { emote: 'nice-shot', label: 'Nice shot' },
  { emote: 'well-played', label: 'Well played' },
  { emote: 'oops', label: 'Oops' },
  { emote: 'thinking', label: 'Thinking' },
  { emote: 'good-game', label: 'Good game' },
  { emote: 'hello', label: 'Hello' },
];

export const MODE_WORDS: Record<string, string> = {
  local: 'Pass and play',
  private: 'Private',
  casual: 'Casual',
  ranked: 'Ranked',
};

export const FORMAT_WORDS: Record<string, string> = {
  quick: 'Quick',
  classic: 'Classic',
};

export const RULES_SUMMARY = [
  'The striker sits on your baseline, touching both lines, within 200.0 mm of its centre.',
  'A placement is legal only when the striker centre is at least 36.15 mm from every coin and the queen.',
  'Pocket a coin of your colour and you shoot again. Pocket nothing and the turn passes.',
  'Pocket the striker and you owe a due coin: one of your pocketed coins returns to the centre.',
  'The queen must be covered by your next pocket, or she returns to the centre.',
  'Pocket your last coin with the queen covered to win the board: 1 point per opponent coin left, plus 3 for the queen below 22 points.',
  'Pocket the opponent\u2019s last coin, or your own last coin with the queen uncovered, and the board goes to your opponent.',
  'The white player breaks every board and has three attempts to touch a piece.',
  'Classic plays to 25 points or eight boards; Quick is one board.',
];
