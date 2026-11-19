import { describeChange } from '../shared/announce.js';
import { checkAreaName } from '../shared/area.js';
import { effectiveGap, getScopeGrid, ownGap, scopeLabel, sortedBreakpoints } from '../shared/grid.js';
import { generateCss, generateHtml } from '../shared/generate.js';
import { GAP_MESSAGE } from '../shared/messages.js';
import type { Axis, Change, LayoutObject, LayoutState, Rect, Scope } from '../shared/types.js';
import { Canvas } from './canvas.js';
import { cancelButton, openDialog } from './dialog.js';
import { api, clear, h, isTextField, reducedMotion, undoShortcut } from './dom.js';
import { PreviewPane, roundHalfUp } from './preview.js';
import { tabStrip } from './tabs.js';

const LIVE_PAUSED = 'Live updates are paused. Your changes are still saved.';
const UNREACHABLE = 'Mullion could not be reached. Your last change was not saved.';
const NOTICE_LIFETIME = 8000;
const SLIDE_MS = 220;

interface Boot {
  username: string;
  layout: LayoutObject;
}

interface ChangeReply {
  revision: number;
  unchanged?: boolean;
  layout?: LayoutObject;
  error?: string;
  message?: string;
}

function stateOf(layout: LayoutObject): LayoutState {
  return {
    columns: layout.columns,
    rows: layout.rows,
    gap: layout.gap,
    areas: layout.areas,
    breakpoints: layout.breakpoints,
  };
}

