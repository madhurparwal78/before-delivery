// The contribute chooser and the three contribution forms.
import { h } from '../dom.js';
import { api, ApiFailure, apiErrorMessage } from '../api.js';
import { alertBand, announce, toast } from '../feedback.js';
import { combobox, starRating } from '../controls.js';
import { CITIES, OUTCOMES_CLIENT, ROLE_FAMILIES, WORK_PATTERNS_CLIENT } from '../reference.js';
import type { PageContext } from '../app.js';

export function contributePage(ctx: PageContext): HTMLElement {
  const main = h('main', { class: 'narrow' });
  if (!ctx.me) {
    ctx.navigate('/sign-in');
    return main;
  }
  main.appendChild(h('h1', {}, 'Share something'));
  main.appendChild(h('p', {}, 'Members give before they get. Your first approved post unlocks the full pay and review detail for every lab.'));
  main.appendChild(h('p', {}, h('a', { class: 'solid-button', href: '/contribute/review' }, 'Write a review')));
  main.appendChild(h('p', {}, h('a', { class: 'text-button', href: '/contribute/pay' }, 'Report your pay')));
  main.appendChild(h('p', {}, h('a', { class: 'text-button', href: '/contribute/interview' }, 'Add an interview note')));
  return main;
}

function companyCombobox(onSelect: (company: { id?: string; name: string }) => void): { root: HTMLElement; input: HTMLInputElement; selectedId: () => string | null } {
  let selected: string | null = null;
  const box = combobox({
    label: 'Company',
    value: '',
    fetchOptions: async (text) => {
      const result = await api.get<{ options: { id: string; name: string; city: string }[] }>(
        `/api/companies/options?q=${encodeURIComponent(text)}`,
      );
      return result.options.map((option) => ({ id: option.id, name: option.name }));
    },
    onSelect: (choice) => {
      selected = choice.id ?? null;
      onSelect(choice);
    },
  });
  return {
    root: box.root,
    input: box.input,
    selectedId: () => selected,
  };
}

