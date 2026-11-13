// Rules the browser and the server both apply to text, decided here once.

export const timers = {
  autosave: 800,
  searchDebounce: 150,
  searchRecord: 1000,
  drawer: 200,
  accordion: 150,
  theme: 200,
  spliceStrike: 240,
  spliceSet: 420,
  spliceStagger: 18,
  spliceFile: 320,
  spliceCount: 600,
  noticeFade: 4000,
} as const;

export const limits = {
  json: 1_000_000,
  image: 5_000_000,
  openapi: 1_000_000,
  source: 200_000,
} as const;

const SEGMENT = /^[A-Za-z0-9_-]{1,60}$/;

/** A page path: 1 to 5 segments of letters, digits, hyphens and underscores, no leading or trailing slash. */
export function isPagePath(path: string): boolean {
  const segments = path.split('/');
  return segments.length >= 1 && segments.length <= 5 && segments.every((segment) => SEGMENT.test(segment));
}

/** A one-segment slug (site, version). */
export function isSlug(slug: string): boolean {
  return SEGMENT.test(slug);
}

/** The anchor of a heading: lower-case, runs of anything but a-z and 0-9 become one hyphen, trimmed. */
export function anchorOf(headingText: string): string {
  const anchor = headingText
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return anchor === '' ? 'section' : anchor;
}

const markedSnippets: [string, string][] = [
  ['Callout', '<Callout type="note">\n\u2038\n</Callout>'],
  ['Tabs', '<Tabs>\n<Tab title="First">\n\u2038\n</Tab>\n<Tab title="Second">\n\n</Tab>\n</Tabs>'],
  ['Code group', '<CodeGroup>\n```bash Shell\n\u2038\n```\n```js JavaScript\n\n```\n</CodeGroup>'],
  ['Steps', '<Steps>\n<Step title="First step">\n\u2038\n</Step>\n</Steps>'],
  ['Accordion', '<Accordion title="Question">\n\u2038\n</Accordion>'],
  ['Cards', '<Cards>\n<Card title="Title" href="/\u2038">\n</Card>\n</Cards>'],
];

/** The snippets the slash menu inserts; `caret` is where the caret goes (the marked spot, which is not inserted). */
export const SNIPPETS: { name: string; text: string; caret: number }[] = markedSnippets.map(([name, marked]) => ({
  name,
  text: marked.replace('\u2038', ''),
  caret: marked.indexOf('\u2038'),
}));
