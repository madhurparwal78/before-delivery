/** Every published string lives here, so the server and the browser announce the same words. */

export const announce = {
  zoomIn: (text: string) => `Zoomed into ${text}`,
  zoomOut: (text: string) => `Zoomed out to ${text}`,
  zoomOutHome: 'Zoomed out to Home',
  indented: (parent: string) => `Indented under ${parent}`,
  outdented: (parent: string) => `Outdented under ${parent}`,
  outdentedTopLevel: 'Outdented to top level',
  moved: (i: number, n: number, parent: string) => `Moved to position ${i} of ${n} under ${parent}`,
  movedTopLevel: (i: number, n: number) => `Moved to position ${i} of ${n} at top level`,
  completed: (text: string) => `Completed ${text}`,
  notCompleted: (text: string) => `Marked ${text} not complete`,
  collapsed: (text: string) => `Collapsed ${text}`,
  expanded: (text: string) => `Expanded ${text}`,
  mirrored: (text: string) => `Mirrored ${text}`,
  copyRemoved: (text: string) => `Removed copy of ${text}`,
  trashed: (text: string) => `Moved ${text} to trash`,
  emptyDeleted: 'Deleted empty bullet',
  undid: (step: string) => `Undid ${step}`,
  redid: (step: string) => `Redid ${step}`,
  searchCount: (n: number) =>
    n === 0 ? 'No matching bullets' : n === 1 ? '1 matching bullet' : `${n} matching bullets`,
  hiddenCount: (n: number) =>
    n === 0
      ? 'No completed bullets hidden'
      : n === 1
        ? '1 completed bullet hidden'
        : `${n} completed bullets hidden`,
  showingCompleted: 'Showing completed bullets',
  boardPickUp: (text: string) =>
    `Picked up ${text}. Use the arrow keys to move it, Space to drop, Escape to cancel.`,
  boardStep: (text: string, i: number, n: number, column: string) =>
    `${text}: position ${i} of ${n} in ${column}`,
  boardDrop: (text: string, column: string, i: number, n: number) =>
    `Dropped ${text} in ${column}, position ${i} of ${n}`,
  boardCancel: (text: string, column: string) => `Move cancelled. ${text} is back in ${column}.`,
  codeSent: (email: string) => `We sent a 6-digit code to ${email}.`,
  invitationSent: (email: string) => `Invitation sent to ${email}`,
  accessRemoved: (email: string) => `Removed access for ${email}`,
  invitationAccepted: (text: string) => `You can now edit ${text}.`,
  branchReloaded: 'This branch was reloaded to catch up with recent changes.',
  syncResumed: 'Live sync is back.'
} as const;

export const alerts = {
  noPreviousSibling: `Can't indent: there is no bullet above it at this level.`,
  tooDeep: (max: number) => `Can't indent: an outline goes at most ${max} levels deep.`,
  atTop: `Can't outdent: it is already at the top level.`,
  atFirst: `Can't move up: it is already first.`,
  atLast: `Can't move down: it is already last.`,
  insideItself: `Can't place a bullet inside itself.`,
  backspaceWithChildren: `Can't delete with Backspace: this bullet has bullets inside. Press Ctrl+Shift+Backspace to delete it.`,
  shareRoot: 'The shared bullet stays where its owner put it.',
  textTooLong: (max: number) => `A bullet holds at most ${max} characters.`,
  staleRevision: (name: string) =>
    `${name} changed this bullet first. Their text is shown; your edit was not saved.`,
  nothingToUndo: 'Nothing more to undo.',
  nothingToRedo: 'Nothing more to redo.',
  editedSince: (name: string) => `Can't undo: ${name} has edited this bullet since.`,
  originGone: `Can't undo: the place it came from was deleted.`,
  invitationNotSent: (email: string) =>
    `Invitation not sent to ${email}. Mail can't be delivered right now; use Retry.`,
  codeNotSent: `We couldn't send your code right now. Try again in a minute.`,
  saveFailed: `Couldn't save your last change. Retrying when the connection returns.`,
  notRetryable: `That invitation can't be retried.`,
  shareClosed: 'That share is already closed.',
  emailTaken: 'That email is already registered.',
  signInFailed: 'Email or password is wrong.'
} as const;

export const fixed = {
  placeholder: 'This bullet was deleted.',
  deleteDialog: (text: string, count: number) =>
    `Delete ${text} and the ${countBullets(count)} inside it?`,
  emptyHome: 'Your outline is empty. Start with one thought.',
  emptyBranch: 'Nothing inside this bullet yet.',
  notFoundHeading: `We couldn't find that bullet`,
  notFoundSentence: `It may have been deleted, or it isn't shared with you.`,
  syncPaused: 'Live sync paused. Your edits are saved and other tabs will catch up when it returns.',
  accessEnded: 'This branch is no longer shared with you.',
  inviteSignedOut: (email: string) =>
    `Sign in or create an account with ${email} to open this branch.`,
  inviteWrongAccount: 'This invitation was sent to a different email address.',
  inviteLapsed: 'This invitation has expired. Ask the owner to send a new one.',
  nameRequired: 'Enter your name.',
  emailInvalid: 'Enter a valid email address.',
  passwordShort: 'Use at least 10 characters.',
  codeWrong: `That code doesn't match. Check the latest email.`,
  codeExpired: 'That code has expired. Send a new one.',
  inviteSelf: `You can't invite yourself.`,
  alreadyInvited: 'This address already has an open invitation to this bullet.',
  searchTooLong: (max: number) => `Search holds at most ${max} characters.`
} as const;

export function countBullets(count: number): string {
  return count === 1 ? '1 bullet' : `${count} bullets`;
}

/** The undo step names, used in `Undid <step>` and `Redid <step>`. */
export type StepKind =
  | 'new bullet'
  | 'text edit'
  | 'delete'
  | 'move'
  | 'indent'
  | 'outdent'
  | 'completion'
  | 'mirror';

export const marketing = {
  headlineOne: 'Think in branches.',
  headlineTwo: 'Zoom into the one that matters.',
  lead: 'One outline for plans, drafts and lists. Fold it, mirror it, and share a single branch.',
  shortcutStripLabel: 'Every move has a key',
  featureHeading: 'One list, four ways to see it',
  keyboardHelp: 'Press Alt and an arrow key to zoom into or out of any bullet.',
  keyboardHelpLink: 'See every key →',
  closingHeading: 'Your next plan already has branches.'
} as const;

/** The hero demo list, in typing order. */
export const demoList = [
  'Prepare the site',
  'Clear the lot',
  'Test the soil',
  'Plant the beds',
  'Tomatoes',
  'Herb spiral',
  'Find helpers',
  'Saturday crew'
] as const;

/** Which demo lines become children of which parent when Nest it is pressed. */
export const demoNesting: ReadonlyArray<{ parent: string; children: readonly string[] }> = [
  { parent: 'Prepare the site', children: ['Clear the lot', 'Test the soil'] },
  { parent: 'Plant the beds', children: ['Tomatoes', 'Herb spiral'] },
  { parent: 'Find helpers', children: ['Saturday crew'] }
];
