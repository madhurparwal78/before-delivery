import { ApiCallError, api } from '../api';
import { el, applyFieldErrors, clearFieldErrors, field, mount, setFieldError } from '../dom';
import { PeriodId, PlanId, planOffer } from '../../shared/plans';
import { formatMoney } from '../../shared/format';
import { navigate } from '../router';

const TIME_ZONES = [
  'Europe/Berlin',
  'Europe/London',
  'Europe/Lisbon',
  'Europe/Madrid',
  'Europe/Paris',
  'Europe/Stockholm',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Asia/Kolkata',
  'Australia/Sydney',
  'UTC',
];

function mainNavigation(): HTMLElement {
  return el('nav', { 'aria-label': 'Main', class: 'public-nav' }, [
    el('a', { href: '/', class: 'wordmark', text: 'Orrery Studio' }),
    el('ul', {}, [
      el('li', {}, [el('a', { href: '/', text: 'Product' })]),
      el('li', {}, [el('a', { href: '/pricing', text: 'Pricing' })]),
      el('li', {}, [el('a', { href: '/login', text: 'Sign in' })]),
      el('li', {}, [el('a', { href: '/signup', class: 'button primary', text: 'Start free trial' })]),
    ]),
  ]);
}

function section(
  numeral: string,
  heading: string,
  paragraphs: string[],
  extra: HTMLElement | null = null,
): HTMLElement {
  const headingId = `section-${numeral}`;
  return el('section', { class: 'ruled-section', 'aria-labelledby': headingId }, [
    el('p', { class: 'rail-numeral', 'aria-hidden': 'true', text: numeral }),
    el('div', { class: 'section-body' }, [
      el('h2', { id: headingId }, [el('span', { class: 'inline-numeral', text: numeral }), heading]),
      ...paragraphs.map((paragraph) => el('p', { text: paragraph })),
      extra,
    ]),
  ]);
}

export function homeScreen(root: HTMLElement): void {
  const sections = el('div', { class: 'number-rail-grid' }, [
    section('01', 'What Orrery Studio is', [
      'Orrery Studio is a browser workspace where brand and product-marketing teams build interactive 3D scenes for launch pages, review them and publish them.',
      'A scene is a product that turns on hover, a camera that glides in on scroll, or a colourway that changes on click. Owners, admins, billing managers, editors, viewers and outside agents all work in one governed workspace.',
    ]),
    section('02', 'How the operation-log rewind works', [
      'Every change is an attributed operation stored with its inverse. Drag the timeline playhead back and the viewport re-renders the scene exactly as it was, with changed objects outlined and inspector numbers counting to their old values.',
      'Restore any past operation as new operations: the scene matches that point again and the history stays intact.',
    ]),
    section('03', 'Agents under the same rules as people', [
      'Outside agents get their own scoped tokens, never a person’s password. A catalogue bot that poses every variant works under the same permissions, object locks and undo as a teammate.',
      'Every operation is credited to the token that sent it, so a live embed always traces back to the edits behind it.',
    ]),
    section('04', 'Plans', [
      'Team is $96.00 per month with 8 seats. Business is $380.00 per month with 20 seats. Annual billing is ten months for twelve.',
      'Scheduled publishing, review links and agent tokens are included on both plans.',
    ], el('a', { href: '/pricing', class: 'button', text: 'Compare plans' })),
    section('05', 'Start a trial', [
      'Start a 14-day trial, invite your team and publish your first embed. No card is needed to begin.',
    ], el('a', { href: '/signup', class: 'button primary', text: 'Start your trial' })),
  ]);

  mount(
    root,
    el('div', { class: 'public-page' }, [
      mainNavigation(),
      el('header', { class: 'public-hero' }, [
        el('h1', { text: '3D scenes your whole team can trace' }),
        el('p', {
          class: 'lede',
          text: 'Build states and transitions in the browser, review them with pinned comments, and publish a versioned embed that traces back to every operation behind it.',
        }),
      ]),
      el('main', {}, [sections]),
      el('footer', { class: 'public-footer' }, [
        el('p', { text: 'Orrery Labs · Orrery Studio' }),
      ]),
    ]),
  );
}

function priceCell(plan: PlanId, period: PeriodId): string {
  const offer = planOffer(plan, period);
  return `${formatMoney(offer.priceCents)} / ${period === 'monthly' ? 'month' : 'year'}`;
}

