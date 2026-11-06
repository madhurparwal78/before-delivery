import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_OPS,
  applyToText,
  composeOps,
  diffOps,
  invertOps,
  normaliseOps,
  opsFit,
  transformOffset,
  transformPair,
  type Op,
} from './ot.ts';

test('opsFit accepts well-formed ops covering the base length', () => {
  assert.equal(opsFit([{ retain: 3 }, { insert: 'x' }, { delete: 2 }], 5), true);
  assert.equal(opsFit([{ insert: 'x' }], 0), true);
});

test('opsFit refuses malformed ops and wrong lengths', () => {
  const refused: unknown[] = [
    [],
    [{ retain: 3 }],
    [{ retain: 0 }, { retain: 5 }],
    [{ insert: '' }, { retain: 5 }],
    [{ retain: 2.5 }, { retain: 2.5 }],
    [{ retain: 5, insert: 'x' }],
    [{ keep: 5 }],
    [{ delete: -5 }],
    [null],
    'retain',
    { retain: 5 },
    Array.from({ length: MAX_OPS + 1 }, () => ({ insert: 'x' })),
  ];
  for (const value of refused) assert.equal(opsFit(value, 5), false, JSON.stringify(value)?.slice(0, 60));
  assert.equal(opsFit(Array.from({ length: MAX_OPS }, () => ({ insert: 'x' })), 0), true);
});

test('applyToText walks retain, insert and delete', () => {
  assert.equal(applyToText('hello world', [{ retain: 6 }, { delete: 5 }, { insert: 'there' }]), 'hello there');
  assert.equal(applyToText('', [{ insert: 'a' }]), 'a');
});

test('normaliseOps merges adjacent ops of one kind and keeps the final retain', () => {
  assert.deepEqual(
    normaliseOps([{ retain: 1 }, { retain: 2 }, { insert: 'a' }, { insert: 'b' }, { delete: 1 }, { delete: 1 }, { retain: 4 }]),
    [{ retain: 3 }, { insert: 'ab' }, { delete: 2 }, { retain: 4 }],
  );
});

test('inserts at the same offset put the committed one first', () => {
  const text = 'abc';
  const committed: Op[] = [{ retain: 1 }, { insert: 'X' }, { retain: 2 }];
  const incoming: Op[] = [{ retain: 1 }, { insert: 'Y' }, { retain: 2 }];
  const result = transformPair(committed, incoming);
  assert.ok(result);
  assert.equal(applyToText(applyToText(text, committed), result.incoming), 'aXYbc');
  assert.equal(applyToText(applyToText(text, incoming), result.committed), 'aXYbc');
});

test('positions shift right after an earlier insert and left after an earlier delete', () => {
  const text = 'abcdefgh';
  const committed: Op[] = [{ insert: 'AB' }, { retain: 1 }, { delete: 2 }, { retain: 5 }];
  const incoming: Op[] = [{ retain: 6 }, { insert: 'Z' }, { retain: 2 }];
  const result = transformPair(committed, incoming);
  assert.ok(result);
  assert.deepEqual(result.incoming, [{ retain: 6 }, { insert: 'Z' }, { retain: 2 }]);
  assert.equal(applyToText(applyToText(text, committed), result.incoming), 'ABadefZgh');
});

test('a delete range partly after an earlier delete shrinks only by the overlap-free part', () => {
  const text = 'abcdefgh';
  const committed: Op[] = [{ retain: 1 }, { delete: 2 }, { retain: 5 }];
  const incoming: Op[] = [{ retain: 3 }, { delete: 3 }, { retain: 2 }];
  const result = transformPair(committed, incoming);
  assert.ok(result, 'adjacent deletes are not a conflict');
  assert.deepEqual(result.incoming, [{ retain: 1 }, { delete: 3 }, { retain: 2 }]);
  assert.equal(applyToText(applyToText(text, committed), result.incoming), 'agh');
});

test('conflict: deleted ranges overlapping by a positive length', () => {
  assert.equal(transformPair([{ retain: 4 }, { delete: 5 }, { retain: 3 }], [{ retain: 6 }, { delete: 5 }, { retain: 1 }]), null);
  assert.equal(transformPair([{ delete: 12 }], [{ retain: 3 }, { delete: 1 }, { retain: 8 }]), null);
  assert.equal(transformPair([{ retain: 3 }, { delete: 2 }, { retain: 7 }], [{ retain: 3 }, { delete: 2 }, { retain: 7 }]), null);
});

