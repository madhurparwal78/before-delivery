// Published copy (Feedback states), rendered character for character.

export const COPY = {
  headline: "Keep the object, not the picture.",
  heroSentence: "Every photograph keeps its maker, its true size and its finish, so the reference you show a client is the one you can print.",
  standInNote: "Demo photographs are open-access museum images or drawn stand-ins.",
  savingOriginal: "Saving the original to storage.",
  savedToDeck: "Saved to your deck.",
  capture422: "Check the highlighted fields.",
  idempotencyInFlight: "This save is still in progress. Wait for it to finish.",
  capture503: "The photograph could not be stored, so nothing was saved. Try again when storage returns.",
  savingFacts: "Saving facts.",
  factsSaved: "Facts saved.",
  factsConflict: "This reference changed in another window. Reloaded the latest facts.",
  measuringSwatch: "Measuring the swatch.",
  swatchSet: "Swatch set from the photo.",
  swatchReset: "Swatch reset to the measured colour.",
  addedToReel: (reel: string) => `Added to ${reel}.`,
  alreadyInReel: (title: string, reel: string) => `${title} is already in ${reel}.`,
  reelFull: "A reel holds at most 60 stops.",
  movedToStop: (title: string, k: number) => `Moved ${title} to stop ${k}.`,
  reelConflict: "This reel changed in another window. Reloaded the latest order.",
  removedStop: (title: string) => `Removed ${title} from the reel.`,
  reelCreated: "Reel created.",
  sheetQueued: "Contact sheet queued.",
  reelEmpty: "Add at least one reference before printing.",
  sheetReady: "Contact sheet ready.",
  sheetFailed: "The contact sheet could not be rendered.",
  movedToTrash: (title: string) => `Moved ${title} to the trash.`,
  restored: (title: string) => `Restored ${title}.`,
  restoreWindowClosed: "The restore window for this reference has closed. It has been purged from your library.",
  zoneNoticePending: (zone: string, date: string, oldZone: string) =>
    `Your home zone changes to ${zone} at midnight on ${date} in ${oldZone}.`,
  zoneNoticeCurrent: (zone: string) => `Your home zone is ${zone}.`,
  unitNow: (unit: "millimetres" | "inches") => `Sizes now show in ${unit}.`,
  genericFailure: "Something went wrong. Try again.",
  nReferencesMatch: (n: number) => n === 1 ? "1 reference matches." : `${n} references match.`,
  noReferencesMatch: "No references match that search.",
  openingDeck: "Opening your deck.",
  libraryEmpty: "Your deck is empty. Capture your first object to start.",
  trashEmpty: "The trash is empty.",
  photoUnavailable: "Photo unavailable while storage is offline.",
  unknownReference: "This reference isn't in your deck.",
  emptyReel: "This reel has no stops yet. Add references from your library.",
  nothingToPull: "Nothing to pull yet. Capture an object to start your Daily Pull.",
  todaysPullRemoved: "Today's pull has left your library. A new one arrives at 06:00.",
  searchOffline: "Search is offline. Showing simple matches from your library until it returns.",
  storageOffline: "Storage is offline. New captures can't be saved until it returns.",
  printingOffline: "Printing is offline. Contact sheets wait in the queue until it returns.",
} as const;

export const FIELD_ORDER = [
  "photo", "swatch", "title", "maker", "year", "unit", "width", "height", "depth",
  "materials", "finish", "colour_family", "source_url", "source_note", "notes",
] as const;

// The announcer sentence, with the published dropping rule.
export function announcer(k: number, n: number, title: string, maker: string | null, year: number | null): string {
  let tail = "";
  if (maker && year !== null) tail = `, ${maker} ${year}`;
  else if (maker) tail = `, ${maker}`;
  else if (year !== null) tail = `, ${year}`;
  return `Reference ${k} of ${n}: ${title}${tail}`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

// Dates come from the API's YYYY-MM-DD strings, never the browser clock.
export function formatDate(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

// The countdown from the server's seconds_left.
export function countdownText(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s >= 86400) return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}
