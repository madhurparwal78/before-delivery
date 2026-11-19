import { ApiRequest, errorText } from './api.js';
import { el, status } from './ui.js';
import type { Stay, Folio, Entry } from './types.js';
import { formatMoney } from './types.js';
import { setNotice, refreshDeskData, renderTimeline, renderToday } from './desk.js';
import { openFolioRegion } from './folio.js';
import { trapTab } from './newStay.js';

let panel: HTMLElement | null = null;
let hideTimer: number | null = null;
let loadSeq = 0;
let panelOpener: HTMLElement | null = null;
let folioStatusText = '';

/** One folio status node for the whole panel, so messages survive folio re-renders. */
export function panelFolioStatus(): HTMLElement {
  let node = document.getElementById('folio-status') as HTMLElement | null;
  if (!node) {
    node = status('');
    node.id = 'folio-status';
    node.setAttribute('role', 'status');
    node.setAttribute('aria-label', 'Folio status');
  }
  if (folioStatusText) node.textContent = folioStatusText;
  return node;
}

export function setPanelFolioStatus(text: string): void {
  folioStatusText = text;
  const node = document.getElementById('folio-status');
  if (node) node.textContent = text;
}

export function forceClosePanels(): void {
  for (const p of Array.from(document.querySelectorAll('.panel'))) p.remove();
  panel = null;
  if (hideTimer !== null) { window.clearTimeout(hideTimer); hideTimer = null; }
}

export function openStayPanel(stayId: string): void {
  const seq = ++loadSeq;
  if (document.activeElement instanceof HTMLElement && !panel?.contains(document.activeElement)) {
    panelOpener = document.activeElement;
  }
  if (hideTimer !== null) { window.clearTimeout(hideTimer); hideTimer = null; }
  if (!panel) {
    panel = el('div', { class: 'panel', role: 'dialog', 'aria-label': 'Stay' });
    document.body.append(panel);
    panel.addEventListener('keydown', ev => {
      if (ev.key === 'Escape') { ev.stopPropagation(); closePanel(panelOpener); }
      if (ev.key === 'Tab') trapTab(ev, panel as unknown as HTMLElement);
    });
  }
  panel.style.display = 'block';
  panel.setAttribute('aria-hidden', 'false');
  void loadStay(stayId, seq);
}

async function loadStay(stayId: string, seq: number): Promise<void> {
  const res = await ApiRequest.get(`/api/stays/${stayId}`);
  if (seq !== loadSeq) return;
  if (res.status !== 200) return;
  const stay = res.data as Stay;
  renderStay(stay);
}

