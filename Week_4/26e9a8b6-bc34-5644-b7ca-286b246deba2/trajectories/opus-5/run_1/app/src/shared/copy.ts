import { groupDigits } from './cost.js';

/** Thousands separators for `<limit>` and `<size>` placeholders in copy. */
function withSeparators(value: number): string {
  const negative = value < 0;
  return (negative ? '-' : '') + groupDigits(String(Math.abs(Math.round(value))));
}

function twoDigit(value: number): string {
  return String(value).padStart(2, '0');
}

export const stageStatus = {
  loading: 'Loading the model.',
  ready: 'Model ready.',
  noModel: 'No model yet. Drop a .glb on the stage or use Choose a model file.',
  previewing: (file: string) => `Previewing ${file}. It is not uploaded.`,
  uploading: (file: string, percent: number) => `Uploading ${file}: ${percent}%.`,
  stored: (file: string, size: number) => `${file} is stored. ${withSeparators(size)} bytes confirmed.`,
  notGlb: (file: string) => `${file} is not a glTF 2.0 binary file.`,
  overBytes: (limit: number) => `This file is over the limit of ${withSeparators(limit)} bytes.`,
  overParts: (file: string, count: number, limit: number) =>
    `${file} has ${count} parts. The limit is ${withSeparators(limit)} parts.`,
  externalUri: (file: string) => `${file} refers to outside files, so it cannot be used.`,
  storageOutReader: 'Storage unreachable. The steps and parts below still work.',
  storageOutAuthor:
    'Storage unreachable. Uploading and publishing wait until it returns; your text still saves.',
  stillFallback: '3D view is not available here. Showing a still of this step.',
} as const;

export const readingProgress = (n: number, total: number, title: string, cost: string): string =>
  `Step ${n} of ${total}: ${title}. Parts so far: ${cost}.`;

export const stepCounter = (n: number, total: number): string =>
  `${twoDigit(n)} / ${twoDigit(total)}`;

export const latestVersion = (n: number | null): string =>
  n === null ? 'No saved versions' : `Latest version ${n}`;

export const editLabel = {
  guideTitle: 'Edit guide title',
  stepTitle: (n: number) => `Edit step ${n} title`,
  stepText: (n: number) => `Edit step ${n} text`,
  stepPhase: (n: number) => `Change step ${n} phase`,
  stepExplode: (n: number) => `Change step ${n} apart amount`,
  stepFocusParts: (n: number) => `Change step ${n} parts`,
  stepCamera: (n: number) => `Change step ${n} view`,
  stepCallout: (n: number) => `Edit callout on step ${n}`,
  addStep: (n: number) => `Add step ${n}`,
  deleteStep: (n: number) => `Delete step ${n}`,
  moveStep: (from: number, to: number) => `Move step ${from} to ${to}`,
  part: (name: string) => `Edit part ${name}`,
} as const;

export const editorStatus = {
  saving: 'Saving version.',
  saved: (n: number) => `Saved as version ${n}.`,
  staleSave: (current: number) => `Version ${current} was saved elsewhere. Nothing was overwritten.`,
  stepAdded: (n: number) => `Step ${n} added.`,
  stepDeleted: (n: number) => `Step ${n} deleted.`,
  stepMoved: (from: number, to: number) => `Step ${from} moved to position ${to}.`,
  stepAlreadyFirst: (n: number) => `Step ${n} is already first.`,
  stepAlreadyLast: (n: number) => `Step ${n} is already last.`,
  undid: (label: string) => `Undid: ${label}.`,
  redid: (label: string) => `Redid: ${label}.`,
  nothingToUndo: 'Nothing to undo.',
  nothingToRedo: 'Nothing to redo.',
  undoBlocked: (name: string) => `Cannot undo: ${name} has changed this since.`,
  totalChanged: (cost: string) => `Guide total ${cost}.`,
  restored: (older: number, created: number) => `Restored version ${older} as version ${created}.`,
  keptMine: (fieldLabel: string) => `Kept your text in ${fieldLabel}.`,
  tookTheirs: (name: string, fieldLabel: string) =>
    `Took the text from ${name} in ${fieldLabel}.`,
  textOverLimit: (fieldLabel: string, limit: number) =>
    `${fieldLabel} can be at most ${withSeparators(limit)} characters.`,
  tooManySteps: (limit: number) => `A guide can have at most ${withSeparators(limit)} steps.`,
  tooManyCallouts: (n: number, limit: number) =>
    `Step ${n} can have at most ${withSeparators(limit)} callouts.`,
  tooManyTags: (limit: number) => `A guide can have at most ${withSeparators(limit)} tags.`,
  commitFailed: 'Your last change was not saved. Try again.',
  publishing: 'Publishing.',
  published: (n: number) => `Published version ${n}.`,
  withdrawn: 'Withdrawn.',
  publishNeedsVersion: 'Save a version before publishing.',
  publishNeedsModel: 'Upload a model before publishing.',
  publishStorageOut: 'Storage unreachable. Publishing waits until it returns.',
  publishUnboundParts: (names: readonly string[]) =>
    `These parts need a node or removal before publishing: ${names.join(', ')}.`,
  publishScaleUnconfirmed: 'Confirm the model scale before publishing.',
} as const;

