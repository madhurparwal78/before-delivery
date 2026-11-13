/** Every line of copy the desk shows, exactly as the brief prints it. */
export const COPY = {
  signedOut: "Your desk session has ended. Sign in again.",
  badCode: "That code does not open a desk.",
  checkingCode: "Checking code",
  unreachable: "The desk can't reach the server. Trying again.",
  sendingAnswers: "Sending answers",
  waiting: "No round is open. The quizmaster will call the next one.",
  answerOver: "Answers can be up to 120 characters.",
  savingName: "Saving name",
  nameSaved: "Team name saved.",
  nameEmpty: "A team needs a name.",
  nameOver: "Team names can be up to 40 characters.",
  nameTaken: "Another team already has that name.",
  storingSheet: "Storing sheet",
  noFile: "Choose a sheet image to upload.",
  sheetType: "Sheets must be PNG or JPEG images.",
  sheetSize: "Sheets can be up to 5,000,000 bytes.",
  sheetDimensions: "Sheets must be 200 to 4,000 pixels on each side.",
  sheetOutage: "Sheet not stored — storage is unreachable. This round cannot open yet.",
  anotherOpen: "Close the open round before opening another.",
  loadingAnswers: "Loading answers",
  noNewer: "No newer answers yet.",
  searching: "Searching",
  emptySearch: "Type something to search for.",
  queryOver: "Searches can be up to 80 characters.",
  searchTimeout: "That search took too long. Try a shorter spelling.",
  sendingDispute: "Sending dispute",
  disputeSent: "Dispute sent to the quizmaster.",
  reasonEmpty: "Say what was wrong with the mark.",
  reasonOver: "Reasons can be up to 280 characters.",
  savingRuling: "Saving ruling",
  rulingSaved: "Ruling saved. The captain's note is on its way.",
  alreadyRuled: "This dispute was already ruled.",
  rulingMissing: "Choose Uphold or Dismiss.",
  notFound: "No such page in the quiz book.",
} as const;

export const tooManySubmits = (seconds: number) => `Too many submits. Please wait ${seconds} s and try again.`;
export const answersIn = (n: number) => `Answers in for round ${n}.`;
export const roundClosed = (n: number) => `Round ${n} is closed. Answers are no longer taken.`;
export const openingRound = (n: number) => `Opening round ${n}`;
export const roundOpen = (n: number) => `Round ${n} is open.`;
export const sheetMissing = (n: number) => `Upload and store the picture sheet before opening round ${n}.`;
export const closingRound = (n: number) => `Closing round ${n}`;
export const roundClosedByQuizmaster = (n: number) => `Round ${n} closed by the quizmaster.`;
export const sheetStored = (n: number) => `Sheet stored for round ${n}.`;
export const markedAnswer = (team: string, q: number, correct: boolean) => `${team}, question ${q}: ${correct ? "correct" : "wrong"}.`;
export const finishing = (n: number) => `Finishing round ${n}`;
export const roundMarked = (n: number) => `Round ${n} is marked.`;
export const answersLeft = (n: number, count: number) => `Answers left to mark in round ${n}: ${count}.`;
export const answersMatching = (count: number) => `Answers matching: ${count}.`;
export const noMatch = (query: string) => `No answers match "${query}".`;
export const windowClosed = (n: number) => `Disputes for round ${n} are closed.`;
export const disputeRuled = (ruling: string, n: number, q: number) => `Dispute ruled: ${ruling} for round ${n}, question ${q}.`;
export const publishing = (n: number) => `Publishing round ${n}`;
export const disputesOpen = (n: number, count: number) => `Open disputes left on round ${n}: ${count}. Rule on them before publishing.`;
export const newsOf = (n: number, leader: string, total: number) => `Round ${n} published. Leader: ${leader} on ${total} points.`;

export const STATUS_WORD = {
  drafted: "Drafted",
  open: "Open",
  closed: "Closed",
  marked: "Marked",
  published: "Published",
} as const;
