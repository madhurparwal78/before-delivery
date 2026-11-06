// The published copy and reference values, kept as data in one place. The
// four private-page languages live together, and no sentence is assembled
// from translated fragments beyond its printed placeholders.

export const APP_NAME = "Clapstick";
export const ARTIST_NAME = "Noor Bakker Boards";
export const MAIL_ADDRESS = "desk@noorbakkerboards.example";

export type Language = "en" | "nl" | "fr" | "ar";
export const LANGUAGES: Language[] = ["en", "nl", "fr", "ar"];
export const RTL_LANGUAGES: Language[] = ["ar"];

export function isLanguage(v: string): v is Language {
  return (LANGUAGES as string[]).includes(v);
}

export type Place = "netherlands" | "ontario" | "newYork" | "dubai";
export const PLACES: Place[] = ["netherlands", "ontario", "newYork", "dubai"];
export const PLACE_LABEL: Record<Place, string> = {
  netherlands: "Netherlands",
  ontario: "Ontario",
  newYork: "New York",
  dubai: "Dubai",
};
export const PLACE_TAX_PERCENT: Record<Place, bigint | null> = {
  netherlands: 21n,
  ontario: 13n,
  newYork: null,
  dubai: null,
};

export type Town = "amsterdam" | "newYork" | "toronto" | "dubai";
export const TOWNS: Town[] = ["amsterdam", "newYork", "toronto", "dubai"];
export const TOWN_LABEL: Record<Town, string> = {
  amsterdam: "Amsterdam",
  newYork: "New York",
  toronto: "Toronto",
  dubai: "Dubai",
};

export type Aspect = "16:9" | "1:1" | "9:16";
export const ASPECTS: Aspect[] = ["16:9", "1:1", "9:16"];
export function isAspect(v: string): v is Aspect {
  return (ASPECTS as string[]).includes(v);
}
export const ASPECT_RATIO: Record<Aspect, [number, number]> = {
  "16:9": [16, 9],
  "1:1": [1, 1],
  "9:16": [9, 16],
};

export const TARGET_SECONDS = [6, 15, 30, 60] as const;
export type TargetSeconds = (typeof TARGET_SECONDS)[number];
export function isTargetSeconds(v: number): v is TargetSeconds {
  return (TARGET_SECONDS as readonly number[]).includes(v);
}
export function targetLabel(seconds: number): string {
  return `:${seconds.toString().padStart(2, "0")}`;
}

export type JobState = "draft" | "inReview" | "signedOff" | "delivered" | "archived";
export const JOB_STATES: JobState[] = ["draft", "inReview", "signedOff", "delivered", "archived"];
export const JOB_STATE_LABEL: Record<JobState, string> = {
  draft: "Draft",
  inReview: "In review",
  signedOff: "Signed off",
  delivered: "Delivered",
  archived: "Archived",
};

export type NoteState = "open" | "done" | "wontDo";
export const NOTE_STATES: NoteState[] = ["open", "done", "wontDo"];
export const NOTE_STATE_LABEL: Record<NoteState, string> = {
  open: "Open",
  done: "Done",
  wontDo: "Won't do",
};

export type ClientState = "active" | "closing" | "erasing" | "erased";
export const CLIENT_STATE_LABEL: Record<ClientState, string> = {
  active: "Active",
  closing: "Closing",
  erasing: "Erasing",
  erased: "Erased",
};

export type RenderState = "queued" | "running" | "done" | "failed" | "ready" | "outdated";
export const RENDER_STATE_LABEL: Record<RenderState, string> = {
  queued: "Queued",
  running: "Running",
  done: "Done",
  failed: "Failed",
  ready: "Ready",
  outdated: "Outdated",
};

export type PackageState = "making" | "ready";
export type LetterState = "draft" | "sent" | "accepted";
export type LicenceMarket = "NL" | "US" | "CA" | "AE";
export const LICENCE_MARKETS: LicenceMarket[] = ["NL", "US", "CA", "AE"];
export function isLicenceMarket(v: string): v is LicenceMarket {
  return (LICENCE_MARKETS as string[]).includes(v);
}
export const MARKET_TOWN: Record<LicenceMarket, Town> = {
  NL: "amsterdam",
  US: "newYork",
  CA: "toronto",
  AE: "dubai",
};
export const MINUTES_CHOICES = [30, 60] as const;

