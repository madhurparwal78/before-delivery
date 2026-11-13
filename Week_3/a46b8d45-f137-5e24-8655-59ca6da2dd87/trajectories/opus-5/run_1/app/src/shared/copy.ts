/**
 * Every visible string, printed exactly as published: straight apostrophes, a single
 * ellipsis character and em dashes. Owner copy comes in English and Polish; operator copy
 * and dispatch notes are English only.
 *
 * Both the server's pages and the browser's in-place language switch read from here, so
 * the two can never drift apart.
 */

import type { ClaimState } from './claim-state';
import { formatDate, formatInstantDate, formatInstantTime, formatMoney, type Language } from './format';

type Pair = Readonly<Record<Language, string>>;

const MIDDLE_DOT = '\u00b7';

export const STATE_NAMES: Readonly<Record<ClaimState, Pair>> = {
  started: { 'en-GB': 'Started', 'pl-PL': 'Rozpoczęte' },
  confirmed: { 'en-GB': 'Confirmed', 'pl-PL': 'Potwierdzone' },
  identified: { 'en-GB': 'Identified', 'pl-PL': 'Zidentyfikowane' },
  quoted: { 'en-GB': 'Quoted', 'pl-PL': 'Wycenione' },
  declined: { 'en-GB': 'Declined', 'pl-PL': 'Odrzucone' },
  dispatched: { 'en-GB': 'Dispatched', 'pl-PL': 'Wysłane' },
  closed: { 'en-GB': 'Closed', 'pl-PL': 'Zamknięte' },
  erased: { 'en-GB': 'Erased', 'pl-PL': 'Usunięte' },
};

export function stateName(state: ClaimState, language: Language): string {
  return STATE_NAMES[state][language];
}

/* ------------------------------------------------------------------ owner page headings */

export const PAGE_HEADINGS = {
  home: { 'en-GB': 'Holmgarth Aftercare', 'pl-PL': 'Holmgarth Aftercare' },
  claimForm: { 'en-GB': 'Claim a part', 'pl-PL': 'Zgłoś część' },
  confirmation: { 'en-GB': 'Confirm your claim', 'pl-PL': 'Potwierdź zgłoszenie' },
  find: { 'en-GB': 'Find my claim', 'pl-PL': 'Znajdź moje zgłoszenie' },
  sent: { 'en-GB': 'Check your email', 'pl-PL': 'Sprawdź pocztę' },
} as const satisfies Record<string, Pair>;

export function sharePageHeading(reference: string, language: Language): string {
  return language === 'en-GB' ? `Claim ${reference}` : `Zgłoszenie ${reference}`;
}

/* ------------------------------------------------------- owner pending and success copy */

export const OWNER_PENDING = {
  claimStart: { 'en-GB': 'Sending your claim…', 'pl-PL': 'Wysyłamy zgłoszenie…' },
  estimate: { 'en-GB': 'Asking the carrier…', 'pl-PL': 'Pytamy przewoźnika…' },
  confirm: { 'en-GB': 'Confirming…', 'pl-PL': 'Potwierdzamy…' },
  find: { 'en-GB': 'Looking up your claim…', 'pl-PL': 'Szukamy zgłoszenia…' },
} as const satisfies Record<string, Pair>;

export const SENT_PAGE_ALREADY_CONFIRMED: Pair = {
  'en-GB': 'This claim is already confirmed. Follow it through your share link.',
  'pl-PL': 'To zgłoszenie jest już potwierdzone. Śledź je przez swój link.',
};

export function sentPageText(reference: string, language: Language): string {
  return language === 'en-GB'
    ? `We've emailed a link to confirm claim ${reference}. Open it on any device.`
    : `Wysłaliśmy e-mailem link do potwierdzenia zgłoszenia ${reference}. Otwórz go na dowolnym urządzeniu.`;
}

