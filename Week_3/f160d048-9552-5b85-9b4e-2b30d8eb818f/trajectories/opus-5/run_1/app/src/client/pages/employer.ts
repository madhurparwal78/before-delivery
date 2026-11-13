import {
  applicantCountLine,
  CITIES,
  ROLE_FAMILIES,
  STAGE_LABELS,
  STAGES,
  WORK_PATTERNS,
  type Stage,
} from '../../shared/reference';
import { announce } from '../core/announce';
import { failureOf, get, post, put } from '../core/api';
import { el, focus, on } from '../core/dom';
import { onLive, onLiveReload } from '../core/live';
import { runMotion } from '../core/motion';
import { navigate, type Cleanup, type PageContext } from '../core/router';
import {
  clearFieldErrors,
  currentUser,
  fieldError,
  pageAlert,
  showToast,
  toastAndAnnounce,
  working,
} from '../core/shell';
import { chipGroup } from '../widgets/chips';
import { combobox, type Combobox } from '../widgets/combobox';
import { choiceRadiogroup } from '../widgets/stars';

interface JobRow {
  id: string;
  title: string;
  status: 'draft' | 'listed' | 'closed';
}

interface Applicant {
  id: string;
  job_id: string;
  candidate_name: string;
  contact_email: string;
  phone: string;
  cover_note: string;
  stage: Stage;
  applied_on: string;
  updated_on: string;
  resume_file_id: string;
}

