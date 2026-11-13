import { STAGE_LABELS, type Stage } from '../../shared/reference';
import { announce } from '../core/announce';
import { failureOf, get, postForm } from '../core/api';
import { el, focus, on } from '../core/dom';
import { onLive } from '../core/live';
import type { Cleanup, PageContext } from '../core/router';
import { clearFieldErrors, fieldError, pageAlert } from '../core/shell';
import { narrowForm } from '../widgets/layout';

interface JobDetail {
  id: string;
  title: string;
  company_name: string;
}

function labelled(labelText: string, input: HTMLElement, name: string): HTMLElement {
  const id = `apply-${name}`;
  input.id = id;
  return el('div', { class: 'field' }, [el('label', { for: id, text: labelText }), input]);
}

export async function renderApply(container: HTMLElement, ctx: PageContext): Promise<Cleanup> {
  const jobId = ctx.params['id'] as string;
  const job = await get<JobDetail>(`/api/jobs/${jobId}`);

  const fullName = el('input', { type: 'text', class: 'textbox' });
  const contactEmail = el('input', { type: 'email', class: 'textbox' });
  const phone = el('input', { type: 'text', class: 'textbox' });
  const note = el('textarea', { class: 'textbox', rows: '4' });
  const resume = el('input', { type: 'file', class: 'file-field', accept: 'application/pdf' });
  const submit = el('button', { type: 'submit', class: 'solid-button', text: 'Send application' });
  const pending = el('span', { class: 'working' });

  const form = el('form', { class: 'stack' }, [
    labelled('Full name', fullName, 'full-name'),
    labelled('Contact email', contactEmail, 'contact-email'),
    labelled('Phone (optional)', phone, 'phone'),
    labelled('Note to the employer (optional)', note, 'note'),
    labelled('Resume (PDF, up to 5 MB)', resume, 'resume'),
    el('div', { class: 'row' }, [submit, pending]),
  ]);

  const page = narrowForm(`Apply for ${job.title}`, [form]);
  container.append(page);
  const alert = pageAlert(page);

  /** One key is made when the form opens and sent on every submit of this form. */
  const idempotencyKey = crypto.randomUUID();
  let keptFile: File | null = null;

  const send = (): void => {
    clearFieldErrors(form);
    alert(null);
    const file = resume.files?.[0] ?? keptFile;
    const body = new FormData();
    body.set('candidate_name', fullName.value);
    body.set('contact_email', contactEmail.value);
    body.set('phone', phone.value);
    body.set('cover_note', note.value);
    if (file) body.set('resume', file, file.name);

    submit.disabled = true;
    pending.textContent = 'Sending your application';
    announce('Sending your application');

    void postForm<{ id: string }>(`/api/jobs/${jobId}/applications`, body, { 'Idempotency-Key': idempotencyKey })
      .then(() => {
        const heading = el('h1', { text: 'Application sent', tabindex: '-1' });
        page.replaceChildren(
          heading,
          el('p', { text: `Your application for ${job.title} at ${job.company_name} is in.` }),
          el('a', { href: '/applications', text: 'My applications' }),
        );
        focus(heading);
      })
      .catch((error: unknown) => {
        const failure = failureOf(error);
        if (!failure) throw error;
        if (failure.error === 'storage_unavailable') {
          keptFile = file;
          const banner = alert(failure.message);
          const retry = el('button', { type: 'button', class: 'solid-button', text: 'Try again' });
          on(retry, 'click', () => send());
          banner?.append(retry);
          return;
        }
        if (failure.fields) {
          const inputs: Record<string, HTMLElement> = {
            candidate_name: fullName,
            contact_email: contactEmail,
            phone,
            cover_note: note,
            resume,
            idempotency_key: resume,
          };
          for (const [field, message] of Object.entries(failure.fields)) {
            const input = inputs[field];
            if (input) fieldError(input, message);
          }
          return;
        }
        if (failure.error === 'resume_not_pdf' || failure.error === 'resume_too_large') {
          fieldError(resume, failure.message);
          return;
        }
        alert(failure.message);
      })
      .finally(() => {
        submit.disabled = false;
        pending.textContent = '';
      });
  };

  on(form, 'submit', (event) => {
    event.preventDefault();
    send();
  });
  return () => undefined;
}

interface ApplicationItem {
  id: string;
  job_id: string;
  job_title: string;
  company_name: string;
  stage: Stage;
}

export async function renderMyApplications(container: HTMLElement): Promise<Cleanup> {
  const page = el('div', { class: 'narrow-page' }, [el('h1', { text: 'My applications' })]);
  container.append(page);
  const list = el('ul', { 'aria-label': 'My applications', class: 'plain-list' });
  page.append(list);

  let items: ApplicationItem[] = [];
  const paint = (): void => {
    list.replaceChildren();
    for (const item of items) {
      list.append(
        el('li', { 'data-id': item.id }, [
          el('a', { href: `/applications/${item.id}`, text: `${item.job_title} at ${item.company_name}` }),
          el('p', { class: 'stage-text', text: STAGE_LABELS[item.stage] }),
        ]),
      );
    }
  };

  const load = async (): Promise<void> => {
    items = (await get<{ applications: ApplicationItem[] }>('/api/me/applications')).applications;
    paint();
  };
  await load();

  const stopLive = onLive((messages) => {
    for (const message of messages) {
      if (message.type !== 'application.stage') continue;
      const id = String(message.data['application_id']);
      const stage = String(message.data['stage']) as Stage;
      const item = items.find((candidate) => candidate.id === id);
      if (!item) continue;
      item.stage = stage;
      paint();
      announce(`Your application for ${item.job_title} is now at ${STAGE_LABELS[stage]}.`);
    }
  });
  return stopLive;
}

interface ApplicationDetail extends ApplicationItem {
  candidate_name: string;
  contact_email: string;
  phone: string;
  cover_note: string;
  resume_file_id: string;
}

export async function renderApplicationDetail(container: HTMLElement, ctx: PageContext): Promise<Cleanup> {
  const detail = await get<ApplicationDetail>(`/api/applications/${ctx.params['id'] as string}`);
  container.append(
    el('div', { class: 'narrow-page' }, [
      el('h1', { text: `${detail.job_title} at ${detail.company_name}` }),
      el('p', { class: 'stage-text', text: STAGE_LABELS[detail.stage] }),
      el('p', { text: detail.candidate_name }),
      el('p', { text: detail.contact_email }),
      el('p', { text: detail.phone }),
      el('p', { text: detail.cover_note }),
      el('a', { href: `/api/files/${detail.resume_file_id}`, text: 'Download resume', download: 'resume.pdf' }),
    ]),
  );
  return () => undefined;
}