// Always-on feedback copy.
export const COPY = {
  sessionEnded: "Your session ended. Sign in again to keep going — what you typed is still here.",
  refreshFailed: "Couldn't refresh. Trying again.",
  wrongSignIn: "That email and password don't match.",
  typeAName: "Type a name.",
  typeAnEmail: "Type a mail address such as name@example.test.",
  passwordRule: "A password has at least 10 characters.",
  typeADate: "Type a date such as 2027-03-15.",
  typeATime: "Type a time such as 09:00.",
  typeATitle: "Type a title.",
  working: "Working…",
} as const;

// Artist action copy, with placeholders filled by the caller.
export const ARTIST_COPY = {
  passwordChanged: "Password changed.",
  currentPasswordWrong: "That current password doesn't match.",
  clientAdded: "Client added.",
  clientSaved: "Client saved.",
  clientDeleted: "Client deleted.",
  clientHasJobs: "A client with jobs has to be closed instead.",
  producerAdded: "Producer added.",
  producerSaved: "Producer saved.",
  closing: (name: string, date: string) => `Closing ${name}. You can bring it back until ${date}.`,
  backAgain: (name: string) => `${name} is back.`,
  closingNoChange: "This client is closing and can't change.",
  waitPassed: "The time to bring this client back has passed.",
  notClosing: "This client is not closing.",
  jobAdded: "Job added.",
  jobSaved: "Job saved.",
  jobDuplicated: "Job duplicated.",
  jobArchived: (title: string) => `${title} archived.`,
  adIdEnd: "That Ad-ID should end in H or D.",
  adIdShape: "An Ad-ID has four letters, then seven letters or digits, then H or D.",
  jobArchivedRefusal: "This job is archived.",
  searchResults: (count: number) => (count === 1 ? "1 result." : `${count} results.`),
  searchNone: "No results.",
  scriptHeader: "This file needs the header row shot,visual,audio,seconds.",
  scriptNotUtf8: "This file is not UTF-8 text.",
  scriptRowSeconds: (row: number) => `Row ${row}: seconds should be a number such as 1.5.`,
  scriptRowShot: (row: number) => `Row ${row}: shot is empty.`,
  scriptRowDuplicate: (row: number, shot: string, other: number) =>
    `Row ${row}: shot ${shot} is already in row ${other}.`,
  scriptSaved: (created: number, changed: number) =>
    `Script saved: ${created} new, ${changed} changed.`,
  scriptPreview: (newCount: number, matched: number, refused: number) =>
    `Preview ready: ${newCount} new, ${matched} matched, ${refused} refused.`,
  uploadStored: (name: string) => `${name}: Stored.`,
  uploadNotImage: "This file is not a PNG or JPEG.",
  uploadTooBig: "This file is over 8,000,000 bytes.",
  uploadAspect: (w: number, h: number, aspect: string) =>
    `This frame is ${w} x ${h}. This job is ${aspect}.`,
  uploadDuplicate: (number: number) => `Already on this board as frame ${number}.`,
  storeUnavailable: "The file store is unavailable right now. Nothing was saved.",
  frameMoved: (number: number, position: number, count: number) =>
    `Frame ${number} moved to position ${position} of ${count}.`,
  frameDuplicated: (number: number, newNumber: number) =>
    `Frame ${number} duplicated as frame ${newNumber}.`,
  frameInserted: (number: number, afterNumber: number) =>
    `Frame ${number} inserted after frame ${afterNumber}.`,
  frameRemoved: (number: number) => `Frame ${number} removed.`,
  frameBack: (number: number) => `Frame ${number} is back.`,
  undoPassed: "The time to undo has passed.",
  frameSaved: (number: number) => `Frame ${number} saved.`,
  frameNow: (number: number, count: number) =>
    `Frame ${number} is now ${count === 1 ? "1 frame" : `${count} frames`}.`,
  staleBoard: (time: string) =>
    `This board was changed at ${time} Amsterdam time in another window. Your changes are still here.`,
  frameRateNow: (rate: string) => `Frame rate is now ${rate}.`,
  lineSaved: "Line saved.",
  lineRemoved: "Line removed.",
  lineOutside: (percent: string) => `This line runs outside the safe area by ${percent}%.`,
  lineReading: (need: number, has: number) =>
    `This line needs ${need === 1 ? "1 frame" : `${need} frames`} on screen. It has ${has === 1 ? "1 frame" : `${has} frames`}.`,
  lineEmpty: "Type the line's text.",
  linePastLast: "This line runs past the last frame.",
  cueAdded: (title: string) => `Cue added: ${title}.`,
  cueRemoved: (title: string) => `Cue removed: ${title}.`,
  libraryUnavailable: "The music library is unavailable right now. Your cue stays.",
  licenceOrder: "The licence ends before it starts.",
  licenceDays: (count: number) =>
    count === 1 ? "Licence ends in 1 day" : `Licence ends in ${count} days`,
  licenceToday: "Licence ends today",
  licenceEnded: (date: string) => `Licence ended on ${date}.`,
  filmAsked: "Film asked for.",
  filmStored: "The stored film is shown.",
  filmReady: (number: number) => `The film for Cut ${number} is ready.`,
  renderBusy: (time: string) =>
    `The render service is busy. You can try again at ${time} Amsterdam time.`,
  renderIncomplete: "The render came back incomplete. Nothing was saved.",
  renderUnavailable: "The render service is unavailable right now. Nothing changed.",
  renderFailed: "The render service could not finish this film. Nothing was saved.",
  reviewReady: (name: string) => `Review page ready. The mail to ${name} is on its way.`,
  pageEnded: "Page ended.",
  duePassed: "This job's due date has passed.",
  noteDone: "Note marked done.",
  noteWontDo: "Note marked won't do.",
  noteReopened: "Note reopened.",
  notesDone: (count: number) => `${count} note${count === 1 ? "" : "s"} marked done.`,
  noteArrived: (name: string, number: number, time: string, town: string) =>
    `${name} left a note on frame ${number} at ${time} ${town} time.`,
  notePosition: (position: number) => `Position ${position}`,
  frameGone: (number: number) => `Frame gone in Cut ${number}.`,
  signOffReady: (name: string) => `Sign-off page ready. The mail to ${name} is on its way.`,
  signedOffArrived: (number: number, name: string, time: string, town: string) =>
    `Cut ${number} signed off by ${name} at ${time} ${town} time.`,
  callBooked: "Call booked.",
  callMoved: "Call moved.",
  callCancelled: "Call cancelled.",
  callTaken: (time: string) => `That time was just taken at ${time} Amsterdam time. Pick another.`,
  callMissing: (time: string, town: string, date: string) =>
    `${time} does not exist in ${town} on ${date}.`,
  callPast: "That time has passed.",
  packageReady: "Package ready.",
  pdfUnavailable: "The PDF service is unavailable right now. Nothing was saved.",
  licenceEndedPackage: (title: string, date: string) =>
    `The licence for ${title} ended on ${date}.`,
  onlySignedOff: "Only a signed-off cut can be delivered.",
  noDrawing: (number: number) => `Frame ${number} has no drawing yet.`,
  tooManyDownloads: (time: string) =>
    `Too many downloads for now. You can download again at ${time} Amsterdam time.`,
  letterSaved: "Letter saved.",
  feePageReady: (name: string) => `Fee page ready. The mail to ${name} is on its way.`,
  letterAcceptedArrived: (name: string) => `Letter accepted by ${name}.`,
  amountShape: "Type an amount such as 1835.50.",
  letterAcceptedLock: "This letter is accepted and can't change.",
  letterStale: (time: string, town: string) =>
    `This letter was changed at ${time} ${town} time. Read it again.`,
  cutMade: (number: number) => `Cut ${number} made.`,
  cutBroughtBack: (number: number) => `Cut ${number} is the board again.`,
  cutDeleted: (number: number) => `Cut ${number} deleted.`,
  cutSaved: (number: number) => `Cut ${number} saved.`,
  cutSignedNoChange: "A signed-off cut can't change.",
  differencesNone: "These two cuts are the same.",
} as const;

