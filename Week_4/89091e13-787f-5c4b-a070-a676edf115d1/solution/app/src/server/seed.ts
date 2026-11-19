import { randomBytes, randomUUID } from "node:crypto";
import { createSession, hashPassword } from "./auth.ts";
import { flushObjects } from "./blocks.ts";
import { persistClock, setProcessed } from "./clock.ts";
import { config } from "./config.ts";
import { maybeOne, pool, run } from "./db.ts";
import { advanceTo, setPaysRewards } from "./engine.ts";
import { estimateBlob } from "./fee.ts";
import { decideTally, type TallyCounts } from "./governance.ts";
import { GENESIS, bondedAccount, depositsAccount, memberAccount, post } from "./ledger.ts";
import { silenceMail } from "./outbox.ts";
import { emptyBucket } from "./storage.ts";
import { TABLES } from "./schema.ts";
import { insertBlob } from "./transactions.ts";
import { blobsInHeight } from "./views.ts";
import { UFERN_PER_FERN } from "../shared/units.ts";

const FERN = UFERN_PER_FERN;

export async function resetAll(): Promise<void> {
  await pool.query(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
  await emptyBucket().catch(() => undefined);
  setProcessed(config.startAt);
  await persistClock(pool);
}

async function insertId(sql: string, params: unknown[]): Promise<string> {
  return (await maybeOne<{ id: string }>(pool, sql, params))?.id as string;
}

const PEOPLE = {
  amara: { name: "Amara Osei", email: "amara.osei@fernhill.test" },
  felix: { name: "Felix Navarro", email: "felix.navarro@fernhill.test" },
  priya: { name: "Priya Raman", email: "priya.raman@fernhill.test" },
  jonas: { name: "Jonas Weber", email: "jonas.weber@quarry.test" },
} as const;

const VALIDATORS = [
  { key: "alder", name: "Alder", selfStake: 4000, basisPoints: 500 },
  { key: "birch", name: "Birch", selfStake: 3000, basisPoints: 1000 },
  { key: "cedar", name: "Cedar", selfStake: 2000, basisPoints: 0 },
  { key: "dogwood", name: "Dogwood", selfStake: 1000, basisPoints: 2000 },
] as const;

const ORCHARD = "00000000000000a100";
const HARBOR = "00000000000000b200";
const LANTERN = "00000000000000c300";
const LANTERN_TEXT = "Blobs are split into shares, laid in a square and extended with parity. Blobs are split into shares, laid in a square an";

interface SeedBlob {
  namespace: string;
  data: Uint8Array;
}

const bytesOf = (text: string) => new TextEncoder().encode(text);
const repeated = (letter: string, count: number) => bytesOf(letter.repeat(count));

/** Felix's history, per block, with what the producer was told to do for it. */
const HISTORY: Array<{ height: number; blobs: SeedBlob[]; nextBlock?: "withhold" | "bad-encoding" }> = [
  { height: 1, blobs: [] },
  {
    height: 2,
    blobs: [
      { namespace: ORCHARD, data: repeated("o", 60) },
      { namespace: ORCHARD, data: repeated("p", 10) },
      { namespace: HARBOR, data: repeated("h", 120) },
      { namespace: LANTERN, data: repeated("l", 20) },
    ],
  },
  { height: 3, blobs: [{ namespace: LANTERN, data: bytesOf(LANTERN_TEXT) }] },
  { height: 4, blobs: [{ namespace: HARBOR, data: repeated("h", 300) }], nextBlock: "withhold" },
  { height: 5, blobs: [{ namespace: LANTERN, data: bytesOf(LANTERN_TEXT) }], nextBlock: "bad-encoding" },
];

const MEMPOOL: SeedBlob[] = [
  { namespace: ORCHARD, data: repeated("q", 300) },
  { namespace: LANTERN, data: repeated("r", 200) },
];

interface SeedProposal {
  number: number;
  title: string;
  status: "passed" | "rejected" | "rejected_veto" | "rejected_quorum" | "failed" | "voting" | "deposit";
  depositFern: number;
  /** For a closed proposal: the final tally in FERN (yes, no, no with veto, abstain). */
  tally?: [number, number, number, number];
}

const DAY_MS = 86_400_000;

const PROPOSALS: SeedProposal[] = [
  { number: 1, title: "Raise the maximum square width to 16", status: "passed", depositFern: 100, tally: [8000, 500, 0, 1000] },
  { number: 2, title: "Lower the block time to 10 seconds", status: "rejected_veto", depositFern: 100, tally: [2000, 1000, 4000, 0] },
  { number: 3, title: "Fund a public sampling dashboard", status: "voting", depositFern: 100 },
  { number: 4, title: "Add a namespace directory", status: "deposit", depositFern: 40 },
  { number: 5, title: "Rename the Dogwood validator", status: "failed", depositFern: 40 },
  { number: 6, title: "Halve the block reward", status: "rejected_quorum", depositFern: 100, tally: [1000, 0, 0, 0] },
  { number: 7, title: "Add a second light node tier", status: "rejected", depositFern: 100, tally: [3000, 4500, 500, 500] },
];

const feeOf = (blob: SeedBlob) => estimateBlob(blob.data.length).feeUfern;

const isOpen = (p: SeedProposal) => p.status === "voting" || p.status === "deposit";

/** Amara's deposits still held by the two open proposals. */
const amaraDepositsHeld = () => PROPOSALS.filter(isOpen).reduce((sum, p) => sum + p.depositFern * FERN, 0);

interface SeedResult {
  clock: string;
  workspaces: Record<"fernhill" | "quarry", { id: string; name: string }>;
  people: Record<string, { id: string; name: string; email: string; password: string; session: string }>;
  namespaces: Record<string, { id: string; name: string; hex: string }>;
  lightNodes: Record<string, { id: string; name: string; number: number }>;
  validators: Record<"fernhill" | "quarry", Record<string, { id: string; name: string }>>;
  blobs: Record<string, Array<{ id: string; txId: string; namespace: string; size: number }>>;
  proposals: Record<string, { number: number; title: string }>;
}

/** Resets everything and builds the published seed: blocks 1-5 are produced by the real engine, then the clock rests at block 5's time. */
export async function buildSeed(): Promise<SeedResult> {
  await resetAll();
  silenceMail(true);
  setPaysRewards(false);
  try {
    return await seedHistory();
  } finally {
    setPaysRewards(true);
    silenceMail(false);
  }
}

async function seedHistory(): Promise<SeedResult> {
  const start = config.startAt;
  const at = (height: number) => new Date(start.getTime() + height * config.blockTimeMs);

  const people: SeedResult["people"] = {};
  const userIds: Record<string, string> = {};
  for (const [key, person] of Object.entries(PEOPLE)) {
    const password = `fern-${randomBytes(6).toString("hex")}`;
    const id = await insertId("INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id", [person.name, person.email, hashPassword(password)]);
    userIds[key] = id;
    people[key] = { id, name: person.name, email: person.email, password, session: await createSession(pool, id) };
  }

  const workspaces = {
    fernhill: { id: await insertId("INSERT INTO workspaces (name) VALUES ('Fernhill Labs') RETURNING id", []), name: "Fernhill Labs" },
    quarry: { id: await insertId("INSERT INTO workspaces (name) VALUES ('Quarry Labs') RETURNING id", []), name: "Quarry Labs" },
  };
  for (const [workspace, key, role] of [
    [workspaces.fernhill.id, "amara", "owner"],
    [workspaces.fernhill.id, "felix", "developer"],
    [workspaces.fernhill.id, "priya", "viewer"],
    [workspaces.quarry.id, "jonas", "owner"],
  ] as const) {
    await run(pool, "INSERT INTO members (workspace_id, user_id, role, joined_at) VALUES ($1, $2, $3, $4)", [workspace, userIds[key], role, start]);
  }

  const namespaces: SeedResult["namespaces"] = {};
  for (const [key, workspace, name, hex] of [
    ["orchard", workspaces.fernhill.id, "Orchard", ORCHARD],
    ["harbor", workspaces.fernhill.id, "Harbor", HARBOR],
    ["lantern", workspaces.fernhill.id, "Lantern", LANTERN],
    ["quarryMain", workspaces.quarry.id, "Quarry main", "00000000000000d400"],
  ] as const) {
    namespaces[key] = { id: await insertId("INSERT INTO namespaces (workspace_id, name, hex) VALUES ($1, $2, $3) RETURNING id", [workspace, name, hex]), name, hex };
  }

  const genesis = (workspaceId: string, to: string, amount: number) =>
    post(pool, { workspaceId, from: GENESIS, to, amount, kind: "genesis", label: "Genesis allocation", height: 0, at: start });
  const delegation = (workspaceId: string, userId: string, validatorId: string, validatorName: string, amount: number) =>
    post(pool, { workspaceId, from: memberAccount(userId), to: bondedAccount(validatorId), amount, kind: "delegation", label: `Delegation to ${validatorName}`, height: 0, at: start });

  const validators: SeedResult["validators"] = { fernhill: {}, quarry: {} };
  for (const workspace of ["fernhill", "quarry"] as const) {
    for (const v of VALIDATORS) {
      const id = await insertId(
        "INSERT INTO validators (workspace_id, name, self_stake_ufern, commission_basis_points) VALUES ($1, $2, $3, $4) RETURNING id",
        [workspaces[workspace].id, v.name, v.selfStake * FERN, v.basisPoints],
      );
      validators[workspace][v.key] = { id, name: v.name };
      await genesis(workspaces[workspace].id, bondedAccount(id), v.selfStake * FERN);
    }
  }

  const felixFees = [...HISTORY.filter((h) => h.height === 2 || h.height === 3).flatMap((h) => h.blobs)].reduce((sum, blob) => sum + feeOf(blob), 0);
  await genesis(workspaces.fernhill.id, memberAccount(userIds.amara as string), 2000 * FERN + 500 * FERN + amaraDepositsHeld());
  await genesis(workspaces.fernhill.id, memberAccount(userIds.felix as string), 5000 * FERN + 300 * FERN + felixFees);
  await genesis(workspaces.fernhill.id, memberAccount(userIds.priya as string), 100 * FERN);
  await genesis(workspaces.quarry.id, memberAccount(userIds.jonas as string), 1000 * FERN);

  for (const [user, validator, amount] of [
    [userIds.amara as string, "alder", 500],
    [userIds.felix as string, "birch", 300],
  ] as const) {
    const target = validators.fernhill[validator] as { id: string; name: string };
    await run(pool, "INSERT INTO delegations (workspace_id, user_id, validator_id, amount_ufern) VALUES ($1, $2, $3, $4)", [workspaces.fernhill.id, user, target.id, amount * FERN]);
    await delegation(workspaces.fernhill.id, user, target.id, target.name, amount * FERN);
  }

  await seedProposals(workspaces.fernhill.id, userIds.amara as string, validators.fernhill);

  const lightNodes: SeedResult["lightNodes"] = {};
  for (const [key, workspace, name, number, auto] of [
    ["wren", workspaces.fernhill.id, "Wren", 1, true],
    ["kestrel", workspaces.fernhill.id, "Kestrel", 2, false],
    ["heron", workspaces.quarry.id, "Heron", 1, true],
  ] as const) {
    lightNodes[key] = { id: await insertId("INSERT INTO light_nodes (workspace_id, name, number, auto_sample) VALUES ($1, $2, $3, $4) RETURNING id", [workspace, name, number, auto]), name, number };
  }

  const submit = (sender: string, blob: SeedBlob) =>
    insertBlob(pool, workspaces.fernhill.id, sender, { id: randomUUID(), namespace: blob.namespace, data: blob.data, feeUfern: feeOf(blob), stored: false });

  for (const entry of HISTORY) {
    if (entry.height > 1) {
      await advanceTo(new Date(at(entry.height - 1).getTime() + config.blockTimeMs / 2));
      for (const blob of entry.blobs) await submit(userIds.felix as string, blob);
      if (entry.nextBlock) await run(pool, "UPDATE workspaces SET next_block = $2 WHERE id = $1", [workspaces.fernhill.id, entry.nextBlock]);
    }
    await advanceTo(at(entry.height));
  }
  for (const blob of MEMPOOL) await submit(userIds.amara as string, blob);
  await advanceTo(new Date(at(5).getTime() + config.fraudCheckDelayMs));
  setProcessed(at(5));
  await persistClock(pool);
  await flushObjects();

  const blobsAt = async (height: number | null) =>
    (await blobsInHeight(pool, workspaces.fernhill.id, height)).map((b) => ({ id: b.id, txId: b.txId, namespace: b.namespace, size: b.size }));
  return {
    clock: at(5).toISOString(),
    workspaces,
    people,
    namespaces,
    lightNodes,
    validators,
    blobs: { block2: await blobsAt(2), block3: await blobsAt(3), block4: await blobsAt(4), block5: await blobsAt(5), mempool: await blobsAt(null) },
    proposals: Object.fromEntries(PROPOSALS.map((p) => [String(p.number), { number: p.number, title: p.title }])),
  };
}

/** Proposals 1-7 as the seed states them; the closed ones are written in their final state (their deposits were settled before this ledger began). */
async function seedProposals(workspaceId: string, amara: string, validators: Record<string, { id: string }>): Promise<void> {
  const start = config.startAt;
  const voting3End = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), start.getUTCHours(), 6, 15));
  const deposit4End = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), start.getUTCHours(), 4, 35));
  for (const p of PROPOSALS) {
    const counts: TallyCounts | undefined = p.tally && { yes: p.tally[0] * FERN, no: p.tally[1] * FERN, noWithVeto: p.tally[2] * FERN, abstain: p.tally[3] * FERN, totalBonded: 10_800 * FERN };
    if (counts && decideTally(counts) !== p.status) throw new Error(`seed tally of proposal ${p.number} does not decide ${p.status}`);
    const closedAt = new Date(start.getTime() - (8 - p.number) * DAY_MS);
    const depositEndsAt = p.status === "voting" ? new Date(voting3End.getTime() - config.votingPeriodMs) : p.status === "deposit" ? deposit4End : closedAt;
    const votingEndsAt = p.status === "voting" ? voting3End : counts ? closedAt : null;
    await run(
      pool,
      `INSERT INTO proposals (workspace_id, number, title, description, status, deposit_ufern, deposit_ends_at, voting_ends_at, final_tally)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [workspaceId, p.number, p.title, `${p.title}. A signalling proposal: it changes no parameter.`, p.status, p.depositFern * FERN, depositEndsAt, votingEndsAt, counts ? JSON.stringify(counts) : null],
    );
    if (!isOpen(p)) continue;
    await run(pool, "INSERT INTO proposal_deposits (workspace_id, number, user_id, amount_ufern) VALUES ($1, $2, $3, $4)", [workspaceId, p.number, amara, p.depositFern * FERN]);
    await post(pool, {
      workspaceId, from: memberAccount(amara), to: depositsAccount(p.number), amount: p.depositFern * FERN, kind: "deposit",
      label: `Deposit on proposal ${p.number}`, height: 0, at: start,
    });
  }
  for (const [voter, option] of [
    [`validator:${validators.alder?.id}`, "yes"],
    [`validator:${validators.birch?.id}`, "no_with_veto"],
    [`validator:${validators.cedar?.id}`, "no"],
    [`member:${amara}`, "yes"],
  ] as const) {
    await run(pool, "INSERT INTO votes (workspace_id, number, voter, option) VALUES ($1, 3, $2, $3)", [workspaceId, voter, option]);
  }
}
