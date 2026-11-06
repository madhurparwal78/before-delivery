import type { Router, Request, Response } from "express";
import type { Services } from "../services.js";
import { errors } from "../errors.js";
import { requirePerson, role, AppRequest, handleRouteError } from "../web.js";
import { formatCoopTime, isoInstant } from "../../shared/time.js";

// Follows belong to the person who made them; one shortlist per newsroom.
export function registerSocialRoutes(router: Router, services: Services): void {
  const { sql, clock } = services;

  // --- Follows ---
  router.post("/api/follows", async (req: Request, res: Response) => {
    const person = requirePerson(req as AppRequest);
    try {
      role(person, "picture_editor");
      const raw = (req as AppRequest).rawBody as Record<string, unknown>;
      const keys = Object.keys(raw);
      const hasEssay = "essay_id" in raw;
      const hasContributor = "contributor" in raw;
      if (keys.some((k) => k !== "essay_id" && k !== "contributor")) {
        const problems: Record<string, string> = {};
        for (const k of keys) if (k !== "essay_id" && k !== "contributor") problems[k] = "Unknown field";
        res.status(422).json(errors.validationFailed(problems).body());
        return;
      }
      if (hasEssay === hasContributor) {
        res.status(422).json(errors.validationFailed({ target: "Follow one essay or one contributor" }).body());
        return;
      }
      if (hasEssay) {
        if (typeof raw.essay_id !== "string") {
          res.status(422).json(errors.validationFailed({ essay_id: "This field is missing or has the wrong type" }).body());
          return;
        }
        const essay = await sql`SELECT id, state FROM essays WHERE id = ${raw.essay_id}`;
        if (essay.length === 0) {
          res.status(404).json(errors.notFound().body());
          return;
        }
        if (essay[0].state === "taken_down") {
          res.status(410).json(errors.takenDown().body());
          return;
        }
        if (essay[0].state !== "embargoed" && essay[0].state !== "live") {
          res.status(404).json(errors.notFound().body());
          return;
        }
        const existing = await sql`
          SELECT id, essay_id, followed_handle FROM follows
          WHERE person_id = ${person.id} AND essay_id = ${raw.essay_id}`;
        if (existing.length > 0) {
          res.status(200).json(followBody(existing[0]));
          return;
        }
        const rows = await sql`
          INSERT INTO follows (person_id, essay_id) VALUES (${person.id}, ${raw.essay_id})
          ON CONFLICT DO NOTHING
          RETURNING id, essay_id, followed_handle`;
        if (rows.length === 0) {
          const again = await sql`
            SELECT id, essay_id, followed_handle FROM follows
            WHERE person_id = ${person.id} AND essay_id = ${raw.essay_id}`;
          res.status(200).json(followBody(again[0]));
          return;
        }
        res.status(201).json(followBody(rows[0]));
      } else {
        if (typeof raw.contributor !== "string") {
          res.status(422).json(errors.validationFailed({ contributor: `Unknown contributor ${String(raw.contributor)}` }).body());
          return;
        }
        const target = await sql`SELECT id, contributor_handle FROM people WHERE contributor_handle = ${raw.contributor}`;
        if (target.length === 0) {
          res.status(422).json(errors.validationFailed({ contributor: `Unknown contributor ${String(raw.contributor)}` }).body());
          return;
        }
        const existing = await sql`
          SELECT id, essay_id, followed_handle FROM follows
          WHERE person_id = ${person.id} AND followed_handle = ${raw.contributor}`;
        if (existing.length > 0) {
          res.status(200).json(followBody(existing[0]));
          return;
        }
        const rows = await sql`
          INSERT INTO follows (person_id, followed_handle) VALUES (${person.id}, ${raw.contributor})
          RETURNING id, essay_id, followed_handle`;
        res.status(201).json(followBody(rows[0]));
      }
    } catch (err) {
      handleRouteError(res, err);
      }
  });

  router.get("/api/follows", async (req: Request, res: Response) => {
    const person = requirePerson(req as AppRequest);
    try {
      role(person, "picture_editor");
      const rows = await sql`
        SELECT id, essay_id, followed_handle FROM follows WHERE person_id = ${person.id} ORDER BY id DESC`;
      res.status(200).json({ follows: rows.map(followBody) });
    } catch (err) {
      handleRouteError(res, err);
      }
  });

  router.delete("/api/follows/:id", async (req: Request, res: Response) => {
    const person = requirePerson(req as AppRequest);
    try {
      role(person, "picture_editor");
      const rows = await sql`DELETE FROM follows WHERE id = ${Number(req.params.id)} AND person_id = ${person.id} RETURNING id`;
      if (rows.length === 0) {
        res.status(404).json(errors.notFound().body());
        return;
      }
      res.status(204).end();
    } catch (err) {
      handleRouteError(res, err);
      }
  });

  // --- Shortlist (one per newsroom) ---
  const shortlistBody = (item: Record<string, unknown>): Record<string, unknown> => ({
    id: Number(item.id),
    essay_id: item.essay_id,
    essay_title: item.essay_title,
    frame_id: item.frame_id,
    position: Number(item.position),
    added_by: item.added_by,
    added_at: isoInstant(new Date(item.added_at as unknown as string).getTime()),
    added_display: formatCoopTime(new Date(item.added_at as unknown as string).getTime()),
  });

  router.get("/api/shortlist", async (req: Request, res: Response) => {
    const person = requirePerson(req as AppRequest);
    try {
      role(person, "picture_editor", "licensing_manager");
      const rows = await sql`
        SELECT s.id, s.essay_id, s.frame_id, s.added_at, f.position, e.title AS essay_title,
               p.name AS added_by
        FROM shortlist_items s
        JOIN frames f ON f.id = s.frame_id
        JOIN essays e ON e.id = s.essay_id
        JOIN people p ON p.id = s.added_by
        WHERE s.newsroom_id = ${person.newsroom_id}
        ORDER BY s.added_at DESC, s.id DESC`;
      res.status(200).json({ items: rows.map(shortlistBody), count: rows.length });
    } catch (err) {
      handleRouteError(res, err);
      }
  });

  router.post("/api/shortlist", async (req: Request, res: Response) => {
    const person = requirePerson(req as AppRequest);
    try {
      role(person, "picture_editor");
      const raw = (req as AppRequest).rawBody as Record<string, unknown>;
      if ("frame_id" in raw === false || Object.keys(raw).some((k) => k !== "frame_id")) {
        const problems: Record<string, string> = {};
        for (const k of Object.keys(raw)) if (k !== "frame_id") problems[k] = "Unknown field";
        if (!("frame_id" in raw)) problems.frame_id = "This field is missing or has the wrong type";
        res.status(422).json(errors.validationFailed(problems).body());
        return;
      }
      if (typeof raw.frame_id !== "string") {
        res.status(422).json(errors.validationFailed({ frame_id: "This field is missing or has the wrong type" }).body());
        return;
      }
      const frame = await sql`SELECT id, essay_id FROM frames WHERE id = ${raw.frame_id}`;
      if (frame.length === 0) {
        res.status(404).json(errors.notFound().body());
        return;
      }
      const essay = await sql`SELECT state FROM essays WHERE id = ${frame[0].essay_id}`;
      if (essay[0].state !== "embargoed" && essay[0].state !== "live") {
        res.status(409).json(errors.notLicensable().body());
        return;
      }
      const existing = await sql`
        SELECT s.id, s.essay_id, s.frame_id, s.added_at, f.position, e.title AS essay_title, p.name AS added_by
        FROM shortlist_items s
        JOIN frames f ON f.id = s.frame_id
        JOIN essays e ON e.id = s.essay_id
        JOIN people p ON p.id = s.added_by
        WHERE s.newsroom_id = ${person.newsroom_id} AND s.frame_id = ${raw.frame_id}`;
      if (existing.length > 0) {
        res.status(200).json(shortlistBody(existing[0]));
        return;
      }
      const rows = await sql`
        INSERT INTO shortlist_items (newsroom_id, frame_id, essay_id, added_by)
        VALUES (${person.newsroom_id}, ${raw.frame_id}, ${frame[0].essay_id}, ${person.id})
        ON CONFLICT (newsroom_id, frame_id) DO NOTHING
        RETURNING id`;
      if (rows.length === 0) {
        const again = await sql`
          SELECT s.id, s.essay_id, s.frame_id, s.added_at, f.position, e.title AS essay_title, p.name AS added_by
          FROM shortlist_items s
          JOIN frames f ON f.id = s.frame_id
          JOIN essays e ON e.id = s.essay_id
          JOIN people p ON p.id = s.added_by
          WHERE s.newsroom_id = ${person.newsroom_id} AND s.frame_id = ${raw.frame_id}`;
        res.status(200).json(shortlistBody(again[0]));
        return;
      }
      const fresh = await sql`
        SELECT s.id, s.essay_id, s.frame_id, s.added_at, f.position, e.title AS essay_title, p.name AS added_by
        FROM shortlist_items s
        JOIN frames f ON f.id = s.frame_id
        JOIN essays e ON e.id = s.essay_id
        JOIN people p ON p.id = s.added_by
        WHERE s.id = ${rows[0].id}`;
      res.status(201).json(shortlistBody(fresh[0]));
    } catch (err) {
      handleRouteError(res, err);
      }
  });

  router.delete("/api/shortlist/:id", async (req: Request, res: Response) => {
    const person = requirePerson(req as AppRequest);
    try {
      role(person, "picture_editor");
      const rows = await sql`
        DELETE FROM shortlist_items WHERE id = ${Number(req.params.id)} AND newsroom_id = ${person.newsroom_id}
        RETURNING id`;
      if (rows.length === 0) {
        res.status(404).json(errors.notFound().body());
        return;
      }
      res.status(204).end();
    } catch (err) {
      handleRouteError(res, err);
      }
  });

  void clock;
}

function followBody(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: Number(row.id),
    essay_id: row.essay_id ?? null,
    contributor: row.followed_handle ?? null,
  };
}
