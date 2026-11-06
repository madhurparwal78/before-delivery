import { STATUS_COPY } from '../../domain/copy.ts';
import { MARKETS, marketCity } from '../../domain/markets.ts';
import { SWATCH_NAMES } from '../../domain/palette.ts';
import { applyValues, clearDraft, collectValues, readDraft, writeDraft } from '../drafts.ts';
import { announce, clearFieldErrors, showFieldErrors } from '../feedback.ts';
import { request, RequestFailed } from '../net.ts';
import { control, numberOf, onAction, onOpen, pageData, radioValue, valueOf } from '../ui.ts';

interface NewDropData {
  screen: 'new-drop';
  memberId: string;
}

interface StyleRow {
  styleNumber: string;
  name: string;
  colour: string;
  wholesaleEdition: number;
}

const TOTAL_STEPS = 4;

export function startNewDropScreen(): void {
  const data = pageData<NewDropData>();
  const key = { memberId: data.memberId, screen: 'new-drop' };
  const form = document.querySelector<HTMLFormElement>('[data-form="new-drop"]');
  if (form === null) return;

  let step = 1;
  let styleCount = 0;

  const showStep = (): void => {
    for (const fieldset of form.querySelectorAll<HTMLElement>('[data-step]')) {
      fieldset.hidden = fieldset.dataset['step'] !== String(step);
    }
    const counter = form.querySelector<HTMLElement>('[data-step-counter]');
    if (counter !== null) counter.textContent = `Step ${step} / ${TOTAL_STEPS}`;
    const back = document.querySelector<HTMLButtonElement>('[data-action="step-back"]');
    const next = document.querySelector<HTMLButtonElement>('[data-action="step-next"]');
    if (back !== null) back.disabled = step === 1;
    if (next !== null) next.disabled = step === TOTAL_STEPS;
    if (step === TOTAL_STEPS) renderReview();
  };

  const addStyleRow = (values: StyleRow | null = null): void => {
    const body = document.querySelector<HTMLElement>('[data-style-rows]');
    if (body === null) return;
    const index = styleCount;
    styleCount += 1;
    const row = document.createElement('tr');
    for (const [name, label, kind] of [
      ['styleNumber', 'Style number', 'text'],
      ['styleName', 'Style name', 'text'],
      ['colour', 'Colour', 'text'],
      ['wholesaleEdition', 'Wholesale edition', 'number'],
    ] as const) {
      const cell = document.createElement('td');
      const field = `styles.${index}.${name}`;
      const input = document.createElement('input');
      input.type = kind;
      input.className = 'field__control';
      input.id = `f-${field}`;
      input.dataset['fieldControl'] = field;
      input.setAttribute('aria-label', label);
      if (kind === 'number') {
        input.min = '0';
        input.max = '100000';
        input.step = '1';
        input.value = String(values?.wholesaleEdition ?? 0);
      } else if (values !== null) {
        input.value =
          name === 'styleNumber'
            ? values.styleNumber
            : name === 'styleName'
              ? values.name
              : values.colour;
      }
      const error = document.createElement('p');
      error.className = 'field__error';
      error.dataset['fieldError'] = field;
      error.hidden = true;
      const wrapper = document.createElement('div');
      wrapper.className = 'field';
      wrapper.dataset['field'] = field;
      wrapper.append(input, error);
      cell.append(wrapper);
      row.append(cell);
    }
    const empty = body.querySelector('.table__empty');
    empty?.remove();
    body.append(row);
  };

  const styles = (): StyleRow[] => {
    const rows: StyleRow[] = [];
    for (let index = 0; index < styleCount; index += 1) {
      const number = valueOf(`styles.${index}.styleNumber`);
      const name = valueOf(`styles.${index}.styleName`);
      if (number === '' && name === '') continue;
      rows.push({
        styleNumber: number,
        name,
        colour: valueOf(`styles.${index}.colour`),
        wholesaleEdition: numberOf(`styles.${index}.wholesaleEdition`),
      });
    }
    return rows;
  };

  const stepBody = (which: number): Record<string, unknown> => {
    if (which === 1) {
      return {
        name: valueOf('name'),
        type: radioValue('type') === '' ? 'simultaneous' : radioValue('type'),
        holdSeconds: numberOf('holdSeconds'),
        internalNote: control('internalNote')?.value ?? '',
      };
    }
    if (which === 2) {
      const markets: Record<string, number> = {};
      for (const market of MARKETS) markets[market] = numberOf(`markets.${market}`);
      return { markets };
    }
    return {
      styles: styles().map((style) => ({
        styleNumber: style.styleNumber,
        name: style.name,
        colour: style.colour,
        wholesaleEdition: style.wholesaleEdition,
        rrpDkkMinor: 0,
      })),
    };
  };

  const renderReview = (): void => {
    const review = form.querySelector<HTMLElement>('[data-review]');
    if (review === null) return;
    const markets = MARKETS.map(
      (market) => `${marketCity(market)} ${numberOf(`markets.${market}`)}`,
    ).join(', ');
    review.replaceChildren();
    const rows: readonly (readonly [string, string])[] = [
      ['Drop name', valueOf('name')],
      ['Drop type', radioValue('type') === 'rolling' ? 'Rolling' : 'Simultaneous'],
      ['Hold length in seconds', String(numberOf('holdSeconds'))],
      ['Market pieces', markets],
      ['Styles', styles().map((style) => style.styleNumber).join(', ')],
    ];
    for (const [label, value] of rows) {
      const term = document.createElement('dt');
      term.textContent = label;
      const detail = document.createElement('dd');
      detail.textContent = value;
      review.append(term, detail);
    }
  };

  onOpen('add-style', () => {
    addStyleRow();
    writeDraft(key, { ...collectValues(form), step: String(step), styleCount: String(styleCount) });
  });

  onOpen('step-back', () => {
    if (step === 1) return;
    step -= 1;
    showStep();
    writeDraft(key, { ...collectValues(form), step: String(step), styleCount: String(styleCount) });
  });

  onOpen('step-next', () => {
    void (async (): Promise<void> => {
      clearFieldErrors(form);
      if (step === TOTAL_STEPS) return;
      try {
        await request('/api/drops/checks', { method: 'POST', body: stepBody(step) });
        step += 1;
        showStep();
        writeDraft(key, {
          ...collectValues(form),
          step: String(step),
          styleCount: String(styleCount),
        });
      } catch (error) {
        if (error instanceof RequestFailed && error.failure.status === 422) {
          showFieldErrors(error.failure.fields, { scope: form, map: mapStepField });
          announce('New drop status', error.failure.message);
          return;
        }
        announce('New drop status', error instanceof RequestFailed ? error.failure.message : '');
      }
    })();
  });

  onAction(
    'create-drop',
    async () => {
      const markets: Record<string, number> = {};
      for (const market of MARKETS) markets[market] = numberOf(`markets.${market}`);
      return request<{ id: string }>('/api/drops', {
        method: 'POST',
        body: {
          name: valueOf('name'),
          type: radioValue('type') === '' ? 'simultaneous' : radioValue('type'),
          holdSeconds: numberOf('holdSeconds'),
          internalNote: control('internalNote')?.value ?? '',
          palette: [SWATCH_NAMES[1] ?? 'ink', 'vermilion', 'sand'],
          status: 'draft',
          markets,
          styles: styles().map((style) => ({
            styleNumber: style.styleNumber,
            name: style.name,
            colour: style.colour,
            wholesaleEdition: style.wholesaleEdition,
            rrpDkkMinor: 0,
          })),
        },
      });
    },
    {
      region: 'New drop status',
      success: STATUS_COPY.dropCreated,
      map: mapStepField,
      after: (result) => {
        clearDraft(key);
        window.location.assign(`/studio/drops/${(result as { id: string }).id}`);
      },
    },
  );

  const draft = readDraft(key);
  if (draft !== null) {
    const kept = Number(draft['styleCount'] ?? '0');
    for (let index = 0; index < kept; index += 1) addStyleRow();
    applyValues(form, draft);
    step = Math.min(TOTAL_STEPS, Math.max(1, Number(draft['step'] ?? '1')));
  }
  showStep();

  for (const event of ['input', 'change']) {
    form.addEventListener(event, () => {
      writeDraft(key, {
        ...collectValues(form),
        step: String(step),
        styleCount: String(styleCount),
      });
    });
  }
}

function mapStepField(path: string): string {
  if (path.startsWith('markets.')) return path;
  const style = /^styles\.(\d+)\.(\w+)$/.exec(path);
  if (style === null) return path;
  const key = style[2] === 'name' ? 'styleName' : (style[2] as string);
  return `styles.${style[1]}.${key}`;
}
