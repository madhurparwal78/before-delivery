// The word diff: a forward greedy shortest edit script over whitespace and
// non-whitespace tokens. The single home of the diff algorithm.

export interface DiffOp {
  op: "equal" | "delete" | "insert";
  text: string;
}

/** Split text into maximal runs of whitespace and maximal runs of non-whitespace. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const ws = /^\s+/.exec(text.slice(i));
    if (ws) {
      out.push(ws[0]);
      i += ws[0].length;
      continue;
    }
    const word = /\S+/.exec(text.slice(i));
    if (word === null) break;
    out.push(word[0]);
    i += word[0].length;
  }
  return out;
}

/**
 * Word diff of two texts, per the published algorithm. Each maximal run of
 * non-equal steps is written as all its deletions, then all its insertions;
 * adjacent ops of the same kind are merged.
 */
export function wordDiff(fromText: string, toText: string): DiffOp[] {
  const A = tokenize(fromText);
  const B = tokenize(toText);
  const N = A.length;
  const M = B.length;
  if (N === 0 && M === 0) return [];

  const V = new Map<number, number>();
  V.set(1, 0);
  const snapshots: Array<Map<number, number>> = [];
  let dFound = -1;
  for (let d = 0; d <= N + M; d += 1) {
    snapshots.push(new Map(V));
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d) {
        x = V.get(k + 1) ?? 0;
      } else if (k !== d && (V.get(k - 1) ?? 0) < (V.get(k + 1) ?? 0)) {
        x = V.get(k + 1) ?? 0;
      } else {
        x = (V.get(k - 1) ?? 0) + 1;
      }
      let y = x - k;
      while (x < N && y < M && A[x] === B[y]) {
        x += 1;
        y += 1;
      }
      V.set(k, x);
      if (x >= N && y >= M) {
        dFound = d;
        break;
      }
    }
    if (dFound !== -1) break;
  }
  if (dFound === -1) dFound = N + M;

  // recover the path backward
  interface Step {
    kind: "equal" | "delete" | "insert";
    token: string;
  }
  const steps: Step[] = [];
  let x = N;
  let y = M;
  for (let d = dFound; d > 0; d -= 1) {
    const k = x - y;
    const Vp = snapshots[d - 1];
    let prevK: number;
    if (k === -d || (k !== d && (Vp.get(k - 1) ?? 0) < (Vp.get(k + 1) ?? 0))) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = Vp.get(prevK) ?? 0;
    const afterMoveX = prevK === k + 1 ? prevX : prevX + 1;
    // snake back over the equal run of step d
    while (x > afterMoveX && y > 0 && x > 0 && A[x - 1] === B[y - 1]) {
      x -= 1;
      y -= 1;
      steps.push({ kind: "equal", token: A[x] });
    }
    if (prevK === k + 1) {
      y -= 1;
      steps.push({ kind: "insert", token: B[y] });
    } else {
      x -= 1;
      steps.push({ kind: "delete", token: A[x] });
    }
  }
  // d reached 0: the remaining path is the initial equal run
  while (x > 0 && y > 0 && x === y) {
    x -= 1;
    y -= 1;
    steps.push({ kind: "equal", token: A[x] });
  }
  steps.reverse();

  // group: each maximal run of non-equal steps as deletions then insertions
  const ops: DiffOp[] = [];
  let runDel: string[] = [];
  let runIns: string[] = [];
  const flushRun = () => {
    if (runDel.length > 0) {
      ops.push({ op: "delete", text: runDel.join("") });
      runDel = [];
    }
    if (runIns.length > 0) {
      ops.push({ op: "insert", text: runIns.join("") });
      runIns = [];
    }
  };
  for (const s of steps) {
    if (s.kind === "equal") {
      flushRun();
      const last = ops[ops.length - 1];
      if (last && last.op === "equal") last.text += s.token;
      else ops.push({ op: "equal", text: s.token });
    } else if (s.kind === "delete") {
      runDel.push(s.token);
    } else {
      runIns.push(s.token);
    }
  }
  flushRun();
  return ops;
}
