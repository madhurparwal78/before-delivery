import type { IncomingMessage, ServerResponse } from "node:http";
import { env, sql } from "../common/env";
import type { StoredChart } from "./db/store";
import { token as randomToken, id as randomId, hashPassword } from "./db/store";
import { checkChart } from "./chart/check";
import {
  invalid,
  notFound,
  parseString,
  readBody,
  route,
  sendRows,
  type RouteMatch,
} from "./routes";
import type { Mailer } from "./mail/mailer";
import type { LiveHub } from "./live/hub";

export interface GradingDeps {
  mailer: Mailer;
  hub: LiveHub;
}

interface SetupUser {
  email: string;
  name: string;
  password: string;
  verified: boolean;
}

interface SetupRepeat {
  id: string;
  fromCol: number;
  toCol: number;
  fromRow: number;
  toRow: number;
  times: number;
}

interface SetupColour {
  letter: string;
  name: string;
  hex: string;
}

interface SetupVersion {
  note: string;
  rows: Record<string, string>;
  colourRows: Record<string, string>;
  height: number;
  width: number;
  castOn: number;
  repeats: SetupRepeat[];
  colours: SetupColour[];
}

interface SetupTester {
  email: string;
  version: number;
  row: number;
  notes: { row: number; text: string }[];
}

interface SetupInvite {
  email: string;
  sentHoursAgo: number;
  status: string;
}

interface SetupPattern {
  key: string;
  owner: string;
  name: string;
  craft: "knit" | "crochet";
  mode: "flat" | "round";
  terms: "us" | "uk" | null;
  castOn: number;
  width: number;
  height: number;
  rows: Record<string, string>;
  colours: SetupColour[];
  colourRows: Record<string, string>;
  repeats: SetupRepeat[];
  coDesigners: string[];
  versions: SetupVersion[];
  published: boolean;
  testers: SetupTester[];
  invites: SetupInvite[];
}

/**
 * Grading setup: every record a check needs is made through this route, and it
 * never returns tokens. Each invitation sends its real mail, dated back as told.
 */
