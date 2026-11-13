import type { Router, Request } from "express";
import type { AppContext } from "./route-context.js";
import { ApiError, sendError } from "./errors.js";
import { copy } from "../shared/copy.js";
import { requireLiveVisitPage } from "./visitpages.js";
import { checkKitCode } from "../shared/kitcode.js";
import { instantZ, localTimeIn, zoneFor } from "../shared/time.js";
import type { TimeZoneKey } from "../shared/enums.js";
import { DateTime } from "luxon";
import { param, query } from "./request-utils.js";

export function registerVisitRoutes(router: Router, ctx: AppContext): void {
  const handler = (fn: (req: Request, res: import("express").Response) => Promise<void>) => {
    return (req: Request, res: import("express").Response) => {
      void fn(req, res).catch((error) => {
        if (!res.headersSent) sendError(res, error);
        else res.end();
      });
    };
  };

  router.get("/api/visits/:token", handler(async (req, res) => {
    const token = param(req, "token");
    const { page, draw } = await requireLiveVisitPage(ctx.db, token);
    const member = await ctx.db.one<{
      name: string;
      address_line1: string | null;
      address_line2: string | null;
      city: string | null;
      state: string | null;
      postal_code: string | null;
      gate_notes: string | null;
    }>(`SELECT name, address_line1, address_line2, city, state, postal_code, gate_notes FROM members WHERE id = $1`, [
      draw.member_id,
    ]);
    const parts = splitName(member?.name ?? "");
    const timeZone = draw.time_zone as TimeZoneKey;
    const localToday = DateTime.now().setZone(zoneFor(timeZone)).toFormat("yyyy-MM-dd");
    const isDrawDay = localToday === draw.local_date;
    const showAddress = isDrawDay && draw.state === "booked";
    res.json({
      memberName: `${parts.first} ${parts.lastInitial}`.trim(),
      startsAt: instantZ(draw.starts_at),
      localDate: draw.local_date,
      localTime: draw.local_time,
      timeZone: draw.time_zone,
      isDrawDay,
      address: showAddress && member
        ? {
            line1: member.address_line1 ?? "",
            line2: member.address_line2 ?? "",
            city: member.city ?? "",
            state: member.state ?? "",
            postalCode: member.postal_code ?? "",
          }
        : null,
      gateNotes: showAddress ? member?.gate_notes ?? null : null,
      kitCodes: draw.kit_codes,
      state: draw.state,
      collectedAt: draw.collected_at ? instantZ(draw.collected_at) : null,
      endsAt: instantZ(page.ends_at),
    });
  }));

  router.post("/api/visits/:token/kit-codes", handler(async (req, res) => {
    const token = param(req, "token");
    const { draw } = await requireLiveVisitPage(ctx.db, token);
    if (draw.state !== "booked") {
      throw new ApiError(409, "already_collected", copy("already_collected"));
    }
    const body = req.body as { kitCode?: unknown };
    const raw = typeof body.kitCode === "string" ? body.kitCode : "";
    const kit = checkKitCode(raw);
    if (!kit.valid) {
      throw new ApiError(422, "invalid", "Check the highlighted fields.", {
        kitCode: kit.reason === "shape" ? copy("kit_code_wrong_shape") : copy("kit_code_wrong_check"),
      });
    }
    if (draw.kit_codes.includes(kit.normalized)) {
      res.json({ kitCodes: draw.kit_codes });
      return;
    }
    const kitCodes = [...draw.kit_codes, kit.normalized];
    await ctx.db.exec(`UPDATE draws SET kit_codes = $2 WHERE id = $1`, [draw.id, kitCodes]);
    res.status(201).json({ kitCodes });
  }));

  router.post("/api/visits/:token/collect", handler(async (req, res) => {
    const token = param(req, "token");
    const { draw } = await requireLiveVisitPage(ctx.db, token);
    if (draw.state !== "booked") {
      throw new ApiError(409, "already_collected", copy("already_collected"));
    }
    const timeZone = draw.time_zone as TimeZoneKey;
    const localToday = DateTime.now().setZone(zoneFor(timeZone)).toFormat("yyyy-MM-dd");
    if (localToday !== draw.local_date) {
      throw new ApiError(409, "not_draw_day", copy("not_draw_day"));
    }
    if (draw.kit_codes.length === 0) {
      throw new ApiError(409, "kit_code_required", copy("kit_code_required"));
    }
    const collectedAt = new Date();
    await ctx.db.exec(`UPDATE draws SET state = 'collected', collected_at = $2 WHERE id = $1`, [
      draw.id,
      collectedAt,
    ]);
    res.json({
      state: "collected",
      collectedAt: instantZ(collectedAt),
      markedAt: localTimeIn(collectedAt, zoneFor(timeZone)),
    });
  }));
}

function splitName(name: string): { first: string; lastInitial: string } {
  const parts = name.trim().split(/\s+/);
  const first = parts[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1] ?? "") : "";
  return { first, lastInitial: last.length > 0 ? `${last[0]}.` : "" };
}

