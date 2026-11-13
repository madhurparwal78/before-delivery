import { html, useState, useEffect } from '../lib/html.js';
import { live } from '../lib/live.js';
import { fmtLocal, plural } from '../lib/format.js';
import { Empty, Tone } from '../lib/ui.js';
import { listAll, byName, windowState, FIRM_ZONE } from './service/data.js';
import { ServiceTree } from './service/tree.js';

export default function Services() {
  const [data, setData] = useState(null);
  useEffect(() => {
    let latest = 0;
    const load = async () => {
      const mine = ++latest;
      const [services, windows] = await Promise.all([listAll('/api/services'), listAll('/api/maintenance-windows')]);
      if (mine === latest && services && windows) setData({ services, windows });
    };
    load();
    return live.on('status', load);
  }, []);

  if (!data) return html`<h1 class="page-label">Services</h1>`;
  const { services, windows } = data;
  const names = new Map(services.map((s) => [s.id, s.name]));
  const affected = services.filter((s) => s.status !== 'Operational').length;
  const running = windows.filter((w) => windowState(w) === 'running' && names.has(w.service_id));
  return html`<section class="services">
    <h1 class="page-label">Services</h1>
    <p class="figure">${affected}</p>
    <p class="figure-label">${`affected of ${plural(services.length, 'service', 'services')}`}</p>
    <div role="status" aria-label="Maintenance banner" class="banners">${running.map(
      (w) => html`<p key=${w.id} class="banner">${`Maintenance on ${names.get(w.service_id)} until ${fmtLocal(w.ends_at, FIRM_ZONE)}`}</p>`,
    )}</div>
    ${services.length === 0
      ? html`<${Empty}>No services yet.</${Empty}>`
      : html`<${ServiceTree} services=${services} />
        <h2 class="settings-title">Settings</h2>
        <ul class="settings-rows" aria-label="Service settings">${[...services].sort(byName).map(
          (s) => html`<li key=${s.id}><a class="settings-row" href=${'/services/' + s.id}>
            <span class="settings-name">${s.name}</span><span class="settings-team">${s.team}</span><${Tone} status=${s.status} />
          </a></li>`,
        )}</ul>`}
  </section>`;
}
