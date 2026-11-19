// The public statement search.

import { el } from '../dom.js';
import { field } from '../dialog.js';
import { pylon } from '../drawings.js';
import { marquee } from '../marquee.js';
import { navigate } from '../router.js';

export function mount({ container }) {
  const code = field({ label: 'Statement code', name: 'code' });
  const submit = el('button', { type: 'button', text: 'Check statement' });
  const go = () => {
    const value = code.input.value.trim();
    if (value) navigate(`/check/${encodeURIComponent(value)}`);
  };
  submit.addEventListener('click', go);
  code.input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') go();
  });
  container.append(
    marquee(),
    el('div', { className: 'panel panel--cyan centred stack' }, [
      el('h1', { text: 'CHECK A STATEMENT.' }),
      el('p', { text: 'Enter the code printed on the attestation.' }),
      code.wrap,
      submit,
      pylon('check__pylon'),
    ])
  );
  return {};
}
