// Every message the brief prints, character for character. The server uses these for error messages and
// the browser for announcements, so a string is spelled in exactly one place.

import type { Role } from './types';

const many = (n: number, one: string, other: string): string => (n === 1 ? one : other);

export const copy = {
  saving: 'Saving',
  saved: 'Saved',
  saveFailed: "Couldn't save. Check your connection.",
  noComponentsMatch: 'No components match',
  imageUploaded: 'Image uploaded.',
  imageOutage: 'Image upload failed: file storage is unavailable. Your page is saved.',
  imageType: 'Images must be PNG, JPEG or WebP.',
  imageSize: 'Images must be 5,000,000 bytes or smaller.',
  badPath: 'Paths use letters, digits, hyphens and underscores, separated by /.',
  offSite: 'Redirects must stay on this site.',
  checkClean: 'No problems found.',
  noProblemsLeft: 'No problems left.',
  publishOutage: "Couldn't publish: file storage is unavailable. The live site hasn't changed.",
  publishInProgress: 'Another publish of this version is running. Try again in a moment.',
  draftBanner: 'Draft preview. Not published.',
  previewLinkCreated: 'Preview link created.',
  previewLinkRevoked: 'Preview link revoked.',
  importInvalid: "This file isn't an OpenAPI 3.0 JSON file.",
  importTooLarge: 'This file is larger than 1,000,000 bytes.',
  importOutage: 'Import failed: file storage is unavailable.',
  signInFailed: 'Email or password is wrong.',
  noAccess: "You don't have access to this page.",
  inviteHeldMessage: "Invite held: mail is unavailable. We'll send it when mail is back.",
  stillUnavailable: "Mail is still unavailable. We'll keep trying.",
  inviteStatusHeld: 'Held: mail is unavailable',
  inviteInvalid: "This invitation isn't valid. Ask for a new one.",
  notFoundHeading: "This page isn't here.",
  notFoundText: 'It may have moved. Search the docs instead.',
  expiredPreview: 'This preview link has expired.',
  updateBanner: 'This page was updated.',
  copied: 'Copied',
  thanks: 'Thanks for your feedback.',
  feedbackRemoved: 'Feedback removed.',
  invalidBody: 'Request body must be valid JSON.',

  conflict: (name: string): string =>
    `${name} saved this page while you were editing. Copy your changes, then reload to see theirs.`,
  presence: (name: string): string => `${name} is also editing this page.`,
  pageMoved: (title: string, n: number, size: number, group: string): string =>
    `Moved ${title} to position ${n} of ${size} in ${group}.`,
  groupMoved: (title: string, n: number, size: number, tab: string): string =>
    `Moved ${title} to position ${n} of ${size} in ${tab}.`,
  renamed: (newPath: string, n: number, oldPath: string | null): string =>
    `Renamed to ${newPath}. ${n} ${many(n, 'link', 'links')} rewritten.` +
    (oldPath === null ? '' : ` Redirect added from ${oldPath}.`),
  redirectLoop: (cycle: string[]): string => `This would create a redirect loop: ${cycle.join(' → ')}.`,
  pathTaken: (path: string): string => `Another page already uses ${path}.`,
  targetMissing: (path: string): string => `No page at ${path}.`,
  redirectExists: (path: string): string => `A redirect from ${path} already exists.`,
  redirectAdded: (from: string, to: string): string => `Redirect added from ${from} to ${to}.`,
  redirectRemoved: (from: string): string => `Redirect removed from ${from}.`,
  checking: (n: number): string => `Checking ${n} ${many(n, 'page', 'pages')}.`,
  checkFound: (n: number): string => `Found ${n} ${many(n, 'problem', 'problems')}. Publish is blocked.`,
  blockedHeading: (n: number): string => `Publish blocked: ${n} ${many(n, 'problem', 'problems')}`,
  problemRow: (file: string, line: number, message: string): string => `${file}:${line} ${message}`,
  problemsLeft: (n: number): string => `${n} ${many(n, 'problem', 'problems')} left.`,
  confirmHeading: (versionTitle: string): string => `Publish ${versionTitle}?`,
  confirmText: (n: number): string => `${n} ${many(n, 'page changes', 'pages change')}.`,
  publishing: (versionTitle: string): string => `Publishing ${versionTitle}.`,
  published: (versionTitle: string): string => `Published ${versionTitle}.`,
  imported: (n: number): string => `Imported ${n} ${many(n, 'operation', 'operations')}.`,
  versionCreated: (versionTitle: string): string => `Created ${versionTitle}.`,
  roleChanged: (role: Role): string => `Your role is now ${roleLabel(role)}.`,
  inviteSent: (email: string): string => `Invite sent to ${email}.`,
  inviteHeading: (teamName: string): string => `Join ${teamName} on Galley`,
  documentTitle: (page: string, site: string, version: string): string => `${page} - ${site} (${version})`,
  notFoundTitle: (site: string, version: string): string => `Page not found - ${site} (${version})`,
  searchCount: (n: number, query: string): string => `${n} ${many(n, 'result', 'results')} for "${query}"`,
  noResults: (query: string): string => `No results for "${query}".`,
  versionFallback: (pageTitle: string, versionTitle: string): string =>
    `${pageTitle} isn't in ${versionTitle}. Showing the first page instead.`,
  stepHeading: (n: number, title: string): string => `Step ${n}: ${title}`,
  requiredParameter: (name: string): string => `${name} is required.`,
  statusLine: (code: number, phrase: string): string => `${code} ${phrase}`,
  subject: (inviter: string, team: string): string => `${inviter} invited you to ${team} on Galley`,
  duplicateSlug: (path: string, title: string): string => `Duplicate path ${path}: also used by ${title}.`,
};

export function roleLabel(role: Role): string {
  return role === 'owner' ? 'Owner' : role === 'editor' ? 'Editor' : 'Viewer';
}

export const reasonPhrases: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  400: 'Bad Request',
  404: 'Not Found',
  422: 'Unprocessable Content',
};
