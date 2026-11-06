import type { Breakpoint, PublishState, StyleKey } from './types.js';
import { breakpointLabel } from './types.js';

function bpList(list: readonly Breakpoint[]): string {
  if (list.length === 0) return 'no other breakpoint';
  return list.map(breakpointLabel).join(' and ');
}

export const notices = {
  inserted: (name: string) => `Added ${name}.`,
  moved: (name: string, position: number, total: number, parentName: string) =>
    `Moved ${name} to position ${position} of ${total} in ${parentName}.`,
  refusedMove: (name: string) => `Can't move ${name} there.`,
  deleted: (name: string) => `Deleted ${name}.`,
  cascade: (
    property: StyleKey,
    bp: Breakpoint,
    inherited: readonly Breakpoint[],
    kept: readonly Breakpoint[],
  ) =>
    `${property} changed on ${breakpointLabel(bp)}. Inherited by ${bpList(inherited)}. ` +
    `Kept override on ${bpList(kept)}.`,
  overrideCleared: (property: StyleKey, bp: Breakpoint, value: string) =>
    `${property} on ${breakpointLabel(bp)} now inherits ${value}.`,
  token: (name: string, value: string, uses: number) =>
    `Token ${name} is now ${value}. ${uses} uses updated.`,
  tokenInUse: (name: string, uses: number) => `Can't delete ${name}: it is used ${uses} times.`,
  sharedEdit: (count: number, componentName: string) =>
    `Updated ${count} instances of ${componentName}.`,
  componentInUse: (name: string, count: number) =>
    `Can't delete ${name}: ${count} instances still link to it.`,
  fieldInUse: (name: string, count: number) => `Can't remove ${name}: it is bound ${count} times.`,
  emptyList: 'Nothing here yet.',
  uploadProgress: (fileName: string) => `Uploading ${fileName}.`,
  uploadSuccess: (fileName: string) => `Uploaded ${fileName}.`,
  uploadWrongType: 'Only PNG, JPEG or WebP images can be uploaded.',
  uploadTooBig: 'That image is over 5,000,000 bytes.',
  uploadOutage: (fileName: string) =>
    `Couldn't upload ${fileName}. File storage is unavailable.`,
  storageBanner: 'File storage is unavailable. Your edits are safe; uploads and publishing are paused.',
  publishProgress: (pageName: string) => `Publishing ${pageName}.`,
  publishSuccess: (pageName: string, url: string) => `Published ${pageName} at ${url}.`,
  publishFailed: (pageName: string) =>
    `Couldn't publish ${pageName}. Nothing changed on the live page.`,
  unpublished: (pageName: string) => `Unpublished ${pageName}.`,
  joined: (name: string) => `${name} joined.`,
  conflict: (name: string, property: string, value: string) =>
    `${name} set ${property} to ${value} at the same time. Their value was kept.`,
  deletedBy: (nodeName: string, name: string) =>
    `${nodeName} was deleted by ${name}. Your change was not saved.`,
  roleChanged: (role: 'editor' | 'viewer') => `Your role is now ${role}.`,
  roleRefused: "You're now a viewer. Your last change was not saved.",
  cantUndo: (name: string, nodeName: string) =>
    `Can't undo: ${name} changed ${nodeName} after you.`,
  nothingToUndo: 'Nothing to undo.',
  nothingToRedo: 'Nothing to redo.',
  versionSaved: (versionName: string) => `Saved ${versionName}.`,
  restoreProgress: (versionName: string) => `Restoring ${versionName}.`,
  restored: (name: string, versionName: string) => `${name} restored ${versionName}.`,
  commentMode: (ownerName: string) => `Comment mode. Ask ${ownerName} for edit access.`,
  previewBanner: (versionName: string) =>
    `Previewing ${versionName}. Restore it or go back to the latest.`,
  commentPosted: (nodeName: string) => `Comment posted on ${nodeName}.`,
  mentionMailFailed: (email: string) => `Couldn't email ${email}.`,
  inviteSent: (email: string) => `Invitation sent to ${email}.`,
  inviteFailed: "Couldn't send the invitation. Try again in a moment.",
} as const;

export const fieldErrors = {
  nameEmpty: 'Enter a name.',
  emailInvalid: 'Enter an email address like name@example.org.',
  passwordShort: 'Use 10 or more characters.',
  emailTaken: 'An account with this email already exists.',
  signInFailed: 'Email or password is wrong.',
  altEmpty: 'Alt text is required.',
  alreadyMember: (email: string) => `${email} is already a member.`,
  alreadyInvited: (email: string) => `${email} already has an invitation.`,
} as const;

export const PUBLISH_STATE_TEXT: Record<PublishState, string> = {
  not_published: 'Not published',
  live: 'Live',
  live_changed: 'Live, with unpublished changes',
  unpublished: 'Unpublished',
};

export const PAGE_COPY = {
  publicNotFound: {
    heading: "This page isn't published.",
    text: "Check the address or ask the site's owner.",
  },
  publicStorage: {
    heading: 'This page is temporarily unavailable.',
    text: 'Please try again in a few minutes.',
  },
  editorNotFound: {
    heading: 'Not found.',
    text: 'It may have been removed, or you may not have access.',
  },
  inviteInvalid: {
    heading: "This invitation isn't valid.",
    text: 'Ask whoever invited you to send a new one.',
  },
} as const;
