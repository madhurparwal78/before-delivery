import type { IncomingMessage, ServerResponse } from "node:http";
import { env, sql } from "../common/env";
import {
  clearSessionCookie,
  currentUser,
  readJson,
  send,
  sendEmpty,
  setSessionCookie,
  type SessionUser,
} from "./http";
import { hashPassword, verifyPassword, token, id } from "./db/store";
import { makeMailer } from "./mail/mailer";
import { fieldErrors } from "../common/copy";
import { chartKindByLabel, symbolsOf } from "../common/symbols";
import { checkChart } from "./chart/check";
import { buildSheetPdf } from "./pdf/sheet";
import {
  columnsError,
  castOnError,
  emailValidationError,
  nameValidationError,
  passwordValidationError,
  patternNameError,
  rowsError,
} from "../common/validate";
import { LiveHub } from "./live/hub";
import { applySchema } from "./db/schema";
import { blankChart, computePattern, loadColours, loadPattern, type PatternRow } from "./services/patterns";
import { applyTextToRow } from "./chart/apply";
import type { StoredChart } from "./db/store";

const mailer = makeMailer();
const hub = new LiveHub();

export function liveHub(): LiveHub {
  return hub;
}

export type RouteMatch = RegExpMatchArray & { params: Record<string, string> };

type Handler = (
  req: IncomingMessage,
  res: ServerResponse,
  match: RouteMatch,
  user: SessionUser | null,
) => Promise<boolean>;

interface Route {
  method: string;
  pattern: RegExp;
  needsUser: boolean;
  handler: Handler;
}

export const routes: Route[] = [];

function route(method: string, path: string, needsUser: boolean, handler: Handler): void {
  // <id>, <rid>, <n> and <token> all become positional groups, read in order
  const names = [...path.matchAll(/<([a-zA-Z]+)>/g)].map((found) => found[1]!);
  const source = path.replace(/<[^>]+>/g, () => "([^/]+)");
  const pattern = new RegExp(`^${source}$`);
  routes.push({
    method,
    pattern,
    needsUser,
    handler: (req, res, match, user) => {
      const params: Record<string, string> = {};
      names.forEach((name, index) => {
        params[name] = match[index + 1] ?? "";
      });
      const withParams = match as unknown as { params?: Record<string, string> };
      withParams.params = params;
      return handler(req, res, match as RouteMatch, user);
    },
  });
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public payload: Record<string, unknown>,
  ) {
    super("api error");
  }
}

export function invalid(field: string, message: string): ApiError {
  return new ApiError(422, { error: "invalid", field, message });
}

export function conflict(code: string, message: string): ApiError {
  return new ApiError(409, { error: code, message });
}

export function notFound(): ApiError {
  return new ApiError(404, { error: "not_found" });
}

export function unauthenticated(): ApiError {
  return new ApiError(401, { error: "unauthenticated" });
}

export function parseNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

export function parseString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function requireUser(user: SessionUser | null): SessionUser {
  if (!user) throw unauthenticated();
  return user;
}


export { editRateCheck, replayCheck, storeOp, noteCountsByRow, serverRows, saveChart, cellKey };
export { route, send, readJson as readBody, patternAccess as designerAccess, send as sendRows };
export type { SessionUser };

interface PatternAccess {
  role: "owner" | "co-designer" | "tester";
  pattern: PatternRow;
}

async function patternAccess(user: SessionUser, patternId: string, roles: string[]): Promise<PatternAccess> {
  const pattern = await loadPattern(patternId);
  if (!pattern) throw notFound();
  let role: string | null = null;
  if (pattern.owner_id === user.id) role = "owner";
  if (!role) {
    const co = await sql<{ user_id: string }>(
      `SELECT user_id FROM co_designers WHERE pattern_id = $1 AND user_id = $2`,
      [patternId, user.id],
    );
    if (co.length > 0) role = "co-designer";
  }
  if (!role) {
    const tester = await sql<{ user_id: string }>(
      `SELECT user_id FROM testers WHERE pattern_id = $1 AND user_id = $2`,
      [patternId, user.id],
    );
    if (tester.length > 0) role = "tester";
  }
  if (!role || !roles.includes(role)) throw notFound();
  return { role: role as PatternAccess["role"], pattern };
}

async function editRateCheck(userId: string): Promise<void> {
  const minute = Math.floor(Date.now() / 60000);
  const rows = await sql<{ count: string }>(
    `SELECT count FROM edit_rate WHERE user_id = $1 AND minute = $2`,
    [userId, minute],
  );
  const count = rows.length > 0 ? Number(rows[0]!.count) : 0;
  if (count >= env.limits.editsPerMinute) {
    throw new ApiError(429, { error: "rate_limited", message: "Too many edits. Wait a moment." });
  }
  await sql(
    `INSERT INTO edit_rate (user_id, minute, count) VALUES ($1, $2, 1)
     ON CONFLICT (user_id, minute) DO UPDATE SET count = edit_rate.count + 1`,
    [userId, minute],
  );
}

/** Health answers 200 in every instance, including with Valkey unreachable. */
route("GET", "/api/health", false, async (_req, res) => {
  send(res, 200, { status: "ok" });
  return true;
});

route("GET", "/api/config", false, async (_req, res) => {
  send(res, 200, {
    today: env.today,
    timeZone: env.tz,
    limits: env.limits,
  });
  return true;
});

