import type { SearchAnswer, SearchResult } from "../shared/types.js";
import { today } from "./clock.js";
import { db } from "./db.js";
import { validation } from "./errors.js";
import { codePoints } from "./rules.js";
import { searchIndex, searchState } from "./meili.js";
import { currentEdition, loadBook, packFacts, type Book } from "./pricing.js";

export const isBatchShaped = (q: string): boolean => /^[a-z]+-\d{6}-\d{1,4}$/i.test(q.trim());
const isNoticeShaped = (q: string): boolean => /^[a-z]+-\d+-\d+$/i.test(q) && !isBatchShaped(q);
const isSkuShaped = (q: string): boolean => /^[a-z]+-\d+-[a-z]+$/i.test(q);

function skuResult(book: Book, code: string): SearchResult | null {
  const sku = book.bySku.get(code);
  if (!sku) return null;
  const current = currentEdition(book, today(), code);
  return { kind: "sku", skuCode: code, name: sku.name, batchCode: null, retailPricePaise: current.mrpPaise, sourceNotice: current.source };
}

export async function search(rawQuery: string): Promise<SearchAnswer> {
  if (codePoints(rawQuery) > 80) throw validation({ q: "Search for up to 80 characters." });
  const q = rawQuery.trim();
  const state = await searchState();
  if (q === "") return { query: rawQuery, searchState: state, results: [] };
  const book = await loadBook(db);
  const compact = q.toUpperCase();
  let results: SearchResult[] = [];
  if (isBatchShaped(q)) {
    const batch = book.batches.find((b) => b.code === compact);
    if (batch) {
      const facts = packFacts(book, today(), batch);
      results = [{ kind: "batch", skuCode: batch.skuCode, name: facts.skuName, batchCode: batch.code, retailPricePaise: facts.retailPricePaise, sourceNotice: facts.sourceNotice }];
    }
  } else if (isNoticeShaped(q)) {
    const notice = book.notices.find((n) => n.number === compact);
    results = (notice?.rows ?? []).flatMap((r) => skuResult(book, r.skuCode) ?? []);
  } else if (isSkuShaped(q)) {
    results = skuResult(book, compact) ? [skuResult(book, compact)!] : [];
  } else {
    const codes = await searchIndex(q);
    if (codes === null) return { query: rawQuery, searchState: "down", results: [] };
    results = codes.flatMap((c) => skuResult(book, c) ?? []);
  }
  return { query: rawQuery, searchState: await searchState(), results };
}
