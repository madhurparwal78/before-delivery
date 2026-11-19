export type Language = 'en' | 'pl' | 'ur';
export type DriverLanguage = 'en' | 'pl';

export const LANGUAGES: Language[] = ['en', 'pl', 'ur'];

export function isLanguage(value: unknown): value is Language {
  return value === 'en' || value === 'pl' || value === 'ur';
}

export type CustomerStringKey =
  | 'yourQuote'
  | 'quoteSent'
  | 'accepted'
  | 'deposit'
  | 'balance'
  | 'travel'
  | 'route'
  | 'out'
  | 'return'
  | 'party'
  | 'vehicles'
  | 'total'
  | 'depositDue'
  | 'validUntil'
  | 'payByTransfer'
  | 'accept'
  | 'acceptThisQuote'
  | 'yourFullName'
  | 'confirmAcceptance'
  | 'close'
  | 'nameDoesNotMatch'
  | 'quoteAccepted'
  | 'depositSent'
  | 'checkingPayment'
  | 'quoteEnded'
  | 'bookingCancelled'
  | 'downloadQuote'
  | 'language'
  | 'couldNotRefresh'
  | 'pageEnded'
  | 'pdfUnavailable'
  | 'fileStoreUnavailable'
  | 'working';

const CUSTOMER_STRINGS: Record<CustomerStringKey, Record<Language, string>> = {
  yourQuote: { en: 'Your quote <reference>', pl: 'Twoja wycena <reference>', ur: 'آپ کا کوٹیشن <reference>' },
  quoteSent: { en: 'Quote sent', pl: 'Wycena wysłana', ur: 'کوٹیشن بھیج دیا گیا' },
  accepted: { en: 'Accepted', pl: 'Zaakceptowana', ur: 'قبول کر لیا گیا' },
  deposit: { en: 'Deposit', pl: 'Zaliczka', ur: 'پیشگی رقم' },
  balance: { en: 'Balance', pl: 'Pozostała kwota', ur: 'بقایا رقم' },
  travel: { en: 'Travel', pl: 'Podróż', ur: 'سفر' },
  route: { en: 'Route', pl: 'Trasa', ur: 'راستہ' },
  out: { en: 'Out', pl: 'Wyjazd', ur: 'روانگی' },
  return: { en: 'Return', pl: 'Powrót', ur: 'واپسی' },
  party: { en: 'Party', pl: 'Grupa', ur: 'مسافر' },
  vehicles: { en: 'Vehicles', pl: 'Pojazdy', ur: 'گاڑیاں' },
  total: { en: 'Total', pl: 'Razem', ur: 'کل رقم' },
  depositDue: { en: 'Deposit due', pl: 'Zaliczka do zapłaty', ur: 'واجب الادا پیشگی رقم' },
  validUntil: { en: 'Valid until <date>', pl: 'Ważna do <date>', ur: '<date> تک کارآمد' },
  payByTransfer: {
    en: 'Pay by bank transfer quoting <reference>',
    pl: 'Zapłać przelewem, podając numer <reference>',
    ur: '<reference> کا حوالہ دے کر بینک ٹرانسفر سے ادائیگی کریں',
  },
  accept: { en: 'Accept', pl: 'Akceptuję', ur: 'قبول کریں' },
  acceptThisQuote: { en: 'Accept this quote', pl: 'Akceptacja wyceny', ur: 'یہ کوٹیشن قبول کریں' },
  yourFullName: { en: 'Your full name', pl: 'Imię i nazwisko', ur: 'آپ کا پورا نام' },
  confirmAcceptance: { en: 'Confirm acceptance', pl: 'Potwierdzam', ur: 'قبولیت کی تصدیق کریں' },
  close: { en: 'Close', pl: 'Zamknij', ur: 'بند کریں' },
  nameDoesNotMatch: {
    en: 'That name does not match this quote.',
    pl: 'To nazwisko nie zgadza się z tą wyceną.',
    ur: 'یہ نام اس کوٹیشن سے مطابقت نہیں رکھتا۔',
  },
  quoteAccepted: { en: 'Quote accepted.', pl: 'Wycena zaakceptowana.', ur: 'کوٹیشن قبول کر لیا گیا۔' },
  depositSent: { en: "I've sent the deposit", pl: 'Zaliczka wysłana', ur: 'میں نے پیشگی رقم بھیج دی ہے' },
  checkingPayment: {
    en: "We're checking your payment",
    pl: 'Sprawdzamy Twoją płatność',
    ur: 'ہم آپ کی ادائیگی کی جانچ کر رہے ہیں',
  },
  quoteEnded: {
    en: 'This quote ended on <date>. Ask us for a new one.',
    pl: 'Ta wycena wygasła <date>. Poproś nas o nową.',
    ur: 'یہ کوٹیشن <date> کو ختم ہو گیا۔ ہم سے نیا کوٹیشن مانگیں۔',
  },
  bookingCancelled: {
    en: 'This booking was cancelled.',
    pl: 'Ta rezerwacja została anulowana.',
    ur: 'یہ بکنگ منسوخ کر دی گئی۔',
  },
  downloadQuote: { en: 'Download quote', pl: 'Pobierz wycenę', ur: 'کوٹیشن ڈاؤن لوڈ کریں' },
  language: { en: 'Language', pl: 'Język', ur: 'زبان' },
  couldNotRefresh: {
    en: "Couldn't refresh. Trying again.",
    pl: 'Nie udało się odświeżyć. Próbujemy ponownie.',
    ur: 'تازہ نہیں ہو سکا۔ دوبارہ کوشش جاری ہے۔',
  },
  pageEnded: { en: 'This page has ended.', pl: 'Ta strona wygasła.', ur: 'یہ صفحہ ختم ہو چکا ہے۔' },
  pdfUnavailable: {
    en: 'The PDF service is unavailable right now. Nothing was saved.',
    pl: 'Usługa PDF jest teraz niedostępna. Niczego nie zapisano.',
    ur: 'پی ڈی ایف سروس اس وقت دستیاب نہیں۔ کچھ محفوظ نہیں ہوا۔',
  },
  fileStoreUnavailable: {
    en: 'The file store is unavailable right now. Nothing was saved.',
    pl: 'Magazyn plików jest teraz niedostępny. Niczego nie zapisano.',
    ur: 'فائل اسٹور اس وقت دستیاب نہیں۔ کچھ محفوظ نہیں ہوا۔',
  },
  working: { en: 'Working…', pl: 'Working…', ur: 'Working…' },
};

