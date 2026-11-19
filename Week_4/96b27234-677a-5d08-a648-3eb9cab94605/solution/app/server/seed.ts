import { tx, query } from "./db.js";
import { createWorld } from "./world.js";
import { storageReachable } from "./storage.js";
import { valkeyReachable } from "./valkey.js";

const SEED = {
  people: [
    { key: "wren", email: "wren@hearthtile.example", password: "lantern-wren-01", displayName: "Wren Okafor", timeZone: "America/New_York", siteRole: "member", avatar: "fox" },
    { key: "tomas", email: "tomas@hearthtile.example", password: "lantern-tomas-02", displayName: "Tomas Vale", timeZone: "Europe/London", siteRole: "member", avatar: "heron" },
    { key: "imke", email: "imke@hearthtile.example", password: "lantern-imke-03", displayName: "Imke Dorn", timeZone: "Europe/Berlin", siteRole: "member", avatar: "walker" },
    { key: "priya", email: "priya@hearthtile.example", password: "lantern-priya-04", displayName: "Priya Nand", timeZone: "Asia/Kolkata", siteRole: "moderator" },
  ],
  friendships: [["wren", "tomas"]],
  communities: [
    {
      key: "stitchers",
      name: "Thursday Stitchers",
      timeZone: "America/New_York",
      members: [{ person: "wren", role: "owner" }, { person: "tomas", role: "steward" }, { person: "imke", role: "member" }],
    },
  ],
  avatars: [{ key: "fox", name: "Paper Fox", owner: "wren", rank: "Feather" }, { key: "heron", name: "Tin Heron", owner: "wren", rank: "Linen" }, { key: "walker", name: "Moss Walker", owner: "wren", rank: "Cedar" }],
  rooms: [
    {
      key: "loft",
      name: "Quilt Loft",
      owner: "wren",
      rank: "Feather",
      layout: {
        width: 12, height: 12, spawn: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }], walls: [{ x: 3, y: 3 }, { x: 8, y: 8 }],
        seats: [{ id: "seat-1", x: 5, y: 2 }], exits: [{ id: "exit-1", x: 0, y: 6 }],
      },
    },
    {
      key: "porch",
      name: "Reading Porch",
      owner: "wren",
      rank: "Feather",
      layout: { width: 8, height: 8, spawn: [{ x: 1, y: 1 }], walls: [{ x: 4, y: 4 }], seats: [{ id: "seat-1", x: 6, y: 2 }], exits: [{ id: "exit-1", x: 7, y: 6 }] },
    },
  ],
  sessions: [
    {
      key: "quilt",
      room: "loft",
      host: "wren",
      visibility: "public",
      capacity: 12,
      community: null,
      invitees: [],
      placements: [
        { person: "wren", x: 2, y: 2, facing: "south" },
        { person: "tomas", x: 4, y: 3, facing: "west" },
        { person: "imke", x: 6, y: 5, facing: "north" },
      ],
    },
  ],
  gatherings: [
    { key: "stitch-in", community: "stitchers", title: "Thursday Stitch-In", startsLocal: "2027-03-04T19:00", durationMinutes: 90, recurrence: "weekly", limit: 30, attending: ["wren", "imke"] },
  ],
};

const SEED_LOCK = 727002;

/** Applies the invented records once, only when every service answers, and never partly. */
async function seedOnce(): Promise<boolean> {
  if (!(await valkeyReachable()) || !(await storageReachable())) return false;
  return tx(async (client) => {
    await query("SELECT pg_advisory_xact_lock($1)", [SEED_LOCK], client);
    const done = await query("SELECT 1 FROM meta WHERE key = 'seeded'", [], client);
    if (done.length > 0) return true;
    await createWorld(SEED, "default", { newWorld: false, client });
    await query("INSERT INTO meta (key, value) VALUES ('seeded', 'yes')", [], client);
    return true;
  });
}

export function startSeeding(): void {
  const attempt = (): void => {
    seedOnce()
      .then((done) => (done ? undefined : Promise.reject(new Error("services not ready"))))
      .catch(() => setTimeout(attempt, 2000));
  };
  attempt();
}
