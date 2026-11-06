import type { StatusBody, TrainStop } from './api';
import { append, clear, h, svg, trapFocus } from './dom';
import { ICON_PATHS } from './generated/icons';
import type { IconName } from './generated/icons';
import { chipKind, hourMinute } from './format';

export function icon(name: IconName): SVGElement {
  const node = svg('svg', {
    class: 'icon',
    viewBox: '0 0 24 24',
    'aria-hidden': 'true',
    focusable: 'false',
  });
  node.innerHTML = ICON_PATHS[name];
  return node;
}

/** Status chips look like counter stamps, with their label stored uppercase. */
export function statusChip(status: StatusBody, passengerNumber: number | null = null): HTMLElement {
  const kind = chipKind(status);
  const chip = h('span', {
    class: `chip chip--${kind}`,
    'data-chip-passenger': passengerNumber === null ? null : String(passengerNumber),
    'data-chip-kind': kind,
  }, [status.label.toUpperCase()]);
  return chip;
}

export interface RibbonStop {
  readonly code: string;
  readonly name: string;
  readonly time: string | null;
  readonly emphasis: boolean;
}

export function routeRibbon(stops: readonly RibbonStop[]): HTMLElement {
  const line = h('div', { class: 'ribbon__line' }, stops.map((stop) =>
    h('div', { class: `ribbon__stop${stop.emphasis ? ' ribbon__stop--end' : ''}` }, [
      h('span', { class: 'ribbon__code' }, [stop.code]),
      h('span', { class: 'ribbon__tick' }),
      h('span', { class: 'ribbon__name' }, [stop.name]),
      h('span', { class: 'ribbon__time' }, [stop.time ?? '']),
    ])));
  return h('div', { class: 'ribbon', role: 'region', 'aria-label': 'Route' }, [
    h('span', { class: 'ribbon__cap ribbon__cap--start', 'aria-hidden': 'true' }),
    h('div', { class: 'ribbon__frame', tabindex: '0' }, [line]),
    h('span', { class: 'ribbon__cap ribbon__cap--end', 'aria-hidden': 'true' }),
  ]);
}

export function ribbonStopsFromTrain(
  stops: readonly TrainStop[],
  fromCode: string,
  toCode: string,
): RibbonStop[] {
  return stops.map((stop) => ({
    code: stop.code,
    name: stop.name,
    time: hourMinute(stop.departure_at),
    emphasis: stop.code === fromCode || stop.code === toCode,
  }));
}

/** A polite status region or an assertive alert region, each holding one message at a time. */
export class LiveRegion {
  readonly element: HTMLElement;

  constructor(name: string, kind: 'status' | 'alert', className = 'live') {
    this.element = h('div', {
      role: kind,
      'aria-live': kind === 'alert' ? 'assertive' : 'polite',
      'aria-atomic': 'true',
      'aria-label': name,
      class: className,
    });
  }

  say(message: string): void {
    clear(this.element);
    if (message.length === 0) return;
    const lines = message.split('\n');
    for (const [index, line] of lines.entries()) {
      if (index > 0) this.element.appendChild(h('br'));
      this.element.appendChild(document.createTextNode(line));
    }
  }

  get text(): string {
    return this.element.textContent ?? '';
  }
}

export interface DialogOptions {
  readonly label: string;
  readonly onClose: () => void;
  readonly initialFocus?: () => HTMLElement | null;
}

/** A modal dialog: Tab stays inside, Escape closes, focus returns to the opener. */
export class Modal {
  readonly backdrop: HTMLElement;
  readonly dialog: HTMLElement;
  private readonly opener: HTMLElement | null;
  private readonly inert: HTMLElement[] = [];
  private closed = false;

  constructor(private readonly options: DialogOptions, content: Node[]) {
    this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.dialog = h('div', {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': options.label,
      class: 'dialog',
      tabindex: '-1',
    });
    append(this.dialog, content);
    this.backdrop = h('div', { class: 'backdrop' }, [this.dialog]);
    this.backdrop.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
        return;
      }
      trapFocus(this.dialog, event);
    });
    document.body.appendChild(this.backdrop);
    for (const child of [...document.body.children]) {
      if (child === this.backdrop || !(child instanceof HTMLElement)) continue;
      child.setAttribute('inert', '');
      child.setAttribute('aria-hidden', 'true');
      this.inert.push(child);
    }
    const focusTarget = options.initialFocus?.() ?? null;
    (focusTarget ?? this.dialog).focus();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const child of this.inert) {
      child.removeAttribute('inert');
      child.removeAttribute('aria-hidden');
    }
    this.backdrop.remove();
    this.opener?.focus();
    this.options.onClose();
  }

  get isClosed(): boolean {
    return this.closed;
  }
}
