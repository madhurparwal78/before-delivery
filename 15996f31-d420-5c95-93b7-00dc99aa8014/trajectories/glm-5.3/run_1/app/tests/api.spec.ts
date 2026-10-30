/**
 * API checks for signing and settling idempotency, the error precedence and
 * the link lifecycle. Needs a running app on port 4173 with a seeded database.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";

const BASE = "http://localhost:4173";

interface Response<T> {
  status: number;
  body: T;
}

async function call<T>(
  path: string,
  options: { method?: string; cookie?: string; body?: unknown; key?: string; raw?: string } = {},
): Promise<Response<T>> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined || options.raw !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.key) headers["Idempotency-Key"] = options.key;
  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
    headers,
    body: options.raw ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
  });
  const text = await response.text();
  let body: unknown = undefined;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  return { status: response.status, body: body as T };
}

async function signIn(email: string): Promise<string> {
  const response = await call("/api/session", { method: "POST", body: { email, password: "bloom-desk-2027" } });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const setCookie = (response.body as unknown as Record<string, never> | null) === null;
  void setCookie;
  const header = await fetch(`${BASE}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "bloom-desk-2027" }),
  }).then((r) => r.headers.get("set-cookie"));
  return header!.split(";")[0]!;
}

/** Waits for Mailpit to deliver the inspection link to the given inspector. */
async function waitMail(ref: string, to: string, timeoutMs = 15000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const messages = await fetch("http://mailpit:8025/api/v1/messages?limit=50")
      .then((response) => response.json() as Promise<{ messages: { ID: string; Subject: string; To: { Address: string }[] }[] }>);
    const match = messages.messages.find((message) =>
      message.Subject.includes(ref) && message.To.some((entry) => entry.Address === to));
    if (match) {
      const detail = await fetch(`http://mailpit:8025/api/v1/message/${match.ID}`)
        .then((response) => response.json() as Promise<{ Text: string }>);
      return detail.Text;
    }
    if (Date.now() > deadline) throw new Error(`inspection email to ${to} never arrived`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function main(): Promise<void> {
  const broker = await signIn("dana@kettleman-pollination.example");
  const coulee = await signIn("sam@couleegold.example");
  const prairie = await signIn("ruth@prairielantern.example");
  const grower = await signIn("luis@mendotaflats.example");

  // A fresh order driven through the whole lifecycle over the API.
  const orchards = (await call<{ id: string; name: string; blocks: { id: string; name: string }[] }[]>("/api/orchards", { cookie: broker })).body;
  const orchard = orchards.find((entry) => entry.name === "Mendota Flats West")!;
  const draft = (await call<{ id: string; ref: string }>("/api/orders", {
    method: "POST",
    cookie: broker,
    body: {
      orchard_id: orchard.id,
      bloom_start: "2027-02-10",
      bloom_end: "2027-03-04",
      delivery_deadline: "2027-02-06",
      blocks: [{ block_id: orchard.blocks[0]!.id, hives: 20 }, { block_id: orchard.blocks[1]!.id, hives: 20 }],
    },
  })).body;

  // Error precedence.
  const noSession = await call("/api/orders");
  assert.equal(noSession.status, 401);
  assert.deepEqual((noSession.body as { error: string }).error, "unauthenticated");
  const growerOrder = await call(`/api/orders/${draft.id}`, { cookie: grower });
  assert.equal(growerOrder.status, 404, "drafts are invisible to growers");
  const foreign = await call(`/api/orders/${draft.id}`, { cookie: coulee });
  assert.equal(foreign.status, 404, "drafts are invisible to beekeepers");
  const tooLarge = await call(`/api/orders/${draft.id}/drops`, {
    method: "POST",
    cookie: coulee,
    raw: `{"yard_name":"${"x".repeat(70000)}"}`,
  });
  assert.equal(tooLarge.status, 413);
  assert.equal((tooLarge.body as { error: string }).error, "payload_too_large");
  const wrongType = await call(`/api/orders/${draft.id}/drops`, {
    method: "POST",
    cookie: coulee,
    raw: "<xml/>",
  });
  assert.equal(wrongType.status, 415);
  assert.equal((wrongType.body as { error: string }).error, "unsupported_media_type");
  const crossOrigin = await fetch(`${BASE}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://elsewhere.example" },
    body: "{}",
  });
  assert.equal(crossOrigin.status, 403);
  assert.deepEqual((await crossOrigin.json() as { error: string }).error, "cross_origin");

  // Open, commit, deliver.
  const opened = await call<{ status: string; deposit_cents: number }>(`/api/orders/${draft.id}/open`, {
    method: "POST", cookie: broker, body: {},
  });
  assert.equal(opened.status, 200);
  assert.equal(opened.body.deposit_cents, 40 * 6000);
  const drop = (await call<{ id: string }>(`/api/orders/${draft.id}/drops`, {
    method: "POST", cookie: coulee, body: { yard_name: "River Bend Yard", hives: 20 },
  })).body;
  const delivered = await call<{ delivered_on: string }>(`/api/drops/${drop.id}/deliver`, {
    method: "POST",
    cookie: coulee,
    body: { block_id: orchard.blocks[0]!.id, delivered_at: "2026-10-29T10:00:00-07:00" },
  });
  assert.equal(delivered.status, 200);
  assert.equal(delivered.body.delivered_on, "2026-10-29", "the Pacific calendar date of the delivery time");
  const dropTwo = (await call<{ id: string }>(`/api/orders/${draft.id}/drops`, {
    method: "POST", cookie: prairie, body: { yard_name: "Prairie Bend Yard", hives: 20 },
  })).body;
  const deliveredTwo = await call(`/api/drops/${dropTwo.id}/deliver`, {
    method: "POST",
    cookie: prairie,
    body: { block_id: orchard.blocks[1]!.id, delivered_at: "2026-10-29T11:30:00-07:00" },
  });
  assert.equal(deliveredTwo.status, 200);
  const late = await call(`/api/drops/${drop.id}/deliver`, {
    method: "POST",
    cookie: coulee,
    body: { block_id: orchard.blocks[0]!.id, delivered_at: "2027-02-07T10:00:00-08:00" },
  });
  assert.equal(late.status, 409, "a delivered drop refuses a second delivery");
  const placed = await call<{ status: string }>(`/api/orders/${draft.id}/place`, {
    method: "POST", cookie: broker, body: {},
  });
  assert.equal(placed.status, 200);
  assert.equal(placed.body.status, "placed");

  // Inspection link lifecycle.
  const link = (await call<{ id: string; status: string; expires_at: string }>(`/api/orders/${draft.id}/inspection-links`, {
    method: "POST", cookie: broker, body: { inspector_email: "api.probe@example.com" },
  })).body;
  assert.equal(link.status, "issued");
  const firstMail = await waitMail(draft.ref, "api.probe@example.com");
  const token = (firstMail.split("/inspect/")[1] ?? "").split("\n")[0]?.trim() ?? "";
  const sheet = await call<{ blocks: { id: string; yards: { drop_id: string }[]; samples_required: number }[] }>(`/api/inspect/${token}`);
  assert.equal(sheet.status, 200);
  for (const blockEntry of sheet.body.blocks) {
    assert.equal(blockEntry.samples_required, 2, "samples required is delivered hives over ten, rounded up");
  }
  const block = sheet.body.blocks[0]!;
  const beforeSecondLink = await call(`/api/inspect/${token}`);
  assert.equal((beforeSecondLink.body as { link: { status: string } }).link.status, "used", "the first sheet read moves the link to used");

  // A second link expires the first.
  const linkTwo = await call(`/api/orders/${draft.id}/inspection-links`, {
    method: "POST", cookie: broker, body: { inspector_email: "api.probe2@example.com" },
  });
  assert.equal(linkTwo.status, 201);
  const deadFirst = await call(`/api/inspect/${token}`);
  assert.equal(deadFirst.status, 410);
  assert.equal((deadFirst.body as { error: string }).error, "link_expired", "a newer link expires the earlier one");
  const unknownLink = await call("/api/inspect/not-a-real-token");
  assert.equal(unknownLink.status, 404);
  assert.equal((unknownLink.body as { error: string }).error, "not_found");

  const secondMail = await waitMail(draft.ref, "api.probe2@example.com");
  const liveToken = (secondMail.split("/inspect/")[1] ?? "").split("\n")[0]?.trim() ?? "";

  // Samples and all-or-nothing signing with idempotency.
  for (const blockEntry of sheet.body.blocks) {
    for (let index = 0; index < 2; index += 1) {
      const added = await call(`/api/inspect/${liveToken}/samples`, {
        method: "POST",
        body: { block_id: blockEntry.id, drop_id: blockEntry.yards[0]!.drop_id, colony_label: `K${index + 1}`, frames: 9.5 },
      });
      assert.equal(added.status, 201);
    }
  }
  const signKey = `sign-${crypto.randomUUID()}`;
  const signBody = { inspector_name: "Ida Reed", attest: true };
  const signed = await call<{ status: string; payable_cents: number }>(`/api/inspect/${liveToken}/sign`, {
    method: "POST", body: signBody, key: signKey,
  });
  assert.equal(signed.status, 200);
  assert.equal(signed.body.payable_cents, 40 * 21450, "a 9.5 average is the Standard tier for all 40 delivered hives");
  const replay = await call<typeof signed.body>(`/api/inspect/${liveToken}/sign`, {
    method: "POST", body: signBody, key: signKey,
  });
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body, signed.body, "the same key and body replays the stored response");
  const differentBody = await call(`/api/inspect/${liveToken}/sign`, {
    method: "POST", body: { ...signBody, inspector_name: "Someone Else" }, key: signKey,
  });
  assert.equal(differentBody.status, 409);
  assert.equal((differentBody.body as { error: string }).error, "idempotency_key_reused");
  const newKeyOnSignedLink = await call(`/api/inspect/${liveToken}/sign`, {
    method: "POST", body: signBody, key: `sign-${crypto.randomUUID()}`,
  });
  assert.equal(newKeyOnSignedLink.status, 410);
  assert.equal((newKeyOnSignedLink.body as { error: string }).error, "link_signed");

  // Accept, then settle with idempotency.
  const accepted = await call(`/api/drops/${drop.id}/accept`, { method: "POST", cookie: coulee, body: {} });
  assert.equal(accepted.status, 200);
  const acceptedTwo = await call(`/api/drops/${dropTwo.id}/accept`, { method: "POST", cookie: prairie, body: {} });
  assert.equal(acceptedTwo.status, 200);
  const noKey = await call(`/api/orders/${draft.id}/settle`, { method: "POST", cookie: broker, body: {} });
  assert.equal(noKey.status, 422);
  assert.ok((noKey.body as { fields: Record<string, string> }).fields["Idempotency-Key"]);
  const settleKey = `settle-${crypto.randomUUID()}`;
  const settleBody = { payment_received_on: "2026-10-29" };
  const settled = await call<{ status: string }>(`/api/orders/${draft.id}/settle`, {
    method: "POST", cookie: broker, body: settleBody, key: settleKey,
  });
  assert.equal(settled.status, 200);
  assert.equal(settled.body.status, "settled");
  const settleReplay = await call<typeof settled.body>(`/api/orders/${draft.id}/settle`, {
    method: "POST", cookie: broker, body: settleBody, key: settleKey,
  });
  assert.equal(settleReplay.status, 200);
  assert.deepEqual(settleReplay.body, settled.body);
  const settleAgain = await call(`/api/orders/${draft.id}/settle`, {
    method: "POST", cookie: broker, body: settleBody, key: `settle-${crypto.randomUUID()}`,
  });
  assert.equal(settleAgain.status, 409);
  assert.equal((settleAgain.body as { error: string }).error, "already_settled");
  const noKeyOnSettled = await call(`/api/orders/${draft.id}/settle`, { method: "POST", cookie: broker, body: {} });
  assert.equal(noKeyOnSettled.status, 409, "state conflicts precede validation");

  console.log("api checks passed");
}

await main().catch((error) => {
  console.error(error);
  process.exit(1);
});
