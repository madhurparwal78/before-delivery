// The published strings of the customer page and the run sheet, character for character.
import { dotDate, longDate, slashDate, type LocalDate } from "./time.js";

export type Language = "en" | "pl" | "ur";

const TABLE = {
  en: {
    yourQuote: (r: string) => `Your quote ${r}`, quoteSent: "Quote sent", accepted: "Accepted", deposit: "Deposit", balance: "Balance", travel: "Travel", route: "Route", out: "Out", returnLabel: "Return", party: "Party", vehicles: "Vehicles", total: "Total", depositDue: "Deposit due",
    validUntil: (d: string) => `Valid until ${d}`, payBy: (r: string) => `Pay by bank transfer quoting ${r}`, accept: "Accept", acceptThis: "Accept this quote", fullName: "Your full name", confirm: "Confirm acceptance", close: "Close",
    nameMismatch: "That name does not match this quote.", quoteAccepted: "Quote accepted.", sentDeposit: "I've sent the deposit", checking: "We're checking your payment", ended: (d: string) => `This quote ended on ${d}. Ask us for a new one.`,
    cancelled: "This booking was cancelled.", download: "Download quote", language: "Language", refreshFailed: "Couldn't refresh. Trying again.", pageEnded: "This page has ended.",
    pdfDown: "The PDF service is unavailable right now. Nothing was saved.", storeDown: "The file store is unavailable right now. Nothing was saved.",
    people: (n: number) => `${n} ${n === 1 ? "person" : "people"}`, vehicleCount: (n: number) => `${n} ${n === 1 ? "vehicle" : "vehicles"}`,
  },
  pl: {
    yourQuote: (r: string) => `Twoja wycena ${r}`, quoteSent: "Wycena wysłana", accepted: "Zaakceptowana", deposit: "Zaliczka", balance: "Pozostała kwota", travel: "Podróż", route: "Trasa", out: "Wyjazd", returnLabel: "Powrót", party: "Grupa", vehicles: "Pojazdy", total: "Razem", depositDue: "Zaliczka do zapłaty",
    validUntil: (d: string) => `Ważna do ${d}`, payBy: (r: string) => `Zapłać przelewem, podając numer ${r}`, accept: "Akceptuję", acceptThis: "Akceptacja wyceny", fullName: "Imię i nazwisko", confirm: "Potwierdzam", close: "Zamknij",
    nameMismatch: "To nazwisko nie zgadza się z tą wyceną.", quoteAccepted: "Wycena zaakceptowana.", sentDeposit: "Zaliczka wysłana", checking: "Sprawdzamy Twoją płatność", ended: (d: string) => `Ta wycena wygasła ${d}. Poproś nas o nową.`,
    cancelled: "Ta rezerwacja została anulowana.", download: "Pobierz wycenę", language: "Język", refreshFailed: "Nie udało się odświeżyć. Próbujemy ponownie.", pageEnded: "Ta strona wygasła.",
    pdfDown: "Usługa PDF jest teraz niedostępna. Niczego nie zapisano.", storeDown: "Magazyn plików jest teraz niedostępny. Niczego nie zapisano.",
    people: (n: number) => `${n} ${polishPlural(n, "osoba", "osoby", "osób")}`, vehicleCount: (n: number) => `${n} ${polishPlural(n, "pojazd", "pojazdy", "pojazdów")}`,
  },
  ur: {
    yourQuote: (r: string) => `آپ کا کوٹیشن ${r}`, quoteSent: "کوٹیشن بھیج دیا گیا", accepted: "قبول کر لیا گیا", deposit: "پیشگی رقم", balance: "بقایا رقم", travel: "سفر", route: "راستہ", out: "روانگی", returnLabel: "واپسی", party: "مسافر", vehicles: "گاڑیاں", total: "کل رقم", depositDue: "واجب الادا پیشگی رقم",
    validUntil: (d: string) => `${d} تک کارآمد`, payBy: (r: string) => `${r} کا حوالہ دے کر بینک ٹرانسفر سے ادائیگی کریں`, accept: "قبول کریں", acceptThis: "یہ کوٹیشن قبول کریں", fullName: "آپ کا پورا نام", confirm: "قبولیت کی تصدیق کریں", close: "بند کریں",
    nameMismatch: "یہ نام اس کوٹیشن سے مطابقت نہیں رکھتا۔", quoteAccepted: "کوٹیشن قبول کر لیا گیا۔", sentDeposit: "میں نے پیشگی رقم بھیج دی ہے", checking: "ہم آپ کی ادائیگی کی جانچ کر رہے ہیں", ended: (d: string) => `یہ کوٹیشن ${d} کو ختم ہو گیا۔ ہم سے نیا کوٹیشن مانگیں۔`,
    cancelled: "یہ بکنگ منسوخ کر دی گئی۔", download: "کوٹیشن ڈاؤن لوڈ کریں", language: "زبان", refreshFailed: "تازہ نہیں ہو سکا۔ دوبارہ کوشش جاری ہے۔", pageEnded: "یہ صفحہ ختم ہو چکا ہے۔",
    pdfDown: "پی ڈی ایف سروس اس وقت دستیاب نہیں۔ کچھ محفوظ نہیں ہوا۔", storeDown: "فائل اسٹور اس وقت دستیاب نہیں۔ کچھ محفوظ نہیں ہوا۔",
    people: (n: number) => `${n} ${n === 1 ? "فرد" : "افراد"}`, vehicleCount: (n: number) => `${n} ${n === 1 ? "گاڑی" : "گاڑیاں"}`,
  },
};
function polishPlural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  const tens = n % 100;
  const units = n % 10;
  return units >= 2 && units <= 4 && !(tens >= 12 && tens <= 14) ? few : many;
}
export const copyFor = (language: Language): typeof TABLE.en => TABLE[language];
export const languageOf = (value: string | null | undefined): Language | null => (value === "en" || value === "pl" || value === "ur" ? value : null);
export const dateIn = (language: Language, date: LocalDate): string =>
  language === "pl" ? dotDate(date) : language === "ur" ? slashDate(date) : longDate(date);

