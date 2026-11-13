import { randomUUID } from "node:crypto";
import { CATEGORIES, CONDITIONS, SIZES, type Option } from "../../shared/catalog";
import { parseEuros } from "../../shared/format";
import type { ImportCounts, ImportPreview, ImportSaved } from "../../shared/api";
import { lockKey, pool, transaction, type Db } from "../db";
import { validationFailed } from "../errors";
import { reply, type Context, type Reply } from "../pipeline";
import { ibanIsValid, storedIban } from "../rules/iban";
import { isDate, isEmail, isPriceCents } from "../validate";
import { intakeDateIsAllowed, insertPiece } from "./pieces";

const HEADER = "item_no,consignor_name,consignor_email,consignor_phone,consignor_iban,category,brand,description,size,condition,asking_price,intake_date";
const COLUMNS = 12;

/** The file's records, with quoted fields and either line end. */
function records(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text.charAt(index);
    if (quoted) {
      if (character === '"' && text.charAt(index + 1) === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || (character === "\r" && text.charAt(index + 1) === "\n")) {
      if (character === "\r") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  if (field || row.length) rows.push([...row, field]);
  return rows;
}

function parseSheet(raw: Buffer): string[][] {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    throw validationFailed({ file: "This file isn't UTF-8 text." });
  }
  const [header, ...rows] = records(text.replace(/^﻿/, ""));
  if (header?.join(",") !== HEADER) throw validationFailed({ file: `The first line must be exactly ${HEADER}.` });
  return rows;
}

const normalisedName = (name: string): string =>
  name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const optionOf = (options: readonly Option[], label: string): string | undefined => options.find((option) => option.label.toLowerCase() === label.trim().toLowerCase())?.value;

interface KnownConsignor {
  id: string;
  name: string;
  email: string | null;
}

interface PlannedRow {
  row: number;
  itemNo: string;
  status: "matched" | "new" | "refused" | "already";
  consignorName: string;
  reason: string | null;
  piece?: { consignorId: string; category: string; brand: string; description: string; size: string; condition: string; askingPriceCents: number; intakeDate: string };
  newConsignor?: { id: string; name: string; email: string | null; phone: string | null; iban: string | null };
}

/** Rows are matched in file order, so a consignor created by an earlier row counts as existing for later ones. */
async function planImport(db: Db, sheet: string[][], now: Date): Promise<PlannedRow[]> {
  const consignors = await db.query<KnownConsignor>("SELECT id, name, email FROM consignors WHERE status = 'active'");
  const known = [...consignors.rows];
  const already = new Set((await db.query<{ item_no: string }>("SELECT item_no FROM import_items")).rows.map((row) => row.item_no));
  const seen = new Set<string>();

  return sheet.map((cells, index) => {
    const [itemNo = "", name = "", email = "", phone = "", ibanText = "", category = "", brand = "", description = "", size = "", condition = "", price = "", intake = ""] = cells;
    const number = index + 2;
    const trimmedItem = itemNo.trim();
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const iban = ibanText.trim() ? storedIban(ibanText) : null;
    const refused = (reason: string): PlannedRow => ({ row: number, itemNo: trimmedItem, status: "refused", consignorName: trimmedName, reason });

    if (!trimmedItem) return refused("Missing item number.");
    if (seen.has(trimmedItem)) return refused("Item number appears twice in this file.");
    seen.add(trimmedItem);
    if (already.has(trimmedItem)) return { row: number, itemNo: trimmedItem, status: "already", consignorName: trimmedName, reason: null };
    if (cells.length !== COLUMNS) return refused(`This row has ${cells.length} fields; the header has ${COLUMNS}.`);
    if (!trimmedName) return refused("Missing consignor name.");
    if (trimmedEmail && !isEmail(trimmedEmail)) return refused("Email address isn't valid.");
    if (iban && !ibanIsValid(iban)) return refused("IBAN doesn't pass its check.");
    const byEmail = trimmedEmail ? known.find((consignor) => consignor.email?.toLowerCase() === trimmedEmail.toLowerCase()) : undefined;
    const byName = byEmail ? [] : known.filter((consignor) => normalisedName(consignor.name) === normalisedName(trimmedName));
    if (byName.length > 1) return refused("More than one consignor has this name.");
    const categoryValue = optionOf(CATEGORIES, category);
    if (!categoryValue) return refused("Unknown category.");
    if (!brand.trim()) return refused("Missing brand.");
    if (!description.trim()) return refused("Missing description.");
    const sizeValue = optionOf(SIZES, size);
    if (!sizeValue) return refused("Unknown size.");
    const conditionValue = optionOf(CONDITIONS, condition);
    if (!conditionValue) return refused("Unknown condition.");
    const cents = parseEuros(price);
    if (!isPriceCents(cents)) return refused("Asking price must be between €1.00 and €10,000.00.");
    if (!isDate(intake) || !intakeDateIsAllowed(intake, now)) return refused("Intake date must be today or up to 730 days back.");

    const match = byEmail ?? byName[0];
    const created = { id: randomUUID(), name: trimmedName, email: trimmedEmail || null, phone: phone.trim() || null, iban };
    if (!match) known.push(created);
    return {
      row: number,
      itemNo: trimmedItem,
      status: match ? "matched" : "new",
      consignorName: match ? match.name : trimmedName,
      reason: null,
      ...(match ? {} : { newConsignor: created }),
      piece: { consignorId: match ? match.id : created.id, category: categoryValue, brand, description, size: sizeValue, condition: conditionValue, askingPriceCents: cents, intakeDate: intake },
    };
  });
}

function countsOf(rows: PlannedRow[]): ImportCounts {
  const count = (status: PlannedRow["status"]): number => rows.filter((row) => row.status === status).length;
  return { matched: count("matched"), new: count("new"), refused: count("refused"), already: count("already") };
}

export async function previewImport({ rawBody, now }: Context): Promise<Reply> {
  const rows = await planImport(pool, parseSheet(rawBody), now);
  const view: ImportPreview = {
    rows: rows.map(({ row, itemNo, status, consignorName, reason }) => ({ row, itemNo, status, consignorName, reason })),
    counts: countsOf(rows),
  };
  return reply(200, view);
}

export async function saveImport({ rawBody, now }: Context): Promise<Reply> {
  const sheet = parseSheet(rawBody);
  const view = await transaction(async (db): Promise<ImportSaved> => {
    await lockKey(db, "ourlet-import");
    const rows = await planImport(db, sheet, now);
    let piecesCreated = 0;
    let consignorsCreated = 0;
    for (const { newConsignor, piece, itemNo } of rows) {
      if (newConsignor) {
        await db.query("INSERT INTO consignors (id, name, email, phone, iban, status, created_at) VALUES ($1, $2, $3, $4, $5, 'active', $6)", [newConsignor.id, newConsignor.name, newConsignor.email, newConsignor.phone, newConsignor.iban, now]);
        consignorsCreated += 1;
      }
      if (piece) {
        const pieceId = await insertPiece(db, piece);
        await db.query("INSERT INTO import_items (item_no, piece_id) VALUES ($1, $2)", [itemNo, pieceId]);
        piecesCreated += 1;
      }
    }
    return { counts: countsOf(rows), piecesCreated, consignorsCreated };
  });
  return reply(200, view);
}
