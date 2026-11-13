import { html, useState, useEffect } from '../lib/html.js';
import { Empty } from '../lib/ui.js';
import { plural } from '../lib/format.js';
import { listAll, byName } from './service/data.js';

export default function Policies() {
  const [policies, setPolicies] = useState(null);
  useEffect(() => {
    listAll('/api/policies').then((items) => setPolicies(items ? [...items].sort(byName) : []));
  }, []);
  if (!policies) return html`<h1 class="page-label">Policies</h1>`;
  return html`<section class="policies">
    <h1 class="page-label">Policies</h1>
    <p class="figure">${policies.length}</p>
    ${policies.length === 0
      ? html`<${Empty}>No policies yet.</${Empty}>`
      : html`<ul class="policy-rows" aria-label="Policy list">${policies.map(
        (p) => html`<li key=${p.id}>
          <a class="policy-row" href=${'/policies/' + p.id}>
            <span class="policy-name">${p.name}</span>
            <span class="policy-meta">${plural(p.levels.length, 'level', 'levels')}, repeats ${p.repeats}</span>
          </a>
        </li>`,
      )}</ul>`}
  </section>`;
}
