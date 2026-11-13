// Three-way merge of text files and of whole trees. Ours is the target branch, theirs the source branch.
import { diffLines, splitLines } from "./diff.ts";
import type { DiffOp } from "./diff.ts";

interface MergeLabels {
  readonly ours: string;
  readonly theirs: string;
}

interface CommonSegment {
  readonly kind: "common";
  readonly lines: string[];
}

interface ConflictSegment {
  readonly kind: "conflict";
  readonly ours: string[];
  readonly theirs: string[];
}

export type MergeSegment = CommonSegment | ConflictSegment;

interface MergeResult {
  readonly text: string;
  readonly clean: boolean;
  readonly segments: MergeSegment[];
}

// The base lines [start, end) are replaced by `lines`; an insertion has start === end.
interface Change {
  readonly start: number;
  end: number;
  readonly lines: string[];
}

function changesOf(ops: readonly DiffOp[]): Change[] {
  const changes: Change[] = [];
  let open: Change | null = null;
  let position = 0;
  for (const op of ops) {
    if (op.type === "equal") {
      open = null;
      position++;
      continue;
    }
    if (open === null) {
      open = { start: position, end: position, lines: [] };
      changes.push(open);
    }
    if (op.type === "del") {
      position++;
      open.end = position;
    } else {
      open.lines.push(op.text);
    }
  }
  return changes;
}

interface Cluster {
  start: number;
  end: number;
  readonly ours: Change[];
  readonly theirs: Change[];
}

// Changes that overlap or touch (one ends where the other starts) fall into the same cluster, from either side.
function clusterChanges(ours: readonly Change[], theirs: readonly Change[]): Cluster[] {
  const tagged = [...ours.map((change) => ({ change, mine: true })), ...theirs.map((change) => ({ change, mine: false }))];
  tagged.sort((a, b) => a.change.start - b.change.start || a.change.end - b.change.end);
  const clusters: Cluster[] = [];
  for (const { change, mine } of tagged) {
    let cluster = clusters[clusters.length - 1];
    if (cluster !== undefined && change.start <= cluster.end) {
      cluster.end = Math.max(cluster.end, change.end);
    } else {
      cluster = { start: change.start, end: change.end, ours: [], theirs: [] };
      clusters.push(cluster);
    }
    (mine ? cluster.ours : cluster.theirs).push(change);
  }
  return clusters;
}

function applyChanges(base: readonly string[], start: number, end: number, changes: readonly Change[]): string[] {
  const out: string[] = [];
  let position = start;
  for (const change of changes) {
    out.push(...base.slice(position, change.start), ...change.lines);
    position = change.end;
  }
  out.push(...base.slice(position, end));
  return out;
}

function sameLines(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((line, i) => line === b[i]);
}

function renderSegments(segments: readonly MergeSegment[], labels: MergeLabels): string {
  let text = "";
  for (const segment of segments) {
    if (segment.kind === "common") {
      for (const line of segment.lines) text += `${line}\n`;
    } else {
      text += `<<<<<<< ${labels.ours}\n`;
      for (const line of segment.ours) text += `${line}\n`;
      text += "=======\n";
      for (const line of segment.theirs) text += `${line}\n`;
      text += `>>>>>>> ${labels.theirs}\n`;
    }
  }
  return text;
}

export function merge3(base: string, ours: string, theirs: string, labels: MergeLabels): MergeResult {
  const baseLines = splitLines(base);
  const clusters = clusterChanges(changesOf(diffLines(baseLines, splitLines(ours))), changesOf(diffLines(baseLines, splitLines(theirs))));

  const segments: MergeSegment[] = [];
  let common: string[] = [];
  const flush = (): void => {
    if (common.length > 0) segments.push({ kind: "common", lines: common });
    common = [];
  };
  let position = 0;
  for (const cluster of clusters) {
    common.push(...baseLines.slice(position, cluster.start));
    position = cluster.end;
    const oursLines = applyChanges(baseLines, cluster.start, cluster.end, cluster.ours);
    const theirsLines = applyChanges(baseLines, cluster.start, cluster.end, cluster.theirs);
    if (cluster.theirs.length === 0 || sameLines(oursLines, theirsLines)) {
      common.push(...oursLines);
    } else if (cluster.ours.length === 0) {
      common.push(...theirsLines);
    } else {
      flush();
      segments.push({ kind: "conflict", ours: oursLines, theirs: theirsLines });
    }
  }
  common.push(...baseLines.slice(position));
  flush();

  let text = renderSegments(segments, labels);
  if (text !== "" && !base.endsWith("\n") && !ours.endsWith("\n") && !theirs.endsWith("\n")) text = text.slice(0, -1);
  return { text, clean: segments.every((segment) => segment.kind === "common"), segments };
}

export function resolveSegments(segments: readonly MergeSegment[], choices: readonly ("ours" | "theirs")[]): string {
  let text = "";
  let conflict = 0;
  for (const segment of segments) {
    const lines = segment.kind === "common" ? segment.lines : segment[choices[conflict++]];
    for (const line of lines) text += `${line}\n`;
  }
  return text;
}

export function hasConflictMarkers(text: string): boolean {
  return text.split("\n").some((line) => line.startsWith("<<<<<<< ") || line.startsWith("=======") || line.startsWith(">>>>>>> "));
}

// --- Whole trees -------------------------------------------------------------------------------------------------------

export interface TreeConflict {
  readonly path: string;
  readonly kind: "content" | "whole";
  // Only for content conflicts: the hunks to choose between.
  readonly segments?: MergeSegment[];
  // The text with conflict markers, as shown in the inline editor; a missing side counts as empty for a whole-file conflict.
  readonly markedText: string;
  readonly oursText: string | null;
  readonly theirsText: string | null;
}

interface TreeMergeResult {
  readonly files: Map<string, string>;
  readonly conflicts: TreeConflict[];
}

const encoder = new TextEncoder();

// Paths sort as UTF-8 bytes.
function comparePaths(a: string, b: string): number {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  const shared = Math.min(left.length, right.length);
  for (let i = 0; i < shared; i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

export function mergeTrees(
  base: ReadonlyMap<string, string>,
  ours: ReadonlyMap<string, string>,
  theirs: ReadonlyMap<string, string>,
  labels: MergeLabels,
): TreeMergeResult {
  const paths = [...new Set([...base.keys(), ...ours.keys(), ...theirs.keys()])].sort(comparePaths);
  const files = new Map<string, string>();
  const conflicts: TreeConflict[] = [];
  for (const path of paths) {
    const baseText = base.get(path);
    const oursText = ours.get(path);
    const theirsText = theirs.get(path);
    let taken: string | undefined;
    if (oursText === theirsText || theirsText === baseText) {
      taken = oursText;
    } else if (oursText === baseText) {
      taken = theirsText;
    } else if (baseText !== undefined && oursText !== undefined && theirsText !== undefined) {
      const merged = merge3(baseText, oursText, theirsText, labels);
      if (!merged.clean) {
        conflicts.push({ path, kind: "content", segments: merged.segments, markedText: merged.text, oursText, theirsText });
        continue;
      }
      taken = merged.text;
    } else {
      const segments: MergeSegment[] = [{ kind: "conflict", ours: splitLines(oursText ?? ""), theirs: splitLines(theirsText ?? "") }];
      conflicts.push({ path, kind: "whole", markedText: renderSegments(segments, labels), oursText: oursText ?? null, theirsText: theirsText ?? null });
      continue;
    }
    if (taken !== undefined) files.set(path, taken);
  }
  return { files, conflicts };
}
