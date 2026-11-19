export type Phase = 'open_up' | 'take_out' | 'fit_new' | 'close_up' | 'test_it';

export const PHASES: Phase[] = ['open_up', 'take_out', 'fit_new', 'close_up', 'test_it'];

export const PHASE_NAMES: Record<Phase, string> = {
  open_up: 'Open up',
  take_out: 'Take out',
  fit_new: 'Fit new',
  close_up: 'Close up',
  test_it: 'Test it',
};

// Colour roles from Visual design; phases are flat full-height fields.
export interface PhaseField {
  field: string;
  text: string;
}

export const PHASE_FIELDS: Record<Phase | 'closing', PhaseField> = {
  open_up: { field: 'var(--post-red)', text: '#ffffff' },
  take_out: { field: 'var(--bone)', text: 'var(--ink)' },
  fit_new: { field: 'var(--mustard)', text: 'var(--ink)' },
  close_up: { field: 'var(--slate)', text: '#ffffff' },
  test_it: { field: 'var(--maroon)', text: '#ffffff' },
  closing: { field: 'var(--post-red)', text: '#ffffff' },
};

export function isPhase(value: unknown): value is Phase {
  return typeof value === 'string' && (PHASES as string[]).includes(value);
}

export const PHASE_FIELD_TEXT: Record<Phase | 'closing', PhaseField> = {
  open_up: { field: 'var(--post-red)', text: '#ffffff' },
  take_out: { field: 'var(--bone)', text: 'var(--ink)' },
  fit_new: { field: 'var(--mustard)', text: 'var(--ink)' },
  close_up: { field: 'var(--slate)', text: '#ffffff' },
  test_it: { field: 'var(--maroon)', text: '#ffffff' },
  closing: { field: 'var(--post-red)', text: '#ffffff' },
};
