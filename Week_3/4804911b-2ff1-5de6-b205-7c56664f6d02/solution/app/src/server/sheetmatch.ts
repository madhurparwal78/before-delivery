import type { SkuRec } from "./pricing.js";
import { normalise, parsePrice, parseRate, type RawRow } from "./sheetparse.js";

export type RowStatus = "matched" | "ambiguous" | "unmatched" | "settled";
export type MatchedBy = "sku_code" | "alias" | "name_size" | null;

export interface SRow {
  rowNumber: number; raw: RawRow; normDesc: string; status: RowStatus; matchedBy: MatchedBy; skuCode: string | null;
  candidates: string[]; reason: string | null; newMrpPaise: number | null; oldRate: number | null; newRate: number | null;
  mergedIntoRow: number | null; ignored: boolean; final: boolean;
}

const FORMAT_WORDS: Record<string, string> = { pet: "pet", glass: "glass", gls: "glass", can: "can", carton: "carton", ctn: "carton" };
const alnum = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

interface SizeToken { text: string; index: number; ml: number | null; casePack: boolean }

function sizeTokens(description: string): SizeToken[] {
  const found: SizeToken[] = [];
  const re = /(\d[\d,]*(?:\.\d+)?|\.\d+)\s*(ltr|ml|l)(?![\p{L}])/giu;
  for (const m of description.matchAll(re)) {
    const [whole, fraction = ""] = m[1]!.replace(/,/g, "").split(".");
    const litres = m[2]!.toLowerCase() !== "ml";
    let ml: number | null;
    if (litres) ml = fraction.length <= 3 ? Number((whole || "0") + fraction.padEnd(3, "0")) : null;
    else ml = /^0*$/.test(fraction) ? Number(whole || "0") : null;
    const after = description.slice(m.index + m[0].length);
    found.push({ text: m[0], index: m.index, ml: ml !== null && ml > 0 ? ml : null, casePack: /^\s*[x*]\s*\d+/i.test(after) });
  }
  return found;
}

interface Resolver { skus: SkuRec[]; aliases: Map<string, string> }

function openRow(base: SRow, status: "ambiguous" | "unmatched", reason: string | null, candidates: string[] = []): SRow {
  return { ...base, status, matchedBy: null, skuCode: null, candidates, reason };
}

/** Resolves one row by SKU code, remembered alias, then normalised name plus converted pack size. */
export function resolveRow(raw: RawRow, rowNumber: number, resolver: Resolver): SRow {
  const base: SRow = {
    rowNumber, raw, normDesc: normalise(raw.description), status: "unmatched", matchedBy: null, skuCode: null, candidates: [], reason: null,
    newMrpPaise: parsePrice(raw.newMrp), oldRate: null, newRate: null, mergedIntoRow: null, ignored: false, final: false,
  };
  const oldRate = parseRate(raw.oldGst);
  const newRate = parseRate(raw.newGst);
  const sticker = typeof oldRate === "number" && typeof newRate === "number";
  if (base.newMrpPaise === null || oldRate === undefined || newRate === undefined || (oldRate === null) !== (newRate === null) || (sticker && oldRate === newRate))
    return openRow(base, "unmatched", "unreadable_values");
  base.oldRate = oldRate;
  base.newRate = newRate;
  const matched = (skuCode: string, matchedBy: MatchedBy): SRow => ({ ...base, status: "matched", matchedBy, skuCode });
  const code = raw.code.trim().toUpperCase();
  if (resolver.skus.some((s) => s.code === code)) return matched(code, "sku_code");
  const alias = resolver.aliases.get(base.normDesc);
  if (alias) return matched(alias, "alias");

  const description = raw.description.replace(/\s+/g, " ").trim();
  const tokens = sizeTokens(description);
  if (tokens.length === 0 || tokens.some((t) => t.ml === null)) return openRow(base, "unmatched", "no_pack_size");
  if (new Set(tokens.map((t) => t.ml)).size > 1) return openRow(base, "unmatched", "several_sizes");
  if (tokens.some((t) => t.casePack)) return openRow(base, "unmatched", "case_pack");
  let rest = description;
  for (const t of [...tokens].sort((a, b) => b.index - a.index)) rest = rest.slice(0, t.index) + " " + rest.slice(t.index + t.text.length);
  const formats = new Set<string>();
  const words = alnum(rest).split(" ").filter((w) => {
    const f = FORMAT_WORDS[w];
    if (f) formats.add(f);
    return !f;
  });
  const name = words.join(" ");
  const fits = (drink: string): boolean => name !== "" && (drink === name || drink.startsWith(`${name} `));
  const drinks = new Set(resolver.skus.filter((s) => fits(alnum(s.drinkName))).map((s) => s.drinkId));
  if (drinks.size === 0) return openRow(base, "unmatched", "no_drink");
  const ml = tokens[0]!.ml;
  const candidates = resolver.skus.filter((s) => drinks.has(s.drinkId) && s.sizeMl === ml && (formats.size === 0 || (formats.size === 1 && formats.has(s.format)))).map((s) => s.code);
  if (candidates.length === 1) return matched(candidates[0]!, "name_size");
  if (candidates.length > 1) return openRow(base, "ambiguous", null, candidates);
  return openRow(base, "unmatched", "no_pack");
}

const valuesOf = (r: SRow): string => `${r.newMrpPaise}/${r.oldRate}/${r.newRate}`;
const inGroup = (r: SRow): boolean =>
  !r.ignored && r.skuCode !== null && r.reason !== "unreadable_values" && (r.status === "matched" || r.status === "settled" || (r.status === "ambiguous" && r.reason === "conflicting_prices"));

/** The duplicate rule, recomputed from the rows as they stand: merge equal values, reopen conflicting ones. */
export function applyDuplicates(rows: SRow[]): void {
  const groups = new Map<string, SRow[]>();
  for (const r of rows) {
    r.mergedIntoRow = null;
    if (inGroup(r)) groups.set(r.skuCode!, [...(groups.get(r.skuCode!) ?? []), r]);
  }
  const revert = (r: SRow): void => {
    if (r.status === "ambiguous" && r.reason === "conflicting_prices") Object.assign(r, { status: "matched", reason: null, candidates: [] });
  };
  for (const [sku, group] of groups) {
    if (new Set(group.map(valuesOf)).size > 1) {
      for (const r of group) if (!r.final) Object.assign(r, { status: "ambiguous", reason: "conflicting_prices", candidates: [sku], matchedBy: r.status === "settled" ? null : r.matchedBy });
    } else {
      for (const r of group) revert(r);
      for (const r of group.slice(1)) r.mergedIntoRow = group[0]!.rowNumber;
    }
  }
}
