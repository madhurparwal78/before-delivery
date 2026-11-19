import { clockStart } from "./clock.js";
import { one, pool } from "./db.js";
import { seedWorld } from "./grading.js";
import { storageReachable } from "./storage.js";

const DEMO_LOCK = 7203002;
const DEMO_PASSWORD = "mothlight-demo-2027";
const HOUR = 3_600_000;

const NIGHT: [number, number][] = [[600, 900], [800, 800], [1200, 600], [600, 1200], [900, 600], [700, 1000], [1000, 1000], [640, 960]];
const FERN: [number, number][] = [[800, 1200], [1000, 800], [1200, 700], [900, 900]];
const NIGHT_COLOURS = ["#2b3a34", "#3b4a3f", "#4a5a4c", "#1f2d2b", "#5b6b57", "#34453f", "#6d7a63", "#27382f"];
const FERN_COLOURS = ["#4f6b4a", "#6b8a5a", "#3d5a3a", "#7a9a6b"];

/**
 * The first start on a database with no people creates the demo collectors, boards and pins once,
 * with the same processing as the grading seed. Without storage it waits for the next start.
 */
export async function seedDemoContent(): Promise<void> {
  if (!storageReachable()) return;
  const lock = await pool.connect();
  try {
    const got = await lock.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [DEMO_LOCK]);
    if (!got.rows[0]?.ok) return;
    if (await one(lock, "SELECT 1 FROM users LIMIT 1")) return;
    const start = (await clockStart()).getTime();
    const pin = (key: string, owner: string, board: string, title: string, size: [number, number], colour: string, hoursBefore: number) => ({
      key, owner, board, section: null, title, description: "", alt: `${title}, a generated print`, source: null,
      image: { width: size[0], height: size[1], format: "png", color: colour },
      at: new Date(start - hoursBefore * HOUR).toISOString(),
    });
    await seedWorld({
      users: [
        { key: "wren", email: "wren@demo.mothlight.example", password: DEMO_PASSWORD, name: "Wren Hollis", handle: "wren_hollis" },
        { key: "odile", email: "odile@demo.mothlight.example", password: DEMO_PASSWORD, name: "Odile Marsh", handle: "odile_marsh" },
      ],
      boards: [
        { key: "night", owner: "wren", name: "Night studies", visibility: "public" },
        { key: "fern", owner: "odile", name: "Fern room", visibility: "public" },
      ],
      pins: [
        ...NIGHT.map((size, index) => pin(`night-${index + 1}`, "wren", "night", `Night study ${index + 1}`, size, NIGHT_COLOURS[index] ?? "#2b3a34", 4 + index + 1)),
        ...FERN.map((size, index) => pin(`fern-${index + 1}`, "odile", "fern", `Fern study ${index + 1}`, size, FERN_COLOURS[index] ?? "#4f6b4a", index + 1)),
      ],
      follows: [{ follower: "wren", user: "odile" }],
    });
  } finally {
    await lock.query("SELECT pg_advisory_unlock($1)", [DEMO_LOCK]);
    lock.release();
  }
}
