/** The read-only share routes: `/api/share/<token>/...` and the `/s/<token>` page. */

import { isoInstant } from "../../shared/doy.js";
import { pages } from "../../shared/copy.js";
import { gone, notFound, rateLimited, readOnly } from "../errors.js";
import { header, sendError, sendHtml, sendJson, type Context } from "../http/context.js";
import { appShell, fixedPage } from "../html.js";
import { countShareRequest, RATE_LIMIT, RATE_WINDOW_SECONDS } from "../services/cache.js";
import { pool } from "../db/pool.js";
import {
  findMissionRow,
  findPassRow,
  loadEvents,
  loadLandmarks,
  loadPerilune,
  loadReference,
  loadSpeakers,
  loadTrack,
  loadTranscript,
  type MissionRow,
} from "../domain/missionRead.js";
import { findShareLink, shareLinkState, type ShareLinkRow } from "../domain/share.js";
import { eventsCsv } from "../domain/eventsCsv.js";
import {
  etagOf,
  methods,
  readUnits,
  sendCapture,
  sendDossier,
  sendFrames,
  sendSearch,
} from "./common.js";
import { shareStream } from "./streams.js";

type Resolved = { link: ShareLinkRow; mission: MissionRow };

/** Counts the request and applies rungs 1 to 4; the page variant answers in HTML. */
async function resolve(
  context: Context,
  token: string,
  html: boolean,
): Promise<Resolved | null> {
  context.extraHeaders["cache-control"] = "no-store";
  const link = await findShareLink(pool, token);
  if (!link) {
    if (html) {
      sendHtml(context, 404, fixedPage(pages.unknownLink.heading, pages.unknownLink.line));
      return null;
    }
    throw notFound();
  }
  const decision = await countShareRequest(token);
  if (decision) {
    if (!decision.allowed) {
      const headers = {
        "retry-after": String(decision.resetSeconds),
        "ratelimit-policy": `${RATE_LIMIT};w=${RATE_WINDOW_SECONDS}`,
        ratelimit: `limit=${RATE_LIMIT}, remaining=0, reset=${decision.resetSeconds}`,
      };
      if (html) {
        sendHtml(context, 429, fixedPage(pages.rateLimited.heading, pages.rateLimited.line), {
          ...headers,
        });
        return null;
      }
      throw rateLimited(headers);
    }
    context.extraHeaders["ratelimit-policy"] = `${RATE_LIMIT};w=${RATE_WINDOW_SECONDS}`;
    context.extraHeaders.ratelimit =
      `limit=${RATE_LIMIT}, remaining=${decision.remaining}, reset=${decision.resetSeconds}`;
  }
  const state = shareLinkState(link, Date.now());
  if (state !== "active") {
    const page = state === "revoked" ? pages.revoked : pages.expired;
    if (html) {
      sendHtml(context, 410, fixedPage(page.heading, page.line));
      return null;
    }
    throw gone(state === "revoked" ? "link_revoked" : "link_expired");
  }
  const mission = await findMissionRow(pool, link.mission_id);
  if (!mission) {
    if (html) {
      sendHtml(context, 404, fixedPage(pages.unknownLink.heading, pages.unknownLink.line));
      return null;
    }
    throw notFound();
  }
  return { link, mission };
}

export async function sharePage(context: Context, rest: string[]): Promise<void> {
  if (rest.length !== 1) {
    sendHtml(context, 404, fixedPage(pages.notFound.heading, pages.notFound.line));
    return;
  }
  const resolved = await resolve(context, rest[0], true);
  if (!resolved) {
    return;
  }
  if (context.method !== "GET" && context.method !== "HEAD") {
    sendError(context, readOnly());
    return;
  }
  sendHtml(
    context,
    200,
    appShell({
      title: `${resolved.mission.name} \u00b7 Perilune Ledger`,
      screen: "share",
      token: rest[0],
    }),
  );
}

