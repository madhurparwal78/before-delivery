// Nightplan's server entry: HTTP + socket on one port, PostgreSQL boot, service checks and the engine.

import { createServer as createHttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseDate, parseInstant } from "../shared/zone.ts";
import type { Run } from "../shared/types.ts";
import { config } from "./config.ts";
import { pool, prepareDatabase, rows } from "./db.ts";
import { ApiError, FIELD } from "./errors.ts";
import { createHandler, json, type Context, type Route } from "./http.ts";
import { hubNow } from "./clock.ts";
import { dayPlan, householdZone, loadCalendar } from "./plan.ts";
import { broadcastStatus, currentStatus } from "./status.ts";
import { handleUpgrade } from "./socket.ts";
import { listScenes, saveScene } from "./scenes.ts";
import { listSchedules, saveSchedule, scheduleById } from "./schedules.ts";
import { changeDeviceState, listDevices, reportDevice } from "./devices.ts";
import { cancelGuestScene, createGuestScene, listGuestScenes } from "./guests.ts";
import { announceClip, clipMedia, getClip, listClips, receiveClipBytes } from "./clips.ts";
import { listNotices, wakeSender } from "./notices.ts";
import { checkStorage } from "./storage.ts";
import { checkMail } from "./mail.ts";
import { moveClock, scheduleSaved, settle, startEngine } from "./engine.ts";
import { broadcast } from "./socket.ts";

let markReady: () => void = () => undefined;
let isReady = false;
const readyPromise = new Promise<void>((resolve) => {
  markReady = () => {
    isReady = true;
    resolve();
  };
});

const bodyOf = (context: Context): unknown => (context.body.kind === "json" ? context.body.value : undefined);

/** The `day` query parameter, defaulting to the hub's today. */
async function dayParam(context: Context): Promise<string> {
  const raw = context.query.get("day");
  if (raw === null || raw === "") return (await householdZone()).day(hubNow());
  const day = parseDate(raw);
  if (!day) throw ApiError.invalid({ day: FIELD.day });
  return day;
}

const one = (id: string) => new RegExp(`^/api/${id}$`);
const ID = "([^/]+)";

