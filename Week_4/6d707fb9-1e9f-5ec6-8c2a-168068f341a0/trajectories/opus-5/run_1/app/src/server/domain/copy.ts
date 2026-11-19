import type { Language } from './numbers';

/** Refusals and rare states, the one place each published line is written. */
export const copy = {
  gtinCheckDigit: (digit: number) => `That GTIN's check digit should be ${digit}.`,
  gtinLength: 'A GTIN has 13 digits.',
  emptyField: 'Give a value here.',
  styleCodeTaken: 'That style code is already in this label.',
  catalogueHeader: 'The first row must be styleCode,name,season,gtin.',
  catalogueName: 'A name is needed.',
  catalogueSeason: 'A season is needed.',
  catalogueRepeat: (row: number) => `This style code is already on row ${row}.`,
  fibresOff: (total: string) => `The fibres add up to ${total}%. They must add up to 100.0%.`,
  fibreShareForm: 'Give each fibre share with one decimal.',
  massForm: 'Give a fabric weight and area, or a plain mass.',
  changedByAnswer: (time: string, supplier: string) =>
    `This style was changed at ${time} Lisbon time by ${supplier}'s answer. Your changes are still here.`,
  changedElsewhere: (time: string) =>
    `This style was changed at ${time} Lisbon time elsewhere. Your changes are still here.`,
  styleArchived: 'This style is archived.',
  labelClosed: 'This label is closed. Bring it back first.',
  archiveWithPassport: 'Withdraw the passport before archiving.',
  lineAtEnd: 'That line is already at the end.',
  tooManyRequests: (time: string) => `Too many requests for now. You can send another at ${time} Lisbon time.`,
  tooManyDownloads: (time: string) => `Too many downloads for now. You can download another at ${time} Lisbon time.`,
  dateForm: 'Give the date as YYYY-MM-DD.',
  timeForm: 'Give the time as HH:MM.',
  dueDatePast: (town: string) => `The due date must be today or later in ${town}.`,
  requestAnswered: 'This request has been answered.',
  skippedTime: (town: string, date: string) =>
    `That time doesn't exist in ${town} on ${date} because the clocks change.`,
  offlineWaiting: (count: number) =>
    count === 1
      ? 'Offline \u2014 1 reading waiting on this device.'
      : `Offline \u2014 ${count} readings waiting on this device.`,
  sendingWaiting: (count: number) =>
    count === 1
      ? 'Sending \u2014 1 reading waiting on this device.'
      : `Sending \u2014 ${count} readings waiting on this device.`,
  allSent: 'All readings sent.',
  signOutWaiting: (count: number) =>
    count === 1
      ? '1 reading is still waiting. Go back online to send it first.'
      : `${count} readings are still waiting. Go back online to send them first.`,
  lowerReading: (meter: number, lastValue: string, unit: string, time: string, town: string) =>
    `Meter ${meter} reads lower than ${lastValue} ${unit} recorded at ${time} ${town} time. Keep which?`,
  meterUnit: (meter: number, unit: string) => `Meter ${meter} reads in ${unit}.`,
  noLines: 'Add a material line first.',
  noTierOne: (material: string) => `Tier 1 country is missing for ${material}.`,
  libraryUnavailable: 'The factor library is unavailable right now. The last result stays.',
  newerFactors: (edition: string) => `Newer factors available (${edition}).`,
  noNewerFactors: 'No newer factors.',
  staleBaseline: (time: string) =>
    `The baseline was worked out again at ${time} Lisbon time. Your scenario is still here.`,
  scoreShown: (score: string, per100g: string) => `Score ${score} points (${per100g} per 100 g)`,
  missingOrigin: (material: string) => `Fibre origin is missing for ${material}.`,
  worstCaseRepair: 'Worst-case value used for repair service.',
  worstCaseRange: 'Worst-case value used for range size.',
  scoreBusy: (time: string) => `The score service is busy. You can try again at ${time} Lisbon time.`,
  scoreUnavailable: 'The score service is unavailable right now. Nothing changed.',
  scoreStale: 'Outdated',
  publishWithoutScore: 'Ask for a current score before publishing.',
  gtinTaken: 'A passport with this GTIN already exists.',
  dossierWithoutResult: 'Work out the footprint first.',
  dossierServiceDown: 'The dossier service is unavailable right now. Nothing was saved.',
  fileStoreDown: 'The file store is unavailable right now. Nothing was saved.',
  newerDossier: (time: string) => `A newer dossier was made at ${time} Lisbon time. Read it first.`,
  alreadySigned: 'This dossier is already signed off.',
  signOffNameEmpty: 'Type your name to sign off.',
  sessionEnded: 'Your session ended. Sign in again to keep going \u2014 what you typed is still here.',
  wrongSignIn: "That email and password don't match.",
  refreshFailed: "Couldn't refresh. Trying again.",
  notFoundHeading: "We couldn't find that page.",
} as const;

