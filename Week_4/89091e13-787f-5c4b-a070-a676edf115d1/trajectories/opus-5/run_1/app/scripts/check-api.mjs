// Scratch check of the published seed state and journeys over the HTTP API.
const BASE = process.env.BASE ?? 'http://127.0.0.1:4173';
const KEY = process.env.GRADING_KEY;

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.log(`FAIL ${label}\n  actual   ${JSON.stringify(actual)}\n  expected ${JSON.stringify(expected)}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

async function api(path, { method = 'GET', body, session, headers = {} } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(session ? { cookie: `fs_session=${session}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed, headers: response.headers };
}

const seed = (await api('/api/grading/seed', { method: 'POST', headers: { 'X-Grading-Key': KEY } })).body;
const fernhill = seed.workspaces.fernhill.id;
const amara = seed.people.amara.session;
const felix = seed.people.felix.session;
const priya = seed.people.priya.session;
const jonas = seed.people.jonas.session;
const w = (path) => `/api/w/${fernhill}${path}`;

check('seed clock', seed.clock, '2026-11-06T09:01:15.000Z');
check('seed blob counts', [seed.blobs.block2.length, seed.blobs.block3.length, seed.blobs.block4.length, seed.blobs.block5.length, seed.blobs.mempool.length], [4, 1, 1, 1, 2]);
check('seed block2 sizes', seed.blobs.block2.map((b) => [b.namespace, b.size]), [['00000000000000a100', 60], ['00000000000000a100', 10], ['00000000000000b200', 120], ['00000000000000c300', 20]]);
check('seed mempool sizes', seed.blobs.mempool.map((b) => b.size), [300, 200]);
check('seed proposals', Object.keys(seed.proposals), ['1', '2', '3', '4', '5', '6', '7']);
check('seed light nodes', [seed.lightNodes.wren.name, seed.lightNodes.kestrel.number, seed.lightNodes.heron.name], ['Wren', 2, 'Heron']);

// Sign in
const signIn = await api('/api/session', { method: 'POST', body: { email: 'felix.navarro@fernhill.test', password: seed.people.felix.password } });
check('sign in', [signIn.status, signIn.body.user.name, signIn.body.workspaces[0].role], [200, 'Felix Navarro', 'developer']);
check('sign in wrong', (await api('/api/session', { method: 'POST', body: { email: 'felix.navarro@fernhill.test', password: 'nope' } })).body, { error: 'Email or password is incorrect.' });
check('me unsigned', (await api('/api/me')).body, { error: 'Sign in to continue.' });

// Workspace basics
const ws = await api(w(''), { session: felix });
check('workspace', [ws.body.name, ws.body.role, ws.body.height, ws.body.nextBlock], ['Fernhill Labs', 'developer', 5, 'honest']);
check('workspace clock', ws.body.clock, '2026-11-06T09:01:15.000Z');

// Isolation: Quarry's workspace is 404 for Felix
check('isolation workspace', (await api(`/api/w/${seed.workspaces.quarry.id}`, { session: felix })).status, 404);
check('isolation blob', (await api(w(`/blobs/${seed.blobs.block2[0].id}`), { session: jonas })).status, 404);

// Blocks table
const blocks = await api(w('/blocks'), { session: felix });
check('blocks newest first', blocks.body.map((b) => [b.height, b.blobs, b.squareWidth, b.status]), [
  [5, 1, 2, 'rejected'],
  [4, 1, 4, 'rejected'],
  [3, 1, 2, 'available'],
  [2, 4, 4, 'available'],
  [1, 0, 1, 'available'],
]);
check('block times', blocks.body.map((b) => b.producedAt), [
  '2026-11-06T09:01:15.000Z',
  '2026-11-06T09:01:00.000Z',
  '2026-11-06T09:00:45.000Z',
  '2026-11-06T09:00:30.000Z',
  '2026-11-06T09:00:15.000Z',
]);

// Namespaces and blob counts
const namespaces = await api(w('/namespaces'), { session: felix });
check('namespace blob counts', namespaces.body.map((n) => [n.name, n.hex, n.blobCount]), [
  ['Orchard', '00000000000000a100', 2],
  ['Harbor', '00000000000000b200', 1],
  ['Lantern', '00000000000000c300', 2],
]);

// Stats trio
const stats = await api(w('/stats'), { session: felix });
check('stats trio', [stats.body.height, stats.body.squareWidth, stats.body.includedToday], [5, 2, 5]);

