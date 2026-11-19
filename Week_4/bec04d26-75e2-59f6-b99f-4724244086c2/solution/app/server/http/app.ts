import { Hono } from "hono";
import { actionId } from "../cause";
import { databaseReady } from "../db";
import { registerAuth } from "../routes/auth";
import { registerGrading } from "../routes/grading";
import { registerLive } from "../routes/live";
import { registerReturns } from "../routes/returns";
import { registerSetup } from "../routes/setup";
import { boundary } from "./body";
import { type Env, reply } from "./context";
import { ApiError, notFound, serverError } from "./errors";
import { registerPages } from "./pages";

export function buildApp(): Hono<Env> {
  const app = new Hono<Env>();
  app.use("*", async (c, next) => {
    if (c.req.path !== "/api/health" && c.req.path.startsWith("/api/")) await databaseReady;
    await next();
  });
  app.use("*", (c, next) => {
    const id = c.req.header("x-action-id");
    return id ? actionId.run(id, next) : next();
  });
  app.use("*", boundary);
  registerAuth(app);
  registerSetup(app);
  registerReturns(app);
  registerLive(app);
  registerGrading(app);
  app.all("/api/*", () => {
    throw notFound();
  });
  registerPages(app);
  app.onError((error) => {
    if (!(error instanceof ApiError)) console.error(error);
    const answer = error instanceof ApiError ? error : serverError();
    return reply(answer.body, answer.status);
  });
  return app;
}
