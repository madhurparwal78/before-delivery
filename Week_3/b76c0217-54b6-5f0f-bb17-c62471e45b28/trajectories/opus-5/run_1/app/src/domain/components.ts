/** The slash menu's components and the exact snippet each one inserts. */

export interface ComponentSnippet {
  /** The option label in the `Insert component` listbox. */
  label: string;
  /** The snippet text, with U+2038 marking where the caret goes. */
  template: string;
}

export const CARET = '\u2038';

export const SNIPPETS: readonly ComponentSnippet[] = [
  {
    label: 'Callout',
    template: ['<Callout type="note">', CARET, '</Callout>'].join('\n'),
  },
  {
    label: 'Tabs',
    template: [
      '<Tabs>',
      '<Tab title="First">',
      CARET,
      '</Tab>',
      '<Tab title="Second">',
      '',
      '</Tab>',
      '</Tabs>',
    ].join('\n'),
  },
  {
    label: 'Code group',
    template: [
      '<CodeGroup>',
      '```bash Shell',
      CARET,
      '```',
      '```js JavaScript',
      '',
      '```',
      '</CodeGroup>',
    ].join('\n'),
  },
  {
    label: 'Steps',
    template: ['<Steps>', '<Step title="First step">', CARET, '</Step>', '</Steps>'].join('\n'),
  },
  {
    label: 'Accordion',
    template: ['<Accordion title="Question">', CARET, '</Accordion>'].join('\n'),
  },
  {
    label: 'Cards',
    template: ['<Cards>', `<Card title="Title" href="/${CARET}">`, '</Card>', '</Cards>'].join('\n'),
  },
];