/** Announcements for each action. */
export const announce = {
  passwordChanged: 'Password changed.',
  labelAdded: (name: string) => `Label ${name} added.`,
  labelRenamed: (name: string) => `Label renamed to ${name}.`,
  labelDeleted: (name: string) => `Label ${name} deleted.`,
  labelClosed: (name: string, date: string, time: string) =>
    `Label ${name} closed. It will be erased on ${date}, ${time} Lisbon time unless you bring it back.`,
  labelBack: (name: string) => `Label ${name} is back.`,
  labelErased: (name: string) => `Label ${name} erased.`,
  styleAdded: (name: string) => `Style ${name} added.`,
  styleArchived: (name: string) => `Style ${name} archived.`,
  stylesShown: (count: number) => (count === 1 ? '1 style shown.' : `${count} styles shown.`),
  cataloguePreview: (newCount: number, matched: number, refused: number) =>
    `Preview ready: ${newCount} new, ${matched} matched, ${refused} refused.`,
  catalogueSaved: (newCount: number, matched: number, refused: number) =>
    `Catalogue saved: ${newCount} new, ${matched} matched, ${refused} refused.`,
  lineAdded: (material: string) => `${material} added.`,
  lineSaved: (material: string) => `${material} saved.`,
  lineRemoved: (material: string) => `${material} removed.`,
  lineMoved: (material: string, position: number, total: number) =>
    `${material} moved to position ${position} of ${total}.`,
  legAdded: 'Transport leg added.',
  legRemoved: 'Transport leg removed.',
  requestSent: (supplier: string) => `Request sent to ${supplier}.`,
  newAddressSent: (supplier: string) => `New address sent to ${supplier}.`,
  pageEnded: (supplier: string) => `Page ended for ${supplier}.`,
  answered: (supplier: string, time: string, town: string) => `${supplier} answered at ${time} ${town} time.`,
  visitBooked: (factory: string) => `Visit to ${factory} booked.`,
  readingRecorded: (meter: number) => `Reading for meter ${meter} recorded.`,
  footprintWorkedOut: (edition: string) => `Footprint worked out with edition ${edition}.`,
  measureChosen: (measure: string, total: string, stage: string) => `${measure}: ${total}, hotspot ${stage}.`,
  scenarioTotal: (total: string) => `Scenario climate total ${total}.`,
  scenarioSaved: (name: string) => `Scenario ${name} saved.`,
  passportPublished: (edition: number) => `Passport edition ${edition} published.`,
  passportWithdrawn: (style: string) => `Passport for ${style} withdrawn.`,
  dossierReady: 'Dossier ready.',
  signOffSent: (contact: string) => `Sign-off page sent to ${contact}.`,
  signedOff: (name: string) => `Signed off by ${name}.`,
  dossierDownloaded: 'Dossier downloaded.',
  resultsDownloaded: 'Results file downloaded.',
  evidenceDownloaded: 'Evidence downloaded.',
} as const;

