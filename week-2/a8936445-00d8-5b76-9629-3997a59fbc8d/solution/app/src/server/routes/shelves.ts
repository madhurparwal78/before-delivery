// Walk-in storage shelves (brief: Shelves).
import type { Shelf } from "../../shared/api";
import { audit, one, pool, rows, transaction } from "../db";
import { notFound, tenantNotActive, validation } from "../errors";
import { route, type Ctx } from "../http";
import { tenantRows, tenantStanding } from "../records";

const SHELF_SELECT = `SELECT s.id, s.name, s.monthly_rate_cents, s.tenant_id, t.business_name AS tenant_name
  FROM shelves s LEFT JOIN tenants t ON t.id = s.tenant_id`;

async function loadShelf(ctx: Ctx<undefined>): Promise<Shelf> {
  const shelf = await one<Shelf>(pool, `${SHELF_SELECT} WHERE s.id = $1`, [ctx.params.id]);
  if (!shelf) throw notFound();
  return shelf;
}

export const shelfRoutes = [
  route({
    method: "GET",
    path: "/api/shelves",
    roles: ["operator", "owner"],
    async handle(ctx) {
      const shelves = await rows<Shelf>(pool, `${SHELF_SELECT} WHERE ($1::text IS NULL OR s.tenant_id = $1) ORDER BY s.position`, [
        ctx.user.role === "operator" ? null : ctx.user.tenant_id,
      ]);
      return { status: 200, json: { shelves } };
    },
  }),
  route<Shelf>({
    method: "PUT",
    path: "/api/shelves/:id",
    roles: ["operator"],
    body: "json",
    load: loadShelf,
    async handle(ctx) {
      const tenantId = ctx.json.tenant_id;
      if (tenantId !== null && typeof tenantId !== "string") throw validation({ tenant_id: "Choose a tenant, or none to free the shelf." });
      await transaction(async (db) => {
        if (tenantId !== null) {
          const [tenant] = await tenantRows(db, tenantId);
          if (!tenant) throw validation({ tenant_id: "Choose a tenant, or none to free the shelf." });
          if ((await tenantStanding(db, tenant, ctx.nowMs)).status !== "active") {
            throw tenantNotActive();
          }
        }
        await db.query("UPDATE shelves SET tenant_id = $2 WHERE id = $1", [ctx.loaded.id, tenantId]);
        await audit(db, ctx.user.id, "shelf", ctx.loaded.id, tenantId === null ? "freed" : "assigned", { tenant_id: tenantId });
      });
      return { status: 200, json: await one<Shelf>(pool, `${SHELF_SELECT} WHERE s.id = $1`, [ctx.loaded.id]) };
    },
  }),
];