export function reviewFormPage(ctx: PageContext): HTMLElement {
  const main = h('main', { class: 'narrow' });
  if (!ctx.me) {
    ctx.navigate('/sign-in');
    return main;
  }
  const steps = ['Company', 'Ratings', 'Your review', 'Check and post'];
  let step = 0;
  const state = {
    company_id: null as string | null,
    overall: null as number | null,
    work_life: null as number | null,
    pay: null as number | null,
    management: null as number | null,
    title: '',
    pros: '',
    cons: '',
  };

  const stepsList = h('ul', { role: 'list', 'aria-label': 'Review steps', class: 'steps' });
  const stepHost = h('div', {});

  function renderSteps(): void {
    stepsList.replaceChildren(
      ...steps.map((name, index) =>
        h('li', { 'aria-current': index === step ? 'step' : 'false' }, `${index + 1}. ${name}`),
      ),
    );
  }

  const companyBox = companyCombobox((choice) => {
    state.company_id = choice.id ?? null;
  });

  const ratings = [
    { key: 'overall' as const, label: 'Overall rating' },
    { key: 'work_life' as const, label: 'Work-life balance rating' },
    { key: 'pay' as const, label: 'Pay rating' },
    { key: 'management' as const, label: 'Management rating' },
  ];

  const titleInput = h('input', { type: 'text', id: 'review-title' }) as HTMLInputElement;
  const prosInput = h('textarea', { id: 'review-pros', rows: '4' }) as HTMLTextAreaElement;
  const consInput = h('textarea', { id: 'review-cons', rows: '4' }) as HTMLTextAreaElement;

  function renderStep(): void {
    renderSteps();
    stepHost.replaceChildren();
    const heading = h('h2', { tabindex: '-1' }, `Step ${step + 1} of 4: ${steps[step]}`);
    stepHost.appendChild(heading);
    if (step === 0) {
      stepHost.appendChild(companyBox.root);
    } else if (step === 1) {
      for (const rating of ratings) {
        stepHost.appendChild(
          starRating({
            label: rating.label,
            name: rating.key,
            value: state[rating.key],
            onChange: (value) => {
              state[rating.key] = value;
            },
          }),
        );
      }
    } else if (step === 2) {
      stepHost.appendChild(h('div', { class: 'field-row' }, h('label', { for: 'review-title' }, 'Title'), titleInput));
      stepHost.appendChild(h('div', { class: 'field-row' }, h('label', { for: 'review-pros' }, 'Pros'), prosInput));
      stepHost.appendChild(h('div', { class: 'field-row' }, h('label', { for: 'review-cons' }, 'Cons'), consInput));
    } else {
      stepHost.appendChild(h('p', {}, state.company_id ? `Company: ${companyBox.input.value}` : 'Company: —'));
      stepHost.appendChild(h('p', {}, `Overall: ${state.overall ?? '—'} · Work-life: ${state.work_life ?? '—'} · Pay: ${state.pay ?? '—'} · Management: ${state.management ?? '—'}`));
      stepHost.appendChild(h('p', {}, `Title: ${titleInput.value}`));
      stepHost.appendChild(h('p', {}, `Pros: ${prosInput.value}`));
      stepHost.appendChild(h('p', {}, `Cons: ${consInput.value}`));
    }
    const next = h('button', { class: 'solid-button', type: 'button' }, step === 3 ? 'Post review' : 'Next');
    next.addEventListener('click', async () => {
      if (step === 0) {
        if (!state.company_id || companyBox.input.value.trim().length === 0) {
          alertBand('Choose a company.');
          companyBox.input.focus();
          return;
        }
        step = 1;
        renderStep();
        focusHeading();
        return;
      }
      if (step === 1) {
        const missing = ratings.filter((rating) => state[rating.key] === null);
        if (missing.length > 0) {
          alertBand('Choose a rating from 1 to 5.');
          const first = stepHost.querySelector<HTMLElement>('.star-group');
          (first?.querySelector('input') as HTMLElement | null)?.focus();
          return;
        }
        step = 2;
        renderStep();
        focusHeading();
        return;
      }
      if (step === 2) {
        if (titleInput.value.trim().length < 5) {
          alertBand('Add a title of 5 to 120 characters.');
          titleInput.focus();
          return;
        }
        if (prosInput.value.trim().length < 20) {
          alertBand('Write 20 to 3,000 characters.');
          prosInput.focus();
          return;
        }
        if (consInput.value.trim().length < 20) {
          alertBand('Write 20 to 3,000 characters.');
          consInput.focus();
          return;
        }
        step = 3;
        renderStep();
        focusHeading();
        return;
      }
      try {
        const result = await api.post<{ id: string; label: string }>('/api/posts', {
          kind: 'review',
          company_id: state.company_id,
          overall: state.overall,
          work_life: state.work_life,
          pay: state.pay,
          management: state.management,
          title: titleInput.value,
          pros: prosInput.value,
          cons: consInput.value,
        });
        toast(`Thanks. Your review is waiting for a moderator.`);
        announce('Thanks. Your review is waiting for a moderator.');
        ctx.navigate('/me/contributions');
      } catch (err) {
        if (err instanceof ApiFailure) {
          if (err.body.field) {
            alertBand(err.body.message);
            return;
          }
          alertBand(err.body.message);
        } else {
          alertBand(apiErrorMessage(err));
        }
      }
    });
    stepHost.appendChild(next);
    if (step > 0) {
      const back = h('button', { class: 'text-button', type: 'button' }, 'Back');
      back.addEventListener('click', () => {
        step -= 1;
        renderStep();
        focusHeading();
      });
      stepHost.appendChild(back);
    }
  }

  function focusHeading(): void {
    const heading = stepHost.querySelector<HTMLElement>('h2');
    heading?.focus();
  }

  renderStep();
  main.appendChild(h('h1', {}, 'Write a review'));
  main.appendChild(stepsList);
  main.appendChild(stepHost);
  return main;
}

