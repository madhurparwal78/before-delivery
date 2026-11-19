export const PLACEHOLDER_TEXT = "This bullet was deleted.";

export const ALERTS = {
  noPreviousSibling: "Can't indent: there is no bullet above it at this level.",
  atTop: "Can't outdent: it is already at the top level.",
  atFirst: "Can't move up: it is already first.",
  atLast: "Can't move down: it is already last.",
  insideItself: "Can't place a bullet inside itself.",
  backspaceWithChildren:
    "Can't delete with Backspace: this bullet has bullets inside. Press Ctrl+Shift+Backspace to delete it.",
  shareRoot: "The shared bullet stays where its owner put it.",
  nothingToUndo: "Nothing more to undo.",
  nothingToRedo: "Nothing more to redo.",
  originGone: "Can't undo: the place it came from was deleted.",
  codeNotSent: "We couldn't send your code right now. Try again in a minute.",
  saveFailed: "Couldn't save your last change. Retrying when the connection returns.",
  notRetryable: "That invitation can't be retried.",
  shareClosed: "That share is already closed.",
  emailTaken: "That email is already registered.",
  signInFailed: "Email or password is wrong.",
} as const;

export const FIELD_ERRORS = {
  name: "Enter your name.",
  email: "Enter a valid email address.",
  password: "Use at least 10 characters.",
  wrongCode: "That code doesn't match. Check the latest email.",
  expiredCode: "That code has expired. Send a new one.",
  selfInvite: "You can't invite yourself.",
  alreadyInvited: "This address already has an open invitation to this bullet.",
  body: "Send a JSON object.",
} as const;

export const INVITATION_SENTENCES = {
  lapsed: "This invitation has expired. Ask the owner to send a new one.",
  wrongAccount: "This invitation was sent to a different email address.",
} as const;

export const tooDeep = (max: number) => `Can't indent: an outline goes at most ${max} levels deep.`;
export const textTooLong = (max: number) => `A bullet holds at most ${max} characters.`;
export const searchTooLong = (max: number) => `Search holds at most ${max} characters.`;
export const staleSave = (name: string) =>
  `${name} changed this bullet first. Their text is shown; your edit was not saved.`;
export const editedSince = (name: string) => `Can't undo: ${name} has edited this bullet since.`;
export const invitationNotSent = (email: string) =>
  `Invitation not sent to ${email}. Mail can't be delivered right now; use Retry.`;
const bulletCount = (count: number) => (count === 1 ? "1 bullet" : `${count} bullets`);
export const deleteSentence = (text: string, inside: number) =>
  `Delete ${text} and the ${bulletCount(inside)} inside it?`;
export const matchCount = (n: number) =>
  n === 0 ? "No matching bullets" : n === 1 ? "1 matching bullet" : `${n} matching bullets`;
export const hiddenCount = (n: number) =>
  n === 0 ? "No completed bullets hidden" : n === 1 ? "1 completed bullet hidden" : `${n} completed bullets hidden`;
export const codeSent = (email: string) => `We sent a 6-digit code to ${email}.`;
export const invitationSent = (email: string) => `Invitation sent to ${email}`;
export const accessRemoved = (email: string) => `Removed access for ${email}`;
export const inviteSignedOut = (email: string) => `Sign in or create an account with ${email} to open this branch.`;

export const MOVE_REFUSAL_COPY = {
  share_root: ALERTS.shareRoot,
  no_previous_sibling: ALERTS.noPreviousSibling,
  at_top: ALERTS.atTop,
  at_first: ALERTS.atFirst,
  at_last: ALERTS.atLast,
  inside_itself: ALERTS.insideItself,
} as const;
