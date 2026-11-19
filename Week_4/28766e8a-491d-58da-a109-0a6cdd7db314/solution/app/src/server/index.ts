// Linewell server: HTTP and the live socket share one port (brief: Deployment).
import { createServer } from "node:http";
import { ApiError } from "../shared/errors";
import { config } from "./config";
import { migrate } from "./db";
import { errorReply, findRoute, json, parseCookies, readBody, route, sameOrigin, send, type Request } from "./http";
import { attachLive } from "./live";
import { servePage } from "./pages";
import { startVersionTimer } from "./versions";
import "./auth";
import "./comments";
import "./diagrams";
import "./exports";
import "./grading";
import "./members";
import "./operations";

route("GET", "/api/health", async () => json(200, { status: "ok" }));

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const server = createServer((incoming, res) => {
  void (async () => {
    const url = new URL(incoming.url ?? "/", "http://local");
    const method = incoming.method ?? "GET";
    const base = { method, path: url.pathname, query: url.searchParams, headers: incoming.headers, cookies: parseCookies(incoming.headers.cookie) };
    try {
      if (STATE_CHANGING.has(method) && !sameOrigin(incoming.headers)) throw new ApiError("cross_origin");
      const found = findRoute(method, url.pathname);
      if (found) {
        const req: Request = { ...base, params: found.params, body: await readBody(incoming) };
        send(res, await found.handler(req));
        return;
      }
      const page = method === "GET" && !url.pathname.startsWith("/api/") ? await servePage({ ...base, params: [], body: undefined }) : null;
      send(res, page ?? errorReply(new ApiError("not_found")));
    } catch (error) {
      if (error instanceof ApiError) send(res, errorReply(error));
      else {
        console.error(error);
        send(res, errorReply(new ApiError("internal")));
      }
    }
  })();
});

await migrate();
attachLive(server);
startVersionTimer();
server.listen(config.port, "0.0.0.0", () => {
  console.log(`Linewell listening on ${config.port}`);
});
