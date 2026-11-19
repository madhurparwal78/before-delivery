import { Router, type Request, type Response } from "express";
import type { Config } from "./config.js";
import type { Database } from "./db.js";
import { loadSession, sessionLanding } from "./auth.js";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

interface RoutePattern {
  regex: RegExp;
  roles: string[];
}

const SIGNED_IN_PATTERNS: RoutePattern[] = [
  { regex: /^\/estate$/, roles: ["lead"] },
  { regex: /^\/shop\/[^/]+$/, roles: ["manager"] },
  { regex: /^\/care$/, roles: ["care"] },
  { regex: /^\/care\/orders\/[^/]+$/, roles: ["care"] },
  { regex: /^\/catalogue$/, roles: ["shopper"] },
  { regex: /^\/products\/[^/]+$/, roles: ["shopper"] },
  { regex: /^\/cart$/, roles: ["shopper"] },
  { regex: /^\/orders\/[^/]+$/, roles: ["shopper"] },
];

function readAsset(name: string): string {
  return readFileSync(path.join(dirname, "..", "public", name), "utf8");
}

let cachedShell: string | null = null;

function shell(): string {
  if (cachedShell === null) {
    cachedShell = readAsset("shell.html");
  }
  return cachedShell;
}

function page(body: string, status = 200): string {
  return shell().replace("<!--BODY-->", body);
}

function notFoundPage(): string {
  return page(
    `<main class="nf"><h1 tabindex="-1" id="nf-heading" class="nf-heading">We couldn't find that page.</h1></main>`,
    404,
  );
}

function signInPage(): string {
  return page(
    `<main class="signin">
  <h1 class="visually-hidden">Sign in</h1>
  <form id="sign-in-form" class="signin-form" novalidate>
    <div id="sign-in-alert-slot"></div>
    <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" /></div>
    <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" /></div>
    <button id="sign-in-button" type="submit" class="btn">Sign in</button>
  </form>
</main>`,
  );
}

function landingPage(): string {
  return page(
    `<main id="landing">
  <section class="hero">
    <div class="hero-left panel-white">
      <p class="support">Every shop in your group, every tin on its shelves, every collection hour in its own local time.</p>
      <a class="btn" href="/sign-in" id="sign-in-link">Sign in</a>
    </div>
    <div class="hero-right panel-charcoal" id="landing-map"></div>
  </section>
  <section class="panel-charcoal drawings" id="landing-drawings"></section>
  <section class="red-section"><div class="measure">Groups of shops run every hold, sale and collection hour from one place.</div></section>
  <section class="red-section"><div class="measure">Stores publish hours that start on the day you choose, in their own timezone.</div></section>
</main>`,
  );
}

function appScreen(): string {
  return page(`<div id="root"></div>`);
}

export function servePages(db: Database, cfg: Config): Router {
  const router = Router();

  router.get("/app.css", (_req, res) => {
    res.setHeader("Content-Type", "text/css; charset=utf-8");
    res.send(readAsset("app.css"));
  });
  router.get("/app.js", (_req, res) => {
    res.setHeader("Content-Type", "text/javascript; charset=utf-8");
    res.send(readAsset("app.js"));
  });
  router.get("/coastline.json", (_req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.send(readAsset("coastline.json"));
  });
  router.get("/fonts/:name", (req, res) => {
    const allowed = ["bigshoulders.woff2", "publicsans.woff2"];
    if (!allowed.includes(req.params.name)) {
      res.status(404).send("not found");
      return;
    }
    res.setHeader("Content-Type", "font/woff2");
    res.send(readFileSync(path.join(dirname, "..", "public", "fonts", req.params.name)));
  });

  router.get("/", (req, res) => {
    res.send(landingPage());
  });

  router.get("/sign-in", (req, res) => {
    res.send(signInPage());
  });

  router.use(async (req: Request, res: Response, next) => {
    const path = req.path.split("?")[0];
    if (path.startsWith("/api")) {
      next();
      return;
    }
    const auth = await loadSession(req, db, cfg);
    const pattern = SIGNED_IN_PATTERNS.find((p) => p.regex.test(path));
    if (!pattern) {
      res.status(404).send(notFoundPage());
      return;
    }
    if (!auth) {
      const target = `${path}${req.url.includes("?") ? `?${req.url.split("?")[1]}` : ""}`;
      res.redirect(302, `/sign-in?next=${encodeURIComponent(target)}`);
      return;
    }
    if (!pattern.roles.includes(auth.user.role)) {
      res.status(404).send(notFoundPage());
      return;
    }
    if (pattern.roles.includes("manager")) {
      const storeId = path.split("/")[2];
      if (!auth.storeIds.includes(storeId)) {
        res.status(404).send(notFoundPage());
        return;
      }
    }
    if (pattern.roles.includes("shopper") && path.startsWith("/orders/")) {
      const orderId = path.split("/")[2];
      const visible = await db.withClient(async (client) => {
        const result = await client.query<{ person_id: string; operator_id: string }>(
          "SELECT person_id, operator_id FROM orders WHERE id = $1",
          [orderId],
        );
        const row = result.rows[0];
        return Boolean(row && row.operator_id === auth.user.operatorId && row.person_id === auth.user.id);
      });
      if (!visible) {
        res.status(404).send(notFoundPage());
        return;
      }
    }
    if (pattern.roles.includes("care") && path.startsWith("/care/orders/")) {
      const orderId = path.split("/")[3];
      const visible = await db.withClient(async (client) => {
        const result = await client.query<{ operator_id: string }>("SELECT operator_id FROM orders WHERE id = $1", [orderId]);
        const row = result.rows[0];
        return Boolean(row && row.operator_id === auth.user.operatorId);
      });
      if (!visible) {
        res.status(404).send(notFoundPage());
        return;
      }
    }
    res.send(appScreen());
  });

  return router;
}



export { sessionLanding };
