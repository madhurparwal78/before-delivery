import type { Evaluation, EvalQuestion } from '../../shared/types.ts';
import { M03, M04 } from '../../shared/messages.ts';
import { h, replaceChildren } from '../lib/dom.ts';
import { createActions, type ActionHandlers, type Actions } from './actions.ts';
import { placeBanner } from './announcements.ts';
import { createField, type Field, type FieldEnv } from './question/index.ts';
import { litQuestions, type Run } from './run.ts';

/** The current page: title, count, banners, the question blocks and the buttons. */
export interface PageView {
  readonly actions: Actions;
  readonly fields: ReadonlyMap<string, Field>;
  /** Patches the page in place from a newer evaluation: blocks are added, removed and relabelled, typed text is left alone. */
  reconcile(evaluation: Evaluation): void;
  setNotice(text: string | null): void;
  setPathNotice(text: string): void;
  setSummary(summary: HTMLElement | null): void;
  /** The document title carries the M03 prefix while the error summary shows. */
  markErrors(shown: boolean): void;
  focusTitle(): void;
  /** Commits every box that is still being typed in. */
  flush(): void;
}

export function renderPage(host: HTMLElement, run: Run, env: FieldEnv, handlers: ActionHandlers): PageView {
  const fields = new Map<string, Field>();
  const formTitle = h('p', { class: 'form-title' }, run.formTitle);
  const title = h('h1', { id: 'page-title', tabindex: '-1' });
  const count = h('p', { id: 'page-count', class: 'figures' });
  const questions = h('div', { class: 'questions' });
  const actions = createActions(handlers);
  let notice: HTMLElement | null = null;
  let pathNotice: HTMLElement | null = null;
  let summary: HTMLElement | null = null;
  let errorsShown = false;

  const setDocumentTitle = (): void => {
    document.title = `${errorsShown ? M03 : ''}${title.textContent ?? ''} - ${run.formTitle}`;
  };

  function blockFor(item: EvalQuestion, evaluation: Evaluation): Field | null {
    const existing = fields.get(item.key);
    if (existing) {
      existing.update(item, evaluation);
      return existing;
    }
    const spec = run.structure[item.key];
    if (!spec) return null;
    const created = createField(item, spec, run.answers[item.key], evaluation, env);
    fields.set(item.key, created);
    return created;
  }

  replaceChildren(host, formTitle, title, count, questions, actions.element);

  return {
    actions,
    fields,
    reconcile(evaluation) {
      const page = evaluation.pages.find((candidate) => candidate.key === run.page);
      if (!page || evaluation.page_number === 0) return;
      if (title.textContent !== page.title) {
        title.textContent = page.title;
        setDocumentTitle();
      }
      count.textContent = M04(evaluation.page_number, evaluation.shown_pages);
      actions.update(evaluation);
      const lit = litQuestions(page);
      for (const [key, field] of fields) {
        if (lit.some((item) => item.key === key)) continue;
        field.element.remove();
        fields.delete(key);
      }
      lit.forEach((item, index) => {
        const field = blockFor(item, evaluation);
        if (field && questions.children[index] !== field.element) questions.insertBefore(field.element, questions.children[index] ?? null);
      });
    },
    setNotice(text) {
      notice = placeBanner(notice, 'notice', text, formTitle);
    },
    setPathNotice(text) {
      pathNotice = placeBanner(pathNotice, 'path-notice', text, count);
    },
    setSummary(next) {
      summary?.remove();
      summary = next;
      if (next) title.before(next);
    },
    markErrors(shown) {
      errorsShown = shown;
      setDocumentTitle();
    },
    focusTitle: () => title.focus(),
    flush() {
      for (const field of fields.values()) field.flush?.();
    },
  };
}