export function registerGradingRoutes(deps: GradingDeps): void {
  const mailer = deps.mailer;

  const guard = (req: IncomingMessage): boolean => {
    if (env.gradingKey === "") return false;
    return req.headers["x-grading-key"] === env.gradingKey;
  };

  route("POST", "/api/grading/setup", false, async (req: IncomingMessage, res: ServerResponse) => {
    if (!guard(req)) throw notFound();
    const bodyResult = await readBody(req, res);
    if (!bodyResult.ok) return true;
    const body = bodyResult.body as Record<string, unknown> | undefined;
    if (body === undefined) return false;
    const users = (body.users ?? []) as SetupUser[];
    const patterns = (body.patterns ?? []) as SetupPattern[];
    const userIds = new Map<string, string>();
    for (const user of users) {
      const email = user.email.toLowerCase();
      const existing = await sql<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email]);
      if (existing[0]) {
        await sql(`UPDATE users SET name = $1, password_hash = $2, verified = $3 WHERE id = $4`, [
          user.name,
          hashPassword(user.password),
          user.verified,
          existing[0].id,
        ]);
        userIds.set(email, existing[0].id);
        continue;
      }
      const userId = randomId("user");
      await sql(
        `INSERT INTO users (id, name, email, password_hash, verified) VALUES ($1, $2, $3, $4, $5)`,
        [userId, user.name, email, hashPassword(user.password), user.verified],
      );
      userIds.set(email, userId);
    }
    const patternIds = new Map<string, string>();
    for (const pattern of patterns) {
      const ownerId = userIds.get(pattern.owner.toLowerCase());
      if (!ownerId) throw invalid("owner", "The owner has no account.");
      const patternId = randomId("pat");
      const chart = chartFromSetup(pattern, pattern.rows, pattern.colourRows, pattern.repeats);
      await sql(
        `INSERT INTO patterns (id, owner_id, name, craft, mode, terms, cast_on, width, height, chart, state)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'draft')`,
        [
          patternId,
          ownerId,
          pattern.name,
          pattern.craft,
          pattern.mode,
          pattern.terms ?? null,
          pattern.castOn,
          pattern.width,
          pattern.height,
          JSON.stringify(chart),
        ],
      );
      for (const colour of pattern.colours.length > 0 ? pattern.colours : [{ letter: "A", name: "Main", hex: "#dce8f7" }]) {
        await sql(`INSERT INTO colours (pattern_id, letter, name, hex) VALUES ($1, $2, $3, $4)`, [
          patternId,
          colour.letter,
          colour.name,
          colour.hex,
        ]);
      }
      patternIds.set(pattern.key, patternId);
      for (const coDesigner of pattern.coDesigners ?? []) {
        const coId = userIds.get(coDesigner.toLowerCase());
        if (!coId) continue;
        await sql(`INSERT INTO co_designers (pattern_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [
          patternId,
          coId,
        ]);
      }
      for (let index = 0; index < (pattern.versions ?? []).length; index++) {
        const version = pattern.versions[index]!;
        const versionChart = versionChartFromSetup(pattern, version);
        const number = index + 1;
        await sql(
          `INSERT INTO versions (pattern_id, version, note, saved_on, stitches, chart)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [patternId, number, version.note ?? "", env.today, countStitches(versionChart), JSON.stringify(versionChart)],
        );
      }
      for (const tester of pattern.testers ?? []) {
        const testerId = userIds.get(tester.email.toLowerCase());
        if (!testerId) continue;
        await sql(
          `INSERT INTO testers (pattern_id, user_id, version, row) VALUES ($1, $2, $3, $4)
           ON CONFLICT (pattern_id, user_id) DO NOTHING`,
          [patternId, testerId, tester.version, tester.row],
        );
        await deps.hub.setCounter(patternId, testerId, tester.row);
        for (const note of tester.notes ?? []) {
          await sql(
            `INSERT INTO notes (id, pattern_id, user_id, version, row, text) VALUES ($1, $2, $3, $4, $5, $6)`,
            [randomId("note"), patternId, testerId, tester.version, note.row, note.text],
          );
        }
      }
      for (const invite of pattern.invites ?? []) {
        const inviteToken = randomToken();
        const sentAt = new Date(Date.now() - invite.sentHoursAgo * 3600 * 1000);
        const expires = new Date(sentAt.getTime() + env.limits.inviteTtlHours * 3600 * 1000);
        await sql(
          `INSERT INTO invites (token, pattern_id, email, status, sent_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [inviteToken, patternId, invite.email.toLowerCase(), invite.status, sentAt, expires],
        );
        try {
          await mailer.send(invite.email.toLowerCase(), `Test ${pattern.name} on Twinrow`, `${env.publicUrl}/invite/${inviteToken}`);
        } catch {
          // a failed invite mail does not undo the setup
        }
      }
      if (pattern.published) {
        const latest = (pattern.versions ?? []).length;
        if (latest > 0) {
          await sql(`UPDATE patterns SET state = 'published', published_version = $1 WHERE id = $2`, [
            latest,
            patternId,
          ]);
        }
      }
    }
    sendRows(res, 200, { users: Object.fromEntries(userIds), patterns: Object.fromEntries(patternIds) });
    return true;
  });

  route("POST", "/api/grading/patterns/<id>/hold-updates", false, async (req: IncomingMessage, res: ServerResponse, match: RouteMatch) => {
    if (!guard(req)) throw notFound();
    const bodyResult = await readBody(req, res);
    if (!bodyResult.ok) return true;
    const body = bodyResult.body as Record<string, unknown> | undefined;
    if (body === undefined) return false;
    const email = parseString(body.email).toLowerCase();
    const hold = body.hold === true;
    const userRows = await sql<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email]);
    const user = userRows[0];
    if (!user) throw notFound();
    const found = deps.hub.hold(match.params['id'], user.id, hold);
    sendRows(res, 200, { held: hold && found ? true : hold ? false : false });
    return true;
  });
}

function chartFromSetup(
  pattern: SetupPattern,
  rows: Record<string, string>,
  colourRows: Record<string, string>,
  repeats: SetupRepeat[],
): StoredChart {
  const cells: StoredChart["cells"] = [];
  const boxes = repeats.map((box) => ({ ...box }));
  for (let row = 1; row <= pattern.height; row++) {
    const symbols = (rows[String(row)] ?? "").split(/\s+/).filter(Boolean);
    const colours = (colourRows[String(row)] ?? "").split(/\s+/).filter(Boolean);
    for (let col = 1; col <= pattern.width; col++) {
      const box = boxes.find((entry) => row >= entry.fromRow && row <= entry.toRow && col >= entry.fromCol && col <= entry.toCol);
      cells.push({
        row,
        col,
        stitch: symbols[col - 1] ?? "ns",
        colour: colours[col - 1] ?? "A",
        repeat: box?.id,
        rev: 1,
      });
    }
  }
  return {
    craft: pattern.craft,
    mode: pattern.mode,
    terms: pattern.terms ?? null,
    castOn: pattern.castOn,
    width: pattern.width,
    height: pattern.height,
    repeats: boxes,
    cells,
  };
}

/** A saved version is a full snapshot with its own size. */
function versionChartFromSetup(
  pattern: SetupPattern,
  version: SetupVersion,
): StoredChart {
  const cells: StoredChart["cells"] = [];
  const rows = version.rows ?? {};
  const colourRows = version.colourRows ?? {};
  const boxes = (version.repeats ?? []).map((box) => ({ ...box }));
  const width = version.width ?? pattern.width;
  const height = version.height ?? pattern.height;
  const castOn = version.castOn ?? pattern.castOn;
  for (let row = 1; row <= height; row++) {
    const symbols = (rows[String(row)] ?? "").split(/\s+/).filter(Boolean);
    const colours = (colourRows[String(row)] ?? "").split(/\s+/).filter(Boolean);
    for (let col = 1; col <= width; col++) {
      const box = boxes.find((entry) => row >= entry.fromRow && row <= entry.toRow && col >= entry.fromCol && col <= entry.toCol);
      cells.push({
        row,
        col,
        stitch: symbols[col - 1] ?? "ns",
        colour: colours[col - 1] ?? "A",
        repeat: box?.id,
        rev: 1,
      });
    }
  }
  return {
    craft: pattern.craft,
    mode: pattern.mode,
    terms: pattern.terms ?? null,
    castOn,
    width,
    height,
    repeats: boxes,
    cells,
  };
}

function countStitches(chart: StoredChart): number {
  const check = checkChart({
    craft: chart.craft,
    mode: chart.mode,
    terms: chart.terms,
    castOn: chart.castOn,
    width: chart.width,
    height: chart.height,
    repeats: chart.repeats ?? [],
    cells: chart.cells.map((cell) => ({ row: cell.row, col: cell.col, stitch: cell.stitch, colour: cell.colour })),
  });
  let topMade = 0;
  for (let row = chart.height; row >= 1; row--) {
    const entry = check.byRow.get(row);
    if (entry && entry.items.length > 0) {
      topMade = entry.made;
      break;
    }
  }
  return topMade;
}
