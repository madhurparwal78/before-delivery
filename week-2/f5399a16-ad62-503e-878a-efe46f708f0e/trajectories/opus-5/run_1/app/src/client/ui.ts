import { COPY } from '../domain/copy.js';
import { closeSurface, isPending, openSurfaces, redraw, state } from './app.js';
import type { Surface } from './app.js';
import type { Child } from './dom.js';
import { h } from './dom.js';
import { QUICK, NORMAL, animate, reducedMotion } from './motion.js';

export type PressProps = {
  id: string;
  label: string;
  onPress: (event: Event) => void;
  pendingKey?: string;
  kind?: 'primary' | 'plain' | 'quiet';
  disabledLook?: boolean;
  describedBy?: string;
  extra?: Record<string, unknown>;
  working?: string;
};

/** A button whose text and accessible name read `Working…` while its request is open. */
export function button(props: PressProps): Child {
  const busy = props.pendingKey !== undefined && isPending(props.pendingKey);
  const working = props.working ?? 'Working…';
  const label = busy ? working : props.label;
  return h(
    'button',
    {
      key: props.id,
      id: props.id,
      type: 'button',
      class: `button button--${props.kind ?? 'plain'}`,
      'aria-disabled': busy || props.disabledLook === true ? 'true' : undefined,
      ...(props.describedBy === undefined ? {} : { 'aria-describedby': props.describedBy }),
      onclick: (event: Event) => {
        if (busy || props.disabledLook === true) {
          event.preventDefault();
          return;
        }
        props.onPress(event);
      },
      ...(props.extra ?? {}),
    },
    label,
  );
}

export function link(
  address: string,
  label: Child,
  extra: Record<string, unknown> = {},
): Child {
  return h('a', { href: address, class: 'link', ...extra }, label);
}

export type FieldProps = {
  id: string;
  label: string;
  value: string;
  onInput: (value: string) => void;
  problem?: string | undefined;
  autocomplete?: string;
  kind?: 'text' | 'password' | 'email' | 'tel' | 'multiline';
  describedBy?: string;
  extra?: Record<string, unknown>;
};

export function field(props: FieldProps): Child {
  const messageId = `${props.id}-message`;
  const shared = {
    id: props.id,
    name: props.id,
    class: 'input',
    value: props.value,
    'aria-invalid': props.problem === undefined ? undefined : 'true',
    'aria-describedby': props.problem === undefined ? props.describedBy : messageId,
    ...(props.autocomplete === undefined ? {} : { autocomplete: props.autocomplete }),
    oninput: (event: Event) => {
      props.onInput((event.target as HTMLInputElement).value);
    },
    ...(props.extra ?? {}),
  };
  return h(
    'div',
    { key: props.id, class: 'field' },
    h('label', { class: 'field__label', for: props.id }, props.label),
    props.kind === 'multiline'
      ? h('textarea', { ...shared, rows: 4 }, props.value)
      : h('input', { ...shared, type: props.kind ?? 'text' }),
    props.problem === undefined
      ? null
      : h('p', { id: messageId, class: 'field__problem' }, redBar(), props.problem),
  );
}

export type Option = { value: string; label: string };

export function combobox(props: {
  id: string;
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  problem?: string | undefined;
  hideLabel?: boolean;
}): Child {
  const messageId = `${props.id}-message`;
  return h(
    'div',
    { key: props.id, class: 'field' },
    h(
      'label',
      { class: props.hideLabel === true ? 'visually-hidden' : 'field__label', for: props.id },
      props.label,
    ),
    h(
      'select',
      {
        id: props.id,
        name: props.id,
        class: 'input',
        selectedValue: props.value,
        'aria-invalid': props.problem === undefined ? undefined : 'true',
        'aria-describedby': props.problem === undefined ? undefined : messageId,
        onchange: (event: Event) => props.onChange((event.target as HTMLSelectElement).value),
      },
      ...props.options.map((option) =>
        h('option', { key: option.value, value: option.value }, option.label),
      ),
    ),
    props.problem === undefined
      ? null
      : h('p', { id: messageId, class: 'field__problem' }, redBar(), props.problem),
  );
}

/** Errors carry a text-sized red bar plus words, never colour alone. */
export function redBar(): Child {
  return h('span', { class: 'red-bar', 'aria-hidden': 'true' });
}

