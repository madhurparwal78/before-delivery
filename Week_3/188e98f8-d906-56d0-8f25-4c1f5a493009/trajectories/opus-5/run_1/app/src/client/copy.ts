/** Every published line of copy, word for word. */

export const COPY = {
  signInPending: 'Checking code',
  badCode: 'That code does not open a desk.',
  signedOut: 'Your desk session has ended. Sign in again.',

  submitPending: 'Sending answers',
  submitDone: (round: number): string => `Answers in for round ${round}.`,
  answerTooLong: 'Answers can be up to 120 characters.',
  roundClosed: (round: number): string => `Round ${round} is closed. Answers are no longer taken.`,
  tooManySubmits: (seconds: number): string => `Too many submits. Please wait ${seconds} s and try again.`,
  waiting: 'No round is open. The quizmaster will call the next one.',

  renamePending: 'Saving name',
  renameDone: 'Team name saved.',
  nameRequired: 'A team needs a name.',
  nameTooLong: 'Team names can be up to 40 characters.',
  nameTaken: 'Another team already has that name.',

  uploadPending: 'Storing sheet',
  uploadDone: (round: number): string => `Sheet stored for round ${round}.`,
  noFileChosen: 'Choose a sheet image to upload.',
  sheetWrongType: 'Sheets must be PNG or JPEG images.',
  sheetTooLarge: 'Sheets can be up to 5,000,000 bytes.',
  sheetDimensions: 'Sheets must be 200 to 4,000 pixels on each side.',
  sheetOutage: 'Sheet not stored — storage is unreachable. This round cannot open yet.',

  openPending: (round: number): string => `Opening round ${round}`,
  openDone: (round: number): string => `Round ${round} is open.`,
  sheetMissing: (round: number): string =>
    `Upload and store the picture sheet before opening round ${round}.`,
  anotherOpen: 'Close the open round before opening another.',

  closePending: (round: number): string => `Closing round ${round}`,
  closeDone: (round: number): string => `Round ${round} closed by the quizmaster.`,

  markDone: (team: string, question: number, points: 0 | 1): string =>
    `${team}, question ${question}: ${points === 1 ? 'correct' : 'wrong'}.`,
  finishPending: (round: number): string => `Finishing round ${round}`,
  finishDone: (round: number): string => `Round ${round} is marked.`,
  unmarkedLeft: (round: number, count: number): string => `Answers left to mark in round ${round}: ${count}.`,

  archivePending: 'Loading answers',
  archiveEmpty: 'No newer answers yet.',

  searchPending: 'Searching',
  searchDone: (count: number): string => `Answers matching: ${count}.`,
  searchNone: (query: string): string => `No answers match "${query}".`,
  searchEmpty: 'Type something to search for.',
  searchTooLong: 'Searches can be up to 80 characters.',
  searchTimeout: 'That search took too long. Try a shorter spelling.',

  disputePending: 'Sending dispute',
  disputeDone: 'Dispute sent to the quizmaster.',
  reasonRequired: 'Say what was wrong with the mark.',
  reasonTooLong: 'Reasons can be up to 280 characters.',
  disputeWindowClosed: (round: number): string => `Disputes for round ${round} are closed.`,
  disputeRuled: (ruling: string, round: number, question: number): string =>
    `Dispute ruled: ${ruling} for round ${round}, question ${question}.`,

  rulingPending: 'Saving ruling',
  rulingDone: "Ruling saved. The captain's note is on its way.",
  alreadyRuled: 'This dispute was already ruled.',

  publishPending: (round: number): string => `Publishing round ${round}`,
  published: (round: number, leader: string, total: number): string =>
    `Round ${round} published. Leader: ${leader} on ${total} points.`,
  disputesPending: (round: number, count: number): string =>
    `Open disputes left on round ${round}: ${count}. Rule on them before publishing.`,

  unreachable: "The desk can't reach the server. Trying again.",
  notFound: 'No such page in the quiz book.',

  timeLeft: (clock: string): string => `${clock} left`,
} as const;
