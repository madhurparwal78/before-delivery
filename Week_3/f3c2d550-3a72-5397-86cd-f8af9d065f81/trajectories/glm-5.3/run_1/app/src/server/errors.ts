// The published error shape, codes, precedence and copy (Feedback states).

export interface ErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> };
}

export const COPY = {
  capture422: "Check the highlighted fields.",
  idempotencyInFlight: "This save is still in progress. Wait for it to finish.",
  storageUnavailable: "The photograph could not be stored, so nothing was saved. Try again when storage returns.",
} as const;

export function errorBody(code: string, message: string, fields?: Record<string, string>): ErrorBody {
  return fields ? { error: { code, message, fields } } : { error: { code, message } };
}

export const FIELD_COPY: Record<string, (ctx?: { year?: number }) => string> = {
  photo_bytes: () => "Use a photograph of 15,000,000 bytes or less.",
  photo_pixels: () => "Use a photograph of 40 megapixels or less.",
  photo: () => "Add a JPEG or PNG photograph.",
  title: () => "Give the object a name of 1 to 80 characters.",
  maker: () => "Keep the maker to 80 characters or fewer.",
  year: (ctx) => `Enter a year from 1800 to ${ctx?.year}.`,
  width: () => "Enter a size above 0 and up to 5000.0 mm (196.9 in).",
  height: () => "Enter a size above 0 and up to 5000.0 mm (196.9 in).",
  depth: () => "Enter a size above 0 and up to 5000.0 mm (196.9 in).",
  materials: () => "List up to 8 materials of 40 characters or fewer.",
  finish: () => "Keep the finish to 80 characters or fewer.",
  colour_family: () => "Choose a colour family.",
  source_url: () => "Enter a link that starts with http:// or https://.",
  source_note: () => "Keep this to 120 characters or fewer.",
  notes: () => "Keep notes to 2000 characters or fewer.",
  x: () => "Pick a point on the photograph.",
  y: () => "Pick a point on the photograph.",
  swatch_x: () => "Pick a point on the photograph.",
  swatch_y: () => "Pick a point on the photograph.",
  zone: () => "Choose a time zone from the list.",
  unit: () => "Choose millimetres or inches.",
  name: () => "Give the reel a name of 1 to 60 characters.",
  reference_ids: () => "Use each reference once, and only references in your library.",
  reference_id: () => "Use a reference that is in your library.",
  version: () => "Send the reference's current version number.",
  reel_version: () => "Send the reel's current version number.",
  paper: () => "Choose A4 or US Letter.",
};

export const MESSAGES = {
  crossOrigin: "Requests from other origins are not accepted.",
  tooLarge: "That request is too large.",
  unsupportedMediaType: "That content type is not accepted.",
  malformedJson: "That request body is not valid JSON.",
  notFound: "This reference isn't in your deck.",
  idempotencyKeyRequired: "An idempotency key is required.",
  idempotencyInFlight: COPY.idempotencyInFlight,
  idempotencyConflict: "That idempotency key was used for a different request.",
  referenceTrashed: "This reference is in the trash.",
  referenceVersionConflict: "This reference changed in another window. Reloaded the latest facts.",
  alreadyTrashed: "This reference is already in the trash.",
  notTrashed: "This reference is not in the trash.",
  restoreWindowClosed: "The restore window for this reference has closed. It has been purged from your library.",
  alreadyInReel: "That reference is already in this reel.",
  reelFull: "A reel holds at most 60 stops.",
  reelEmpty: "Add at least one reference before printing.",
  reelVersionConflict: "This reel changed in another window. Reloaded the latest order.",
  sheetNotFailed: "Only a failed sheet can be tried again.",
  sheetNotReady: "The contact sheet is not ready yet.",
  storageUnavailable: COPY.storageUnavailable,
  validation: COPY.capture422,
} as const;
