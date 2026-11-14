// The six capabilities and the seven invented sample forms of the marketing page (brief: Screens and layout).
// Each sample form is drawn from its page structure: how many questions each page holds, and whether the Lit path
// reaches that page for the answers the drawing assumes.

export const CAPABILITIES = ['Branching', 'Formulas', 'Save and resume', 'Live summary', 'Co-editing', 'CSV export'];

export interface SamplePage { questions: number; lit: boolean }
export interface SampleForm { name: string; pages: SamplePage[] }

const page = (questions: number, lit = true): SamplePage => ({ questions, lit });

export const SAMPLE_FORMS: SampleForm[] = [
  { name: 'Allotment waiting list', pages: [page(3), page(2, false), page(2)] },
  { name: 'Choir audition', pages: [page(2), page(4), page(1)] },
  { name: 'Bakery pre-order', pages: [page(11)] },
  { name: 'Supper club RSVP', pages: [page(2), page(2), page(1, false), page(1)] },
  { name: 'Trip dates', pages: [page(2)] },
  { name: 'Household budget', pages: [page(4)] },
  { name: 'Book club sign-up', pages: [page(2), page(3, false), page(1)] },
];
