// The grading seed. Builds exactly the published workspaces, people, namespaces,
// validators, balances, history blocks 1-5, mempool, light nodes and proposals,
// leaving the clock at block 5's time.

import { randomBytes, scryptSync } from "node:crypto";
import {
  bytesToHex,
  dataRootOf,
  encodeBlobShares,
  extendSquare,
  hexToBytes,
  layoutSquare,
  rowRoot,
  columnRoot,
  tailPaddingShare,
  toRootRef,
  blobGas,
  feeUfern,
  shareCount,
  type RootRef,
} from "../shared/domain.js";
import type { AppConfig } from "./config.js";
import type { Db } from "./db.js";
import type { Storage } from "./storage.js";
import type { Account } from "./ledger.js";
import { ledgerPair, postPair, personAccount } from "./ledger.js";

export interface SeedResult {
  clock: string;
  workspaces: Record<string, { id: string; name: string }>;
  people: Record<string, { id: string; name: string; email: string; password: string; session: string }>;
  namespaces: Record<string, { id: string; name: string; hex: string }>;
  lightNodes: Record<string, { id: string; name: string; number: number }>;
  validators: Record<string, Record<string, { id: string; name: string }>>;
  blobs: Record<string, { id: string; txId: string; namespace: string; size: number }[]>;
  proposals: Record<string, { number: number; title: string }>;
}

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32).toString("hex");
  return { hash: `${salt}:${hash}`, salt };
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 32).toString("hex");
  return candidate.length === hash.length && timingSafeEqual(candidate, hash);
}

function timingSafeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  let diff = 0;
  for (let i = 0; i < bufferA.length; i++) diff |= bufferA[i]! ^ bufferB[i]!;
  return diff === 0;
}

function id(): string {
  return randomBytes(12).toString("hex");
}

function byteCount(text: string): number {
  return new TextEncoder().encode(text).length;
}

interface SeedBlobSpec {
  namespaceHex: string;
  data: string;
}

const LANTERN_TEXT =
  "Blobs are split into shares, laid in a square and extended with parity. Blobs are split into shares, laid in a square an";

