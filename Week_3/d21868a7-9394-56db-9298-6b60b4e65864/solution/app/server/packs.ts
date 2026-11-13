// The regulator delivery pack: the one document format, signed submission, store-then-mail, withdrawal.
import { createHash } from "node:crypto";
import type { User } from "./auth.ts";
import { tx, type Db } from "./db.ts";
import { formatMl } from "./decimal.ts";
import { ApiError, FieldErrors, asRecord, notFound } from "./http.ts";
import { sendMail } from "./mail.ts";
import { windowsOpeningBetween } from "./records.ts";
import { nextNumber } from "./schema.ts";
import { deleteObject, getObject, putObject } from "./store.ts";
import { districtPeriod, isoInstant, type DistrictPeriod } from "./time.ts";
import { kickWorker } from "./worker.ts";

const REGULATOR = "returns@regulator.example";
const TEXT_TYPE = "text/plain; charset=utf-8";

type PackState = "building" | "stored" | "mailed" | "withdrawn";

interface PackRow {
  number: string;
  period_from: string;
  period_to: string;
  signatory: string;
  document: Buffer;
  state: PackState;
  stalled_on: "store" | "mail" | null;
  sha256: string | null;
  object_may_exist: boolean;
  created_at: Date;
  mailed_at: Date | null;
}

const objectKey = (number: string) => `packs/${number}.txt`;

function packRecord(p: PackRow) {
  return {
    id: p.number,
    number: p.number,
    from: p.period_from,
    to: p.period_to,
    signatory: p.signatory,
    state: p.state,
    stalled_on: p.stalled_on,
    key: objectKey(p.number),
    sha256: p.sha256,
    created_at: isoInstant(p.created_at),
    mailed_at: p.mailed_at === null ? null : isoInstant(p.mailed_at),
  };
}

interface Period extends DistrictPeriod {
  signatory: string;
}

function validPeriod(input: Record<string, unknown>, errors = new FieldErrors()): Period {
  const period = districtPeriod(input.from, input.to, errors);
  const signatory = input.signatory;
  if (typeof signatory !== "string" || [...signatory].length < 2 || [...signatory].length > 80 || /[\r\n]/.test(signatory)) {
    errors.add("signatory", "Give a signatory of 2 to 80 characters on one line.");
  }
  errors.throwIfAny();
  return { ...period!, signatory: signatory as string };
}

/** The pack document, byte for byte (brief: Regulator pack). */
async function packDocument(db: Db, period: Period): Promise<Buffer> {
  const windows = await windowsOpeningBetween(db, period.from, period.to);
  const lines = [`Wirrinbah Water Trust delivery pack ${period.from} to ${period.to}`];
  for (const w of windows) {
    let line =
      `WINDOW ${w.id} ${w.channel_name} | ${w.label} | cap ${formatMl(w.effective_cap_milli)} ML/day | ` +
      `volume ${formatMl(w.cap_volume_milli)} ML | committed ${formatMl(w.committed_milli)} ML | delivered ${formatMl(w.delivered_milli)} ML`;
    if (w.restriction_cap_milli !== null) {
      const restriction = await db.query<{ effective_at: Date }>("SELECT effective_at FROM restriction WHERE window_id = $1", [w.id]);
      line += ` | restricted ${formatMl(w.restriction_cap_milli)} ML/day from ${isoInstant(restriction.rows[0]!.effective_at)}`;
    }
    lines.push(line);
    const strokes = await db.query<{ turnout: string; kind: string; from_milli: bigint; to_milli: bigint; stroke_operator_code: string; committed_at: Date }>(
      `SELECT o.turnout, g.kind, g.from_milli, g.to_milli, g.stroke_operator_code, g.committed_at
       FROM gate_card g JOIN water_order o ON o.number = g.order_number
       WHERE o.window_id = $1 AND g.state = 'spent' ORDER BY g.confirmed_at, g.id`,
      [w.id],
    );
    for (const s of strokes.rows) {
      lines.push(
        `STROKE ${s.turnout} ${s.kind} ${formatMl(s.from_milli)} -> ${formatMl(s.to_milli)} ML/day | ` +
          `operator ${s.stroke_operator_code} | ${isoInstant(s.committed_at)}`,
      );
    }
  }
  lines.push(`Signed by ${period.signatory} for Wirrinbah Water Trust`);
  return Buffer.from(lines.map((line) => `${line}\n`).join(""), "utf8");
}

export async function previewPack(db: Db, query: URLSearchParams): Promise<Buffer> {
  return packDocument(db, validPeriod(Object.fromEntries(query)));
}

