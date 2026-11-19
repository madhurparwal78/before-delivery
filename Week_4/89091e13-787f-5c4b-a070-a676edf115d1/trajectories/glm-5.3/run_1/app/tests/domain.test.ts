// Checks every published worked vector against the domain rules.
import {
  blobGas,
  blobFeeUfern,
  confidenceDecimal,
  dataRootOf,
  encodeBlobShares,
  extendSquare,
  layoutSquare,
  proveNamespaceRows,
  rowRoot,
  sampleSequence,
  shareCount,
  tailPaddingShare,
  toRootRef,
  verifyRowProof,
  columnRoot,
  toVerifiable,
  percentFromFraction,
  formatFern,
} from "../src/shared/domain.js";
import assert from "node:assert";

const cfg = {
  blockTimeSeconds: 15,
  maxSquareWidth: 8,
  minGasPriceUfernPerGas: 0.1,
  blockRewardUfern: 1_000_000n,
  sampleSeed: 42,
  samplesPerBlock: 16,
  sampleIntervalMs: 1000,
  fraudCheckDelayMs: 5000,
  unbondingSeconds: 120,
  maxUnbondings: 7,
  maxRedelegations: 7,
  minDepositUfern: 100_000_000n,
  depositPeriodSeconds: 300,
  votingPeriodSeconds: 600,
  voteReminderSeconds: 120,
};

const nsOrchard = "00000000000000a100";
const nsHarbor = "00000000000000b200";
const nsLantern = "00000000000000c300";

function textBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function h(share: Uint8Array): string {
  let out = "";
  for (const b of share) out += b.toString(16).padStart(2, "0");
  return out;
}

// ---- share counts ----
const counts: [number, number][] = [
  [1, 1], [50, 1], [51, 2], [104, 2], [105, 3], [120, 3], [200, 4], [300, 6], [1000, 19], [3452, 64],
];
for (const [bytes, shares] of counts) assert.strictEqual(shareCount(bytes), shares, `shareCount ${bytes}`);

// ---- gas and fee ----
assert.strictEqual(blobGas(1), 65_512);
assert.strictEqual(blobGas(3), 66_536);
assert.strictEqual(blobGas(4), 67_048);
assert.strictEqual(blobGas(6), 68_072);
assert.strictEqual(blobGas(19), 74_728);
assert.strictEqual(blobFeeUfern(1, cfg), 6_552n);
assert.strictEqual(blobFeeUfern(3, cfg), 6_654n);
assert.strictEqual(blobFeeUfern(4, cfg), 6_705n);
assert.strictEqual(blobFeeUfern(6, cfg), 6_808n);
assert.strictEqual(blobFeeUfern(19, cfg), 7_473n);

// ---- block 3 square and roots ----
const lanternText =
  "Blobs are split into shares, laid in a square and extended with parity. Blobs are split into shares, laid in a square an";
const lanternShares = encodeBlobShares(nsLantern, textBytes(lanternText));
assert.strictEqual(lanternShares.length, 3);
assert.strictEqual(h(lanternShares[0]!), "00000000000000c3000100000078426c6f6273206172652073706c697420696e746f207368617265732c206c61696420696e20612073717561726520616e6420");
const layout3 = layoutSquare([{ namespace: nsLantern, shareCount: 3 }], cfg.maxSquareWidth);
assert.strictEqual(layout3.k, 2);
const original3: Uint8Array[] = [];
for (const share of layout3.shares) {
  if (share.kind === "blob") original3.push(lanternShares[share.shareIndex]!);
  else original3.push(tailPaddingShare());
}
const extended3 = extendSquare(original3, layout3.k);
assert.strictEqual(h(extended3.shares[2]!), "00000000000000c30003caf0e8421a7c7b6ed58e717e7f20755250697492e7f21869be515ee3544b5f3486547b694420696e887d2073435d475c4938e36a6eb2");
assert.strictEqual(h(extended3.shares[8]!), "00000000000000c30003c840d2548676f140778a61726520574cb4bb9c60bbb29cb16095b8a396af957460b4a3bbac60bbb260a36095939fa396af60a3b2ac60");
assert.strictEqual(h(extended3.shares[15]!), "242424242424240f210106cd4ec7acb322e72a8ca9c1a780b7ff9cd2e88b5d655cd4ff808a598eb89270b790ecd2a840d2dca5e640e6b492a896be6859d0d6eb");
const root3 = rowRoot(extended3.shares, layout3.k, 0);
assert.strictEqual(toRootRef(root3).min, nsLantern);
assert.strictEqual(toRootRef(root3).max, "ffffffffffffffffff");
assert.strictEqual(toRootRef(root3).hash, "fe8ec31b23bfbc21aaccebbd8b05298542b2b4c75316cea156c65ab15882341f");
assert.strictEqual(toRootRef(columnRoot(extended3.shares, layout3.k, 0)).hash, "0a81b3a2aaeeccd4dbd1cbe93e9fabc992d5a3bb56a0a14a107d43875367c996");
assert.strictEqual(h(dataRootOf(extended3.shares, layout3.k)), "917f4d16f69e876c76da0cdbc6f8935001e4628f279912d1cbdb1425885f23eb");

