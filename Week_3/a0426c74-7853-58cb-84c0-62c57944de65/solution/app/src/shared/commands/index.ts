// The typed command line: one `CommandSession` per drawing page, fed text, clicks and Escape, answering with the prompt, a transient
// message, the one operation group a finished command submits, and requests to focus a panel or zoom to the whole drawing.
// `ownAnnouncement` and `remoteAnnouncement` build the Drawing announcements for a group.
export { CommandSession, type CommandInput, type CommandUpdate } from './session.ts';
export type { CommandEnv } from './env.ts';
export { ownAnnouncement, remoteAnnouncement } from './announce.ts';
export { eraseGroup } from './definitions/modify.ts';
