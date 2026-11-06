import { api, isApiError, getStaffId, setStaffId, getUnit, setUnit } from './api.js';
import type { Staff, Unit } from './types.js';
import { el } from './ui.js';

/**
 * The staff header shared by the workspace, Loan register and record pages:
 * product name, Sections navigation, Working as picker and Units toggle.
 */
export function renderStaffHeader(params: {
  currentPath: '/' | '/records' | `/records/${string}`;
  staffList: Staff[];
  staffId: string;
  unit: Unit;
  onStaffChange?: () => void;
  onUnitChange?: () => void;
}): HTMLElement {
  const header = el('header', { class: 'site-header' });
  header.append(el('span', { class: 'product-name', text: 'Hangline' }));

  const nav = el('nav', { class: 'sections-nav', 'aria-label': 'Sections' });
  const gallery = el('a', { href: '/', text: 'Gallery' });
  const register = el('a', { href: '/records', text: 'Loan register' });
  if (params.currentPath === '/') gallery.setAttribute('aria-current', 'page');
  else register.setAttribute('aria-current', 'page');
  nav.append(gallery, register);
  header.append(nav);

  const controls = el('div', { class: 'header-controls' });
  const staffSelect = el('select', { 'aria-label': 'Working as', 'data-focus-key': 'staff' }) as HTMLSelectElement;
  for (const s of params.staffList) {
    const option = el('option', { value: s.id, text: `${s.name} (${s.role})` });
    if (s.id === params.staffId) option.setAttribute('selected', 'selected');
    staffSelect.append(option);
  }
  staffSelect.addEventListener('change', () => {
    setStaffId(staffSelect.value);
    params.onStaffChange?.();
  });

  const units = el('div', { role: 'radiogroup', 'aria-label': 'Units' });
  for (const value of ['cm', 'in'] as Unit[]) {
    const radio = el('input', { type: 'radio', name: 'unit', id: `unit-${value}`, value }) as HTMLInputElement;
    radio.addEventListener('change', () => {
      setUnit(value);
      params.onUnitChange?.();
    });
    if (params.unit === value) radio.setAttribute('checked', 'checked');
    units.append(radio, el('label', { for: `unit-${value}`, text: value }));
  }
  controls.append(
    el('label', { class: 'control-label', text: 'Working as' }),
    staffSelect,
    units,
  );
  header.append(controls);
  return header;
}

export async function fetchStaff(): Promise<Staff[]> {
  const result = await api<{ staff: Staff[] }>('GET', '/api/staff');
  if (isApiError(result)) return [];
  return (result.body as { staff: Staff[] }).staff;
}
