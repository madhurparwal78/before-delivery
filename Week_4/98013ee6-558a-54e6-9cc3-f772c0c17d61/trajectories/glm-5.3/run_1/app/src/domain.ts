import { config } from "./config";
import { validation } from "./errors";

/** Domain types shared across the server. Ids are positive integers in creation order. */
export interface PinRecord {
  id: number;
  owner_id: number;
  board_id: number;
  section_id: number | null;
  image_id: number;
  root_id: number | null;
  version: number;
  title: string;
  description: string;
  alt: string;
  source: string | null;
  source_host: string | null;
  tags: string[];
  position: number;
  status: "draft" | "live" | "deleted" | "gone";
  created_at: Date;
  updated_at: Date;
}

export interface BoardRecord {
  id: number;
  owner_id: number;
  name: string;
  visibility: "public" | "secret";
  seq: number;
  cover_pin_id: number | null;
  last_saved_at: Date | null;
  created_at: Date;
}

export interface UserRef { id: number; name: string; handle: string; }

/** Board and section names: 1 to BOARD_NAME_MAX code points after trimming (DP-63). */
export function nameProblem(name: string, field: string): (() => ReturnType<typeof validation>) | null {
  if ([...name.trim()].length < 1 || [...name.trim()].length > config.boardNameMax) return () => validation(field);
  return null;
}

export function trimmedName(name: string): string { return name.trim(); }

/** Source link rule (DP-21): absolute http/https URL, shown as its normalised host. */
export function sourceProblem(source: string): (() => ReturnType<typeof validation>) | null {
  let url: URL;
  try { url = new URL(source); } catch { return () => validation("source"); }
  if (url.protocol !== "http:" && url.protocol !== "https:") return () => validation("source");
  if (!url.hostname) return () => validation("source");
  return null;
}

export function sourceHost(source: string): string {
  const url = new URL(source);
  let host = url.hostname.toLowerCase();
  if (host.startsWith("www.")) host = host.slice(4);
  if (url.protocol === "https:" && host.endsWith(":443")) host = host.slice(0, -4);
  if (url.protocol === "http:" && host.endsWith(":80")) host = host.slice(0, -3);
  return host;
}

/** Tag rule (DP-20): # at start or after a non-word character, 1-30 word characters, lowercase, first appearance order. */
export function extractTags(title: string, description: string): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  const text = `${title}\n${description}`;
  const re = /(^|[^\p{L}\p{N}_])#([\p{L}\p{N}_]{1,30})(?![\p{L}\p{N}_])/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const tag = m[2].toLowerCase();
    if (!seen.has(tag)) { seen.add(tag); tags.push(tag); }
  }
  return tags;
}

/** A word is a run of letters and digits (search, DP-65). */
export function words(text: string): string[] {
  return text.match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}
