/**
 * The estimate. Totals change in place on every input, in the dialog and in the
 * tile behind it, and each settled change is announced once.
 */
import { F } from '../../shared/feedback.ts';
import { api, ApiError, fieldProblems } from '../ui/api.ts';
import { el, need, setText } from '../ui/dom.ts';
import { rollFigure } from '../ui/motion.ts';
import { announce, clearProblems, showProblems, withPending } from '../ui/shell.ts';
import { field, openModal } from '../ui/dialog.ts';
import { body, pieceId, setRefresher, wireMainAction } from './deskShell.ts';

interface Estimate {
  id?: string;
  version: number;
  state: string;
  materialCode: string | null;
  lot: string | null;
  patternAreaSqFt: string | null;
  hides: number | null;
  metres: string | null;
  labourHours: string;
  taxPercent: number;
  display: {
    material: string;
    labour: string;
    labourRate: string;
    subtotal: string;
    tax: string;
    total: string;
    milestones: string[];
  };
}

interface Material {
  code: string;
  name: string;
  unit: 'sqFt' | 'metre';
}

interface Lot {
  lot: string;
  hides?: number;
  averageSqFt?: string;
  metres?: string;
}

/** `L-2041-A, 2 hides at 48.25 sq ft` or `L-3000-A, 40.00 m`. */
export function lotLabel(lot: Lot): string {
  if (lot.metres !== undefined) return `${lot.lot}, ${lot.metres} m`;
  const hides = lot.hides ?? 0;
  return `${lot.lot}, ${hides === 1 ? '1 hide' : `${hides} hides`} at ${lot.averageSqFt} sq ft`;
}

const SETTLE_MS = 320;

