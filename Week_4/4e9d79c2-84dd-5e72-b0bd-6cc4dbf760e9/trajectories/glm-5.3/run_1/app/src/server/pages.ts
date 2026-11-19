import express, { type Express, type Request, type Response, type NextFunction } from "express";
import type { Ctx } from "./app.js";
import { pageAuthError, requireAuth } from "./api/auth.js";
import { errors } from "./errors.js";
import { sendError } from "./http.js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { shell, deskShell, notFoundShell } from "./pages/shell.js";
import { homeBody, occasionBody, fleetBody, termsBody, OCCASIONS } from "./pages/public.js";
import { quoteFormBody, thanksBody, type Step } from "./pages/quote-form.js";
import { quotePageBody, bidPageBody, runSheetBody, langFromQuery, type QuotePageView, type BidPageView, type RunPageView } from "./pages/private.js";
import { escapeHtml } from "./pages/html.js";
import { quotePageAnswer } from "./api/sheets.js";
import { ukDateString } from "./uktime.js";

const BUILD_PUBLIC = resolve("build/public");

function file(name: string): Buffer | null {
  const p = resolve(BUILD_PUBLIC, name);
  if (!p.startsWith(BUILD_PUBLIC)) return null;
  if (!existsSync(p)) return null;
  return readFileSync(p);
}

const MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".html": "text/html; charset=utf-8",
};

