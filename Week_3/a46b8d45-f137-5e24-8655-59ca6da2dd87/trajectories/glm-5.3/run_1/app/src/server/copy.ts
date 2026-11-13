// Owner copy, published character for character in English and Polish.
import type { Language } from './format.js';

export interface OwnerCopy {
  code: string;
  en: string;
  pl: string;
}

const OWNER_REFUSALS: Record<string, OwnerCopy> = {
  link_lapsed: {
    code: 'link_lapsed',
    en: 'This confirmation link has lapsed. Start your claim again to get a new one.',
    pl: 'Ten link potwierdzający wygasł. Rozpocznij zgłoszenie ponownie, aby otrzymać nowy.',
  },
  link_used: {
    code: 'link_used',
    en: 'This confirmation link has already been used.',
    pl: 'Ten link potwierdzający został już użyty.',
  },
  link_unknown: {
    code: 'link_unknown',
    en: "We couldn't find that confirmation link.",
    pl: 'Nie znaleźliśmy tego linku potwierdzającego.',
  },
  claim_unknown: {
    code: 'claim_unknown',
    en: "We couldn't find that claim.",
    pl: 'Nie znaleźliśmy tego zgłoszenia.',
  },
  not_a_photo: {
    code: 'not_a_photo',
    en: "The file {file} isn't a JPEG, PNG or WebP photo.",
    pl: 'Plik {file} nie jest zdjęciem JPEG, PNG ani WebP.',
  },
  too_large: {
    code: 'too_large',
    en: 'The file {file} is larger than 8 MB.',
    pl: 'Plik {file} jest większy niż 8 MB.',
  },
  photo_count: {
    code: 'photo_count',
    en: 'Add between 1 and 4 photos.',
    pl: 'Dodaj od 1 do 4 zdjęć.',
  },
  request_too_large: {
    code: 'request_too_large',
    en: 'Those photos are too large to send together.',
    pl: 'Te zdjęcia są razem za duże do wysłania.',
  },
  carrier_unavailable: {
    code: 'carrier_unavailable',
    en: "The carrier isn't answering right now. Try the estimate again later.",
    pl: 'Przewoźnik nie odpowiada w tej chwili. Spróbuj ponownie później.',
  },
  carrier_timeout: {
    code: 'carrier_timeout',
    en: 'The carrier is taking too long to answer. Try the estimate again in a minute.',
    pl: 'Przewoźnik zbyt długo nie odpowiada. Spróbuj ponownie za minutę.',
  },
  carrier_malformed: {
    code: 'carrier_malformed',
    en: "The carrier sent an answer we can't read. Try the estimate again later.",
    pl: 'Przewoźnik przesłał odpowiedź, której nie możemy odczytać. Spróbuj ponownie później.',
  },
  storage_unavailable: {
    code: 'storage_unavailable',
    en: "We can't store photos right now, so nothing was saved. Please try again in a few minutes.",
    pl: 'Nie możemy teraz zapisać zdjęć, więc nic nie zostało zapisane. Spróbuj ponownie za kilka minut.',
  },
  mail_unavailable: {
    code: 'mail_unavailable',
    en: "We can't send email right now, so nothing was saved. Please try again in a few minutes.",
    pl: 'Nie możemy teraz wysłać e-maila, więc nic nie zostało zapisane. Spróbuj ponownie za kilka minut.',
  },
  database_unavailable: {
    code: 'database_unavailable',
    en: "We can't reach our claim records right now, so nothing was saved. Please try again in a few minutes.",
    pl: 'Nie możemy teraz połączyć się z rejestrem zgłoszeń, więc nic nie zostało zapisane. Spróbuj ponownie za kilka minut.',
  },
  part_withdrawn: {
    code: 'part_withdrawn',
    en: 'Part {number} is no longer available to claim.',
    pl: 'Część {number} nie jest już dostępna do zgłoszenia.',
  },
  not_found: {
    code: 'not_found',
    en: "We couldn't find a claim with that reference and email.",
    pl: 'Nie znaleźliśmy zgłoszenia o tym numerze i adresie e-mail.',
  },
  reference_locked: {
    code: 'reference_locked',
    en: 'This reference is locked after too many wrong tries. Try again later.',
    pl: 'Ten numer zgłoszenia jest zablokowany po zbyt wielu błędnych próbach. Spróbuj ponownie później.',
  },
  wrong_state: {
    code: 'wrong_state',
    en: "This claim hasn't been confirmed yet. Use the link in the email we sent.",
    pl: 'To zgłoszenie nie zostało jeszcze potwierdzone. Użyj linku z wysłanego e-maila.',
  },
  claim_closed: {
    code: 'claim_closed',
    en: "This claim is closed, so its link no longer works.",
    pl: 'To zgłoszenie jest zamknięte, więc link już nie działa.',
  },
  link_withdrawn: {
    code: 'link_withdrawn',
    en: 'This link has been withdrawn. Ask Holmgarth Aftercare for a new one.',
    pl: 'Ten link został wycofany. Poproś Holmgarth Aftercare o nowy.',
  },
  share_unknown: {
    code: 'share_unknown',
    en: "We couldn't find that link.",
    pl: 'Nie znaleźliśmy tego linku.',
  },
  rate_limited: {
    code: 'rate_limited',
    en: 'Too many requests. Please wait a moment.',
    pl: 'Zbyt wiele zapytań. Poczekaj chwilę.',
  },
};

