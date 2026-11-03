import type { Breakpoint, PlinthNode, StyleKey, StyleValue } from './types.js';

/** Inheritance runs down this chain: desktop -> tablet -> phone. */
const CHAIN: readonly Breakpoint[] = ['desktop', 'tablet', 'phone'];

export type StyleSource = 'set' | 'inherited' | 'unset';
export type PipState = 'set' | 'inherited' | 'overridden' | 'unset';

export function chainAtOrAbove(bp: Breakpoint): Breakpoint[] {
  const i = CHAIN.indexOf(bp);
  return CHAIN.slice(0, i + 1).reverse();
}

export function belowBreakpoints(bp: Breakpoint): Breakpoint[] {
  return CHAIN.slice(CHAIN.indexOf(bp) + 1);
}

export function ownStyle(node: PlinthNode, bp: Breakpoint, key: StyleKey): StyleValue | undefined {
  return node.styles[bp]?.[key];
}

/** The breakpoint whose own value applies at `bp`, or undefined when none does. */
export function sourceBreakpoint(
  node: PlinthNode,
  bp: Breakpoint,
  key: StyleKey,
): Breakpoint | undefined {
  for (const candidate of chainAtOrAbove(bp)) {
    if (ownStyle(node, candidate, key) !== undefined) return candidate;
  }
  return undefined;
}

/** The value that applies at `bp` after inheritance, before token resolution. */
export function resolveStyle(
  node: PlinthNode,
  bp: Breakpoint,
  key: StyleKey,
): StyleValue | undefined {
  const from = sourceBreakpoint(node, bp, key);
  return from === undefined ? undefined : ownStyle(node, from, key);
}

export function styleSource(node: PlinthNode, bp: Breakpoint, key: StyleKey): StyleSource {
  if (ownStyle(node, bp, key) !== undefined) return 'set';
  return sourceBreakpoint(node, bp, key) === undefined ? 'unset' : 'inherited';
}

export function pipState(node: PlinthNode, bp: Breakpoint, key: StyleKey): PipState {
  const own = ownStyle(node, bp, key) !== undefined;
  if (bp === 'desktop') return own ? 'set' : 'unset';
  if (own) return 'overridden';
  return sourceBreakpoint(node, bp, key) === undefined ? 'unset' : 'inherited';
}

/** An override can only be cleared where it is not the desktop base. */
export function canClearOverride(node: PlinthNode, bp: Breakpoint, key: StyleKey): boolean {
  return bp !== 'desktop' && ownStyle(node, bp, key) !== undefined;
}

export interface ReachGroups {
  inherited: Breakpoint[];
  kept: Breakpoint[];
  shielded: Breakpoint[];
}

/** How a change made at `changed` reaches the breakpoints below it. */
export function reachOfChange(node: PlinthNode, changed: Breakpoint, key: StyleKey): ReachGroups {
  const groups: ReachGroups = { inherited: [], kept: [], shielded: [] };
  let blocked = false;
  for (const bp of belowBreakpoints(changed)) {
    if (ownStyle(node, bp, key) !== undefined) {
      groups.kept.push(bp);
      blocked = true;
    } else if (blocked) {
      groups.shielded.push(bp);
    } else {
      groups.inherited.push(bp);
    }
  }
  return groups;
}

/** Frames that visibly change when the override at `cleared` is removed. */
export function reachOfClear(node: PlinthNode, cleared: Breakpoint, key: StyleKey): Breakpoint[] {
  const frames: Breakpoint[] = [cleared];
  for (const bp of belowBreakpoints(cleared)) {
    if (ownStyle(node, bp, key) !== undefined) break;
    frames.push(bp);
  }
  return frames;
}
