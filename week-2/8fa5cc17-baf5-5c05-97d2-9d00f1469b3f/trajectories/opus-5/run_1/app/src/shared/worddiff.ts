/** The single home of the word diff used by block history. */

export type DiffOp = { op: 'equal' | 'delete' | 'insert'; text: string };

export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let index = 0;
  while (index < text.length) {
    const isSpace = /\s/.test(text.charAt(index));
    let end = index + 1;
    while (end < text.length && /\s/.test(text.charAt(end)) === isSpace) end += 1;
    tokens.push(text.slice(index, end));
    index = end;
  }
  return tokens;
}

type Step = { kind: 'equal' | 'delete' | 'insert'; text: string };

function shortestEditScript(a: string[], b: string[]): Step[] {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];
  const trace: Map<number, number>[] = [];
  let v = new Map<number, number>();
  v.set(1, 0);
  for (let d = 0; ; d += 1) {
    const current = new Map(v);
    for (let k = -d; k <= d; k += 2) {
      const left = current.get(k - 1);
      const right = current.get(k + 1);
      let x: number;
      if (k === -d || (k !== d && (left ?? -1) < (right ?? -1))) x = right ?? 0;
      else x = (left ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      current.set(k, x);
      if (x >= n && y >= m) {
        trace.push(current);
        return backtrack(trace, a, b, d, k);
      }
    }
    trace.push(current);
    v = current;
    if (d > n + m) return [];
  }
}

function backtrack(trace: Map<number, number>[], a: string[], b: string[], dEnd: number, kEnd: number): Step[] {
  const steps: Step[] = [];
  let k = kEnd;
  for (let d = dEnd; d > 0; d -= 1) {
    const current = trace[d];
    const previous = trace[d - 1];
    const x = current.get(k) as number;
    const left = previous.get(k - 1);
    const right = previous.get(k + 1);
    const useRight = k === -d || (k !== d && (left ?? -1) < (right ?? -1));
    const prevK = useRight ? k + 1 : k - 1;
    const prevX = (useRight ? right : left) as number;
    const prevY = prevX - prevK;
    const midX = useRight ? prevX : prevX + 1;
    for (let i = x - 1; i >= midX; i -= 1) steps.push({ kind: 'equal', text: a[i] });
    if (useRight) steps.push({ kind: 'insert', text: b[prevY] });
    else steps.push({ kind: 'delete', text: a[prevX] });
    k = prevK;
  }
  const first = trace[0].get(k) as number;
  for (let i = first - 1; i >= 0; i -= 1) steps.push({ kind: 'equal', text: a[i] });
  steps.reverse();
  return steps;
}

export function wordDiff(fromText: string, toText: string): DiffOp[] {
  const a = tokenize(fromText);
  const b = tokenize(toText);
  if (a.length === 0 && b.length === 0) return [];
  const steps = shortestEditScript(a, b);
  const out: DiffOp[] = [];
  let index = 0;
  while (index < steps.length) {
    const step = steps[index];
    if (step.kind === 'equal') {
      let text = '';
      while (index < steps.length && steps[index].kind === 'equal') {
        text += steps[index].text;
        index += 1;
      }
      push(out, 'equal', text);
      continue;
    }
    let deleted = '';
    let inserted = '';
    while (index < steps.length && steps[index].kind !== 'equal') {
      if (steps[index].kind === 'delete') deleted += steps[index].text;
      else inserted += steps[index].text;
      index += 1;
    }
    push(out, 'delete', deleted);
    push(out, 'insert', inserted);
  }
  return out;
}

function push(out: DiffOp[], op: DiffOp['op'], text: string): void {
  if (text.length === 0) return;
  const last = out[out.length - 1];
  if (last !== undefined && last.op === op) last.text += text;
  else out.push({ op, text });
}