// Mempool
check('mempool', (await api(w('/mempool'), { session: felix })).body.count, 2);

// Block 2 roots and shares
const block2 = await api(w('/blocks/2'), { session: felix });
check('block 2 data root', block2.body.dataRoot, '74394f261f82f1bf398e3de573733f5249c6eaa0b7c98ba5c3c0361e83fcbbdf');
check('block 2 row 0 root', [block2.body.rowRoots[0].min, block2.body.rowRoots[0].hash], ['00000000000000a100', 'a0d9966f3fb0d09021d636825ee1e231dd1bdba95d2c27fe747d21f8a534f165']);
check('block 2 blobs', block2.body.blobs.length, 4);
const shares2 = await api(w('/blocks/2/shares'), { session: felix });
check('block 2 shares k', shares2.body.k, 4);
check('block 2 share (0,0)', shares2.body.rows[0][0].share, '00000000000000a100010000003c' + '6f'.repeat(50));
check('block 2 share kinds row 1', shares2.body.rows[1].map((c) => c.kind), ['blob', 'blob', 'blob', 'padding', 'parity', 'parity', 'parity', 'parity']);
check('block 2 quadrants', [shares2.body.rows[0][0].quadrant, shares2.body.rows[0][4].quadrant, shares2.body.rows[4][0].quadrant, shares2.body.rows[4][4].quadrant], ['Q0', 'Q1', 'Q2', 'Q3']);

// Block 3 roots
const block3 = await api(w('/blocks/3'), { session: felix });
check('block 3 data root', block3.body.dataRoot, '917f4d16f69e876c76da0cdbc6f8935001e4628f279912d1cbdb1425885f23eb');

// Block 4 withheld
const block4 = await api(w('/blocks/4'), { session: felix });
check('block 4 rejection', [block4.body.rejection.reason, block4.body.rejection.nodeName, block4.body.rejection.row, block4.body.rejection.col], ['withheld', 'Wren', 6, 5]);
const shares4 = await api(w('/blocks/4/shares'), { session: felix });
check('block 4 withheld cell', [shares4.body.rows[6][5].kind, shares4.body.rows[6][5].share], ['withheld', null]);
check('block 4 served cell', shares4.body.rows[0][0].kind, 'blob');
check('block 4 withheld region corner', shares4.body.rows[3][3].kind, 'withheld');

// Block 5 fraud proof
const block5 = await api(w('/blocks/5'), { session: felix });
check('block 5 rejection', [block5.body.rejection.reason, block5.body.rejection.axis, block5.body.rejection.index], ['bad-encoding', 'row', 0]);
const fraud = await api(w('/blocks/5/fraud-proof'), { session: felix });
check('block 5 fraud roots', [fraud.body.axis, fraud.body.index, fraud.body.committedRoot.hash, fraud.body.recomputedRoot.hash], [
  'row', 0,
  'e192ae6614412c74a5c3172143235d152cdbf258ddd317c74d6acc0ec835defe',
  'fe8ec31b23bfbc21aaccebbd8b05298542b2b4c75316cea156c65ab15882341f',
]);
check('block 5 fraud shares verified', fraud.body.shares.map((s) => [s.position, s.verified]), [[[0, 0], true], [[0, 1], true]]);
check('block 3 no fraud proof', (await api(w('/blocks/3/fraud-proof'), { session: felix })).status, 404);

// Proofs
const proof = await api(w('/blocks/2/proofs?namespace=00000000000000b200'), { session: felix });
check('harbor proof rows', proof.body.rows.map((r) => r.kind), ['inclusion', 'inclusion', 'outside', 'outside']);
check('harbor row 0', [proof.body.rows[0].start, proof.body.rows[0].end, proof.body.rows[0].nodes.length], [3, 4, 3]);
const verify = await api(w('/blocks/2/proofs/verify'), { method: 'POST', session: felix, body: { namespace: '00000000000000b200', proof: proof.body.rows[0] } });
check('verify row 0', [verify.body.verified, verify.body.root.hash], [true, 'a0d9966f3fb0d09021d636825ee1e231dd1bdba95d2c27fe747d21f8a534f165']);
const tampered = JSON.parse(JSON.stringify(proof.body.rows[0]));
tampered.nodes[0].hash = '0'.repeat(64);
check('verify tampered', (await api(w('/blocks/2/proofs/verify'), { method: 'POST', session: felix, body: { namespace: '00000000000000b200', proof: tampered } })).body.verified, false);
const absence = await api(w('/blocks/2/proofs?namespace=00000000000000b100'), { session: felix });
check('absence row 0', [absence.body.rows[0].kind, absence.body.rows[0].nextLeaf.col, absence.body.rows[0].nextLeaf.hash], ['absence', 3, '0ddeab3716b07d5949f65557ec01cf5c07707c340db2636024b03e7530d0e78a']);
check('proof bad namespace', (await api(w('/blocks/2/proofs?namespace=zz'), { session: felix })).body, { errors: { namespace: 'Namespace must use only the characters 0-9 and a-f.' } });

