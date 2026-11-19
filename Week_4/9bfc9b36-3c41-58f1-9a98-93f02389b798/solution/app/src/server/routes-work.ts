/** Endpoints for drawings, claims and cutting, stock, the ledger, cut sheets, sight grants and the sail account. */
import { one, pool } from "./db.js";
import { boatRow } from "./boats.js";
import { assignDrawing, createDrawing, drawingView, drawingViewByCode, drawSail, isSealed, listDrawings, loadFact, reviseDrawing, STATUS_FILTERS } from "./drawings.js";
import { liveAccountOfRole } from "./accounts.js";
import { drawingScope, onlyRoles, visibleDrawing, visibleStock } from "./access.js";
import { created, ifMatchRevision, ok, sailmakerEtag, type Route } from "./http.js";
import { claimViewById, cutClaim, layPanel, releaseClaim, takeClaim, unlayPanel, visibleClaim } from "./nesting.js";
import { allLines, ledgerCsv, ledgerPage, reconcile } from "./ledger.js";
import { recordCreditNote, recordPayment, requireAccountable, sailAccount } from "./money.js";
import { activeGrantOf, createGrant, grantRow, grantView, listGrants, withdrawGrant } from "./grants.js";
import { withSheetLimit } from "./submissions.js";
import { issueDrawing, previewSheet } from "./sheets.js";
import { receiveRoll, recordCount, stockSummary, stockViewByCode, stockViews, updateStock } from "./stock.js";
import { getObject, StoreUnavailable } from "./s3.js";
import { FieldErrors, invalid, notFound, refuse, storeUnavailable } from "./errors.js";
import { keysetPage, pageRequest } from "./paging.js";
import { now } from "./time.js";
import * as check from "./validate.js";
import { FIELD } from "../shared/copy.js";
import type { DrawingStatus, Sail } from "../shared/types.js";
import { inLengthRange } from "../shared/units.js";

const SVG_HEADERS = { "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" };

async function sheetBytes(key: string): Promise<Buffer> {
  try {
    const stored = await getObject(key);
    if (!stored) throw notFound();
    return stored.body;
  } catch (error) {
    if (error instanceof StoreUnavailable) throw storeUnavailable("sheet");
    throw error;
  }
}

