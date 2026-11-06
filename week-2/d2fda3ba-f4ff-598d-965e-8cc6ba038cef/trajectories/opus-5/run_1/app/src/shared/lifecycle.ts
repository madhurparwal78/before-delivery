export type DossierState = 'draft' | 'in_review' | 'published' | 'unpublished' | 'lapsed';

export type DossierAction =
  | 'create_preview_link'
  | 'revoke_preview_link'
  | 'preview_link_expired'
  | 'publish'
  | 'unpublish'
  | 'takedown'
  | 'reopen';

const TRANSITIONS: Record<DossierAction, { from: DossierState[]; to: DossierState }> = {
  create_preview_link: { from: ['draft', 'in_review'], to: 'in_review' },
  revoke_preview_link: { from: ['in_review'], to: 'draft' },
  preview_link_expired: { from: ['in_review'], to: 'draft' },
  publish: { from: ['draft', 'in_review', 'published'], to: 'published' },
  unpublish: { from: ['published'], to: 'unpublished' },
  takedown: { from: ['published'], to: 'lapsed' },
  reopen: { from: ['unpublished', 'lapsed'], to: 'draft' },
};

/** The state an action leads to, or null when the dossier cannot make that move. */
export function nextDossierState(state: DossierState, action: DossierAction): DossierState | null {
  const transition = TRANSITIONS[action];
  return transition.from.includes(state) ? transition.to : null;
}

export const DOSSIER_STATE_LABELS: Record<DossierState, string> = {
  draft: 'Draft',
  in_review: 'In review',
  published: 'Published',
  unpublished: 'Unpublished',
  lapsed: 'Lapsed',
};