// Snapshot
const snap = await fetch(`${BASE}${w('/blocks/2/snapshot')}`, { headers: { cookie: `fs_session=${priya}` } });
const snapBytes = new Uint8Array(await snap.arrayBuffer());
check('snapshot size', [snap.status, snapBytes.length, snap.headers.get('content-disposition')], [200, 8 * 8 * 64, 'attachment; filename="block-2-square.bin"']);
check('snapshot first share', Buffer.from(snapBytes.slice(0, 64)).toString('hex'), '00000000000000a100010000003c' + '6f'.repeat(50));
const withheldSnap = new Uint8Array(await (await fetch(`${BASE}${w('/blocks/4/snapshot')}`, { headers: { cookie: `fs_session=${priya}` } })).arrayBuffer());
check('withheld snapshot zeroed', Buffer.from(withheldSnap.slice((6 * 8 + 5) * 64, (6 * 8 + 5) * 64 + 64)).toString('hex'), '00'.repeat(64));

// Staking state
const validators = await api(w('/validators'), { session: felix });
check('validators', validators.body.map((v) => [v.name, v.stakeUfern, v.commission, v.shareOfBonded]), [
  ['Alder', 4500000000, '0.05', '41.67'],
  ['Birch', 3300000000, '0.1', '30.56'],
  ['Cedar', 2000000000, '0', '18.52'],
  ['Dogwood', 1000000000, '0.2', '9.26'],
]);
const felixStake = await api(w('/staking/me'), { session: felix });
check('felix balance', [felixStake.body.balanceUfern, felixStake.body.availableUfern], [5000000000, 5000000000]);
check('felix delegation', felixStake.body.delegations, [{ validator: seed.validators.fernhill.birch.id, validatorName: 'Birch', amountUfern: 300000000, pendingRewardsUfern: 0 }]);
const amaraStake = await api(w('/staking/me'), { session: amara });
check('amara available', [amaraStake.body.balanceUfern, amaraStake.body.availableUfern, amaraStake.body.heldUfern], [2000000000, 1999986487, 13513]);
check('priya balance', (await api(w('/staking/me'), { session: priya })).body.balanceUfern, 100000000);

// Proposals
const proposals = await api(w('/proposals'), { session: felix });
check('proposal statuses', proposals.body.map((p) => p.statusText), [
  'Passed',
  'Rejected with veto',
  'Voting period',
  'Deposit period',
  'Failed — deposit not met',
  'Rejected — quorum not reached',
  'Rejected',
]);
const proposal3 = proposals.body[2];
check('proposal 3 tally', [proposal3.tally.votesUfern, proposal3.tally.totalBondedUfern, proposal3.tally.turnout, proposal3.tally.yesUfern, proposal3.tally.noUfern, proposal3.tally.noWithVetoUfern, proposal3.tally.vetoShare, proposal3.tally.yesShare, proposal3.tally.result], [
  9500000000, 10800000000, '87.96', 4500000000, 2000000000, 3000000000, '31.58', '47.37', 'Rejected',
]);
check('proposal 3 ends', proposal3.votingEndsAt, '2026-11-06T09:06:15.000Z');
check('proposal 4', [proposals.body[3].depositUfern, proposals.body[3].minDepositUfern, proposals.body[3].depositEndsAt], [40000000, 100000000, '2026-11-06T09:04:35.000Z']);

// Fee estimates
check('fee estimate 200', (await api(w('/fee-estimate?bytes=200'), { session: felix })).body, { size: 200, shares: 4, gas: 67048, feeUfern: 6705 });
check('staking fee', (await api(w('/staking/fee'), { session: felix })).body, { gas: 80000, feeUfern: 8000 });

