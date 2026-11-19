// Scratch check of the brief's worked examples against the shared domain code.
import { blobToShares, shareCount, paddingShare } from '../dist/shared/shares.js';
import { layOutSquare, extendSquare, squareWidth } from '../dist/shared/square.js';
import { commitSquare, rowLeaves } from '../dist/shared/commitments.js';
import { proveNamespace, rootFromRowProof } from '../dist/shared/proofs.js';
import { toHex } from '../dist/shared/hex.js';
import { nmtLeaf } from '../dist/shared/nmt.js';
import { gfMul } from '../dist/shared/gf256.js';
import { confidencePercent, isConfident, sampleSequence } from '../dist/shared/sampling.js';
import { gasForShares, feeForGas, parseRate } from '../dist/shared/fees.js';

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

const text = (s) => new TextEncoder().encode(s);
const repeat = (ch, n) => text(ch.repeat(n));

// Share counts
check('share counts', [1, 50, 51, 104, 105, 120, 200, 300, 1000, 3452].map(shareCount), [1, 1, 2, 2, 3, 3, 4, 6, 19, 64]);

// GF
check('2 x 0x80', gfMul(2, 0x80), 0x1d);

// Gas and fee
const rate = parseRate('0.1');
check(
  'gas and fee table',
  [1, 120, 200, 300, 1000].map((bytes) => {
    const s = shareCount(bytes);
    const g = gasForShares(s);
    return [s, g, feeForGas(g, rate).toString()];
  }),
  [
    [1, 65512, '6552'],
    [3, 66536, '6654'],
    [4, 67048, '6705'],
    [6, 68072, '6808'],
    [19, 74728, '7473'],
  ],
);
check('staking fee', feeForGas(80000, rate).toString(), '8000');

const ORCHARD = '00000000000000a100';
const HARBOR = '00000000000000b200';
const LANTERN = '00000000000000c300';

// Block 2
const block2 = layOutSquare([
  { blobId: 'b1', namespace: ORCHARD, shares: blobToShares(ORCHARD, repeat('o', 60)) },
  { blobId: 'b2', namespace: ORCHARD, shares: blobToShares(ORCHARD, repeat('p', 10)) },
  { blobId: 'b3', namespace: HARBOR, shares: blobToShares(HARBOR, repeat('h', 120)) },
  { blobId: 'b4', namespace: LANTERN, shares: blobToShares(LANTERN, repeat('l', 20)) },
]);
check('block 2 k', block2.k, 4);
check('block 2 share (0,0)', toHex(block2.cells[0].share), '00000000000000a100010000003c' + '6f'.repeat(50));
check('block 2 share (0,2)', toHex(block2.cells[2].share), '00000000000000a100010000000a' + '70'.repeat(10) + '00'.repeat(40));
check(
  'block 2 row namespaces',
  block2.cells.map((c) => c.namespace),
  [ORCHARD, ORCHARD, ORCHARD, HARBOR, HARBOR, HARBOR, LANTERN, 'fffffffffffffffffe', ...Array(8).fill('fffffffffffffffffe')],
);

function toGrid(layout) {
  const grid = [];
  for (let r = 0; r < layout.k; r++) {
    grid.push(layout.cells.slice(r * layout.k, r * layout.k + layout.k).map((c) => c.share));
  }
  return grid;
}

const square2 = extendSquare(toGrid(block2));
const commit2 = commitSquare(square2, block2.k);
check('block 2 row 0 root', [commit2.rowRoots[0].min, commit2.rowRoots[0].hash], [ORCHARD, 'a0d9966f3fb0d09021d636825ee1e231dd1bdba95d2c27fe747d21f8a534f165']);
check('block 2 row 1 root', [commit2.rowRoots[1].min, commit2.rowRoots[1].hash], [HARBOR, '06370d2ca07b9029694bfce8f2b0e32dbb1e8e904264e06d6b3fc61afb16249a']);
check('block 2 rows 2-3 min', [commit2.rowRoots[2].min, commit2.rowRoots[3].min], ['fffffffffffffffffe', 'fffffffffffffffffe']);
check('block 2 data root', commit2.dataRoot, '74394f261f82f1bf398e3de573733f5249c6eaa0b7c98ba5c3c0361e83fcbbdf');

