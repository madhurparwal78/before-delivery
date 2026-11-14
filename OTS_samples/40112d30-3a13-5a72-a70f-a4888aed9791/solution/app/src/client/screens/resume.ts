import type { RespondentState } from '../../shared/types.ts';
import { M19, M20 } from '../../shared/messages.ts';
import { ApiFailure, api } from '../lib/api.ts';
import { frame, messagePage, notFound, ready } from '../lib/shell.ts';
import { showClosed } from '../respondent/closed.ts';
import { mountPage } from '../respondent/host.ts';
import { startSession } from '../respondent/session.ts';

const SITE = 'Nightform';

/** `/r/<token>`: opening a resume link moves the part-done response to this browser and carries on where it was saved. */
export async function render(params: Record<string, string>): Promise<void> {
  const main = frame();
  try {
    const state = await api<RespondentState>('POST', `/api/resume/${encodeURIComponent(params['token'] ?? '')}`, {});
    ready(main, state.title);
    startSession(mountPage(main), state, state.notice ?? null);
  } catch (error) {
    if (!(error instanceof ApiFailure)) throw error;
    if (error.code === 'LINK_EXPIRED') messagePage(M19);
    else if (error.code === 'ALREADY_SENT') messagePage(M20);
    else if (error.code === 'FORM_CLOSED') {
      ready(main, SITE);
      showClosed(mountPage(main), SITE, error.message, false);
    } else notFound();
  }
}