// Role limits
check('viewer producer', (await api(w('/producer'), { method: 'PUT', session: priya, body: { nextBlock: 'withhold' } })).body, { error: "Viewers can't make changes in this workspace." });
check('developer producer', (await api(w('/producer'), { method: 'PUT', session: felix, body: { nextBlock: 'withhold' } })).body, { error: 'Only the owner can change producer behaviour.' });
check('developer invite', (await api(w('/invites'), { method: 'POST', session: felix, body: { email: 'x@y.test', role: 'viewer' } })).body, { error: 'Only the owner can manage members.' });
check('viewer invite', (await api(w('/invites'), { method: 'POST', session: priya, body: { email: 'x@y.test', role: 'viewer' } })).body, { error: "Viewers can't make changes in this workspace." });
check('viewer blob', (await api(w('/blobs'), { method: 'POST', session: priya, body: { namespace: '00000000000000a100', dataBase64: 'aGk=', fee: '1' } })).body, { error: "Viewers can't make changes in this workspace." });
check('owner producer ok', (await api(w('/producer'), { method: 'PUT', session: amara, body: { nextBlock: 'honest' } })).body, { nextBlock: 'honest' });
check('producer bad value', (await api(w('/producer'), { method: 'PUT', session: amara, body: { nextBlock: 'nope' } })).body, { errors: { nextBlock: 'Choose Honest, Withhold shares or Bad encoding.' } });

// Write error order and shapes
check('415', (await fetch(`${BASE}${w('/blobs')}`, { method: 'POST', headers: { cookie: `fs_session=${felix}` }, body: '{}' })).status, 415);
check('401 before 404', (await api('/api/w/nope/blobs', { method: 'POST', body: {} })).body, { error: 'Sign in to continue.' });
check('404 unknown workspace', (await api('/api/w/nope/blobs', { method: 'POST', session: felix, body: {} })).body, { error: 'Not found' });

// Namespace registration
check('namespace chars', (await api(w('/namespaces'), { method: 'POST', session: felix, body: { name: 'X', hex: 'zz' } })).body, { errors: { hex: 'Namespace must use only the characters 0-9 and a-f.' } });
check('namespace length', (await api(w('/namespaces'), { method: 'POST', session: felix, body: { name: 'X', hex: 'abc' } })).body, { errors: { hex: 'Namespace must be 18 hex characters (1 version byte and 8 id bytes); this one has 3.' } });
check('namespace version', (await api(w('/namespaces'), { method: 'POST', session: felix, body: { name: 'X', hex: '01000000000000a200' } })).body, { errors: { hex: 'Only namespace version 00 is open to users.' } });
check('namespace reserved', (await api(w('/namespaces'), { method: 'POST', session: felix, body: { name: 'X', hex: '000000000000000004' } })).body, { errors: { hex: 'Namespace 000000000000000004 is reserved.' } });
check('namespace name', (await api(w('/namespaces'), { method: 'POST', session: felix, body: { name: ' ', hex: '00000000000000e500' } })).body, { errors: { name: 'Give the namespace a name.' } });
check('namespace taken', (await api(w('/namespaces'), { method: 'POST', session: felix, body: { name: 'X', hex: '00000000000000a100' } })).body, { error: 'Namespace 00000000000000a100 is already registered.' });
check('namespace taken other workspace', (await api(w('/namespaces'), { method: 'POST', session: felix, body: { name: 'X', hex: '00000000000000d400' } })).status, 409);
const registered = await api(w('/namespaces'), { method: 'POST', session: felix, body: { name: 'Beacon', hex: '00000000000000e500' } });
check('namespace registered', [registered.status, registered.body.name, registered.body.hex], [201, 'Beacon', '00000000000000e500']);

// Blob refusals
const refuse = (body) => api(w('/blobs'), { method: 'POST', session: felix, body });
check('blob namespace refusal', (await refuse({ namespace: '00000000000000ff00', dataBase64: 'aGk=', fee: '1' })).body, { errors: { namespace: 'Choose a namespace.' } });
check('blob empty', (await refuse({ namespace: '00000000000000a100', dataBase64: '', fee: '1' })).body, { errors: { data: 'A blob must contain at least 1 byte.' } });
check('blob oversize', (await refuse({ namespace: '00000000000000a100', dataBase64: Buffer.alloc(3453, 1).toString('base64'), fee: '1' })).body, { errors: { data: 'This blob is 3,453 bytes; a block holds at most 3,452 bytes of blob data.' } });
check('blob fee format', (await refuse({ namespace: '00000000000000a100', dataBase64: 'aGk=', fee: '0.0000001' })).body, { errors: { fee: 'Fee must be an amount in FERN with at most 6 decimals.' } });
check('blob fee low', (await refuse({ namespace: '00000000000000a100', dataBase64: 'aGk=', fee: '0.000001' })).body, { errors: { fee: 'Fee too low: this blob needs at least 0.006552 FERN.' } });
check('blob balance', (await api(w('/blobs'), { method: 'POST', session: priya, body: { namespace: '00000000000000a100', dataBase64: 'aGk=', fee: '1' } })).status, 403);


