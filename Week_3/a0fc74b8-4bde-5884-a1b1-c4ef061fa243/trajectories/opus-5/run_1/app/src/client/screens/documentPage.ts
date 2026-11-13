import { api, ApiCallError } from '../api.ts';
import { announce, clear, h, isNarrow, statusRegion } from '../dom.ts';
import { subscribe, type LiveSubscription } from '../live.ts';
import { buildPageGroups, paintPages } from '../ui/pages.ts';
import { Glide } from '../ui/motion.ts';
import { openReasonDialog, openSendDialog, VOID_DIALOG } from '../ui/sendDialog.ts';
import {
  fieldPropertiesPanel,
  placeField,
  type PlacedField,
  type PropertiesPanel,
} from '../ui/fieldEditor.ts';
import { stampInZone, timeZoneNames } from '../timeZones.ts';
import {
  ANNOUNCE,
  BANNER,
  GENERIC_ERROR,
  KIND_WORD,
  NEXT_REMINDER,
  PAGES_UNAVAILABLE_BODY,
  PAGES_UNAVAILABLE_HEADING,
  PENDING,
  REMINDER_MAIL_ERROR,
  STATUS_WORD,
} from '../../shared/copy.ts';
import { rowStatusWord } from '../../shared/nextStep.ts';
import { DEFAULT_SIZE } from '../../shared/geometry.ts';
import type { DocumentJson, FieldKind, FieldJson, Role } from '../../shared/types.ts';
import type { Frame } from '../frame.ts';
import type { Screen } from './documents.ts';

const PANEL_MS = 300;
const KINDS: readonly FieldKind[] = ['signature', 'initials', 'date', 'text'];

