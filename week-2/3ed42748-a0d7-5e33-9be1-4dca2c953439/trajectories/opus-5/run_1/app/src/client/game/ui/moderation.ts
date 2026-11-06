import { el } from '../../shared/dom.js';
import { paperGround } from '../../shared/paper.js';
import { ConfirmDialog } from './dialogs.js';

export interface StaffCourier {
  moderation_ref: string;
  display_name: string;
  satchel_colour: string;
  position: { lat: number; lon: number; heading_deg: number };
  emote: string | null;
  muted: boolean;
  name_locked: boolean;
}

export interface AuditEntry {
  entry_id: string;
  action: 'mute' | 'unmute' | 'rename';
  actor_role: string;
  actor_display_name: string;
  moderation_ref: string;
  target_name_before: string;
  target_name_after: string;
  at: string;
}

export interface ModerationHooks {
  onToggle: (courier: StaffCourier) => void;
  onRename: (courier: StaffCourier) => void;
  onClose: () => void;
}

type ButtonKind = 'toggle' | 'rename';

interface Row {
  line: HTMLElement;
  name: HTMLElement;
  toggle: HTMLButtonElement;
  rename: HTMLButtonElement;
}

/** The moderation drawer: every row reachable by keyboard, and focus never falling to the page. */
export class ModerationDrawer {
  readonly root: HTMLElement;
  readonly closeButton: HTMLButtonElement;
  readonly renameConfirm: ConfirmDialog;
  private readonly rowsHost = el('div', { class: 'moderation-rows' });
  private readonly auditList = el('ul', { role: 'list', 'aria-label': 'Audit', class: 'audit' });
  private readonly rows = new Map<string, Row>();
  private order: string[] = [];
  private renaming: StaffCourier | null = null;

  constructor(private readonly hooks: ModerationHooks) {
    this.closeButton = el('button', { type: 'button' }, ['Close moderation']);
    this.closeButton.addEventListener('click', () => this.hooks.onClose());
    this.renameConfirm = new ConfirmDialog({
      label: 'Rename courier',
      confirmLabel: 'Rename',
      cancelLabel: 'Cancel',
      onConfirm: () => {
        const target = this.renaming;
        this.renameConfirm.dialog.close();
        if (target !== null) this.hooks.onRename(target);
      },
    });
    this.root = el(
      'div',
      {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': 'Moderation drawer',
        class: 'moderation-drawer perforated',
        hidden: true,
      },
      [this.rowsHost, this.auditList, this.closeButton],
    );
    paperGround(this.root);
    this.root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        this.hooks.onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const stops = this.tabStops();
      if (stops.length === 0) return;
      const index = stops.indexOf(document.activeElement as HTMLElement);
      if (index < 0) return;
      event.preventDefault();
      const step = event.shiftKey ? -1 : 1;
      stops[(index + step + stops.length) % stops.length]!.focus();
    });
  }

  /** Each row's toggle then its Rename, row by row, then Close moderation. */
  private tabStops(): HTMLElement[] {
    const stops: HTMLElement[] = [];
    for (const ref of this.order) {
      const row = this.rows.get(ref);
      if (row) stops.push(row.toggle, row.rename);
    }
    stops.push(this.closeButton);
    return stops;
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  show(): void {
    this.root.hidden = false;
    const first = this.order[0];
    const row = first === undefined ? undefined : this.rows.get(first);
    (row?.toggle ?? this.closeButton).focus();
  }

  hide(): void {
    this.root.hidden = true;
  }

  askRename(courier: StaffCourier, opener: HTMLElement): void {
    this.renaming = courier;
    this.renameConfirm.ask(
      `Give ${courier.display_name} a fresh courier name?`,
      opener,
      this.renameConfirm.cancel,
    );
  }

  focusToggleOf(ref: string): void {
    (this.rows.get(ref)?.toggle ?? this.closeButton).focus();
  }

  focusRenameOf(ref: string): void {
    (this.rows.get(ref)?.rename ?? this.closeButton).focus();
  }

  /** A reload keeps every element, so focus is never disturbed while its row remains. */
  render(couriers: StaffCourier[], entries: AuditEntry[]): void {
    const sorted = [...couriers].sort((a, b) => {
      if (a.display_name !== b.display_name) return a.display_name < b.display_name ? -1 : 1;
      return a.moderation_ref < b.moderation_ref ? -1 : 1;
    });
    const focused = document.activeElement as HTMLElement | null;
    const focusedRef = [...this.rows.entries()].find(
      ([, row]) => row.toggle === focused || row.rename === focused,
    );
    const focusedKind: ButtonKind | null =
      focusedRef === undefined ? null : focusedRef[1].toggle === focused ? 'toggle' : 'rename';
    const focusedPosition = focusedRef === undefined ? -1 : this.order.indexOf(focusedRef[0]);

    const wanted = new Set(sorted.map((courier) => courier.moderation_ref));
    for (const [ref, row] of this.rows) {
      if (!wanted.has(ref)) {
        row.line.remove();
        this.rows.delete(ref);
      }
    }
    for (const courier of sorted) {
      let row = this.rows.get(courier.moderation_ref);
      if (row === undefined) {
        const name = el('span', { class: 'moderation-name' });
        const toggle = el('button', { type: 'button' });
        const rename = el('button', { type: 'button' }, ['Rename']);
        row = { line: el('div', { class: 'moderation-row' }, [name, toggle, rename]), name, toggle, rename };
        this.rows.set(courier.moderation_ref, row);
      }
      row.name.textContent = courier.display_name;
      row.toggle.textContent = courier.muted
        ? `Unmute ${courier.display_name}`
        : `Mute ${courier.display_name}`;
      row.rename.textContent = `Rename ${courier.display_name}`;
      row.toggle.onclick = () => this.hooks.onToggle(courier);
      row.rename.onclick = () => this.askRename(courier, row!.rename);
      if (this.rowsHost.children[sorted.indexOf(courier)] !== row.line) {
        this.rowsHost.insertBefore(row.line, this.rowsHost.children[sorted.indexOf(courier)] ?? null);
      }
    }
    this.order = sorted.map((courier) => courier.moderation_ref);
    if (focused !== null && document.contains(focused) && document.activeElement !== focused) {
      focused.focus();
    }

    this.auditList.replaceChildren(
      ...entries.slice(0, 20).map((entry) =>
        el('li', {}, [
          entry.action === 'rename'
            ? `${entry.actor_display_name} renamed ${entry.target_name_before} to ${entry.target_name_after}`
            : `${entry.actor_display_name} ${entry.action}d ${entry.target_name_before}`,
        ]),
      ),
    );

    if (focusedRef !== undefined && !wanted.has(focusedRef[0])) {
      this.restoreFocus(focusedPosition, focusedKind ?? 'toggle');
    }
  }

  private restoreFocus(position: number, kind: ButtonKind): void {
    const refs = this.order;
    const chosen = refs[position] ?? refs[refs.length - 1];
    const row = chosen === undefined ? undefined : this.rows.get(chosen);
    if (row === undefined) {
      this.closeButton.focus();
      return;
    }
    (kind === 'toggle' ? row.toggle : row.rename).focus();
  }
}