export async function submitPack(body: unknown) {
  const input = asRecord(body);
  const errors = new FieldErrors();
  if (typeof input.document !== "string") errors.add("document", "Send the previewed pack text.");
  const period = validPeriod(input, errors);
  const pack = await tx(async (db) => {
    const document = await packDocument(db, period);
    if (!document.equals(Buffer.from(input.document as string, "utf8"))) {
      throw new ApiError(409, "pack_stale", "The records changed since your preview. Preview again before signing.");
    }
    const number = `WP-${String(await nextNumber(db, "pack")).padStart(4, "0")}`;
    const inserted = await db.query<PackRow>(
      `INSERT INTO pack (number, period_from, period_to, signatory, document, state)
       VALUES ($1, $2, $3, $4, $5, 'building') RETURNING *`,
      [number, period.from, period.to, period.signatory, document],
    );
    return inserted.rows[0]!;
  });
  kickWorker();
  return { pack: packRecord(pack) };
}

async function loadPack(db: Db, user: User, id: string): Promise<PackRow> {
  const found = await db.query<PackRow>("SELECT * FROM pack WHERE number = $1", [id]);
  const pack = found.rows[0];
  if (!pack || (user.role === "reviewer" && pack.state !== "mailed")) throw notFound();
  return pack;
}

export async function listPacks(db: Db, user: User) {
  const found = await db.query<PackRow>(
    "SELECT * FROM pack WHERE NOT $1 OR state = 'mailed' ORDER BY number DESC",
    [user.role === "reviewer"],
  );
  return found.rows.map(packRecord);
}

export async function getPack(db: Db, user: User, id: string) {
  return packRecord(await loadPack(db, user, id));
}

export async function packDocumentBytes(db: Db, user: User, id: string): Promise<{ number: string; bytes: Buffer }> {
  const pack = await loadPack(db, user, id);
  if (pack.state !== "stored" && pack.state !== "mailed") {
    throw new ApiError(409, "not_stored", "This pack has not been stored yet.");
  }
  try {
    return { number: pack.number, bytes: await getObject(objectKey(pack.number)) };
  } catch {
    throw new ApiError(503, "store_unavailable", "The evidence store is not answering. Try the download again shortly.");
  }
}

export async function withdrawPack(id: string) {
  const pack = await tx(async (db) => {
    const found = await db.query<PackRow>("SELECT * FROM pack WHERE number = $1 FOR UPDATE", [id]);
    const row = found.rows[0];
    if (!row) throw notFound();
    if (row.state === "mailed") throw new ApiError(409, "pack_mailed", "This pack has already been mailed.");
    if (row.state === "withdrawn") throw new ApiError(409, "illegal_transition", "This pack has already been withdrawn.");
    const updated = await db.query<PackRow>(
      "UPDATE pack SET state = 'withdrawn', stalled_on = NULL WHERE number = $1 RETURNING *",
      [id],
    );
    return updated.rows[0]!;
  }, { lock: false });
  kickWorker();
  return { pack: packRecord(pack) };
}

/** One step for every unfinished pack: store, then mail, or delete a withdrawn pack's object. Each pack
 * is worked under its row lock, so a withdrawal waits for an attempt in flight and the mail goes out once. */
export async function advancePacks(): Promise<void> {
  const pending = await tx(async (db) => {
    const found = await db.query<{ number: string }>(
      "SELECT number FROM pack WHERE state IN ('building', 'stored') OR (state = 'withdrawn' AND object_may_exist) ORDER BY number",
    );
    return found.rows.map((row) => row.number);
  }, { lock: false });
  for (const number of pending) {
    await tx(async (db) => {
      const found = await db.query<PackRow>("SELECT * FROM pack WHERE number = $1 FOR UPDATE SKIP LOCKED", [number]);
      const pack = found.rows[0];
      if (!pack) return;
      if (pack.state === "withdrawn") {
        await deleteObject(objectKey(number))
          .then(() => db.query("UPDATE pack SET object_may_exist = false WHERE number = $1", [number]))
          .catch(() => undefined);
        return;
      }
      if (pack.state === "building") {
        await db.query("UPDATE pack SET object_may_exist = true WHERE number = $1", [number]);
        const stored = await putObject(objectKey(number), pack.document, TEXT_TYPE).then(() => true, () => false);
        if (!stored) {
          await db.query("UPDATE pack SET stalled_on = 'store' WHERE number = $1", [number]);
          return;
        }
        pack.sha256 = createHash("sha256").update(pack.document).digest("hex");
        await db.query("UPDATE pack SET state = 'stored', stalled_on = NULL, sha256 = $2 WHERE number = $1", [number, pack.sha256]);
      }
      const mailed = await sendMail({
        to: REGULATOR,
        subject: `Ditchbook delivery pack ${number}`,
        text: `Pack ${number} for ${pack.period_from} to ${pack.period_to}. SHA-256 ${pack.sha256}`,
        attachment: { filename: `${number}.txt`, contentType: TEXT_TYPE, content: pack.document },
      }).then(() => true, () => false);
      await db.query(
        mailed
          ? "UPDATE pack SET state = 'mailed', stalled_on = NULL, mailed_at = now() WHERE number = $1"
          : "UPDATE pack SET stalled_on = 'mail' WHERE number = $1",
        [number],
      );
    }, { lock: false });
  }
}
