import type { Locale } from './locale.js';
import { formatNumber } from './locale.js';

export type ErrorCode =
  | 'not_found'
  | 'method_not_allowed'
  | 'unsupported_media_type'
  | 'body_too_large'
  | 'unknown_parameter'
  | 'idempotency_key_required'
  | 'idempotency_key_invalid'
  | 'idempotency_key_reused'
  | 'cross_origin'
  | 'unauthenticated'
  | 'invalid_credentials'
  | 'invalid_api_key'
  | 'rate_limited'
  | 'forbidden'
  | 'not_in_plan'
  | 'password_required'
  | 'wrong_password'
  | 'illegal_transition'
  | 'not_ready'
  | 'not_deletable'
  | 'quota_reached'
  | 'read_only'
  | 'visibility_conflict'
  | 'not_failed'
  | 'already_in_collection'
  | 'plan_unchanged'
  | 'edition_sold_out'
  | 'edition_unavailable'
  | 'edition_locked'
  | 'upgrade_not_possible'
  | 'nothing_to_refund'
  | 'licence_refunded'
  | 'derivatives_rebuilding'
  | 'file_too_large'
  | 'content_mismatch'
  | 'unsupported_type'
  | 'type_not_in_plan'
  | 'validation_failed'
  | 'storage_unavailable'
  | 'search_unavailable'
  | 'billing_unavailable';

export interface ErrorParams {
  readonly name?: string;
  readonly seconds?: number;
  readonly from?: string;
  readonly to?: string;
  readonly limit?: number;
}

type Pair = readonly [en: string, de: string];

