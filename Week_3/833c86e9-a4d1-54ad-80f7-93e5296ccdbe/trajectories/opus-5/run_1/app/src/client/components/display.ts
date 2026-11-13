import { el } from '../dom';
import { t } from '../i18n';

/** `radiogroup "Price display"` with `switch "Include taxes"`. */
export function displayControls(
  params: URLSearchParams,
  apply: (next: URLSearchParams) => void,
): HTMLElement {
  const display = params.get('display') ?? 'total';
  const group = el('div', { role: 'radiogroup', 'aria-label': t('ui.price_display'), class: 'display-controls' });
  for (const [value, label] of [
    ['night', t('ui.per_night')],
    ['total', t('ui.total')],
  ]) {
    const radio = el(
      'button',
      {
        type: 'button',
        role: 'radio',
        'aria-checked': display === value ? 'true' : 'false',
        'data-focus-key': `display:${value}`,
      },
      [label],
    );
    radio.addEventListener('click', () => {
      const next = new URLSearchParams(params);
      if (value === 'total') next.delete('display');
      else next.set('display', value);
      apply(next);
    });
    group.append(radio);
  }
  const taxes = el(
    'button',
    {
      type: 'button',
      role: 'switch',
      'aria-checked': params.get('tax') === '0' ? 'false' : 'true',
      'aria-label': t('ui.include_taxes'),
      'data-focus-key': 'display:tax',
    },
    [t('ui.include_taxes')],
  );
  taxes.addEventListener('click', () => {
    const next = new URLSearchParams(params);
    if (next.get('tax') === '0') next.delete('tax');
    else next.set('tax', '0');
    apply(next);
  });
  return el('div', { class: 'controls-row' }, [group, taxes]);
}
