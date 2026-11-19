/** Every sentence the product says, in one place, character for character with the brief's Feedback states. */
import { formatCount } from './cost';

export const stageStatus = {
  loading: 'Loading the model.',
  ready: 'Model ready.',
  noModel: 'No model yet. Drop a .glb on the stage or use Choose a model file.',
  previewing: (file: string) => `Previewing ${file}. It is not uploaded.`,
  uploading: (file: string, percent: number) => `Uploading ${file}: ${percent}%.`,
  stored: (file: string, bytes: number) => `${file} is stored. ${formatCount(bytes)} bytes confirmed.`,
  notGlb: (file: string) => `${file} is not a glTF 2.0 binary file.`,
  overBytes: (limit: number) => `This file is over the limit of ${formatCount(limit)} bytes.`,
  overParts: (file: string, count: number, limit: number) => `${file} has ${count} parts. The limit is ${limit} parts.`,
  outsideFiles: (file: string) => `${file} refers to outside files, so it cannot be used.`,
  storageOutReader: 'Storage unreachable. The steps and parts below still work.',
  storageOutAuthor: 'Storage unreachable. Uploading and publishing wait until it returns; your text still saves.',
  still: '3D view is not available here. Showing a still of this step.',
};

export const readingProgress = (n: number, total: number, title: string, cost: string) =>
  `Step ${n} of ${total}: ${title}. Parts so far: ${cost}.`;