export function ownerRefusal(code: string, lang: Language, params?: { file?: string; number?: string }): string {
  const copy = OWNER_REFUSALS[code];
  if (copy === undefined) return code;
  const raw = lang === 'pl-PL' ? copy.pl : copy.en;
  return raw
    .replace('{file}', params?.file ?? '')
    .replace('{number}', params?.number ?? '');
}

export function ownerRefusalForApi(code: string, params?: { file?: string; number?: string }): string {
  return ownerRefusal(code, 'en-GB', params);
}

export const FIELD_ERRORS: Record<string, OwnerCopy> = {
  name: { code: 'name', en: 'Enter your name.', pl: 'Podaj imię i nazwisko.' },
  email: { code: 'email', en: 'Enter a valid email address.', pl: 'Podaj poprawny adres e-mail.' },
  postcode: { code: 'postcode', en: 'Enter a UK postcode.', pl: 'Podaj brytyjski kod pocztowy.' },
  model_or_part: { code: 'model_or_part', en: 'Choose the broken or missing part.', pl: 'Wybierz uszkodzoną lub brakującą część.' },
  quantity: { code: 'quantity', en: 'Choose between 1 and 20.', pl: 'Wybierz od 1 do 20.' },
  purchase_date: {
    code: 'purchase_date',
    en: 'Enter the date you bought it, not in the future.',
    pl: 'Podaj datę zakupu, nie późniejszą niż dziś.',
  },
  description: {
    code: 'description',
    en: 'Keep the description under 1,000 characters.',
    pl: 'Opis może mieć najwyżej 1000 znaków.',
  },
};

export const STATE_LABELS: Record<string, OwnerCopy> = {
  started: { code: 'started', en: 'Started', pl: 'Rozpoczęte' },
  confirmed: { code: 'confirmed', en: 'Confirmed', pl: 'Potwierdzone' },
  identified: { code: 'identified', en: 'Identified', pl: 'Zidentyfikowane' },
  quoted: { code: 'quoted', en: 'Quoted', pl: 'Wycenione' },
  declined: { code: 'declined', en: 'Declined', pl: 'Odrzucone' },
  dispatched: { code: 'dispatched', en: 'Dispatched', pl: 'Wysłane' },
  closed: { code: 'closed', en: 'Closed', pl: 'Zamknięte' },
  erased: { code: 'erased', en: 'Erased', pl: 'Usunięte' },
};

export function stateLabel(state: string, lang: Language): string {
  const copy = STATE_LABELS[state];
  if (copy === undefined) return state;
  return lang === 'pl-PL' ? copy.pl : copy.en;
}

export interface SlipLine {
  part: string;
  partNumber: string;
  notYetRuled: string;
  inside: string;
  outside: string;
  coverEnd: string;
  edition: string;
  currentRevision: string;
  partLine: string;
  carriageLine: string;
  total: string;
  sameDayPromise: string;
  laterPromise: string;
  paid: string;
  declineNothing: string;
  declineRefunded: string;
  historyEntry: string;
  voidRevision: string;
  claimHistory: string;
}

export function slipLines(lang: Language): SlipLine {
  if (lang === 'pl-PL') {
    return {
      part: 'Część {number}: {name}',
      partNumber: 'Numer części {partNumber}',
      notYetRuled: 'Jeszcze nie rozstrzygnięto',
      inside: 'W ramach opieki posprzedażnej',
      outside: 'Poza opieką posprzedażną',
      coverEnd: 'Ochrona do {time} dnia {date}',
      edition: 'Rozstrzygnięto wg edycji {code}',
      currentRevision: 'Wycena nr {revision}',
      partLine: 'Część {amount}',
      carriageLine: 'Przesyłka, strefa {band} {amount}',
      total: 'Razem {amount}',
      sameDayPromise: 'Wysyłka tego samego dnia roboczego: część wyjdzie z warsztatu {date}',
      laterPromise: 'Część wyjdzie z warsztatu najpóźniej {date}',
      paid: 'Zapłacono {amount}',
      declineNothing: 'Bez opłat',
      declineRefunded: 'Zwrócono {amount}',
      historyEntry: '{state}, {time} dnia {date}',
      voidRevision: 'Revision {revision} (void): Total {amount}',
      claimHistory: 'Historia zgłoszenia',
    };
  }
  return {
    part: 'Part {number}: {name}',
    partNumber: 'Part number {partNumber}',
    notYetRuled: 'Not yet ruled',
    inside: 'Inside aftercare',
    outside: 'Outside aftercare',
    coverEnd: 'Cover until {time} on {date}',
    edition: 'Ruled by edition {code}',
    currentRevision: 'Quote revision {revision}',
    partLine: 'Part {amount}',
    carriageLine: 'Carriage, band {band} {amount}',
    total: 'Total {amount}',
    sameDayPromise: 'Same-working-day dispatch: leaves the workshop on {date}',
    laterPromise: 'Leaves the workshop by {date}',
    paid: 'Paid {amount}',
    declineNothing: 'Nothing charged',
    declineRefunded: 'Refunded {amount}',
    historyEntry: '{state}, {time} on {date}',
    voidRevision: 'Revision {revision} (void): Total {amount}',
    claimHistory: 'Claim history',
  };
}

export function fill(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => params[key] ?? '');
}
