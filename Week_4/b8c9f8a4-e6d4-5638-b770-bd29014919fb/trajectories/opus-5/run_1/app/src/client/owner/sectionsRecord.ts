import { ERRORS, ODOMETER_FLAG, OUTAGE, PENDING, SUCCESS, throttledCopy } from '../../shared/copy';
import { formatDateTime, formatOdometer } from '../../shared/format';
import type { AdvisoryDto, Stance } from '../../shared/types';
import { ApiRefusal, ApiUnreachable, request } from '../shared/api';
import { clearNotice, showNotice } from '../shared/chrome';
import { el, onPress, setPending } from '../shared/dom';
import { announce } from '../shared/live';
import { sectionShell, type SectionContext, type SectionView } from './sectionKit';
import { ownerAction, sessionEnded } from './session';
import type { CarFileState } from './state';

interface AdvisoryRow {
  item: HTMLElement;
  stance: HTMLSelectElement;
  note: HTMLTextAreaElement;
  save: HTMLButtonElement;
  flag: HTMLElement;
  error: HTMLElement;
}

/** Test record: the pull, the odometer tape and one response per advisory. */
export const recordSection = (context: SectionContext): SectionView => {
  const { section, heading } = sectionShell('record', 'Test record');

  const pull = el('button', { type: 'button', class: 'pill-solid', text: 'Pull test record' });
  const pulledLine = el('p', { class: 'record-pulled' });
  const tape = el('div', { class: 'tape', role: 'region', 'aria-label': 'Odometer tape' });
  const tally = el('p', { class: 'advisory-tally' });
  const advisoryList = el('ol', { class: 'advisory-steps' });
  const advisories = el('div', { class: 'advisories', role: 'region', 'aria-label': 'Advisories' }, [
    tally,
    advisoryList,
  ]);

  /** An unsaved response stays on its advisory through polls and re-pulls. */
  const rows = new Map<string, AdvisoryRow>();

  onPress(pull, () => {
    void ownerAction(async () => {
      setPending(pull, true);
      announce(context.status, PENDING.pullRecord);
      try {
        await request(`/api/owner/cars/${context.carId}/record/pull`, { method: 'POST' });
        clearNotice(context.notice);
        await context.refresh(['record', 'publish']);
        announce(context.status, SUCCESS.pullRecord);
      } catch (error) {
        // An ended session is the sign-in dialog’s business, not this handler’s.
        if (sessionEnded(error)) throw error;
        if (error instanceof ApiRefusal) {
          if (error.code === 'record_not_found') {
            announce(context.status, ERRORS.recordNotFound);
            return;
          }
          if (error.code === 'record_throttled') {
            announce(context.status, throttledCopy(error.body.retryAfterSeconds ?? 60));
            return;
          }
          if (error.code === 'record_unreachable') {
            showNotice(context.notice, OUTAGE.record);
            return;
          }
          announce(context.status, error.body.message);
          return;
        }
        if (error instanceof ApiUnreachable) {
          showNotice(context.notice, OUTAGE.record);
          return;
        }
        throw error;
      } finally {
        setPending(pull, false);
      }
    }, pull);
  });

  const buildRow = (advisory: AdvisoryDto): AdvisoryRow => {
    const stance = el('select', { class: 'select-input' }) as HTMLSelectElement;
    stance.setAttribute('aria-label', `Response to ${advisory.text}`);
    stance.append(
      el('option', { value: '', text: 'Choose a stance' }),
      el('option', { value: 'repaired', text: 'Repaired' }),
      el('option', { value: 'monitoring', text: 'Monitoring' }),
      el('option', { value: 'not_repaired', text: 'Not repaired' }),
    );
    const note = el('textarea', { class: 'text-input', rows: 2 }) as HTMLTextAreaElement;
    note.setAttribute('aria-label', `Note on ${advisory.text}`);
    const save = el('button', { type: 'button', class: 'pill-outline', text: 'Save response' }) as HTMLButtonElement;
    const flag = el('p', { class: 'advisory-flag', text: ERRORS.recurredFlag });
    flag.hidden = true;
    const error = el('p', { class: 'field-error' });
    error.hidden = true;

    onPress(save, () => {
      void ownerAction(async () => {
        setPending(save, true);
        announce(context.status, PENDING.saveResponse);
        error.hidden = true;
        try {
          await request(`/api/owner/cars/${context.carId}/advisories/${advisory.id}`, {
            method: 'PUT',
            body: { stance: stance.value as Stance, note: note.value },
          });
          await context.refresh(['record', 'publish']);
          announce(context.status, SUCCESS.saveResponse);
        } catch (failure) {
          // An ended session is the sign-in dialog’s business, not this handler’s.
          if (sessionEnded(failure)) throw failure;
          if (failure instanceof ApiRefusal) {
            const message =
              failure.body.errors?.stance ?? failure.body.errors?.note ?? failure.body.message;
            error.hidden = false;
            error.textContent = message;
            announce(context.status, message);
            return;
          }
          throw failure;
        } finally {
          if (save.isConnected) setPending(save, false);
        }
      }, save);
    });

    const item = el('li', { class: 'advisory-step', 'data-advisory-id': advisory.id }, [
      el('p', { class: 'advisory-text', text: advisory.text }),
      el('p', { class: 'advisory-test figures', text: advisory.motTestNumber }),
      flag,
      stance,
      note,
      error,
      save,
    ]);
    return { item, stance, note, save, flag, error };
  };

  const paint = (state: CarFileState): void => {
    const record = state.record;
    pulledLine.textContent =
      record === null ? 'No pull yet' : `Pulled ${formatDateTime(record.pulledAt)}`;

    tape.replaceChildren(
      el('h3', { class: 'sub-heading', text: 'Odometer tape' }),
      el(
        'ol',
        { class: 'tape-steps' },
        (record?.tape ?? []).map((step) =>
          el('li', { class: `tape-step tape-${step.status}` }, [
            el('span', { class: 'tape-date figures', text: step.completedDate.slice(0, 10) }),
            el('span', { class: 'tape-result', text: step.testResult }),
            el('span', { class: 'tape-odo figures', text: formatOdometer(step.odometerValue, step.odometerUnit) }),
            el('span', {
              class: 'tape-km figures',
              text: step.normalisedKm === null ? '' : `${step.normalisedKm.toFixed(1)} km`,
            }),
            el('span', { class: 'tape-flag', text: step.flag === null ? '' : ODOMETER_FLAG[step.flag] }),
          ]),
        ),
      ),
    );

    tally.textContent = `Open advisories: ${state.car.workingOpenAdvisories}`;

    const wanted = record?.advisories ?? [];
    const keep = new Set(wanted.map((advisory) => advisory.id));
    for (const [id, row] of rows) {
      if (!keep.has(id)) {
        row.item.remove();
        rows.delete(id);
      }
    }

    for (const advisory of wanted) {
      let row = rows.get(advisory.id);
      if (row === undefined) {
        row = buildRow(advisory);
        rows.set(advisory.id, row);
      }
      row.flag.hidden = !advisory.recurred;
      const touched = row.item.dataset.touched === 'true';
      if (!touched && document.activeElement !== row.stance && document.activeElement !== row.note) {
        row.stance.value = advisory.stance ?? '';
        row.note.value = advisory.note ?? '';
      }
    }

    advisoryList.replaceChildren(
      ...wanted.map((advisory) => rows.get(advisory.id)?.item).filter((item): item is HTMLElement => item !== undefined),
    );

    if (wanted.length === 0) {
      advisoryList.replaceChildren(el('li', { class: 'empty-line', text: 'No advisories in this record' }));
    }
  };

  /** Typing marks the row, so a poll or a re-pull leaves the typed value alone. */
  section.addEventListener('input', (event) => {
    const item = (event.target as HTMLElement).closest<HTMLElement>('.advisory-step');
    if (item !== null) item.dataset.touched = 'true';
  });
  section.addEventListener('change', (event) => {
    const item = (event.target as HTMLElement).closest<HTMLElement>('.advisory-step');
    if (item !== null) item.dataset.touched = 'true';
  });

  section.append(el('div', { class: 'card' }, [pull, pulledLine]), tape, advisories);

  return { id: 'record', heading, node: section, paint };
};
