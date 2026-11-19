import { isLanguage } from "../../shared/copy";
import type { Language } from "../../shared/catalog";
import { PASSPORT_COPY } from "../../shared/copy";
import type { Measure } from "../../shared/api";
import { instantText } from "../../shared/time";
import { now, pool, transaction } from "../db";
import { fitsInteger } from "../figures";
import { ApiError, conflict, notFound, ok, route, type Call, type Session } from "../http";
import {
  assertWritable,
  latestResultRow,
  loadStyle,
  nextStyleState,
  passportFor,
  publicPassport,
  scoreOf,
  type StyleRecord,
} from "../domain";

const desk = (call: Call): string => (call.session as Session).assessorId;
const theStyle = (call: Call): Promise<StyleRecord> => loadStyle(pool, desk(call), call.params[0] as string);

route("POST", "/api/styles/:id/passport", {
  input: "emptyOrJson",
  resource: theStyle,
  handle: async (call, style) => {
    assertWritable(style);
    return transaction(async (tx) => {
      const locked = await loadStyle(tx, desk(call), style.id, true);
      const latest = await latestResultRow(tx, style.id);
      const score = await scoreOf(tx, locked);
      if (!latest || score.state !== "current") throw conflict("Ask for a current score before publishing.");
      await tx.query(
        `INSERT INTO passports (gtin, assessor_id, style_id, state) VALUES ($1, $2, $3, 'published') ON CONFLICT (gtin) DO NOTHING`,
        [locked.gtin, desk(call), style.id],
      );
      const passport = (await tx.query(`SELECT * FROM passports WHERE gtin = $1 FOR UPDATE`, [locked.gtin])).rows[0];
      if (passport.style_id !== style.id) throw new ApiError(409, "gtin_taken", "A passport with this GTIN already exists.");
      if (passport.state === "withdrawn") throw conflict(PASSPORT_COPY.en.withdrawn);
      const count = await tx.query(`SELECT COUNT(*)::int AS editions FROM passport_editions WHERE gtin = $1`, [locked.gtin]);
      const edition = (count.rows[0].editions as number) + 1;
      const publishedAt = now();
      const measures = (latest.measures as Measure[]).map(({ measure, totalShown }) => ({ measure, totalShown }));
      await tx.query(`INSERT INTO passport_editions (gtin, edition, published_at, snapshot) VALUES ($1, $2, $3, $4)`, [
        locked.gtin,
        edition,
        publishedAt,
        JSON.stringify({
          styleName: locked.name,
          labelName: locked.label_name,
          garment: locked.garment,
          factorEdition: latest.edition,
          dataQualityPercent: latest.data_quality_percent,
          dataQualityGrade: latest.data_quality_grade,
          score: score.score,
          per100g: score.per100g,
          measures,
        }),
      ]);
      await tx.query(`UPDATE styles SET state = $2 WHERE id = $1`, [style.id, nextStyleState(locked.state, "firstPassport")]);
      return ok(
        { gtin: locked.gtin, edition, state: "published", publishedAt: instantText(publishedAt), address: `/p/${locked.gtin}` },
        201,
      );
    });
  },
});

route("POST", "/api/styles/:id/passport/withdraw", {
  input: "emptyOrJson",
  resource: theStyle,
  handle: async (_call, style) => {
    if (style.label_state !== "open") assertWritable(style);
    return transaction(async (tx) => {
      const { rows } = await tx.query(
        `UPDATE passports SET state = 'withdrawn' WHERE style_id = $1 AND state = 'published' RETURNING gtin`,
        [style.id],
      );
      if (!rows[0]) throw conflict("This style has no live passport.");
      await tx.query(`UPDATE styles SET state = $2 WHERE id = $1`, [style.id, nextStyleState(style.state, "withdrawn")]);
      return ok({ gtin: rows[0].gtin, state: "withdrawn" });
    });
  },
});

route("GET", "/api/passports", {
  handle: async (call) => {
    const { rows } = await pool.query(
      `SELECT p.gtin, p.state, p.style_id, s.name AS style_name, e.edition, e.published_at
       FROM passports p JOIN styles s ON s.id = p.style_id JOIN passport_editions e ON e.gtin = p.gtin
       WHERE p.assessor_id = $1 ORDER BY e.published_at DESC, e.gtin, e.edition DESC`,
      [desk(call)],
    );
    return ok({
      passports: rows.map((row) => ({
        styleId: row.style_id,
        styleName: row.style_name,
        gtin: row.gtin,
        edition: row.edition,
        state: row.state,
        publishedAt: instantText(row.published_at),
        address: `/p/${row.gtin}`,
      })),
    });
  },
});

function languageOf(call: Call): Language {
  const lang = call.query.get("lang");
  return isLanguage(lang) ? lang : "en";
}

async function publicRead(call: Call, edition: number | null): Promise<ReturnType<typeof ok>> {
  const found = await passportFor(pool, call.params[0] as string, edition);
  if (found.kind === "none") throw notFound();
  const language = languageOf(call);
  if (found.kind === "withdrawn") throw new ApiError(410, "withdrawn", PASSPORT_COPY[language].withdrawn);
  return ok(publicPassport(found.row, language));
}

route("GET", "/api/passports/:gtin", {
  auth: false,
  handle: (call) => publicRead(call, null),
});

route("GET", "/api/passports/:gtin/editions/:n", {
  auth: false,
  handle: (call) => {
    const edition = Number(call.params[1]);
    if (!fitsInteger(edition)) throw notFound();
    return publicRead(call, edition);
  },
});
