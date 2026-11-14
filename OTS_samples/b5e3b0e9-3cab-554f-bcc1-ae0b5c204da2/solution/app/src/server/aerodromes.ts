import { config } from "./config.ts";
import { BUILT_IN_LAYOUTS, checkLayoutFile, type Layout } from "./domain/layout.ts";
import { newId, pool, query } from "./db.ts";
import { ApiError, layoutInvalid, layoutTooLarge, notFound, storageUnavailable } from "./errors.ts";
import { file, reply, route } from "./http.ts";
import { requireInstructor } from "./auth.ts";
import { getObject, putObject, StorageError } from "./s3.ts";

interface AerodromeInfo {
  id: string;
  name: string;
  code: string;
  imported: boolean;
  layout: Layout;
}

/** An aerodrome the school may use: a built-in one or one of its own imports; anything else is not found. */
export async function aerodromeFor(id: string, schoolId: string): Promise<AerodromeInfo> {
  const builtIn = BUILT_IN_LAYOUTS[id];
  if (builtIn) return { id, name: builtIn.name, code: builtIn.code, imported: false, layout: builtIn };
  const rows = await query<{ id: string; name: string; code: string; layout: Layout }>(
    pool,
    "SELECT id, name, code, layout FROM aerodromes WHERE id = $1 AND school_id = $2",
    [id, schoolId],
  );
  const found = rows[0];
  if (!found) throw notFound();
  return { ...found, imported: true };
}

export function registerAerodromeRoutes(): void {
  route("GET", "/api/aerodromes", async (ctx) => {
    const { schoolId } = await requireInstructor(ctx);
    const imported = await query<{ id: string; name: string; code: string }>(
      pool,
      "SELECT id, name, code FROM aerodromes WHERE school_id = $1 ORDER BY created_at, id",
      [schoolId],
    );
    return [
      ...Object.entries(BUILT_IN_LAYOUTS).map(([id, layout]) => ({ id, name: layout.name, code: layout.code, imported: false })),
      ...imported.map((row) => ({ ...row, imported: true })),
    ];
  });

  route("GET", "/api/aerodromes/:id", async (ctx) => {
    const { schoolId } = await requireInstructor(ctx);
    const found = await aerodromeFor(ctx.params[0] ?? "", schoolId);
    return { id: found.id, layout: found.layout };
  });

  route("POST", "/api/aerodromes/import", async (ctx) => {
    const { schoolId } = await requireInstructor(ctx);
    let bytes: Buffer;
    try {
      bytes = await ctx.raw(config.layoutMaxBytes);
    } catch (error) {
      if (error instanceof ApiError && error.status === 413) throw layoutTooLarge(config.layoutMaxBytes);
      throw error;
    }
    const checked = checkLayoutFile(bytes);
    if (!checked.ok) throw layoutInvalid(checked.lines);
    const id = newId();
    try {
      await putObject(`layouts/${id}/original.json`, bytes, "application/octet-stream");
    } catch (error) {
      if (error instanceof StorageError) throw storageUnavailable("layouts");
      throw error;
    }
    const { layout } = checked;
    await query(pool, "INSERT INTO aerodromes (id, school_id, name, code, layout) VALUES ($1, $2, $3, $4, $5)", [id, schoolId, layout.name, layout.code, JSON.stringify(layout)]);
    return reply(201, { id, name: layout.name, code: layout.code });
  });

  route("GET", "/api/aerodromes/:id/original", async (ctx) => {
    const { schoolId } = await requireInstructor(ctx);
    const found = await aerodromeFor(ctx.params[0] ?? "", schoolId);
    if (!found.imported) throw notFound();
    try {
      return file(await getObject(`layouts/${found.id}/original.json`), {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": 'attachment; filename="layout.json"',
      });
    } catch (error) {
      if (error instanceof StorageError) throw storageUnavailable("layout-files");
      throw error;
    }
  });
}
