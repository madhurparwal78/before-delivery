import { Hono } from "hono";
import { pool, tx } from "../db.js";
import { StorageError, forbidden, storageUnavailable } from "../errors.js";
import { can } from "../domain/permissions.js";
import { documentJson } from "../domain/serialize.js";
import { listTemplates, loadTemplate, moveTemplate, templateView, useTemplate } from "../domain/templates.js";

import { jsonBody, requireActor } from "./context.js";

export const templateRoutes = new Hono();

templateRoutes.get("/", async (c) => {
  const actor = await requireActor(c);
  return c.json({ templates: await listTemplates(pool, actor) });
});

templateRoutes.get("/:id", async (c) => {
  const actor = await requireActor(c);
  return c.json(await templateView(pool, await loadTemplate(pool, actor, c.req.param("id"))));
});

for (const action of ["share", "retire"] as const) {
  templateRoutes.post(`/:id/${action}`, async (c) => {
    const actor = await requireActor(c);
    const moved = await tx(async (client) => {
      const template = await loadTemplate(client, actor, c.req.param("id"), true);
      if (!can(actor, "template.manage")) throw forbidden();
      return moveTemplate(client, template, action);
    });
    return c.json(await templateView(pool, moved));
  });
}

templateRoutes.post("/:id/use", async (c) => {
  const actor = await requireActor(c);
  const body = await jsonBody(c);
  try {
    const document = await tx(async (client) => {
      const template = await loadTemplate(client, actor, c.req.param("id"), true);
      if (!can(actor, "template.use")) throw forbidden();
      return useTemplate(client, template, actor, body);
    });
    return c.json(await documentJson(pool, document), 201);
  } catch (error) {
    if (error instanceof StorageError) throw storageUnavailable();
    throw error;
  }
});


