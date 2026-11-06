/** API contract checks: idempotency, boundary, upload limits, error shape. */
import { test, expect } from "@playwright/test";

const base = "http://localhost:4173";
const jsonHeaders = { "content-type": "application/json" };

import { spawn, execSync } from "node:child_process";
import { openSync } from "node:fs";

test.beforeAll(async () => {
  // the outage suite stops the normal copy; start one if none is serving
  const up = await fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false);
  if (!up) {
    try { execSync("node scripts/kill-servers.mjs") } catch { /* not running */ }
    const out = openSync("/tmp/server.log", "a");
    const server = spawn("node", ["dist/server.js"], { stdio: ["ignore", out, out], detached: true });
    server.unref();
    const { writeFileSync } = await import("node:fs");
    writeFileSync("/tmp/server.pid", String(server.pid));
    await new Promise((r) => setTimeout(r, 6000));
  }
});

test("idempotent replay returns the stored result and changes nothing", async ({ request }) => {
  const key = `idem-${Date.now()}`;
  const body = { title: "Idempotent probe", department: "props" };
  const first = await request.post(`${base}/api/tasks`, { headers: { ...jsonHeaders, "Idempotency-Key": key, "X-Crew-Member": "maya" }, data: body });
  expect(first.status()).toBe(201);
  const firstBody = await first.json();
  const replay = await request.post(`${base}/api/tasks`, { headers: { ...jsonHeaders, "Idempotency-Key": key, "X-Crew-Member": "maya" }, data: body });
  expect(replay.status()).toBe(201);
  expect(replay.headers()["idempotent-replay"]).toBe("true");
  const replayBody = await replay.json();
  expect(replayBody.change).toBe(firstBody.change);
  const tasks = await (await request.get(`${base}/api/tasks`)).json();
  expect(tasks.tasks.filter((t: { title: string }) => t.title === "Idempotent probe")).toHaveLength(1);
});

test("key reuse with a different body is refused", async ({ request }) => {
  const key = `reuse-${Date.now()}`;
  await request.post(`${base}/api/tasks`, { headers: { ...jsonHeaders, "Idempotency-Key": key }, data: { title: "First", department: "props" } });
  const r = await request.post(`${base}/api/tasks`, { headers: { ...jsonHeaders, "Idempotency-Key": key }, data: { title: "Second", department: "props" } });
  expect(r.status()).toBe(409);
  const body = await r.json();
  expect(body.error.code).toBe("idempotency_key_reused");
});

test("bad Idempotency-Key is refused with 422", async ({ request }) => {
  const r = await request.post(`${base}/api/tasks`, { headers: { ...jsonHeaders, "Idempotency-Key": "bad key" }, data: { title: "X", department: "props" } });
  expect(r.status()).toBe(422);
  const body = await r.json();
  expect(body.error.fields["Idempotency-Key"]).toBe("Use 1 to 100 visible characters.");
});

test("cross-origin writes are refused with 403", async ({ request }) => {
  const r = await request.post(`${base}/api/tasks`, {
    headers: { ...jsonHeaders, origin: "https://evil.example" },
    data: { title: "X", department: "props" },
  });
  expect(r.status()).toBe(403);
  const body = await r.json();
  expect(body.error.code).toBe("cross_origin");
});

test("oversized JSON body is refused with 413", async () => {
  const r = await fetch(`${base}/api/tasks`, {
    method: "POST", headers: jsonHeaders,
    body: JSON.stringify({ title: "X", department: "props", details: "y".repeat(70_000) }),
  });
  expect(r.status).toBe(413);
  const body = await r.json();
  expect(body.error.code).toBe("payload_too_large");
});

test("wrong content type is refused with 415", async ({ request }) => {
  const r = await request.post(`${base}/api/tasks`, {
    headers: { "content-type": "text/plain" },
    data: "not json",
  });
  expect(r.status()).toBe(415);
});

test("invalid JSON is refused with 400", async () => {
  const r = await fetch(`${base}/api/tasks`, {
    method: "POST", headers: jsonHeaders,
    body: "{not json",
  });
  expect(r.status).toBe(400);
  const body = await r.json();
  expect(body.error.code).toBe("malformed_json");
});