const ERROR_COPY: Readonly<Record<ErrorCode, Pair>> = {
  not_found: ['Not found.', 'Nicht gefunden.'],
  method_not_allowed: ['Method not allowed.', 'Methode nicht erlaubt.'],
  unsupported_media_type: [
    "This content type isn't accepted here.",
    'Dieser Inhaltstyp wird hier nicht angenommen.',
  ],
  body_too_large: ['This request is too large.', 'Diese Anfrage ist zu groß.'],
  unknown_parameter: ['Unknown parameter: <name>.', 'Unbekannter Parameter: <name>.'],
  idempotency_key_required: [
    'Add an Idempotency-Key header to this request.',
    'Füge dieser Anfrage einen Idempotency-Key-Header hinzu.',
  ],
  idempotency_key_invalid: [
    'The Idempotency-Key must be 8 to 64 letters, digits, - or _.',
    'Der Idempotency-Key muss aus 8 bis 64 Buchstaben, Ziffern, - oder _ bestehen.',
  ],
  idempotency_key_reused: [
    'This Idempotency-Key was already used with a different request.',
    'Dieser Idempotency-Key wurde bereits für eine andere Anfrage verwendet.',
  ],
  cross_origin: ['This request came from another site.', 'Diese Anfrage kam von einer anderen Website.'],
  unauthenticated: ['Sign in to continue.', 'Melde dich an, um fortzufahren.'],
  invalid_credentials: [
    "That email and password don't match.",
    'E-Mail und Passwort passen nicht zusammen.',
  ],
  invalid_api_key: ["This API key isn't valid.", 'Dieser API-Schlüssel ist ungültig.'],
  rate_limited: [
    'Too many requests. Retry after <seconds> seconds.',
    'Zu viele Anfragen. Versuche es in <seconds> Sekunden erneut.',
  ],
  forbidden: ["You don't have access to this.", 'Darauf hast du keinen Zugriff.'],
  not_in_plan: ["Your plan doesn't include this.", 'Dein Tarif enthält das nicht.'],
  password_required: ['This model is password protected.', 'Dieses Modell ist passwortgeschützt.'],
  wrong_password: ["That password doesn't match.", 'Das Passwort stimmt nicht.'],
  illegal_transition: [
    "A model that is <from> can't become <to>.",
    'Ein Modell im Status <from> kann nicht zu <to> wechseln.',
  ],
  not_ready: [
    'This model has no finished files to publish yet.',
    'Dieses Modell hat noch keine fertigen Dateien zum Veröffentlichen.',
  ],
  not_deletable: ['Only a draft can be deleted.', 'Nur ein Entwurf kann gelöscht werden.'],
  quota_reached: [
    "You've used all <limit> publishes for this billing cycle.",
    'Du hast alle <limit> Veröffentlichungen dieses Abrechnungszeitraums genutzt.',
  ],
  read_only: [
    "This model is over your plan's limit and is read-only.",
    'Dieses Modell liegt über dem Limit deines Tarifs und ist schreibgeschützt.',
  ],
  visibility_conflict: [
    'Embeds work only for public or unlisted models.',
    'Einbettungen funktionieren nur für öffentliche oder nicht gelistete Modelle.',
  ],
  not_failed: [
    'Only a failed upload can be requeued.',
    'Nur ein fehlgeschlagener Upload kann erneut eingereiht werden.',
  ],
  already_in_collection: [
    'This model is already in that collection.',
    'Dieses Modell ist bereits in dieser Sammlung.',
  ],
  plan_unchanged: ["You're already on this plan.", 'Du nutzt diesen Tarif bereits.'],
  edition_sold_out: [
    'Someone else just claimed the last copy. This edition is sold out.',
    'Jemand anderes hat gerade das letzte Exemplar erhalten. Diese Edition ist ausverkauft.',
  ],
  edition_unavailable: [
    "This edition isn't on sale right now.",
    'Diese Edition ist gerade nicht im Verkauf.',
  ],
  edition_locked: [
    "The edition size can't change after the first sale.",
    'Die Editionsgröße kann nach dem ersten Verkauf nicht mehr geändert werden.',
  ],
  upgrade_not_possible: [
    "This licence can't be upgraded to that one.",
    'Diese Lizenz kann nicht auf diese Lizenz erweitert werden.',
  ],
  nothing_to_refund: [
    'Nothing is left to refund on this order.',
    'Für diese Bestellung ist nichts mehr zu erstatten.',
  ],
  licence_refunded: [
    'This licence was refunded, so its files are no longer available.',
    'Diese Lizenz wurde erstattet, ihre Dateien sind nicht mehr verfügbar.',
  ],
  derivatives_rebuilding: [
    "This model's files are being rebuilt. Try again in a few minutes.",
    'Die Dateien dieses Modells werden neu erstellt. Versuche es in ein paar Minuten noch einmal.',
  ],
  file_too_large: [
    'This file is larger than your plan allows (<limit> bytes).',
    'Diese Datei ist größer, als dein Tarif erlaubt (<limit> Bytes).',
  ],
  content_mismatch: [
    "This file is named .glb but isn't a glTF binary.",
    'Diese Datei heißt .glb, ist aber kein glTF-Binary.',
  ],
  unsupported_type: [
    "This file isn't a glTF binary or a glTF package.",
    'Diese Datei ist weder ein glTF-Binary noch ein glTF-Paket.',
  ],
  type_not_in_plan: [
    'Your plan accepts .glb files only.',
    'Dein Tarif akzeptiert nur .glb-Dateien.',
  ],
  validation_failed: ['Check the highlighted fields.', 'Prüfe die markierten Felder.'],
  storage_unavailable: [
    'File storage is unavailable right now. Try again shortly.',
    'Der Dateispeicher ist gerade nicht erreichbar. Versuche es gleich noch einmal.',
  ],
  search_unavailable: [
    'Search is unavailable right now. Try again shortly.',
    'Die Suche ist gerade nicht erreichbar. Versuche es gleich noch einmal.',
  ],
  billing_unavailable: [
    'Billing is unavailable right now. Nothing has been charged or changed.',
    'Die Abrechnung ist gerade nicht erreichbar. Es wurde nichts berechnet oder geändert.',
  ],
};

/** State labels used inside `illegal_transition` copy. */
const STATE_LABEL_INLINE: Readonly<Record<string, Pair>> = {
  draft: ['draft', 'Entwurf'],
  in_review: ['in review', 'In Prüfung'],
  published: ['published', 'Veröffentlicht'],
  withdrawn: ['withdrawn', 'Zurückgezogen'],
};

export function stateLabelInline(state: string, locale: Locale): string {
  const pair = STATE_LABEL_INLINE[state];
  if (pair === undefined) return state;
  return locale === 'de' ? pair[1] : pair[0];
}

export function errorMessage(code: ErrorCode, locale: Locale, params: ErrorParams = {}): string {
  const pair = ERROR_COPY[code];
  let text = locale === 'de' ? pair[1] : pair[0];
  if (params.name !== undefined) text = text.replace('<name>', params.name);
  if (params.seconds !== undefined) text = text.replace('<seconds>', String(params.seconds));
  if (params.from !== undefined) text = text.replace('<from>', stateLabelInline(params.from, locale));
  if (params.to !== undefined) text = text.replace('<to>', stateLabelInline(params.to, locale));
  if (params.limit !== undefined) {
    // `file_too_large` states plain digits with no separators; `quota_reached`
    // is a count and follows the locale's plain-number format.
    const limit =
      code === 'file_too_large' ? String(params.limit) : formatNumber(params.limit, locale);
    text = text.replace('<limit>', limit);
  }
  return text;
}

