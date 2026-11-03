import { BREAKPOINT_LABEL, type Breakpoint } from "./types.js";

/** Lists of breakpoints are joined with " and " (Feedback states). */
function list(bps: readonly Breakpoint[]): string {
  return bps.length ? bps.map((bp) => BREAKPOINT_LABEL[bp]).join(" and ") : "no other breakpoint";
}

export const notice = {
  inserted: (name: string) => `Added ${name}.`,
  moved: (name: string, n: number, total: number, parent: string) => `Moved ${name} to position ${n} of ${total} in ${parent}.`,
  refusedMove: (name: string) => `Can't move ${name} there.`,
  deleted: (name: string) => `Deleted ${name}.`,
  cascade: (property: string, bp: Breakpoint, inherited: readonly Breakpoint[], kept: readonly Breakpoint[]) =>
    `${property} changed on ${BREAKPOINT_LABEL[bp]}. Inherited by ${list(inherited)}. Kept override on ${list(kept)}.`,
  overrideCleared: (property: string, bp: Breakpoint, value: string) => `${property} on ${BREAKPOINT_LABEL[bp]} now inherits ${value}.`,
  token: (name: string, value: string, uses: number) => `Token ${name} is now ${value}. ${uses} uses updated.`,
  tokenInUse: (name: string, uses: number) => `Can't delete ${name}: it is used ${uses} times.`,
  sharedEdit: (instances: number, component: string) => `Updated ${instances} instances of ${component}.`,
  componentInUse: (component: string, instances: number) => `Can't delete ${component}: ${instances} instances still link to it.`,
  fieldInUse: (field: string, bound: number) => `Can't remove ${field}: it is bound ${bound} times.`,
  emptyList: "Nothing here yet.",
  uploading: (file: string) => `Uploading ${file}.`,
  uploaded: (file: string) => `Uploaded ${file}.`,
  wrongType: "Only PNG, JPEG or WebP images can be uploaded.",
  tooBig: "That image is over 5,000,000 bytes.",
  uploadOutage: (file: string) => `Couldn't upload ${file}. File storage is unavailable.`,
  storageBanner: "File storage is unavailable. Your edits are safe; uploads and publishing are paused.",
  publishing: (page: string) => `Publishing ${page}.`,
  published: (page: string, url: string) => `Published ${page} at ${url}.`,
  publishFailed: (page: string) => `Couldn't publish ${page}. Nothing changed on the live page.`,
  unpublished: (page: string) => `Unpublished ${page}.`,
  joined: (name: string) => `${name} joined.`,
  conflict: (name: string, property: string, value: string) => `${name} set ${property} to ${value} at the same time. Their value was kept.`,
  deletedBy: (node: string, name: string) => `${node} was deleted by ${name}. Your change was not saved.`,
  roleChanged: (role: "viewer" | "editor") => `Your role is now ${role}.`,
  roleRefused: "You're now a viewer. Your last change was not saved.",
  cantUndo: (name: string, node: string) => `Can't undo: ${name} changed ${node} after you.`,
  nothingToUndo: "Nothing to undo.",
  nothingToRedo: "Nothing to redo.",
  versionSaved: (version: string) => `Saved ${version}.`,
  restoring: (version: string) => `Restoring ${version}.`,
  restored: (name: string, version: string) => `${name} restored ${version}.`,
  commentMode: (owner: string) => `Comment mode. Ask ${owner} for edit access.`,
  preview: (version: string) => `Previewing ${version}. Restore it or go back to the latest.`,
  commentPosted: (node: string) => `Comment posted on ${node}.`,
  mentionFailed: (email: string) => `Couldn't email ${email}.`,
  inviteSent: (email: string) => `Invitation sent to ${email}.`,
  inviteFailed: "Couldn't send the invitation. Try again in a moment.",
  alreadyMember: (email: string) => `${email} is already a member.`,
  alreadyInvited: (email: string) => `${email} already has an invitation.`,
};

export const publishStateText = {
  not_published: "Not published",
  live: "Live",
  live_changed: "Live, with unpublished changes",
  unpublished: "Unpublished",
} as const;

export const pageCopy = {
  publicNotFound: { heading: "This page isn't published.", text: "Check the address or ask the site's owner." },
  publicUnavailable: { heading: "This page is temporarily unavailable.", text: "Please try again in a few minutes." },
  editorNotFound: { heading: "Not found.", text: "It may have been removed, or you may not have access." },
  inviteInvalid: { heading: "This invitation isn't valid.", text: "Ask whoever invited you to send a new one." },
} as const;

export const fieldError = {
  nameEmpty: "Enter a name.",
  emailInvalid: "Enter an email address like name@example.org.",
  passwordShort: "Use 10 or more characters.",
  emailTaken: "An account with this email already exists.",
  signInFailed: "Email or password is wrong.",
  altEmpty: "Alt text is required.",
} as const;

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
