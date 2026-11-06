/** The header and footer shared by the public screens. */
import { element } from './dom';
import { BOARD_COPY } from './copy';

export function siteHeader(): HTMLElement {
  return element('header', {
    className: 'site-header',
    children: [
      element('p', { className: 'site-company', text: 'Vellichor Holdings, Inc.' }),
      element('p', { className: 'site-wordmark', text: 'Tracewell' }),
      element('p', { className: 'site-ticker', text: 'Nasdaq: VLCH' }),
      element('a', {
        className: 'site-staff-link',
        text: 'Staff sign in',
        attributes: { href: '/staff' },
      }),
    ],
  });
}

export function siteFooter(): HTMLElement {
  return element('footer', {
    className: 'site-footer',
    children: [element('p', { text: BOARD_COPY.footer })],
  });
}
