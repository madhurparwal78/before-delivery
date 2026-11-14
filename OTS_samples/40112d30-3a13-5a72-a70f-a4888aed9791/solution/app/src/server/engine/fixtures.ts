import type { ChoiceOption, FormCheck, FormDefinition, Page, Question } from '../../shared/types.ts';
import type { EngineEnv } from './env.ts';

export const env: EngineEnv = { today: '2026-03-16', shuffleSeed: 'nightform-1', formulaMaxChars: 500, formulaMaxDepth: 16 };

export const option = (value: string, label: string = value): ChoiceOption => ({ value, label });

export const numberQuestion = (key: string, label: string, extra: Partial<Question> = {}): Question =>
  ({ key, type: 'number', label, ...extra });

export const textQuestion = (key: string, label: string, extra: Partial<Question> = {}): Question =>
  ({ key, type: 'short_text', label, ...extra });

export const dateQuestion = (key: string, label: string, extra: Partial<Question> = {}): Question =>
  ({ key, type: 'date', label, ...extra });

export const choiceQuestion = (key: string, label: string, values: string[], extra: Partial<Question> = {}): Question =>
  ({ key, type: 'choice', label, options: values.map((value) => option(value)), ...extra });

export const calculatedQuestion = (key: string, label: string, formula: string, extra: Partial<Question> = {}): Question =>
  ({ key, type: 'calculated', label, formula, ...extra });

export const page = (key: string, title: string, questions: Question[], extra: Partial<Page> = {}): Page =>
  ({ key, title, questions, ...extra });

export const form = (pages: Page[], checks: FormCheck[] = []): FormDefinition =>
  ({ title: 'Test form', intro: '', pages, checks });

export const SUPPER: FormDefinition = {
  title: 'Supper club RSVP',
  intro: 'Tell us if you are coming.',
  pages: [
    {
      key: 'about',
      title: 'About you',
      questions: [
        { ...choiceQuestion('attending', 'Are you coming?', ['Yes', 'No']), required: true },
        { key: 'guests', type: 'number', label: 'How many guests?', help: 'Count yourself.', required: false, min: 1, max: 8, decimals: 0 },
      ],
      jumps: [{ name: 'Not attending', when: '{attending} = "No"', to: 'thanks' }],
    },
    {
      key: 'meals',
      title: 'Meals',
      questions: [
        { ...choiceQuestion('meal', 'Main course', ['Vegetarian', 'Fish']), type: 'dropdown', required: true },
        {
          key: 'diet', type: 'short_text', label: 'Which diet?', required: false, max_length: 40,
          show_rule: { name: 'Vegetarian meal', when: '{meal} = "Vegetarian"' },
        },
      ],
    },
    {
      key: 'travel',
      title: 'Travel',
      show_rule: { name: 'Two or more guests', when: '{guests} >= 2' },
      questions: [{ ...choiceQuestion('parking', 'Do you need parking?', ['Yes', 'No']), required: true }],
    },
    {
      key: 'thanks',
      title: 'Anything else',
      questions: [
        { key: 'comment', type: 'long_text', label: 'Anything to add about your {{meal}} meal?', required: false },
      ],
    },
  ],
  checks: [],
};

const money = { places: 2, prefix: '£' };

export const BAKERY: FormDefinition = form([
  page('order', 'Your order', [
    numberQuestion('loaves', 'Loaves', { decimals: 0, min: 0 }),
    numberQuestion('rolls', 'Rolls', { decimals: 0, min: 0 }),
    choiceQuestion('delivery', 'Delivery', ['yes', 'no']),
    numberQuestion('people', 'People sharing', { decimals: 0 }),
    calculatedQuestion('subtotal', 'Subtotal', '{loaves} * 3.35 + {rolls} * 0.45', money),
    calculatedQuestion('discount', 'Discount', 'ROUND(IF({subtotal} >= 20, {subtotal} * 0.125, 0), 2)', money),
    calculatedQuestion('total', 'Total', '{subtotal} - {discount} + IF({delivery} = "yes", 2.5, 0)', money),
    calculatedQuestion('each', 'Each', '{total} / {people}', money),
    calculatedQuestion('margin', 'Margin', '{total} * 0.3', { places: 2, hidden: true }),
    textQuestion('bulk_note', 'Collection time for large orders', { show_rule: { name: 'Large order', when: '{total} >= 20' } }),
    textQuestion('email', 'Your email', { pattern: 'email' }),
  ]),
]);

export const TRIP: FormDefinition = form(
  [page('trip', 'Your trip', [
    dateQuestion('start', 'Start date', { required: true }),
    dateQuestion('end', 'End date', { required: true }),
  ])],
  [{ name: 'Dates in order', page: 'trip', target: 'end', fail_when: '{end} <= {start}', message: 'End date must be after the start date.' }],
);

const percent = (key: string, label: string): Question => numberQuestion(key, label, { required: true, decimals: 1 });

export const BUDGET: FormDefinition = form(
  [page('budget', 'Budget', [
    percent('rent', 'Rent percent'),
    percent('food', 'Food percent'),
    percent('other', 'Other percent'),
    calculatedQuestion('pct_total', 'Percent total', '{rent} + {food} + {other}'),
  ])],
  [{
    name: 'Adds to 100', page: 'budget', target: 'other', fail_when: '{pct_total} <> 100',
    message: 'The percentages must total 100. They total {{pct_total}}.',
  }],
);
