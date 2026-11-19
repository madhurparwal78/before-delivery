import type { LayoutMode, Role, ThemeName } from './types.js';

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export const copy = {
  offlineBanner: (n: number) =>
    `You're working offline. ${n} ${plural(n, 'change waiting', 'changes waiting')}.`,
  connectionLost: (n: number) =>
    `Connection lost. Trying again. ${n} ${plural(n, 'change waiting', 'changes waiting')}.`,
  backOnline: (sent: number, conflicts: number) =>
    `Back online: ${sent} ${plural(sent, 'change', 'changes')} sent, ${conflicts} ${plural(conflicts, 'conflict', 'conflicts')}.`,

  cycleRollback: (title: string) => `Move undone: ${title} can't go inside its own branch.`,
  movedAfterYou: (user: string, title: string) => `${user} moved ${title} after you.`,
  deletedUnderYou: (user: string) =>
    `${user} deleted this branch. Your edit is in Recovered edits.`,
  orderChanged: (user: string) => `Order changed: ${user} reordered these topics too.`,
  lockedMove: (title: string) => `Nothing moved: ${title} is locked.`,
  lockedEdit: (title: string, user: string) => `${title} is locked by ${user}.`,
  undoSkipped: (user: string, title: string) => `Can't undo: ${user} changed ${title} after you.`,
  redoSkipped: (user: string, title: string) => `Can't redo: ${user} changed ${title} after you.`,
  undone: 'Undone.',
  redone: 'Redone.',
  nothingToUndo: 'Nothing to undo.',
  nothingToRedo: 'Nothing to redo.',
  rootDelete: "The central topic can't be deleted.",
  readOnly: 'You can view this map but not edit it.',
  cannotMove: (title: string) => `${title} can't move that way.`,
  movePosition: (title: string, k: number, n: number, parentTitle: string) =>
    `${title} is now ${k} of ${n} under ${parentTitle}.`,
  selection: (n: number) => `${n} ${plural(n, 'topic selected', 'topics selected')}.`,
  collapsed: (title: string) => `${title} collapsed`,
  expanded: (title: string) => `${title} expanded`,
  dropPreview: (title: string, target: string) => `Drop to make ${title} a child of ${target}`,
  dependencyLoop: 'That would make a dependency loop.',
  linkScheme: 'Links must start with http:// or https://.',
  replaced: (n: number, k: number) => `Replaced ${n}. Skipped ${k} locked.`,
  findCount: (k: number, n: number) => (n === 0 ? 'No matches' : `${k} of ${n}`),
  noMatches: 'No matches',
  copiedTopics: (n: number) => `Copied ${n} ${plural(n, 'topic', 'topics')}.`,
  pastedTopics: (n: number) => `Pasted ${n} ${plural(n, 'topic', 'topics')}.`,
  nothingToPaste: 'Nothing to paste.',
  missingTopic: 'That topic no longer exists.',
  focusBranchDeleted: 'This branch was deleted. Showing the whole map.',
  following: (name: string) => `Following ${name}.`,
  stoppedFollowing: (name: string) => `Stopped following ${name}.`,
  emptyMapPrompt: 'Press Tab to add the first branch.',

  roleChange: (role: Role) => `Your role is now ${role}.`,
  accessRemoved: 'You no longer have access to this map.',
  expiredLink: 'This link has expired.',
  turnedOffLink: "This link was turned off by the map's owner.",
  unknownMap: "We couldn't find that map.",
  unknownPage: "We couldn't find that page.",
  emptyMapList: 'You have no maps yet. Start one from a central idea.',
  sessionDialogText: 'Your session ended. Sign in again to keep your changes.',

  usernameField: 'Username must be 3 to 24 characters: lowercase letters, digits or underscores.',
  passwordField: 'Password must be at least 8 characters.',
  usernameTaken: 'That username is taken.',
  wrongCredentials: 'Wrong username or password.',
  rateLimited: 'Too many sign-in attempts. Try again in a minute.',

  blockedTopic: (title: string) => `Blocked by ${title}`,
  parentBlockedCount: (n: number) => `${n} blocked`,
  overdue: 'Overdue',
  rollupDash: '\u2014',

  sliderValueText: (k: number, n: number, user: string) => `Version ${k} of ${n} by ${user}`,
  readOnlyVersion: (k: number) => `This is version ${k}. Read only.`,
  diffSummary: (a: number, r: number, m: number, e: number) =>
    `Added ${a}, removed ${r}, moved ${m}, edited ${e}`,
  versionSaved: (k: number) => `Saved version ${k}.`,
  versionRestored: (k: number) => `Restored version ${k}.`,
  followerCount: (n: number) => `${n} following`,
  slideCounter: (k: number, n: number) => `Slide ${k} of ${n}`,
  slideSkippedDeleted: (k: number) => `Slide ${k} was skipped: its topic was deleted.`,
  slideSkippedRestricted: (k: number) => `Slide ${k} was skipped: it is restricted.`,
  audienceWaiting: (user: string) =>
    `The presentation hasn't started yet. It will appear here when ${user} goes live.`,
  audiencePaused: 'The presenter has stepped away. The show will continue here.',
  audienceEnded: 'This presentation has ended.',

  uploadingFile: (name: string) => `Uploading ${name}`,
  imageAttached: 'Image attached.',
  imageTooLarge: (limit: number) => `This image is larger than ${limit} bytes.`,
  imageWrongType: 'Only PNG and JPEG images can be attached.',
  imageQuota: (quota: number) => `This map's images would pass its ${quota} byte limit.`,
  storageOutage: 'File storage is unavailable. Nothing was added. Try again in a moment.',
  readingFile: (name: string) => `Reading ${name}`,
  importPreview: (n: number, title: string) =>
    `Adds ${n} ${plural(n, 'topic', 'topics')} under ${title}.`,
  importErrorHeading: "This file can't be imported:",
  exportReady: 'Export ready.',
  exportOutage: 'Export failed: file storage is unavailable.',
  versionOutage: 'File storage is unavailable. The version was not saved. Try again in a moment.',
  restoreOutage: 'File storage is unavailable. Nothing was restored. Try again in a moment.',
};