/** Shown on the sent page and in the confirmation email, from the server's `confirm_by`. */
export function linkLifetimeLine(confirmBy: string, language: Language): string {
  const time = formatInstantTime(confirmBy);
  const date = formatInstantDate(confirmBy, language);
  return language === 'en-GB'
    ? `This link works until ${time} on ${date} (UK time).`
    : `Link działa do ${time} dnia ${date} (czas brytyjski).`;
}

export function estimateShown(band: string, chargeMinor: number, language: Language): string {
  const amount = formatMoney(chargeMinor, language);
  const label = language === 'en-GB' ? 'Band' : 'Strefa';
  return `${label} ${band} ${MIDDLE_DOT} ${amount}`;
}

/* ------------------------------------------------------------ share page and slip lines */

export function partLine(bookletNumber: number, partName: string, language: Language): string {
  return language === 'en-GB' ? `Part ${bookletNumber}: ${partName}` : `Część ${bookletNumber}: ${partName}`;
}

export function partNumberLine(partNumber: string, language: Language): string {
  return language === 'en-GB' ? `Part number ${partNumber}` : `Numer części ${partNumber}`;
}

export const NOT_YET_RULED: Pair = { 'en-GB': 'Not yet ruled', 'pl-PL': 'Jeszcze nie rozstrzygnięto' };

export const RULING_INSIDE: Pair = { 'en-GB': 'Inside aftercare', 'pl-PL': 'W ramach opieki posprzedażnej' };

export const RULING_OUTSIDE: Pair = { 'en-GB': 'Outside aftercare', 'pl-PL': 'Poza opieką posprzedażną' };

export function rulingLine(inside: boolean, language: Language): string {
  return (inside ? RULING_INSIDE : RULING_OUTSIDE)[language];
}

export function coverEndLine(coverEndsAt: string, language: Language): string {
  const time = formatInstantTime(coverEndsAt);
  const date = formatInstantDate(coverEndsAt, language);
  return language === 'en-GB' ? `Cover until ${time} on ${date}` : `Ochrona do ${time} dnia ${date}`;
}

export function editionLine(code: string, language: Language): string {
  return language === 'en-GB' ? `Ruled by edition ${code}` : `Rozstrzygnięto wg edycji ${code}`;
}

export function revisionHeading(revision: number, language: Language): string {
  return language === 'en-GB' ? `Quote revision ${revision}` : `Wycena nr ${revision}`;
}

export function partAmountLine(amountMinor: number, language: Language): string {
  const amount = formatMoney(amountMinor, language);
  return language === 'en-GB' ? `Part ${amount}` : `Część ${amount}`;
}

export function carriageAmountLine(band: string, amountMinor: number, language: Language): string {
  const amount = formatMoney(amountMinor, language);
  return language === 'en-GB' ? `Carriage, band ${band} ${amount}` : `Przesyłka, strefa ${band} ${amount}`;
}

export function totalLine(amountMinor: number, language: Language): string {
  const amount = formatMoney(amountMinor, language);
  return language === 'en-GB' ? `Total ${amount}` : `Razem ${amount}`;
}

export function promiseLine(kind: 'same_day' | 'later', date: string, language: Language): string {
  const shown = formatDate(date, language);
  if (kind === 'same_day') {
    return language === 'en-GB'
      ? `Same-working-day dispatch: leaves the workshop on ${shown}`
      : `Wysyłka tego samego dnia roboczego: część wyjdzie z warsztatu ${shown}`;
  }
  return language === 'en-GB'
    ? `Leaves the workshop by ${shown}`
    : `Część wyjdzie z warsztatu najpóźniej ${shown}`;
}

export function paidLine(amountMinor: number, language: Language): string {
  const amount = formatMoney(amountMinor, language);
  return language === 'en-GB' ? `Paid ${amount}` : `Zapłacono ${amount}`;
}

export const NOTHING_CHARGED: Pair = { 'en-GB': 'Nothing charged', 'pl-PL': 'Bez opłat' };

export function refundedLine(amountMinor: number, language: Language): string {
  const amount = formatMoney(amountMinor, language);
  return language === 'en-GB' ? `Refunded ${amount}` : `Zwrócono ${amount}`;
}

