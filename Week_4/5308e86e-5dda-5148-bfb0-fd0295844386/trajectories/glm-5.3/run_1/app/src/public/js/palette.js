// The command palette: opens on Control+K or Command+K from any cockpit
// control, lists pages and recipients with latest-answer-wins.
import { el, api, ApiError } from './app.js';

const PAGES = [
  ['Approvals', '/approvals'],
  ['Send payment', '/payments/new'],
  ['Recipients', '/payments/recipients'],
  ['Payments', '/payments'],
  ['Invoicing', '/invoices'],
  ['Loans', '/loans'],
];

export class CommandPalette {
  constructor(cockpit) {
    this.cockpit = cockpit;
    this.open = false;
    this.seq = 0;
    document.addEventListener('keydown', (e) => {
      const isK = e.key === 'k' || e.key === 'K';
      if ((e.ctrlKey || e.metaKey) && isK) {
        e.preventDefault();
        if (this.open || this.cockpit.anyDialogOpen?.()) return;
        this.show();
      }
    });
  }

  show() {
    if (this.open) return;
    this.open = true;
    const backdrop = el('div', { class: 'dialog-backdrop' });
    const dialog = el('div', { class: 'dialog dialog-wide', role: 'dialog', 'aria-label': 'Command palette' });
    const input = el('input', {
      class: 'input',
      'aria-label': 'Search commands',
      placeholder: 'Search commands',
      autocomplete: 'off',
    });
    this.input = input;
    this.list = el('div', { role: 'listbox', 'aria-label': 'Matches' });
    dialog.append(el('h2', { text: 'Command palette' }), input, this.list);
    backdrop.append(dialog);
    document.body.append(backdrop);
    this.backdrop = backdrop;
    this.dialog = dialog;
    this.prevFocus = document.activeElement;

    const move = (dir) => {
      this.setHighlight(this.highlight + dir);
    };
    input.addEventListener('input', () => this.schedule());
    dialog.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.hide();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        move(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        move(-1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this.activateCurrent();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        move(e.shiftKey ? -1 : 1);
      }
    });
    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop) this.hide();
    });
    input.focus();
    this.render([], []);
  }

  hide() {
    if (!this.open) return;
    this.open = false;
    this.backdrop?.remove();
    if (this.timer) clearTimeout(this.timer);
    if (this.prevFocus && this.prevFocus.isConnected) this.prevFocus.focus();
    else if (this.cockpit.searchInput) this.cockpit.searchInput.focus();
  }

  schedule() {
    if (this.timer) clearTimeout(this.timer);
    const text = this.input.value;
    if (text.trim().length < 2) {
      this.seq++;
      this.renderPagesOnly(text);
      return;
    }
    this.timer = setTimeout(() => this.run(text), 250);
  }

  async run(text) {
    const seq = ++this.seq;
    this.recipientsPending = true;
    this.renderPagesOnly(text);
    try {
      const res = await api('GET', `/api/search?q=${encodeURIComponent(text)}`);
      if (seq !== this.seq) return;
      this.recipientsPending = false;
      this.render(res.recipients.filter(r => r.status === 'active'), text);
    } catch {
      if (seq === this.seq) {
        this.recipientsPending = false;
        this.render([], text);
      }
    }
  }

  renderPagesOnly(text) {
    this.render([], text);
  }

  matchingPages(text) {
    const q = text.trim().toLowerCase();
    if (!q) return PAGES.map(p => p);
    return PAGES.filter(([name]) => name.toLowerCase().includes(q));
  }

  render(recipients, text) {
    const items = [];
    const pages = this.matchingPages(text);
    for (const [name, href] of pages) {
      items.push({ kind: 'page', label: name, href });
    }
    this.items = items;
    this.list.textContent = '';
    const q = text.trim();
    if (q.length >= 2 && recipients.length > 0) {
      const group = el('div', { class: 'command-group-label', text: 'Recipients' });
      this.list.append(group);
      for (const r of recipients) {
        const item = { kind: 'recipient', label: r.display_name, href: `/payments/new?recipient=${r.id}` };
        this.items.push(item);
        const btn = el('button', { class: 'command-option', role: 'option', text: r.display_name, onclick: () => this.openTarget(item) });
        this.list.append(btn);
      }
    }
    if (pages.length > 0) {
      const group = el('div', { class: 'command-group-label', text: 'Pages' });
      this.list.append(group);
      for (const [name, href] of pages) {
        const item = { kind: 'page', label: name, href };
        const btn = el('button', { class: 'command-option', role: 'option', text: name, onclick: () => this.openTarget(item) });
        this.list.append(btn);
      }
    }
    this.buttons = Array.from(this.list.querySelectorAll('button'));
    this.highlight = this.buttons.length > 0 ? 0 : -1;
    this.setHighlight(this.highlight);
  }

  setHighlight(i) {
    if (!this.buttons) return;
    if (this.buttons.length === 0) { this.highlight = -1; return; }
    this.highlight = ((i % this.buttons.length) + this.buttons.length) % this.buttons.length;
    this.buttons.forEach((b, idx) => b.setAttribute('aria-selected', String(idx === this.highlight)));
  }

  activateCurrent() {
    if (this.highlight < 0 || !this.buttons || !this.buttons[this.highlight]) return;
    this.buttons[this.highlight].click();
  }

  openTarget(item) {
    this.hide();
    window.location.href = item.href;
  }
}