export const MEASURE_NAMES = {
  climate: 'Climate',
  water: 'Water',
  fossilEnergy: 'Fossil energy',
  landUse: 'Land use',
  freshwaterToxicity: 'Freshwater toxicity',
  microfibres: 'Microfibres',
} as const;

export const STAGE_NAMES = {
  materials: 'Materials',
  making: 'Making',
  transport: 'Transport',
  use: 'Use',
  endOfLife: 'End of life',
} as const;

export const GARMENT_NAMES = {
  tshirt: 'T-shirt',
  shirt: 'Shirt',
  jeans: 'Jeans',
  coat: 'Coat',
} as const;

export const MODE_NAMES = {
  sea: 'Sea',
  road: 'Road',
  rail: 'Rail',
  air: 'Air',
} as const;

export const COUNTRY_NAMES = {
  PT: 'Portugal',
  TR: 'Turkey',
  VN: 'Vietnam',
  EG: 'Egypt',
  IN: 'India',
  BD: 'Bangladesh',
} as const;

export const STYLE_STATE_NAMES = {
  draft: 'Draft',
  worked: 'Worked',
  published: 'Published',
  archived: 'Archived',
} as const;

export const LABEL_STATE_NAMES = {
  open: 'Open',
  closed: 'Closed',
  erased: 'Erased',
} as const;

export const REQUEST_STATE_NAMES = {
  sent: 'Sent',
  reminded: 'Reminded',
  answered: 'Answered',
  ended: 'Ended',
} as const;

/** The answer page copy table, rendered character for character. */
type AnswerKey =
  | 'heading'
  | 'stepsGroup'
  | 'stepEnergy'
  | 'stepWater'
  | 'stepFibreOrigin'
  | 'stepEvidence'
  | 'stepSend'
  | 'energyField'
  | 'waterField'
  | 'originField'
  | 'unit'
  | 'unitKwh'
  | 'unitMj'
  | 'unitGas'
  | 'close'
  | 'next'
  | 'back'
  | 'evidenceField'
  | 'sendAnswers'
  | 'working'
  | 'sent'
  | 'ended'
  | 'numberRefused'
  | 'fileTypeRefused'
  | 'fileTooBig'
  | 'fileStoreDown'
  | 'problems'
  | 'refreshFailed'
  | 'emptyAnswer';

