import { isUuid, requireMember } from "./access.ts";
import type { Database } from "./db.ts";
import { rows } from "./db.ts";
import { notFound, writeJson } from "./errors.ts";
import type { Router } from "./http.ts";
import type { Person } from "../shared/types.ts";

interface ShaderVersionRow {
  number: number;
  sha256: string;
  size: number;
  created_at: Date;
  restored_from: number | null;
  user_id: string;
  display_name: string;
}

export class ShaderRoutes {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  private async requireShader(setId: string, layerId: string): Promise<void> {
    const found = isUuid(layerId)
      ? await rows(this.db, "SELECT 1 FROM layers WHERE id = $1 AND set_id = $2 AND kind = 'shader'", [layerId, setId])
      : [];
    if (found.length === 0) throw notFound();
  }

  register(router: Router): void {
    router.add("GET", "/api/sets/:id/layers/:layerId/shader/versions", {}, async (ctx) => {
      const membership = await requireMember(this.db, ctx);
      const layerId = ctx.params["layerId"] ?? "";
      await this.requireShader(membership.setId, layerId);
      const found = await rows<ShaderVersionRow>(
        this.db,
        `SELECT v.number, v.sha256, v.size, v.created_at, v.restored_from, u.id AS user_id, u.display_name
         FROM shader_versions v JOIN users u ON u.id = v.author_id WHERE v.layer_id = $1 ORDER BY v.number DESC`,
        [layerId],
      );
      const versions = found.map((row) => {
        const author: Person = { user_id: row.user_id, display_name: row.display_name };
        return { number: row.number, sha256: row.sha256, size: row.size, author, created_at: row.created_at.toISOString(), restored_from: row.restored_from };
      });
      writeJson(ctx.res, 200, { versions });
    });

    router.add("GET", "/api/sets/:id/layers/:layerId/shader/versions/:number", {}, async (ctx) => {
      const membership = await requireMember(this.db, ctx);
      const layerId = ctx.params["layerId"] ?? "";
      await this.requireShader(membership.setId, layerId);
      const wanted = Number(ctx.params["number"]);
      const [version] = Number.isInteger(wanted)
        ? await rows<{ number: number; source: string; sha256: string }>(
          this.db, "SELECT number, source, sha256 FROM shader_versions WHERE layer_id = $1 AND number = $2", [layerId, wanted])
        : [];
      if (!version) throw notFound();
      writeJson(ctx.res, 200, version);
    });
  }
}