export const VISITOR_COPY = {
  addressCopied: "Address copied.",
  copyRefused: "Press Ctrl+C to copy the address.",
  enquiryThanks: "Thanks. I answer within two working days.",
  enquiryLimit: (time: string) =>
    `Too many enquiries from this address for now. You can send again at ${time} Amsterdam time.`,
  enquiryMessage: "Type your message.",
} as const;

// The private page copy table, one key across the four languages.
export type PrivateKey =
  | "reviewHeading" | "stepsGroup" | "stepFrames" | "stepNotes" | "stepSend"
  | "next" | "back" | "openSheet" | "close" | "filmStrip" | "clip" | "earlier"
  | "later" | "play" | "pause" | "placePin" | "noteField" | "lengthField"
  | "lengthInFrames" | "attachment" | "addNote" | "nameField" | "sendNotes"
  | "notesSent" | "draftRefused" | "numberCopy" | "emptyNote" | "emptyName"
  | "badAttachment" | "bigAttachment" | "problems" | "working" | "refreshLine"
  | "ended" | "askLink" | "mailField" | "linkAnswer" | "linkLimit"
  | "signOffHeading" | "signOffButton" | "signed" | "alreadySigned" | "newerCut"
  | "wrongName" | "mailReviewSubject" | "mailReminderSubject" | "mailNewLinkSubject"
  | "mailDueLine" | "mailCallSubject" | "mailCancelledCallSubject";