route("POST", "/api/signup", false, async (req, res) => {
  const bodyResult = await readJson(req, res);
  if (!bodyResult.ok) return true;
  const body = bodyResult.body as Record<string, unknown>;
  if (body === undefined) return false;
  const name = parseString(body.name).trim();
  const email = parseString(body.email).trim().toLowerCase();
  const password = parseString(body.password);
  const nameError = nameValidationError(name);
  if (nameError) throw invalid(nameError.field, nameError.message);
  if (emailValidationError(email)) throw invalid("email", fieldErrors.emailInvalid);
  const passwordError = passwordValidationError(password);
  if (passwordError) throw invalid(passwordError.field, passwordError.message);
  const existing = await sql<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email]);
  if (existing.length > 0) throw conflict("email_taken", fieldErrors.emailTaken);
  const verifyToken = token();
  const userId = id("user");
  await sql(
    `INSERT INTO users (id, name, email, password_hash, verified, verify_token, verify_expires)
     VALUES ($1, $2, $3, $4, FALSE, $5, $6)`,
    [userId, name, email, hashPassword(password), verifyToken, hoursFrom(env.limits.verifyTtlHours)],
  );
  try {
    await mailer.send(email, "Verify your Twinrow email", `${env.publicUrl}/verify?token=${verifyToken}`);
  } catch {
    await sql(`DELETE FROM users WHERE id = $1`, [userId]);
    throw new ApiError(503, { error: "mail_unavailable", message: "The mail could not be sent. Try again." });
  }
  send(res, 201, { id: userId });
  return true;
});

route("POST", "/api/verify", false, async (req, res) => {
  const bodyResult = await readJson(req, res);
  if (!bodyResult.ok) return true;
  const body = bodyResult.body as Record<string, unknown>;
  if (body === undefined) return false;
  const verifyToken = parseString(body.token);
  const rows = await sql<{ id: string; verify_expires: Date }>(
    `SELECT id, verify_expires FROM users WHERE verify_token = $1 AND verified = FALSE`,
    [verifyToken],
  );
  const row = rows[0];
  if (!row) throw notFound();
  if (new Date(row.verify_expires).getTime() < Date.now()) throw conflict("link_expired", "This link has expired. Sign up again to get a new one.");
  await sql(`UPDATE users SET verified = TRUE, verify_token = NULL WHERE id = $1`, [row.id]);
  send(res, 200, { verified: true });
  return true;
});

route("POST", "/api/session", false, async (req, res) => {
  const bodyResult = await readJson(req, res);
  if (!bodyResult.ok) return true;
  const body = bodyResult.body as Record<string, unknown>;
  if (body === undefined) return false;
  const email = parseString(body.email).trim().toLowerCase();
  const password = parseString(body.password);
  const rows = await sql<{ id: string; name: string; email: string; password_hash: string; verified: boolean }>(
    `SELECT id, name, email, password_hash, verified FROM users WHERE email = $1`,
    [email],
  );
  const row = rows[0];
  if (!row || !verifyPassword(password, row.password_hash)) {
    throw new ApiError(401, { error: "invalid_credentials", message: fieldErrors.signInBad });
  }
  if (!row.verified) throw new ApiError(401, { error: "unverified", message: fieldErrors.unverified });
  const sessionToken = token(32);
  await sql(`INSERT INTO sessions (token, user_id) VALUES ($1, $2)`, [sessionToken, row.id]);
  setSessionCookie(res, sessionToken);
  send(res, 200, { id: row.id, name: row.name, email: row.email });
  return true;
});

route("DELETE", "/api/session", false, async (req, res) => {
  const cookies = String(req.headers.cookie ?? "");
  const match = /twinrow_session=([^;]+)/.exec(cookies);
  if (match) {
    await sql(`DELETE FROM sessions WHERE token = $1`, [decodeURIComponent(match[1]!)]);
  }
  clearSessionCookie(res);
  sendEmpty(res, 204);
  return true;
});

route("GET", "/api/me", true, async (_req, res, _match, userRaw) => {
  const user = requireUser(userRaw);
  send(res, 200, { id: user.id, name: user.name, email: user.email, reduceMotion: user.reduceMotion });
  return true;
});

route("PATCH", "/api/me", true, async (req, res, _match, userRaw) => {
  const user = requireUser(userRaw);
  const bodyResult = await readJson(req, res);
  if (!bodyResult.ok) return true;
  const body = bodyResult.body as Record<string, unknown>;
  if (body === undefined) return false;
  if (body.name !== undefined) {
    const nameError = nameValidationError(parseString(body.name));
    if (nameError) throw invalid(nameError.field, nameError.message);
    await sql(`UPDATE users SET name = $1 WHERE id = $2`, [parseString(body.name), user.id]);
  }
  if (body.reduceMotion !== undefined && typeof body.reduceMotion === "boolean") {
    await sql(`UPDATE users SET reduce_motion = $1 WHERE id = $2`, [body.reduceMotion, user.id]);
  }
  const rows = await sql<{ name: string; email: string; reduce_motion: boolean }>(
    `SELECT name, email, reduce_motion FROM users WHERE id = $1`,
    [user.id],
  );
  const row = rows[0]!;
  send(res, 200, { id: user.id, name: row.name, email: row.email, reduceMotion: row.reduce_motion });
  return true;
});

