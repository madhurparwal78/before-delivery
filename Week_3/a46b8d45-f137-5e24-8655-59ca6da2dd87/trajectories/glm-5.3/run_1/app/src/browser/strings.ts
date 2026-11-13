// Browser i18n: every owner string, character for character, in both languages.
export type Language = 'en-GB' | 'pl-PL';

export interface Strings {
  skipLink: string;
  homeTagline: string;
  startClaim: string;
  findClaim: string;
  claimHeading: string;
  yourName: string;
  email: string;
  postcode: string;
  model: string;
  dateOfPurchase: string;
  quantity: string;
  whatHappened: string;
  damagePhotos: string;
  claimRef: string;
  findHeading: string;
  findButton: string;
  sendingClaim: string;
  askingCarrier: string;
  estimateCarriage: string;
  startButton: string;
  confirmHeading: string;
  confirmButton: string;
  confirming: string;
  findingClaim: string;
  sentHeading: string;
  fanHeading: string;
  separateParts: string;
  claimSlip: string;
  claimHistory: string;
  diagramUnavailable: string;
  partsList: string;
  languageGroup: string;
  english: string;
  polski: string;
  partLineLabel: string;
  chosenPart: string;
  stateStarted: string;
  stateConfirmed: string;
  stateIdentified: string;
  stateQuoted: string;
  stateDeclined: string;
  stateDispatched: string;
  stateClosed: string;
  stateErased: string;
  partLabel: string;
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
  quantityLabel: string;
  purchaseDateLabel: string;
  carrierSource: string;
  billingSource: string;
  editionSource: string;
}

