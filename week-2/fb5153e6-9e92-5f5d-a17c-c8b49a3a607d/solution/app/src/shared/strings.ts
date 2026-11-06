import type { Locale } from './locale.js';
import { formatNumber } from './locale.js';

type Pair = readonly [en: string, de: string];

/** Every published accessible name and fixed label, English then German. */
const S = {
  wordmark: ['Turnstone Studio', 'Turnstone Studio'],
  catalogueLink: ['Catalogue', 'Katalog'],
  language: ['Language', 'Sprache'],
  english: ['English', 'English'],
  german: ['Deutsch', 'Deutsch'],
  signIn: ['Sign in', 'Anmelden'],
  signOut: ['Sign out', 'Abmelden'],
  areaStudio: ['Studio', 'Studio'],
  areaContribute: ['Contribute', 'Beitragen'],
  areaStaff: ['Staff', 'Support'],
  serviceStatus: ['Service status', 'Dienststatus'],

  catalogueHeading: ['Catalogue', 'Katalog'],
  searchModels: ['Search models', 'Modelle suchen'],
  groupCategory: ['Category', 'Kategorie'],
  groupLicence: ['Licence', 'Lizenz'],
  groupFormat: ['Format', 'Format'],
  catHardSurface: ['Hard-surface prop', 'Hard-Surface-Requisite'],
  catMiniature: ['Miniature', 'Miniatur'],
  catScan: ['Scanned object', 'Gescanntes Objekt'],
  licPersonal: ['Personal', 'Privat'],
  licCommercial: ['Commercial', 'Kommerziell'],
  licStudio: ['Studio', 'Studio'],
  fmtGlb: ['GLB', 'GLB'],
  fmtStl: ['STL', 'STL'],
  sort: ['Sort', 'Sortierung'],
  sortNewest: ['Newest', 'Neueste'],
  sortPriceAsc: ['Price: low to high', 'Preis aufsteigend'],
  sortPriceDesc: ['Price: high to low', 'Preis absteigend'],
  catalogueResults: ['Catalogue results', 'Katalogergebnisse'],
  results: ['Results', 'Ergebnisse'],
  pages: ['Pages', 'Seiten'],
  previousPage: ['Previous page', 'Vorherige Seite'],
  nextPage: ['Next page', 'Nächste Seite'],
  filters: ['Filters', 'Filter'],
  showResults: ['Show results', 'Ergebnisse anzeigen'],
  fromPrice: ['from', 'ab'],

  modelViewer: ['Model viewer', 'Modellansicht'],
  surveyRing: ['Survey Ring', 'Messring'],
  headingStrip: ['Heading strip', 'Kursleiste'],
  cameraReadout: ['Camera readout', 'Kamerawerte'],
  readoutDistance: ['Distance', 'Abstand'],
  readoutFov: ['FOV', 'Blickwinkel'],
  readoutTilt: ['Tilt', 'Neigung'],
  readoutAzimuth: ['Azimuth', 'Azimut'],
  previousHotspot: ['Previous hotspot', 'Vorheriger Hotspot'],
  nextHotspot: ['Next hotspot', 'Nächster Hotspot'],
  firstPerson: ['First-person view', 'Ich-Perspektive'],
  resetView: ['Reset view', 'Ansicht zurücksetzen'],
  viewerAnnouncements: ['Viewer announcements', 'Ansichtsmeldungen'],
  viewerFallback: [
    "Your browser can't draw the 3D view here, so this is the rendered preview.",
    'Dein Browser kann die 3D-Ansicht hier nicht darstellen, deshalb siehst du die gerenderte Vorschau.',
  ],
  previewRebuilding: ['Preview rebuilding', 'Vorschau wird neu erstellt'],
  licences: ['Licences', 'Lizenzen'],
  buyPersonal: ['Buy Personal licence', 'Privatlizenz kaufen'],
  buyCommercial: ['Buy Commercial licence', 'Kommerzielle Lizenz kaufen'],
  buyStudio: ['Buy Studio licence', 'Studiolizenz kaufen'],
  buyEdition: ['Buy numbered copy', 'Nummeriertes Exemplar kaufen'],
  specifications: ['Specifications', 'Technische Daten'],
  editionAvailability: ['Edition availability', 'Verfügbarkeit der Edition'],
  moreFromWorkshop: ['More from the workshop', 'Mehr aus der Werkstatt'],
  soldOut: ['Sold out', 'Ausverkauft'],
  specWidth: ['Width', 'Breite'],
  specHeight: ['Height', 'Höhe'],
  specDepth: ['Depth', 'Tiefe'],
  specFormats: ['Formats', 'Formate'],
  specScale: ['Figure scale', 'Figurenmaßstab'],
  specEdition: ['Edition', 'Edition'],
  colLicence: ['Licence', 'Lizenz'],
  colSeats: ['Seats', 'Plätze'],
  colPrice: ['Price', 'Preis'],

  checkout: ['Checkout', 'Kasse'],
  email: ['Email', 'E-Mail'],
  acceptTerms: ['I accept the licence terms', 'Ich akzeptiere die Lizenzbedingungen'],
  payNow: ['Pay now', 'Jetzt bezahlen'],
  cancel: ['Cancel', 'Abbrechen'],
  checkoutStatus: ['Checkout status', 'Kassenstatus'],
  processingPayment: ['Processing payment', 'Zahlung wird verarbeitet'],

  password: ['Password', 'Passwort'],
  unlock: ['Unlock', 'Entsperren'],

  downloadGlb: ['Download GLB', 'GLB herunterladen'],
  downloadStl: ['Download STL', 'STL herunterladen'],
  invoicePdf: ['Invoice PDF', 'Rechnung (PDF)'],
  upgradeToCommercial: ['Upgrade to Commercial', 'Auf Kommerziell upgraden'],
  upgradeToStudio: ['Upgrade to Studio', 'Auf Studio upgraden'],

  studio: ['Studio', 'Studio'],
  studioMenu: ['Studio menu', 'Studiomenü'],
  navDashboard: ['Dashboard', 'Übersicht'],
  navUpload: ['Upload', 'Hochladen'],
  navReview: ['Review', 'Prüfung'],
  navCollections: ['Collections', 'Sammlungen'],
  navPlan: ['Plan', 'Tarif'],
  navApiKeys: ['API keys', 'API-Schlüssel'],
  navExport: ['Export', 'Export'],
  quota: ['Quota', 'Kontingent'],
  catalogueTotals: ['Catalogue totals', 'Katalogsummen'],
  totalPublic: ['Public', 'Öffentlich'],
  totalUnlisted: ['Unlisted', 'Nicht gelistet'],
  totalPassword: ['Password', 'Passwort'],
  totalPrivate: ['Private', 'Privat'],
  totalDrafts: ['Drafts', 'Entwürfe'],
  totalInReview: ['In review', 'In Prüfung'],
  totalWithdrawn: ['Withdrawn', 'Zurückgezogen'],
  models: ['Models', 'Modelle'],
  queue: ['Queue', 'Warteschlange'],
  studioNotices: ['Studio notices', 'Studiohinweise'],
  colTitle: ['Title', 'Titel'],
  colState: ['State', 'Status'],
  colVisibility: ['Visibility', 'Sichtbarkeit'],
  colPriceFrom: ['Price from', 'Preis ab'],
  colQueue: ['Queue', 'Warteschlange'],
  colSubmitter: ['Submitter', 'Eingereicht von'],

  modelFile: ['Model file', 'Modelldatei'],
  title: ['Title', 'Titel'],
  description: ['Description', 'Beschreibung'],
  sourceUnit: ['Source unit', 'Quelleinheit'],
  unitMm: ['Millimetres', 'Millimeter'],
  unitCm: ['Centimetres', 'Zentimeter'],
  unitM: ['Metres', 'Meter'],
  unitIn: ['Inches', 'Zoll'],
  category: ['Category', 'Kategorie'],
  upload: ['Upload', 'Hochladen'],
  uploadProgress: ['Upload progress', 'Upload-Fortschritt'],

  queueStages: ['Queue stages', 'Warteschlangenschritte'],
  requeue: ['Requeue', 'Erneut einreihen'],
  queueProgress: ['Queue progress', 'Warteschlangenfortschritt'],
  queueStarted: [
    'Upload received. Queue work has started.',
    'Upload erhalten. Die Verarbeitung hat begonnen.',
  ],
  queueAllConfirmed: [
    'All stages confirmed. Files are ready.',
    'Alle Schritte bestätigt. Die Dateien sind bereit.',
  ],
  queueRequeued: ['Upload requeued.', 'Upload erneut eingereiht.'],
  queueValidateFailed: [
    "Validate failed. The package couldn't be read as a 3D model.",
    'Prüfen fehlgeschlagen. Das Paket konnte nicht als 3D-Modell gelesen werden.',
  ],
  attempts: ['Attempts', 'Versuche'],
  nextRetry: ['Next retry', 'Nächster Versuch'],

  sendToReview: ['Send to review', 'Zur Prüfung senden'],
  returnToDraft: ['Return to draft', 'Zurück zum Entwurf'],
  publish: ['Publish', 'Veröffentlichen'],
  withdraw: ['Withdraw', 'Zurückziehen'],
  visibility: ['Visibility', 'Sichtbarkeit'],
  visPublic: ['Public', 'Öffentlich'],
  visUnlisted: ['Unlisted', 'Nicht gelistet'],
  visPrivate: ['Private', 'Privat'],
  visPassword: ['Password protected', 'Passwortgeschützt'],
  saveChanges: ['Save changes', 'Änderungen speichern'],
  newShareLink: ['New share link', 'Neuer Freigabelink'],
  createEmbed: ['Create embed', 'Einbettung erstellen'],
  removeEmbed: ['Remove embed', 'Einbettung entfernen'],
  replaceSource: ['Replace source', 'Quelle ersetzen'],
  downloadOriginal: ['Download original', 'Original herunterladen'],
  saveDefaultView: ['Save as default view', 'Als Standardansicht speichern'],
  addHotspot: ['Add hotspot', 'Hotspot hinzufügen'],
  hotspotLabel: ['Hotspot label', 'Hotspot-Beschriftung'],
  saveHotspots: ['Save hotspots', 'Hotspots speichern'],
  readOnly: ['Read-only', 'Schreibgeschützt'],
  readOnlyOnPlan: ['Read-only on your plan', 'Schreibgeschützt in deinem Tarif'],
  pricePersonal: ['Personal price', 'Preis Privat'],
  priceCommercial: ['Commercial price', 'Preis Kommerziell'],
  priceStudio: ['Studio price', 'Preis Studio'],
  discountPercent: ['Discount percent', 'Rabatt in Prozent'],
  editionTotal: ['Edition size', 'Editionsgröße'],
  editionPrice: ['Edition price', 'Editionspreis'],
  shareLink: ['Share link', 'Freigabelink'],
  embeds: ['Embeds', 'Einbettungen'],

  collectionName: ['Collection name', 'Name der Sammlung'],
  createCollection: ['Create collection', 'Sammlung erstellen'],
  deleteCollection: ['Delete collection', 'Sammlung löschen'],
  addToCollection: ['Add to collection', 'Zur Sammlung hinzufügen'],
  moveTo: ['Move to collection', 'In Sammlung verschieben'],

  planHeading: ['Plan', 'Tarif'],
  plans: ['Plans', 'Tarife'],
  changePlan: ['Change plan', 'Tarif ändern'],
  confirmChange: ['Confirm change', 'Änderung bestätigen'],
  planMonthly: ['Monthly price', 'Monatspreis'],
  planPackage: ['Max package', 'Max. Paket'],
  planPublishes: ['Publishes per cycle', 'Veröffentlichungen pro Zeitraum'],
  planModels: ['Published models', 'Veröffentlichte Modelle'],
  planEmbeds: ['Embeds', 'Einbettungen'],
  planEditions: ['Limited editions', 'Limitierte Editionen'],
  planKeys: ['Read API keys', 'Lese-API-Schlüssel'],
  yes: ['yes', 'ja'],
  no: ['no', 'nein'],
  noLimit: ['no limit', 'kein Limit'],

  downloadCsv: ['Download catalogue CSV', 'Katalog-CSV herunterladen'],

  keyName: ['Key name', 'Schlüsselname'],
  createKey: ['Create key', 'Schlüssel erstellen'],
  colReference: ['Reference', 'Referenz'],
  colCreated: ['Created', 'Erstellt'],

  textureSetName: ['Texture set name', 'Name des Textursets'],
  textureArchive: ['Texture archive', 'Texturarchiv'],
  draft: ['Draft', 'Entwurf'],
  submitTextureSet: ['Submit texture set', 'Texturset einreichen'],
  contributeHeading: ['Contribute', 'Beitragen'],
  yourModels: ['Your models', 'Deine Modelle'],

  findOrders: ['Find orders', 'Bestellungen finden'],
  orders: ['Orders', 'Bestellungen'],
  refundInFull: ['Refund in full', 'Vollständig erstatten'],
  seatsToRefund: ['Seats to refund', 'Zu erstattende Plätze'],
  refundSeats: ['Refund seats', 'Plätze erstatten'],
  serviceHealth: ['Service health', 'Dienstzustand'],
  staffNotices: ['Staff notices', 'Mitarbeiterhinweise'],
  staffHeading: ['Staff', 'Support'],
  issuingRefund: ['Issuing refund', 'Erstattung läuft'],
  colOrder: ['Order', 'Bestellung'],
  colAmount: ['Amount', 'Betrag'],
  colRefunded: ['Refunded', 'Erstattet'],
  colStatus: ['Status', 'Status'],
  colModel: ['Model', 'Modell'],

  stageValidate: ['Validate', 'Prüfen'],
  stageTranscode: ['Transcode', 'Umwandeln'],
  stagePreview: ['Render preview', 'Vorschau rendern'],
  stageIndex: ['Index', 'Indexieren'],
  stagePublish: ['Publish', 'Bereitstellen'],
  statusPending: ['Pending', 'Wartend'],
  statusRunning: ['Running', 'Läuft'],
  statusConfirmed: ['Confirmed', 'Bestätigt'],
  statusFailed: ['Failed', 'Fehlgeschlagen'],

  orderPaid: ['Paid', 'Bezahlt'],
  orderPartiallyRefunded: ['Partially refunded', 'Teilweise erstattet'],
  orderRefunded: ['Refunded', 'Erstattet'],

  svcDatabase: ['Database', 'Datenbank'],
  svcStorage: ['Storage', 'Speicher'],
  svcSearch: ['Search', 'Suche'],
  svcBilling: ['Billing', 'Abrechnung'],
  svcMail: ['Mail', 'Mail'],
  svcUp: ['Up', 'Aktiv'],
  svcDown: ['Down', 'Gestört'],

  stateDraft: ['Draft', 'Entwurf'],
  stateInReview: ['In review', 'In Prüfung'],
  statePublished: ['Published', 'Veröffentlicht'],
  stateWithdrawn: ['Withdrawn', 'Zurückgezogen'],
  queueInProgress: ['In progress', 'In Arbeit'],
  queueCompleted: ['Completed', 'Abgeschlossen'],
  queueFailed: ['Failed', 'Fehlgeschlagen'],
  queueNone: ['None', 'Keine'],

  noticeSaved: ['Changes saved.', 'Änderungen gespeichert.'],
  noticeSaving: ['Saving', 'Wird gespeichert'],
  noticeShareLink: [
    'New share link ready. The old link no longer works.',
    'Neuer Freigabelink bereit. Der alte Link funktioniert nicht mehr.',
  ],
  noticeEmbedCreated: ['Embed created.', 'Einbettung erstellt.'],
  noticeEmbedRemoved: ['Embed removed.', 'Einbettung entfernt.'],
  noticeCollectionDeleted: ['Collection deleted.', 'Sammlung gelöscht.'],
  noticeKeyCreated: [
    "Key created. Copy it now; it won't be shown again.",
    'Schlüssel erstellt. Kopiere ihn jetzt; er wird nicht noch einmal angezeigt.',
  ],
  noticeKeyRevoked: ['Key revoked.', 'Schlüssel widerrufen.'],
  noticeTextureSet: ['Texture set submitted.', 'Texturset eingereicht.'],
  noticePlanPending: ['Changing plan', 'Tarif wird geändert'],

  embedUnavailable: ['This embed is no longer available.', 'Diese Einbettung ist nicht mehr verfügbar.'],
  shareDead: ['This link is no longer available.', 'Dieser Link ist nicht mehr verfügbar.'],
  backToModel: ['Open the model page', 'Zur Modellseite'],

  bannerStudioSearch: [
    'Search is unavailable. Index work is waiting and will retry on schedule.',
    'Die Suche ist nicht erreichbar. Die Indexierung wartet und wird planmäßig wiederholt.',
  ],
  bannerStudioStorage: [
    'File storage is unavailable. Uploads are paused and queue work will retry on schedule.',
    'Der Dateispeicher ist nicht erreichbar. Uploads sind pausiert, die Verarbeitung wird planmäßig wiederholt.',
  ],
  bannerStudioBilling: [
    'Billing is unavailable. Showing the plan last confirmed by billing.',
    'Die Abrechnung ist nicht erreichbar. Angezeigt wird der zuletzt bestätigte Tarif.',
  ],

  signInHeading: ['Sign in', 'Anmelden'],
  reviewHeading: ['Review', 'Prüfung'],
  collectionsHeading: ['Collections', 'Sammlungen'],
  apiKeysHeading: ['API keys', 'API-Schlüssel'],
  exportHeading: ['Export', 'Export'],
  uploadHeading: ['Upload', 'Hochladen'],
  queueHeading: ['Queue', 'Warteschlange'],
  dashboardHeading: ['Dashboard', 'Übersicht'],
  receiptHeading: ['Receipt', 'Beleg'],
  goToYourArea: ['Go to your area', 'Zu deinem Bereich'],
} as const satisfies Record<string, Pair>;

