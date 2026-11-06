import { call, newIdempotencyKey } from '../lib/api.js';
import { clear, el, focus } from '../lib/dom.js';
import { confirmLeave } from '../lib/dialog.js';
import { liveRegion, pending, problemsSummary, radioGroup, textbox } from '../lib/forms.js';
import { navigate, pageHeading, setLeaveGuard, type RenderContext, type Screen, type ScreenResult } from '../lib/router.js';
import { clearDraft, draft, saveDraft, tray } from '../lib/store.js';
import { copy } from '../lib/copy.js';
import type { OfficeId } from '../../shared/types.js';

type CastDraft = {
  name: string;
  company: string;
  email: string;
  office: string;
  shootDate: string;
  brief: string;
  idempotencyKey: string;
};

const DRAFT_NAME = 'cast-request';

const FIELD_IDS: Record<string, string> = {
  talentSlugs: 'cast-tray',
  name: 'cast-name',
  company: 'cast-company',
  email: 'cast-email',
  office: 'office-toronto',
  shootDate: 'cast-shoot-date',
  brief: 'cast-brief',
};

const STEP_TITLES = ['Your tray', 'Your details', 'The job', 'Review and send'];

function emptyDraft(): CastDraft {
  return {
    name: '',
    company: '',
    email: '',
    office: 'toronto',
    shootDate: '',
    brief: '',
    idempotencyKey: newIdempotencyKey(),
  };
}

