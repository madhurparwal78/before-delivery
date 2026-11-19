import type { PaneName, Visibility } from './api';

const PANE_LABEL: Record<PaneName, string> = { html: 'HTML', css: 'CSS', js: 'JS' };

export const paneLabel = (pane: PaneName): string => PANE_LABEL[pane];

export const copy = {
  tagline: 'Write a little HTML, CSS and JavaScript. Watch it run. Keep every version.',

  savePending: 'Saving…',
  saved: (n: number) => `Saved as version ${n}`,
  restoredLanding: (n: number, m: number) => `Restored version ${n} as version ${m}`,
  loadedLatest: (n: number) => `Loaded version ${n}`,
  saveStorageDown: 'Storage is unreachable, so this version was not saved. Your edits are still here.',
  savePaneTooBig: (pane: PaneName, limit: number) =>
    `The ${PANE_LABEL[pane]} pane is over ${limit} bytes, so this version was not saved.`,

  unverified: (email: string) => `Verify your email to do this. We sent a link to ${email}.`,
  conflict: (head: number) =>
    `Version ${head} of this pen was saved somewhere else. Your edits are still here.`,
  draftOffered: (time: string) => `You have unsaved edits from ${time}.`,

  versionLabel: (head: number) => (head > 0 ? `Version ${head}` : 'Not saved yet'),
  previewUpdated: 'Preview updated',

  loopStopped: (line: number, limit: number) =>
    `Stopped a loop on line ${line} after ${limit} iterations.`,
  blockedScript: (url: string) => `Script ${url} is not on the shelf.`,
  blockedRequest: (url: string) => `Request to ${url} was blocked. Pens cannot use the network.`,

  notOnShelf: (text: string) => `${text} is not on the shelf. Pick a pinned library from the list.`,
  visibilityChanged: (visibility: Visibility) => `This pen is now ${visibility}.`,
  tagFormat: 'Tags use 1 to 24 lowercase letters, digits or hyphens.',
  tooManyTags: (max: number) => `A pen can have up to ${max} tags.`,
  duplicateTag: 'That tag is already on this pen.',
  deleteStorageDown: 'Storage is unreachable, so the pen was not deleted.',

  deleteConfirm: (title: string) =>
    `Delete "${title}" and all its versions? Its forks stay, but they will no longer link here.`,
  deleted: (title: string) => `Deleted "${title}"`,

  exported: (n: number) => `Exported version ${n}`,
  nothingToExport: 'Save a version before exporting.',
  exportStorageDown: 'Storage is unreachable, so the export was not made. Your pen is unchanged.',

  restoreStorageDown: (n: number) => `Storage is unreachable, so version ${n} was not restored.`,

  sliderValue: (n: number, total: number, date: string, added: number, removed: number) =>
    `Version ${n} of ${total}, saved ${date}, +${added} −${removed}`,
  compareHeading: (a: number, b: number) => `Comparing version ${a} with version ${b}`,
  diffCounts: (added: number, removed: number) => `+${added} −${removed}`,

  likes: (n: number) => (n === 1 ? '1 like' : `${n} likes`),
  forks: (n: number) => (n === 1 ? '1 fork' : `${n} forks`),

  forkCredit: (title: string, handle: string) => `Forked from ${title} by ${handle}`,
  forkCreditRemoved: 'Forked from a removed pen',
  forkCreditHidden: 'Forked from a private pen',

  verifySent: (email: string) =>
    `Check ${email} for a link to verify your account. Until then you can write and preview, but not save versions, publish, like or fork.`,
  verifyPending:
    'Your account is ready, but the verification email is not sent yet. Use Resend link in a moment.',
  resendSent: (email: string) => `Sent a new link to ${email}.`,
  resendMailDown: 'Mail is unreachable, so the link was not sent. Try Resend link again in a moment.',
  verifiedLive: 'Email verified. You can now save versions.',

  verifyOk: 'Your email is verified',
  verifyExpired: 'This link has expired. Sign in and use Resend link to get a new one.',
  verifyInvalid: 'This link is not valid. It may have been used already.',

  handleFormat: 'Use 3 to 20 lowercase letters, digits or hyphens.',
  handleTaken: 'That handle is taken.',
  emailFormat: 'Enter an email address like name@example.com.',
  emailTaken: 'That email already has an account.',
  passwordFormat: 'Use at least 10 characters.',
  badCredentials: 'That email or password is not right.',
  thereIsAProblem: 'There is a problem',

  titleInvalid: 'Give the pen a title of 1 to 80 characters.',

  searchAtRest: 'Type to search public pens. Use tag:name to filter by tag.',
  searchResults: (n: number) => (n === 0 ? 'No pens match' : n === 1 ? '1 pen found' : `${n} pens found`),

  dashboardEmpty:
    'You have no pens yet. Start one, and every save becomes a version you can go back to.',
  collectionsEmpty: 'No collections yet. Make one to keep related pens together.',
  collectionEmpty: 'This collection is empty. Add a pen with the box above.',
  collectionMoved: (title: string, position: number, total: number) =>
    `Moved ${title} to position ${position} of ${total}`,
  collectionAdded: (title: string) => `Added ${title}`,
  collectionDuplicate: (title: string) => `${title} is already in this collection.`,

  linkCopied: 'Link copied',
  sharePrivate:
    'This pen is private, so the embed shows a not-found page. Make it unlisted or public to embed it.',

  notFoundHeading: 'Nothing here',
  notFoundLine: 'This pen does not exist, or it is not shared with you.',
} as const;