route("POST", "/api/me/password", true, async (req, res, _match, userRaw) => {
  const user = requireUser(userRaw);
  const bodyResult = await readJson(req, res);
  if (!bodyResult.ok) return true;
  const body = bodyResult.body as Record<string, unknown>;
  if (body === undefined) return false;
  const current = parseString(body.current);
  const next = parseString(body.next);
  const rows = await sql<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1`, [user.id]);
  const row = rows[0]!;
  if (!verifyPassword(current, row.password_hash)) throw invalid("current", fieldErrors.passwordWrong);
  const passwordError = passwordValidationError(next);
  if (passwordError) throw invalid(passwordError.field, passwordError.message);
  await sql(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hashPassword(next), user.id]);
  sendEmpty(res, 204);
  return true;
});

route("GET", "/api/patterns", true, async (_req, res, _match, userRaw) => {
  const user = requireUser(userRaw);
  const rows = await sql<{ id: string; name: string; state: string; role: string }>(
    `SELECT p.id, p.name, p.state, 'owner' AS role FROM patterns p WHERE p.owner_id = $1
     UNION ALL
     SELECT p.id, p.name, p.state, 'co-designer' FROM patterns p
     JOIN co_designers c ON c.pattern_id = p.id WHERE c.user_id = $1
     UNION ALL
     SELECT p.id, p.name, p.state, 'tester' FROM patterns p
     JOIN testers t ON t.pattern_id = p.id WHERE t.user_id = $1
     ORDER BY name`,
    [user.id],
  );
  send(res, 200, { patterns: rows });
  return true;
});

route("POST", "/api/patterns", true, async (req, res, _match, userRaw) => {
  const user = requireUser(userRaw);
  const bodyResult = await readJson(req, res);
  if (!bodyResult.ok) return true;
  const body = bodyResult.body as Record<string, unknown>;
  if (body === undefined) return false;
  const patternId = id("pat");
  if (body.sample === true) {
    const chart = sampleChart();
    await sql(
      `INSERT INTO patterns (id, owner_id, name, craft, mode, terms, cast_on, width, height, chart, state)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'draft')`,
      [
        patternId,
        user.id,
        "Sample swatch",
        "knit",
        "flat",
        null,
        12,
        chart.width,
        chart.height,
        JSON.stringify(chart),
      ],
    );
    await sql(`INSERT INTO colours (pattern_id, letter, name, hex) VALUES ($1, 'A', 'Main', '#dce8f7')`, [patternId]);
    send(res, 201, { id: patternId });
    return true;
  }
  const name = parseString(body.name);
  const kindLabel = parseString(body.kind);
  const rows = parseNumber(body.rows);
  const columns = parseNumber(body.columns);
  const castOn = parseNumber(body.castOn);
  const nameError = patternNameError(name);
  if (nameError) throw invalid(nameError.field, nameError.message);
  const kind = chartKindByLabel(kindLabel);
  if (!kind) throw invalid("kind", "Choose a chart kind.");
  const rowsErr = rowsError(rows ?? 0);
  if (rowsErr) throw invalid(rowsErr.field, rowsErr.message);
  const columnsErr = columnsError(columns ?? 0);
  if (columnsErr) throw invalid(columnsErr.field, columnsErr.message);
  const castOnErr = castOnError(castOn ?? 0);
  if (castOnErr) throw invalid(castOnErr.field, castOnErr.message);
  const chart = blankChart(columns!, rows!, castOn!);
  chart.craft = kind.craft;
  chart.mode = kind.mode;
  chart.terms = kind.terms;
  chart.castOn = castOn!;
  await sql(
    `INSERT INTO patterns (id, owner_id, name, craft, mode, terms, cast_on, width, height, chart, state)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'draft')`,
    [
      patternId,
      user.id,
      name,
      kind.craft,
      kind.mode,
      kind.terms,
      castOn!,
      columns!,
      rows!,
      JSON.stringify(chart),
    ],
  );
  for (const colour of kind.colours) {
    await sql(`INSERT INTO colours (pattern_id, letter, name, hex) VALUES ($1, $2, $3, $4)`, [
      patternId,
      colour.letter,
      colour.name,
      colour.letter === "A" ? "#dce8f7" : "#f6dfe6",
    ]);
  }
  send(res, 201, { id: patternId });
  return true;
});

route("GET", "/api/patterns/<id>/sheet.pdf", false, async (_req, res, match) => {
  const pattern = await loadPattern(match.params["id"]);
  if (!pattern || pattern.state !== "published" || pattern.published_version === null) throw notFound();
  const versionRows = await sql<{ chart: StoredChart }>(
    `SELECT chart FROM versions WHERE pattern_id = $1 AND version = $2`,
    [pattern.id, pattern.published_version],
  );
  const version = versionRows[0];
  if (!version) throw notFound();
  const check = checkChart({
    craft: pattern.craft,
    mode: pattern.mode,
    terms: pattern.terms,
    castOn: version.chart.castOn,
    width: version.chart.width,
    height: version.chart.height,
    repeats: version.chart.repeats ?? [],
    cells: version.chart.cells.map((cell) => ({ row: cell.row, col: cell.col, stitch: cell.stitch, colour: cell.colour })),
  });
  const lines = check.rows.filter((row) => row.text !== "").map((row) => row.text);
  const key: { text: string; name: string }[] = [];
  for (const def of symbolsOf(pattern.craft)) {
    if (def.key === "ns") continue;
    if (!version.chart.cells.some((cell) => cell.stitch === def.key)) continue;
    const text =
      pattern.craft === "crochet"
        ? pattern.terms === "uk"
          ? def.ukText
          : def.usText
        : def.rsText;
    key.push({ text, name: def.name });
  }
  const pdf = buildSheetPdf({
    name: pattern.name,
    version: pattern.published_version,
    castOn: version.chart.castOn,
    lines,
    key,
  });
  res.writeHead(200, {
    "content-type": "application/pdf",
    "content-length": pdf.length,
    "cache-control": "no-store",
  });
  res.end(pdf);
  return true;
});

route("GET", "/api/public/<id>", false, async (_req, res, match) => {
  const pattern = await loadPattern(match.params['id']);
  if (!pattern || pattern.state !== "published" || pattern.published_version === null) throw notFound();
  const versionRows = await sql<{ chart: StoredChart; version: number; saved_on: string; note: string }>(
    `SELECT chart, version, saved_on, note FROM versions WHERE pattern_id = $1 AND version = $2`,
    [pattern.id, pattern.published_version],
  );
  const version = versionRows[0];
  if (!version) throw notFound();
  const colours = await loadColours(pattern.id);
  const view = chartView(pattern, version.chart, colours);
  send(res, 200, view);
  return true;
});

function hoursFrom(hours: number): Date {
  return new Date(Date.now() + hours * 3600 * 1000);
}

function chartView(
  pattern: Awaited<ReturnType<typeof loadPattern>>,
  chart: StoredChart,
  colours: { letter: string; name: string; hex: string }[],
) {
  const computed = computePattern({ ...pattern!, chart, cast_on: chart.castOn, width: chart.width, height: chart.height }, colours);
  return {
    id: pattern!.id,
    name: pattern!.name,
    craft: pattern!.craft,
    mode: pattern!.mode,
    terms: pattern!.terms,
    version: pattern!.published_version ?? 0,
    castOn: chart.castOn,
    width: chart.width,
    height: chart.height,
    colours: colours.map((colour) => ({ letter: colour.letter, name: colour.name, hex: colour.hex })),
    repeats: chart.repeats ?? [],
    cells: chart.cells,
    rows: computed.rows.map((row) => publicRow(row)),
  };
}

function publicRow(row: { row: number; side: string; used: number; made: number; state: string; errors: string[]; text: string }) {
  return {
    row: row.row,
    side: row.side,
    used: row.used,
    made: row.made,
    state: row.state,
    errors: row.errors,
    text: row.text,
  };
}

/** The sample swatch: the 12-wide, 7-row shaping chart from the row rule. */
export function sampleChart(): StoredChart {
  const width = 12;
  const height = 7;
  const rows: Record<number, string> = {
    1: "k k k k k k k k k k k k",
    2: "k k k k k k k k k k k k",
    3: "ns k k2tog k k k k k k ssk k ns",
    4: "ns k ssk k k k k k2tog k ns ns ns",
    5: "ns k k k k k k k k ns ns ns",
    6: "ns k k k k k k k k ns ns ns",
    7: "ns k m1r k k k k k k m1l k ns",
  };
  const cells: StoredChart["cells"] = [];
  for (let row = 1; row <= height; row++) {
    const symbols = rows[row]!.split(" ");
    for (let col = 1; col <= width; col++) {
      cells.push({ row, col, stitch: symbols[col - 1] ?? "ns", colour: "A", rev: 1 });
    }
  }
  return { craft: "knit", mode: "flat", terms: null, castOn: 12, width, height, repeats: [], cells };
}

export { applySchema };

// ---------------------------------------------------------------------------
// Designer routes
// ---------------------------------------------------------------------------

route("GET", "/api/patterns/<id>", true, async (_req, res, match, userRaw) => {
  const user = requireUser(userRaw);
  const access = await patternAccess(user, match.params['id'], ["owner", "co-designer"]);
  const colours = await loadColours(access.pattern.id);
  const computed = computePattern(access.pattern, colours);
  const noteCounts = await noteCountsByRow(access.pattern.id);
  const versionRows = await sql<{ version: number }>(
    `SELECT version FROM versions WHERE pattern_id = $1 ORDER BY version DESC LIMIT 1`,
    [access.pattern.id],
  );
  send(res, 200, {
    id: access.pattern.id,
    name: access.pattern.name,
    craft: access.pattern.craft,
    mode: access.pattern.mode,
    terms: access.pattern.terms,
    castOn: access.pattern.cast_on,
    width: access.pattern.width,
    height: access.pattern.height,
    colours: colours.map((colour) => ({ letter: colour.letter, name: colour.name, hex: colour.hex })),
    repeats: access.pattern.chart.repeats ?? [],
    cells: access.pattern.chart.cells,
    rows: serverRows(computed, noteCounts),
    colourWarnings: computed.colourWarnings,
    version: versionRows[0]?.version ?? 0,
    state: access.pattern.state,
  });
  return true;
});

async function noteCountsByRow(patternId: string): Promise<Map<number, number>> {
  const rows = await sql<{ row: number; count: string }>(
    `SELECT row, count(*) AS count FROM notes WHERE pattern_id = $1 GROUP BY row`,
    [patternId],
  );
  return new Map(rows.map((row) => [Number(row.row), Number(row.count)]));
}

function serverRows(computed: ReturnType<typeof computePattern>, noteCounts: Map<number, number>) {
  return computed.rows.map((row) => ({
    row: row.row,
    side: row.side,
    used: row.used,
    made: row.made,
    state: row.state,
    errors: row.errors,
    text: row.text,
    notes: noteCounts.get(row.row) ?? 0,
    tokens: row.line?.tokens ?? [],
  }));
}

route("POST", "/api/patterns/<id>/cells", true, async (req, res, match, userRaw) => {
  const user = requireUser(userRaw);
  const access = await patternAccess(user, match.params['id'], ["owner", "co-designer"]);
  const bodyResult = await readJson(req, res);
  if (!bodyResult.ok) return true;
  const body = bodyResult.body as Record<string, unknown>;
  if (body === undefined) return false;
  const opId = parseString(body.opId);
  if (opId === "") throw invalid("opId", "Give an opId.");
  const replay = await replayCheck(opId, access.pattern.id);
  if (replay) {
    send(res, 200, replay.response);
    return true;
  }
  await editRateCheck(user.id);
  const cells = Array.isArray(body.cells) ? (body.cells as Record<string, unknown>[]) : [];
  if (cells.length === 0) throw invalid("cells", "Give the cells to change.");
  const pattern = access.pattern;
  const colourList = await loadColours(pattern.id);
  const applied: { row: number; col: number; rev: number }[] = [];
  const conflicts: { row: number; col: number; by: string; stitch: string; colour: string; rev: number }[] = [];
  const byCell = new Map(pattern.chart.cells.map((cell) => [cellKey(cell.row, cell.col), cell]));
  for (const change of cells) {
    const row = parseNumber(change.row);
    const col = parseNumber(change.col);
    const stitch = parseString(change.stitch);
    const colour = parseString(change.colour);
    const rev = parseNumber(change.rev);
    if (!row || !col || row < 1 || row > pattern.height || col < 1 || col > pattern.width) {
      throw invalid("cells", "A cell is off the chart.");
    }
    if (!symbolOfCraft(pattern.craft, stitch) || !colourLettersOf(colourList).includes(colour)) {
      throw invalid("cells", "A stitch or colour is not valid for this pattern.");
    }
    if (rev === null) throw invalid("cells", "Give each cell's revision.");
    const existing = byCell.get(cellKey(row, col));
    if (!existing) throw invalid("cells", "A cell is off the chart.");
    if (existing.rev !== rev) {
      conflicts.push({
        row,
        col,
        by: existing.by ?? user.name,
        stitch: existing.stitch,
        colour: existing.colour,
        rev: existing.rev,
      });
      continue;
    }
    const nextRev = existing.rev + 1;
    existing.stitch = stitch;
    existing.colour = colour;
    existing.rev = nextRev;
    existing.by = user.name;
    applied.push({ row, col, rev: nextRev });
  }
  await saveChart(pattern);
  const colours = await loadColours(pattern.id);
  const computed = computePattern(pattern, colours);
  const noteCounts = await noteCountsByRow(pattern.id);
  const response = {
    applied,
    conflicts,
    rows: serverRows(computed, noteCounts),
  };
  await storeOp(opId, pattern.id, response);
  if (applied.length > 0) {
    hub.publish(pattern.id, {
      type: "cells",
      by: user.id,
      byName: user.name,
      cells: applied.map((cell) => ({
        row: cell.row,
        col: cell.col,
        ...pickCell(pattern.chart.cells, cell.row, cell.col),
      })),
      rows: response.rows,
    });
  }
  send(res, 200, response);
  return true;
});

function colourLettersOf(colours: { letter: string }[]): string[] {
  return colours.map((colour) => colour.letter);
}

function pickCell(cells: StoredChart["cells"], row: number, col: number) {
  const found = cells.find((cell) => cell.row === row && cell.col === col);
  return found ? { stitch: found.stitch, colour: found.colour, repeat: found.repeat ?? "", rev: found.rev } : {};
}

function symbolOfCraft(craft: string, stitch: string): boolean {
  const keys =
    craft === "knit"
      ? ["k", "p", "yo", "k2tog", "ssk", "cdd", "m1l", "m1r", "ns", "c22"]
      : ["sc", "hdc", "dc", "inc", "dec", "ns"];
  return keys.includes(stitch);
}

function cellKey(row: number, col: number): string {
  return `${row}:${col}`;
}

async function saveChart(pattern: PatternRow): Promise<void> {
  await sql(`UPDATE patterns SET chart = $1, width = $2, height = $3 WHERE id = $4`, [
    JSON.stringify(pattern.chart),
    pattern.width,
    pattern.height,
    pattern.id,
  ]);
}

async function replayCheck(opId: string, patternId: string): Promise<{ response: unknown } | null> {
  const rows = await sql<{ response: unknown }>(`SELECT response FROM ops WHERE op_id = $1 AND pattern_id = $2`, [
    opId,
    patternId,
  ]);
  return rows[0] ?? null;
}

route("POST", "/api/patterns/<id>/repeats", true, async (req, res, match, userRaw) => {
  const user = requireUser(userRaw);
  const access = await patternAccess(user, match.params['id'], ["owner", "co-designer"]);
  const bodyResult = await readJson(req, res);
  if (!bodyResult.ok) return true;
  const body = bodyResult.body as Record<string, unknown>;
  if (body === undefined) return false;
  const pattern = access.pattern;
  const fromCol = parseNumber(body.fromCol);
  const toCol = parseNumber(body.toCol);
  const fromRow = parseNumber(body.fromRow);
  const toRow = parseNumber(body.toRow);
  if (fromCol === null || toCol === null || fromRow === null || toRow === null) {
    throw invalid("from", "Give the box's rows and columns.");
  }
  const loCol = Math.min(fromCol, toCol);
  const hiCol = Math.max(fromCol, toCol);
  const loRow = Math.min(fromRow, toRow);
  const hiRow = Math.max(fromRow, toRow);
  if (loCol < 1 || hiCol > pattern.width || loRow < 1 || hiRow > pattern.height) {
    throw invalid("from", "The box is off the chart.");
  }
  const repeats = pattern.chart.repeats ?? [];
  const overlaps = repeats.some(
    (box) => loRow <= box.toRow && hiRow >= box.fromRow && loCol <= box.toCol && hiCol >= box.fromCol,
  );
  if (overlaps) throw conflict("overlap", "Repeat boxes cannot overlap.");
  const times = parseNumber(body.times) ?? 2;
  if (times < 2 || times > 20) throw invalid("times", "Times must be from 2 to 20.");
  const boxId = nextRepeatId(repeats);
  const box = { id: boxId, fromCol: loCol, toCol: hiCol, fromRow: loRow, toRow: hiRow, times };
  pattern.chart.repeats = [...repeats, box];
  for (const cell of pattern.chart.cells) {
    if (cell.row >= loRow && cell.row <= hiRow && cell.col >= loCol && cell.col <= hiCol) {
      cell.repeat = boxId;
    }
  }
  await saveChart(pattern);
  const colours = await loadColours(pattern.id);
  const computed = computePattern(pattern, colours);
  const noteCounts = await noteCountsByRow(pattern.id);
  const response = { id: boxId, times, cells: pattern.chart.cells, rows: serverRows(computed, noteCounts) };
  hub.publish(pattern.id, {
    type: "chart",
    by: user.id,
    byName: user.name,
    chart: { repeats: pattern.chart.repeats, cells: pattern.chart.cells },
    rows: response.rows,
  });
  send(res, 201, response);
  return true;
});

function nextRepeatId(repeats: { id: string }[]): string {
  for (let index = 0; index < 200; index++) {
    const candidate = String.fromCharCode(65 + index);
    if (!repeats.some((box) => box.id === candidate)) return candidate;
  }
  return "A";
}

async function storeOp(opId: string, patternId: string, response: unknown): Promise<void> {
  await sql(
    `INSERT INTO ops (op_id, pattern_id, response) VALUES ($1, $2, $3)
     ON CONFLICT (op_id) DO NOTHING`,
    [opId, patternId, JSON.stringify(response)],
  );
}

route("PATCH", "/api/patterns/<id>/repeats/<rid>", true, async (req, res, match, userRaw) => {
  const user = requireUser(userRaw);
  const access = await patternAccess(user, match.params['id'], ["owner", "co-designer"]);
  const bodyResult = await readJson(req, res);
  if (!bodyResult.ok) return true;
  const body = bodyResult.body as Record<string, unknown>;
  if (body === undefined) return false;
  const pattern = access.pattern;
  const times = parseNumber(body.times);
  if (times === null || times < 2 || times > 20) throw invalid("times", "Times must be from 2 to 20.");
  const box = (pattern.chart.repeats ?? []).find((entry) => entry.id === match.groups!.rid);
  if (!box) throw notFound();
  box.times = times;
  await saveChart(pattern);
  const colours = await loadColours(pattern.id);
  const computed = computePattern(pattern, colours);
  const noteCounts = await noteCountsByRow(pattern.id);
  const response = { rows: serverRows(computed, noteCounts) };
  hub.publish(pattern.id, {
    type: "chart",
    by: user.id,
    byName: user.name,
    chart: { repeats: pattern.chart.repeats, cells: pattern.chart.cells },
    rows: response.rows,
  });
  send(res, 200, response);
  return true;
});

route("DELETE", "/api/patterns/<id>/repeats/<rid>", true, async (_req, res, match, userRaw) => {
  const user = requireUser(userRaw);
  const access = await patternAccess(user, match.params['id'], ["owner", "co-designer"]);
  const pattern = access.pattern;
  const repeats = pattern.chart.repeats ?? [];
  const box = repeats.find((entry) => entry.id === match.groups!.rid);
  if (!box) throw notFound();
  pattern.chart.repeats = repeats.filter((entry) => entry.id !== box.id);
  for (const cell of pattern.chart.cells) {
    if (cell.repeat === box.id) cell.repeat = undefined;
  }
  await saveChart(pattern);
  const colours = await loadColours(pattern.id);
  const computed = computePattern(pattern, colours);
  const noteCounts = await noteCountsByRow(pattern.id);
  const response = { cells: pattern.chart.cells, rows: serverRows(computed, noteCounts) };
  hub.publish(pattern.id, {
    type: "chart",
    by: user.id,
    byName: user.name,
    chart: { repeats: pattern.chart.repeats, cells: pattern.chart.cells },
    rows: response.rows,
  });
  send(res, 200, response);
  return true;
});

route("POST", "/api/patterns/<id>/repeats/<rid>/expand", true, async (_req, res, match, userRaw) => {
  const user = requireUser(userRaw);
  const access = await patternAccess(user, match.params['id'], ["owner", "co-designer"]);
  const pattern = access.pattern;
  const repeats = pattern.chart.repeats ?? [];
  const box = repeats.find((entry) => entry.id === match.groups!.rid);
  if (!box) throw notFound();
  const span = box.toCol - box.fromCol + 1;
  const added = span * (box.times - 1);
  const newWidth = pattern.width + added;
  if (newWidth > env.limits.maxChartCols) {
    throw conflict("too_wide", `That is wider than the ${env.limits.maxChartCols} column limit.`);
  }
  pattern.chart = expandChart(pattern.chart, box, added, newWidth);
  pattern.width = newWidth;
  await saveChart(pattern);
  const colours = await loadColours(pattern.id);
  const computed = computePattern(pattern, colours);
  const noteCounts = await noteCountsByRow(pattern.id);
  const response = { added, width: newWidth, cells: pattern.chart.cells, rows: serverRows(computed, noteCounts) };
  hub.publish(pattern.id, {
    type: "chart",
    by: user.id,
    byName: user.name,
    chart: { repeats: pattern.chart.repeats, cells: pattern.chart.cells },
    rows: response.rows,
    width: newWidth,
  });
  send(res, 200, response);
  return true;
});

/** Expand: the box's columns are copied `times - 1` more times to its right. */
function expandChart(
  chart: StoredChart,
  box: { id: string; fromCol: number; toCol: number; fromRow: number; toRow: number; times: number },
  added: number,
  newWidth: number,
): StoredChart {
  const span = box.toCol - box.fromCol + 1;
  const byRow = new Map<number, Map<number, StoredChart["cells"][number]>>();
  for (const cell of chart.cells) {
    let rowMap = byRow.get(cell.row);
    if (!rowMap) {
      rowMap = new Map();
      byRow.set(cell.row, rowMap);
    }
    rowMap.set(cell.col, { ...cell });
  }
  const cells: StoredChart["cells"] = [];
  for (let row = 1; row <= chart.height; row++) {
    const rowMap = byRow.get(row) ?? new Map();
    for (let col = 1; col <= newWidth; col++) {
      let source: StoredChart["cells"][number] | undefined;
      if (col <= box.toCol) {
        source = rowMap.get(col);
      } else if (col <= box.toCol + added) {
        if (row < box.fromRow || row > box.toRow) {
          source = { row, col, stitch: "ns", colour: "A", rev: 1 };
        } else {
          const offset = (col - box.toCol - 1) % span;
          source = rowMap.get(box.fromCol + offset);
        }
      } else {
        source = rowMap.get(col - added);
      }
      cells.push({
        row,
        col,
        stitch: source?.stitch ?? "ns",
        colour: source?.colour ?? "A",
        rev: source?.rev ?? 1,
        repeat: undefined,
        by: source?.by,
      });
    }
  }
  return {
    ...chart,
    width: newWidth,
    repeats: (chart.repeats ?? [])
      .filter((entry) => entry.id !== box.id)
      .map((entry) => ({
        ...entry,
        fromCol: entry.fromCol > box.toCol ? entry.fromCol + added : entry.fromCol,
        toCol: entry.toCol > box.toCol ? entry.toCol + added : entry.toCol,
      })),
    cells,
  };
}

route("POST", "/api/patterns/<id>/repeats/undo-expand", true, async (req, res, match, userRaw) => {
  const user = requireUser(userRaw);
  const access = await patternAccess(user, match.params['id'], ["owner", "co-designer"]);
  const bodyResult = await readJson(req, res);
  if (!bodyResult.ok) return true;
  const body = bodyResult.body as Record<string, unknown>;
  if (body === undefined) return false;
  const pattern = access.pattern;
  const box = {
    id: parseString(body.id),
    fromCol: parseNumber(body.fromCol) ?? 0,
    toCol: parseNumber(body.toCol) ?? 0,
    fromRow: parseNumber(body.fromRow) ?? 0,
    toRow: parseNumber(body.toRow) ?? 0,
    times: parseNumber(body.times) ?? 0,
  };
  if (box.id === "") throw invalid("id", "Give the repeat id.");
  const added = (box.toCol - box.fromCol + 1) * (box.times - 1);
  const newWidth = pattern.width - added;
  const shrunk: StoredChart = {
    ...pattern.chart,
    width: newWidth,
    repeats: [...(pattern.chart.repeats ?? []), box],
    cells: pattern.chart.cells
      .filter((cell) => cell.col <= newWidth)
      .map((cell) => ({ ...cell, repeat: undefined })),
  };
  for (const cell of shrunk.cells) {
    if (cell.row >= box.fromRow && cell.row <= box.toRow && cell.col >= box.fromCol && cell.col <= box.toCol) {
      cell.repeat = box.id;
    }
  }
  pattern.chart = shrunk;
  pattern.width = newWidth;
  await saveChart(pattern);
  const colours = await loadColours(pattern.id);
  const computed = computePattern(pattern, colours);
  const noteCounts = await noteCountsByRow(pattern.id);
  const response = { width: newWidth, cells: pattern.chart.cells, rows: serverRows(computed, noteCounts) };
  hub.publish(pattern.id, {
    type: "chart",
    by: user.id,
    byName: user.name,
    chart: { repeats: pattern.chart.repeats, cells: pattern.chart.cells },
    rows: response.rows,
    width: newWidth,
  });
  send(res, 200, response);
  return true;
});

route("POST", "/api/patterns/<id>/colours", true, async (req, res, match, userRaw) => {
  const user = requireUser(userRaw);
  const access = await patternAccess(user, match.params['id'], ["owner", "co-designer"]);
  const bodyResult = await readJson(req, res);
  if (!bodyResult.ok) return true;
  const body = bodyResult.body as Record<string, unknown>;
  if (body === undefined) return false;
  const name = parseString(body.name).trim();
  const hex = parseString(body.hex);
  const existing = await loadColours(access.pattern.id);
  if (name === "") throw invalid("name", fieldErrors.colourName);
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw invalid("hex", fieldErrors.colourHex);
  if (existing.length >= env.limits.maxColours) {
    throw conflict("too_many_colours", `A pattern can have ${env.limits.maxColours} colours.`);
  }
  const letter = String.fromCharCode(65 + existing.length);
  await sql(`INSERT INTO colours (pattern_id, letter, name, hex) VALUES ($1, $2, $3, $4)`, [
    access.pattern.id,
    letter,
    name,
    hex,
  ]);
  hub.publish(access.pattern.id, {
    type: "colours",
    by: user.id,
    colours: [...existing, { letter, name, hex }],
  });
  send(res, 201, { letter });
  return true;
});

route("POST", "/api/patterns/<id>/co-designers", true, async (req, res, match, userRaw) => {
  const user = requireUser(userRaw);
  const access = await patternAccess(user, match.params['id'], ["owner"]);
  const bodyResult = await readJson(req, res);
  if (!bodyResult.ok) return true;
  const body = bodyResult.body as Record<string, unknown>;
  if (body === undefined) return false;
  const email = parseString(body.email).trim().toLowerCase();
  if (emailValidationError(email)) throw invalid("email", fieldErrors.coDesigner);
  const rows = await sql<{ id: string; name: string }>(`SELECT id, name FROM users WHERE email = $1`, [email]);
  const account = rows[0];
  if (!account) throw invalid("email", fieldErrors.coDesigner);
  await sql(`INSERT INTO co_designers (pattern_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [
    access.pattern.id,
    account.id,
  ]);
  send(res, 200, { id: account.id, name: account.name });
  return true;
});

