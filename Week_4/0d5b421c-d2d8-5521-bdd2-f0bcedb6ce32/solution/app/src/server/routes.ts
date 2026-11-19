// The published API, one entry per endpoint.
import type { FloorResponse, Rules, StatusResponse } from "../shared/api.js";
import { cancelBooking, changeBookingStatus, confirmHold, listTonightsBookings, readManage, seatWalkIn } from "./bookings.js";
import { catalog } from "./catalog.js";
import { instantIso, now, setNow } from "./clock.js";
import { config } from "./config.js";
import { dependencyState } from "./dependencies.js";
import { openStream } from "./events.js";
import { placeHold, readHold, releaseHold } from "./holds.js";
import { SESSION_COOKIE, signIn, signOut } from "./host.js";
import type { Context, Route } from "./http.js";
import { claimOffer, readOffer } from "./offers.js";
import { availability, hostFloor, plan, tonight } from "./read.js";
import { joinWaitlist } from "./waitlist.js";
import { lisbonDate } from "./lisbon.js";
import { MESSAGES, parseDate, rejectInvalid } from "./validation.js";
import type http from "node:http";

function publishedRules(): Rules {
  return { ...catalog().rules, hold_seconds: config.holdSeconds, offer_seconds: config.offerSeconds };
}

function publishedFloor(): FloorResponse {
  return {
    rooms: catalog().rooms.map((room) => ({
      room_id: room.roomId,
      name: room.name,
      seats: room.seats,
      tables: room.tables.map((table) => ({ table_id: table.tableId, min_seats: table.minSeats, max_seats: table.maxSeats })),
    })),
    joinable_pairs: catalog()
      .targets.filter((target) => target.tableIds.length === 2)
      .map((pair) => ({
        pair_id: pair.targetId,
        tables: [pair.tableIds[0] ?? "", pair.tableIds[1] ?? ""],
        min_seats: pair.minSeats,
        max_seats: pair.maxSeats,
      })),
  };
}

/** A page's first open has no Last-Event-ID; `replay_ms` (how long the page has been open, at most ten seconds) replays what it missed meanwhile. */
const MAX_REPLAY_MS = 10_000;

function lastEventId(context: Context): string | null {
  const header = context.req.headers["last-event-id"];
  if (typeof header === "string" && header !== "") return header;
  const replay = context.query.get("replay_ms") ?? "";
  if (!/^\d{1,5}$/.test(replay) || Number(replay) > MAX_REPLAY_MS) return null;
  return `${Date.now() - Number(replay)}-0`;
}

/** Holds an event stream open until the page goes away; closing it releases everything it used. */
async function streamEvents(context: Context, res: http.ServerResponse, date: string, host: boolean): Promise<void> {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  context.req.socket.setNoDelay(true);
  let closed = false;
  let close: (() => void) | undefined;
  res.on("close", () => {
    closed = true;
    close?.();
  });
  close = await openStream(date, host, (frame) => res.write(frame), lastEventId(context));
  if (closed) close();
}

const sessionCookie = (token: string, maxAge: string): string =>
  `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict${maxAge}`;

const clockRoute: Route[] = config.clockControl
  ? [
      {
        method: "PUT",
        path: "/api/clock",
        handler: async ({ body }) => {
          const instant = typeof body["now"] === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(body["now"]) ? new Date(body["now"]) : null;
          if (instant === null || Number.isNaN(instant.getTime())) throw rejectInvalid({ now: [null, MESSAGES.now] });
          setNow(instant);
          return { status: 200, body: { server_now: instantIso(now()) } };
        },
      },
    ]
  : [];