export const STRINGS: Record<Language, Strings> = {
  'en-GB': {
    skipLink: 'Skip to claim',
    homeTagline: 'Replacement numbered parts for flat-pack furniture, sent by post.',
    startClaim: 'Start a claim',
    findClaim: 'Find my claim',
    claimHeading: 'Claim a part',
    yourName: 'Your name',
    email: 'Email',
    postcode: 'Postcode',
    model: 'Model',
    dateOfPurchase: 'Date of purchase',
    quantity: 'Quantity',
    whatHappened: 'What happened',
    damagePhotos: 'Damage photos',
    claimRef: 'Claim reference',
    findHeading: 'Find my claim',
    findButton: 'Find claim',
    sendingClaim: 'Sending your claim…',
    askingCarrier: 'Asking the carrier…',
    estimateCarriage: 'Estimate carriage',
    startButton: 'Start claim',
    confirmHeading: 'Confirm your claim',
    confirmButton: 'Confirm my claim',
    confirming: 'Confirming…',
    findingClaim: 'Looking up your claim…',
    sentHeading: 'Check your email',
    fanHeading: 'Fitting fan',
    separateParts: 'Separate parts',
    claimSlip: 'Claim slip',
    claimHistory: 'Claim history',
    diagramUnavailable: 'Diagram unavailable — choose your part from the list',
    partsList: 'Parts in booklet order',
    languageGroup: 'Language · Język',
    english: 'English',
    polski: 'Polski',
    partLineLabel: 'Claimed part',
    chosenPart: 'Part',
    stateStarted: 'Started',
    stateConfirmed: 'Confirmed',
    stateIdentified: 'Identified',
    stateQuoted: 'Quoted',
    stateDeclined: 'Declined',
    stateDispatched: 'Dispatched',
    stateClosed: 'Closed',
    stateErased: 'Erased',
    partLabel: 'Part',
    partNumber: 'Part number',
    notYetRuled: 'Not yet ruled',
    inside: 'Inside aftercare',
    outside: 'Outside aftercare',
    coverEnd: 'Cover until',
    edition: 'Ruled by edition',
    currentRevision: 'Quote revision',
    partLine: 'Part',
    carriageLine: 'Carriage, band',
    total: 'Total',
    sameDayPromise: 'Same-working-day dispatch: leaves the workshop on',
    laterPromise: 'Leaves the workshop by',
    paid: 'Paid',
    declineNothing: 'Nothing charged',
    declineRefunded: 'Refunded',
    historyEntry: '',
    quantityLabel: 'Quantity',
    purchaseDateLabel: 'Date of purchase',
    carrierSource: 'carrier',
    billingSource: 'billing',
    editionSource: 'edition',
  },
  'pl-PL': {
    skipLink: 'Przejdź do zgłoszenia',
    homeTagline: 'Zamienniki numerowanych części do mebli składanych, wysyłane pocztą.',
    startClaim: 'Zgłoś część',
    findClaim: 'Znajdź moje zgłoszenie',
    claimHeading: 'Zgłoś część',
    yourName: 'Imię i nazwisko',
    email: 'E-mail',
    postcode: 'Kod pocztowy',
    model: 'Model',
    dateOfPurchase: 'Data zakupu',
    quantity: 'Ilość',
    whatHappened: 'Co się stało',
    damagePhotos: 'Zdjęcia uszkodzeń',
    claimRef: 'Numer zgłoszenia',
    findHeading: 'Znajdź moje zgłoszenie',
    findButton: 'Znajdź zgłoszenie',
    sendingClaim: 'Wysyłamy zgłoszenie…',
    askingCarrier: 'Pytamy przewoźnika…',
    estimateCarriage: 'Oszacuj przesyłkę',
    startButton: 'Wyślij zgłoszenie',
    confirmHeading: 'Potwierdź zgłoszenie',
    confirmButton: 'Potwierdzam zgłoszenie',
    confirming: 'Potwierdzamy…',
    findingClaim: 'Szukamy zgłoszenia…',
    sentHeading: 'Sprawdź pocztę',
    fanHeading: 'Rozkład części',
    separateParts: 'Rozsuń części',
    claimSlip: 'Karta zgłoszenia',
    claimHistory: 'Historia zgłoszenia',
    diagramUnavailable: 'Diagram niedostępny — wybierz część z listy',
    partsList: 'Części w kolejności z instrukcji',
    languageGroup: 'Language · Język',
    english: 'English',
    polski: 'Polski',
    partLineLabel: 'Zgłoszona część',
    chosenPart: 'Część',
    stateStarted: 'Rozpoczęte',
    stateConfirmed: 'Potwierdzone',
    stateIdentified: 'Zidentyfikowane',
    stateQuoted: 'Wycenione',
    stateDeclined: 'Odrzucone',
    stateDispatched: 'Wysłane',
    stateClosed: 'Zamknięte',
    stateErased: 'Usunięte',
    partLabel: 'Część',
    partNumber: 'Numer części',
    notYetRuled: 'Jeszcze nie rozstrzygnięto',
    inside: 'W ramach opieki posprzedażnej',
    outside: 'Poza opieką posprzedażną',
    coverEnd: 'Ochrona do',
    edition: 'Rozstrzygnięto wg edycji',
    currentRevision: 'Wycena nr',
    partLine: 'Część',
    carriageLine: 'Przesyłka, strefa',
    total: 'Razem',
    sameDayPromise: 'Wysyłka tego samego dnia roboczego: część wyjdzie z warsztatu',
    laterPromise: 'Część wyjdzie z warsztatu najpóźniej',
    paid: 'Zapłacono',
    declineNothing: 'Bez opłat',
    declineRefunded: 'Zwrócono',
    historyEntry: '',
    quantityLabel: 'Ilość',
    purchaseDateLabel: 'Data zakupu',
    carrierSource: 'przewoźnik',
    billingSource: 'rozliczenia',
    editionSource: 'edycja',
  },
};

export const OWNER_REFUSALS: Record<string, Record<Language, string>> = {
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
    'en-GB': "The file {file} isn't a JPEG, PNG or WebP photo.",
    'pl-PL': 'Plik {file} nie jest zdjęciem JPEG, PNG ani WebP.',
  },
  too_large: {
    'en-GB': 'The file {file} is larger than 8 MB.',
    'pl-PL': 'Plik {file} jest większy niż 8 MB.',
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
    'pl-PL': 'Nie możemy teraz połączyć się z rejestrem zgłoszeń, więc nic nie zostało zapisane. Spróbuj ponownie za kilka minut.',
  },
  part_withdrawn: {
    'en-GB': 'Part {number} is no longer available to claim.',
    'pl-PL': 'Część {number} nie jest już dostępna do zgłoszenia.',
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
    'en-GB': "This claim is closed, so its link no longer works.",
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
};

