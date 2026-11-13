import { announce } from '../core/announce';
import { el, on } from '../core/dom';
import { runMotion } from '../core/motion';

const STAR_LABELS = ['1 star', '2 stars', '3 stars', '4 stars', '5 stars'];

export interface ChoiceGroup {
  element: HTMLElement;
  value(): number | null;
  firstRadio(): HTMLElement;
}

/** Five star radios worked by arrow keys, Home and End. */
export function starRadiogroup(groupName: string, initial: number | null = null): ChoiceGroup {
  const group = el('div', { role: 'radiogroup', 'aria-label': groupName, class: 'stars' });
  const radios: HTMLElement[] = [];
  let chosen = initial;

  const paint = (): void => {
    for (const [index, radio] of radios.entries()) {
      const selected = chosen === index + 1;
      radio.setAttribute('aria-checked', selected ? 'true' : 'false');
      radio.tabIndex = chosen === null ? (index === 0 ? 0 : -1) : selected ? 0 : -1;
      radio.classList.toggle('filled', chosen !== null && index + 1 <= chosen);
    }
  };

  const choose = (value: number, moveFocus: boolean): void => {
    chosen = value;
    paint();
    if (moveFocus) radios[value - 1]?.focus();
    runMotion(group, 'star-fill', 'running', 'done');
    announce(`${groupName}: ${value} of 5`);
  };

  for (const [index, label] of STAR_LABELS.entries()) {
    const radio = el('span', { role: 'radio', 'aria-label': label, class: 'star', tabindex: index === 0 ? 0 : -1 }, [
      el('span', { 'aria-hidden': 'true', text: '★' }),
    ]);
    on(radio, 'click', () => choose(index + 1, true));
    on(radio, 'keydown', (event) => {
      if (event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault();
        choose(index + 1, false);
        return;
      }
      const wrapNext = index + 2 > 5 ? 1 : index + 2;
      const wrapPrevious = index < 1 ? 5 : index;
      const moves: Record<string, number | undefined> = {
        ArrowRight: wrapNext,
        ArrowUp: wrapNext,
        ArrowLeft: wrapPrevious,
        ArrowDown: wrapPrevious,
        Home: 1,
        End: 5,
      };
      const next = moves[event.key];
      if (next === undefined) return;
      event.preventDefault();
      choose(next, true);
    });
    radios.push(radio);
    group.append(radio);
  }
  paint();

  return { element: group, value: () => chosen, firstRadio: () => radios[0] as HTMLElement };
}

export interface NamedChoiceGroup {
  element: HTMLElement;
  value(): string | null;
  firstRadio(): HTMLElement;
}

export function choiceRadiogroup(
  groupName: string,
  choices: ReadonlyArray<{ id: string; label: string }>,
  initial: string | null = null,
): NamedChoiceGroup {
  const group = el('div', { role: 'radiogroup', 'aria-label': groupName, class: 'radio-row' });
  const radios: HTMLElement[] = [];
  let chosen = initial;

  const paint = (): void => {
    for (const [index, radio] of radios.entries()) {
      const selected = chosen === choices[index]?.id;
      radio.setAttribute('aria-checked', selected ? 'true' : 'false');
      radio.tabIndex = chosen === null ? (index === 0 ? 0 : -1) : selected ? 0 : -1;
      radio.classList.toggle('chosen', selected);
    }
  };

  const choose = (index: number, moveFocus: boolean): void => {
    chosen = choices[index]?.id ?? null;
    paint();
    if (moveFocus) radios[index]?.focus();
    group.dispatchEvent(new CustomEvent('choice', { detail: chosen }));
  };

  for (const [index, choice] of choices.entries()) {
    const radio = el('span', {
      role: 'radio',
      'aria-label': choice.label,
      class: 'radio',
      tabindex: index === 0 ? 0 : -1,
      text: choice.label,
    });
    on(radio, 'click', () => choose(index, true));
    on(radio, 'keydown', (event) => {
      if (event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault();
        choose(index, false);
        return;
      }
      const step =
        event.key === 'ArrowRight' || event.key === 'ArrowDown'
          ? 1
          : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
            ? -1
            : 0;
      if (step === 0) return;
      event.preventDefault();
      choose((index + step + choices.length) % choices.length, true);
    });
    radios.push(radio);
    group.append(radio);
  }
  paint();

  return { element: group, value: () => chosen, firstRadio: () => radios[0] as HTMLElement };
}
