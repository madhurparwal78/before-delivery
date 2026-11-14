/** This tab's session storage: the enquiry draft and where the gallery last was. */

export const DRAFT_KEY = "vo.enquiry-draft";
const GALLERY_KEY = "vo.gallery-address";

export function readJson<T>(key: string): T | null {
  try {
    const text = sessionStorage.getItem(key);
    return text === null ? null : (JSON.parse(text) as T);
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): void {
  sessionStorage.setItem(key, JSON.stringify(value));
}

export function lastGalleryAddress(): string {
  return sessionStorage.getItem(GALLERY_KEY) ?? "/work";
}

export function rememberGalleryAddress(address: string): void {
  sessionStorage.setItem(GALLERY_KEY, address);
}

/** The tile the visitor opened, kept in memory only until they leave the work pages. */
let openedTile: string | null = null;

export function rememberOpenedTile(slug: string): void {
  openedTile = slug;
}

export function forgetOpenedTile(): void {
  openedTile = null;
}

export function takeOpenedTile(): string | null {
  const slug = openedTile;
  openedTile = null;
  return slug;
}
