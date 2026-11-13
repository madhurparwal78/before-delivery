import type { IncomingMessage, ServerResponse } from "node:http";
import { env, sql } from "../common/env";
import { fieldErrors, s } from "../common/copy";
import { emailValidationError, nameValidationError, noteTextError, passwordValidationError } from "../common/validate";
import {
  conflict,
  invalid,
  notFound,
  parseNumber,
  parseString,
  readBody,
  requireUser,
  route,
  sendRows,
  type RouteMatch,
  type SessionUser,
} from "./routes";
import { loadColours, loadPattern, computePattern } from "./services/patterns";
import type { LiveHub } from "./live/hub";
import type { Mailer } from "./mail/mailer";
import type { StoredChart } from "./db/store";
import { token as randomToken, id as randomId } from "./db/store";
import { checkChart } from "./chart/check";

export interface TesterDeps {
  hub: LiveHub;
  mailer: Mailer;
}

interface StoredVersion {
  version: number;
  note: string;
  saved_on: string;
  stitches: number;
  chart: StoredChart;
}

export function registerTesterRoutes(deps: TesterDeps): void {
  const hub = deps.hub;
  const mailer = deps.mailer;

  route("POST", "/api/patterns/<id>/testers", true, async (req: IncomingMessage, res: ServerResponse, match: RouteMatch, userRaw: SessionUser | null) => {
    const user = requireUser(userRaw);
    const patternId = match.params['id'];
    const pattern = await loadPattern(patternId);
    if (!pattern || pattern.owner_id !== user.id) throw notFound();
    const body = (await readBody(req, res)).body as Record<string, unknown> | undefined;
    const email = parseString(body?.email).trim().toLowerCase();
    if (emailValidationError(email)) throw invalid("email", fieldErrors.testerEmail);
    const latest = await sql<{ version: number }>(
      `SELECT version FROM versions WHERE pattern_id = $1 ORDER BY version DESC LIMIT 1`,
      [patternId],
    );
    if (!latest[0]) throw conflict("no_version", fieldErrors.noVersionInvite);
    const existing = await sql<{ user_id: string }>(
      `SELECT user_id FROM testers WHERE pattern_id = $1 AND email-less = FALSE`,
      [patternId],
    );
    void existing;
    const invitedRows = await sql<{ email: string }>(
      `SELECT email FROM users WHERE email = $1`,
      [email],
    );
    void invitedRows;
    const alreadyTester = await sql<{ user_id: string }>(
      `SELECT t.user_id FROM testers t JOIN users u ON u.id = t.user_id WHERE t.pattern_id = $1 AND u.email = $2`,
      [patternId, email],
    );
    if (alreadyTester.length > 0) throw conflict("already_testing", fieldErrors.alreadyTesting);
    const inviteToken = randomToken();
    await sql(
      `INSERT INTO invites (token, pattern_id, email, status, sent_at, expires_at)
       VALUES ($1, $2, $3, 'sent', now(), $4)`,
      [inviteToken, patternId, email, new Date(Date.now() + env.limits.inviteTtlHours * 3600 * 1000)],
    );
    try {
      await mailer.send(email, `Test ${pattern.name} on Twinrow`, `${env.publicUrl}/invite/${inviteToken}`);
    } catch {
      await sql(`DELETE FROM invites WHERE token = $1`, [inviteToken]);
      throw new ApiMailError();
    }
    sendRows(res, 201, { id: inviteToken, email, status: "sent" });
    return true;
  });

  route("GET", "/api/invites/<token>", false, async (_req: IncomingMessage, res: ServerResponse, match: RouteMatch) => {
    const rows = await sql<{ pattern_id: string; email: string; status: string; expires_at: Date }>(
      `SELECT pattern_id, email, status, expires_at FROM invites WHERE token = $1`,
      [match.params['token']],
    );
    const invite = rows[0];
    if (!invite) throw notFound();
    const pattern = await loadPattern(invite.pattern_id);
    if (!pattern) throw notFound();
    const expired = new Date(invite.expires_at).getTime() < Date.now();
    const status = invite.status === "accepted" ? "accepted" : expired ? "expired" : "sent";
    const accountRows = await sql<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [invite.email]);
    sendRows(res, 200, {
      patternName: pattern.name,
      hasAccount: accountRows.length > 0,
      status,
    });
    return true;
  });

  route("POST", "/api/invites/<token>/accept", false, async (req: IncomingMessage, res: ServerResponse, match: RouteMatch) => {
    const body = (await readBody(req, res)).body as Record<string, unknown> | undefined;
    const rows = await sql<{ id: string; pattern_id: string; email: string; status: string; expires_at: Date }>(
      `SELECT id, pattern_id, email, status, expires_at FROM invites WHERE token = $1`,
      [match.params['token']],
    );
    const invite = rows[0];
    if (!invite) throw notFound();
    if (invite.status === "accepted") throw conflict("invite_used", s.inviteUsed);
    if (new Date(invite.expires_at).getTime() < Date.now()) {
      throw conflict("invite_expired", s.inviteExpired);
    }
    const accountRows = await sql<{ id: string; name: string; password_hash: string; verified: boolean }>(
      `SELECT id, name, password_hash, verified FROM users WHERE email = $1`,
      [invite.email],
    );
    let account = accountRows[0];
    const password = parseString(body?.password);
    const name = parseString(body?.name);
    if (account) {
      const passwordError = passwordValidationError(password);
      if (passwordError) throw invalid(passwordError.field, passwordError.message);
      const { verifyPassword } = await import("./db/store");
      if (!verifyPassword(password, account.password_hash)) {
        throw new ApiInvalidCredentials();
      }
    } else {
      const nameError = nameValidationError(name);
      if (nameError) throw invalid(nameError.field, nameError.message);
      const passwordError = passwordValidationError(password);
      if (passwordError) throw invalid(passwordError.field, passwordError.message);
      const verifyToken = randomToken();
      const userId = randomId("user");
      await sql(
        `INSERT INTO users (id, name, email, password_hash, verified, verify_token, verify_expires)
         VALUES ($1, $2, $3, $4, TRUE, $5, $6)`,
        [userId, name, invite.email, (await import("./db/store")).hashPassword(password), verifyToken, new Date(Date.now() + 24 * 3600 * 1000)],
      );
      try {
        await mailer.send(invite.email, "Verify your Twinrow email", `${env.publicUrl}/verify?token=${verifyToken}`);
      } catch {
        // the account stands; the mail can be sent again from settings
      }
      account = { id: userId, name, password_hash: "", verified: true };
    }
    const latest = await sql<{ version: number }>(
      `SELECT version FROM versions WHERE pattern_id = $1 ORDER BY version DESC LIMIT 1`,
      [invite.pattern_id],
    );
    await sql(
      `INSERT INTO testers (pattern_id, user_id, version, row) VALUES ($1, $2, $3, 1)
       ON CONFLICT (pattern_id, user_id) DO NOTHING`,
      [invite.pattern_id, account.id, latest[0]?.version ?? 1],
    );
    await sql(`UPDATE invites SET status = 'accepted' WHERE id = $1`, [invite.id]);
    const sessionToken = randomToken(32);
    await sql(`INSERT INTO sessions (token, user_id) VALUES ($1, $2)`, [sessionToken, account.id]);
    const { setSessionCookie } = await import("./http");
    setSessionCookie(res, sessionToken);
    sendRows(res, 200, { patternId: invite.pattern_id });
    return true;
  });

  route("GET", "/api/patterns/<id>/follow", true, async (_req: IncomingMessage, res: ServerResponse, match: RouteMatch, userRaw: SessionUser | null) => {
    const user = requireUser(userRaw);
    const patternId = match.params['id'];
    const testerRows = await sql<{ version: number; row: number }>(
      `SELECT version, row FROM testers WHERE pattern_id = $1 AND user_id = $2`,
      [patternId, user.id],
    );
    const tester = testerRows[0];
    if (!tester) throw notFound();
    const pattern = await loadPattern(patternId);
    if (!pattern) throw notFound();
    const versionRows = await sql<StoredVersion>(
      `SELECT version, note, saved_on, stitches, chart FROM versions WHERE pattern_id = $1 AND version = $2`,
      [patternId, tester.version],
    );
    const version = versionRows[0];
    if (!version) throw notFound();
    const latestRows = await sql<{ version: number }>(
      `SELECT version FROM versions WHERE pattern_id = $1 ORDER BY version DESC LIMIT 1`,
      [patternId],
    );
    const ownNotes = await sql<{ row: number; count: string }>(
      `SELECT row, count(*) AS count FROM notes WHERE pattern_id = $1 AND user_id = $2 AND version = $3 GROUP BY row`,
      [patternId, user.id, tester.version],
    );
    const noteCounts = new Map(ownNotes.map((note) => [Number(note.row), Number(note.count)]));
    const check = checkChart({
      craft: version.chart.craft,
      mode: version.chart.mode,
      terms: version.chart.terms,
      castOn: version.chart.castOn,
      width: version.chart.width,
      height: version.chart.height,
      repeats: version.chart.repeats ?? [],
      cells: version.chart.cells.map((cell) => ({ row: cell.row, col: cell.col, stitch: cell.stitch, colour: cell.colour })),
    });
    const colours = await loadColours(patternId);
    const row = await hub.loadCounter(patternId, user.id, tester.row);
    sendRows(res, 200, {
      id: pattern.id,
      name: pattern.name,
      craft: version.chart.craft,
      mode: version.chart.mode,
      terms: version.chart.terms,
      castOn: version.chart.castOn,
      width: version.chart.width,
      height: version.chart.height,
      colours: colours.map((colour) => ({ letter: colour.letter, name: colour.name, hex: colour.hex })),
      repeats: version.chart.repeats ?? [],
      cells: version.chart.cells,
      rows: check.rows.map((entry) => ({
        row: entry.row,
        side: entry.side,
        used: entry.used,
        made: entry.made,
        state: entry.state,
        errors: entry.errors,
        text: entry.text,
        notes: noteCounts.get(entry.row) ?? 0,
      })),
      version: tester.version,
      latestVersion: latestRows[0]?.version ?? tester.version,
      row,
    });
    return true;
  });

  route("POST", "/api/patterns/<id>/follow", true, async (req: IncomingMessage, res: ServerResponse, match: RouteMatch, userRaw: SessionUser | null) => {
    const user = requireUser(userRaw);
    const patternId = match.params['id'];
    const body = (await readBody(req, res)).body as Record<string, unknown> | undefined;
    const version = parseNumber(body?.version);
    if (version === null) throw invalid("version", fieldErrors.onlyLatestVersion);
    const testerRows = await sql<{ version: number; row: number }>(
      `SELECT version, row FROM testers WHERE pattern_id = $1 AND user_id = $2`,
      [patternId, user.id],
    );
    const tester = testerRows[0];
    if (!tester) throw notFound();
    const latestRows = await sql<{ version: number }>(
      `SELECT version FROM versions WHERE pattern_id = $1 ORDER BY version DESC LIMIT 1`,
      [patternId],
    );
    const latest = latestRows[0]?.version ?? 0;
    if (version !== latest) throw invalid("version", fieldErrors.onlyLatestVersion);
    const chartRows = await sql<StoredVersion>(
      `SELECT version, chart FROM versions WHERE pattern_id = $1 AND version = $2`,
      [patternId, version],
    );
    const newChart = chartRows[0];
    if (!newChart) throw notFound();
    let movedFrom: number | null = null;
    let row = tester.row;
    if (row > newChart.chart.height) {
      movedFrom = row;
      row = newChart.chart.height;
    }
    await sql(`UPDATE testers SET version = $1, row = $2 WHERE pattern_id = $3 AND user_id = $4`, [
      version,
      row,
      patternId,
      user.id,
    ]);
    await hub.setCounter(patternId, user.id, row);
    sendRows(res, 200, { version, row, movedFrom });
    return true;
  });

  route("GET", "/api/patterns/<id>/counter", true, async (_req: IncomingMessage, res: ServerResponse, match: RouteMatch, userRaw: SessionUser | null) => {
    const user = requireUser(userRaw);
    const patternId = match.params['id'];
    const testerRows = await sql<{ version: number; row: number }>(
      `SELECT version, row FROM testers WHERE pattern_id = $1 AND user_id = $2`,
      [patternId, user.id],
    );
    const tester = testerRows[0];
    if (!tester) throw notFound();
    const chartRows = await sql<{ chart: StoredChart }>(
      `SELECT chart FROM versions WHERE pattern_id = $1 AND version = $2`,
      [patternId, tester.version],
    );
    const total = chartRows[0]?.chart.height ?? tester.row;
    const row = await hub.loadCounter(patternId, user.id, tester.row);
    sendRows(res, 200, { row, version: tester.version, total });
    return true;
  });

  route("POST", "/api/patterns/<id>/counter", true, async (req: IncomingMessage, res: ServerResponse, match: RouteMatch, userRaw: SessionUser | null) => {
    const user = requireUser(userRaw);
    const patternId = match.params['id'];
    const body = (await readBody(req, res)).body as Record<string, unknown> | undefined;
    const from = parseNumber(body?.from);
    const step = parseNumber(body?.step);
    const stepId = parseString(body?.stepId);
    if (from === null) throw invalid("from", "Give the row you are stepping from.");
    if (step !== 1 && step !== -1) throw invalid("step", "Step by 1 or -1.");
    if (stepId === "") throw invalid("stepId", "Give a stepId.");
    const testerRows = await sql<{ version: number; row: number }>(
      `SELECT version, row FROM testers WHERE pattern_id = $1 AND user_id = $2`,
      [patternId, user.id],
    );
    const tester = testerRows[0];
    if (!tester) throw notFound();
    const replay = await sql<{ response: unknown }>(
      `SELECT response FROM steps WHERE step_id = $1 AND pattern_id = $2 AND user_id = $3`,
      [stepId, patternId, user.id],
    );
    if (replay[0]) {
      sendRows(res, 200, replay[0].response);
      return true;
    }
    const chartRows = await sql<{ chart: StoredChart }>(
      `SELECT chart FROM versions WHERE pattern_id = $1 AND version = $2`,
      [patternId, tester.version],
    );
    const height = chartRows[0]?.chart.height ?? tester.row;
    const moved = await hub.compareCounter(patternId, user.id, from, step ?? 0, tester.row, { min: 1, max: height });
    const row = moved.moved ? moved.row : await hub.loadCounter(patternId, user.id, tester.row);
    await sql(`UPDATE testers SET row = $1 WHERE pattern_id = $2 AND user_id = $3`, [row, patternId, user.id]);
    const response = { row };
    await sql(
      `INSERT INTO steps (step_id, pattern_id, user_id, response) VALUES ($1, $2, $3, $4)
       ON CONFLICT (step_id) DO NOTHING`,
      [stepId, patternId, user.id, JSON.stringify(response)],
    );
    if (moved.moved) {
      hub.publish(patternId, { type: "counter", userId: user.id, row });
    }
    sendRows(res, 200, response);
    return true;
  });

  route("POST", "/api/patterns/<id>/notes", true, async (req: IncomingMessage, res: ServerResponse, match: RouteMatch, userRaw: SessionUser | null) => {
    const user = requireUser(userRaw);
    const patternId = match.params['id'];
    const body = (await readBody(req, res)).body as Record<string, unknown> | undefined;
    const row = parseNumber(body?.row);
    const text = parseString(body?.text);
    const testerRows = await sql<{ version: number; row: number }>(
      `SELECT version, row FROM testers WHERE pattern_id = $1 AND user_id = $2`,
      [patternId, user.id],
    );
    const tester = testerRows[0];
    if (!tester) throw notFound();
    if (row === null || row < 1) throw invalid("row", "Give the note's row.");
    const textError = noteTextError(text);
    if (textError) throw invalid(textError.field, textError.message);
    const noteId = randomId("note");
    await sql(
      `INSERT INTO notes (id, pattern_id, user_id, version, row, text) VALUES ($1, $2, $3, $4, $5, $6)`,
      [noteId, patternId, user.id, tester.version, row, text],
    );
    const pattern = await loadPattern(patternId);
    const owner = await sql<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [pattern?.owner_id ?? ""]);
    if (owner[0] && pattern) {
      try {
        await mailer.send(owner[0].email, `Note on row ${row} of ${pattern.name}`, text);
      } catch {
        // the note stands even when its notice cannot be sent
      }
    }
    const notesCount = await sql<{ count: string }>(
      `SELECT count(*) AS count FROM notes WHERE pattern_id = $1 AND user_id = $2`,
      [patternId, user.id],
    );
    hub.publish(patternId, {
      type: "note",
      userId: user.id,
      testerName: user.name,
      row,
      text,
      version: tester.version,
      notes: Number(notesCount[0]?.count ?? 0),
    });
    sendRows(res, 201, { id: noteId, row, text, version: tester.version });
    return true;
  });

  route("GET", "/api/patterns/<id>/notes", true, async (_req: IncomingMessage, res: ServerResponse, match: RouteMatch, userRaw: SessionUser | null) => {
    const user = requireUser(userRaw);
    const patternId = match.params['id'];
    const pattern = await loadPattern(patternId);
    if (!pattern) throw notFound();
    const isDesigner = pattern.owner_id === user.id || (await isCoDesigner(patternId, user.id));
    const isTester = await isTesterOf(patternId, user.id);
    if (!isDesigner && !isTester) throw notFound();
    if (isDesigner) {
      const rows = await sql<{ row: number; text: string; tester: string; version: number; created_at: Date }>(
        `SELECT n.row, n.text, u.name AS tester, n.version, n.created_at FROM notes n
         JOIN users u ON u.id = n.user_id WHERE n.pattern_id = $1 ORDER BY n.row, n.created_at`,
        [patternId],
      );
      sendRows(res, 200, {
        notes: rows.map((row) => ({ row: row.row, text: row.text, tester: row.tester, version: row.version })),
      });
      return true;
    }
    const rows = await sql<{ row: number; text: string; version: number; created_at: Date }>(
      `SELECT row, text, version, created_at FROM notes WHERE pattern_id = $1 AND user_id = $2 ORDER BY row, created_at`,
      [patternId, user.id],
    );
    sendRows(res, 200, {
      notes: rows.map((row) => ({ row: row.row, text: row.text, tester: user.name, version: row.version })),
    });
    return true;
  });
}

class ApiMailError extends Error {}

class ApiInvalidCredentials extends Error {}

async function isCoDesigner(patternId: string, userId: string): Promise<boolean> {
  const rows = await sql<{ user_id: string }>(
    `SELECT user_id FROM co_designers WHERE pattern_id = $1 AND user_id = $2`,
    [patternId, userId],
  );
  return rows.length > 0;
}

async function isTesterOf(patternId: string, userId: string): Promise<boolean> {
  const rows = await sql<{ user_id: string }>(
    `SELECT user_id FROM testers WHERE pattern_id = $1 AND user_id = $2`,
    [patternId, userId],
  );
  return rows.length > 0;
}

export { ApiMailError, ApiInvalidCredentials };
