import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { config } from '../config.js';
import { Queryable, withTransaction } from '../db.js';
import { blobObjectKey, emptyBucket, putObject, StorageUnavailable } from '../storage.js';
import { feeForGas, gasForShares, parseFern } from '../../shared/fees.js';
import { shareCount } from '../../shared/shares.js';
import { ProposalStatus } from '../../shared/governance.js';
import { blockTimeOf } from './blocks.js';
import { advanceTo, resetClock, setClockTo } from './engine.js';
import { minDepositUfern, StoredTally } from './governance.js';
import {
  bondedAccount,
  BURN_ACCOUNT,
  depositsAccount,
  GENESIS_ACCOUNT,
  memberAccount,
  postPair,
} from './ledger.js';
import { Role } from './types.js';

const TABLES = [
  'pending_objects',
  'outbox',
  'idempotency_keys',
  'votes',
  'deposits',
  'proposals',
  'ledger_entries',
  'fraud_proofs',
  'samples',
  'light_nodes',
  'block_shares',
  'blocks',
  'blobs',
  'transactions',
  'redelegations',
  'unbondings',
  'delegations',
  'validators',
  'namespaces',
  'invites',
  'sessions',
  'members',
  'workspaces',
  'people',
  'clock',
];

export function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 32).toString('hex');
}

export async function resetAll(): Promise<void> {
  await withTransaction(async (tx) => {
    await tx.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
    await resetClock(tx);
  });
  try {
    await emptyBucket();
  } catch (error) {
    if (!(error instanceof StorageUnavailable)) throw error;
  }
}

interface SeedPerson {
  id: string;
  name: string;
  email: string;
  password: string;
  session: string;
}

interface SeedNamespace {
  id: string;
  name: string;
  hex: string;
}

interface SeedLightNode {
  id: string;
  name: string;
  number: number;
}

interface SeedBlob {
  id: string;
  txId: string;
  namespace: string;
  size: number;
}

export interface SeedResult {
  clock: string;
  workspaces: Record<string, { id: string; name: string }>;
  people: Record<string, SeedPerson>;
  namespaces: Record<string, SeedNamespace>;
  lightNodes: Record<string, SeedLightNode>;
  validators: Record<string, Record<string, { id: string; name: string }>>;
  blobs: Record<string, SeedBlob[]>;
  proposals: Record<string, { number: number; title: string }>;
}

const ORCHARD = '00000000000000a100';
const HARBOR = '00000000000000b200';
const LANTERN = '00000000000000c300';
const QUARRY_MAIN = '00000000000000d400';

const PEOPLE = [
  { key: 'amara', name: 'Amara Osei', email: 'amara.osei@fernhill.test', password: 'amara-fernhill-2026' },
  { key: 'felix', name: 'Felix Navarro', email: 'felix.navarro@fernhill.test', password: 'felix-fernhill-2026' },
  { key: 'priya', name: 'Priya Raman', email: 'priya.raman@fernhill.test', password: 'priya-fernhill-2026' },
  { key: 'jonas', name: 'Jonas Weber', email: 'jonas.weber@quarry.test', password: 'jonas-quarry-2026' },
];

const VALIDATORS = [
  { key: 'alder', name: 'Alder', selfStake: '4000', commission: [5n, 100n] as const },
  { key: 'birch', name: 'Birch', selfStake: '3000', commission: [10n, 100n] as const },
  { key: 'cedar', name: 'Cedar', selfStake: '2000', commission: [0n, 100n] as const },
  { key: 'dogwood', name: 'Dogwood', selfStake: '1000', commission: [20n, 100n] as const },
];

interface HistoricProposal {
  number: number;
  title: string;
  status: ProposalStatus;
  depositFern: string;
  tally: { yes: string; no: string; noWithVeto: string; abstain: string };
}

const HISTORIC_PROPOSALS: HistoricProposal[] = [
  {
    number: 1,
    title: 'Raise the maximum square width to 16',
    status: 'passed',
    depositFern: '100',
    tally: { yes: '6000', no: '1000', noWithVeto: '0', abstain: '500' },
  },
  {
    number: 2,
    title: 'Lower the block time to 10 seconds',
    status: 'rejected_with_veto',
    depositFern: '100',
    tally: { yes: '3000', no: '2000', noWithVeto: '4000', abstain: '0' },
  },
];

