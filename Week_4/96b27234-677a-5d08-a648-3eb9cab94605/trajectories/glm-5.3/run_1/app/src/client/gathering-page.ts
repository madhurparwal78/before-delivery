// Gathering page: occurrences with display, status and notes, and attendance.
import { api, el, type Ctx } from './main';

interface Occurrence {
  startsAt: string;
  startsLocal: string;
  display: string;
  status: string;
  note: string | null;
}

interface Gathering {
  id: string;
  title: string;
  status: string;
  display: string;
  attendingCount: number;
  attending: boolean;
  limit: number;
  occurrences: Occurrence[];
}

export async function renderGatheringPage(ctx: Ctx, id: string): Promise<void> {
  const main = ctx.main;
  const g = await api<Gathering>(`/api/gatherings/${id}`).catch(() => null);
  if (!g) {
    main.append(el('h1', {}, 'Page not found.'));
    return;
  }
  main.append(el('h1', {}, g.title));

  const result = el('div', { role: 'status', 'aria-label': 'Gathering result', class: 'status-region' });
  const list = el('ul', { class: 'plain', role: 'list', 'aria-label': 'Occurrences' });
  for (const o of g.occurrences) {
    const item = el('li', { 'data-status': o.status }, `${o.display} - ${o.status}`);
    if (o.note) item.append(` - ${o.note}`);
    list.append(item);
  }

  const attend = el('button', { class: 'primary' }, 'Attend');
  const stop = el('button', { class: 'danger' }, 'Stop attending');
  attend.addEventListener('click', async () => {
    result.textContent = 'Saving...';
    try {
      const communityId = await communityIdOf(id);
      await api(`/api/communities/${communityId}/gatherings/${id}/attend`, { method: 'POST' });
      result.textContent = "You're attending.";
      location.reload();
    } catch (e) { result.textContent = (e as Error).message; }
  });
  stop.addEventListener('click', async () => {
    result.textContent = 'Saving...';
    try {
      const communityId = await communityIdOf(id);
      await api(`/api/communities/${communityId}/gatherings/${id}/attend`, { method: 'DELETE' });
      result.textContent = "You're no longer attending.";
      location.reload();
    } catch (e) { result.textContent = (e as Error).message; }
  });

  main.append(el('div', { class: 'panel' }, list, attend, stop, result));
}

async function communityIdOf(gatheringId: string): Promise<string> {
  const communities = await api<{ communities: { id: string }[] }>('/api/communities');
  for (const c of communities.communities) {
    const gatherings = await api<{ gatherings: { id: string }[] }>(`/api/communities/${c.id}/gatherings`);
    if (gatherings.gatherings.some((g) => g.id === gatheringId)) return c.id;
  }
  throw new Error('Not found.');
}