export const castRequestScreen: Screen = {
  pattern: '/cast-request',
  async render(ctx: RenderContext): Promise<ScreenResult> {
    const step = Math.min(4, Math.max(1, Number.parseInt(ctx.query.get('step') ?? '1', 10) || 1));
    const stored = draft<Partial<CastDraft>>(DRAFT_NAME, {});
    const state: CastDraft = { ...emptyDraft(), ...stored };
    if (!stored.idempotencyKey) saveDraft(DRAFT_NAME, state);
    const live = liveRegion('Tray announcements');
    const problems = problemsSummary();
    const stepHeading = el('h2', { class: 'step-heading', text: STEP_TITLES[step - 1] });
    const body = el('div', { class: 'step-body' });
    const restored = Boolean(stored.name || stored.company || stored.email || stored.shootDate || stored.brief);

    const save = (): void => saveDraft(DRAFT_NAME, state);

    const back = el('button', { type: 'button', class: 'button button-quiet', text: 'Back' });
    const next = el('button', { type: 'button', class: 'button', text: 'Next' });
    const send = el('button', { type: 'button', class: 'button', text: 'Send cast request' });
    back.hidden = step === 1;
    next.hidden = step === 4;
    send.hidden = step !== 4;

    const entries = tray();
    if (step === 1) {
      const list = el('ul', { class: 'tray-list', id: FIELD_IDS.talentSlugs, 'aria-label': 'Tray' },
        entries.map((entry) => el('li', { class: 'tray-item', 'aria-label': entry.displayName }, [
          el('span', { class: 'tray-name', text: entry.displayName }),
        ])));
      body.append(
        el('p', { class: 'lede', text: `${entries.length} talent travel with this request.` }),
        list,
        el('p', { class: 'field-error', id: `${FIELD_IDS.talentSlugs}-error`, hidden: true }),
      );
    }
    if (step === 2) {
      const name = textbox({ id: FIELD_IDS.name, label: 'Your name', value: state.name, autocomplete: 'name' });
      const company = textbox({ id: FIELD_IDS.company, label: 'Company', value: state.company });
      const email = textbox({ id: FIELD_IDS.email, label: 'Email', value: state.email, type: 'email', autocomplete: 'email' });
      const office = radioGroup({
        name: 'office',
        label: 'Office',
        value: state.office,
        choices: [
          { value: 'toronto', label: 'Toronto' },
          { value: 'vancouver', label: 'Vancouver' },
        ],
        onChange: (value) => {
          state.office = value;
          save();
        },
      });
      name.input.addEventListener('input', () => {
        state.name = name.input.value;
        save();
      });
      company.input.addEventListener('input', () => {
        state.company = company.input.value;
        save();
      });
      email.input.addEventListener('input', () => {
        state.email = email.input.value;
        save();
      });
      body.append(
        name.field,
        company.field,
        email.field,
        el('div', { class: 'field' }, [el('span', { class: 'field-label', text: 'Office' }), office.node]),
      );
    }
    if (step === 3) {
      const shootDate = textbox({
        id: FIELD_IDS.shootDate,
        label: 'Shoot date',
        value: state.shootDate,
        type: 'date',
      });
      const brief = textbox({ id: FIELD_IDS.brief, label: 'Brief', value: state.brief, multiline: true });
      shootDate.input.addEventListener('input', () => {
        state.shootDate = shootDate.input.value;
        save();
      });
      brief.input.addEventListener('input', () => {
        state.brief = brief.input.value;
        save();
      });
      body.append(shootDate.field, brief.field);
    }
    if (step === 4) {
      body.append(
        el('dl', { class: 'facts' }, [
          el('dt', { text: 'Talent' }),
          el('dd', { text: entries.map((entry) => entry.displayName).join(', ') }),
          el('dt', { text: 'Your name' }),
          el('dd', { text: state.name }),
          el('dt', { text: 'Company' }),
          el('dd', { text: state.company }),
          el('dt', { text: 'Email' }),
          el('dd', { text: state.email }),
          el('dt', { text: 'Office' }),
          el('dd', { text: state.office === 'vancouver' ? 'Vancouver' : 'Toronto' }),
          el('dt', { text: 'Shoot date' }),
          el('dd', { text: state.shootDate }),
          el('dt', { text: 'Brief' }),
          el('dd', { text: state.brief }),
        ]),
        el('p', { class: 'field-error', id: `${FIELD_IDS.talentSlugs}-error`, hidden: true }),
      );
    }

    const form = el('form', { class: 'form cast-form', novalidate: true }, [
      problems.node,
      stepHeading,
      body,
      el('div', { class: 'sticky-bar' }, [back, next, send]),
    ]);
    form.addEventListener('submit', (event) => event.preventDefault());

    const node = el('main', { class: 'page page-cast' }, [
      pageHeading('Cast request'),
      form,
      live.node,
    ]);

    const payload = (): Record<string, unknown> => ({
      name: state.name,
      company: state.company,
      email: state.email,
      office: state.office as OfficeId,
      shootDate: state.shootDate,
      brief: state.brief,
      talentSlugs: tray().map((entry) => entry.slug),
    });

    const showErrors = (errors: Record<string, string>): void => {
      problems.show(errors, FIELD_IDS, node);
      live.announce(copy.validation(Object.keys(errors).length));
      const firstId = FIELD_IDS[Object.keys(errors)[0]];
      focus(node.querySelector<HTMLElement>(`#${firstId}`) ?? problems.node);
    };

    next.addEventListener('click', async () => {
      const spinner = pending(next, 'Checking…');
      spinner.start();
      const result = await call<{ ok: boolean }>('POST', '/api/cast-requests/checks', {
        body: { step, draft: payload() },
      });
      spinner.stop();
      if (result.status === 422 && result.error?.errors) {
        showErrors(result.error.errors);
        return;
      }
      problems.hide(node, FIELD_IDS);
      navigate(`/cast-request?step=${step + 1}`);
    });

    back.addEventListener('click', () => {
      navigate(`/cast-request?step=${Math.max(1, step - 1)}`);
    });

    send.addEventListener('click', async () => {
      const spinner = pending(send, 'Sending your cast request…');
      spinner.start();
      const result = await call<{ reference: string }>('POST', '/api/cast-requests', {
        body: payload(),
        idempotencyKey: state.idempotencyKey,
      });
      spinner.stop();
      if (result.status === 422 && result.error?.errors) {
        showErrors(result.error.errors);
        return;
      }
      if (result.status === 429) {
        live.announce(copy.rateLimited(Number(result.error?.retryAfterSeconds ?? 1)));
        return;
      }
      if (!result.body) {
        live.announce('That cast request could not be sent.');
        return;
      }
      setLeaveGuard(null);
      clearDraft(DRAFT_NAME);
      const city = state.office === 'vancouver' ? 'Vancouver' : 'Toronto';
      const heading = el('h1', { class: 'page-title display', text: 'Cast request sent' });
      clear(node);
      node.append(
        heading,
        el('p', { class: 'lede', text: `Cast request ${result.body.reference} sent. A booker in ${city} will reply by email.` }),
        el('a', { class: 'link', href: '/boards', text: 'Back to boards' }),
        live.node,
      );
      live.announce(`Cast request ${result.body.reference} sent. A booker in ${city} will reply by email.`);
      document.title = `${heading.textContent ?? ''} — Vesper & Rowe Talent`;
      focus(heading);
    });

    setLeaveGuard((to, proceed) => {
      if (to.startsWith('/cast-request')) {
        proceed();
        return;
      }
      confirmLeave(proceed);
    });

    return {
      node,
      chrome: 'public',
      onMounted: (): void => {
        focus(stepHeading);
        if (restored) live.announce(copy.draftRestored);
      },
    };
  },
};
