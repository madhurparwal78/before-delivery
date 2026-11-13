import { dateText, instantDateText, instantTimeText, money } from "./format";
import type { ClaimState, Lang } from "./types";

type Pair = readonly [en: string, pl: string];

export const pick = (pair: Pair, lang: Lang): string => (lang === "pl-PL" ? pair[1] : pair[0]);

const STATE_NAMES: Record<ClaimState, Pair> = {
  started: ["Started", "Rozpoczęte"],
  confirmed: ["Confirmed", "Potwierdzone"],
  identified: ["Identified", "Zidentyfikowane"],
  quoted: ["Quoted", "Wycenione"],
  declined: ["Declined", "Odrzucone"],
  dispatched: ["Dispatched", "Wysłane"],
  closed: ["Closed", "Zamknięte"],
  erased: ["Erased", "Usunięte"],
};

export const stateName = (state: ClaimState, lang: Lang): string => pick(STATE_NAMES[state], lang);

/** Owner-facing refusals: code, English and Polish copy. `<file>` and `<number>` are filled by `fill`. */
export const OWNER_REFUSALS = {
  link_lapsed: ["This confirmation link has lapsed. Start your claim again to get a new one.", "Ten link potwierdzający wygasł. Rozpocznij zgłoszenie ponownie, aby otrzymać nowy."],
  link_used: ["This confirmation link has already been used.", "Ten link potwierdzający został już użyty."],
  link_unknown: ["We couldn't find that confirmation link.", "Nie znaleźliśmy tego linku potwierdzającego."],
  claim_unknown: ["We couldn't find that claim.", "Nie znaleźliśmy tego zgłoszenia."],
  not_a_photo: ["The file <file> isn't a JPEG, PNG or WebP photo.", "Plik <file> nie jest zdjęciem JPEG, PNG ani WebP."],
  too_large: ["The file <file> is larger than 8 MB.", "Plik <file> jest większy niż 8 MB."],
  photo_count: ["Add between 1 and 4 photos.", "Dodaj od 1 do 4 zdjęć."],
  request_too_large: ["Those photos are too large to send together.", "Te zdjęcia są razem za duże do wysłania."],
  carrier_unavailable: ["The carrier isn't answering right now. Try the estimate again later.", "Przewoźnik nie odpowiada w tej chwili. Spróbuj ponownie później."],
  carrier_timeout: ["The carrier is taking too long to answer. Try the estimate again in a minute.", "Przewoźnik zbyt długo nie odpowiada. Spróbuj ponownie za minutę."],
  carrier_malformed: ["The carrier sent an answer we can't read. Try the estimate again later.", "Przewoźnik przesłał odpowiedź, której nie możemy odczytać. Spróbuj ponownie później."],
  storage_unavailable: ["We can't store photos right now, so nothing was saved. Please try again in a few minutes.", "Nie możemy teraz zapisać zdjęć, więc nic nie zostało zapisane. Spróbuj ponownie za kilka minut."],
  mail_unavailable: ["We can't send email right now, so nothing was saved. Please try again in a few minutes.", "Nie możemy teraz wysłać e-maila, więc nic nie zostało zapisane. Spróbuj ponownie za kilka minut."],
  database_unavailable: ["We can't reach our claim records right now, so nothing was saved. Please try again in a few minutes.", "Nie możemy teraz połączyć się z rejestrem zgłoszeń, więc nic nie zostało zapisane. Spróbuj ponownie za kilka minut."],
  part_withdrawn: ["Part <number> is no longer available to claim.", "Część <number> nie jest już dostępna do zgłoszenia."],
  not_found: ["We couldn't find a claim with that reference and email.", "Nie znaleźliśmy zgłoszenia o tym numerze i adresie e-mail."],
  reference_locked: ["This reference is locked after too many wrong tries. Try again later.", "Ten numer zgłoszenia jest zablokowany po zbyt wielu błędnych próbach. Spróbuj ponownie później."],
  wrong_state: ["This claim hasn't been confirmed yet. Use the link in the email we sent.", "To zgłoszenie nie zostało jeszcze potwierdzone. Użyj linku z wysłanego e-maila."],
  claim_closed: ["This claim is closed, so its link no longer works.", "To zgłoszenie jest zamknięte, więc link już nie działa."],
  link_withdrawn: ["This link has been withdrawn. Ask Holmgarth Aftercare for a new one.", "Ten link został wycofany. Poproś Holmgarth Aftercare o nowy."],
  share_unknown: ["We couldn't find that link.", "Nie znaleźliśmy tego linku."],
  rate_limited: ["Too many requests. Please wait a moment.", "Zbyt wiele zapytań. Poczekaj chwilę."],
} as const satisfies Record<string, Pair>;

