import { wordCount } from '../../shared/doc.js';
import type { Mode, Role, Snapshot, Span } from '../../shared/types.js';
import { ApiError, api, type SessionPerson } from '../api.js';
import { clear, el, escapeCloses, icon, trapFocus } from '../dom.js';
import { noticesControl } from '../notices.js';
import { announce, clearBanners, hideBanner, navigate, renderInto, showBanner } from '../shell.js';
import type { Connection } from '../socket.js';
import { FindDialog } from './find.js';
import { MarginView } from './margin.js';
import { Outline } from './outline.js';
import { PageView, wordEndAfter, wordStartBefore } from './page.js';
import { EditorSession } from './session.js';
import { openShareDialog } from './share.js';
import { Toolbar } from './toolbar.js';

const roleLabel = (role?: Role): string => (role ? role.charAt(0).toUpperCase() + role.slice(1) : '');
const MODES: { mode: Mode; label: string }[] = [
  { mode: 'editing', label: 'Editing' },
  { mode: 'suggesting', label: 'Suggesting' },
  { mode: 'viewing', label: 'Viewing' },
];

function message(heading: string, body: string, alert?: string): HTMLElement {
  return el('main', { class: 'screen' }, [
    el('div', { class: 'screen-card' }, [
      el('h1', { text: heading }),
      alert ? el('p', { role: 'alert', class: 'screen-alert', text: alert }) : null,
      body ? el('p', { text: body }) : null,
      el('a', {
        href: '/',
        text: 'Back to documents',
        onclick: (event: Event) => {
          event.preventDefault();
          navigate('/');
        },
      }),
    ]),
  ]);
}

export function renderNotFound(): void {
  renderInto(message('Proposal not found', "This proposal doesn't exist or isn't shared with you."));
}

export function renderStorageUnavailable(): void {
  renderInto(message('This proposal can\u2019t be opened right now', 'Storage is unreachable. Try again in a minute.'));
}

function renderAccessEnded(reason: 'expired' | 'removed' | 'deleted'): void {
  const alert =
    reason === 'expired'
      ? 'Your access ended at the time the owner set.'
      : reason === 'removed'
        ? 'The owner removed your access.'
        : 'The owner deleted this proposal.';
  renderInto(message('This proposal is no longer available', '', alert));
}

export async function renderEditor(documentId: string, person: SessionPerson, connection: Connection): Promise<void> {
  let snapshot: Snapshot;
  try {
    snapshot = await api.snapshot(documentId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 503) renderStorageUnavailable();
    else renderNotFound();
    return;
  }
  mountEditor(snapshot, person, connection);
}

