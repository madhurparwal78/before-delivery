// Storage outage: while MinIO is unreachable, blob submission and snapshot
// download are refused with the published copy while everything else works.

import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const BASE = "http://127.0.0.1:4173";
const GRADING_KEY = process.env.GRADING_KEY ?? "gf-grading-7c19e4";
// An address nothing answers on: the server must boot and serve regardless.
const DEAD_STORAGE = "http://127.0.0.1:59999";

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

async function waitForServer(timeoutMs = 25000): Promise<void> {
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
  workspaces: { fernhill: { id: string } };
  people: Record<string, { session: string }>;
}

async function main(): Promise<void> {
  process.env.S3_ENDPOINT = DEAD_STORAGE;
  const server = spawn("node", ["dist/server/main.js"], { cwd: "/app", stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (chunk: Buffer) => process.stdout.write(chunk));
  server.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));
  try {
    await waitForServer();

    const health = (await (await fetch(`${BASE}/api/health`)).json()) as { status: string };
    check("health reports unavailable", health.status === "unavailable", health.status);

    // Grading routes work while storage is down.
    const seedResponse = await fetch(`${BASE}/api/grading/seed`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Grading-Key": GRADING_KEY },
      body: "{}",
    });
    check("seed answers 200 while storage is down", seedResponse.status === 200, seedResponse.status);
    const seedBody = (await seedResponse.json()) as Seed;
    void seedBody;

    const resetResponse = await fetch(`${BASE}/api/grading/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Grading-Key": GRADING_KEY },
      body: "{}",
    });
    check("reset answers 200 while storage is down", resetResponse.status === 200, resetResponse.status);

    // Seed again for the read checks; the new seed issues new sessions.
    const reseedResponse = await fetch(`${BASE}/api/grading/seed`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Grading-Key": GRADING_KEY },
      body: "{}",
    });
    const reseed = (await reseedResponse.json()) as Seed;
    const ws = reseed.workspaces.fernhill.id;
    const activeCookie = `fs_session=${reseed.people.amara.session}`;

    const headers = { "Content-Type": "application/json", Cookie: activeCookie };

    // The explorer, squares, roots and proofs keep working from PostgreSQL.
    const blocks = await fetch(`${BASE}/api/w/${ws}/blocks`, { headers });
    check("blocks list works during outage", blocks.status === 200, blocks.status);
    const blockBody = (await (await fetch(`${BASE}/api/w/${ws}/blocks/2`, { headers })).json()) as { dataRoot: string };
    check(
      "block roots serve from PostgreSQL",
      blockBody.dataRoot === "74394f261f82f1bf398e3de573733f5249c6eaa0b7c98ba5c3c0361e83fcbbdf",
      blockBody.dataRoot,
    );
    const shares = await fetch(`${BASE}/api/w/${ws}/blocks/2/shares`, { headers });
    check("square shares serve during outage", shares.status === 200, shares.status);
    const proofs = await fetch(`${BASE}/api/w/${ws}/blocks/2/proofs?namespace=00000000000000b200`, {
      headers,
    });
    check("proofs serve during outage", proofs.status === 200, proofs.status);

    // Blob submission is refused with the published copy.
    const blobResponse = await fetch(`${BASE}/api/w/${ws}/blobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: activeCookie },
      body: JSON.stringify({
        namespace: "00000000000000b200",
        dataBase64: Buffer.from("x".repeat(120)).toString("base64"),
        fee: "0.006654",
      }),
    });
    check("blob submit is 503 during outage", blobResponse.status === 503, blobResponse.status);
    const blobBody = (await blobResponse.json()) as { error: string };
    check(
      "blob submit outage copy",
      blobBody.error ===
        "Storage is unavailable, so blobs can't be submitted right now. The explorer still works.",
      blobBody.error,
    );

    // Snapshot download is refused with the published copy.
    const snapshotResponse = await fetch(`${BASE}/api/w/${ws}/blocks/2/snapshot`, { headers });
    check("snapshot is 503 during outage", snapshotResponse.status === 503, snapshotResponse.status);
    const snapshotBody = (await snapshotResponse.json()) as { error: string };
    check(
      "snapshot outage copy",
      snapshotBody.error === "Storage is unavailable, so the snapshot can't be downloaded right now.",
      snapshotBody.error,
    );

    // Namespace registration and staking keep working.
    const namespaceResponse = await fetch(`${BASE}/api/w/${ws}/namespaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: activeCookie },
      body: JSON.stringify({ name: "Meadow", hex: "00000000000000e500" }),
    });
    check("namespace registration works during outage", namespaceResponse.status === 201, namespaceResponse.status);

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