function sendAsset(res: Response, name: string): void {
  const buf = file("assets/" + name);
  if (!buf) {
    res.status(404).end();
    return;
  }
  const ext = name.slice(name.lastIndexOf("."));
  res.setHeader("Content-Type", MIME[ext] ?? "application/octet-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.send(buf);
}

const DESK_SCREENS: Record<string, [string, string]> = {
  "/enquiries": ["Enquiries", "Enquiries | Wayticket"],
  "/operators": ["Operators", "Operators | Wayticket"],
  "/payments": ["Payments", "Payments | Wayticket"],
  "/diary": ["Diary", "Diary | Wayticket"],
  "/documents": ["Documents", "Documents | Wayticket"],
  "/rates": ["Rate tables", "Rate tables | Wayticket"],
  "/customers": ["Customers", "Customers | Wayticket"],
  "/aftercare/complaints": ["Complaints", "Complaints | Wayticket"],
  "/aftercare/lost-property": ["Lost property", "Lost property | Wayticket"],
};

export function registerPageRoutes(app: Express, ctx: Ctx): void {
  app.get("/assets/app.css", (_req, res) => sendAsset(res, "app.css"));
  app.get("/assets/client.js", (_req, res) => sendAsset(res, "client.js"));
  app.get("/assets/fonts.css", (_req, res) => sendAsset(res, "fonts.css"));
  app.get("/assets/fonts/:name", (req, res) => sendAsset(res, "fonts/" + String(req.params.name)));
  app.use("/assets", (req: Request, res: Response) => {
    void req;
    void ctx;
    res.status(404).end();
  });
  app.get("/sw.js", (_req, res) => {
    const buf = file("sw.js");
    if (!buf) {
      res.status(404).end();
      return;
    }
    res.setHeader("Content-Type", "text/javascript; charset=utf-8");
    res.setHeader("Service-Worker-Allowed", "/");
    res.send(buf);
  });

  // Public site.
  app.get("/", (_req, res) => {
    res.type("html").send(shell({ title: "Coach and minibus hire from Coventry | Merrowfield Coach Hire", h1: "Coaches and minibuses with a driver", path: "/" }, homeBody(), { public: true }));
  });
  app.get("/occasions/:slug", (req, res) => {
    const slug = String(req.params.slug);
    if (!OCCASIONS[slug]) {
      res.status(404).type("html").send(notFoundShell("Page not found", "Page not found"));
      return;
    }
    const o = OCCASIONS[slug];
    res
      .type("html")
      .send(
        shell({ title: `${o.title} | Merrowfield Coach Hire`, h1: o.title, path: `/occasions/${slug}` }, occasionBody(slug), { public: true })
      );
  });
  app.get("/fleet", (_req, res) => {
    res.type("html").send(shell({ title: "Our fleet | Merrowfield Coach Hire", h1: "Our fleet", path: "/fleet" }, fleetBody(), { public: true }));
  });
  app.get("/terms", (_req, res) => {
    res.type("html").send(shell({ title: "Terms | Merrowfield Coach Hire", h1: "Terms", path: "/terms" }, termsBody(), { public: true }));
  });

  // Quote form.
  const quoteStep = (req: Request): Step => {
    const p = req.path.replace("/quote/", "");
    if (p === "when" || p === "details") return p;
    return "route";
  };
  app.get(["/quote", "/quote/route", "/quote/when", "/quote/details"], (req, res) => {
    const step = quoteStep(req);
    const occasion = typeof req.query.occasion === "string" && OCCASIONS[req.query.occasion] ? req.query.occasion : null;
    const titles: Record<Step, string> = {
      route: "Route | Get a free quote",
      when: "When and who | Get a free quote",
      details: "Your details | Get a free quote",
    };
    const h1s: Record<Step, string> = { route: "Route", when: "When and who", details: "Your details" };
    res.type("html").send(shell({ title: titles[step], h1: h1s[step], path: `/quote/${step}` }, quoteFormBody(step, occasion), { public: true }));
  });
  app.get("/quote/thanks", (req, res) => {
    const ref = typeof req.query.ref === "string" ? req.query.ref : "";
    const body = thanksBody(ref);
    res.type("html").send(
      shell({ title: "Thank you | Get a free quote", h1: "Thank you", path: "/quote/thanks" }, body, { public: true })
    );
  });

  // Sign-in and sign-up.
  app.get("/sign-in", (req, res) => {
    const ended = req.query.ended === "1" || pageAuthError(req) === "ended";
    const returnTo = typeof req.query.return === "string" ? req.query.return : "";
    const endedLine = ended ? `<p class="session-ended" data-session-ended>Your session ended. Sign in again to keep going — what you typed is still here.</p>` : "";
    const body = `
<div class="auth-page">
  <h1>Sign in</h1>
  ${endedLine}
  <form data-sign-in novalidate>
    <input type="hidden" name="return" value="${escapeHtml(returnTo)}">
    <div class="group problems" data-problems hidden><h2 class="problems-h">Problems</h2><ul class="problems-list" data-problems-list></ul></div>
    <div class="field"><label class="field-label" for="email">Email</label><input id="email" name="email" type="email" class="input" autocomplete="email"></div>
    <div class="field"><label class="field-label" for="password">Password</label><input id="password" name="password" type="password" class="input" autocomplete="current-password"></div>
    <button type="submit" class="primary">Sign in</button>
    <p class="auth-alt"><a href="/sign-up">Start a desk</a></p>
  </form>
</div>`;
    res.type("html").send(shell({ title: "Sign in | Wayticket", h1: "Sign in", path: "/sign-in" }, body));
  });
  app.get("/sign-up", (_req, res) => {
    const body = `
<div class="auth-page">
  <h1>Start a desk</h1>
  <form data-sign-up novalidate>
    <div class="group problems" data-problems hidden><h2 class="problems-h">Problems</h2><ul class="problems-list" data-problems-list></ul></div>
    <div class="field"><label class="field-label" for="deskName">Desk name</label><input id="deskName" name="name" type="text" class="input" autocomplete="organization"></div>
    <div class="field"><label class="field-label" for="email">Email</label><input id="email" name="email" type="email" class="input" autocomplete="email"></div>
    <div class="field"><label class="field-label" for="password">Password</label><input id="password" name="password" type="password" class="input" autocomplete="new-password"></div>
    <button type="submit" class="primary">Start desk</button>
    <p class="auth-alt"><a href="/sign-in">Sign in</a></p>
  </form>
</div>`;
    res.type("html").send(shell({ title: "Start a desk | Wayticket", h1: "Start a desk", path: "/sign-up" }, body));
  });

  // Desk screens: redirect to sign-in when there is no session.
  const deskGuard = (req: Request, res: Response, render: () => string): void => {
    const auth = pageAuthError(req);
    if (auth !== "none") {
      const target = encodeURIComponent(req.originalUrl);
      res.redirect(303, `/sign-in?return=${target}${auth === "ended" ? "" : ""}`);
      return;
    }
    res.type("html").send(render());
  };

  for (const [path, [h1, title]] of Object.entries(DESK_SCREENS)) {
    app.get(path, (req, res) => {
      deskGuard(req, res, () => deskShell({ title, h1, path }, "", deskScreenBody(path)));
    });
  }

  app.get("/enquiries/:id", (req, res) => {
    deskGuard(req, res, () => {
      const ref = String(req.params.id);
      const title = `Enquiry ${ref} | Wayticket`;
      return deskShell({ title, h1: `Enquiry ${ref}`, path: "/enquiries" }, "", enquiryDetailBody(ref));
    });
  });
  app.get("/enquiries/:id/trip", (req, res) => {
    deskGuard(req, res, () => {
      const ref = String(req.params.id);
      const title = `Trip plan ${ref} | Wayticket`;
      return deskShell({ title, h1: `Trip plan ${ref}`, path: "/enquiries" }, "", tripBody(ref));
    });
  });
  app.get("/enquiries/:id/bids", (req, res) => {
    deskGuard(req, res, () => {
      const ref = String(req.params.id);
      const title = `Operator bids ${ref} | Wayticket`;
      return deskShell({ title, h1: `Operator bids ${ref}`, path: "/enquiries" }, "", bidsBody(ref));
    });
  });
  const hireScreens: [string, (ref: string) => string, (ref: string) => string][] = [
    ["/quote", (ref) => `Quote ${ref} | Wayticket`, (ref) => `Quote ${ref}`],
    ["/hours", (ref) => `Drivers' hours ${ref} | Wayticket`, (ref) => `Drivers' hours ${ref}`],
    ["/seats", (ref) => `Seat plan ${ref} | Wayticket`, (ref) => `Seat plan ${ref}`],
    ["/changes", (ref) => `Changes ${ref} | Wayticket`, (ref) => `Changes ${ref}`],
  ];
  for (const [suffix, title, h1] of hireScreens) {
    app.get(`/hires/:id${suffix}`, (req, res) => {
      deskGuard(req, res, () => {
        const ref = String(req.params.id);
        return deskShell({ title: title(ref), h1: h1(ref), path: suffix.slice(1) }, "", hireScreenBody(suffix, ref));
      });
    });
  }

  // Private pages.
  app.get("/q/:token", async (req: Request, res: Response) => {
    try {
      const data = await quotePageAnswer(ctx, String(req.params.token), null);
      const lang = langFromQuery(req.query.lang, String(data.language));
      const view: QuotePageView = {
        reference: String(data.reference),
        language: String(data.language),
        state: String(data.state),
        stage: String(data.stage),
        stops: (data.stops as string[]) ?? [],
        departAt: (data.departAt as { date: string; time: string } | null) ?? null,
        returnAt: (data.returnAt as { date: string; time: string } | null) ?? null,
        people: Number(data.people ?? 0),
        vehicles: (data.vehicles as { seats: number; total: string; deposit: string }[]) ?? [],
        total: String(data.total ?? "0.00"),
        depositTotal: String(data.depositTotal ?? "0.00"),
        validUntil: data.validUntil ? String(data.validUntil) : null,
        endsAt: data.endsAt ? String(data.endsAt) : null,
        depositSaidSent: Boolean(data.depositSaidSent),
        cancelled: Boolean(data.cancelled),
        endedLineDate: data.endedLineDate ? String(data.endedLineDate) : null,
      };
      const v = quotePageBody(view, lang);
      const html = privateShell(`${v.title} | Merrowfield Coach Hire`, v.title, v.body, lang, v.dir, String(req.params.token));
      res.status(200).type("html").send(html);
    } catch (e) {
      privatePageError(res, e, req.params.token as string, "q");
    }
  });

  app.get("/b/:token", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const t = await ctx.db.query("SELECT * FROM bid_tokens WHERE token=$1", [String(req.params.token)]);
      if (!t.rows[0]) {
        res.status(404).type("html").send(notFoundShell("Page not found", "Page not found"));
        return;
      }
      const deskId = String(t.rows[0].desk_id);
      const enquiryId = String(t.rows[0].enquiry_id);
      const bid = await ctx.db.query("SELECT * FROM bids WHERE desk_id=$1 AND enquiry_id=$2 AND operator_id=$3", [deskId, enquiryId, String(t.rows[0].operator_id)]);
      if (!bid.rows[0]) {
        res.status(404).type("html").send(notFoundShell("Page not found", "Page not found"));
        return;
      }
      const award = await ctx.db.query("SELECT * FROM awards WHERE desk_id=$1 AND enquiry_id=$2", [deskId, enquiryId]);
      const awardedAt = award.rows[0] ? (award.rows[0].awarded_at as Date) : null;
      const closes = bid.rows[0].closes_at as Date;
      const now = new Date();
      const ended = (awardedAt && now.getTime() >= awardedAt.getTime() + 1000) || now.getTime() >= closes.getTime() + 1000;
      if (ended) {
        res.status(410).type("html").send(notFoundShell("This bid page has closed", "This bid page has closed"));
        return;
      }
      const stops = (await ctx.db.query("SELECT text FROM enquiry_stops WHERE enquiry_id=$1 ORDER BY position", [enquiryId])).rows.map((x) => String(x.text));
      const plan = await ctx.db.query<{ sizes: number[] }>("SELECT sizes FROM plan_saves WHERE desk_id=$1 AND enquiry_id=$2", [deskId, enquiryId]);
      const enquiry = await ctx.db.query("SELECT * FROM enquiries WHERE desk_id=$1 AND id=$2", [deskId, enquiryId]);
      const view: BidPageView = {
        route: stops,
        departAt: enquiry.rows[0] ? { date: String(enquiry.rows[0].depart_date), time: String(enquiry.rows[0].depart_time) } : null,
        returnAt: enquiry.rows[0]?.return_date ? { date: String(enquiry.rows[0].return_date), time: String(enquiry.rows[0].return_time) } : null,
        vehicles: (plan.rows[0]?.sizes ?? []).map((seats, i) => ({ index: i + 1, seats })),
        partySize: Number(enquiry.rows[0]?.people ?? 0),
        closesAt: new Date(closes).toISOString(),
        bid: bid.rows[0].received_at && !bid.rows[0].withdrawn_at ? { prices: (bid.rows[0].prices as string[]) ?? [], receivedAt: String(bid.rows[0].received_at) } : null,
      };
      res.status(200).type("html").send(privateShell("Price this hire | Wayticket", "Price this hire", bidPageBody(view), "en", "ltr", String(req.params.token)));
    } catch (e) {
      next(e);
    }
  });

  app.get("/r/:token", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const t = await ctx.db.query("SELECT * FROM run_tokens WHERE token=$1", [String(req.params.token)]);
      if (!t.rows[0]) {
        res.status(404).type("html").send(notFoundShell("Page not found", "Page not found"));
        return;
      }
      const run = await ctx.db.query("SELECT * FROM runs WHERE id=$1", [String(t.rows[0].run_id)]);
      if (!run.rows[0]) {
        res.status(404).type("html").send(notFoundShell("Page not found", "Page not found"));
        return;
      }
      const hire = await ctx.db.query("SELECT * FROM hires WHERE id=$1", [run.rows[0].hire_id]);
      if (hire.rows[0]?.cancelled) {
        res.status(410).type("html").send(notFoundShell("This page has ended.", "This page has ended."));
        return;
      }
      const customer = hire.rows[0] ? await ctx.db.query("SELECT state FROM customers WHERE id=$1", [hire.rows[0].customer_id]) : null;
      if (customer?.rows[0]?.state === "erased") {
        res.status(410).type("html").send(notFoundShell("This page has ended.", "This page has ended."));
        return;
      }
      const lang = req.query.lang === "pl" ? "pl" : "en";
      const deskId = String(t.rows[0].desk_id);
      const stops = (await ctx.db.query("SELECT * FROM enquiry_stops WHERE enquiry_id=(SELECT reference FROM hires WHERE id=$1) ORDER BY position", [run.rows[0].hire_id])).rows;
      const presses = (await ctx.db.query("SELECT * FROM run_presses WHERE run_id=$1", [String(run.rows[0].id)])).rows;
      const charges = (await ctx.db.query("SELECT * FROM run_charges WHERE run_id=$1", [String(run.rows[0].id)])).rows;
      const view: RunPageView = {
        number: Number(run.rows[0].number),
        departAt: { date: String(run.rows[0].depart_date), time: String(run.rows[0].depart_time) },
        stops: stops.map((s) => ({
          id: String(s.id),
          text: String(s.text),
          presses: {
            arrived: pressAt(presses, String(s.id), "arrived"),
            boarded: pressAt(presses, String(s.id), "boarded"),
            left: pressAt(presses, String(s.id), "left"),
          },
        })),
        flightLine: null,
        charges: charges.map((c) => ({
          stopId: c.stop_id ? String(c.stop_id) : null,
          kind: String(c.kind),
          minutes: Number(c.minutes),
          amount: String(c.amount_pennies),
          accepted: Boolean(c.accepted),
        })),
      };
      const v = runSheetBody(view, lang);
      res
        .status(200)
        .type("html")
        .send(privateShell(`${v.title} | Wayticket`, v.title, v.body, lang, v.dir, String(req.params.token)));
      void deskId;
    } catch (e) {
      next(e);
    }
  });

  // Unknown pages: server 404, never the shell with 200.
  app.use((req: Request, res: Response) => {
    void ctx;
    if (req.path.startsWith("/api/")) {
      sendError(res, errors.unknownRoute());
      return;
    }
    res.status(404).type("html").send(notFoundShell("Page not found", "Page not found"));
  });
  void ukDateString;
  void requireAuth;
  void express;
}