test('conflict: an insert strictly inside the other side\'s deleted range, either way round', () => {
  const del: Op[] = [{ retain: 4 }, { delete: 5 }, { retain: 3 }];
  const ins: Op[] = [{ retain: 6 }, { insert: 'X' }, { retain: 6 }];
  assert.equal(transformPair(del, ins), null);
  assert.equal(transformPair(ins, del), null);
});

test('an insert at the exact start or end of a deleted range is not a conflict', () => {
  const text = 'abcdefghijkl';
  const del: Op[] = [{ retain: 4 }, { delete: 5 }, { retain: 3 }];
  for (const at of [4, 9]) {
    const ins: Op[] = [{ retain: at }, { insert: 'X' }, { retain: 12 - at }];
    for (const [committed, incoming] of [[del, ins], [ins, del]]) {
      const result = transformPair(committed, incoming);
      assert.ok(result, `insert at ${at}`);
      assert.equal(applyToText(applyToText(text, committed), result.incoming), 'abcdXjkl');
      assert.equal(applyToText(applyToText(text, incoming), result.committed), 'abcdXjkl');
    }
  }
});

test('a side\'s contiguous deletes count as one range even around its own insert', () => {
  const committed: Op[] = [{ delete: 2 }, { insert: 'n' }, { delete: 2 }, { retain: 2 }];
  assert.equal(transformPair(committed, [{ retain: 2 }, { insert: 'X' }, { retain: 4 }]), null);
});

test('the merge test sequence: inserts, delete, conflicting and adjacent edits', () => {
  // Mirrors the server fold: transform the incoming ops over each later committed revision.
  const s5 = 'XYA base Z';
  const committed: Op[] = [{ retain: 4 }, { delete: 5 }, { retain: s5.length - 9 }];
  const s6 = applyToText(s5, committed);
  assert.equal(transformPair(committed, [{ retain: 6 }, { delete: 2 }, { retain: s5.length - 8 }]), null);
  assert.equal(transformPair(committed, [{ retain: 6 }, { insert: 'X' }, { retain: s5.length - 6 }]), null);
  const result = transformPair(committed, [{ delete: 4 }, { retain: s5.length - 4 }]);
  assert.ok(result);
  assert.equal(applyToText(s6, result.incoming), s6.slice(4));
});

test('several inserts at the end from one version land in commit order', () => {
  const base = 'replaced';
  const sends = ['[0]', '[1]', '[2]'].map((t): Op[] => [{ retain: base.length }, { insert: t }]);
  let text = base;
  const history: Op[][] = [];
  for (const ops of sends) {
    let incoming: Op[] | null = ops;
    for (const rev of history) incoming = incoming === null ? null : (transformPair(rev, incoming)?.incoming ?? null);
    assert.ok(incoming);
    text = applyToText(text, incoming);
    history.push(incoming);
  }
  assert.equal(text, 'replaced[0][1][2]');
});

function randomText(rand: () => number, length: number): string {
  let s = '';
  for (let i = 0; i < length; i += 1) s += 'abcdefgh'[Math.floor(rand() * 8)];
  return s;
}

function randomOps(rand: () => number, length: number): Op[] {
  const ops: Op[] = [];
  let pos = 0;
  while (pos < length) {
    const roll = rand();
    const n = 1 + Math.floor(rand() * Math.min(4, length - pos));
    if (roll < 0.25) ops.push({ insert: randomText(rand, 1 + Math.floor(rand() * 3)) });
    else if (roll < 0.45) {
      ops.push({ delete: n });
      pos += n;
    } else {
      ops.push({ retain: n });
      pos += n;
    }
  }
  if (rand() < 0.3) ops.push({ insert: 'Q' });
  return normaliseOps(ops.length === 0 ? [{ insert: 'E' }] : ops);
}

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

