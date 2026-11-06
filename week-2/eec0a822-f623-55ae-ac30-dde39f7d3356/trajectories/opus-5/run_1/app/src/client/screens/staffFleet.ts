import { api } from '../lib/api.js';
import { el } from '../lib/dom.js';
import { staffPage } from '../lib/chrome.js';
import { link, type RouteContext } from '../lib/router.js';
import { listItem, namedList } from '../lib/views.js';
import { can } from '../../shared/roles.js';
import type { Passage, YachtProfile } from '../lib/types.js';
import { formatInstant } from '../../shared/copy.js';

export async function todayScreen(host: HTMLElement, context: RouteContext): Promise<void> {
  const workspaceSlug = context.params.ws;
  const page = await staffPage(host, workspaceSlug, 'Today');
  if (page === null) return;
  const yachts = await api.get<{ yachts: readonly YachtProfile[] }>(
    `/api/w/${workspaceSlug}/yachts`,
  );
  const mine = namedList('Your yachts', 'No yachts yet.');
  const showEnergy = can(page.member.role, 'energy_logs');
  mine.setItems(
    (yachts.ok ? yachts.data.yachts : []).map((yacht) =>
      listItem(
        el('h3', { class: 'card-heading' }, yacht.name),
        el(
          'p',
          { class: 'card-links' },
          link('Rota', `/w/${workspaceSlug}/yachts/${yacht.slug}/rota`),
          link('Passages', `/w/${workspaceSlug}/passages?yacht=${yacht.slug}`),
          link('Stores', `/w/${workspaceSlug}/yachts/${yacht.slug}/stores`),
          showEnergy ? link('Energy', `/w/${workspaceSlug}/yachts/${yacht.slug}/energy`) : null,
        ),
      ),
    ),
  );

  const passages = await api.get<{ passages: readonly Passage[] }>(
    `/api/w/${workspaceSlug}/passages`,
  );
  const upcoming = namedList('Upcoming passages', 'No passages yet.');
  upcoming.setItems(
    (passages.ok ? passages.data.passages : []).map((passage) =>
      listItem(
        el(
          'h3',
          { class: 'card-heading' },
          link(passage.name, `/w/${workspaceSlug}/passages/${passage.id}`),
        ),
        el('p', { class: 'card-figure' }, formatInstant(passage.departsAt, passage.base)),
      ),
    ),
  );
  page.main.append(mine.section, upcoming.section);
}

export async function staffFleetScreen(host: HTMLElement, context: RouteContext): Promise<void> {
  const workspaceSlug = context.params.ws;
  const page = await staffPage(host, workspaceSlug, 'Fleet');
  if (page === null) return;
  const result = await api.get<{ yachts: readonly YachtProfile[] }>(`/api/w/${workspaceSlug}/yachts`);
  const yachts = namedList('Yachts', 'No yachts yet.');
  const showProfile = can(page.member.role, 'yacht_profile');
  yachts.setItems(
    (result.ok ? result.data.yachts : []).map((yacht) =>
      listItem(
        el('h3', { class: 'card-heading' }, yacht.name),
        el('p', { class: 'card-line' }, yacht.base === 'split' ? 'Split' : 'Lavrio'),
        el('p', { class: 'card-line' }, yacht.status === 'on_sale' ? 'On sale' : 'Withdrawn'),
        el(
          'p',
          { class: 'card-links' },
          link('Weeks', `/w/${workspaceSlug}/yachts/${yacht.slug}`),
          showProfile ? link('Profile', `/w/${workspaceSlug}/yachts/${yacht.slug}/profile`) : null,
        ),
      ),
    ),
  );
  page.main.append(yachts.section);
}