function pressAt(rows: Record<string, unknown>[], stopId: string, kind: string): string | null {
  const found = rows.find((x) => String(x.stop_id) === stopId && String(x.kind) === kind);
  return found ? new Date(found.at as Date).toISOString().replace(/\.\d{3}Z$/, "Z") : null;
}

function privateShell(title: string, _h1: string, body: string, lang: string, dir: string, token: string): string {
  return `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/assets/app.css">
<script src="/assets/client.js" defer></script>
</head>
<body data-page="private" data-token="${escapeHtml(token)}">
<div role="region" aria-label="Announcements" data-part="announcements" class="announcements" aria-live="polite"></div>
<main id="main">
${body}
</main>
</body>
</html>`;
}

function privatePageError(res: Response, e: unknown, token: string, kind: string): void {
  if (e && typeof e === "object" && "status" in e) {
    const err = e as { status: number; code: string; message: string };
    if (err.status === 404) {
      res.status(404).type("html").send(notFoundShell("Page not found", "Page not found"));
      return;
    }
    if (err.status === 410) {
      const lang = kind === "q" ? "en" : "en";
      res.status(410).type("html").send(notFoundShell("This page has ended.", "This page has ended.", lang, "ltr", true));
      return;
    }
  }
  void token;
  res.status(404).type("html").send(notFoundShell("Page not found", "Page not found"));
}

import { deskScreenBody, enquiryDetailBody, tripBody, bidsBody, hireScreenBody } from "./pages/desk.js";
