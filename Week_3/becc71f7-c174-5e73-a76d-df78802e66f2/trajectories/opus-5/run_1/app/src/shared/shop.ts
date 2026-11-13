/** Atelier Ourlet itself. */
export const shop = {
  name: 'Atelier Ourlet',
  legalName: 'Atelier Ourlet SRL',
  address: `Rue de l'Ourlet 12, 1000 Brussels`,
  iban: 'BE68539007547034',
} as const;

export const MAX_PHOTOS_PER_PIECE = 6;
export const MAX_PHOTO_BYTES = 5_000_000;
export const MAX_PHOTO_BODY_BYTES = 6_000_000;
export const MAX_JSON_BYTES = 65_536;
export const MAX_SPREADSHEET_BYTES = 2_000_000;
export const MAX_PUBLIC_PHOTO_EDGE = 1_600;
export const SOLD_PIECE_LIFETIME_DAYS = 30;
export const RETURNS_SHELF_DAYS = 14;
export const SALES_BOOK_DOWNLOAD_LIMIT = 5;
export const APPOINTMENT_BOOKING_LIMIT = 3;
export const REFRESH_MS = 5_000;
export const SEARCH_PAUSE_MS = 300;