function extraSeatCell(plan: PlanId, period: PeriodId): string {
  const offer = planOffer(plan, period);
  return `${formatMoney(offer.extraSeatCents)} / ${period === 'monthly' ? 'month' : 'year'}`;
}

export function pricingScreen(root: HTMLElement): void {
  let period: PeriodId = 'monthly';
  const table = el('table', { class: 'compare-plans' });

  const render = (): void => {
    mount(
      table,
      el('caption', { text: 'Compare plans' }),
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: 'Plan' }),
          el('th', { scope: 'col', text: 'Team' }),
          el('th', { scope: 'col', text: 'Business' }),
        ]),
      ]),
      el('tbody', {}, [
        el('tr', {}, [
          el('th', { scope: 'row', text: 'Price' }),
          el('td', { class: 'figure', 'data-plan': 'Team', text: priceCell('team', period) }),
          el('td', { class: 'figure', 'data-plan': 'Business', text: priceCell('business', period) }),
        ]),
        el('tr', {}, [
          el('th', { scope: 'row', text: 'Included seats' }),
          el('td', { class: 'figure', 'data-plan': 'Team', text: '8' }),
          el('td', { class: 'figure', 'data-plan': 'Business', text: '20' }),
        ]),
        el('tr', {}, [
          el('th', { scope: 'row', text: 'Extra seat' }),
          el('td', { class: 'figure', 'data-plan': 'Team', text: extraSeatCell('team', period) }),
          el('td', {
            class: 'figure',
            'data-plan': 'Business',
            text: extraSeatCell('business', period),
          }),
        ]),
        el('tr', {}, [
          el('th', { scope: 'row', text: 'Agent tokens' }),
          el('td', { 'data-plan': 'Team', text: 'Up to 5' }),
          el('td', { 'data-plan': 'Business', text: 'Up to 25' }),
        ]),
        el('tr', {}, [
          el('th', { scope: 'row', text: 'Scheduled publishing' }),
          el('td', { 'data-plan': 'Team', text: 'Included' }),
          el('td', { 'data-plan': 'Business', text: 'Included' }),
        ]),
        el('tr', {}, [
          el('th', { scope: 'row', text: 'Review links' }),
          el('td', { 'data-plan': 'Team', text: 'Included' }),
          el('td', { 'data-plan': 'Business', text: 'Included' }),
        ]),
      ]),
    );
  };
  render();

  const radios = (['monthly', 'annual'] as PeriodId[]).map((value) => {
    const input = el('input', {
      type: 'radio',
      name: 'billing-period',
      value,
      checked: value === 'monthly',
      id: `period-${value}`,
    });
    input.addEventListener('change', () => {
      if (!input.checked) return;
      period = value;
      render();
    });
    return el('label', { class: 'radio-pill' }, [
      input,
      el('span', { text: value === 'monthly' ? 'Monthly' : 'Annual' }),
    ]);
  });

  mount(
    root,
    el('div', { class: 'public-page' }, [
      mainNavigation(),
      el('main', {}, [
        el('h1', { text: 'Plans for teams that publish' }),
        el('div', { role: 'radiogroup', 'aria-label': 'Billing period', class: 'segmented' }, radios),
        table,
        el('p', { class: 'pricing-note' }, [
          el('a', { href: '/signup', class: 'button primary', text: 'Start free trial' }),
        ]),
        el('p', { class: 'pricing-note', text: 'Annual plans are billed once a year.' }),
      ]),
    ]),
  );
}

function formStatus(): HTMLElement {
  return el('p', { role: 'status', 'aria-label': 'Form status', class: 'form-status' });
}

