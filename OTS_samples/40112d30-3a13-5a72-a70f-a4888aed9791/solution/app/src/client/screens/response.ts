import type { ResponseView } from '../../shared/types.ts';
import { api } from '../lib/api.ts';
import { h } from '../lib/dom.ts';
import { ready } from '../lib/shell.ts';
import { formatStamp } from '../owner/dates.ts';
import { openFormScreen, orNotFound } from '../owner/form-screen.ts';
import { answerBlocks } from '../owner/answer-blocks.ts';

export async function render(params: Record<string, string>): Promise<void> {
  const id = params['id'] ?? '';
  const screen = await openFormScreen(id, 'responses');
  if (!screen) return;
  const view = await orNotFound(api<ResponseView>('GET', `/api/forms/${id}/responses/${params['rid'] ?? ''}`));
  if (!view) return;
  const title = h('h1', {}, `Response ${view.reference}`);
  ready(screen.main, `${title.textContent} - Nightform`);
  screen.main.append(title, h('p', {}, `Edition ${view.edition}`), h('p', { class: 'figures' }, `Submitted ${formatStamp(view.submitted_at)}`), answerBlocks(view));
}
