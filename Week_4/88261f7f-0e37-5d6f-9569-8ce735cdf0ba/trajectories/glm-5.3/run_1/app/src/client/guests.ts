import { ApiRequest, errorText } from './api.js';
import { el, status } from './ui.js';
import type { App } from './main.js';
import { navigate, setDeskNotice } from './main.js';
import type { GuestRecord } from './types.js';
import { trapTab } from './newStay.js';

export async function renderGuests(app: App): Promise<void> {
  const searchInput = el('input', { type: 'search', 'aria-label': 'Search guests' }) as HTMLInputElement;
  const tableWrap = el('div', {});
  const mergeStatus = status('');
  mergeStatus.setAttribute('role', 'status');

  const load = async () => {
    const res = await ApiRequest.get(`/api/guests?search=${encodeURIComponent(searchInput.value)}`);
    if (res.status !== 200) return;
    const guests = res.data.guests as GuestRecord[];
    const table = el('table', { class: 'data', 'aria-label': 'Guests' });
    table.append(el('thead', {}, el('tr', {},
      el('th', { text: 'Name' }), el('th', { text: 'Email' }), el('th', { text: 'Phone' }),
      el('th', { text: 'Company' }), el('th', { text: 'Address' }))));
    const tbody = el('tbody');
    for (const g of guests) {
      tbody.append(el('tr', {},
        el('td', { text: g.name }), el('td', { text: g.email }), el('td', { text: g.phone }),
        el('td', { text: g.company }), el('td', { text: g.address })));
    }
    table.append(tbody);
    tableWrap.replaceChildren(table);
    currentGuests = guests;
  };
  let currentGuests: GuestRecord[] = [];
  await load();
  searchInput.addEventListener('input', () => void load());

  const mergeBtn = el('button', { text: 'Merge guests' }) as HTMLButtonElement;
  mergeBtn.addEventListener('click', () => openMergeDialog(currentGuests, load, app));

  const signOutBtn = el('button', { text: 'Sign out' });
  signOutBtn.addEventListener('click', async () => {
    await ApiRequest.del('/api/session');
    app.user = null;
    navigate('/');
  });
  const nav = el('nav', { 'aria-label': 'Main' });
  for (const [label, path, roles] of [
    ['Desk', '/desk', ['owner', 'front_desk']],
    ['Guests', '/guests', ['owner', 'front_desk']],
    ['Board', '/board', ['owner', 'front_desk', 'housekeeper']]
  ] as Array<[string, string, string[]]>) {
    if (!app.user || !roles.includes(app.user.role)) continue;
    const a = el('a', { href: path, text: label });
    if (window.location.pathname === path) a.classList.add('current');
    a.addEventListener('click', ev => { ev.preventDefault(); navigate(path); });
    nav.append(a);
  }

  const content = el('div', {},
    el('h1', { text: 'Guests' }),
    el('div', { class: 'form-row' }, el('label', { text: 'Search' }), searchInput),
    tableWrap,
    el('div', {}, mergeBtn),
    mergeStatus);
  app.root.replaceChildren(el('div', {},
    el('div', { class: 'topbar' }, el('span', { class: 'brand', text: 'Nightroll' }), nav,
      el('span', { class: 'spacer' }), el('span', { text: app.user?.name ?? '' }), signOutBtn),
    el('main', {}, content)));
}

