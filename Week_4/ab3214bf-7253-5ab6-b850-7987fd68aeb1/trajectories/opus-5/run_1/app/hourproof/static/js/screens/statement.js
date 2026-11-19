// The public statement: the scores, the opinion and whether the signature holds.

import { get } from '../api.js';
import { announce, el, liveRegion } from '../dom.js';
import { commas, percent } from '../format.js';
import { marquee } from '../marquee.js';
import { linkTo } from '../router.js';

function line(label, value) {
  return el('p', {}, [el('strong', { text: `${label} ` }), el('span', { text: value })]);
}

export async function mount({ container, params }) {
  const code = params[0];
  const seal = liveRegion('Seal status', 'status');
  const panel = el('div', { className: 'panel panel--cyan stack' });
  const side = el('div', { className: 'panel panel--white stack' });
  container.append(
    marquee(),
    el('div', { className: 'statement-grid' }, [panel, side]),
    seal
  );
  const answer = await get(`/api/public/statements/${encodeURIComponent(code)}`);
  if (answer.status === 404) {
    panel.append(el('h1', { text: 'NO STATEMENT HAS THAT CODE.' }));
    return {};
  }
  if (answer.status === 503) {
    panel.append(
      el('div', { className: 'outage', text: 'THE STORE IS DOWN. TRY THIS CHECK AGAIN.' })
    );
    return {};
  }
  const statement = answer.data;
  const result = el(
    'div',
    { role: 'region', 'aria-label': 'Statement result', className: 'stack' },
    [
      el('h1', { text: statement.site_name }),
      el('span', {
        className: 'panel__figure',
        text: `${percent(statement.scores.hour_bp)}%`,
      }),
      line('Code', statement.code),
      line('Site', statement.site_name),
      line('Month', statement.month),
      line('Month score', `${percent(statement.scores.month_bp)}%`),
      line('Week score', `${percent(statement.scores.week_bp)}%`),
      line('Day score', `${percent(statement.scores.day_bp)}%`),
      line('Hour score', `${percent(statement.scores.hour_bp)}%`),
      line('Opinion', statement.opinion),
      line('Verifier firm', statement.firm_name),
      line('State', statement.state),
      el('p', {
        className: 'word',
        text: statement.signature_valid ? 'SIGNATURE HOLDS.' : 'SIGNATURE DOES NOT HOLD.',
      }),
    ]
  );
  panel.append(result);
  if (statement.state === 'Restated') {
    panel.append(
      el('div', {
        className: 'outage',
        text: `RESTATED. SEE THE SUCCESSOR WINDOW. ${statement.successor_window_id}`,
      })
    );
  }
  const download = el('a', {
    href: statement.pdf_url,
    text: 'Download attestation PDF',
    className: 'button',
  });
  side.append(
    el('h3', { text: 'THE SIGNED FILE.' }),
    line('Consumed', `${commas(statement.consumed_wh)} Wh`),
    line('Hour matched', `${commas(statement.hour_matched_wh)} Wh`),
    line('Allocation digest', statement.allocation_digest),
    line('Signing key', statement.key_id),
    download
  );
  if (statement.successor_statement_code) {
    side.append(
      linkTo(`/check/${statement.successor_statement_code}`, 'Open the successor statement')
    );
  }
  if (window.sessionStorage.getItem('hourproof-sealed') === statement.code) {
    window.sessionStorage.removeItem('hourproof-sealed');
    announce('Seal status', `Sealed. Statement ${statement.code} is live.`);
  }
  return {};
}
