// Screen copy for the client, in English. The answer and passport pages render their own
// languages from the server's copy tables.

export const UI = {
  working: `Working\u2026`,
  problems: `Problems`,
  close: `Close`,
  save: `Save`,
  cancel: `Cancel`,
  sessionEnded: `Your session ended. Sign in again to keep going \u2014 what you typed is still here.`,
  signInAgain: `Sign in again`,
  refreshFailed: `Couldn't refresh. Trying again.`,
  stylesShown: (n: number) => `${n} ${n === 1 ? "style" : "styles"} shown.`,
  added: (name: string) => `${name} added.`,
  removed: (name: string) => `${name} removed.`,
  saved: (name: string) => `${name} saved.`,
  moved: (name: string, p: number, t: number) => `${name} moved to position ${p} of ${t}.`,
  legAdded: `Transport leg added.`,
  legRemoved: `Transport leg removed.`,
  labelAdded: (name: string) => `Label ${name} added.`,
  labelRenamed: (name: string) => `Label renamed to ${name}.`,
  labelDeleted: (name: string) => `Label ${name} deleted.`,
  labelClosed: (name: string, date: string, time: string) =>
    `Label ${name} closed. It will be erased on ${date}, ${time} Lisbon time unless you bring it back.`,
  labelBack: (name: string) => `Label ${name} is back.`,
  visitBooked: (factory: string) => `Visit to ${factory} booked.`,
  readingRecorded: (meter: number) => `Reading for meter ${meter} recorded.`,
  requestSent: (supplier: string) => `Request sent to ${supplier}.`,
  newAddress: (supplier: string) => `New address sent to ${supplier}.`,
  pageEnded: (supplier: string) => `Page ended for ${supplier}.`,
  answerArrived: (supplier: string, time: string, town: string) => `${supplier} answered at ${time} ${town} time.`,
  footprintWorked: (edition: string) => `Footprint worked out with edition ${edition}.`,
  measureChosen: (measure: string, total: string, stage: string) => `${measure}: ${total}, hotspot ${stage}.`,
  noNewerFactors: `No newer factors.`,
  scenarioTotal: (total: string) => `Scenario climate total ${total}.`,
  scenarioSaved: (name: string) => `Scenario ${name} saved.`,
  published: (n: number) => `Passport edition ${n} published.`,
  withdrawn: (style: string) => `Passport for ${style} withdrawn.`,
  dossierReady: `Dossier ready.`,
  signOffSent: (contact: string) => `Sign-off page sent to ${contact}.`,
  signedOff: (name: string) => `Signed off by ${name}.`,
  downloaded: `Dossier downloaded.`,
  resultsDownloaded: `Results file downloaded.`,
  evidenceDownloaded: `Evidence downloaded.`,
  estimate: (figure: string) => figure,
  previewReady: (n: number, m: number, r: number) => `Preview ready: ${n} new, ${m} matched, ${r} refused.`,
  catalogueSaved: (n: number, m: number, r: number) => `Catalogue saved: ${n} new, ${m} matched, ${r} refused.`,
  archived: (name: string) => `Style ${name} archived.`,
  styleAdded: (name: string) => `Style ${name} added.`,
  duplicated: (name: string) => `Style ${name} added.`,
  passwordChanged: `Password changed.`,
  sent: `Sent`,
  keepMine: `Keep mine`,
  keepRecorded: `Keep recorded`,
} as const;

export const STAGE_NAMES: Record<string, string> = {
  materials: `Materials`,
  making: `Making`,
  transport: `Transport`,
  use: `Use`,
  endOfLife: `End of life`,
};

export const MEASURE_NAMES: Record<string, string> = {
  climate: `Climate`,
  water: `Water`,
  fossilEnergy: `Fossil energy`,
  landUse: `Land use`,
  freshwaterToxicity: `Freshwater toxicity`,
  microfibres: `Microfibres`,
};

export const STATE_NAMES: Record<string, string> = {
  draft: `Draft`,
  worked: `Worked`,
  published: `Published`,
  archived: `Archived`,
  open: `Open`,
  closed: `Closed`,
  erased: `Erased`,
  sent: `Sent`,
  reminded: `Reminded`,
  answered: `Answered`,
  ended: `Ended`,
  making: `Making`,
  ready: `Ready`,
  signedOff: `Signed off`,
  replaced: `Replaced`,
  withdrawn: `Withdrawn`,
};

export const GARMENT_NAMES: Record<string, string> = {
  tshirt: `T-shirt`,
  shirt: `Shirt`,
  jeans: `Jeans`,
  coat: `Coat`,
};

export const MODE_NAMES: Record<string, string> = {
  sea: `Sea`,
  road: `Road`,
  rail: `Rail`,
  air: `Air`,
};

export const COUNTRY_NAMES: Record<string, string> = {
  PT: `Portugal`,
  TR: `Turkey`,
  VN: `Vietnam`,
  EG: `Egypt`,
  IN: `India`,
  BD: `Bangladesh`,
};

export const TOWN_NAMES: Record<string, string> = {
  porto: `Porto`,
  izmir: `Izmir`,
  hoChiMinhCity: `Ho Chi Minh City`,
  cairo: `Cairo`,
};

export const STRIP_NAMES = [
  `Mar\u00E9 Alta`,
  `Linho & Sal`,
  `Atelier Noroeste`,
  `Kade Studio`,
  `Fio Norte`,
  `Serra Knit`,
  `Douro Denim`,
  `Cais Workwear`,
];