export const routes: Route[] = [
  { method: "GET", path: "/api/health", handler: async () => ({ status: 200, body: { status: "ok" } }) },
  {
    method: "GET",
    path: "/api/status",
    handler: async () => {
      const body: StatusResponse = { server_now: instantIso(now()), ...dependencyState() };
      return { status: 200, body };
    },
  },
  { method: "GET", path: "/api/rules", handler: async () => ({ status: 200, body: publishedRules() }) },
  { method: "GET", path: "/api/floor", handler: async () => ({ status: 200, body: publishedFloor() }) },
  { method: "GET", path: "/api/tonight", handler: async () => ({ status: 200, body: await tonight() }) },
  { method: "GET", path: "/api/availability", handler: async ({ query }) => ({ status: 200, body: await availability(query) }) },
  { method: "GET", path: "/api/plan", handler: async ({ query }) => ({ status: 200, body: await plan(query) }) },
  {
    method: "GET",
    path: "/api/floor/events",
    stream: async (context, res) => {
      const date = parseDate(context.query.get("date"), now());
      if (date === null) throw rejectInvalid({ date: [null, MESSAGES.date] });
      await streamEvents(context, res, date, false);
    },
  },
  { method: "POST", path: "/api/holds", handler: async ({ body }) => ({ status: 201, body: await placeHold(body) }) },
  { method: "GET", path: "/api/holds/:id", handler: async ({ params }) => ({ status: 200, body: await readHold(params["id"] ?? "") }) },
  {
    method: "DELETE",
    path: "/api/holds/:id",
    handler: async ({ params }) => {
      await releaseHold(params["id"] ?? "");
      return { status: 204 };
    },
  },
  {
    method: "POST",
    path: "/api/holds/:id/confirm",
    keyed: true,
    handler: async ({ params, body }) => ({ status: 201, body: await confirmHold(params["id"] ?? "", body) }),
  },
  { method: "GET", path: "/api/manage/:token", handler: async ({ params }) => ({ status: 200, body: await readManage(params["token"] ?? "") }) },
  {
    method: "POST",
    path: "/api/manage/:token/cancel",
    keyed: true,
    handler: async ({ params }) => ({ status: 200, body: await cancelBooking(params["token"] ?? "") }),
  },
  {
    method: "POST",
    path: "/api/waitlist",
    handler: async ({ body }) => {
      const { created, entry } = await joinWaitlist(body);
      return { status: created ? 201 : 200, body: entry };
    },
  },
  { method: "GET", path: "/api/offers/:token", handler: async ({ params }) => ({ status: 200, body: await readOffer(params["token"] ?? "") }) },
  {
    method: "POST",
    path: "/api/offers/:token/claim",
    keyed: true,
    handler: async ({ params }) => ({ status: 201, body: await claimOffer(params["token"] ?? "") }),
  },
  ...clockRoute,
  {
    method: "POST",
    path: "/api/host/session",
    handler: async ({ body }) => {
      const { session, token } = await signIn(body);
      return { status: 200, body: session, headers: { "Set-Cookie": sessionCookie(token, "") } };
    },
  },
  {
    method: "DELETE",
    path: "/api/host/session",
    host: true,
    handler: async ({ sessionToken }) => {
      await signOut(sessionToken);
      return { status: 204, headers: { "Set-Cookie": sessionCookie("", "; Max-Age=0") } };
    },
  },
  { method: "GET", path: "/api/host/floor", host: true, handler: async ({ query }) => ({ status: 200, body: await hostFloor(query) }) },
  { method: "GET", path: "/api/host/bookings", host: true, handler: async () => ({ status: 200, body: await listTonightsBookings() }) },
  {
    method: "GET",
    path: "/api/host/events",
    host: true,
    stream: async (context, res) => streamEvents(context, res, lisbonDate(now()), true),
  },
  {
    method: "POST",
    path: "/api/host/bookings/:reference/seat",
    host: true,
    handler: async ({ params }) => ({ status: 200, body: await changeBookingStatus(params["reference"] ?? "", "seat") }),
  },
  {
    method: "POST",
    path: "/api/host/bookings/:reference/clear",
    host: true,
    handler: async ({ params }) => ({ status: 200, body: await changeBookingStatus(params["reference"] ?? "", "clear") }),
  },
  {
    method: "POST",
    path: "/api/host/bookings/:reference/no-show",
    host: true,
    handler: async ({ params }) => ({ status: 200, body: await changeBookingStatus(params["reference"] ?? "", "no_show") }),
  },
  {
    method: "POST",
    path: "/api/host/walk-ins",
    host: true,
    keyed: true,
    handler: async ({ body }) => ({ status: 201, body: await seatWalkIn(body) }),
  },
];
