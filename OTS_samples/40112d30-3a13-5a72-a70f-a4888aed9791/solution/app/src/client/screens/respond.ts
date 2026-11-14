import type { ClosedText, RespondentState } from '../../shared/types.ts';
import { ApiFailure, api } from '../lib/api.ts';
import { frame, notFound, ready } from '../lib/shell.ts';
import { showClosed } from '../respondent/closed.ts';
import { mountPage } from '../respondent/host.ts';
import { startSession } from '../respondent/session.ts';

interface PublicForm { title: string; intro: string; state: string; closed: ClosedText | null; today: string }

/** `/f/<slug>`: the form's closed panel, or the respondent's part-done response (new, or this device's own). */
export async function render(params: Record<string, string>): Promise<void> {
  const slug = params['slug'] ?? '';
  const main = frame();
  let form: PublicForm;
  try {
    form = await api<PublicForm>('GET', `/api/f/${encodeURIComponent(slug)}`);
  } catch (error) {
    if (error instanceof ApiFailure && error.status === 404) return notFound();
    throw error;
  }
  if (form.closed) {
    ready(main, form.title);
    showClosed(mountPage(main), form.title, form.closed.text, false);
    return;
  }
  try {
    const state = await api<RespondentState>('POST', `/api/f/${encodeURIComponent(slug)}/responses`, {});
    ready(main, state.title);
    startSession(mountPage(main), state, null);
  } catch (error) {
    if (!(error instanceof ApiFailure) || error.code !== 'FORM_CLOSED') throw error;
    ready(main, form.title);
    showClosed(mountPage(main), form.title, error.message, false);
  }
}
