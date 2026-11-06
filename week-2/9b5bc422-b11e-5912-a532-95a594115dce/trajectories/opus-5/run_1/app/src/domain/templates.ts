import type { BlockType } from './types.ts';

export type TemplateBlock = { type: BlockType; text: string; checked?: boolean; indent?: 0 | 1 | 2 };

export type Template = {
  id: string;
  name: string;
  category: 'Journal' | 'Planning' | 'Reading';
  description: string;
  blocks: TemplateBlock[];
};

export const TEMPLATE_CATEGORIES = ['All', 'Journal', 'Planning', 'Reading'] as const;

export const TEMPLATES: Template[] = [
  {
    id: 'daily-note',
    name: 'Daily note',
    category: 'Journal',
    description: 'A short note for one day.',
    blocks: [
      { type: 'heading2', text: 'Today' },
      { type: 'todo', text: 'One thing to finish' },
      { type: 'heading2', text: 'Notes' },
      { type: 'paragraph', text: '' },
    ],
  },
  {
    id: 'weekly-review',
    name: 'Weekly review',
    category: 'Journal',
    description: 'Look back at the week in ten minutes.',
    blocks: [
      { type: 'heading2', text: 'What went well' },
      { type: 'paragraph', text: '' },
      { type: 'heading2', text: 'What to change' },
      { type: 'todo', text: 'Pick one change for next week' },
    ],
  },
  {
    id: 'meeting-notes',
    name: 'Meeting notes',
    category: 'Planning',
    description: 'Who came, what was decided, what is next.',
    blocks: [
      { type: 'heading2', text: 'Who was there' },
      { type: 'bulleted', text: 'Name' },
      { type: 'heading2', text: 'Decisions' },
      { type: 'todo', text: 'Next step' },
    ],
  },
  {
    id: 'trip-plan',
    name: 'Trip plan',
    category: 'Planning',
    description: 'Travel, beds and bookings on one page.',
    blocks: [
      { type: 'heading2', text: 'Getting there' },
      { type: 'heading2', text: 'Where to stay' },
      { type: 'todo', text: 'Book the first night' },
    ],
  },
  {
    id: 'book-notes',
    name: 'Book notes',
    category: 'Reading',
    description: 'Keep the lines and thoughts from a book.',
    blocks: [
      { type: 'heading2', text: 'Why I picked it up' },
      { type: 'quote', text: 'A line worth keeping' },
      { type: 'heading2', text: 'What stays with me' },
    ],
  },
  {
    id: 'reading-list',
    name: 'Reading list',
    category: 'Reading',
    description: 'Books to read next, ticked off as you go.',
    blocks: [
      { type: 'todo', text: 'First book on the list' },
      { type: 'todo', text: 'Second book on the list' },
    ],
  },
];

export const DAILY_NOTE = TEMPLATES[0];
