/** Every published visible string that carries live values. */
export const copy = {
  worldArrival: (islandName: string, pagesFilled: number) =>
    `You are on ${islandName}. ${pagesFilled} of 4 album pages filled.`,
  stampEarned: (islandName: string, stamps: number) => `Stamp earned for ${islandName}. You have ${stamps} stamps.`,
  lighthouseOpen: 'The lighthouse at Lantern Point is open.',
  rainBegins: 'Rain begins on the islands.',
  rainStops: 'The rain stops.',
  duskFalls: 'Dusk falls on the islands.',
  duskOver: 'Dusk is over.',
  noPath: 'No path to that spot.',
  restarted: 'Expedition restarted. You are on Saltmarsh Harbour.',
  unknownSpot: "That spot doesn't exist. You are at Saltmarsh Harbour, spot 1.",
  spotted: (creatureName: string) => `You spot a ${creatureName}.`,
  filmRefilled: 'Film refilled to 36 frames.',

  photoScoring: 'Scoring…',
  photoSuccess: (creatureName: string, total: number, s: number, c: number, f: number, p: number) =>
    `${creatureName}: ${total} points. Size ${s}, centring ${c}, facing ${f}, sharpness ${p}.`,
  albumPageFilled: (creatureName: string) => `Album page filled: ${creatureName}.`,
  photoNetwork: "Couldn't reach the islands. Try again.",

  creatureInFrame: (creatureName: string) => `${creatureName} in frame`,
  noCreatureInFrame: 'No creature in frame',

  guideFaces: (degrees: number) => `Wump faces ${degrees} degrees.`,
  guideZoom: (percent: number) => `Wump at ${percent} percent.`,
  guideHops: 'Wump hops.',
  guideRest: 'Wump is back at rest.',

  photoMoved: (creatureName: string, frame: number, total: number) =>
    `${creatureName} photo moved to frame ${frame} of ${total}.`,
  hallSaved: 'Hall saved.',
  hallSaving: 'Saving hall…',
  hallPublic: 'Hall is now public.',
  hallPrivate: 'Hall is now private.',
  liked: (creatureName: string) => `Liked ${creatureName} photo.`,
  unliked: (creatureName: string) => `Like removed from ${creatureName} photo.`,
  likedYours: (visitorName: string, creatureName: string) => `${visitorName} liked your ${creatureName} photo.`,

  safariStarted: 'Safari started.',
  safariEnded: 'Safari ended.',
  safariJoined: (hostName: string) => `You joined ${hostName}'s safari.`,
  safariGuestJoined: (guestName: string) => `${guestName} joined your safari.`,
  safariGuestLeft: (guestName: string) => `${guestName} left. The guest seat is free.`,
  sighting: (x: number, y: number, hostName: string) => `Sighting at ${x}, ${y} by ${hostName}`,
  safariFeed: (hostName: string, creatureName: string, total: number) =>
    `${hostName} photographed ${creatureName}: ${total} points.`,

  notePinning: 'Pinning…',
  notePinned: 'Note pinned.',
  noteApproved: 'Note approved.',
  noteDeclined: 'Note declined.',
  noteRemoved: 'Note removed.',
  newNote: 'New note on the board.',
  yourNoteOnBoard: 'Your note is on the board.',
  yourNoteDeclined: (reason: string) => `Your note was declined: ${reason}.`,

  boardEntries: (n: number) => (n === 1 ? '1 entry' : `${n} entries`),
  boardFiltered: (shown: number, total: number, text: string) => `Showing ${shown} of ${total} entries for “${text}”.`,
  boardFailed: "Couldn't load the board. Try again.",
  boardUpdated: (playerName: string, rank: number) => `Board updated. ${playerName} is now number ${rank}.`,
  boardEntered: (creatureName: string) => `Your ${creatureName} photo is entered.`,

  postcardPosting: 'Posting…',
  postcardPosted: 'Postcard posted.',

  settingsSaved: 'Settings saved.',
  settingsFailed: "Couldn't save settings. Try again.",

  emailConfirmed: 'Email confirmed.',
  newCodeSent: 'New code sent.',
  codeFailed: "Couldn't send the code. Press Send a new code to try again.",

  noWebgl: '3D is not available here. The text world below has everything.',
  emptyHall: 'No photos hung yet.',
  emptyBoard: 'No entries yet.',
  emptyNotes: 'No notes yet.',
  emptyRanger: 'No notes waiting.',
  signedOutProgress: 'Sign in to see your progress.',
  notPhotographedYet: 'Not photographed yet.',
  waitingForRanger: 'Waiting for a ranger',
  restartSentence: 'Start the whole expedition again?',
  noGalleryHere: 'No gallery here',
  noPostcardHere: 'No postcard here',

  textLocation: (islandName: string, x: number, y: number) => `You are on ${islandName} at tile ${x}, ${y}.`,
} as const;

export function filmText(n: number): string {
  return n === 1 ? '1 frame' : `${n} frames`;
}

export function stampsText(n: number): string {
  return n === 1 ? '1 stamp' : `${n} stamps`;
}

export function likesText(n: number): string {
  return n === 1 ? '1 like' : `${n} likes`;
}

export function albumPagesText(n: number): string {
  return `${n} of 4 pages`;
}