export type OwnerRefusalCode = keyof typeof OWNER_REFUSALS;

/** Operator refusals, English only. */
export const OPS_REFUSALS = {
  bad_credentials: "That email and password don't match.",
  wrong_state: "This claim is <state>, so that can't be done now.",
  not_paid: "Record the owner's payment before dispatch.",
  already_paid: "This claim is already paid.",
  part_withdrawn: "Part <number> has been withdrawn.",
  idempotency_conflict: "That request was already used for a different action.",
  billing_unavailable: "Billing isn't answering. Nothing was charged or changed.",
  carrier_unavailable: "The carrier isn't answering. No quote was made.",
  carrier_timeout: "The carrier took too long to answer. No quote was made.",
  carrier_malformed: "The carrier's answer couldn't be read. No quote was made.",
  storage_unavailable: "File storage isn't answering. Nothing was changed.",
  mail_unavailable: "Email isn't answering. Nothing was erased.",
  database_unavailable: "The claim records aren't answering. Nothing was changed.",
  must_be_future: "Choose a date after today.",
  edition_date_taken: "An edition already starts on that date.",
  edition_code_taken: "That edition code is already used.",
  file_too_large: "The file is larger than 2,000,000 bytes.",
  not_found: "No claim with that reference.",
} as const satisfies Record<string, string>;

export type OpsRefusalCode = keyof typeof OPS_REFUSALS;

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/<(\w+)>/g, (whole, key: string) => (key in values ? String(values[key]) : whole));
}

export const FIELDS_MESSAGE = "Some fields need attention.";
export const PART_NOT_FOUND_MESSAGE = "Choose the broken or missing part.";

export const FIELD_ERRORS = {
  name: ["Enter your name.", "Podaj imię i nazwisko."],
  email: ["Enter a valid email address.", "Podaj poprawny adres e-mail."],
  postcode: ["Enter a UK postcode.", "Podaj brytyjski kod pocztowy."],
  part: ["Choose the broken or missing part.", "Wybierz uszkodzoną lub brakującą część."],
  quantity: ["Choose between 1 and 20.", "Wybierz od 1 do 20."],
  purchase_date: ["Enter the date you bought it, not in the future.", "Podaj datę zakupu, nie późniejszą niż dziś."],
  description: ["Keep the description under 1,000 characters.", "Opis może mieć najwyżej 1000 znaków."],
} as const satisfies Record<string, Pair>;

