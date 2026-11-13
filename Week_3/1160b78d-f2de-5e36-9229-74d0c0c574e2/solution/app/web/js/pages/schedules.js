// /schedules: every schedule, each linking to its page.
import { html, useState, useEffect, useRef } from '../lib/html.js';
import { api } from '../lib/api.js';
import { live } from '../lib/live.js';
import { Empty } from '../lib/ui.js';

export default function Schedules() {
  const [items, setItems] = useState(null);
  const load = useRef(null);
  load.current = async () => {
    const res = await api.get('/api/schedules');
    if (res.ok) setItems([...res.data.items].sort((a, b) => a.name.localeCompare(b.name)));
  };
  useEffect(() => {
    load.current();
    return live.on('schedule', () => load.current());
  }, []);

  if (!items) return html`<div aria-busy="true"></div>`;
  return html`<div class="schedules">
    <h1 class="page-title">Schedules</h1>
    ${items.length === 0
      ? html`<${Empty}>No schedules yet.</${Empty}>`
      : html`<ul class="schedule-list">${items.map((s) => html`<li key=${s.id}>
          <a class="schedule-link" href=${`/schedules/${s.id}`}>
            <span class="schedule-name">${s.name}</span>
            <span class="schedule-meta">${s.zone} · ${s.layers.length === 1 ? '1 layer' : `${s.layers.length} layers`}</span>
          </a>
        </li>`)}</ul>`}
  </div>`;
}
