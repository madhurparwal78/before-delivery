import { M59 } from '../../shared/messages.ts';
import type { Summary } from '../../shared/types.ts';
import { api } from '../lib/api.ts';
import { h } from '../lib/dom.ts';
import { ready, showFormState } from '../lib/shell.ts';
import { connect } from '../lib/socket.ts';
import { openFormScreen, orNotFound } from '../owner/form-screen.ts';
import { summaryView } from '../owner/summary-view.ts';

export async function render(params: Record<string, string>): Promise<void> {
  const id = params['id'] ?? '';
  const screen = await openFormScreen(id, 'summary');
  if (!screen) return;
  const summary = await orNotFound(api<Summary>('GET', `/api/forms/${id}/summary`));
  if (!summary) return;
  const count = h('h1', { id: 'response-count' });
  const status = h('p', { id: 'live-status' });
  const body = h('div', { class: 'summary-body' });
  const view = summaryView(count, body);
  view.show(summary);
  ready(screen.main, 'Summary - Nightform');
  screen.main.append(count, status, body);
  connect({ type: 'join', form: id, view: 'summary' }, (frame) => {
    if (frame.type === 'joined' && !frame.live) status.textContent = M59;
    else if (frame.type === 'summary') view.show(frame.summary);
    else if (frame.type === 'form_state') showFormState(frame.state);
  });
}