/** Labels and fixed strings of the owner screens, keyed by purpose. */
export const OWNER_TEXT = {
  skipToClaim: ["Skip to claim", "Skip to claim"],
  languageGroup: ["Language · Język", "Language · Język"],
  english: ["English", "English"],
  polish: ["Polski", "Polski"],
  brand: ["Holmgarth Aftercare", "Holmgarth Aftercare"],
  homeExplain: [
    "Holmgarth Aftercare finds, prices and posts replacement numbered parts for flat-pack wardrobes, sofa frames, bed frames and shelving units. Pull the assembly diagram apart, tap the broken part, and we take it from there.",
    "Holmgarth Aftercare znajduje, wycenia i wysyła zamienne numerowane części do szaf, ram sof, ram łóżek i regałów. Rozsuń schemat montażu, dotknij uszkodzonej części, a resztą zajmiemy się my.",
  ],
  startClaim: ["Start a claim", "Zgłoś część"],
  findMyClaim: ["Find my claim", "Znajdź moje zgłoszenie"],
  claimFormHeading: ["Claim a part", "Zgłoś część"],
  confirmHeading: ["Confirm your claim", "Potwierdź zgłoszenie"],
  sentHeading: ["Check your email", "Sprawdź pocztę"],
  findHeading: ["Find my claim", "Znajdź moje zgłoszenie"],
  labelName: ["Your name", "Imię i nazwisko"],
  labelEmail: ["Email", "E-mail"],
  labelPostcode: ["Postcode", "Kod pocztowy"],
  labelModel: ["Model", "Model"],
  labelPurchase: ["Date of purchase", "Data zakupu"],
  labelQuantity: ["Quantity", "Ilość"],
  labelWhat: ["What happened", "Co się stało"],
  labelPhotos: ["Damage photos", "Zdjęcia uszkodzeń"],
  estimateRegion: ["Carriage estimate", "Szacunkowy koszt przesyłki"],
  estimateButton: ["Estimate carriage", "Oszacuj przesyłkę"],
  startButton: ["Start claim", "Wyślij zgłoszenie"],
  confirmButton: ["Confirm my claim", "Potwierdzam zgłoszenie"],
  labelReference: ["Claim reference", "Numer zgłoszenia"],
  findButton: ["Find claim", "Znajdź zgłoszenie"],
  slipRegion: ["Claim slip", "Karta zgłoszenia"],
  historyButton: ["Claim history", "Historia zgłoszenia"],
  fanRegion: ["Fitting fan", "Rozkład części"],
  fanSlider: ["Separate parts", "Rozsuń części"],
  fanUnavailable: ["Diagram unavailable — choose your part from the list", "Diagram niedostępny — wybierz część z listy"],
  fanList: ["Parts in booklet order", "Części w kolejności z instrukcji"],
  chooseModel: ["Choose a model", "Wybierz model"],
  fanEmpty: ["Choose a model and its fitting fan is drawn here.", "Wybierz model, a jego rozkład części pojawi się tutaj."],
  carriageHint: ["The carrier prices the post for this part and postcode.", "Przewoźnik wycenia przesyłkę tej części na ten kod pocztowy."],
  photosHint: ["Add 1 to 4 JPEG, PNG or WebP photos, up to 8 MB each.", "Dodaj od 1 do 4 zdjęć JPEG, PNG lub WebP, do 8 MB każde."],
  photosChosen: ["Chosen photos", "Wybrane zdjęcia"],
  sending: ["Sending your claim…", "Wysyłamy zgłoszenie…"],
  asking: ["Asking the carrier…", "Pytamy przewoźnika…"],
  confirming: ["Confirming…", "Potwierdzamy…"],
  looking: ["Looking up your claim…", "Szukamy zgłoszenia…"],
  alreadyConfirmed: ["This claim is already confirmed. Follow it through your share link.", "To zgłoszenie jest już potwierdzone. Śledź je przez swój link."],
  notYetRuled: ["Not yet ruled", "Jeszcze nie rozstrzygnięto"],
  inside: ["Inside aftercare", "W ramach opieki posprzedażnej"],
  outside: ["Outside aftercare", "Poza opieką posprzedażną"],
  nothingCharged: ["Nothing charged", "Bez opłat"],
  captionCarrier: ["carrier", "przewoźnik"],
  captionBilling: ["billing", "rozliczenia"],
  captionEdition: ["edition", "edycja"],
  quantityLine: ["Quantity", "Ilość"],
} as const satisfies Record<string, Pair>;

export type OwnerTextKey = keyof typeof OWNER_TEXT;

export const ownerText = (key: OwnerTextKey, lang: Lang): string => pick(OWNER_TEXT[key], lang);

export const sentText = (reference: string, lang: Lang): string =>
  lang === "pl-PL"
    ? `Wysłaliśmy e-mailem link do potwierdzenia zgłoszenia ${reference}. Otwórz go na dowolnym urządzeniu.`
    : `We've emailed a link to confirm claim ${reference}. Open it on any device.`;

export const lifetimeLine = (confirmBy: string, lang: Lang): string => {
  const time = instantTimeText(confirmBy);
  const date = instantDateText(confirmBy, lang);
  return lang === "pl-PL" ? `Link działa do ${time} dnia ${date} (czas brytyjski).` : `This link works until ${time} on ${date} (UK time).`;
};

