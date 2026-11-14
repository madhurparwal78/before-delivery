import type { FormDefinition } from '../../shared/types.ts';
import { api } from '../lib/api.ts';
import { h } from '../lib/dom.ts';
import { ready } from '../lib/shell.ts';
import { formatStamp } from '../owner/dates.ts';
import { editionPages } from '../owner/edition-pages.ts';
import { openFormScreen, orNotFound } from '../owner/form-screen.ts';

interface EditionView { number: number; published_at: string; definition: FormDefinition }

export async function render(params: Record<string, string>): Promise<void> {
  const id = params['id'] ?? '';
  const screen = await openFormScreen(id, 'editions');
  if (!screen) return;
  const edition = await orNotFound(api<EditionView>('GET', `/api/forms/${id}/editions/${params['number'] ?? ''}`));
  if (!edition) return;
  const title = h('h1', {}, `Edition ${edition.number}`);
  ready(screen.main, `${title.textContent} - Nightform`);
  screen.main.append(title, h('p', { class: 'figures' }, `Published ${formatStamp(edition.published_at)}`), editionPages(edition.definition));
}
