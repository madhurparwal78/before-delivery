// A finding's panel, paint band and severity, as the card, the travelling card and the owner's
// finding list all show them.

import { el, setText } from '../dom.js';
import { bandClass } from '../format.js';

export function fillFindingMeta(
  line: HTMLElement,
  finding: { panelLabel: string; band: string; severity: string },
): void {
  if (!line.firstChild) {
    line.append(
      el('span', { class: 'meta-panel' }), ' · ',
      el('span', { class: 'meta-band' }), ' · ',
      el('span', { class: 'meta-severity' }),
    );
  }
  const [panel, band, severity] = [...line.children] as HTMLElement[];
  setText(panel, finding.panelLabel);
  setText(band, finding.band);
  band.className = `meta-band ${bandClass(finding.band)}`;
  setText(severity, finding.severity);
  severity.className = 'meta-severity';
}