export const shareHeading = (reference: string, lang: Lang): string => (lang === "pl-PL" ? `Zgłoszenie ${reference}` : `Claim ${reference}`);
export const partLine = (booklet: number, name: string, lang: Lang): string => (lang === "pl-PL" ? `Część ${booklet}: ${name}` : `Part ${booklet}: ${name}`);
export const partNumberLine = (partNumber: string, lang: Lang): string => (lang === "pl-PL" ? `Numer części ${partNumber}` : `Part number ${partNumber}`);
export const coverEndLine = (coverEndsAt: string, lang: Lang): string => {
  const time = instantTimeText(coverEndsAt);
  const date = instantDateText(coverEndsAt, lang);
  return lang === "pl-PL" ? `Ochrona do ${time} dnia ${date}` : `Cover until ${time} on ${date}`;
};
export const editionLine = (code: string, lang: Lang): string => (lang === "pl-PL" ? `Rozstrzygnięto wg edycji ${code}` : `Ruled by edition ${code}`);
export const revisionHeading = (revision: number, lang: Lang): string => (lang === "pl-PL" ? `Wycena nr ${revision}` : `Quote revision ${revision}`);
export const partAmountLine = (minor: number, lang: Lang): string => (lang === "pl-PL" ? `Część ${money(minor, lang)}` : `Part ${money(minor, lang)}`);
export const carriageLine = (band: string, minor: number, lang: Lang): string =>
  lang === "pl-PL" ? `Przesyłka, strefa ${band} ${money(minor, lang)}` : `Carriage, band ${band} ${money(minor, lang)}`;
export const totalLine = (minor: number, lang: Lang): string => (lang === "pl-PL" ? `Razem ${money(minor, lang)}` : `Total ${money(minor, lang)}`);
export const paidLine = (minor: number, lang: Lang): string => (lang === "pl-PL" ? `Zapłacono ${money(minor, lang)}` : `Paid ${money(minor, lang)}`);
export const refundedLine = (minor: number, lang: Lang): string => (lang === "pl-PL" ? `Zwrócono ${money(minor, lang)}` : `Refunded ${money(minor, lang)}`);
const sameDayLine = (ymd: string, lang: Lang): string =>
  lang === "pl-PL"
    ? `Wysyłka tego samego dnia roboczego: część wyjdzie z warsztatu ${dateText(ymd, lang)}`
    : `Same-working-day dispatch: leaves the workshop on ${dateText(ymd, lang)}`;
const laterLine = (ymd: string, lang: Lang): string =>
  lang === "pl-PL" ? `Część wyjdzie z warsztatu najpóźniej ${dateText(ymd, lang)}` : `Leaves the workshop by ${dateText(ymd, lang)}`;
export const promiseLine = (promise: { kind: "same_day" | "later"; date: string }, lang: Lang): string =>
  promise.kind === "same_day" ? sameDayLine(promise.date, lang) : laterLine(promise.date, lang);
export const historyLine = (state: ClaimState, at: string, lang: Lang): string => {
  const time = instantTimeText(at);
  const date = instantDateText(at, lang);
  return `${stateName(state, lang)}, ${time} ${lang === "pl-PL" ? "dnia" : "on"} ${date}`;
};
export const estimateShown = (band: string, minor: number, lang: Lang): string =>
  `${lang === "pl-PL" ? "Strefa" : "Band"} ${band} · ${money(minor, lang)}`;
export const voidRevisionLine = (revision: number, totalMinor: number): string => `Revision ${revision} (void): Total ${money(totalMinor, "en-GB")}`;

export const OPS_TEXT = {
  working: "Working…",
  identified: (code: string): string => `Part identified. Ruled by edition ${code}.`,
  quoted: (revision: number): string => `Quote revision ${revision} recorded in billing.`,
  payment: (amount: string): string => `Payment of ${amount} recorded in billing.`,
  declined: "Claim declined.",
  dispatched: "Dispatched. Dispatch note stored.",
  closed: "Claim closed.",
  withdrawn: "Share link withdrawn.",
  newLink: "New share link created.",
  erased: "Owner data erased.",
  waiting: (n: number): string => `Notices waiting to send: ${n}`,
  editionSaved: (code: string, ymd: string): string => `Edition ${code} saved. It rules claims confirmed from 00:00 on ${dateText(ymd, "en-GB")}.`,
  imported: (created: number, updated: number, unchanged: number, unmatched: number): string =>
    `Imported: ${created} new, ${updated} updated, ${unchanged} unchanged, ${unmatched} unmatched.`,
  decided: (n: number, inside: number, outside: number): string => `Decided claims: ${n} (inside ${inside}, outside ${outside})`,
} as const;
