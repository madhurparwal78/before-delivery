import { ApiProblem, call, newKey } from '../api.js';
import { append, button, clear, combobox, el, field, showFieldError, textbox } from '../dom.js';
import { listen } from '../events.js';
import { clearBand, follow, heading, navigation, showBand } from '../shell.js';
import { wallFragment } from '../wall.js';

export interface SiteSummary {
  readonly id: string;
  readonly name: string;
  readonly widthMetres: string;
  readonly heightMetres: string;
  readonly columns: number;
  readonly rows: number;
  readonly showAt: string;
  readonly rectified: boolean;
  readonly residualMetres: string | null;
  readonly stale: boolean;
  readonly staleAt: string | null;
  readonly demo: boolean;
  readonly circuits: readonly { id: string; name: string; kind: string; capacityWatts: number }[];
  readonly layouts: readonly { id: string; name: string; sheetStatus: string }[];
}

const FIELDS = ['/name', '/width', '/height', '/showAtLocal'] as const;

export async function renderWalls(screen: HTMLElement, chrome: HTMLElement): Promise<() => void> {
  clear(chrome);
  chrome.appendChild(navigation('/sites'));

  const draw = async (): Promise<void> => {
    const sites = (await call<{ items: SiteSummary[] }>('/api/sites')).items;
    const count = sites.length;
    const sentence = count === 1 ? '1 WALL ON FILE' : `${count} WALLS ON FILE`;

    const rows = sites.map((site) =>
      el('tr', {}, [
        el('td', {}, [
          el('a', {
            href: site.rectified && site.layouts[0] !== undefined
              ? `/sites/${site.id}/layouts/${site.layouts[0].id}`
              : `/sites/${site.id}/survey`,
            text: site.name,
            onclick: follow,
          }),
        ]),
        el('td', { text: `${Number(site.widthMetres).toFixed(1)} m by ${Number(site.heightMetres).toFixed(1)} m` }),
        el('td', { text: site.rectified ? `Measured to ${site.residualMetres} m` : 'Not measured yet' }),
        el('td', { text: site.layouts.map((layout) => `${layout.name}: ${layout.sheetStatus}`).join(', ') }),
      ]),
    );

    const name = textbox('Site name');
    const width = textbox('Wall width');
    const height = textbox('Wall height');
    const unit = combobox('Length unit', [
      { value: 'm', label: 'm' },
      { value: 'ft', label: 'ft' },
    ]);
    const showAt = textbox('Show time', '', { placeholder: 'YYYY-MM-DDTHH:mm' });

    const save = async (): Promise<void> => {
      for (const pointer of FIELDS) showFieldError(`new-site${pointer}`, null);
      clearBand();
      try {
        const site = await call<SiteSummary>('/api/sites', {
          method: 'POST',
          key: newKey(),
          body: {
            name: name.value,
            width: { text: width.value, unit: unit.value },
            height: { text: height.value, unit: unit.value },
            showAtLocal: showAt.value,
          },
        });
        history.pushState({}, '', `/sites/${site.id}/survey`);
        window.dispatchEvent(new PopStateEvent('popstate'));
      } catch (error) {
        if (!(error instanceof ApiProblem)) throw error;
        const errors = error.body.errors ?? {};
        for (const [pointer, copy] of Object.entries(errors)) {
          showFieldError(`new-site${pointer.replace(/\/text$/, '')}`, copy);
        }
        if (error.body.errors === undefined) showBand(error.body.detail);
      }
    };

    const form = el('form', { 'aria-label': 'New site', onsubmit: (event: Event) => event.preventDefault() }, [
      field('Site name', name, 'new-site/name'),
      field('Wall width', width, 'new-site/width'),
      field('Wall height', height, 'new-site/height'),
      el('label', {}, ['Length unit', unit]),
      field('Show time', showAt, 'new-site/showAtLocal'),
      button('Save site', () => void save()),
    ]);

    clear(screen);
    append(screen, [
      heading({ sentence, slot: wallFragment() }),
      el('div', { class: 'columns' }, [
        el('div', { class: 'lede' }, [form]),
        el('div', { class: 'evidence' }, [
          el('table', { 'aria-label': 'Walls' }, [
            el('thead', {}, [
              el('tr', {}, [
                el('th', { scope: 'col', text: 'Wall' }),
                el('th', { scope: 'col', text: 'Size' }),
                el('th', { scope: 'col', text: 'Rectification' }),
                el('th', { scope: 'col', text: 'Layouts' }),
              ]),
            ]),
            el('tbody', {}, rows),
          ]),
        ]),
      ]),
    ]);
  };

  await draw();
  return listen('/api/events', (event) => {
    if (event.type === 'layout.changed' || event.type === 'sheet.changed') void draw();
  });
}
