import type { IsoDate } from './dates.js';
import { formatRupees, unitSalePrice } from './money.js';
import type { PriceBook } from './price.js';
import { sugarMgPerPack } from './money.js';

const HEADER =
  'sku_code,drink_name,sku_name,size_ml,format,aliases,current_mrp_rs,effective_date,notice_number,notice_version,unit_sale_price_rs,unit_sale_per,sugar_mg_per_pack';

const RISKY_FIRST_CHARACTERS = ['=', '+', '-', '@', '\t', '\r'];

/** A value a spreadsheet could read as a command is made inert with one apostrophe. */
function inert(value: string): string {
  return RISKY_FIRST_CHARACTERS.includes(value.charAt(0)) ? `'${value}` : value;
}

function quote(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function priceSheetCsv(book: PriceBook, aliases: Map<string, string[]>, todayDate: IsoDate): string {
  const lines = [HEADER];
  for (const sku of book.skus()) {
    const drink = book.drink(sku.drinkId);
    const edition = book.currentEdition(sku.code, todayDate);
    const unit = unitSalePrice(edition.mrpPaise, sku.sizeMl);
    const skuAliases = (aliases.get(sku.code) ?? []).map(inert).join(' | ');
    const cells = [
      sku.code,
      inert(drink.name),
      inert(book.skuNameOf(sku)),
      String(sku.sizeMl),
      sku.format,
      skuAliases,
      formatRupees(edition.mrpPaise),
      edition.notice === null ? '' : edition.effectiveDate,
      edition.notice === null ? '' : edition.notice.number,
      edition.notice === null ? '' : String(edition.notice.version),
      unit === null ? '' : unit.rupees,
      unit === null ? '' : unit.per,
      String(sugarMgPerPack(drink.sugarMgPer100Ml, sku.sizeMl)),
    ];
    lines.push(cells.map(quote).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
