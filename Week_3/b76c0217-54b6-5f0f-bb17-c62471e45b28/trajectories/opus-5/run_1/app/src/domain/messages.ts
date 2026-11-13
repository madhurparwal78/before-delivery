/** Every string the app shows or announces. This is the only place the copy lives. */

export type RoleLabel = 'Owner' | 'Editor' | 'Viewer';

export const roleLabel = (role: 'owner' | 'editor' | 'viewer'): RoleLabel =>
  role === 'owner' ? 'Owner' : role === 'editor' ? 'Editor' : 'Viewer';

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

export const messages = {
  savingStatus: 'Saving',
  saved: 'Saved',
  saveFailed: "Couldn't save. Check your connection.",
  conflict: (name: string): string =>
    `${name} saved this page while you were editing. Copy your changes, then reload to see theirs.`,
  presence: (name: string): string => `${name} is also editing this page.`,
  noComponentsMatch: 'No components match',
  imageUploaded: 'Image uploaded.',
  imageOutage: 'Image upload failed: file storage is unavailable. Your page is saved.',
  imageType: 'Images must be PNG, JPEG or WebP.',
  imageSize: 'Images must be 5,000,000 bytes or smaller.',
  pageMoved: (pageTitle: string, position: number, total: number, groupTitle: string): string =>
    `Moved ${pageTitle} to position ${position} of ${total} in ${groupTitle}.`,
  groupMoved: (groupTitle: string, position: number, total: number, tabTitle: string): string =>
    `Moved ${groupTitle} to position ${position} of ${total} in ${tabTitle}.`,
  renamed: (newPath: string, links: number, oldPath: string): string =>
    `Renamed to ${newPath}. ${links} ${plural(links, 'link rewritten', 'links rewritten')}. Redirect added from ${oldPath}.`,
  redirectLoop: (cycle: readonly string[]): string =>
    `This would create a redirect loop: ${cycle.join(' \u2192 ')}.`,
  pathTaken: (path: string): string => `Another page already uses ${path}.`,
  badPath: 'Paths use letters, digits, hyphens and underscores, separated by /.',
  offSite: 'Redirects must stay on this site.',
  targetMissing: (path: string): string => `No page at ${path}.`,
  redirectExists: (path: string): string => `A redirect from ${path} already exists.`,
  redirectAdded: (from: string, to: string): string => `Redirect added from ${from} to ${to}.`,
  redirectRemoved: (from: string): string => `Redirect removed from ${from}.`,
  checking: (n: number): string => `Checking ${n} ${plural(n, 'page', 'pages')}.`,
  checkFoundProblems: (n: number): string =>
    `Found ${n} ${plural(n, 'problem', 'problems')}. Publish is blocked.`,
  checkClean: 'No problems found.',
  blockedHeading: (n: number): string =>
    `Publish blocked: ${n} ${plural(n, 'problem', 'problems')}`,
  problemRow: (file: string, line: number, message: string): string => `${file}:${line} ${message}`,
  problemsLeft: (n: number): string => `${n} ${plural(n, 'problem', 'problems')} left.`,
  noProblemsLeft: 'No problems left.',
  confirmHeading: (versionTitle: string): string => `Publish ${versionTitle}?`,
  confirmText: (n: number): string => `${n} ${plural(n, 'page changes', 'pages change')}.`,
  publishing: (versionTitle: string): string => `Publishing ${versionTitle}.`,
  published: (versionTitle: string): string => `Published ${versionTitle}.`,
  publishOutage: "Couldn't publish: file storage is unavailable. The live site hasn't changed.",
  publishInProgress: 'Another publish of this version is running. Try again in a moment.',
  draftBanner: 'Draft preview. Not published.',
  previewLinkCreated: 'Preview link created.',
  previewLinkRevoked: 'Preview link revoked.',
  imported: (n: number): string => `Imported ${n} ${plural(n, 'operation', 'operations')}.`,
  importInvalid: "This file isn't an OpenAPI 3.0 JSON file.",
  importTooLarge: 'This file is larger than 1,000,000 bytes.',
  importOutage: 'Import failed: file storage is unavailable.',
  versionCreated: (versionTitle: string): string => `Created ${versionTitle}.`,
  signInFailed: 'Email or password is wrong.',
  noAccess: "You don't have access to this page.",
  roleChanged: (label: RoleLabel): string => `Your role is now ${label}.`,
  inviteSent: (email: string): string => `Invite sent to ${email}.`,
  inviteHeld: "Invite held: mail is unavailable. We'll send it when mail is back.",
  stillUnavailable: "Mail is still unavailable. We'll keep trying.",
  inviteStatus: {
    sent: 'Sent',
    held: 'Held: mail is unavailable',
    accepted: 'Accepted',
    expired: 'Expired',
  },
  inviteHeading: (teamName: string): string => `Join ${teamName} on Galley`,
  inviteInvalid: "This invitation isn't valid. Ask for a new one.",
  inviteSubject: (inviterName: string, teamName: string): string =>
    `${inviterName} invited you to ${teamName} on Galley`,
} as const;

