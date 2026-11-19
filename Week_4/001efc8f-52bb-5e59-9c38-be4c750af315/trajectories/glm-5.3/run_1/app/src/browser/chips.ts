import { el, svgEl, icon } from './dom';

export interface ChipOptions {
  active?: boolean;
  failed?: boolean;
}

/** Every state chip: Lucide glyph plus word, square corners, ink outline. */
export async function chip(kind: string, label: string, opts: ChipOptions = {}): Promise<HTMLElement> {
  const span = el('span', { class: `chip${opts.active ? ' active' : ''}${opts.failed ? ' failed' : ''}` });
  const svg = await icon(kind);
  if (svg) span.append(svgEl(svg));
  span.append(label);
  return span;
}

export const CHIP_ICONS: Record<string, string> = {
  Pending: 'hourglass',
  Sent: 'check',
  Delivered: 'check-check',
  Read: 'eye',
  Failed: 'alert-triangle',
  Pinned: 'pin',
  Edited: 'pencil',
  Private: 'lock',
};

export async function stateChip(state: string, opts: ChipOptions = {}): Promise<HTMLElement> {
  const [word, n] = state.startsWith('Read') ? ['Read', state.replace(/^Read · /, '')] : [state, ''];
  const key = state.startsWith('Read') ? 'Read' : state;
  const label = state.startsWith('Read') ? `Read · ${n}` : state;
  const span = el('span', { class: `chip${opts.active ? ' active' : ''}${opts.failed ? ' failed' : ''}` });
  const svg = await icon(CHIP_ICONS[key] ?? 'circle');
  if (svg) span.append(svgEl(svg));
  span.append(label);
  return span;
}
