// The admin screen: seat meter, plan, roster with filter/sort, invites and
// collaborator offboarding.

import type { PlanView, SeatsResponse, UpgradeChoice, WorkspaceResponse } from '../../shared/types.js';
import { api, announce, el, navigate, notFoundPage, session } from '../lib.js';
import { topBar } from '../app.js';
import { clearInvalid, errorSummary, formField, markInvalid } from './signin.js';

export async function renderAdmin(slug: string, params: URLSearchParams): Promise<HTMLElement> {
  const acc = session()?.account ?? null;
  if (!acc) {
    navigate(`/signin?next=${encodeURIComponent(`/w/${slug}/admin`)}`, true);
    return el('div');
  }
  if (acc.role !== 'ops_lead') return notFoundPage();

  const page = el('div');
  page.append(topBar({ account: acc, currentSlug: slug }));
  const main = el('main', { class: 'two-col' });
  const left = el('section', { class: 'stack' });
  const right = el('section', { class: 'stack' });

  // --- Seat meter + plan -------------------------------------------------
  const meter = el('p', { class: 'seat-meter mono' });
  meter.setAttribute('aria-label', 'Seats');
  const stateTag = el('span', { class: 'state-tag' });
  const seatPanel = el('section', { class: 'panel stack', 'aria-label': 'Seats' });
  seatPanel.append(el('h3', {}, 'Seats'), meter, stateTag);
  const planPanel = el('section', { class: 'panel stack', 'aria-label': 'Plan' });
  planPanel.append(el('h3', {}, 'Plan'), el('p', { class: 'plan-current' }));
  const currentPlan = planPanel.querySelector('.plan-current') as HTMLElement;

  const upgradeForm = el('form', { class: 'stack', novalidate: true }) as HTMLFormElement;
  const radios = el('div', { role: 'radiogroup', 'aria-label': 'Plan', class: 'stack' });
  const upgradeBtn = el('button', { type: 'submit', class: 'btn btn-primary' }, 'Upgrade plan') as HTMLButtonElement;
  upgradeBtn.setAttribute('aria-label', 'Upgrade plan');
  upgradeForm.append(radios, el('div', {}, upgradeBtn));
  planPanel.append(upgradeForm);

  // --- Roster -------------------------------------------------------------
  const rosterPanel = el('section', { class: 'panel stack', 'aria-label': 'Member roster' });
  const controls = el('div', { class: 'roster-controls' });
  const seatFilter = el('div', { role: 'radiogroup', 'aria-label': 'Show members', class: 'row' });
  const sortSel = el('select', { id: 'sort-members', 'aria-label': 'Sort members' }) as HTMLSelectElement;
  for (const [value, label] of [['name', 'Name'], ['seat', 'Seat']] as const) {
    sortSel.append(el('option', { value }, label));
  }
  controls.append(seatFilter, sortSel);

  // The filter and sort live in the address.
  const initialSeat = params.get('seat');
  const initialSort = params.get('sort');
  let seat = initialSeat === 'seated' || initialSeat === 'unseated' ? initialSeat : 'all';
  let sort = initialSort === 'seat' ? 'seat' : 'name';
  for (const [value, label] of [['all', 'All'], ['seated', 'Seated'], ['unseated', 'Without seat']] as const) {
    const id = `seat-${value}`;
    const radio = el('input', { type: 'radio', name: 'seat-filter', id, value }) as HTMLInputElement;
    radio.checked = seat === value;
    radio.addEventListener('change', () => {
      seat = value;
      pushHistory();
      renderRoster();
    });
    seatFilter.append(el('label', { for: id }, radio, el('span', {}, label)));
  }
  sortSel.value = sort;
  sortSel.addEventListener('change', () => {
    sort = sortSel.value;
    pushHistory();
    renderRoster();
  });
  function pushHistory(): void {
    const q = new URLSearchParams();
    if (seat !== 'all') q.set('seat', seat);
    if (sort !== 'name') q.set('sort', sort);
    const url = `/w/${slug}/admin${q.toString() ? `?${q.toString()}` : ''}`;
    history.pushState(null, '', url);
  }

  const table = el('table', { class: 'members-table', 'aria-label': 'Members' }) as HTMLTableElement;
  const thead = el('thead', {}, el('tr', {}, el('th', {}, 'Name'), el('th', {}, 'Email'), el('th', {}, 'Handle'), el('th', {}, 'Seat')));
  const tbody = el('tbody');
  table.append(thead, tbody);

  rosterPanel.append(controls, table);

  // --- Invite form ----------------------------------------------------------
  const invitePanel = el('section', { class: 'panel stack', 'aria-label': 'Invite a designer' });
  const inviteForm = el('form', { class: 'stack', novalidate: true }) as HTMLFormElement;
  const inviteEmail = el('input', { type: 'email', id: 'invite-email' }) as HTMLInputElement;
  inviteEmail.setAttribute('aria-label', 'Email');
  const inviteName = el('input', { type: 'text', id: 'invite-name' }) as HTMLInputElement;
  inviteName.setAttribute('aria-label', 'Display name');
  const inviteBtn = el('button', { type: 'submit', class: 'btn btn-primary' }, 'Send invite') as HTMLButtonElement;
  inviteBtn.setAttribute('aria-label', 'Send invite');
  inviteForm.append(formField('Email', inviteEmail), formField('Display name', inviteName), el('div', {}, inviteBtn));

  // --- Offboarding ----------------------------------------------------------
  const offboardPanel = el('section', { class: 'panel stack', 'aria-label': 'Offboard a collaborator' });
  const offboardForm = el('form', { class: 'stack', novalidate: true }) as HTMLFormElement;
  const collabEmail = el('input', { type: 'email', id: 'collab-email' }) as HTMLInputElement;
  const offboardBtn = el('button', { type: 'submit', class: 'btn btn-danger' }, 'Revoke all review links') as HTMLButtonElement;
  offboardBtn.setAttribute('aria-label', 'Revoke all review links');
  offboardForm.append(formField('Collaborator email', collabEmail), el('div', {}, offboardBtn));

  invitePanel.append(el('h3', {}, 'Invite a designer'), inviteForm);
  offboardPanel.append(el('h3', {}, 'Offboard a collaborator'), offboardForm);

  left.append(rosterPanel);
  right.append(seatPanel, planPanel, invitePanel, offboardPanel);
  main.append(left, right);
  page.append(main);

  const adminStatus = el('div', { id: 'admin-status', role: 'status', class: 'visually-hidden' });
  adminStatus.setAttribute('aria-live', 'polite');
  document.body.append(adminStatus);

  // --- Load -------------------------------------------------------------
  let seats: SeatsResponse | null = null;
  let plan: PlanView | null = null;

  async function loadAll(): Promise<void> {
    const s = await api<SeatsResponse>('GET', `/api/workspaces/${slug}/seats`);
    if (s.ok) seats = s.data!;
    const p = await api<PlanView & { upgrades: UpgradeChoice[] }>('GET', `/api/workspaces/${slug}/plan`);
    if (p.ok) plan = p.data!;
    renderMeter();
    renderPlan();
    renderRoster();
  }

  function renderMeter(): void {
    if (!seats) return;
    meter.textContent = `${seats.seatsUsed} of ${seats.seatCap} seats in use`;
    const used = seats.seatsUsed;
    const cap = seats.seatCap;
    stateTag.replaceChildren();
    const [word, icon] = used > cap ? ['Over cap', 'icon-over'] : used === cap ? ['Full', 'icon-full'] : ['Seats free', 'icon-check'];
    stateTag.append(el('span', { class: `icon ${icon}`, 'aria-hidden': 'true' }), word);
  }

  function renderPlan(): void {
    if (!plan) return;
    currentPlan.replaceChildren(el('span', { class: 'icon icon-check', 'aria-hidden': 'true' }), `Current plan: ${plan.planName}`);
    radios.replaceChildren();
    for (const u of (plan as PlanView & { upgrades: UpgradeChoice[] }).upgrades ?? []) {
      const id = `plan-${u.plan}`;
      const radio = el('input', { type: 'radio', name: 'plan-choice', id, value: u.plan }) as HTMLInputElement;
      radios.append(el('label', { for: id, class: 'row' }, radio, el('span', {}, `${u.planName} · `), el('span', { class: 'mono' }, `$${u.monthlyPrice} per month`)));
    }
    if (radios.children.length === 0) {
      radios.append(el('p', { class: 'muted' }, 'No upgrades offered.'));
    }
  }

  function renderRoster(): void {
    if (!seats) return;
    tbody.replaceChildren();
    let members = [...seats.members];
    if (seat === 'seated') members = members.filter((m) => m.hasSeat);
    if (seat === 'unseated') members = members.filter((m) => !m.hasSeat);
    const byName = (a: typeof members[number], b: typeof members[number]) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' });
    if (sort === 'seat') {
      members.sort((a, b) => (a.hasSeat === b.hasSeat ? byName(a, b) : a.hasSeat ? -1 : 1));
    } else {
      members.sort(byName);
    }
    for (const m of members) {
      const tr = el('tr');
      tr.append(el('td', {}, m.displayName), el('td', {}, m.email), el('td', {}, m.handle));
      const actionCell = el('td');
      const btn = m.hasSeat
        ? el('button', { class: 'btn small', type: 'button' }, `Free seat from ${m.displayName}`)
        : el('button', { class: 'btn small', type: 'button' }, `Assign seat to ${m.displayName}`);
      btn.setAttribute('aria-label', m.hasSeat ? `Free seat from ${m.displayName}` : `Assign seat to ${m.displayName}`);
      btn.addEventListener('click', () => void seatAction(m, btn));
      actionCell.append(btn);
      tr.append(actionCell);
      tbody.append(tr);
    }
  }

  async function seatAction(member: { id: string; displayName: string; hasSeat: boolean }, btn: HTMLButtonElement): Promise<void> {
    // Optimistic: flip the row and the meter at once.
    const before = seats!.members.map((m) => ({ ...m }));
    const beforeUsed = seats!.seatsUsed;
    member.hasSeat = !member.hasSeat;
    seats!.seatsUsed += member.hasSeat ? 1 : -1;
    renderRoster();
    renderMeter();
    btn.disabled = true;
    const r = member.hasSeat
      ? await api<{ memberId: string; seatsUsed: number; seatCap: number }>('POST', `/api/workspaces/${slug}/seats`, { memberId: member.id })
      : await api<{ memberId: string; seatsUsed: number; seatCap: number }>('DELETE', `/api/workspaces/${slug}/seats/${member.id}`);
    btn.disabled = false;
    if (r.ok && r.data) {
      // The server's state wins; then focus the row's new seat button.
      await loadAll();
      announce('admin-status', member.hasSeat
        ? `Seat assigned to ${member.displayName}. ${r.data.seatsUsed} of ${r.data.seatCap} seats in use.`
        : `Seat freed from ${member.displayName}. ${r.data.seatsUsed} of ${r.data.seatCap} seats in use.`);
      const row = tbody.querySelector(`tr td button[aria-label="${member.hasSeat ? `Free seat from ${member.displayName}` : `Assign seat to ${member.displayName}`}"]`) as HTMLButtonElement | null;
      row?.focus();
      return;
    }
    const err = r.error;
    if (err?.error === 'no_seats_left') {
      // The screen re-reads the roster and puts the server's state in place.
      announce('admin-status', 'No seats left on this plan. Upgrade the plan or free a seat.');
      await loadAll();
      const row = tbody.querySelector(`tr td button[aria-label="Assign seat to ${member.displayName}"]`) as HTMLButtonElement | null;
      row?.focus();
      return;
    }
    // Any other failure rolls back to what the screen showed before.
    seats!.members = before;
    seats!.seatsUsed = beforeUsed;
    renderRoster();
    renderMeter();
    announce('admin-status', `The seat change could not be saved. ${beforeUsed} of ${seats!.seatCap} seats in use.`);
  }

  upgradeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearInvalid(upgradeForm);
    const chosen = upgradeForm.querySelector<HTMLInputElement>('input[name="plan-choice"]:checked')?.value ?? '';
    if (!chosen) {
      upgradeForm.prepend(errorSummary({ plan: 'Choose a plan to upgrade to.' }, { plan: 'plan-rushes-pro-10' }));
      document.getElementById('error-summary')?.focus();
      return;
    }
    upgradeBtn.disabled = true;
    announce('admin-status', 'Upgrading plan...');
    const key = `upgrade-${slug}-${Date.now()}`;
    const r = await fetch(`/api/workspaces/${slug}/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify({ plan: chosen }),
    });
    upgradeBtn.disabled = false;
    const data = (await r.json().catch(() => null)) as (PlanView & { receiptSentTo?: string }) | { error: string; message: string } | null;
    if (r.ok && data && 'planName' in data) {
      announce('admin-status', `Plan upgraded to ${data.planName}. ${data.seatCap} seats available. Receipt sent to ${data.receiptSentTo}.`);
      await loadAll();
      return;
    }
    const err = data as { error?: string; message?: string } | null;
    if (err?.error === 'billing_unavailable') {
      announce('admin-status', 'Billing is unreachable. Your plan is unchanged.');
    } else if (err?.error === 'mail_unavailable') {
      announce('admin-status', 'The receipt email could not be sent, so the upgrade was cancelled. Your plan is unchanged.');
    } else if (err?.error === 'idempotency_in_progress') {
      announce('admin-status', 'This upgrade is already in progress.');
    } else if (err?.error === 'validation') {
      announce('admin-status', 'Choose a larger plan than the current one.');
    } else {
      announce('admin-status', 'The upgrade could not be saved. Try again.');
    }
  });

  inviteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearInvalid(invitePanel);
    inviteBtn.disabled = true;
    const r = await api('POST', `/api/workspaces/${slug}/invites`, { email: inviteEmail.value, displayName: inviteName.value });
    inviteBtn.disabled = false;
    if (r.ok) {
      announce('admin-status', `Invite sent to ${inviteEmail.value}.`);
      inviteEmail.value = '';
      inviteName.value = '';
      return;
    }
    const errors = r.error?.errors ?? {};
    if (Object.keys(errors).length > 0) {
      inviteForm.prepend(errorSummary(errors, { email: 'invite-email', displayName: 'invite-name' }));
      document.getElementById('error-summary')?.focus();
      if (errors.email) markInvalid(inviteEmail, errors.email);
      if (errors.displayName) markInvalid(inviteName, errors.displayName);
    } else if (r.error?.error === 'mail_unavailable') {
      announce('admin-status', 'The invite email could not be sent. No invite was created.');
    }
  });

  offboardForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearInvalid(offboardPanel);
    offboardBtn.disabled = true;
    const r = await api<{ email: string; revoked: number }>('POST', `/api/workspaces/${slug}/collaborators/offboard`, { email: collabEmail.value });
    offboardBtn.disabled = false;
    if (r.ok && r.data) {
      announce('admin-status', `Revoked ${r.data.revoked} review links for ${r.data.email}.`);
      collabEmail.value = '';
      return;
    }
    const errors = r.error?.errors ?? {};
    if (Object.keys(errors).length > 0) {
      offboardForm.prepend(errorSummary(errors, { email: 'collab-email' }));
      document.getElementById('error-summary')?.focus();
      if (errors.email) markInvalid(collabEmail, errors.email);
    }
  });

  await loadAll();
  return page;
}
