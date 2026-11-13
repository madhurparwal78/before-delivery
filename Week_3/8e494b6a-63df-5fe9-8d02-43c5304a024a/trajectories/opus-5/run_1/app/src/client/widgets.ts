import { sheetRise } from './animate.js';
import { el, focusTrap } from './dom.js';
import { ApiFailure } from './state.js';

export function layoutBand(): 'phone' | 'tablet' | 'desk' {
  const width = window.innerWidth;
  if (width < 768) return 'phone';
  if (width < 1100) return 'tablet';
  return 'desk';
}

export type Dialog = { node: HTMLElement; close: () => void };

export function openDialog(options: {
  label: string;
  content: (dialog: Dialog) => Node[];
  opener: HTMLElement | null;
  sheet?: boolean;
}): Dialog {
  const backdrop = el('div', { class: 'backdrop' });
  const asSheet = options.sheet === true && layoutBand() === 'phone';
  const node = el('div', {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': options.label,
    class: asSheet ? 'dialog sheet' : 'dialog',
  });
  const dialog: Dialog = {
    node,
    close: () => {
      backdrop.remove();
      options.opener?.focus();
    },
  };
  node.append(...options.content(dialog));
  backdrop.append(node);
  document.body.append(backdrop);
  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop) dialog.close();
  });
  focusTrap(node, dialog.close);
  if (asSheet) sheetRise(node);
  const focusable = node.querySelector<HTMLElement>(
    'input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])',
  );
  (focusable ?? node).focus();
  return dialog;
}

export function emptyBand(line: string, action: Node): HTMLElement {
  return el('div', { role: 'region', 'aria-label': 'Empty', class: 'empty-band' }, [
    el('p', { text: line }),
    action,
  ]);
}

export function loadFailed(retry: () => void): HTMLElement {
  const button = el('button', { type: 'button', 'aria-label': 'Retry', text: 'Retry' });
  button.addEventListener('click', retry);
  return el('div', { role: 'alert', 'aria-label': 'Load failed', class: 'notice-box' }, [
    el('p', { text: "Spoorline can't reach the server. Retry when your connection is back." }),
    button,
  ]);
}

export function errorAlert(failure: ApiFailure, form?: HTMLElement): HTMLElement {
  const items: Node[] = [el('p', { text: failure.message })];
  if (failure.fields) {
    items.push(
      el(
        'ul',
        {},
        Object.entries(failure.fields).map(([name, message]) => {
          const link = el('a', { href: `#field-${name}`, text: `${name}: ${message}` });
          link.addEventListener('click', (event) => {
            event.preventDefault();
            const target = form?.querySelector<HTMLElement>(`[data-field="${name}"]`);
            target?.focus();
          });
          return el('li', {}, [link]);
        }),
      ),
    );
    if (form) {
      for (const [name, message] of Object.entries(failure.fields)) {
        const target = form.querySelector<HTMLElement>(`[data-field="${name}"]`);
        const holder = target?.parentElement;
        if (!holder) continue;
        const existing = holder.querySelector('.field-error');
        existing?.remove();
        holder.append(el('p', { class: 'field-error', text: message }));
      }
    }
  }
  return el('div', { role: 'alert', 'aria-label': 'Error', class: 'notice-box' }, items);
}

export function showFormError(host: HTMLElement, failure: ApiFailure, form?: HTMLElement): void {
  host.querySelector('[aria-label="Error"]')?.remove();
  host.prepend(errorAlert(failure, form));
}





export type TreeNode = {
  label: string;
  text: string;
  children: TreeNode[];
  onSelect?: () => void;
  extra?: Node[];
};

/** One tree widget behind the score explanation and the span tree. */
export function buildTree(label: string, nodes: TreeNode[]): HTMLElement {
  const tree = el('div', { role: 'tree', 'aria-label': label, class: 'tree' });
  const items: HTMLElement[] = [];

  const add = (node: TreeNode, level: number, parent: HTMLElement): void => {
    const item = el('div', {
      role: 'treeitem',
      'aria-label': node.label,
      'aria-level': String(level),
      class: 'treeitem',
      tabindex: '-1',
    });
    if (node.children.length > 0) item.setAttribute('aria-expanded', 'true');
    const row = el('span', { class: 'treeitem-row' }, [el('span', { text: node.text }), ...(node.extra ?? [])]);
    item.append(row);
    parent.append(item);
    items.push(item);
    if (node.children.length === 0) return;
    const group = el('div', { role: 'group', class: 'tree-group' });
    item.after(group);
    for (const child of node.children) add(child, level + 1, group);
    item.dataset.group = 'true';
    (item as HTMLElement & { groupNode?: HTMLElement }).groupNode = group;
    row.addEventListener('click', () => {
      const expanded = item.getAttribute('aria-expanded') === 'true';
      item.setAttribute('aria-expanded', String(!expanded));
      group.hidden = expanded;
      node.onSelect?.();
    });
  };

  for (const node of nodes) add(node, 1, tree);
  if (items.length > 0) items[0].tabIndex = 0;

  const visible = (): HTMLElement[] =>
    items.filter((item) => item.offsetParent !== null || item === items[0]);

  const moveTo = (item: HTMLElement): void => {
    for (const other of items) other.tabIndex = -1;
    item.tabIndex = 0;
    item.focus();
  };

  tree.addEventListener('keydown', (event) => {
    const current = document.activeElement as HTMLElement | null;
    const list = visible();
    const index = current ? list.indexOf(current) : -1;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (index >= 0 && index + 1 < list.length) moveTo(list[index + 1]);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (index > 0) moveTo(list[index - 1]);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      if (list.length > 0) moveTo(list[0]);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      if (list.length > 0) moveTo(list[list.length - 1]);
      return;
    }
    if (event.key === 'ArrowRight' && current) {
      event.preventDefault();
      const group = (current as HTMLElement & { groupNode?: HTMLElement }).groupNode;
      if (!group) return;
      if (current.getAttribute('aria-expanded') === 'false') {
        current.setAttribute('aria-expanded', 'true');
        group.hidden = false;
        return;
      }
      const child = group.querySelector<HTMLElement>('[role="treeitem"]');
      if (child) moveTo(child);
      return;
    }
    if (event.key === 'ArrowLeft' && current) {
      event.preventDefault();
      const group = (current as HTMLElement & { groupNode?: HTMLElement }).groupNode;
      if (group && current.getAttribute('aria-expanded') === 'true') {
        current.setAttribute('aria-expanded', 'false');
        group.hidden = true;
        return;
      }
      const parentItem = current.parentElement?.previousElementSibling as HTMLElement | null;
      if (parentItem && parentItem.getAttribute('role') === 'treeitem') moveTo(parentItem);
    }
  });
  return tree;
}
