/** Every published string, in one place. */
export const copy = {
  saving: (path: string) => `Saving ${path}…`,
  saved: (path: string, revision: number) => `Saved ${path} as r${revision}`,
  saveStale: (path: string) => `Not saved: a newer version of ${path} exists`,
  saveUnstorable: (path: string) =>
    `Not saved: ${path} contains a character that cannot be stored`,
  saveFailed: 'Not saved. Your text is still here; try again.',

  accepting: 'Accepting suggestion…',
  rejecting: 'Rejecting suggestion…',
  accepted: (open: number) =>
    open === 1 ? 'Suggestion accepted, 1 open remains' : `Suggestion accepted, ${open} open remain`,
  rejected: (open: number) =>
    open === 1 ? 'Suggestion rejected, 1 open remains' : `Suggestion rejected, ${open} open remain`,
  alreadyDecided: (status: string, name: string) => `Already ${status} by ${name}`,
  suggestionOrphaned: 'This suggestion lost its passage and can no longer be applied',
  resolutionDropped: 'Not applied. Your connection dropped; try again.',

  sending: 'Sending…',
  suggestionAdded: 'Suggestion added',
  commentPosted: 'Comment posted',
  replyPosted: 'Reply posted',
  threadResolved: 'Thread resolved',
  passageChanged: 'The passage changed; select it again',
  threadAlreadyResolved: 'This thread is already resolved',

  forbidden: (role: string) => `You can no longer do that. Your role on this project is now ${role}.`,
  roleChanged: (role: string) => `Your role on this project is now ${role}.`,
  somethingWrong: 'Something went wrong. Try again.',

  creatingFile: (path: string) => `Creating ${path}…`,
  createdFile: (path: string) => `Created ${path}`,
  pathTaken: (path: string) => `${path} already exists`,
  deletingFile: (path: string) => `Deleting ${path}…`,
  deletedFile: (path: string) => `Deleted ${path}`,

  uploading: (file: string) => `Uploading ${file}…`,
  uploaded: (path: string) => `Uploaded ${path}`,
  uploadTooLarge: (file: string) => `${file} is too large for its file type`,
  uploadType: (file: string) => `${file} is not an allowed file type`,
  uploadName: (file: string) => `${file} is not an allowed file name`,

  labelling: 'Labelling…',
  labelled: (revision: number, label: string) => `Labelled r${revision} as ${label}`,
  restoring: (label: string) => `Restoring ${label}…`,
  restored: (label: string, revision: number) => `Restored ${label} as r${revision}`,

  invitePending: 'Sending invitation…',
  inviteSent: (email: string) => `Invitation sent to ${email}`,
  inviteMailDown: 'Invitation not sent: email is unavailable. Try again shortly.',
  inviteRateLimited: (minutes: number) =>
    minutes === 1
      ? 'Invitation not sent: this project has reached 10 invitations this hour. Try again in 1 minute.'
      : `Invitation not sent: this project has reached 10 invitations this hour. Try again in ${minutes} minutes.`,
  inviteAlreadyMember: (email: string) => `${email} is already a member`,
  inviteAlreadyPending: (email: string) => `${email} already has a pending invitation`,
  inviteRevoked: (email: string) => `Invitation to ${email} revoked`,

  memberRole: (name: string, role: string) => `${name} is now ${role}`,
  memberRemoved: (name: string) => `${name} was removed`,
  lastOwner: 'A project needs at least one owner',

  shareCreated: 'Share link created',
  shareRegenerated: 'Share link regenerated. The old link no longer works.',
  shareRevoked: 'Share link revoked',

  exportPending: 'Running submission check…',
  exportReady: (revision: number) => `Export of r${revision} ready to download`,
  exportNotReady: (a: number, b: number, c: number, d: number) =>
    `Not ready to export: ${a} open suggestions, ${b} open threads, ${c} undefined citations, ${d} duplicate keys`,

  threadResolvedBy: (name: string) => `This thread was resolved by ${name}`,
  threadMissing: 'That comment is no longer available',

  storageUnavailable: 'Figure storage unavailable. Text editing still works; try again shortly.',

  citationCheck: (count: number) =>
    count === 0
      ? 'No undefined citations'
      : count === 1
        ? '1 undefined citation'
        : `${count} undefined citations`,

  accessLost: (title: string) => `You no longer have access to ${title}.`,
  accessUnknown: 'You do not have access to that project.',

  invitationSentence: (inviter: string, role: string) => `${inviter} invited you to join as ${role}.`,
  invitationHint:
    'If you already use Marginalia, enter your existing password; your display name stays as it is.',
  invitationAlreadyMember: (title: string) => `You already belong to ${title}.`,
  invitationInvalid: 'This invitation is no longer valid',

  deleteConfirmBody: (path: string) =>
    `This removes ${path} from the current files. Restoring an earlier label that holds it brings it back.`,
  restoreConfirmBody: (label: string) =>
    `This adds a new revision whose files match ${label} exactly. Nothing in the ledger is erased.`,
  staleSaveBody: (path: string) =>
    `Someone saved ${path} after you opened it. Your changes were not saved; copy them from below.`,

  unsavedChanges: 'Unsaved changes',
  figureUnavailable: 'Figure unavailable',
  readOnlyView: 'Read-only view',
  deadShareLink: 'This link is no longer active',

  expiresOn: (when: string) => `Expires on ${when}`,
  expiredOn: (when: string) => `Expired on ${when}`,

  fields: {
    credentials: 'Email or password is incorrect.',
    title: 'Enter a title of 1 to 120 characters.',
    displayName: 'Enter a display name of 1 to 80 characters.',
    passwordNew: 'Use at least 10 characters.',
    passwordMismatch: 'That password does not match this account.',
    email: 'Enter a valid email address.',
    label: 'Enter a label of 1 to 60 characters.',
    labelTaken: 'That label is already used in this project.',
    comment: 'Write a comment of 1 to 4,000 characters.',
    unstorable: 'This text contains a character that cannot be stored.',
    path: 'Use letters, digits, dots, hyphens and underscores, separated by slashes.',
  },
};
