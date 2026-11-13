import { Hono } from "hono";
import { ApiError } from "./errors.js";
import { config } from "./config.js";
import { documentRoutes, UPLOAD_LIMIT } from "./routes/documents.js";
import { gradingRoutes } from "./routes/grading.js";
import { liveRoutes } from "./routes/live.js";
import { pageRoutes } from "./routes/pages.js";
import { sessionRoutes } from "./routes/session.js";
import { completedPdfRoute, signRoutes } from "./routes/sign.js";
import { teamRoutes } from "./routes/team.js";
import { templateRoutes } from "./routes/templates.js";

const JSON_LIMIT = 1_000_000;
const MULTIPART_OVERHEAD = 1_000_000;
const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const app = new Hono();

app.use("*", async (c, next) => {
  if (!WRITES.has(c.req.method)) return next();
  const origin = c.req.header("Origin");
  if (origin && origin !== "null") {
    let sameOrigin = false;
    try {
      sameOrigin = new URL(origin).host === c.req.header("Host");
    } catch {
      sameOrigin = false;
    }
    if (!sameOrigin) throw new ApiError(403, { error: "forbidden" });
  } else if (origin === "null") throw new ApiError(403, { error: "forbidden" });
  const multipart = (c.req.header("Content-Type") ?? "").startsWith("multipart/form-data");
  const limit = multipart ? UPLOAD_LIMIT + MULTIPART_OVERHEAD : JSON_LIMIT;
  const declared = Number(c.req.header("Content-Length") ?? 0);
  if (declared > limit) throw new ApiError(413, { error: "too_large", limit: multipart ? UPLOAD_LIMIT : JSON_LIMIT });
  if (!multipart) {
    const size = (await c.req.arrayBuffer()).byteLength;
    if (size > limit) throw new ApiError(413, { error: "too_large", limit: JSON_LIMIT });
  }
  return next();
});

app.get("/api/health", (c) => c.json({ status: "ok" }));
app.route("/api/session", sessionRoutes);
app.route("/api/documents", documentRoutes);
app.route("/api/templates", templateRoutes);
app.route("/api/team", teamRoutes);
app.route("/api/sign", signRoutes);
app.route("/api/live", liveRoutes);
app.route("/api/grading", gradingRoutes);
app.route("/sign", completedPdfRoute);
app.route("/", pageRoutes);

app.onError((error, c) => {
  if (error instanceof ApiError) return c.json(error.body, error.status);
  console.error(error);
  return c.json({ error: "internal" }, 500);
});

app.notFound((c) => c.json({ error: "not_found" }, 404));