function renderStay(stay: Stay): void {
  if (!panel) return;
  const openers = document.activeElement as HTMLElement | null;
  panel.replaceChildren();

  const title = el('h2', { text: `${stay.guest.name}` });
  const sub = el('p', {},
    el('span', { text: `${stay.arrival} to ${stay.departure} · ${stay.guests} ${stay.guests === 1 ? 'guest' : 'guests'}` }),
    ' · ',
    el('span', { text: stay.status.replace('_', ' ') })
  );
  const terms = status(stay.cancellation?.text ?? '');
  terms.setAttribute('role', 'status');
  if (stay.checkedInOnline) {
    sub.append(' · ', el('span', { text: 'Checked in online' }));
  }
  if (stay.checkInNight) {
    sub.append(el('div', { text: `Checked in for the night of ${stay.checkInNight}` }));
  }

  // nightly breakdown
  const nightlyTable = el('table', { class: 'data', 'aria-label': 'Nightly breakdown' });
  nightlyTable.append(el('thead', {}, el('tr', {},
    el('th', { text: 'Date' }), el('th', { text: 'Room' }), el('th', { class: 'num', text: 'Tax' }),
    el('th', { class: 'num', text: 'City tax' }), el('th', { class: 'num', text: 'Night total' }))));
  const tbody = el('tbody');
  for (const night of stay.nightly) {
    tbody.append(el('tr', {},
      el('td', { text: night.date }), el('td', { text: night.roomNumber }),
      el('td', { class: 'num', text: formatMoney(night.taxCents) }),
      el('td', { class: 'num', text: formatMoney(night.cityTaxCents) }),
      el('td', { class: 'num', text: formatMoney(night.totalCents) })));
  }
  nightlyTable.append(tbody);
  const stayTotal = status(formatMoney(stay.totalCents));
  stayTotal.setAttribute('role', 'status');
  stayTotal.id = 'stay-total';

  // actions
  const actions = el('div', { class: 'stay-actions' });
  const checkInBtn = el('button', { text: 'Check in' }) as HTMLButtonElement;
  checkInBtn.addEventListener('click', async () => {
    await act(`/api/stays/${stay.id}/check-in`, 'Checking in…', s =>
      `Checked in ${s.guest.name} to room ${s.segments[0]?.roomNumber ?? ''}.`);
  });
  const checkOutBtn = el('button', { text: 'Check out' }) as HTMLButtonElement;
  checkOutBtn.addEventListener('click', async () => {
    await act(`/api/stays/${stay.id}/check-out`, 'Checking out…', s =>
      `Checked out ${s.guest.name} from room ${s.segments[s.segments.length - 1]?.roomNumber ?? ''}.`);
  });
  const cancelBtn = el('button', { text: 'Cancel stay' }) as HTMLButtonElement;
  cancelBtn.addEventListener('click', () => openCancelDialog(stay));
  actions.append(checkInBtn, checkOutBtn, cancelBtn);

  // dates form
  const depInput = el('input', { type: 'text', value: stay.departure, 'aria-label': 'Departure' }) as HTMLInputElement;
  const saveDates = el('button', { text: 'Save dates' }) as HTMLButtonElement;
  saveDates.addEventListener('click', async () => {
    setNotice('Saving stay…');
    const res = await ApiRequest.patch(`/api/stays/${stay.id}`, { version: stay.version, departure: depInput.value });
    if (res.status === 200) {
      const updated = res.data as Stay;
      setNotice(`Stay updated for ${updated.guest.name}.`);
      await reloadAll(updated.id);
    } else {
      setNotice(errorText(res.data) ?? 'Save failed.');
    }
  });

  // move form
  const moveRoom = el('select', { 'aria-label': 'Move to room' }) as HTMLSelectElement;
  void loadRooms(moveRoom);
  const moveNight = el('input', { type: 'text', 'aria-label': 'Move from night' }) as HTMLInputElement;
  const moveBtn = el('button', { text: 'Move room' }) as HTMLButtonElement;
  moveBtn.addEventListener('click', async () => {
    setNotice('Moving stay…');
    const body: Record<string, unknown> = { version: stay.version, roomId: moveRoom.value };
    if (moveNight.value.trim()) body.fromNight = moveNight.value.trim();
    const res = await ApiRequest.post(`/api/stays/${stay.id}/move`, body);
    if (res.status === 200) {
      const updated = res.data as Stay;
      setNotice(`Moved ${updated.guest.name} to room ${updated.segments[updated.segments.length - 1]?.roomNumber ?? ''}.`);
      await reloadAll(updated.id);
    } else {
      setNotice(errorText(res.data) ?? 'Move failed.');
    }
  });

  // resend link
  const resendBtn = el('button', { text: 'Resend check-in link' }) as HTMLButtonElement;
  resendBtn.addEventListener('click', async () => {
    setNotice('Sending check-in link…');
    const res = await ApiRequest.post(`/api/stays/${stay.id}/checkin-link`);
    if (res.status === 200) {
      const updated = res.data as Stay;
      setNotice(`Check-in link sent to ${updated.guest.name}.`);
      await reloadAll(updated.id);
    } else {
      setNotice(errorText(res.data) ?? 'Link failed.');
    }
  });

  // id photo link
  const photoLink = stay.idPhoto === 'received'
    ? el('a', { href: `/api/stays/${stay.id}/id-photo`, target: '_blank', text: 'View ID photo' })
    : null;

  // add folio
  const addFolioBtn = el('button', { text: 'Add folio' }) as HTMLButtonElement;
  addFolioBtn.addEventListener('click', async () => {
    const name = window.prompt('Payer name') ?? '';
    const email = window.prompt('Payer email') ?? '';
    const res = await ApiRequest.post(`/api/stays/${stay.id}/folios`, { payerName: name, payerEmail: email });
    if (res.status === 201) await reloadAll(stay.id);
    else setNotice(errorText(res.data) ?? 'Folio failed.');
  });

  const folioStatus = panelFolioStatus();
  folioStatus.setAttribute('role', 'status');

  const closeBtn = el('button', { text: 'Close' }) as HTMLButtonElement;
  closeBtn.addEventListener('click', () => closePanel(openers));

  const body = el('div', {},
    title, sub, terms, el('h3', { text: 'Nightly breakdown' }), nightlyTable,
    el('p', {}, el('b', { text: 'Stay total ' }), stayTotal),
    actions,
    el('div', { class: 'form-row' }, el('label', { text: 'Departure' }), depInput, saveDates),
    el('div', { class: 'form-row' }, el('label', { text: 'Move to room' }), moveRoom, moveNight, moveBtn),
    el('div', {}, resendBtn, photoLink),
    el('div', {}, addFolioBtn, closeBtn),
    el('div', { id: 'folio-regions' }),
    folioStatus
  );
  panel.replaceChildren(body);
  panel.dataset.stayId = stay.id;
  for (const folio of stay.folios) {
    document.getElementById('folio-regions')?.append(openFolioRegion(stay, folio, folioStatus, () => reloadAll(stay.id)));
  }
  const firstBtn = panel.querySelector('button');
  if (firstBtn instanceof HTMLElement) firstBtn.focus();
}

