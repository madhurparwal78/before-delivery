import { query, one, withTransaction, type Tx } from "../db.js";
import { errors } from "../http/errors.js";
import { CLOSURE_DATES, type Board, type Office } from "../../shared/domain.js";
import { parseMeasurementText, slugify } from "./talent.js";

/** Roster import and export, and the withdraw/restore/erase lifecycle. */

export const ROSTER_HEADER = ["Email", "First Name", "Last Name", "Date of Birth", "Office", "Division", "Height", "Chest", "Waist", "Hips", "Instagram", "TikTok", "YouTube"];

const OFFICE_ALIASES: Record<string, Office> = { toronto: "toronto", tor: "toronto", vancouver: "vancouver", van: "vancouver" };
const DIVISION_ALIASES: Record<string, Board> = { women: "women", men: "men", creators: "creators", digital: "creators", "new faces": "new_faces" };

export interface ImportOutcome {
  row: number;
  outcome: "created" | "merged" | "unchanged" | "orphan";
  talentId: string | null;
  reason: string | null;
  filled: string[];
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0] !== "");
}

export function parseReach(value: string): number | null {
  const cleaned = value.replace(/,/g, "").trim();
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

export function parseDateCell(value: string): string | null {
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return null;
}

function normaliseName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export async function importRoster(csvText: string): Promise<{ counts: { created: number; merged: number; unchanged: number; orphan: number }; rows: ImportOutcome[] }> {
  const table = parseCsv(csvText);
  if (table.length === 0) throw errors.validation({ file: "The header row does not match the roster export format." });
  const header = table[0].map((h) => h.trim());
  if (header.join(",") !== ROSTER_HEADER.join(",")) {
    throw errors.validation({ file: "The header row does not match the roster export format." });
  }
  const counts = { created: 0, merged: 0, unchanged: 0, orphan: 0 };
  const rows: ImportOutcome[] = [];
  for (let i = 1; i < table.length; i++) {
    const cells = table[i];
    const rowNumber = i + 1;
    const get = (index: number): string => (cells[index] ?? "").trim();
    const email = get(0);
    const firstName = get(1);
    const lastName = get(2);
    const dobCell = get(3);
    const officeCell = get(4);
    const divisionCell = get(5);
    const heightCell = get(6);
    const chestCell = get(7);
    const waistCell = get(8);
    const hipsCell = get(9);
    const instagramCell = get(10);
    const tiktokCell = get(11);
    const youtubeCell = get(12);
    const dob = dobCell ? parseDateCell(dobCell) : null;
    if (!email && !dob) {
      counts.orphan += 1;
      rows.push({ row: rowNumber, outcome: "orphan", talentId: null, reason: "no_identity", filled: [] });
      continue;
    }
    if (dobCell && !dob) {
      counts.orphan += 1;
      rows.push({ row: rowNumber, outcome: "orphan", talentId: null, reason: "bad_date", filled: [] });
      continue;
    }
    const officeKey = normaliseName(officeCell);
    const office = OFFICE_ALIASES[officeKey];
    if (!office) {
      counts.orphan += 1;
      rows.push({ row: rowNumber, outcome: "orphan", talentId: null, reason: "unknown_office", filled: [] });
      continue;
    }
    const divisionKey = normaliseName(divisionCell);
    const board = DIVISION_ALIASES[divisionKey];
    if (!board) {
      counts.orphan += 1;
      rows.push({ row: rowNumber, outcome: "orphan", talentId: null, reason: "unknown_division", filled: [] });
      continue;
    }
    const heightCm = heightCell ? parseMeasurementText(heightCell) : null;
    if (!heightCm) {
      // height parse failure matters only when creating a new talent
      const matched = await findExisting(email, firstName, lastName, dob);
      if (!matched) {
        counts.orphan += 1;
        rows.push({ row: rowNumber, outcome: "orphan", talentId: null, reason: "bad_height", filled: [] });
        continue;
      }
    }
    const existing = await findExisting(email, firstName, lastName, dob);
    if (existing) {
      const filled: string[] = [];
      if (existing.email === null && email) filled.push("email");
      if (existing.height_cm === null && heightCm) filled.push("heightCm");
      if (existing.chest_cm === null) {
        const chest = chestCell ? parseMeasurementText(chestCell) : null;
        if (chest) filled.push("chestCm");
      }
      if (existing.waist_cm === null) {
        const waist = waistCell ? parseMeasurementText(waistCell) : null;
        if (waist) filled.push("waistCm");
      }
      if (existing.hips_cm === null) {
        const hips = hipsCell ? parseMeasurementText(hipsCell) : null;
        if (hips) filled.push("hipsCm");
      }
      if (existing.instagram === null && instagramCell) filled.push("instagram");
      if (existing.tiktok === null && tiktokCell) filled.push("tiktok");
      if (existing.youtube === null && youtubeCell) filled.push("youtube");
      if (existing.date_of_birth === null && dob) filled.push("dateOfBirth");
      if (filled.length === 0) {
        counts.unchanged += 1;
        rows.push({ row: rowNumber, outcome: "unchanged", talentId: existing.id, reason: null, filled: [] });
      } else {
        const updates: Record<string, unknown> = {};
        if (filled.includes("email")) updates.email = email;
        if (filled.includes("heightCm")) updates.height_cm = heightCm;
        if (filled.includes("chestCm")) updates.chest_cm = parseMeasurementText(chestCell);
        if (filled.includes("waistCm")) updates.waist_cm = parseMeasurementText(waistCell);
        if (filled.includes("hipsCm")) updates.hips_cm = parseMeasurementText(hipsCell);
        if (filled.includes("instagram")) updates.instagram = parseReach(instagramCell);
        if (filled.includes("tiktok")) updates.tiktok = parseReach(tiktokCell);
        if (filled.includes("youtube")) updates.youtube = parseReach(youtubeCell);
        if (filled.includes("dateOfBirth")) updates.date_of_birth = dob;
        const keys = Object.keys(updates);
        await query(`UPDATE talent SET ${keys.map((k, j) => `${k} = $${j + 1}`).join(", ")} WHERE id = $${keys.length + 1}`, [...keys.map((k) => updates[k]), existing.id]);
        counts.merged += 1;
        rows.push({ row: rowNumber, outcome: "merged", talentId: existing.id, reason: null, filled });
      }
      continue;
    }
    const id = `tal_${Math.random().toString(36).slice(2, 14)}`;
    const displayName = `${firstName} ${lastName}`.trim();
    const base = slugify(displayName);
    let slug = base;
    let n = 2;
    for (;;) {
      const taken = await one<{ id: string }>(`SELECT id FROM talent WHERE lower(slug) = lower($1) AND state <> 'erased'`, [slug]);
      if (!taken) break;
      slug = `${base}-${n}`;
      n += 1;
    }
    await query(
      `INSERT INTO talent (id, slug, display_name, state, office, board, email, date_of_birth, height_cm, chest_cm, waist_cm, hips_cm, instagram, tiktok, youtube, feed_token)
       VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        id,
        slug,
        displayName,
        office,
        board,
        email || null,
        dob,
        heightCm,
        chestCell ? parseMeasurementText(chestCell) : null,
        waistCell ? parseMeasurementText(waistCell) : null,
        hipsCell ? parseMeasurementText(hipsCell) : null,
        instagramCell ? parseReach(instagramCell) : 0,
        tiktokCell ? parseReach(tiktokCell) : 0,
        youtubeCell ? parseReach(youtubeCell) : 0,
        Math.random().toString(36).slice(2).padEnd(40, "0").slice(0, 40),
      ]
    );
    counts.created += 1;
    rows.push({ row: rowNumber, outcome: "created", talentId: id, reason: null, filled: [] });
  }
  return { counts, rows };
}

async function findExisting(email: string, firstName: string, lastName: string, dob: string | null): Promise<{ id: string; email: string | null; height_cm: number | null; chest_cm: number | null; waist_cm: number | null; hips_cm: number | null; instagram: number | null; tiktok: number | null; youtube: number | null; date_of_birth: string | null } | null> {
  if (email) {
    const byEmail = await one<{ id: string; email: string | null; height_cm: number | null; chest_cm: number | null; waist_cm: number | null; hips_cm: number | null; instagram: number | null; tiktok: number | null; youtube: number | null; date_of_birth: string | null }>(
      `SELECT id, email, height_cm, chest_cm, waist_cm, hips_cm, instagram, tiktok, youtube, to_char(date_of_birth,'YYYY-MM-DD') AS date_of_birth FROM talent WHERE lower(email) = lower($1) AND state <> 'erased'`,
      [email]
    );
    if (byEmail) return byEmail;
  }
  if (dob && firstName && lastName) {
    const byName = await one<{ id: string; email: string | null; height_cm: number | null; chest_cm: number | null; waist_cm: number | null; hips_cm: number | null; instagram: number | null; tiktok: number | null; youtube: number | null; date_of_birth: string | null }>(
      `SELECT id, email, height_cm, chest_cm, waist_cm, hips_cm, instagram, tiktok, youtube, to_char(date_of_birth,'YYYY-MM-DD') AS date_of_birth
       FROM talent WHERE state <> 'erased' AND to_char(date_of_birth,'YYYY-MM-DD') = $1
         AND lower(regexp_replace(display_name, '\\s+', ' ', 'g')) = lower($2)`,
      [dob, `${firstName} ${lastName}`.replace(/\s+/g, " ")]
    );
    if (byName) return byName;
  }
  return null;
}

function csvQuote(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function neutralise(text: string): string {
  if (/^[=+\-@\t\r]/.test(text)) return `'${text}`;
  return text;
}

export async function exportRoster(): Promise<string> {
  const rows = await query<{ email: string | null; display_name: string; date_of_birth: string | null; office: string; board: string; height_cm: number | null; chest_cm: number | null; waist_cm: number | null; hips_cm: number | null; instagram: number; tiktok: number; youtube: number }>(
    `SELECT email, display_name, to_char(date_of_birth,'YYYY-MM-DD') AS date_of_birth, office, board, height_cm, chest_cm, waist_cm, hips_cm, instagram, tiktok, youtube
     FROM talent WHERE state = 'active' ORDER BY lower(display_name)`
  );
  const lines = [ROSTER_HEADER.join(",")];
  for (const row of rows) {
    const [first, ...rest] = row.display_name.split(" ");
    const last = rest.join(" ");
    lines.push([
      row.email ?? "",
      first ?? "",
      last,
      row.date_of_birth ?? "",
      row.office === "toronto" ? "Toronto" : "Vancouver",
      row.board === "new_faces" ? "New Faces" : row.board === "creators" ? "Creators" : row.board === "women" ? "Women" : "Men",
      row.height_cm !== null ? `${row.height_cm} cm` : "",
      row.chest_cm !== null ? `${row.chest_cm} cm` : "",
      row.waist_cm !== null ? `${row.waist_cm} cm` : "",
      row.hips_cm !== null ? `${row.hips_cm} cm` : "",
      String(row.instagram),
      String(row.tiktok),
      String(row.youtube),
    ].map((cell) => csvQuote(neutralise(cell))).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

export async function withdrawTalent(id: string): Promise<void> {
  await withTransaction(async (tx) => {
    const row = await tx.one<{ id: string; state: string }>(`SELECT id, state FROM talent WHERE id = $1`, [id]);
    if (!row) throw errors.notFound();
    if (row.state === "erased") throw errors.conflict("erased");
    if (row.state === "withdrawn") throw errors.conflict("already_withdrawn");
    await tx.query(`UPDATE talent SET state = 'withdrawn', version = version + 1 WHERE id = $1`, [id]);
  });
}

export async function restoreTalent(id: string): Promise<void> {
  await withTransaction(async (tx) => {
    const row = await tx.one<{ id: string; state: string }>(`SELECT id, state FROM talent WHERE id = $1`, [id]);
    if (!row) throw errors.notFound();
    if (row.state === "erased") throw errors.conflict("erased");
    if (row.state !== "withdrawn") throw errors.conflict("not_withdrawn");
    await tx.query(`UPDATE talent SET state = 'active', version = version + 1 WHERE id = $1`, [id]);
  });
}

/** Erasure keeps amounts but removes personal data everywhere. */
export async function eraseTalent(id: string, memberName: string): Promise<void> {
  await withTransaction(async (tx) => {
    const row = await tx.one<{ id: string; display_name: string; state: string }>(`SELECT id, display_name, state FROM talent WHERE id = $1`, [id]);
    if (!row) throw errors.notFound();
    if (row.state === "erased") throw errors.conflict("erased");
    const displayName = row.display_name;
    await tx.query(
      `UPDATE talent SET display_name = 'Erased talent', email = NULL, phone = NULL, home_address = NULL, date_of_birth = NULL,
        guardian_name = NULL, guardian_email = NULL, guardian_phone = NULL, height_cm = NULL, chest_cm = NULL, waist_cm = NULL, hips_cm = NULL,
        instagram = 0, tiktok = 0, youtube = 0, office_note = NULL, feed_token = NULL, state = 'erased', version = version + 1
       WHERE id = $1`,
      [id]
    );
    await tx.query(`DELETE FROM photos WHERE talent_id = $1`, [id]);
    await tx.query(`UPDATE options SET job_title = 'Erased talent', note = NULL, version = version + 1 WHERE talent_id = $1`, [id]);
    await tx.query(`UPDATE booking_lines SET label = replace(label, $2, 'Erased talent') WHERE talent_id = $1`, [id, displayName]);
    await tx.query(`UPDATE bookings SET job_title = replace(job_title, $2, 'Erased talent') WHERE id IN (SELECT booking_id FROM booking_talent WHERE talent_id = $1)`, [id, displayName]);
    const member = await tx.one<{ id: string }>(`SELECT id FROM members WHERE talent_id = $1`, [id]);
    if (member) {
      await tx.query(`UPDATE members SET removed_at = now() WHERE id = $1`, [member.id]);
      await tx.query(`UPDATE sessions SET ended_at = now() WHERE member_id = $1 AND ended_at IS NULL`, [member.id]);
    }
    await tx.query(`DELETE FROM package_talent WHERE talent_id = $1`, [id]);
    void memberName;
    await deleteUnsentMentioningTx(tx, displayName);
  });
}

async function deleteUnsentMentioningTx(tx: Tx, text: string): Promise<void> {
  await tx.query(`DELETE FROM mail_outbox WHERE sent_at IS NULL AND (to_address = $1 OR subject ILIKE $2 OR body ILIKE $2)`, [text, `%${text}%`]);
}

export function closureDatesFor(office: Office): string[] {
  return CLOSURE_DATES[office];
}