export const answerCopy: Record<AnswerKey, Record<Language, string>> = {
  heading: { en: 'Your answers', fr: 'Vos r\u00e9ponses', tr: 'Yan\u0131tlar\u0131n\u0131z', ar: '\u0625\u062c\u0627\u0628\u0627\u062a\u0643' },
  stepsGroup: { en: 'Steps', fr: '\u00c9tapes', tr: 'Ad\u0131mlar', ar: '\u0627\u0644\u062e\u0637\u0648\u0627\u062a' },
  stepEnergy: { en: 'Energy', fr: '\u00c9nergie', tr: 'Enerji', ar: '\u0627\u0644\u0637\u0627\u0642\u0629' },
  stepWater: { en: 'Water', fr: 'Eau', tr: 'Su', ar: '\u0627\u0644\u0645\u0627\u0621' },
  stepFibreOrigin: {
    en: 'Fibre origin',
    fr: 'Origine de la fibre',
    tr: 'Elyaf k\u00f6keni',
    ar: '\u0645\u0646\u0634\u0623 \u0627\u0644\u0623\u0644\u064a\u0627\u0641',
  },
  stepEvidence: {
    en: 'Evidence',
    fr: 'Justificatif',
    tr: 'Kan\u0131t belgesi',
    ar: '\u0645\u0633\u062a\u0646\u062f \u062f\u0627\u0639\u0645',
  },
  stepSend: { en: 'Send', fr: 'Envoi', tr: 'G\u00f6nderim', ar: '\u0627\u0644\u0625\u0631\u0633\u0627\u0644' },
  energyField: {
    en: 'Energy per kg of finished goods',
    fr: '\u00c9nergie par kg de produit fini',
    tr: "Bitmi\u015f \u00fcr\u00fcn\u00fcn kg'si ba\u015f\u0131na enerji",
    ar: '\u0627\u0644\u0637\u0627\u0642\u0629 \u0644\u0643\u0644 \u0643\u064a\u0644\u0648\u063a\u0631\u0627\u0645 \u0645\u0646 \u0627\u0644\u0645\u0646\u062a\u062c \u0627\u0644\u0646\u0647\u0627\u0626\u064a',
  },
  waterField: {
    en: 'Water in litres per kg of finished goods',
    fr: 'Eau en litres par kg de produit fini',
    tr: "Bitmi\u015f \u00fcr\u00fcn\u00fcn kg'si ba\u015f\u0131na litre su",
    ar: '\u0627\u0644\u0645\u0627\u0621 \u0628\u0627\u0644\u0644\u062a\u0631 \u0644\u0643\u0644 \u0643\u064a\u0644\u0648\u063a\u0631\u0627\u0645 \u0645\u0646 \u0627\u0644\u0645\u0646\u062a\u062c \u0627\u0644\u0646\u0647\u0627\u0626\u064a',
  },
  originField: {
    en: 'Country of fibre origin',
    fr: "Pays d'origine de la fibre",
    tr: 'Elyaf\u0131n men\u015fe \u00fclkesi',
    ar: '\u0628\u0644\u062f \u0645\u0646\u0634\u0623 \u0627\u0644\u0623\u0644\u064a\u0627\u0641',
  },
  unit: { en: 'Unit', fr: 'Unit\u00e9', tr: 'Birim', ar: '\u0627\u0644\u0648\u062d\u062f\u0629' },
  unitKwh: { en: 'kWh', fr: 'kWh', tr: 'kWh', ar: 'kWh' },
  unitMj: { en: 'MJ', fr: 'MJ', tr: 'MJ', ar: 'MJ' },
  unitGas: {
    en: 'm\u00b3 of natural gas',
    fr: 'm\u00b3 de gaz naturel',
    tr: 'm\u00b3 do\u011fal gaz',
    ar: '\u0645\u00b3 \u0645\u0646 \u0627\u0644\u063a\u0627\u0632 \u0627\u0644\u0637\u0628\u064a\u0639\u064a',
  },
  close: { en: 'Close', fr: 'Fermer', tr: 'Kapat', ar: '\u0625\u063a\u0644\u0627\u0642' },
  next: { en: 'Next', fr: 'Suivant', tr: '\u0130leri', ar: '\u0627\u0644\u062a\u0627\u0644\u064a' },
  back: { en: 'Back', fr: 'Retour', tr: 'Geri', ar: '\u0627\u0644\u0633\u0627\u0628\u0642' },
  evidenceField: {
    en: 'Evidence file (PDF, JPEG or PNG)',
    fr: 'Justificatif (PDF, JPEG ou PNG)',
    tr: 'Kan\u0131t dosyas\u0131 (PDF, JPEG veya PNG)',
    ar: '\u0645\u0644\u0641 \u0627\u0644\u0645\u0633\u062a\u0646\u062f (PDF \u0623\u0648 JPEG \u0623\u0648 PNG)',
  },
  sendAnswers: {
    en: 'Send answers',
    fr: 'Envoyer les r\u00e9ponses',
    tr: 'Yan\u0131tlar\u0131 g\u00f6nder',
    ar: '\u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0625\u062c\u0627\u0628\u0627\u062a',
  },
  working: {
    en: 'Working\u2026',
    fr: 'En cours\u2026',
    tr: '\u0130\u015fleniyor\u2026',
    ar: '\u062c\u0627\u0631\u064d \u0627\u0644\u0639\u0645\u0644\u2026',
  },
  sent: { en: 'Sent', fr: 'Envoy\u00e9', tr: 'G\u00f6nderildi', ar: '\u062a\u0645 \u0627\u0644\u0625\u0631\u0633\u0627\u0644' },
  ended: {
    en: 'This page has ended.',
    fr: 'Cette page est termin\u00e9e.',
    tr: 'Bu sayfan\u0131n s\u00fcresi doldu.',
    ar: '\u0627\u0646\u062a\u0647\u062a \u0647\u0630\u0647 \u0627\u0644\u0635\u0641\u062d\u0629.',
  },
  numberRefused: {
    en: "That number isn't in the form this page uses, for example 1,250.5.",
    fr: "Ce nombre n'est pas \u00e9crit comme il faut, par exemple 1 250,5.",
    tr: 'Bu say\u0131 do\u011fru bi\u00e7imde de\u011fil, \u00f6rne\u011fin 1.250,5.',
    ar: '\u0647\u0630\u0627 \u0627\u0644\u0631\u0642\u0645 \u0644\u064a\u0633 \u0628\u0627\u0644\u0635\u064a\u063a\u0629 \u0627\u0644\u0635\u062d\u064a\u062d\u0629\u060c \u0645\u062b\u0644 \u0661\u066c\u0662\u0665\u0660\u066b\u0665.',
  },
  fileTypeRefused: {
    en: "That file isn't a PDF, JPEG or PNG.",
    fr: "Ce fichier n'est ni un PDF, ni un JPEG, ni un PNG.",
    tr: 'Bu dosya PDF, JPEG veya PNG de\u011fil.',
    ar: '\u0647\u0630\u0627 \u0627\u0644\u0645\u0644\u0641 \u0644\u064a\u0633 PDF \u0623\u0648 JPEG \u0623\u0648 PNG.',
  },
  fileTooBig: {
    en: 'That file is over 5,000,000 bytes.',
    fr: 'Ce fichier d\u00e9passe 5 000 000 octets.',
    tr: 'Bu dosya 5.000.000 bayt\u0131 a\u015f\u0131yor.',
    ar: '\u064a\u062a\u062c\u0627\u0648\u0632 \u0647\u0630\u0627 \u0627\u0644\u0645\u0644\u0641 \u0665\u066c\u0660\u0660\u0660\u066c\u0660\u0660\u0660 \u0628\u0627\u064a\u062a.',
  },
  fileStoreDown: {
    en: copy.fileStoreDown,
    fr: "Le stockage des fichiers est indisponible pour le moment. Rien n'a \u00e9t\u00e9 enregistr\u00e9.",
    tr: 'Dosya deposu \u015fu anda kullan\u0131lam\u0131yor. Hi\u00e7bir \u015fey kaydedilmedi.',
    ar: '\u0645\u062e\u0632\u0646 \u0627\u0644\u0645\u0644\u0641\u0627\u062a \u063a\u064a\u0631 \u0645\u062a\u0627\u062d \u062d\u0627\u0644\u064a\u064b\u0627. \u0644\u0645 \u064a\u064f\u062d\u0641\u0638 \u0623\u064a \u0634\u064a\u0621.',
  },
  problems: { en: 'Problems', fr: 'Probl\u00e8mes', tr: 'Sorunlar', ar: '\u0627\u0644\u0645\u0634\u0643\u0644\u0627\u062a' },
  refreshFailed: {
    en: "Couldn't refresh. Trying again.",
    fr: 'Actualisation impossible. Nouvel essai en cours.',
    tr: 'Yenilenemedi. Yeniden deneniyor.',
    ar: '\u062a\u0639\u0630\u0631 \u0627\u0644\u062a\u062d\u062f\u064a\u062b. \u062c\u0627\u0631\u064d \u0627\u0644\u0645\u062d\u0627\u0648\u0644\u0629 \u0645\u062c\u062f\u062f\u064b\u0627.',
  },
  emptyAnswer: {
    en: 'Give an answer here.',
    fr: 'R\u00e9pondez ici.',
    tr: 'Buraya bir yan\u0131t girin.',
    ar: '\u0623\u062f\u062e\u0644 \u0625\u062c\u0627\u0628\u0629 \u0647\u0646\u0627.',
  },
};