route("POST", "/api/patterns/<id>/text", true, async (req, res, match, userRaw) => {
  const user = requireUser(userRaw);
  const access = await patternAccess(user, match.params['id'], ["owner", "co-designer"]);
  const bodyResult = await readJson(req, res);
  if (!bodyResult.ok) return true;
  const body = bodyResult.body as Record<string, unknown>;
  if (body === undefined) return false;
  const row = parseNumber(body.row);
  const text = parseString(body.text);
  if (row === null || row < 1 || row > access.pattern.height) throw invalid("row", "The row is not on the chart.");
  await editRateCheck(user.id);
  const pattern = access.pattern;
  const colours = await loadColours(pattern.id);
  const result = applyTextToChart(pattern, colours, row, text);
  if (!result.ok) {
    send(res, 422, { error: "invalid", field: "text", message: result.error.message, position: result.error.position });
    return true;
  }
  const byCell = new Map(pattern.chart.cells.map((cell) => [cellKey(cell.row, cell.col), cell]));
  const changed: { row: number; col: number; stitch: string; colour: string; repeat: string; rev: number }[] = [];
  let differing = 0;
  for (const change of result.cells) {
    const existing = byCell.get(cellKey(change.row, change.col))!;
    const differs = existing.stitch !== change.stitch || existing.colour !== change.colour;
    if (differs) {
      existing.rev += 1;
      existing.by = user.name;
      differing++;
    }
    existing.stitch = change.stitch;
    existing.colour = change.colour;
    changed.push({
      row: change.row,
      col: change.col,
      stitch: existing.stitch,
      colour: existing.colour,
      repeat: existing.repeat ?? "",
      rev: existing.rev,
    });
  }
  await saveChart(pattern);
  const freshColours = await loadColours(pattern.id);
  const computed = computePattern(pattern, freshColours);
  const noteCounts = await noteCountsByRow(pattern.id);
  const response = { changed: differing, cells: changed, rows: serverRows(computed, noteCounts) };
  hub.publish(pattern.id, { type: "cells", by: user.id, byName: user.name, cells: changed, rows: response.rows });
  send(res, 200, response);
  return true;
});

