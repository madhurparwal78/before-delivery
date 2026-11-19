// Live channel, idempotency, error order and storage outage behaviour.

import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";

const BASE = "http://127.0.0.1:4173";
const GRADING_KEY = process.env.GRADING_KEY ?? "gf-grading-7c19e4";
let failures = 0;
let checks = 0;

function check(name: string, condition: boolean, detail?: unknown): void {
  checks++;
  if (!condition) {
    failures++;
    console.log(`FAIL ${name}`, detail !== undefined ? JSON.stringify(detail) : "");
  } else {
    console.log(`ok   ${name}`);
  }
}

async function api(path: string, init: RequestInit = {}, cookie?: string): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`${BASE}${path}`, { ...init, headers });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

async function waitForServer(timeoutMs = 20000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) return;
    } catch {
      // retry
    }
    await delay(250);
  }
  throw new Error("server did not start");
}

interface Seed {
  workspaces: { fernhill: { id: string }; quarry: { id: string } };
  people: Record<string, { session: string }>;
  validators: Record<string, Record<string, { id: string }>>;
}

async function main(): Promise<void> {
  const server = spawn("node", ["dist/server/main.js"], { cwd: "/app", stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (chunk: Buffer) => process.stdout.write(chunk));
  server.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));
  try {
    await waitForServer();
    const seedResponse = await api("/api/grading/seed", {
      method: "POST",
      headers: { "X-Grading-Key": GRADING_KEY },
      body: JSON.stringify({}),
    });
    const seed = seedResponse.body as Seed;
    const ws = seed.workspaces.fernhill.id;
    const cookie = `fs_session=${seed.people.amara.session}`;

    // --- Live channel: the upgrade is refused without a session.
    const refused = await new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:4173/api/w/${ws}/live`);
      socket.on("open", () => resolve(socket));
      socket.on("error", (error: Error) => reject(error));
    }).then(
      () => true,
      () => false,
    );
    check("websocket refused without session", refused === false);

    // --- Live channel: a member receives block events.
    const events: unknown[] = [];
    const socket = new WebSocket(`ws://127.0.0.1:4173/api/w/${ws}/live`, {
      headers: { Cookie: cookie },
    });
    await new Promise<void>((resolve, reject) => {
      socket.on("open", () => resolve());
      socket.on("error", (error: Error) => reject(error));
    });
    socket.on("message", (data: unknown) => {
      events.push(JSON.parse(String(data)));
    });

    // Produce a block through the clock and watch for the event.
    await api("/api/grading/clock", {
      method: "POST",
      headers: { "X-Grading-Key": GRADING_KEY },
      body: JSON.stringify({ advanceMs: 15000 }),
    });
    await delay(1500);
    check("websocket delivered block event", events.some((event) => (event as { kind: string }).kind === "block"), events);
    socket.close();

    // --- Idempotency: repeating a key with the same body returns the stored response.
    const idempotentKey = `test-key-${Date.now()}`;
    const blobBody = JSON.stringify({
      namespace: "00000000000000b200",
      dataBase64: Buffer.from("x".repeat(120)).toString("base64"),
      fee: "0.006654",
    });
    const first = await fetch(`${BASE}/api/w/${ws}/blobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, "Idempotency-Key": idempotentKey },
      body: blobBody,
    });
    check("idempotent first status", first.status === 201, first.status);
    const second = await fetch(`${BASE}/api/w/${ws}/blobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, "Idempotency-Key": idempotentKey },
      body: blobBody,
    });
    check("idempotent replay status", second.status === 201, second.status);
    const different = await fetch(`${BASE}/api/w/${ws}/blobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, "Idempotency-Key": idempotentKey },
      body: JSON.stringify({
        namespace: "00000000000000b200",
        dataBase64: Buffer.from("y".repeat(120)).toString("base64"),
        fee: "0.006654",
      }),
    });
    check("idempotent conflict status", different.status === 409, different.status);
    const conflictBody = (await different.json()) as { error: string };
    check(
      "idempotent conflict copy",
      conflictBody.error === "This idempotency key was used for a different request.",
      conflictBody.error,
    );

    // --- Error order: 401 before 404, 404 before 403, 403 before 422.
    const anonymous = await api(`/api/w/${ws}/blobs`, {
      method: "POST",
      body: JSON.stringify({ namespace: "00000000000000b200", dataBase64: "eA==", fee: "1" }),
    });
    check("unauthenticated write is 401", anonymous.status === 401, anonymous.status);

    const unknownWorkspace = await api(`/api/w/unknown-workspace/blobs`, {
      method: "POST",
      body: JSON.stringify({ namespace: "00000000000000b200", dataBase64: "eA==", fee: "1" }),
    }, cookie);
    check("unknown workspace is 404", unknownWorkspace.status === 404, unknownWorkspace.status);

    const crossWorkspace = await api(`/api/w/${seed.workspaces.quarry.id}/blobs`, {
      method: "POST",
      body: JSON.stringify({ namespace: "00000000000000b200", dataBase64: "eA==", fee: "1" }),
    }, cookie);
    check("cross workspace write is 404", crossWorkspace.status === 404, crossWorkspace.status);

    const viewerCookie = `fs_session=${seed.people.priya.session}`;
    const viewerUnknown = await api(`/api/w/unknown-workspace/blobs`, {
      method: "POST",
      body: JSON.stringify({ namespace: "00000000000000b200", dataBase64: "eA==", fee: "1" }),
    }, viewerCookie);
    check("viewer on unknown workspace is 404 not 403", viewerUnknown.status === 404, viewerUnknown.status);

    const felixCookie = `fs_session=${seed.people.felix.session}`;
    const producerAttempt = await api(`/api/w/${ws}/producer`, {
      method: "PUT",
      body: JSON.stringify({ nextBlock: "nonsense" }),
    }, felixCookie);
    check("developer producer refusal is 403 not 422", producerAttempt.status === 403, producerAttempt.status);

    // --- Write content type and size rules.
    const wrongType = await fetch(`${BASE}/api/w/${ws}/blobs`, {
      method: "POST",
      headers: { "Content-Type": "text/plain", Cookie: cookie },
      body: "hello",
    });
    check("non-JSON write is 415", wrongType.status === 4415 || wrongType.status === 415, wrongType.status);
    const wrongTypeBody = (await wrongType.json()) as { error: string };
    check("non-JSON write copy", wrongTypeBody.error === "Send JSON.", wrongTypeBody.error);

    // --- Health reports the storage state.
    const health = (await api("/api/health")).body as { status: string };
    check("health ok with storage", health.status === "ok", health.status);

    console.log(`\n${checks - failures}/${checks} checks passed`);
    if (failures > 0) process.exitCode = 1;
  } finally {
    server.kill("SIGTERM");
    await delay(500);
    server.kill("SIGKILL");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