/** Remote and activity sentences. These carry no final period. */
export const sentence = {
  add: (user: string, title: string) => `${user} added ${title}`,
  rename: (user: string, oldTitle: string, newTitle: string) =>
    `${user} renamed ${oldTitle} to ${newTitle}`,
  move: (user: string, title: string, parentTitle: string) =>
    `${user} moved ${title} under ${parentTitle}`,
  moveMany: (user: string, n: number, parentTitle: string) =>
    `${user} moved ${n} topics under ${parentTitle}`,
  reorder: (user: string, title: string) => `${user} reordered ${title}`,
  deleteOne: (user: string, title: string) => `${user} deleted ${title}`,
  deleteWithSubtopics: (user: string, title: string, k: number) =>
    `${user} deleted ${title} and ${k} ${plural(k, 'subtopic', 'subtopics')}`,
  deleteMany: (user: string, n: number) => `${user} deleted ${n} topics`,
  note: (user: string, title: string) => `${user} edited the note on ${title}`,
  task: (user: string, title: string) => `${user} changed the task on ${title}`,
  style: (user: string, title: string) => `${user} styled ${title}`,
  link: (user: string, title: string, otherTitle: string) =>
    `${user} linked ${title} to ${otherTitle}`,
  boundary: (user: string, title: string) => `${user} added a boundary around ${title}`,
  lock: (user: string, title: string) => `${user} locked ${title}`,
  unlock: (user: string, title: string) => `${user} unlocked ${title}`,
  restrict: (user: string, title: string) => `${user} restricted ${title}`,
  unrestrict: (user: string, title: string) => `${user} lifted the restriction on ${title}`,
  layout: (user: string, layout: LayoutMode) => `${user} switched to ${LAYOUT_LABEL[layout]}`,
  theme: (user: string, theme: ThemeName) => `${user} chose the ${THEME_LABEL[theme]} theme`,
  restore: (user: string, k: number) => `${user} restored version ${k}`,
  undo: (user: string, title: string) => `${user} undid a change to ${title}`,
  redo: (user: string, title: string) => `${user} redid a change to ${title}`,
  graft: (user: string, n: number, title: string) => `${user} imported ${n} topics under ${title}`,
  paste: (user: string, n: number, title: string) => `${user} pasted ${n} topics under ${title}`,
  replace: (user: string, n: number) => `${user} replaced text in ${n} topics`,
  reapply: (user: string, title: string) => `${user} re-applied an edit under ${title}`,
  comment: (user: string, title: string) => `${user} commented on ${title}`,
  vote: (user: string, title: string) => `${user} voted for ${title}`,
};

export const LAYOUT_LABEL: Record<LayoutMode, string> = {
  map: 'Mind map',
  org: 'Org chart',
  list: 'List',
};

export const THEME_LABEL: Record<ThemeName, string> = {
  daylight: 'Daylight',
  paper: 'Paper',
  dusk: 'Dusk',
};
