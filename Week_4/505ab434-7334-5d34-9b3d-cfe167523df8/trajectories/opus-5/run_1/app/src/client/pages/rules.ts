import { getJson } from '../api.js';
import { el } from '../dom.js';

interface RuleRow {
  identifier: string;
  chapter: string;
  text: string;
  version: number;
}

const TITLES: Record<string, string> = {
  logo: 'Logo',
  colour: 'Colour',
  typography: 'Typography',
  iconography: 'Iconography',
  motion: 'Motion',
  voice: 'Voice',
};

export async function renderRuleIndex(main: HTMLElement, navigate: (path: string) => void): Promise<void> {
  const { rules } = await getJson<{ rules: RuleRow[] }>('/api/rules');
  const grouped = new Map<string, RuleRow[]>();
  for (const rule of rules) {
    const bucket = grouped.get(rule.chapter) ?? [];
    bucket.push(rule);
    grouped.set(rule.chapter, bucket);
  }

  main.appendChild(
    el(
      'div',
      { class: 'cell' },
      el('h1', {}, 'Rule index'),
      ...[...grouped.entries()].map(([slug, items]) =>
        el(
          'section',
          { class: 'rule-group' },
          el('h2', {}, TITLES[slug] ?? slug),
          el(
            'ul',
            { class: 'rule-links' },
            ...items.map((rule) =>
              el(
                'li',
                {},
                el(
                  'a',
                  {
                    href: `/rules/${rule.identifier}`,
                    onclick: (event: Event) => {
                      event.preventDefault();
                      navigate(`/rules/${rule.identifier}`);
                    },
                  },
                  rule.identifier,
                ),
                el('span', { class: 'rule-text' }, rule.text),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}
