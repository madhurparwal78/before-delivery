export const COPY = {
  savingDots: 'Saving...',
  linkCopied: 'Link copied',
  linkReplaced: 'Link replaced. The old link no longer works.',
  logoUpdated: 'Logo updated.',
  checkinClosedAnnouncement: 'Check-in is closed.',
  tournamentStarted: 'The tournament has started',
  noLaterResets: 'No later matches will reset.',
  liveDown: 'Live updates paused. Reconnecting...',
  pageNotFound: "We couldn't find that page.",
  shareDead: 'This link no longer works.',
  shareDraft: 'This tournament is not public yet.',
  emptySetup: 'No entrants yet. Upload a roster or add names one by one.',
  emptyDisputes: 'No open disputes.',
  emptyHistory: 'No finished tournaments yet.',
  emptyTournaments: 'No tournaments yet.',
  checkedInBeforeStart: "You're checked in. Your first match appears here when the tournament starts.",
  noMoreMatches: 'No more matches for you in this tournament.',
  confirmingDots: 'Confirming...',
  willReset: 'Will reset',
} as const;

export const FIELD_MESSAGES = {
  username: 'Use 3 to 24 characters: a-z, 0-9 or _.',
  password: 'Use at least 8 characters.',
  tournamentName: 'Enter a name of 1 to 60 characters.',
  format: 'Choose a format.',
  fill: 'Choose a trophy fill.',
  timeZone: 'Choose a time zone from the list.',
  entrantName: 'Enter a name of 1 to 40 characters.',
  duplicateEntrant: 'That name is already in the field.',
  games: 'Enter a whole number from 0 to 99.',
  checkinAfterNow: 'Choose a time after now.',
  checkinFormat: 'Enter the time as YYYY-MM-DD HH:MM or YYYY-MM-DD HH:MM:SS.',
} as const;

export const noAccountNamed = (username: string): string => `No account named @${username}.`;
export const alreadyCoOrganizer = (username: string): string => `@${username} is already a co-organizer.`;
export const seedRangeMessage = (fieldSize: number): string => `Enter a seed from 1 to ${fieldSize}.`;

export const ERROR_MESSAGES = {
  bodyTooLarge: (limit: number) => `The request body is larger than ${limit} bytes.`,
  fileTooLarge: (limit: number) => `This file is larger than ${limit} bytes.`,
  unauthenticated: 'Sign in to continue.',
  badCredentials: 'Username or password is wrong.',
  usernameTaken: 'That username is taken.',
  rateLimitedSignin: 'Too many sign-in attempts. Wait a minute and try again.',
  rateLimitedReports: 'Too many score reports. Wait a minute and try again.',
  notFoundTournament: "We couldn't find that tournament.",
  notFoundShare: 'This link no longer works.',
  notPublicYet: 'This tournament is not public yet.',
  noRosterFile: 'No roster file has been added.',
  readOnly: 'Share links are read-only.',
  forbiddenTournament: 'You cannot change this tournament.',
  forbiddenReport: 'Only the two players in this match or an organizer can report it.',
  forbiddenConfirmOwn: 'You cannot confirm your own report.',
  forbiddenResolve: 'Only organizers can resolve disputes.',
  forbiddenOrganizerOnly: 'Only the organizer can do this.',
  forbiddenCrossSite: 'Cross-site requests are refused.',
  staleMatch: (username: string, score: string) => `This match was updated by ${username}. Current score: ${score}.`,
  alreadyResolved: (username: string, upper: number, lower: number) =>
    `This dispute was already resolved by ${username}. Result: ${upper}-${lower}.`,
  stalePreview: 'The bracket changed since this preview. Review the edit again.',
  staleSeeding: (username: string) => `The seeding was changed by ${username}. The list now shows their order.`,
  checkinClosed: 'Check-in is closed.',
  validationFields: 'Check the highlighted fields.',
  needWinner: 'Elimination matches need a winner.',
  needOneGame: 'A score needs at least one game.',
  disputeMustDiffer: 'Change the score to dispute it.',
  logoType: 'Logos must be PNG or JPEG images.',
  rosterInvalid: 'The roster was not added. Fix these lines and upload again.',
  storageUnavailable: 'File storage is unavailable. Nothing was added. Try again in a moment.',
} as const;

