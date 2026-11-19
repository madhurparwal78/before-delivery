import { pool, tx } from "./db.js";
import { insertFixtures, type FixtureUser } from "./fixtures.js";

const WREN: FixtureUser = {
  ref: "wren",
  email: "wren@pellwick.test",
  name: "Wren Okafor",
  password: "wren-branches-26",
  outline: [
    {
      ref: "garden", text: "Community garden build", children: [
        {
          text: "Site prep #soil", children: [
            { text: "Clear the lot", date: "2026-11-07", completed: true },
            { text: "Test soil pH #soil @Mira" },
            { mirrorOf: "compost" },
          ],
        },
        {
          text: "Planting plan", children: [
            { text: "Tomatoes #seedlings" },
            { text: "Herb spiral @Jonah", date: "2026-11-12" },
            { text: "Native wildflowers #seedlings", completed: true },
          ],
        },
        {
          text: "Volunteers", children: [
            { text: "Saturday crew @Mira" },
            { text: "Tool library sign-out", collapsed: true, children: [{ text: "Borrow the wheelbarrow", date: "2026-11-08" }] },
          ],
        },
      ],
    },
    {
      text: "Weekly errands", children: [
        { ref: "compost", text: "Buy compost bags #soil" },
        { text: "Return library books", completed: true },
      ],
    },
  ],
};

const JONAH: FixtureUser = {
  ref: "jonah",
  email: "jonah@pellwick.test",
  name: "Jonah Reyes",
  password: "jonah-branches-26",
  outline: [{ text: "Allotment notes", children: [{ text: "Plant garlic" }, { text: "Mulch delivery #soil" }] }],
};

export async function seedIfAbsent(): Promise<void> {
  await tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(7302)");
    for (const user of [WREN, JONAH]) {
      const known = await pool.query("SELECT 1 FROM accounts WHERE email = $1", [user.email]);
      if (known.rowCount === 0) await insertFixtures(client, [user]);
    }
  });
}
