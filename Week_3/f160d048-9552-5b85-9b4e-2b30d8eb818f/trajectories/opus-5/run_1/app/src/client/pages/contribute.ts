import { CITIES, KIND_LABELS, OUTCOME_LABELS, ROLE_FAMILIES, type PostKind } from '../../shared/reference';
import { announce } from '../core/announce';
import { failureOf, get, post } from '../core/api';
import { el, focus, on } from '../core/dom';
import { navigate, type Cleanup } from '../core/router';
import { clearFieldErrors, fieldError, pageAlert, showToast, working } from '../core/shell';
import { combobox, type Combobox } from '../widgets/combobox';
import { narrowForm } from '../widgets/layout';
import { choiceRadiogroup, starRadiogroup, type ChoiceGroup, type NamedChoiceGroup } from '../widgets/stars';

interface CompanyOption {
  id: string;
  name: string;
  city: string;
}

function companyCombobox(name = 'Company'): Combobox {
  return combobox({
    name,
    listName: 'Company suggestions',
    load: async (query) => {
      const options = await get<{ options: CompanyOption[] }>(`/api/companies/options?q=${encodeURIComponent(query)}`);
      return options.options.map((option) => ({ id: option.id, label: option.name }));
    },
  });
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

function labelled(labelText: string, input: HTMLElement): HTMLElement {
  const id = `field-${labelText.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  input.id = id;
  return el('div', { class: 'field' }, [el('label', { for: id, text: labelText }), input]);
}

function labelledCombobox(labelText: string, combo: Combobox): HTMLElement {
  const id = `field-${labelText.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  combo.input.id = id;
  return el('div', { class: 'field' }, [el('label', { for: id, text: labelText }), combo.element]);
}

function spinbutton(): HTMLInputElement {
  return el('input', { type: 'number', class: 'textbox', inputmode: 'numeric' });
}

function onPosted(kind: PostKind): void {
  const text = `Thanks. Your ${KIND_LABELS[kind]} is waiting for a moderator.`;
  showToast(text);
  announce(text);
  navigate('/me/contributions');
}

function applyFieldErrors(
  form: HTMLElement,
  inputs: Record<string, HTMLElement>,
  error: unknown,
  alert: (m: string | null) => void,
): void {
  const failure = failureOf(error);
  if (!failure) throw error;
  clearFieldErrors(form);
  if (failure.fields && Object.keys(failure.fields).length > 0) {
    let firstInvalid: HTMLElement | null = null;
    for (const [field, message] of Object.entries(failure.fields)) {
      const input = inputs[field];
      if (!input) continue;
      fieldError(input, message);
      firstInvalid = firstInvalid ?? input;
    }
    focus(firstInvalid);
    return;
  }
  if (failure.field && inputs[failure.field]) {
    fieldError(inputs[failure.field] as HTMLElement, failure.message);
    focus(inputs[failure.field]);
    return;
  }
  alert(failure.message);
}

export async function renderContribute(container: HTMLElement): Promise<Cleanup> {
  container.append(
    narrowForm('Share something', [
      el('p', { text: 'One post unlocks full pay and review detail for every lab.' }),
      el('ul', { class: 'plain-list' }, [
        el('li', {}, [el('a', { href: '/contribute/review', text: 'Write a review' })]),
        el('li', {}, [el('a', { href: '/contribute/pay', text: 'Report your pay' })]),
        el('li', {}, [el('a', { href: '/contribute/interview', text: 'Add an interview note' })]),
      ]),
    ]),
  );
  return () => undefined;
}

const STEP_NAMES = ['Company', 'Ratings', 'Your review', 'Check and post'] as const;

export async function renderReviewForm(container: HTMLElement): Promise<Cleanup> {
  const page = el('div', { class: 'narrow-page' });
  container.append(page);
  const alert = pageAlert(page);

  const steps = el('ol', { 'aria-label': 'Review steps', class: 'step-list' });
  const stepItems: HTMLElement[] = [];
  for (const name of STEP_NAMES) {
    const item = el('li', { text: name });
    stepItems.push(item);
    steps.append(item);
  }

  const company = companyCombobox();
  const overall = starRadiogroup('Overall rating');
  const workLife = starRadiogroup('Work-life balance rating');
  const pay = starRadiogroup('Pay rating');
  const management = starRadiogroup('Management rating');
  const title = el('input', { type: 'text', class: 'textbox' });
  const pros = el('textarea', { class: 'textbox', rows: '4' });
  const cons = el('textarea', { class: 'textbox', rows: '4' });

  const ratingGroups: Array<[string, ChoiceGroup]> = [
    ['overall', overall],
    ['work_life', workLife],
    ['pay', pay],
    ['management', management],
  ];

  const heading = el('h1', { tabindex: '-1' });
  const body = el('div', { class: 'step-body' });
  const back = el('button', { type: 'button', class: 'nav-action', text: 'Back' });
  const next = el('button', { type: 'button', class: 'solid-button', text: 'Next' });
  const postButton = el('button', { type: 'button', class: 'solid-button', text: 'Post review' });
  const actions = el('div', { class: 'row' });
  const form = el('form', { class: 'stack' }, [heading, body, actions]);
  page.append(steps, form);

  let step = 1;

  const stepContent = (): Node[] => {
    if (step === 1) return [labelledCombobox('Company', company)];
    if (step === 2) {
      return [
        el('div', { class: 'field' }, [el('span', { class: 'field-label', text: 'Overall rating' }), overall.element]),
        el('div', { class: 'field' }, [
          el('span', { class: 'field-label', text: 'Work-life balance rating' }),
          workLife.element,
        ]),
        el('div', { class: 'field' }, [el('span', { class: 'field-label', text: 'Pay rating' }), pay.element]),
        el('div', { class: 'field' }, [
          el('span', { class: 'field-label', text: 'Management rating' }),
          management.element,
        ]),
      ];
    }
    if (step === 3) return [labelled('Title', title), labelled('Pros', pros), labelled('Cons', cons)];
    return [
      el('p', { text: `Company: ${company.text()}` }),
      el('p', { text: `Title: ${title.value}` }),
      el('p', { text: 'Your review goes to a moderator before it appears.' }),
    ];
  };

  const paint = (moveFocus: boolean): void => {
    heading.textContent = `Step ${step} of 4: ${STEP_NAMES[step - 1]}`;
    for (const [index, item] of stepItems.entries()) {
      if (index === step - 1) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    }
    body.replaceChildren(...stepContent());
    actions.replaceChildren(...(step > 1 ? [back] : []), ...(step < 4 ? [next] : [postButton]));
    if (moveFocus) focus(heading);
  };

  const validateStep = (): HTMLElement | null => {
    clearFieldErrors(form);
    if (step === 1 && !company.selected()) {
      fieldError(company.input, 'Choose a company.');
      return company.input;
    }
    if (step === 2) {
      for (const [, group] of ratingGroups) {
        if (group.value() === null) {
          fieldError(group.element, 'Choose a rating from 1 to 5.');
          return group.firstRadio();
        }
      }
    }
    if (step === 3) {
      const checks: Array<[HTMLElement, boolean, string]> = [
        [
          title,
          title.value.trim().length >= 5 && title.value.trim().length <= 120,
          'Add a title of 5 to 120 characters.',
        ],
        [pros, pros.value.trim().length >= 20 && pros.value.trim().length <= 3000, 'Write 20 to 3,000 characters.'],
        [cons, cons.value.trim().length >= 20 && cons.value.trim().length <= 3000, 'Write 20 to 3,000 characters.'],
      ];
      for (const [input, valid, message] of checks) {
        if (!valid) {
          fieldError(input, message);
          return input;
        }
      }
    }
    return null;
  };

  on(next, 'click', () => {
    const invalid = validateStep();
    if (invalid) {
      focus(invalid);
      return;
    }
    step += 1;
    paint(true);
  });
  on(back, 'click', () => {
    step -= 1;
    paint(true);
  });
  on(postButton, 'click', () => {
    const done = working(postButton);
    void post('/api/posts', {
      kind: 'review',
      company_id: company.selected()?.id ?? '',
      overall: overall.value(),
      work_life: workLife.value(),
      pay: pay.value(),
      management: management.value(),
      title: title.value,
      pros: pros.value,
      cons: cons.value,
    })
      .then(() => onPosted('review'))
      .catch((error: unknown) =>
        applyFieldErrors(
          form,
          {
            company_id: company.input,
            title,
            pros,
            cons,
            overall: overall.element,
            work_life: workLife.element,
            pay: pay.element,
            management: management.element,
          },
          error,
          alert,
        ),
      )
      .finally(done);
  });

  paint(false);
  return () => undefined;
}

export async function renderPayForm(container: HTMLElement): Promise<Cleanup> {
  const page = el('div', { class: 'narrow-page' });
  container.append(page);
  const alert = pageAlert(page);

  const company = companyCombobox();
  const role = fixedCombobox('Role', 'Role suggestions', ROLE_FAMILIES);
  const city = fixedCombobox('City', 'City suggestions', CITIES);
  const annualPay = spinbutton();
  const years = spinbutton();
  const submit = el('button', { type: 'button', class: 'solid-button', text: 'Post pay report' });

  const form = el('form', { class: 'stack' }, [
    labelledCombobox('Company', company),
    labelledCombobox('Role', role),
    labelledCombobox('City', city),
    labelled('Annual pay in rupees', annualPay),
    labelled('Years of experience', years),
    submit,
  ]);
  page.append(el('h1', { text: 'Report your pay' }), form);

  on(submit, 'click', () => {
    const done = working(submit);
    void post('/api/posts', {
      kind: 'pay_report',
      company_id: company.selected()?.id ?? '',
      role_family: role.selected()?.id ?? '',
      city: city.selected()?.id ?? '',
      annual_pay: Number(annualPay.value),
      years_experience: Number(years.value),
    })
      .then(() => onPosted('pay_report'))
      .catch((error: unknown) =>
        applyFieldErrors(
          form,
          {
            company_id: company.input,
            role_family: role.input,
            city: city.input,
            annual_pay: annualPay,
            years_experience: years,
          },
          error,
          alert,
        ),
      )
      .finally(done);
  });
  return () => undefined;
}

export async function renderInterviewForm(container: HTMLElement): Promise<Cleanup> {
  const page = el('div', { class: 'narrow-page' });
  container.append(page);
  const alert = pageAlert(page);

  const company = companyCombobox();
  const role = fixedCombobox('Role', 'Role suggestions', ROLE_FAMILIES);
  const difficulty = starRadiogroup('Difficulty rating');
  const outcome: NamedChoiceGroup = choiceRadiogroup(
    'Outcome',
    (['offer', 'no_offer', 'no_reply'] as const).map((id) => ({ id, label: OUTCOME_LABELS[id] })),
  );
  const text = el('textarea', { class: 'textbox', rows: '5' });
  const submit = el('button', { type: 'button', class: 'solid-button', text: 'Post interview note' });

  const form = el('form', { class: 'stack' }, [
    labelledCombobox('Company', company),
    labelledCombobox('Role', role),
    el('div', { class: 'field' }, [
      el('span', { class: 'field-label', text: 'Difficulty rating' }),
      difficulty.element,
    ]),
    el('div', { class: 'field' }, [el('span', { class: 'field-label', text: 'Outcome' }), outcome.element]),
    labelled('What happened', text),
    submit,
  ]);
  page.append(el('h1', { text: 'Add an interview note' }), form);

  on(submit, 'click', () => {
    const done = working(submit);
    void post('/api/posts', {
      kind: 'interview_note',
      company_id: company.selected()?.id ?? '',
      role_family: role.selected()?.id ?? '',
      difficulty: difficulty.value(),
      outcome: outcome.value(),
      text: text.value,
    })
      .then(() => onPosted('interview_note'))
      .catch((error: unknown) =>
        applyFieldErrors(
          form,
          {
            company_id: company.input,
            role_family: role.input,
            difficulty: difficulty.element,
            outcome: outcome.element,
            text,
          },
          error,
          alert,
        ),
      )
      .finally(done);
  });
  return () => undefined;
}