export type StringKey = keyof typeof S;

export function s(key: StringKey, locale: Locale): string {
  const pair: Pair = S[key];
  return locale === 'de' ? pair[1] : pair[0];
}

/* Parameterised copy. */

export function catalogueResultCount(n: number, locale: Locale): string {
  if (n === 0) return locale === 'de' ? 'Keine Modelle gefunden' : 'No models match';
  if (n === 1) return locale === 'de' ? '1 Modell gefunden' : '1 model matches';
  const num = formatNumber(n, locale);
  return locale === 'de' ? `${num} Modelle gefunden` : `${num} models match`;
}

export function pageLabel(n: number, locale: Locale): string {
  return locale === 'de' ? `Seite ${n}` : `Page ${n}`;
}

export function hotspotAnnouncement(
  index: number,
  total: number,
  label: string,
  locale: Locale,
): string {
  return locale === 'de'
    ? `Hotspot ${index} von ${total}: ${label}`
    : `Hotspot ${index} of ${total}: ${label}`;
}

export function renderedPreviewAlt(title: string, locale: Locale): string {
  return locale === 'de' ? `Gerenderte Vorschau von ${title}` : `Rendered preview of ${title}`;
}

export function stageConfirmed(stageName: string, locale: Locale): string {
  return locale === 'de' ? `${stageName} bestätigt.` : `${stageName} confirmed.`;
}

