/** Published field sentences for 422 bodies. */
export const FIELD = {
  idempotencyKey: 'Send again from the form.',
  status: 'Choose waiting, answered or closed.',
  limit: 'Choose a page size from 1 to 100.',
  cursor: 'Start the list again.',
  currency: 'Use one of the published currencies.',
  eventField: 'This field is missing or not valid.',
  email: 'Enter your email.',
  password: 'Enter your password.',
  replyEmpty: 'Write a reply before sending.',
  replyLong: 'Replies can be up to 4,000 characters.',
  messageEmpty: 'Write a message before sending.',
  messageLong: 'Messages can be up to 2,000 characters.',
  topic: 'Choose what this is about.',
  effect: 'Choose grant or deny.',
  action: 'Choose read, reply, close or receipts.',
  ruleTopic: 'Choose bug, account, purchase, other or all topics.',
  fileType: 'Attach a PNG, JPEG or plain-text file.',
  fileCount: 'Three files per message at most.',
  secret: 'This field is missing or not valid.',
} as const;

/** Published interface copy. */
export const COPY = {
  heroHeadlineFirst: 'Every message,',
  heroHeadlineSecond: 'already checked.',
  heroSentence:
    'Answer your players from inside the game, with every purchase, match and pasted link checked before you read it.',
  heroSlabMessage: 'i never got the lantern pack',
  footer: 'Fernwick Software. Hushline answers players from inside the game.',
  signInHeading: 'Sign in to Hushline',
  signInEmailError: 'Enter your email.',
  signInPasswordError: 'Enter your password.',
  signingIn: 'Signing in...',
  badCredentials: "That email and password don't match.",
  sessionEnded: 'Your session ended. Sign in again.',
  signedOut: "You're signed out.",
  openingThread: 'Opening thread...',
  loadingMore: 'Loading more threads...',
  moreFailed: "More threads didn't load. Try again.",
  threadUnavailable: 'That thread is no longer available.',
  sendingReply: 'Sending reply...',
  replyEmpty: 'Write a reply before sending.',
  replyClosed: 'This thread is closed. It reopens when the player writes again.',
  replyFailed: 'Reply not sent. Try again.',
  closingThread: 'Closing thread...',
  threadClosed: 'Thread closed.',
  closeNotAnswered: 'Answer the player before closing.',
  closeAlready: 'This thread is already closed.',
  lookupPending: 'Asking the game server...',
  lookupEmpty: 'The game server lists no receipts for this player.',
  lookupOutage:
    "The game server isn't answering receipt lookups right now. Signed receipts in this thread are still checked.",
  addingRule: 'Adding rule...',
  ruleAdded: 'Rule added.',
  ruleNotSaved: 'Rule not saved. Try again.',
  revokingRule: 'Revoking rule...',
  ruleRevoked: 'Rule revoked.',
  ruleNotRevoked: 'Rule not revoked. Try again.',
  widgetSending: 'Sending...',
  widgetSent: 'Sent. Replies appear here.',
  widgetMessageEmpty: 'Write a message before sending.',
  widgetFailed: 'Message not sent. Try again.',
  widgetCanWrite: 'You can write again.',
  widgetFileSize: 'Files can be up to 5,000,000 bytes.',
  widgetFileType: 'Attach a PNG, JPEG or plain-text file.',
  widgetFileCount: 'Three files per message at most.',
  widgetIdentity: "This help window couldn't confirm who you are. Reopen it from the game.",
  emptyWaiting: 'No one is waiting. Back to the game.',
  emptyOther: 'No threads here.',
  tamperglassIdle: 'Select a message to see what was checked.',
  tamperglassReply: 'Replies are not checked.',
  notFoundHeading: "There's no page here.",
  notFoundLink: 'Back to the inbox',
} as const;

export function rateLimitNotice(secondsLeft: number): string {
  return `You're writing faster than the inbox can read. Try again in ${secondsLeft} seconds.`;
}

export function waitingAnnouncement(playerName: string): string {
  return `${playerName} is waiting.`;
}

export function replySentAnnouncement(playerName: string): string {
  return `Reply sent to ${playerName}.`;
}

export function refusedEventAnnouncement(playerName: string, reasonWords: string): string {
  return `Refused a game-server event for ${playerName}: ${reasonWords}.`;
}

export function showingThreads(count: number): string {
  return `Showing ${count} threads.`;
}

export function verdictsAnnouncement(verdicts: readonly string[]): string {
  return `Checked: ${verdicts.join('; ')}.`;
}

export function uploadingAnnouncement(pickedName: string): string {
  return `Uploading ${pickedName}...`;
}

export function attachedAnnouncement(filename: string): string {
  return `Attached ${filename}.`;
}

export function attachmentFailedAnnouncement(filename: string): string {
  return `${filename} didn't upload. Send it again later.`;
}
