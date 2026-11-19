import type { SectionId } from '../../shared/copy';
import { el } from '../shared/dom';
import type { CarFileState } from './state';

export interface SectionContext {
  carId: string;
  /** `status "Owner status"` on every owner screen. */
  status: HTMLElement;
  /** `alert "Service notice"` on the outlined notice panel. */
  notice: HTMLElement;
  state: () => CarFileState;
  /** Refetches and repaints, moving the baseline of the standing lines this action changed. */
  refresh: (changed: readonly SectionId[]) => Promise<void>;
  goTo: (id: SectionId) => void;
  /** Lets the shell release waiting poll announcements once an overlay has closed. */
  onOverlayClosed?: () => void;
}

export interface SectionView {
  id: SectionId;
  heading: HTMLElement;
  node: HTMLElement;
  paint: (state: CarFileState) => void;
}

export const sectionShell = (id: SectionId, headingText: string): { section: HTMLElement; heading: HTMLElement } => {
  const heading = el('h2', { class: 'section-heading', text: headingText });
  const section = el('section', { class: `car-section car-section-${id}`, id });
  section.append(heading);
  return { section, heading };
};

export const row = (cells: Node[], cls = 'data-row'): HTMLElement =>
  el('tr', { class: cls, role: 'row' }, cells);

export const cell = (content: Node | string, cls = ''): HTMLElement =>
  el('td', { class: cls, role: 'cell' }, [content]);

export const columnHeader = (text: string): HTMLElement => el('th', { role: 'columnheader', text });

export const dataTable = (name: string, headers: readonly string[], body: HTMLElement): HTMLElement =>
  el('table', { class: 'data-table', role: 'table', 'aria-label': name }, [
    el('thead', { role: 'rowgroup' }, [el('tr', { role: 'row' }, headers.map(columnHeader))]),
    body,
  ]);

export const labelledField = (
  labelText: string,
  control: HTMLElement,
  id: string,
): { nodes: Node[]; error: HTMLElement } => {
  control.id = id;
  control.setAttribute('aria-label', labelText);
  const error = el('p', { class: 'field-error' });
  error.hidden = true;
  return { nodes: [el('label', { class: 'field-label', for: id, text: labelText }), control, error], error };
};

export const showFieldError = (error: HTMLElement, message: string | undefined): void => {
  if (message === undefined) {
    error.hidden = true;
    error.textContent = '';
    return;
  }
  error.hidden = false;
  error.textContent = message;
};
