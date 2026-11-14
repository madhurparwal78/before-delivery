import type { FormDetail } from '../../shared/types.ts';
import { api, ApiFailure } from '../lib/api.ts';
import { h } from '../lib/dom.ts';
import { frame, notFound, showFormState, type FormPage } from '../lib/shell.ts';

// What every owner form screen starts with: the frame with both navigations, then the form's own state and title.

interface FormScreen { main: HTMLElement; form: FormDetail }

/** A request for something the person may not open draws the not-found page and resolves to null. */
export async function orNotFound<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request;
  } catch (failure) {
    if (failure instanceof ApiFailure && failure.status === 404) {
      notFound();
      return null;
    }
    throw failure;
  }
}

export async function openFormScreen(id: string, current: FormPage): Promise<FormScreen | null> {
  const main = frame({ owner: true, form: { id, current } });
  main.classList.add('owner-screen');
  const form = await orNotFound(api<FormDetail>('GET', `/api/forms/${id}`));
  if (!form) return null;
  showFormState(form.state);
  document.querySelector('.form-bar')?.prepend(h('p', { class: 'form-title' }, form.title));
  return { main, form };
}