export function customerString(key: CustomerStringKey, language: Language): string {
  return CUSTOMER_STRINGS[key][language];
}

export type RunStringKey =
  | 'run'
  | 'stopOf'
  | 'arrived'
  | 'boarded'
  | 'left'
  | 'comfortStop'
  | 'backOnTheRoad'
  | 'runDetails'
  | 'close'
  | 'waitingToSend'
  | 'allSent'
  | 'waitingCharge'
  | 'flightTimesUnavailable'
  | 'language'
  | 'couldNotRefresh'
  | 'pageEnded'
  | 'working';

const RUN_STRINGS: Record<RunStringKey, Record<DriverLanguage, string>> = {
  run: { en: 'Run <number>', pl: 'Kurs <number>' },
  stopOf: { en: 'Stop <i> of <n>', pl: 'Przystanek <i> z <n>' },
  arrived: { en: 'Arrived', pl: 'Na miejscu' },
  boarded: { en: 'Boarded', pl: 'Wsiedli' },
  left: { en: 'Left', pl: 'Odjazd' },
  comfortStop: { en: 'Comfort stop', pl: 'Postój' },
  backOnTheRoad: { en: 'Back on the road', pl: 'W trasie' },
  runDetails: { en: 'Run details', pl: 'Szczegóły kursu' },
  close: { en: 'Close', pl: 'Zamknij' },
  waitingToSend: { en: '<n> waiting to send', pl: 'Do wysłania: <n>' },
  allSent: { en: 'All sent', pl: 'Wszystko wysłane' },
  waitingCharge: { en: 'Waiting charge <amount>', pl: 'Opłata za oczekiwanie <amount>' },
  flightTimesUnavailable: {
    en: 'Flight times unavailable. Waiting counts from the booked pick-up.',
    pl: 'Brak danych o locie. Oczekiwanie liczone od zamówionej godziny odbioru.',
  },
  language: { en: 'Language', pl: 'Język' },
  couldNotRefresh: { en: "Couldn't refresh. Trying again.", pl: 'Nie udało się odświeżyć. Próbujemy ponownie.' },
  pageEnded: { en: 'This page has ended.', pl: 'Ta strona wygasła.' },
  working: { en: 'Working…', pl: 'Working…' },
};

export function runString(key: RunStringKey, language: DriverLanguage): string {
  return RUN_STRINGS[key][language];
}

function polishForm(count: number, one: string, few: string, many: string): string {
  if (count === 1) return one;
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 12 && lastTwo <= 14) return many;
  if (last >= 2 && last <= 4) return few;
  return many;
}

export function peopleCount(count: number, language: Language): string {
  if (language === 'pl') return `${count} ${polishForm(count, 'osoba', 'osoby', 'osób')}`;
  if (language === 'ur') return `${count} ${count === 1 ? 'فرد' : 'افراد'}`;
  return `${count} ${count === 1 ? 'person' : 'people'}`;
}

export function vehicleCount(count: number, language: Language): string {
  if (language === 'pl') return `${count} ${polishForm(count, 'pojazd', 'pojazdy', 'pojazdów')}`;
  if (language === 'ur') return `${count} ${count === 1 ? 'گاڑی' : 'گاڑیاں'}`;
  return `${count} ${count === 1 ? 'vehicle' : 'vehicles'}`;
}

export function fill(template: string, values: Record<string, string>): string {
  let text = template;
  for (const [key, value] of Object.entries(values)) {
    text = text.split(`<${key}>`).join(value);
  }
  return text;
}
