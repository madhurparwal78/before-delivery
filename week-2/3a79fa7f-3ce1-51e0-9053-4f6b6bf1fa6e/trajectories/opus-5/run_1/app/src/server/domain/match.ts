import { failValidation } from '../errors.js';
import { BOARD_ORDER, type BoardName } from './catalog.js';

export interface QuizOption {
  key: string;
  label: string;
  points: Record<BoardName, number>;
}

export interface QuizQuestion {
  number: number;
  text: string;
  options: QuizOption[];
}

function option(key: string, label: string, drift: number, crest: number, swift: number): QuizOption {
  return { key, label, points: { Drift: drift, Crest: crest, Swift: swift } };
}

export const QUIZ: readonly QuizQuestion[] = [
  {
    number: 1,
    text: 'How much have you foiled?',
    options: [
      option('never', 'Never', 3, 0, 0),
      option('foiled', 'I have foiled without a motor', 0, 1, 3),
      option('powered', 'I have ridden an eFoil', 0, 2, 1),
    ],
  },
  {
    number: 2,
    text: 'Where will you ride?',
    options: [
      option('calm', 'Calm water', 2, 1, 0),
      option('swell', 'Ocean swell', 0, 1, 2),
      option('mixed', 'A bit of both', 0, 2, 0),
    ],
  },
  {
    number: 3,
    text: 'What matters most?',
    options: [
      option('stability', 'Stability', 2, 0, 0),
      option('range', 'Range', 0, 3, 0),
      option('lightness', 'Light weight', 0, 0, 3),
    ],
  },
  {
    number: 4,
    text: 'What is your budget?',
    options: [
      option('under-12k', 'Under $12k', 3, 0, 0),
      option('12k-14k', '$12k to $14k', 0, 0, 2),
      option('any', 'Whatever it takes', 0, 2, 0),
    ],
  },
  {
    number: 5,
    text: 'What do you weigh?',
    options: [
      option('under-70', 'Under 70 kg', 0, 0, 1),
      option('70-90', '70 to 90 kg', 0, 1, 0),
      option('over-90', 'Over 90 kg', 1, 1, 0),
    ],
  },
];

export interface MatchOutcome {
  answers: string[];
  recommended: BoardName;
  scores: Record<BoardName, number>;
  reasons: number[];
}

export function scoreAnswers(raw: unknown): MatchOutcome {
  if (!Array.isArray(raw) || raw.length !== 5) failValidation({ answers: 'Answer all five questions.' });
  const chosen: QuizOption[] = [];
  for (let i = 0; i < 5; i += 1) {
    const question = QUIZ[i];
    if (!question) throw new Error('Quiz is incomplete');
    const found = question.options.find((o) => o.key === raw[i]);
    if (!found) failValidation({ answers: 'Answer all five questions.' });
    chosen.push(found);
  }

  const scores: Record<BoardName, number> = { Drift: 0, Crest: 0, Swift: 0 };
  for (const o of chosen) for (const board of BOARD_ORDER) scores[board] += o.points[board];

  let recommended: BoardName = 'Drift';
  for (const board of BOARD_ORDER) {
    if (scores[board] > scores[recommended]) recommended = board;
  }

  const ranked = chosen
    .map((o, index) => ({ number: index + 1, points: o.points[recommended] }))
    .sort((a, b) => (b.points !== a.points ? b.points - a.points : a.number - b.number));

  return {
    answers: chosen.map((o) => o.key),
    recommended,
    scores,
    reasons: ranked.slice(0, 2).map((r) => r.number),
  };
}

