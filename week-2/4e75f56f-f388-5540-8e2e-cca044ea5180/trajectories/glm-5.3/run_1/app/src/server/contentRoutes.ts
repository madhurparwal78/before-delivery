import { Router } from "express";
import type { Config } from "./config.js";
import { query, withTransaction } from "./db.js";
import { accountFromRequest, requireRole } from "./auth.js";
import { validation, contentUnavailable } from "./errors.js";
import { PocketBase, COLLECTIONS } from "./pocketbase.js";
import { CONTENT_LOCK_KEY } from "./locks.js";

interface Session {
  [key: string]: unknown;
  id: string;
  number: number;
  day: number;
  title: string;
  format: "lecture" | "hands-on";
  minutes: number;
  outcomes: string;
}

/** The hands-on rule, in one place: h × 10 ≥ t × 3. */
export function handsOnOk(handsOnMinutes: number, totalMinutes: number): boolean {
  return handsOnMinutes * 10 >= totalMinutes * 3;
}

const HANDS_ON_ERROR = "Hands-on time must stay at least 30% of the agenda.";

export function makeContentRouter(cfg: Config, pb: PocketBase): Router {
  const router = Router();

  // GET /api/content — anonymous allowed, read live from PocketBase.
  router.get("/content", async (req, res, next) => {
    try {
      const viewer = await accountFromRequest(req);
      const [sessions, hospitality, hotels, faq] = await Promise.all([
        pb.list(COLLECTIONS.sessions),
        pb.list(COLLECTIONS.hospitality),
        pb.list(COLLECTIONS.hotels),
        pb.list(COLLECTIONS.faq),
      ]);
      // Atelier-only evenings are gated unless the viewer may see them.
      let maySeeAtelier = viewer?.role === "director";
      if (!maySeeAtelier && viewer) {
        const { rows } = await query(
          `SELECT 1 FROM reservations
           WHERE (buyer_id = $1 OR (attendee_email = $2 AND attendee_accepted = true))
             AND tier = 'atelier'
             AND state IN ('deposit_paid','paid_in_full','checked_in_day1','checked_in_day2','certificate_issued')
           LIMIT 1`,
          [viewer.id, viewer.email]
        );
        maySeeAtelier = rows.length > 0;
      }
      const sessionsOut = (sessions as unknown as Session[])
        .map((s) => ({ id: s.id, number: Number(s.number), day: Number(s.day), title: s.title, format: s.format, minutes: Number(s.minutes), outcomes: s.outcomes }))
        .sort((a, b) => a.day - b.day || a.number - b.number);
      const hospitalityOut = (hospitality as unknown as Record<string, string | number>[]).map((h) => {
        const tier = String(h.tier) === "atelier" ? "atelier" : "all";
        const gated = tier === "atelier" && !maySeeAtelier;
        return gated
          ? { id: h.id, title: h.title, day: Number(h.day), tier, gated: true }
          : {
              id: h.id,
              title: h.title,
              day: Number(h.day),
              tier,
              starts_at: h.starts_at,
              venue: h.venue,
              description: h.description,
              gated: false,
            };
      });
      const hotelsOut = hotels.map((h) => ({ id: h.id, name: h.name, distance: h.distance, rate: h.rate, map_url: h.map_url }));
      const faqOut = (faq as unknown as Record<string, string | number>[])
        .map((f) => ({ id: f.id, question: f.question, answer: f.answer, sort: Number(f.sort) }))
        .sort((a, b) => a.sort - b.sort);
      res.json({ sessions: sessionsOut, hospitality: hospitalityOut, hotels: hotelsOut, faq: faqOut });
    } catch (e) {
      next(e);
    }
  });

  // Content desk, role director.
  const kinds: Record<string, string> = {
    sessions: COLLECTIONS.sessions,
    hospitality: COLLECTIONS.hospitality,
    hotels: COLLECTIONS.hotels,
    faq: COLLECTIONS.faq,
  };

  router.get("/desk/content/:kind", async (req, res, next) => {
    try {
      await requireRole(req, "director");
      const collection = kinds[req.params.kind!];
      if (!collection) {
        res.status(404).json({ error: "not_found", message: "Nothing here." });
        return;
      }
      let items = await pb.list(collection);
      if (req.params.kind === "sessions") {
        items = (items as unknown as Session[]).slice().sort((a, b) => Number(a.day) - Number(b.day) || Number(a.number) - Number(b.number));
      }
      res.json({ items });
    } catch (e) {
      next(e);
    }
  });

  const validateItem = (kind: string, body: Record<string, unknown>, partial: boolean): Record<string, unknown> | { errors: Record<string, string> } => {
    const errors: Record<string, string> = {};
    const out: Record<string, unknown> = {};
    const str = (v: unknown, field: string, max: number, required: boolean) => {
      if (v === undefined || v === null) {
        if (required && !partial) errors[field] = "This field is required.";
        return undefined;
      }
      if (typeof v !== "string" || v.length < 1 || v.length > max) {
        errors[field] = `Enter between 1 and ${max} characters.`;
        return undefined;
      }
      return v;
    };
    const int = (v: unknown, field: string, min: number | null, max: number | null, required: boolean) => {
      if (v === undefined || v === null) {
        if (required && !partial) errors[field] = "This field is required.";
        return undefined;
      }
      const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
      if (!Number.isFinite(n) || !Number.isInteger(n) || (min !== null && n < min) || (max !== null && n > max)) {
        errors[field] = min !== null && max !== null ? `Enter a whole number from ${min} to ${max}.` : "Enter a whole number.";
        return undefined;
      }
      return n;
    };
    if (kind === "sessions") {
      out.number = int(body.number, "number", 1, null, true);
      out.day = int(body.day, "day", 1, 2, true);
      out.title = str(body.title, "title", 120, true);
      const format = body.format;
      if (format === undefined || format === null) {
        if (!partial) errors.format = "Choose lecture or hands-on.";
      } else if (format !== "lecture" && format !== "hands-on") {
        errors.format = "Choose lecture or hands-on.";
      } else {
        out.format = format;
      }
      out.minutes = int(body.minutes, "minutes", 15, 480, true);
      if (body.outcomes === undefined || body.outcomes === null) {
        if (!partial) out.outcomes = "";
      } else {
        const v = body.outcomes;
        if (typeof v !== "string" || v.length > 600) errors.outcomes = "Keep outcomes within 600 characters.";
        else out.outcomes = v;
      }
    } else if (kind === "hospitality") {
      out.title = str(body.title, "title", 200, true);
      out.day = int(body.day, "day", 1, 2, true);
      const starts = body.starts_at;
      if (starts === undefined || starts === null) {
        if (!partial) errors.starts_at = "Enter a time as HH:MM.";
      } else if (typeof starts !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(starts)) {
        errors.starts_at = "Enter a time as HH:MM.";
      } else {
        out.starts_at = starts;
      }
      out.venue = str(body.venue, "venue", 200, true);
      const tier = body.tier;
      if (tier === undefined || tier === null) {
        if (!partial) errors.tier = "Choose all or atelier.";
      } else if (tier !== "all" && tier !== "atelier") {
        errors.tier = "Choose all or atelier.";
      } else {
        out.tier = tier;
      }
      if (body.description === undefined || body.description === null) {
        if (!partial) out.description = "";
      } else {
        const v = body.description;
        if (typeof v !== "string" || v.length > 2000) errors.description = "Keep the description within 2000 characters.";
        else out.description = v;
      }
    } else if (kind === "hotels") {
      out.name = str(body.name, "name", 200, true);
      out.distance = str(body.distance, "distance", 200, true);
      out.rate = str(body.rate, "rate", 200, true);
      const mapUrl = body.map_url;
      if (typeof mapUrl !== "string" || !mapUrl.startsWith("https://")) errors.map_url = "Enter an https URL.";
      else out.map_url = mapUrl;
    } else if (kind === "faq") {
      out.question = str(body.question, "question", 600, true);
      out.answer = str(body.answer, "answer", 2000, true);
      out.sort = int(body.sort, "sort", null, null, true);
    }
    if (Object.keys(errors).length > 0) return { errors };
    return out;
  };

  /** One agenda write at a time, checked and written together under the content
   * lock, so of two simultaneous writes that would break the rule together
   * exactly one succeeds and the stored agenda always satisfies the rule. */
  const checkedSessionWrite = async (
    op: "create" | "patch",
    req: import("express").Request,
    res: import("express").Response
  ): Promise<void> => {
    await requireRole(req, "director");
    const collection = COLLECTIONS.sessions;
    const body = req.body as Record<string, unknown>;
    const parsed = validateItem("sessions", body, op === "patch");
    if ("errors" in parsed) {
      res.status(422).json({ error: "validation", message: "Some fields need attention.", errors: (parsed as { errors: Record<string, string> }).errors });
      return;
    }
    const fieldsRaw = parsed as Record<string, unknown>;
    const fields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fieldsRaw)) {
      if (v !== undefined) fields[k] = v;
    }
    if (op === "create" && fields.number !== undefined) {
      const items = (await pb.list(collection)) as unknown as Session[];
      if (items.some((s) => Number(s.number) === Number(fields.number))) {
        res.status(422).json({ error: "validation", message: "Some fields need attention.", errors: { number: "Choose a number no other session uses." } });
        return;
      }
    }
    const result = await withTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock($1)", [CONTENT_LOCK_KEY]);
      const items = (await pb.list(collection)) as unknown as Session[];
      const id = op === "patch" ? req.params.id! : null;
      if (op === "patch" && !items.some((s) => s.id === id)) {
        return { code: "not_found" as const };
      }
      if (op === "patch" && fields.number !== undefined) {
        if (items.some((s) => Number(s.number) === Number(fields.number) && s.id !== id)) {
          return { code: "dupe_number" as const };
        }
      }
      const projected = op === "patch"
        ? items.map((s) => (s.id === id ? { ...s, ...fields } : s))
        : [...items, { ...fields } as unknown as Session];
      const minutesOf = (s: { minutes: number | string }) => Number(s.minutes) || 0;
      const t = projected.reduce((s, x) => s + minutesOf(x), 0);
      const h = projected.filter((x) => x.format === "hands-on").reduce((s, x) => s + minutesOf(x), 0);
      if (!handsOnOk(h, t)) {
        return { code: "hands_on" as const };
      }
      // The write happens under the same lock as the check.
      if (op === "create") {
        const item = await pb.create(collection, { ...fields, outcomes: fields.outcomes ?? "" });
        return { code: "ok" as const, item };
      }
      const item = await pb.update(collection, id!, fields);
      return { code: "ok" as const, item };
    });
    if (result.code === "not_found") {
      res.status(404).json({ error: "not_found", message: "Nothing here." });
      return;
    }
    if (result.code === "dupe_number") {
      res.status(422).json({ error: "validation", message: "Some fields need attention.", errors: { number: "Choose a number no other session uses." } });
      return;
    }
    if (result.code === "hands_on") {
      res.status(422).json({ error: "validation", message: "Some fields need attention.", errors: { minutes: HANDS_ON_ERROR } });
      return;
    }
    if (op === "create") res.status(201).json({ item: result.item });
    else res.json({ item: result.item });
  };

  router.post("/desk/content/sessions", async (req, res, next) => {
    try {
      await checkedSessionWrite("create", req, res);
    } catch (e) {
      next(e);
    }
  });

  router.patch("/desk/content/sessions/:id", async (req, res, next) => {
    try {
      await checkedSessionWrite("patch", req, res);
    } catch (e) {
      next(e);
    }
  });

  const simpleCrud = (kind: string) => {
    const collection = kinds[kind]!;
    return {
      post: async (req: import("express").Request, res: import("express").Response) => {
        await requireRole(req, "director");
        const parsed = validateItem(kind, req.body as Record<string, unknown>, false);
        if ("errors" in parsed) {
          res.status(422).json({ error: "validation", message: "Some fields need attention.", errors: (parsed as { errors: Record<string, string> }).errors });
          return;
        }
        const fields = parsed as Record<string, unknown>;
        const item = await pb.create(collection, { ...fields });
        res.status(201).json({ item });
      },
      patch: async (req: import("express").Request, res: import("express").Response) => {
        await requireRole(req, "director");
        const parsed = validateItem(kind, req.body as Record<string, unknown>, true);
        if ("errors" in parsed) {
          res.status(422).json({ error: "validation", message: "Some fields need attention.", errors: (parsed as { errors: Record<string, string> }).errors });
          return;
        }
        const fields = parsed as Record<string, unknown>;
        const item = await pb.update(collection, req.params.id!, { ...fields });
        res.json({ item });
      },
      remove: async (req: import("express").Request, res: import("express").Response) => {
        await requireRole(req, "director");
        await pb.remove(collection, req.params.id!);
        res.status(204).end();
      },
    };
  };

  for (const kind of ["hospitality", "hotels", "faq"]) {
    const crud = simpleCrud(kind);
    router.post(`/desk/content/${kind}`, wrap(crud.post));
    router.patch(`/desk/content/${kind}/:id`, wrap(crud.patch));
    router.delete(`/desk/content/${kind}/:id`, wrap(crud.remove));
  }

  // Session delete, checked against the hands-on share, one write at a time.
  router.delete("/desk/content/sessions/:id", wrap(async (req, res) => {
    await requireRole(req, "director");
    const collection = COLLECTIONS.sessions;
    const result = await withTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock($1)", [CONTENT_LOCK_KEY]);
      const items = (await pb.list(collection)) as unknown as Session[];
      if (!items.some((s) => s.id === req.params.id)) {
        return { code: "not_found" as const };
      }
      const projected = items.filter((s) => s.id !== req.params.id);
      const minutesOf = (s: { minutes: number | string }) => Number(s.minutes) || 0;
      const t = projected.reduce((s, x) => s + minutesOf(x), 0);
      const h = projected.filter((x) => x.format === "hands-on").reduce((s, x) => s + minutesOf(x), 0);
      if (!handsOnOk(h, t)) {
        return { code: "hands_on" as const };
      }
      await pb.remove(collection, req.params.id!);
      return { code: "ok" as const };
    });
    if (result.code === "not_found") {
      res.status(404).json({ error: "not_found", message: "Nothing here." });
      return;
    }
    if (result.code === "hands_on") {
      res.status(422).json({ error: "validation", message: "Some fields need attention.", errors: { minutes: HANDS_ON_ERROR } });
      return;
    }
    res.status(204).end();
  }));

  function wrap(handler: (req: import("express").Request, res: import("express").Response) => Promise<void>) {
    return async (req: import("express").Request, res: import("express").Response, next: (e: unknown) => void) => {
      try {
        await handler(req, res);
      } catch (e) {
        next(e);
      }
    };
  }

  return router;
}
