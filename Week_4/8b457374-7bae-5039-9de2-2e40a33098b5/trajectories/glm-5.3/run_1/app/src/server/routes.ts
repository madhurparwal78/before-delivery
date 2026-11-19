import express, { type NextFunction, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import type { AppContext } from "./context.js";
import type { NoticeService } from "./notices.js";
import { ApiError, errors, sendError } from "./errors.js";
import { newId, newPersonKey, newFixCode } from "./ids.js";
import { isKnownZone, resolveLocalDeadline } from "./clock.js";
import { COUNTRY_BY_CODE, type CampaignStatus, type CardBehaviour, type Zone } from "../shared/domain.js";
import {
  behaviourForCard,
  campaignTotals,
  last4,
  quoteAmount,
  zoneFor,
  type PersonRow,
  type TierRow,
} from "./store.js";
import { loadCampaign, campaignView, pledgeView } from "./serialize.js";
import type { CampaignRowFull, PledgeRowFull } from "./serialize.js";
import { campaignClosedForPledging } from "./states.js";
import { feesForAmount } from "../shared/money.js";
import { imageBody, jsonBody } from "./http.js";

type Handler = (req: Request, res: Response) => Promise<void>;

function wrap(handler: Handler): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

function serializeContext(pool: AppContext["pool"]): { pool: AppContext["pool"]; now: () => Date } {
  return { pool, now: () => new Date() };
}

function jsonBodyOf(req: Request): Record<string, unknown> {
  return (req as Request & { jsonBody?: Record<string, unknown> }).jsonBody ?? {};
}

function rawBodyOf(req: Request): Buffer {
  return (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
}

function auth(req: Request): PersonRow | null {
  return (req as Request & { person?: PersonRow | null }).person ?? null;
}

async function personFromKey(ctx: AppContext, key: string | null): Promise<PersonRow | null> {
  if (key === null) return null;
  const result = await ctx.pool.query<PersonRow>(
    `SELECT id, name, email, key FROM people WHERE key = $1`,
    [key],
  );
  return result.rows[0] ?? null;
}

function bearer(req: Request): string | null {
  const header = req.header("authorization");
  if (header === undefined) return null;
  const match = /^Bearer (.+)$/.exec(header);
  return match === null ? null : match[1];
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

function bodyHash(body: unknown): string {
  return createHash("sha256").update(stableStringify(body)).digest("hex");
}

export function createApiRouter(ctx: AppContext, notices: NoticeService): express.Router {
  const router = express.Router();
  const sctx = serializeContext(ctx.pool);
  const finalWindow = ctx.config.finalWindowSeconds;
  const fixWindow = ctx.config.fixWindowSeconds;

  // ---- authentication middleware -------------------------------------------

  const requireAuth: (req: Request, res: Response, next: NextFunction) => Promise<void> = async (
    req,
    res,
    next,
  ) => {
    const key = bearer(req);
    const person = await personFromKey(ctx, key);
    if (person === null) {
      sendError(res, errors.unauthenticated());
      return;
    }
    (req as Request & { person?: PersonRow | null }).person = person;
    next();
  };

  const optionalAuth: (req: Request, res: Response, next: NextFunction) => Promise<void> = async (
    req,
    res,
    next,
  ) => {
    const key = bearer(req);
    const person = await personFromKey(ctx, key);
    (req as Request & { person?: PersonRow | null }).person = person;
    next();
  };

  // ---- status and health ---------------------------------------------------

  router.get("/api/status", (req, res) => {
    const snapshot = ctx.health.snapshot();
    res.json({
      payments: snapshot.payments ? "up" : "down",
      email: snapshot.email ? "up" : "down",
      storage: snapshot.storage ? "up" : "down",
      documents: snapshot.documents ? "up" : "down",
    });
  });

  router.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // ---- people --------------------------------------------------------------

  router.post(
    "/api/people",
    jsonBody(ctx.config.jsonBodyLimit),
    wrap(async (req, res) => {
      const body = jsonBodyOf(req);
      const name = body.name;
      const email = body.email;
      const fields: Record<string, string> = {};
      if (typeof name !== "string" || name.length < 1 || name.length > 80) {
        fields.name = "Enter your name.";
      }
      if (
        typeof email !== "string" ||
        !EMAIL_PATTERN.test(email) ||
        email.length > 254
      ) {
        fields.email = "Enter an email address.";
      }
      if (Object.keys(fields).length > 0) {
        sendError(res, errors.validation(fields));
        return;
      }
      const existing = await ctx.pool.query(`SELECT id FROM people WHERE email = $1`, [email]);
      if (existing.rows.length > 0) {
        // The email already has a key; a second key would break key-once. The
        // studio journey treats this as re-creating the same identity, so the
        // route confirms the person exists and reissues nothing.
        sendError(res, errors.validation({ email: "Enter an email address." }));
        return;
      }
      const key = newPersonKey();
      const id = newId("per");
      await ctx.pool.query(
        `INSERT INTO people (id, name, email, key) VALUES ($1, $2, $3, $4)`,
        [id, name, email, key],
      );
      res.status(201).json({ id, name, email, key });
    }),
  );

  router.get(
    "/api/me",
    requireAuth,
    wrap(async (req, res) => {
      const person = auth(req);
      if (person === null) return;
      res.json({ id: person.id, name: person.name, email: person.email });
    }),
  );

  // ---- campaigns listing ---------------------------------------------------

  const coverMediaId = async (campaignId: string): Promise<string | null> => {
    const result = await ctx.pool.query<{ id: string }>(
      `SELECT id FROM media WHERE campaign_id = $1 AND kind = 'cover' AND status = 'stored'
       ORDER BY created_at DESC LIMIT 1`,
      [campaignId],
    );
    return result.rows[0]?.id ?? null;
  };

  const campaignRowView = async (
    row: { id: string; title: string; status: string; goal: number; deadline_utc: Date },
  ) => {
    const totals = await campaignTotals(ctx.pool, row.id);
    const cover = await coverMediaId(row.id);
    const draft = row.status === "draft";
    const closed = campaignClosedForPledging(row.status as never);
    const open = !draft && !closed && row.deadline_utc.getTime() > Date.now();
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      total: totals.total,
      goal: row.goal,
      percent: Math.floor((100 * totals.total) / row.goal),
      pledging_open: open,
      cover_media_id: cover,
    };
  };

  router.get(
    "/api/campaigns",
    optionalAuth,
    wrap(async (req, res) => {
      const rows = await ctx.pool.query<{
        id: string;
        title: string;
        status: string;
        goal: number;
        deadline_utc: Date;
      }>(
        `SELECT id, title, status, goal, deadline_utc FROM campaigns
         WHERE status NOT IN ('draft')`,
      );
      const views = [];
      for (const row of rows.rows) {
        views.push({ row, view: await campaignRowView(row) });
      }
      const live = views
        .filter((v) => v.view.status === "live")
        .sort((a, b) => a.row.deadline_utc.getTime() - b.row.deadline_utc.getTime())
        .map((v) => v.view);
      const closed = views
        .filter((v) => v.view.status !== "live")
        .sort((a, b) => b.row.deadline_utc.getTime() - a.row.deadline_utc.getTime())
        .map((v) => v.view);
      res.json([...live, ...closed]);
    }),
  );

  router.get(
    "/api/me/campaigns",
    requireAuth,
    wrap(async (req, res) => {
      const person = auth(req);
      if (person === null) return;
      const rows = await ctx.pool.query<{
        id: string;
        title: string;
        status: string;
        goal: number;
        deadline_utc: Date;
        created_at: Date;
      }>(
        `SELECT id, title, status, goal, deadline_utc, created_at FROM campaigns
         WHERE creator_id = $1 ORDER BY created_at DESC`,
        [person.id],
      );
      const views = [];
      for (const row of rows.rows) {
        views.push(await campaignRowView(row));
      }
      res.json(views);
    }),
  );

  // ---- campaign validation --------------------------------------------------

  interface CampaignInput {
    title?: string;
    story?: string;
    goal?: number;
    min_run_copies?: number;
    stretch?: unknown;
    ships_from?: string;
    time_zone?: string;
    deadline_local?: string;
  }

  function validateCampaignInput(
    body: Record<string, unknown>,
    existing: { goal: number; min_run_copies: number; time_zone: string },
    forPatch: boolean,
  ): { fields: Record<string, string>; value: CampaignInput } {
    const fields: Record<string, string> = {};
    const value: CampaignInput = {};

    if (body.title !== undefined || !forPatch) {
      const title = body.title;
      if (typeof title !== "string" || title.length < 1 || title.length > 120) {
        fields.title = "Enter a title.";
      } else {
        value.title = title;
      }
    }
    if (body.story !== undefined || !forPatch) {
      const story = body.story;
      if (typeof story !== "string" || story.length > 20000) {
        fields.story = "Keep the story under 20,000 characters.";
      } else {
        value.story = story;
      }
    }
    if (body.goal !== undefined || !forPatch) {
      const goal = body.goal;
      if (typeof goal !== "number" || !Number.isInteger(goal) || goal < 10000 || goal > 10000000) {
        fields.goal = "Enter a goal between £100 and £100,000.";
      } else {
        value.goal = goal;
      }
    }
    if (body.min_run_copies !== undefined || !forPatch) {
      const minRun = body.min_run_copies;
      if (
        typeof minRun !== "number" ||
        !Number.isInteger(minRun) ||
        minRun < 10 ||
        minRun > 100000
      ) {
        fields.min_run_copies = "Enter a minimum run between 10 and 100,000 copies.";
      } else {
        value.min_run_copies = minRun;
      }
    }
    if (body.stretch !== undefined || !forPatch) {
      const stretch = body.stretch;
      if (!Array.isArray(stretch) || stretch.length > 3) {
        fields.stretch = "Add at most three break points.";
      } else {
        const previousCopies = value.min_run_copies ?? existing.min_run_copies;
        const previousAmount = value.goal ?? existing.goal;
        let valid = true;
        const parsed: { copies: number; amount: number }[] = [];
        for (const entry of stretch) {
          if (
            typeof entry !== "object" ||
            entry === null ||
            typeof (entry as { copies?: unknown }).copies !== "number" ||
            typeof (entry as { amount?: unknown }).amount !== "number" ||
            !Number.isInteger((entry as { copies: number }).copies) ||
            !Number.isInteger((entry as { amount: number }).amount)
          ) {
            valid = false;
            break;
          }
          const copies = (entry as { copies: number }).copies;
          const amount = (entry as { amount: number }).amount;
          if (copies <= previousCopies || amount <= previousAmount) {
            valid = false;
            break;
          }
          parsed.push({ copies, amount });
        }
        if (!valid) {
          fields.stretch = "Each break point needs more copies and a higher amount than the one before.";
        } else {
          value.stretch = parsed;
        }
      }
    }
    if (body.ships_from !== undefined || !forPatch) {
      const shipsFrom = body.ships_from;
      if (typeof shipsFrom !== "string" || !COUNTRY_BY_CODE.has(shipsFrom)) {
        fields.ships_from = "Choose a country.";
      } else {
        value.ships_from = shipsFrom;
      }
    }
    if (body.time_zone !== undefined || !forPatch) {
      const timeZone = body.time_zone;
      if (typeof timeZone !== "string" || !isKnownZone(timeZone)) {
        fields.time_zone = "Choose a time zone.";
      } else {
        value.time_zone = timeZone;
      }
    }
    if (body.deadline_local !== undefined || !forPatch) {
      const deadlineLocal = body.deadline_local;
      if (typeof deadlineLocal !== "string") {
        fields.deadline_local = "Enter a deadline.";
      } else {
        value.deadline_local = deadlineLocal;
      }
    }
    return { fields, value };
  }

  // ---- campaign create, read, patch -----------------------------------------

  router.post(
    "/api/campaigns",
    requireAuth,
    jsonBody(ctx.config.jsonBodyLimit),
    wrap(async (req, res) => {
      const person = auth(req);
      if (person === null) return;
      const body = jsonBodyOf(req);
      const { fields, value } = validateCampaignInput(
        body,
        { goal: 0, min_run_copies: 0, time_zone: "UTC" },
        false,
      );

      // Resolve the deadline against the zone.
      if (value.deadline_local !== undefined && value.time_zone !== undefined) {
        const resolved = resolveLocalDeadline(value.deadline_local, value.time_zone);
        if (resolved === null || resolved.skipped) {
          fields.deadline_local = "That local time does not exist in the campaign time zone.";
        }
      }
      if (Object.keys(fields).length > 0) {
        sendError(res, errors.validation(fields));
        return;
      }

      const id = newId("cmp");
      const resolved = resolveLocalDeadline(
        value.deadline_local ?? "",
        value.time_zone ?? "UTC",
      );
      await ctx.pool.query(
        `INSERT INTO campaigns
           (id, creator_id, title, story, status, goal, min_run_copies, ships_from,
            time_zone, deadline_local, deadline_utc)
         VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7, $8, $9, $10)`,
        [
          id,
          person.id,
          value.title,
          value.story,
          value.goal,
          value.min_run_copies,
          value.ships_from,
          value.time_zone,
          value.deadline_local,
          resolved === null ? new Date() : resolved.utc,
        ],
      );
      const stretch = value.stretch;
      if (Array.isArray(stretch)) {
        for (const [index, entry] of stretch.entries()) {
          await ctx.pool.query(
            `INSERT INTO stretch_breaks (campaign_id, position, copies, amount)
             VALUES ($1, $2, $3, $4)`,
            [id, index, entry.copies, entry.amount],
          );
        }
      }
      const row = await loadCampaign(ctx.pool, id);
      if (row === null) {
        sendError(res, errors.notFound());
        return;
      }
      res.status(201).json(await campaignView(sctx, row));
    }),
  );

  router.get(
    "/api/campaigns/:id",
    optionalAuth,
    wrap(async (req, res) => {
      const row = await loadCampaign(ctx.pool, req.params.id);
      if (row === null) {
        sendError(res, errors.notFound());
        return;
      }
      const person = auth(req);
      if (row.status === "draft" && person?.id !== row.creator_id) {
        sendError(res, errors.notFound());
        return;
      }
      res.json(await campaignView(sctx, row));
    }),
  );

  router.patch(
    "/api/campaigns/:id",
    requireAuth,
    jsonBody(ctx.config.jsonBodyLimit),
    wrap(async (req, res) => {
      const person = auth(req);
      if (person === null) return;
      const row = await loadCampaign(ctx.pool, req.params.id);
      if (row === null || row.creator_id !== person.id) {
        sendError(res, errors.notFound());
        return;
      }
      if (row.status !== "draft") {
        sendError(res, errors.campaignNotDraft());
        return;
      }
      const { fields, value } = validateCampaignInput(
        jsonBodyOf(req),
        { goal: row.goal, min_run_copies: row.min_run_copies, time_zone: row.time_zone },
        true,
      );
      const timeZone = value.time_zone ?? row.time_zone;
      const deadlineLocal = value.deadline_local ?? row.deadline_local;
      if (value.deadline_local !== undefined || value.time_zone !== undefined) {
        const resolved = resolveLocalDeadline(deadlineLocal, timeZone);
        if (resolved === null || resolved.skipped) {
          fields.deadline_local = "That local time does not exist in the campaign time zone.";
        }
      }
      if (Object.keys(fields).length > 0) {
        sendError(res, errors.validation(fields));
        return;
      }
      const resolved = resolveLocalDeadline(deadlineLocal, timeZone);
      await ctx.pool.query(
        `UPDATE campaigns SET
           title = COALESCE($2, title),
           story = COALESCE($3, story),
           goal = COALESCE($4, goal),
           min_run_copies = COALESCE($5, min_run_copies),
           ships_from = COALESCE($6, ships_from),
           time_zone = COALESCE($7, time_zone),
           deadline_local = $8,
           deadline_utc = $9
         WHERE id = $1`,
        [
          row.id,
          value.title ?? null,
          value.story ?? null,
          value.goal ?? null,
          value.min_run_copies ?? null,
          value.ships_from ?? null,
          value.time_zone ?? null,
          deadlineLocal,
          resolved === null ? row.deadline_utc : resolved.utc,
        ],
      );
      if (Array.isArray(value.stretch)) {
        await ctx.pool.query(`DELETE FROM stretch_breaks WHERE campaign_id = $1`, [row.id]);
        for (const [index, entry] of value.stretch.entries()) {
          await ctx.pool.query(
            `INSERT INTO stretch_breaks (campaign_id, position, copies, amount)
             VALUES ($1, $2, $3, $4)`,
            [row.id, index, entry.copies, entry.amount],
          );
        }
      }
      const after = await loadCampaign(ctx.pool, row.id);
      if (after === null) {
        sendError(res, errors.notFound());
        return;
      }
      res.json(await campaignView(sctx, after));
    }),
  );

  // ---- tiers ------------------------------------------------------------------

  async function loadTier(id: string): Promise<{ tier: TierRow; campaign: CampaignRowFull } | null> {
    const tierResult = await ctx.pool.query<TierRow>(
      `SELECT id, campaign_id, title, description, price, quantity,
              shipping_domestic, shipping_europe, shipping_rest_of_world, position
       FROM tiers WHERE id = $1`,
      [id],
    );
    const tier = tierResult.rows[0];
    if (tier === undefined) return null;
    const campaign = await loadCampaign(ctx.pool, tier.campaign_id);
    if (campaign === null) return null;
    return { tier, campaign };
  }

  function tierView(tier: TierRow, claimed: number) {
    const claimedCount = tier.quantity === null ? claimed : Math.min(claimed, tier.quantity);
    return {
      id: tier.id,
      title: tier.title,
      description: tier.description,
      price: tier.price,
      quantity: tier.quantity,
      claimed: claimedCount,
      remaining: tier.quantity === null ? null : tier.quantity - claimedCount,
      shipping: {
        domestic: tier.shipping_domestic,
        europe: tier.shipping_europe,
        rest_of_world: tier.shipping_rest_of_world,
      },
    };
  }

  async function tierWithClaims(tier: TierRow) {
    const claimed = await ctx.pool.query<{ claimed: string }>(
      `SELECT COUNT(*) AS claimed FROM pledges
       WHERE tier_id = $1 AND state IN ('authorising','authorised','captured','errored')`,
      [tier.id],
    );
    return tierView(tier, Number(claimed.rows[0]?.claimed ?? 0));
  }

  router.post(
    "/api/campaigns/:id/tiers",
    requireAuth,
    jsonBody(ctx.config.jsonBodyLimit),
    wrap(async (req, res) => {
      const person = auth(req);
      if (person === null) return;
      const campaign = await loadCampaign(ctx.pool, req.params.id);
      if (campaign === null || campaign.creator_id !== person.id) {
        sendError(res, errors.notFound());
        return;
      }
      if (campaign.status !== "draft") {
        sendError(res, errors.campaignNotDraft());
        return;
      }
      const existing = await ctx.pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM tiers WHERE campaign_id = $1`,
        [campaign.id],
      );
      if (Number(existing.rows[0]?.count ?? 0) >= 8) {
        sendError(res, errors.validation({ tiers: "Add at most eight tiers." }));
        return;
      }
      const body = jsonBodyOf(req);
      const fields: Record<string, string> = {};
      const title = body.title;
      const description = body.description;
      const price = body.price;
      const quantity = body.quantity;
      const shipping = body.shipping;
      if (typeof title !== "string" || title.length < 1 || title.length > 80) {
        fields.title = "Enter a tier title.";
      }
      if (typeof description !== "string" || description.length > 1000) {
        fields.description = "Keep the description under 1,000 characters.";
      }
      if (
        typeof price !== "number" ||
        !Number.isInteger(price) ||
        price < 100 ||
        price > 1000000
      ) {
        fields.price = "Enter a price between £1 and £10,000.";
      }
      if (quantity !== null && typeof quantity !== "number") {
        fields.quantity = "Enter a quantity.";
      }

      if (
        typeof quantity === "number" &&
        (!Number.isInteger(quantity) || quantity < 1 || quantity > 100000)
      ) {
        fields.quantity = "Enter a quantity between 1 and 100,000.";
      }
      const parsedShipping: { domestic: number; europe: number; rest_of_world: number } = {
        domestic: -1,
        europe: -1,
        rest_of_world: -1,
      };
      if (
        typeof shipping !== "object" ||
        shipping === null ||
        typeof (shipping as { domestic?: unknown }).domestic !== "number" ||
        typeof (shipping as { europe?: unknown }).europe !== "number" ||
        typeof (shipping as { rest_of_world?: unknown }).rest_of_world !== "number"
      ) {
        fields.shipping = "Enter the three shipping prices.";
      } else {
        for (const key of ["domestic", "europe", "rest_of_world"] as const) {
          const value = (shipping as Record<string, number>)[key];
          if (!Number.isInteger(value) || value < 0 || value > 10000) {
            fields.shipping = "Enter shipping between £0 and £100.";
            break;
          }
          parsedShipping[key] = value;
        }
      }
      if (Object.keys(fields).length > 0) {
        sendError(res, errors.validation(fields));
        return;
      }
      const position = Number(existing.rows[0]?.count ?? 0);
      const id = newId("tir");
      await ctx.pool.query(
        `INSERT INTO tiers
           (id, campaign_id, title, description, price, quantity,
            shipping_domestic, shipping_europe, shipping_rest_of_world, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          id,
          campaign.id,
          title,
          description,
          price,
          quantity,
          parsedShipping.domestic,
          parsedShipping.europe,
          parsedShipping.rest_of_world,
          position,
        ],
      );
      const tier = (await loadTier(id))?.tier;
      if (tier === undefined) {
        sendError(res, errors.notFound());
        return;
      }
      res.status(201).json(await tierWithClaims(tier));
    }),
  );

  router.patch(
    "/api/tiers/:id",
    requireAuth,
    jsonBody(ctx.config.jsonBodyLimit),
    wrap(async (req, res) => {
      const person = auth(req);
      if (person === null) return;
      const loaded = await loadTier(req.params.id);
      if (loaded === null || loaded.campaign.creator_id !== person.id) {
        sendError(res, errors.notFound());
        return;
      }
      if (loaded.campaign.status !== "draft") {
        sendError(res, errors.campaignNotDraft());
        return;
      }
      const body = jsonBodyOf(req);
      const fields: Record<string, string> = {};
      const title = body.title;
      if (typeof title !== "string" || title.length < 1 || title.length > 80) {
        fields.title = "Enter a tier title.";
      }
      const description = body.description;
      if (typeof description !== "string" || description.length > 1000) {
        fields.description = "Keep the description under 1,000 characters.";
      }
      const price = body.price;
      if (
        typeof price !== "number" ||
        !Number.isInteger(price) ||
        price < 100 ||
        price > 1000000
      ) {
        fields.price = "Enter a price between £1 and £10,000.";
      }
      const quantity = body.quantity;
      if (
        quantity !== null &&
        (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > 100000)
      ) {
        fields.quantity = "Enter a quantity between 1 and 100,000.";
      }
      const shipping = body.shipping;
      const parsedShipping: { domestic: number; europe: number; rest_of_world: number } = {
        domestic: -1,
        europe: -1,
        rest_of_world: -1,
      };
      if (
        typeof shipping === "object" &&
        shipping !== null &&
        typeof (shipping as { domestic?: unknown }).domestic === "number" &&
        typeof (shipping as { europe?: unknown }).europe === "number" &&
        typeof (shipping as { rest_of_world?: unknown }).rest_of_world === "number"
      ) {
        for (const key of ["domestic", "europe", "rest_of_world"] as const) {
          const value = (shipping as Record<string, number>)[key];
          if (!Number.isInteger(value) || value < 0 || value > 10000) {
            fields.shipping = "Enter shipping between £0 and £100.";
            break;
          }
          parsedShipping[key] = value;
        }
      }
      if (Object.keys(fields).length > 0) {
        sendError(res, errors.validation(fields));
        return;
      }
      await ctx.pool.query(
        `UPDATE tiers SET title = $2, description = $3, price = $4, quantity = $5,
                shipping_domestic = $6, shipping_europe = $7, shipping_rest_of_world = $8
         WHERE id = $1`,
        [
          loaded.tier.id,
          title,
          description,
          price,
          quantity,
          typeof shipping === "object" && shipping !== null
            ? parsedShipping.domestic
            : loaded.tier.shipping_domestic,
          typeof shipping === "object" && shipping !== null
            ? parsedShipping.europe
            : loaded.tier.shipping_europe,
          typeof shipping === "object" && shipping !== null
            ? parsedShipping.rest_of_world
            : loaded.tier.shipping_rest_of_world,
        ],
      );
      const tier = (await loadTier(loaded.tier.id))?.tier;
      if (tier === undefined) {
        sendError(res, errors.notFound());
        return;
      }
      res.json(await tierWithClaims(tier));
    }),
  );

  router.delete(
    "/api/tiers/:id",
    requireAuth,
    wrap(async (req, res) => {
      const person = auth(req);
      if (person === null) return;
      const loaded = await loadTier(req.params.id);
      if (loaded === null || loaded.campaign.creator_id !== person.id) {
        sendError(res, errors.notFound());
        return;
      }
      if (loaded.campaign.status !== "draft") {
        sendError(res, errors.campaignNotDraft());
        return;
      }
      await ctx.pool.query(`DELETE FROM tiers WHERE id = $1`, [loaded.tier.id]);
      res.status(204).send();
    }),
  );

  // ---- media ------------------------------------------------------------------

  const EXTENSION_BY_TYPE: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
  };

  router.post(
    "/api/campaigns/:id/media",
    requireAuth,
    (req, res, next) => {
      const kind = req.query.kind;
      if (kind !== "cover" && kind !== "spread") {
        sendError(res, errors.validation({ media: "Choose a media kind." }));
        return;
      }
      (req as Request & { mediaKind?: "cover" | "spread" }).mediaKind = kind;
      next();
    },
    imageBody(ctx.config.imageBodyLimit),
    wrap(async (req, res) => {
      const person = auth(req);
      if (person === null) return;
      const campaign = await loadCampaign(ctx.pool, req.params.id);
      if (campaign === null || campaign.creator_id !== person.id) {
        sendError(res, errors.notFound());
        return;
      }
      if (campaign.status !== "draft") {
        sendError(res, errors.campaignNotDraft());
        return;
      }
      const kind = (req as Request & { mediaKind?: "cover" | "spread" }).mediaKind ?? "spread";
      const bytes = rawBodyOf(req);
      if (bytes.length === 0) {
        sendError(res, errors.validation({ media: "Choose an image." }));
        return;
      }
      if (kind === "spread") {
        const count = await ctx.pool.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM media WHERE campaign_id = $1 AND kind = 'spread'`,
          [campaign.id],
        );
        if (Number(count.rows[0]?.count ?? 0) >= 6) {
          sendError(res, errors.validation({ media: "Add at most six spreads." }));
          return;
        }
      }
      const contentType = (req.header("content-type") ?? "").split(";")[0].trim().toLowerCase();
      const mediaId = newId("med");
      const extension = EXTENSION_BY_TYPE[contentType] ?? "png";
      const objectKey = `campaigns/${campaign.id}/media/${mediaId}.${extension}`;
      const filename = req.header("x-filename") ?? null;

      if (!ctx.health.isUp("storage")) {
        await ctx.pool.query(
          `INSERT INTO media (id, campaign_id, kind, status, content_type, bytes, object_key, filename)
           VALUES ($1, $2, $3, 'failed', $4, $5, $6, $7)`,
          [mediaId, campaign.id, kind, contentType, bytes.length, objectKey, filename],
        );
        sendError(res, errors.storageUnavailable());
        return;
      }

      // Mark uploading so a concurrent read sees the honest status.
      await ctx.pool.query(
        `INSERT INTO media (id, campaign_id, kind, status, content_type, bytes, object_key, filename)
         VALUES ($1, $2, $3, 'uploading', $4, $5, $6, $7)`,
        [mediaId, campaign.id, kind, contentType, bytes.length, objectKey, filename],
      );

      if (kind === "cover") {
        const previous = await ctx.pool.query<{ id: string; object_key: string }>(
          `SELECT id, object_key FROM media
           WHERE campaign_id = $1 AND kind = 'cover' AND id <> $2`,
          [campaign.id, mediaId],
        );
        for (const row of previous.rows) {
          await ctx.pool.query(`DELETE FROM media WHERE id = $1`, [row.id]);
          await ctx.storage.remove(row.object_key);
        }
      }

      const stored = await ctx.storage.putAndConfirm(objectKey, bytes, contentType);
      if (!stored.stored) {
        await ctx.pool.query(`UPDATE media SET status = 'failed' WHERE id = $1`, [mediaId]);
        ctx.health.markDown("storage");
        sendError(res, errors.storageUnavailable());
        return;
      }
      await ctx.pool.query(`UPDATE media SET status = 'stored' WHERE id = $1`, [mediaId]);
      const row = await ctx.pool.query<{
        id: string;
        kind: string;
        status: string;
        content_type: string;
        bytes: number;
      }>(`SELECT id, kind, status, content_type, bytes FROM media WHERE id = $1`, [mediaId]);
      const media = row.rows[0];
      res.status(201).json({
        id: media.id,
        kind: media.kind,
        status: media.status,
        content_type: media.content_type,
        bytes: media.bytes,
      });
    }),
  );

  router.delete(
    "/api/media/:id",
    requireAuth,
    wrap(async (req, res) => {
      const person = auth(req);
      if (person === null) return;
      const media = await ctx.pool.query<{ id: string; campaign_id: string; object_key: string }>(
        `SELECT id, campaign_id, object_key FROM media WHERE id = $1`,
        [req.params.id],
      );
      const row = media.rows[0];
      if (row === undefined) {
        sendError(res, errors.notFound());
        return;
      }
      const campaign = await loadCampaign(ctx.pool, row.campaign_id);
      if (campaign === null || campaign.creator_id !== person.id) {
        sendError(res, errors.notFound());
        return;
      }
      if (campaign.status !== "draft") {
        sendError(res, errors.campaignNotDraft());
        return;
      }
      await ctx.pool.query(`DELETE FROM media WHERE id = $1`, [row.id]);
      await ctx.storage.remove(row.object_key);
      res.status(204).send();
    }),
  );

  router.get(
    "/api/media/:id",
    optionalAuth,
    wrap(async (req, res) => {
      const media = await ctx.pool.query<{
        id: string;
        campaign_id: string;
        status: string;
        content_type: string;
        object_key: string;
      }>(
        `SELECT id, campaign_id, status, content_type, object_key FROM media WHERE id = $1`,
        [req.params.id],
      );
      const row = media.rows[0];
      if (row === undefined || row.status !== "stored") {
        sendError(res, errors.notFound());
        return;
      }
      const campaign = await loadCampaign(ctx.pool, row.campaign_id);
      if (campaign === null) {
        sendError(res, errors.notFound());
        return;
      }
      if (campaign.status === "draft") {
        const person = auth(req);
        if (person?.id !== campaign.creator_id) {
          sendError(res, errors.notFound());
          return;
        }
      }
      const bytes = await ctx.storage.get(row.object_key);
      if (bytes === null) {
        sendError(res, errors.notFound());
        return;
      }
      res.setHeader("Content-Type", row.content_type);
      res.send(bytes);
    }),
  );

  // ---- launch -----------------------------------------------------------------

  router.post(
    "/api/campaigns/:id/launch",
    requireAuth,
    wrap(async (req, res) => {
      const person = auth(req);
      if (person === null) return;
      const campaign = await loadCampaign(ctx.pool, req.params.id);
      if (campaign === null || campaign.creator_id !== person.id) {
        sendError(res, errors.notFound());
        return;
      }
      if (campaign.status !== "draft") {
        sendError(res, errors.campaignNotDraft());
        return;
      }
      const media = await ctx.pool.query<{ kind: string; status: string }>(
        `SELECT kind, status FROM media WHERE campaign_id = $1`,
        [campaign.id],
      );
      if (media.rows.some((m) => m.status !== "stored")) {
        sendError(res, errors.mediaNotStored());
        return;
      }
      const hasCover = media.rows.some((m) => m.kind === "cover");
      const tiers = await ctx.pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM tiers WHERE campaign_id = $1`,
        [campaign.id],
      );
      const secondsLeft = Math.floor(
        (campaign.deadline_utc.getTime() - Date.now()) / 1000,
      );
      const minSeconds = ctx.config.minCampaignSeconds;
      const maxSeconds = 5184000;
      const fields: Record<string, string> = {};
      if (!hasCover) fields.cover = "Upload a cover.";
      if (Number(tiers.rows[0]?.count ?? 0) === 0) fields.tiers = "Add a reward tier.";
      if (secondsLeft < minSeconds || secondsLeft > maxSeconds) {
        fields.deadline_local = "Set a deadline between one and sixty days away.";
      }
      if (Object.keys(fields).length > 0) {
        sendError(res, errors.validation(fields));
        return;
      }
      await ctx.pool.query(
        `UPDATE campaigns SET status = 'live', launched_at = now() WHERE id = $1`,
        [campaign.id],
      );
      const after = await loadCampaign(ctx.pool, campaign.id);
      if (after === null) {
        sendError(res, errors.notFound());
        return;
      }
      res.json(await campaignView(sctx, after));
    }),
  );

  // ---- quotes ------------------------------------------------------------------

  function parseCountry(body: Record<string, unknown>): string | null {
    const country = body.country;
    if (typeof country !== "string") return null;
    if (!COUNTRY_BY_CODE.has(country)) return null;
    return country;
  }

  function parseAddOn(body: Record<string, unknown>): number | null {
    const addOn = body.add_on;
    if (typeof addOn !== "number" || !Number.isInteger(addOn) || addOn < 0 || addOn > 50000) {
      return null;
    }
    return addOn;
  }

  router.post(
    "/api/campaigns/:id/quote",
    optionalAuth,
    jsonBody(ctx.config.jsonBodyLimit),
    wrap(async (req, res) => {
      const campaign = await loadCampaign(ctx.pool, req.params.id);
      if (campaign === null || campaign.status === "draft") {
        sendError(res, errors.notFound());
        return;
      }
      const closed =
        campaignClosedForPledging(campaign.status as CampaignStatus) ||
        campaign.deadline_utc.getTime() <= Date.now();
      if (closed) {
        sendError(res, errors.campaignClosed());
        return;
      }
      const body = jsonBodyOf(req);
      const fields: Record<string, string> = {};
      const country = parseCountry(body);
      if (country === null) fields.country = "Choose a shipping country.";
      const addOn = parseAddOn(body);
      if (addOn === null) fields.add_on = "Enter an add-on from 0.00 to 500.00.";
      const tierId = body.tier_id;
      if (typeof tierId !== "string") fields.tier_id = "Choose a tier.";
      if (Object.keys(fields).length > 0) {
        sendError(res, errors.validation(fields));
        return;
      }
      const tierResult = await ctx.pool.query<TierRow>(
        `SELECT id, campaign_id, title, description, price, quantity,
                shipping_domestic, shipping_europe, shipping_rest_of_world, position
         FROM tiers WHERE id = $1 AND campaign_id = $2`,
        [tierId, campaign.id],
      );
      const tier = tierResult.rows[0];
      if (tier === undefined || country === null || addOn === null) {
        sendError(res, errors.notFound());
        return;
      }
      const zone = zoneFor(country, campaign.ships_from);
      if (zone === null) {
        sendError(res, errors.validation({ country: "Choose a shipping country." }));
        return;
      }
      const quote = quoteAmount(tier, zone, addOn);
      const totals = await campaignTotals(ctx.pool, campaign.id);
      const person = auth(req);
      let projectedTotal = totals.total + quote.amount;
      if (person !== null) {
        const own = await ctx.pool.query<{ amount: number }>(
          `SELECT amount FROM pledges
           WHERE campaign_id = $1 AND person_id = $2 AND state = 'authorised'`,
          [campaign.id, person.id],
        );
        if (own.rows.length > 0) {
          projectedTotal = totals.total - Number(own.rows[0].amount) + quote.amount;
        }
      }
      res.json({
        tier_id: tier.id,
        zone,
        reward: quote.reward,
        shipping: quote.shipping,
        add_on: addOn,
        amount: quote.amount,
        projected_total: projectedTotal,
        projected_percent: Math.floor((100 * projectedTotal) / campaign.goal),
      });
    }),
  );

  // ---- pledge helpers -----------------------------------------------------------

  async function loadPledge(
    id: string,
  ): Promise<{ pledge: PledgeRowFull; campaign: CampaignRowFull } | null> {
    const result = await ctx.pool.query<PledgeRowFull>(
      `SELECT id, campaign_id, tier_id, person_id, country, zone, reward, shipping, add_on,
              amount, state, card_last4, card_behaviour, replaces, created_at,
              captured_at, errored_at, fix_deadline, fix_count, card_fixed,
              kb_payment_id, kb_payment_method_id, last_capture_attempt
       FROM pledges WHERE id = $1`,
      [id],
    );
    const pledge = result.rows[0];
    if (pledge === undefined) return null;
    const campaign = await loadCampaign(ctx.pool, pledge.campaign_id);
    if (campaign === null) return null;
    return { pledge, campaign };
  }

  async function appendHistory(pledgeId: string, state: string): Promise<void> {
    await ctx.pool.query(
      `INSERT INTO pledge_history (pledge_id, state, at) VALUES ($1, $2, now())`,
      [pledgeId, state],
    );
  }

  function campaignClosedNow(campaign: CampaignRowFull): boolean {
    return (
      campaignClosedForPledging(campaign.status as CampaignStatus) ||
      campaign.deadline_utc.getTime() <= Date.now()
    );
  }

  /** True when the final-window guard refuses a reduction. */
  async function wouldUnfund(
    campaign: CampaignRowFull,
    reductionPence: number,
  ): Promise<boolean> {
    const secondsLeft = Math.floor(
      (campaign.deadline_utc.getTime() - Date.now()) / 1000,
    );
    if (secondsLeft > finalWindow) return false;
    const totals = await campaignTotals(ctx.pool, campaign.id);
    if (totals.total < campaign.goal) return false;
    return totals.total - reductionPence < campaign.goal;
  }

  // ---- idempotency ---------------------------------------------------------------

  interface IdempotencyGuard {
    proceed: boolean;
    replay?: { status: number; body: string };
  }

  async function idempotencyCheck(
    personKey: string,
    route: string,
    idemKey: string,
    requestHash: string,
  ): Promise<IdempotencyGuard> {
    const existing = await ctx.pool.query<{
      request_hash: string;
      status_code: number | null;
      response_body: string | null;
      in_progress: boolean;
    }>(
      `SELECT request_hash, status_code, response_body, in_progress FROM idempotency
       WHERE person_key = $1 AND route = $2 AND idem_key = $3
         AND created_at > now() - interval '24 hours'`,
      [personKey, route, idemKey],
    );
    const row = existing.rows[0];
    if (row === undefined) {
      await ctx.pool.query(
        `INSERT INTO idempotency (person_key, route, idem_key, request_hash, in_progress)
         VALUES ($1, $2, $3, $4, TRUE)
         ON CONFLICT (person_key, route, idem_key)
         DO UPDATE SET in_progress = TRUE, request_hash = EXCLUDED.request_hash
         WHERE idempotency.in_progress = FALSE OR idempotency.request_hash <> EXCLUDED.request_hash`,
        [personKey, route, idemKey, requestHash],
      );
      return { proceed: true };
    }
    if (row.request_hash !== requestHash) {
      return { proceed: false };
    }
    if (row.in_progress || row.status_code === null) {
      return { proceed: false };
    }
    return { proceed: true, replay: { status: row.status_code, body: row.response_body ?? "" } };
  }

  async function idempotencyStore(
    personKey: string,
    route: string,
    idemKey: string,
    status: number,
    body: string,
  ): Promise<void> {
    await ctx.pool.query(
      `UPDATE idempotency SET in_progress = FALSE, status_code = $4, response_body = $5
       WHERE person_key = $1 AND route = $2 AND idem_key = $3`,
      [personKey, route, idemKey, status, body],
    );
  }

  async function idempotencyRelease(
    personKey: string,
    route: string,
    idemKey: string,
  ): Promise<void> {
    await ctx.pool.query(
      `DELETE FROM idempotency
       WHERE person_key = $1 AND route = $2 AND idem_key = $3`,
      [personKey, route, idemKey],
    );
  }

  // ---- pledge creation --------------------------------------------------------

  router.post(
    "/api/campaigns/:id/pledges",
    jsonBody(ctx.config.jsonBodyLimit),
    wrap(async (req, res) => {
      const body = jsonBodyOf(req);
      const key = bearer(req);
      const person = await personFromKey(ctx, key);

      // The request can create its person in the same call. Person creation is
      // deferred until after the idempotency check so a replay never tries to
      // create the person again.
      const inlineName = body.name;
      const inlineEmail = body.email;
      const wantsInlinePerson =
        person === null && (typeof inlineName === "string" || typeof inlineEmail === "string");
      let backer: PersonRow | null = person;
      if (backer === null && !wantsInlinePerson) {
        sendError(res, errors.unauthenticated());
        return;
      }

      const idemKey = req.header("idempotency-key");
      if (idemKey === undefined || idemKey.trim() === "" || idemKey.trim().length > 64) {
        sendError(res, errors.validation({ idempotency_key: "Enter an idempotency key." }));
        return;
      }
      const scopeKey = person !== null ? person.key : `email:${String(inlineEmail ?? "")}`;
      const hash = bodyHash(body);
      const guard = await idempotencyCheck(scopeKey, "pledge", idemKey.trim(), hash);
      if (!guard.proceed) {
        const existing = await ctx.pool.query<{ request_hash: string; in_progress: boolean }>(
          `SELECT request_hash, in_progress FROM idempotency
           WHERE person_key = $1 AND route = 'pledge' AND idem_key = $2`,
          [scopeKey, idemKey.trim()],
        );
        const row = existing.rows[0];
        if (row !== undefined && row.request_hash !== hash) {
          sendError(res, errors.idempotencyConflict());
          return;
        }
        sendError(res, errors.idempotencyInProgress());
        return;
      }
      if (guard.replay !== undefined) {
        // A replay returns the stored answer, minus any key field, so no key
        // is ever returned twice.
        const replayed = JSON.parse(guard.replay.body) as Record<string, unknown>;
        delete replayed.key;
        res
          .status(guard.replay.status)
          .set("Content-Type", "application/json; charset=utf-8")
          .json(replayed);
        return;
      }

      const finish = async (error: ApiError | null, status: number, payload: unknown) => {
        if (error !== null) {
          if (error.status === 503) {
            // A 503 answer is not stored; the same key may retry after an outage.
            await idempotencyRelease(scopeKey, "pledge", idemKey.trim());
            sendError(res, error);
            return;
          }
          await idempotencyStore(
            scopeKey,
            "pledge",
            idemKey.trim(),
            error.status,
            JSON.stringify({ error: error.code }),
          );
          sendError(res, error);
          return;
        }
        const bodyText = JSON.stringify(payload);
        await idempotencyStore(scopeKey, "pledge", idemKey.trim(), status, bodyText);
        res.status(status).type("application/json").set("Content-Type", "application/json; charset=utf-8").send(bodyText);
      };

      // Create the person now, once the idempotency guard has passed. If the
      // email already exists — a person created by an attempt that failed
      // before its key was ever shown — the person is adopted and a fresh key
      // is minted, since the earlier key was never delivered to the browser.
      let newKey: string | null = null;
      if (backer === null) {
        const nameValid =
          typeof inlineName === "string" && inlineName.length >= 1 && inlineName.length <= 80;
        const emailValid =
          typeof inlineEmail === "string" &&
          EMAIL_PATTERN.test(inlineEmail) &&
          inlineEmail.length <= 254;
        const fields: Record<string, string> = {};
        if (!nameValid) fields.name = "Enter your name.";
        if (!emailValid) fields.email = "Enter an email address.";
        if (Object.keys(fields).length > 0) {
          await finish(errors.validation(fields), 422, null);
          return;
        }
        const existing = await ctx.pool.query<PersonRow>(
          `SELECT id, name, email, key FROM people WHERE email = $1`,
          [inlineEmail],
        );
        if (existing.rows.length > 0) {
          backer = existing.rows[0];
          newKey = newPersonKey();
          await ctx.pool.query(`UPDATE people SET key = $2 WHERE id = $1`, [
            backer.id,
            newKey,
          ]);
        } else {
          newKey = newPersonKey();
          const inserted = await ctx.pool.query<PersonRow>(
            `INSERT INTO people (id, name, email, key) VALUES ($1, $2, $3, $4)
             RETURNING id, name, email, key`,
            [newId("per"), inlineName, inlineEmail, newKey],
          );
          backer = inserted.rows[0];
        }
      }

      // ---- validation and state checks, in the published precedence --------

      const campaign = await loadCampaign(ctx.pool, req.params.id);
      if (campaign === null || campaign.status === "draft") {
        await finish(errors.notFound(), 404, null);
        return;
      }
      const tierId = body.tier_id;
      const tierResult =
        typeof tierId === "string"
          ? await ctx.pool.query<TierRow>(
              `SELECT id, campaign_id, title, description, price, quantity,
                      shipping_domestic, shipping_europe, shipping_rest_of_world, position
               FROM tiers WHERE id = $1 AND campaign_id = $2`,
              [tierId, campaign.id],
            )
          : null;
      const tier = tierResult?.rows[0];

      const fields: Record<string, string> = {};
      const country = typeof body.country === "string" ? body.country : null;
      if (country === null || !COUNTRY_BY_CODE.has(country)) {
        fields.country = "Choose a shipping country.";
      }
      let addOn: number | null = null;
      if (
        typeof body.add_on !== "number" ||
        !Number.isInteger(body.add_on) ||
        body.add_on < 0 ||
        body.add_on > 50000
      ) {
        fields.add_on = "Enter an add-on from 0.00 to 500.00.";
      } else {
        addOn = body.add_on;
      }
      const cardNumber = typeof body.card_number === "string" ? body.card_number : null;
      if (cardNumber === null || behaviourForCard(cardNumber) === null) {
        fields.card_number = "Use one of the test cards.";
      }
      if (tier === undefined) {
        await finish(errors.notFound(), 404, null);
        return;
      }
      if (Object.keys(fields).length > 0) {
        await finish(errors.validation(fields), 422, null);
        return;
      }
      if (country === null || addOn === null || cardNumber === null) {
        await finish(errors.validation(fields), 422, null);
        return;
      }
      const behaviour = behaviourForCard(cardNumber);
      if (behaviour === null) {
        await finish(errors.validation(fields), 422, null);
        return;
      }

      if (campaign.creator_id === backer.id) {
        await finish(errors.ownCampaign(), 403, null);
        return;
      }
      if (campaignClosedNow(campaign)) {
        await finish(errors.campaignClosed(), 409, null);
        return;
      }
      const already = await ctx.pool.query<{ id: string }>(
        `SELECT id FROM pledges
         WHERE campaign_id = $1 AND person_id = $2
           AND state IN ('authorising','authorised','captured','errored')`,
        [campaign.id, backer.id],
      );
      if (already.rows.length > 0) {
        await finish(errors.alreadyPledged(), 409, null);
        return;
      }

      const zone = zoneFor(country, campaign.ships_from);
      if (zone === null) {
        await finish(errors.validation({ country: "Choose a shipping country." }), 422, null);
        return;
      }
      const quote = quoteAmount(tier, zone, addOn);

      // ---- payment service availability, checked before any claim -----------

      if (!ctx.health.isUp("payments")) {
        await finish(errors.paymentUnavailable(), 503, null);
        return;
      }
      const account = await ctx.killbill.ensureAccount({
        id: backer.id,
        name: backer.name,
        email: backer.email,
      });
      if (!account.ok) {
        ctx.health.markDown("payments");
        await finish(errors.paymentUnavailable(), 503, null);
        return;
      }
      const method = await ctx.killbill.ensurePaymentMethod(backer.id);
      if (!method.ok) {
        ctx.health.markDown("payments");
        await finish(errors.paymentUnavailable(), 503, null);
        return;
      }

      // ---- claim the copy before any Kill Bill authorisation ------------------
      // The claim row is inserted inside a serializable transaction; a
      // concurrent claim on the last copy sees the count and is refused.
      const pledgeId = newId("pld");
      const claim = await insertClaimingPledge({
        pledgeId,
        campaign,
        tier,
        backer,
        country,
        zone,
        addOn,
        quote,
        cardNumber,
        behaviour,
      });
      if (claim.outcome === "sold_out") {
        await finish(errors.tierSoldOut(), 409, null);
        return;
      }
      if (claim.outcome === "already") {
        await finish(errors.alreadyPledged(), 409, null);
        return;
      }
      if (claim.outcome === "serialised") {
        // A concurrent request raced ahead on this backer's only slot.
        const concurrent = await ctx.pool.query<{ id: string }>(
          `SELECT id FROM pledges
           WHERE campaign_id = $1 AND person_id = $2
             AND state IN ('authorising','authorised','captured','errored')`,
          [campaign.id, backer.id],
        );
        await finish(
          concurrent.rows.length > 0 ? errors.alreadyPledged() : errors.tierSoldOut(),
          409,
          null,
        );
        return;
      }

      // ---- authorise -----------------------------------------------------------

      const auth = await ctx.killbill.authorize(
        backer.id,
        pledgeId,
        `${pledgeId}-auth`,
        quote.amount,
        behaviour === "decline_auth",
      );
      if (!auth.ok || auth.value === undefined) {
        await ctx.pool.query(`DELETE FROM pledges WHERE id = $1`, [pledgeId]);
        if (!auth.ok && auth.reason === "unavailable") {
          ctx.health.markDown("payments");
          await finish(errors.paymentUnavailable(), 503, null);
          return;
        }
        await finish(errors.cardDeclined(), 402, null);
        return;
      }

      await ctx.pool.query(
        `UPDATE pledges SET state = 'authorised', kb_payment_id = $2, kb_payment_method_id = $3
         WHERE id = $1`,
        [pledgeId, auth.value.paymentId, auth.value.paymentMethodId],
      );
      await appendHistory(pledgeId, "authorised");

      await notices.recordPledgeReceipt({
        campaignId: campaign.id,
        pledgeId,
        kind: "pledge_receipt",
        to: backer.email,
        campaignTitle: campaign.title,
        amountPence: quote.amount,
      });

      const totals = await campaignTotals(ctx.pool, campaign.id);
      const pledge = (await loadPledge(pledgeId))?.pledge;
      const payload: Record<string, unknown> = {
        ...(pledge !== undefined ? await pledgeView(sctx, pledge) : {}),
        campaign_total: totals.total,
        campaign_percent: Math.floor((100 * totals.total) / campaign.goal),
      };
      if (newKey !== null) {
        payload.key = newKey;
      }
      await finish(null, 201, payload);
    }),
  );

  /**
   * Inserts the pledge as an authorising claim inside a serializable
   * transaction. Concurrent claims on a limited tier serialise, so exactly
   * one request claims the last copy; every other is refused before any card
   * is authorised. The same transaction keeps one pledge per backer, ignoring
   * the pledge being changed so its own copy is not double-counted.
   */
  async function insertClaimingPledge(input: {
    pledgeId: string;
    campaign: CampaignRowFull;
    tier: TierRow;
    backer: PersonRow;
    country: string;
    zone: Zone;
    addOn: number;
    quote: { reward: number; shipping: number; amount: number };
    cardNumber: string;
    behaviour: CardBehaviour;
    replaces?: string;
  }): Promise<{ outcome: "claimed" | "sold_out" | "already" | "serialised" }> {
    const client = await ctx.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      try {
        const already = await client.query<{ id: string }>(
          `SELECT id FROM pledges
           WHERE campaign_id = $1 AND person_id = $2
             AND state IN ('authorising','authorised','captured','errored')
             AND id <> $3`,
          [input.campaign.id, input.backer.id, input.replaces ?? ""],
        );
        if (already.rows.length > 0) {
          await client.query("ROLLBACK");
          return { outcome: "already" };
        }
        if (input.tier.quantity !== null) {
          const claimed = await client.query<{ claimed: string }>(
            `SELECT COUNT(*) AS claimed FROM pledges
             WHERE tier_id = $1 AND state IN ('authorising','authorised','captured','errored')
               AND id <> $2`,
            [input.tier.id, input.replaces ?? ""],
          );
          if (Number(claimed.rows[0]?.claimed ?? 0) >= input.tier.quantity) {
            await client.query("ROLLBACK");
            return { outcome: "sold_out" };
          }
        }
        await client.query(
          `INSERT INTO pledges
             (id, campaign_id, tier_id, person_id, country, zone, reward, shipping, add_on,
              amount, state, card_last4, card_behaviour, replaces, kb_payment_id, kb_payment_method_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'authorising', $11, $12, $13, '', '')`,
          [
            input.pledgeId,
            input.campaign.id,
            input.tier.id,
            input.backer.id,
            input.country,
            input.zone,
            input.quote.reward,
            input.quote.shipping,
            input.addOn,
            input.quote.amount,
            last4(input.cardNumber),
            input.behaviour,
            input.replaces ?? null,
          ],
        );
        await client.query(
          `INSERT INTO pledge_history (pledge_id, state, at) VALUES ($1, 'authorising', now())`,
          [input.pledgeId],
        );
        await client.query("COMMIT");
        return { outcome: "claimed" };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        const code = (error as { code?: string }).code;
        // A serialisation failure means another claim won the race.
        if (code === "40001" || code === "40P01") {
          return { outcome: "serialised" };
        }
        throw error;
      }
    } finally {
      client.release();
    }
  }

  // ---- my pledges and pledge reads ---------------------------------------------

  router.get(
    "/api/me/pledges",
    requireAuth,
    wrap(async (req, res) => {
      const person = auth(req);
      if (person === null) return;
      const pledges = await ctx.pool.query<PledgeRowFull & { campaign_title: string; campaign_status: string }>(
        `SELECT pl.*, c.title AS campaign_title, c.status AS campaign_status
         FROM pledges pl JOIN campaigns c ON c.id = pl.campaign_id
         WHERE pl.person_id = $1
         ORDER BY pl.created_at DESC, pl.id DESC`,
        [person.id],
      );
      const views = [];
      for (const pledge of pledges.rows) {
        const cover = await coverMediaId(pledge.campaign_id);
        views.push({
          ...(await pledgeView(sctx, pledge)),
          campaign: {
            id: pledge.campaign_id,
            title: pledge.campaign_title,
            status: pledge.campaign_status,
            cover_media_id: cover,
          },
        });
      }
      res.json(views);
    }),
  );

  router.get(
    "/api/pledges/:id",
    requireAuth,
    wrap(async (req, res) => {
      const person = auth(req);
      if (person === null) return;
      const loaded = await loadPledge(req.params.id);
      if (loaded === null || loaded.pledge.person_id !== person.id) {
        sendError(res, errors.notFound());
        return;
      }
      res.json(await pledgeView(sctx, loaded.pledge));
    }),
  );

  // ---- pledge change and cancel -------------------------------------------------

  router.patch(
    "/api/pledges/:id",
    requireAuth,
    jsonBody(ctx.config.jsonBodyLimit),
    wrap(async (req, res) => {
      const person = auth(req);
      if (person === null) return;
      const idemKey = req.header("idempotency-key");
      if (idemKey === undefined || idemKey.trim() === "" || idemKey.trim().length > 64) {
        sendError(res, errors.validation({ idempotency_key: "Enter an idempotency key." }));
        return;
      }
      const scopeKey = person.key;
      const body = jsonBodyOf(req);
      const hash = bodyHash(body);
      const guard = await idempotencyCheck(scopeKey, `change:${req.params.id}`, idemKey.trim(), hash);
      if (!guard.proceed) {
        const existing = await ctx.pool.query<{ request_hash: string }>(
          `SELECT request_hash FROM idempotency
           WHERE person_key = $1 AND route = $2 AND idem_key = $3`,
          [scopeKey, `change:${req.params.id}`, idemKey.trim()],
        );
        const row = existing.rows[0];
        if (row !== undefined && row.request_hash !== hash) {
          sendError(res, errors.idempotencyConflict());
          return;
        }
        sendError(res, errors.idempotencyInProgress());
        return;
      }
      if (guard.replay !== undefined) {
        res
          .status(guard.replay.status)
          .set("Content-Type", "application/json; charset=utf-8")
          .send(guard.replay.body);
        return;
      }
      const finishChange = async (error: ApiError | null, payload: unknown) => {
        if (error !== null) {
          if (error.status === 503) {
            await idempotencyRelease(scopeKey, `change:${req.params.id}`, idemKey.trim());
          } else {
            await idempotencyStore(
              scopeKey,
              `change:${req.params.id}`,
              idemKey.trim(),
              error.status,
              JSON.stringify({ error: error.code }),
            );
          }
          sendError(res, error);
          return;
        }
        const bodyText = JSON.stringify(payload);
        await idempotencyStore(scopeKey, `change:${req.params.id}`, idemKey.trim(), 201, bodyText);
        res
          .status(201)
          .set("Content-Type", "application/json; charset=utf-8")
          .send(bodyText);
      };

      const loaded = await loadPledge(req.params.id);
      if (loaded === null || loaded.pledge.person_id !== person.id) {
        await finishChange(errors.notFound(), null);
        return;
      }
      const { pledge, campaign } = loaded;
      if (campaignClosedNow(campaign)) {
        await finishChange(errors.campaignClosed(), null);
        return;
      }
      if (pledge.state !== "authorised") {
        await finishChange(errors.pledgeNotActive(), null);
        return;
      }

      // Work out the new pledge shape.
      const tierId = typeof body.tier_id === "string" ? body.tier_id : pledge.tier_id;
      const country = typeof body.country === "string" ? body.country : pledge.country;
      let addOn: number | null = pledge.add_on;
      if (body.add_on !== undefined) {
        if (
          typeof body.add_on !== "number" ||
          !Number.isInteger(body.add_on) ||
          body.add_on < 0 ||
          body.add_on > 50000
        ) {
          await finishChange(
            errors.validation({ add_on: "Enter an add-on from 0.00 to 500.00." }),
            null,
          );
          return;
        }
        addOn = body.add_on;
      }
      if (!COUNTRY_BY_CODE.has(country)) {
        await finishChange(errors.validation({ country: "Choose a shipping country." }), null);
        return;
      }
      const tierResult = await ctx.pool.query<TierRow>(
        `SELECT id, campaign_id, title, description, price, quantity,
                shipping_domestic, shipping_europe, shipping_rest_of_world, position
         FROM tiers WHERE id = $1 AND campaign_id = $2`,
        [tierId, campaign.id],
      );
      const tier = tierResult.rows[0];
      if (tier === undefined) {
        await finishChange(errors.notFound(), null);
        return;
      }
      const zone = zoneFor(country, campaign.ships_from);
      if (zone === null || addOn === null) {
        await finishChange(errors.validation({ country: "Choose a shipping country." }), null);
        return;
      }
      const quote = quoteAmount(tier, zone, addOn);

      const differs =
        tier.id !== pledge.tier_id || country !== pledge.country || addOn !== pledge.add_on;
      if (!differs) {
        await finishChange(errors.validation({ pledge: "Change something first." }), null);
        return;
      }

      // A change away from the tier frees the old copy once the new hold
      // succeeds; a change keeping the same limited tier keeps the pledge's
      // own copy, which the claim's excludes the pledge being changed.
      if (!ctx.health.isUp("payments")) {
        await finishChange(errors.paymentUnavailable(), null);
        return;
      }

      // The would-unfund guard applies to reductions in the final window.
      if (quote.amount < pledge.amount) {
        const unfund = await wouldUnfund(campaign, pledge.amount - quote.amount);
        if (unfund) {
          await finishChange(errors.wouldUnfund(), null);
          return;
        }
      }

      // Claim the new copy first, on the same pledge card. The claim excludes
      // the pledge being changed, so its own copy is not counted twice and
      // the backer's one slot stays free for the replacement.
      const newPledgeId = newId("pld");
      const claim = await insertClaimingPledge({
        pledgeId: newPledgeId,
        campaign,
        tier,
        backer: person,
        country,
        zone,
        addOn,
        quote,
        cardNumber: `0000${pledge.card_last4}`,
        behaviour: pledge.card_behaviour,
        replaces: pledge.id,
      });
      if (claim.outcome === "sold_out") {
        await finishChange(errors.tierSoldOut(), null);
        return;
      }
      if (claim.outcome !== "claimed") {
        await finishChange(errors.pledgeNotActive(), null);
        return;
      }

      const kbAuth = await ctx.killbill.authorize(
        person.id,
        newPledgeId,
        `${newPledgeId}-auth`,
        quote.amount,
        pledge.card_behaviour === "decline_auth",
      );
      if (!kbAuth.ok || kbAuth.value === undefined) {
        await ctx.pool.query(`DELETE FROM pledges WHERE id = $1`, [newPledgeId]);
        if (!kbAuth.ok && kbAuth.reason === "unavailable") {
          ctx.health.markDown("payments");
          await finishChange(errors.paymentUnavailable(), null);
          return;
        }
        await finishChange(errors.cardDeclined(), null);
        return;
      }

      // New hold placed: void the old hold and mark the old pledge replaced.
      const voided = await ctx.killbill.void(pledge.kb_payment_id, `${pledge.id}-void`);
      if (!voided.ok || voided.value !== true) {
        // Kill Bill unreachable: release the new claim and keep the original.
        await ctx.pool.query(`DELETE FROM pledges WHERE id = $1`, [newPledgeId]);
        if (!voided.ok) {
          ctx.health.markDown("payments");
        }
        await finishChange(errors.paymentUnavailable(), null);
        return;
      }
      await ctx.pool.query(`UPDATE pledges SET state = 'voided' WHERE id = $1`, [pledge.id]);
      await appendHistory(pledge.id, "voided");

      await ctx.pool.query(
        `UPDATE pledges SET state = 'authorised', replaces = $2,
                kb_payment_id = $3, kb_payment_method_id = $4
         WHERE id = $1`,
        [newPledgeId, pledge.id, kbAuth.value.paymentId, kbAuth.value.paymentMethodId],
      );
      await appendHistory(newPledgeId, "authorised");

      const personRow = await ctx.pool.query<PersonRow>(
        `SELECT id, name, email, key FROM people WHERE id = $1`,
        [person.id],
      );
      await notices.recordPledgeReceipt({
        campaignId: campaign.id,
        pledgeId: newPledgeId,
        kind: "pledge_receipt",
        to: personRow.rows[0]?.email ?? person.email,
        campaignTitle: campaign.title,
        amountPence: quote.amount,
      });

      const totals = await campaignTotals(ctx.pool, campaign.id);
      const newPledge = (await loadPledge(newPledgeId))?.pledge;
      await finishChange(null, {
        ...(newPledge !== undefined ? await pledgeView(sctx, newPledge) : {}),
        campaign_total: totals.total,
        campaign_percent: Math.floor((100 * totals.total) / campaign.goal),
      });
    }),
  );

  router.post(
    "/api/pledges/:id/cancel",
    requireAuth,
    wrap(async (req, res) => {
      const person = auth(req);
      if (person === null) return;
      const loaded = await loadPledge(req.params.id);
      if (loaded === null || loaded.pledge.person_id !== person.id) {
        sendError(res, errors.notFound());
        return;
      }
      const { pledge, campaign } = loaded;
      if (campaignClosedNow(campaign)) {
        sendError(res, errors.campaignClosed());
        return;
      }
      if (pledge.state !== "authorised") {
        sendError(res, errors.pledgeNotActive());
        return;
      }
      const unfund = await wouldUnfund(campaign, pledge.amount);
      if (unfund) {
        sendError(res, errors.wouldUnfund());
        return;
      }
      if (!ctx.health.isUp("payments")) {
        sendError(res, errors.paymentUnavailable());
        return;
      }
      const voided = await ctx.killbill.void(pledge.kb_payment_id, `${pledge.id}-void`);
      if (!voided.ok || voided.value !== true) {
        if (!voided.ok) {
          ctx.health.markDown("payments");
        }
        sendError(res, errors.paymentUnavailable());
        return;
      }
      await ctx.pool.query(`UPDATE pledges SET state = 'voided' WHERE id = $1`, [pledge.id]);
      await appendHistory(pledge.id, "voided");
      const personRow = await ctx.pool.query<PersonRow>(
        `SELECT id, name, email, key FROM people WHERE id = $1`,
        [person.id],
      );
      await notices.record(
        {
          campaignId: campaign.id,
          pledgeId: pledge.id,
          kind: "pledge_cancelled",
          to: personRow.rows[0]?.email ?? person.email,
          campaignTitle: campaign.title,
          amountPence: pledge.amount,
        },
        `pledge_cancelled:${campaign.id}:${pledge.id}:${person.email}`,
      );
      const after = (await loadPledge(pledge.id))?.pledge;
      if (after === undefined) {
        sendError(res, errors.notFound());
        return;
      }
      res.json(await pledgeView(sctx, after));
    }),
  );

  // ---- campaign pledges, notices and cancellation --------------------------------

  router.get(
    "/api/campaigns/:id/pledges",
    requireAuth,
    wrap(async (req, res) => {
      const person = auth(req);
      if (person === null) return;
      const campaign = await loadCampaign(ctx.pool, req.params.id);
      if (campaign === null || campaign.creator_id !== person.id) {
        sendError(res, errors.notFound());
        return;
      }
      const pledges = await ctx.pool.query<
        PledgeRowFull & { name: string; email: string; tier_title: string }
      >(
        `SELECT pl.*, pe.name, pe.email, t.title AS tier_title
         FROM pledges pl
         JOIN people pe ON pe.id = pl.person_id
         JOIN tiers t ON t.id = pl.tier_id
         WHERE pl.campaign_id = $1
         ORDER BY pl.created_at DESC`,
        [campaign.id],
      );
      const views = [];
      for (const pledge of pledges.rows) {
        views.push({
          ...(await pledgeView(sctx, pledge)),
          tier_title: pledge.tier_title,
          backer: { id: pledge.person_id, name: pledge.name, email: pledge.email },
        });
      }
      res.json(views);
    }),
  );

  router.get(
    "/api/campaigns/:id/notices",
    requireAuth,
    wrap(async (req, res) => {
      const person = auth(req);
      if (person === null) return;
      const campaign = await loadCampaign(ctx.pool, req.params.id);
      if (campaign === null || campaign.creator_id !== person.id) {
        sendError(res, errors.notFound());
        return;
      }
      const noticesList = await ctx.pool.query<{
        kind: string;
        to_email: string;
        subject: string;
        status: string;
        created_at: Date;
        sent_at: Date | null;
      }>(
        `SELECT kind, to_email, subject, status, created_at, sent_at FROM notices
         WHERE campaign_id = $1 ORDER BY created_at ASC`,
        [campaign.id],
      );
      res.json(
        noticesList.rows.map((n) => ({
          kind: n.kind,
          to: n.to_email,
          subject: n.subject,
          status: n.status,
          created_at: n.created_at.toISOString().replace(/\.\d{3}Z$/, "Z"),
          sent_at: n.sent_at === null ? null : n.sent_at.toISOString().replace(/\.\d{3}Z$/, "Z"),
        })),
      );
    }),
  );

  router.post(
    "/api/campaigns/:id/cancel",
    requireAuth,
    wrap(async (req, res) => {
      const person = auth(req);
      if (person === null) return;
      const campaign = await loadCampaign(ctx.pool, req.params.id);
      if (campaign === null || campaign.creator_id !== person.id) {
        sendError(res, errors.notFound());
        return;
      }
      if (campaign.status !== "live") {
        sendError(res, errors.notLive());
        return;
      }
      if (campaign.deadline_utc.getTime() <= Date.now()) {
        sendError(res, errors.campaignClosed());
        return;
      }
      if (!ctx.health.isUp("payments")) {
        sendError(res, errors.paymentUnavailable());
        return;
      }
      const pledges = await ctx.pool.query<PledgeRowFull>(
        `SELECT id, campaign_id, tier_id, person_id, country, zone, reward, shipping, add_on,
                amount, state, card_last4, card_behaviour, replaces, created_at,
                captured_at, errored_at, fix_deadline, fix_count, card_fixed,
                kb_payment_id, kb_payment_method_id, last_capture_attempt
         FROM pledges
         WHERE campaign_id = $1 AND state = 'authorised'`,
        [campaign.id],
      );
      const backerEmails = await ctx.pool.query<{ person_id: string; email: string }>(
        `SELECT DISTINCT pl.person_id, pe.email FROM pledges pl
         JOIN people pe ON pe.id = pl.person_id
         WHERE pl.campaign_id = $1 AND pl.state = 'authorised'`,
        [campaign.id],
      );
      const emailByPerson = new Map(backerEmails.rows.map((r) => [r.person_id, r.email]));
      for (const pledge of pledges.rows) {
        const voided = await ctx.killbill.void(pledge.kb_payment_id, `${pledge.id}-void`);
        if (!voided.ok || voided.value !== true) {
          if (!voided.ok) {
            ctx.health.markDown("payments");
          }
          sendError(res, errors.paymentUnavailable());
          return;
        }
        await ctx.pool.query(`UPDATE pledges SET state = 'voided' WHERE id = $1`, [pledge.id]);
        await appendHistory(pledge.id, "voided");
      }
      await ctx.pool.query(
        `UPDATE campaigns SET status = 'cancelled', closed_at = now() WHERE id = $1`,
        [campaign.id],
      );
      for (const pledge of pledges.rows) {
        await notices.record(
          {
            campaignId: campaign.id,
            pledgeId: pledge.id,
            kind: "campaign_cancelled",
            to: emailByPerson.get(pledge.person_id) ?? "",
            campaignTitle: campaign.title,
            amountPence: pledge.amount,
          },
          `campaign_cancelled:${campaign.id}:${pledge.id}`,
        );
      }
      const after = await loadCampaign(ctx.pool, campaign.id);
      if (after === null) {
        sendError(res, errors.notFound());
        return;
      }
      res.json(await campaignView(sctx, after));
    }),
  );

  // ---- fix window ------------------------------------------------------------------

  async function fixView(code: string): Promise<{
    pledge_id: string;
    campaign_title: string;
    amount: number;
    state: string;
    fix_deadline_utc: string;
    fix_seconds_left: number;
    card_fixed: boolean;
  } | null> {
    const result = await ctx.pool.query<{ code: string; pledge_id: string }>(
      `SELECT code, pledge_id FROM fix_codes WHERE code = $1`,
      [code],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    const loaded = await loadPledge(row.pledge_id);
    if (loaded === null) return null;
    const { pledge, campaign } = loaded;
    const secondsLeft =
      pledge.fix_deadline === null
        ? 0
        : Math.max(0, Math.floor((pledge.fix_deadline.getTime() - Date.now()) / 1000));
    return {
      pledge_id: pledge.id,
      campaign_title: campaign.title,
      amount: pledge.amount,
      state: pledge.state,
      fix_deadline_utc:
        pledge.fix_deadline === null
          ? new Date(0).toISOString().replace(/\.\d{3}Z$/, "Z")
          : pledge.fix_deadline.toISOString().replace(/\.\d{3}Z$/, "Z"),
      fix_seconds_left: secondsLeft,
      card_fixed: pledge.card_fixed,
    };
  }

  router.get(
    "/api/fix/:code",
    wrap(async (req, res) => {
      const view = await fixView(req.params.code);
      if (view === null) {
        sendError(res, errors.notFound());
        return;
      }
      res.json(view);
    }),
  );

  router.post(
    "/api/fix/:code",
    jsonBody(ctx.config.jsonBodyLimit),
    wrap(async (req, res) => {
      const codeRow = await ctx.pool.query<{ pledge_id: string }>(
        `SELECT pledge_id FROM fix_codes WHERE code = $1`,
        [req.params.code],
      );
      const row = codeRow.rows[0];
      if (row === undefined) {
        sendError(res, errors.notFound());
        return;
      }
      const loaded = await loadPledge(row.pledge_id);
      if (loaded === null) {
        sendError(res, errors.notFound());
        return;
      }
      const { pledge, campaign } = loaded;
      const body = jsonBodyOf(req);
      const cardNumber = typeof body.card_number === "string" ? body.card_number : null;
      if (cardNumber === null || behaviourForCard(cardNumber) === null) {
        sendError(res, errors.validation({ card_number: "Use one of the test cards." }));
        return;
      }
      const behaviour = behaviourForCard(cardNumber);
      const windowOpen =
        pledge.state === "errored" &&
        pledge.fix_deadline !== null &&
        pledge.fix_deadline.getTime() > Date.now();
      if (!windowOpen) {
        sendError(res, errors.fixWindowClosed());
        return;
      }
      if (!ctx.health.isUp("payments")) {
        sendError(res, errors.paymentUnavailable());
        return;
      }

      // A fix is a separate payment holding its own AUTHORIZE.
      const fixCount = pledge.fix_count + 1;
      const paymentKey = `${pledge.id}-fix-${fixCount}`;
      const auth = await ctx.killbill.authorize(
        pledge.person_id,
        paymentKey,
        `${paymentKey}-auth`,
        pledge.amount,
        behaviour === "decline_auth",
      );
      if (!auth.ok || auth.value === undefined) {
        if (!auth.ok && auth.reason === "unavailable") {
          ctx.health.markDown("payments");
          sendError(res, errors.paymentUnavailable());
          return;
        }
        sendError(res, errors.cardDeclined());
        return;
      }
      await ctx.pool.query(
        `UPDATE pledges SET card_fixed = TRUE, card_last4 = $2, card_behaviour = $3,
                fix_count = $4, kb_fix_payment_id = $5
         WHERE id = $1`,
        [pledge.id, last4(cardNumber), behaviour, fixCount, auth.value.paymentId],
      );
      // Void any earlier fix hold.
      const previousFix = await ctx.pool.query<{ kb_fix_payment_id: string | null }>(
        `SELECT kb_fix_payment_id FROM pledges WHERE id = $1`,
        [pledge.id],
      );
      const previous = previousFix.rows[0]?.kb_fix_payment_id;
      const current = auth.value.paymentId;
      if (previous !== null && previous !== current) {
        const voided = await ctx.killbill.void(previous, `${paymentKey}-previous-void`);
        if (!voided.ok) {
          ctx.health.markDown("payments");
        }
      }
      const view = await fixView(req.params.code);
      if (view === null) {
        sendError(res, errors.notFound());
        return;
      }
      res.json({ ...view, card_fixed: true });
    }),
  );

  // ---- documents ----------------------------------------------------------------------

  router.get(
    "/api/pledges/:id/statement.pdf",
    requireAuth,
    wrap(async (req, res) => {
      const person = auth(req);
      if (person === null) return;
      const loaded = await loadPledge(req.params.id);
      if (loaded === null || loaded.pledge.person_id !== person.id) {
        sendError(res, errors.notFound());
        return;
      }
      const statement = await ctx.pool.query<{ status: string; object_key: string | null }>(
        `SELECT status, object_key FROM statements WHERE pledge_id = $1`,
        [loaded.pledge.id],
      );
      const row = statement.rows[0];
      if (row === undefined || row.status !== "ready" || row.object_key === null) {
        sendError(res, errors.notReady());
        return;
      }
      const bytes = await ctx.storage.get(row.object_key);
      if (bytes === null) {
        sendError(res, errors.notReady());
        return;
      }
      res.setHeader("Content-Type", "application/pdf");
      res.send(bytes);
    }),
  );

  router.get(
    "/api/campaigns/:id/settlement",
    requireAuth,
    wrap(async (req, res) => {
      const person = auth(req);
      if (person === null) return;
      const campaign = await loadCampaign(ctx.pool, req.params.id);
      if (campaign === null || campaign.creator_id !== person.id) {
        sendError(res, errors.notFound());
        return;
      }
      if (
        campaign.status !== "funded" &&
        campaign.status !== "collecting" &&
        campaign.status !== "settled"
      ) {
        sendError(res, errors.notFunded());
        return;
      }
      const captured = await ctx.pool.query<{
        id: string;
        amount: number;
      }>(
        `SELECT id, amount FROM pledges WHERE campaign_id = $1 AND state = 'captured'`,
        [campaign.id],
      );
      const dropped = await ctx.pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM pledges WHERE campaign_id = $1 AND state = 'dropped'`,
        [campaign.id],
      );
      const errored = await ctx.pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM pledges WHERE campaign_id = $1 AND state = 'errored'`,
        [campaign.id],
      );
      const settlementRow = await ctx.pool.query<{ status: string }>(
        `SELECT status FROM settlements WHERE campaign_id = $1`,
        [campaign.id],
      );
      let gross = 0;
      let platformFee = 0;
      let processingFee = 0;
      const lines = captured.rows.map((row) => {
        const fees = feesForAmount(row.amount);
        gross += row.amount;
        platformFee += fees.platform_fee;
        processingFee += fees.processing_fee;
        return {
          pledge_id: row.id,
          amount: row.amount,
          platform_fee: fees.platform_fee,
          processing_fee: fees.processing_fee,
          to_creator: fees.to_creator,
        };
      });
      res.json({
        campaign_id: campaign.id,
        status: campaign.status,
        captured_count: captured.rows.length,
        dropped_count: Number(dropped.rows[0]?.count ?? 0),
        errored_count: Number(errored.rows[0]?.count ?? 0),
        gross,
        platform_fee: platformFee,
        processing_fee: processingFee,
        net: gross - platformFee - processingFee,
        lines,
        pdf: (settlementRow.rows[0]?.status as "none" | "pending" | "ready") ?? "none",
      });
    }),
  );

  router.get(
    "/api/campaigns/:id/settlement.pdf",
    requireAuth,
    wrap(async (req, res) => {
      const person = auth(req);
      if (person === null) return;
      const campaign = await loadCampaign(ctx.pool, req.params.id);
      if (campaign === null || campaign.creator_id !== person.id) {
        sendError(res, errors.notFound());
        return;
      }
      const settlementRow = await ctx.pool.query<{ status: string; object_key: string | null }>(
        `SELECT status, object_key FROM settlements WHERE campaign_id = $1`,
        [campaign.id],
      );
      const row = settlementRow.rows[0];
      if (row === undefined || row.status !== "ready" || row.object_key === null) {
        sendError(res, errors.notReady());
        return;
      }
      const bytes = await ctx.storage.get(row.object_key);
      if (bytes === null) {
        sendError(res, errors.notReady());
        return;
      }
      res.setHeader("Content-Type", "application/pdf");
      res.send(bytes);
    }),
  );

  return router;
}

export function createErrorForwarder() {
  return (error: unknown, req: Request, res: Response, next: NextFunction): void => {
    if (error instanceof ApiError) {
      sendError(res, error);
      return;
    }
    next(error);
  };
}
