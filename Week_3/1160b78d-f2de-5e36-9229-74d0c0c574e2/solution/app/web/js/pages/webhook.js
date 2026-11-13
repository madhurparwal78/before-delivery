// /webhooks/<id>: one endpoint with every recent delivery and its attempts.
import { html, useState, useEffect } from '../lib/html.js';
import { api } from '../lib/api.js';
import { boot } from '../lib/boot.js';
import { EndpointSection } from './webhook/section.js';

const DETAIL_DELIVERIES = 50;

export default function Webhook() {
  const id = boot.params.id;
  const [endpoint, setEndpoint] = useState(null);
  const [services, setServices] = useState(new Map());
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    (async () => {
      const [list, all] = await Promise.all([api.get('/api/webhooks'), api.get('/api/services')]);
      if (all.ok) setServices(new Map(all.data.items.map((service) => [service.id, service.name])));
      const found = list.ok ? list.data.items.find((item) => item.id === id) : null;
      if (found) setEndpoint(found);
      else setMissing(true);
    })();
  }, [id]);

  if (missing) return html`<p class="sentence">We could not find that page.</p>`;
  if (!endpoint) return html`<div class="webhook"></div>`;
  return html`<div class="webhook">
    <p class="back"><a href="/webhooks">All endpoints</a></p>
    <${EndpointSection} endpoint=${endpoint} services=${services} limit=${DETAIL_DELIVERIES} titleLevel="h1" linked=${false} />
  </div>`;
}