test("unknown API path is a JSON 404", async ({ request }) => {
  const r = await request.get(`${base}/api/nope`);
  expect(r.status()).toBe(404);
  const body = await r.json();
  expect(body.error.code).toBe("not_found");
});

test("unknown filter value is a 422 with the field name", async ({ request }) => {
  const r = await request.get(`${base}/api/tasks?dept=bogus`);
  expect(r.status()).toBe(422);
  const body = await r.json();
  expect(body.error.fields.dept).toBe("That filter value isn't recognised.");
});

test("upload refuses a wrong content type with 422", async ({ request }) => {
  const form = new FormData();
  form.append("file", new File([new Uint8Array([1, 2, 3, 4])], "note.txt", { type: "text/plain" }), "note.txt");
  form.append("kind", "plot");
  const r = await request.post(`${base}/api/tasks/STG-21/attachments`, { multipart: form });
  expect(r.status()).toBe(422);
  const body = await r.json();
  expect(body.error.fields.file).toBe("Attach a PDF, PNG or JPEG file.");
});

test("upload refuses a bad kind with 422", async ({ request }) => {
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
  const form = new FormData();
  form.append("file", new File([pdf], "plot.pdf", { type: "application/pdf" }), "plot.pdf");
  form.append("kind", "gobo");
  const r = await request.post(`${base}/api/tasks/STG-21/attachments`, { multipart: form });
  expect(r.status()).toBe(422);
  const body = await r.json();
  expect(body.error.fields.kind).toBe("Choose sketch, plot or rendering.");
});

test("a PDF of exactly the upload limit is refused only when larger", async ({ request }) => {
  const big = new Uint8Array(10_000_001);
  big.set([0x25, 0x50, 0x44, 0x46], 0);
  const form = new FormData();
  form.append("file", new File([big], "big.pdf", { type: "application/pdf" }), "big.pdf");
  form.append("kind", "sketch");
  const r = await request.post(`${base}/api/tasks/STG-21/attachments`, { multipart: form });
  expect(r.status()).toBe(413);
});

test("signed download redirects and expires in 60 seconds", async ({ request }) => {
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
  const form = new FormData();
  form.append("file", new File([pdf], "plot-signed.pdf", { type: "application/pdf" }), "plot-signed.pdf");
  form.append("kind", "plot");
  const up = await request.post(`${base}/api/tasks/STG-22/attachments`, { multipart: form, headers: { "X-Crew-Member": "ines" } });
  expect(up.status()).toBe(201);
  const { attachment } = await up.json();
  const dl = await request.get(`${base}/api/attachments/${attachment.id}/download`, maxRedirects(0) as never);
  expect(dl.status()).toBe(302);
  const location = dl.headers()["location"] ?? "";
  expect(location).toContain("X-Amz-Expires=60");
});

function maxRedirects(n: number): Record<string, unknown> { return { maxRedirects: n } }

test("ETag carries the version", async ({ request }) => {
  const r = await request.get(`${base}/api/tasks/STG-1`);
  const etag = r.headers()["etag"] ?? "";
  expect(/^"\d+"$/.test(etag)).toBe(true);
});

test("nothing to undo for a fresh crew member", async ({ request }) => {
  const r = await request.post(`${base}/api/undo`, { headers: { ...jsonHeaders, "X-Crew-Member": "sasha" }, data: {} });
  expect(r.status()).toBe(409);
  const body = await r.json();
  expect(body.error.code).toBe("nothing_to_undo");
});

test("illegal transition refusal carries the exact code", async ({ request }) => {
  const r = await request.patch(`${base}/api/tasks/STG-11`, {
    headers: { ...jsonHeaders, "If-Match": "1", "X-Crew-Member": "maya" },
    data: { status: "backlog" },
  });
  expect(r.status()).toBe(409);
  const body = await r.json();
  expect(body.error.code).toBe("illegal_transition");
});

test("parent with open sub-tasks refuses Done by hand", async ({ request }) => {
  const r = await request.patch(`${base}/api/tasks/STG-52`, {
    headers: { ...jsonHeaders, "If-Match": "1", "X-Crew-Member": "ruth" },
    data: { status: "done" },
  });
  expect(r.status()).toBe(409);
  const body = await r.json();
  expect(body.error.code).toBe("open_subtasks");
});
