// Announcements and visible copy: one place for every published template.

import { ISLANDS } from "./world";

export function islandName(id: number): string {
  return ISLANDS.find(i => i.id === id)?.name ?? "";
}

export function framesText(n: number): string {
  return n === 1 ? "1 frame" : `${n} frames`;
}

export function stampsText(n: number): string {
  return n === 1 ? "1 stamp" : `${n} stamps`;
}

export function likesText(n: number): string {
  return n === 1 ? "1 like" : `${n} likes`;
}

export function pagesText(n: number): string {
  return `${n} of 4 pages`;
}

export const M = {
  arrived: (island: string, pages: number) => `You are on ${island}. ${pages} of 4 album pages filled.`,
  stampEarned: (island: string, stamps: number) => `Stamp earned for ${island}. You have ${stamps} stamps.`,
  lighthouseOpen: "The lighthouse at Lantern Point is open.",
  rainStarts: "Rain begins on the islands.",
  rainStops: "The rain stops.",
  duskFalls: "Dusk falls on the islands.",
  duskOver: "Dusk is over.",
  noPath: "No path to that spot.",
  restarted: "Expedition restarted. You are on Saltmarsh Harbour.",
  unknownSpot: "That spot doesn't exist. You are at Saltmarsh Harbour, spot 1.",
  spot: (name: string) => `You spot a ${name}.`,
  filmRefilled: "Film refilled to 36 frames.",
  scoring: "Scoring…",
  photoScore: (name: string, total: number, s: number, c: number, f: number, p: number) =>
    `${name}: ${total} points. Size ${s}, centring ${c}, facing ${f}, sharpness ${p}.`,
  albumPageFilled: (name: string) => `Album page filled: ${name}.`,
  photoNetwork: "Couldn't reach the islands. Try again.",
  creatureInFrame: (name: string) => `${name} in frame`,
  noCreatureInFrame: "No creature in frame",
  wumpFaces: (deg: number) => `Wump faces ${deg} degrees.`,
  wumpZoom: (percent: number) => `Wump at ${percent} percent.`,
  wumpHops: "Wump hops.",
  wumpRest: "Wump is back at rest.",
  movedFrame: (name: string, frame: number, total: number) => `${name} photo moved to frame ${frame} of ${total}.`,
  hallSaved: "Hall saved.",
  hallSaving: "Saving hall…",
  hallPublic: "Hall is now public.",
  hallPrivate: "Hall is now private.",
  liked: (name: string) => `Liked ${name} photo.`,
  unliked: (name: string) => `Like removed from ${name} photo.`,
  visitorLiked: (visitor: string, name: string) => `${visitor} liked your ${name} photo.`,
  safariStarted: "Safari started.",
  safariEnded: "Safari ended.",
  joinedSafari: (host: string) => `You joined ${host}'s safari.`,
  guestJoined: (guest: string) => `${guest} joined your safari.`,
  guestLeft: (guest: string) => `${guest} left. The guest seat is free.`,
  sighting: (x: number, y: number, by: string) => `Sighting at ${x}, ${y} by ${by}`,
  safariPhotoFeed: (host: string, name: string, total: number) => `${host} photographed ${name}: ${total} points.`,
  pinning: "Pinning…",
  notePinned: "Note pinned.",
  noteApproved: "Note approved.",
  noteDeclined: "Note declined.",
  noteRemoved: "Note removed.",
  newNote: "New note on the board.",
  yourNoteOnBoard: "Your note is on the board.",
  noteDeclinedReason: (reason: string) => `Your note was declined: ${reason}.`,
  entries: (n: number) => (n === 1 ? "1 entry" : `${n} entries`),
  filteredEntries: (n: number, m: number, text: string) => `Showing ${n} of ${m} entries for “${text}”.`,
  boardLoadFailed: "Couldn't load the board. Try again.",
  boardUpdated: (player: string, rank: number) => `Board updated. ${player} is now number ${rank}.`,
  photoEntered: (name: string) => `Your ${name} photo is entered.`,
  posting: "Posting…",
  postcardPosted: "Postcard posted.",
  settingsSaved: "Settings saved.",
  settingsFailed: "Couldn't save settings. Try again.",
  emailConfirmed: "Email confirmed.",
  newCodeSent: "New code sent.",
  codeSendFailed: "Couldn't send the code. Press Send a new code to try again.",
  waitingForRanger: "Waiting for a ranger",
  noWebgl: "3D is not available here. The text world below has everything.",
  noPhotosHung: "No photos hung yet.",
  noEntries: "No entries yet.",
  noNotes: "No notes yet.",
  noNotesWaiting: "No notes waiting.",
  textWorldSignedOut: "Sign in to see your progress.",
  notPhotographedYet: "Not photographed yet."
} as const;
