import { createServer } from "node:http";
import { config } from "./config.js";
import { migrate } from "./db.js";
import { ApiError, errorBody } from "./errors.js";
import { answer, failure, send, splitTarget } from "./http.js";
import { startBackgroundWork } from "./monitor.js";
import { routes } from "./routes.js";
import { serveBuilt } from "./static.js";

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  // script-src keeps inline script out; the one hash admits the axe-core build the golden page audit injects.
  "content-security-policy":
    "default-src 'self'; script-src 'self' 'sha256-IMCf4Veoo0ow4kGqofza3mV3NPCKs3ns++t9RcxG6Hg='; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

const ready = migrate().then(startBackgroundWork);

const server = createServer((request, response) => {
  void (async () => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
    const target = request.url ?? "/";
    const { pathname } = splitTarget(target);
    try {
      if (pathname === "/api/health") {
        send(response, { status: 200, json: { status: "ok" } });
      } else if (pathname.startsWith("/api/")) {
        await ready;
        send(response, await answer(request, routes, target));
      } else {
        const asset = request.method === "GET" || request.method === "HEAD" ? await serveBuilt(pathname) : null;
        send(response, asset ?? { status: 404, json: errorBody(new ApiError("not_found")) });
      }
    } catch (error) {
      send(response, failure(error));
    }
  })();
});

server.listen(config.port, "0.0.0.0");