const routes: Route[] = [
  {
    method: "GET", pattern: one("health"), accepts: "none", open: true,
    handle: async () => (isReady ? json(200, { status: "ok" }) : json(503, { status: "starting" })),
  },
  { method: "GET", pattern: one("status"), accepts: "none", handle: async () => json(200, await currentStatus()) },
  {
    method: "GET", pattern: one("plan"), accepts: "none",
    handle: async (context) => {
      const day = await dayParam(context);
      return json(200, dayPlan(await loadCalendar(), day));
    },
  },
  {
    method: "GET", pattern: one("rooms"), accepts: "none",
    handle: async () => {
      const found = await rows<{ id: string; name: string; order: number; device_ids: string[] }>(
        pool,
        `SELECT r.id, r.name, r.position AS order,
          coalesce(array_agg(d.id ORDER BY d.position) FILTER (WHERE d.id IS NOT NULL), '{}') AS device_ids
         FROM rooms r LEFT JOIN devices d ON d.room_id = r.id GROUP BY r.id ORDER BY r.position`,
      );
      return json(200, { rooms: found });
    },
  },
  { method: "GET", pattern: one("scenes"), accepts: "none", handle: async () => json(200, { scenes: await listScenes() }) },
  { method: "POST", pattern: one("scenes"), accepts: "json", handle: async (c) => json(201, { scene: await saveScene(null, bodyOf(c)) }) },
  {
    method: "PUT", pattern: one(`scenes/${ID}`), accepts: "json",
    handle: async (c) => json(200, { scene: await saveScene(c.params[0] as string, bodyOf(c)) }),
  },
  { method: "GET", pattern: one("schedules"), accepts: "none", handle: async () => json(200, { schedules: await listSchedules() }) },
  {
    method: "GET", pattern: one(`schedules/${ID}`), accepts: "none",
    handle: async (c) => {
      const schedule = await scheduleById(c.params[0] as string);
      if (!schedule) throw ApiError.of("not_found");
      return json(200, { schedule });
    },
  },
  {
    method: "PUT", pattern: one(`schedules/${ID}`), accepts: "json",
    handle: async (c) => {
      const { schedule, from } = await saveSchedule(c.params[0] as string, bodyOf(c));
      broadcast({ type: "schedule", schedule_id: schedule.id, revision: schedule.revision });
      await scheduleSaved(schedule.id, from);
      return json(200, { schedule });
    },
  },
  {
    method: "GET", pattern: one("devices"), accepts: "none",
    handle: async (c) => json(200, { devices: await listDevices(c.query.get("room_id") || null) }),
  },
  {
    method: "PUT", pattern: one(`devices/${ID}/state`), accepts: "json",
    handle: async (c) => json(200, { device: await changeDeviceState(c.params[0] as string, bodyOf(c)) }),
  },
  { method: "GET", pattern: one("guest-scenes"), accepts: "none", handle: async () => json(200, { guest_scenes: await listGuestScenes() }) },
  {
    method: "POST", pattern: one("guest-scenes"), accepts: "json",
    handle: async (c) => {
      const header = c.headers["idempotency-key"];
      const answer = await createGuestScene(Array.isArray(header) ? header[0] : header, bodyOf(c));
      if (answer.created) await settle();
      return json(answer.status, answer.body);
    },
  },
  {
    method: "POST", pattern: one(`guest-scenes/${ID}/cancel`), accepts: "json",
    handle: async (c) => {
      const guest_scene = await cancelGuestScene(c.params[0] as string);
      await settle();
      return json(200, { guest_scene });
    },
  },
  {
    method: "GET", pattern: one("runs"), accepts: "none",
    handle: async (c) => {
      const day = await dayParam(c);
      const zone = await householdZone();
      const found = await rows<Omit<Run, "ran_at"> & { ran_at: Date }>(
        pool,
        `SELECT id, schedule_id, version_from, slot_id, slot_time, ran_at, scene_id, room_ids
         FROM runs WHERE ran_day = $1 ORDER BY ran_at, id`,
        [day],
      );
      return json(200, { day, runs: found.map((run) => ({ ...run, ran_at: zone.iso(run.ran_at.getTime()) })) });
    },
  },
  {
    method: "GET", pattern: one("clips"), accepts: "none",
    handle: async (c) => {
      const day = await dayParam(c);
      return json(200, { day, clips: await listClips(day) });
    },
  },
  { method: "GET", pattern: one(`clips/${ID}`), accepts: "none", handle: async (c) => json(200, { clip: await getClip(c.params[0] as string) }) },
  {
    method: "GET", pattern: one(`clips/${ID}/media`), accepts: "none",
    handle: async (c) => {
      const media = await clipMedia(c.params[0] as string);
      return { status: 200, stream: media.body, type: "video/mp4", length: media.size };
    },
  },
  { method: "GET", pattern: one("notices"), accepts: "none", handle: async () => json(200, { notices: await listNotices() }) },
  {
    method: "GET", pattern: one("sim/clock"), accepts: "none",
    handle: async () => json(200, { now: (await householdZone()).iso(hubNow()) }),
  },
  {
    method: "PUT", pattern: one("sim/clock"), accepts: "json",
    handle: async (c) => {
      const body = bodyOf(c);
      const target = parseInstant(typeof body === "object" && body !== null ? (body as { now?: unknown }).now : undefined);
      if (target === null) throw ApiError.invalid({ now: FIELD.instant });
      await moveClock(target);
      return json(200, { now: (await householdZone()).iso(hubNow()) });
    },
  },
  {
    method: "POST", pattern: one(`sim/devices/${ID}/report`), accepts: "json",
    handle: async (c) => json(200, { device: await reportDevice(c.params[0] as string, bodyOf(c)) }),
  },
  {
    method: "POST", pattern: one(`sim/cameras/${ID}/clips`), accepts: "json",
    handle: async (c) => json(201, { clip: await announceClip(c.params[0] as string, bodyOf(c)) }),
  },
  {
    method: "PUT", pattern: one(`sim/clips/${ID}/bytes`), accepts: "bytes",
    handle: async (c) => json(200, { clip: await receiveClipBytes(c.params[0] as string, c.body.kind === "bytes" ? c.body.value : Buffer.alloc(0)) }),
  },
];

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "public");
const handle = await createHandler(routes, publicDir, () => readyPromise);
const server = createHttpServer((request, response) => void handle(request, response));
server.on("upgrade", (request, socket, head: Buffer) =>
  handleUpgrade(request, socket, head, async () => {
    await readyPromise;
    return { type: "status", ...(await currentStatus()) };
  }),
);
server.listen(config.port, "0.0.0.0", () => console.log(`Nightplan listening on port ${config.port}`));

await prepareDatabase();
await Promise.all([checkStorage(), checkMail()]);
await startEngine();
markReady();
console.log("Nightplan is ready");
setInterval(() => void checkStorage(), 5_000);
setInterval(() => void checkMail(), 5_000);
setInterval(() => void broadcastStatus().catch(() => undefined), 10_000);
setInterval(wakeSender, 1_000);
wakeSender();