export function stageWillRetry(
  stageName: string,
  attempt: number,
  total: number,
  seconds: number,
  locale: Locale,
): string {
  return locale === 'de'
    ? `${stageName} fehlgeschlagen. Neuer Versuch ${attempt} von ${total} in ${seconds} Sekunden.`
    : `${stageName} failed. Retry ${attempt} of ${total} in ${seconds} seconds.`;
}

export function stageOutOfRetries(stageName: string, locale: Locale): string {
  return locale === 'de'
    ? `${stageName} fehlgeschlagen. Keine Versuche mehr.`
    : `${stageName} failed. No retries left.`;
}

export function uploadingPercent(percent: number, locale: Locale): string {
  return locale === 'de' ? `Wird hochgeladen ${percent} %` : `Uploading ${percent}%`;
}

export function copiesLeft(remaining: number, total: number, locale: Locale): string {
  return locale === 'de'
    ? `${formatNumber(remaining, locale)} von ${formatNumber(total, locale)} Exemplaren übrig`
    : `${formatNumber(remaining, locale)} of ${formatNumber(total, locale)} copies left`;
}

export function editionCopyLine(n: number, total: number, locale: Locale): string {
  return locale === 'de' ? `Nr. ${n} von ${total}` : `No. ${n} of ${total}`;
}

