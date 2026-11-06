// The word diff between two revisions' plain text (Business rules: "Revisions and the word diff").

export type DiffOp = { op: 'equal' | 'delete' | 'insert'; text: string };

type Step = { op: DiffOp['op']; token: string };

/** Maximal runs of whitespace and maximal runs of non-whitespace. */
export function diffTokens(plain: string): string[] {
  return plain.match(/\s+|\S+/g) ?? [];
}

/** V after each D, keeping only k from -D to D; `at(d, k)` reads V[k] of that snapshot. */
type Trace = { snapshots: Int32Array[]; at(d: number, k: number): number };

/** Myers forward greedy edit script. V lives at index k + offset, and V[1] starts at 0 (zero-filled). */
function forwardTrace(a: string[], b: string[]): Trace {
  const n = a.length;
  const m = b.length;
  const offset = n + m + 1;
  const v = new Int32Array(2 * offset + 1);
  const snapshots: Int32Array[] = [];
  for (let d = 0; d <= n + m; d++) {
    let done = false;
    for (let k = -d; k <= d && !done; k += 2) {
      let x = k === -d || (k !== d && v[k - 1 + offset] < v[k + 1 + offset]) ? v[k + 1 + offset] : v[k - 1 + offset] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[k + offset] = x;
      done = x >= n && y >= m;
    }
    snapshots.push(v.slice(offset - d - 1, offset + d + 2));
    if (done) break;
  }
  return { snapshots, at: (d, k) => snapshots[d][k + d + 1] };
}

/** Walks the trace backward with the same choice rule, producing steps in forward order. */
function recoverSteps(a: string[], b: string[], trace: Trace): Step[] {
  const reversed: Step[] = [];
  let x = a.length;
  let y = b.length;
  for (let d = trace.snapshots.length - 1; d > 0; d--) {
    const k = x - y;
    const insertion = k === -d || (k !== d && trace.at(d - 1, k - 1) < trace.at(d - 1, k + 1));
    const prevK = insertion ? k + 1 : k - 1;
    const prevX = trace.at(d - 1, prevK);
    const prevY = prevX - prevK;
    const snakeStart = insertion ? prevX : prevX + 1;
    while (x > snakeStart) {
      x--;
      y--;
      reversed.push({ op: 'equal', token: a[x] });
    }
    reversed.push(insertion ? { op: 'insert', token: b[prevY] } : { op: 'delete', token: a[prevX] });
    x = prevX;
    y = prevY;
  }
  while (x > 0) {
    x--;
    reversed.push({ op: 'equal', token: a[x] });
  }
  return reversed.reverse();
}

function pushMerged(ops: DiffOp[], op: DiffOp['op'], text: string): void {
  if (text === '') return;
  const last = ops[ops.length - 1];
  if (last !== undefined && last.op === op) last.text += text;
  else ops.push({ op, text });
}

export function wordDiff(fromPlain: string, toPlain: string): DiffOp[] {
  const a = diffTokens(fromPlain);
  const b = diffTokens(toPlain);
  const steps = recoverSteps(a, b, forwardTrace(a, b));
  const ops: DiffOp[] = [];
  let deleted = '';
  let inserted = '';
  for (const step of steps) {
    if (step.op === 'equal') {
      pushMerged(ops, 'delete', deleted);
      pushMerged(ops, 'insert', inserted);
      deleted = '';
      inserted = '';
      pushMerged(ops, 'equal', step.token);
    } else if (step.op === 'delete') deleted += step.token;
    else inserted += step.token;
  }
  pushMerged(ops, 'delete', deleted);
  pushMerged(ops, 'insert', inserted);
  return ops;
}
