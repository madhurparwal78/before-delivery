export type ModelState = 'draft' | 'in_review' | 'published' | 'withdrawn';

export const MODEL_STATES: readonly ModelState[] = [
  'draft',
  'in_review',
  'published',
  'withdrawn',
];

export function isModelState(v: unknown): v is ModelState {
  return v === 'draft' || v === 'in_review' || v === 'published' || v === 'withdrawn';
}

/** Who may make a move. A contributor may make only their own draft → in_review. */
export type Mover = 'author' | 'editor' | 'owning_contributor';

interface Edge {
  readonly from: ModelState;
  readonly to: ModelState;
  readonly movers: readonly Mover[];
}

const EDGES: readonly Edge[] = [
  { from: 'draft', to: 'in_review', movers: ['author', 'editor', 'owning_contributor'] },
  { from: 'in_review', to: 'draft', movers: ['author', 'editor'] },
  { from: 'in_review', to: 'published', movers: ['author', 'editor'] },
  { from: 'published', to: 'withdrawn', movers: ['author', 'editor'] },
  { from: 'withdrawn', to: 'in_review', movers: ['author', 'editor'] },
];

/** True when the pair is a legal edge, whoever the mover is. */
export function isLegalEdge(from: ModelState, to: ModelState): boolean {
  return EDGES.some((e) => e.from === from && e.to === to);
}

export function edgeAllows(from: ModelState, to: ModelState, mover: Mover): boolean {
  return EDGES.some((e) => e.from === from && e.to === to && e.movers.includes(mover));
}

/** The moves this mover may make from this state, used to enable studio controls. */
export function allowedTargets(from: ModelState, mover: Mover): readonly ModelState[] {
  return EDGES.filter((e) => e.from === from && e.movers.includes(mover)).map((e) => e.to);
}

/** Only a move to published needs a revision whose publish stage confirmed. */
export function needsConfirmedRevision(to: ModelState): boolean {
  return to === 'published';
}

/** Only a move to published spends a publish from the plan's quota. */
export function spendsQuota(to: ModelState): boolean {
  return to === 'published';
}

/** Leaving published ends share links, unlocks and embeds and clears the index. */
export function leavesPublished(from: ModelState, to: ModelState): boolean {
  return from === 'published' && to !== 'published';
}