async function loadRooms(select: HTMLSelectElement): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const tl = await ApiRequest.get(`/api/timeline?from=${today}&to=${today}`);
  if (tl.status === 200) {
    select.append(el('option', { value: '', text: 'Choose' }));
    for (const room of tl.data.rooms) {
      select.append(el('option', { value: room.id, text: room.number }));
    }
  }
}

async function act(path: string, pending: string, success: (stay: Stay) => string): Promise<void> {
  setNotice(pending);
  const res = await ApiRequest.post(path);
  if (res.status === 200) {
    const stay = res.data as Stay;
    setNotice(success(stay));
    await reloadAll(stay.id);
  } else {
    setNotice(errorText(res.data) ?? 'Action failed.');
  }
}

export async function reloadAll(stayId: string): Promise<void> {
  const seq = ++loadSeq;
  const res = await ApiRequest.get(`/api/stays/${stayId}`);
  if (seq !== loadSeq) return;
  if (res.status === 200) {
    renderStay(res.data as Stay);
    await refreshDeskData();
    renderTimeline();
    renderToday();
  }
}

function openCancelDialog(stay: Stay): void {
  const termsText = stay.cancellation?.text ?? '';
  const dialog = el('div', { class: 'dialog overlay-full', role: 'alertdialog', 'aria-label': 'Cancel stay' });
  const text = el('p', { text: termsText });
  const confirm = el('button', { text: 'Confirm cancellation', class: 'primary' }) as HTMLButtonElement;
  const keep = el('button', { text: 'Keep stay' }) as HTMLButtonElement;
  const closeDialog = () => { dialog.remove(); confirm.focus(); };
  confirm.addEventListener('click', async () => {
    setNotice('Cancelling stay…');
    const res = await ApiRequest.post(`/api/stays/${stay.id}/cancel`);
    if (res.status === 200) {
      const updated = res.data as Stay;
      const fee = updated.folios.flatMap(f => f.entries).find(e => e.description === 'Late cancellation fee');
      setNotice(fee ? `Cancelled ${updated.guest.name}'s stay. Fee: ${formatMoney(fee.amountCents)}.` : `Cancelled ${updated.guest.name}'s stay. No fee.`);
      closeDialog();
      await reloadAll(stay.id);
    } else {
      setNotice(errorText(res.data) ?? 'Cancel failed.');
      closeDialog();
    }
  });
  keep.addEventListener('click', closeDialog);
  dialog.append(el('h2', { text: 'Cancel stay' }), text, el('div', {}, confirm, keep));
  document.body.append(dialog);
  confirm.focus();
  dialog.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { ev.stopPropagation(); closeDialog(); }
  });
}

export function closePanel(opener?: HTMLElement | null): void {
  if (!panel) return;
  const p = panel;
  panel = null;
  hideTimer = window.setTimeout(() => {
    p.style.display = 'none';
    p.replaceChildren();
  }, 240);
  if (opener && document.contains(opener)) opener.focus();
}
