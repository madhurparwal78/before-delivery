// The technician page: circuit checklist and the stored PDF (DP-44 to DP-46).

import { h, clear, announce, showProblem, statusRegion, COPY } from './ui.js';
import { subscribe, ApiProblem } from './app.js';

export async function renderRig(shell, band, token) {
  const rig = await api(`/api/rig/${token}`);
  shell.append(); // no navigation on the technician page
  const heading = h('h1', { class: 'sentence' });
  const slot = h('span', { class: 'slot', 'aria-hidden': 'true' }, 'rig');
  heading.append(
    rig.circuits.length === 1 ? 'THIS RIG HAS 1 CIRCUIT TO PROVE' : `THIS RIG HAS ${rig.circuits.length} CIRCUITS TO PROVE`,
    slot);
  shell.append(heading);

  const status = statusRegion('Rig');
  const outOfStep = h('div', { class: 'outage-band', role: 'status', hidden: rig.sheetStatus !== 'Out of step' }, COPY.outOfStep);
  shell.append(outOfStep);

  const list = h('ul', { 'aria-label': 'Circuits', role: 'list' });
  for (const circuit of rig.circuits) {
    const checkbox = h('input', { type: 'checkbox', 'aria-label': `${circuit.name} is live` });
    checkbox.checked = circuit.live;
    checkbox.addEventListener('change', async () => {
      try {
        await fetch(`/api/rig/${token}/circuits/${circuit.id}/live`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ live: checkbox.checked }),
        });
        announce(status, checkbox.checked ? COPY.rigTick(circuit.name) : COPY.rigUntick(circuit.name));
      } catch {
        checkbox.checked = !checkbox.checked;
      }
    });
    list.append(h('li', { role: 'listitem' }, checkbox, ` ${circuit.name} ${circuit.kind} ${circuit.loadWatts} W of ${circuit.capacityWatts} W`));
  }
  shell.append(list);

  const pdf = h('a', { href: `/api/rig/${token}/sheet.pdf`, target: '_blank' }, 'Open the PDF');
  shell.append(pdf, status);

  // Live ticks arrive without a reload through the link's own stream.
  const source = new EventSource(`/api/rig/${token}/events`);
  source.onmessage = (event) => {
    let data = null;
    try { data = JSON.parse(event.data); } catch { return; }
    if (data.type === 'circuit.confirmed') {
      for (const item of list.children) {
        const input = item.querySelector('input');
        if (input && input.getAttribute('aria-label')?.startsWith(data.data.circuitName ?? '')) {
          // match by circuit id when the name is not present
        }
      }
      for (const circuit of rig.circuits) {
        if (circuit.id === data.data.circuitId) {
          for (const item of list.children) {
            const input = item.querySelector('input');
            if (input && input.getAttribute('aria-label') === `${circuit.name} is live`) {
              input.checked = data.data.live;
            }
          }
        }
      }
    }
    if (data.type === 'sheet.changed') {
      routeRigStatus(data.data.status);
    }
  };
  source.onerror = () => {
    // A stream open on a link that ends closes within 5 seconds; the page shows the ending.
    source.close();
    renderEnded();
  };

  function routeRigStatus(statusWord) {
    if (statusWord === 'Out of step') outOfStep.hidden = false;
    if (statusWord === 'Withdrawn') renderEnded();
  }

  function renderEnded() {
    clear(shell);
    const heading = h('h1', { class: 'sentence' }, "This rig sheet link has ended. Ask the projection artist for a new one.");
    shell.append(heading);
  }
}

async function api(path) {
  const response = await fetch(path);
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) {
    if (json && json.code === 'link_window_over' || json && json.code === 'link_ended') {
      throw new ApiProblem(json);
    }
    if (json && json.code) throw new ApiProblem(json);
    throw new ApiProblem({ code: 'internal_error', detail: 'Something went wrong on our side.' });
  }
  return json;
}