export async function startEstimate(): Promise<void> {
  const screen = body();
  const piece = pieceId();

  const lines = el('dl', { class: 'amounts', id: 'estimate-lines' });
  const milestones = el('ol', { class: 'milestones', id: 'estimate-milestones' });
  const total = el('p', { class: 'figure', 'data-part': 'estimate-total', id: 'estimate-total' });
  const mint = el('div', { class: 'tile tile-mint' }, [
    el('p', { class: 'figure-label', text: 'Total' }),
    total,
  ]);
  const edit = el('button', { type: 'button', class: 'button-primary', text: 'Edit estimate', id: 'edit-estimate' });
  const facts = el('div', { class: 'tile tile-large' }, [el('h2', { text: 'Estimate' }), lines, milestones]);

  screen.textContent = '';
  screen.append(mint, facts, el('p', { class: 'screen-action' }, [edit]));

  const materials = ((await api.get('/api/materials')) as { materials: Material[] }).materials;
  let current: Estimate | null = null;

  const showEstimate = (estimate: Estimate | null): void => {
    if (!estimate) {
      lines.textContent = '';
      milestones.textContent = '';
      rollFigure(total, '\u2014');
      return;
    }
    const rows: [string, string][] = [
      ['Material', estimate.display.material],
      ['Labour', estimate.display.labour],
      ['Labour rate', estimate.display.labourRate],
      ['Subtotal', estimate.display.subtotal],
      [`Tax ${estimate.taxPercent}%`, estimate.display.tax],
      ['Total', estimate.display.total],
    ];
    lines.textContent = '';
    for (const [label, value] of rows) {
      lines.append(el('dt', { text: label }), el('dd', { text: value }));
    }
    milestones.textContent = '';
    estimate.display.milestones.forEach((amount, index) => {
      milestones.append(el('li', { text: `Stage ${index + 1}: ${amount}` }));
    });
    rollFigure(total, estimate.display.total);
  };

  const openEditor = (): void => {
    openModal({
      name: 'Edit estimate',
      opener: edit,
      build(dialogBody, handle) {
        const material = el('select', { name: 'materialCode' });
        material.append(el('option', { value: '', text: 'None (frame only)' }));
        for (const item of materials) {
          material.append(el('option', { value: item.code, text: `${item.name} ${item.code}` }));
        }
        const lotSelect = el('select', { name: 'lot' });
        const lotRow = field('est-lot', 'Lot', lotSelect);
        const quantity = el('input', { type: 'text', name: 'patternAreaSqFt', inputmode: 'decimal' });
        const quantityRow = field('est-quantity', 'Pattern area in sq ft', quantity);
        const hours = el('input', { type: 'text', name: 'labourHours', value: '0.00', inputmode: 'decimal' });
        const save = el('button', { type: 'button', class: 'button-primary', text: 'Save estimate' });
        const close = el('button', { type: 'button', text: 'Close' });
        const preview = el('dl', { class: 'amounts preview-amounts' });

        dialogBody.append(
          field('est-material', 'Material', material),
          lotRow,
          quantityRow,
          field('est-hours', 'Labour hours', hours),
          preview,
          el('p', { class: 'dialog-actions' }, [save, close]),
        );

        if (current) {
          material.value = current.materialCode ?? '';
          hours.value = current.labourHours;
          quantity.value = current.patternAreaSqFt ?? current.metres ?? '';
        }

        let lots: Lot[] = [];
        let settle: number | null = null;
        let newest = 0;

        const unitOf = (): 'sqFt' | 'metre' | null => {
          const code = material.value;
          if (code === '') return null;
          return materials.find((item) => item.code === code)?.unit ?? null;
        };

        const applyUnit = (): void => {
          const unit = unitOf();
          // Choosing `None (frame only)` also removes Lot.
          lotRow.hidden = unit === null;
          quantityRow.hidden = unit === null;
          if (unit === null) return;
          const label = need('label', quantityRow);
          setText(label, unit === 'metre' ? 'Metres' : 'Pattern area in sq ft');
          quantity.name = unit === 'metre' ? 'metres' : 'patternAreaSqFt';
        };

        const loadLots = async (): Promise<void> => {
          const code = material.value;
          if (code === '') {
            lots = [];
            return;
          }
          const answer = (await api.get(`/api/materials/${encodeURIComponent(code)}/lots`)) as { lots: Lot[] };
          lots = answer.lots;
          lotSelect.textContent = '';
          for (const lot of lots) {
            lotSelect.append(el('option', { value: lot.lot, text: lotLabel(lot) }));
          }
          if (current?.lot && lots.some((lot) => lot.lot === current!.lot)) lotSelect.value = current.lot;
        };

        /** The totals change in place on input, with no submit and no reload. */
        const recompute = (): void => {
          if (settle !== null) window.clearTimeout(settle);
          settle = window.setTimeout(() => {
            const token = ++newest;
            void (async () => {
              const payload: Record<string, unknown> = {
                materialCode: material.value === '' ? null : material.value,
                lot: material.value === '' ? null : lotSelect.value,
                labourHours: hours.value,
              };
              const unit = unitOf();
              if (unit === 'metre') payload.metres = quantity.value;
              else if (unit === 'sqFt') payload.patternAreaSqFt = quantity.value;
              try {
                const answer = (await api.post(`/api/pieces/${piece}/estimates/preview`, payload)) as {
                  estimate: Estimate;
                };
                if (token !== newest) return;
                preview.textContent = '';
                for (const [label, value] of [
                  ['Material', answer.estimate.display.material],
                  ['Labour', answer.estimate.display.labour],
                  ['Subtotal', answer.estimate.display.subtotal],
                  ['Tax', answer.estimate.display.tax],
                  ['Total', answer.estimate.display.total],
                ] as [string, string][]) {
                  preview.append(el('dt', { text: label }), el('dd', { text: value }));
                }
                rollFigure(total, answer.estimate.display.total);
                announce(F.totalNow(answer.estimate.display.total));
              } catch {
                if (token !== newest) return;
                preview.textContent = '';
              }
            })();
          }, SETTLE_MS);
        };

        material.addEventListener('change', () => {
          applyUnit();
          void loadLots().then(recompute);
        });
        lotSelect.addEventListener('change', recompute);
        quantity.addEventListener('input', recompute);
        hours.addEventListener('input', recompute);

        applyUnit();
        void loadLots().then(recompute);

        close.addEventListener('click', () => handle.close());
        save.addEventListener('click', () => {
          void withPending(save, async () => {
            clearProblems(handle.problems, [material, lotSelect, quantity, hours]);
            const payload: Record<string, unknown> = {
              materialCode: material.value === '' ? null : material.value,
              lot: material.value === '' ? null : lotSelect.value,
              labourHours: hours.value,
            };
            const unit = unitOf();
            if (unit === 'metre') payload.metres = quantity.value;
            else if (unit === 'sqFt') payload.patternAreaSqFt = quantity.value;
            if (current) payload.openVersion = current.version;
            try {
              await api.post(`/api/pieces/${piece}/estimates`, payload);
              handle.close();
              announce(F.estimateSaved);
              await load();
            } catch (error) {
              if (!(error instanceof ApiError)) throw error;
              // A refused dialog stays open as typed with its own message.
              const problems = fieldProblems(error);
              showProblems(
                handle.problems,
                problems.length > 0 ? problems : [{ field: 'labourHours', message: error.failure.message }],
                (name) =>
                  name === 'materialCode'
                    ? material
                    : name === 'lot'
                      ? lotSelect
                      : name === 'labourHours'
                        ? hours
                        : quantity,
                'Problems',
              );
            }
          });
        });
      },
    });
  };

  edit.addEventListener('click', openEditor);
  wireMainAction(openEditor);

  async function load(): Promise<void> {
    const answer = (await api.get(`/api/pieces/${piece}/estimates`)) as { estimates: Estimate[] };
    current = answer.estimates.find((item) => item.state === 'open' || item.state === 'signedOff') ?? null;
    showEstimate(current);
  }

  await load();
  setRefresher(load);
}