export function historyEntry(state: ClaimState, at: string, language: Language): string {
  const time = formatInstantTime(at);
  const date = formatInstantDate(at, language);
  const name = stateName(state, language);
  return language === 'en-GB' ? `${name}, ${time} on ${date}` : `${name}, ${time} dnia ${date}`;
}

/** Void revisions are shown to the operator only, inside the Earlier revisions disclosure. */
export function voidRevisionLine(revision: number, totalMinor: number): string {
  return `Revision ${revision} (void): Total ${formatMoney(totalMinor, 'en-GB')}`;
}

/* ------------------------------------------------------------------------ owner refusals */

export const OWNER_REFUSALS = {
  link_lapsed: {
    'en-GB': 'This confirmation link has lapsed. Start your claim again to get a new one.',
    'pl-PL': 'Ten link potwierdzający wygasł. Rozpocznij zgłoszenie ponownie, aby otrzymać nowy.',
  },
  link_used: {
    'en-GB': 'This confirmation link has already been used.',
    'pl-PL': 'Ten link potwierdzający został już użyty.',
  },
  link_unknown: {
    'en-GB': "We couldn't find that confirmation link.",
    'pl-PL': 'Nie znaleźliśmy tego linku potwierdzającego.',
  },
  claim_unknown: {
    'en-GB': "We couldn't find that claim.",
    'pl-PL': 'Nie znaleźliśmy tego zgłoszenia.',
  },
  not_a_photo: {
    'en-GB': "The file <file> isn't a JPEG, PNG or WebP photo.",
    'pl-PL': 'Plik <file> nie jest zdjęciem JPEG, PNG ani WebP.',
  },
  too_large: {
    'en-GB': 'The file <file> is larger than 8 MB.',
    'pl-PL': 'Plik <file> jest większy niż 8 MB.',
  },
  photo_count: {
    'en-GB': 'Add between 1 and 4 photos.',
    'pl-PL': 'Dodaj od 1 do 4 zdjęć.',
  },
  request_too_large: {
    'en-GB': 'Those photos are too large to send together.',
    'pl-PL': 'Te zdjęcia są razem za duże do wysłania.',
  },
  carrier_unavailable: {
    'en-GB': "The carrier isn't answering right now. Try the estimate again later.",
    'pl-PL': 'Przewoźnik nie odpowiada w tej chwili. Spróbuj ponownie później.',
  },
  carrier_timeout: {
    'en-GB': 'The carrier is taking too long to answer. Try the estimate again in a minute.',
    'pl-PL': 'Przewoźnik zbyt długo nie odpowiada. Spróbuj ponownie za minutę.',
  },
  carrier_malformed: {
    'en-GB': "The carrier sent an answer we can't read. Try the estimate again later.",
    'pl-PL': 'Przewoźnik przesłał odpowiedź, której nie możemy odczytać. Spróbuj ponownie później.',
  },
  storage_unavailable: {
    'en-GB': "We can't store photos right now, so nothing was saved. Please try again in a few minutes.",
    'pl-PL': 'Nie możemy teraz zapisać zdjęć, więc nic nie zostało zapisane. Spróbuj ponownie za kilka minut.',
  },
  mail_unavailable: {
    'en-GB': "We can't send email right now, so nothing was saved. Please try again in a few minutes.",
    'pl-PL': 'Nie możemy teraz wysłać e-maila, więc nic nie zostało zapisane. Spróbuj ponownie za kilka minut.',
  },
  database_unavailable: {
    'en-GB': "We can't reach our claim records right now, so nothing was saved. Please try again in a few minutes.",
    'pl-PL':
      'Nie możemy teraz połączyć się z rejestrem zgłoszeń, więc nic nie zostało zapisane. Spróbuj ponownie za kilka minut.',
  },
  part_withdrawn: {
    'en-GB': 'Part <number> is no longer available to claim.',
    'pl-PL': 'Część <number> nie jest już dostępna do zgłoszenia.',
  },
  not_found: {
    'en-GB': "We couldn't find a claim with that reference and email.",
    'pl-PL': 'Nie znaleźliśmy zgłoszenia o tym numerze i adresie e-mail.',
  },
  reference_locked: {
    'en-GB': 'This reference is locked after too many wrong tries. Try again later.',
    'pl-PL': 'Ten numer zgłoszenia jest zablokowany po zbyt wielu błędnych próbach. Spróbuj ponownie później.',
  },
  wrong_state: {
    'en-GB': "This claim hasn't been confirmed yet. Use the link in the email we sent.",
    'pl-PL': 'To zgłoszenie nie zostało jeszcze potwierdzone. Użyj linku z wysłanego e-maila.',
  },
  claim_closed: {
    'en-GB': 'This claim is closed, so its link no longer works.',
    'pl-PL': 'To zgłoszenie jest zamknięte, więc link już nie działa.',
  },
  link_withdrawn: {
    'en-GB': 'This link has been withdrawn. Ask Holmgarth Aftercare for a new one.',
    'pl-PL': 'Ten link został wycofany. Poproś Holmgarth Aftercare o nowy.',
  },
  share_unknown: {
    'en-GB': "We couldn't find that link.",
    'pl-PL': 'Nie znaleźliśmy tego linku.',
  },
  rate_limited: {
    'en-GB': 'Too many requests. Please wait a moment.',
    'pl-PL': 'Zbyt wiele zapytań. Poczekaj chwilę.',
  },
} as const satisfies Record<string, Pair>;