export const stepCounter = (n: number, total: number) => `${String(n).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;

export const latestVersion = (n: number | null) => (n === null ? 'No saved versions' : `Latest version ${n}`);

export const editorStatus = {
  saving: 'Saving version.',
  saved: (n: number) => `Saved as version ${n}.`,
  stale: (current: number) => `Version ${current} was saved elsewhere. Nothing was overwritten.`,
  stepAdded: (n: number) => `Step ${n} added.`,
  stepDeleted: (n: number) => `Step ${n} deleted.`,
  stepMoved: (from: number, to: number) => `Step ${from} moved to position ${to}.`,
  stepFirst: (n: number) => `Step ${n} is already first.`,
  stepLast: (n: number) => `Step ${n} is already last.`,
  undid: (label: string) => `Undid: ${label}.`,
  redid: (label: string) => `Redid: ${label}.`,
  nothingToUndo: 'Nothing to undo.',
  nothingToRedo: 'Nothing to redo.',
  undoBlocked: (name: string) => `Cannot undo: ${name} has changed this since.`,
  totalChanged: (cost: string) => `Guide total ${cost}.`,
  restored: (old: number, created: number) => `Restored version ${old} as version ${created}.`,
  keptYours: (field: string) => `Kept your text in ${field}.`,
  tookTheirs: (name: string, field: string) => `Took the text from ${name} in ${field}.`,
  textOverLimit: (field: string, limit: number) => `${field} can be at most ${formatCount(limit)} characters.`,
  tooManySteps: (limit: number) => `A guide can have at most ${limit} steps.`,
  tooManyCallouts: (n: number, limit: number) => `Step ${n} can have at most ${limit} callouts.`,
  tooManyTags: (limit: number) => `A guide can have at most ${limit} tags.`,
  commitFailed: 'Your last change was not saved. Try again.',
  publishing: 'Publishing.',
  published: (n: number) => `Published version ${n}.`,
  withdrawn: 'Withdrawn.',
  needVersion: 'Save a version before publishing.',
  needModel: 'Upload a model before publishing.',
  publishStorageOut: 'Storage unreachable. Publishing waits until it returns.',
  unboundParts: (names: string[]) => `These parts need a node or removal before publishing: ${names.join(', ')}.`,
  needScale: 'Confirm the model scale before publishing.',
};

export const undoLabel = {
  guideTitle: 'Edit guide title',
  stepTitle: (n: number) => `Edit step ${n} title`,
  stepText: (n: number) => `Edit step ${n} text`,
  stepPhase: (n: number) => `Change step ${n} phase`,
  stepExplode: (n: number) => `Change step ${n} apart amount`,
  stepParts: (n: number) => `Change step ${n} parts`,
  stepView: (n: number) => `Change step ${n} view`,
  callout: (n: number) => `Edit callout on step ${n}`,
  addStep: (n: number) => `Add step ${n}`,
  deleteStep: (n: number) => `Delete step ${n}`,
  moveStep: (from: number, to: number) => `Move step ${from} to ${to}`,
  part: (name: string) => `Edit part ${name}`,
};

export const editConflict = (name: string, field: string) => `${name} changed ${field} while you were editing it.`;

export const questionAlert = {
  toAuthor: (title: string, step: number) => `New question on ${title}, step ${step}.`,
  toAsker: (author: string, step: number) => `${author} answered your question on step ${step}.`,
};

export const askStatus = {
  sending: 'Sending your question.',
  empty: 'Write a question first.',
  tooLong: (limit: number) => `Your question can be at most ${formatCount(limit)} characters.`,
  rateLimited: (seconds: number) => `Too many questions. Try again in ${seconds} seconds.`,
};

export const guideStatus = {
  questionSent: 'Question sent.',
  unconfirmed: 'Confirm your email before you can do that. Check your inbox or send the message again.',
  resent: (email: string) => `We sent a new confirmation message to ${email}.`,
  resendLimited: (seconds: number) => `Too many messages. Try again in ${seconds} seconds.`,
  liked: 'Liked.',
  likeRemoved: 'Like removed.',
  forking: 'Forking.',
  failure: 'That did not work. Try again.',
};

export const searchStatus = {
  searching: 'Searching.',
  found: (n: number) => (n === 1 ? '1 guide found.' : `${formatCount(n)} guides found.`),
  none: 'No guides found.',
  queryTooLong: (limit: number) => `Search terms can be at most ${limit} characters.`,
  tooManyTags: (limit: number) => `Search can use at most ${limit} tags.`,
  timeout: 'That search took too long. Try fewer words.',
};

export const collectionStatus = {
  moved: (title: string, n: number) => `${title} moved to position ${n}.`,
  first: (title: string) => `${title} is already first.`,
  last: (title: string) => `${title} is already last.`,
  added: (collection: string) => `Added to ${collection}.`,
  already: 'This guide is already in that collection.',
};

export const accountStatus = {
  waiting: (email: string) => `Check ${email}. We sent a confirmation link.`,
  mailFailed: 'We could not send the message. Try again.',
  resendLimited: guideStatus.resendLimited,
  emailTaken: 'That email already has an account.',
  badSignin: 'That email and password do not match.',
  signinLimited: (seconds: number) => `Too many sign-in attempts. Try again in ${seconds} seconds.`,
  confirmed: 'Your email is confirmed.',
  badToken: 'This confirmation link has expired or was replaced. Send a new one.',
};

export const likeCount = (n: number) => (n === 1 ? '1 like' : `${formatCount(n)} likes`);
export const forkCount = (n: number) => (n === 1 ? '1 fork' : `${formatCount(n)} forks`);

export const pageText = {
  notFound: 'We could not find that page.',
  withdrawn: 'This guide was withdrawn.',
  pastTheEnd: (total: number) => `This guide has ${total} steps. Showing step ${total}.`,
  forkCredit: (title: string, author: string, version: number) => `Forked from ${title} by ${author}, version ${version}.`,
  emptyQuestions: 'No questions waiting.',
  emptyDrafts: 'Nothing on the bench yet.',
  emptyPublished: 'Nothing out in the world yet.',
  emptyForks: 'No forks yet. Find a guide worth adapting.',
  emptyCollections: 'No collections yet.',
};

export const compareText = {
  removed: (words: string) => `Removed: ${words}`,
  added: (words: string) => `Added: ${words}`,
  step: (n: number, title: string) => `Step ${n}: ${title}`,
  wasStep: (n: number, title: string) => `Was step ${n}: ${title}`,
  difference: (signed: string) => `Parts cost difference ${signed}`,
};