export const FIELD_ERRORS: Record<string, Record<Language, string>> = {
  name: {
    'en-GB': 'Enter your name.',
    'pl-PL': 'Podaj imię i nazwisko.',
  },
  email: {
    'en-GB': 'Enter a valid email address.',
    'pl-PL': 'Podaj poprawny adres e-mail.',
  },
  postcode: {
    'en-GB': 'Enter a UK postcode.',
    'pl-PL': 'Podaj brytyjski kod pocztowy.',
  },
  model: {
    'en-GB': 'Choose the broken or missing part.',
    'pl-PL': 'Wybierz uszkodzoną lub brakującą część.',
  },
  booklet_number: {
    'en-GB': 'Choose the broken or missing part.',
    'pl-PL': 'Wybierz uszkodzoną lub brakującą część.',
  },
  quantity: {
    'en-GB': 'Choose between 1 and 20.',
    'pl-PL': 'Wybierz od 1 do 20.',
  },
  purchase_date: {
    'en-GB': 'Enter the date you bought it, not in the future.',
    'pl-PL': 'Podaj datę zakupu, nie późniejszą niż dziś.',
  },
  description: {
    'en-GB': 'Keep the description under 1,000 characters.',
    'pl-PL': 'Opis może mieć najwyżej 1000 znaków.',
  },
};

/** Money in the language's published format. */
export function formatMoney(minor: number, lang: Language): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100);
  const pennies = String(abs % 100).padStart(2, '0');
  const wholeStr = String(whole);
  if (lang === 'pl-PL') {
    let grouped = wholeStr;
    if (wholeStr.length >= 5) {
      const groups: string[] = [];
      const head = wholeStr.length % 3;
      let rest = wholeStr;
      if (head > 0) {
        groups.push(rest.slice(0, head));
        rest = rest.slice(head);
      }
      while (rest.length > 0) {
        groups.push(rest.slice(0, 3));
        rest = rest.slice(3);
      }
      grouped = groups.join('\u00a0');
    }
    return `${sign}${grouped},${pennies}\u00a0£`;
  }
  const groups: string[] = [];
  let rest = wholeStr;
  while (rest.length > 3) {
    groups.unshift(rest.slice(-3));
    rest = rest.slice(0, -3);
  }
  groups.unshift(rest);
  return `${sign}£${groups.join(',')}.${pennies}`;
}

const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const PL_MONTHS = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca',
  'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];

/** A Europe/London date shown as the server decided it. The browser renders
 * only what the server returned; it never consults its own clock. */
export function formatDate(date: string, lang: Language): string {
  const parts = date.split('-');
  const y = parts[0] ?? '0000';
  const m = Number(parts[1] ?? '1');
  const d = parts[2] ?? '01';
  if (lang === 'pl-PL') return `${d} ${PL_MONTHS[m - 1]} ${y}`;
  return `${d} ${EN_MONTHS[m - 1]} ${y}`;
}

/** History-entry state names, in the chosen language. */
export function stateLabel(state: string, lang: Language): string {
  const labels: Record<string, Record<Language, string>> = {
    started: { 'en-GB': 'Started', 'pl-PL': 'Rozpoczęte' },
    confirmed: { 'en-GB': 'Confirmed', 'pl-PL': 'Potwierdzone' },
    identified: { 'en-GB': 'Identified', 'pl-PL': 'Zidentyfikowane' },
    quoted: { 'en-GB': 'Quoted', 'pl-PL': 'Wycenione' },
    declined: { 'en-GB': 'Declined', 'pl-PL': 'Odrzucone' },
    dispatched: { 'en-GB': 'Dispatched', 'pl-PL': 'Wysłane' },
    closed: { 'en-GB': 'Closed', 'pl-PL': 'Zamknięte' },
    erased: { 'en-GB': 'Erased', 'pl-PL': 'Usunięte' },
  };
  return (labels[state] ?? { 'en-GB': state, 'pl-PL': state })[lang];
}