// ---- block 2 square, roots and proofs ----
const orchard60 = encodeBlobShares(nsOrchard, new Uint8Array(60).fill(0x6f));
const orchard10 = encodeBlobShares(nsOrchard, new Uint8Array(10).fill(0x70));
const harbor120 = encodeBlobShares(nsHarbor, new Uint8Array(120).fill(0x68));
const lantern20 = encodeBlobShares(nsLantern, new Uint8Array(20).fill(0x6c));
const layout2 = layoutSquare(
  [
    { namespace: nsOrchard, shareCount: orchard60.length },
    { namespace: nsOrchard, shareCount: orchard10.length },
    { namespace: nsHarbor, shareCount: harbor120.length },
    { namespace: nsLantern, shareCount: lantern20.length },
  ],
  cfg.maxSquareWidth,
);
assert.strictEqual(layout2.k, 4);
const byBlob = new Map<number, Uint8Array[]>();
byBlob.set(0, orchard60);
byBlob.set(1, orchard10);
byBlob.set(2, harbor120);
byBlob.set(3, lantern20);
const original2: Uint8Array[] = [];
for (const share of layout2.shares) {
  if (share.kind === "blob") original2.push(byBlob.get(share.blobIndex)![share.shareIndex]!);
  else original2.push(tailPaddingShare());
}
assert.strictEqual(h(original2[0]!), "00000000000000a100010000003c" + "6f".repeat(50));
assert.strictEqual(h(original2[2]!), "00000000000000a100010000000a" + "70".repeat(10) + "00".repeat(40));
const extended2 = extendSquare(original2, layout2.k);
const roots2 = [0, 1, 2, 3].map((r) => toRootRef(rowRoot(extended2.shares, layout2.k, r)));
assert.strictEqual(roots2[0]!.min, nsOrchard);
assert.strictEqual(roots2[0]!.hash, "a0d9966f3fb0d09021d636825ee1e231dd1bdba95d2c27fe747d21f8a534f165");
assert.strictEqual(roots2[1]!.min, nsHarbor);
assert.strictEqual(roots2[1]!.hash, "06370d2ca07b9029694bfce8f2b0e32dbb1e8e904264e06d6b3fc61afb16249a");
assert.strictEqual(roots2[2]!.min, "fffffffffffffffffe");
assert.strictEqual(roots2[3]!.min, "fffffffffffffffffe");
assert.strictEqual(h(dataRootOf(extended2.shares, layout2.k)), "74394f261f82f1bf398e3de573733f5249c6eaa0b7c98ba5c3c0361e83fcbbdf");

