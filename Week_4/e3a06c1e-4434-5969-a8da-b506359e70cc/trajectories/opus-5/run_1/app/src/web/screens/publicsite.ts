import { ApiFailure, request } from '../api.js';
import { el, field, prefersReducedMotion, setAttribute, showFieldError } from '../dom.js';
import { SessionField } from '../field/field.js';
import { StatusRegion } from '../ui/status.js';
import { billableMinutesText, billableSeconds, parseCalculatorLength } from '../../shared/billing.js';
import { calculatorCopy, genericFailure, trialCopy } from '../../shared/copy.js';
import type { Screen } from '../router.js';

const SCRUB_RANGE = 1600;
const STAGE_SPAN = 320;

interface Stage {
  readonly name: string;
  readonly lines: string;
}

const stages: readonly Stage[] = [
  {
    name: 'Capture',
    lines:
      'Your integration opens one socket and streams 16 kHz, 16-bit audio. Nothing is resampled on the way in.',
  },
  {
    name: 'Stream',
    lines: 'Frames are recognised as they arrive, thirty spectrum rows a second, and never buffered out of order.',
  },
  {
    name: 'Recognise',
    lines: 'Each phrase becomes a segment with a confidence for every word, so weak words are visible immediately.',
  },
  {
    name: 'Review',
    lines:
      'Reviewers correct low-confidence words against the retained audio. Approvals update the reviewed transcript and the word error rate; the machine original is kept.',
  },
  {
    name: 'Meter',
    lines: 'Every closed session is metered once under your plan\u2019s published rounding rule and confirmed by billing.',
  },
];

const planCards = [
  {
    title: 'Pilot',
    price: '6 cents per billable minute',
    rule: 'Each session is rounded up to whole minutes, per channel.',
  },
  {
    title: 'Scale',
    price: '3 cents per billable minute',
    rule: 'Each session is billed per second with a 15-second minimum, per channel.',
  },
];

const teamOptions = [
  { value: 'contact_centre', label: 'Contact centre' },
  { value: 'clinical_dictation', label: 'Clinical dictation' },
];

interface DemoSpectrum {
  frame_rate: number;
  rows: number[][];
}

const peakOf = (row: readonly number[]): number => {
  let best = 0;
  for (let i = 1; i < row.length; i += 1) if ((row[i] as number) > (row[best] as number)) best = i;
  return best;
};

const buildCalculator = (): HTMLElement => {
  const status = new StatusRegion('Billed minutes');
  const input = el('input', {
    type: 'text',
    inputmode: 'decimal',
    id: 'calculator-length',
    'aria-label': 'Session length in seconds',
    class: 'input numeric',
    autocomplete: 'off',
  });
  const lengthField = field('Session length in seconds', input, 'calculator-length-error');
  lengthField.row.querySelector('.field-label')?.classList.add('visually-hidden');

  const mono = el('input', { type: 'radio', name: 'channels', id: 'channels-mono', value: '1', checked: true });
  const stereo = el('input', { type: 'radio', name: 'channels', id: 'channels-stereo', value: '2' });
  const channels = el('fieldset', { role: 'radiogroup', 'aria-label': 'Channels', class: 'radio-group' }, [
    el('legend', { class: 'field-label', text: 'Channels' }),
    el('div', { class: 'radio-row' }, [
      el('label', { class: 'radio', for: 'channels-mono' }, [mono, el('span', { text: 'Mono' })]),
      el('label', { class: 'radio', for: 'channels-stereo' }, [stereo, el('span', { text: 'Stereo' })]),
    ]),
  ]);

  const recompute = (): void => {
    const raw = input.value.trim();
    if (raw === '') {
      showFieldError(input, lengthField.error, null);
      status.set('');
      return;
    }
    const audioMs = parseCalculatorLength(raw);
    if (audioMs === null) {
      showFieldError(input, lengthField.error, calculatorCopy.invalid);
      status.set('');
      return;
    }
    showFieldError(input, lengthField.error, null);
    const count = stereo.checked ? 2 : 1;
    status.set(
      calculatorCopy.billed(
        billableMinutesText(billableSeconds('pilot', audioMs, count)),
        billableMinutesText(billableSeconds('scale', audioMs, count)),
      ),
    );
  };

  input.addEventListener('input', recompute);
  for (const radio of [mono, stereo]) radio.addEventListener('change', recompute);

  return el('div', { class: 'calculator' }, [
    el('h3', { class: 'calculator-title', text: 'Billed minutes calculator' }),
    el('div', { class: 'calculator-controls' }, [lengthField.row, channels]),
    status.node,
  ]);
};