// Block 3
const b3text = 'Blobs are split into shares, laid in a square and extended with parity. Blobs are split into shares, laid in a square an';
check('block 3 text length', b3text.length, 120);
const block3 = layOutSquare([{ blobId: 'c1', namespace: LANTERN, shares: blobToShares(LANTERN, text(b3text)) }]);
check('block 3 k', block3.k, 2);
const square3 = extendSquare(toGrid(block3));
check('block 3 (0,0)', toHex(square3[0][0]), '00000000000000c3000100000078426c6f6273206172652073706c697420696e746f207368617265732c206c61696420696e20612073717561726520616e6420');
check('block 3 (0,1)', toHex(square3[0][1]), '00000000000000c30000657874656e6465642077697468207061726974792e20426c6f6273206172652073706c697420696e746f207368617265732c206c6169');
check('block 3 (0,2)', toHex(square3[0][2]), '00000000000000c30003caf0e8421a7c7b6ed58e717e7f20755250697492e7f21869be515ee3544b5f3486547b694420696e887d2073435d475c4938e36a6eb2');
check('block 3 (2,0)', toHex(square3[2][0]), '00000000000000c30003c840d2548676f140778a61726520574cb4bb9c60bbb29cb16095b8a396af957460b4a3bbac60bbb260a36095939fa396af60a3b2ac60');
check('block 3 (3,3)', toHex(square3[3][3]), '242424242424240f210106cd4ec7acb322e72a8ca9c1a780b7ff9cd2e88b5d655cd4ff808a598eb89270b790ecd2a840d2dca5e640e6b492a896be6859d0d6eb');
const commit3 = commitSquare(square3, block3.k);
check('block 3 leaf (0,0)', nmtLeaf(LANTERN, square3[0][0]).hash, '8ae44032ea24401cfbd4dd0a2d3bd02c316cbfe62602df791dae30495b4eb7a4');
check('block 3 row 0 root', [commit3.rowRoots[0].min, commit3.rowRoots[0].max, commit3.rowRoots[0].hash], [LANTERN, 'ffffffffffffffffff', 'fe8ec31b23bfbc21aaccebbd8b05298542b2b4c75316cea156c65ab15882341f']);
check('block 3 column 0 root', commit3.columnRoots[0].hash, '0a81b3a2aaeeccd4dbd1cbe93e9fabc992d5a3bb56a0a14a107d43875367c996');
check('block 3 data root', commit3.dataRoot, '917f4d16f69e876c76da0cdbc6f8935001e4628f279912d1cbdb1425885f23eb');

// Block 5: bad encoding on block 3's square
const square5 = extendSquare(toGrid(block3));
square5[0][2][14] ^= 1;
const commit5 = commitSquare(square5, 2);
check('block 5 committed row 0 root', commit5.rowRoots[0].hash, 'e192ae6614412c74a5c3172143235d152cdbf258ddd317c74d6acc0ec835defe');
check('block 5 recomputed row 0 root', commit3.rowRoots[0].hash, 'fe8ec31b23bfbc21aaccebbd8b05298542b2b4c75316cea156c65ab15882341f');

// Namespace proofs, block 2, Harbor
const harborProof = proveNamespace(square2, 4, HARBOR);
check('harbor row 0', [harborProof[0].kind, harborProof[0].start, harborProof[0].end, harborProof[0].nodes.map((n) => n.hash)], [
  'inclusion',
  3,
  4,
  [
    'f88cc191e709c55fd17d251db310293382646b0209a4d19a4db97a9d59bb4889',
    '586695226acd1200025e9256e1b90a222099dabdc0141448c3b2d19a8aa695e2',
    'cd5b55a6080cfcc3dec12ea9cc751cb120867ea543c76a263976141f23b98b00',
  ],
]);
check('harbor row 1', [harborProof[1].kind, harborProof[1].start, harborProof[1].end, harborProof[1].nodes.length, harborProof[1].nodes[0].min, harborProof[1].nodes[0].max], ['inclusion', 0, 2, 2, LANTERN, 'fffffffffffffffffe']);
check('harbor rows 2-3', [harborProof[2].kind, harborProof[3].kind], ['outside', 'outside']);
check('harbor verify rows', harborProof.map((p) => (p.kind === 'outside' ? null : rootFromRowProof(4, p).hash)), [
  commit2.rowRoots[0].hash,
  commit2.rowRoots[1].hash,
  null,
  null,
]);