test('convergence: both orders give the same text for random op pairs', () => {
  const rand = seeded(7);
  let merged = 0;
  for (let round = 0; round < 3000; round += 1) {
    const text = randomText(rand, Math.floor(rand() * 12));
    const committed = randomOps(rand, text.length);
    const incoming = randomOps(rand, text.length);
    assert.ok(opsFit(committed, text.length) && opsFit(incoming, text.length));
    const result = transformPair(committed, incoming);
    if (result === null) continue;
    merged += 1;
    const viaCommitted = applyToText(applyToText(text, committed), result.incoming);
    const viaIncoming = applyToText(applyToText(text, incoming), result.committed);
    assert.equal(viaCommitted, viaIncoming, JSON.stringify({ text, committed, incoming }));
    const mid = applyToText(text, committed);
    if (result.incoming.length > 0) assert.ok(opsFit(result.incoming, mid.length));
  }
  assert.ok(merged > 500, `only ${merged} pairs merged`);
});

test('transformOffset moves past an insert at the offset and to the start of a deleted range', () => {
  assert.equal(transformOffset(3, [{ retain: 3 }, { insert: 'XY' }, { retain: 2 }]), 5);
  assert.equal(transformOffset(3, [{ retain: 4 }, { insert: 'XY' }, { retain: 1 }]), 3);
  assert.equal(transformOffset(3, [{ insert: 'A' }, { retain: 5 }]), 4);
  assert.equal(transformOffset(3, [{ retain: 1 }, { delete: 3 }, { retain: 1 }]), 1);
  assert.equal(transformOffset(4, [{ retain: 1 }, { delete: 3 }, { retain: 1 }]), 1);
  assert.equal(transformOffset(5, [{ retain: 1 }, { delete: 3 }, { retain: 1 }]), 2);
  assert.equal(transformOffset(1, [{ retain: 1 }, { delete: 3 }, { retain: 1 }]), 1);
});

test('transformOffset keeps a caret on the same character', () => {
  const text = 'the quick fox';
  const ops: Op[] = [{ insert: 'so ' }, { retain: 4 }, { delete: 6 }, { retain: 3 }];
  const after = applyToText(text, ops);
  assert.equal(after[transformOffset(text.indexOf('fox'), ops)], 'f');
});

test('invertOps undoes ops', () => {
  const text = 'hello world';
  const ops: Op[] = [{ retain: 6 }, { delete: 5 }, { insert: 'there' }];
  assert.equal(applyToText(applyToText(text, ops), invertOps(ops, text)), text);
});

test('diffOps finds one changed region and covers the full length', () => {
  assert.deepEqual(diffOps('same', 'same'), []);
  assert.deepEqual(diffOps('abcdef', 'abXYef'), [{ retain: 2 }, { delete: 2 }, { insert: 'XY' }, { retain: 2 }]);
  assert.deepEqual(diffOps('', 'new'), [{ insert: 'new' }]);
  assert.deepEqual(diffOps('aaa', 'aaaa'), [{ retain: 3 }, { insert: 'a' }]);
  const rand = seeded(3);
  for (let i = 0; i < 300; i += 1) {
    const before = randomText(rand, Math.floor(rand() * 8));
    const after = randomText(rand, Math.floor(rand() * 8));
    const ops = diffOps(before, after);
    assert.equal(applyToText(before, ops), after);
    if (before !== after) assert.ok(opsFit(ops, before.length));
  }
});

test('diffOps never splits a surrogate pair', () => {
  const ops = diffOps('a\u{1F600}', 'a\u{1F601}');
  assert.deepEqual(ops, [{ retain: 1 }, { delete: 2 }, { insert: '\u{1F601}' }]);
});

test('composeOps equals applying both lists in turn', () => {
  const rand = seeded(11);
  for (let i = 0; i < 1000; i += 1) {
    const text = randomText(rand, Math.floor(rand() * 10));
    const a = randomOps(rand, text.length);
    const mid = applyToText(text, a);
    const b = randomOps(rand, mid.length);
    const composed = composeOps(a, b);
    assert.equal(applyToText(text, composed), applyToText(mid, b));
    if (composed.length > 0) assert.ok(opsFit(composed, text.length));
  }
});

test('op lists made against different lengths are refused', () => {
  assert.throws(() => transformPair([{ retain: 3 }], [{ retain: 4 }]), RangeError);
  assert.throws(() => composeOps([{ retain: 3 }], [{ retain: 4 }]), RangeError);
});