export const WRONG_STATE = {
  matchHasResult: 'This match already has a result.',
  matchDisputed: 'This match is disputed. An organizer will resolve it.',
  alreadyReported: 'You already reported this match.',
  noReport: 'There is no report to answer.',
  noDispute: 'There is no open dispute.',
  notReady: 'This match is not ready to play.',
  onlyConfirmedEditable: 'Only confirmed or resolved results can be edited.',
  notRunning: 'The tournament is not running.',
  finished: 'This tournament is finished. Its results can no longer change.',
  alreadyStarted: 'The tournament has already started.',
  checkinNotOpen: 'Check-in is not open.',
  closeCheckinFirst: 'Close check-in before starting.',
  needTwoEntrants: 'At least 2 entrants are needed to start.',
  needTwoCheckedIn: 'At least 2 checked-in entrants are needed to start.',
  finishRoundFirst: (round: number) => `Finish every match in round ${round} first.`,
  noPairing: 'No pairing without a rematch exists.',
  checkinAlreadyOpen: 'Check-in is already open.',
  checkinAlreadyClosed: 'Check-in has already closed. Go back to draft to open it again.',
  alreadyDraft: 'The tournament is already a draft.',
  onlySwissRounds: 'Only Swiss tournaments have a next round.',
  standingsOnly: 'Standings exist only for round robin and Swiss.',
} as const;

export const ROSTER_ERRORS = {
  notUtf8: 'The roster file is not UTF-8 text.',
  empty: 'The roster file is empty.',
  extension: 'Roster files end in .cupfold.txt.',
  count: (n: number) => `The roster has ${n} entrants. A roster needs 2 to 128.`,
  seedNotNumber: (line: number) => `Line ${line}: seed must be a whole number from 1 to 128`,
  seedTooLarge: (line: number, seed: number, max: number) =>
    `Line ${line}: seed ${seed} is larger than the number of entrants (${max})`,
  seedUsed: (line: number, seed: number, first: number) =>
    `Line ${line}: seed ${seed} is already used on line ${first}`,
  nameEmpty: (line: number) => `Line ${line}: name is empty`,
  nameLong: (line: number) => `Line ${line}: name is longer than 40 characters`,
  duplicateName: (line: number, firstSpelling: string, first: number) =>
    `Line ${line}: duplicate name "${firstSpelling}" (first on line ${first})`,
  noAccount: (line: number, username: string) => `Line ${line}: no account named @${username}`,
  accountUsed: (line: number, username: string, first: number) =>
    `Line ${line}: @${username} is already on line ${first}`,
} as const;

export const YOUR_ACTION = {
  reported: (opponent: string) => `Score reported, awaiting ${opponent}`,
  confirmed: 'Score confirmed',
  disputed: 'Score disputed',
  resolved: 'Dispute resolved',
  resultSaved: 'Result saved',
  resultEdited: 'Result edited',
  called: 'Match called',
  moved: (name: string, seed: number) => `${name} moved to seed ${seed}`,
} as const;

export const ANNOUNCE = {
  advancesRound: (name: string, round: number) => `${name} advances to round ${round}`,
  advancesWinners: (name: string, round: number) => `${name} advances to winners round ${round}`,
  dropsLosers: (name: string, round: number) => `${name} drops to losers round ${round}`,
  advancesLosers: (name: string, round: number) => `${name} advances to losers round ${round}`,
  advancesGrandFinal: (name: string) => `${name} advances to the grand final`,
  grandFinalReset: 'Grand final reset needed',
  winsTournament: (name: string) => `${name} wins the tournament`,
  matchesReset: (n: number) => (n === 1 ? '1 match reset' : `${n} matches reset`),
  checkedIn: (name: string) => `${name} checked in`,
  checkinClosed: 'Check-in is closed.',
  started: 'The tournament has started',
  roundPaired: (round: number) => `Round ${round} is paired`,
} as const;

export const RESET_COUNT = {
  many: (n: number, confirmed: number) => `${n} matches will reset, ${confirmed} of them confirmed`,
  oneConfirmed: '1 match will reset, it is confirmed',
  oneUnconfirmed: '1 match will reset, it is not confirmed',
  none: 'No later matches will reset.',
} as const;

export const resetCountSentence = (count: number, confirmedCount: number): string => {
  if (count === 0) return RESET_COUNT.none;
  if (count === 1) return confirmedCount === 1 ? RESET_COUNT.oneConfirmed : RESET_COUNT.oneUnconfirmed;
  return RESET_COUNT.many(count, confirmedCount);
};

export const PAGE_NOTICE = {
  removedNoShows: (names: string[]) =>
    names.length === 1
      ? `Removed 1 no-show: ${names[0]}.`
      : `Removed ${names.length} no-shows: ${names.join(', ')}.`,
  addedEntrants: (n: number, fileName: string) => `Added ${n} entrants from ${fileName}.`,
} as const;

export const checkinCount = (checkedIn: number, total: number): string => `${checkedIn} of ${total} checked in`;
export const checkinClosesAt = (time: string, zone: string): string => `Check-in closes at ${time} (${zone})`;
export const checkinClosedAt = (time: string, zone: string): string => `Check-in closed at ${time} (${zone})`;
export const autoConfirmsIn = (minutes: number, seconds: number): string =>
  `Auto-confirms in ${minutes}:${String(seconds).padStart(2, '0')}`;