export const workRoutes: Route[] = [
  // ---- cloth and closures
  {
    method: "GET", pattern: "/api/cloths", auth: "user", body: "none",
    handler: async (ctx) => {
      onlyRoles(ctx, "sailmaker", "loft-hand");
      return ok(await keysetPage(pool, {
        base: "SELECT *, code AS k1 FROM cloth", params: [], types: ["text"], direction: "asc", filter: "cloths", request: pageRequest(ctx.query),
        map: (row) => ({ code: row.code, name: row.name, weight: row.weight, width_mm: row.width_mm, usable_width_mm: row.usable_width_mm, rate_pence_per_m2: row.rate_pence_per_m2 }),
      }));
    },
  },
  {
    method: "GET", pattern: "/api/closures", auth: "user", body: "none",
    handler: async (ctx) => {
      onlyRoles(ctx, "sailmaker", "loft-hand");
      return ok(await keysetPage(pool, {
        base: "SELECT day AS k1, day FROM closure", params: [], types: ["date"], direction: "asc", filter: "closures", request: pageRequest(ctx.query),
        map: (row) => ({ date: row.day }),
      }));
    },
  },

  // ---- drawings
  {
    method: "GET", pattern: "/api/drawings", auth: "user", body: "none",
    handler: async (ctx) => {
      const status = ctx.query.get("status");
      if (status !== null && !STATUS_FILTERS.includes(status as DrawingStatus)) throw invalid({ status: FIELD.decision });
      const boat = ctx.query.get("boat");
      return ok(await listDrawings(pool, await drawingScope(pool, ctx.actor, now()), { status: status as DrawingStatus | null, boat }, ctx.actor.role, pageRequest(ctx.query)));
    },
  },
  {
    method: "GET", pattern: "/api/drawings/:code", auth: "user", body: "none",
    handler: async (ctx) => {
      const facts = await visibleDrawing(pool, ctx.actor, ctx.params.code!, now());
      if (!facts) throw notFound();
      return ok(drawingView(facts, ctx.actor.role));
    },
  },
  {
    method: "POST", pattern: "/api/drawings", auth: "user", body: "json",
    handler: async (ctx) => {
      onlyRoles(ctx, "sailmaker");
      const body = ctx.json();
      const errors = new FieldErrors();
      const boat = typeof body.boat_code === "string" ? await boatRow(pool, body.boat_code) : null;
      if (!boat) errors.add("boat_code", FIELD.boat);
      const sail = check.oneOf<Sail>(errors, body, "sail", ["mainsail", "headsail"], FIELD.sail);
      const cloth = typeof body.cloth_code === "string" ? await one(pool, "SELECT code FROM cloth WHERE code = $1", [body.cloth_code]) : null;
      if (!cloth) errors.add("cloth_code", FIELD.cloth);
      errors.throwIfAny();
      const code = await createDrawing(ctx.actor, { boatCode: boat!.code, sail: sail!, clothCode: cloth!.code });
      return created(await drawingViewByCode(pool, code, "sailmaker"));
    },
  },
  {
    method: "POST", pattern: "/api/drawings/:code/draw", auth: "user", body: "none",
    handler: async (ctx) => {
      const facts = await visibleDrawing(pool, ctx.actor, ctx.params.code!, now());
      if (!facts) throw notFound();
      onlyRoles(ctx, "sailmaker");
      await drawSail(ctx.actor, facts.row.code);
      return ok(await drawingViewByCode(pool, facts.row.code, "sailmaker"));
    },
  },
  {
    method: "POST", pattern: "/api/drawings/:code/assign", auth: "user", body: "json",
    handler: async (ctx) => {
      const facts = await visibleDrawing(pool, ctx.actor, ctx.params.code!, now());
      if (!facts) throw notFound();
      onlyRoles(ctx, "sailmaker");
      if (isSealed(facts)) throw refuse("sealed");
      const loftHand = await liveAccountOfRole(pool, ctx.json().loft_hand_email, "loft-hand");
      if (!loftHand) throw invalid({ loft_hand_email: FIELD.loftHandAccount });
      await assignDrawing(ctx.actor, facts.row.code, loftHand);
      return ok(await drawingViewByCode(pool, facts.row.code, "sailmaker"));
    },
  },
  {
    method: "POST", pattern: "/api/drawings/:code/issue", auth: "user", body: "none",
    handler: async (ctx) => {
      const facts = await visibleDrawing(pool, ctx.actor, ctx.params.code!, now());
      if (!facts) throw notFound();
      onlyRoles(ctx, "sailmaker");
      const phase = await issueDrawing(ctx.actor, facts.row.code);
      return { status: phase === "issued" ? 200 : 202, json: await drawingViewByCode(pool, facts.row.code, "sailmaker") };
    },
  },
  {
    method: "GET", pattern: "/api/drawings/:code/cut-sheet/preview", auth: "user", body: "none",
    handler: async (ctx) => {
      const facts = await visibleDrawing(pool, ctx.actor, ctx.params.code!, now());
      if (!facts) throw notFound();
      onlyRoles(ctx, "sailmaker");
      return { status: 200, raw: await previewSheet(pool, facts.row.code), type: "image/svg+xml", headers: SVG_HEADERS };
    },
  },
  {
    method: "POST", pattern: "/api/drawings/:code/revise", auth: "user", body: "none",
    handler: async (ctx) => {
      const facts = await visibleDrawing(pool, ctx.actor, ctx.params.code!, now());
      if (!facts) throw notFound();
      onlyRoles(ctx, "sailmaker");
      const successor = await reviseDrawing(ctx.actor, facts.row.code);
      return created(await drawingViewByCode(pool, successor, "sailmaker"));
    },
  },
  {
    method: "GET", pattern: "/api/cut-sheets/:sha", auth: "user", body: "none",
    handler: async (ctx) => {
      onlyRoles(ctx, "sailmaker");
      const found = await one(pool, "SELECT code FROM drawing WHERE cut_sheet_sha = $1", [ctx.params.sha!]);
      if (!found) throw notFound();
      const facts = (await loadFact(pool, found.code, now()))!;
      const bytes = await sheetBytes(facts.row.cut_sheet_key);
      const headers: Record<string, string> = { ...SVG_HEADERS };
      if (facts.row.successor && facts.row.successor_phase === "issued") headers["boltrope-superseded-by"] = facts.row.successor;
      if (facts.row.predecessor) headers["boltrope-supersedes"] = facts.row.predecessor;
      return { status: 200, raw: bytes, type: "image/svg+xml", headers };
    },
  },

  // ---- sail account
  {
    method: "GET", pattern: "/api/drawings/:code/account", auth: "user", body: "none",
    handler: async (ctx) => {
      if (ctx.actor.role === "loft-hand") throw notFound();
      const facts = await visibleDrawing(pool, ctx.actor, ctx.params.code!, now());
      if (!facts) throw notFound();
      await requireAccountable(pool, facts.row.code);
      return ok(await sailAccount(pool, facts.row.code, ctx.actor.role));
    },
  },
  {
    method: "POST", pattern: "/api/drawings/:code/payments", auth: "user", body: "json",
    handler: async (ctx) => {
      const facts = await visibleDrawing(pool, ctx.actor, ctx.params.code!, now());
      if (!facts || ctx.actor.role === "loft-hand") throw notFound();
      onlyRoles(ctx, "sailmaker");
      const key = ctx.headers["idempotency-key"];
      const reply = await recordPayment(ctx.actor, facts.row.code, typeof key === "string" ? key : null, ctx.json());
      return { status: reply.status, raw: reply.body };
    },
  },
  {
    method: "POST", pattern: "/api/drawings/:code/credit-notes", auth: "user", body: "json",
    handler: async (ctx) => {
      const facts = await visibleDrawing(pool, ctx.actor, ctx.params.code!, now());
      if (!facts || ctx.actor.role === "loft-hand") throw notFound();
      onlyRoles(ctx, "sailmaker");
      return created(await recordCreditNote(ctx.actor, facts.row.code, ctx.json()));
    },
  },

  // ---- sight grants
  {
    method: "POST", pattern: "/api/drawings/:code/grants", auth: "user", body: "json",
    handler: async (ctx) => {
      const facts = await visibleDrawing(pool, ctx.actor, ctx.params.code!, now());
      if (!facts || ctx.actor.role === "loft-hand") throw notFound();
      onlyRoles(ctx, "sailmaker");
      return created(await createGrant(ctx.actor, facts.row.code, ctx.json()));
    },
  },
  {
    method: "GET", pattern: "/api/drawings/:code/grants", auth: "user", body: "none",
    handler: async (ctx) => {
      const facts = await visibleDrawing(pool, ctx.actor, ctx.params.code!, now());
      if (!facts || ctx.actor.role === "loft-hand") throw notFound();
      onlyRoles(ctx, "sailmaker");
      return ok(await listGrants(pool, "g.drawing_code = $1", [facts.row.code], pageRequest(ctx.query), `drawing=${facts.row.code}`, now()));
    },
  },
  {
    method: "POST", pattern: "/api/grants/:id/withdraw", auth: "user", body: "none",
    handler: async (ctx) => {
      const row = await grantRow(pool, ctx.params.id!);
      if (!row || ctx.actor.role === "loft-hand") throw notFound();
      if (ctx.actor.role === "yacht-owner" && row.owner_id !== ctx.actor.id) throw notFound();
      onlyRoles(ctx, "sailmaker");
      return ok(await withdrawGrant(ctx.actor, row.id));
    },
  },
  {
    method: "GET", pattern: "/api/grants/:id", auth: "user", body: "none",
    handler: async (ctx) => {
      const at = now();
      const row = ctx.actor.role === "yacht-owner" ? await activeGrantOf(pool, ctx.actor, ctx.params.id!, at) : ctx.actor.role === "sailmaker" ? await grantRow(pool, ctx.params.id!) : null;
      if (!row) throw notFound();
      return ok(grantView(row, at));
    },
  },
  {
    method: "GET", pattern: "/api/my/cut-sheets", auth: "user", body: "none",
    handler: async (ctx) => {
      onlyRoles(ctx, "yacht-owner");
      return ok(await listGrants(pool, "g.owner_id = $1", [ctx.actor.id], pageRequest(ctx.query), "mine", now(), true));
    },
  },
  {
    method: "GET", pattern: "/api/grants/:id/cut-sheet", auth: "user", body: "none",
    handler: async (ctx) => {
      const row = await grantRow(pool, ctx.params.id!);
      if (!row) throw notFound();
      if (ctx.actor.role !== "yacht-owner") {
        if (ctx.actor.role === "loft-hand") throw notFound();
        throw refuse("forbidden");
      }
      const at = now();
      if (!(await activeGrantOf(pool, ctx.actor, row.id, at))) throw notFound();
      const facts = (await loadFact(pool, row.drawing_code, at))!;
      const bytes = await withSheetLimit(ctx.actor, () => sheetBytes(facts.row.cut_sheet_key));
      return { status: 200, raw: bytes, type: "image/svg+xml", headers: SVG_HEADERS };
    },
  },

  // ---- stock
  {
    method: "GET", pattern: "/api/stock", auth: "user", body: "none",
    handler: async (ctx) => {
      onlyRoles(ctx, "sailmaker", "loft-hand");
      const kind = ctx.query.get("kind");
      if (kind !== null && kind !== "roll" && kind !== "offcut") throw invalid({ kind: FIELD.stock });
      const clauses = ["TRUE"];
      const params: unknown[] = [];
      if (ctx.actor.role === "loft-hand") {
        params.push(ctx.actor.id);
        clauses.push(`s.cloth_code IN (SELECT cloth_code FROM drawing WHERE assigned_to = $${params.length})`);
      }
      if (kind) {
        params.push(kind);
        clauses.push(`s.kind = $${params.length}`);
      }
      const at = now();
      const page = await keysetPage(pool, {
        base: `SELECT s.*, substr(s.code, 1, 1) AS k1, s.num AS k2 FROM stock s WHERE ${clauses.join(" AND ")}`,
        params, types: ["text", "int"], direction: "asc", filter: `kind=${kind ?? ""}`, request: pageRequest(ctx.query), map: (row) => row,
      });
      return ok({ ...page, items: await stockViews(pool, page.items, at) });
    },
  },
  {
    method: "GET", pattern: "/api/stock/summary", auth: "user", body: "none",
    handler: async (ctx) => {
      onlyRoles(ctx, "sailmaker", "loft-hand");
      return ok(await stockSummary(pool));
    },
  },
  {
    method: "GET", pattern: "/api/stock/:code", auth: "user", body: "none",
    handler: async (ctx) => {
      const row = await visibleStock(pool, ctx.actor, ctx.params.code!);
      if (!row) throw notFound();
      return { ...ok((await stockViews(pool, [row], now()))[0]), headers: sailmakerEtag(ctx.actor.role, row.revision) };
    },
  },
  {
    method: "POST", pattern: "/api/rolls", auth: "user", body: "json",
    handler: async (ctx) => {
      onlyRoles(ctx, "sailmaker");
      const body = ctx.json();
      const errors = new FieldErrors();
      const cloth = typeof body.cloth_code === "string" ? await one(pool, "SELECT code FROM cloth WHERE code = $1", [body.cloth_code]) : null;
      if (!cloth) errors.add("cloth_code", FIELD.cloth);
      const lot = check.lot(errors, body);
      const length = body.length_mm;
      if (typeof length !== "number" || !inLengthRange(length)) errors.add("length_mm", FIELD.lengthRange);
      const shelf = check.text(errors, body, "shelf_location", 1, 40);
      errors.throwIfAny();
      const code = await receiveRoll(ctx.actor, { clothCode: cloth!.code, lot: lot!, lengthMm: length as number, shelfLocation: shelf! });
      return created(await stockViewByCode(pool, code));
    },
  },
  {
    method: "PATCH", pattern: "/api/stock/:code", auth: "user", body: "json",
    handler: async (ctx) => {
      const row = await visibleStock(pool, ctx.actor, ctx.params.code!);
      if (!row) throw notFound();
      onlyRoles(ctx, "sailmaker");
      const revision = ifMatchRevision(ctx.headers);
      const body = ctx.json();
      const errors = new FieldErrors();
      const shelfLocation = "shelf_location" in body ? check.text(errors, body, "shelf_location", 1, 40) : undefined;
      const note = "note" in body ? check.text(errors, body, "note", 0, 200) : undefined;
      if (row.revision !== revision) throw refuse("stale_revision");
      errors.throwIfAny();
      await updateStock(ctx.actor, row.code, revision, { shelfLocation, note });
      const view = await stockViewByCode(pool, row.code);
      return { ...ok(view), headers: { etag: `"${view.revision}"` } };
    },
  },
  {
    method: "POST", pattern: "/api/stock/:code/counts", auth: "user", body: "json",
    handler: async (ctx) => {
      const row = await visibleStock(pool, ctx.actor, ctx.params.code!);
      if (!row) throw notFound();
      onlyRoles(ctx, "sailmaker");
      await recordCount(ctx.actor, row.code, ctx.json());
      return ok(await stockViewByCode(pool, row.code));
    },
  },

  // ---- claims
  {
    method: "POST", pattern: "/api/claims", auth: "user", body: "json",
    handler: async (ctx) => {
      onlyRoles(ctx, "sailmaker", "loft-hand");
      const body = ctx.json();
      const result = await takeClaim(ctx.actor, { drawingCode: body.drawing_code, stockCode: body.stock_code, lengthMm: body.length_mm });
      return created(result.view);
    },
  },
  {
    method: "GET", pattern: "/api/claims/:id", auth: "user", body: "none",
    handler: async (ctx) => {
      const claim = await visibleClaim(pool, ctx.actor, ctx.params.id!);
      if (!claim) throw notFound();
      return ok(await claimViewById(pool, claim.id, now()));
    },
  },
  {
    method: "POST", pattern: "/api/claims/:id/lays", auth: "user", body: "json",
    handler: async (ctx) => {
      const claim = await visibleClaim(pool, ctx.actor, ctx.params.id!);
      if (!claim) throw notFound();
      return created(await layPanel(ctx.actor, claim.id, ctx.json()));
    },
  },
  {
    method: "DELETE", pattern: "/api/claims/:id/lays/:panel", auth: "user", body: "none",
    handler: async (ctx) => {
      const claim = await visibleClaim(pool, ctx.actor, ctx.params.id!);
      const panel = Number(ctx.params.panel);
      if (!claim || !Number.isInteger(panel)) throw notFound();
      return ok(await unlayPanel(ctx.actor, claim.id, panel));
    },
  },
  {
    method: "POST", pattern: "/api/claims/:id/release", auth: "user", body: "none",
    handler: async (ctx) => {
      const claim = await visibleClaim(pool, ctx.actor, ctx.params.id!);
      if (!claim) throw notFound();
      return ok(await releaseClaim(ctx.actor, claim.id));
    },
  },
  {
    method: "POST", pattern: "/api/claims/:id/cut", auth: "user", body: "none",
    handler: async (ctx) => {
      const claim = await visibleClaim(pool, ctx.actor, ctx.params.id!);
      if (!claim) throw notFound();
      const raw = ctx.headers["idempotency-key"];
      const key = typeof raw === "string" && /^[\x20-\x7e]{1,100}$/.test(raw) ? raw : null;
      const reply = await cutClaim(ctx.actor, claim.id, key);
      return { status: reply.status, raw: reply.body };
    },
  },

  // ---- ledger
  {
    method: "GET", pattern: "/api/ledger", auth: "user", body: "none",
    handler: async (ctx) => {
      onlyRoles(ctx, "sailmaker");
      const stock = ctx.query.get("stock");
      return ok(await ledgerPage(pool, stock || null, pageRequest(ctx.query)));
    },
  },
  {
    method: "GET", pattern: "/api/ledger/reconciliation", auth: "user", body: "none",
    handler: async (ctx) => {
      onlyRoles(ctx, "sailmaker");
      return ok(await reconcile(pool));
    },
  },
  {
    method: "GET", pattern: "/api/exports/ledger.csv", auth: "user", body: "none",
    handler: async (ctx) => {
      onlyRoles(ctx, "sailmaker");
      return { status: 200, raw: ledgerCsv(await allLines(pool)), type: "text/csv; charset=utf-8", headers: { "content-disposition": 'attachment; filename="ledger.csv"' } };
    },
  },
];
