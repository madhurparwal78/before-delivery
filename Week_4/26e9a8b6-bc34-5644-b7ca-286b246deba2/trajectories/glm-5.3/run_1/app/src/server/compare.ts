// Version comparison: the compare JSON and diff rows in one place.

import type { VersionRow } from './store';
import { formatCost, formatCostDifference, type CurrencyCode } from '../shared/cost';
import type { WorkingPart, WorkingStep } from '../shared/working';

export interface CompareJson {
  older: number;
  newer: number;
  added: { position: number; title: string }[];
  removed: { position: number; title: string }[];
  changed: { position: number; title: string; fields: string[] }[];
  moved: { title: string; from: number; to: number }[];
  part_changes: { part: string; field: string; from: unknown; to: unknown }[];
  cost_difference: number;
  cost_difference_text: string;
}

/** Compares two versions by step id; positions come from the version each belongs to. */
export function compareVersions(older: VersionRow, newer: VersionRow, currency: CurrencyCode): CompareJson {
  const olderSteps = older.steps as WorkingStep[];
  const newerSteps = newer.steps as WorkingStep[];
  const olderParts = older.parts as WorkingPart[];
  const newerParts = newer.parts as WorkingPart[];

  const olderById = new Map(olderSteps.map((step) => [step.id, step]));
  const newerById = new Map(newerSteps.map((step) => [step.id, step]));

  const added: CompareJson['added'] = [];
  const removed: CompareJson['removed'] = [];
  const changed: CompareJson['changed'] = [];
  const moved: CompareJson['moved'] = [];

  const bothOlder = olderSteps.filter((step) => newerById.has(step.id));
  const bothNewer = newerSteps.filter((step) => olderById.has(step.id));
  const orderOfBoth = new Map<string, number>();
  bothNewer.forEach((step, index) => orderOfBoth.set(step.id, index));

  for (const step of newerSteps) {
    const oldStep = olderById.get(step.id);
    if (!oldStep) {
      added.push({ position: step.number, title: step.title });
      continue;
    }
    const fields = stepDiffFields(oldStep, step);
    if (fields.length > 0) changed.push({ position: step.number, title: step.title, fields });
    const oldRank = bothOlder.findIndex((s) => s.id === step.id);
    const newRank = orderOfBoth.get(step.id) ?? -1;
    if (oldRank !== newRank) {
      moved.push({ title: step.title, from: oldStep.number, to: step.number });
    }
  }
  for (const step of olderSteps) {
    if (!newerById.has(step.id)) removed.push({ position: step.number, title: step.title });
  }

  const partChanges: CompareJson['part_changes'] = [];
  const newerPartById = new Map(newerParts.map((part) => [part.id, part]));
  const olderPartById = new Map(olderParts.map((part) => [part.id, part]));
  const newerStepById = new Map(newerSteps.map((step) => [step.id, step]));
  const olderStepById = new Map(olderSteps.map((step) => [step.id, step]));

  for (const part of newerParts) {
    const old = olderPartById.get(part.id);
    const newName = part.name;
    if (!old) {
      partChanges.push({ part: newName, field: 'name', from: null, to: newName });
      continue;
    }
    if (old.name !== part.name) partChanges.push({ part: newName, field: 'name', from: old.name, to: part.name });
    if (old.quantity !== part.quantity) partChanges.push({ part: newName, field: 'quantity', from: old.quantity, to: part.quantity });
    if (old.unit_price !== part.unit_price) partChanges.push({ part: newName, field: 'unit_price', from: old.unit_price, to: part.unit_price });
    const oldFitted = old.fitted_at ? olderStepById.get(old.fitted_at)?.title ?? null : null;
    const newFitted = part.fitted_at ? newerStepById.get(part.fitted_at)?.title ?? null : null;
    if (oldFitted !== newFitted) partChanges.push({ part: newName, field: 'fitted_at', from: oldFitted, to: newFitted });
  }
  for (const part of olderParts) {
    if (!newerPartById.has(part.id)) partChanges.push({ part: part.name, field: 'name', from: part.name, to: null });
  }

  const difference = Number(newer.parts_cost) - Number(older.parts_cost);
  return {
    older: older.number,
    newer: newer.number,
    added,
    removed,
    changed,
    moved,
    part_changes: partChanges,
    cost_difference: difference,
    cost_difference_text: formatCostDifference(difference, currency),
  };
}

function stepDiffFields(older: WorkingStep, newer: WorkingStep): string[] {
  const fields: string[] = [];
  if (older.title !== newer.title) fields.push('title');
  if (older.text !== newer.text) fields.push('text');
  if (older.phase !== newer.phase) fields.push('phase');
  if (older.explode !== newer.explode) fields.push('explode');
  if (!arrayEqual(older.focus_parts, newer.focus_parts)) fields.push('focus_parts');
  if (cameraDiffers(older.camera, newer.camera)) fields.push('camera');
  if (calloutsDiffers(older.callouts, newer.callouts)) fields.push('callouts');
  return fields;
}

function arrayEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function cameraDiffers(a: { yaw: number; pitch: number; zoom: number }, b: { yaw: number; pitch: number; zoom: number }): boolean {
  return a.yaw !== b.yaw || a.pitch !== b.pitch || a.zoom !== b.zoom;
}

function calloutsDiffers(a: { part_id: string; text: string }[], b: { part_id: string; text: string }[]): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

/** Word-by-word text diff used by the compare rows. */
export function wordDiff(olderText: string, newerText: string): { removed: string[]; added: string[] } {
  const olderWords = olderText.split(/\s+/).filter(Boolean);
  const newerWords = newerText.split(/\s+/).filter(Boolean);
  const removed: string[] = [];
  const added: string[] = [];
  let i = 0;
  let j = 0;
  while (i < olderWords.length || j < newerWords.length) {
    if (i < olderWords.length && j < newerWords.length && olderWords[i] === newerWords[j]) {
      i++;
      j++;
      continue;
    }
    // Look ahead for a re-sync point.
    const syncOlder = findSync(olderWords, newerWords, i, j);
    if (syncOlder !== null) {
      for (let k = i; k < syncOlder.olderIndex; k++) removed.push(olderWords[k]);
      for (let k = j; k < syncOlder.newerIndex; k++) added.push(newerWords[k]);
      i = syncOlder.olderIndex;
      j = syncOlder.newerIndex;
      continue;
    }
    for (; i < olderWords.length; i++) removed.push(olderWords[i]);
    for (; j < newerWords.length; j++) added.push(newerWords[j]);
  }
  return { removed, added };
}

function findSync(olderWords: string[], newerWords: string[], i: number, j: number): { olderIndex: number; newerIndex: number } | null {
  for (let lookahead = 1; lookahead <= 8; lookahead++) {
    for (let di = 0; di <= lookahead; di++) {
      const dj = lookahead - di;
      const oi = i + di;
      const nj = j + dj;
      if (oi >= olderWords.length || nj >= newerWords.length) continue;
      if (olderWords[oi] === newerWords[nj]) return { olderIndex: oi, newerIndex: nj };
    }
  }
  return null;
}
