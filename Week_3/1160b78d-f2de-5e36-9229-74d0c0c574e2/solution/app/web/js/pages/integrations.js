// /integrations: the list of integrations, then the dead letters of the whole firm.
import { html, useState, useEffect, useRef, useCallback } from '../lib/html.js';
import { useReveal } from '../lib/reveal.js';
import { api } from '../lib/api.js';
import { live } from '../lib/live.js';
import { Empty } from '../lib/ui.js';
import { DeadLetters } from './integration/dead-letters.js';

const REFETCH_DELAY_MS = 80;

export default function Integrations() {
  const [items, setItems] = useState(null);
  const [services, setServices] = useState(new Map());
  const [letters, setLetters] = useState(null);
  const timer = useRef(null);
  const lettersTitle = useRef(null);
  const [ready, loaded] = useReveal(1);

  const load = useCallback(async () => {
    const [list, dead, all] = await Promise.all([api.get('/api/integrations'), api.get('/api/dead-letters'), api.get('/api/services')]);
    if (list.ok) setItems(list.data.items);
    if (all.ok) setServices(new Map(all.data.items.map((service) => [service.id, service.name])));
    loaded('first');
    if (dead.ok) {
      setLetters(dead.data.items);
      requestAnimationFrame(() => {
        if (document.activeElement === document.body && lettersTitle.current) lettersTitle.current.focus();
      });
    }
  }, []);

  useEffect(() => {
    load();
    const off = live.on('integration', () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(load, REFETCH_DELAY_MS);
    });
    return () => {
      off();
      clearTimeout(timer.current);
    };
  }, []);

  const serviceOf = (item) => item.service?.name ?? item.service_name ?? services.get(item.service_id) ?? '';
  const integrationFor = (letter) => items?.find((item) => item.id === letter.integration_id || (letter.routing_key && item.routing_key === letter.routing_key));
  const waiting = (item) => (letters ?? []).filter((letter) => integrationFor(letter) === item).length;

  return html`<div class=${ready ? 'integrations' : 'integrations pending'}>
    <h1>Integrations</h1>
    <section class="block">
      <h2>Monitors</h2>
      ${items && !items.length ? html`<${Empty}>No integrations yet.</${Empty}>` : null}
      ${items && items.length ? html`<div class="table-scroll" tabindex="0" role="region" aria-label="Integrations table">
        <table aria-label="Integrations">
          <thead><tr><th scope="col">Name</th><th scope="col">Service</th><th scope="col">Routing key</th><th scope="col">Dead letters</th></tr></thead>
          <tbody>${items.map((item) => html`<tr key=${item.id}>
            <td data-label="Name"><a href=${`/integrations/${item.id}`}>${item.name}</a></td>
            <td data-label="Service">${serviceOf(item)}</td>
            <td class="mono" data-label="Routing key">${item.routing_key}</td>
            <td data-label="Dead letters">${letters ? waiting(item) : ''}</td>
          </tr>`)}</tbody>
        </table>
      </div>` : null}
    </section>
    <section class="block">
      <h2 tabindex="-1" ref=${lettersTitle}>Dead letters</h2>
      ${letters ? html`<${DeadLetters} items=${letters} onChanged=${load}
        integrationOf=${(letter) => {
          const found = integrationFor(letter);
          return found ? html`<a href=${`/integrations/${found.id}`}>${found.name}</a>` : html`<span class="mono">${letter.routing_key ?? ''}</span>`;
        }} />` : null}
    </section>
  </div>`;
}
