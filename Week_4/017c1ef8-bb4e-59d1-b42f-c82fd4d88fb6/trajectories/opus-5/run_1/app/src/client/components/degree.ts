import { DEGREE_LABELS, DEGREE_NUMERALS, mutualLineText } from '../../shared/format';
import { h, prefersReducedMotion } from '../dom';

export type MutualData = { count: number; named?: { id: string; name: string; handle: string } };

export type DegreeBlockHandle = {
  node: HTMLElement;
  actionRow: HTMLElement;
  update: (degree: string, mutual: MutualData, handle: string, actions: () => HTMLElement[]) => void;
};

/**
 * The Degree Roll. The numeral sits in a fixed slot that hides anything outside
 * it; the mutual line settles after it, and the degree-only actions follow.
 */
export function degreeBlock(
  degree: string,
  mutual: MutualData,
  profileHandle: string,
  actions: () => HTMLElement[],
): DegreeBlockHandle {
  const slot = h('div', { class: 'numeral-slot' });
  const numeral = h('span', {
    'data-degree-roll': '',
    'data-degree': degree,
    class: 'numeral',
    text: DEGREE_NUMERALS[degree] ?? '—',
  });
  slot.append(numeral);
  const label = h('span', {
    'data-degree-badge': '',
    'data-degree': degree,
    class: 'degree-label tabular',
    text: DEGREE_LABELS[degree] ?? '',
  });
  const mutualLine = h('a', {
    href: `/in/${profileHandle}/mutual`,
    'data-mutual-line': '',
    'data-count': String(mutual.count),
    class: 'mutual-line',
    text: mutualLineText(mutual.count, mutual.named?.name ?? null),
  });
  const actionRow = h('div', { class: 'action-row' });
  for (const action of actions()) actionRow.append(action);

  const node = h('div', { class: 'degree-block' }, [slot, label, mutualLine]);
  let current = degree;
  let currentNumeral = numeral;

  return { node, actionRow, update };

  function update(
    nextDegree: string,
    nextMutual: MutualData,
    nextHandle: string,
    nextActions: () => HTMLElement[],
  ): void {
    const rank = (value: string): number => (value === 'out' ? 4 : Number(value));
    const dropped = rank(nextDegree) > rank(current);
    if (dropped) actionRow.replaceChildren();

    const setLabel = (): void => {
      label.textContent = DEGREE_LABELS[nextDegree] ?? '';
      label.setAttribute('data-degree', nextDegree);
    };
    const setMutual = (): void => {
      mutualLine.setAttribute('href', `/in/${nextHandle}/mutual`);
      mutualLine.setAttribute('data-count', String(nextMutual.count));
      mutualLine.textContent = mutualLineText(nextMutual.count, nextMutual.named?.name ?? null);
    };
    const setActions = (): void => {
      actionRow.replaceChildren();
      for (const action of nextActions()) actionRow.append(action);
      if (!prefersReducedMotion()) actionRow.classList.add('fade-in');
    };

    if (nextDegree === current) {
      setMutual();
      setActions();
      return;
    }

    const fresh = h('span', {
      'data-degree-roll': '',
      'data-degree': nextDegree,
      class: 'numeral',
      text: DEGREE_NUMERALS[nextDegree] ?? '—',
    });
    setLabel();

    if (prefersReducedMotion()) {
      currentNumeral.remove();
      slot.append(fresh);
      currentNumeral = fresh;
      current = nextDegree;
      setMutual();
      setActions();
      return;
    }

    currentNumeral.classList.add('rolling-out');
    fresh.classList.add('rolling-in');
    slot.append(fresh);
    const leaving = currentNumeral;
    currentNumeral = fresh;
    current = nextDegree;
    window.setTimeout(() => {
      leaving.remove();
      fresh.classList.remove('rolling-in');
    }, 480);
    window.setTimeout(() => {
      mutualLine.classList.add('reflow');
      setMutual();
      window.setTimeout(() => mutualLine.classList.remove('reflow'), 320);
    }, 280);
    window.setTimeout(setActions, 600);
  }
}