export const editConflictText = (name: string, fieldLabel: string): string =>
  `${name} changed ${fieldLabel} while you were editing it.`;

export const questionAlerts = {
  toAuthor: (guideTitle: string, n: number) => `New question on ${guideTitle}, step ${n}.`,
  toAsker: (authorName: string, n: number) => `${authorName} answered your question on step ${n}.`,
} as const;

export const askStatus = {
  sending: 'Sending your question.',
  empty: 'Write a question first.',
  overLimit: (limit: number) => `Your question can be at most ${withSeparators(limit)} characters.`,
  rateLimited: (seconds: number) => `Too many questions. Try again in ${seconds} seconds.`,
} as const;

export const guideStatus = {
  questionSent: 'Question sent.',
  unconfirmed:
    'Confirm your email before you can do that. Check your inbox or send the message again.',
  resendSent: (email: string) => `We sent a new confirmation message to ${email}.`,
  resendLimited: (seconds: number) => `Too many messages. Try again in ${seconds} seconds.`,
  liked: 'Liked.',
  likeRemoved: 'Like removed.',
  forking: 'Forking.',
  failure: 'That did not work. Try again.',
} as const;

export const searchStatus = {
  searching: 'Searching.',
  found: (n: number) => (n === 1 ? '1 guide found.' : `${n} guides found.`),
  none: 'No guides found.',
  queryOverLimit: (limit: number) =>
    `Search terms can be at most ${withSeparators(limit)} characters.`,
  tagsOverLimit: (limit: number) => `Search can use at most ${withSeparators(limit)} tags.`,
  timeout: 'That search took too long. Try fewer words.',
} as const;

export const collectionStatus = {
  moved: (title: string, n: number) => `${title} moved to position ${n}.`,
  alreadyFirst: (title: string) => `${title} is already first.`,
  alreadyLast: (title: string) => `${title} is already last.`,
  added: (collectionTitle: string) => `Added to ${collectionTitle}.`,
} as const;

export const accountStatus = {
  waiting: (email: string) => `Check ${email}. We sent a confirmation link.`,
  mailFailed: 'We could not send the message. Try again.',
  resendLimited: guideStatus.resendLimited,
  emailTaken: 'That email already has an account.',
  badSignIn: 'That email and password do not match.',
  signInLimited: (seconds: number) =>
    `Too many sign-in attempts. Try again in ${seconds} seconds.`,
  confirmed: 'Your email is confirmed.',
  badToken: 'This confirmation link has expired or was replaced. Send a new one.',
} as const;

export const likeCount = (n: number): string => (n === 1 ? '1 like' : `${n} likes`);
export const forkCount = (n: number): string => (n === 1 ? '1 fork' : `${n} forks`);

export const peopleEditingItem = (name: string, step: number | null): string =>
  step === null ? `${name}, no step` : `${name}, step ${step}`;

export const pageText = {
  notFound: 'We could not find that page.',
  withdrawn: 'This guide was withdrawn.',
  pastTheEnd: (total: number) => `This guide has ${total} steps. Showing step ${total}.`,
  forkCredit: (title: string, authorName: string, version: number) =>
    `Forked from ${title} by ${authorName}, version ${version}.`,
  emptyQuestions: 'No questions waiting.',
  emptyDrafts: 'Nothing on the bench yet.',
  emptyPublished: 'Nothing out in the world yet.',
  emptyForks: 'No forks yet. Find a guide worth adapting.',
  emptyCollections: 'No collections yet.',
  heroSupporting:
    'Upload the thing you fixed, and readers watch it come apart one step at a time.',
} as const;

export const compareRow = {
  step: (n: number, title: string) => `Step ${n}: ${title}`,
  removedStep: (n: number, title: string) => `Was step ${n}: ${title}`,
  removedWords: (words: string) => `Removed: ${words}`,
  addedWords: (words: string) => `Added: ${words}`,
  part: (name: string, field: string, from: string, to: string) =>
    `${name}: ${field} ${from} to ${to}`,
  difference: (signedCost: string) => `Parts cost difference ${signedCost}`,
  labelAdded: 'Added',
  labelChanged: 'Changed',
  labelMoved: 'Moved',
  labelRemoved: 'Removed',
} as const;