export type OwnerRefusalCode = keyof typeof OWNER_REFUSALS;

export function isOwnerRefusalCode(code: string): code is OwnerRefusalCode {
  return Object.prototype.hasOwnProperty.call(OWNER_REFUSALS, code);
}

export interface RefusalParams {
  file?: string;
  number?: number | string;
}

/* -------------------------------------------------------------------- owner field errors */

export const OWNER_FIELD_ERRORS = {
  name: { 'en-GB': 'Enter your name.', 'pl-PL': 'Podaj imię i nazwisko.' },
  email: { 'en-GB': 'Enter a valid email address.', 'pl-PL': 'Podaj poprawny adres e-mail.' },
  postcode: { 'en-GB': 'Enter a UK postcode.', 'pl-PL': 'Podaj brytyjski kod pocztowy.' },
  part: {
    'en-GB': 'Choose the broken or missing part.',
    'pl-PL': 'Wybierz uszkodzoną lub brakującą część.',
  },
  quantity: { 'en-GB': 'Choose between 1 and 20.', 'pl-PL': 'Wybierz od 1 do 20.' },
  purchase_date: {
    'en-GB': 'Enter the date you bought it, not in the future.',
    'pl-PL': 'Podaj datę zakupu, nie późniejszą niż dziś.',
  },
  description: {
    'en-GB': 'Keep the description under 1,000 characters.',
    'pl-PL': 'Opis może mieć najwyżej 1000 znaków.',
  },
} as const satisfies Record<string, Pair>;

export type OwnerFieldName = keyof typeof OWNER_FIELD_ERRORS;

/** The claim form shows one message for the model and part together. */
export function ownerFieldErrorFor(field: string): OwnerFieldName | null {
  switch (field) {
    case 'name':
    case 'email':
    case 'postcode':
    case 'quantity':
    case 'description':
      return field;
    case 'purchase_date':
      return 'purchase_date';
    case 'model':
    case 'booklet_number':
    case 'part':
      return 'part';
    default:
      return null;
  }
}

/* ---------------------------------------------------------------- operator copy, English */

export const OPERATOR_WORKING = 'Working…';

export function decidedCount(decided: number, inside: number, outside: number): string {
  return `Decided claims: ${decided} (inside ${inside}, outside ${outside})`;
}

