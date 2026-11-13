// The API routes. Every error goes through the one shape and the one ordering.

import express, { type Request, type Response, type NextFunction } from "express";
import { Pool } from "pg";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PersonRow, ProgrammeRow, PartRow, ScanRow } from "./model.js";
import {
  loadProgrammeData, programmeSummaryOf, workSummaryOf, workDetailOf, seatedPlayers,
  noticesOf, uploaderNames, userOf, rentalSetOf, reminderDate, isSeated,
} from "./model.js";
import { formatTimestamp, formatDateTime } from "../shared/london.js";
import {
  ApiError, notFound, forbidden, unauthenticated, validation, conflict,
} from "./errors.js";
import {
  readBody, requireJson, parseMultipart, decodeFileName, sniffType, contentDisposition,
  JSON_LIMIT, FILE_LIMIT, MULTIPART_LIMIT,
} from "./bodies.js";
import {
  singleLine, parseInstant, idempotencyKey, hashOf, isWholeNumber,
  parseStringCount, statusText, rentalText, plural,
} from "./validation.js";
import { putObject, getObject, probeWithTimeout, type StoreConfig } from "./store.js";
import type { MailService } from "./mail.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface AppState {
  pool: Pool;
  store: StoreConfig;
  mail: MailService;
}

const SESSION_COOKIE = "qw_session";
const SESSION_TTL_MS = 12 * 3600 * 1000;

type RentalStatus = "requested" | "received" | "in_use" | "returned" | "checked_in";

interface RentalSetRow {
  id: string;
  work_id: string;
  publisher: string;
  status: RentalStatus;
  created_at: Date;
  returned_at: Date | null;
  reminder_status: "none" | "queued" | "sent";
  reminder_sent_at: Date | null;
}