export const answerIntro: Record<Language, (label: string, style: string) => string> = {
  en: (label, style) => `${label} asks about ${style}.`,
  fr: (label, style) => `${label} pose des questions sur ${style}.`,
  tr: (label, style) => `${label}, ${style} hakk\u0131nda soruyor.`,
  ar: (label, style) => `\u062a\u0633\u0623\u0644 ${label} \u0639\u0646 ${style}.`,
};

export const answerDueLine: Record<Language, (dueDate: string, town: string) => string> = {
  en: (dueDate, town) => `Please answer by ${dueDate} 23:59:59 ${town} time.`,
  fr: (dueDate, town) => `Merci de r\u00e9pondre avant le ${dueDate} 23:59:59, heure de ${town}.`,
  tr: (dueDate, town) => `L\u00fctfen ${dueDate} 23:59:59 (${town} saati) tarihine kadar yan\u0131tlay\u0131n.`,
  ar: (dueDate, town) =>
    `\u064a\u0631\u062c\u0649 \u0627\u0644\u0625\u062c\u0627\u0628\u0629 \u0642\u0628\u0644 ${dueDate} 23:59:59 \u0628\u062a\u0648\u0642\u064a\u062a ${town}.`,
};

export const answerCountryNames: Record<Language, Record<keyof typeof COUNTRY_NAMES, string>> = {
  en: { PT: 'Portugal', TR: 'Turkey', VN: 'Vietnam', EG: 'Egypt', IN: 'India', BD: 'Bangladesh' },
  fr: {
    PT: 'Portugal',
    TR: 'Turquie',
    VN: 'Vi\u00eat Nam',
    EG: '\u00c9gypte',
    IN: 'Inde',
    BD: 'Bangladesh',
  },
  tr: {
    PT: 'Portekiz',
    TR: 'T\u00fcrkiye',
    VN: 'Vietnam',
    EG: 'M\u0131s\u0131r',
    IN: 'Hindistan',
    BD: 'Banglade\u015f',
  },
  ar: {
    PT: '\u0627\u0644\u0628\u0631\u062a\u063a\u0627\u0644',
    TR: '\u062a\u0631\u0643\u064a\u0627',
    VN: '\u0641\u064a\u062a\u0646\u0627\u0645',
    EG: '\u0645\u0635\u0631',
    IN: '\u0627\u0644\u0647\u0646\u062f',
    BD: '\u0628\u0646\u063a\u0644\u0627\u062f\u064a\u0634',
  },
};

