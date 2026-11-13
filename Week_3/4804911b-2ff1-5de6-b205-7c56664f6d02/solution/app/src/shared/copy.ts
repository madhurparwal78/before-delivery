// Every sentence the brief owns, character for character (Feedback states). Server and browser share this file.
export const COPY = {
  printOutage: "Printing is down. The prices on this page are still correct.",
  lostPrint: "Print request didn't reach the server. Try again.",
  messageOutage: "Stockist messages are queued. Nothing has been lost.",
  workOutage: "Background work is queued. Nothing has been lost.",
  workSetAside: "A broken job was set aside. No notice was affected.",
  storageOutage: "Stored copies are unavailable right now. The prices on this page are still correct.",
  expiredLink: "This link has expired. Getting a fresh one.",
  searchBehind: "Search is catching up. Recent changes may be missing.",
  searchDown: "Search is down. Exact codes still work.",
  noMatch: "No pack matches that.",
  unknownBatch: "We can't find that batch. Check the code printed near the best-before date.",
  unknownPack: "This pack isn't in the programme.",
  noSticker: "No sticker on this pack. The printed price is the price.",
  pastDate: "This pack is past its best-before date. Please don't drink it.",
  staleDraft: "This draft changed in another tab. Reload to see it.",
  closedWrapper: "No notice allows old wrappers for this pack on that date.",
  badQuoting: "This sheet has a broken quoted field.",
  rotationUnavailable: "Rotation needs the message service. Try again shortly.",
  rotationInProgress: "This secret is already being rotated.",
  lostRemoval: "Removal didn't reach the server. Try again.",
  nothingToRecover: "Nothing on this endpoint is waiting for recovery.",
  previewClear: "Ready to publish.",
  endedSession: "Your session has ended. Sign in again.",
  workKept: "Your unsaved work was kept. Nothing has been sent.",
  confirmWarning: "This can't be undone. There is no way back to draft.",
  noStickerPacks: "No pack takes a sticker.",
  unsavedDraft: "Save this draft first. The notice would publish its saved values.",
  stillPrinting: "This notice is still being printed.",
  badCredentials: "That email and password don't match.",
  endpointRefused: "That address can't receive price messages. Use a public https address.",
  unavailable: "The record is unavailable. Please try again shortly.",
  legal: "Vasant Talkies Drinks is an invented house. Every price here is invented.",
  heroSentence:
    "Nashik's Vasant Talkies bottled its interval soda in the lobby, and the house still prints every price where you can read it.",
  sheetTooLarge: "This sheet is over the 2,000,000 byte limit.",
  sheetIsArchive: "This is a workbook or archive, not a text price sheet. Save it as CSV first.",
  sheetHasNul: "This sheet contains NUL bytes and can't be read as text.",
  sheetNotUtf8: "This sheet isn't UTF-8 text.",
  sheetTooManyRows: "This sheet has more than 5,000 rows.",
  sheetBadHeader: "This sheet needs description and new_mrp columns.",
  sheetEmpty: "This sheet has no rows.",
  sheetKnown: "This sheet is already on file. Nothing new was stored.",
} as const;

export const newDay = (date: string): string => `The house date has changed. Prices here are for ${formatDate(date)}.`;
export const dayRead = (date: string): string => `Prices read for ${formatDate(date)}.`;
export const openRows = (n: number): string => (n === 1 ? "1 row open." : `${n} rows open.`);
export const waitTime = (n: number): string => (n === 1 ? "1 second left." : `${n} seconds left.`);
export const waitMessage = (seconds: number): string => `Too many tries. Wait ${seconds} seconds and try again.`;
export const heldWorkLine = (n: number): string => `Work set aside: ${n}.`;
export const countsLine = (c: { drinks: number; skus: number; notices: number; scheduledRevisions: number }): string =>
  `Drinks: ${c.drinks}. Packs: ${c.skus}. Notices: ${c.notices}. Scheduled revisions: ${c.scheduledRevisions}.`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
/** `YYYY-MM-DD` to `D Mon YYYY`, read from the string alone so no browser or process zone can move it. */
export function formatDate(day: string): string {
  const [y, m, d] = day.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}
/** Integer paise to `Rs 18.75`'s number part, with two decimals and no floating point. */
export function rupees(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
