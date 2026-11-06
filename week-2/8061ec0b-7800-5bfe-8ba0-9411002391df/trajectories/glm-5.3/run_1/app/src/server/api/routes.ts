// Route registrar: wires every API module onto the HTTP server, and serves
// the catalog endpoints (availability and schools).
import type { PoolClient } from "pg";
import type { ApiRequest, FileResponse, JsonResponseBody } from "../http/server.js";
import type { HttpServer } from "../http/server.js";
import type { Db } from "../db.js";
import type { Clock } from "../clock.js";
import type { AppConfig } from "../config.js";
import { ApiError } from "../errors.js";
import type { StorageService } from "../services/storage.js";
import type { KillBillClient } from "../services/killbill.js";
import type { Mailer } from "../services/mailer.js";
import { requireUser, serverNowIso } from "./helpers.js";

export type HandlerResult = JsonResponseBody | FileResponse | ApiError | undefined;
export type Handler = (req: ApiRequest) => Promise<HandlerResult>;

export interface RouteRegistrar {
  db: Db;
  clock: Clock;
  config: AppConfig;
  storage: StorageService;
  killbill: KillBillClient;
  mailer: Mailer;
  add: (method: string, path: string, handler: Handler, options?: { multipart?: boolean; jsonBody?: boolean }) => void;
}

export function isoSecond(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

// The contract row joined with its instrument, as every contract surface sees it.
export async function loadContract(
  client: PoolClient,
  id: string
): Promise<Record<string, unknown> | null> {
  const rows = await client.query<Record<string, unknown>>(
    `SELECT c.*, i.serial, i.instrument_type, i.size, i.model
       FROM contracts c JOIN instruments i ON i.id = c.instrument_id
      WHERE c.id = $1`,
    [id]
  );
  return rows.rows.length > 0 ? rows.rows[0] : null;
}

export async function familyContact(
  client: PoolClient,
  familyId: string
): Promise<{ parent_name: string; email: string } | null> {
  const rows = await client.query<{ parent_name: string; email: string }>(
    "SELECT parent_name, email FROM families WHERE id = $1",
    [familyId]
  );
  return rows.rows.length > 0 ? rows.rows[0] : null;
}

// The origin used in email links.
export function originOf(config: AppConfig): string {
  return config.publicUrl ?? `http://localhost:${config.port}`;
}

export function registerAllRoutes(
  server: HttpServer,
  deps: {
    db: Db;
    clock: Clock;
    config: AppConfig;
    storage: StorageService;
    killbill: KillBillClient;
    mailer: Mailer;
  }
): void {
  const registrar: RouteRegistrar = {
    ...deps,
    add: (method, path, handler, options) => {
      server.addRoute(method, path, async (req) => {
        try {
          return await handler(req);
        } catch (err) {
          if (err instanceof ApiError) return err;
          throw err;
        }
      }, options);
    },
  };
  registerSessionRoutes(registrar);
  registerCatalogRoutes(registrar);
  registerManageRoutes(registrar);
  registerContractRoutes(registrar);
  registerMoneyRoutes(registrar);
  registerSigningRoutes(registrar);
  registerRosterRoutes(registrar);
}

import { registerSessionRoutes } from "./session.js";
import { registerManageRoutes } from "./manage.js";
import { registerContractRoutes } from "./contracts.js";
import { registerMoneyRoutes } from "./money.js";
import { registerSigningRoutes } from "./signing.js";
import { registerRosterRoutes } from "./roster.js";

function registerCatalogRoutes(reg: RouteRegistrar): void {
  reg.add("GET", "/api/availability", async (req) => {
    await requireUser(reg.db, req.sessionToken);
    const items = await reg.db.withTransaction(async (client) => {
      const rows = await client.query<Record<string, unknown>>(
        `SELECT instrument_type, size, COUNT(*) AS n FROM instruments
          WHERE status = 'available' GROUP BY instrument_type, size`
      );
      const counts = new Map<string, number>();
      for (const row of rows.rows) {
        counts.set(`${row.instrument_type}|${row.size}`, Number(row.n));
      }
      const order: [string, string][] = [
        ["flute", "full"],
        ["clarinet", "full"],
        ["trumpet", "full"],
        ["violin", "1/4"],
        ["violin", "1/2"],
        ["violin", "3/4"],
        ["violin", "4/4"],
        ["cello", "1/4"],
        ["cello", "1/2"],
        ["cello", "3/4"],
        ["cello", "4/4"],
      ];
      return order.map(([instrument_type, size]) => ({
        instrument_type,
        size,
        available: counts.get(`${instrument_type}|${size}`) ?? 0,
      }));
    });
    return { status: 200, body: { items } };
  });

  reg.add("GET", "/api/schools", async (req) => {
    await requireUser(reg.db, req.sessionToken);
    const now = reg.clock.now();
    const schools = await reg.db.withTransaction(async (client) => {
      const rows = await client.query<Record<string, unknown>>(
        "SELECT id, name, delivery_weekday FROM schools ORDER BY ordinal"
      );
      const { upcomingDeliveryDays, nextDeliveryDay } = await import("../domain/delivery.js");
      return rows.rows.map((r) => {
        const school = {
          id: r.id as string,
          name: r.name as string,
          delivery_weekday: r.delivery_weekday as string,
        };
        const next = nextDeliveryDay(school, now);
        return {
          id: school.id,
          name: school.name,
          delivery_weekday: school.delivery_weekday,
          next_delivery_date: next.date,
          cutoff_at: isoSecond(next.cutoff_at),
          upcoming_delivery_days: upcomingDeliveryDays(school, now).map((d) => ({
            date: d.date,
            cutoff_at: isoSecond(d.cutoff_at),
          })),
        };
      });
    });
    return { status: 200, body: { server_now: serverNowIso(reg.clock), schools } };
  });
}