function labelled(labelText: string, input: HTMLElement): HTMLElement {
  input.id = `employer-${labelText.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return el('div', { class: 'field' }, [el('label', { for: input.id, text: labelText }), input]);
}

function labelledCombobox(labelText: string, combo: Combobox): HTMLElement {
  combo.input.id = `employer-${labelText.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return el('div', { class: 'field' }, [el('label', { for: combo.input.id, text: labelText }), combo.element]);
}

function fixedCombobox(name: string, listName: string, options: ReadonlyArray<{ id: string; name: string }>): Combobox {
  return combobox({
    name,
    listName,
    load: async (query) =>
      options
        .filter((option) => option.name.toLowerCase().includes(query.trim().toLowerCase()))
        .map((option) => ({ id: option.id, label: option.name })),
  });
}

export async function renderEmployerHome(container: HTMLElement): Promise<Cleanup> {
  const page = el('div', { class: 'narrow-page' }, [el('h1', { text: 'Employer home' })]);
  container.append(page);
  const alert = pageAlert(page);
  const user = currentUser();

  const company = user?.company_slug
    ? await get<{ verified: boolean; name: string }>(`/api/companies/${user.company_slug}`)
    : null;
  const verifiedText = el('p', { class: 'verified-mark', text: company?.verified ? 'Verified employer' : '' });
  page.append(verifiedText);

  if (user?.role === 'employer_admin') {
    const workEmail = el('input', { type: 'email', class: 'textbox' });
    const sendCode = el('button', { type: 'button', class: 'solid-button', text: 'Send code' });
    const code = el('input', { type: 'text', class: 'textbox' });
    const verify = el('button', { type: 'button', class: 'solid-button', text: 'Verify' });
    const note = el('p', { class: 'muted' });
    const verifyForm = el('form', { class: 'stack' }, [
      labelled('Work email', workEmail),
      sendCode,
      labelled('Verification code', code),
      verify,
      note,
    ]);
    page.append(verifyForm);

    on(sendCode, 'click', () => {
      const done = working(sendCode);
      clearFieldErrors(verifyForm);
      void post('/api/employer/verification/request', { email: workEmail.value })
        .then(() => {
          note.textContent = `A code is on its way to ${workEmail.value}.`;
          announce(note.textContent);
        })
        .catch((error: unknown) => {
          const failure = failureOf(error);
          if (failure?.fields?.['email']) fieldError(workEmail, failure.fields['email']);
          else alert(failure?.message ?? 'Something went wrong.');
        })
        .finally(done);
    });

    on(verify, 'click', () => {
      const done = working(verify);
      clearFieldErrors(verifyForm);
      void post('/api/employer/verification/confirm', { code: code.value })
        .then(() => {
          verifiedText.textContent = 'Verified employer';
          announce('Your team is verified.');
        })
        .catch((error: unknown) => {
          const failure = failureOf(error);
          if (failure?.error === 'code_invalid' || failure?.error === 'code_expired') fieldError(code, failure.message);
          else alert(failure?.message ?? 'Something went wrong.');
        })
        .finally(done);
    });

    const mark = el('input', { type: 'file', class: 'file-field', accept: 'image/png' });
    page.append(labelled('Lab mark (PNG)', mark));
    on(mark, 'change', () => {
      const file = mark.files?.[0];
      if (!file) return;
      void file.arrayBuffer().then((bytes) =>
        put('/api/employer/company/mark', bytes, { 'content-type': 'image/png' })
          .then(() => announce('Mark updated.'))
          .catch((error: unknown) => alert(failureOf(error)?.message ?? 'Something went wrong.')),
      );
    });
  }

  page.append(el('a', { href: '/employer/jobs/new', class: 'solid-button', text: 'List a job' }));
  const list = el('ul', { 'aria-label': 'Your jobs', class: 'plain-list' });
  page.append(list);

  const paint = (jobs: JobRow[]): void => {
    list.replaceChildren();
    for (const job of jobs) {
      const item = el('li', { 'data-id': job.id }, [
        el('a', { href: `/employer/jobs/${job.id}`, text: job.title }),
        el('p', {
          class: 'job-status',
          text: job.status === 'closed' ? 'Closed' : job.status === 'draft' ? 'Draft' : 'Listed',
        }),
      ]);
      const close = el('button', {
        type: 'button',
        class: 'nav-action',
        'aria-label': `Close ${job.title}`,
        text: 'Close',
      });
      on(close, 'click', () => {
        const done = working(close);
        void post(`/api/employer/jobs/${job.id}/close`)
          .then(async () => {
            announce(`${job.title} is closed.`);
            paint((await get<{ jobs: JobRow[] }>('/api/employer/jobs')).jobs);
          })
          .catch((error: unknown) => alert(failureOf(error)?.message ?? 'Something went wrong.'))
          .finally(done);
      });
      item.append(close);
      if (job.status === 'draft') {
        const relist = el('button', {
          type: 'button',
          class: 'nav-action',
          'aria-label': `List ${job.title} again`,
          text: 'List again',
        });
        on(relist, 'click', () => {
          const done = working(relist);
          void post(`/api/employer/jobs/${job.id}/list`)
            .then(async () => {
              toastAndAnnounce(`${job.title} is listed.`);
              paint((await get<{ jobs: JobRow[] }>('/api/employer/jobs')).jobs);
            })
            .catch((error: unknown) => alert(failureOf(error)?.message ?? 'Something went wrong.'))
            .finally(done);
        });
        item.append(relist);
      }
      list.append(item);
    }
  };
  paint((await get<{ jobs: JobRow[] }>('/api/employer/jobs')).jobs);
  return () => undefined;
}

export async function renderNewJob(container: HTMLElement): Promise<Cleanup> {
  const page = el('div', { class: 'narrow-page' }, [el('h1', { text: 'List a job' })]);
  container.append(page);
  const alert = pageAlert(page);

  const title = el('input', { type: 'text', class: 'textbox' });
  const role = fixedCombobox('Role', 'Role suggestions', ROLE_FAMILIES);
  const city = fixedCombobox('City', 'City suggestions', CITIES);
  const pattern = choiceRadiogroup(
    'Work pattern',
    WORK_PATTERNS.map((item) => ({ id: item.id, label: item.name })),
  );
  const payFrom = el('input', { type: 'number', class: 'textbox' });
  const payTo = el('input', { type: 'number', class: 'textbox' });
  const description = el('textarea', { class: 'textbox', rows: '5' });
  const submit = el('button', { type: 'button', class: 'solid-button', text: 'List job' });

  const form = el('form', { class: 'stack' }, [
    labelled('Title', title),
    labelledCombobox('Role', role),
    labelledCombobox('City', city),
    el('div', { class: 'field' }, [el('span', { class: 'field-label', text: 'Work pattern' }), pattern.element]),
    labelled('Pay from (rupees a year)', payFrom),
    labelled('Pay to (rupees a year)', payTo),
    labelled('Description', description),
    submit,
  ]);
  page.append(form);

  on(submit, 'click', () => {
    const done = working(submit);
    clearFieldErrors(form);
    void post<{ title: string }>('/api/employer/jobs', {
      title: title.value,
      role_family: role.selected()?.id ?? '',
      city: city.selected()?.id ?? '',
      remote: pattern.value() ?? '',
      pay_low: Number(payFrom.value),
      pay_high: Number(payTo.value),
      description: description.value,
    })
      .then((created) => {
        showToast(`${created.title} is listed.`);
        announce(`${created.title} is listed.`);
        navigate('/employer');
      })
      .catch((error: unknown) => {
        const failure = failureOf(error);
        if (failure?.fields) {
          const inputs: Record<string, HTMLElement> = {
            title,
            role_family: role.input,
            city: city.input,
            remote: pattern.element,
            pay_low: payFrom,
            pay_high: payTo,
            description,
          };
          for (const [field, message] of Object.entries(failure.fields)) {
            const input = inputs[field];
            if (input) fieldError(input, message);
          }
          return;
        }
        alert(failure?.message ?? 'Something went wrong.');
      })
      .finally(done);
  });
  return () => undefined;
}

export async function renderPipeline(container: HTMLElement, ctx: PageContext): Promise<Cleanup> {
  const jobId = ctx.params['id'] as string;
  const page = el('div', { class: 'working-screen' });
  container.append(page);
  const alert = pageAlert(page);

  const job = await get<{ title: string }>(`/api/jobs/${jobId}`);
  page.append(el('h1', { text: job.title }));

  const countLine = el('p', { class: 'count-line' });
  const columnsHost = el('div', { class: 'pipeline' });
  const exportButton = el('button', { type: 'button', class: 'nav-action', text: 'Export applicants CSV' });
  on(exportButton, 'click', () => window.location.assign(`/api/employer/jobs/${jobId}/applicants.csv`));

  let applicants: Applicant[] = [];
  let shown: Stage[] = [];
  const clearButton = el('button', { type: 'button', class: 'nav-action', text: 'Clear filters' });

  const stageChips = chipGroup({
    name: 'Stage filter',
    chips: STAGES.map((stage) => ({ id: stage, label: STAGE_LABELS[stage] })),
    onToggle: ({ chip, added }) => {
      shown = stageChips.pressed() as Stage[];
      paint();
      announce(`Filter ${added ? 'added' : 'removed'}: ${chip.label}. ${applicantCountLine(visible().length)}.`);
    },
    clearButton: () => clearButton,
  });
  on(clearButton, 'click', () => {
    stageChips.setPressed([]);
    shown = [];
    paint();
  });

  const visible = (): Applicant[] =>
    shown.length === 0 ? applicants : applicants.filter((item) => shown.includes(item.stage));

  let picked: { id: string; target: number } | null = null;

  const move = (applicant: Applicant, stage: Stage): void => {
    void post<Applicant>(`/api/employer/applications/${applicant.id}/stage`, { stage })
      .then((updated) => {
        applicant.stage = updated.stage;
        paint();
        const card = columnsHost.querySelector<HTMLElement>(`[data-id="${applicant.id}"]`);
        if (card) {
          runMotion(card, 'card-drop', 'running', 'done');
          focus(card);
        }
        announce(`${applicant.candidate_name} moved to ${STAGE_LABELS[stage]}.`);
      })
      .catch((error: unknown) => {
        announce(`${applicant.candidate_name} cannot move to ${STAGE_LABELS[stage]}.`);
        alert(failureOf(error)?.message ?? 'Something went wrong.');
      });
  };

  const paint = (): void => {
    columnsHost.replaceChildren();
    const items = visible();
    countLine.textContent = applicantCountLine(items.length);
    for (const [index, stage] of STAGES.entries()) {
      if (shown.length > 0 && !shown.includes(stage)) continue;
      const inStage = items.filter((item) => item.stage === stage);
      const list = el('ul', { 'aria-label': STAGE_LABELS[stage], class: 'stage-column', 'data-stage': stage });
      for (const applicant of inStage) {
        const card = el('button', {
          type: 'button',
          class: 'applicant-card',
          'data-id': applicant.id,
          'aria-label': `${applicant.candidate_name}, ${STAGE_LABELS[stage]}`,
          text: applicant.candidate_name,
        });
        if (picked?.id === applicant.id) card.classList.add('picked');
        card.draggable = true;
        on(card, 'dragstart', (event) => {
          (event as DragEvent).dataTransfer?.setData('text/plain', applicant.id);
        });
        on(card, 'keydown', (event) => {
          if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            if (!picked) {
              picked = { id: applicant.id, target: index };
              card.classList.add('picked');
              announce(
                `Picked up ${applicant.candidate_name}, in ${STAGE_LABELS[stage]}. Use Left and Right to move, Space to drop, Escape to cancel.`,
              );
              return;
            }
            const target = STAGES[picked.target] as Stage;
            picked = null;
            if (target === stage) {
              announce(`Move cancelled. ${applicant.candidate_name} stays in ${STAGE_LABELS[stage]}.`);
              paint();
              focus(columnsHost.querySelector<HTMLElement>(`[data-id="${applicant.id}"]`));
              return;
            }
            move(applicant, target);
            return;
          }
          if (event.key === 'Escape' && picked) {
            event.preventDefault();
            picked = null;
            card.classList.remove('picked');
            announce(`Move cancelled. ${applicant.candidate_name} stays in ${STAGE_LABELS[stage]}.`);
            return;
          }
          const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
          if (step === 0 || !picked) return;
          event.preventDefault();
          const next = Math.min(STAGES.length - 1, Math.max(0, picked.target + step));
          if (next === picked.target) return;
          picked.target = next;
          for (const column of columnsHost.querySelectorAll('.stage-column')) column.classList.remove('target');
          columnsHost.querySelector(`[data-stage="${STAGES[next]}"]`)?.classList.add('target');
          announce(`${applicant.candidate_name} over ${STAGE_LABELS[STAGES[next] as Stage]}.`);
        });
        list.append(el('li', {}, [card]));
      }
      const column = el('div', { class: 'pipeline-column' }, [
        el('h2', { text: `${STAGE_LABELS[stage]} (${inStage.length})` }),
        list,
      ]);
      on(column, 'dragover', (event) => event.preventDefault());
      on(column, 'drop', (event) => {
        event.preventDefault();
        const id = (event as DragEvent).dataTransfer?.getData('text/plain');
        const dragged = applicants.find((item) => item.id === id);
        if (dragged && dragged.stage !== stage) move(dragged, stage);
      });
      columnsHost.append(column);
    }
  };

  const load = async (): Promise<void> => {
    applicants = (await get<{ applicants: Applicant[] }>(`/api/employer/jobs/${jobId}/applicants`)).applicants;
    paint();
  };

  page.append(el('div', { class: 'row' }, [stageChips.element, clearButton, exportButton]), countLine, columnsHost);
  await load();

  const stopLive = onLive((messages) => {
    for (const message of messages) {
      if (message.type !== 'application.stage' || message.data['job_id'] !== jobId) continue;
      const applicant = applicants.find((item) => item.id === String(message.data['application_id']));
      if (applicant) applicant.stage = String(message.data['stage']) as Stage;
      else void load();
    }
    paint();
  });
  const stopReload = onLiveReload(() => void load());
  return () => {
    stopLive();
    stopReload();
  };
}

export async function renderApplicant(container: HTMLElement, ctx: PageContext): Promise<Cleanup> {
  const applicant = await get<Applicant>(`/api/employer/applications/${ctx.params['id'] as string}`);
  container.append(
    el('div', { class: 'narrow-page' }, [
      el('h1', { text: applicant.candidate_name }),
      el('p', { text: applicant.contact_email }),
      el('p', { text: applicant.phone }),
      el('p', { text: applicant.cover_note }),
      el('p', { class: 'stage-text', text: STAGE_LABELS[applicant.stage] }),
      el('p', { class: 'figures', text: `Applied ${applicant.applied_on} · Updated ${applicant.updated_on}` }),
      el('a', { href: `/api/files/${applicant.resume_file_id}`, text: 'Download resume', download: 'resume.pdf' }),
    ]),
  );
  return () => undefined;
}
