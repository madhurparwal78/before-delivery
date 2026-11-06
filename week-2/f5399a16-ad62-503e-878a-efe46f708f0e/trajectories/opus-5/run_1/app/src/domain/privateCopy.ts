import type { Town } from './time.js';

export const LANGUAGES = ['en', 'nl', 'fr', 'ar'] as const;
export type Language = (typeof LANGUAGES)[number];

type Row = Record<Language, string>;

/** Every string a private page or its mail may print, as data in the four languages. */
export const PRIVATE_COPY: Record<string, Row> = {
  reviewHeading: {
    en: 'Review of <title>',
    nl: 'Beoordeling van <title>',
    fr: 'Relecture de <title>',
    ar: 'مراجعة <title>',
  },
  stepsGroup: { en: 'Steps', nl: 'Stappen', fr: 'Étapes', ar: 'الخطوات' },
  stepFrames: { en: 'Frames', nl: 'Beelden', fr: 'Images', ar: 'الإطارات' },
  stepNotes: { en: 'Notes', nl: 'Notities', fr: 'Notes', ar: 'الملاحظات' },
  stepSend: { en: 'Send', nl: 'Versturen', fr: 'Envoyer', ar: 'إرسال' },
  next: { en: 'Next', nl: 'Volgende', fr: 'Suivant', ar: 'التالي' },
  back: { en: 'Back', nl: 'Terug', fr: 'Retour', ar: 'السابق' },
  openSheet: {
    en: 'Open notes',
    nl: 'Notities openen',
    fr: 'Ouvrir les notes',
    ar: 'فتح الملاحظات',
  },
  close: { en: 'Close', nl: 'Sluiten', fr: 'Fermer', ar: 'إغلاق' },
  filmStrip: { en: 'Film strip', nl: 'Filmstrook', fr: 'Bande de film', ar: 'شريط الفيلم' },
  clip: {
    en: 'Frame <number>',
    nl: 'Beeld <number>',
    fr: 'Image <number>',
    ar: 'الإطار <number>',
  },
  earlier: { en: 'Earlier', nl: 'Eerder', fr: 'Plus tôt', ar: 'أبكر' },
  later: { en: 'Later', nl: 'Later', fr: 'Plus tard', ar: 'لاحقًا' },
  play: { en: 'Play', nl: 'Afspelen', fr: 'Lire', ar: 'تشغيل' },
  pause: { en: 'Pause', nl: 'Pauzeren', fr: 'Pause', ar: 'إيقاف مؤقت' },
  placePin: {
    en: 'Place a pin',
    nl: 'Speld plaatsen',
    fr: 'Placer une épingle',
    ar: 'وضع دبوس',
  },
  noteField: { en: 'Your note', nl: 'Je notitie', fr: 'Votre note', ar: 'ملاحظتك' },
  lengthField: {
    en: 'Suggested length in seconds',
    nl: 'Voorgestelde lengte in seconden',
    fr: 'Durée suggérée en secondes',
    ar: 'المدة المقترحة بالثواني',
  },
  lengthInFrames: {
    en: '<count> frames',
    nl: '<count> beelden',
    fr: '<count> images',
    ar: '<count> إطارًا',
  },
  lengthInFramesOne: { en: '1 frame', nl: '1 beeld', fr: '1 image', ar: 'إطار واحد' },
  attachment: {
    en: 'Attach a drawing',
    nl: 'Tekening toevoegen',
    fr: 'Joindre un dessin',
    ar: 'إرفاق رسم',
  },
  addNote: {
    en: 'Add note',
    nl: 'Notitie toevoegen',
    fr: 'Ajouter la note',
    ar: 'إضافة الملاحظة',
  },
  nameField: {
    en: 'Your full name',
    nl: 'Je volledige naam',
    fr: 'Votre nom complet',
    ar: 'اسمك الكامل',
  },
  sendNotes: {
    en: 'Send notes',
    nl: 'Notities versturen',
    fr: 'Envoyer les notes',
    ar: 'إرسال الملاحظات',
  },
  notesSent: {
    en: 'Your notes were sent.',
    nl: 'Je notities zijn verstuurd.',
    fr: 'Vos notes ont été envoyées.',
    ar: 'تم إرسال ملاحظاتك.',
  },
  draftRefused: {
    en: 'This draft is not kept on this device.',
    nl: 'Dit concept wordt niet op dit apparaat bewaard.',
    fr: "Ce brouillon n'est pas conservé sur cet appareil.",
    ar: 'لا يتم حفظ هذه المسودة على هذا الجهاز.',
  },
  numberCopy: {
    en: 'Type a length such as 1.5.',
    nl: 'Typ een lengte zoals 1,5.',
    fr: 'Saisissez une durée comme 1,5.',
    ar: 'اكتب مدة مثل ١٫٥.',
  },
  emptyNote: {
    en: 'Type your note.',
    nl: 'Typ je notitie.',
    fr: 'Saisissez votre note.',
    ar: 'اكتب ملاحظتك.',
  },
  emptyName: {
    en: 'Type your full name.',
    nl: 'Typ je volledige naam.',
    fr: 'Saisissez votre nom complet.',
    ar: 'اكتب اسمك الكامل.',
  },
  badAttachment: {
    en: 'This file is not a PNG or JPEG.',
    nl: 'Dit bestand is geen PNG of JPEG.',
    fr: "Ce fichier n'est ni un PNG ni un JPEG.",
    ar: 'هذا الملف ليس PNG أو JPEG.',
  },
  bigAttachment: {
    en: 'This file is over 5,000,000 bytes.',
    nl: 'Dit bestand is groter dan 5.000.000 bytes.',
    fr: 'Ce fichier dépasse 5 000 000 octets.',
    ar: 'حجم هذا الملف يتجاوز 5,000,000 بايت.',
  },
  problems: { en: 'Problems', nl: 'Problemen', fr: 'Problèmes', ar: 'المشكلات' },
  working: { en: 'Working…', nl: 'Bezig…', fr: 'En cours…', ar: 'جارٍ العمل…' },
  refreshLine: {
    en: "Couldn't refresh. Trying again.",
    nl: 'Vernieuwen is niet gelukt. We proberen het opnieuw.',
    fr: 'Actualisation impossible. Nouvel essai en cours.',
    ar: 'تعذر التحديث. جارٍ إعادة المحاولة.',
  },
  ended: {
    en: 'This page has ended.',
    nl: 'Deze pagina is verlopen.',
    fr: 'Cette page est terminée.',
    ar: 'انتهت هذه الصفحة.',
  },
  askLink: {
    en: 'Ask for a new link',
    nl: 'Vraag een nieuwe link aan',
    fr: 'Demander un nouveau lien',
    ar: 'طلب رابط جديد',
  },
  mailField: {
    en: 'Mail address',
    nl: 'E-mailadres',
    fr: 'Adresse e-mail',
    ar: 'عنوان البريد الإلكتروني',
  },
  linkAnswer: {
    en: 'If that address belongs to this page, a new link is on its way.',
    nl: 'Als dit adres bij deze pagina hoort, is er een nieuwe link onderweg.',
    fr: 'Si cette adresse correspond à cette page, un nouveau lien est en route.',
    ar: 'إذا كان هذا العنوان مرتبطًا بهذه الصفحة، فسيصلك رابط جديد قريبًا.',
  },
  linkLimit: {
    en: 'Too many requests for now. Try again later.',
    nl: 'Te veel verzoeken. Probeer het later opnieuw.',
    fr: 'Trop de demandes pour le moment. Réessayez plus tard.',
    ar: 'طلبات كثيرة جدًا الآن. حاول مرة أخرى لاحقًا.',
  },
  signOffHeading: {
    en: 'Sign-off for <title>',
    nl: 'Akkoord voor <title>',
    fr: 'Validation de <title>',
    ar: 'اعتماد <title>',
  },
  signOffButton: { en: 'Sign off', nl: 'Akkoord geven', fr: 'Valider', ar: 'اعتماد' },
  signed: {
    en: 'Signed off at <when>.',
    nl: 'Akkoord gegeven om <when>.',
    fr: 'Validé à <when>.',
    ar: 'تم الاعتماد في <when>.',
  },
  alreadySigned: {
    en: 'Already signed off at <when>.',
    nl: 'Al akkoord gegeven om <when>.',
    fr: 'Déjà validé à <when>.',
    ar: 'تم الاعتماد بالفعل في <when>.',
  },
  newerCut: {
    en: 'A newer cut was made at <when>. Read it first.',
    nl: 'Er is om <when> een nieuwere versie gemaakt. Lees die eerst.',
    fr: 'Une version plus récente a été faite à <when>. Lisez-la d\u2019abord.',
    ar: 'تم إعداد نسخة أحدث في <when>. اقرأها أولاً.',
  },
  wrongName: {
    en: "That name doesn't match. Type your full name as it was given.",
    nl: 'Die naam komt niet overeen. Typ je volledige naam zoals die is doorgegeven.',
    fr: 'Ce nom ne correspond pas. Saisissez votre nom complet tel qu\u2019il a été donné.',
    ar: 'هذا الاسم غير مطابق. اكتب اسمك الكامل كما هو مسجل.',
  },
  mailReviewSubject: {
    en: 'Your review page for <title>',
    nl: 'Je beoordelingspagina voor <title>',
    fr: 'Votre page de relecture pour <title>',
    ar: 'صفحة المراجعة الخاصة بك لـ <title>',
  },
  mailReminderSubject: {
    en: 'Reminder: your review page for <title>',
    nl: 'Herinnering: je beoordelingspagina voor <title>',
    fr: 'Rappel : votre page de relecture pour <title>',
    ar: 'تذكير: صفحة المراجعة الخاصة بك لـ <title>',
  },
  mailNewLinkSubject: {
    en: 'Your new link',
    nl: 'Je nieuwe link',
    fr: 'Votre nouveau lien',
    ar: 'رابطك الجديد',
  },
  mailDueLine: {
    en: 'Due <date>',
    nl: 'Uiterlijk <date>',
    fr: 'À rendre le <date>',
    ar: 'الموعد النهائي <date>',
  },
  mailCallSubject: {
    en: 'Call on <date>',
    nl: 'Gesprek op <date>',
    fr: 'Appel le <date>',
    ar: 'مكالمة في <date>',
  },
  mailCancelledCallSubject: {
    en: 'Call cancelled: <date>',
    nl: 'Gesprek geannuleerd: <date>',
    fr: 'Appel annulé : <date>',
    ar: 'تم إلغاء المكالمة: <date>',
  },
};

