export const badPathMessage = 'Paths use letters, digits, hyphens and underscores, separated by /.';

const SEGMENT = /^[A-Za-z0-9_-]{1,60}$/;

export const MAX_PAGE_SOURCE_BYTES = 200000;
export const MAX_IMAGE_BYTES = 5000000;
export const MAX_OPENAPI_BYTES = 1000000;
export const MAX_JSON_BYTES = 1000000;

export function isValidPath(p: string): boolean {
  if (p.startsWith('/') || p.endsWith('/')) return false;
  const segments = p.split('/');
  if (segments.length < 1 || segments.length > 5) return false;
  return segments.every((s) => SEGMENT.test(s));
}

export function isValidSlug(p: string): boolean {
  return SEGMENT.test(p) && p.length <= 60;
}

export function normalizePath(p: string): string {
  return p.replace(/^\/+/, '').replace(/\/+$/, '');
}

export function withLeadingSlash(p: string): string {
  return p.startsWith('/') ? p : `/${p}`;
}

export function anchorFor(headingText: string): string {
  const lowered = headingText.toLowerCase();
  let slug = '';
  let lastDash = false;
  for (const ch of lowered) {
    if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) {
      slug += ch;
      lastDash = false;
    } else if (!lastDash) {
      slug += '-';
      lastDash = true;
    }
  }
  slug = slug.replace(/^-+|-+$/g, '');
  return slug === '' ? 'section' : slug;
}

export function assignAnchors(headings: { text: string; level: number }[]): (string | null)[] {
  const counts = new Map<string, number>();
  return headings.map((h) => {
    if (h.level !== 2 && h.level !== 3) return null;
    const base = anchorFor(h.text);
    const n = counts.get(base) ?? 0;
    counts.set(base, n + 1);
    return n === 0 ? base : `${base}-${n + 1}`;
  });
}

export const COMPONENT_NAMES = ['Callout', 'Tabs', 'CodeGroup', 'Steps', 'Accordion', 'Cards'] as const;
export type ComponentName = (typeof COMPONENT_NAMES)[number];
export const RENDERED_COMPONENTS = ['callout', 'tabs', 'code-group', 'steps', 'accordion', 'cards'] as const;

export const SNIPPETS: Record<ComponentName, string[]> = {
  Callout: ['<Callout type="note">', '‸', '</Callout>'],
  Tabs: ['<Tabs>', '<Tab title="First">', '‸', '</Tab>', '<Tab title="Second">', '', '</Tab>', '</Tabs>'],
  CodeGroup: ['<CodeGroup>', '```bash Shell', '‸', '```', '```js JavaScript', '', '```', '</CodeGroup>'],
  Steps: ['<Steps>', '<Step title="First step">', '‸', '</Step>', '</Steps>'],
  Accordion: ['<Accordion title="Question">', '‸', '</Accordion>'],
  Cards: ['<Cards>', '<Card title="Title" href="/‸">', '</Card>', '</Cards>'],
};

export const COMPONENT_MENU_ITEMS: { name: ComponentName; label: string }[] = [
  { name: 'Callout', label: 'Callout' },
  { name: 'Tabs', label: 'Tabs' },
  { name: 'CodeGroup', label: 'Code group' },
  { name: 'Steps', label: 'Steps' },
  { name: 'Accordion', label: 'Accordion' },
  { name: 'Cards', label: 'Cards' },
];