function mountEditor(snapshot: Snapshot, person: SessionPerson, connection: Connection): void {
  const session = new EditorSession(snapshot, person, connection);
  const notices = noticesControl(connection, (notice) => {
    if (notice.commentId) window.setTimeout(() => margin.focusCard(notice.commentId as string), 50);
  });

  const page = new PageView(session, {
    onSelectionChange: (selection) => {
      toolbar.update();
      caretThrottle(selection);
    },
    onCardTarget: (id) => margin.focusCard(id),
    onMarkerActivate: (id) => openSheet(id),
  });
  const margin = new MarginView(session, page, () => updateSheetButton());
  const outline = new Outline(session, page);
  const find = new FindDialog(session, page, () => refreshDecorations());

  let caretTimer: number | null = null;
  function caretThrottle(selection: Span): void {
    if (caretTimer !== null) return;
    caretTimer = window.setTimeout(() => {
      caretTimer = null;
      session.sendCaret(selection.at, selection.length);
    }, 120);
  }

  const titleNode =
    session.role === 'owner'
      ? el('input', { class: 'doc-title', 'aria-label': 'Proposal title', value: session.title })
      : el('h1', { class: 'doc-title', text: session.title });
  if (titleNode instanceof HTMLInputElement) {
    titleNode.addEventListener('change', () => {
      void api.renameDocument(session.documentId, { title: titleNode.value }).catch(() => undefined);
    });
  }

  const peopleList = el('ul', { class: 'people-here', 'aria-label': 'People here' });
  const shareButton = el('button', { type: 'button', class: 'chrome-button', 'aria-label': 'Share' }, [icon('users'), 'Share']);
  shareButton.addEventListener('click', () => openShareDialog(session, shareButton));

  const modeGroup = el('div', { class: 'mode-switch', role: 'radiogroup', 'aria-label': 'Mode' });
  const modeRadios = new Map<Mode, HTMLElement>();
  for (const entry of MODES) {
    const radio = el('button', {
      type: 'button',
      role: 'radio',
      class: 'mode-radio',
      'aria-checked': 'false',
      text: entry.label,
    });
    radio.addEventListener('click', () => void chooseMode(entry.mode));
    radio.addEventListener('keydown', (event) => onModeKey(event as KeyboardEvent, entry.mode));
    modeRadios.set(entry.mode, radio);
    modeGroup.appendChild(radio);
  }

  function allowedModes(): Mode[] {
    if (session.role === 'viewer') return ['viewing'];
    if (session.role === 'commenter') return ['suggesting', 'viewing'];
    return ['editing', 'suggesting', 'viewing'];
  }

  async function chooseMode(mode: Mode): Promise<void> {
    if (!allowedModes().includes(mode)) return;
    await session.setMode(mode);
  }

  function onModeKey(event: KeyboardEvent, mode: Mode): void {
    const allowed = allowedModes();
    const index = allowed.indexOf(mode);
    if (index === -1) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      const next = allowed[(index + 1) % allowed.length] as Mode;
      void chooseMode(next).then(() => modeRadios.get(next)?.focus());
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = allowed[(index - 1 + allowed.length) % allowed.length] as Mode;
      void chooseMode(next).then(() => modeRadios.get(next)?.focus());
    } else if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      void chooseMode(mode);
    }
  }

  const saveStatus = el('p', { class: 'save-status', role: 'status', 'aria-label': 'Save status' });
  saveStatus.textContent =
    snapshot.saveState === 'saved' ? 'All changes saved' : snapshot.saveState === 'saving' ? 'Saving' : 'Not saved';
  const wordCountNode = el('p', { class: 'word-count' });
  const accessNode = el('p', { class: 'access-label' });
  const sheetButton = el('button', { type: 'button', class: 'chrome-button sheet-button', 'aria-label': 'Comments and suggestions' });
  const statusBar = el('div', { class: 'status-bar', role: 'region', 'aria-label': 'Document status' }, [
    saveStatus,
    wordCountNode,
    accessNode,
    sheetButton,
  ]);

  const toolbarActions = {
    comment: () => startComment(),
    find: () => find.show(null),
    acceptAll: () => confirmDecideAll('accept'),
    rejectAll: () => confirmDecideAll('reject'),
    link: () => openLinkDialog(),
    outline: () => openOutlineDialog(),
    share: () => openShareDialog(session, shareButton),
  };
  const toolbar = new Toolbar(session, page, toolbarActions);

  const outlineButton = el('button', { type: 'button', class: 'chrome-button outline-button', 'aria-label': 'Outline', 'aria-expanded': 'false' }, [
    icon('list'),
    'Outline',
  ]);
  const outlinePanel = el('div', { class: 'outline-rail' }, [outline.element]);
  outlineButton.addEventListener('click', () => {
    const open = outlinePanel.classList.toggle('open');
    outlineButton.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) outline.element.querySelector<HTMLElement>('[role="listbox"]')?.focus();
  });
  outlinePanel.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Escape' && outlinePanel.classList.contains('open')) {
      outlinePanel.classList.remove('open');
      outlineButton.setAttribute('aria-expanded', 'false');
      outlineButton.focus();
    }
  });

  const sheet = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Comments and suggestions', hidden: true }, [
    el('div', { class: 'sheet-handle', 'aria-hidden': 'true' }),
    margin.sheetHost,
    el('button', { type: 'button', class: 'chrome-button', text: 'Close', onclick: () => closeSheet() }),
  ]);
  trapFocus(sheet);
  escapeCloses(sheet, () => closeSheet());
  let sheetTouchStart = 0;
  sheet.addEventListener('touchstart', (event) => {
    sheetTouchStart = (event as TouchEvent).touches[0]?.clientY ?? 0;
  });
  sheet.addEventListener('touchend', (event) => {
    const end = (event as TouchEvent).changedTouches[0]?.clientY ?? 0;
    if (end - sheetTouchStart > 40) closeSheet();
  });

  function openSheet(cardId?: string): void {
    sheet.hidden = false;
    margin.render();
    if (cardId) margin.focusCard(cardId);
    else sheet.querySelector<HTMLElement>('.card')?.focus();
  }

  function closeSheet(): void {
    sheet.hidden = true;
    sheetButton.focus();
  }

  sheetButton.addEventListener('click', () => (sheet.hidden ? openSheet() : closeSheet()));

  const resolvedToggle = el('input', { type: 'checkbox', id: 'show-resolved' });
  resolvedToggle.addEventListener('change', () => {
    margin.showResolved = resolvedToggle.checked;
    refreshDecorations();
    margin.render();
  });

  const sheetWrapper = el('div', { class: 'page-sheet' });
  page.appendTo(sheetWrapper);
  const workArea = el('div', { class: 'work-area' }, [
    outlinePanel,
    el('div', { class: 'page-column' }, [sheetWrapper]),
    el('div', { class: 'margin-wrapper' }, [
      el('div', { class: 'margin-head' }, [resolvedToggle, el('label', { for: 'show-resolved', text: 'Show resolved' })]),
      margin.column,
    ]),
    margin.tetherLayer,
  ]);

  const editorRoot = el('div', { class: 'editor' }, [
    el('header', { class: 'menu-bar' }, [
      el('a', {
        class: 'documents-link',
        href: '/',
        text: 'Documents',
        onclick: (event: Event) => {
          event.preventDefault();
          navigate('/');
        },
      }),
      titleNode,
      peopleList,
      el('div', { class: 'menu-right' }, [shareButton, notices.button, modeGroup]),
    ]),
    el('div', { class: 'toolbar-row' }, [toolbar.element, toolbar.menuButton, outlineButton]),
    statusBar,
    workArea,
    sheet,
  ]);

  function startComment(): void {
    page.readSelection();
    if (page.selection.length === 0 || !session.canComment) return;
    margin.openDraft(page.selection);
  }

  function openLinkDialog(): void {
    const opener = document.activeElement as HTMLElement | null;
    const address = el('input', { type: 'url', 'aria-label': 'Link address' });
    const apply = el('button', { type: 'button', class: 'primary', text: 'Apply' });
    const removeLink = el('button', { type: 'button', class: 'chrome-button', text: 'Remove link' });
    const cancel = el('button', { type: 'button', class: 'chrome-button', text: 'Cancel' });
    const close = (): void => {
      backdrop.remove();
      opener?.focus();
    };
    const dialog = el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Link' }, [
      el('h2', { text: 'Link' }),
      el('div', { class: 'field' }, [el('label', { text: 'Link address' }), address]),
      el('div', { class: 'dialog-actions' }, [apply, removeLink, cancel]),
    ]);
    const backdrop = el('div', { class: 'backdrop' }, [dialog]);
    trapFocus(dialog);
    escapeCloses(dialog, close);
    cancel.addEventListener('click', close);
    apply.addEventListener('click', () => {
      page.setLink(address.value);
      close();
    });
    removeLink.addEventListener('click', () => {
      page.setLink(null);
      close();
    });
    document.body.appendChild(backdrop);
    address.focus();
  }

  function openOutlineDialog(): void {
    const opener = document.activeElement as HTMLElement | null;
    const close = (): void => {
      backdrop.remove();
      workArea.appendChild(outlinePanel);
      opener?.focus();
    };
    const dialog = el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Outline' }, [
      outlinePanel,
      el('button', { type: 'button', class: 'chrome-button', text: 'Close', onclick: close }),
    ]);
    const backdrop = el('div', { class: 'backdrop' }, [dialog]);
    trapFocus(dialog);
    escapeCloses(dialog, close);
    document.body.appendChild(backdrop);
    outline.element.querySelector<HTMLElement>('[role="listbox"]')?.focus();
  }

  function confirmDecideAll(decision: 'accept' | 'reject'): void {
    if (!session.canEdit) return;
    const opener = document.activeElement as HTMLElement | null;
    const count = session.state.suggestions.length;
    const label = decision === 'accept' ? 'Accept all' : 'Reject all';
    const confirm = el('button', { type: 'button', class: 'primary', text: label });
    const cancel = el('button', { type: 'button', class: 'chrome-button', text: 'Cancel' });
    const close = (): void => {
      backdrop.remove();
      opener?.focus();
    };
    const dialog = el(
      'div',
      { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': `${label} suggestions` },
      [
        el('h2', { text: `${label} suggestions` }),
        el('p', { text: `${count} ${count === 1 ? 'suggestion' : 'suggestions'} will be settled.` }),
        el('div', { class: 'dialog-actions' }, [confirm, cancel]),
      ],
    );
    const backdrop = el('div', { class: 'backdrop' }, [dialog]);
    trapFocus(dialog);
    escapeCloses(dialog, close);
    cancel.addEventListener('click', close);
    confirm.addEventListener('click', () => {
      confirm.disabled = true;
      confirm.textContent = decision === 'accept' ? 'Accepting' : 'Rejecting';
      void session.decideAll(decision).then((settled) => {
        close();
        const word = settled === 1 ? 'suggestion' : 'suggestions';
        announce(`${settled} ${word} ${decision === 'accept' ? 'accepted' : 'rejected'}`);
      });
    });
    document.body.appendChild(backdrop);
    cancel.focus();
  }

  function updateSheetButton(): void {
    sheetButton.textContent = `Comments and suggestions (${margin.openCardCount()})`;
  }

  function refreshDecorations(): void {
    const matches = find.decorations();
    page.setDecorations({
      matches: matches.matches,
      currentMatch: matches.currentMatch,
      markers: margin.markers(),
      hiddenCommentIds: margin.hiddenCommentIds(),
      focusedCardId: margin.focusedCardId,
    });
    page.render();
    margin.layout();
  }

  let lastStatusText = saveStatus.textContent ?? '';
  function updateStatus(): void {
    const state = session.saveState;
    const text = state === 'saved' ? 'All changes saved' : state === 'saving' ? 'Saving' : 'Not saved';
    if (text !== lastStatusText) {
      saveStatus.textContent = text;
      lastStatusText = text;
    }
    if (state === 'failed') {
      showBanner('storage', "Your latest edits are not saved. Quillmere can't reach storage and is retrying.");
    } else {
      hideBanner('storage');
    }
  }

  function updateWordCount(): void {
    const count = wordCount(session.state);
    wordCountNode.textContent = count === 1 ? '1 word' : `${count} words`;
  }

  function updateAccessLabel(): void {
    accessNode.textContent = session.accessEndsAt
      ? `Access until ${new Date(session.accessEndsAt).toLocaleString()}`
      : '';
  }

  function updatePeople(): void {
    clear(peopleList);
    const entries = [
      { person: { personId: session.me.personId, displayName: session.me.displayName, colour: session.me.colour, role: session.role } },
      ...[...session.presence.values()].filter((entry) => entry.person.personId !== session.me.personId),
    ];
    for (const entry of entries) {
      peopleList.appendChild(
        el('li', { class: 'person-chip' }, [
          el('span', { class: 'chip', style: `background:${session.personColour(entry.person.personId)}` }),
          el('span', { text: entry.person.displayName }),
          el('span', { class: 'person-role', text: roleLabel(entry.person.role) }),
        ]),
      );
    }
    page.renderCarets();
  }

  function updateModeSwitch(): void {
    const allowed = allowedModes();
    for (const entry of MODES) {
      const radio = modeRadios.get(entry.mode);
      if (!radio) continue;
      const enabled = allowed.includes(entry.mode);
      const checked = session.mode === entry.mode;
      radio.setAttribute('aria-checked', checked ? 'true' : 'false');
      radio.setAttribute('aria-disabled', enabled ? 'false' : 'true');
      radio.toggleAttribute('disabled', !enabled);
      radio.setAttribute('tabindex', checked ? '0' : '-1');
      radio.classList.toggle('checked', checked);
    }
    page.element.setAttribute('contenteditable', session.mode === 'viewing' ? 'false' : 'true');
    page.element.setAttribute('aria-readonly', session.mode === 'viewing' ? 'true' : 'false');
    toolbar.update();
  }

  session.on('doc', () => {
    refreshDecorations();
    outline.render();
    updateWordCount();
    updateStatus();
  });
  session.on('cards', () => {
    const settled = session.lastSettled;
    session.lastSettled = null;
    if (settled) margin.settle(settled.card.id);
    margin.render();
    if (settled && settled.status === 'accepted' && settled.card.kind !== 'delete' && settled.card.inserted) {
      page.element.style.setProperty('--settle-colour', session.personColour(settled.card.author.personId));
      page.setDecorations({ inkFade: [settled.card.inserted] });
      window.setTimeout(() => {
        page.setDecorations({ inkFade: [] });
        page.render();
      }, 260);
    }
    refreshDecorations();
    updateSheetButton();
  });
  session.on('presence', () => updatePeople());
  session.on('save', () => updateStatus());
  session.on('title', () => {
    if (titleNode instanceof HTMLInputElement) titleNode.value = session.title;
    else titleNode.textContent = session.title;
  });
  session.on('role', () => {
    updateModeSwitch();
    updateAccessLabel();
    margin.render();
    refreshDecorations();
  });
  session.on('access', () => {
    if (session.accessEnded) {
      connection.close();
      clearBanners();
      renderAccessEnded(session.accessEnded);
    }
  });
  session.on('connection', () => {
    if (session.connected) hideBanner('socket');
    else showBanner('socket', 'Connection lost. Reconnecting.');
    updateModeSwitch();
  });

  let announcedRole: Role = session.role;
  session.on('role', () => {
    if (announcedRole === session.role) return;
    announcedRole = session.role;
    const suffix = session.mode === 'suggesting' ? " You're now suggesting." : session.mode === 'viewing' ? " You're now viewing." : '';
    announce(`Your access changed to ${roleLabel(session.role)}.${suffix}`);
  });

  editorRoot.addEventListener('keydown', (event) => onKeyDown(event));

  function onKeyDown(event: KeyboardEvent): void {
    const meta = event.ctrlKey || event.metaKey;
    if (meta && (event.key === 'z' || event.key === 'y')) {
      event.preventDefault();
      return;
    }
    if (event.altKey && event.shiftKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      margin.cycle(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (meta && event.altKey && (event.key === 'm' || event.key === 'M' || event.code === 'KeyM')) {
      event.preventDefault();
      startComment();
      return;
    }
    if (meta && (event.key === 'f' || event.code === 'KeyF')) {
      event.preventDefault();
      find.show(null);
      return;
    }
    if (meta && event.altKey && ['0', '1', '2', '3'].includes(event.key)) {
      event.preventDefault();
      const style = event.key === '0' ? 'paragraph' : (`heading${event.key}` as 'heading1' | 'heading2' | 'heading3');
      page.setBlockStyle(style);
      return;
    }
    if (meta && !event.altKey && ['b', 'i', 'u'].includes(event.key.toLowerCase())) {
      event.preventDefault();
      const key = event.key.toLowerCase();
      page.toggleMark(key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'underline');
      return;
    }
    if (!page.element.contains(event.target as Node)) return;
    if ((event.ctrlKey || event.altKey) && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      const text = session.state.text;
      const moving = page.focusAt;
      const target = event.key === 'ArrowRight' ? wordEndAfter(text, moving) : wordStartBefore(text, moving);
      if (event.shiftKey) {
        const anchor = page.selection.at === moving ? page.selection.at + page.selection.length : page.selection.at;
        page.setSelection({ at: Math.min(anchor, target), length: Math.abs(target - anchor) }, target >= anchor);
        page.focusAt = target;
      } else {
        page.setSelection({ at: target, length: 0 });
      }
    }
  }

  renderInto(editorRoot);
  margin.render();
  refreshDecorations();
  outline.render();
  updateWordCount();
  updateAccessLabel();
  updatePeople();
  updateModeSwitch();
  updateSheetButton();
  window.addEventListener('resize', () => {
    margin.render();
    refreshDecorations();
  });
  workArea.addEventListener('scroll', () => margin.layout(), true);
  window.addEventListener('scroll', () => margin.layout(), true);
}