export function mountEditor(root: HTMLElement, boot: Boot): void {
  let layout = boot.layout;
  let previewWidth = 1280;
  let designers: string[] = [boot.username];
  let inFlight = 0;
  let noticeTimer = 0;
  let exitTimer = 0;

  const scopeInEffect = (): Scope => {
    const below = sortedBreakpoints(stateOf(layout)).filter((item) => item.min_width <= previewWidth);
    const nearest = below[below.length - 1];
    return nearest ? nearest.min_width : 'base';
  };
  let shownScope: Scope = scopeInEffect();
  let livePaused = !layout.live;
  let lastSyncedCss: string | null = null;

  /* Top bar. */
  const saveState = h('div', { role: 'status', 'aria-label': 'Save state', class: 'save-state', text: 'All changes saved.' });
  const heading = h('h1', { text: layout.name });
  const saveVersionButton = h('button', { type: 'button', text: 'Save version' });
  const versionsButton = h('button', { type: 'button', text: 'Versions' });
  const shareButton = h('button', { type: 'button', class: 'primary', text: 'Share' });
  const topBar = h(
    'header',
    { class: 'top-bar' },
    h('a', { href: '/', text: 'Your layouts' }),
    heading,
    saveState,
    h(
      'div',
      { class: 'top-actions' },
      saveVersionButton,
      versionsButton,
      layout.role === 'owner' ? shareButton : null,
    ),
  );

  /* Notices. */
  const noticeText = h('div', { role: 'alert', 'aria-label': 'Editor notice', class: 'editor-notice' });
  const dismissButton = h('button', {
    type: 'button',
    class: 'dismiss-notice',
    'aria-label': 'Dismiss notice',
    text: 'Dismiss',
    onclick: () => hideNotice(),
  });
  const noticeHolder = h('div', { class: 'notice-holder' }, noticeText);
  const liveStatus = h('div', { role: 'status', 'aria-label': 'Live status', class: 'live-status' });
  const updates = h('div', { role: 'status', 'aria-live': 'polite', 'aria-label': 'Layout updates', class: 'updates' });
  const editProblem = h('div', { role: 'alert', 'aria-label': 'Edit problem', class: 'alert' });
  const noticeArea = h('div', { class: 'notice-area' }, noticeHolder, liveStatus, updates, editProblem);

  function announce(message: string): void {
    updates.textContent = message;
  }

  function problem(message: string): void {
    editProblem.textContent = message;
  }

  function hideNotice(): void {
    window.clearTimeout(noticeTimer);
    window.clearTimeout(exitTimer);
    noticeHolder.classList.remove('showing');
    noticeHolder.classList.add('leaving');
    exitTimer = window.setTimeout(() => {
      noticeText.textContent = '';
      dismissButton.remove();
      noticeHolder.classList.remove('leaving');
    }, reducedMotion() ? 0 : SLIDE_MS);
  }

  function showNotice(message: string): void {
    window.clearTimeout(noticeTimer);
    window.clearTimeout(exitTimer);
    noticeHolder.classList.remove('leaving');
    noticeText.textContent = message;
    noticeHolder.append(dismissButton);
    noticeHolder.classList.add('showing');
    noticeTimer = window.setTimeout(hideNotice, NOTICE_LIFETIME);
  }

  /* Rail. */
  const breakpointTabsHolder = h('div', { class: 'breakpoint-tabs' });
  const addBreakpointButton = h('button', { type: 'button', text: 'Add breakpoint' });
  const removeBreakpointButton = h('button', { type: 'button', text: 'Remove breakpoint' });
  const rowGapField = h('input', { type: 'text', class: 'gap-field numeric', 'aria-label': 'Row gap' }) as HTMLInputElement;
  const columnGapField = h('input', { type: 'text', class: 'gap-field numeric', 'aria-label': 'Column gap' }) as HTMLInputElement;
  const gapProblem = h('p', { class: 'field-problem' });
  const inheritedNote = h('p', { class: 'inherited-note' });
  const addColumnButton = h('button', { type: 'button', text: 'Add column' });
  const addRowButton = h('button', { type: 'button', text: 'Add row' });
  const designerList = h('ul', { role: 'list', 'aria-label': 'Designers here', class: 'designers' });
  const rail = h(
    'div',
    { class: 'pane rail', role: 'tabpanel', id: 'panel-tracks', 'aria-label': 'Tracks' },
    breakpointTabsHolder,
    h('div', { class: 'rail-row' }, addBreakpointButton, removeBreakpointButton),
    h('div', { class: 'rail-field' }, h('label', { text: 'Row gap' }), rowGapField),
    h('div', { class: 'rail-field' }, h('label', { text: 'Column gap' }), columnGapField),
    inheritedNote,
    gapProblem,
    h('div', { class: 'rail-row' }, addColumnButton, addRowButton),
    h('h2', { class: 'rail-heading', text: 'Designers here' }),
    designerList,
  );

  /* Canvas. */
  const canvas = new Canvas({
    editable: true,
    nameArea: (selection) => openNameArea(selection),
    clearCells: (selection) =>
      send({ kind: 'clear_cells', scope: shownScope, ...selection }),
    trackCommand: (command, axis, index) => {
      if (command === 'add') send({ kind: 'add_track', scope: shownScope, axis, after: index });
      else send({ kind: 'remove_track', scope: shownScope, axis, index });
    },
    setTrackSize: (axis, index, size) => send({ kind: 'set_track', scope: shownScope, axis, index, size }),
    fieldProblem: (field, message) => {
      field.setAttribute('aria-invalid', 'true');
      const holder = field.parentElement;
      if (holder) {
        const note = holder.querySelector('.field-problem') ?? h('p', { class: 'field-problem' });
        note.textContent = message;
        holder.append(note);
      }
      problem(message);
      announce(message);
    },
  });
  const canvasPane = h(
    'div',
    { class: 'pane canvas-pane', role: 'tabpanel', id: 'panel-grid', 'aria-label': 'Grid' },
    canvas.element,
  );

  /* Preview and code. */
  const preview = new PreviewPane();
  const widthReadout = h('output', { class: 'width-readout numeric' });
  const widthSlider = h('input', {
    type: 'range',
    min: '320',
    max: '1440',
    step: '1',
    class: 'width-slider',
    'aria-label': 'Preview width',
  }) as HTMLInputElement;
  const previewPane = h(
    'div',
    { class: 'pane preview-pane', role: 'tabpanel', id: 'panel-preview', 'aria-label': 'Preview' },
    h('div', { class: 'preview-controls' }, h('label', { text: 'Preview width' }), widthSlider, widthReadout),
    h('div', { class: 'preview-frame-holder' }, preview.frame),
  );

  const cssField = h('textarea', {
    class: 'code-field numeric',
    'aria-label': 'Layout CSS',
    spellcheck: 'false',
  }) as HTMLTextAreaElement;
  const htmlField = h('textarea', {
    class: 'code-field numeric',
    'aria-label': 'Layout HTML',
    readonly: true,
    spellcheck: 'false',
  }) as HTMLTextAreaElement;
  const applyCssButton = h('button', { type: 'button', class: 'primary', text: 'Apply CSS' });
  const cssPanel = h(
    'div',
    { role: 'tabpanel', id: 'panel-css', 'aria-label': 'CSS', class: 'code-panel' },
    cssField,
    applyCssButton,
  );
  const htmlPanel = h(
    'div',
    { role: 'tabpanel', id: 'panel-html', 'aria-label': 'HTML', class: 'code-panel' },
    htmlField,
  );
  const codeTabs = tabStrip(
    'Code',
    [
      { id: 'css', label: 'CSS' },
      { id: 'html', label: 'HTML' },
    ],
    'css',
    (id) => {
      cssPanel.hidden = id !== 'css';
      htmlPanel.hidden = id !== 'html';
    },
  );
  htmlPanel.hidden = true;
  const codePane = h(
    'div',
    { class: 'pane code-pane', role: 'tabpanel', id: 'panel-code', 'aria-label': 'Code' },
    codeTabs.list,
    cssPanel,
    htmlPanel,
  );

  const panes = h('div', { class: 'panes' }, rail, canvasPane, h('div', { class: 'side' }, previewPane, codePane));
  const paneTabs = tabStrip(
    'Editor panes',
    [
      { id: 'grid', label: 'Grid' },
      { id: 'tracks', label: 'Tracks' },
      { id: 'preview', label: 'Preview' },
      { id: 'code', label: 'Code' },
    ],
    'grid',
    (id) => showPane(id),
  );
  const paneTabsHolder = h('div', { class: 'pane-tabs' }, paneTabs.list);

  root.append(h('div', { class: 'editor' }, topBar, noticeArea, paneTabsHolder, panes));

  function showPane(id: string): void {
    const phone = window.innerWidth < 700;
    for (const [key, pane] of [
      ['grid', canvasPane],
      ['tracks', rail],
      ['preview', previewPane],
      ['code', codePane],
    ] as [string, HTMLElement][]) {
      pane.hidden = phone && key !== id;
    }
  }

  /* Rendering. */
  function renderBreakpointTabs(): void {
    clear(breakpointTabsHolder);
    const scopes: Scope[] = ['base', ...sortedBreakpoints(stateOf(layout)).map((item) => item.min_width)];
    const strip = tabStrip(
      'Breakpoints',
      scopes.map((scope) => ({
        id: String(scope),
        label: scopeLabel(scope),
        focusKey: `breakpoint-tab-${scope}`,
      })),
      String(shownScope),
      (id) => setPreviewWidth(id === 'base' ? 375 : Number(id)),
    );
    breakpointTabsHolder.append(strip.list);
    removeBreakpointButton.disabled = shownScope === 'base';
  }

  function renderRail(): void {
    const gap = effectiveGap(stateOf(layout), shownScope);
    rowGapField.value = String(gap.row);
    columnGapField.value = String(gap.column);
    rowGapField.removeAttribute('aria-invalid');
    columnGapField.removeAttribute('aria-invalid');
    gapProblem.textContent = '';
    const own = ownGap(stateOf(layout), shownScope);
    inheritedNote.textContent = shownScope !== 'base' && !own ? 'inherited' : '';
    clear(designerList);
    for (const name of designers) designerList.append(h('li', { role: 'listitem', text: name }));
  }

  function renderPreviewAndCode(): void {
    const state = stateOf(layout);
    preview.update(generateCss(state), generateHtml(state), previewWidth);
    widthSlider.value = String(previewWidth);
    widthSlider.setAttribute('aria-valuetext', `${previewWidth}px`);
    widthReadout.textContent = `${previewWidth}px`;
    if (layout.css !== lastSyncedCss) {
      lastSyncedCss = layout.css;
      cssField.value = layout.css;
    }
    htmlField.value = layout.html;
  }

  function render(animate: boolean): boolean {
    const scope = scopeInEffect();
    const moved = scope !== shownScope;
    shownScope = scope;
    if (!layout.live) livePaused = true;
    const focusKey = (document.activeElement as HTMLElement | null)?.dataset['focusKey'] ?? null;

    heading.textContent = layout.name;
    liveStatus.textContent = livePaused ? LIVE_PAUSED : '';
    renderBreakpointTabs();
    renderRail();
    renderPreviewAndCode();
    showPane(paneTabs.selected());
    const grid = getScopeGrid(stateOf(layout), shownScope);
    if (grid) {
      const resolved = preview.resolvedColumns().map(roundHalfUp);
      canvas.render({ columns: grid.columns, rows: grid.rows, areas: grid.areas }, resolved, animate || moved);
    }

    if (focusKey && !root.contains(document.activeElement)) {
      root.querySelector<HTMLElement>(`[data-focus-key="${focusKey}"]`)?.focus();
    }
    return moved;
  }

  /* Changes. */
  function markSaving(): void {
    inFlight += 1;
    saveState.textContent = 'Saving…';
  }

  function markSaved(reached: boolean): void {
    inFlight = Math.max(0, inFlight - 1);
    if (!reached) {
      saveState.textContent = 'Not saved. Check your connection.';
      return;
    }
    if (inFlight === 0) saveState.textContent = 'All changes saved.';
  }

  async function send(change: Change, onProblem?: (message: string) => void): Promise<boolean> {
    const before = stateOf(layout);
    markSaving();
    const reply = await api<ChangeReply>('POST', `/api/layouts/${layout.id}/changes`, {
      base_revision: layout.revision,
      change,
    });
    if (!reply) {
      markSaved(false);
      problem(UNREACHABLE);
      announce(UNREACHABLE);
      return false;
    }
    markSaved(true);
    if (reply.status === 200 && reply.body.unchanged) {
      layout = { ...layout, revision: reply.body.revision };
      announce('No changes.');
      return true;
    }
    if (reply.status === 200 && reply.body.layout) {
      layout = reply.body.layout;
      problem('');
      announce(describeChange(change, before, stateOf(layout)));
      render(false);
      return true;
    }
    if (reply.status === 409 && reply.body.layout) {
      layout = reply.body.layout;
      showNotice(reply.body.message ?? '');
      render(false);
      return false;
    }
    const message = reply.body.message ?? '';
    if (onProblem) onProblem(message);
    else {
      problem(message);
      announce(message);
    }
    render(false);
    return false;
  }

  /* Dialogs. */
  function openNameArea(selection: Rect): void {
    const grid = getScopeGrid(stateOf(layout), shownScope);
    const existing = grid?.areas.find(
      (area) =>
        area.row_start === selection.row_start &&
        area.row_end === selection.row_end &&
        area.column_start === selection.column_start &&
        area.column_end === selection.column_end,
    );
    openDialog(
      {
        label: 'Name area',
        heading: 'Name area',
        restoreFocus: () => canvas.focusCursor(),
        announce,
      },
      (dialog) => {
        const field = h('input', {
          type: 'text',
          'aria-label': 'Area name',
          value: existing ? existing.name : '',
        }) as HTMLInputElement;
        const save = async (): Promise<void> => {
          const name = field.value.trim();
          const nameProblem = checkAreaName(name);
          if (nameProblem) {
            dialog.showProblem(nameProblem);
            return;
          }
          const accepted = await send(
            { kind: 'set_area', scope: shownScope, name, ...selection },
            (message) => dialog.showProblem(message),
          );
          if (accepted) dialog.close();
        };
        field.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void save();
          }
        });
        window.setTimeout(() => field.focus(), 0);
        return [
          h('p', { class: 'field' }, h('label', { text: 'Area name' }), field),
          h(
            'p',
            { class: 'actions' },
            h('button', { type: 'button', class: 'primary', text: 'Save area', onclick: () => void save() }),
            cancelButton(dialog),
          ),
        ];
      },
    );
  }

  function openAddBreakpoint(): void {
    openDialog(
      { label: 'Add breakpoint', heading: 'Add breakpoint', restoreFocus: () => addBreakpointButton.focus(), announce },
      (dialog) => {
        const field = h('input', { type: 'text', 'aria-label': 'Minimum width' }) as HTMLInputElement;
        const add = async (): Promise<void> => {
          const value = Number(field.value.trim());
          const accepted = await send({ kind: 'add_breakpoint', min_width: value }, (message) =>
            dialog.showProblem(message),
          );
          if (accepted) dialog.close();
        };
        window.setTimeout(() => field.focus(), 0);
        return [
          h('p', { class: 'field' }, h('label', { text: 'Minimum width' }), field),
          h(
            'p',
            { class: 'actions' },
            h('button', { type: 'button', class: 'primary', text: 'Add', onclick: () => void add() }),
            cancelButton(dialog),
          ),
        ];
      },
    );
  }

  function openSaveVersion(): void {
    openDialog(
      { label: 'Save version', heading: 'Save version', restoreFocus: () => saveVersionButton.focus(), announce },
      (dialog) => {
        const field = h('input', { type: 'text', 'aria-label': 'Version name' }) as HTMLInputElement;
        const save = async (): Promise<void> => {
          markSaving();
          const reply = await api<{ number: number; name: string; message?: string }>(
            'POST',
            `/api/layouts/${layout.id}/versions`,
            { name: field.value },
          );
          if (!reply) {
            markSaved(false);
            dialog.showProblem(UNREACHABLE);
            return;
          }
          markSaved(true);
          if (reply.status !== 201) {
            dialog.showProblem(reply.body.message ?? '');
            return;
          }
          announce(`Version ${reply.body.number} saved.`);
          dialog.close();
        };
        window.setTimeout(() => field.focus(), 0);
        return [
          h('p', { class: 'field' }, h('label', { text: 'Version name' }), field),
          h(
            'p',
            { class: 'actions' },
            h('button', { type: 'button', class: 'primary', text: 'Save', onclick: () => void save() }),
            cancelButton(dialog),
          ),
        ];
      },
    );
  }

  async function openVersions(): Promise<void> {
    const list = await api<{ versions: { number: number; name: string }[] }>(
      'GET',
      `/api/layouts/${layout.id}/versions`,
    );
    if (!list || list.status !== 200) {
      problem(UNREACHABLE);
      return;
    }
    const versions = list.body.versions;
    openDialog(
      { label: 'Versions', heading: 'Versions', restoreFocus: () => versionsButton.focus(), announce },
      (dialog) => {
        dialog.element.classList.add('drawer');
        window.requestAnimationFrame(() => dialog.element.classList.add('open'));
        const differences = h('ul', { role: 'list', 'aria-label': 'Differences', class: 'differences' });
        const saved = h('ul', { role: 'list', 'aria-label': 'Saved versions', class: 'saved-versions' });
        for (const version of versions) {
          saved.append(
            h(
              'li',
              { role: 'listitem' },
              h('span', { text: `Version ${version.number}: ${version.name}` }),
              h('button', {
                type: 'button',
                'aria-label': `Restore version ${version.number}`,
                text: 'Restore',
                onclick: (event: Event) => confirmRestore(version.number, event.currentTarget as HTMLElement),
              }),
            ),
          );
        }
        const options = (label: string): HTMLSelectElement => {
          const select = h('select', { 'aria-label': label }) as HTMLSelectElement;
          for (const version of versions) {
            select.append(
              h('option', { value: String(version.number), text: `Version ${version.number}: ${version.name}` }),
            );
          }
          return select;
        };
        const from = options('Compare from');
        const to = options('Compare to');
        const compare = async (): Promise<void> => {
          const reply = await api<{ differences: string[] }>(
            'GET',
            `/api/layouts/${layout.id}/compare?from=${from.value}&to=${to.value}`,
          );
          clear(differences);
          if (!reply || reply.status !== 200) return;
          for (const line of reply.body.differences) {
            differences.append(h('li', { role: 'listitem', text: line }));
          }
        };
        const close = (): void => {
          dialog.element.classList.remove('open');
          window.setTimeout(() => dialog.close(), reducedMotion() ? 0 : SLIDE_MS);
        };
        return [
          h('button', { type: 'button', text: 'Close versions', onclick: close }),
          saved,
          h('div', { class: 'compare-row' }, from, to, h('button', { type: 'button', text: 'Compare', onclick: () => void compare() })),
          differences,
        ];
      },
    );
  }

  function confirmRestore(number: number, opener: HTMLElement): void {
    openDialog(
      {
        label: `Restore version ${number}?`,
        heading: `Restore version ${number}?`,
        restoreFocus: () => opener.focus(),
        announce,
      },
      (dialog) => [
        h(
          'p',
          { class: 'actions' },
          h('button', {
            type: 'button',
            class: 'primary',
            text: 'Restore',
            onclick: async () => {
              const accepted = await send({ kind: 'restore_version', number }, (message) =>
                dialog.showProblem(message),
              );
              if (accepted) dialog.close();
            },
          }),
          cancelButton(dialog),
        ),
      ],
    );
  }

  async function openShare(): Promise<void> {
    const reply = await api<{ view_path: string | null; join_path: string; collaborators: string[] }>(
      'GET',
      `/api/layouts/${layout.id}/share`,
    );
    if (!reply || reply.status !== 200) {
      problem(UNREACHABLE);
      return;
    }
    let share = reply.body;
    openDialog(
      { label: 'Share', heading: 'Share', restoreFocus: () => shareButton.focus(), announce },
      (dialog) => {
        const body = h('div', { class: 'share-body' });
        const origin = window.location.origin;

        const refresh = (): void => {
          clear(body);
          if (share.view_path === null) {
            body.append(
              h('p', {}, h('button', {
                type: 'button',
                class: 'primary',
                text: 'Create view link',
                onclick: () => void linkAction('POST', 'view-link', 'View link created.'),
              })),
            );
          } else {
            body.append(
              h(
                'p',
                { class: 'field' },
                h('label', { text: 'View link' }),
                h('input', { type: 'text', readonly: true, 'aria-label': 'View link', value: origin + share.view_path }),
              ),
              h(
                'p',
                { class: 'actions' },
                h('button', {
                  type: 'button',
                  text: 'Regenerate view link',
                  onclick: () => void linkAction('POST', 'view-link', 'View link regenerated.'),
                }),
                h('button', {
                  type: 'button',
                  text: 'Revoke view link',
                  onclick: () => void linkAction('DELETE', 'view-link', 'View link revoked.'),
                }),
              ),
            );
          }
          body.append(
            h(
              'p',
              { class: 'field' },
              h('label', { text: 'Co-edit link' }),
              h('input', { type: 'text', readonly: true, 'aria-label': 'Co-edit link', value: origin + share.join_path }),
            ),
            h(
              'p',
              { class: 'actions' },
              h('button', {
                type: 'button',
                text: 'Regenerate co-edit link',
                onclick: () => void linkAction('POST', 'join-link', 'Co-edit link regenerated.'),
              }),
            ),
          );
          const collaborators = h('ul', { role: 'list', 'aria-label': 'Collaborators', class: 'collaborators' });
          for (const username of share.collaborators) {
            collaborators.append(
              h(
                'li',
                { role: 'listitem' },
                h('span', { text: username }),
                h('button', {
                  type: 'button',
                  'aria-label': `Remove ${username}`,
                  text: 'Remove',
                  onclick: () => void removeCollaborator(username),
                }),
              ),
            );
          }
          body.append(collaborators);
        };

        const reload = async (): Promise<void> => {
          const next = await api<{ view_path: string | null; join_path: string; collaborators: string[] }>(
            'GET',
            `/api/layouts/${layout.id}/share`,
          );
          if (next && next.status === 200) share = next.body;
          refresh();
        };

        const linkAction = async (method: string, route: string, message: string): Promise<void> => {
          markSaving();
          const result = await api<{ error?: string }>(method, `/api/layouts/${layout.id}/${route}`);
          if (!result) {
            markSaved(false);
            dialog.showProblem(UNREACHABLE);
            return;
          }
          markSaved(true);
          if (result.status >= 400) {
            dialog.showProblem(result.body.error ?? '');
            return;
          }
          announce(message);
          await reload();
        };

        const removeCollaborator = async (username: string): Promise<void> => {
          markSaving();
          const result = await api<unknown>(
            'DELETE',
            `/api/layouts/${layout.id}/collaborators/${encodeURIComponent(username)}`,
          );
          if (!result) {
            markSaved(false);
            dialog.showProblem(UNREACHABLE);
            return;
          }
          markSaved(true);
          announce(`${username} removed from collaborators.`);
          await reload();
        };

        refresh();
        return [body, cancelButton(dialog, 'Close')];
      },
    );
  }

  /* Gaps. */
  const gapAttempt = new Map<string, string>();

  function gapCommit(field: HTMLInputElement, axis: 'row' | 'column'): void {
    const gap = effectiveGap(stateOf(layout), shownScope);
    const typed = field.value.trim();
    const key = `${String(shownScope)}:${axis}`;
    if (gapAttempt.get(key) === typed) return;
    const value = Number(typed);
    if (!/^\d+$/.test(typed) || !Number.isInteger(value) || value < 0 || value > 200) {
      field.setAttribute('aria-invalid', 'true');
      gapProblem.textContent = GAP_MESSAGE;
      problem(GAP_MESSAGE);
      announce(GAP_MESSAGE);
      field.value = String(axis === 'row' ? gap.row : gap.column);
      return;
    }
    if (value === (axis === 'row' ? gap.row : gap.column) && ownGap(stateOf(layout), shownScope)) return;
    gapAttempt.set(key, typed);
    send({
      kind: 'set_gap',
      scope: shownScope,
      row: axis === 'row' ? value : gap.row,
      column: axis === 'column' ? value : gap.column,
    });
  }

  for (const [field, axis] of [
    [rowGapField, 'row'],
    [columnGapField, 'column'],
  ] as [HTMLInputElement, 'row' | 'column'][]) {
    field.addEventListener('blur', () => gapCommit(field, axis));
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        gapCommit(field, axis);
      }
    });
  }

  /* Preview width. */
  function edges(): number[] {
    return [320, ...sortedBreakpoints(stateOf(layout)).map((item) => item.min_width), 1440];
  }

  function setPreviewWidth(width: number): void {
    const next = Math.min(Math.max(Math.round(width), 320), 1440);
    if (next === previewWidth) return;
    previewWidth = next;
    if (render(false)) announce(`Showing ${scopeLabel(shownScope)} at ${previewWidth}px.`);
  }

  widthSlider.addEventListener('input', () => setPreviewWidth(Number(widthSlider.value)));
  widthSlider.addEventListener('keydown', (event) => {
    const key = event.key;
    if (key === 'ArrowRight' || key === 'ArrowUp') {
      event.preventDefault();
      setPreviewWidth(previewWidth + 10);
    } else if (key === 'ArrowLeft' || key === 'ArrowDown') {
      event.preventDefault();
      setPreviewWidth(previewWidth - 10);
    } else if (key === 'Home') {
      event.preventDefault();
      setPreviewWidth(320);
    } else if (key === 'End') {
      event.preventDefault();
      setPreviewWidth(1440);
    } else if (key === 'PageUp') {
      event.preventDefault();
      const above = edges().filter((edge) => edge > previewWidth);
      if (above.length > 0) setPreviewWidth(Math.min(...above));
    } else if (key === 'PageDown') {
      event.preventDefault();
      const below = edges().filter((edge) => edge < previewWidth);
      if (below.length > 0) setPreviewWidth(Math.max(...below));
    }
  });

  /* Buttons. */
  addBreakpointButton.addEventListener('click', openAddBreakpoint);
  removeBreakpointButton.addEventListener('click', () => {
    if (shownScope === 'base') return;
    send({ kind: 'remove_breakpoint', min_width: shownScope });
  });
  addColumnButton.addEventListener('click', () =>
    send({ kind: 'add_track', scope: shownScope, axis: 'column' as Axis, after: canvas.cursor.column }),
  );
  addRowButton.addEventListener('click', () =>
    send({ kind: 'add_track', scope: shownScope, axis: 'row' as Axis, after: canvas.cursor.row }),
  );
  saveVersionButton.addEventListener('click', openSaveVersion);
  versionsButton.addEventListener('click', () => void openVersions());
  shareButton.addEventListener('click', () => void openShare());
  applyCssButton.addEventListener('click', () => send({ kind: 'apply_css', css: cssField.value }));
  cssField.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      send({ kind: 'apply_css', css: cssField.value });
    }
  });

  document.addEventListener('keydown', (event) => {
    if (isTextField(event.target)) return;
    const shortcut = undoShortcut(event);
    if (!shortcut) return;
    event.preventDefault();
    send({ kind: shortcut });
  });

  window.addEventListener('resize', () => showPane(paneTabs.selected()));

  /* Live delivery. */
  function connect(): void {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/layouts/${layout.id}/live`);
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data as string) as
        | { type: 'presence'; designers: string[] }
        | { type: 'change'; revision: number; author: string; change: Change; state: LayoutState };
      if (message.type === 'presence') {
        designers = message.designers;
        renderRail();
        return;
      }
      if (message.revision <= layout.revision) return;
      const before = stateOf(layout);
      layout = {
        ...layout,
        revision: message.revision,
        ...message.state,
        css: generateCss(message.state),
        html: generateHtml(message.state),
      };
      render(false);
      if (message.author === boot.username) return;
      announce(`${message.author}: ${describeChange(message.change, before, message.state)}`);
      if (message.change.kind === 'restore_version') {
        showNotice(`${message.author} restored version ${message.change.number}.`);
      }
    });
    socket.addEventListener('close', () => window.setTimeout(connect, 2000));
  }

  render(false);
  connect();
}