/** Every refused form also shows its problems with links that move focus to the fields. */
export function problemsRegion(
  problems: Record<string, string>,
  options: { heading?: string; withLinks?: boolean; message?: string | null } = {},
): Child {
  const entries = Object.entries(problems);
  if (entries.length === 0 && (options.message ?? null) === null) return null;
  const heading = options.heading ?? 'Problems';
  return h(
    'div',
    { key: 'problems', class: 'problems', role: 'region', 'aria-label': heading, tabindex: '-1' },
    h('h2', { class: 'problems__heading' }, redBar(), heading),
    (options.message ?? null) === null
      ? null
      : h('p', { class: 'problems__message' }, options.message as string),
    entries.length === 0
      ? null
      : h(
          'ul',
          { class: 'problems__list' },
          ...entries.map(([name, message]) =>
            h(
              'li',
              { key: name },
              options.withLinks === false
                ? message
                : h(
                    'a',
                    {
                      href: `#${name}`,
                      class: 'link',
                      onclick: (event: Event) => {
                        event.preventDefault();
                        document.getElementById(name)?.focus();
                      },
                    },
                    message,
                  ),
            ),
          ),
        ),
  );
}

/** Empty states are one big cropped ink bar and one sentence. */
export function emptyState(sentence: string): Child {
  return h(
    'div',
    { key: 'empty', class: 'empty' },
    h('span', { class: 'empty__bar', 'aria-hidden': 'true' }),
    h('p', { class: 'empty__words' }, sentence),
  );
}

/** Loading is three slanted bars filling in turn. */
export function loadingBars(label: string): Child {
  return h(
    'div',
    { key: 'loading', class: 'loading' },
    h('span', { class: 'loading__bar' }),
    h('span', { class: 'loading__bar' }),
    h('span', { class: 'loading__bar' }),
    h('span', { class: 'visually-hidden' }, label),
  );
}

/** The main action sits in a bar fixed to the bottom edge at 375x812. */
export function bottomBar(...children: Child[]): Child {
  if (children.every((child) => child === null || child === undefined || child === false)) {
    return null;
  }
  return h('div', { key: 'bottom-bar', class: 'bottom-bar' }, ...children);
}

export function surfaceView(
  surface: Surface,
  parts: { title: string; body: Child[]; footer?: Child[]; closeLabel?: string },
): Child {
  const closing = surface.phase === 'closing';
  const titleId = `surface-title-${surface.name.replace(/\W+/g, '-')}`;
  return h(
    'div',
    {
      key: `surface-${surface.name}`,
      class: `surface surface--${surface.kind}${surface.sheet === undefined ? '' : ` surface--sheet-${surface.sheet}`}`,
      'data-surface-name': surface.name,
      'data-surface': surface.kind,
      ...(surface.sheet === undefined ? {} : { 'data-sheet': surface.sheet }),
      ...(closing ? { inert: '', 'aria-hidden': 'true' } : {}),
    },
    h('div', {
      class: 'surface__behind',
      onpointerdown: (event: Event) => {
        if (surface.kind === 'sheet') {
          event.preventDefault();
          closeSurface(surface.name);
        }
      },
    }),
    h(
      'div',
      {
        class: 'surface__panel',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': titleId,
        tabindex: '-1',
        onkeydown: (event: Event) => trapKeys(event as KeyboardEvent, surface),
      },
      h(
        'div',
        { class: 'surface__head' },
        h('h2', { id: titleId, class: 'surface__title' }, parts.title),
        button({
          id: `close-${surface.name.replace(/\W+/g, '-')}`,
          label: parts.closeLabel ?? 'Close',
          kind: 'quiet',
          onPress: () => closeSurface(surface.name),
        }),
      ),
      h(
        'div',
        { class: 'surface__body' },
        ...parts.body,
        state.sessionEnded
          ? h(
              'p',
              { key: 'session-again' },
              h('a', { href: '/sign-in', class: 'link' }, 'Sign in again'),
            )
          : null,
      ),
      parts.footer === undefined
        ? null
        : h('div', { class: 'surface__foot' }, ...parts.footer),
    ),
  );
}

/** Tab and Shift+Tab stay inside; Escape closes only the innermost open thing. */
function trapKeys(event: KeyboardEvent, surface: Surface): void {
  if (event.key === 'Escape') {
    if (state.menu !== null) {
      state.menu = null;
      redraw();
      event.stopPropagation();
      return;
    }
    event.stopPropagation();
    closeSurface(surface.name);
    return;
  }
  if (event.key !== 'Tab') return;
  const panel = event.currentTarget as HTMLElement;
  const stops = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.offsetParent !== null || element === document.activeElement,
  );
  if (stops.length === 0) return;
  const first = stops[0] as HTMLElement;
  const last = stops[stops.length - 1] as HTMLElement;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
    return;
  }
  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([type=hidden]), select, textarea, [tabindex="0"], [tabindex="-1"][data-focus-stop]';

