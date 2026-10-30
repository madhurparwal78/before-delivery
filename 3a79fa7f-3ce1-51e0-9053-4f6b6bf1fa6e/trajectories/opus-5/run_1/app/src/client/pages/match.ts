import { get, post } from '../api.js';
import { el, svgIcon, uniqueId } from '../dom.js';
import { announce, reducedMotion } from '../ui.js';
import type { MatchResult } from '../types.js';

interface QuizOption {
  key: string;
  label: string;
}

interface QuizQuestion {
  text: string;
  options: QuizOption[];
}

const QUIZ: QuizQuestion[] = [
  {
    text: 'How much have you foiled?',
    options: [
      { key: 'never', label: 'Never' },
      { key: 'foiled', label: 'I have foiled without a motor' },
      { key: 'powered', label: 'I have ridden an eFoil' },
    ],
  },
  {
    text: 'Where will you ride?',
    options: [
      { key: 'calm', label: 'Calm water' },
      { key: 'swell', label: 'Ocean swell' },
      { key: 'mixed', label: 'A bit of both' },
    ],
  },
  {
    text: 'What matters most?',
    options: [
      { key: 'stability', label: 'Stability' },
      { key: 'range', label: 'Range' },
      { key: 'lightness', label: 'Light weight' },
    ],
  },
  {
    text: 'What is your budget?',
    options: [
      { key: 'under-12k', label: 'Under $12k' },
      { key: '12k-14k', label: '$12k to $14k' },
      { key: 'any', label: 'Whatever it takes' },
    ],
  },
  {
    text: 'What do you weigh?',
    options: [
      { key: 'under-70', label: 'Under 70 kg' },
      { key: '70-90', label: '70 to 90 kg' },
      { key: 'over-90', label: 'Over 90 kg' },
    ],
  },
];

const RIDER_KG: Record<string, number> = { 'under-70': 65, '70-90': 80, 'over-90': 95 };
const FIRST_SKU: Record<string, string> = { Drift: 'DR-49', Crest: 'CR-52', Swift: 'SW-43' };

interface QuizState {
  step: number;
  answers: string[];
}

function readState(): QuizState {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('answers') ?? '';
  const answers: string[] = [];
  for (const key of raw.split(',').filter((value) => value.length > 0)) {
    const question = QUIZ[answers.length];
    if (!question || !question.options.some((option) => option.key === key)) return { step: 1, answers: [] };
    answers.push(key);
  }
  const step = Number(params.get('step') ?? '1');
  if (!Number.isInteger(step) || step < 1 || step > 5 || step > answers.length + 1) return { step: 1, answers: [] };
  return { step, answers };
}

function addressFor(state: QuizState): string {
  const params = new URLSearchParams();
  params.set('step', String(state.step));
  if (state.answers.length > 0) params.set('answers', state.answers.join(','));
  return `/match?${params.toString()}`;
}

