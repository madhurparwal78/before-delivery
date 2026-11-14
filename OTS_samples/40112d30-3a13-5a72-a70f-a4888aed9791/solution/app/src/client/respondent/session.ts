import type { Evaluation, RespondentState } from '../../shared/types.ts';
import { M20, M21 } from '../../shared/messages.ts';
import { ApiFailure, api } from '../lib/api.ts';
import type { OpenDialog } from '../lib/dialog.ts';
import { alertText, announce } from '../lib/live.ts';
import { messagePage } from '../lib/shell.ts';
import { changedCalculations, pathSentence } from './announcements.ts';
import { createCommits } from './commits.ts';
import { showClosed } from './closed.ts';
import { showConfirmation, type Submitted } from './confirmation.ts';
import { showErrors } from './error-summary.ts';
import { restartFade } from './host.ts';
import { joinLive } from './live.ts';
import { lockPage } from './locking.ts';
import { renderPage, type PageView } from './page.ts';
import type { FieldEnv } from './question/index.ts';
import { createRun } from './run.ts';
import { openSaveDialog } from './save-dialog.ts';

type Phase = 'open' | 'locked' | 'ended';

const isInvalid = (error: unknown): error is ApiFailure => error instanceof ApiFailure && error.code === 'ANSWERS_INVALID';

/**
 * One respondent's walk through the form, from the first page to the confirmation. The server decides everything
 * that is shown; this function sends what the person did and puts the server's replies on the page.
 */
export function startSession(host: HTMLElement, state: RespondentState, notice: string | null): void {
  const run = createRun(state);
  let phase: Phase = 'open';
  let moving = false;
  let saving: OpenDialog | null = null;
  let view: PageView;

  const live = joinLive(run.id, { closed: (text) => close(text.text, true), moved: lock });
  const commits = createCommits(run, { apply, refuse });
  const env: FieldEnv = {
    responseId: run.id,
    today: run.today,
    commit: (key, value) => commits.send({ [key]: value }),
    advance: () => view.actions.primary().click(),
    refuse,
    track: commits.track,
  };

  /** The first page appears at once; every later page change crossfades in. */
  function showPage(options: { focus: boolean; banner: string | null; fade: boolean }): void {
    view = renderPage(host, run, env, {
      back: () => { void move('back').catch(refuse); },
      next: () => { void move('next').catch(refuse); },
      submit: () => { void submit().catch(refuse); },
      save: openSave,
    });
    view.reconcile(run.evaluation);
    view.setNotice(options.banner);
    if (options.fade) restartFade(host);
    announce(run.evaluation.announce);
    if (options.focus) view.focusTitle();
  }

  function apply(evaluation: Evaluation): void {
    if (phase !== 'open') return;
    const path = pathSentence(evaluation);
    const calculations = changedCalculations(run, evaluation);
    run.evaluation = evaluation;
    view.reconcile(evaluation);
    if (path) view.setPathNotice(path);
    const sentence = [path, ...calculations].filter(Boolean).join(' ');
    if (sentence) announce(sentence);
  }

  function end(): void {
    phase = 'ended';
    live.close();
    saving?.close();
  }

  function lock(): void {
    if (phase !== 'open') return;
    phase = 'locked';
    live.close();
    lockPage(host);
    alertText(M21);
  }

  function close(text: string, whileOpen: boolean): void {
    if (phase === 'ended') return;
    end();
    showClosed(host, run.formTitle, text, whileOpen);
  }

  /** Every refusal the server can give a commit, a page move, a save or a submit. */
  function refuse(error: unknown): void {
    if (!(error instanceof ApiFailure)) throw error;
    if (error.code === 'DRAFT_MOVED') lock();
    else if (error.code === 'FORM_CLOSED') close(error.message, true);
    else if (error.code === 'ALREADY_SUBMITTED') {
      end();
      messagePage(M20);
    } else alertText(error.message);
  }

  async function settle(): Promise<void> {
    view.flush();
    await commits.settled();
  }

  async function move(direction: 'back' | 'next'): Promise<void> {
    if (moving) return;
    moving = true;
    view.actions.busy(direction === 'back' ? 'back' : 'primary');
    try {
      await settle();
      const reply = await api<{ page: string; evaluation: Evaluation }>('POST', `/api/responses/${run.id}/${direction}`, { page: run.page });
      if (phase !== 'open') return;
      run.page = reply.page;
      run.evaluation = reply.evaluation;
      showPage({ focus: true, banner: null, fade: true });
    } catch (error) {
      if (!isInvalid(error)) throw error;
      showErrors(view, error.items);
    } finally {
      moving = false;
      view.actions.busy(null);
    }
  }

  /** The server checked every shown page: open the page of the first error and show that page's errors. */
  async function showSubmitErrors(error: ApiFailure): Promise<void> {
    const target = error.items[0]?.page ?? run.page;
    if (target !== run.page) {
      run.evaluation = await commits.moveTo(target);
      showPage({ focus: false, banner: null, fade: true });
    }
    showErrors(view, error.items.filter((item) => item.page === target));
  }

  async function submit(): Promise<void> {
    if (moving) return;
    moving = true;
    view.actions.busy('primary');
    try {
      await settle();
      const submitted = await api<Submitted>('POST', `/api/responses/${run.id}/submit`, { page: run.page }, { 'Idempotency-Key': run.submitKey });
      end();
      showConfirmation(host, run.formTitle, submitted);
    } catch (error) {
      if (!isInvalid(error)) throw error;
      await showSubmitErrors(error);
    } finally {
      moving = false;
      view.actions.busy(null);
    }
  }

  function openSave(opener: HTMLElement): void {
    saving = openSaveDialog({
      responseId: run.id,
      page: () => run.page,
      settle,
      refuse,
      onClose: () => { saving = null; },
    }, opener);
  }

  showPage({ focus: true, banner: notice, fade: false });
}