/** Each distinct field message, keyed by its own name; `field` is what the API reports. */
export type FieldCopyKey =
  | 'title'
  | 'description'
  | 'email'
  | 'terms'
  | 'password'
  | 'price'
  | 'discount'
  | 'camera'
  | 'hotspots'
  | 'file_path_escape'
  | 'file_texture_content'
  | 'file_missing'
  | 'file_package_contents'
  | 'seats'
  | 'name'
  | 'choose_one'
  | 'page'
  | 'q'
  | 'edition_total'
  | 'lookup'
  | 'unknown';

const FIELD_COPY: Readonly<Record<FieldCopyKey, Pair>> = {
  title: [
    'Enter a title of 1 to 120 characters.',
    'Gib einen Titel mit 1 bis 120 Zeichen ein.',
  ],
  description: [
    'Keep the description to 2000 characters.',
    'Die Beschreibung darf höchstens 2000 Zeichen haben.',
  ],
  email: ['Enter a valid email address.', 'Gib eine gültige E-Mail-Adresse ein.'],
  terms: [
    'Accept the licence terms to continue.',
    'Akzeptiere die Lizenzbedingungen, um fortzufahren.',
  ],
  password: ['Use 8 to 64 characters.', 'Verwende 8 bis 64 Zeichen.'],
  price: [
    'Enter a price from 1.00 to 1000.00 euros.',
    'Gib einen Preis von 1,00 bis 1000,00 Euro ein.',
  ],
  discount: ['Enter a whole number from 0 to 90.', 'Gib eine ganze Zahl von 0 bis 90 ein.'],
  camera: [
    "Keep the camera within the viewer's limits.",
    'Halte die Kamera innerhalb der Grenzen der Ansicht.',
  ],
  hotspots: [
    "Use up to 8 hotspots inside the model's bounds, each labelled with 1 to 60 characters.",
    'Verwende bis zu 8 Hotspots innerhalb des Modells mit je 1 bis 60 Zeichen Beschriftung.',
  ],
  file_path_escape: [
    'The package contains a path outside its folder.',
    'Das Paket enthält einen Pfad außerhalb seines Ordners.',
  ],
  file_texture_content: [
    'Every file in a texture set must be a PNG or JPEG image.',
    'Jede Datei in einem Texturset muss ein PNG- oder JPEG-Bild sein.',
  ],
  file_missing: ['Choose a file to upload.', 'Wähle eine Datei zum Hochladen aus.'],
  file_package_contents: [
    'A glTF package needs exactly one .gltf file and every file it references.',
    'Ein glTF-Paket braucht genau eine .gltf-Datei und alle Dateien, auf die sie verweist.',
  ],
  seats: [
    'Choose fewer seats than the licence still holds.',
    'Wähle weniger Plätze, als die Lizenz noch hat.',
  ],
  name: [
    'Use 1 to 60 characters that no other collection or key uses.',
    'Verwende 1 bis 60 Zeichen, die keine andere Sammlung und kein anderer Schlüssel nutzt.',
  ],
  choose_one: ['Choose one of the listed values.', 'Wähle einen der angebotenen Werte.'],
  page: ['Use a whole number of 1 or more.', 'Verwende eine ganze Zahl ab 1.'],
  q: ['Keep the search to 100 characters.', 'Die Suche darf höchstens 100 Zeichen haben.'],
  edition_total: [
    'Use a whole number from 1 to 500.',
    'Verwende eine ganze Zahl von 1 bis 500.',
  ],
  lookup: [
    'Give either an email or an order reference.',
    'Gib entweder eine E-Mail-Adresse oder eine Bestellnummer an.',
  ],
  unknown: ['Unknown field.', 'Unbekanntes Feld.'],
};

export function fieldMessage(key: FieldCopyKey, locale: Locale): string {
  const pair = FIELD_COPY[key];
  return locale === 'de' ? pair[1] : pair[0];
}

/** Maps the English field message the API reports back to its locale copy. */
const FIELD_COPY_BY_EN: ReadonlyMap<string, FieldCopyKey> = new Map(
  (Object.entries(FIELD_COPY) as [FieldCopyKey, Pair][]).map(([key, pair]) => [pair[0], key]),
);

export function fieldMessageFromEnglish(english: string, locale: Locale): string {
  const key = FIELD_COPY_BY_EN.get(english);
  return key === undefined ? english : fieldMessage(key, locale);
}

export const ERROR_SUMMARY_TITLE: Pair = ["There's a problem", 'Es gibt ein Problem'];
