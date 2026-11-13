import { request } from '../api.js';
import { copy, utcStamp } from '../../shared/copy.js';
import { normaliseUnits } from '../../shared/units.js';
import type { Length, PackBody, Units } from '../../shared/types.js';
import { clear, el } from '../dom.js';

function unitOf(length: Length, units: Units): string {
  return units === 'ft' ? length.ft : length.m;
}

function tableRegion(
  name: string,
  tableName: string,
  headers: string[],
  rows: (Node | string)[][],
): HTMLElement {
  const head = el('tr', {}, headers.map((header) => el('th', { scope: 'col', text: header })));
  const body = el(
    'tbody',
    {},
    rows.map((cells) =>
      el(
        'tr',
        {},
        cells.map((cell) =>
          el('td', {}, [typeof cell === 'string' ? document.createTextNode(cell) : cell]),
        ),
      ),
    ),
  );
  const table = el('table', { 'aria-label': tableName }, [el('thead', {}, [head]), body]);
  return el('section', { class: 'table-region' }, [
    el('h2', { text: name.replace(' table', '') }),
    el(
      'div',
      { class: 'table-scroll', role: 'region', 'aria-label': name, tabindex: '0' },
      [table],
    ),
  ]);
}

export function packView(root: HTMLElement, token: string, query: URLSearchParams): void {
  document.body.className = 'scrolls';
  const raw = query.get('units');
  let units: Units = normaliseUnits(raw);
  if (raw !== 'm' && raw !== 'ft') {
    window.history.replaceState(null, '', `/pack/${token}?units=m`);
  }

  const column = el('div', { class: 'pack-column' });
  const stateWord = el('span', { class: 'mono' });
  const unitsButton = el('button', {
    type: 'button',
    'aria-label': 'Units',
    'aria-pressed': units === 'ft' ? 'true' : 'false',
    text: units === 'ft' ? 'ft' : 'm',
  });
  const bar = el('div', { class: 'pack-top' }, [stateWord, unitsButton]);
  root.append(bar, column);

  const draw = (pack: PackBody): void => {
    clear(column);
    stateWord.textContent = copy.versionStateWord(pack.version.state);
    const suffix = units === 'ft' ? '(ft)' : '(m)';
    column.append(
      el('h1', { text: `Build pack — ${pack.room.name} v${pack.version.number}` }),
      el('p', { text: pack.version.label }),
      el('p', { class: 'mono', text: `${utcStamp(pack.version.frozenAt)} UTC` }),
    );
    if (pack.version.state === 'superseded' && pack.version.supersededBy !== null) {
      column.append(el('p', { text: copy.supersededPack(pack.version.supersededBy) }));
    }
    column.append(
      tableRegion(
        'Room table',
        'Room',
        [`Width ${suffix}`, `Depth ${suffix}`, `Height ${suffix}`],
        [
          [
            unitOf(pack.room.width, units),
            unitOf(pack.room.depth, units),
            unitOf(pack.room.height, units),
          ],
        ],
      ),
      tableRegion(
        'Placements table',
        'Placements',
        [
          'Label',
          'Kind',
          `X ${suffix}`,
          `Y ${suffix}`,
          `Z ${suffix}`,
          `Width ${suffix}`,
          `Depth ${suffix}`,
          `Height ${suffix}`,
          'Rotation',
        ],
        pack.placements.map((placement) => [
          placement.label,
          placement.kind,
          unitOf(placement.x, units),
          unitOf(placement.y, units),
          unitOf(placement.z, units),
          unitOf(placement.width, units),
          unitOf(placement.depth, units),
          unitOf(placement.height, units),
          `${placement.rotationDeg}`,
        ]),
      ),
      tableRegion(
        'Trigger wiring table',
        'Trigger wiring',
        ['Title', 'Kind', 'Needs', 'Linked placement', 'Answer'],
        pack.nodes.map((node) => [
          node.title,
          node.kind,
          node.needs.join(', '),
          node.linkedPlacement ?? '',
          node.answer ?? '',
        ]),
      ),
      tableRegion(
        'Files table',
        'Files',
        ['Prop name', 'Bytes', 'SHA-256', 'Download'],
        pack.props.map((prop) => [
          prop.name,
          String(prop.bytes),
          el('span', { class: 'mono sha', text: prop.sha256 }),
          el('a', {
            class: 'download-link',
            href: prop.downloadPath,
            'aria-label': `Download ${prop.name}`,
            text: 'Download',
            download: '',
          }),
        ]),
      ),
    );
  };

  unitsButton.addEventListener('click', () => {
    units = units === 'ft' ? 'm' : 'ft';
    unitsButton.setAttribute('aria-pressed', units === 'ft' ? 'true' : 'false');
    unitsButton.textContent = units === 'ft' ? 'ft' : 'm';
    window.history.replaceState(null, '', `/pack/${token}?units=${units}`);
    if (current) draw(current);
  });

  let current: PackBody | null = null;
  void request<PackBody>('GET', `/api/pack/${token}`)
    .then((pack) => {
      current = pack;
      draw(pack);
    })
    .catch(() => {
      bar.remove();
      clear(column);
      column.append(el('h1', { text: copy.linkInvalid }));
    });
}