export async function shareApi(
  context: Context,
  token: string,
  rest: string[],
): Promise<void> {
  const resolved = await resolve(context, token, false);
  if (!resolved) {
    return;
  }
  const { link, mission } = resolved;
  const route = rest.join("/");
  if (context.method !== "GET" && context.method !== "HEAD") {
    throw readOnly();
  }
  switch (route) {
    case "":
      return methods(
        context,
        { GET: async (ctx) => shareMission(ctx, link, mission) },
        { shareRoute: true },
      );
    case "track":
      return methods(
        context,
        {
          GET: async (ctx) =>
            sendJson(ctx, 200, { samples: await loadTrack(pool, mission.id) }),
        },
        { shareRoute: true },
      );
    case "transcript":
      return methods(
        context,
        {
          GET: async (ctx) =>
            sendJson(ctx, 200, { lines: await loadTranscript(pool, mission.id) }),
        },
        { shareRoute: true },
      );
    case "speakers":
      return methods(
        context,
        {
          GET: async (ctx) =>
            sendJson(ctx, 200, { speakers: await loadSpeakers(pool, mission.id) }),
        },
        { shareRoute: true },
      );
    case "events":
      return methods(
        context,
        {
          GET: async (ctx) => {
            sendJson(ctx, 200, { events: await loadEvents(pool, mission.id, false) });
          },
        },
        { shareRoute: true },
      );
    case "frames":
      return methods(context, { GET: async (ctx) => sendFrames(ctx, mission) }, {
        shareRoute: true,
      });
    case "search":
      return methods(context, { GET: async (ctx) => sendSearch(ctx, mission) }, {
        shareRoute: true,
      });
    case "stream":
      return methods(
        context,
        {
          GET: async (ctx) => shareStream(ctx, link, header(ctx, "last-event-id")),
        },
        { shareRoute: true },
      );
    case "events.csv":
      return methods(context, { GET: async (ctx) => shareCsv(ctx, mission) }, {
        shareRoute: true,
      });
    case "dossier.pdf":
      return methods(
        context,
        {
          GET: async (ctx) =>
            sendDossier(ctx, mission, readUnits(ctx, mission, { strict: true }), false),
        },
        { shareRoute: true },
      );
    default:
      break;
  }
  if (rest.length === 2 && rest[0] === "captures") {
    const pass = await findPassRow(pool, rest[1]);
    if (!pass || pass.mission_id !== mission.id || pass.state !== "parsed") {
      throw notFound();
    }
    await methods(context, { GET: async (ctx) => sendCapture(ctx, mission, pass) }, {
      shareRoute: true,
    });
    return;
  }
  throw notFound();
}

async function shareMission(
  context: Context,
  link: ShareLinkRow,
  mission: MissionRow,
): Promise<void> {
  const [perilune, reference, landmarks] = await Promise.all([
    loadPerilune(pool, mission.id),
    loadReference(pool, mission),
    loadLandmarks(pool, mission.id),
  ]);
  const passes = await pool.query<{
    id: string;
    filename: string;
    size_bytes: number;
    sha256: string;
    sample_count: number;
    transcript_line_count: number;
  }>(
    `select id, filename, size_bytes, sha256, sample_count, transcript_line_count
     from passes where mission_id = $1 and state = 'parsed' order by upload_seq`,
    [mission.id],
  );
  const samples = await pool.query<{ count: number }>(
    "select count(*)::int as count from samples where mission_id = $1",
    [mission.id],
  );
  sendJson(context, 200, {
    mission: {
      name: mission.name,
      epoch_utc: isoInstant(mission.epoch_ms),
      distance_unit: mission.distance_unit,
      speed_unit: mission.speed_unit,
      sample_count: samples.rows[0].count,
      perilune,
      reference,
      change_version: mission.change_version,
    },
    passes: passes.rows,
    landmarks,
    expires_utc: isoInstant(link.expires_ms),
  });
}

async function shareCsv(context: Context, mission: MissionRow): Promise<void> {
  const units = readUnits(context, mission, { strict: true });
  const events = await loadEvents(pool, mission.id, false);
  const body = Buffer.from(
    eventsCsv(events, units.distanceUnit, units.speedUnit),
    "utf8",
  );
  context.response.writeHead(200, {
    ...context.extraHeaders,
    "content-type": "text/csv; charset=utf-8; header=present",
    "content-length": body.length,
    "content-disposition": 'attachment; filename="events.csv"',
    etag: etagOf(body),
  });
  context.response.end(context.method === "HEAD" ? undefined : body);
}