const HISTORIC_PROPOSALS_TAIL: HistoricProposal[] = [
  {
    number: 5,
    title: 'Rename the Dogwood validator',
    status: 'failed_deposit',
    depositFern: '40',
    tally: { yes: '0', no: '0', noWithVeto: '0', abstain: '0' },
  },
  {
    number: 6,
    title: 'Halve the block reward',
    status: 'rejected_quorum',
    depositFern: '100',
    tally: { yes: '1500', no: '500', noWithVeto: '0', abstain: '0' },
  },
  {
    number: 7,
    title: 'Add a second light node tier',
    status: 'rejected',
    depositFern: '100',
    tally: { yes: '3000', no: '5000', noWithVeto: '0', abstain: '0' },
  },
];

const fern = (amount: string): bigint => parseFern(amount) as bigint;

async function insertPerson(
  tx: Queryable,
  person: { name: string; email: string; password: string },
  at: Date,
): Promise<SeedPerson> {
  const id = randomUUID();
  const salt = randomBytes(16).toString('hex');
  await tx.query(
    `INSERT INTO people (id, name, email, password_salt, password_hash, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, person.name, person.email, salt, hashPassword(person.password, salt), at],
  );
  const session = randomUUID();
  await tx.query('INSERT INTO sessions (token, person_id, created_at) VALUES ($1, $2, $3)', [
    session,
    id,
    at,
  ]);
  return { id, name: person.name, email: person.email, password: person.password, session };
}

async function insertWorkspace(tx: Queryable, name: string, at: Date): Promise<string> {
  const id = randomUUID();
  await tx.query(
    "INSERT INTO workspaces (id, name, next_block, created_at) VALUES ($1, $2, 'honest', $3)",
    [id, name, at],
  );
  return id;
}

async function addMember(
  tx: Queryable,
  workspaceId: string,
  personId: string,
  role: Role,
  at: Date,
): Promise<void> {
  await tx.query(
    'INSERT INTO members (workspace_id, person_id, role, joined_at) VALUES ($1, $2, $3, $4)',
    [workspaceId, personId, role, at],
  );
}

async function insertNamespace(
  tx: Queryable,
  workspaceId: string,
  name: string,
  hex: string,
  at: Date,
): Promise<SeedNamespace> {
  const id = randomUUID();
  await tx.query(
    'INSERT INTO namespaces (id, workspace_id, name, hex, created_at) VALUES ($1, $2, $3, $4, $5)',
    [id, workspaceId, name, hex, at],
  );
  return { id, name, hex };
}

async function insertValidators(
  tx: Queryable,
  workspaceId: string,
  at: Date,
): Promise<Record<string, { id: string; name: string }>> {
  const result: Record<string, { id: string; name: string }> = {};
  for (const [position, validator] of VALIDATORS.entries()) {
    const id = randomUUID();
    await tx.query(
      `INSERT INTO validators (id, workspace_id, name, commission_numerator, commission_denominator, position)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, workspaceId, validator.name, validator.commission[0], validator.commission[1], position],
    );
    const selfStake = fern(validator.selfStake);
    await tx.query(
      `INSERT INTO delegations (id, workspace_id, validator_id, person_id, amount_ufern, created_at)
       VALUES ($1, $2, $3, NULL, $4, $5)`,
      [randomUUID(), workspaceId, id, selfStake, at],
    );
    await postPair(tx, {
      workspaceId,
      debit: GENESIS_ACCOUNT,
      credit: bondedAccount(id),
      amountUfern: selfStake,
      kind: 'genesis',
      label: 'Genesis allocation',
      height: null,
      at,
    });
    result[validator.key] = { id, name: validator.name };
  }
  return result;
}