/** Runs the full seed: resets everything, then builds the published state. */
export async function seedWorkspace(
  config: AppConfig,
  db: Db,
  storage: Storage,
  passwords: Record<string, string>,
): Promise<SeedResult> {
  const wsFernhill = `ws-${id()}`;
  const wsQuarry = `ws-${id()}`;
  const peopleIds = {
    amara: id(),
    felix: id(),
    priya: id(),
    jonas: id(),
  };
  const sessions = {
    amara: randomBytes(24).toString("hex"),
    felix: randomBytes(24).toString("hex"),
    priya: randomBytes(24).toString("hex"),
    jonas: randomBytes(24).toString("hex"),
  };
  const nsIds: Record<string, string> = {};
  const validatorIds: Record<string, string> = {};
  const nodeIds: Record<string, string> = {};

  const clockAt = new Date(config.appStartAtMs + 5 * config.blockTimeSeconds * 1000);

  const blobIds: Record<string, { id: string; txId: string; ns: string; size: number; data: string }[]> = {
    block2: [],
    block3: [],
    block4: [],
    block5: [],
    mempool: [],
  };

  await db.transaction(async (tx) => {
    const at = (height: number) => new Date(config.appStartAtMs + height * config.blockTimeSeconds * 1000);

    await tx.query(
      `INSERT INTO workspaces (id, name, slug, next_block, created_at) VALUES ($1, $2, $3, 'honest', $4)`,
      [wsFernhill, "Fernhill Labs", "fernhill", at(1)],
    );
    await tx.query(
      `INSERT INTO workspaces (id, name, slug, next_block, created_at) VALUES ($1, $2, $3, 'honest', $4)`,
      [wsQuarry, "Quarry Labs", "quarry", at(1)],
    );

    for (const [key, personId] of Object.entries(peopleIds)) {
      const email = EMAILS[key as keyof typeof EMAILS]!;
      const name = NAMES[key as keyof typeof NAMES]!;
      const { hash } = hashPassword(passwords[key] ?? "fernsquare");
      await tx.query(
        `INSERT INTO people (id, name, email, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)`,
        [personId, name, email, hash, at(1)],
      );
      await tx.query(`INSERT INTO sessions (token, person_id, created_at) VALUES ($1, $2, $3)`, [
        sessions[key as keyof typeof sessions]!,
        personId,
        at(1),
      ]);
    }

    await tx.query(
      `INSERT INTO memberships (workspace_id, person_id, role, joined_at) VALUES ($1, $2, 'owner', $3)`,
      [wsFernhill, peopleIds.amara, at(1)],
    );
    await tx.query(
      `INSERT INTO memberships (workspace_id, person_id, role, joined_at) VALUES ($1, $2, 'developer', $3)`,
      [wsFernhill, peopleIds.felix, at(1)],
    );
    await tx.query(
      `INSERT INTO memberships (workspace_id, person_id, role, joined_at) VALUES ($1, $2, 'viewer', $3)`,
      [wsFernhill, peopleIds.priya, at(1)],
    );
    await tx.query(
      `INSERT INTO memberships (workspace_id, person_id, role, joined_at) VALUES ($1, $2, 'owner', $3)`,
      [wsQuarry, peopleIds.jonas, at(1)],
    );

    // Namespaces
    const namespaceSpecs: [string, string, string, string][] = [
      ["orchard", "Orchard", "00000000000000a100", wsFernhill],
      ["harbor", "Harbor", "00000000000000b200", wsFernhill],
      ["lantern", "Lantern", "00000000000000c300", wsFernhill],
      ["quarryMain", "Quarry main", "00000000000000d400", wsQuarry],
    ];
    for (const [key, name, hex, workspaceId] of namespaceSpecs) {
      const namespaceId = id();
      nsIds[key] = namespaceId;
      await tx.query(
        `INSERT INTO namespaces (id, workspace_id, name, hex, created_at) VALUES ($1, $2, $3, $4, $5)`,
        [namespaceId, workspaceId, name, hex, at(1)],
      );
    }

    // Validators (simulated operators, not people): each gets a synthetic
    // operator account person so self-stake votes can be recorded.
    const validatorSpecs: [string, number, number][] = [
      ["Alder", 4_000, 0.05],
      ["Birch", 3_000, 0.1],
      ["Cedar", 2_000, 0],
      ["Dogwood", 1_000, 0.2],
    ];
    const operatorPersonIds: Record<string, string> = {};
    for (const workspaceId of [wsFernhill, wsQuarry]) {
      for (const [name, selfStake, commission] of validatorSpecs) {
        const validatorId = id();
        const key = workspaceId === wsFernhill ? name : `${name}-quarry`;
        validatorIds[key] = validatorId;
        const operatorId = `validator-op-${validatorId}`;
        operatorPersonIds[key] = operatorId;
        await tx.query(
          `INSERT INTO validators (id, workspace_id, name, self_stake_ufern, commission) VALUES ($1, $2, $3, $4, $5)`,
          [validatorId, workspaceId, name, (BigInt(selfStake) * 1_000_000n).toString(), commission],
        );
        await tx.query(
          `INSERT INTO people (id, name, email, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)`,
          [operatorId, `${name} operator`, `operator.${key.toLowerCase()}@fernhill.test`, `${id()}:disabled`, at(1)],
        );
        const pair = ledgerPair({
          workspaceId,
          credit: { account: `bonded:${validatorId}`, amount: BigInt(selfStake) * 1_000_000n },
          debit: { account: "genesis", amount: BigInt(selfStake) * 1_000_000n },
          kind: "genesis",
          label: "Genesis allocation",
          at: at(1),
        });
        await postPair(tx, pair);
      }
    }

    // Delegations
    await tx.query(
      `INSERT INTO delegations (id, workspace_id, person_id, validator_id, amount_ufern, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id(), wsFernhill, peopleIds.amara, validatorIds["Alder"]!, (500n * 1_000_000n).toString(), at(1)],
    );
    await tx.query(
      `INSERT INTO delegations (id, workspace_id, person_id, validator_id, amount_ufern, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id(), wsFernhill, peopleIds.felix, validatorIds["Birch"]!, (300n * 1_000_000n).toString(), at(1)],
    );
    const amaraDelegation = ledgerPair({
      workspaceId: wsFernhill,
      credit: { account: `bonded:${validatorIds["Alder"]!}`, amount: 500n * 1_000_000n },
      debit: { account: "genesis", amount: 500n * 1_000_000n },
      kind: "genesis",
      label: "Genesis allocation",
      at: at(1),
    });
    await postPair(tx, amaraDelegation);
    const felixDelegation = ledgerPair({
      workspaceId: wsFernhill,
      credit: { account: `bonded:${validatorIds["Birch"]!}`, amount: 300n * 1_000_000n },
      debit: { account: "genesis", amount: 300n * 1_000_000n },
      kind: "genesis",
      label: "Genesis allocation",
      at: at(1),
    });
    await postPair(tx, felixDelegation);

    // Light nodes
    const nodeSpecs: [string, string, string, number, boolean][] = [
      ["wren", "Wren", wsFernhill, 1, true],
      ["kestrel", "Kestrel", wsFernhill, 2, false],
      ["heron", "Heron", wsQuarry, 1, false],
    ];
    for (const [key, name, workspaceId, number, auto] of nodeSpecs) {
      const nodeId = id();
      nodeIds[key] = nodeId;
      await tx.query(
        `INSERT INTO light_nodes (id, workspace_id, name, number, auto_sample) VALUES ($1, $2, $3, $4, $5)`,
        [nodeId, workspaceId, name, number, auto],
      );
    }

    // Genesis balances
    const balances: Record<string, bigint> = {
      amara: 2_000n * 1_000_000n,
      felix: 5_000n * 1_000_000n,
      priya: 100n * 1_000_000n,
      jonas: 1_000n * 1_000_000n,
    };
    // Seeded fees burn before the genesis allocation is sized, so the published
    // balances hold exactly afterwards.
    const feeTotals: Record<string, bigint> = {
      amara: 0n,
      felix: 0n,
      priya: 0n,
      jonas: 0n,
    };
    const feeOf = (shares: number) => feeUfern(blobGas(shares), config.minGasPriceUfernPerGas);
    const stakingFee = feeUfern(80_000, config.minGasPriceUfernPerGas);

    // Seeded fees, refunds and deposits net against the genesis entries.
    const insertBlobTx = async (
      senderKey: keyof typeof peopleIds,
      workspaceId: string,
      spec: SeedBlobSpec,
      submittedAt: Date,
      status: "included" | "pending" | "rejected",
      height: number | null,
    ): Promise<{ blobId: string; txId: string; positions: [number, number][] }> => {
      const txId = id();
      const blobId = id();
      const size = byteCount(spec.data);
      const shares = shareCount(size);
      const fee = feeOf(shares);
      await tx.query(
        `INSERT INTO transactions (id, workspace_id, kind, sender_id, status, status_text, height, fee_ufern, gas, submitted_at, included_at, sequence, payload, hold_ufern)
         VALUES ($1, $2, 'blob', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          txId,
          workspaceId,
          peopleIds[senderKey],
          status === "included" ? "included" : status === "rejected" ? "rejected" : "pending",
          status === "included"
            ? `Included in block ${height}`
            : status === "rejected"
              ? `Rejected — block ${height} was rejected`
              : "Pending",
          height,
          fee.toString(),
          blobGas(shares),
          submittedAt,
          submittedAt,
          0,
          JSON.stringify({ dataBase64: Buffer.from(spec.data, "utf8").toString("base64"), namespace: spec.namespaceHex }),
          status === "pending" ? fee.toString() : "0",
        ],
      );
      await tx.query(
        `INSERT INTO blobs (id, workspace_id, tx_id, namespace, size_bytes, shares, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [blobId, workspaceId, txId, spec.namespaceHex, size, shares, submittedAt],
      );
      if (status === "included") {
        feeTotals[senderKey] = (feeTotals[senderKey] ?? 0n) + fee;
        const feePair = ledgerPair({
          workspaceId,
          credit: { account: "burn", amount: fee },
          debit: { account: personAccount(peopleIds[senderKey]), amount: fee },
          kind: "fee",
          label: "Fee",
          at: submittedAt,
          height: height ?? undefined,
        });
        await postPair(tx, feePair);
      }
      return { blobId, txId, positions: [] };
    };

    const block2Blobs: SeedBlobSpec[] = [
      { namespaceHex: "00000000000000a100", data: "o".repeat(60) },
      { namespaceHex: "00000000000000a100", data: "p".repeat(10) },
      { namespaceHex: "00000000000000b200", data: "h".repeat(120) },
      { namespaceHex: "00000000000000c300", data: "l".repeat(20) },
    ];
    for (const spec of block2Blobs) {
      const result = await insertBlobTx("felix", wsFernhill, spec, at(2), "included", 2);
      blobIds.block2.push({ id: result.blobId, txId: result.txId, ns: spec.namespaceHex, size: byteCount(spec.data), data: spec.data });
    }
    const block3Blob = { namespaceHex: "00000000000000c300", data: LANTERN_TEXT };
    const result3 = await insertBlobTx("felix", wsFernhill, block3Blob, at(3), "included", 3);
    blobIds.block3.push({ id: result3.blobId, txId: result3.txId, ns: block3Blob.namespaceHex, size: byteCount(block3Blob.data), data: block3Blob.data });
    const block4Blob = { namespaceHex: "00000000000000b200", data: "h".repeat(300) };
    const result4 = await insertBlobTx("felix", wsFernhill, block4Blob, at(4), "rejected", 4);
    blobIds.block4.push({ id: result4.blobId, txId: result4.txId, ns: block4Blob.namespaceHex, size: byteCount(block4Blob.data), data: block4Blob.data });
    const block5Blob = block3Blob;
    const result5 = await insertBlobTx("felix", wsFernhill, block5Blob, at(5), "rejected", 5);
    blobIds.block5.push({ id: result5.blobId, txId: result5.txId, ns: block5Blob.namespaceHex, size: byteCount(block5Blob.data), data: block5Blob.data });

    const mempoolBlobs: SeedBlobSpec[] = [
      { namespaceHex: "00000000000000a100", data: "q".repeat(300) },
      { namespaceHex: "00000000000000c300", data: "r".repeat(200) },
    ];
    for (const spec of mempoolBlobs) {
      const result = await insertBlobTx("amara", wsFernhill, spec, at(5), "pending", null);
      blobIds.mempool.push({ id: result.blobId, txId: result.txId, ns: spec.namespaceHex, size: byteCount(spec.data), data: spec.data });
    }

    // Blocks 1-5 with squares, roots and status.
    await insertHistoryBlock(tx, config, wsFernhill, 1, [], "honest", "available", null);
    await insertHistoryBlock(
      tx,
      config,
      wsFernhill,
      2,
      block2Blobs.map((spec, index) => ({ ...spec, blobId: blobIds.block2[index]!.id })),
      "honest",
      "available",
      null,
    );
    await insertHistoryBlock(
      tx,
      config,
      wsFernhill,
      3,
      [{ ...block3Blob, blobId: result3.blobId }],
      "honest",
      "available",
      null,
    );
    await insertHistoryBlock(
      tx,
      config,
      wsFernhill,
      4,
      [{ ...block4Blob, blobId: result4.blobId }],
      "withhold",
      "rejected",
      { reason: "withheld", node: nodeIds["wren"]!, nodeName: "Wren", row: 6, col: 5 },
    );
    await insertHistoryBlock(
      tx,
      config,
      wsFernhill,
      5,
      [{ ...block5Blob, blobId: result5.blobId }],
      "bad-encoding",
      "rejected",
      { reason: "bad-encoding", axis: "row", index: 0 },
    );
    await insertHistoryBlock(tx, config, wsQuarry, 1, [], "honest", "available", null);

    // Wren's samples: block 2 available after 10 samples, block 4 rejected at its
    // third sample, block 5 rejected by its fraud proof.
    const { sampleSequence } = await import("../shared/domain.js");
    const samplesAt = async (height: number, k: number, count: number) => {
      const sequence = sampleSequence(config, 1, height, k).slice(0, count);
      for (let i = 0; i < sequence.length; i++) {
        const [row, col] = sequence[i]!;
        await tx.query(
          `INSERT INTO samples (id, workspace_id, node_id, height, index, row, col, served, taken_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            id(),
            wsFernhill,
            nodeIds["wren"]!,
            height,
            i,
            row,
            col,
            true,
            new Date(at(height).getTime() + (i + 1) * config.sampleIntervalMs),
          ],
        );
      }
    };
    await samplesAt(2, 4, 10);
    await samplesAt(4, 4, 3);
    await tx.query(
      `UPDATE samples SET served = false WHERE workspace_id = $1 AND height = 4 AND index = 2`,
      [wsFernhill],
    );

    // Block 5 fraud proof: share (0, 2) byte 14 flipped.
    await insertBlock5FraudProof(tx, config, wsFernhill, 5);

    // Proposals
    const proposalFees = await insertProposals(tx, config, wsFernhill, peopleIds, validatorIds, operatorPersonIds, stakingFee);
    for (const [key, total] of Object.entries(proposalFees)) {
      feeTotals[key as keyof typeof feeTotals] += total;
    }

    // Genesis allocation entries: balances hold exactly after every seeded fee, refund, delegation and deposit.
    for (const [key, personId] of Object.entries(peopleIds)) {
      const workspaceId = key === "jonas" ? wsQuarry : wsFernhill;
      const feeBurned = feeTotals[key] ?? 0n;
      const balance = balances[key]! + feeBurned;
      const pair = ledgerPair({
        workspaceId,
        credit: { account: personAccount(personId), amount: balance },
        debit: { account: "genesis", amount: balance },
        kind: "genesis",
        label: "Genesis allocation",
        at: at(1),
      });
      await postPair(tx, pair);
    }

    await tx.query(
      `INSERT INTO meta (key, value) VALUES ('clock_offset', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [(BigInt(5 * config.blockTimeSeconds) * 1000n).toString()],
    );
    await tx.query(`INSERT INTO events (workspace_id, at, kind, body) VALUES ($1, $2, 'seeded', '{}')`, [
      wsFernhill,
      clockAt,
    ]);
  });

  // Storage objects: payloads for every seeded blob, snapshots for blocks 1-5.
  const payloadWrites: { key: string; body: Buffer }[] = [];
  for (const list of [blobIds.block2, blobIds.block3, blobIds.block4, blobIds.block5, blobIds.mempool]) {
    for (const blob of list) {
      payloadWrites.push({ key: `blobs/${blob.id}`, body: Buffer.from(blob.data, "utf8") });
    }
  }
  for (const write of payloadWrites) {
    await storage.putDeferred(write.key, write.body);
  }

  const proposals = await db.many<{ number: number; title: string }>(
    `SELECT number, title FROM proposals WHERE workspace_id = $1 ORDER BY number`,
    [wsFernhill],
  );

  const result: SeedResult = {
    clock: clockAt.toISOString(),
    workspaces: {
      fernhill: { id: wsFernhill, name: "Fernhill Labs" },
      quarry: { id: wsQuarry, name: "Quarry Labs" },
    },
    people: {
      amara: { id: peopleIds.amara, name: "Amara Osei", email: EMAILS.amara, password: passwords.amara ?? "", session: sessions.amara },
      felix: { id: peopleIds.felix, name: "Felix Navarro", email: EMAILS.felix, password: passwords.felix ?? "", session: sessions.felix },
      priya: { id: peopleIds.priya, name: "Priya Raman", email: EMAILS.priya, password: passwords.priya ?? "", session: sessions.priya },
      jonas: { id: peopleIds.jonas, name: "Jonas Weber", email: EMAILS.jonas, password: passwords.jonas ?? "", session: sessions.jonas },
    },
    namespaces: {
      orchard: { id: nsIds["orchard"]!, name: "Orchard", hex: "00000000000000a100" },
      harbor: { id: nsIds["harbor"]!, name: "Harbor", hex: "00000000000000b200" },
      lantern: { id: nsIds["lantern"]!, name: "Lantern", hex: "00000000000000c300" },
      quarryMain: { id: nsIds["quarryMain"]!, name: "Quarry main", hex: "00000000000000d400" },
    },
    lightNodes: {
      wren: { id: nodeIds["wren"]!, name: "Wren", number: 1 },
      kestrel: { id: nodeIds["kestrel"]!, name: "Kestrel", number: 2 },
      heron: { id: nodeIds["heron"]!, name: "Heron", number: 1 },
    },
    validators: {
      fernhill: {
        alder: { id: validatorIds["Alder"]!, name: "Alder" },
        birch: { id: validatorIds["Birch"]!, name: "Birch" },
        cedar: { id: validatorIds["Cedar"]!, name: "Cedar" },
        dogwood: { id: validatorIds["Dogwood"]!, name: "Dogwood" },
      },
      quarry: {
        alder: { id: validatorIds["Alder-quarry"]!, name: "Alder" },
        birch: { id: validatorIds["Birch-quarry"]!, name: "Birch" },
        cedar: { id: validatorIds["Cedar-quarry"]!, name: "Cedar" },
        dogwood: { id: validatorIds["Dogwood-quarry"]!, name: "Dogwood" },
      },
    },
    blobs: {
      block2: blobIds.block2.map((b) => ({ id: b.id, txId: b.txId, namespace: b.ns, size: b.size })),
      block3: blobIds.block3.map((b) => ({ id: b.id, txId: b.txId, namespace: b.ns, size: b.size })),
      block4: blobIds.block4.map((b) => ({ id: b.id, txId: b.txId, namespace: b.ns, size: b.size })),
      block5: blobIds.block5.map((b) => ({ id: b.id, txId: b.txId, namespace: b.ns, size: b.size })),
      mempool: blobIds.mempool.map((b) => ({ id: b.id, txId: b.txId, namespace: b.ns, size: b.size })),
    },
    proposals: Object.fromEntries(proposals.map((p) => [String(p.number), { number: p.number, title: p.title }])),
  };
  return result;
}

const EMAILS = {
  amara: "amara.osei@fernhill.test",
  felix: "felix.navarro@fernhill.test",
  priya: "priya.raman@fernhill.test",
  jonas: "jonas.weber@quarry.test",
};

const NAMES = {
  amara: "Amara Osei",
  felix: "Felix Navarro",
  priya: "Priya Raman",
  jonas: "Jonas Weber",
};

interface HistoryBlob {
  namespaceHex: string;
  data: string;
  blobId: string;
}

/** Inserts a history block with its square, roots, layout and status. */
async function insertHistoryBlock(
  tx: import("./db.js").DbClient,
  config: AppConfig,
  workspaceId: string,
  height: number,
  blobs: HistoryBlob[],
  behaviour: "honest" | "withhold" | "bad-encoding",
  status: "available" | "rejected",
  rejection: Record<string, unknown> | null,
): Promise<void> {
  const at = new Date(config.appStartAtMs + height * config.blockTimeSeconds * 1000);
  const encoded = blobs.map((blob) => ({
    namespace: blob.namespaceHex,
    shares: encodeBlobShares(blob.namespaceHex, new TextEncoder().encode(blob.data)),
    blobId: blob.blobId,
  }));
  const layout = layoutSquare(
    encoded.map((blob) => ({ namespace: blob.namespace, shareCount: blob.shares.length })),
    config.maxSquareWidth,
  );
  const original: Uint8Array[] = [];
  const flatBlobs: { blobId: string; positions: [number, number][] }[] = [];
  for (const laidBlob of layout.blobs) {
    const blob = encoded[laidBlob.blobIndex]!;
    flatBlobs.push({ blobId: blob.blobId, positions: laidBlob.positions });
  }
  for (const share of layout.shares) {
    if (share.kind === "blob") {
      const blob = encoded[share.blobIndex]!;
      original.push(blob.shares[share.shareIndex]!);
    } else {
      original.push(tailPaddingShare());
    }
  }
  const extended = extendSquare(original, layout.k);
  let squareShares = extended.shares;
  if (behaviour === "bad-encoding") {
    const altered = squareShares.slice();
    const target = layout.k;
    const share = new Uint8Array(altered[target]!);
    share[14] = share[14]! ^ 0x01;
    altered[target] = share;
    squareShares = altered;
  }
  const rowRoots: RootRef[] = [];
  const columnRoots: RootRef[] = [];
  for (let r = 0; r < extended.width; r++) rowRoots.push(toRootRef(rowRoot(squareShares, layout.k, r)));
  for (let c = 0; c < extended.width; c++) columnRoots.push(toRootRef(columnRoot(squareShares, layout.k, c)));
  const dataRoot = bytesToHex(dataRootOf(squareShares, layout.k));
  const withheld: string[] = [];
  if (behaviour === "withhold") {
    for (let r = layout.k - 1; r < extended.width; r++) {
      for (let c = layout.k - 1; c < extended.width; c++) withheld.push(`${r},${c}`);
    }
  }
  await tx.query(
    `INSERT INTO blocks (workspace_id, height, produced_at, square_width, status, blob_count, data_root, layout, row_roots, column_roots, shares_hex, withheld, producer_behaviour, rejection)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      workspaceId,
      height,
      at,
      layout.k,
      status,
      blobs.length,
      dataRoot,
      JSON.stringify({ blobs: flatBlobs, k: layout.k }),
      JSON.stringify(rowRoots),
      JSON.stringify(columnRoots),
      JSON.stringify(squareShares.map((share) => bytesToHex(share))),
      JSON.stringify(withheld),
      behaviour,
      rejection ? JSON.stringify(rejection) : null,
    ],
  );
  for (const blob of blobs) {
    await tx.query(`INSERT INTO block_blobs (workspace_id, height, blob_id) VALUES ($1, $2, $3)`, [
      workspaceId,
      height,
      blob.blobId,
    ]);
    await tx.query(`UPDATE blobs SET positions = $2 WHERE id = $1`, [
      blob.blobId,
      JSON.stringify(flatBlobs.find((f) => f.blobId === blob.blobId)?.positions ?? []),
    ]);
  }
}

async function insertBlock5FraudProof(
  tx: import("./db.js").DbClient,
  config: AppConfig,
  workspaceId: string,
  height: number,
): Promise<void> {
  const block = await tx.one<{ shares_hex: string[]; row_roots: unknown; square_width: number; column_roots: unknown }>(
    `SELECT shares_hex, row_roots, column_roots, square_width FROM blocks WHERE workspace_id = $1 AND height = $2`,
    [workspaceId, height],
  );
  if (!block) return;
  const committedRowRoots = block.row_roots as RootRef[];
  const committedColumnRoots = block.column_roots as RootRef[];
  const k = block.square_width;
  const shares = block.shares_hex.map((hex) => hexToBytes(hex));
  const original: Uint8Array[] = [];
  for (let r = 0; r < k; r++) {
    for (let c = 0; c < k; c++) {
      original.push(shares[r * 2 * k + c]!);
    }
  }
  const recomputed = extendSquare(original, k);
  const recomputedRoot = toRootRef(rowRoot(recomputed.shares, k, 0));
  await tx.query(
    `INSERT INTO fraud_proofs (workspace_id, height, axis, index, body, published_at)
     VALUES ($1, $2, 'row', 0, $3, $4)`,
    [
      workspaceId,
      height,
      JSON.stringify({
        axis: "row",
        index: 0,
        shares: [],
        committedRoot: committedRowRoots[0]!,
        recomputedRoot: recomputedRoot,
      }),
      new Date(config.appStartAtMs + height * config.blockTimeSeconds * 1000 + config.fraudCheckDelayMs),
    ],
  );
  void committedColumnRoots;
}

async function insertProposals(
  tx: import("./db.js").DbClient,
  config: AppConfig,
  workspaceId: string,
  peopleIds: Record<string, string>,
  validatorIds: Record<string, string>,
  operatorPersonIds: Record<string, string>,
  stakingFee: bigint,
): Promise<Record<string, bigint>> {
  // Seeded proposal and vote fees burn before the genesis allocation is sized.
  const feeTotals: Record<string, bigint> = { amara: 0n, felix: 0n, priya: 0n, jonas: 0n };
  const at = (height: number) => new Date(config.appStartAtMs + height * config.blockTimeSeconds * 1000);
  const txInsert = async (
    kind: string,
    sender: string,
    status: "included" | "rejected",
    statusText: string,
    submittedAt: Date,
    height: number | null,
    payload: Record<string, unknown>,
  ): Promise<string> => {
    const txId = id();
    await tx.query(
      `INSERT INTO transactions (id, workspace_id, kind, sender_id, status, status_text, height, fee_ufern, gas, submitted_at, included_at, sequence, payload, hold_ufern)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 80000, $9, $10, 0, $11, 0)`,
      [
        txId,
        workspaceId,
        kind,
        sender,
        status,
        statusText,
        height,
        stakingFee.toString(),
        submittedAt,
        submittedAt,
        JSON.stringify(payload),
      ],
    );
    const senderAccount: Account = sender.startsWith("validator-op-")
        ? "genesis"
        : personAccount(sender);
    const senderEmail = await tx.one<{ email: string }>(`SELECT email FROM people WHERE id = $1`, [sender]);
    const senderKey = senderEmail?.email.split(".")[0] ?? "";
    if (senderKey in feeTotals) {
      feeTotals[senderKey as keyof typeof feeTotals] += stakingFee;
    }
    const feePair = ledgerPair({
        workspaceId,
        credit: { account: "burn", amount: stakingFee },
        debit: { account: senderAccount, amount: stakingFee },
        kind: "fee",
        label: "Fee",
        at: submittedAt,
        height: height ?? undefined,
      });
      await postPair(tx, feePair);
      return txId;
  };

  const minDeposit = config.minDepositUfern;
  const proposals: {
    number: number;
    title: string;
    description: string;
    status: string;
    statusText: string;
    deposit: bigint;
    votingOpensAt: Date | null;
    votingEndsAt: Date | null;
    depositEndsAt: Date | null;
    votes: [string, string][];
  }[] = [
    {
      number: 1,
      title: "Raise the maximum square width to 16",
      description: "Widen the data square so larger blob batches fit into one block.",
      status: "passed",
      statusText: "Passed",
      deposit: minDeposit,
      votingOpensAt: at(2),
      votingEndsAt: new Date(at(2).getTime() + config.votingPeriodSeconds * 1000),
      depositEndsAt: at(2),
      votes: [
        ["validator:Alder", "yes"],
        ["validator:Birch", "yes"],
        ["validator:Cedar", "yes"],
        ["validator:Dogwood", "yes"],
      ],
    },
    {
      number: 2,
      title: "Lower the block time to 10 seconds",
      description: "Speed the network up by producing blocks every ten seconds.",
      status: "rejected-veto",
      statusText: "Rejected with veto",
      deposit: minDeposit,
      votingOpensAt: at(2),
      votingEndsAt: new Date(at(2).getTime() + config.votingPeriodSeconds * 1000),
      depositEndsAt: at(2),
      votes: [
        ["validator:Alder", "yes"],
        ["validator:Birch", "no_with_veto"],
        ["validator:Cedar", "no"],
        ["validator:Dogwood", "no_with_veto"],
      ],
    },
    {
      number: 3,
      title: "Fund a public sampling dashboard",
      description: "Publish a read-only dashboard of sampling confidence for every block.",
      status: "voting",
      statusText: "Voting period",
      deposit: minDeposit,
      votingOpensAt: at(3),
      votingEndsAt: new Date(at(3).getTime() + config.votingPeriodSeconds * 1000),
      depositEndsAt: at(3),
      votes: [
        ["validator:Alder", "yes"],
        ["validator:Birch", "no_with_veto"],
        ["validator:Cedar", "no"],
        ["amara", "yes"],
      ],
    },
    {
      number: 4,
      title: "Add a namespace directory",
      description: "List every registered namespace with its blob counts.",
      status: "deposit",
      statusText: "Deposit period",
      deposit: 40n * 1_000_000n,
      votingOpensAt: null,
      votingEndsAt: null,
      depositEndsAt: new Date(at(4).getTime() + config.depositPeriodSeconds * 1000),
      votes: [],
    },
    {
      number: 5,
      title: "Rename the Dogwood validator",
      description: "Give Dogwood a clearer name for new operators.",
      status: "failed-deposit",
      statusText: "Failed — deposit not met",
      deposit: 0n,
      votingOpensAt: null,
      votingEndsAt: null,
      depositEndsAt: new Date(at(3).getTime() + config.depositPeriodSeconds * 1000),
      votes: [],
    },
    {
      number: 6,
      title: "Halve the block reward",
      description: "Cut the per-block reward in half.",
      status: "rejected-quorum",
      statusText: "Rejected — quorum not reached",
      deposit: minDeposit,
      votingOpensAt: at(3),
      votingEndsAt: new Date(at(3).getTime() + config.votingPeriodSeconds * 1000),
      depositEndsAt: at(3),
      votes: [["validator:Alder", "yes"]],
    },
    {
      number: 7,
      title: "Add a second light node tier",
      description: "Introduce a faster sampling tier for demo networks.",
      status: "rejected",
      statusText: "Rejected",
      deposit: minDeposit,
      votingOpensAt: at(4),
      votingEndsAt: new Date(at(4).getTime() + config.votingPeriodSeconds * 1000),
      depositEndsAt: at(4),
      votes: [
        ["validator:Alder", "yes"],
        ["validator:Birch", "no"],
        ["validator:Cedar", "no"],
        ["validator:Dogwood", "no"],
      ],
    },
  ];

  for (const proposal of proposals) {
    const txId = await txInsert(
      "proposal",
      peopleIds.amara,
      "included",
      "Included in block 1",
      at(1),
      1,
      { title: proposal.title, description: proposal.description, amountUfern: proposal.deposit.toString() },
    );
    await tx.query(
      `INSERT INTO proposals (workspace_id, number, title, description, status, status_text, deposit_ufern, min_deposit_ufern, tx_id, created_at, deposit_ends_at, voting_ends_at, voting_opened_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        workspaceId,
        proposal.number,
        proposal.title,
        proposal.description,
        proposal.status,
        proposal.statusText,
        proposal.deposit.toString(),
        minDeposit.toString(),
        txId,
        at(1),
        proposal.depositEndsAt,
        proposal.votingEndsAt,
        proposal.votingOpensAt,
      ],
    );
    if (proposal.deposit > 0n) {
      await tx.query(
        `INSERT INTO deposits (id, workspace_id, number, person_id, amount_ufern, tx_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id(), workspaceId, proposal.number, peopleIds.amara, proposal.deposit.toString(), txId, at(1)],
      );
    }
    for (const [voter, option] of proposal.votes) {
      const personId = voter.startsWith("validator:")
        ? validatorIds[voter.replace("validator:", "")]!
        : peopleIds[voter as "amara" | "felix"]!;
      const isValidator = voter.startsWith("validator:");
      // Validator self stake votes as the validator: the operator account is a
      // synthetic person id derived from the validator so no extra people exist.
      const voterKey = voter.replace("validator:", "");
      const voterId = isValidator ? operatorPersonIds[voterKey]! : personId;
      const voteTxId = await txInsert(
        "vote",
        voterId,
        "included",
        "Included in block 1",
        at(1),
        1,
        { number: proposal.number, option },
      );
      await tx.query(
        `INSERT INTO votes (workspace_id, number, person_id, option, tx_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (workspace_id, number, person_id) DO UPDATE SET option = EXCLUDED.option, tx_id = EXCLUDED.tx_id, created_at = EXCLUDED.created_at`,
        [workspaceId, proposal.number, voterId, option, voteTxId, at(1)],
      );
    }
  }
  return feeTotals;
}

export async function resetAll(db: Db, storage: Storage): Promise<void> {
  const tables = [
    "events",
    "mail_outbox",
    "idempotency",
    "ledger_entries",
    "votes",
    "deposits",
    "proposals",
    "redelegations",
    "unbondings",
    "delegations",
    "validators",
    "samples",
    "light_nodes",
    "fraud_proofs",
    "block_blobs",
    "blocks",
    "blobs",
    "transactions",
    "namespaces",
    "invites",
    "memberships",
    "sessions",
    "people",
    "workspaces",
  ];
  await db.transaction(async (tx) => {
    for (const table of tables) {
      await tx.query(`TRUNCATE TABLE ${table} CASCADE`);
    }
    await tx.query(`DELETE FROM meta WHERE key = 'clock_offset'`);
  });
  await storage.emptyBucket();
}
