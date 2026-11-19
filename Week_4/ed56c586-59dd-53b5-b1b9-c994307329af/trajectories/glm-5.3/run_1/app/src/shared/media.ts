import { FRAME_KEYS_PER_PROJECT, PROJECTS, coverKey, frameKey } from "./domain.js";

/** Media manifest: the single list of published objects, in manifest order. */
export const MEDIA_KEYS: string[] = (() => {
  const keys: string[] = [];
  for (const project of PROJECTS) {
    keys.push(coverKey(project.slug));
    for (let frame = 1; frame <= FRAME_KEYS_PER_PROJECT; frame += 1) {
      keys.push(frameKey(project.slug, frame));
    }
  }
  return keys;
})();

export const MEDIA_KEY_SET = new Set(MEDIA_KEYS);

export type MediaEntry = { key: string; available: boolean };
export type MediaReport = { status: "available" | "unavailable"; objects: MediaEntry[] };

export function isMediaKey(key: string): boolean {
  return MEDIA_KEY_SET.has(key);
}

/** Percent-decode a media path segment, refusing encoded slashes and traversal. */
export function decodeMediaKey(raw: string): string | null {
  let key = raw;
  if (key.includes("%")) {
    try {
      const upper = key.toUpperCase();
      if (upper.includes("%2F") || upper.includes("%5C")) return null;
      key = decodeURIComponent(key);
    } catch {
      return null;
    }
  }
  if (key.includes("\\") || key.split("/").some((part) => part === ".." || part === ".")) {
    return null;
  }
  return key;
}
