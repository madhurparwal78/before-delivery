/**
 * DP-17: simultaneous truckload commits on the last open hives are decided one
 * at a time — of two parallel commits exactly one wins and the other answers
 * 409 with the remaining count. Needs a running app on port 4173.
 */
import assert from "node:assert/strict";

const BASE = "http://localhost:4173";

async function session(email: string): Promise<string> {
  const response = await fetch(`${BASE}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "bloom-desk-2027" }),
  });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie")!.split(";")[0]!;
}

async function main(): Promise<void> {
  const broker = await session("dana@kettleman-pollination.example");
  const coulee = await session("sam@couleegold.example");
  const prairie = await session("ruth@prairielantern.example");

  const orchardsResponse = await fetch(`${BASE}/api/orchards`, { headers: { Cookie: broker } });
  const orchards = await orchardsResponse.json() as { id: string; name: string; blocks: { id: string }[] }[];
  const orchard = orchards.find((entry) => entry.name === "Mendota Flats West");
  assert.ok(orchard);

  const draftResponse = await fetch(`${BASE}/api/orders`, {
    method: "POST",
    headers: { Cookie: broker, "Content-Type": "application/json" },
    body: JSON.stringify({
      orchard_id: orchard.id,
      bloom_start: "2027-02-10",
      bloom_end: "2027-03-04",
      delivery_deadline: "2027-02-06",
      blocks: [{ block_id: orchard.blocks[0]!.id, hives: 80 }],
    }),
  });
  assert.equal(draftResponse.status, 201);
  const draft = await draftResponse.json() as { id: string; ref: string };
  const openResponse = await fetch(`${BASE}/api/orders/${draft.id}/open`, {
    method: "POST",
    headers: { Cookie: broker, "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(openResponse.status, 200, JSON.stringify(await openResponse.json()));

  const commit = (cookie: string, hives: number): Promise<{ status: number; body: { error?: string; remaining?: number } }> =>
    fetch(`${BASE}/api/orders/${draft.id}/drops`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ yard_name: `Race Yard ${hives}`, hives }),
    }).then(async (response) => ({ status: response.status, body: await response.json() as { error?: string; remaining?: number } }));

  // Two parallel commits that each need all 80 open hives: exactly one wins.
  const [a, b] = await Promise.all([commit(coulee, 80), commit(prairie, 80)]);
  const winners = [a, b].filter((result) => result.status === 201);
  const losers = [a, b].filter((result) => result.status === 409);
  assert.equal(winners.length, 1, JSON.stringify([a, b]));
  assert.equal(losers.length, 1, JSON.stringify([a, b]));
  assert.equal(losers[0]!.body.error, "not_enough_open_hives");
  assert.equal(losers[0]!.body.remaining, 0);

  const orderResponse = await fetch(`${BASE}/api/orders/${draft.id}`, { headers: { Cookie: broker } });
  const order = await orderResponse.json() as { status: string; hives_ordered: number; hives_committed: number };
  assert.equal(order.hives_committed, order.hives_ordered, "committed hives never exceed hives ordered");
  assert.equal(order.status, "filled");

  console.log("commit race checks passed");
}

await main().catch((error) => {
  console.error(error);
  process.exit(1);
});
