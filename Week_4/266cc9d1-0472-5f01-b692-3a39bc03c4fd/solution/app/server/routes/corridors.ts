// Corridors, their towers and coverage, and the flight endpoint.
import type { Db } from "../db.js";
import { activeAssets } from "../domain/assets.js";
import { corridorJson, listCorridors, loadCorridor, towersJson, type CorridorRecord } from "../domain/corridor.js";
import { flightAnswer, readFlightQuery, readTrack, type FlightQuery, type Track } from "../domain/flight.js";
import { fail } from "../http/errors.js";
import { json, noInput, staffRoute, type Route } from "../http/pipeline.js";

export async function activeTrack(db: Db, corridorId: string): Promise<Track | null> {
  const czml = (await activeAssets(db, corridorId)).czml;
  return czml === null ? null : readTrack(db, czml);
}

/** The corridor detail shared by the workspace and the review page. */
export async function corridorDetail(db: Db, corridor: CorridorRecord): Promise<Record<string, unknown>> {
  const track = await activeTrack(db, corridor.id);
  return {
    corridor: await corridorJson(db, corridor),
    towers: towersJson(corridor),
    active_assets: await activeAssets(db, corridor.id),
    coverage: track?.coverage ?? [],
  };
}

export function validFlightQuery(query: URLSearchParams, corridor: CorridorRecord): FlightQuery {
  const read = readFlightQuery(query, corridor);
  if ("fields" in read) throw fail.validation(read.fields);
  return read;
}

export const corridorRoutes: Route[] = [
  staffRoute({
    method: "GET",
    path: "/api/corridors",
    load: (ctx) => listCorridors(ctx.db, ctx.staff.tenantId),
    validate: noInput,
    perform: async (ctx, corridors) =>
      json(200, { corridors: await Promise.all(corridors.map((c) => corridorJson(ctx.db, c))) }),
  }),

  staffRoute({
    method: "GET",
    path: "/api/corridors/:id",
    load: (ctx) => loadCorridor(ctx.db, ctx.staff.tenantId, ctx.params.id ?? ""),
    validate: noInput,
    perform: async (ctx, corridor) => json(200, await corridorDetail(ctx.db, corridor)),
  }),

  staffRoute({
    method: "GET",
    path: "/api/corridors/:id/flight",
    load: (ctx) => loadCorridor(ctx.db, ctx.staff.tenantId, ctx.params.id ?? ""),
    validate: (ctx, corridor) => validFlightQuery(ctx.query, corridor),
    perform: async (ctx, corridor, query) => json(200, flightAnswer(await activeTrack(ctx.db, corridor.id), corridor, query)),
  }),
];