export const gateMessages = {
  brokenLink: (path: string): string => `Broken link to ${path}: no page at that path.`,
  brokenAnchor: (path: string, anchor: string): string =>
    `Broken link to ${path}#${anchor}: no heading with that anchor.`,
  unknownComponent: (name: string): string => `Unknown component ${name}.`,
  calloutType: 'Callout needs type note, tip, warning or danger.',
  tabsCount: 'Tabs needs 2 or more Tab items.',
  tabOutside: 'Tab must be inside Tabs.',
  tabTitle: 'Tab needs a title.',
  tabTitleDuplicate: (title: string): string =>
    `Tab title "${title}" is used twice in these Tabs.`,
  codeGroupCount: 'CodeGroup needs 2 or more titled code blocks.',
  codeTitleDuplicate: (title: string): string =>
    `Code block title "${title}" is used twice in this CodeGroup.`,
  stepsCount: 'Steps needs 1 or more Step items.',
  stepOutside: 'Step must be inside Steps.',
  stepTitle: 'Step needs a title.',
  accordionTitle: 'Accordion needs a title.',
  cardsCount: 'Cards needs 1 or more Card items.',
  cardOutside: 'Card must be inside Cards.',
  cardAttributes: 'Card needs a title and an href.',
  missingClosingTag: (name: string): string => `${name} is missing its closing tag.`,
  invalidImage: 'Images must be uploaded to this site.',
  duplicateSlug: (path: string, otherTitle: string): string =>
    `Duplicate path ${path}: also used by ${otherTitle}.`,
} as const;

export const readerMessages = {
  documentTitle: (pageTitle: string, siteTitle: string, versionTitle: string): string =>
    `${pageTitle} - ${siteTitle} (${versionTitle})`,
  notFoundDocumentTitle: (siteTitle: string, versionTitle: string): string =>
    `Page not found - ${siteTitle} (${versionTitle})`,
  notFoundHeading: "This page isn't here.",
  notFoundText: 'It may have moved. Search the docs instead.',
  expiredPreview: 'This preview link has expired.',
  searchCount: (n: number, query: string): string =>
    `${n} ${plural(n, 'result', 'results')} for "${query}"`,
  noResults: (query: string): string => `No results for "${query}".`,
  versionFallback: (pageTitle: string, versionTitle: string): string =>
    `${pageTitle} isn't in ${versionTitle}. Showing the first page instead.`,
  updateBanner: 'This page was updated.',
  stepHeading: (n: number, title: string): string => `Step ${n}: ${title}`,
  copied: 'Copied',
  thanks: 'Thanks for your feedback.',
  feedbackRemoved: 'Feedback removed.',
  requiredParameter: (name: string): string => `${name} is required.`,
  invalidBody: 'Request body must be valid JSON.',
  tryItStatusLine: (code: number, reasonPhrase: string): string => `${code} ${reasonPhrase}`,
  noVotes: '-',
} as const;

export const reasonPhrases: Readonly<Record<number, string>> = {
  200: 'OK',
  201: 'Created',
  400: 'Bad Request',
  404: 'Not Found',
  422: 'Unprocessable Content',
};