export function renderMatch(main: HTMLElement): void {
  const panel = el('div', { class: 'card quiz-panel' });
  const page = el('section', { class: 'band wrap' }, [panel]);
  main.replaceChildren(page);

  let state = readState();
  let currentStep: HTMLElement | null = null;

  const paintResult = async (id: string): Promise<void> => {
    const result = await get<MatchResult>(`/api/match/${encodeURIComponent(id)}`);
    panel.replaceChildren();
    if (!result.ok) {
      panel.append(
        el('h1', {}, 'We could not find that match.'),
        el('a', { href: '/match', class: 'btn btn-secondary' }, 'Retake'),
      );
      return;
    }
    const match = result.body;
    panel.append(
      el('h1', {}, `Your match: ${match.recommended}`),
      el('div', { class: 'stack' }, ['Drift', 'Crest', 'Swift'].map((board) => el('p', { style: 'margin:0' }, `${board}: ${match.scores[board] ?? 0} points`))),
      el('div', { class: 'stack', style: 'margin-top:1rem' }, match.reasons.map((number) => el('p', { style: 'margin:0' }, `Question ${number}: ${QUIZ[number - 1]?.text ?? ''}`))),
      el('div', { class: 'row', style: 'margin-top:1.25rem' }, [
        el(
          'a',
          {
            href: `/build?board=${FIRST_SKU[match.recommended] ?? 'DR-49'}&rider=${RIDER_KG[match.answers[4] ?? '70-90'] ?? 80}`,
            class: 'btn',
          },
          ['Build this board', svgIcon('arrow')],
        ),
        el('a', { href: '/match', class: 'btn btn-secondary' }, 'Retake'),
      ]),
    );
    (panel.querySelector('h1') as HTMLElement).focus();
  };

  const paintStep = (direction: 'forward' | 'back' | 'none'): void => {
    const question = QUIZ[state.step - 1]!;
    const groupId = uniqueId('quiz-group');
    const heading = el('h1', { tabindex: '-1' }, `Question ${state.step} of 5`);
    const chosen = state.answers[state.step - 1];

    const radios = question.options.map((option) => {
      const id = uniqueId('quiz-option');
      const input = el('input', {
        type: 'radio',
        name: groupId,
        id,
        value: option.key,
        checked: chosen === option.key,
      });
      input.addEventListener('change', () => {
        const answers = state.answers.slice(0, state.step - 1);
        answers.push(option.key);
        state = { step: state.step, answers };
        window.history.replaceState({}, '', addressFor(state));
        next.disabled = false;
      });
      const wrapper = el('div', { class: `option${chosen === option.key ? ' option-selected' : ''}` }, [
        input,
        el('label', { for: id, class: 'option-body' }, el('span', { class: 'option-name' }, option.label)),
      ]);
      input.addEventListener('change', () => {
        for (const sibling of group.querySelectorAll('.option')) sibling.classList.remove('option-selected');
        wrapper.classList.add('option-selected');
      });
      return wrapper;
    });

    const group = el('div', { role: 'radiogroup', 'aria-label': question.text, class: 'stack' }, radios);

    const back = el('button', { class: 'btn btn-secondary', type: 'button', disabled: state.step === 1 }, 'Back');
    const next = el(
      'button',
      { class: 'btn', type: 'button', disabled: chosen === undefined },
      state.step === 5 ? 'See my match' : 'Next',
    );

    back.addEventListener('click', () => {
      if (state.step === 1) return;
      state = { step: state.step - 1, answers: state.answers };
      window.history.pushState({}, '', addressFor(state));
      paintStep('back');
    });

    next.addEventListener('click', async () => {
      if (state.step < 5) {
        state = { step: state.step + 1, answers: state.answers };
        window.history.pushState({}, '', addressFor(state));
        paintStep('forward');
        return;
      }
      next.disabled = true;
      next.textContent = 'Scoring...';
      announce('Scoring...');
      const result = await post<MatchResult>('/api/match', { answers: state.answers });
      next.disabled = false;
      next.textContent = 'See my match';
      if (!result.ok) return;
      window.history.pushState({}, '', `/match?result=${result.body.id}`);
      await paintResult(result.body.id);
    });

    const step = el('div', { class: 'quiz-step' }, [
      heading,
      el('p', { style: 'font-size:1.2rem' }, question.text),
      group,
      el('div', { class: 'quiz-actions' }, [back, next]),
    ]);

    const settle = (): void => {
      panel.replaceChildren(step);
      currentStep = step;
      if (!reducedMotion() && direction !== 'none') {
        step.classList.add(direction === 'forward' ? 'entering-forward' : 'entering-back');
        window.setTimeout(() => step.classList.remove('entering-forward', 'entering-back'), 320);
      }
      heading.focus();
      announce(`Question ${state.step} of 5. ${question.text}`);
    };

    if (currentStep && !reducedMotion() && direction !== 'none') {
      currentStep.classList.add(direction === 'forward' ? 'leaving-forward' : 'leaving-back');
      window.setTimeout(settle, 200);
    } else settle();
  };

  const paint = (): void => {
    const params = new URLSearchParams(window.location.search);
    const resultId = params.get('result');
    if (resultId) {
      currentStep = null;
      void paintResult(resultId);
      return;
    }
    const parsed = readState();
    const bad = parsed.step === 1 && parsed.answers.length === 0 && window.location.search !== '' && window.location.search !== '?step=1';
    state = parsed;
    if (bad) window.history.replaceState({}, '', '/match');
    paintStep('none');
  };

  window.addEventListener('popstate', paint);
  paint();
}
