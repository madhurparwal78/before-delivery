import { COPY } from "../shared/copy.js";
import { ApiError } from "./errors.js";
import { SHEET_LIMIT } from "./http.js";

const MAX_SHEET_ROWS = 5000;

export interface RawRow { code: string; description: string; newMrp: string; oldGst: string; newGst: string }

const refusal = (status: number, code: string, message: string): ApiError => new ApiError(status, code, message);

/** Splits CSV text into records; the quoting rules of the brief make a broken field a refusal rather than a guess. */
function records(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let i = 0;
  const bad = (): ApiError => refusal(422, "sheet_bad_quoting", COPY.badQuoting);
  const n = text.length;
  while (i < n) {
    let field = "";
    if (text[i] === '"') {
      i++;
      for (;;) {
        if (i >= n) throw bad();
        if (text[i] === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        field += text[i++];
      }
      if (i < n && text[i] !== "," && text[i] !== "\n" && !(text[i] === "\r" && text[i + 1] === "\n")) throw bad();
    } else {
      while (i < n && text[i] !== "," && text[i] !== "\n" && !(text[i] === "\r" && text[i + 1] === "\n")) {
        if (text[i] === '"') throw bad();
        field += text[i++];
      }
    }
    row.push(field);
    if (i >= n) break;
    if (text[i] === ",") {
      i++;
      if (i >= n) row.push("");
      continue;
    }
    i += text[i] === "\r" ? 2 : 1;
    out.push(row);
    row = [];
  }
  if (row.length) out.push(row);
  return out;
}

export function parseSheet(upload: { bytes: Buffer; oversize: boolean }): RawRow[] {
  const { bytes } = upload;
  if (upload.oversize || bytes.length > SHEET_LIMIT) throw refusal(413, "sheet_too_large", COPY.sheetTooLarge);
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && [[3, 4], [5, 6], [7, 8]].some(([a, b]) => bytes[2] === a && bytes[3] === b))
    throw refusal(415, "sheet_is_archive", COPY.sheetIsArchive);
  if (bytes.includes(0)) throw refusal(422, "sheet_has_nul", COPY.sheetHasNul);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw refusal(422, "sheet_not_utf8", COPY.sheetNotUtf8);
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const all = records(text).filter((r) => !(r.length === 1 && r[0]!.trim() === ""));
  const dataCount = Math.max(0, all.length - 1);
  if (dataCount > MAX_SHEET_ROWS) throw refusal(422, "sheet_too_many_rows", COPY.sheetTooManyRows);
  const header = (all[0] ?? []).map((h) => h.trim().toLowerCase());
  if (!header.includes("description") || !header.includes("new_mrp")) throw refusal(422, "sheet_bad_header", COPY.sheetBadHeader);
  if (dataCount === 0) throw refusal(422, "sheet_empty", COPY.sheetEmpty);
  const at = (name: string): number => header.indexOf(name);
  return all.slice(1).map((r) => {
    const cell = (name: string): string => (at(name) >= 0 ? (r[at(name)] ?? "") : "");
    return { code: cell("code"), description: cell("description"), newMrp: cell("new_mrp"), oldGst: cell("old_gst"), newGst: cell("new_gst") };
  });
}

const PRICE = /^(?:rs\.?|₹)?\s*(\d+(?:,\d+)*)(?:\.(\d{1,2}))?\s*(?:\/-)?$/i;

/** Indian price formats to integer paise; null when unreadable. */
export function parsePrice(text: string): number | null {
  const m = PRICE.exec(text.trim());
  if (!m) return null;
  const whole = Number(m[1]!.replace(/,/g, ""));
  const paise = whole * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
  return Number.isSafeInteger(paise) && paise > 0 ? paise : null;
}

/** "" for no rate; a whole percentage otherwise; undefined when the cell is not a rate. */
export function parseRate(text: string): number | null | undefined {
  const t = text.trim();
  if (t === "") return null;
  const m = /^(\d{1,3})\s*%?$/.exec(t);
  return m && Number(m[1]) <= 100 ? Number(m[1]) : undefined;
}

export const normalise = (description: string): string => description.toLowerCase().split(/\s+/).filter(Boolean).join(" ");
