import { randomUUID } from "node:crypto";
import { config } from "../config.ts";
import { one, query } from "../db/pool.ts";
import { copy } from "../domain/copy.ts";
import { addSeconds, instant, wholeSecond } from "../domain/time.ts";
import { LANGUAGES, type Language, TOWNS, TOWN_NAMES, type Town } from "../domain/towns.ts";
import { conflict, invalid, notFound } from "../http/errors.ts";
import { type Ctx, empty, json, route } from "../http/router.ts";
import { clientEntryId, entryOfClient, syncEntries } from "../providers/meili.ts";
import { type Body, bodyOf, checkFields, emailField, requiredText } from "./fields.ts";

const NAME_LIMIT = 120;

interface ClientRow {
  id: string;
  desk_id: string;
  name: string;
  town: Town;
  language: Language;
  email: string | null;
  state: string;
  closes_at: Date | null;
}

function clientBody(row: ClientRow): Record<string, unknown> {
  if (row.state === "erased") return { id: row.id, name: row.name, state: row.state };
  return { id: row.id, name: row.name, town: row.town, language: row.language, email: row.email, state: row.state, closesAt: row.closes_at ? instant(row.closes_at) : null };
}

/** A client of this desk that has not reached `erasing`; anything else is 404. */
export async function findClient(deskId: string, clientId: string): Promise<ClientRow | null> {
  return one<ClientRow>("SELECT * FROM clients WHERE id = $1 AND desk_id = $2 AND state NOT IN ('erasing', 'erased')", [clientId, deskId]);
}

async function clientResource(ctx: Ctx): Promise<void> {
  const client = await findClient(ctx.deskId, ctx.params.id as string);
  if (!client) throw notFound();
  ctx.loaded.client = client;
}

function townField(body: Body): Town {
  const town = requiredText(body, "town", NAME_LIMIT);
  if (!TOWN_NAMES.includes(town as Town)) throw invalid("town", copy("F-08"));
  return town as Town;
}

function languageField(body: Body): Language {
  if (!LANGUAGES.includes(body.language as Language)) throw invalid("language", copy("F-08"));
  return body.language as Language;
}

export function register(): void {
  route({
    method: "GET",
    pattern: "/api/clients",
    handle: async (ctx) => {
      const rows = await query<ClientRow>("SELECT * FROM clients WHERE desk_id = $1 ORDER BY created_at, id", [ctx.deskId]);
      return json(200, { clients: rows.map(clientBody) });
    },
  });

  route({
    method: "POST",
    pattern: "/api/clients",
    handle: async (ctx) => {
      const body = bodyOf(ctx);
      const fields = checkFields({
        name: () => requiredText(body, "name", NAME_LIMIT),
        town: () => townField(body),
        email: () => emailField(body),
        language: () => (body.language === undefined ? null : languageField(body)),
      });
      const language = fields.language ?? TOWNS[fields.town].language;
      const id = randomUUID();
      const row = await one<ClientRow>(
        "INSERT INTO clients (id, desk_id, name, town, language, email) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
        [id, ctx.deskId, fields.name, fields.town, language, fields.email],
      );
      syncEntries([entryOfClient(ctx.deskId, { id, name: fields.name })]);
      return json(201, { client: clientBody(row as ClientRow) });
    },
  });

  route({
    method: "GET",
    pattern: "/api/clients/:id",
    resource: clientResource,
    handle: async (ctx) => json(200, { client: clientBody(ctx.loaded.client as ClientRow) }),
  });

  route({
    method: "PATCH",
    pattern: "/api/clients/:id",
    resource: clientResource,
    handle: async (ctx) => {
      const body = bodyOf(ctx);
      const client = ctx.loaded.client as ClientRow;
      const fields = checkFields({
        name: () => ("name" in body ? requiredText(body, "name", NAME_LIMIT) : client.name),
        town: () => ("town" in body ? townField(body) : client.town),
        language: () => ("language" in body ? languageField(body) : client.language),
        email: () => ("email" in body ? emailField(body) : client.email),
      });
      const row = await one<ClientRow>(
        "UPDATE clients SET name = $2, town = $3, language = $4, email = $5 WHERE id = $1 AND state IN ('active', 'closing') RETURNING *",
        [client.id, fields.name, fields.town, fields.language, fields.email],
      );
      if (!row) throw notFound();
      if (fields.name !== client.name) syncEntries([entryOfClient(ctx.deskId, { id: client.id, name: fields.name })]);
      return json(200, { client: clientBody(row) });
    },
  });

  route({
    method: "DELETE",
    pattern: "/api/clients/:id",
    resource: clientResource,
    handle: async (ctx) => {
      const client = ctx.loaded.client as ClientRow;
      if (await one("SELECT 1 FROM pieces WHERE client_id = $1 LIMIT 1", [client.id])) throw conflict("clientHasPieces", copy("F-98"));
      await query("DELETE FROM clients WHERE id = $1", [client.id]);
      syncEntries([], [clientEntryId(ctx.deskId, client.id)]);
      return empty(204);
    },
  });

  route({
    method: "POST",
    pattern: "/api/clients/:id/close",
    resource: clientResource,
    handle: async (ctx) => {
      const client = ctx.loaded.client as ClientRow;
      const row = await one<ClientRow>(
        "UPDATE clients SET state = 'closing', closes_at = COALESCE(closes_at, $2) WHERE id = $1 AND state IN ('active', 'closing') RETURNING *",
        [client.id, addSeconds(wholeSecond(), config.closureWaitSeconds)],
      );
      if (!row) throw notFound();
      return json(200, { client: clientBody(row) });
    },
  });

  route({
    method: "POST",
    pattern: "/api/clients/:id/bring-back",
    resource: clientResource,
    handle: async (ctx) => {
      const client = ctx.loaded.client as ClientRow;
      const row = await one<ClientRow>(
        "UPDATE clients SET state = 'active', closes_at = NULL WHERE id = $1 AND (state = 'active' OR (state = 'closing' AND closes_at > now())) RETURNING *",
        [client.id],
      );
      if (!row) throw conflict("waitEnded", copy("F-110"));
      return json(200, { client: clientBody(row) });
    },
  });
}
