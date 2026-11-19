import type { Express, Request, Response } from "express";
import { errors } from "../errors.js";
import { readJson } from "../http.js";
import { searchPublicPages } from "../search.js";
import { wireGet } from "../services.js";
import { formatUkPostcode } from "../csv.js";
import { parseParty } from "../validation.js";
import { createEnquiryFromRequest, type EnquiryInput } from "./enquiry-create.js";
import { foldEmail, isoInstant } from "../domain.js";
import { requireAuth } from "./auth.js";
import type { Ctx } from "../app.js";

export function registerPublicApi(app: Express, ctx: Ctx): void {
  app.get("/api/public/search", (req: Request, res: Response) => {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    if (q.trim() === "") throw errors.invalid({ q: "Nothing found for that search." }, "Nothing found for that search.");
    if (q.length > 200) throw errors.invalid({ q: "Search text can be up to 200 characters." });
    const results = searchPublicPages(q);
    res.json({ results });
  });

  app.get("/api/public/address/find", async (req: Request, res: Response) => {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    if (q.length < 3) throw errors.invalid({ q: "Enter at least 3 characters." });
    const r = await wireGet<{ suggestions: { id: string; text: string }[] }>(ctx.cfg, `/v1/find?q=${encodeURIComponent(q)}`);
    if (!r) throw errors.provider("We could not check this address. You can carry on and type it in full.");
    res.json({ suggestions: (r.suggestions ?? []).slice(0, 6) });
  });

  app.get("/api/public/address/get/:id", async (req: Request, res: Response) => {
    const r = await wireGet<{ line1: string; town: string; postcode: string }>(ctx.cfg, `/v1/get/${encodeURIComponent(req.params.id)}`);
    if (!r) throw errors.provider("We could not check this address. You can carry on and type it in full.");
    const line1 = String(r.line1 ?? "");
    const town = String(r.town ?? "");
    const postcode = formatUkPostcode(String(r.postcode ?? "")) ?? "";
    res.json({ id: req.params.id, line1, town, postcode, text: `${line1}, ${town} ${postcode}`.trim() });
  });

  app.post("/api/public/enquiries", async (req: Request, res: Response) => {
    const input = await enquiryInput(req);
    const desk = await ctx.db.query<{ id: string }>("SELECT id FROM desks WHERE email_folded=$1", [foldEmail(ctx.cfg.publicDeskEmail)]);
    const deskId = desk.rows[0]?.id;
    if (!deskId) throw errors.provider("We can't find that.");
    const created = await createEnquiryFromRequest(ctx, deskId, input, true);
    res.status(201).json({ reference: created.reference, receivedAt: isoInstant(created.receivedAt) });
  });

  app.post("/api/enquiries", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const input = await enquiryInput(req);
    const created = await createEnquiryFromRequest(ctx, deskId, input, false);
    res.status(201).json({ reference: created.reference, receivedAt: isoInstant(created.receivedAt) });
  });
}

async function enquiryInput(req: Request): Promise<EnquiryInput> {
  const raw = (await readJson(req)) as Record<string, unknown>;
  const website = typeof raw.website === "string" ? raw.website : "";
  const depart = (raw.departAt ?? null) as Record<string, unknown> | null;
  const ret = (raw.returnAt ?? null) as Record<string, unknown> | null;
  return {
    raw,
    website,
    occasion: raw.occasion,
    journeyType: raw.journeyType,
    stops: Array.isArray(raw.stops) ? (raw.stops as unknown[]) : [],
    party: parseParty(raw.party ?? {}),
    name: typeof raw.name === "string" ? raw.name.trim() : "",
    email: typeof raw.email === "string" ? raw.email.trim() : "",
    telephone: typeof raw.telephone === "string" ? raw.telephone.trim() : "",
    language: raw.language === "pl" || raw.language === "ur" ? raw.language : "en",
    details: typeof raw.details === "string" ? raw.details : null,
    depart,
    return: ret,
    isTrap: website.trim().length > 0,
  };
}

