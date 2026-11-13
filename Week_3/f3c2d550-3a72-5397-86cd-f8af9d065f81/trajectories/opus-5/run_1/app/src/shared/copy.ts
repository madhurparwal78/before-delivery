import type { Unit } from './types.js';

/** Published copy, character for character. */

export const COLOUR_FAMILIES = [
  'Black',
  'White',
  'Grey',
  'Silver',
  'Beige',
  'Brown',
  'Red',
  'Orange',
  'Yellow',
  'Green',
  'Blue',
  'Purple',
  'Pink',
] as const;

/** The published form order of the capture form. */
export const FORM_ORDER = [
  'photo',
  'swatch_x',
  'swatch_y',
  'title',
  'maker',
  'year',
  'unit',
  'width',
  'height',
  'depth',
  'materials',
  'finish',
  'colour_family',
  'source_url',
  'source_note',
  'notes',
] as const;

export const FIELD_COPY = {
  photoType: 'Add a JPEG or PNG photograph.',
  photoBytes: 'Use a photograph of 15,000,000 bytes or less.',
  photoPixels: 'Use a photograph of 40 megapixels or less.',
  title: 'Give the object a name of 1 to 80 characters.',
  maker: 'Keep the maker to 80 characters or fewer.',
  size: 'Enter a size above 0 and up to 5000.0 mm (196.9 in).',
  materials: 'List up to 8 materials of 40 characters or fewer.',
  finish: 'Keep the finish to 80 characters or fewer.',
  colour_family: 'Choose a colour family.',
  source_url: 'Enter a link that starts with http:// or https://.',
  source_note: 'Keep this to 120 characters or fewer.',
  notes: 'Keep notes to 2000 characters or fewer.',
  swatchPoint: 'Pick a point on the photograph.',
  zone: 'Choose a time zone from the list.',
  unit: 'Choose millimetres or inches.',
  reelName: 'Give the reel a name of 1 to 60 characters.',
  reference_ids: 'Use each reference once, and only references in your library.',
  reference_id: 'Use a reference that is in your library.',
  referenceVersion: "Send the reference's current version number.",
  reelVersion: "Send the reel's current version number.",
  paper: 'Choose A4 or US Letter.',
} as const;

export function yearCopy(currentYear: number): string {
  return `Enter a year from 1800 to ${currentYear}.`;
}

export const DECK_STATUS = {
  capturePending: 'Saving the original to storage.',
  captureSuccess: 'Saved to your deck.',
  validationFailure: 'Check the highlighted fields.',
  idempotencyInFlight: 'This save is still in progress. Wait for it to finish.',
  storageFailure:
    'The photograph could not be stored, so nothing was saved. Try again when storage returns.',
  searchZero: 'No references match that search.',
  savingFacts: 'Saving facts.',
  factsSaved: 'Facts saved.',
  referenceVersionConflict:
    'This reference changed in another window. Reloaded the latest facts.',
  measuringSwatch: 'Measuring the swatch.',
  swatchSet: 'Swatch set from the photo.',
  swatchReset: 'Swatch reset to the measured colour.',
  reelFull: 'A reel holds at most 60 stops.',
  reelVersionConflict: 'This reel changed in another window. Reloaded the latest order.',
  reelCreated: 'Reel created.',
  sheetQueued: 'Contact sheet queued.',
  reelEmpty: 'Add at least one reference before printing.',
  sheetReady: 'Contact sheet ready.',
  sheetFailed: 'The contact sheet could not be rendered.',
  restoreWindowClosed:
    'The restore window for this reference has closed. It has been purged from your library.',
  genericFailure: 'Something went wrong. Try again.',
} as const;

export function searchCountCopy(n: number): string {
  if (n === 0) return DECK_STATUS.searchZero;
  if (n === 1) return '1 reference matches.';
  return `${n} references match.`;
}

export function unitName(unit: Unit): string {
  return unit === 'mm' ? 'millimetres' : 'inches';
}

export function unitChangedCopy(unit: Unit): string {
  return `Sizes now show in ${unitName(unit)}.`;
}

export const SERVICE_BANNERS = {
  search: 'Search is offline. Showing simple matches from your library until it returns.',
  storage: "Storage is offline. New captures can't be saved until it returns.",
  printing: 'Printing is offline. Contact sheets wait in the queue until it returns.',
} as const;

export const SCREEN_STATES = {
  loading: 'Opening your deck.',
  libraryEmpty: 'Your deck is empty. Capture your first object to start.',
  trashEmpty: 'The trash is empty.',
  photoUnavailable: 'Photo unavailable while storage is offline.',
  unknown: "This reference isn't in your deck.",
  emptyReel: 'This reel has no stops yet. Add references from your library.',
} as const;

export const DAILY_PULL_COPY = {
  empty: 'Nothing to pull yet. Capture an object to start your Daily Pull.',
  removed: "Today's pull has left your library. A new one arrives at 06:00.",
} as const;

export const LANDING_COPY = {
  wordmark: 'Stowdeck',
  headline: 'Keep the object, not the picture.',
  sentence:
    'Every photograph keeps its maker, its true size and its finish, so the reference you show a client is the one you can print.',
  action: 'Open your deck',
  standIn: 'Demo photographs are open-access museum images or drawn stand-ins.',
} as const;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** `YYYY-MM-DD` to `<d> <Month> <YYYY>`, never through the browser's locale or clock. */
export function formatPublishedDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  const monthIndex = Number(m) - 1;
  return `${Number(d)} ${MONTHS[monthIndex] ?? m} ${y}`;
}

/** `Reference <k> of <N>: <title>, <maker> <year>`, dropping missing parts. */
export function announcement(
  k: number,
  n: number,
  title: string,
  maker: string | null,
  year: number | null,
): string {
  return `Reference ${k} of ${n}: ${titleMakerYear(title, maker, year)}`;
}

/** `<title>, <maker> <year>`, dropping ` <year>` then `, <maker> <year>`. */
export function titleMakerYear(
  title: string,
  maker: string | null,
  year: number | null,
): string {
  if (!maker) return title;
  if (year === null) return `${title}, ${maker}`;
  return `${title}, ${maker} ${year}`;
}

/** `<maker>, <year>` for the contact sheet, using the announcer's dropping rule. */
export function makerYearLine(maker: string | null, year: number | null): string {
  if (!maker) return '';
  if (year === null) return maker;
  return `${maker}, ${year}`;
}

export function trashCountdown(secondsLeft: number): string {
  const s = Math.max(0, Math.floor(secondsLeft));
  if (s >= 86400) {
    const d = Math.floor(s / 86400);
    const h = Math.floor((s - d * 86400) / 3600);
    return `${d}d ${h}h`;
  }
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s - h * 3600) / 60);
    return `${h}h ${m}m`;
  }
  const m = Math.floor(s / 60);
  return `${m}m ${s - m * 60}s`;
}