const SHEET = {
  en: {
    run: (n: number) => `Run ${n}`, stop: (i: number, n: number) => `Stop ${i} of ${n}`, arrived: "Arrived", boarded: "Boarded", left: "Left", comfortStop: "Comfort stop", backOnTheRoad: "Back on the road", details: "Run details", close: "Close",
    waiting: (n: number) => `${n} waiting to send`, allSent: "All sent", charge: (a: string) => `Waiting charge ${a}`, flight: "Flight times unavailable. Waiting counts from the booked pick-up.", language: "Language", refreshFailed: "Couldn't refresh. Trying again.", pageEnded: "This page has ended.", recorded: (p: string) => `${p} recorded.`,
  },
  pl: {
    run: (n: number) => `Kurs ${n}`, stop: (i: number, n: number) => `Przystanek ${i} z ${n}`, arrived: "Na miejscu", boarded: "Wsiedli", left: "Odjazd", comfortStop: "Postój", backOnTheRoad: "W trasie", details: "Szczegóły kursu", close: "Zamknij",
    waiting: (n: number) => `Do wysłania: ${n}`, allSent: "Wszystko wysłane", charge: (a: string) => `Opłata za oczekiwanie ${a}`, flight: "Brak danych o locie. Oczekiwanie liczone od zamówionej godziny odbioru.", language: "Język", refreshFailed: "Nie udało się odświeżyć. Próbujemy ponownie.", pageEnded: "Ta strona wygasła.", recorded: (p: string) => `Zapisano: ${p}.`,
  },
};
export type SheetLanguage = "en" | "pl";
export const sheetCopy = (language: SheetLanguage): typeof SHEET.en => SHEET[language];