export function signupScreen(root: HTMLElement): void {
  const workspace = el('input', { type: 'text', name: 'workspaceName', required: true });
  const name = el('input', { type: 'text', name: 'name', required: true });
  const email = el('input', { type: 'email', name: 'email', required: true });
  const password = el('input', { type: 'password', name: 'password', required: true });
  const zone = el('select', { name: 'timeZone' }, TIME_ZONES.map((value) => el('option', { value, text: value, selected: value === 'Europe/Berlin' })));
  const status = formStatus();
  const submit = el('button', { type: 'submit', class: 'button primary', text: 'Start 14-day trial' });

  const form = el('form', { 'aria-label': 'Start your trial', class: 'form-column' }, [
    el('h1', { text: 'Start your trial' }),
    field('Workspace name', workspace),
    field('Your name', name),
    field('Work email', email),
    field('Password', password, { hint: 'At least 10 characters.' }),
    field('Time zone', zone),
    submit,
    status,
  ]);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    clearFieldErrors(form);
    status.textContent = 'Creating your workspace…';
    submit.disabled = true;
    api
      .post('/api/signup', {
        workspaceName: workspace.value,
        name: name.value,
        email: email.value,
        password: password.value,
        timeZone: zone.value,
      })
      .then(() => {
        navigate('/app');
      })
      .catch((error: unknown) => {
        submit.disabled = false;
        status.textContent = '';
        if (error instanceof ApiCallError) {
          if (error.error === 'email_taken') {
            status.textContent = 'That email already has a workspace. Sign in instead.';
            setFieldError(email, 'That email already has a workspace. Sign in instead.');
            return;
          }
          if (error.errors) {
            const message = applyFieldErrors(form, error.errors);
            if (message) status.textContent = message;
            return;
          }
        }
        status.textContent = 'Something went wrong. Try again.';
      });
  });

  mount(root, el('div', { class: 'public-page' }, [mainNavigation(), el('main', {}, [form])]));
}

export function loginScreen(root: HTMLElement): void {
  const email = el('input', { type: 'email', name: 'email', required: true });
  const password = el('input', { type: 'password', name: 'password', required: true });
  const status = formStatus();
  const submit = el('button', { type: 'submit', class: 'button primary', text: 'Sign in' });
  const form = el('form', { 'aria-label': 'Sign in', class: 'form-column' }, [
    el('h1', { text: 'Sign in' }),
    field('Email', email),
    field('Password', password),
    submit,
    status,
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    clearFieldErrors(form);
    status.textContent = 'Signing in…';
    submit.disabled = true;
    api
      .post('/api/auth/login', { email: email.value, password: password.value })
      .then(() => navigate('/app'))
      .catch((error: unknown) => {
        submit.disabled = false;
        status.textContent =
          error instanceof ApiCallError && error.status === 401
            ? 'Email or password is incorrect.'
            : 'Something went wrong. Try again.';
      });
  });
  mount(root, el('div', { class: 'public-page' }, [mainNavigation(), el('main', {}, [form])]));
}

export async function inviteScreen(root: HTMLElement, token: string): Promise<void> {
  let invitation: { workspace: { name: string }; email: string; role: string };
  try {
    invitation = await api.get(`/api/invites/${encodeURIComponent(token)}`);
  } catch {
    mount(
      root,
      el('div', { class: 'public-page' }, [
        mainNavigation(),
        el('main', {}, [
          el('div', { class: 'form-column' }, [
            el('h1', { text: 'Invitation' }),
            el('p', { role: 'status', text: 'This invitation is no longer valid.' }),
          ]),
        ]),
      ]),
    );
    return;
  }

  const name = el('input', { type: 'text', name: 'name', required: true });
  const password = el('input', { type: 'password', name: 'password', required: true });
  const status = formStatus();
  const submit = el('button', {
    type: 'submit',
    class: 'button primary',
    text: `Join ${invitation.workspace.name}`,
  });
  const form = el('form', { 'aria-label': 'Join workspace', class: 'form-column' }, [
    el('h1', { text: `Join ${invitation.workspace.name}` }),
    el('p', { text: `You were invited as ${invitation.email} with the ${invitation.role} role.` }),
    field('Your name', name),
    field('Password', password, { hint: 'At least 10 characters.' }),
    submit,
    status,
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    clearFieldErrors(form);
    status.textContent = 'Creating your workspace…';
    submit.disabled = true;
    api
      .post(`/api/invites/${encodeURIComponent(token)}/accept`, {
        name: name.value,
        password: password.value,
      })
      .then(() => navigate('/app'))
      .catch((error: unknown) => {
        submit.disabled = false;
        status.textContent = '';
        if (error instanceof ApiCallError) {
          if (error.error === 'email_taken') {
            status.textContent = 'That email already has a workspace. Sign in instead.';
            return;
          }
          if (error.status === 404) {
            status.textContent = 'This invitation is no longer valid.';
            return;
          }
          if (error.errors) {
            const message = applyFieldErrors(form, error.errors);
            if (message) status.textContent = message;
            return;
          }
        }
        status.textContent = 'Something went wrong. Try again.';
      });
  });
  mount(root, el('div', { class: 'public-page' }, [mainNavigation(), el('main', {}, [form])]));
}
