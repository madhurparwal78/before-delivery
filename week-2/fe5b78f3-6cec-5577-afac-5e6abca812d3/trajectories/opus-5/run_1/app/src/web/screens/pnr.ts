import type { PublicPnrBody } from '../api';
import { ApiRequestError, api } from '../api';
import { LiveRegion } from '../components';
import { clear, h } from '../dom';
import type { Screen, ScreenContext } from '../screen';

const COLUMNS = ['Passenger', 'Booking status', 'Current status'] as const;

function statusTable(body: PublicPnrBody): HTMLElement {
  const head = h('thead', {}, [
    h('tr', {}, COLUMNS.map((column) => h('th', { scope: 'col' }, [column]))),
  ]);
  const rows = body.passengers.map((passenger) =>
    h('tr', {}, [
      h('td', {}, [
        h('span', { class: 'cell-label' }, ['Passenger']),
        h('span', {}, [`Passenger ${passenger.number}`]),
      ]),
      h('td', {}, [
        h('span', { class: 'cell-label' }, ['Booking status']),
        h('span', { class: 'num' }, [passenger.booking_status]),
      ]),
      h('td', {}, [
        h('span', { class: 'cell-label' }, ['Current status']),
        h('span', { class: 'num' }, [passenger.current_status]),
      ]),
    ]));
  return h('div', {}, [
    h('p', { class: 'num' }, [
      `PNR ${body.pnr} · ${body.train.number} ${body.train.name} · ${body.from} to ${body.to}`,
    ]),
    h('table', { class: 'status', 'aria-label': 'PNR status' }, [head, h('tbody', {}, rows)]),
  ]);
}

export async function renderPnrStatus(
  context: ScreenContext,
  pnrFromPath: string | null,
): Promise<Screen> {
  const { main, router } = context;
  const lookup = new LiveRegion('PNR lookup', 'status');
  const input = h('input', {
    type: 'text',
    id: 'pnr-number',
    inputmode: 'numeric',
    value: pnrFromPath ?? '',
  });
  const result = h('div');
  const form = h('form', { class: 'pnr-form' }, [
    h('div', { class: 'field' }, [h('label', { for: 'pnr-number' }, ['PNR number']), input]),
    h('button', { type: 'submit', class: 'btn' }, ['Check status']),
  ]);

  async function lookupPnr(pnr: string): Promise<void> {
    clear(result);
    const body = await api.publicPnr(pnr).catch((error: unknown) => {
      if (error instanceof ApiRequestError) return null;
      throw error;
    });
    if (body === null) {
      lookup.say(`No booking has PNR ${pnr}.`);
      return;
    }
    lookup.say('');
    result.appendChild(statusTable(body));
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const pnr = input.value.trim();
    if (pnr.length === 0) return;
    router.go(`/pnr/${encodeURIComponent(pnr)}`);
  });

  main.appendChild(h('div', { class: 'panel stack' }, [
    h('h1', {}, ['PNR status']),
    form,
    lookup.element,
    result,
  ]));

  if (pnrFromPath !== null) await lookupPnr(pnrFromPath);
  return { ribbon: [] };
}