const TIME_PHRASES: Record<Town, Row> = {
  newYork: {
    en: 'New York time',
    nl: 'tijd in New York',
    fr: 'heure de New York',
    ar: 'بتوقيت نيويورك',
  },
  toronto: {
    en: 'Toronto time',
    nl: 'tijd in Toronto',
    fr: 'heure de Toronto',
    ar: 'بتوقيت تورنتو',
  },
  amsterdam: {
    en: 'Amsterdam time',
    nl: 'tijd in Amsterdam',
    fr: "heure d'Amsterdam",
    ar: 'بتوقيت أمستردام',
  },
  dubai: { en: 'Dubai time', nl: 'tijd in Dubai', fr: 'heure de Dubaï', ar: 'بتوقيت دبي' },
};

export function timePhrase(town: Town, language: Language): string {
  return TIME_PHRASES[town][language];
}

/** `<when>` is the clock time followed by the town's time phrase. */
export function whenText(time: string, town: Town, language: Language): string {
  return `${time} ${timePhrase(town, language)}`;
}

export function privateCopy(
  key: keyof typeof PRIVATE_COPY | string,
  language: Language,
  placeholders: Record<string, string | number> = {},
): string {
  const row = PRIVATE_COPY[key];
  if (!row) throw new Error(`no private copy for ${key}`);
  let text = row[language];
  for (const [name, value] of Object.entries(placeholders)) {
    text = text.split(`<${name}>`).join(String(value));
  }
  return text;
}

/** At 1 the frames row reads its own singular. */
export function framesText(count: number, language: Language): string {
  return count === 1
    ? privateCopy('lengthInFramesOne', language)
    : privateCopy('lengthInFrames', language, { count });
}

/** The fee page and the letter are in English for every producer. */
export const FEE_COPY = {
  heading: 'Fee letter for <title>',
  subject: 'Your fee letter for <title>',
  accepted: 'Letter accepted.',
  button: 'Accept letter',
  openLetter: 'Open the letter',
} as const;
