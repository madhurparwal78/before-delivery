import type { GroupMode, Role, SortMode } from './types';

export const LIMITS = {
  postTitle: 80,
  postBody: 2000,
  comment: 500,
  displayName: 40,
  boardTitle: 80,
  sectionTitle: 40,
  sectionCount: 12,
  accountPasswordMin: 8,
  accountPasswordMax: 72,
  boardPasswordMin: 8,
  boardPasswordMax: 64,
} as const;

export const SORT_LABELS: Record<SortMode, string> = {
  by_hand: 'By hand',
  newest: 'Newest first',
  oldest: 'Oldest first',
  most_liked: 'Most liked',
};

export const GROUP_LABELS: Record<GroupMode, string> = {
  section: 'By section',
  author: 'By author',
};

export const ROLE_LABELS: Record<Exclude<Role, 'owner'>, string> = {
  viewer: 'Viewer',
  contributor: 'Contributor',
  moderator: 'Moderator',
};

export const withThousands = (value: number): string => value.toLocaleString('en-US');

export const MOVE_COPY = {
  pickUp: (title: string, section: string, p: number, n: number) => `Picked up ${title}. ${section}, position ${p} of ${n}.`,
  step: (title: string, section: string, p: number, n: number) => `${title}: ${section}, position ${p} of ${n}.`,
  drop: (title: string, section: string, p: number, n: number) => `Dropped ${title}: ${section}, position ${p} of ${n}.`,
  cancel: (title: string, section: string, p: number, n: number) =>
    `Move cancelled. ${title} is back in ${section}, position ${p} of ${n}.`,
  sortBlocked: (sortLabel: string) => `Order is set by ${sortLabel}. Choose By hand to reorder.`,
  groupBlocked: () => 'Moving is off while posts are grouped by author.',
  lost: (name: string, title: string, section: string, p: number, n: number) =>
    `${name} moved ${title} first. It is now in ${section}, position ${p} of ${n}.`,
  loupeMove: (title: string, section: string, p: number, n: number) => `${title} moved to ${section}, position ${p} of ${n}.`,
};

export const ANNOUNCE_COPY = {
  deletedElsewhere: (title: string) => `${title} was deleted.`,
  youDeleted: (title: string) => `Deleted ${title}.`,
  newPost: (name: string, title: string) => `${name} added ${title}.`,
  approved: (title: string) => `Your post ${title} was approved.`,
  rejected: (title: string) => `Your post ${title} was not approved.`,
  roleChanged: (boardTitle: string, roleLabel: string) => `Your role on ${boardTitle} is now ${roleLabel}.`,
  uploading: (fileName: string) => `Uploading ${fileName}…`,
  posted: (title: string) => `Posted ${title}.`,
  held: (title: string) => `Sent ${title} for approval.`,
};

export const BOARD_COPY = {
  empty: 'Nothing on this board yet.',
  heldNote: "Only you and the people who moderate this board can see these posts until they're approved.",
  awaitingApproval: 'Awaiting approval',
  approvalsEmpty: 'Nothing is waiting for approval.',
  pushPending: 'Push pending',
  sectionsHint: 'Comma-separated, for example Ideas, Booked, Done',
  boardCount: (n: number) => (n === 1 ? '1 board' : `${n} boards`),
  deleteConfirm: (boardTitle: string) => `Every post, comment and file on ${boardTitle} will be removed.`,
  slidePosition: (k: number, n: number) => `Post ${k} of ${n}`,
  slideEmpty: 'No posts to show yet.',
};

export const BANNER_COPY = {
  storage: 'File uploads are unavailable right now. Posts without files still work.',
  push: "Moderator alerts can't be sent right now. Held posts still wait in Approvals.",
};

export const POST_FORM_COPY = {
  titleRequired: 'Give your post a title.',
  titleTooLong: `Titles can be at most ${LIMITS.postTitle} characters.`,
  bodyTooLong: `Text can be at most ${withThousands(LIMITS.postBody)} characters.`,
  fileTooLarge: (fileName: string, limit: number) => `${fileName} is over the ${withThousands(limit)} byte limit.`,
  unsupportedType: (fileName: string) => `${fileName} isn't a PNG, JPEG, GIF, WebP, PDF or plain-text file.`,
  storageDown: 'Uploads are unavailable right now. Your post was not saved.',
  staleEdit: 'Someone changed this post first. Your edit was not saved.',
  pending: 'Posting…',
};

export const COMMENT_COPY = {
  required: 'Write a comment first.',
  tooLong: `Comments can be at most ${LIMITS.comment} characters.`,
  pending: 'Sending…',
};

export const MAKE_BOARD_COPY = {
  titleRequired: 'Give your board a title.',
  titleTooLong: `Board titles can be at most ${LIMITS.boardTitle} characters.`,
  sectionCount: `Add between 1 and ${LIMITS.sectionCount} sections.`,
  sectionTooLong: `Section titles can be at most ${LIMITS.sectionTitle} characters.`,
};

export const SETTINGS_COPY = {
  boardPassword: `Passwords are ${LIMITS.boardPasswordMin} to ${LIMITS.boardPasswordMax} characters.`,
};

export const MEMBERS_COPY = {
  inviteSent: (email: string) => `Invite sent to ${email}.`,
  emailRequired: 'Enter an email address.',
  alreadyMember: (email: string) => `${email} is already on this board.`,
  mailDown: "Invites can't be sent right now. Try again in a few minutes.",
  ownerRole: "The owner's role can't change.",
};

export const AUTH_COPY = {
  displayName: `Display names are 1 to ${LIMITS.displayName} characters.`,
  emailRequired: 'Enter an email address.',
  password: `Passwords are ${LIMITS.accountPasswordMin} to ${LIMITS.accountPasswordMax} characters.`,
  emailTaken: 'That email already has an account.',
  codeSent: (email: string) => `We sent a 6-digit code to ${email}.`,
  badCode: 'That code is wrong or has expired.',
  unconfirmed: 'Confirm your email first.',
  badCredentials: "That email and password don't match.",
  mailDown: "We can't send your code right now. Try again in a few minutes.",
};

export const ACCESS_COPY = {
  passwordHeading: 'This board is password protected',
  badPassword: "That password didn't open this board.",
  notFoundHeading: 'Board not found',
  notFoundText: "This board doesn't exist, or you don't have access to it.",
  inviteExpired: 'This invite has expired.',
};

export const POSITION_COPY = {
  outOfRange: (max: number) => `Position must be between 1 and ${max}.`,
};

export const LANDING_COPY = {
  sentence: 'Boards your group fills together, live.',
};
