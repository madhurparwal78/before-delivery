import type { Router, Request, Response } from "express";
import type { Services } from "../services.js";
import { errors } from "../errors.js";
import { AppRequest, handleRouteError } from "../web.js";
import { loadEssay, type EssayRow, type PersonRow } from "../domain/essays.js";

// Media under /media is served by the app from the bucket, with access judged
// by role and essay state. Newsrooms may fetch grid and preview; credited
// contributors and the desk editor may also fetch story. A withdrawn essay
// stays open to newsrooms holding a licence on it.
export function registerMediaRoutes(router: Router, services: Services): void {
  const { sql, storage } = services;

  router.get("/media/frames/:frameId/:variant", async (req: Request, res: Response) => {
    const person = (req as AppRequest).person;
    if (!person) {
      res.status(401).json(errors.unauthenticated().body());
      return;
    }
    const variant = req.params.variant;
    if (variant !== "grid" && variant !== "story" && variant !== "preview") {
      res.status(404).json(errors.notFound().body());
      return;
    }
    try {
      const frames = await sql`SELECT * FROM frames WHERE id = ${req.params.frameId}`;
      if (frames.length === 0) {
        res.status(404).json(errors.notFound().body());
        return;
      }
      const frame = frames[0];
      const essay = await loadEssay(sql, frame.essay_id);
      if (!essay) {
        res.status(404).json(errors.notFound().body());
        return;
      }
      const access = await mediaAccess(sql, essay, person, variant);
      if (access === "gone") {
        res.status(410).json(errors.takenDown().body());
        return;
      }
      if (access === "denied") {
        res.status(404).json(errors.notFound().body());
        return;
      }
      try {
        const stream = await storage.client.getObject(storage.bucket, derivativeKey(essay.id, frame.id, variant));
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(chunk as Buffer);
        res.setHeader("Content-Type", "image/jpeg");
        res.setHeader("Cache-Control", "no-store");
        res.status(200).send(Buffer.concat(chunks));
      } catch {
        res.status(503).json(errors.storageUnavailable().body());
      }
    } catch (err) {
      handleRouteError(res, err);
      }
  });

  function derivativeKey(essayId: string, frameId: string, variant: "grid" | "story" | "preview"): string {
    return `derivatives/${essayId}/${frameId}/${variant}.jpg`;
  }
}

type MediaAccess = "ok" | "gone" | "denied";

async function mediaAccess(sql: Services["sql"], essay: EssayRow, person: PersonRow, variant: string): Promise<MediaAccess> {
  if (essay.state === "taken_down") return "gone";
  if (person.role === "desk_editor") return "ok";
  if (person.role === "contributor") {
    const credited = await sql`SELECT 1 FROM credits WHERE essay_id = ${essay.id} AND person_id = ${person.id}`;
    if (credited.length === 0) return "denied";
    return "ok";
  }
  if (person.role === "picture_editor" || person.role === "licensing_manager") {
    if (essay.state === "embargoed" || essay.state === "live") {
      return variant === "story" ? "denied" : "ok";
    }
    if (essay.state === "withdrawn") {
      // A newsroom holding a licence may still open the essay while its
      // licences run to their end.
      const licence = await sql`
        SELECT id FROM licences WHERE essay_id = ${essay.id} AND newsroom_id = ${person.newsroom_id} LIMIT 1`;
      if (licence.length > 0) return "ok";
    }
    return "denied";
  }
  return "denied";
}