const absence = proveNamespace(square2, 4, '00000000000000b100');
check('absence row 0', [absence[0].kind, absence[0].nextLeaf.col, absence[0].nextLeaf.namespace, absence[0].nextLeaf.hash, absence[0].nodes.map((n) => n.hash)], [
  'absence',
  3,
  HARBOR,
  '0ddeab3716b07d5949f65557ec01cf5c07707c340db2636024b03e7530d0e78a',
  [
    'f88cc191e709c55fd17d251db310293382646b0209a4d19a4db97a9d59bb4889',
    '586695226acd1200025e9256e1b90a222099dabdc0141448c3b2d19a8aa695e2',
    'cd5b55a6080cfcc3dec12ea9cc751cb120867ea543c76a263976141f23b98b00',
  ],
]);
check('absence verify', rootFromRowProof(4, absence[0]).hash, commit2.rowRoots[0].hash);

// Confidence
check('k=2 confidence', [1, 2, 3].map((s) => confidencePercent(2, s)), ['56.2500', '80.8594', '91.6260']);
check('k=4 confidence', [1, 2, 3, 4, 5, 6].map((s) => confidencePercent(4, s)), ['39.0625', '62.8662', '77.3716', '86.2108', '91.5972', '94.8796']);
check('k=8 confidence', [1, 2, 3].map((s) => confidencePercent(8, s)), ['31.6406', '53.2700', '68.0556']);
check('k=1 confidence', confidencePercent(1, 1), '100.0000');
const firstConfident = (k) => { let s = 1; while (!isConfident(k, s)) s += 1; return s; };
check('availability samples', [firstConfident(4), firstConfident(2)], [10, 6]);

// Sample sequences
const seq = (h, n, k, c) => sampleSequence(42, h, n, k, c).map((s) => [s.row, s.col]);
check('wren height 6 k=4', seq(6, 1, 4, 8), [[2, 5], [1, 5], [1, 3], [2, 0], [1, 7], [3, 4], [6, 4], [1, 4]]);
check('kestrel height 2 k=4', seq(2, 2, 4, 6), [[6, 2], [7, 7], [4, 0], [4, 5], [4, 6], [7, 1]]);
check('wren height 4 k=4', seq(4, 1, 4, 3), [[0, 3], [2, 0], [6, 5]]);

// Block 6 with the seeded mempool plus a 200-byte Harbor blob
const block6 = layOutSquare([
  { blobId: 'm1', namespace: ORCHARD, shares: blobToShares(ORCHARD, repeat('q', 300)) },
  { blobId: 'm2', namespace: LANTERN, shares: blobToShares(LANTERN, repeat('r', 200)) },
  { blobId: 'f1', namespace: HARBOR, shares: blobToShares(HARBOR, repeat('x', 200)) },
]);
check('block 6 k', block6.k, 4);
check('block 6 data shares', 6 + 4 + 4, 14);
check(
  'block 6 felix positions',
  block6.cells.flatMap((c, i) => (c.blobId === 'f1' ? [[Math.floor(i / 4), i % 4]] : [])),
  [[1, 2], [1, 3], [2, 0], [2, 1]],
);
const square6 = extendSquare(toGrid(block6));
check('block 6 (0,4) byte 14', square6[0][4][14], 0x71);
const bad6 = extendSquare(toGrid(block6));
bad6[0][4][14] ^= 1;
check('block 6 bad byte', bad6[0][4][14], 0x70);
check('block 6 committed row 0', commitSquare(bad6, 4).rowRoots[0].hash, '11ff6ecf60e7971fdd14b69761c46758fe74b59cf4cad36467f73b8334f999a5');
check('block 6 recomputed row 0', commitSquare(square6, 4).rowRoots[0].hash, '285512c9cea4bb8c34ce7b2a1ce036f8e7087fa6e48cf2f7cb67dfb497d4672b');

// Empty block
const block1 = layOutSquare([]);
check('empty block', [block1.k, block1.cells.length, toHex(block1.cells[0].share)], [1, 1, toHex(paddingShare())]);
check('square widths', [0, 1, 2, 5, 7, 14, 17].map(squareWidth), [1, 1, 2, 4, 4, 4, 8]);

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
