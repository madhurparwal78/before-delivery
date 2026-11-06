import { api } from '../api';
import { clear, el } from '../dom';
import { frame } from '../frame';
import { Screen, ScreenParams, navigate } from '../router';
import { ObjectDto, TypeDto } from '../types';
import { libraryOrder, refreshLibrary, typeById, workspace } from '../state';
import { objectCard } from '../components/cards';
import { openDialog } from '../components/dialog';
import { onLive } from '../live';
import { setNumeral } from '../components/tether';
import { COPY } from '../../shared/copy';
import { startTitleTransition } from '../components/titletransition';

const KIND_LABELS: [string, string][] = [
  ['Text', 'text'],
  ['Number', 'number'],
  ['Date', 'date'],
  ['URL', 'url'],
  ['Select', 'select'],
  ['Relation', 'relation'],
];

export function typePageScreen(): Screen {
  let stopLive: (() => void) | null = null;
  let type: TypeDto | undefined;
  let objects: ObjectDto[] = [];
  const titles = new Map<string, string>();
  const grid = el('div', { className: 'card-grid' });

  async function load(): Promise<void> {
    if (type === undefined) return;
    const result = await api.get<{ objects: ObjectDto[] }>(`/api/objects?type_id=${type.id}`);
    if (!result.ok) return;
    objects = result.data.objects;
    const all = await api.get<{ objects: ObjectDto[] }>('/api/objects');
    if (all.ok) for (const candidate of all.data.objects) titles.set(candidate.id, candidate.title);
    renderCards();
  }

  function renderCards(): void {
    clear(grid);
    for (const object of objects) {
      grid.append(
        objectCard({
          object,
          type,
          relationTitle: (id) => titles.get(id) ?? '',
          onOpen: (opened, titleNode) => {
            startTitleTransition(titleNode);
            navigate(`/o/${opened.id}`);
          },
        }),
      );
    }
  }

  return {
    async mount(params: ScreenParams): Promise<void> {
      const main = frame().main;
      clear(main);
      clear(frame().margin);
      type = typeById(params.params['id']);
      if (type === undefined) {
        main.append(el('h1', { text: COPY.notFound }));
        return;
      }
      main.append(el('h1', { text: type.name, attrs: { tabindex: '-1' } }));
      frame().setTopTitle(type.name);
      if (type.name !== 'Daily note') {
        const create = el('button', {
          className: 'new-object',
          text: `New ${type.name}`,
          attrs: { type: 'button' },
        });
        create.addEventListener('click', () => openNewObjectDialog(type as TypeDto, create, load));
        main.append(create);
      }
      main.append(grid);
      await load();
      stopLive = onLive((eventType, data) => {
        if (eventType === 'backlinks.changed') {
          const objectId = String(data['object_id'] ?? '');
          const count = Number(data['backlinks'] ?? 0);
          const card = grid.querySelector<HTMLElement>(`.object-card a[href="/o/${objectId}"]`);
          const numeral = card?.closest('.object-card')?.querySelector<HTMLElement>('.card-count');
          if (numeral != null) setNumeral(numeral, count, true);
          return;
        }
        if (eventType === 'object.saved' || eventType === 'object.removed') void load();
      });
    },
    unmount(): void {
      if (stopLive !== null) stopLive();
    },
  };
}

function openNewObjectDialog(type: TypeDto, opener: HTMLElement, done: () => Promise<void>): void {
  openDialog({
    label: `New ${type.name}`,
    opener,
    content: (handle) => {
      const title = el('input', { attrs: { type: 'text', 'aria-label': 'Title', id: 'new-object-title' } });
      const error = el('div', { className: 'field-error' });
      const create = el('button', { text: 'Create', attrs: { type: 'button' } });
      create.addEventListener('click', () => {
        void (async () => {
          const result = await api.post<ObjectDto>('/api/objects', {
            type_id: type.id,
            title: title.value,
            properties: {},
          });
          if (!result.ok) {
            error.textContent = result.errors?.['title'] ?? '';
            title.focus();
            return;
          }
          handle.close();
          await done();
          navigate(`/o/${result.data.id}`);
        })();
      });
      return [el('label', { text: 'Title', attrs: { for: 'new-object-title' } }), title, error, create];
    },
  });
}

/** Dialog `New type`: a named type with named typed fields. */
export function openNewTypeDialog(opener: HTMLElement | null): void {
  type Row = {
    node: HTMLElement;
    name: HTMLInputElement;
    kind: HTMLSelectElement;
    required: HTMLInputElement;
    options: HTMLTextAreaElement;
    target: HTMLSelectElement;
    error: HTMLElement;
  };
  const rows: Row[] = [];
  openDialog({
    label: 'New type',
    className: 'new-type',
    opener,
    content: (handle) => {
      const typeName = el('input', { attrs: { type: 'text', 'aria-label': 'Type name' } });
      const nameError = el('div', { className: 'field-error' });
      const fieldHost = el('div', { className: 'field-rows' });
      const addField = el('button', { text: 'Add field', attrs: { type: 'button' } });
      const create = el('button', { text: 'Create type', attrs: { type: 'button' } });

      const addRow = (): void => {
        const name = el('input', { attrs: { type: 'text', 'aria-label': 'Field name' } });
        const kind = el('select', { attrs: { 'aria-label': 'Field kind' } });
        for (const [label, value] of KIND_LABELS) kind.append(el('option', { text: label, attrs: { value } }));
        const required = el('input', { attrs: { type: 'checkbox', 'aria-label': 'Required' } });
        const options = el('textarea', { attrs: { 'aria-label': 'Options' } });
        const target = el('select', { attrs: { 'aria-label': 'Target type' } });
        for (const candidate of libraryOrder(workspace().types)) {
          target.append(el('option', { text: candidate.name, attrs: { value: candidate.id } }));
        }
        const error = el('div', { className: 'field-error' });
        const node = el('div', {
          className: 'field-row',
          children: [name, kind, required, options, target, error],
        });
        fieldHost.append(node);
        rows.push({ node, name, kind, required, options, target, error });
      };
      addField.addEventListener('click', addRow);
      addRow();

      create.addEventListener('click', () => {
        void (async () => {
          const payload = {
            name: typeName.value,
            fields: rows.map((row) => ({
              name: row.name.value,
              kind: row.kind.value,
              required: row.required.checked,
              options:
                row.kind.value === 'select'
                  ? row.options.value.split('\n').map((option) => option.trim()).filter((option) => option !== '')
                  : null,
              target_type_id: row.kind.value === 'relation' ? row.target.value : null,
            })),
          };
          const result = await api.post<TypeDto>('/api/types', payload);
          if (!result.ok) {
            nameError.textContent = result.errors?.['name'] ?? '';
            rows.forEach((row, index) => {
              row.error.textContent =
                result.errors?.[`fields.${index}.name`] ??
                result.errors?.[`fields.${index}.kind`] ??
                result.errors?.[`fields.${index}.options`] ??
                result.errors?.[`fields.${index}.target_type_id`] ??
                '';
            });
            if (nameError.textContent !== '') typeName.focus();
            else rows.find((row) => row.error.textContent !== '')?.name.focus();
            return;
          }
          handle.close();
          await refreshLibrary();
          frame().renderRail();
          navigate(`/types/${result.data.id}`);
        })();
      });

      return [
        el('label', { text: 'Type name' }),
        typeName,
        nameError,
        fieldHost,
        addField,
        create,
      ];
    },
  });
}
