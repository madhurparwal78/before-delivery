// Communities pages: the person's communities, a community's members with
// role controls, and its gatherings with the schedule dialog.
import { api, el, type Ctx } from './main';

interface Community {
  id: string;
  name: string;
  timeZone: string;
  role: string;
}

export const ZONE_OPTIONS = [
  'America/New_York',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Kolkata',
  'Asia/Tokyo',
  'Australia/Sydney',
];

export async function renderCommunitiesPage(ctx: Ctx): Promise<void> {
  const main = ctx.main;
  main.append(el('h1', {}, 'Communities'));
  const res = await api<{ communities: Community[] }>('/api/communities');
  const list = el('ul', { class: 'plain', role: 'list' });
  for (const c of res.communities) {
    list.append(el('li', {}, el('a', { href: `/communities/${c.id}` }, `${c.name} (${c.role})`)));
  }
  main.append(el('div', { class: 'panel' }, list));

  const result = el('div', { role: 'status', 'aria-label': 'Community result', class: 'status-region' });
  const name = el('input', { type: 'text', 'aria-label': 'Community name' }) as HTMLInputElement;
  const zone = el('select', { 'aria-label': 'Community time zone' }) as HTMLSelectElement;
  for (const z of ZONE_OPTIONS) {
    const o = document.createElement('option');
    o.value = z;
    o.textContent = z;
    zone.append(o);
  }
  const create = el('button', { class: 'primary' }, 'Create community');
  create.addEventListener('click', async () => {
    try {
      await api('/api/communities', { method: 'POST', body: JSON.stringify({ name: name.value, timeZone: zone.value }) });
      location.reload();
    } catch (e) {
      result.textContent = (e as Error).message;
    }
  });
  main.append(el('div', { class: 'panel' }, el('h2', {}, 'Create a community'), name, zone, create, result));
}

export async function renderCommunityPage(ctx: Ctx, id: string): Promise<void> {
  const main = ctx.main;
  const detail = await api<{ id: string; name: string; timeZone: string }>(`/api/communities/${id}`).catch(() => null);
  if (!detail) {
    main.append(el('h1', {}, 'Page not found.'));
    return;
  }
  main.append(el('h1', {}, detail.name));

  const result = el('div', { role: 'status', 'aria-label': 'Community result', class: 'status-region' });

  // Members table with role controls
  const membersRes = await api<{ members: { personId: string; displayName: string; role: string }[] }>(`/api/communities/${id}/members`).catch(() => null);
  const table = el('table', { 'aria-label': 'Members' });
  const thead = el('thead', {}, el('tr', {}, el('th', {}, 'Name'), el('th', {}, 'Role'), el('th', {}, 'Remove')));
  table.append(thead);
  const tbody = el('tbody');
  table.append(tbody);
  if (membersRes) {
    for (const member of membersRes.members) {
      const row = el('tr', {}, el('td', {}, member.displayName));
      const roleSelect = el('select', { 'aria-label': `Role for ${member.displayName}` }) as HTMLSelectElement;
      for (const role of ['owner', 'steward', 'member']) {
        const o = document.createElement('option');
        o.value = role;
        o.textContent = role;
        if (member.role === role) o.selected = true;
        roleSelect.append(o);
      }
      roleSelect.addEventListener('change', async () => {
        result.textContent = 'Saving...';
        try {
          await api(`/api/communities/${id}/members/${member.personId}`, { method: 'PUT', body: JSON.stringify({ role: roleSelect.value }) });
          result.textContent = 'Role changed.';
        } catch (e) { result.textContent = (e as Error).message; }
      });
      row.append(el('td', {}, roleSelect));
      const remove = el('button', { class: 'danger', 'aria-label': `Remove ${member.displayName}` }, `Remove ${member.displayName}`);
      remove.addEventListener('click', async () => {
        result.textContent = 'Saving...';
        try {
          await api(`/api/communities/${id}/members/${member.personId}`, { method: 'DELETE' });
          result.textContent = 'Member removed.';
          location.reload();
        } catch (e) { result.textContent = (e as Error).message; }
      });
      row.append(el('td', {}, remove));
      tbody.append(row);
    }
  }
  main.append(el('div', { class: 'panel' }, el('h2', {}, 'Members'), table, result));

  // Gatherings
  const gatheringsRes = await api<{ gatherings: { id: string; title: string; status: string }[] }>(`/api/communities/${id}/gatherings`).catch(() => null);
  const gatheringList = el('ul', { class: 'plain', role: 'list', 'aria-label': 'Gatherings' });
  if (gatheringsRes) {
    for (const g of gatheringsRes.gatherings) {
      gatheringList.append(el('li', { 'data-gathering-id': g.id, 'data-status': g.status }, el('a', { href: `/gatherings/${g.id}` }, `${g.title} (${g.status})`)));
    }
  }
  const gatheringResult = el('div', { role: 'status', 'aria-label': 'Gathering result', class: 'status-region' });

  const scheduleButton = el('button', { class: 'primary' }, 'Schedule gathering');
  const dialog = el('dialog', { 'aria-label': 'Schedule gathering' }) as HTMLDialogElement;
  const title = el('input', { type: 'text', 'aria-label': 'Title' }) as HTMLInputElement;
  const starts = el('input', { type: 'text', 'aria-label': 'Starts', placeholder: '2027-03-07T19:00' }) as HTMLInputElement;
  const duration = el('input', { type: 'number', 'aria-label': 'Duration in minutes', min: '15', max: '480', value: '90' }) as HTMLInputElement;
  const repeats = el('select', { 'aria-label': 'Repeats' }) as HTMLSelectElement;
  for (const r of ['none', 'weekly']) {
    const o = document.createElement('option');
    o.value = r;
    o.textContent = r;
    repeats.append(o);
  }
  const limit = el('input', { type: 'number', 'aria-label': 'Limit', min: '1', max: '500', value: '30' }) as HTMLInputElement;
  const save = el('button', { class: 'primary' }, 'Save gathering');
  const cancel = el('button', {}, 'Cancel');
  dialog.append(el('h2', {}, 'Schedule gathering'), title, starts, duration, repeats, limit, save, cancel, gatheringResult);
  document.body.append(dialog);
  scheduleButton.addEventListener('click', () => dialog.showModal());
  cancel.addEventListener('click', () => dialog.close());
  save.addEventListener('click', async () => {
    gatheringResult.textContent = 'Saving...';
    try {
      await api(`/api/communities/${id}/gatherings`, {
        method: 'POST',
        body: JSON.stringify({
          title: title.value,
          startsLocal: starts.value,
          durationMinutes: Number(duration.value),
          recurrence: repeats.value,
          limit: Number(limit.value),
        }),
      });
      gatheringResult.textContent = 'Gathering scheduled.';
      dialog.close();
      location.reload();
    } catch (e) {
      gatheringResult.textContent = (e as Error).message;
    }
  });

  main.append(el('div', { class: 'panel' }, el('h2', {}, 'Gatherings'), gatheringList, scheduleButton, gatheringResult));
}