// Harbor proofs on block 2
const harborProof = proveNamespaceRows(extended2.shares, layout2.k, nsHarbor);
const inclusion0 = harborProof.rows[0]!;
assert.strictEqual(inclusion0.kind, "inclusion");
if (inclusion0.kind === "inclusion") {
  assert.strictEqual(inclusion0.start, 3);
  assert.strictEqual(inclusion0.end, 4);
  assert.strictEqual(inclusion0.nodes.length, 3);
  assert.deepStrictEqual(inclusion0.nodes.map((n) => n.hash), [
    "f88cc191e709c55fd17d251db310293382646b0209a4d19a4db97a9d59bb4889",
    "586695226acd1200025e9256e1b90a222099dabdc0141448c3b2d19a8aa695e2",
    "cd5b55a6080cfcc3dec12ea9cc751cb120867ea543c76a263976141f23b98b00",
  ]);
  const spans = inclusion0.nodes.map((n) => n.span);
  const verified = verifyRowProof(toVerifiable(inclusion0, spans, 8));
  assert.ok(verified);
  assert.strictEqual(verified.hash, roots2[0]!.hash);
}
const inclusion1 = harborProof.rows[1]!;
if (inclusion1.kind === "inclusion") {
  assert.strictEqual(inclusion1.start, 0);
  assert.strictEqual(inclusion1.end, 2);
  assert.strictEqual(inclusion1.nodes.length, 2);
  const verified = verifyRowProof(toVerifiable(inclusion1, inclusion1.nodes.map((n) => n.span), 8));
  assert.ok(verified);
  assert.strictEqual(verified.hash, roots2[1]!.hash);
}
assert.strictEqual(harborProof.rows[2]!.kind, "outside");
assert.strictEqual(harborProof.rows[3]!.kind, "outside");

// Absence of 00000000000000b100 in row 0 of block 2
const absence = proveNamespaceRows(extended2.shares, layout2.k, "00000000000000b100");
const absenceRow = absence.rows[0]!;
assert.strictEqual(absenceRow.kind, "absence");
if (absenceRow.kind === "absence") {
  assert.strictEqual(absenceRow.nextLeaf.col, 3);
  assert.strictEqual(absenceRow.nextLeaf.namespace, nsHarbor);
  assert.strictEqual(absenceRow.nextLeaf.hash, "0ddeab3716b07d5949f65557ec01cf5c07707c340db2636024b03e7530d0e78a");
  assert.strictEqual(absenceRow.nodes.length, 3);
  const verified = verifyRowProof(toVerifiable(absenceRow, absenceRow.nodes.map((n) => n.span), 8));
  assert.ok(verified);
  assert.strictEqual(verified.hash, roots2[0]!.hash);
}

// ---- sample sequences ----
assert.deepStrictEqual(sampleSequence(cfg, 1, 6, 4).slice(0, 8), [[2, 5], [1, 5], [1, 3], [2, 0], [1, 7], [3, 4], [6, 4], [1, 4]]);
assert.deepStrictEqual(sampleSequence(cfg, 2, 2, 4).slice(0, 6), [[6, 2], [7, 7], [4, 0], [4, 5], [4, 6], [7, 1]]);
assert.deepStrictEqual(sampleSequence(cfg, 1, 4, 4).slice(0, 3), [[0, 3], [2, 0], [6, 5]]);

// ---- confidence ----
assert.strictEqual(confidenceDecimal(0, 2), "0.0000");
assert.strictEqual(confidenceDecimal(1, 2), "56.2500");
assert.strictEqual(confidenceDecimal(2, 2), "80.8594");
assert.strictEqual(confidenceDecimal(3, 2), "91.6260");
assert.strictEqual(confidenceDecimal(1, 4), "39.0625");
assert.strictEqual(confidenceDecimal(6, 4), "94.8796");
assert.strictEqual(confidenceDecimal(1, 8), "31.6406");
assert.strictEqual(confidenceDecimal(1, 1), "100.0000");

// ---- percentages ----
assert.strictEqual(percentFromFraction(4500n * 1_000_000n, 10_800n * 1_000_000n), "41.67");
assert.strictEqual(percentFromFraction(3300n * 1_000_000n, 10_800n * 1_000_000n), "30.56");
assert.strictEqual(percentFromFraction(2000n * 1_000_000n, 10_800n * 1_000_000n), "18.52");
assert.strictEqual(percentFromFraction(1000n * 1_000_000n, 10_800n * 1_000_000n), "9.26");
assert.strictEqual(percentFromFraction(9_500n * 1_000_000n, 10_800n * 1_000_000n), "87.96");
assert.strictEqual(percentFromFraction(3_000n * 1_000_000n, 9_500n * 1_000_000n), "31.58");

// ---- money formatting ----
assert.strictEqual(formatFern(3_999_992_000n), "3,999.992000");
assert.strictEqual(formatFern(6_705n), "0.006705");

console.log("all domain worked vectors verified");