export function buildApp(state: AppState): express.Express {
  const app = express();
  app.disable("x-powered-by");

  // Server-boundary checks, first in the error order: same origin, body limits
  // and content types, before any session is read.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (["POST", "PUT", "DELETE"].includes(req.method)) {
      const origin = req.header("Origin");
      if (origin && origin !== originOf(req)) {
        throw new ApiError(403, "cross_origin", "Requests from other origins are refused.");
      }
    }
    const declaredLength = Number(req.header("Content-Length") ?? "0");
    const chunked = req.header("Transfer-Encoding") === "chunked";
    if (req.method === "GET" || req.method === "HEAD" || req.method === "DELETE") {
      next();
      return;
    }
    if (!chunked && declaredLength === 0) {
      // No body was sent (for example the publish request); nothing to check.
      next();
      return;
    }
    const type = (req.header("Content-Type") ?? "").split(";")[0].trim();
    const isUpload = /^\/api\/parts\/[^/]+\/scans$/.test(req.path);
    if (isUpload) {
      if (type !== "multipart/form-data") {
        throw new ApiError(415, "unsupported_media_type", "Send the scan as multipart/form-data.");
      }
      if (declaredLength > MULTIPART_LIMIT) {
        throw new ApiError(413, "file_too_large", "The file is larger than 20,000,000 bytes.");
      }
      next();
      return;
    }
    if (type !== "application/json") {
      throw new ApiError(415, "unsupported_media_type", "Send the body as application/json.");
    }
    if (declaredLength > JSON_LIMIT) {
      throw new ApiError(413, "body_too_large", "The JSON body is too large.");
    }
    next();
  });

  app.use(async (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { person?: PersonRow | null }).person = await personForSession(state, req);
    next();
  });

  const requirePerson = (req: Request): PersonRow => {
    const person = (req as Request & { person?: PersonRow }).person;
    if (!person) throw unauthenticated();
    return person as PersonRow;
  };

  const isLibrarian = (person: PersonRow): boolean =>
    person.role === "principal_librarian" || person.role === "assistant_librarian";
  const isSectionPrincipal = (person: PersonRow): boolean => person.role === "section_principal";
  const maySeeCatalogue = (person: PersonRow): boolean => isLibrarian(person) || isSectionPrincipal(person);

  // ------------------------------------------------------------ session

  app.post("/api/session", async (req: Request, res: Response) => {
    const raw = await readBody(req, JSON_LIMIT);
    const body = requireJson(req, raw);
    if (typeof body.email !== "string" || typeof body.passcode !== "string") {
      throw validation({ email: "Enter your email.", passcode: "Enter your passcode." });
    }
    const rows = await state.pool.query<PersonRow>(
      "SELECT * FROM people WHERE email=$1 AND passcode=$2",
      [body.email.trim(), body.passcode]
    );
    if (rows.rows.length === 0) {
      throw new ApiError(401, "invalid_credentials", "That email and passcode don't match.");
    }
    const token = randomBytes(32).toString("base64url");
    await state.pool.query(
      "INSERT INTO sessions (token,person_id,last_seen) VALUES ($1,$2,now())",
      [token, rows.rows[0].id]
    );
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_TTL_MS / 1000,
    });
    res.json({ user: userOf(rows.rows[0]) });
  });

  app.get("/api/session", (req: Request, res: Response) => {
    res.json({ user: userOf(requirePerson(req)) });
  });

  app.delete("/api/session", async (req: Request, res: Response) => {
    const rawToken = req.cookies[SESSION_COOKIE];
    const token = typeof rawToken === 'string' ? rawToken : undefined;
    if (token) await state.pool.query("DELETE FROM sessions WHERE token=$1", [token]);
    res.cookie(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
    res.status(204).end();
  });

  // ------------------------------------------------------------- health

  app.get("/api/health", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok" });
  });

  app.get("/api/status", async (_req: Request, res: Response) => {
    const storage = await probeWithTimeout(state.store);
    const mail = await probeMail(state.mail);
    res.json({ storage: storage ? "up" : "down", mail: mail ? "up" : "down" });
  });

  // ----------------------------------------------------------- catalogue

  app.get("/api/catalogue", async (req: Request, res: Response) => {
    const person = requirePerson(req);
    if (!maySeeCatalogue(person)) throw forbidden();
    const works = await state.pool.query<{
      id: string; title: string; composer: string; bars: number; running_time_ms: string;
    }>("SELECT id,title,composer,bars,running_time_ms FROM catalogue_works ORDER BY id");
    const out = [];
    for (const work of works.rows) {
      const parts = await state.pool.query<{ name: string; chair_key: string; bars_from: number; bars_to: number }>(
        "SELECT name,chair_key,bars_from,bars_to FROM catalogue_parts WHERE catalogue_work_id=$1 ORDER BY chair_key",
        [work.id]
      );
      out.push({
        id: work.id,
        title: work.title,
        composer: work.composer,
        bars: work.bars,
        running_time_seconds: Math.round(Number(work.running_time_ms) / 1000),
        parts: parts.rows,
      });
    }
    res.json({ works: out });
  });

  // ---------------------------------------------------------- programmes

  app.get("/api/programmes", async (req: Request, res: Response) => {
    const person = requirePerson(req);
    if (!maySeeCatalogue(person)) throw forbidden();
    const programmes = await state.pool.query<{ id: string }>("SELECT id FROM programmes ORDER BY number");
    const out = [];
    for (const row of programmes.rows) {
      const data = await loadProgrammeData(state.pool, row.id);
      if (!data) continue;
      out.push(programmeSummaryOf(data, await seatedCount(state, row.id), Date.now()));
    }
    res.json({ programmes: out });
  });

  app.get("/api/programmes/:id", async (req: Request, res: Response) => {
    const person = requirePerson(req);
    if (!maySeeCatalogue(person)) throw forbidden();
    const data = await loadProgrammeData(state.pool, pathParam(req, "id"));
    if (!data) throw notFound();
    res.json({
      ...programmeSummaryOf(data, await seatedCount(state, data.programme.id), Date.now()),
      works: data.works.map(workSummaryOf),
    });
  });

  app.post("/api/programmes", async (req: Request, res: Response) => {
    const person = requirePerson(req);
    if (person.role !== "principal_librarian") {
      if (maySeeCatalogue(person)) throw forbidden();
      throw notFound();
    }
    const raw = await readBody(req, JSON_LIMIT);
    const body = requireJson(req, raw);
    const errors: Record<string, string> = {};
    const title = singleLine(body.title, "Title");
    if (title.error) errors.title = title.error;
    const firstRehearsal = parseInstant(body.first_rehearsal);
    if (firstRehearsal === null) {
      errors.first_rehearsal = "Enter a date and time like 2026-12-01 10:00.";
    }
    const performanceInstants: number[] = [];
    if (!Array.isArray(body.performances) || body.performances.length < 1 || body.performances.length > 10) {
      errors.performances = "Enter between 1 and 10 performances.";
    } else {
      const instants = body.performances.map((value) => parseInstant(value));
      if (instants.some((value) => value === null)) {
        errors.performances = "Enter a date and time like 2026-12-01 10:00.";
      } else {
        const values = instants as number[];
        if (new Set(values).size !== values.length) {
          errors.performances = "Two performances can't be at the same time.";
        } else if (firstRehearsal !== null && values.some((at) => at <= firstRehearsal)) {
          errors.performances = "Each performance must be after the first rehearsal.";
        } else {
          performanceInstants.push(...values);
        }
      }
    }
    const count = parseStringCount(body.string_count, errors, "string_count.");
    if (Object.keys(errors).length > 0) throw validation(errors);

    const client = await state.pool.connect();
    try {
      await client.query("BEGIN");
      const highest = await client.query<{ n: number }>("SELECT coalesce(max(number),0)::int AS n FROM programmes");
      const number = highest.rows[0].n + 1;
      const id = `p${String(number).padStart(2, "0")}-${randomBytes(4).toString("hex")}`;
      await client.query(
        "INSERT INTO programmes (id,number,title,status,first_rehearsal,violin_1,violin_2,viola,cello,bass) VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,$8,$9)",
        [id, number, title.value, new Date(firstRehearsal as number), count.violin_1, count.violin_2, count.viola, count.cello, count.bass]
      );
      for (const at of performanceInstants) {
        await client.query("INSERT INTO performances (programme_id,at) VALUES ($1,$2)", [id, new Date(at)]);
      }
      await client.query("COMMIT");
      const data = await loadProgrammeData(state.pool, id);
      if (!data) throw notFound();
      res.status(201).json({ ...programmeSummaryOf(data, 0, Date.now()), works: [] });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  });

  app.put("/api/programmes/:id/string-count", async (req: Request, res: Response) => {
    const person = requirePerson(req);
    const data = await loadProgrammeData(state.pool, pathParam(req, "id"));
    if (!data) throw notFound();
    if (person.role !== "principal_librarian") {
      if (maySeeCatalogue(person)) throw forbidden();
      throw notFound();
    }
    if (data.programme.status === "closed") {
      throw conflict("programme_closed", "This programme is closed. Its counts and cuts can't change.");
    }
    const raw = await readBody(req, JSON_LIMIT);
    const body = requireJson(req, raw);
    const errors: Record<string, string> = {};
    const count = parseStringCount(body, errors, "");
    if (Object.keys(errors).length > 0) throw validation(errors);
    await state.pool.query(
      "UPDATE programmes SET violin_1=$2, violin_2=$3, viola=$4, cello=$5, bass=$6 WHERE id=$1",
      [data.programme.id, count.violin_1, count.violin_2, count.viola, count.cello, count.bass]
    );
    await seatNewPlayers(state, data.programme.id);
    const fresh = await loadProgrammeData(state.pool, data.programme.id);
    if (!fresh) throw notFound();
    res.json({
      ...programmeSummaryOf(fresh, await seatedCount(state, fresh.programme.id), Date.now()),
      works: fresh.works.map(workSummaryOf),
    });
  });

  app.post("/api/programmes/:id/works", async (req: Request, res: Response) => {
    const person = requirePerson(req);
    const data = await loadProgrammeData(state.pool, pathParam(req, "id"));
    if (!data) throw notFound();
    if (person.role !== "principal_librarian") {
      if (maySeeCatalogue(person)) throw forbidden();
      throw notFound();
    }
    if (data.programme.status !== "draft" && data.programme.status !== "in_preparation") {
      throw conflict("wrong_status", "Works can only be added to a draft or in-preparation programme.");
    }
    const raw = await readBody(req, JSON_LIMIT);
    const body = requireJson(req, raw);
    if (typeof body.catalogue_work_id !== "string") {
      throw validation({ catalogue_work_id: "Choose a work." });
    }
    const catalogue = await state.pool.query<{ id: string; title: string; composer: string; bars: number }>(
      "SELECT * FROM catalogue_works WHERE id=$1", [body.catalogue_work_id]
    );
    if (catalogue.rows.length === 0) throw notFound();
    if (data.works.some((w) => w.row.catalogue_work_id === catalogue.rows[0].id)) {
      throw conflict("work_already_in_programme", `${catalogue.rows[0].title} is already in this programme.`);
    }
    const workId = `${data.programme.id}-${catalogue.rows[0].id.replace("cw-", "")}`;
    const client = await state.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO works (id,programme_id,catalogue_work_id,position,bars) VALUES ($1,$2,$3,$4,$5)",
        [workId, data.programme.id, catalogue.rows[0].id, data.works.length, catalogue.rows[0].bars]
      );
      const barMap = await client.query<{ from_bar: number; to_bar: number; bar_ms: number }>(
        "SELECT from_bar,to_bar,bar_ms FROM catalogue_bar_map WHERE catalogue_work_id=$1 ORDER BY from_bar",
        [catalogue.rows[0].id]
      );
      for (const span of barMap.rows) {
        await client.query("INSERT INTO bar_map (work_id,from_bar,to_bar,bar_ms) VALUES ($1,$2,$3,$4)", [
          workId, span.from_bar, span.to_bar, span.bar_ms,
        ]);
      }
      const letters = await client.query<{ letter: string; bar: number }>(
        "SELECT letter,bar FROM catalogue_letters WHERE catalogue_work_id=$1", [catalogue.rows[0].id]
      );
      for (const letter of letters.rows) {
        await client.query("INSERT INTO rehearsal_letters (work_id,letter,bar) VALUES ($1,$2,$3)", [
          workId, letter.letter, letter.bar,
        ]);
      }
      const parts = await client.query<{ name: string; chair_key: string; bars_from: number; bars_to: number }>(
        "SELECT name,chair_key,bars_from,bars_to FROM catalogue_parts WHERE catalogue_work_id=$1 ORDER BY chair_key",
        [catalogue.rows[0].id]
      );
      for (const part of parts.rows) {
        await client.query(
          "INSERT INTO parts (id,work_id,name,chair_key,bars_from,bars_to,copies_on_hand) VALUES ($1,$2,$3,$4,$5,$6,0)",
          [`${workId}-${part.chair_key}`, workId, part.name, part.chair_key, part.bars_from, part.bars_to]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    res.status(201).json(await loadWorkDetail(state, workId));
  });

  app.post("/api/programmes/:id/transition", async (req: Request, res: Response) => {
    const person = requirePerson(req);
    const data = await loadProgrammeData(state.pool, pathParam(req, "id"));
    if (!data) throw notFound();
    if (person.role !== "principal_librarian") {
      if (maySeeCatalogue(person)) throw forbidden();
      throw notFound();
    }
    const raw = await readBody(req, JSON_LIMIT);
    const body = requireJson(req, raw);
    const to = body.to;
    if (to !== "draft" && to !== "in_preparation" && to !== "in_performance" && to !== "closed") {
      throw validation({ to: "Choose a status." });
    }
    const legal: Record<string, string[]> = {
      draft: ["in_preparation"],
      in_preparation: ["draft"],
      published: ["in_performance"],
      in_performance: ["closed"],
      closed: [],
    };
    if (!legal[data.programme.status].includes(to)) {
      throw conflict(
        "illegal_transition",
        `Programme ${String(data.programme.number).padStart(2, "0")} can't move from ${statusText(data.programme.status)} to ${statusText(to)}.`
      );
    }
    await state.pool.query("UPDATE programmes SET status=$2 WHERE id=$1", [data.programme.id, to]);
    const fresh = await loadProgrammeData(state.pool, data.programme.id);
    if (!fresh) throw notFound();
    res.json({
      ...programmeSummaryOf(fresh, await seatedCount(state, fresh.programme.id), Date.now()),
      works: fresh.works.map(workSummaryOf),
    });
  });

  app.post("/api/programmes/:id/publish", async (req: Request, res: Response) => {
    const person = requirePerson(req);
    const data = await loadProgrammeData(state.pool, pathParam(req, "id"));
    if (!data) throw notFound();
    if (person.role !== "principal_librarian") {
      if (maySeeCatalogue(person)) throw forbidden();
      throw notFound();
    }
    const key = idempotencyKey(req);
    if (key === null) {
      throw validation({ idempotency_key: "The idempotency key must be 1 to 80 visible characters." });
    }
    const result = await idempotent(
      state,
      `publish:${data.programme.id}`,
      key,
      hashOf(data.programme.id),
      async () => {
        const fresh = await loadProgrammeData(state.pool, data.programme.id);
        if (!fresh) throw notFound();
        const blockers = programmeBlockers(fresh, Date.now());
        const first = blockers[0];
        if (first) {
          throw conflict(first.error, first.message, first.error === "copies_short" ? { shortfall: freshShortfall(fresh) } : undefined);
        }
        const seated = await seatedPlayers(state.pool, fresh.programme, fresh.works);
        let sent = 0;
        let queued = 0;
        for (const player of seated) {
          const existing = await state.pool.query<{ player_id: string }>(
            "SELECT player_id FROM notices WHERE programme_id=$1 AND player_id=$2",
            [fresh.programme.id, player.id]
          );
          if (existing.rows.length > 0) continue;
          await state.pool.query(
            "INSERT INTO notices (programme_id,player_id,status) VALUES ($1,$2,'queued')",
            [fresh.programme.id, player.id]
          );
          const accepted = await sendFolderNotice(state, fresh.programme, player);
          if (accepted) sent += 1;
          else queued += 1;
        }
        await state.pool.query("UPDATE programmes SET status='published' WHERE id=$1", [fresh.programme.id]);
        const after = await loadProgrammeData(state.pool, data.programme.id);
        if (!after) throw notFound();
        return {
          status: 200,
          body: {
            programme: {
              ...programmeSummaryOf(after, await seatedCount(state, data.programme.id), Date.now()),
              works: after.works.map(workSummaryOf),
            },
            notices: { sent, queued },
          },
        };
      }
    );
    res.status(result.status).json(result.body);
  });

  app.get("/api/programmes/:id/notices", async (req: Request, res: Response) => {
    const person = requirePerson(req);
    if (!isLibrarian(person)) {
      if (maySeeCatalogue(person)) throw forbidden();
      throw notFound();
    }
    const data = await loadProgrammeData(state.pool, pathParam(req, "id"));
    if (!data) throw notFound();
    res.json({ notices: await noticesOf(state.pool, data.programme.id) });
  });

  // ---------------------------------------------------------------- works

  app.get("/api/works/:id", async (req: Request, res: Response) => {
    const person = requirePerson(req);
    if (!maySeeCatalogue(person)) throw forbidden();
    const work = await state.pool.query<{ id: string }>("SELECT id FROM works WHERE id=$1", [pathParam(req, "id")]);
    if (work.rows.length === 0) throw notFound();
    res.json(await loadWorkDetail(state, pathParam(req, "id")));
  });

  app.post("/api/works/:id/cuts", async (req: Request, res: Response) => {
    const person = requirePerson(req);
    const work = await state.pool.query<{ id: string; programme_id: string; bars: number }>(
      "SELECT id,programme_id,bars FROM works WHERE id=$1", [pathParam(req, "id")]
    );
    if (work.rows.length === 0) throw notFound();
    if (person.role !== "principal_librarian") {
      if (maySeeCatalogue(person)) throw forbidden();
      throw notFound();
    }
    const programme = await state.pool.query<ProgrammeRow>("SELECT * FROM programmes WHERE id=$1", [
      work.rows[0].programme_id,
    ]);
    if (programme.rows[0].status === "closed") {
      throw conflict("programme_closed", "This programme is closed. Its counts and cuts can't change.");
    }
    const raw = await readBody(req, JSON_LIMIT);
    const body = requireJson(req, raw);
    const errors: Record<string, string> = {};
    const fromBar = isWholeNumber(body.from_bar) ? body.from_bar : 0;
    const toBar = isWholeNumber(body.to_bar) ? body.to_bar : 0;
    if (!isWholeNumber(body.from_bar)) errors.from_bar = "Enter a whole number from 1 to the work's bars.";
    if (!isWholeNumber(body.to_bar)) errors.to_bar = "Enter a whole number from 1 to the work's bars.";
    if (Object.keys(errors).length > 0) throw validation(errors);
    if (fromBar > toBar || fromBar < 1 || toBar > work.rows[0].bars) {
      throw validation({
        ...(fromBar > toBar ? { from_bar: "Enter a whole number from 1 to the work's bars." } : {}),
        ...((fromBar < 1 || toBar > work.rows[0].bars) ? { to_bar: "Enter a whole number from 1 to the work's bars." } : {}),
      });
    }
    const cutId = `cut-${randomBytes(8).toString("hex")}`;
    const client = await state.pool.connect();
    try {
      await client.query("BEGIN");
      const overlap = await client.query(
        "SELECT 1 FROM cuts WHERE work_id=$1 AND from_bar <= $3 AND to_bar >= $2",
        [pathParam(req, "id"), fromBar, toBar]
      );
      if (overlap.rows.length > 0) {
        throw conflict("cut_overlaps", `Bars ${fromBar}–${toBar} overlap an existing cut.`);
      }
      const count = await client.query<{ n: number }>(
        "SELECT coalesce(sum(to_bar - from_bar + 1),0)::int AS n FROM cuts WHERE work_id=$1",
        [pathParam(req, "id")]
      );
      if (work.rows[0].bars - count.rows[0].n <= toBar - fromBar + 1) {
        throw conflict("cut_removes_whole_work", "A cut can't remove every bar of a work.");
      }
      await client.query(
        "INSERT INTO cuts (id,work_id,from_bar,to_bar) VALUES ($1,$2,$3,$4)",
        [cutId, pathParam(req, "id"), fromBar, toBar]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    const detail = await loadWorkDetail(state, pathParam(req, "id"));
    const after = await loadProgrammeData(state.pool, work.rows[0].programme_id);
    const cut = detail.cuts.find((c) => c.from_bar === fromBar && c.to_bar === toBar);
    res.status(201).json({
      cut,
      work: detail,
      programme: after ? programmeSummaryOf(after, await seatedCount(state, after.programme.id), Date.now()) : null,
    });
  });

  app.delete("/api/cuts/:id", async (req: Request, res: Response) => {
    const person = requirePerson(req);
    if (person.role !== "principal_librarian") throw forbidden();
    const cut = await state.pool.query<{ id: string; work_id: string; from_bar: number; to_bar: number }>(
      "SELECT id,work_id,from_bar,to_bar FROM cuts WHERE id=$1", [pathParam(req, "id")]
    );
    if (cut.rows.length === 0) throw notFound();
    const work = await state.pool.query<{ id: string; programme_id: string }>(
      "SELECT id,programme_id FROM works WHERE id=$1", [cut.rows[0].work_id]
    );
    const programme = await state.pool.query<ProgrammeRow>("SELECT * FROM programmes WHERE id=$1", [
      work.rows[0].programme_id,
    ]);
    if (programme.rows[0].status === "closed") {
      throw conflict("programme_closed", "This programme is closed. Its counts and cuts can't change.");
    }
    const client = await state.pool.connect();
    try {
      await client.query("BEGIN");
      const deleted = await client.query("DELETE FROM cuts WHERE id=$1 RETURNING id", [pathParam(req, "id")]);
      if (deleted.rows.length === 0) throw conflict("cut_gone", "That cut was already restored.");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    const detail = await loadWorkDetail(state, cut.rows[0].work_id);
    const after = await loadProgrammeData(state.pool, work.rows[0].programme_id);
    res.json({
      work: detail,
      programme: after ? programmeSummaryOf(after, await seatedCount(state, after.programme.id), Date.now()) : null,
    });
  });

  // ---------------------------------------------------------------- parts

  app.put("/api/parts/:id/holdings", async (req: Request, res: Response) => {
    const person = requirePerson(req);
    const part = await state.pool.query<PartRow>("SELECT * FROM parts WHERE id=$1", [pathParam(req, "id")]);
    if (part.rows.length === 0) throw notFound();
    if (!isLibrarian(person)) {
      if (maySeeCatalogue(person)) throw forbidden();
      throw notFound();
    }
    const work = await state.pool.query<{ id: string; programme_id: string }>(
      "SELECT id,programme_id FROM works WHERE id=$1", [part.rows[0].work_id]
    );
    const programme = await state.pool.query<ProgrammeRow>("SELECT * FROM programmes WHERE id=$1", [
      work.rows[0].programme_id,
    ]);
    if (programme.rows[0].status === "closed") {
      throw conflict("programme_closed", "This programme is closed. Its counts and cuts can't change.");
    }
    const raw = await readBody(req, JSON_LIMIT);
    const body = requireJson(req, raw);
    if (!isWholeNumber(body.copies_on_hand) || body.copies_on_hand < 0 || body.copies_on_hand > 99) {
      throw validation({ copies_on_hand: "Copies on hand must be a whole number from 0 to 99." });
    }
    await state.pool.query("UPDATE parts SET copies_on_hand=$2 WHERE id=$1", [
      pathParam(req, "id"), body.copies_on_hand,
    ]);
    const detail = await loadWorkDetail(state, work.rows[0].id);
    const after = await loadProgrammeData(state.pool, work.rows[0].programme_id);
    const freshPart = detail.parts.find((p) => p.id === pathParam(req, "id"));
    res.json({
      part: freshPart,
      work: workSummaryFromDetail(detail),
      programme: after ? programmeSummaryOf(after, await seatedCount(state, after.programme.id), Date.now()) : null,
    });
  });

  app.post("/api/parts/:id/marks", async (req: Request, res: Response) => {
    const person = requirePerson(req);
    const part = await state.pool.query<PartRow>("SELECT * FROM parts WHERE id=$1", [pathParam(req, "id")]);
    if (part.rows.length === 0) throw notFound();
    if (!isLibrarian(person)) {
      if (!isSectionPrincipal(person) || person.chair_key !== part.rows[0].chair_key) {
        if (maySeeCatalogue(person)) throw forbidden();
        throw notFound();
      }
    }
    const work = await state.pool.query<{ id: string; programme_id: string }>(
      "SELECT id,programme_id FROM works WHERE id=$1", [part.rows[0].work_id]
    );
    const programme = await state.pool.query<ProgrammeRow>("SELECT * FROM programmes WHERE id=$1", [
      work.rows[0].programme_id,
    ]);
    if (programme.rows[0].status === "closed") {
      throw conflict("programme_closed", "This programme is closed. Its counts and cuts can't change.");
    }
    const raw = await readBody(req, JSON_LIMIT);
    const body = requireJson(req, raw);
    if (typeof body.cut_id !== "string") throw validation({ cut_id: "Choose a cut." });
    const cut = await state.pool.query<{ id: string; work_id: string; from_bar: number; to_bar: number }>(
      "SELECT id,work_id,from_bar,to_bar FROM cuts WHERE id=$1", [body.cut_id]
    );
    if (cut.rows.length === 0 || cut.rows[0].work_id !== work.rows[0].id) throw notFound();
    if (cut.rows[0].from_bar > part.rows[0].bars_to || cut.rows[0].to_bar < part.rows[0].bars_from) {
      throw validation({ cut_id: `The cut is outside ${part.rows[0].name}'s bars.` });
    }
    const client = await state.pool.connect();
    let stored = false;
    try {
      await client.query("BEGIN");
      const lock = await client.query(
        "SELECT 1 FROM parts WHERE id=$1 FOR UPDATE", [pathParam(req, "id")]
      );
      if (lock.rows.length === 0) throw notFound();
      const existing = await client.query<{ marked_by: string }>(
        "SELECT marked_by FROM marks WHERE part_id=$1 AND cut_id=$2", [pathParam(req, "id"), body.cut_id]
      );
      if (existing.rows.length === 0) {
        await client.query(
          "INSERT INTO marks (part_id,cut_id,marked_by,marked_at) VALUES ($1,$2,$3,now())",
          [pathParam(req, "id"), body.cut_id, person.id]
        );
        stored = true;
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    const detail = await loadWorkDetail(state, work.rows[0].id);
    const freshPart = detail.parts.find((p) => p.id === pathParam(req, "id"));
    res.status(stored ? 201 : 200).json({ part: freshPart });
  });

  // ---------------------------------------------------------------- scans

  app.post("/api/parts/:id/scans", async (req: Request, res: Response) => {
    const person = requirePerson(req);
    const part = await state.pool.query<PartRow>("SELECT * FROM parts WHERE id=$1", [pathParam(req, "id")]);
    if (part.rows.length === 0) throw notFound();
    const work = await state.pool.query<{ id: string; programme_id: string; title: string }>(
      `SELECT w.id, w.programme_id, c.title FROM works w
       JOIN catalogue_works c ON c.id=w.catalogue_work_id WHERE w.id=$1`,
      [part.rows[0].work_id]
    );
    const programme = await state.pool.query<ProgrammeRow>("SELECT * FROM programmes WHERE id=$1", [
      work.rows[0].programme_id,
    ]);
    const contentTypeHeader = req.header("Content-Type") ?? "";
    if (!contentTypeHeader.startsWith("multipart/form-data")) {
      throw new ApiError(415, "unsupported_media_type", "Send the scan as multipart/form-data.");
    }
    const raw = await readBody(req, MULTIPART_LIMIT);
    if (raw.length > MULTIPART_LIMIT) {
      throw new ApiError(413, "file_too_large", "The file is larger than 20,000,000 bytes.");
    }
    const parsed = parseMultipart(raw, contentTypeHeader);
    const kind = parsed.fields.kind;
    if (kind !== "marked_part" && kind !== "bowing_master") {
      throw validation({ kind: "Choose the scan kind." });
    }
    if (kind === "marked_part" && !isLibrarian(person)) {
      if (maySeeCatalogue(person)) throw forbidden();
      throw notFound();
    }
    if (kind === "bowing_master" &&
        (!isSectionPrincipal(person) || person.chair_key !== part.rows[0].chair_key)) {
      if (maySeeCatalogue(person)) throw forbidden();
      throw notFound();
    }
    if (programme.rows[0].status === "closed") {
      throw conflict("programme_closed", "This programme is closed. Its counts and cuts can't change.");
    }
    const file = parsed.file;
    if (!file) throw validation({ file: "Choose a file." });
    if (file.bytes.length === 0) throw validation({ file: "The file is empty." });
    if (file.bytes.length > FILE_LIMIT) {
      throw new ApiError(413, "file_too_large", "The file is larger than 20,000,000 bytes.");
    }
    const fileName = decodeFileName(file.fileName);
    if (
      fileName.length === 0 ||
      Buffer.byteLength(fileName, "utf8") > 255 ||
      fileName.includes("/") ||
      fileName.includes("\\") ||
      /[\u0000-\u001f\u007f]/.test(fileName)
    ) {
      throw validation({ file: "Choose a file name that is one line of text." });
    }
    const storedType = sniffType(file);
    if (!storedType) {
      throw new ApiError(415, "unsupported_file_type", "Only PDF, PNG or JPEG files can be filed.");
    }

    const key = idempotencyKey(req);
    const requestHash = hashOf(
      `${person.id}|${part.rows[0].id}|${kind}|${fileName}|${storedType}|${file.bytes.length}`
    );
    const scanId = `scan-${randomBytes(12).toString("hex")}`;
    const objectKey = `scans/${programme.rows[0].id}/${work.rows[0].id}/${part.rows[0].id}/${scanId}`;

    const run = async (): Promise<{ status: number; body: unknown }> => {
      const write = await putObject(state.store, objectKey, file.bytes, storedType);
      if (!write.ok) {
        throw new ApiError(503, "storage_unavailable", "The score store is offline.");
      }
      const inserted = await state.pool.query<ScanRow>(
        `INSERT INTO scans (id,part_id,kind,file_name,content_type,size_bytes,sha256,object_key,filed_at,uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now(),$9) RETURNING *`,
        [scanId, part.rows[0].id, kind, fileName, storedType, file.bytes.length, write.sha256, objectKey, person.id]
      );
      const scan = inserted.rows[0];
      return {
        status: 201,
        body: {
          scan: {
            id: scan.id,
            part_id: scan.part_id,
            kind: scan.kind,
            file_name: scan.file_name,
            content_type: scan.content_type,
            size_bytes: Number(scan.size_bytes),
            sha256: scan.sha256,
            object_key: scan.object_key,
            filed_at: formatTimestamp(scan.filed_at.getTime()),
            uploaded_by: { id: person.id, name: person.name },
          },
        },
      };
    };

    if (key !== null) {
      const result = await idempotent(state, `upload:${person.id}`, key, requestHash, run);
      res.status(result.status).json(result.body);
      return;
    }
    const result = await run();
    res.status(result.status).json(result.body);
  });

  app.get("/api/parts/:id/scans", async (req: Request, res: Response) => {
    const person = requirePerson(req);
    if (!maySeeCatalogue(person)) {
      const visible = await visiblePartIds(state, person);
      if (!visible.has(pathParam(req, "id"))) throw notFound();
    }
    const part = await state.pool.query<PartRow>("SELECT id FROM parts WHERE id=$1", [pathParam(req, "id")]);
    if (part.rows.length === 0) throw notFound();
    const rows = await state.pool.query<ScanRow & { uploaded_by_name: string }>(
      `SELECT s.*, p.name AS uploaded_by_name FROM scans s JOIN people p ON p.id=s.uploaded_by
       WHERE s.part_id=$1 ORDER BY s.filed_at DESC, s.id`,
      [pathParam(req, "id")]
    );
    res.json({
      scans: rows.rows.map((row) => ({
        id: row.id,
        part_id: row.part_id,
        kind: row.kind,
        file_name: row.file_name,
        content_type: row.content_type,
        size_bytes: Number(row.size_bytes),
        sha256: row.sha256,
        object_key: row.object_key,
        filed_at: formatTimestamp(row.filed_at.getTime()),
        uploaded_by: { id: row.uploaded_by, name: row.uploaded_by_name },
      })),
    });
  });

  app.get("/api/scans/:id/file", async (req: Request, res: Response) => {
    const person = requirePerson(req);
    const rows = await state.pool.query<ScanRow>("SELECT * FROM scans WHERE id=$1", [pathParam(req, "id")]);
    if (rows.rows.length === 0) throw notFound();
    const scan = rows.rows[0];
    if (!maySeeCatalogue(person)) {
      const visible = await visiblePartIds(state, person);
      if (!(scan.kind === "marked_part" && visible.has(scan.part_id))) throw notFound();
    }
    const object = await getObject(state.store, scan.object_key);
    if (!object.ok) {
      throw new ApiError(503, "storage_unavailable", "The score store is offline.");
    }
    res.setHeader("Content-Type", scan.content_type);
    res.setHeader("Content-Length", String(object.bytes.length));
    res.setHeader("Content-Disposition", contentDisposition(scan.file_name));
    res.end(object.bytes);
  });

  // -------------------------------------------------------------- folders

  app.get("/api/folders", async (req: Request, res: Response) => {
    const person = requirePerson(req);
    if (!isSectionPrincipal(person) && person.role !== "player") throw forbidden();
    const programmes = await state.pool.query<ProgrammeRow>("SELECT * FROM programmes ORDER BY number");
    const folders = [];
    for (const programme of programmes.rows) {
      const folder = await folderFor(state, person, programme.id);
      if (folder) folders.push(folder.summary);
    }
    res.json({ folders });
  });

  app.get("/api/folders/:programmeId", async (req: Request, res: Response) => {
    const person = requirePerson(req);
    if (!isSectionPrincipal(person) && person.role !== "player") throw forbidden();
    const folder = await folderFor(state, person, pathParam(req, "programmeId"));
    if (!folder) throw notFound();
    const storageUp = await probeWithTimeout(state.store);
    res.json({ ...folder.detail, scans_available: storageUp });
  });

  app.get("/api/folders/:programmeId/parts/:partId", async (req: Request, res: Response) => {
    const person = requirePerson(req);
    if (!isSectionPrincipal(person) && person.role !== "player") throw forbidden();
    const folder = await folderFor(state, person, pathParam(req, "programmeId"));
    if (!folder) throw notFound();
    const page = folder.detail.pages.find((p) => p.part_id === pathParam(req, "partId"));
    if (!page) throw notFound();
    res.json(page);
  });

  // ---------------------------------------------------------- rental sets

  app.get("/api/rental-sets", async (req: Request, res: Response) => {
    const person = requirePerson(req);
    if (!isLibrarian(person)) {
      if (maySeeCatalogue(person)) throw forbidden();
      throw notFound();
    }
    const rows = await state.pool.query<RentalSetRow>("SELECT * FROM rental_sets ORDER BY created_at");
    const sets = [];
    for (const row of rows.rows) {
      sets.push(await rentalSetOf(state.pool, row, Date.now()));
    }
    sets.sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0));
    res.json({ rental_sets: sets });
  });

  app.post("/api/rental-sets", async (req: Request, res: Response) => {
    const person = requirePerson(req);
    if (person.role !== "principal_librarian") {
      if (isLibrarian(person)) throw forbidden();
      throw notFound();
    }
    const raw = await readBody(req, JSON_LIMIT);
    const body = requireJson(req, raw);
    const errors: Record<string, string> = {};
    const publisher = singleLine(body.publisher, "Publisher");
    if (publisher.error) errors.publisher = publisher.error;
    if (typeof body.work_id !== "string") errors.work_id = "Choose a work.";
    const slipRaw = body.slip;
    if (!Array.isArray(slipRaw) || slipRaw.length === 0) {
      errors.slip = "The slip needs at least one line.";
    }
    if (Object.keys(errors).length > 0) throw validation(errors);

    const work = await state.pool.query<{ id: string; title: string; programme_id: string }>(
      `SELECT w.id, c.title, w.programme_id FROM works w
       JOIN catalogue_works c ON c.id=w.catalogue_work_id WHERE w.id=$1`,
      [body.work_id]
    );
    if (work.rows.length === 0) throw notFound();
    const open = await state.pool.query<{ id: string }>(
      "SELECT id FROM rental_sets WHERE work_id=$1 AND status <> 'checked_in'", [body.work_id]
    );
    if (open.rows.length > 0) {
      throw conflict("rental_set_open", `${work.rows[0].title} already has an open rental set.`);
    }
    const slipLines: { partId: string; copies: number }[] = [];
    const seen = new Set<string>();
    for (const line of slipRaw as unknown[]) {
      if (line === null || typeof line !== "object") {
        throw validation({ counts: "Returned copies must be from 0 to the slip count." });
      }
      const entry = line as Record<string, unknown>;
      if (typeof entry.part_id !== "string" || !isWholeNumber(entry.copies)) {
        throw validation({ counts: "Returned copies must be from 0 to the slip count." });
      }
      const part = await state.pool.query<PartRow>("SELECT id,work_id FROM parts WHERE id=$1", [entry.part_id]);
      if (part.rows.length === 0 || part.rows[0].work_id !== body.work_id) throw notFound();
      if (seen.has(entry.part_id)) {
        throw validation({ counts: "Returned copies must be from 0 to the slip count." });
      }
      if (entry.copies < 1 || entry.copies > 99) {
        throw validation({ counts: "Returned copies must be from 0 to the slip count." });
      }
      seen.add(entry.part_id);
      slipLines.push({ partId: entry.part_id, copies: entry.copies });
    }
    const id = `rs-${randomBytes(6).toString("hex")}`;
    const client = await state.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO rental_sets (id,work_id,publisher,status) VALUES ($1,$2,$3,'requested')",
        [id, body.work_id, publisher.value]
      );
      for (const [position, line] of slipLines.entries()) {
        await client.query(
          "INSERT INTO rental_slip (rental_set_id,part_id,position,copies,checked_in) VALUES ($1,$2,$3,$4,0)",
          [id, line.partId, position, line.copies]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    await runReminderSweep(state);
    const row = await state.pool.query<RentalSetRow>("SELECT * FROM rental_sets WHERE id=$1", [id]);
    res.status(201).json(await rentalSetOf(state.pool, row.rows[0], Date.now()));
  });

  app.post("/api/rental-sets/:id/transition", async (req: Request, res: Response) => {
    const person = requirePerson(req);
    const set = await state.pool.query<RentalSetRow>("SELECT * FROM rental_sets WHERE id=$1", [pathParam(req, "id")]);
    if (set.rows.length === 0) throw notFound();
    if (!isLibrarian(person)) {
      if (maySeeCatalogue(person)) throw forbidden();
      throw notFound();
    }
    const raw = await readBody(req, JSON_LIMIT);
    const body = requireJson(req, raw);
    const to = body.to;
    if (to !== "received" && to !== "in_use" && to !== "returned" && to !== "checked_in") {
      throw validation({ to: "Choose a status." });
    }
    const work = await state.pool.query<{ title: string }>(
      `SELECT c.title FROM works w JOIN catalogue_works c ON c.id=w.catalogue_work_id WHERE w.id=$1`,
      [set.rows[0].work_id]
    );
    const legal: Record<RentalStatus, { to: string; roles: string[] }[]> = {
      requested: [{ to: "received", roles: ["principal_librarian"] }],
      received: [{ to: "in_use", roles: ["principal_librarian"] }],
      in_use: [{ to: "returned", roles: ["principal_librarian", "assistant_librarian"] }],
      returned: [{ to: "checked_in", roles: ["principal_librarian"] }],
      checked_in: [],
    };
    const edge = legal[set.rows[0].status].find((e) => e.to === to);
    if (edge && !edge.roles.includes(person.role)) throw forbidden();
    if (!edge) {
      throw conflict(
        "illegal_transition",
        `${work.rows[0].title} set can't move from ${rentalText(set.rows[0].status)} to ${rentalText(to)}.`
      );
    }
    const client = await state.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<{ status: RentalStatus }>(
        "SELECT status FROM rental_sets WHERE id=$1 FOR UPDATE", [pathParam(req, "id")]
      );
      if (current.rows[0].status !== set.rows[0].status) {
        throw conflict(
          "illegal_transition",
          `${work.rows[0].title} set can't move from ${rentalText(set.rows[0].status)} to ${rentalText(to)}.`
        );
      }
      if (to === "returned") {
        const missing = await client.query<{ part_name: string; copies: number; checked_in: number }>(
          `SELECT p.name AS part_name, s.copies, s.checked_in FROM rental_slip s
           JOIN parts p ON p.id=s.part_id WHERE s.rental_set_id=$1 ORDER BY s.position`,
          [pathParam(req, "id")]
        );
        const short = missing.rows.filter((line) => line.checked_in < line.copies);
        if (short.length > 0) {
          const total = short.reduce((n, line) => n + (line.copies - line.checked_in), 0);
          throw conflict(
            "copies_missing",
            `Can't mark returned: ${total} ${plural(total, "copy is", "copies are")} missing (${short
              .map((line) => `${line.part_name} ${line.copies - line.checked_in}`)
              .join(", ")}).`,
            { missing: short.map((line) => ({ part_id: line.part_name, part_name: line.part_name, missing: line.copies - line.checked_in })) }
          );
        }
        await client.query(
          "UPDATE rental_sets SET status='returned', returned_at=now() WHERE id=$1", [pathParam(req, "id")]
        );
      } else {
        await client.query("UPDATE rental_sets SET status=$2 WHERE id=$1", [pathParam(req, "id"), to]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    const fresh = await state.pool.query<RentalSetRow>("SELECT * FROM rental_sets WHERE id=$1", [pathParam(req, "id")]);
    res.json(await rentalSetOf(state.pool, fresh.rows[0], Date.now()));
  });

  app.put("/api/rental-sets/:id/check-in", async (req: Request, res: Response) => {
    const person = requirePerson(req);
    const set = await state.pool.query<RentalSetRow>("SELECT * FROM rental_sets WHERE id=$1", [pathParam(req, "id")]);
    if (set.rows.length === 0) throw notFound();
    if (!isLibrarian(person)) {
      if (maySeeCatalogue(person)) throw forbidden();
      throw notFound();
    }
    const work = await state.pool.query<{ title: string }>(
      `SELECT c.title FROM works w JOIN catalogue_works c ON c.id=w.catalogue_work_id WHERE w.id=$1`,
      [set.rows[0].work_id]
    );
    const raw = await readBody(req, JSON_LIMIT);
    const body = requireJson(req, raw);
    if (!Array.isArray(body.counts)) {
      throw validation({ counts: "Returned copies must be from 0 to the slip count." });
    }
    const client = await state.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<RentalSetRow>(
        "SELECT * FROM rental_sets WHERE id=$1 FOR UPDATE", [pathParam(req, "id")]
      );
      if (locked.rows[0].status !== "in_use") {
        throw conflict(
          "wrong_status",
          `Counts can't change: ${work.rows[0].title} set is already ${rentalText(locked.rows[0].status)}.`
        );
      }
      interface Named { partId: string; copies: number; expected: number }
      const named: Named[] = [];
      for (const line of body.counts) {
        if (line === null || typeof line !== "object") {
          throw validation({ counts: "Returned copies must be from 0 to the slip count." });
        }
        const entry = line as Record<string, unknown>;
        if (typeof entry.part_id !== "string" || !isWholeNumber(entry.copies) || !isWholeNumber(entry.expected)) {
          throw validation({ counts: "Returned copies must be from 0 to the slip count." });
        }
        const slipLine = await client.query<{ part_id: string }>(
          "SELECT part_id FROM rental_slip WHERE rental_set_id=$1 AND part_id=$2",
          [pathParam(req, "id"), entry.part_id]
        );
        if (slipLine.rows.length === 0) throw notFound();
        named.push({ partId: entry.part_id, copies: entry.copies, expected: entry.expected });
      }
      const stale: { part_id: string; part_name: string; checked_in: number; position: number }[] = [];
      for (const line of named) {
        const stored = await client.query<{ checked_in: number; position: number; name: string }>(
          `SELECT s.checked_in, s.position, p.name FROM rental_slip s
           JOIN parts p ON p.id=s.part_id WHERE s.rental_set_id=$1 AND s.part_id=$2`,
          [pathParam(req, "id"), line.partId]
        );
        if (stored.rows[0].checked_in !== line.expected) {
          stale.push({
            part_id: line.partId,
            part_name: stored.rows[0].name,
            checked_in: stored.rows[0].checked_in,
            position: stored.rows[0].position,
          });
        }
      }
      if (stale.length > 0) {
        stale.sort((a, b) => a.position - b.position);
        throw conflict("count_changed", "Counts changed while you were typing.", {
          lines: stale.map((line) => ({
            part_id: line.part_id,
            part_name: line.part_name,
            checked_in: line.checked_in,
          })),
        });
      }
      for (const line of named) {
        const slip = await client.query<{ copies: number }>(
          "SELECT copies FROM rental_slip WHERE rental_set_id=$1 AND part_id=$2",
          [pathParam(req, "id"), line.partId]
        );
        if (line.copies < 0 || line.copies > slip.rows[0].copies) {
          throw validation({ counts: "Returned copies must be from 0 to the slip count." });
        }
      }
      for (const line of named) {
        await client.query(
          "UPDATE rental_slip SET checked_in=$3 WHERE rental_set_id=$1 AND part_id=$2",
          [pathParam(req, "id"), line.partId, line.copies]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    const fresh = await state.pool.query<RentalSetRow>("SELECT * FROM rental_sets WHERE id=$1", [pathParam(req, "id")]);
    res.json(await rentalSetOf(state.pool, fresh.rows[0], Date.now()));
  });

  // ------------------------------------------------------------- fallback

  app.all(/^\/api(\/.*)?$/, () => {
    throw notFound();
  });

  // ------------------------------------------------------------- static

  const distDir = path.join(__dirname, "..", "..", "public");
  const blocked = (p: string): boolean =>
    p.startsWith("node_modules/") ||
    p === "run.json" || p === "esbuild.mjs" || p === "tsconfig.json" ||
    p === "package.json" || p === "package-lock.json" ||
    p.startsWith("src/") || p.endsWith(".ts") || p.endsWith(".map") ||
    p === ".env" || p.startsWith(".env/") ||
    p === "THIRD_PARTY_NOTICES.md" || p === "npm-shrinkwrap.json";

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const clean = req.path.replace(/^\/+/, "").split("?")[0];
    if (clean && blocked(clean)) {
      res.status(404).json({ error: "not_found", message: "Not found." });
      return;
    }
    const target = path.join(distDir, clean);
    if (clean && existsSync(target) && path.resolve(target).startsWith(distDir)) {
      res.sendFile(target);
      return;
    }
    res.sendFile(path.join(distDir, "index.html"));
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ApiError) {
      res.status(error.status).json(error.body);
      return;
    }
    res.status(500).json({ error: "internal", message: "Something went wrong." });
  });

  return app;
}

// --------------------------------------------------------- support functions

/** A single path parameter, which express 5 types as string | string[]. */
function pathParam(req: Request, name: string): string {
  const value = req.params[name];
  return typeof value === "string" ? value : "";
}

function originOf(req: Request): string {
  const host = req.header("Host") ?? "";
  const proto = req.header("X-Forwarded-Proto") ?? "http";
  return `${proto}://${host}`;
}

async function personForSession(state: AppState, req: Request): Promise<PersonRow | null> {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (!token || typeof token !== "string") return null;
  const rows = await state.pool.query<PersonRow>(
    `SELECT p.* FROM sessions s JOIN people p ON p.id=s.person_id
     WHERE s.token=$1 AND s.last_seen > now() - interval '12 hours'`,
    [token]
  );
  if (rows.rows.length === 0) return null;
  await state.pool.query("UPDATE sessions SET last_seen=now() WHERE token=$1", [token]);
  return rows.rows[0];
}

async function probeMail(mail: MailService): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 2000);
    mail.probe().then((up) => {
      clearTimeout(timer);
      resolve(up);
    });
  });
}

async function loadWorkDetail(state: AppState, workId: string) {
  const work = await state.pool.query<{ programme_id: string }>(
    "SELECT programme_id FROM works WHERE id=$1", [workId]
  );
  if (work.rows.length === 0) throw notFound();
  const data = await loadProgrammeData(state.pool, work.rows[0].programme_id);
  if (!data) throw notFound();
  const derived = data.works.find((w) => w.row.id === workId);
  if (!derived) throw notFound();
  const names = await uploaderNames(state.pool);
  return workDetailOf(derived, data.marksByPart, data.latestScans, names);
}

function workSummaryFromDetail(detail: {
  id: string; programme_id: string; catalogue_work_id: string; title: string; composer: string;
  bars: number; running_time_seconds: number; running_time: string; copies: unknown; parts_to_mark: number;
}): { id: string; programme_id: string; catalogue_work_id: string; title: string; composer: string; bars: number; running_time_seconds: number; running_time: string; copies: unknown; parts_to_mark: number } {
  return detail;
}

function programmeBlockers(data: NonNullable<Awaited<ReturnType<typeof loadProgrammeData>>>, now: number) {
  return programmeSummaryOf(data, 0, now).publish_blockers;
}

async function seatedCount(state: AppState, programmeId: string): Promise<number> {
  const data = await loadProgrammeData(state.pool, programmeId);
  if (!data) return 0;
  return (await seatedPlayers(state.pool, data.programme, data.works)).length;
}

function freshShortfall(data: NonNullable<Awaited<ReturnType<typeof loadProgrammeData>>>): number {
  return data.works.reduce((n, w) => n + w.copies.shortfall, 0);
}

async function idempotent(
  state: AppState,
  scope: string,
  key: string,
  requestHash: string,
  run: () => Promise<{ status: number; body: unknown }>
): Promise<{ status: number; body: unknown }> {
  const client = await state.pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query<{ status: number; body: string; request_hash: string }>(
      "SELECT status, body, request_hash FROM idempotency WHERE scope=$1 AND key=$2 FOR UPDATE",
      [scope, key]
    );
    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      await client.query("COMMIT");
      if (row.request_hash !== requestHash) {
        throw conflict("idempotency_key_reused", "That idempotency key was used for a different request.");
      }
      return { status: row.status, body: JSON.parse(row.body) as unknown };
    }
    await client.query(
      "INSERT INTO idempotency (scope,key,request_hash,status,body) VALUES ($1,$2,$3,0,'')",
      [scope, key, requestHash]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    throw error;
  }
  client.release();

  const result = await run();
  if (result.status < 400) {
    await state.pool.query(
      "UPDATE idempotency SET status=$3, body=$4 WHERE scope=$1 AND key=$2",
      [scope, key, result.status, JSON.stringify(result.body)]
    );
  } else {
    await state.pool.query("DELETE FROM idempotency WHERE scope=$1 AND key=$2", [scope, key]);
  }
  return result;
}

async function seatNewPlayers(state: AppState, programmeId: string): Promise<void> {
  const data = await loadProgrammeData(state.pool, programmeId);
  if (!data) return;
  if (data.programme.status !== "published" && data.programme.status !== "in_performance") return;
  const seated = await seatedPlayers(state.pool, data.programme, data.works);
  for (const player of seated) {
    const existing = await state.pool.query<{ player_id: string }>(
      "SELECT player_id FROM notices WHERE programme_id=$1 AND player_id=$2", [programmeId, player.id]
    );
    if (existing.rows.length > 0) continue;
    await state.pool.query(
      "INSERT INTO notices (programme_id,player_id,status) VALUES ($1,$2,'queued')",
      [programmeId, player.id]
    );
    await sendFolderNotice(state, data.programme, player);
  }
}

async function sendFolderNotice(
  state: AppState,
  programme: ProgrammeRow,
  player: { id: string; name: string; email: string; chair_label: string; chair_key: string }
): Promise<boolean> {
  const data = await loadProgrammeData(state.pool, programme.id);
  if (!data) return false;
  const lines: string[] = [];
  for (const work of data.works) {
    for (const part of work.parts) {
      if (part.chair_key === player.chair_key) lines.push(`${work.row.title} — ${part.name}`);
    }
  }
  const body = [
    `${player.name}, your folder for Programme ${String(programme.number).padStart(2, "0")} · ${programme.title} is ready.`,
    `Chair: ${player.chair_label}`,
    `Parts:`,
    ...lines,
    `First rehearsal: ${formatDateTime(programme.first_rehearsal.getTime())} (London time)`,
  ].join("\r\n");
  const accepted = await state.mail.send({
    to: player.email,
    subject: `Your folder is ready: ${programme.title}`,
    body,
  });
  await state.pool.query(
    "UPDATE notices SET status=$3, sent_at=CASE WHEN $3='sent' THEN now() ELSE sent_at END WHERE programme_id=$1 AND player_id=$2",
    [programme.id, player.id, accepted ? "sent" : "queued"]
  );
  return accepted;
}

async function visiblePartIds(state: AppState, person: PersonRow): Promise<Set<string>> {
  const programmes = await state.pool.query<ProgrammeRow>("SELECT * FROM programmes");
  const ids = new Set<string>();
  for (const programme of programmes.rows) {
    if (programme.status !== "published" && programme.status !== "in_performance") continue;
    const data = await loadProgrammeData(state.pool, programme.id);
    if (!data) continue;
    const chairKeys = new Set<string>();
    for (const work of data.works) {
      for (const part of work.parts) chairKeys.add(part.chair_key);
    }
    if (!isSeated(person, programme, chairKeys)) continue;
    for (const work of data.works) {
      for (const part of work.parts) {
        if (part.chair_key === person.chair_key) ids.add(part.id);
      }
    }
  }
  return ids;
}

interface FolderResult {
  summary: {
    programme_id: string; number: string; title: string; status: string;
    first_rehearsal: string; chair_label: string; part_count: number;
  };
  detail: {
    programme: { id: string; number: string; title: string; status: string; first_rehearsal: string };
    chair: PersonRow["chair_label"] extends never ? never : { key: string; section: string | null; number: number | null; label: string };
    scans_available: boolean;
    pages: FolderPageData[];
  };
}

interface FolderPageData {
  part_id: string;
  work_id: string;
  work_title: string;
  composer: string;
  part_name: string;
  bars_from: number;
  bars_to: number;
  cuts: { from_bar: number; to_bar: number }[];
  rehearsal_letters: { letter: string; bar: number }[];
  marked_scan: { id: string; file_name: string; content_type: string; size_bytes: number } | null;
}

async function folderFor(
  state: AppState,
  person: PersonRow,
  programmeId: string
): Promise<FolderResult | null> {
  const data = await loadProgrammeData(state.pool, programmeId);
  if (!data) return null;
  if (data.programme.status !== "published" && data.programme.status !== "in_performance") return null;
  const chairKeys = new Set<string>();
  for (const work of data.works) {
    for (const part of work.parts) chairKeys.add(part.chair_key);
  }
  if (!isSeated(person, data.programme, chairKeys)) return null;
  const pages: FolderPageData[] = [];
  for (const work of data.works) {
    for (const part of work.parts) {
      if (part.chair_key !== person.chair_key) continue;
      const latest = data.latestScans.get(part.id);
      pages.push({
        part_id: part.id,
        work_id: work.row.id,
        work_title: work.row.title,
        composer: work.row.composer,
        part_name: part.name,
        bars_from: part.bars_from,
        bars_to: part.bars_to,
        cuts: work.cuts
          .filter((cut) => cut.from_bar <= part.bars_to && cut.to_bar >= part.bars_from)
          .map((cut) => ({ from_bar: cut.from_bar, to_bar: cut.to_bar })),
        rehearsal_letters: work.letters
          .filter((letter) => letter.bar >= part.bars_from && letter.bar <= part.bars_to && !letter.cut)
          .map((letter) => ({ letter: letter.letter, bar: letter.bar })),
        marked_scan:
          latest && latest.marked
            ? {
                id: latest.marked.id,
                file_name: latest.marked.file_name,
                content_type: latest.marked.content_type,
                size_bytes: Number(latest.marked.size_bytes),
              }
            : null,
      });
    }
  }
  const summary = {
    programme_id: data.programme.id,
    number: String(data.programme.number).padStart(2, "0"),
    title: data.programme.title,
    status: data.programme.status,
    first_rehearsal: formatTimestamp(data.programme.first_rehearsal.getTime()),
    chair_label: person.chair_label,
    part_count: pages.length,
  };
  return {
    summary,
    detail: {
      programme: {
        id: data.programme.id,
        number: String(data.programme.number).padStart(2, "0"),
        title: data.programme.title,
        status: data.programme.status,
        first_rehearsal: formatTimestamp(data.programme.first_rehearsal.getTime()),
      },
      chair: {
        key: person.chair_key,
        section: person.chair_section,
        number: person.chair_number,
        label: person.chair_label,
      },
      scans_available: true,
      pages,
    },
  };
}

/** Sends each due reminder, once, to every assistant librarian. */
export async function runReminderSweep(state: AppState): Promise<void> {
  const sets = await state.pool.query<RentalSetRow & { due: string }>(
    `SELECT r.*, (SELECT to_char(max(p.at) AT TIME ZONE 'UTC' + interval '14 days', 'YYYY-MM-DD') FROM performances p
      WHERE p.programme_id = (SELECT programme_id FROM works WHERE id=r.work_id)) AS due
     FROM rental_sets r WHERE r.status IN ('requested','received','in_use')`
  ).catch(async () => {
    const rows = await state.pool.query<RentalSetRow>(
      "SELECT * FROM rental_sets WHERE status IN ('requested','received','in_use')"
    );
    const out = [];
    for (const row of rows.rows) {
      const rental = await rentalSetOf(state.pool, row, Date.now());
      out.push({ ...row, due: rental.due_date });
    }
    return { rows: out };
  });
  const assistants = await state.pool.query<PersonRow>(
    "SELECT * FROM people WHERE role='assistant_librarian'"
  );
  const today = (await import("../shared/london.js")).londonDateString(Date.now());
  for (const set of sets.rows) {
    if (set.reminder_status === "sent") continue;
    const reminder = reminderDate(set.due);
    if (today < reminder) continue;
    await state.pool.query(
      "UPDATE rental_sets SET reminder_status='queued' WHERE id=$1", [set.id]
    );
    const accepted = await sendRemindersFor(state, set, assistants.rows);
    if (accepted) {
      await state.pool.query(
        "UPDATE rental_sets SET reminder_status='sent', reminder_sent_at=now() WHERE id=$1", [set.id]
      );
    }
  }
}

async function sendRemindersFor(
  state: AppState,
  set: RentalSetRow,
  assistants: PersonRow[]
): Promise<boolean> {
  const rental = await rentalSetOf(state.pool, set, Date.now());
  const programmeTitle = await programmeTitleOf(state, rental.programme_id);
  let allAccepted = true;
  for (const assistant of assistants) {
    const body = [
      `Publisher: ${rental.publisher}`,
      `Programme ${rental.programme_number} · ${programmeTitle}`,
      `Copies on slip: ${rental.copies_on_slip}`,
      `Copies checked in: ${rental.copies_checked_in}`,
      `Due: ${rental.due_date} at 23:59 (London time)`,
    ].join("\r\n");
    const accepted = await state.mail.send({
      to: assistant.email,
      subject: `Rental return due ${rental.due_date}: ${rental.work_title} · ${rental.publisher}`,
      body,
    });
    if (!accepted) allAccepted = false;
  }
  return allAccepted;
}

async function programmeTitleOf(state: AppState, programmeId: string): Promise<string> {
  const rows = await state.pool.query<{ title: string }>("SELECT title FROM programmes WHERE id=$1", [programmeId]);
  return rows.rows[0]?.title ?? "";
}