export const PRIVATE_COPY: Record<Language, Record<PrivateKey, string>> = {
  en: {
    reviewHeading: "Review of <title>",
    stepsGroup: "Steps",
    stepFrames: "Frames",
    stepNotes: "Notes",
    stepSend: "Send",
    next: "Next",
    back: "Back",
    openSheet: "Open notes",
    close: "Close",
    filmStrip: "Film strip",
    clip: "Frame <number>",
    earlier: "Earlier",
    later: "Later",
    play: "Play",
    pause: "Pause",
    placePin: "Place a pin",
    noteField: "Your note",
    lengthField: "Suggested length in seconds",
    lengthInFrames: "<count> frames",
    attachment: "Attach a drawing",
    addNote: "Add note",
    nameField: "Your full name",
    sendNotes: "Send notes",
    notesSent: "Your notes were sent.",
    draftRefused: "This draft is not kept on this device.",
    numberCopy: "Type a length such as 1.5.",
    emptyNote: "Type your note.",
    emptyName: "Type your full name.",
    badAttachment: "This file is not a PNG or JPEG.",
    bigAttachment: "This file is over 5,000,000 bytes.",
    problems: "Problems",
    working: "Working…",
    refreshLine: "Couldn't refresh. Trying again.",
    ended: "This page has ended.",
    askLink: "Ask for a new link",
    mailField: "Mail address",
    linkAnswer: "If that address belongs to this page, a new link is on its way.",
    linkLimit: "Too many requests for now. Try again later.",
    signOffHeading: "Sign-off for <title>",
    signOffButton: "Sign off",
    signed: "Signed off at <when>.",
    alreadySigned: "Already signed off at <when>.",
    newerCut: "A newer cut was made at <when>. Read it first.",
    wrongName: "That name doesn't match. Type your full name as it was given.",
    mailReviewSubject: "Your review page for <title>",
    mailReminderSubject: "Reminder: your review page for <title>",
    mailNewLinkSubject: "Your new link",
    mailDueLine: "Due <date>",
    mailCallSubject: "Call on <date>",
    mailCancelledCallSubject: "Call cancelled: <date>",
  },
  nl: {
    reviewHeading: "Beoordeling van <title>",
    stepsGroup: "Stappen",
    stepFrames: "Beelden",
    stepNotes: "Notities",
    stepSend: "Versturen",
    next: "Volgende",
    back: "Terug",
    openSheet: "Notities openen",
    close: "Sluiten",
    filmStrip: "Filmstrook",
    clip: "Beeld <number>",
    earlier: "Eerder",
    later: "Later",
    play: "Afspelen",
    pause: "Pauzeren",
    placePin: "Speld plaatsen",
    noteField: "Je notitie",
    lengthField: "Voorgestelde lengte in seconden",
    lengthInFrames: "<count> beelden",
    attachment: "Tekening toevoegen",
    addNote: "Notitie toevoegen",
    nameField: "Je volledige naam",
    sendNotes: "Notities versturen",
    notesSent: "Je notities zijn verstuurd.",
    draftRefused: "Dit concept wordt niet op dit apparaat bewaard.",
    numberCopy: "Typ een lengte zoals 1,5.",
    emptyNote: "Typ je notitie.",
    emptyName: "Typ je volledige naam.",
    badAttachment: "Dit bestand is geen PNG of JPEG.",
    bigAttachment: "Dit bestand is groter dan 5.000.000 bytes.",
    problems: "Problemen",
    working: "Bezig…",
    refreshLine: "Vernieuwen is niet gelukt. We proberen het opnieuw.",
    ended: "Deze pagina is verlopen.",
    askLink: "Vraag een nieuwe link aan",
    mailField: "E-mailadres",
    linkAnswer: "Als dit adres bij deze pagina hoort, is er een nieuwe link onderweg.",
    linkLimit: "Te veel verzoeken. Probeer het later opnieuw.",
    signOffHeading: "Akkoord voor <title>",
    signOffButton: "Akkoord geven",
    signed: "Akkoord gegeven om <when>.",
    alreadySigned: "Al akkoord gegeven om <when>.",
    newerCut: "Er is om <when> een nieuwere versie gemaakt. Lees die eerst.",
    wrongName: "Die naam komt niet overeen. Typ je volledige naam zoals die is doorgegeven.",
    mailReviewSubject: "Je beoordelingspagina voor <title>",
    mailReminderSubject: "Herinnering: je beoordelingspagina voor <title>",
    mailNewLinkSubject: "Je nieuwe link",
    mailDueLine: "Uiterlijk <date>",
    mailCallSubject: "Gesprek op <date>",
    mailCancelledCallSubject: "Gesprek geannuleerd: <date>",
  },
  fr: {
    reviewHeading: "Relecture de <title>",
    stepsGroup: "Étapes",
    stepFrames: "Images",
    stepNotes: "Notes",
    stepSend: "Envoyer",
    next: "Volgende",
    back: "Retour",
    openSheet: "Ouvrir les notes",
    close: "Fermer",
    filmStrip: "Bande de film",
    clip: "Image <number>",
    earlier: "Plus tôt",
    later: "Plus tard",
    play: "Lire",
    pause: "Pause",
    placePin: "Placer une épingle",
    noteField: "Votre note",
    lengthField: "Durée suggérée en secondes",
    lengthInFrames: "<count> images",
    attachment: "Joindre un dessin",
    addNote: "Ajouter la note",
    nameField: "Votre nom complet",
    sendNotes: "Envoyer les notes",
    notesSent: "Vos notes ont été envoyées.",
    draftRefused: "Ce brouillon n'est pas conservé sur cet appareil.",
    numberCopy: "Saisissez une durée comme 1,5.",
    emptyNote: "Saisissez votre note.",
    emptyName: "Saisissez votre nom complet.",
    badAttachment: "Ce fichier n'est ni un PNG ni un JPEG.",
    bigAttachment: "Ce fichier dépasse 5 000 000 octets.",
    problems: "Problèmes",
    working: "En cours…",
    refreshLine: "Actualisation impossible. Nouvel essai en cours.",
    ended: "Cette page est terminée.",
    askLink: "Demander un nouveau lien",
    mailField: "Adresse e-mail",
    linkAnswer: "Si cette adresse correspond à cette page, un nouveau lien est en route.",
    linkLimit: "Trop de demandes pour le moment. Réessayez plus tard.",
    signOffHeading: "Validation de <title>",
    signOffButton: "Valider",
    signed: "Validé à <when>.",
    alreadySigned: "Déjà validé à <when>.",
    newerCut: "Une version plus récente a été faite à <when>. Lisez-la d'abord.",
    wrongName: "Ce nom ne correspond pas. Saisissez votre nom complet tel qu'il a été donné.",
    mailReviewSubject: "Votre page de relecture pour <title>",
    mailReminderSubject: "Rappel : votre page de relecture pour <title>",
    mailNewLinkSubject: "Votre nouveau lien",
    mailDueLine: "À rendre le <date>",
    mailCallSubject: "Appel le <date>",
    mailCancelledCallSubject: "Appel annulé : <date>",
  },
  ar: {
    reviewHeading: "مراجعة <title>",
    stepsGroup: "الخطوات",
    stepFrames: "الإطارات",
    stepNotes: "الملاحظات",
    stepSend: "إرسال",
    next: "التالي",
    back: "السابق",
    openSheet: "فتح الملاحظات",
    close: "إغلاق",
    filmStrip: "شريط الفيلم",
    clip: "الإطار <number>",
    earlier: "أبكر",
    later: "لاحقًا",
    play: "تشغيل",
    pause: "إيقاف مؤقت",
    placePin: "وضع دبوس",
    noteField: "ملاحظتك",
    lengthField: "المدة المقترحة بالثواني",
    lengthInFrames: "<count> إطارًا",
    attachment: "إرفاق رسم",
    addNote: "إضافة الملاحظة",
    nameField: "اسمك الكامل",
    sendNotes: "إرسال الملاحظات",
    notesSent: "تم إرسال ملاحظاتك.",
    draftRefused: "لا يتم حفظ هذه المسودة على هذا الجهاز.",
    numberCopy: "اكتب مدة مثل ١٫٥.",
    emptyNote: "اكتب ملاحظتك.",
    emptyName: "اكتب اسمك الكامل.",
    badAttachment: "هذا الملف ليس PNG أو JPEG.",
    bigAttachment: "حجم هذا الملف يتجاوز 5,000,000 بايت.",
    problems: "المشكلات",
    working: "جارٍ العمل…",
    refreshLine: "تعذر التحديث. جارٍ إعادة المحاولة.",
    ended: "انتهت هذه الصفحة.",
    askLink: "طلب رابط جديد",
    mailField: "عنوان البريد الإلكتروني",
    linkAnswer: "إذا كان هذا العنوان مرتبطًا بهذه الصفحة، فسيصلك رابط جديد قريبًا.",
    linkLimit: "طلبات كثيرة جدًا الآن. حاول مرة أخرى لاحقًا.",
    signOffHeading: "اعتماد <title>",
    signOffButton: "اعتماد",
    signed: "تم الاعتماد في <when>.",
    alreadySigned: "تم الاعتماد بالفعل في <when>.",
    newerCut: "تم إعداد نسخة أحدث في <when>. اقرأها أولاً.",
    wrongName: "هذا الاسم غير مطابق. اكتب اسمك الكامل كما هو مسجل.",
    mailReviewSubject: "صفحة المراجعة الخاصة بك لـ <title>",
    mailReminderSubject: "تذكير: صفحة المراجعة الخاصة بك لـ <title>",
    mailNewLinkSubject: "رابطك الجديد",
    mailDueLine: "الموعد النهائي <date>",
    mailCallSubject: "مكالمة في <date>",
    mailCancelledCallSubject: "تم إلغاء المكالمة: <date>",
  },
};

// The fee page and the letter are in English for every producer.
export const FEE_COPY = {
  heading: (title: string) => `Fee letter for ${title}`,
  acceptLetter: "Accept letter",
  openTheLetter: "Open the letter",
  yourFullName: "Your full name",
  acceptedLine: "Letter accepted.",
  mailSubject: (title: string) => `Your fee letter for ${title}`,
} as const;

export const TOWN_TIME_PHRASE: Record<Town, Record<Language, string>> = {
  newYork: { en: "New York time", nl: "tijd in New York", fr: "heure de New York", ar: "بتوقيت نيويورك" },
  toronto: { en: "Toronto time", nl: "tijd in Toronto", fr: "heure de Toronto", ar: "بتوقيت تورنتو" },
  amsterdam: { en: "Amsterdam time", nl: "tijd in Amsterdam", fr: "heure d'Amsterdam", ar: "بتوقيت أمستردام" },
  dubai: { en: "Dubai time", nl: "tijd in Dubai", fr: "heure de Dubaï", ar: "بتوقيت دبي" },
};
