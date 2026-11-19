// Line diff over panes. Counts follow the brief: added lines are lines of B that
// are not in a longest common subsequence of A's and B's lines, removed lines
// are lines of A not in it, and rows merge both sides with removed first.
export type RowChange = "same" | "added" | "removed";

export interface PaneDiff {
  added: number;
  removed: number;
  rows: Array<{ change: RowChange; text: string }>;
}

export interface PanesLike {
  html: string;
  css: string;
  js: string;
}

export interface PanesDiff {
  a: number;
  b: number;
  added: number;
  removed: number;
  panes: { html: PaneDiff; css: PaneDiff; js: PaneDiff };
}

function splitLines(pane: string): string[] {
  if (pane === "") return [];
  return pane.split("\n");
}

// Matched (index in A, index in B) pairs forming an LCS.
function matchPairs(a: string[], b: string[]): Array<[number, number]> {
  const head: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length && a[i] === b[j]) {
    head.push([i, j]);
    i++;
    j++;
  }
  const ai0 = i;
  const bj0 = j;
  let ae = a.length;
  let be = b.length;
  while (ae > ai0 && be > bj0 && a[ae - 1] === b[be - 1]) {
    ae--;
    be--;
  }
  const n = ae - ai0;
  const m = be - bj0;
  const middle: Array<[number, number]> = [];
  if (n > 0 && m > 0) {
    // dir: 1 diagonal match, 2 advance A, 3 advance B
    const w = m + 1;
    const dir = new Uint8Array((n + 1) * w);
    const len = new Uint16Array((n + 1) * w);
    for (let x = n - 1; x >= 0; x--) {
      for (let y = m - 1; y >= 0; y--) {
        const idx = x * w + y;
        const diag = len[(x + 1) * w + (y + 1)] ?? 0;
        const down = len[(x + 1) * w + y] ?? 0;
        const right = len[x * w + (y + 1)] ?? 0;
        if (a[ai0 + x] === b[bj0 + y] && diag + 1 >= Math.max(down, right)) {
          len[idx] = diag + 1;
          dir[idx] = 1;
        } else if (down >= right) {
          len[idx] = down;
          dir[idx] = 2;
        } else {
          len[idx] = right;
          dir[idx] = 3;
        }
      }
    }
    let x = 0;
    let y = 0;
    while (x < n && y < m) {
      const d = dir[x * w + y];
      if (d === 1) {
        middle.push([ai0 + x, bj0 + y]);
        x++;
        y++;
      } else if (d === 2) {
        x++;
      } else {
        y++;
      }
    }
  }
  const tail: Array<[number, number]> = [];
  while (ae < a.length && be < b.length) {
    tail.push([ae, be]);
    ae++;
    be++;
  }
  return head.concat(middle, tail);
}

function paneDiff(a: string, b: string): PaneDiff {
  const la = splitLines(a);
  const lb = splitLines(b);
  const pairs = matchPairs(la, lb);
  const inA = new Set<number>();
  const inB = new Set<number>();
  for (const [x, y] of pairs) {
    inA.add(x);
    inB.add(y);
  }
  const rows: PaneDiff["rows"] = [];
  let added = 0;
  let removed = 0;
  let i = 0;
  let j = 0;
  for (const [x, y] of pairs) {
    while (i < x) {
      rows.push({ change: "removed", text: la[i] ?? "" });
      removed++;
      i++;
    }
    while (j < y) {
      rows.push({ change: "added", text: lb[j] ?? "" });
      added++;
      j++;
    }
    rows.push({ change: "same", text: la[x] ?? "" });
    i = x + 1;
    j = y + 1;
  }
  while (i < la.length) {
    rows.push({ change: "removed", text: la[i] ?? "" });
    removed++;
    i++;
  }
  while (j < lb.length) {
    rows.push({ change: "added", text: lb[j] ?? "" });
    added++;
    j++;
  }
  return { added, removed, rows };
}

export function diffPanes(a: PanesLike, b: PanesLike): Omit<PanesDiff, "a" | "b"> {
  const html = paneDiff(a.html, b.html);
  const css = paneDiff(a.css, b.css);
  const js = paneDiff(a.js, b.js);
  return {
    added: html.added + css.added + js.added,
    removed: html.removed + css.removed + js.removed,
    panes: { html, css, js },
  };
}

export function changedChars(panes: Record<"html" | "css" | "js", PaneDiff>): number {
  let total = 0;
  for (const pane of ["html", "css", "js"] as const) {
    for (const row of panes[pane].rows) {
      if (row.change !== "same") total += [...row.text].length;
    }
  }
  return total;
}
