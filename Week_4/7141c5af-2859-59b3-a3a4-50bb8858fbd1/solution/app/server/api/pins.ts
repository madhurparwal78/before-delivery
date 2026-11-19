import { randomUUID } from "node:crypto";
import { one, query, tx } from "../db/pool.ts";
import { copy } from "../domain/copy.ts";
import { invalid, notFound } from "../http/errors.ts";
import { empty, json, route } from "../http/router.ts";
import { type Body, bodyOf, checkFields, optionalText, requiredText } from "./fields.ts";
import { pieceOf, pieceResource } from "./resources.ts";

const KINDS = ["tear", "crack", "stain", "looseJoint", "woodworm"];
const NOTE_LIMIT = 2000;

interface PinRow {
  id: string;
  number: number;
  x_tenths: number;
  y_tenths: number;
  kind: string;
  note: string;
  signed: boolean;
}

function pinBody(row: PinRow): Record<string, unknown> {
  return { id: row.id, number: row.number, x: row.x_tenths / 10, y: row.y_tenths / 10, kind: row.kind, note: row.note, signed: row.signed };
}

/** A pin coordinate in tenths of a percent: 0 to 100 with one decimal at most. */
function tenths(body: Body, field: string): number {
  const value = body[field];
  if (typeof value !== "number") throw invalid(field, copy("F-112"));
  const scaled = Math.round(value * 10);
  if (value < 0 || value > 100 || Math.abs(value * 10 - scaled) > 1e-9) throw invalid(field, copy("F-08"));
  return scaled;
}

function kindField(body: Body): string {
  const kind = requiredText(body, "kind", 40);
  if (!KINDS.includes(kind)) throw invalid("kind", copy("F-08"));
  return kind;
}

export function register(): void {
  route({
    method: "GET",
    pattern: "/api/pieces/:id/pins",
    resource: pieceResource,
    handle: async (ctx) => {
      const rows = await query<PinRow>("SELECT * FROM pins WHERE piece_id = $1 ORDER BY y_tenths, x_tenths, number", [ctx.params.id]);
      return json(200, { pins: rows.map(pinBody) });
    },
  });

  route({
    method: "POST",
    pattern: "/api/pieces/:id/pins",
    resource: pieceResource,
    handle: async (ctx) => {
      const body = bodyOf(ctx);
      const fields = checkFields({
        x: () => tenths(body, "x"),
        y: () => tenths(body, "y"),
        kind: () => kindField(body),
        note: () => optionalText(body, "note", NOTE_LIMIT) ?? "",
      });
      const pin = await tx(async (client) => {
        const piece = await one<{ last_pin_number: number }>("UPDATE pieces SET last_pin_number = last_pin_number + 1 WHERE id = $1 RETURNING last_pin_number", [pieceOf(ctx).id], client);
        return one<PinRow>(
          "INSERT INTO pins (id, piece_id, number, x_tenths, y_tenths, kind, note, signed) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *",
          [randomUUID(), pieceOf(ctx).id, piece?.last_pin_number, fields.x, fields.y, fields.kind, fields.note, body.signed === true],
          client,
        );
      });
      return json(201, { pin: pinBody(pin as PinRow) });
    },
  });

  route({
    method: "DELETE",
    pattern: "/api/pieces/:id/pins/:pinId",
    resource: pieceResource,
    handle: async (ctx) => {
      const gone = await query("DELETE FROM pins WHERE id = $1 AND piece_id = $2 RETURNING id", [ctx.params.pinId, ctx.params.id]);
      if (gone.length === 0) throw notFound();
      return empty(204);
    },
  });
}
