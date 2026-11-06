// Line sheets (brief: API → Line sheets; Business rules → Line-sheet export, Line-sheet import).
import { COPY, FIELD } from "../shared/copy";
import { CURRENCY } from "../shared/time";
import { requireRole, staff } from "./auth";
import { pool, tx } from "./db";
import { type StyleRow, staffDrop, stylesOf } from "./drops";
import { type Json, reply, route, validationFailed } from "./http";
import { csvReply } from "./csv";
import { copenhagenDay, pricesInForce } from "./pricing";

route("GET", "/api/drops/{dropId}/line-sheet.csv", "none", async (ctx) => {
  const me = await staff(ctx);
  const drop = await staffDrop(pool, me, ctx.params.dropId);
  requireRole(me, "merchandiser", "launch_producer", "finance_lead");
  const currency = ctx.query("currency") || "DKK";
  if (!Object.values(CURRENCY).includes(currency)) throw validationFailed({ currency: "Choose one of DKK, SEK, EUR, GBP, USD or JPY." });
  const prices = await pricesInForce(pool, me.workspaceId, currency, copenhagenDay());
  return csvReply(
    [
      ["Style number", "Name", "Colour", "Wholesale edition", "RRP DKK (minor units)", "Wholesale price (minor units)", "Currency", "Price list from"],
      ...(await stylesOf(pool, drop.id)).map((s) => {
        const price = prices.get(s.style_number.toLowerCase());
        return [s.style_number, s.name, s.colour, s.wholesale_edition, s.rrp_dkk_minor, price?.unitPriceMinor ?? null, price ? currency : null, price?.effectiveDate ?? null];
      }),
    ],
    `${drop.slug}-line-sheet-${currency.toLowerCase()}.csv`,
  );
});

const HEADER = ["style no", "name", "colour", "edition", "rrp dkk"];

/** `2.799,00` → 279900 minor units, by string arithmetic only. */
function rrpMinor(text: string): number | null {
  const m = /^(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?$/.exec(text);
  if (!m) return null;
  return Number(m[1].replace(/\./g, "")) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}

function edition(text: string): number | null {
  const m = /^(\d{1,3}(?:\.\d{3})*|\d+)$/.exec(text);
  const value = m ? Number(m[1].replace(/\./g, "")) : null;
  return value !== null && value <= 100_000 ? value : null;
}

interface Parsed {
  line: number;
  styleNumber: string;
  name: string;
  colour: string;
  edition: number;
  rrpDkkMinor: number;
}

type Outcome = "Updated" | "Unchanged" | "Merged" | "Orphan" | "Invalid";

route(
  "POST",
  "/api/drops/{dropId}/line-sheet/import",
  "multipart",
  async (ctx) => {
    const me = await staff(ctx);
    const drop = await staffDrop(pool, me, ctx.params.dropId);
    requireRole(me, "merchandiser");
    const { file } = ctx.multipart(COPY.lineSheetWrongType);
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
    let text: string;
    try {
      text = decoder.decode(file?.data ?? Buffer.alloc(0));
    } catch {
      throw validationFailed({ file: COPY.lineSheetWrongType });
    }
    const lines = text.split(/\r?\n/);
    const header = (lines[0] ?? "").split(";").map((h) => h.trim().toLowerCase());
    if (!file || header.length !== HEADER.length || header.some((h, i) => h !== HEADER[i])) throw validationFailed({ file: file ? COPY.lineSheetWrongType : FIELD.required });
    return tx(async (db) => {
      const styles = await stylesOf(db, drop.id);
      const byNumber = new Map<string, StyleRow>(styles.map((s) => [s.style_number.trim().toLowerCase(), s]));
      const results: Array<{ line: number; styleNumber: string; outcome: Outcome }> = [];
      const invalid: Array<{ line: number; field: string; message: string }> = [];
      const orphans: Array<{ line: number; styleNumber: string }> = [];
      const groups = new Map<string, Parsed[]>();
      let count = 0;
      lines.slice(1).forEach((raw, i) => {
        const line = i + 2;
        if (!raw.trim()) return;
        count += 1;
        const cells = raw.split(";").map((c) => c.trim().replace(/^"(.*)"$/, "$1"));
        const styleNumber = cells[0] ?? "";
        const problem =
          cells.length !== 5 ? ["Style no", "Use five semicolon-separated columns."]
          : !styleNumber ? ["Style no", FIELD.required]
          : !cells[1] ? ["Name", FIELD.required]
          : !cells[2] ? ["Colour", FIELD.required]
          : edition(cells[3]) === null ? ["Edition", "Enter a whole number of pieces, such as 1.200."]
          : rrpMinor(cells[4]) === null ? ["RRP DKK", "Enter an amount with a decimal comma, such as 2.799,00."]
          : null;
        if (problem) {
          invalid.push({ line, field: problem[0], message: problem[1] });
          results.push({ line, styleNumber, outcome: "Invalid" });
          return;
        }
        const key = styleNumber.toLowerCase();
        if (!byNumber.has(key)) {
          orphans.push({ line, styleNumber });
          results.push({ line, styleNumber, outcome: "Orphan" });
          return;
        }
        const parsed = { line, styleNumber, name: cells[1], colour: cells[2], edition: edition(cells[3]) ?? 0, rrpDkkMinor: rrpMinor(cells[4]) ?? 0 };
        groups.set(key, [...(groups.get(key) ?? []), parsed]);
      });
      let updated = 0;
      let unchanged = 0;
      const merged: Array<{ styleNumber: string; lines: number[] }> = [];
      for (const [key, group] of groups) {
        const style = byNumber.get(key) as StyleRow;
        const winner = group[group.length - 1];
        if (group.length > 1) {
          merged.push({ styleNumber: style.style_number, lines: group.map((g) => g.line) });
          for (const g of group.slice(0, -1)) results.push({ line: g.line, styleNumber: g.styleNumber, outcome: "Merged" });
        }
        const same = style.name === winner.name && style.colour === winner.colour && style.wholesale_edition === winner.edition && style.rrp_dkk_minor === winner.rrpDkkMinor;
        if (same) unchanged += 1;
        else {
          updated += 1;
          await db.query("UPDATE styles SET name = $2, colour = $3, wholesale_edition = $4, rrp_dkk_minor = $5 WHERE id = $1", [style.id, winner.name, winner.colour, winner.edition, winner.rrpDkkMinor]);
        }
        results.push({ line: winner.line, styleNumber: winner.styleNumber, outcome: same ? "Unchanged" : "Updated" });
      }
      results.sort((a, b) => a.line - b.line);
      const answer: Json = { rows: count, matched: groups.size, updated, unchanged, merged, orphans, invalid, results };
      return reply(200, answer);
    });
  },
  { fileLimit: 1_000_000, tooLarge: COPY.lineSheetTooLarge },
);