/** The passport copy table. */
type PassportKey =
  | 'label'
  | 'garment'
  | 'footprint'
  | 'climate'
  | 'water'
  | 'fossilEnergy'
  | 'landUse'
  | 'freshwaterToxicity'
  | 'microfibres'
  | 'withdrawn'
  | 'claimNote'
  | 'language';

export const passportCopy: Record<PassportKey, Record<Language, string>> = {
  label: { en: 'Label', fr: 'Marque', tr: 'Marka', ar: '\u0627\u0644\u0639\u0644\u0627\u0645\u0629' },
  garment: { en: 'Garment', fr: 'V\u00eatement', tr: 'Giysi', ar: '\u0627\u0644\u0645\u0644\u0628\u0633' },
  footprint: { en: 'Footprint', fr: 'Empreinte', tr: 'Ayak izi', ar: '\u0627\u0644\u0628\u0635\u0645\u0629' },
  climate: { en: 'Climate', fr: 'Climat', tr: '\u0130klim', ar: '\u0627\u0644\u0645\u0646\u0627\u062e' },
  water: { en: 'Water', fr: 'Eau', tr: 'Su', ar: '\u0627\u0644\u0645\u0627\u0621' },
  fossilEnergy: {
    en: 'Fossil energy',
    fr: '\u00c9nergie fossile',
    tr: 'Fosil enerji',
    ar: '\u0627\u0644\u0637\u0627\u0642\u0629 \u0627\u0644\u0623\u062d\u0641\u0648\u0631\u064a\u0629',
  },
  landUse: {
    en: 'Land use',
    fr: 'Usage des sols',
    tr: 'Arazi kullan\u0131m\u0131',
    ar: '\u0627\u0633\u062a\u062e\u062f\u0627\u0645 \u0627\u0644\u0623\u0631\u0627\u0636\u064a',
  },
  freshwaterToxicity: {
    en: 'Freshwater toxicity',
    fr: 'Toxicit\u00e9 en eau douce',
    tr: 'Tatl\u0131 su toksisitesi',
    ar: '\u0633\u0645\u064a\u0629 \u0627\u0644\u0645\u064a\u0627\u0647 \u0627\u0644\u0639\u0630\u0628\u0629',
  },
  microfibres: {
    en: 'Microfibres',
    fr: 'Microfibres',
    tr: 'Mikrolifler',
    ar: '\u0627\u0644\u0623\u0644\u064a\u0627\u0641 \u0627\u0644\u062f\u0642\u064a\u0642\u0629',
  },
  withdrawn: {
    en: 'This passport has been withdrawn.',
    fr: 'Ce passeport a \u00e9t\u00e9 retir\u00e9.',
    tr: 'Bu pasaport geri \u00e7ekildi.',
    ar: '\u062a\u0645 \u0633\u062d\u0628 \u0647\u0630\u0627 \u0627\u0644\u062c\u0648\u0627\u0632.',
  },
  claimNote: {
    en: 'These figures are published sums. They are not a legal claim.',
    fr: 'Ces chiffres sont des sommes publi\u00e9es. Ils ne constituent pas une affirmation l\u00e9gale.',
    tr: 'Bu rakamlar yay\u0131mlanm\u0131\u015f toplamlard\u0131r. Yasal bir iddia de\u011fildir.',
    ar: '\u0647\u0630\u0647 \u0627\u0644\u0623\u0631\u0642\u0627\u0645 \u0645\u062c\u0627\u0645\u064a\u0639 \u0645\u0646\u0634\u0648\u0631\u0629 \u0648\u0644\u064a\u0633\u062a \u0627\u062f\u0639\u0627\u0621\u064b \u0642\u0627\u0646\u0648\u0646\u064a\u064b\u0627.',
  },
  language: { en: 'Language', fr: 'Language', tr: 'Language', ar: 'Language' },
};