/** A menu is never cut off: every item is fully on screen and pressable. */
export function menuView(): Child {
  const menu = state.menu;
  if (menu === null) return null;
  return h(
    'div',
    { key: 'menu', class: 'menu-layer' },
    h('div', {
      class: 'menu-layer__behind',
      onpointerdown: () => {
        state.menu = null;
        redraw();
      },
    }),
    h(
      'div',
      {
        class: 'menu',
        role: 'menu',
        'aria-label': menu.name,
        tabindex: '-1',
        onkeydown: (event: Event) => moveInMenu(event as KeyboardEvent, menu.opener),
      },
      ...menu.items.map((item, index) =>
        h(
          'button',
          {
            key: `item-${index}`,
            type: 'button',
            role: 'menuitem',
            class: 'menu__item',
            tabindex: index === 0 ? '0' : '-1',
            onclick: () => {
              state.menu = null;
              item.run();
            },
          },
          item.label,
        ),
      ),
    ),
  );
}

function moveInMenu(event: KeyboardEvent, opener: string): void {
  const menu = event.currentTarget as HTMLElement;
  const items = [...menu.querySelectorAll<HTMLElement>('[role=menuitem]')];
  const at = items.indexOf(document.activeElement as HTMLElement);
  if (event.key === 'Escape') {
    event.stopPropagation();
    state.menu = null;
    redraw();
    document.getElementById(opener)?.focus();
    return;
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const next = items[(at + step + items.length) % items.length];
    next?.focus();
    return;
  }
  if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault();
    (event.key === 'Home' ? items[0] : items[items.length - 1])?.focus();
  }
}

export function openMenu(
  name: string,
  opener: string,
  items: { label: string; run: () => void }[],
): void {
  state.menu = { name, opener, payload: {}, items };
  redraw();
  requestAnimationFrame(() => {
    const layer = document.querySelector('.menu');
    const openerElement = document.getElementById(opener);
    if (layer instanceof HTMLElement && openerElement instanceof HTMLElement) {
      placeMenu(layer, openerElement);
      layer.querySelector<HTMLElement>('[role=menuitem]')?.focus();
      animate(layer, [{ opacity: 0 }, { opacity: 1 }], QUICK);
    }
  });
}

function placeMenu(menu: HTMLElement, opener: HTMLElement): void {
  const box = opener.getBoundingClientRect();
  const size = menu.getBoundingClientRect();
  const margin = 8;
  const left = Math.max(
    margin,
    Math.min(box.left, window.innerWidth - size.width - margin),
  );
  const below = box.bottom + size.height + margin < window.innerHeight;
  const top = below ? box.bottom + 4 : Math.max(margin, box.top - size.height - 4);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

/** The refresh line shows directly under the level-one heading. */
export function refreshLine(copy: string = COPY.refreshFailed): Child {
  if (!state.refreshFailed) return null;
  return h('p', { key: 'refresh-line', class: 'refresh-line' }, redBar(), copy);
}

export function playSurfaceEntries(): void {
  if (reducedMotion()) return;
  for (const surface of openSurfaces()) {
    const panel = document.querySelector(
      `[data-surface-name="${surface.name.replace(/["\\]/g, '\\$&')}"] .surface__panel`,
    );
    if (!(panel instanceof HTMLElement) || panel.dataset['entered'] === 'yes') continue;
    panel.dataset['entered'] = 'yes';
    const style = getComputedStyle(panel);
    const from = style.getPropertyValue('--enter-from').trim() || 'translateY(100%)';
    animate(panel, [{ transform: from, opacity: 0 }, { transform: 'none', opacity: 1 }], NORMAL);
  }
}

/**
 * The level-one heading reveals line by line and has one whole accessible name,
 * so the lines are keyed by their words and re-reveal on each new screen.
 */
export function headingNode(lines: readonly string[]): Child {
  return h(
    'h1',
    { key: 'heading', class: 'h1', id: 'screen-heading', tabindex: '-1' },
    ...lines.flatMap((line, index) => [
      index > 0 ? ' ' : null,
      h(
        'span',
        {
          key: `${index}:${line}`,
          'data-part': 'heading-line',
          style: `--line:${index}`,
        },
        line,
      ),
    ]),
  );
}

export function tableFrame(label: string, ...children: Child[]): Child {
  return h(
    'div',
    {
      key: `frame-${label}`,
      class: 'scroll-frame',
      role: 'region',
      'aria-label': label,
      tabindex: '0',
    },
    ...children,
  );
}