const uuid = (): string =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const documentPageScreen = (
  frame: Frame,
  documentId: string,
  initialRole: Role,
  userId: string,
): Screen => {
  let role: Role = initialRole;
  let document_: DocumentJson | null = null;
  let selectedId: string | null = null;
  let currentPage = 1;
  let armedKind: FieldKind | null = null;
  let live: LiveSubscription | null = null;
  let pagesReady = false;
  const placed = new Map<string, PlacedField>();

  const heading = h('h1', { class: 'page-heading', tabindex: '-1' });
  const statusWord = h('span', { class: 'status-word' });
  const nextStep = h('span', { class: 'next-step' });
  const auditLink = h('a', { href: `/documents/${documentId}/audit` }, 'Audit trail');
  const downloadLink = h(
    'a',
    { href: `/api/documents/${documentId}/completed.pdf`, download: 'completed.pdf' },
    'Download completed PDF',
  );
  const hashLine = h('p', { class: 'hash-line' });
  const banner = h('p', { class: 'outcome-banner' });

  const positionRegion = statusRegion('Field position');
  const orderRegion = statusRegion('Signing order updates');
  const updatesRegion = statusRegion('Document updates');

  const filmstrip = h('nav', { 'aria-label': 'Pages', class: 'filmstrip' });
  const pageSelect = h('select', { id: 'page-combo' });
  const pageSelectRow = h(
    'div',
    { class: 'page-select' },
    h('label', { for: 'page-combo' }, 'Page'),
    pageSelect,
  );

  const toolbar = h('div', { role: 'toolbar', 'aria-label': 'Fields', class: 'fields-toolbar' });
  const pagesHost = h('div', { class: 'pages-host' });
  const fallbackList = h('ul', { 'aria-label': 'Fields', class: 'fields-fallback-list' });
  const fallback = h(
    'div',
    { class: 'pages-fallback', hidden: true },
    h('h2', {}, PAGES_UNAVAILABLE_HEADING),
    h('p', {}, PAGES_UNAVAILABLE_BODY),
    fallbackList,
  );

  const orderList = h('ol', { 'aria-label': 'Signing order', class: 'signing-order' });
  const nameInput = h('input', { type: 'text', id: 'signer-name' });
  const emailInput = h('input', { type: 'email', id: 'signer-email' });
  const addError = h('p', { class: 'field-error', role: 'alert' });
  const addButton = h('button', { type: 'button', class: 'button' }, 'Add signer');
  const addForm = h(
    'div',
    { class: 'add-signer' },
    h('div', { class: 'field' }, h('label', { for: 'signer-name' }, 'Name'), nameInput),
    h('div', { class: 'field' }, h('label', { for: 'signer-email' }, 'Email'), emailInput),
    addButton,
    addError,
  );

  const zoneSelect = h('select', { id: 'time-zone' });
  const zoneRow = h(
    'div',
    { class: 'field' },
    h('label', { for: 'time-zone' }, 'Time zone'),
    zoneSelect,
  );
  for (const zone of timeZoneNames()) {
    zoneSelect.appendChild(h('option', { value: zone }, zone));
  }

  const sendButton = h('button', { type: 'button', class: 'button seal' }, 'Send for signing');
  const remindButton = h('button', { type: 'button', class: 'button' }, 'Send reminder');
  const voidButton = h('button', { type: 'button', class: 'button' }, 'Void document');
  const templateButton = h('button', { type: 'button', class: 'button' }, 'Save as template');
  const actions = h(
    'div',
    { class: 'routing-actions' },
    sendButton,
    remindButton,
    voidButton,
    templateButton,
  );

  const routingBody = h(
    'div',
    { class: 'routing-body' },
    h('h2', { class: 'routing-heading' }, 'Signing order'),
    orderList,
    addForm,
    zoneRow,
    actions,
    orderRegion,
  );
  const routingHost = h('div', { class: 'routing-host' }, routingBody);
  const sheetButton = h('button', { type: 'button', class: 'button sheet-open' }, 'Signing order');

  const propertiesHost = h('div', { class: 'properties-host' });
  let properties: PropertiesPanel | null = null;
  let panelGlide: Glide | null = null;
  let panelFieldId: string | null = null;

  const pagesLayer = h('div', { class: 'centre' }, toolbar, pagesHost, fallback);
  const layout = h('div', { class: 'doc-layout' }, filmstrip, pagesLayer, routingHost);

  const root = h(
    'div',
    { class: 'document-screen' },
    h(
      'header',
      { class: 'doc-header' },
      heading,
      h('div', { class: 'doc-meta' }, statusWord, nextStep),
      h('div', { class: 'doc-links' }, auditLink, downloadLink, sheetButton),
    ),
    banner,
    hashLine,
    pageSelectRow,
    updatesRegion,
    positionRegion,
    layout,
    propertiesHost,
  );

  // ---------- pages ----------

  const pageGroup = (page: number): HTMLElement | null =>
    pagesHost.querySelector<HTMLElement>(`#page-${page}`);

  const setCurrentPage = (page: number, moveFocus: boolean): void => {
    currentPage = page;
    for (const button of filmstrip.querySelectorAll('button')) {
      const isCurrent = button.dataset['page'] === String(page);
      if (isCurrent) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    if (pageSelect.value !== String(page)) pageSelect.value = String(page);
    const group = pageGroup(page);
    if (!group) return;
    if (moveFocus) {
      group.scrollIntoView({ behavior: 'auto', block: 'start' });
      group.focus();
    }
  };

  const buildFilmstrip = (pageCount: number): void => {
    clear(filmstrip);
    clear(pageSelect);
    const buttons: HTMLButtonElement[] = [];
    for (let page = 1; page <= pageCount; page += 1) {
      const button = h(
        'button',
        { type: 'button', class: 'thumb' },
        h('img', { alt: '', class: 'thumb-image' }),
        h('span', { class: 'thumb-label' }, `Page ${page}`),
      );
      button.dataset['page'] = String(page);
      button.addEventListener('click', () => setCurrentPage(page, true));
      button.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const step = event.key === 'ArrowDown' ? 1 : -1;
          buttons[Math.min(buttons.length - 1, Math.max(0, page - 1 + step))]?.focus();
          return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          setCurrentPage(page, true);
        }
      });
      buttons.push(button);
      filmstrip.appendChild(button);
      pageSelect.appendChild(
        h('option', { value: String(page) }, `Page ${page} of ${pageCount}`),
      );
    }
    pageSelect.addEventListener('change', () =>
      setCurrentPage(Number.parseInt(pageSelect.value, 10), true),
    );
  };

  const watchScroll = (): void => {
    window.addEventListener(
      'scroll',
      () => {
        const middle = window.innerHeight / 2;
        for (const group of pagesHost.querySelectorAll<HTMLElement>('.page-group')) {
          const rect = group.getBoundingClientRect();
          if (rect.top <= middle && rect.bottom >= middle) {
            const page = Number.parseInt(group.id.replace('page-', ''), 10);
            if (page !== currentPage) setCurrentPage(page, false);
            return;
          }
        }
      },
      { passive: true },
    );
  };

  // ---------- fields ----------

  const canEdit = (doc: DocumentJson): boolean =>
    role === 'owner' || (role === 'member' && doc.ownerId === userId);

  const canVoid = (doc: DocumentJson): boolean => canEdit(doc);


  const saveField = (fieldId: string, patch: Record<string, unknown>): void => {
    void (async () => {
      try {
        await api.patchField(documentId, fieldId, patch);
      } catch {
        /* the live channel re-states the stored geometry on the next tick */
      }
    })();
  };

  const ensurePanel = (): { panel: PropertiesPanel; glide: Glide } => {
    if (properties !== null && panelGlide !== null) {
      return { panel: properties, glide: panelGlide };
    }
    const built = fieldPropertiesPanel(
      (patch) => {
        const fieldId = panelFieldId;
        if (fieldId === null) return;
        saveField(fieldId, patch);
        const target = placed.get(fieldId);
        if (!target) return;
        const next = { ...target.field };
        if (typeof patch['label'] === 'string') next.label = patch['label'];
        if (typeof patch['recipientId'] === 'string') next.recipientId = patch['recipientId'];
        if (typeof patch['required'] === 'boolean') next.required = patch['required'];
        target.apply(next);
      },
      () => select(null),
    );
    const glide = new Glide(
      0,
      PANEL_MS,
      (eased) => {
        const hidden = (1 - eased) * 100;
        built.panel.style.transform = isNarrow()
          ? `translateY(${hidden}%)`
          : `translateX(${hidden}%)`;
      },
      (value) => {
        built.panel.classList.toggle('hidden-panel', value === 0);
      },
    );
    propertiesHost.appendChild(built.panel);
    properties = built;
    panelGlide = glide;
    return { panel: built, glide };
  };

  const closePanel = (): void => {
    if (properties === null || panelGlide === null) return;
    panelFieldId = null;
    properties.panel.setAttribute('aria-hidden', 'true');
    properties.panel.removeAttribute('role');
    panelGlide.to(0);
  };

  const openPanel = (field: FieldJson): void => {
    if (!document_) return;
    const { panel, glide } = ensurePanel();
    panelFieldId = field.id;
    panel.refresh(field, document_.recipients);
    panel.panel.classList.remove('hidden-panel');
    panel.panel.setAttribute('role', 'complementary');
    panel.panel.setAttribute('aria-label', 'Field properties');
    panel.panel.removeAttribute('aria-hidden');
    glide.to(1);
  };

  const select = (fieldId: string | null): void => {
    if (selectedId === fieldId) {
      if (fieldId !== null) {
        const field = placed.get(fieldId)?.field;
        if (field) openPanel(field);
      }
      return;
    }
    selectedId = fieldId;
    for (const [id, entry] of placed) entry.setSelected(id === fieldId);
    if (fieldId === null) {
      closePanel();
      return;
    }
    const field = placed.get(fieldId)?.field;
    if (field) openPanel(field);
  };

  const removeField = (fieldId: string): void => {
    const entry = placed.get(fieldId);
    if (!entry) return;
    const page = entry.field.page;
    const siblings = [...placed.values()].filter(
      (item) => item.field.page === page && item.field.id !== fieldId,
    );
    entry.detach();
    placed.delete(fieldId);
    selectedId = null;
    closePanel();
    const next = siblings[0];
    if (next) next.button.focus();
    else pageGroup(page)?.focus();
    void (async () => {
      try {
        await api.deleteField(documentId, fieldId);
      } catch {
        /* the live channel restores the field if the delete did not take */
      }
    })();
  };

  const announcePosition = (field: FieldJson): void => {
    announce(
      positionRegion,
      ANNOUNCE.fieldPosition(field.label, field.page, field.x, field.y, field.w, field.h),
    );
  };

  const fieldHost = {
    editable: () => document_ !== null && document_.status === 'draft' && canEdit(document_),
    pageGroup,
    recipients: () => document_?.recipients ?? [],
    save: saveField,
    remove: removeField,
    select,
    announcePosition,
    pageCount: () => document_?.pageCount ?? 1,
  };

  const createField = async (kind: FieldKind, page: number, cx: number, cy: number): Promise<void> => {
    if (!document_) return;
    const first = document_.recipients[0];
    if (!first) return;
    const size = DEFAULT_SIZE[kind];
    const x = Math.min(Math.max(cx - size.w / 2, 0), 1 - size.w);
    const y = Math.min(Math.max(cy - size.h / 2, 0), 1 - size.h);
    try {
      const created = await api.createField(documentId, {
        recipientId: first.id,
        kind,
        page,
        x: Math.round(x * 10000) / 10000,
        y: Math.round(y * 10000) / 10000,
        w: size.w,
        h: size.h,
      });
      const entry = placeField(created, fieldHost);
      placed.set(created.id, entry);
      selectedId = null;
      select(created.id);
      entry.button.focus();
      announcePosition(created);
    } catch {
      announce(positionRegion, GENERIC_ERROR);
    }
  };

  const buildToolbar = (): void => {
    clear(toolbar);
    for (const kind of KINDS) {
      const button = h('button', { type: 'button', class: 'tool' }, KIND_WORD[kind]);
      let start: { x: number; y: number; pointerType: string } | null = null;
      button.addEventListener('pointerdown', (event: PointerEvent) => {
        start = { x: event.clientX, y: event.clientY, pointerType: event.pointerType };
        button.setPointerCapture(event.pointerId);
      });
      button.addEventListener('pointerup', (event: PointerEvent) => {
        const began = start;
        start = null;
        button.releasePointerCapture?.(event.pointerId);
        if (!began) return;
        const moved =
          Math.abs(event.clientX - began.x) > 6 || Math.abs(event.clientY - began.y) > 6;
        if (began.pointerType === 'touch' && !moved) {
          armedKind = armedKind === kind ? null : kind;
          refreshToolbarArming();
          return;
        }
        if (!moved) {
          void createField(kind, currentPage, 0.5, 0.5);
          return;
        }
        const drop = pointAtPage(event.clientX, event.clientY);
        if (drop === null) return;
        void createField(kind, drop.page, drop.x, drop.y);
      });
      button.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        void createField(kind, currentPage, 0.5, 0.5);
      });
      button.dataset['kind'] = kind;
      toolbar.appendChild(button);
    }
  };

  const refreshToolbarArming = (): void => {
    for (const button of toolbar.querySelectorAll('button')) {
      const kind = button.dataset['kind'];
      if (armedKind !== null && kind === armedKind) button.setAttribute('aria-pressed', 'true');
      else button.removeAttribute('aria-pressed');
    }
  };

  const pointAtPage = (
    clientX: number,
    clientY: number,
  ): { page: number; x: number; y: number } | null => {
    const count = document_?.pageCount ?? 0;
    for (let page = 1; page <= count; page += 1) {
      const rect = pageGroup(page)?.getBoundingClientRect();
      if (!rect) continue;
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        return {
          page,
          x: (clientX - rect.left) / rect.width,
          y: (clientY - rect.top) / rect.height,
        };
      }
    }
    return null;
  };

  pagesHost.addEventListener('pointerup', (event: PointerEvent) => {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest('.field-box, .field-handle')) return;
    const spot = pointAtPage(event.clientX, event.clientY);
    if (spot === null) return;
    if (armedKind !== null) {
      const kind = armedKind;
      armedKind = null;
      refreshToolbarArming();
      void createField(kind, spot.page, spot.x, spot.y);
      return;
    }
    select(null);
  });

  pagesHost.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    if (!(event.target instanceof Element) || !event.target.classList.contains('page-group')) return;
    select(null);
  });

  // ---------- routing column ----------

  const addSigner = async (): Promise<void> => {
    if (!document_) return;
    addError.textContent = '';
    try {
      await api.addRecipient(documentId, nameInput.value.trim(), emailInput.value.trim());
      nameInput.value = '';
      emailInput.value = '';
      nameInput.focus();
      await refresh();
    } catch (failure) {
      if (failure instanceof ApiCallError) {
        const fields = failure.failure.fields;
        addError.textContent =
          fields['name'] ?? fields['email'] ?? fields['recipients'] ?? GENERIC_ERROR;
      } else {
        addError.textContent = GENERIC_ERROR;
      }
    }
  };

  addButton.addEventListener('click', () => void addSigner());
  emailInput.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void addSigner();
  });

  zoneSelect.addEventListener('change', () => {
    void (async () => {
      try {
        await api.patchDocument(documentId, { timeZone: zoneSelect.value });
      } catch {
        /* the live channel restates the stored zone */
      }
    })();
  });

  const moveSigner = async (
    recipientId: string,
    direction: 'up' | 'down',
    pressed: HTMLButtonElement,
  ): Promise<void> => {
    if (!document_) return;
    try {
      const recipients = await api.moveRecipient(documentId, recipientId, direction);
      const moved = recipients.find((row) => row.id === recipientId);
      if (moved) {
        announce(orderRegion, ANNOUNCE.reordered(moved.name, moved.order, recipients.length));
      }
      await refresh();
      const name = moved?.name ?? '';
      const same = orderList.querySelector<HTMLButtonElement>(
        `button[data-move="${direction}"][data-name="${CSS.escape(name)}"]`,
      );
      const other = orderList.querySelector<HTMLButtonElement>(
        `button[data-move="${direction === 'up' ? 'down' : 'up'}"][data-name="${CSS.escape(name)}"]`,
      );
      if (same && !same.disabled) same.focus();
      else if (other) other.focus();
      else pressed.focus();
    } catch {
      announce(orderRegion, GENERIC_ERROR);
    }
  };

  const renderOrder = (doc: DocumentJson): void => {
    clear(orderList);
    const draft = doc.status === 'draft';
    const closed = doc.status === 'declined' || doc.status === 'voided';
    doc.recipients.forEach((recipient, index) => {
      const word = rowStatusWord(recipient.status, recipient.delivery);
      const row = h(
        'li',
        { class: recipient.status === 'signed' ? 'signer-row signed' : 'signer-row' },
        h('span', { class: 'signer-number' }, String(recipient.order)),
        h('span', { class: 'signer-name' }, `${recipient.order}. ${recipient.name}`),
        h('span', { class: 'signer-status' }, word),
        closed && recipient.status === 'signed' ? h('span', { class: 'not-binding' }, 'Not binding') : null,
      );
      if (draft && canEdit(doc)) {
        const up = h(
          'button',
          { type: 'button', class: 'button quiet', disabled: index === 0 },
          `Move ${recipient.name} up`,
        );
        const down = h(
          'button',
          {
            type: 'button',
            class: 'button quiet',
            disabled: index === doc.recipients.length - 1,
          },
          `Move ${recipient.name} down`,
        );
        const remove = h('button', { type: 'button', class: 'button quiet' }, `Remove ${recipient.name}`);
        up.dataset['move'] = 'up';
        up.dataset['name'] = recipient.name;
        down.dataset['move'] = 'down';
        down.dataset['name'] = recipient.name;
        up.addEventListener('click', () => void moveSigner(recipient.id, 'up', up));
        down.addEventListener('click', () => void moveSigner(recipient.id, 'down', down));
        remove.addEventListener('click', () => {
          void (async () => {
            await api.removeRecipient(documentId, recipient.id);
            await refresh();
            nameInput.focus();
          })();
        });
        row.appendChild(h('span', { class: 'signer-controls' }, up, down, remove));
      }
      if (doc.status === 'in_progress' && recipient.status === 'expired') {
        const again = h('button', { type: 'button', class: 'button' }, 'Send a new link');
        again.addEventListener('click', () => {
          announce(orderRegion, PENDING.newLink);
          again.disabled = true;
          again.setAttribute('aria-busy', 'true');
          void (async () => {
            try {
              await api.newLink(documentId, recipient.id);
              announce(orderRegion, ANNOUNCE.newLink(recipient.name));
              await refresh();
            } catch {
              announce(orderRegion, GENERIC_ERROR);
              again.disabled = false;
              again.removeAttribute('aria-busy');
            }
          })();
        });
        row.appendChild(again);
      }
      orderList.appendChild(row);
    });
  };

  // ---------- send, remind, void, template ----------

  sendButton.addEventListener('click', () => {
    const doc = document_;
    if (!doc) return;
    openSendDialog(
      doc,
      sendButton,
      () => api.send(documentId, uuid()),
      (sent) => {
        const first = sent.recipients[0];
        if (first) announce(orderRegion, ANNOUNCE.sent(first.name));
        applyDocument(sent);
        heading.focus();
      },
      () => announce(orderRegion, PENDING.send),
    );
  });

  remindButton.addEventListener('click', () => {
    announce(orderRegion, PENDING.remind);
    remindButton.disabled = true;
    remindButton.setAttribute('aria-busy', 'true');
    void (async () => {
      const current = document_?.recipients.find((row) => row.order === document_?.currentOrder);
      try {
        await api.remind(documentId);
        if (current) announce(orderRegion, ANNOUNCE.reminderSent(current.name));
      } catch (failure) {
        remindButton.removeAttribute('aria-busy');
        if (failure instanceof ApiCallError && failure.failure.error === 'mail_unavailable') {
          announce(orderRegion, REMINDER_MAIL_ERROR);
        } else if (failure instanceof ApiCallError && failure.failure.error !== 'reminder_cooldown') {
          announce(orderRegion, GENERIC_ERROR);
        }
      }
      await refresh();
    })();
  });

  voidButton.addEventListener('click', () => {
    openReasonDialog(
      VOID_DIALOG,
      voidButton,
      async (reason) => {
        applyDocument(await api.voidDocument(documentId, reason));
      },
      () => announce(orderRegion, PENDING.void),
    );
  });

  templateButton.addEventListener('click', () => {
    void (async () => {
      try {
        await api.saveTemplate(documentId);
        announce(orderRegion, 'Template saved.');
      } catch {
        announce(orderRegion, GENERIC_ERROR);
      }
    })();
  });

  // ---------- sheet at 375 px ----------

  const sheetGlide = new Glide(
    0,
    PANEL_MS,
    (eased) => {
      if (isNarrow()) routingHost.style.transform = `translateY(${(1 - eased) * 100}%)`;
      else routingHost.style.transform = '';
    },
    (value) => {
      routingHost.classList.toggle('sheet-hidden', isNarrow() && value === 0);
    },
  );

  const applySheetMode = (): void => {
    sheetButton.hidden = !isNarrow();
    if (document_) applyControls(document_);
    if (isNarrow()) {
      routingHost.setAttribute('role', 'dialog');
      routingHost.setAttribute('aria-modal', 'true');
      routingHost.setAttribute('aria-label', 'Signing order');
      routingHost.setAttribute('aria-hidden', 'true');
      routingHost.classList.add('sheet', 'sheet-hidden');
      routingHost.style.transform = 'translateY(100%)';
      return;
    }
    routingHost.removeAttribute('role');
    routingHost.removeAttribute('aria-modal');
    routingHost.removeAttribute('aria-label');
    routingHost.removeAttribute('aria-hidden');
    routingHost.classList.remove('sheet', 'sheet-hidden');
    routingHost.style.transform = '';
  };

  sheetButton.addEventListener('click', () => {
    routingHost.removeAttribute('aria-hidden');
    routingHost.classList.remove('sheet-hidden');
    sheetGlide.to(1);
    const first = routingHost.querySelector<HTMLElement>('button, select, input');
    first?.focus();
  });

  const closeSheet = (): void => {
    if (!isNarrow()) return;
    routingHost.setAttribute('aria-hidden', 'true');
    sheetGlide.to(0);
    sheetButton.focus();
  };

  root.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    if (!isNarrow() || routingHost.getAttribute('aria-hidden') === 'true') return;
    if (!(event.target instanceof Node) || !routingHost.contains(event.target)) return;
    event.preventDefault();
    closeSheet();
  });

  window.matchMedia('(max-width: 480px)').addEventListener('change', applySheetMode);

  // ---------- rendering ----------

  const renderFallbackList = (doc: DocumentJson): void => {
    clear(fallbackList);
    for (const field of doc.fields) {
      const who = doc.recipients.find((row) => row.id === field.recipientId)?.name ?? '';
      fallbackList.appendChild(h('li', {}, `${field.label} for ${who}, page ${field.page}`));
    }
  };

  const syncFields = (doc: DocumentJson): void => {
    const seen = new Set<string>();
    for (const field of doc.fields) {
      seen.add(field.id);
      const entry = placed.get(field.id);
      if (entry) {
        if (document.activeElement !== entry.button) entry.apply(field);
        continue;
      }
      const created = placeField(field, fieldHost);
      created.setSelected(field.id === selectedId);
      placed.set(field.id, created);
    }
    for (const [id, entry] of [...placed]) {
      if (seen.has(id)) continue;
      entry.detach();
      placed.delete(id);
    }
  };

  const applyControls = (doc: DocumentJson): void => {
    const draft = doc.status === 'draft';
    const editable = draft && canEdit(doc);
    toolbar.hidden = !editable;
    addForm.hidden = !editable;
    zoneRow.hidden = !editable;
    sendButton.hidden = !editable;
    templateButton.hidden = !(draft && role === 'owner');
    voidButton.hidden = !(doc.status === 'in_progress' && canVoid(doc));
    for (const button of toolbar.querySelectorAll('button')) {
      button.disabled = doc.recipients.length === 0;
    }

    const current = doc.recipients.find((row) => row.order === doc.currentOrder) ?? null;
    const remindable =
      doc.status === 'in_progress' &&
      canEdit(doc) &&
      current !== null &&
      (current.status === 'invited' || current.status === 'viewed');
    remindButton.hidden = !remindable;
    if (remindable) {
      const cooling = doc.reminderAvailableAt !== null;
      remindButton.disabled = cooling;
      const text = cooling
        ? NEXT_REMINDER(stampInZone(doc.reminderAvailableAt ?? '', doc.timeZone), doc.timeZone)
        : 'Send reminder';
      remindButton.textContent = text;
      remindButton.setAttribute('aria-label', text);
      remindButton.removeAttribute('aria-busy');
    }

    downloadLink.hidden = doc.status !== 'completed';
    hashLine.hidden = doc.status !== 'completed';
    sheetButton.hidden = !isNarrow();
  };

  const applyDocument = (doc: DocumentJson): void => {
    const first = document_ === null;
    const statusChanged = document_ !== null && document_.status !== doc.status;
    document_ = doc;

    heading.textContent = doc.title;
    statusWord.textContent = STATUS_WORD[doc.status];
    nextStep.textContent = doc.nextStep;
    if (doc.status === 'completed') {
      clear(hashLine);
      hashLine.append(
        'Completed PDF SHA-256 ',
        h('span', { class: 'mono' }, doc.completedSha256 ?? ''),
      );
    }
    banner.textContent =
      doc.status === 'declined'
        ? BANNER.declined(doc.declinedBy ?? '', doc.declineReason ?? '')
        : doc.status === 'voided'
          ? BANNER.voided(doc.voidedBy ?? '', doc.voidReason ?? '')
          : '';
    banner.hidden = banner.textContent === '';
    if (statusChanged) {
      announce(updatesRegion, ANNOUNCE.documentUpdate(doc.title, STATUS_WORD[doc.status]));
    }

    if (first) {
      buildFilmstrip(doc.pageCount);
      buildToolbar();
      const built = buildPageGroups(doc.pageCount);
      pagesHost.appendChild(built.container);
      setCurrentPage(1, false);
      watchScroll();
      void paintPages(
        `/api/documents/${documentId}/original.pdf`,
        built.groups,
        (page, _shape, imageUrl) => {
          const thumb = filmstrip.querySelector<HTMLImageElement>(
            `button[data-page="${page}"] img.thumb-image`,
          );
          if (thumb) thumb.src = imageUrl;
        },
      )
        .then(() => {
          pagesReady = true;
        })
        .catch(() => {
          pagesReady = false;
          pagesHost.hidden = true;
          fallback.hidden = false;
          renderFallbackList(doc);
        });
    }
    if (!pagesReady && !fallback.hidden) renderFallbackList(doc);

    if (zoneSelect.value !== doc.timeZone) zoneSelect.value = doc.timeZone;
    syncFields(doc);
    renderOrder(doc);
    applyControls(doc);
    if (selectedId !== null) {
      const field = doc.fields.find((row) => row.id === selectedId);
      if (field && properties !== null && panelFieldId === field.id) {
        properties.refresh(field, doc.recipients);
      }
      if (!field) select(null);
    }
  };

  const refresh = async (): Promise<void> => {
    try {
      applyDocument(await api.document(documentId));
    } catch {
      /* the live channel supplies the next state */
    }
  };

  applySheetMode();
  void refresh();
  live = subscribe({ scope: 'document', id: documentId }, (payload) => {
    if (payload.role !== undefined && payload.role !== role) {
      role = payload.role;
      frame.setRole(role);
      if (document_) applyControls(document_);
    }
    if (payload.notice !== undefined) frame.setNotice(payload.notice);
    if (payload.document !== undefined && payload.document !== null) {
      applyDocument(payload.document);
    }
  });

  return {
    root,
    destroy: () => live?.close(),
  };
};