export const OPERATOR_SUCCESS = {
  identified: (edition: string): string => `Part identified. Ruled by edition ${edition}.`,
  quoted: (revision: number): string => `Quote revision ${revision} recorded in billing.`,
  payment: (amountMinor: number): string => `Payment of ${formatMoney(amountMinor, 'en-GB')} recorded in billing.`,
  declined: (): string => 'Claim declined.',
  dispatched: (): string => 'Dispatched. Dispatch note stored.',
  closed: (): string => 'Claim closed.',
  linkWithdrawn: (): string => 'Share link withdrawn.',
  newLink: (): string => 'New share link created.',
  erased: (): string => 'Owner data erased.',
  editionSaved: (code: string, startsOn: string): string =>
    `Edition ${code} saved. It rules claims confirmed from 00:00 on ${formatDate(startsOn, 'en-GB')}.`,
  importDone: (created: number, updated: number, unchanged: number, unmatched: number): string =>
    `Imported: ${created} new, ${updated} updated, ${unchanged} unchanged, ${unmatched} unmatched.`,
} as const;

export function waitingNotices(count: number): string {
  return `Notices waiting to send: ${count}`;
}

export const OPERATOR_REFUSALS = {
  bad_credentials: "That email and password don't match.",
  not_paid: "Record the owner's payment before dispatch.",
  already_paid: 'This claim is already paid.',
  idempotency_conflict: 'That request was already used for a different action.',
  billing_unavailable: "Billing isn't answering. Nothing was charged or changed.",
  carrier_unavailable: "The carrier isn't answering. No quote was made.",
  carrier_timeout: 'The carrier took too long to answer. No quote was made.',
  carrier_malformed: "The carrier's answer couldn't be read. No quote was made.",
  storage_unavailable: "File storage isn't answering. Nothing was changed.",
  mail_unavailable: "Email isn't answering. Nothing was erased.",
  database_unavailable: "The claim records aren't answering. Nothing was changed.",
  must_be_future: 'Choose a date after today.',
  edition_date_taken: 'An edition already starts on that date.',
  edition_code_taken: 'That edition code is already used.',
  file_too_large: 'The file is larger than 2,000,000 bytes.',
  not_found: 'No claim with that reference.',
} as const;

export type OperatorRefusalCode = keyof typeof OPERATOR_REFUSALS;

export function isOperatorRefusalCode(code: string): code is OperatorRefusalCode {
  return Object.prototype.hasOwnProperty.call(OPERATOR_REFUSALS, code);
}

export function operatorWrongState(state: ClaimState): string {
  return `This claim is ${stateName(state, 'en-GB')}, so that can't be done now.`;
}

export function operatorPartWithdrawn(bookletNumber: number | string): string {
  return `Part ${bookletNumber} has been withdrawn.`;
}

/* --------------------------------------------------------------------- notice subjects */

export type NoticeKind = 'confirmation' | 'quoted' | 'declined' | 'dispatched' | 'closed' | 'new_link';

export function noticeSubject(
  kind: NoticeKind,
  reference: string,
  language: Language,
  figures: { totalMinor?: number; refundedMinor?: number } = {},
): string {
  const english = language === 'en-GB';
  switch (kind) {
    case 'confirmation':
      return english
        ? `Confirm your Holmgarth claim ${reference}`
        : `Potwierdź zgłoszenie Holmgarth ${reference}`;
    case 'quoted': {
      const total = formatMoney(figures.totalMinor ?? 0, language);
      return english ? `Quote for claim ${reference}: ${total}` : `Wycena zgłoszenia ${reference}: ${total}`;
    }
    case 'declined': {
      const refunded = figures.refundedMinor ?? 0;
      if (refunded === 0) {
        return english
          ? `Claim ${reference} declined — nothing charged`
          : `Zgłoszenie ${reference} odrzucone — bez opłat`;
      }
      const amount = formatMoney(refunded, language);
      return english
        ? `Claim ${reference} declined — ${amount} refunded`
        : `Zgłoszenie ${reference} odrzucone — zwrot ${amount}`;
    }
    case 'dispatched':
      return english
        ? `Part on its way for claim ${reference}`
        : `Część w drodze — zgłoszenie ${reference}`;
    case 'closed':
      return english ? `Claim ${reference} is closed` : `Zgłoszenie ${reference} zostało zamknięte`;
    case 'new_link':
      return english ? `New link for claim ${reference}` : `Nowy link do zgłoszenia ${reference}`;
  }
}

