import { clear, el, focusableIn, trapTab } from '../../shared/dom.js';
import { paperGround } from '../../shared/paper.js';

/** A perforated stamp-card pinned into a corner of the screen. */
export class StampCard {
  readonly root: HTMLElement;
  readonly body: HTMLElement;
  readonly tab: HTMLButtonElement;

  constructor(
    readonly label: string,
    corner: string,
  ) {
    this.body = el('div', { class: 'card-body' });
    this.root = el(
      'aside',
      {
        role: 'complementary',
        'aria-label': label,
        class: `stamp-card perforated card-${corner}`,
      },
      [el('h2', { class: 'card-heading' }, [label]), this.body],
    );
    this.tab = el(
      'button',
      { type: 'button', class: 'card-tab', 'aria-expanded': 'false' },
      [label],
    );
    paperGround(this.root);
  }

  setOpen(open: boolean): void {
    this.root.classList.toggle('sheet-open', open);
    this.tab.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
}

export interface DialogOptions {
  label: string;
  role?: 'dialog' | 'alertdialog';
  className?: string;
  onEscape?: () => void;
}

/** A paper dialog over the canvas: focus moves in, Tab stays in, Escape gives focus back. */
export class PaperDialog {
  readonly root: HTMLElement;
  readonly body: HTMLElement;
  private opener: HTMLElement | null = null;
  private readonly onEscape?: () => void;

  constructor(options: DialogOptions) {
    this.body = el('div', { class: 'dialog-body' });
    this.root = el(
      'div',
      {
        role: options.role ?? 'dialog',
        'aria-modal': 'true',
        'aria-label': options.label,
        class: `paper-dialog perforated ${options.className ?? ''}`.trim(),
        hidden: true,
      },
      [this.body],
    );
    this.onEscape = options.onEscape;
    paperGround(this.root);
    this.root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        if (this.onEscape) this.onEscape();
        else this.close();
        return;
      }
      trapTab(this.root, event);
    });
  }

  relabel(label: string): void {
    this.root.setAttribute('aria-label', label);
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  show(opener: HTMLElement | null, startOn?: HTMLElement): void {
    this.opener = opener;
    this.root.hidden = false;
    const target = startOn ?? focusableIn(this.body)[0];
    target?.focus();
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.opener?.focus();
  }

  replace(children: Array<Node | string>): void {
    clear(this.body);
    for (const child of children) this.body.append(child);
  }
}

export interface TouchHooks {
  onWalk: (sign: number) => void;
  onTurn: (sign: number) => void;
  onJump: () => void;
}

/** The on-screen stick and jump button a phone courier plays with. */
export class TouchControls {
  readonly stick: HTMLElement;
  readonly jump: HTMLButtonElement;
  private readonly knob: HTMLElement;
  private pointer: number | null = null;
  private centre = { x: 0, y: 0 };

  constructor(hooks: TouchHooks) {
    this.knob = el('span', { class: 'stick-knob' });
    this.stick = el('div', { role: 'group', 'aria-label': 'Move stick', class: 'move-stick' }, [
      this.knob,
    ]);
    this.jump = el('button', { type: 'button', class: 'jump-button', 'aria-label': 'Jump' }, [
      el('span', { 'aria-hidden': 'true', class: 'jump-arrow' }, ['\u2191']),
    ]);
    this.jump.addEventListener('click', () => hooks.onJump());

    const recentre = (): void => {
      this.knob.style.transform = 'translate(0px, 0px)';
      hooks.onWalk(0);
      hooks.onTurn(0);
    };
    this.stick.addEventListener('pointerdown', (event) => {
      this.pointer = event.pointerId;
      const box = this.stick.getBoundingClientRect();
      this.centre = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      this.stick.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    this.stick.addEventListener('pointermove', (event) => {
      if (this.pointer !== event.pointerId) return;
      const reach = this.stick.clientWidth / 2;
      const dx = Math.max(-reach, Math.min(reach, event.clientX - this.centre.x));
      const dy = Math.max(-reach, Math.min(reach, event.clientY - this.centre.y));
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
      hooks.onWalk(-dy / reach);
      hooks.onTurn(Math.abs(dx) < reach * 0.2 ? 0 : Math.sign(dx));
    });
    for (const ending of ['pointerup', 'pointercancel'] as const) {
      this.stick.addEventListener(ending, (event) => {
        if (this.pointer !== event.pointerId) return;
        this.pointer = null;
        recentre();
      });
    }
  }
}

export const coarsePointer = (): boolean => window.matchMedia('(pointer: coarse)').matches;