async function delegate(
  tx: Queryable,
  workspaceId: string,
  personId: string,
  validator: { id: string; name: string },
  amount: string,
  at: Date,
): Promise<void> {
  await tx.query(
    `INSERT INTO delegations (id, workspace_id, validator_id, person_id, amount_ufern, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [randomUUID(), workspaceId, validator.id, personId, fern(amount), at],
  );
  await postPair(tx, {
    workspaceId,
    debit: memberAccount(personId),
    credit: bondedAccount(validator.id),
    amountUfern: fern(amount),
    kind: 'delegate',
    label: `Delegation to ${validator.name}`,
    height: null,
    at,
  });
}

async function insertBlob(
  tx: Queryable,
  workspaceId: string,
  senderId: string,
  namespaceHex: string,
  data: Uint8Array,
  at: Date,
): Promise<SeedBlob> {
  const blobId = randomUUID();
  const txId = randomUUID();
  const shares = shareCount(data.length);
  const gas = gasForShares(shares);
  const feeUfern = feeForGas(gas, config.minGasPrice);
  await tx.query(
    `INSERT INTO transactions
       (id, workspace_id, kind, sender_id, status, fee_ufern, gas, held_ufern, payload, submitted_at)
     VALUES ($1, $2, 'blob', $3, 'pending', $4, $5, $4, $6, $7)`,
    [
      txId,
      workspaceId,
      senderId,
      feeUfern,
      gas,
      JSON.stringify({ blobId, namespace: namespaceHex, size: data.length, shares }),
      at,
    ],
  );
  await tx.query(
    `INSERT INTO blobs (id, workspace_id, tx_id, namespace_hex, size, shares, payload, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [blobId, workspaceId, txId, namespaceHex, data.length, shares, Buffer.from(data), at],
  );
  try {
    await putObject(blobObjectKey(blobId), data);
  } catch (error) {
    if (!(error instanceof StorageUnavailable)) throw error;
    await tx.query(
      `INSERT INTO pending_objects (key, workspace_id, body, created_at)
       VALUES ($1, $2, $3, $4) ON CONFLICT (key) DO UPDATE SET body = excluded.body`,
      [blobObjectKey(blobId), workspaceId, Buffer.from(data), at],
    );
  }
  return { id: blobId, txId, namespace: namespaceHex, size: data.length };
}

async function insertProposal(
  tx: Queryable,
  workspaceId: string,
  personId: string,
  proposal: HistoricProposal,
  createdAt: Date,
  depositEndsAt: Date,
  votingStartsAt: Date | null,
  votingEndsAt: Date | null,
  settledAt: Date,
): Promise<void> {
  const id = randomUUID();
  const deposit = fern(proposal.depositFern);
  const stored: StoredTally = {
    yes: fern(proposal.tally.yes).toString(),
    no: fern(proposal.tally.no).toString(),
    noWithVeto: fern(proposal.tally.noWithVeto).toString(),
    abstain: fern(proposal.tally.abstain).toString(),
    totalBonded: fern('10800').toString(),
  };
  await tx.query(
    `INSERT INTO proposals
       (id, workspace_id, number, title, description, status, deposit_ufern, deposit_ends_at,
        voting_starts_at, voting_ends_at, final_tally, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      id,
      workspaceId,
      proposal.number,
      proposal.title,
      `${proposal.title}. A signalling proposal in this sandbox network.`,
      proposal.status,
      deposit,
      depositEndsAt,
      votingStartsAt,
      votingEndsAt,
      JSON.stringify(stored),
      createdAt,
    ],
  );
  await tx.query(
    `INSERT INTO deposits (id, workspace_id, proposal_id, person_id, amount_ufern, at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [randomUUID(), workspaceId, id, personId, deposit, createdAt],
  );
  await postPair(tx, {
    workspaceId,
    debit: memberAccount(personId),
    credit: depositsAccount(proposal.number),
    amountUfern: deposit,
    kind: 'deposit',
    label: `Deposit on proposal ${proposal.number}`,
    height: null,
    at: createdAt,
  });
  const burned = proposal.status === 'rejected_with_veto' || proposal.status === 'rejected_quorum';
  await postPair(tx, {
    workspaceId,
    debit: depositsAccount(proposal.number),
    credit: burned ? BURN_ACCOUNT : memberAccount(personId),
    amountUfern: deposit,
    kind: burned ? 'deposit-burn' : 'deposit-refund',
    label: burned ? 'Deposit burned' : 'Deposit refund',
    height: null,
    at: settledAt,
  });
}

/** Sizes the genesis allocations so the published liquid balances hold exactly. */
async function allocateGenesis(
  tx: Queryable,
  workspaceId: string,
  targets: { personId: string; balance: string }[],
  at: Date,
): Promise<void> {
  for (const target of targets) {
    const { rows } = await tx.query<{ total: string | null }>(
      `SELECT sum(amount_ufern)::text AS total FROM ledger_entries
       WHERE workspace_id = $1 AND account = $2`,
      [workspaceId, memberAccount(target.personId)],
    );
    const current = BigInt(rows[0]?.total ?? '0');
    const amount = fern(target.balance) - current;
    await postPair(tx, {
      workspaceId,
      debit: GENESIS_ACCOUNT,
      credit: memberAccount(target.personId),
      amountUfern: amount,
      kind: 'genesis',
      label: 'Genesis allocation',
      height: null,
      at,
    });
  }
}

const text = (value: string): Uint8Array => new TextEncoder().encode(value);
const repeat = (ch: string, count: number): Uint8Array => text(ch.repeat(count));

const BLOCK_3_TEXT =
  'Blobs are split into shares, laid in a square and extended with parity. ' +
  'Blobs are split into shares, laid in a square an';

/** Builds exactly the published seed. */
export async function buildSeed(): Promise<SeedResult> {
  await resetAll();
  const start = new Date(Date.parse(config.appStartAt));

  const result = await withTransaction(async (tx) => {
    const people: Record<string, SeedPerson> = {};
    for (const person of PEOPLE) people[person.key] = await insertPerson(tx, person, start);

    const fernhill = await insertWorkspace(tx, 'Fernhill Labs', start);
    const quarry = await insertWorkspace(tx, 'Quarry Labs', start);
    await addMember(tx, fernhill, people.amara.id, 'owner', start);
    await addMember(tx, fernhill, people.felix.id, 'developer', start);
    await addMember(tx, fernhill, people.priya.id, 'viewer', start);
    await addMember(tx, quarry, people.jonas.id, 'owner', start);

    const namespaces = {
      orchard: await insertNamespace(tx, fernhill, 'Orchard', ORCHARD, start),
      harbor: await insertNamespace(tx, fernhill, 'Harbor', HARBOR, start),
      lantern: await insertNamespace(tx, fernhill, 'Lantern', LANTERN, start),
      quarryMain: await insertNamespace(tx, quarry, 'Quarry main', QUARRY_MAIN, start),
    };

    const validators = {
      fernhill: await insertValidators(tx, fernhill, start),
      quarry: await insertValidators(tx, quarry, start),
    };
    await delegate(tx, fernhill, people.amara.id, validators.fernhill.alder, '500', start);
    await delegate(tx, fernhill, people.felix.id, validators.fernhill.birch, '300', start);

    const lightNodes = {
      wren: { id: randomUUID(), name: 'Wren', number: 1 },
      kestrel: { id: randomUUID(), name: 'Kestrel', number: 2 },
      heron: { id: randomUUID(), name: 'Heron', number: 1 },
    };
    await tx.query(
      `INSERT INTO light_nodes (id, workspace_id, name, number, auto_sample, auto_sample_since)
       VALUES ($1, $2, 'Wren', 1, true, $3), ($4, $2, 'Kestrel', 2, false, NULL),
              ($5, $6, 'Heron', 1, true, $3)`,
      [lightNodes.wren.id, fernhill, start, lightNodes.kestrel.id, lightNodes.heron.id, quarry],
    );

    const past = (seconds: number): Date => new Date(start.getTime() - seconds * 1000);
    for (const proposal of HISTORIC_PROPOSALS) {
      await insertProposal(
        tx,
        fernhill,
        people.amara.id,
        proposal,
        past(3600 - proposal.number * 60),
        past(3300 - proposal.number * 60),
        past(3300 - proposal.number * 60),
        past(2700 - proposal.number * 60),
        past(2700 - proposal.number * 60),
      );
    }

    const votingEndsAt = new Date(start.getTime() + 375 * 1000);
    const votingStartsAt = new Date(votingEndsAt.getTime() - config.votingPeriodSeconds * 1000);
    const liveProposalId = randomUUID();
    await tx.query(
      `INSERT INTO proposals
         (id, workspace_id, number, title, description, status, deposit_ufern, deposit_ends_at,
          voting_starts_at, voting_ends_at, created_at)
       VALUES ($1, $2, 3, $3, $4, 'voting', $5, $6, $7, $8, $7)`,
      [
        liveProposalId,
        fernhill,
        'Fund a public sampling dashboard',
        'Fund a public dashboard that charts sampling confidence across the network.',
        minDepositUfern,
        new Date(votingStartsAt.getTime() + config.depositPeriodSeconds * 1000),
        votingStartsAt,
        votingEndsAt,
      ],
    );
    await tx.query(
      `INSERT INTO deposits (id, workspace_id, proposal_id, person_id, amount_ufern, at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), fernhill, liveProposalId, people.amara.id, minDepositUfern, votingStartsAt],
    );
    await postPair(tx, {
      workspaceId: fernhill,
      debit: memberAccount(people.amara.id),
      credit: depositsAccount(3),
      amountUfern: minDepositUfern,
      kind: 'deposit',
      label: 'Deposit on proposal 3',
      height: null,
      at: votingStartsAt,
    });
    const seededVotes: [string | null, string | null, string][] = [
      [null, validators.fernhill.alder.id, 'yes'],
      [null, validators.fernhill.birch.id, 'no_with_veto'],
      [null, validators.fernhill.cedar.id, 'no'],
      [people.amara.id, null, 'yes'],
    ];
    for (const [personId, validatorId, option] of seededVotes) {
      await tx.query(
        `INSERT INTO votes (id, workspace_id, proposal_id, person_id, validator_id, option, at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [randomUUID(), fernhill, liveProposalId, personId, validatorId, option, votingStartsAt],
      );
    }

    const depositEndsAt = new Date(start.getTime() + 275 * 1000);
    const proposal4Id = randomUUID();
    await tx.query(
      `INSERT INTO proposals
         (id, workspace_id, number, title, description, status, deposit_ufern, deposit_ends_at, created_at)
       VALUES ($1, $2, 4, $3, $4, 'deposit', $5, $6, $7)`,
      [
        proposal4Id,
        fernhill,
        'Add a namespace directory',
        'Publish a directory of registered namespaces with their blob counts.',
        fern('40'),
        depositEndsAt,
        new Date(depositEndsAt.getTime() - config.depositPeriodSeconds * 1000),
      ],
    );
    await tx.query(
      `INSERT INTO deposits (id, workspace_id, proposal_id, person_id, amount_ufern, at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        randomUUID(),
        fernhill,
        proposal4Id,
        people.amara.id,
        fern('40'),
        new Date(depositEndsAt.getTime() - config.depositPeriodSeconds * 1000),
      ],
    );
    await postPair(tx, {
      workspaceId: fernhill,
      debit: memberAccount(people.amara.id),
      credit: depositsAccount(4),
      amountUfern: fern('40'),
      kind: 'deposit',
      label: 'Deposit on proposal 4',
      height: null,
      at: new Date(depositEndsAt.getTime() - config.depositPeriodSeconds * 1000),
    });

    for (const proposal of HISTORIC_PROPOSALS_TAIL) {
      await insertProposal(
        tx,
        fernhill,
        people.amara.id,
        proposal,
        past(3600 - proposal.number * 60),
        past(3300 - proposal.number * 60),
        proposal.status === 'failed_deposit' ? null : past(3300 - proposal.number * 60),
        proposal.status === 'failed_deposit' ? null : past(2700 - proposal.number * 60),
        past(2700 - proposal.number * 60),
      );
    }

    return { people, fernhill, quarry, namespaces, validators, lightNodes };
  });

  const blobs: Record<string, SeedBlob[]> = {
    block2: [],
    block3: [],
    block4: [],
    block5: [],
    mempool: [],
  };

  const { people, fernhill, quarry, namespaces, validators, lightNodes } = result;

  // Block 1 is empty; each later block takes the blobs submitted before it.
  await advanceTo(blockTimeOf(1).getTime(), false);

  await withTransaction(async (tx) => {
    const at = new Date(blockTimeOf(1).getTime() + 5000);
    blobs.block2.push(await insertBlob(tx, fernhill, people.felix.id, ORCHARD, repeat('o', 60), at));
    blobs.block2.push(await insertBlob(tx, fernhill, people.felix.id, ORCHARD, repeat('p', 10), at));
    blobs.block2.push(await insertBlob(tx, fernhill, people.felix.id, HARBOR, repeat('h', 120), at));
    blobs.block2.push(await insertBlob(tx, fernhill, people.felix.id, LANTERN, repeat('l', 20), at));
  });
  await advanceTo(blockTimeOf(2).getTime(), false);

  await withTransaction(async (tx) => {
    const at = new Date(blockTimeOf(2).getTime() + 5000);
    blobs.block3.push(
      await insertBlob(tx, fernhill, people.felix.id, LANTERN, text(BLOCK_3_TEXT), at),
    );
  });
  await advanceTo(blockTimeOf(3).getTime(), false);

  await withTransaction(async (tx) => {
    const at = new Date(blockTimeOf(3).getTime() + 5000);
    blobs.block4.push(
      await insertBlob(tx, fernhill, people.felix.id, HARBOR, repeat('h', 300), at),
    );
    await tx.query("UPDATE workspaces SET next_block = 'withhold' WHERE id = $1", [fernhill]);
  });
  await advanceTo(blockTimeOf(4).getTime(), false);

  await withTransaction(async (tx) => {
    const at = new Date(blockTimeOf(4).getTime() + 5000);
    blobs.block5.push(
      await insertBlob(tx, fernhill, people.felix.id, LANTERN, text(BLOCK_3_TEXT), at),
    );
    await tx.query("UPDATE workspaces SET next_block = 'bad-encoding' WHERE id = $1", [fernhill]);
  });
  // Block 5's fraud check and samples run at their own instants, so the seeded
  // history carries every check the published state describes.
  await advanceTo(blockTimeOf(5).getTime() + config.fraudCheckDelayMs, false);

  await withTransaction(async (tx) => {
    const at = blockTimeOf(5);
    blobs.mempool.push(
      await insertBlob(tx, fernhill, people.amara.id, ORCHARD, repeat('q', 300), at),
    );
    blobs.mempool.push(
      await insertBlob(tx, fernhill, people.amara.id, LANTERN, repeat('r', 200), at),
    );
    await allocateGenesis(
      tx,
      fernhill,
      [
        { personId: people.amara.id, balance: '2000' },
        { personId: people.felix.id, balance: '5000' },
        { personId: people.priya.id, balance: '100' },
      ],
      new Date(Date.parse(config.appStartAt)),
    );
    await allocateGenesis(
      tx,
      quarry,
      [{ personId: people.jonas.id, balance: '1000' }],
      new Date(Date.parse(config.appStartAt)),
    );
    await setClockTo(tx, blockTimeOf(5));
  });

  return {
    clock: blockTimeOf(5).toISOString(),
    workspaces: {
      fernhill: { id: fernhill, name: 'Fernhill Labs' },
      quarry: { id: quarry, name: 'Quarry Labs' },
    },
    people,
    namespaces,
    lightNodes,
    validators,
    blobs,
    proposals: {
      1: { number: 1, title: HISTORIC_PROPOSALS[0].title },
      2: { number: 2, title: HISTORIC_PROPOSALS[1].title },
      3: { number: 3, title: 'Fund a public sampling dashboard' },
      4: { number: 4, title: 'Add a namespace directory' },
      5: { number: 5, title: HISTORIC_PROPOSALS_TAIL[0].title },
      6: { number: 6, title: HISTORIC_PROPOSALS_TAIL[1].title },
      7: { number: 7, title: HISTORIC_PROPOSALS_TAIL[2].title },
    },
  };
}
