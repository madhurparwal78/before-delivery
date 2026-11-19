// End-to-end verification: boots the server, seeds, and checks every published
// worked value of the seeded state, then the journeys driven through the API.

import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const BASE = "http://127.0.0.1:4173";
const GRADING_KEY = process.env.GRADING_KEY ?? "gf-grading-7c19e4";

let failures = 0;
let checks = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.log(`FAIL ${name}\n  actual   ${JSON.stringify(actual)}\n  expected ${JSON.stringify(expected)}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

function checkTrue(name: string, condition: boolean, detail?: unknown): void {
  checks++;
  if (!condition) {
    failures++;
    console.log(`FAIL ${name}`, detail !== undefined ? JSON.stringify(detail) : "");
  } else {
    console.log(`ok   ${name}`);
  }
}

async function api(
  path: string,
  init: RequestInit = {},
  cookie?: string,
): Promise<{ status: number; body: unknown; headers: Record<string, string> }> {
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
  const headersOut: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headersOut[key] = value;
  });
  return { status: response.status, body, headers: headersOut };
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
  clock: string;
  workspaces: { fernhill: { id: string; name: string }; quarry: { id: string; name: string } };
  people: Record<string, { id: string; name: string; email: string; password: string; session: string }>;
  namespaces: Record<string, { id: string; name: string; hex: string }>;
  lightNodes: Record<string, { id: string; name: string; number: number }>;
  validators: Record<string, Record<string, { id: string; name: string }>>;
  blobs: Record<string, { id: string; txId: string; namespace: string; size: number }[]>;
  proposals: Record<string, { number: number; title: string }>;
}

async function main(): Promise<void> {
  const server = spawn("node", ["dist/server/main.js"], { cwd: "/app", stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (chunk: Buffer) => process.stdout.write(chunk));
  server.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));
  try {
    await waitForServer();

    // Sign-in works and returns workspaces.
    const signIn = await api("/api/session", {
      method: "POST",
      body: JSON.stringify({ email: "amara.osei@fernhill.test", password: "amara-fernhill-2026" }),
    });
    check("sign in status", signIn.status, 200);

    // Seed.
    const seedResponse = await api("/api/grading/seed", {
      method: "POST",
      headers: { "X-Grading-Key": GRADING_KEY },
      body: JSON.stringify({}),
    });
    check("seed status", seedResponse.status, 200);
    const seed = seedResponse.body as Seed;
    const ws = seed.workspaces.fernhill.id;
    const cookie = `fs_session=${seed.people.amara.session}`;
    const felixCookie = `fs_session=${seed.people.felix.session}`;
    const priyaCookie = `fs_session=${seed.people.priya.session}`;

    // Seed shape.
    check("seed clock", seed.clock, "2026-11-06T09:01:15.000Z");
    check("workspace names", [seed.workspaces.fernhill.name, seed.workspaces.quarry.name], ["Fernhill Labs", "Quarry Labs"]);
    check(
      "people emails",
      Object.values(seed.people).map((p) => p.email).sort(),
      ["amara.osei@fernhill.test", "felix.navarro@fernhill.test", "jonas.weber@quarry.test", "priya.raman@fernhill.test"].sort(),
    );
    check(
      "namespace hexes",
      Object.values(seed.namespaces).map((n) => n.hex).sort(),
      ["00000000000000a100", "00000000000000b200", "00000000000000c300", "00000000000000d400"].sort(),
    );
    check("block2 blobs", seed.blobs.block2.map((b) => [b.namespace, b.size]), [
      ["00000000000000a100", 60],
      ["00000000000000a100", 10],
      ["00000000000000b200", 120],
      ["00000000000000c300", 20],
    ]);
    check("mempool blobs", seed.blobs.mempool.map((b) => [b.namespace, b.size]), [
      ["00000000000000a100", 300],
      ["00000000000000c300", 200],
    ]);
    check("proposal titles", Object.values(seed.proposals).map((p) => p.title), [
      "Raise the maximum square width to 16",
      "Lower the block time to 10 seconds",
      "Fund a public sampling dashboard",
      "Add a namespace directory",
      "Rename the Dogwood validator",
      "Halve the block reward",
      "Add a second light node tier",
    ]);

    // Blocks.
    const blocks = (await api(`/api/w/${ws}/blocks`, {}, cookie)).body as {
      height: number;
      blobs: number;
      squareWidth: number;
      status: string;
      dataRoot: string;
    }[];
    const byHeight = new Map(blocks.map((b) => [b.height, b]));
    check("block list heights", blocks.map((b) => b.height).sort((a, b) => a - b), [1, 2, 3, 4, 5]);
    check("block1", [byHeight.get(1)!.blobs, byHeight.get(1)!.squareWidth, byHeight.get(1)!.status], [0, 1, "available"]);
    check("block2", [byHeight.get(2)!.blobs, byHeight.get(2)!.squareWidth, byHeight.get(2)!.status], [4, 4, "available"]);
    check("block3", [byHeight.get(3)!.blobs, byHeight.get(3)!.squareWidth, byHeight.get(3)!.status], [1, 2, "available"]);
    check("block4", [byHeight.get(4)!.blobs, byHeight.get(4)!.squareWidth, byHeight.get(4)!.status], [1, 4, "rejected"]);
    check("block5", [byHeight.get(5)!.blobs, byHeight.get(5)!.squareWidth, byHeight.get(5)!.status], [1, 2, "rejected"]);
    check("block2 data root", byHeight.get(2)!.dataRoot, "74394f261f82f1bf398e3de573733f5249c6eaa0b7c98ba5c3c0361e83fcbbdf");
    check("block3 data root", byHeight.get(3)!.dataRoot, "917f4d16f69e876c76da0cdbc6f8935001e4628f279912d1cbdb1425885f23eb");

    const block2 = (await api(`/api/w/${ws}/blocks/2`, {}, cookie)).body as {
      rowRoots: { min: string; max: string; hash: string }[];
      blobs: { id: string; positions: [number, number][] }[];
    };
    check("block2 row0 root", [block2.rowRoots[0]!.min, block2.rowRoots[0]!.hash], [
      "00000000000000a100",
      "a0d9966f3fb0d09021d636825ee1e231dd1bdba95d2c27fe747d21f8a534f165",
    ]);
    check("block2 row1 root", [block2.rowRoots[1]!.min, block2.rowRoots[1]!.hash], [
      "00000000000000b200",
      "06370d2ca07b9029694bfce8f2b0e32dbb1e8e904264e06d6b3fc61afb16249a",
    ]);
    check("block2 row2 min", block2.rowRoots[2]!.min, "fffffffffffffffffe");

    // Shares.
    const shares2 = (await api(`/api/w/${ws}/blocks/2/shares`, {}, cookie)).body as {
      k: number;
      rows: { row: number; col: number; share: string | null; kind: string }[][];
    };
    checkTrue("block2 k=4", shares2.k === 4, shares2.k);
    checkTrue(
      "block2 share(0,0) prefix",
      shares2.rows[0]![0]!.share!.startsWith("00000000000000a100010000003c6f"),
    );
    checkTrue(
      "block2 share(0,0) is 50 bytes of 6f",
      shares2.rows[0]![0]!.share === "00000000000000a100010000003c" + "6f".repeat(50),
    );
    check(
      "block2 share(0,2)",
      shares2.rows[0]![2]!.share,
      "00000000000000a100010000000a" + "70".repeat(10) + "00".repeat(40),
    );

    // Proofs: Harbor on block 2.
    const proofs = (await api(`/api/w/${ws}/blocks/2/proofs?namespace=00000000000000b200`, {}, cookie)).body as {
      rows: { kind: string; start?: number; end?: number; nodes: { hash: string; span: number }[] }[];
    };
    check("proof row0 kind", proofs.rows[0]!.kind, "inclusion");
    check("proof row0 range", [proofs.rows[0]!.start, proofs.rows[0]!.end], [3, 4]);
    check(
      "proof row0 nodes",
      proofs.rows[0]!.nodes.map((n) => n.hash),
      [
        "f88cc191e709c55fd17d251db310293382646b0209a4d19a4db97a9d59bb4889",
        "586695226acd1200025e9256e1b90a222099dabdc0141448c3b2d19a8aa695e2",
        "cd5b55a6080cfcc3dec12ea9cc751cb120867ea543c76a263976141f23b98b00",
      ],
    );
    check("proof row1 range", [proofs.rows[1]!.start, proofs.rows[1]!.end], [0, 2]);
    check("proof row2 kind", proofs.rows[2]!.kind, "outside");

    // Absence proof.
    const absence = (await api(`/api/w/${ws}/blocks/2/proofs?namespace=00000000000000b100`, {}, cookie)).body as {
      rows: { kind: string; nextLeaf?: { col: number; hash: string } }[];
    };
    check("absence row0 kind", absence.rows[0]!.kind, "absence");
    check(
      "absence next leaf",
      [absence.rows[0]!.nextLeaf!.col, absence.rows[0]!.nextLeaf!.hash],
      [3, "0ddeab3716b07d5949f65557ec01cf5c07707c340db2636024b03e7530d0e78a"],
    );

    // Verify a proof on the server.
    const verify = await api(`/api/w/${ws}/blocks/2/proofs/verify`, {
      method: "POST",
      body: JSON.stringify({ proof: proofs.rows[0] }),
    }, cookie);
    checkTrue("verify row0", (verify.body as { verified: boolean }).verified === true, verify.body);

    // Wren's samples on block 2: the worked sequence's first three.
    const wrenId = seed.lightNodes.wren.id;
    const wrenSamples = (await api(`/api/w/${ws}/light-nodes/${wrenId}/samples?height=4`, {}, cookie)).body as {
      samples: { row: number; col: number; served: boolean }[];
      confidence: string;
      verdict: string;
    };
    check("wren h4 first samples", wrenSamples.samples.slice(0, 3).map((s) => [s.row, s.col]), [
      [0, 3],
      [2, 0],
      [6, 5],
    ]);
    check("wren h4 third sample withheld", wrenSamples.samples[2]!.served, false);
    check("wren h4 verdict", wrenSamples.verdict, "unavailable");
    const wrenSamples2 = (await api(`/api/w/${ws}/light-nodes/${wrenId}/samples?height=2`, {}, cookie)).body as {
      samples: { row: number; col: number }[];
      confidence: string;
      verdict: string;
    };
    check("wren h2 sample count", wrenSamples2.samples.length, 10);
    check("wren h2 verdict", wrenSamples2.verdict, "available");

    // Kestrel draws its own sequence.
    const kestrelId = seed.lightNodes.kestrel.id;
    const kestrelResponse = await api(`/api/w/${ws}/light-nodes/${kestrelId}/samples`, {
      method: "POST",
      body: JSON.stringify({ height: 2 }),
    }, felixCookie);
    check("kestrel sample status", kestrelResponse.status, 201);
    const kestrelSamples = (await api(`/api/w/${ws}/light-nodes/${kestrelId}/samples?height=2`, {}, cookie)).body as {
      samples: { row: number; col: number }[];
    };
    check("kestrel h2 first sample", [kestrelSamples.samples[0]!.row, kestrelSamples.samples[0]!.col], [6, 2]);

    // Namespaces and validators.
    const namespaces = (await api(`/api/w/${ws}/namespaces`, {}, cookie)).body as { name: string; blobCount: number }[];
    check("namespace blob counts", namespaces.map((n) => [n.name, n.blobCount]), [
      ["Orchard", 2],
      ["Harbor", 1],
      ["Lantern", 2],
    ]);
    const validators = (await api(`/api/w/${ws}/validators`, {}, cookie)).body as { name: string; shareOfBonded: string }[];
    check("validator shares", validators.map((v) => [v.name, v.shareOfBonded]), [
      ["Alder", "41.67"],
      ["Birch", "30.56"],
      ["Cedar", "18.52"],
      ["Dogwood", "9.26"],
    ]);

    // Proposal 3 live tally.
    const p3 = (await api(`/api/w/${ws}/proposals/3`, {}, cookie)).body as {
      statusText: string;
      tally: { turnout: string; vetoShare: string; yesShare: string; result: string };
    };
    check("proposal 3 state", [p3.statusText, p3.tally.turnout, p3.tally.vetoShare, p3.tally.yesShare], [
      "Voting period",
      "87.96",
      "31.58",
      "47.37",
    ]);
    check("proposal 3 projected result", p3.tally.result, "Rejected");

    // Staking: Amara's available balance holds her two held fees.
    const me = (await api(`/api/w/${ws}/staking/me`, {}, cookie)).body as {
      balanceUfern: string;
      availableUfern: string;
    };
    check("amara balance", me.balanceUfern, "2000000000");
    check("amara available", me.availableUfern, "1999986487");

    // Mempool.
    const mempool = (await api(`/api/w/${ws}/mempool`, {}, cookie)).body as { count: number };
    check("mempool count", mempool.count, 2);

    // Fraud proof on block 5.
    const fraud = (await api(`/api/w/${ws}/blocks/5/fraud-proof`, {}, cookie)).body as {
      axis: string;
      index: number;
      committedRoot: { hash: string };
      recomputedRoot: { hash: string };
    };
    check("fraud proof line", [fraud.axis, fraud.index], ["row", 0]);
    check("fraud committed root", fraud.committedRoot.hash, "e192ae6614412c74a5c3172143235d152cdbf258ddd317c74d6acc0ec835defe");
    check("fraud recomputed root", fraud.recomputedRoot.hash, "fe8ec31b23bfbc21aaccebbd8b05298542b2b4c75316cea156c65ab15882341f");

    // Snapshot downloads byte for byte: block 3 is a 4x4 extended square of
    // 64-byte shares = 16 x 64 = 1024 bytes.
    const snapshot = await fetch(`${BASE}/api/w/${ws}/blocks/3/snapshot`, { headers: { Cookie: cookie } });
    const snapshotBytes = Buffer.from(await snapshot.arrayBuffer());
    check("snapshot size", snapshotBytes.length, 1024);
    check("snapshot disposition", snapshot.headers.get("content-disposition"), 'attachment; filename="block-3-square.bin"');

    // Blob submission journey: Felix submits a 200-byte Harbor blob.
    const felixHarbor = await api(`/api/w/${ws}/blobs`, {
      method: "POST",
      body: JSON.stringify({
        namespace: "00000000000000b200",
        dataBase64: Buffer.from("h".repeat(200)).toString("base64"),
        fee: "0.006705",
      }),
    }, felixCookie);
    check("blob submit status", felixHarbor.status, 201);
    const felixBlob = felixHarbor.body as { blobId: string; shares: number; gas: number; feeUfern: string };
    check("blob shares", felixBlob.shares, 4);
    check("blob gas", felixBlob.gas, 67048);
    check("blob fee", felixBlob.feeUfern, "6705");

    const felixBlobs = (await api(`/api/w/${ws}/blobs?mine=true`, {}, felixCookie)).body as { id: string; status: string }[];
    check("felix pending blob", felixBlobs.some((b) => b.id === felixBlob.blobId && b.status === "pending"), true);

    // Produce block 6 with the clock: 15 seconds ahead.
    const clock6 = await api("/api/grading/clock", {
      method: "POST",
      headers: { "X-Grading-Key": GRADING_KEY },
      body: JSON.stringify({ advanceMs: 15000 }),
    });
    check("clock advance status", clock6.status, 200);
    const heights = (clock6.body as { heights: Record<string, number> }).heights;
    check("heights after block 6", heights[ws], 6);

    const block6 = (await api(`/api/w/${ws}/blocks/6`, {}, cookie)).body as {
      squareWidth: number;
      blobs: { id: string; positions: [number, number][] }[];
    };
    check("block6 k", block6.squareWidth, 4);
    const felixInBlock = block6.blobs.find((b) => b.id === felixBlob.blobId);
    check("felix positions", felixInBlock?.positions, [[1, 2], [1, 3], [2, 0], [2, 1]]);

    const felixBlobAfter = (await api(`/api/w/${ws}/blobs/${felixBlob.blobId}`, {}, felixCookie)).body as {
      status: string;
      height: number;
    };
    check("felix blob included", [felixBlobAfter.status, felixBlobAfter.height], ["included", 6]);

    // Namespace registration: Felix registers a new namespace.
    const newNamespace = await api(`/api/w/${ws}/namespaces`, {
      method: "POST",
      body: JSON.stringify({ name: "Meadow", hex: "00000000000000e500" }),
    }, felixCookie);
    check("namespace register", newNamespace.status, 201);

    // Duplicate registration conflicts.
    const duplicate = await api(`/api/w/${ws}/namespaces`, {
      method: "POST",
      body: JSON.stringify({ name: "Meadow again", hex: "00000000000000e500" }),
    }, felixCookie);
    check("namespace duplicate status", duplicate.status, 409);
    check("namespace duplicate copy", (duplicate.body as { error: string }).error, "Namespace 00000000000000e500 is already registered.");

    // Reserved namespace refused.
    const reserved = await api(`/api/w/${ws}/namespaces`, {
      method: "POST",
      body: JSON.stringify({ name: "Reserved", hex: "000000000000000004" }),
    }, felixCookie);
    check("reserved status", reserved.status, 422);
    check("reserved copy", (reserved.body as { errors: { hex: string } }).errors.hex, "Namespace 000000000000000004 is reserved.");

    // Role limits: the viewer cannot write.
    const viewerBlob = await api(`/api/w/${ws}/blobs`, {
      method: "POST",
      body: JSON.stringify({
        namespace: "00000000000000b200",
        dataBase64: Buffer.from("x").toString("base64"),
        fee: "0.006552",
      }),
    }, priyaCookie);
    check("viewer write status", viewerBlob.status, 403);
    check("viewer write copy", (viewerBlob.body as { error: string }).error, "Viewers can't make changes in this workspace.");

    // Producer is owner-only: Felix is refused.
    const felixProducer = await api(`/api/w/${ws}/producer`, {
      method: "PUT",
      body: JSON.stringify({ nextBlock: "withhold" }),
    }, felixCookie);
    check("developer producer status", felixProducer.status, 403);
    check("developer producer copy", (felixProducer.body as { error: string }).error, "Only the owner can change producer behaviour.");

    // Workspace isolation: Quarry's resources 404 for Amara.
    const quarry = seed.workspaces.quarry.id;
    const cross = await api(`/api/w/${quarry}/blocks/1`, {}, cookie);
    check("cross workspace 404", cross.status, 404);

    // Unreachable resource 404.
    const unknown = await api(`/api/w/${ws}/blocks/99`, {}, cookie);
    check("unknown block 404", unknown.status, 404);

    // Blob refusals in order.
    const emptyBlob = await api(`/api/w/${ws}/blobs`, {
      method: "POST",
      body: JSON.stringify({ namespace: "00000000000000b200", dataBase64: "", fee: "0.006552" }),
    }, felixCookie);
    check("empty blob status", emptyBlob.status, 422);
    check("empty blob copy", (emptyBlob.body as { errors: { data: string } }).errors.data, "A blob must contain at least 1 byte.");

    const lowFee = await api(`/api/w/${ws}/blobs`, {
      method: "POST",
      body: JSON.stringify({
        namespace: "00000000000000b200",
        dataBase64: Buffer.from("x".repeat(120)).toString("base64"),
        fee: "0.001",
      }),
    }, felixCookie);
    check("low fee status", lowFee.status, 422);
    check(
      "low fee copy",
      (lowFee.body as { errors: { fee: string } }).errors.fee,
      "Fee too low: this blob needs at least 0.006654 FERN.",
    );

    const unregistered = await api(`/api/w/${ws}/blobs`, {
      method: "POST",
      body: JSON.stringify({
        namespace: "00000000000000f100",
        dataBase64: Buffer.from("x").toString("base64"),
        fee: "0.006552",
      }),
    }, felixCookie);
    check("unregistered namespace status", unregistered.status, 422);
    check("unregistered copy", (unregistered.body as { errors: { namespace: string } }).errors.namespace, "Choose a namespace.");

    // Fee estimate.
    const estimate = (await api(`/api/w/${ws}/fee-estimate?bytes=200`, {}, cookie)).body as {
      size: number;
      shares: number;
      gas: number;
      feeUfern: string;
    };
    check("fee estimate 200 bytes", [estimate.shares, estimate.gas, estimate.feeUfern], [4, 67048, "6705"]);

    // Vote journey: Felix votes No with veto on proposal 3, included in block 9.
    const vote = await api(`/api/w/${ws}/proposals/3/votes`, {
      method: "POST",
      body: JSON.stringify({ option: "no_with_veto" }),
    }, felixCookie);
    check("vote status", vote.status, 201);
    await api("/api/grading/clock", {
      method: "POST",
      headers: { "X-Grading-Key": GRADING_KEY },
      body: JSON.stringify({ advanceMs: 15000 }),
    });
    const p3After = (await api(`/api/w/${ws}/proposals/3`, {}, cookie)).body as {
      tally: { turnout: string; vetoShare: string; result: string };
      myVote: string | null;
    };
    check("proposal 3 turnout after felix", p3After.tally.turnout, "90.74");
    check("proposal 3 veto share after felix", p3After.tally.vetoShare, "33.67");
    check("proposal 3 projected after felix", p3After.tally.result, "Rejected with veto");

    // Delegation journey: Felix delegates 1000 FERN to Cedar, included in block 7.
    const cedar = seed.validators.fernhill.cedar.id;
    const delegate = await api(`/api/w/${ws}/staking/delegate`, {
      method: "POST",
      body: JSON.stringify({ validator: cedar, amount: "1000" }),
    }, felixCookie);
    check("delegate status", delegate.status, 201);
    const felixBefore = (await api(`/api/w/${ws}/staking/me`, {}, felixCookie)).body as { balanceUfern: string; availableUfern: string };
    check(
      "felix held after delegate",
      felixBefore.availableUfern,
      "3999985295",
    );

    await api("/api/grading/clock", {
      method: "POST",
      headers: { "X-Grading-Key": GRADING_KEY },
      body: JSON.stringify({ advanceMs: 15000 }),
    });
    const felixAfter7 = (await api(`/api/w/${ws}/staking/me`, {}, felixCookie)).body as {
      balanceUfern: string;
      delegations: { validatorName: string; amountUfern: string; pendingRewardsUfern: string }[];
    };
    check(
      "felix balance moved by fee and delegation",
      felixAfter7.balanceUfern,
      (BigInt(felixBefore.balanceUfern) - 8000n - 1000000000n).toString(),
    );
    const cedarDelegation = felixAfter7.delegations.find((d) => d.validatorName === "Cedar");
    check("cedar delegation amount", cedarDelegation?.amountUfern, "1000000000");

    // Rewards accrue per block (worked: Felix's Cedar reward is 0.084745 FERN per block).
    await api("/api/grading/clock", {
      method: "POST",
      headers: { "X-Grading-Key": GRADING_KEY },
      body: JSON.stringify({ advanceMs: 15000 }),
    });
    const felixAfter8 = (await api(`/api/w/${ws}/staking/me`, {}, felixCookie)).body as {
      delegations: { validatorName: string; pendingRewardsUfern: string }[];
    };
    const cedarPending8 = felixAfter8.delegations.find((d) => d.validatorName === "Cedar")?.pendingRewardsUfern;
    check("cedar pending after block 8", cedarPending8, "84745");

    // Claim rewards: Felix claims his Birch + Cedar rewards in block 10.
    const claim = await api(`/api/w/${ws}/staking/claim`, {
      method: "POST",
      body: JSON.stringify({}),
    }, felixCookie);
    check("claim status", claim.status, 201);
    await api("/api/grading/clock", {
      method: "POST",
      headers: { "X-Grading-Key": GRADING_KEY },
      body: JSON.stringify({ advanceMs: 15000 }),
    });
    const felixAfter10 = (await api(`/api/w/${ws}/staking/me`, {}, felixCookie)).body as {
      delegations: { validatorName: string; pendingRewardsUfern: string }[];
    };
    check(
      "felix pending rewards after claim",
      felixAfter10.delegations.map((d) => [d.validatorName, d.pendingRewardsUfern]).sort(),
      [["Birch", "0"], ["Cedar", "0"]].sort(),
    );

    // Undelegate: Felix undelegates 1000 from Cedar in block 11; unbonding completes at 10:05.
    const undelegate = await api(`/api/w/${ws}/staking/undelegate`, {
      method: "POST",
      body: JSON.stringify({ validator: cedar, amount: "1000" }),
    }, felixCookie);
    check("undelegate status", undelegate.status, 201);

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