// ---- Journey phases, each on a fresh seed so the published worked numbers hold ----

async function reseed() {
  await fetch(`${process.env.MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });
  const fresh = (await api('/api/grading/seed', { method: 'POST', headers: { 'X-Grading-Key': KEY } })).body;
  return {
    seed: fresh,
    id: fresh.workspaces.fernhill.id,
    w: (path) => `/api/w/${fresh.workspaces.fernhill.id}${path}`,
  };
}
const tick = (ms) => api('/api/grading/clock', { method: 'POST', headers: { 'X-Grading-Key': KEY }, body: { advanceMs: ms } });

// Phase A — submit a blob, watch it land in block 6
{
  const { seed: s, w } = await reseed();
  const felix = s.people.felix.session;
  const payload = Buffer.from('x'.repeat(200)).toString('base64');
  const submit = await api(w('/blobs'), { method: 'POST', session: felix, body: { namespace: '00000000000000b200', dataBase64: payload, fee: '0.006705' }, headers: { 'Idempotency-Key': 'felix-1' } });
  check('A submit blob', [submit.status, submit.body.status, submit.body.feeUfern, submit.body.gas, submit.body.shares, submit.body.size], [201, 'pending', 6705, 67048, 4, 200]);
  const replay = await api(w('/blobs'), { method: 'POST', session: felix, body: { namespace: '00000000000000b200', dataBase64: payload, fee: '0.006705' }, headers: { 'Idempotency-Key': 'felix-1' } });
  check('A idempotent replay', [replay.status, replay.body.id], [201, submit.body.id]);
  check('A idempotent mismatch', (await api(w('/blobs'), { method: 'POST', session: felix, body: { namespace: '00000000000000b200', dataBase64: payload, fee: '0.007' }, headers: { 'Idempotency-Key': 'felix-1' } })).body, { error: 'This idempotency key was used for a different request.' });
  check('A blob pending', (await api(w(`/blobs/${submit.body.blobId}`), { session: felix })).body.statusText, 'Pending');
  check('A mempool', (await api(w('/mempool'), { session: felix })).body.count, 3);
  check('A held fee', (await api(w('/staking/me'), { session: felix })).body.heldUfern, 6705);
  await tick(15000);
  const block6 = await api(w('/blocks/6'), { session: felix });
  check('A block 6', [block6.body.squareWidth, block6.body.blobs.length, block6.body.status], [4, 3, 'sampling']);
  const blob = await api(w(`/blobs/${submit.body.blobId}`), { session: felix });
  check('A blob included', [blob.body.status, blob.body.statusText, blob.body.height, blob.body.positions], ['included', 'Included in block 6', 6, [[1, 2], [1, 3], [2, 0], [2, 1]]]);
  check('A fee charged', (await api(w('/staking/me'), { session: felix })).body.balanceUfern, 5000000000 - 6705);
  check('A namespace counts', (await api(w('/namespaces'), { session: felix })).body.map((n) => n.blobCount), [3, 2, 3]);
  check('A mempool empty', (await api(w('/mempool'), { session: felix })).body.count, 0);
}

// Phase B — the published delegation, reward and unbonding walk-through
{
  const { seed: s, w } = await reseed();
  const felix = s.people.felix.session;
  const cedar = s.validators.fernhill.cedar.id;
  await api(w('/staking/delegate'), { method: 'POST', session: felix, body: { validator: cedar, amount: '1000' } });
  await tick(15000);
  const afterSix = await api(w('/staking/me'), { session: felix });
  check('B balance after delegating', afterSix.body.balanceUfern, 3999992000);
  check('B birch reward of block 6', afterSix.body.delegations[0].pendingRewardsUfern, 25000);
  check('B total bonded', (await api(w('/validators'), { session: felix })).body.reduce((sum, v) => sum + v.stakeUfern, 0), 11800000000);
  await tick(15000);
  check('B cedar reward per block', (await api(w('/staking/me'), { session: felix })).body.delegations[1].pendingRewardsUfern, 84745);
  await tick(60000);
  check('B pending after blocks 7-11', (await api(w('/staking/me'), { session: felix })).body.delegations[1].pendingRewardsUfern, 423725);
  await api(w('/staking/undelegate'), { method: 'POST', session: felix, body: { validator: cedar, amount: '1000' } });
  await tick(15000);
  const afterTwelve = await api(w('/staking/me'), { session: felix });
  check('B balance after undelegate', afterTwelve.body.balanceUfern, 4000492470);
  check('B unbonding', afterTwelve.body.unbondings.map((u) => [u.amountUfern, u.completesAt, u.status]), [[1000000000, '2026-11-06T09:05:00.000Z', 'unbonding']]);
  await tick(119999);
  check('B still unbonding', (await api(w('/staking/me'), { session: felix })).body.unbondings[0].status, 'unbonding');
  await tick(1);
  const released = await api(w('/staking/me'), { session: felix });
  check('B released at the end instant', [released.body.unbondings[0].status, released.body.balanceUfern], ['released', 5000492470]);
  const ledger = await api(w('/ledger'), { session: felix });
  const pairs = ledger.body.entries.reduce((map, entry) => map.set(entry.pairId, (map.get(entry.pairId) ?? 0) + entry.amountUfern), new Map());
  check('B every pair sums to zero', [...pairs.values()].every((total) => total === 0), true);
  const mine = await api(w(`/ledger?account=member:${s.people.felix.id}`), { session: felix });
  check('B ledger balance matches', mine.body.balanceUfern, released.body.balanceUfern);
  const bonded = ledger.body.entries.filter((e) => e.account.startsWith('bonded:')).reduce((sum, e) => sum + e.amountUfern, 0);
  check('B bonded total matches accounts', bonded, (await api(w('/validators'), { session: felix })).body.reduce((sum, v) => sum + v.stakeUfern, 0));
  check('B person-facing labels', [...new Set(mine.body.entries.map((e) => e.label))].sort(), ['Delegation to Birch', 'Delegation to Cedar', 'Fee', 'Fee refund', 'Genesis allocation', 'Rewards from Cedar', 'Unbonding released from Cedar']);
  check('B unbonding pair label', ledger.body.entries.some((e) => e.label === 'Unbonding started from Cedar'), true);
}

// Phase C — the published proposal 3 tally
{
  const { seed: s, w } = await reseed();
  const felix = s.people.felix.session;
  check('C vote', (await api(w('/proposals/3/votes'), { method: 'POST', session: felix, body: { option: 'no_with_veto' } })).status, 201);
  await tick(15000);
  const veto = await api(w('/proposals/3'), { session: felix });
  check('C veto tally', [veto.body.tally.votesUfern, veto.body.tally.turnout, veto.body.tally.vetoShare, veto.body.tally.result, veto.body.myVote], [9800000000, '90.74', '33.67', 'Rejected with veto', 'no_with_veto']);
  check('C change vote', (await api(w('/proposals/3/votes'), { method: 'POST', session: felix, body: { option: 'yes' } })).status, 201);
  await tick(15000);
  const yes = await api(w('/proposals/3'), { session: felix });
  check('C yes tally', [yes.body.tally.yesShare, yes.body.tally.result], ['48.98', 'Rejected']);
  // Voting period ends at 10:06:15; final tally stands
  await tick(270000);
  const final = await api(w('/proposals/3'), { session: felix });
  check('C final', [final.body.status, final.body.statusText, final.body.tally.result], ['rejected', 'Rejected', 'Rejected']);
  check('C vote after end', (await api(w('/proposals/3/votes'), { method: 'POST', session: felix, body: { option: 'yes' } })).body, { error: 'The voting period for proposal 3 has ended.' });
  const four = await api(w('/proposals/4'), { session: felix });
  check('C proposal 4 failed deposit', four.body.statusText, 'Failed — deposit not met');
  check('C deposit after end', (await api(w('/proposals/4/deposits'), { method: 'POST', session: felix, body: { amount: '60' } })).body, { error: 'The deposit period for proposal 4 has ended.' });
}

// Phase D — topping up proposal 4 opens its voting period
{
  const { seed: s, w } = await reseed();
  const felix = s.people.felix.session;
  check('D deposit', (await api(w('/proposals/4/deposits'), { method: 'POST', session: felix, body: { amount: '60' } })).status, 201);
  await tick(15000);
  const four = await api(w('/proposals/4'), { session: felix });
  check('D voting opened', [four.body.status, four.body.depositUfern, four.body.votingEndsAt], ['voting', 100000000, '2026-11-06T09:11:30.000Z']);
  await new Promise((resolve) => setTimeout(resolve, 600));
  const mail = await (await fetch(`${process.env.MAILPIT_URL}/api/v1/messages`)).json();
  const subjects = mail.messages.map((m) => m.Subject);
  check('D voting-open mail to every member', subjects.filter((s2) => s2 === 'Voting is open on proposal 4: Add a namespace directory').length, 3);
}

// Phase E — withholding attack
{
  const { seed: s, w } = await reseed();
  const amara = s.people.amara.session;
  const felix = s.people.felix.session;
  check('E set producer', (await api(w('/producer'), { method: 'PUT', session: amara, body: { nextBlock: 'withhold' } })).body, { nextBlock: 'withhold' });
  check('E producer stored', (await api(w(''), { session: amara })).body.nextBlock, 'withhold');
  await tick(15000);
  check('E block 6 sampling', (await api(w('/blocks/6'), { session: felix })).body.status, 'sampling');
  check('E producer reset', (await api(w(''), { session: amara })).body.nextBlock, 'honest');
  await tick(5000);
  const samples = await api(w(`/light-nodes/${s.lightNodes.wren.id}/samples?height=6`), { session: felix });
  check('E five served samples', samples.body.samples.map((x) => [x.row, x.col, x.confidence]), [
    [2, 5, '39.0625'], [1, 5, '62.8662'], [1, 3, '77.3716'], [2, 0, '86.2108'], [1, 7, '91.5972'],
  ]);
  await tick(1000);
  const sixth = await api(w(`/light-nodes/${s.lightNodes.wren.id}/samples?height=6`), { session: felix });
  check('E sixth sample withheld', [sixth.body.samples[5].row, sixth.body.samples[5].col, sixth.body.samples[5].served, sixth.body.verdict], [3, 4, false, 'unavailable']);
  const block6 = await api(w('/blocks/6'), { session: felix });
  check('E rejected', [block6.body.status, block6.body.rejection.reason, block6.body.rejection.nodeName, block6.body.rejection.row, block6.body.rejection.col], ['rejected', 'withheld', 'Wren', 3, 4]);
  const mempoolBlobs = (await api(w('/blobs'), { session: amara })).body.filter((b) => b.height === 6);
  check('E blobs rejected', mempoolBlobs.map((b) => b.statusText), ['Rejected — block 6 was rejected', 'Rejected — block 6 was rejected']);
  check('E fees refunded', (await api(w('/staking/me'), { session: amara })).body.balanceUfern, 2000000000);
  await new Promise((resolve) => setTimeout(resolve, 600));
  const mail = await (await fetch(`${process.env.MAILPIT_URL}/api/v1/messages`)).json();
  check('E one mail per member', mail.messages.filter((m) => m.Subject === 'Block 6 was rejected').length, 3);
}

// Phase F — bad encoding attack
{
  const { seed: s, w } = await reseed();
  const amara = s.people.amara.session;
  await api(w('/producer'), { method: 'PUT', session: amara, body: { nextBlock: 'bad-encoding' } });
  await tick(15000);
  check('F no proof yet', (await api(w('/blocks/6/fraud-proof'), { session: amara })).status, 404);
  await tick(5000);
  const proof = await api(w('/blocks/6/fraud-proof'), { session: amara });
  check('F fraud proof', [proof.body.axis, proof.body.index, proof.body.committedRoot.hash, proof.body.recomputedRoot.hash], [
    'row', 0,
    '11ff6ecf60e7971fdd14b69761c46758fe74b59cf4cad36467f73b8334f999a5',
    '285512c9cea4bb8c34ce7b2a1ce036f8e7087fa6e48cf2f7cb67dfb497d4672b',
  ]);
  check('F shares verified', [proof.body.shares.length, proof.body.shares.every((x) => x.verified)], [4, true]);
  check('F block rejected', (await api(w('/blocks/6'), { session: amara })).body.rejection.reason, 'bad-encoding');
  check('F publishedAt', proof.body.publishedAt, '2026-11-06T09:01:35.000Z');
}

// Phase G — invites
{
  const { seed: s, w } = await reseed();
  const amara = s.people.amara.session;
  const invite = await api(w('/invites'), { method: 'POST', session: amara, body: { email: 'wren.keeper@fernhill.test', role: 'developer' } });
  check('G invite created', [invite.status, invite.body.role, invite.body.expiresAt], [201, 'developer', '2026-11-09T09:01:15.000Z']);
  check('G invite bad email', (await api(w('/invites'), { method: 'POST', session: amara, body: { email: 'nope', role: 'developer' } })).body, { errors: { email: 'Enter a valid email address.' } });
  check('G invite bad role', (await api(w('/invites'), { method: 'POST', session: amara, body: { email: 'a@b.test', role: 'owner' } })).body, { errors: { role: 'Choose Developer or Viewer.' } });
  check('G invite member exists', (await api(w('/invites'), { method: 'POST', session: amara, body: { email: 'felix.navarro@fernhill.test', role: 'viewer' } })).body, { error: 'felix.navarro@fernhill.test is already a member of this workspace.' });
  await new Promise((resolve) => setTimeout(resolve, 600));
  const mail = await (await fetch(`${process.env.MAILPIT_URL}/api/v1/messages`)).json();
  const message = mail.messages.find((m) => m.Subject === 'Join Fernhill Labs on Fernsquare');
  check('G invite mail', message !== undefined, true);
  const detail = await (await fetch(`${process.env.MAILPIT_URL}/api/v1/message/${message.ID}`)).json();
  const token = /\/invites\/([0-9a-f-]+)/.exec(detail.Text)[1];
  const read = await api(`/api/invites/${token}`);
  check('G invite read', read.body, { workspaceName: 'Fernhill Labs', email: 'wren.keeper@fernhill.test', role: 'developer', existingAccount: false });
  check('G accept needs name', (await api(`/api/invites/${token}/accept`, { method: 'POST', body: { name: '', password: 'longenough' } })).body, { errors: { name: 'Enter your name.' } });
  check('G accept needs password', (await api(`/api/invites/${token}/accept`, { method: 'POST', body: { name: 'Wren Keeper', password: 'short' } })).body, { errors: { password: 'Password must be at least 8 characters.' } });
  const accept = await api(`/api/invites/${token}/accept`, { method: 'POST', body: { name: 'Wren Keeper', password: 'longenough' } });
  check('G accepted', [accept.status, accept.body.workspaceId], [200, s.workspaces.fernhill.id]);
  check('G single use', (await api(`/api/invites/${token}`)).body, { error: 'This invite link has already been used or has expired.' });
  check('G member added', (await api(w('/members'), { session: amara })).body.length, 4);
}

// Phase H — sampling cap and auto-sample
{
  const { seed: s, w } = await reseed();
  const felix = s.people.felix.session;
  const kestrel = s.lightNodes.kestrel.id;
  for (let i = 0; i < 16; i++) await api(w(`/light-nodes/${kestrel}/samples`), { method: 'POST', session: felix, body: { height: 2 } });
  check('H cap', (await api(w(`/light-nodes/${kestrel}/samples`), { method: 'POST', session: felix, body: { height: 2 } })).body, { error: 'Light node Kestrel has already taken 16 samples of block 2.' });
  check('H auto-sample off', (await api(w('/light-nodes'), { session: felix })).body.find((n) => n.id === kestrel).autoSample, false);
  check('H toggle', (await api(w(`/light-nodes/${kestrel}`), { method: 'PATCH', session: felix, body: { autoSample: true } })).body.autoSample, true);
  await tick(15000);
  await tick(3000);
  const auto = await api(w(`/light-nodes/${kestrel}/samples?height=6`), { session: felix });
  check('H auto samples block 6', auto.body.samples.length, 3);
  const wren = await api(w(`/light-nodes/${s.lightNodes.wren.id}/samples?height=6`), { session: felix });
  check('H wren block 6 sequence', wren.body.samples.map((x) => [x.row, x.col]), [[2, 5], [1, 5], [1, 3]]);
  await tick(10000);
  check('H block 6 available', (await api(w('/blocks/6'), { session: felix })).body.status, 'available');
}

console.log(failures === 0 ? '\nALL API CHECKS PASSED' : `\n${failures} API CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
