/** The three event streams. */

import type { Pool } from "../db/pool.js";
import type { Express, Request, Response } from "express";
import { runStream } from "./sse.js";
import { loadWorldBySlug } from "../world/world.js";
import { loadTable } from "../tables/serialize.js";

export function installStreamRoutes(app: Express, pool: Pool): void {
  app.get("/api/servers/:slug/events", async (req: Request, res: Response) => {
    const slug = req.params.slug!;
    const server = (await pool.query<{ id: string }>("SELECT id FROM servers WHERE slug = $1", [slug])).rows[0];
    if (server === undefined) {
      res.status(404).json({ error: "not_found", message: "Not found." });
      return;
    }
    await runStream(pool, res, { serverId: server.id, kind: "server" });
  });

  app.get("/api/servers/:slug/worlds/:world/events", async (req: Request, res: Response) => {
    const slug = req.params.slug!;
    const server = (await pool.query<{ id: string }>("SELECT id FROM servers WHERE slug = $1", [slug])).rows[0];
    if (server === undefined) {
      res.status(404).json({ error: "not_found", message: "Not found." });
      return;
    }
    const world = await loadWorldBySlug(pool, server.id, req.params.world!);
    if (world === null) {
      res.status(404).json({ error: "not_found", message: "Not found." });
      return;
    }
    await runStream(pool, res, { serverId: server.id, kind: "world", worldSlug: world.slug });
  });

  app.get("/api/tables/:id/events", async (req: Request, res: Response) => {
    const table = await loadTable(pool, req.params.id!);
    if (table === null) {
      res.status(404).json({ error: "not_found", message: "Not found." });
      return;
    }
    await runStream(pool, res, { serverId: table.server_id, kind: "table", tableId: table.id });
  });
}