function applyTextToChart(
  pattern: PatternRow,
  colours: { letter: string; name: string; hex: string }[],
  row: number,
  text: string,
): { ok: true; cells: { row: number; col: number; stitch: string; colour: string }[] } | { ok: false; error: { position: number | null; message: string } } {
  return applyTextToRow(
    {
      craft: pattern.craft,
      mode: pattern.mode,
      terms: pattern.terms,
      castOn: pattern.cast_on,
      width: pattern.width,
      height: pattern.height,
      repeats: pattern.chart.repeats ?? [],
      cells: pattern.chart.cells.map((cell) => ({ row: cell.row, col: cell.col, stitch: cell.stitch, colour: cell.colour })),
      colourLetters: () => colours.map((colour) => colour.letter),
    },
    row,
    text,
  );
}

route("POST", "/api/patterns/<id>/mirror", true, async (req, res, match, userRaw) => {
  const user = requireUser(userRaw);
  const access = await patternAccess(user, match.params['id'], ["owner", "co-designer"]);
  const bodyResult = await readJson(req, res);
  if (!bodyResult.ok) return true;
  const body = bodyResult.body as Record<string, unknown>;
  if (body === undefined) return false;
  const opId = parseString(body.opId);
  if (opId === "") throw invalid("opId", "Give an opId.");
  const replay = await replayCheck(opId, access.pattern.id);
  if (replay) {
    send(res, 200, replay.response);
    return true;
  }
  await editRateCheck(user.id);
  const pattern = access.pattern;
  const fromRow = parseNumber(body.fromRow);
  const toRow = parseNumber(body.toRow);
  const fromCol = parseNumber(body.fromCol);
  const toCol = parseNumber(body.toCol);
  if (fromRow === null || toRow === null || fromCol === null || toCol === null) {
    throw invalid("from", "Give the selection to mirror.");
  }
  const lo = { row: Math.min(fromRow, toRow), col: Math.min(fromCol, toCol) };
  const hi = { row: Math.max(fromRow, toRow), col: Math.max(fromCol, toCol) };
  const repeats = pattern.chart.repeats ?? [];
  const crosses = repeats.some(
    (box) => lo.row <= box.toRow && hi.row >= box.fromRow && lo.col <= box.toCol && hi.col >= box.fromCol,
  );
  if (crosses) throw conflict("crosses_repeat", "Mirror cannot cross a repeat box.");
  const partners: Record<string, string> = { k2tog: "ssk", ssk: "k2tog", m1l: "m1r", m1r: "m1l" };
  const byCell = new Map(pattern.chart.cells.map((cell) => [cellKey(cell.row, cell.col), cell]));
  const applied: { row: number; col: number; stitch: string; colour: string; rev: number }[] = [];
  for (let row = lo.row; row <= hi.row; row++) {
    const slice: { col: number; stitch: string; colour: string }[] = [];
    for (let col = lo.col; col <= hi.col; col++) {
      const cell = byCell.get(cellKey(row, col));
      slice.push({ col, stitch: cell?.stitch ?? "ns", colour: cell?.colour ?? "A" });
    }
    const reversed = [...slice].reverse();
    for (let index = 0; index < slice.length; index++) {
      const target = byCell.get(cellKey(row, slice[index]!.col))!;
      const source = reversed[index]!;
      target.stitch = partners[source.stitch] ?? source.stitch;
      target.colour = source.colour;
      target.rev += 1;
      target.by = user.name;
      applied.push({ row, col: slice[index]!.col, stitch: target.stitch, colour: target.colour, rev: target.rev });
    }
  }
  await saveChart(pattern);
  const colours = await loadColours(pattern.id);
  const computed = computePattern(pattern, colours);
  const noteCounts = await noteCountsByRow(pattern.id);
  const response = { applied, conflicts: [], rows: serverRows(computed, noteCounts) };
  await storeOp(opId, pattern.id, response);
  hub.publish(pattern.id, { type: "cells", by: user.id, byName: user.name, cells: applied, rows: response.rows });
  send(res, 200, response);
  return true;
});