export const passportGarmentNames: Record<Language, Record<keyof typeof GARMENT_NAMES, string>> = {
  en: { tshirt: 'T-shirt', shirt: 'Shirt', jeans: 'Jeans', coat: 'Coat' },
  fr: { tshirt: 'T-shirt', shirt: 'Chemise', jeans: 'Jean', coat: 'Manteau' },
  tr: { tshirt: 'Ti\u015f\u00f6rt', shirt: 'G\u00f6mlek', jeans: 'Kot pantolon', coat: 'Kaban' },
  ar: {
    tshirt: '\u0642\u0645\u064a\u0635 \u0642\u0635\u064a\u0631',
    shirt: '\u0642\u0645\u064a\u0635',
    jeans: '\u062c\u064a\u0646\u0632',
    coat: '\u0645\u0639\u0637\u0641',
  },
};

export const passportScore: Record<Language, (score: string, per100g: string) => string> = {
  en: (score, per100g) => `Score ${score} points (${per100g} per 100 g)`,
  fr: (score, per100g) => `Score ${score} points (${per100g} pour 100 g)`,
  tr: (score, per100g) => `Puan ${score} (100 g ba\u015f\u0131na ${per100g})`,
  ar: (score, per100g) =>
    `\u0627\u0644\u062f\u0631\u062c\u0629 ${score} \u0646\u0642\u0637\u0629 (${per100g} \u0644\u0643\u0644 100 \u063a)`,
};

export const passportEdition: Record<Language, (edition: number) => string> = {
  en: (edition) => `Edition ${edition}`,
  fr: (edition) => `\u00c9dition ${edition}`,
  tr: (edition) => `${edition}. s\u00fcr\u00fcm`,
  ar: (edition) => `\u0627\u0644\u0625\u0635\u062f\u0627\u0631 ${edition}`,
};

