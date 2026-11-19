/**
 * The published feedback copy. Every message the desk and the public site show
 * comes from here, character for character.
 */

function thousands(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+$)/g, ',');
}

export const F = {
  /** F-01 */ working: 'Working\u2026',
  /** F-02 */ refreshFailed: "Couldn't refresh. Trying again.",
  /** F-03 */ sessionEnded:
    'Your session ended. Sign in again to keep going \u2014 what you typed is still here.',
  /** F-04 */ required: 'This field is required.',
  /** F-05 */ tooLong: (limit: number): string => `This is longer than ${thousands(limit)} characters.`,
  /** F-06 */ notEmail: 'That is not an email address.',
  /** F-07 */ notDate: 'That is not a date.',
  /** F-08 */ outOfRange: 'That number is out of range.',
  /** F-09 */ badPair: 'That email and password do not match.',
  /** F-10 */ shortPassword: 'Use at least 10 characters.',
  /** F-11 */ enquirySent: 'Thank you. Your enquiry is on its way.',
  /** F-12 */ enquiryBusy: (minute: string): string =>
    `Too many enquiries. You can try again at ${minute} Turin time.`,
  /** F-13 */ badStamp: 'That stamp number does not check out. Read it again from the frame.',
  /** F-14 */ stampTaken: 'Another piece on this desk has that stamp number.',
  /** F-15 */ pieceSaved: (title: string): string => `${title} saved.`,
  /** F-16 */ pieceArchived: (title: string): string => `${title} archived.`,
  /** F-17 */ searchDown: 'Search is unavailable right now. The full list is still here.',
  /** F-18 */ nothingFound: (text: string): string => `Nothing found for ${text}.`,
  /** F-19 */ clientClosing: (name: string, date: string): string =>
    `${name} is closing. You can bring it back until ${date}.`,
  /** F-20 */ clientBack: (name: string): string => `${name} is back.`,
  /** F-21 */ erasing: 'Erasing',
  /** F-21 */ erased: 'Erased',
  /** F-21 */ erasedClient: 'Erased client',
  /** F-22 */ pinPlaced: (x: string, y: string): string => `Pin placed at ${x}, ${y}.`,
  /** F-23 */ pinRemoved: 'Pin removed.',
  /** F-24 */ notImage: 'This file is not a PNG or JPEG.',
  /** F-25 */ fileTooBig: 'This file is over 8,000,000 bytes.',
  /** F-26 */ photographRepeat: (n: number): string => `Already on this piece as photograph ${n}.`,
  /** F-27 */ storeDown: 'The file store is unavailable right now. Nothing was saved.',
  /** F-28 */ fileStored: (fileName: string): string => `${fileName} stored.`,
  /** F-29 */ supplierUnread: 'The supplier could not be read. Your library has not changed.',
  /** F-30 */ searchUnconfirmed: 'Search could not take the new entries. Your library has not changed.',
  /** F-31 */ libraryRefreshed: (n: number): string => `Library refreshed: ${n} materials.`,
  /** F-32 */ trayFull: 'The tray holds four. Take one out first.',
  /** F-33 */ heldUntil: (date: string): string => `Held until ${date}`,
  /** F-34 */ holdEnded: (date: string): string => `Hold ended on ${date}.`,
  /** F-35 */ supplierBusy: (minute: string): string =>
    `The supplier is busy. You can try again at ${minute} Turin time.`,
  /** F-36 */ supplierDown: 'The supplier is unavailable right now. Nothing changed.',
  /** F-37 */ noLotHides: (n: number, name: string, m: number): string =>
    `No single dye lot holds ${n} hides of ${name}. The largest holds ${m}.`,
  /** F-38 */ noLotMetres: (n: string, name: string, m: string): string =>
    `No single dye lot holds ${n} m of ${name}. The largest holds ${m} m.`,
  /** F-39 */ lotHolds: (lot: string, m: string): string => `Lot ${lot} holds ${m}.`,
  /** F-40 */ otherLotHeld: (lot: string): string =>
    `This piece is held on lot ${lot}. All its hides come from one dye lot.`,
  /** F-41 */ lotAlreadyHeld: (quantity: string): string =>
    `This lot is already held for this piece for ${quantity}.`,
  /** F-42 */ lifted: (part: string): string =>
    `${part} lifted. Arrow keys move it, Enter places it, Escape puts it back.`,
  /** F-43 */ toTray: (part: string): string => `${part} back in the tray.`,
  /** F-44 */ putBack: (part: string): string => `${part} put back.`,
  /** F-45 */ placed: (part: string, x: number, y: number): string =>
    `${part} placed at ${x}, ${y} cm.`,
  /** F-46 */ clientAnswered: (name: string, title: string, time: string): string =>
    `${name} answered about ${title} at ${time} Turin time.`,
  /** F-47 */ offHide: (part: string): string => `${part} cannot go there. It runs off the hide.`,
  /** F-48 */ crossesFlaw: (part: string, x: number, y: number): string =>
    `${part} cannot go there. It crosses the flaw at ${x}, ${y} cm.`,
  /** F-49 */ overlaps: (part: string, other: string): string =>
    `${part} cannot go there. It overlaps ${other}.`,
  /** F-50 */ grainBound: (part: string): string =>
    `${part} runs with the grain and turns only 0 or 180.`,
  /** F-51 */ layoutStale: (time: string): string =>
    `This layout was changed at ${time} Turin time in another window. Your piece is still lifted.`,
  /** F-52 */ hideFigure: (used: string, percent: string): string =>
    `Used ${used} sq ft of 51.67 sq ft (${percent}%)`,
  /** F-53 */ totalNow: (total: string): string => `Total now ${total}.`,
  /** F-54 */ estimateSaved: 'Estimate saved.',
  /** F-55 */ estimateStale: (time: string): string =>
    `This estimate was changed at ${time} Turin time in another window. Your figures are still here.`,
  /** F-56 */ quarterHours: 'Labour goes in quarter hours.',
  /** F-57 */ rateSaved: (date: string): string =>
    `Rate saved. It applies to new estimates from ${date}.`,
  /** F-58 */ rateTaken: 'A rate already takes effect on that day.',
  /** F-59 */ rateTooEarly: 'Rates take effect today or later.',
  /** F-60 */ clientPageSent: (email: string): string => `Client page sent to ${email}.`,
  /** F-61 */ clientPageEnded: 'Client page ended.',
  /** F-62 */ needDueDate: 'Give this piece a due date first.',
  /** F-63 */ needClientEmail: 'This client has no email address yet.',
  /** F-64 */ jobMoved: (job: string, bench: string, date: string): string =>
    `${job} moved to ${bench} on ${date}.`,
  /** F-65 */ weekEnd: 'No more days this week. Use Move to\u2026.',
  /** F-66 */ benchTaken: (date: string, job: string): string =>
    `That bench is taken on ${date} by ${job}.`,
  /** F-67 */ glueCuring: (title: string, datetime: string): string =>
    `The glue on ${title} cures until ${datetime}.`,
  /** F-68 */ noSuchTime: (time: string, town: string, date: string): string =>
    `${time} does not exist in ${town} on ${date}.`,
  /** F-69 */ glueLaid: (job: string, datetime: string): string =>
    `Glue laid on ${job}. It cures at ${datetime}.`,
  /** F-70 */ benchWeekdays: 'The bench works Monday to Friday.',
  /** F-71 */ glueOnFrame: 'Glue goes on a frame bench job.',
  /** F-72 */ courierUnconfirmed: 'The courier could not confirm. Nothing was booked.',
  /** F-73 */ courierBusy: (minute: string): string =>
    `The courier is busy. You can try again at ${minute} Turin time.`,
  /** F-74 */ slotTaken: (time: string): string =>
    `That time was just taken at ${time} Turin time. Pick another.`,
  /** F-75 */ booked: 'Booked',
  /** F-76 */ quote: (amount: string): string => `Quote: ${amount}.`,
  /** F-77 */ quoteFailed: 'The courier could not give a quote. Nothing changed.',
  /** F-78 */ needMeasurements: 'This piece needs its width, depth, height and weight first.',
  /** F-79 */ alreadyBooked: (collectionTime: string): string =>
    `This piece is already booked for ${collectionTime}.`,
  /** F-80 */ unknownColumn: (name: string): string =>
    `This file has a column the desk does not know: ${name}.`,
  /** F-81 */ missingColumn: (name: string): string => `This file is missing a column: ${name}.`,
  /** F-82 */ workbookTooBig: 'This file is over 2,000,000 bytes.',
  /** F-83 */ notUtf8: 'This file is not UTF-8 text.',
  /** F-84 */ rowBadStamp: (n: number): string => `Row ${n}: that stamp number does not check out.`,
  /** F-85 */ rowNoTitle: (n: number): string => `Row ${n}: the piece has no title.`,
  /** F-86 */ rowNoMaterial: (n: number, code: string): string =>
    `Row ${n}: the desk has no material ${code}.`,
  /** F-87 */ rowFieldCount: (n: number): string => `Row ${n}: that row does not have seven fields.`,
  /** F-88 */ workbookSaved: (a: number, b: number, c: number): string =>
    `Saved: ${a} new, ${b} matched, ${c} refused.`,
  /** F-89 */ waiting: 'Waiting',
  /** F-89 */ rendering: 'Rendering',
  /** F-89 */ stored: 'Stored',
  /** F-89 */ sending: 'Sending',
  /** F-89 */ refused: 'Refused',
  /** F-90 */ renderDown: 'The PDF service is unavailable right now. Nothing was saved.',
  /** F-91 */ downloadsBusy: (minute: string): string =>
    `Too many downloads. You can try again at ${minute} Turin time.`,
  /** F-92 */ noSignedEstimate: 'This piece has no signed-off estimate yet.',
  /** F-93 */ dossierStored: 'Dossier stored.',
  /** F-94 */ dossierSigned: 'Dossier signed.',
  /** F-95 */ notDeskName: 'That is not the name on this desk.',
  /** F-96 */ dossierLocked: 'A signed dossier never changes.',
  /** F-97 */ dossierNotStored: 'The dossier is not stored yet.',
  /** F-98 */ closeInstead: 'Close this client instead.',
  /** F-99 */ loading: 'Loading\u2026',
  /** F-100 */ notFound: 'Page not found',
  /** F-101 */ passwordChanged: 'Password changed.',
  /** F-102 */ clientSaved: (name: string): string => `${name} saved.`,
  /** F-103 */ clientDeleted: (name: string): string => `${name} deleted.`,
  /** F-104 */ pieceDuplicated: (title: string): string => `${title} duplicated.`,
  /** F-105 */ pieceState: (title: string, state: string): string => `${title} is now ${state}.`,
  /** F-106 */ hideCleared: 'Hide cleared.',
  /** F-107 */ jobAdded: (job: string, bench: string, date: string): string =>
    `${job} added to ${bench} on ${date}.`,
  /** F-108 */ previewReady: (a: number, b: number, c: number): string =>
    `Preview ready: ${a} new, ${b} matched, ${c} refused.`,
  /** F-109 */ emailTaken: 'That email already has a desk.',
  /** F-110 */ noBringBack: 'This client can no longer be brought back.',
  /** F-111 */ notTime: 'That is not a time. Write it like 09:00.',
  /** F-112 */ notNumber: 'That is not a number. Write it like 12.50.',
} as const;

export const EMPTY = {
  pieces: 'No pieces yet.',
  clients: 'No clients yet.',
  pins: 'No pins yet.',
  photographs: 'No photographs yet.',
  holds: 'No holds yet.',
  jobs: 'No jobs this week.',
  collections: 'No collections yet.',
  family: 'Nothing here until the library is refreshed.',
} as const;

export const REGION = {
  announcements: 'Announcements',
  refreshState: 'Refresh state',
  problems: 'Problems',
  mainAction: 'Main action',
} as const;
