import type { Tx } from "./db.js";
import { randomId, type AppConfig } from "./config.js";

type MissionSeed = {
  mission_id: string;
  title: string;
  resident_id: string;
  reward_stamps: number;
  kind: "standard" | "rush";
  rush_slots: number | null;
  status: "live" | "draft";
  offer: string[];
  thanks: string[];
};

const MISSIONS: MissionSeed[] = [
  {
    mission_id: "lantern-oil", title: "Lantern oil for the mill", resident_id: "ottoline", reward_stamps: 5,
    kind: "standard", rush_slots: null, status: "live",
    offer: ["The mill lamps are sputtering again.", "Bring me a tin of lantern oil from the depot, would you?"],
    thanks: ["Bright as noon. Here, take these stamps."],
  },
  {
    mission_id: "seed-packets", title: "Seed packets for the gourds", resident_id: "barnaby", reward_stamps: 4,
    kind: "standard", rush_slots: null, status: "live",
    offer: ["My gourds want company.", "Fetch the seed packets with the blue string."],
    thanks: ["They'll be climbing the fence by spring."],
  },
  {
    mission_id: "star-chart", title: "A rolled star chart", resident_id: "pim", reward_stamps: 8,
    kind: "standard", rush_slots: null, status: "live",
    offer: ["The tide charts are fine, but the star charts are late.", "Mind the tube — it's older than the observatory."],
    thanks: ["Perfect. Tonight we count comets."],
  },
  {
    mission_id: "moonmelon-express", title: "Moonmelon Express", resident_id: "juniper", reward_stamps: 15,
    kind: "rush", rush_slots: 1, status: "live",
    offer: ["A moonmelon is only sweet for an hour.", "Run it to Mossy Arch before it sulks!"],
    thanks: ["Still cold! You're the fastest on Bramble."],
  },
  {
    mission_id: "kite-string", title: "Kite string for the mill", resident_id: "ottoline", reward_stamps: 6,
    kind: "standard", rush_slots: null, status: "draft",
    offer: ["The wind finally turned.", "I need the long spool of kite string."],
    thanks: ["Up she goes. Thank you, courier."],
  },
];

const STAFF: Array<{ email: string; name: string; role: "founder" | "helper" | "courier" }> = [
  { email: "wren@kitefold.example", name: "Wren", role: "founder" },
  { email: "odile@kitefold.example", name: "Odile", role: "helper" },
  { email: "tamsin@example.com", name: "Tamsin", role: "courier" },
  { email: "ravi@example.com", name: "Ravi", role: "courier" },
];

/** The seed is applied once, on the first start against an empty database, and never overwrites changes. */
export async function seedIfEmpty(tx: Tx, _cfg: AppConfig): Promise<void> {
  const { rows } = await tx.query<{ count: string }>("SELECT count(*)::text AS count FROM missions");
  if (Number(rows[0].count) > 0) return;

  await tx.query(
    `INSERT INTO settings (key, value) VALUES ('studio_zone', 'America/Vancouver'), ('site_secret', $1)
     ON CONFLICT (key) DO NOTHING`,
    [randomId("secret_")],
  );

  const courierIds: Record<string, string> = {};
  for (const person of STAFF) {
    const id = randomId("cu_");
    courierIds[person.email] = id;
    await tx.query(
      `INSERT INTO couriers (id, email, role, display_name, worn_satchel, moderation_ref)
       VALUES ($1, $2, $3, $4, 'canvas', $5)`,
      [id, person.email, person.role, person.name, randomId("mod_")],
    );
    await tx.query(`INSERT INTO satchel_ownership (courier_id, satchel_id) VALUES ($1, 'canvas')`, [id]);
  }

  // Tamsin's opening balance: two paired delivery movements, star-chart then Moonmelon Express one second later.
  const now = Date.now();
  await seedMovement(tx, courierIds["tamsin@example.com"], "star-chart", 8, new Date(now - 2000));
  await seedMovement(tx, courierIds["tamsin@example.com"], "moonmelon-express", 15, new Date(now - 1000));

  for (const m of MISSIONS) {
    await tx.query(
      `INSERT INTO missions (mission_id, title, resident_id, reward_stamps, kind, rush_slots, status, version, revision, live_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1,1,$8)`,
      [m.mission_id, m.title, m.resident_id, m.reward_stamps, m.kind, m.rush_slots, m.status, m.status === "live" ? new Date(0) : null],
    );
    await tx.query(
      `INSERT INTO mission_versions (mission_id, version, title, resident_id, reward_stamps, offer, thanks)
       VALUES ($1, 1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
      [m.mission_id, m.title, m.resident_id, m.reward_stamps, JSON.stringify(m.offer), JSON.stringify(m.thanks)],
    );
  }
}

async function seedMovement(tx: Tx, courierId: string, ref: string, amount: number, at: Date): Promise<void> {
  const movementId = randomId("mv_");
  await tx.query(
    `INSERT INTO ledger_movements (movement_id, courier_id, kind, ref, created_at) VALUES ($1,$2,'delivery',$3,$4)`,
    [movementId, courierId, ref, at],
  );
  await tx.query(
    `INSERT INTO ledger_entries (movement_id, account, amount) VALUES ($1,'courier',$2),($1,'mint',$3)`,
    [movementId, amount, -amount],
  );
}
