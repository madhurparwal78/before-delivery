// Rungboard server: one origin for the API and the browser app.

import { createServer } from "node:http";
import { config } from "./config.js";
import { dispatch, errorReply, json, publicRoute, send } from "./http.js";
import { ApiError, notFound } from "./errors.js";
import { databaseReachable } from "./db.js";
import { isReady, start } from "./startup.js";
import { serveApp } from "./spa.js";
import "./domain/offices.js";
import "./domain/options.js";
import "./domain/bookings.js";
import "./domain/ledger.js";
import "./domain/licences.js";
import "./domain/feeds.js";
import "./domain/members.js";
import "./domain/clients.js";
import "./domain/rate-cards.js";
import "./domain/talent.js";
import "./domain/public.js";
import "./domain/roster.js";
import "./domain/packages.js";
import "./domain/applications.js";
import "./domain/cast-requests.js";

publicRoute("GET", "/api/health", async () =>
  isReady() && databaseReachable() ? json(200, { status: "ok" }) : json(503, { status: "starting" }));

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (url.pathname === "/api/health" || isReady()) {
      if (await dispatch(req, res, url)) return;
    } else if (url.pathname.startsWith("/api/")) {
      send(res, errorReply(new ApiError(503, "starting")));
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      send(res, errorReply(notFound()));
      return;
    }
    await serveApp(req, res, url);
  } catch (error) {
    console.error("request failed:", error);
    if (!res.headersSent) send(res, errorReply(error));
  }
});

server.listen(config.port, "0.0.0.0", () => console.log(`Rungboard listening on 0.0.0.0:${config.port}`));
void start();
