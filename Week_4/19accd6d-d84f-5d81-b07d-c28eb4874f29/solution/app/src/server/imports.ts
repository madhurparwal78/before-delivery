import { createHash } from "node:crypto";
import type { ImportResult } from "../shared/api";
import { asRecord } from "../shared/records";
import { pool, queryOne } from "./db";
import type { Db } from "./db";
import { ApiError, validationFailed } from "./errors";
import { defineRoute, reply } from "./http";
import type { Route } from "./http";
import { contentOf, createRecipe, publish, resolveOwner, visibleRecipe } from "./recipes";
import type { RecipeOwner } from "./recipes";
import { newId } from "./session";
import { normalizedLineEndings, parseWringLine } from "./wringline";

const IMPORT_NOTE = "Imported from Wring Line v1";

/** Every import attempt is kept with its report, whether or not it created a recipe. */
async function recordAttempt(
  db: Db, userId: string, textHash: string, status: string, report: object, recipeId: string | null = null, version: number | null = null,
): Promise<void> {
  await db.query(
    "INSERT INTO import_attempts (id, user_id, text_hash, status, recipe_id, version, report) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [newId("i"), userId, textHash, status, recipeId, version, JSON.stringify(report)],
  );
}

export const importRoutes: Route[] = [
  defineRoute<undefined, string, RecipeOwner>({
    method: "POST", path: "/api/imports", access: "session", body: "json",
    check: (ctx, _, body) => resolveOwner(pool, ctx.me().id, asRecord(body).owner),
    validate: (body) => {
      const text = asRecord(body).text;
      if (typeof text !== "string") throw validationFailed({ text: "Paste the Wring Line text to import." });
      return text;
    },
    run: async (ctx, owner, text) => {
      const userId = ctx.me().id;
      const textHash = createHash("sha256").update(normalizedLineEndings(text)).digest("hex");
      const db = await ctx.transaction();
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${userId}:${textHash}`]);
      const earlier = await queryOne<{ recipe_id: string; version: number; report: { recipeName: string } }>(
        db,
        "SELECT recipe_id, version, report FROM import_attempts WHERE user_id = $1 AND text_hash = $2 AND status = 'created' AND recipe_id IS NOT NULL LIMIT 1",
        [userId, textHash],
      );
      const existing = earlier ? await visibleRecipe(db, userId, earlier.recipe_id) : null;
      if (earlier && existing) {
        const message = `Already imported as ${earlier.report.recipeName} (version ${earlier.version}). Nothing was created.`;
        await recordAttempt(db, userId, textHash, "already_imported", { message });
        const result: ImportResult = { status: "already_imported", recipe: existing, version: earlier.version, message };
        return reply(200, { import: result });
      }
      const parsed = parseWringLine(text);
      if ("unmatched" in parsed) {
        await recordAttempt(pool, userId, textHash, "rejected", { lines: parsed.unmatched });
        const count = parsed.unmatched.length;
        throw new ApiError(422, "import_unmatched", `${count} ${count === 1 ? "line" : "lines"} did not match. Nothing was created.`, {
          lines: parsed.unmatched,
        });
      }
      const content = contentOf({ name: parsed.name, note: IMPORT_NOTE, tags: [], steps: parsed.steps });
      const recipeId = await createRecipe(db, owner, content, userId);
      await recordAttempt(db, userId, textHash, "created", { recipeName: content.name, lineCount: parsed.lineCount }, recipeId, 1);
      publish(ctx, recipeId, 1, content, owner.type === "team" ? owner.id : null);
      const result: ImportResult = {
        status: "created", recipe: (await visibleRecipe(db, userId, recipeId)) as ImportResult["recipe"], version: 1, lineCount: parsed.lineCount,
      };
      return reply(201, { import: result });
    },
  }),
];
