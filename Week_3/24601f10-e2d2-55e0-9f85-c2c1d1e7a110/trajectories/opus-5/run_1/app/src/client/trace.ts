import { COPY, YOUR_ACTION, resetCountSentence } from '../shared/copy';
import type { ApiMatch, DependentPreview } from '../shared/types';
import { api, ApiError } from './api';
import { type DialogHandle, dialogError, openDialog } from './dialog';
import { h, prefersReducedMotion, wait } from './dom';

export const SEGMENT_MS = 320;
export const SLAT_MS = 240;
export const STEP_MS = 90;

const cardFor = (matchId: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-match-id="${matchId}"]`);

const traceLayer = (): SVGSVGElement | null => {
  const area = document.querySelector<HTMLElement>('[data-bracket-area]');
  if (area === null) return null;
  let layer = area.querySelector<SVGSVGElement>('svg[data-trace-path]');
  if (layer === null) {
    layer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    layer.setAttribute('data-trace-path', '');
    layer.setAttribute('class', 'trace-layer');
    area.appendChild(layer);
  }
  return layer;
};

const clearTrace = (): void => {
  document.querySelector('svg[data-trace-path]')?.remove();
};

const centreIn = (layer: SVGSVGElement, element: HTMLElement): { x: number; y: number } => {
  const base = layer.getBoundingClientRect();
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2 - base.left, y: box.top + box.height / 2 - base.top };
};

const drawSegment = (layer: SVGSVGElement, from: HTMLElement, to: HTMLElement, animate: boolean): SVGLineElement => {
  const start = centreIn(layer, from);
  const end = centreIn(layer, to);
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', String(start.x));
  line.setAttribute('y1', String(start.y));
  line.setAttribute('x2', String(end.x));
  line.setAttribute('y2', String(end.y));
  line.setAttribute('class', 'trace-segment');
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (animate) {
    line.style.strokeDasharray = String(length);
    line.style.strokeDashoffset = String(length);
    line.style.transition = `stroke-dashoffset ${SEGMENT_MS}ms ease-out`;
    requestAnimationFrame(() => {
      line.style.strokeDashoffset = '0';
    });
  }
  layer.appendChild(line);
  return line;
};

interface TraceRun {
  dependents: DependentPreview[];
  reversed: boolean;
}

const markWillReset = (card: HTMLElement, shutter: 'half' | 'closed'): void => {
  card.dataset.shutter = shutter;
  if (card.querySelector('.will-reset') === null) {
    card.appendChild(h('span', { class: 'will-reset' }, COPY.willReset));
  }
};

const unmark = (card: HTMLElement): void => {
  card.dataset.shutter = 'open';
  card.querySelector('.will-reset')?.remove();
  delete card.dataset.shutter;
};

/** Shutter trace: the path reaches each dependent card in reset order and half-closes its slats. */
const runTrace = async (
  run: TraceRun,
  editedId: string,
  list: HTMLElement,
  count: HTMLElement,
  confirmedTotal: number,
): Promise<void> => {
  const reduced = prefersReducedMotion();
  const layer = traceLayer();
  const source = cardFor(editedId);
  const total = run.dependents.length;
  if (total === 0) {
    count.textContent = resetCountSentence(0, 0);
    return;
  }

  if (reduced) {
    for (const dependent of run.dependents) {
      const card = cardFor(dependent.match_id);
      if (card !== null) markWillReset(card, 'half');
      list.appendChild(h('li', {}, dependent.label));
    }
    count.textContent = resetCountSentence(total, confirmedTotal);
    return;
  }

  let previous = source;
  for (let index = 0; index < total; index += 1) {
    if (run.reversed) return;
    const dependent = run.dependents[index] as DependentPreview;
    const card = cardFor(dependent.match_id);
    if (card !== null && layer !== null && previous !== null) drawSegment(layer, previous, card, true);
    if (card !== null) {
      card.style.setProperty('--slat-ms', `${SLAT_MS}ms`);
      markWillReset(card, 'half');
      card.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      previous = card;
    }
    list.appendChild(h('li', {}, dependent.label));
    const confirmedSoFar = run.dependents
      .slice(0, index + 1)
      .filter((item) => item.state === 'confirmed' || item.state === 'resolved').length;
    count.textContent = resetCountSentence(index + 1, confirmedSoFar);
    await wait(STEP_MS);
  }
  count.textContent = resetCountSentence(total, confirmedTotal);
};

const reverseTrace = async (dependents: DependentPreview[]): Promise<void> => {
  const reduced = prefersReducedMotion();
  for (const dependent of [...dependents].reverse()) {
    const card = cardFor(dependent.match_id);
    if (card !== null) unmark(card);
    if (!reduced) await wait(STEP_MS);
  }
  clearTrace();
};

/** Other screens receive the reset in the same order and play the slat close on their own cards. */
export const playResetOnCards = async (matchIds: string[]): Promise<void> => {
  const reduced = prefersReducedMotion();
  for (const matchId of matchIds) {
    const card = cardFor(matchId);
    if (card !== null) {
      card.dataset.shutter = 'closed';
      window.setTimeout(() => {
        const current = cardFor(matchId);
        if (current !== null) delete current.dataset.shutter;
      }, SLAT_MS * 2);
    }
    if (!reduced) await wait(STEP_MS);
  }
};

export const openEditDialog = (match: ApiMatch, opener: HTMLElement, details: DialogHandle): void => {
  let preview: { token: string; dependents: DependentPreview[]; confirmed: number } | null = null;
  const run: TraceRun = { dependents: [], reversed: false };

  openDialog({
    title: 'Edit result',
    opener,
    build: (dialog) => {
      const upper = h('input', {
        type: 'number',
        min: '0',
        max: '99',
        'aria-label': `${upperName(match)} games`,
        value: String(match.upper_games ?? 0),
      }) as HTMLInputElement;
      const lower = h('input', {
        type: 'number',
        min: '0',
        max: '99',
        'aria-label': `${lowerName(match)} games`,
        value: String(match.lower_games ?? 0),
      }) as HTMLInputElement;
      const count = h('div', { role: 'status', 'aria-label': 'Reset count', class: 'reset-count' });
      const list = h('ul', { role: 'list', 'aria-label': 'Matches that will reset', class: 'reset-list' });
      const review = h('button', { type: 'button', class: 'primary' }, 'Review edit') as HTMLButtonElement;
      const confirm = h('button', { type: 'button', class: 'primary' }, 'Confirm edit') as HTMLButtonElement;
      const cancel = h('button', { type: 'button' }, 'Cancel') as HTMLButtonElement;
      confirm.hidden = true;

      const resetReview = (): void => {
        if (preview === null) return;
        confirm.hidden = true;
        run.reversed = true;
        const previous = preview.dependents;
        preview = null;
        count.textContent = '';
        list.replaceChildren();
        void reverseTrace(previous);
      };
      upper.addEventListener('input', resetReview);
      lower.addEventListener('input', resetReview);

      review.addEventListener('click', () => {
        const current = Number(upper.value);
        const currentLower = Number(lower.value);
        dialog.setPending(true, [review, cancel]);
        api
          .editPreview(match.id, current, currentLower, match.version)
          .then(async (response) => {
            dialog.setPending(false, [review, cancel]);
            preview = {
              token: response.preview_token,
              dependents: response.dependents,
              confirmed: response.confirmed_count,
            };
            run.dependents = response.dependents;
            run.reversed = false;
            list.replaceChildren();
            confirm.hidden = false;
            await runTrace(run, match.id, list, count, response.confirmed_count);
          })
          .catch((error: unknown) => {
            dialog.setPending(false, [review, cancel]);
            if (error instanceof ApiError) dialogError(dialog, error.message);
          });
      });

      confirm.addEventListener('click', () => {
        const token = preview?.token;
        if (token === undefined) return;
        for (const dependent of run.dependents) {
          const card = cardFor(dependent.match_id);
          if (card !== null) card.dataset.shutter = 'closed';
        }
        dialog.setPending(true, [confirm, cancel, review]);
        api
          .edit(match.id, Number(upper.value), Number(lower.value), token)
          .then(() => {
            dialog.setPending(false, [confirm, cancel, review]);
            clearTrace();
            const card = cardFor(match.id);
            dialog.close(false);
            details.close(false);
            const region = document.querySelector<HTMLElement>('[data-your-action]');
            if (region !== null) region.textContent = YOUR_ACTION.resultEdited;
            card?.focus();
          })
          .catch((error: unknown) => {
            dialog.setPending(false, [confirm, cancel, review]);
            if (error instanceof ApiError) dialogError(dialog, error.message);
          });
      });

      cancel.addEventListener('click', () => {
        run.reversed = true;
        void reverseTrace(run.dependents);
        dialog.close();
      });

      return [
        h(
          'div',
          { class: 'score-fields' },
          h('label', { class: 'field' }, h('span', {}, `${upperName(match)} games`), upper),
          h('label', { class: 'field' }, h('span', {}, `${lowerName(match)} games`), lower),
        ),
        h('div', { class: 'dialog-buttons' }, review, confirm, cancel),
        count,
        list,
      ];
    },
    onEscape: () => {
      run.reversed = true;
      void reverseTrace(run.dependents);
      return true;
    },
  });
};

const upperName = (match: ApiMatch): string =>
  match.upper !== null && 'name' in match.upper ? match.upper.name : 'to be decided';
const lowerName = (match: ApiMatch): string =>
  match.lower !== null && 'name' in match.lower ? match.lower.name : 'to be decided';