function openMergeDialog(guests: GuestRecord[], reload: () => Promise<void>, app: App): void {
  const dialog = el('div', { class: 'dialog overlay-full', role: 'dialog', 'aria-label': 'Merge guests' });
  const opener = document.activeElement as HTMLElement | null;
  const close = () => { dialog.remove(); if (opener) opener.focus(); };

  const survivorSelect = el('select', { 'aria-label': 'Surviving guest' }) as HTMLSelectElement;
  const mergedSelect = el('select', { 'aria-label': 'Merged guest' }) as HTMLSelectElement;
  for (const select of [survivorSelect, mergedSelect]) {
    select.append(el('option', { value: '', text: 'Choose' }));
    for (const g of guests) {
      const label = g.email ? `${g.name} ${g.email}` : g.name;
      select.append(el('option', { value: g.id, text: label }));
    }
  }
  const conflictsWrap = el('div', {});
  const reviewBtn = el('button', { text: 'Review merge' }) as HTMLButtonElement;
  const confirmBtn = el('button', { text: 'Confirm merge', class: 'primary' }) as HTMLButtonElement;
  confirmBtn.style.display = 'none';

  let survivor: GuestRecord | null = null;
  let merged: GuestRecord | null = null;
  let choices: Record<string, string> = {};

  reviewBtn.addEventListener('click', async () => {
    const sRes = await ApiRequest.get(`/api/guests/${survivorSelect.value}`);
    const mRes = await ApiRequest.get(`/api/guests/${mergedSelect.value}`);
    if (sRes.status !== 200 || mRes.status !== 200) return;
    survivor = sRes.data as GuestRecord;
    merged = mRes.data as GuestRecord;
    choices = {};
    conflictsWrap.replaceChildren();
    const differing = (['Name', 'Email', 'Phone', 'Company', 'Address'] as const)
      .filter(field => {
        const s = (survivor as unknown as Record<string, string>)[field.toLowerCase()];
        const m = (merged as unknown as Record<string, string>)[field.toLowerCase()];
        return s.trim() !== '' && m.trim() !== '' && s !== m;
      });
    if (differing.length > 0) {
      const table = el('table', { class: 'data', 'aria-label': 'Merge conflicts' });
      for (const field of differing) {
        const s = (survivor as unknown as Record<string, string>)[field.toLowerCase()];
        const m = (merged as unknown as Record<string, string>)[field.toLowerCase()];
        const radioGroup = el('div', { role: 'radiogroup', 'aria-label': field });
        const mkRadio = (value: string, label: string, checked: boolean) => {
          const input = el('input', { type: 'radio', name: field, value }) as HTMLInputElement;
          input.checked = checked;
          input.addEventListener('change', () => { choices[field.toLowerCase()] = value; });
          return el('label', {}, input, ` ${label}`);
        };
        radioGroup.append(mkRadio('survivor', `Keep ${s}`, true), mkRadio('merged', `Keep ${m}`, false));
        table.append(el('tr', {}, el('td', { text: field }), el('td', {}, radioGroup)));
      }
      conflictsWrap.append(table);
    }
    confirmBtn.style.display = 'inline-block';
  });

  confirmBtn.addEventListener('click', async () => {
    if (!survivor || !merged) return;
    confirmBtn.setAttribute('aria-busy', 'true');
    setDeskNotice('Merging guests…');
    const res = await ApiRequest.post('/api/guests/merge', {
      survivorId: survivor.id, mergedId: merged.id, choices
    });
    confirmBtn.removeAttribute('aria-busy');
    if (res.status === 200) {
      const text = `Guests merged. ${res.data.staysMoved} ${res.data.staysMoved === 1 ? 'stay' : 'stays'} moved.`;
      setDeskNotice(text);
      close();
      await reload();
    } else {
      setDeskNotice(errorText(res.data) ?? 'Merge failed.');
    }
  });

  const closeBtn = el('button', { text: 'Close' }) as HTMLButtonElement;
  closeBtn.addEventListener('click', close);
  dialog.append(el('h2', { text: 'Merge guests' }),
    el('div', { class: 'form-row' }, el('label', { text: 'Surviving guest' }), survivorSelect),
    el('div', { class: 'form-row' }, el('label', { text: 'Merged guest' }), mergedSelect),
    el('div', {}, reviewBtn), conflictsWrap,
    el('div', {}, confirmBtn, closeBtn));
  dialog.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { ev.stopPropagation(); close(); }
    if (ev.key === 'Tab') trapTab(ev, dialog);
  });
  document.body.append(dialog);
  survivorSelect.focus();
}