export function totalLine(amount: string, locale: Locale): string {
  return locale === 'de' ? `Summe ${amount}` : `Total ${amount}`;
}

export function refundedLine(amount: string, locale: Locale): string {
  return locale === 'de' ? `Erstattet ${amount}` : `Refunded ${amount}`;
}

export function receiptHeadingText(orderRef: string, locale: Locale): string {
  return locale === 'de' ? `Beleg ${orderRef}` : `Receipt ${orderRef}`;
}

export function movedToState(stateLabel: string, locale: Locale): string {
  return locale === 'de' ? `Verschoben nach ${stateLabel}.` : `Moved to ${stateLabel}.`;
}

export function addedToCollection(name: string, locale: Locale): string {
  return locale === 'de' ? `Zu ${name} hinzugefügt.` : `Added to ${name}.`;
}

export function modelMovedToCollection(name: string, locale: Locale): string {
  return locale === 'de' ? `Modell nach ${name} verschoben.` : `Model moved to ${name}.`;
}

export function removedFromCollection(name: string, locale: Locale): string {
  return locale === 'de' ? `Aus ${name} entfernt.` : `Removed from ${name}.`;
}

export function downgradeAccepted(plan: string, date: string, locale: Locale): string {
  return locale === 'de'
    ? `Dein Tarif wechselt am ${date} zu ${plan}.`
    : `Your plan changes to ${plan} on ${date}.`;
}

