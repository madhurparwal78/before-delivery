import { Hono } from "hono";
import { config } from "../config.js";
import { StorageError, notFound, storageUnavailable } from "../errors.js";
import { setupWorld } from "../domain/seed.js";
import { buildSample, isSampleName } from "../pdf/samples.js";
import { safeEqual } from "../util.js";
import { jsonBody } from "./context.js";

export const gradingRoutes = new Hono();

gradingRoutes.use("*", async (c, next) => {
  const given = c.req.header("X-Grading-Key") ?? "";
  if (config.gradingKey === "" || !safeEqual(given, config.gradingKey)) throw notFound();
  await next();
});

gradingRoutes.post("/setup", async (c) => {
  try {
    return c.json(await setupWorld(await jsonBody(c)), 201);
  } catch (error) {
    if (error instanceof StorageError) throw storageUnavailable();
    throw error;
  }
});

gradingRoutes.get("/samples/:name", (c) => {
  const name = c.req.param("name");
  if (!isSampleName(name)) throw notFound();
  return new Response(new Uint8Array(buildSample(name)), { headers: { "content-type": "application/pdf" } });
});
