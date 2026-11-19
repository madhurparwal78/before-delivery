/** The four starter templates, in the order the New layout dialog lists them. */
export const TEMPLATE_CHOICES = [
  { name: 'blank', label: 'Blank' },
  { name: 'holy-grail', label: 'Holy Grail' },
  { name: 'dashboard-shell', label: 'Dashboard Shell' },
  { name: 'magazine-spread', label: 'Magazine Spread' },
] as const;

export type TemplateName = (typeof TEMPLATE_CHOICES)[number]['name'];

export const isTemplateName = (value: unknown): value is TemplateName => TEMPLATE_CHOICES.some((choice) => choice.name === value);
