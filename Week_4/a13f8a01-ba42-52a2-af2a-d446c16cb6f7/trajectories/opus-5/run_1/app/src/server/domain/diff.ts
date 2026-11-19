import type { DiffRow, Files, PaneDiff, PaneName } from '../../shared/api';

export const PANES: readonly PaneName[] = ['html', 'css', 'js'];

export const EMPTY_FILES: Files = { html: '', css: '', js: '' };

/** An empty pane has zero lines; a non-empty pane is split on "\n". */
export const paneLines = (pane: string): string[] => (pane === '' ? [] : pane.split('\n'));

const lcsLengths = (a: readonly string[], b: readonly string[]): Int32Array => {
  const row = new Int32Array(b.length + 1);
  for (const lineA of a) {
    let diagonal = 0;
    for (let j = 0; j < b.length; j += 1) {
      const next = row[j + 1]!;
      row[j + 1] = lineA === b[j] ? diagonal + 1 : Math.max(row[j]!, next);
      diagonal = next;
    }
  }
  return row;
};

const same = (text: string): DiffRow => ({ change: 'same', text });
const added = (text: string): DiffRow => ({ change: 'added', text });
const removed = (text: string): DiffRow => ({ change: 'removed', text });

/** Hirschberg's linear-space longest-common-subsequence alignment. */
const align = (a: readonly string[], b: readonly string[], out: DiffRow[]): void => {
  if (a.length === 0) {
    for (const line of b) out.push(added(line));
    return;
  }
  if (b.length === 0) {
    for (const line of a) out.push(removed(line));
    return;
  }
  if (a.length === 1) {
    const index = b.indexOf(a[0]!);
    if (index === -1) {
      out.push(removed(a[0]!));
      for (const line of b) out.push(added(line));
      return;
    }
    for (let j = 0; j < index; j += 1) out.push(added(b[j]!));
    out.push(same(a[0]!));
    for (let j = index + 1; j < b.length; j += 1) out.push(added(b[j]!));
    return;
  }

  const mid = a.length >> 1;
  const head = lcsLengths(a.slice(0, mid), b);
  const tail = lcsLengths(a.slice(mid).reverse(), b.slice().reverse());

  let best = -1;
  let split = 0;
  for (let j = 0; j <= b.length; j += 1) {
    const total = head[j]! + tail[b.length - j]!;
    if (total > best) {
      best = total;
      split = j;
    }
  }

  align(a.slice(0, mid), b.slice(0, split), out);
  align(a.slice(mid), b.slice(split), out);
};

/** Within every gap between matches, removed rows come before added rows. */
const orderGaps = (rows: DiffRow[]): DiffRow[] => {
  const ordered: DiffRow[] = [];
  let gapRemoved: DiffRow[] = [];
  let gapAdded: DiffRow[] = [];
  const flush = (): void => {
    ordered.push(...gapRemoved, ...gapAdded);
    gapRemoved = [];
    gapAdded = [];
  };
  for (const row of rows) {
    if (row.change === 'same') {
      flush();
      ordered.push(row);
    } else if (row.change === 'removed') {
      gapRemoved.push(row);
    } else {
      gapAdded.push(row);
    }
  }
  flush();
  return ordered;
};

export const diffPane = (before: string, after: string): PaneDiff => {
  const a = paneLines(before);
  const b = paneLines(after);

  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const middle: DiffRow[] = [];
  align(a.slice(prefix, a.length - suffix), b.slice(prefix, b.length - suffix), middle);

  const rows: DiffRow[] = [
    ...a.slice(0, prefix).map(same),
    ...orderGaps(middle),
    ...a.slice(a.length - suffix).map(same),
  ];

  return {
    added: rows.filter((row) => row.change === 'added').length,
    removed: rows.filter((row) => row.change === 'removed').length,
    rows,
  };
};

export interface FileDiff {
  added: number;
  removed: number;
  changed_chars: number;
  panes: { html: PaneDiff; css: PaneDiff; js: PaneDiff };
}

/** The one place that counts added lines, removed lines and changed characters. */
export const diffFiles = (before: Files, after: Files): FileDiff => {
  const panes = {
    html: diffPane(before.html, after.html),
    css: diffPane(before.css, after.css),
    js: diffPane(before.js, after.js),
  };
  let addedTotal = 0;
  let removedTotal = 0;
  let changedChars = 0;
  for (const pane of PANES) {
    addedTotal += panes[pane].added;
    removedTotal += panes[pane].removed;
    for (const row of panes[pane].rows) {
      if (row.change !== 'same') changedChars += [...row.text].length;
    }
  }
  return { added: addedTotal, removed: removedTotal, changed_chars: changedChars, panes };
};
