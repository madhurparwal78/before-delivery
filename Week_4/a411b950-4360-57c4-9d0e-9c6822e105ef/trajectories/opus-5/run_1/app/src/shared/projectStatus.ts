export const PROJECT_STATUSES = ['draft', 'in_review', 'published', 'withdrawn'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const LAYERS = ['bed', 'pulse', 'lead', 'stinger'] as const;
export type Layer = (typeof LAYERS)[number];

export const LAYER_LABELS: Record<Layer, string> = {
  bed: 'Bed',
  pulse: 'Pulse',
  lead: 'Lead',
  stinger: 'Stinger',
};

const LEGAL_MOVES: Record<ProjectStatus, readonly ProjectStatus[]> = {
  draft: ['in_review', 'withdrawn'],
  in_review: ['draft', 'published', 'withdrawn'],
  published: ['withdrawn'],
  withdrawn: [],
};

export function isLegalProjectMove(from: ProjectStatus, to: ProjectStatus): boolean {
  return LEGAL_MOVES[from].includes(to);
}

export const CREDIT_TYPES = ['shipped', 'jam', 'redesign'] as const;
export type CreditType = (typeof CREDIT_TYPES)[number];

export const CREDIT_LABELS: Record<CreditType, string> = {
  shipped: 'Shipped title',
  jam: 'Game jam',
  redesign: 'Redesign',
};

export const VISIBILITIES = ['public', 'nda'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/** The one place that decides whether a project is on public pages: published and public. */
export const PUBLICLY_VISIBLE_SQL = `(p.status = 'published' AND p.visibility = 'public')`;

/** A link may be created for, and read through, a project in review or published. */
export function isLinkableStatus(status: ProjectStatus): boolean {
  return status === 'in_review' || status === 'published';
}