export function upgradeDone(plan: string, amount: string, locale: Locale): string {
  return locale === 'de'
    ? `Du nutzt jetzt ${plan}. Heute berechnet: ${amount}.`
    : `You're now on ${plan}. Charged today: ${amount}.`;
}

export function pendingChangeLine(plan: string, date: string, locale: Locale): string {
  return locale === 'de' ? `Wechselt am ${date} zu ${plan}` : `Changes to ${plan} on ${date}`;
}

export function quotaLimited(
  used: number,
  limit: number,
  date: string,
  locale: Locale,
): string {
  return locale === 'de'
    ? `${formatNumber(used, locale)} von ${formatNumber(limit, locale)} Veröffentlichungen · neu ab ${date}`
    : `${formatNumber(used, locale)} of ${formatNumber(limit, locale)} publishes · resets ${date}`;
}

export function quotaUnlimited(used: number, locale: Locale): string {
  return locale === 'de'
    ? `${formatNumber(used, locale)} Veröffentlichungen · kein Limit`
    : `${formatNumber(used, locale)} publishes · no limit`;
}

export function refundDone(amount: string, orderRef: string, locale: Locale): string {
  return locale === 'de'
    ? `${amount} für ${orderRef} erstattet.`
    : `Refunded ${amount} on ${orderRef}.`;
}

export function switchToPlan(plan: string, locale: Locale): string {
  return locale === 'de' ? `Zu ${plan} wechseln` : `Switch to ${plan}`;
}

export function revokeKey(name: string, locale: Locale): string {
  return locale === 'de' ? `${name} widerrufen` : `Revoke ${name}`;
}

export function moveModel(title: string, locale: Locale): string {
  return locale === 'de' ? `${title} verschieben` : `Move ${title}`;
}

export function removeModel(title: string, locale: Locale): string {
  return locale === 'de' ? `${title} entfernen` : `Remove ${title}`;
}

export function collectionRegionName(name: string, count: number): string {
  return `${name} (${count})`;
}

export function queueCountLine(
  kind: 'pending' | 'running' | 'failed',
  n: number,
  locale: Locale,
): string {
  const key = kind === 'pending' ? 'statusPending' : kind === 'running' ? 'statusRunning' : 'statusFailed';
  return `${s(key, locale)} ${formatNumber(n, locale)}`;
}