/* -------------------------------------------------------------- control names and labels */

export const CONTROL_NAMES = {
  languageGroup: { 'en-GB': 'Language · Język', 'pl-PL': 'Language · Język' },
  english: { 'en-GB': 'English', 'pl-PL': 'English' },
  polish: { 'en-GB': 'Polski', 'pl-PL': 'Polski' },
  startAClaim: { 'en-GB': 'Start a claim', 'pl-PL': 'Zgłoś część' },
  findMyClaim: { 'en-GB': 'Find my claim', 'pl-PL': 'Znajdź moje zgłoszenie' },
  yourName: { 'en-GB': 'Your name', 'pl-PL': 'Imię i nazwisko' },
  email: { 'en-GB': 'Email', 'pl-PL': 'E-mail' },
  postcode: { 'en-GB': 'Postcode', 'pl-PL': 'Kod pocztowy' },
  model: { 'en-GB': 'Model', 'pl-PL': 'Model' },
  purchaseDate: { 'en-GB': 'Date of purchase', 'pl-PL': 'Data zakupu' },
  quantity: { 'en-GB': 'Quantity', 'pl-PL': 'Ilość' },
  whatHappened: { 'en-GB': 'What happened', 'pl-PL': 'Co się stało' },
  damagePhotos: { 'en-GB': 'Damage photos', 'pl-PL': 'Zdjęcia uszkodzeń' },
  carriageEstimate: { 'en-GB': 'Carriage estimate', 'pl-PL': 'Szacunkowy koszt przesyłki' },
  estimateCarriage: { 'en-GB': 'Estimate carriage', 'pl-PL': 'Oszacuj przesyłkę' },
  startClaim: { 'en-GB': 'Start claim', 'pl-PL': 'Wyślij zgłoszenie' },
  confirmMyClaim: { 'en-GB': 'Confirm my claim', 'pl-PL': 'Potwierdzam zgłoszenie' },
  claimReference: { 'en-GB': 'Claim reference', 'pl-PL': 'Numer zgłoszenia' },
  findClaim: { 'en-GB': 'Find claim', 'pl-PL': 'Znajdź zgłoszenie' },
  claimSlip: { 'en-GB': 'Claim slip', 'pl-PL': 'Karta zgłoszenia' },
  claimHistory: { 'en-GB': 'Claim history', 'pl-PL': 'Historia zgłoszenia' },
  fittingFan: { 'en-GB': 'Fitting fan', 'pl-PL': 'Rozkład części' },
  separateParts: { 'en-GB': 'Separate parts', 'pl-PL': 'Rozsuń części' },
  diagramUnavailable: {
    'en-GB': 'Diagram unavailable — choose your part from the list',
    'pl-PL': 'Diagram niedostępny — wybierz część z listy',
  },
  partsInBookletOrder: {
    'en-GB': 'Parts in booklet order',
    'pl-PL': 'Części w kolejności z instrukcji',
  },
  skipToClaim: { 'en-GB': 'Skip to claim', 'pl-PL': 'Skip to claim' },
} as const satisfies Record<string, Pair>;

/** A part button is named `Part <booklet number>: <part name>`, and part names are never translated. */
export function partButtonName(bookletNumber: number, partName: string, language: Language): string {
  return language === 'en-GB' ? `Part ${bookletNumber}: ${partName}` : `Część ${bookletNumber}: ${partName}`;
}

/** The small mono caption under each figure on the slip, naming its source. */
export const SOURCE_CAPTIONS = {
  carrier: { 'en-GB': 'carrier', 'pl-PL': 'przewoźnik' },
  billing: { 'en-GB': 'billing', 'pl-PL': 'rozliczenia' },
  edition: { 'en-GB': 'edition', 'pl-PL': 'edycja' },
} as const satisfies Record<string, Pair>;