export function payFormPage(ctx: PageContext): HTMLElement {
  const main = h('main', { class: 'narrow' });
  if (!ctx.me) {
    ctx.navigate('/sign-in');
    return main;
  }
  main.appendChild(h('h1', {}, 'Report your pay'));
  const companyBox = companyCombobox(() => undefined);
  const roleBox = roleCombobox();
  const cityBox = cityCombobox();
  const pay = h('input', { type: 'number', id: 'annual-pay', 'aria-label': 'Annual pay in rupees' }) as HTMLInputElement;
  const years = h('input', { type: 'number', id: 'years', 'aria-label': 'Years of experience' }) as HTMLInputElement;
  const submit = h('button', { class: 'solid-button', type: 'button' }, 'Post pay report');
  submit.addEventListener('click', async () => {
    try {
      const response = await api.post('/api/posts', {
        kind: 'pay_report',
        company_id: companyBox.selectedId(),
        role_family: roleBox.input.value,
        city: cityBox.input.value,
        annual_pay: Number.parseInt(pay.value, 10),
        years_experience: Number.parseInt(years.value, 10),
      });
      void response;
      toast('Thanks. Your pay report is waiting for a moderator.');
      announce('Thanks. Your pay report is waiting for a moderator.');
      ctx.navigate('/me/contributions');
    } catch (err) {
      alertBand(err instanceof ApiFailure ? err.body.message : apiErrorMessage(err));
    }
  });
  main.appendChild(companyBox.root);
  main.appendChild(roleBox.root);
  main.appendChild(cityBox.root);
  main.appendChild(h('div', { class: 'field-row' }, h('label', { for: 'annual-pay' }, 'Annual pay in rupees'), pay));
  main.appendChild(h('div', { class: 'field-row' }, h('label', { for: 'years' }, 'Years of experience'), years));
  main.appendChild(submit);
  return main;
}

export function interviewFormPage(ctx: PageContext): HTMLElement {
  const main = h('main', { class: 'narrow' });
  if (!ctx.me) {
    ctx.navigate('/sign-in');
    return main;
  }
  main.appendChild(h('h1', {}, 'Add an interview note'));
  const companyBox = companyCombobox(() => undefined);
  const roleBox = roleCombobox();
  const difficulty = starRating({
    label: 'Difficulty rating',
    name: 'difficulty',
    value: null,
    onChange: () => undefined,
  });
  const outcomeGroup = h('div', { role: 'radiogroup', 'aria-label': 'Outcome' });
  for (const [index, outcome] of OUTCOMES_CLIENT.entries()) {
    const radio = h('input', { type: 'radio', name: 'outcome', id: `outcome-${index}`, value: outcome.id }) as HTMLInputElement;
    radio.addEventListener('change', () => undefined);
    outcomeGroup.appendChild(h('div', { class: 'field-row' }, radio, h('label', { for: `outcome-${index}` }, outcome.name)));
  }
  const text = h('textarea', { id: 'interview-text', rows: '5', 'aria-label': 'What happened' }) as HTMLTextAreaElement;
  const submit = h('button', { class: 'solid-button', type: 'button' }, 'Post interview note');
  submit.addEventListener('click', async () => {
    const chosenOutcome = outcomeGroup.querySelector<HTMLInputElement>('input:checked');
    const ratingValue = Number.parseInt(difficulty.dataset.value ?? '', 10);
    try {
      await api.post('/api/posts', {
        kind: 'interview_note',
        company_id: companyBox.selectedId(),
        role_family: roleBox.input.value,
        difficulty: Number.isFinite(ratingValue) ? ratingValue : undefined,
        outcome: chosenOutcome?.value,
        text: text.value,
      });
      toast('Thanks. Your interview note is waiting for a moderator.');
      announce('Thanks. Your interview note is waiting for a moderator.');
      ctx.navigate('/me/contributions');
    } catch (err) {
      alertBand(err instanceof ApiFailure ? err.body.message : apiErrorMessage(err));
    }
  });
  main.appendChild(companyBox.root);
  main.appendChild(roleBox.root);
  main.appendChild(difficulty);
  main.appendChild(outcomeGroup);
  main.appendChild(h('div', { class: 'field-row' }, h('label', { for: 'interview-text' }, 'What happened'), text));
  main.appendChild(submit);
  return main;
}

function roleCombobox(): { root: HTMLElement; input: HTMLInputElement } {
  return combobox({
    label: 'Role',
    value: '',
    fetchOptions: async (text) =>
      ROLE_FAMILIES.filter((role) => role.name.toLowerCase().includes(text.toLowerCase())).map((role) => ({
        id: role.id,
        name: role.name,
      })),
    onSelect: (choice) => undefined,
  });
}

function cityCombobox(): { root: HTMLElement; input: HTMLInputElement } {
  return combobox({
    label: 'City',
    value: '',
    fetchOptions: async (text) =>
      CITIES.filter((city) => city.name.toLowerCase().includes(text.toLowerCase())).map((city) => ({
        id: city.id,
        name: city.name,
      })),
    onSelect: (choice) => undefined,
  });
}

