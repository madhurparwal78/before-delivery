import type { EventDto, IndexTableDto } from '../../shared/api';
import { api, RequestFailed } from '../api';
import { copy, STATUS_LABELS } from '../copy';
import { el, openDialog, replace } from '../dom';
import { appLink, type ScreenContext, type ScreenHandle } from '../main';
import {
  button,
  formAlert,
  labelledField,
  labelledSelect,
  labelledTextarea,
  liveRegion,
} from '../ui';

export function renderEvents(ctx: ScreenContext): ScreenHandle {
  const isChair = ctx.user?.roles.includes('chair') ?? false;
  const updates = liveRegion('Event updates');
  const list = el('div', { class: 'event-list' });
  const container = el(
    'div',
    { class: 'screen' },
    el(
      'div',
      { class: 'screen__header' },
      el('h1', { class: 'page-heading', text: 'Events' }),
      isChair
        ? button('New event', { variant: 'primary', onClick: () => void openCreateDialog() })
        : null,
    ),
    updates,
    list,
  );

  async function load(): Promise<void> {
    const result = await api.events.list();
    replace(
      list,
      result.events.length === 0
        ? el('p', { class: 'empty', text: 'No events yet.' })
        : el(
            'ul',
            { class: 'event-list__items' },
            result.events.map((event) => eventItem(event)),
          ),
    );
  }

  function eventItem(event: EventDto): HTMLElement {
    return el(
      'li',
      { class: 'event-list__item' },
      appLink(event.name, `/events/${event.id}`, 'event-list__link'),
      el('span', { class: 'event-list__date mono', text: event.date }),
      el('span', { class: 'event-list__venue', text: event.venue }),
      el('span', { class: 'status-label', text: STATUS_LABELS[event.status] }),
    );
  }

  async function openCreateDialog(): Promise<void> {
    const tables = await api.indexTables.list();
    const alert = formAlert();
    const name = labelledField({ label: 'Event name', id: 'event-name' });
    const date = labelledField({
      label: 'Date',
      id: 'event-date',
      hint: 'YYYY-MM-DD',
    });
    const venue = labelledField({ label: 'Venue', id: 'event-venue' });
    const cutoff = labelledField({
      label: 'Registration cutoff',
      id: 'event-cutoff',
      hint: 'YYYY-MM-DDTHH:MM in the club time zone',
    });
    const runs = labelledField({
      label: 'Runs per driver',
      id: 'event-runs',
      type: 'number',
      value: '3',
      min: '1',
      max: '6',
      step: '1',
    });
    const heats = labelledField({
      label: 'Heats',
      id: 'event-heats',
      type: 'number',
      value: '2',
      min: '2',
      max: '4',
      step: '1',
    });
    const classArea = el('div', { class: 'class-heats' });
    const stations = labelledTextarea({ label: 'Stations', id: 'event-stations', rows: 6 });
    stations.textarea.value = 'Start\nFinish\nCorner 1\nCorner 2';

    let classSelects: {
      classCode: string;
      select: HTMLSelectElement;
      wrapper: HTMLElement;
    }[] = [];

    const renderClassSelects = (): void => {
      const heatCount = Math.max(2, Math.min(4, Number(heats.input.value) || 2));
      const table = tableForDate(tables.tables, date.input.value);
      const classes = table === null ? [] : Object.keys(table.factors);
      classSelects = classes.map((classCode) => {
        const choice = labelledSelect({
          label: `Heat for ${classCode}`,
          id: `event-heat-${classCode}`,
          options: [
            { value: '', label: 'Not run' },
            ...Array.from({ length: heatCount }, (unused, index) => ({
              value: String(index + 1),
              label: `Heat ${index + 1}`,
            })),
          ],
        });
        return { classCode, select: choice.select, wrapper: choice.wrapper };
      });
      replace(classArea, ...classSelects.map((entry) => entry.wrapper));
    };

    heats.input.addEventListener('change', renderClassSelects);
    date.input.addEventListener('change', renderClassSelects);

    openDialog({
      name: 'New event',
      heading: 'New event',
      build: (close) => {
        renderClassSelects();
        const save = button('Save event', {
          variant: 'primary',
          onClick: () => void submit(close),
        });
        return [
          alert.element,
          name.wrapper,
          date.wrapper,
          venue.wrapper,
          cutoff.wrapper,
          runs.wrapper,
          heats.wrapper,
          classArea,
          stations.wrapper,
          el('div', { class: 'dialog__actions' }, save, button('Cancel', { onClick: close })),
        ];
      },
    });

    async function submit(close: () => void): Promise<void> {
      const heatCount = Math.max(2, Math.min(4, Number(heats.input.value) || 2));
      const heatSpecs = Array.from({ length: heatCount }, (unused, index) => ({
        number: index + 1,
        classes: classSelects
          .filter((entry) => entry.select.value === String(index + 1))
          .map((entry) => entry.classCode),
      }));
      const payload = {
        name: name.input.value.trim(),
        date: date.input.value.trim(),
        venue: venue.input.value.trim(),
        registrationCutoff: cutoff.input.value.trim(),
        runsPerDriver: Number(runs.input.value),
        heats: heatSpecs,
        stations: stations.textarea.value
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0),
      };
      alert.message(copy.event.savePending);
      updates.textContent = copy.event.savePending;
      try {
        await api.events.create(payload);
        updates.textContent = copy.event.saved;
        close();
        await load();
      } catch (error) {
        if (error instanceof RequestFailed && error.status === 422) {
          alert.fields(
            Object.entries(error.fields).map(([field, message]) => ({
              message,
              focus: () => {
                const map: Record<string, HTMLElement> = {
                  name: name.input,
                  date: date.input,
                  venue: venue.input,
                  registrationCutoff: cutoff.input,
                  runsPerDriver: runs.input,
                  heats: classArea.querySelector('select') ?? heats.input,
                  stations: stations.textarea,
                };
                (map[field] ?? name.input).focus();
              },
            })),
          );
          updates.textContent = '';
        } else if (error instanceof RequestFailed) {
          alert.message(error.message);
        } else {
          throw error;
        }
      }
    }
  }

  void load();
  return { element: container };
}

function tableForDate(tables: IndexTableDto[], date: string): IndexTableDto | null {
  const candidates = tables.filter((table) => date.length === 0 || table.effectiveDate <= date);
  return candidates[candidates.length - 1] ?? null;
}