export const passportFactorEdition: Record<Language, (edition: string) => string> = {
  en: (edition) => `Factor edition ${edition}`,
  fr: (edition) => `\u00c9dition des facteurs ${edition}`,
  tr: (edition) => `Fakt\u00f6r s\u00fcr\u00fcm\u00fc ${edition}`,
  ar: (edition) => `\u0625\u0635\u062f\u0627\u0631 \u0627\u0644\u0639\u0648\u0627\u0645\u0644 ${edition}`,
};

export const passportDataQuality: Record<Language, (grade: string, percent: number) => string> = {
  en: (grade, percent) => `Data quality ${grade} (${percent}%)`,
  fr: (grade, percent) => `Qualit\u00e9 des donn\u00e9es ${grade} (${percent}%)`,
  tr: (grade, percent) => `Veri kalitesi ${grade} (%${percent})`,
  ar: (grade, percent) =>
    `\u062c\u0648\u062f\u0629 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a ${grade} (${percent}%)`,
};

export const passportCorrected: Record<Language, (date: string) => string> = {
  en: (date) => `Corrected ${date}`,
  fr: (date) => `Corrig\u00e9 le ${date}`,
  tr: (date) => `D\u00fczeltildi: ${date}`,
  ar: (date) => `\u0635\u064f\u062d\u0650\u0651\u062d \u0641\u064a ${date}`,
};

export const mailSubject: Record<'request' | 'reminder', Record<Language, (label: string) => string>> = {
  request: {
    en: (label) => `Facts needed for ${label}`,
    fr: (label) => `Informations demand\u00e9es pour ${label}`,
    tr: (label) => `${label} i\u00e7in bilgi talebi`,
    ar: (label) =>
      `\u0645\u0639\u0644\u0648\u0645\u0627\u062a \u0645\u0637\u0644\u0648\u0628\u0629 \u0645\u0646 \u0623\u062c\u0644 ${label}`,
  },
  reminder: {
    en: (label) => `Reminder: facts needed for ${label}`,
    fr: (label) => `Rappel : informations demand\u00e9es pour ${label}`,
    tr: (label) => `Hat\u0131rlatma: ${label} i\u00e7in bilgi talebi`,
    ar: (label) =>
      `\u062a\u0630\u0643\u064a\u0631: \u0645\u0639\u0644\u0648\u0645\u0627\u062a \u0645\u0637\u0644\u0648\u0628\u0629 \u0645\u0646 \u0623\u062c\u0644 ${label}`,
  },
};

export const mailGreeting: Record<Language, (contact: string) => string> = {
  en: (contact) => `Hello ${contact},`,
  fr: (contact) => `Bonjour ${contact},`,
  tr: (contact) => `Merhaba ${contact},`,
  ar: (contact) => `\u0645\u0631\u062d\u0628\u064b\u0627 ${contact}\u060c`,
};

export const mailAsk: Record<Language, (label: string, style: string) => string> = {
  en: (label, style) => `${label} asks you for facts about ${style}. Please answer on this private page:`,
  fr: (label, style) =>
    `${label} vous demande des informations sur ${style}. Merci de r\u00e9pondre sur cette page priv\u00e9e :`,
  tr: (label, style) =>
    `${label}, ${style} hakk\u0131nda bilgi istiyor. L\u00fctfen bu \u00f6zel sayfadan yan\u0131tlay\u0131n:`,
  ar: (label, style) =>
    `\u062a\u0637\u0644\u0628 \u0645\u0646\u0643 ${label} \u0645\u0639\u0644\u0648\u0645\u0627\u062a \u0639\u0646 ${style}. \u064a\u0631\u062c\u0649 \u0627\u0644\u0625\u062c\u0627\u0628\u0629 \u0641\u064a \u0647\u0630\u0647 \u0627\u0644\u0635\u0641\u062d\u0629 \u0627\u0644\u062e\u0627\u0635\u0629:`,
};
