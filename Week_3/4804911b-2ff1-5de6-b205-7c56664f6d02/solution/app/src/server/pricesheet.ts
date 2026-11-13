import { rupees } from "../shared/copy.js";
import { today } from "./clock.js";
import { db } from "./db.js";
import { currentEdition, loadBook, sugarPerPack, unitSalePrice } from "./pricing.js";

const HEADER = "sku_code,drink_name,sku_name,size_ml,format,aliases,current_mrp_rs,effective_date,notice_number,notice_version,unit_sale_price_rs,unit_sale_per,sugar_mg_per_pack";

/** A leading = + - @ tab or CR would be read as a command by a spreadsheet: one apostrophe makes it text. */
const inert = (text: string): string => (/^[=+\-@\t\r]/.test(text) ? `'${text}` : text);
const quote = (text: string): string => (/[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);

export async function priceSheetCsv(): Promise<string> {
  const book = await loadBook(db);
  const day = today();
  const aliases = (await db.query("SELECT alias, sku_code FROM aliases ORDER BY alias")).rows;
  const lines = book.skus.map((sku) => {
    const current = currentEdition(book, day, sku.code);
    const unit = unitSalePrice(current.mrpPaise, sku.sizeMl);
    return [
      sku.code, inert(sku.drinkName), inert(sku.name), String(sku.sizeMl), sku.format,
      aliases.filter((a) => a.sku_code === sku.code).map((a) => inert(a.alias as string)).join(" | "),
      rupees(current.mrpPaise), current.source ? current.effectiveDate : "", current.source?.number ?? "", current.source ? String(current.source.version) : "",
      unit?.rupees ?? "", unit?.per ?? "", String(sugarPerPack(sku)),
    ].map(quote).join(",");
  });
  return `${[HEADER, ...lines].join("\r\n")}\r\n`;
}
