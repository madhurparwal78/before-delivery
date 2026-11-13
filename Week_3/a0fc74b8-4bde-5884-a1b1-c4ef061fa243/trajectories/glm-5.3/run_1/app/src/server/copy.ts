export const COPY = {
  titleLength: "Enter a title of 1 to 120 characters.",
  timeZone: "Choose a valid time zone.",
  file: "Choose a PDF to upload.",
  name: "Enter a name.",
  emailInvalid: "Enter a valid email address.",
  emailDuplicate: "This email is already a signer on this document.",
  recipientsMax: "A document can have at most 10 signers.",
  kind: "Choose signature, initials, date or text.",
  label: "Enter a label of 1 to 40 characters.",
  geometry: "Fields must lie inside the page and be at least 0.02 by 0.02.",
  valueTooLong: "Text can be at most 200 characters.",
  typed: "Enter 1 to 100 characters.",
  strokes: "Draw at least one stroke of at most 5,000 points.",
  reasonEmptyDecline: "Enter a reason for declining.",
  reasonEmptyVoid: "Enter a reason for voiding.",
  reasonTooLong: "Reason can be at most 500 characters.",
  signers: "Enter a name and a valid email address for every signer.",
  missingSignatureFields: "Every signer needs a signature field. Missing: ",
  storageUnavailableUpload: "File storage is unavailable. Your PDF was not uploaded.",
  storageUnavailableNotice: "File storage is unavailable. New uploads are paused and completed PDFs are sealed when it recovers.",
  mailUnavailableNotice: "Email is unavailable. Invitations are held and sent when email recovers.",
  pagesCantLoadHeading: "Pages can't be shown right now",
  pagesCantLoadBody: "File storage is unavailable. Your document and its fields are safe.",
  emailUnavailableReminder: "Email is unavailable. Try the reminder again later.",
  somethingWentWrong: "Something went wrong. Try again.",
  invalidCredentials: "Email or password is incorrect.",
  lastOwner: "A team needs at least one owner.",
} as const;

export const NOT_A_PDF = "That file is not a PDF.";
export const PDF_ENCRYPTED = "Password-protected PDFs can't be uploaded.";
export const PDF_HAS_SCRIPTS = "PDFs with scripts can't be uploaded.";
export const PDF_ROTATED = "Rotated pages aren't supported. Upload a PDF with upright pages.";
export const TOO_MANY_PAGES = "This PDF has more than 60 pages.";
export const TOO_LARGE = "This PDF is larger than 25 MB.";

export function declinedByCopy(name: string, reason: string): string {
  return `${name} declined: ${reason}`;
}
export function voidedByCopy(name: string, reason: string): string {
  return `Voided by ${name}: ${reason}`;
}