const buildTrialForm = (): HTMLElement => {
  const status = new StatusRegion('Trial status');
  const name = el('input', { type: 'text', id: 'trial-name', 'aria-label': 'Name', class: 'input' });
  const email = el('input', { type: 'email', id: 'trial-email', 'aria-label': 'Work email', class: 'input' });
  const company = el('input', { type: 'text', id: 'trial-company', 'aria-label': 'Company', class: 'input' });
  const team = el(
    'select',
    { id: 'trial-team', 'aria-label': 'Team', class: 'input' },
    teamOptions.map((option) => el('option', { value: option.value, text: option.label })),
  );
  const submit = el('button', { type: 'submit', class: 'button button-primary', text: 'Request trial' });

  const nameField = field('Name', name, 'trial-name-error');
  const emailField = field('Work email', email, 'trial-email-error');
  const companyField = field('Company', company, 'trial-company-error');
  const teamField = field('Team', team, 'trial-team-error');

  const form = el(
    'form',
    { 'aria-label': 'Request a trial workspace', class: 'trial-form', novalidate: true },
    [
      el('h2', { class: 'section-title', text: 'Request a trial workspace' }),
      nameField.row,
      emailField.row,
      companyField.row,
      teamField.row,
      submit,
      status.node,
    ],
  );

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit.disabled = true;
    showFieldError(name, nameField.error, null);
    showFieldError(email, emailField.error, null);
    showFieldError(company, companyField.error, null);
    showFieldError(team, teamField.error, null);
    void request<{ id: string }>('/api/trial-requests', {
      method: 'POST',
      json: { name: name.value, email: email.value, company: company.value, team: team.value },
    })
      .then(() => {
        for (const entry of [nameField.row, emailField.row, companyField.row, teamField.row, submit]) entry.remove();
        status.set(trialCopy.success);
      })
      .catch((error: unknown) => {
        submit.disabled = false;
        const fields = error instanceof ApiFailure ? error.fields : {};
        showFieldError(name, nameField.error, fields.name ?? null);
        showFieldError(email, emailField.error, fields.email ?? null);
        showFieldError(company, companyField.error, fields.company ?? null);
        showFieldError(team, teamField.error, fields.team ?? null);
        if (Object.keys(fields).length === 0) status.set(genericFailure);
      });
  });

  return form;
};

export const publicSiteScreen = (): Screen => {
  const reduced = prefersReducedMotion();
  const heroField = new SessionField({ surfaceClass: 'field-hero' });
  heroField.setSessionState('live');

  const heroText = el('div', { class: 'hero-text' }, [
    el('p', { class: 'eyebrow', text: 'Lowfield Signal' }),
    el('h1', { class: 'hero-title', text: 'Watch every second you are billed for.' }),
    el('p', {
      class: 'hero-line',
      text: 'Live speech recognition for agent assist and clinical dictation, with per-project quotas, published rounding and reviewed transcripts.',
    }),
    el('a', { href: '/sign-in', class: 'button button-primary', 'data-link': 'true', text: 'Sign in' }),
  ]);

  const stageItems = stages.map((stage, index) =>
    el('li', { class: 'stage', 'data-stage-index': index + 1 }, [
      el('h3', { class: 'stage-name', text: stage.name }),
      el('p', { class: 'stage-line', text: stage.lines }),
    ]),
  );
  const stageList = el('ol', { class: 'stage-list' }, stageItems);
  const signalPath = el(
    'section',
    { 'aria-label': 'Signal path', class: 'signal-path', 'data-stage': reduced ? 5 : 1 },
    [el('h2', { class: 'section-title', text: 'Signal path' }), stageList],
  );

  const heroRibbon = el('div', { class: 'hero-ribbon', 'aria-hidden': 'true' },
    Array.from({ length: 24 }, (_, i) => el('span', { class: `hero-tile hero-tile-${i % 5 === 3 ? 'low' : i % 3 === 1 ? 'medium' : 'high'}` })),
  );
  const heroStats = el('div', { class: 'hero-stats', 'aria-hidden': 'true' }, [
    el('span', { class: 'hero-stat', text: '12.000 s' }),
    el('span', { class: 'hero-stat', text: 'frame 359' }),
    el('span', { class: 'hero-stat', text: 'bin 35' }),
    el('span', { class: 'hero-stat', text: '1.00 min' }),
  ]);

  const pinned = el('div', { class: `scrub-pinned${reduced ? ' scrub-static' : ''}` }, [
    el('div', { class: 'hero-field' }, [heroField.node, heroRibbon, heroStats]),
    heroText,
    signalPath,
  ]);
  const scrub = el('div', { class: `scrub${reduced ? ' scrub-reduced' : ''}` }, [pinned]);

  const plans = el('section', { 'aria-label': 'Plans', class: 'plans' }, [
    el('h2', { class: 'section-title', text: 'Plans' }),
    el(
      'div',
      { class: 'plan-cards' },
      planCards.map((card) =>
        el('article', { class: 'plan-card' }, [
          el('h3', { class: 'plan-title', text: card.title }),
          el('p', { class: 'plan-price', text: card.price }),
          el('p', { class: 'plan-rule', text: card.rule }),
        ]),
      ),
    ),
    buildCalculator(),
  ]);

  const node = el('main', { class: 'public-site' }, [scrub, plans, buildTrialForm()]);

  const applyStage = (stage: number): void => {
    setAttribute(signalPath, 'data-stage', String(stage));
    stageItems.forEach((item, index) => {
      const active = index + 1 === stage;
      item.classList.toggle('stage-active', active);
      if (active) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    });
  };

  const onScroll = (): void => {
    const offset = Math.min(SCRUB_RANGE, Math.max(0, window.scrollY));
    applyStage(Math.min(stages.length, Math.floor(offset / STAGE_SPAN) + 1));
  };

  if (reduced) {
    applyStage(5);
    for (const item of stageItems) item.classList.add('stage-active');
    stageItems[4]?.setAttribute('aria-current', 'step');
  } else {
    applyStage(1);
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  let demoTimer = 0;
  void request<DemoSpectrum>('/api/public/demo-spectrum').then((demo) => {
    if (demo.rows.length === 0) return;
    const first = demo.rows[0] as number[];
    heroField.setFrame(0, peakOf(first), first);
    if (reduced) return;
    let index = 0;
    demoTimer = window.setInterval(() => {
      index = (index + 1) % demo.rows.length;
      const row = demo.rows[index] as number[];
      heroField.setFrame(index, peakOf(row), row);
    }, 1000 / demo.frame_rate);
  });

  return {
    node,
    destroy: () => {
      window.removeEventListener('scroll', onScroll);
      window.clearInterval(demoTimer);
      heroField.destroy();
    },
  };
};
