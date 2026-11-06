import type { BlockStyle } from '../../shared/types.js';
import { el, escapeCloses, icon, trapFocus } from '../dom.js';
import type { PageView } from './page.js';
import type { EditorSession } from './session.js';

export interface ToolbarActions {
  comment: () => void;
  find: () => void;
  acceptAll: () => void;
  rejectAll: () => void;
  link: () => void;
  outline: () => void;
  share: () => void;
}

const STYLE_OPTIONS: [BlockStyle, string][] = [
  ['title', 'Title'],
  ['heading1', 'Heading 1'],
  ['heading2', 'Heading 2'],
  ['heading3', 'Heading 3'],
  ['paragraph', 'Paragraph'],
  ['bullet', 'Bulleted item'],
  ['numbered', 'Numbered item'],
];

/** The Formatting toolbar, folded into one menu button on a phone. */
export class Toolbar {
  readonly element: HTMLElement;
  readonly menuButton: HTMLButtonElement;
  private readonly bold: HTMLButtonElement;
  private readonly italic: HTMLButtonElement;
  private readonly underline: HTMLButtonElement;
  private readonly linkButton: HTMLButtonElement;
  private readonly styleSelect: HTMLSelectElement;
  private readonly acceptAll: HTMLButtonElement;
  private readonly rejectAll: HTMLButtonElement;
  private menu: HTMLElement | null = null;

  constructor(
    private readonly session: EditorSession,
    private readonly page: PageView,
    private readonly actions: ToolbarActions,
  ) {
    this.bold = el('button', { type: 'button', class: 'tool', 'aria-label': 'Bold', 'aria-pressed': 'false' }, [icon('bold')]);
    this.italic = el('button', { type: 'button', class: 'tool', 'aria-label': 'Italic', 'aria-pressed': 'false' }, [icon('italic')]);
    this.underline = el('button', { type: 'button', class: 'tool', 'aria-label': 'Underline', 'aria-pressed': 'false' }, [
      icon('underline'),
    ]);
    this.linkButton = el('button', { type: 'button', class: 'tool', 'aria-label': 'Link' }, [icon('link'), 'Link']);
    this.styleSelect = el('select', { class: 'tool-select', 'aria-label': 'Paragraph style' });
    for (const [value, label] of STYLE_OPTIONS) this.styleSelect.appendChild(el('option', { value, text: label }));
    this.acceptAll = el('button', { type: 'button', class: 'tool', 'aria-label': 'Accept all' }, [icon('check-check'), 'Accept all']);
    this.rejectAll = el('button', { type: 'button', class: 'tool', 'aria-label': 'Reject all' }, [icon('x'), 'Reject all']);

    this.bold.addEventListener('click', () => this.page.toggleMark('bold'));
    this.italic.addEventListener('click', () => this.page.toggleMark('italic'));
    this.underline.addEventListener('click', () => this.page.toggleMark('underline'));
    this.linkButton.addEventListener('click', () => actions.link());
    this.styleSelect.addEventListener('change', () => this.page.setBlockStyle(this.styleSelect.value as BlockStyle));
    this.acceptAll.addEventListener('click', () => actions.acceptAll());
    this.rejectAll.addEventListener('click', () => actions.rejectAll());

    const comment = el('button', { type: 'button', class: 'tool', 'aria-label': 'Comment' }, [icon('message-square'), 'Comment']);
    comment.addEventListener('click', () => actions.comment());
    const find = el('button', { type: 'button', class: 'tool', 'aria-label': 'Find and replace' }, [
      icon('search'),
      'Find and replace',
    ]);
    find.addEventListener('click', () => actions.find());

    this.element = el('div', { class: 'toolbar', role: 'toolbar', 'aria-label': 'Formatting' }, [
      this.bold,
      this.italic,
      this.underline,
      this.linkButton,
      this.styleSelect,
      comment,
      find,
      this.acceptAll,
      this.rejectAll,
    ]);

    this.menuButton = el('button', { type: 'button', class: 'chrome-button toolbar-button', 'aria-label': 'Toolbar' }, [
      icon('menu'),
      'Toolbar',
    ]);
    this.menuButton.addEventListener('click', () => this.toggleMenu());
  }

  private toggleMenu(): void {
    if (this.menu) {
      this.closeMenu();
      return;
    }
    const items: [string, () => void][] = [
      ['Bold', () => this.page.toggleMark('bold')],
      ['Italic', () => this.page.toggleMark('italic')],
      ['Underline', () => this.page.toggleMark('underline')],
      ['Link', () => this.actions.link()],
      ['Paragraph style', () => this.revealStyle()],
      ['Comment', () => this.actions.comment()],
      ['Find and replace', () => this.actions.find()],
      ['Accept all', () => this.actions.acceptAll()],
      ['Reject all', () => this.actions.rejectAll()],
      ['Outline', () => this.actions.outline()],
      ['Share', () => this.actions.share()],
    ];
    const menu = el('div', { class: 'menu', role: 'menu', 'aria-label': 'Toolbar' });
    const buttons: HTMLButtonElement[] = [];
    for (const [label, action] of items) {
      const item = el('button', { type: 'button', role: 'menuitem', class: 'menu-item', text: label, tabindex: '-1' });
      item.addEventListener('click', () => {
        if (label !== 'Paragraph style') this.closeMenu();
        action();
      });
      buttons.push(item);
      menu.appendChild(item);
    }
    menu.appendChild(this.styleSelect);
    this.styleSelect.hidden = true;
    menu.addEventListener('keydown', (event) => {
      const key = event as KeyboardEvent;
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (key.key === 'ArrowDown') {
        key.preventDefault();
        buttons[(index + 1 + buttons.length) % buttons.length]?.focus();
      } else if (key.key === 'ArrowUp') {
        key.preventDefault();
        buttons[(index - 1 + buttons.length) % buttons.length]?.focus();
      }
    });
    trapFocus(menu);
    escapeCloses(menu, () => this.closeMenu());
    this.menu = menu;
    this.menuButton.setAttribute('aria-expanded', 'true');
    this.menuButton.parentElement?.appendChild(menu);
    buttons[0]?.focus();
  }

  private revealStyle(): void {
    this.styleSelect.hidden = false;
    this.styleSelect.focus();
  }

  closeMenu(): void {
    if (!this.menu) return;
    this.menu.remove();
    this.menu = null;
    this.styleSelect.hidden = false;
    this.element.appendChild(this.styleSelect);
    this.menuButton.setAttribute('aria-expanded', 'false');
    this.menuButton.focus();
  }

  update(): void {
    const editing = this.session.mode === 'editing' && this.session.canEdit && this.session.editable;
    const marks = this.page.marksAt(this.page.selection);
    this.bold.setAttribute('aria-pressed', marks.has('bold') ? 'true' : 'false');
    this.italic.setAttribute('aria-pressed', marks.has('italic') ? 'true' : 'false');
    this.underline.setAttribute('aria-pressed', marks.has('underline') ? 'true' : 'false');
    for (const control of [this.bold, this.italic, this.underline, this.linkButton]) control.disabled = !editing;
    this.styleSelect.disabled = !editing;
    this.styleSelect.value = this.page.blockStyleAt(this.page.selection.at);
    const canDecide = this.session.canEdit && this.session.accessEnded === null;
    this.acceptAll.disabled = !canDecide;
    this.rejectAll.disabled = !canDecide;
  }
}
