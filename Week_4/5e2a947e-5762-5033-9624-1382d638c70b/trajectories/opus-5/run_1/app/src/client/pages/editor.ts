import { copy, LAYOUT_LABEL, THEME_LABEL } from '../../shared/copy.js';
import type { LayoutMode, MapPayload, ThemeName } from '../../shared/types.js';
import { api, RequestFailed } from '../api.js';
import { clear, el, on } from '../dom.js';
import { navigate } from '../router.js';
import {
  announce,
  appRoot,
  inboxButton,
  notify,
  openDialog,
  resetScreen,
  trapFocus,
} from '../shell.js';
import { Actions } from '../editor/actions.js';
import {
  openCrossLinkDialog,
  openExportDialog,
  openHistoryDialog,
  openImportDialog,
  openPresenter,
  openSessionDialog,
  openShareDialog,
  openTopicMenu,
} from '../editor/dialogs.js';
import { Input } from '../editor/input.js';
import {
  ActivityPanel,
  DetailsPanel,
  FindPanel,
  OutlinePanel,
  PeopleList,
  RecoveredBand,
} from '../editor/panels.js';
import { Editor, nextId } from '../editor/state.js';
import { CanvasView } from '../editor/view.js';

type PanelName = 'details' | 'activity' | 'find' | 'outline' | null;

function viewportKind(): 'phone' | 'tablet' | 'desk' {
  const width = window.innerWidth;
  if (width < 768) return 'phone';
  if (width < 1280) return 'tablet';
  return 'desk';
}

export async function editorScreen(params: Record<string, string>, url: URL): Promise<void> {
  let payload: MapPayload;
  try {
    payload = await api.get<MapPayload>(`/api/maps/${params.id}`);
  } catch (error) {
    if (error instanceof RequestFailed && error.status === 404) {
      const root = resetScreen();
      root.append(el('main', { class: 'message-page' }, [el('h1', { text: copy.unknownMap })]));
      return;
    }
    if (error instanceof RequestFailed && error.status === 401) {
      navigate('/signin', true);
      return;
    }
    throw error;
  }
  const me = await api
    .get<{ user: { username: string } }>('/api/me')
    .then((answer) => answer.user.username)
    .catch(() => '');

  const root = resetScreen();
  document.title = payload.map.title;
  const editor = new Editor(payload);
  editor.me = me;
  const view = new CanvasView(editor);
  const actions = new Actions(editor, view);
  const outline = new OutlinePanel(editor, actions, view);
  const details = new DetailsPanel(editor);
  const find = new FindPanel(editor, view, actions);
  const activity = new ActivityPanel(editor, view);
  const recovered = new RecoveredBand(editor);
  const people = new PeopleList(editor, view);

  let panel: PanelName = null;
  const panelHost = el('div', { class: 'panel-host' });
  const outlineRail = el('div', {
    class: 'outline-rail',
    role: 'complementary',
    'aria-label': 'Outline',
  });
  outlineRail.append(outline.tree);

  const toolbar = el('div', { class: 'toolbar', role: 'toolbar', 'aria-label': 'Map tools' });
  const toolbarButtons: HTMLElement[] = [];
  const button = (label: string, run: (node: HTMLElement) => void): HTMLButtonElement => {
    const node = el('button', { type: 'button', class: 'tool', text: label });
    on(node, 'click', () => run(node));
    toolbarButtons.push(node);
    return node;
  };

  const undoButton = button('Undo', () => void editor.undo());
  const redoButton = button('Redo', () => void editor.redo());

  const layoutGroup = el('div', { class: 'picker', role: 'radiogroup', 'aria-label': 'Layout' });
  const layoutRadios = new Map<LayoutMode, HTMLElement>();
  for (const mode of ['map', 'org', 'list'] as LayoutMode[]) {
    const tile = el('button', {
      type: 'button',
      role: 'radio',
      class: 'tile',
      'aria-checked': editor.doc.layout === mode ? 'true' : 'false',
      text: LAYOUT_LABEL[mode],
    });
    on(tile, 'click', () => {
      if (editor.doc.layout === mode) return;
      view.prepareRegrow();
      editor.send([{ op_id: nextId('o'), kind: 'layout', layout: mode }]);
    });
    layoutRadios.set(mode, tile);
    layoutGroup.append(tile);
    toolbarButtons.push(tile);
  }
  const themeGroup = el('div', { class: 'picker', role: 'radiogroup', 'aria-label': 'Theme' });
  const themeRadios = new Map<ThemeName, HTMLElement>();
  for (const theme of ['daylight', 'paper', 'dusk'] as ThemeName[]) {
    const tile = el('button', {
      type: 'button',
      role: 'radio',
      class: 'tile',
      'aria-checked': editor.doc.theme === theme ? 'true' : 'false',
      text: THEME_LABEL[theme],
    });
    on(tile, 'click', () => {
      if (editor.doc.theme === theme) return;
      editor.send([{ op_id: nextId('o'), kind: 'theme', theme }]);
    });
    themeRadios.set(theme, tile);
    themeGroup.append(tile);
    toolbarButtons.push(tile);
  }

  const setPanel = (name: PanelName): void => {
    panel = name;
    paint();
  };

  const fitButton = button('Fit to screen', () =>
    view.fitToScreen(undefined, editor.presenting),
  );
  const focusButton = button('Focus branch', () => focusBranch(editor.focusId));
  const crossLinkButton = button('Add cross-link', (node) => openCrossLinkDialog(editor, node));
  const boundaryButton = button('Add boundary', () => {
    editor.send([
      {
        op_id: nextId('o'),
        kind: 'boundary_add',
        boundary_id: nextId('b'),
        topic_id: editor.focusId,
        label: '',
      },
    ]);
  });
  const findButton = button('Find', () => {
    setPanel('find');
    find.focus();
  });
  const saveVersionButton = button('Save version', (node) => {
    void openDialog({ title: 'Save version', returnFocusTo: node }, (close, body) => {
      const name = el('input', { type: 'text', 'aria-label': 'Version name' }) as HTMLInputElement;
      name.value = `Version ${new Date().toISOString().slice(0, 10)}`;
      const save = el('button', { type: 'button', class: 'primary', text: 'Save version' });
      const error = el('p', { class: 'field-error' });
      on(save, 'click', () => {
        void api
          .post<{ version: { number: number } }>(`/api/maps/${editor.mapId}/versions`, {
            name: name.value.trim(),
          })
          .then((answer) => {
            notify(copy.versionSaved(answer.version.number));
            close();
          })
          .catch((failure: unknown) => {
            if (failure instanceof RequestFailed) {
              error.textContent = failure.body.message;
              notify(failure.body.message, 'warning');
            }
          });
      });
      body.append(
        el('h2', { text: 'Save version' }),
        el('label', {}, [el('span', { text: 'Name' }), name]),
        error,
        save,
      );
    });
  });
  const historyButton = button('History', (node) => openHistoryDialog(editor, node));
  const activityButton = button('Activity', () => {
    setPanel(panel === 'activity' ? null : 'activity');
    if (panel === 'activity') void activity.load();
  });
  const shareButton = button('Share', (node) => openShareDialog(editor, node));
  const importButton = button('Import outline', (node) => openImportDialog(editor, node));
  const exportButton = button('Export', (node) => openExportDialog(editor, node));
  const presentButton = button('Start presentation', (node) => openPresenter(editor, view, node));

  const offlineSwitch = el('button', {
    type: 'button',
    role: 'switch',
    class: 'tool switch',
    'aria-checked': 'false',
    text: 'Work offline',
  });
  on(offlineSwitch, 'click', () => {
    const next = offlineSwitch.getAttribute('aria-checked') !== 'true';
    offlineSwitch.setAttribute('aria-checked', next ? 'true' : 'false');
    void editor.setOffline(next);
  });
  toolbarButtons.push(offlineSwitch);

  const readOnlyMark = el('span', { class: 'view-only' }, [
    el('span', { class: 'eye', 'aria-hidden': 'true' }),
    el('span', { text: 'View only' }),
  ]);

  const connection = el('div', { class: 'connection', role: 'region', 'aria-label': 'Connection' });
  const breadcrumb = el('nav', { class: 'breadcrumb', 'aria-label': 'Breadcrumb' });

  const focusBranch = (id: string | null): void => {
    editor.focusBranch = id;
    const next = new URL(window.location.href);
    if (id === null) next.searchParams.delete('focus');
    else next.searchParams.set('focus', id);
    window.history.pushState({}, '', next.toString());
    paint();
    view.fitToScreen();
  };
  actions.onFocusBranch = focusBranch;
  actions.onOpenFind = () => {
    setPanel('find');
    find.focus();
  };
  actions.onOpenCrossLink = () => openCrossLinkDialog(editor, crossLinkButton);
  actions.onOpenDetails = (id) => {
    details.open(id);
    setPanel('details');
  };
  actions.onTopicMenu = (id, at) => openTopicMenu(editor, actions, id, at);

  const toolsButton = el('button', { type: 'button', class: 'tool', text: 'Tools' });
  const outlineButton = el('button', { type: 'button', class: 'tool', text: 'Outline' });
  on(toolsButton, 'click', () => {
    const drawer = el('div', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Tools' });
    const holder = el('div', { class: 'drawer-body' });
    drawer.append(holder);
    document.body.append(drawer);
    holder.append(toolbar);
    const trap = trapFocus(drawer, {
      returnFocusTo: toolsButton,
      onClose: () => {
        toolbarHost.append(toolbar);
      },
    });
    void trap;
  });
  on(outlineButton, 'click', () => {
    if (viewportKind() === 'phone') {
      openDialog(
        {
          title: 'Outline',
          returnFocusTo: outlineButton,
          bottomSheet: true,
          onClose: () => outlineRail.append(outline.tree),
        },
        (close, body) => {
          body.append(el('h2', { text: 'Outline' }), outline.tree);
          const done = el('button', { type: 'button', class: 'secondary', text: 'Close' });
          on(done, 'click', close);
          body.append(done);
          outline.update();
        },
      );
      return;
    }
    outlineRail.classList.toggle('collapsed');
    const collapsed = outlineRail.classList.contains('collapsed');
    outlineRail.hidden = collapsed;
    outlineRail.inert = collapsed;
  });

  const toolbarHost = el('div', { class: 'toolbar-host' });
  const topBar = el('header', { class: 'editor-bar', role: 'banner' }, [
    el('a', { href: '/maps', class: 'logo', 'aria-label': 'Sprigmap' }, [
      el('span', { class: 'logo-mark', 'aria-hidden': 'true' }),
    ]),
    el('h1', { class: 'map-title', text: payload.map.title }),
    inboxButton(),
  ]);

  const main = el('div', { class: 'editor-main' }, [
    outlineRail,
    el('div', { class: 'canvas-column' }, [
      connection,
      recovered.node,
      breadcrumb,
      view.region,
      people.node,
    ]),
    panelHost,
  ]);
  root.append(topBar, toolbarHost, main);
  toolbarHost.append(toolbar);

  const paintToolbar = (): void => {
    clear(toolbar);
    const kind = viewportKind();
    if (editor.canEdit) toolbar.append(undoButton, redoButton);
    toolbar.append(layoutGroup, themeGroup, fitButton, focusButton);
    if (editor.canEdit) toolbar.append(crossLinkButton, boundaryButton);
    toolbar.append(findButton);
    if (editor.canEdit) toolbar.append(saveVersionButton);
    toolbar.append(historyButton, activityButton);
    if (editor.canManage) toolbar.append(shareButton);
    if (editor.canEdit) toolbar.append(importButton);
    toolbar.append(exportButton);
    if (editor.canManage) toolbar.append(presentButton);
    if (editor.canEdit) toolbar.append(offlineSwitch);
    if (!editor.canEdit) toolbar.append(readOnlyMark);
    clear(toolbarHost);
    if (kind === 'phone') {
      toolbarHost.append(toolsButton, outlineButton);
      if (!document.body.contains(toolbar)) document.body.append(toolbar);
      toolbar.hidden = true;
    } else {
      toolbar.hidden = false;
      toolbarHost.append(toolbar);
      if (kind === 'tablet') toolbarHost.append(outlineButton);
    }
    for (const node of layoutRadios) {
      node[1].setAttribute('aria-checked', editor.doc.layout === node[0] ? 'true' : 'false');
    }
    for (const node of themeRadios) {
      node[1].setAttribute('aria-checked', editor.doc.theme === node[0] ? 'true' : 'false');
    }
  };

  const paintPanels = (): void => {
    clear(panelHost);
    const kind = viewportKind();
    if (panel === 'details') {
      if (kind === 'phone') {
        openDialog({ title: 'Topic', bottomSheet: true, onClose: () => setPanel(null) }, (close, body) => {
          void close;
          body.append(details.node);
          details.update();
        });
      } else {
        const host = el('aside', { role: 'complementary', 'aria-label': 'Topic details' }, [details.node]);
        panelHost.append(host);
        details.update();
      }
    } else if (panel === 'activity') {
      if (kind === 'phone') {
        openDialog({ title: 'Activity panel', bottomSheet: true, onClose: () => setPanel(null) }, (close, body) => {
          void close;
          body.append(activity.node);
          activity.update();
        });
      } else {
        panelHost.append(activity.node);
        activity.update();
      }
    } else if (panel === 'find') {
      panelHost.append(find.node);
    }
  };

  const paintBreadcrumb = (): void => {
    clear(breadcrumb);
    if (editor.focusBranch === null) return;
    const chain = [...editor.ancestorsOf(editor.focusBranch)].reverse();
    for (const id of [...chain, editor.focusBranch]) {
      const link = el('a', { href: `?focus=${id}`, text: editor.doc.topics[id]?.title ?? '' });
      on(link, 'click', (event) => {
        event.preventDefault();
        focusBranch(id);
      });
      breadcrumb.append(link);
    }
  };

  const paintConnection = (): void => {
    clear(connection);
    if (editor.offline) {
      connection.append(
        el('p', { class: 'banner', text: copy.offlineBanner(editor.queue.length) }),
      );
    } else if (editor.connectionLost) {
      connection.append(
        el('p', { class: 'banner', text: copy.connectionLost(editor.queue.length) }),
      );
    }
  };

  const paint = (): void => {
    paintToolbar();
    view.update();
    outline.update();
    recovered.update();
    people.update();
    paintBreadcrumb();
    paintConnection();
    paintPanels();
    if (editor.sessionExpired) openSessionDialog(editor);
    root.dataset.viewport = viewportKind();
  };

  let lastRole = editor.role;
  editor.onChange(() => {
    if (editor.focusBranch !== null && !editor.doc.topics[editor.focusBranch]) {
      editor.focusBranch = null;
      const next = new URL(window.location.href);
      next.searchParams.delete('focus');
      window.history.replaceState({}, '', next.toString());
      notify(copy.focusBranchDeleted, 'warning');
    }
    view.update();
    outline.update();
    recovered.update();
    people.update();
    paintConnection();
    paintBreadcrumb();
    if (editor.sessionExpired) openSessionDialog(editor);
    if (lastRole !== editor.role) {
      lastRole = editor.role;
      if (panel === 'details' && !editor.canComment) panel = null;
      paintToolbar();
      paintPanels();
      view.focusTopic(editor.focusId);
    }
  });
  editor.onAccessRemoved = () => {
    const page = appRoot();
    clear(page);
    page.append(
      el('main', { class: 'message-page' }, [
        el('h1', { text: copy.accessRemoved }),
        el('a', { href: '/maps', text: 'Your maps' }),
      ]),
    );
  };
  editor.onLinkEnded = (reason) => {
    const page = appRoot();
    clear(page);
    page.append(
      el('main', { class: 'message-page' }, [
        el('h1', { text: reason === 'expired' ? copy.expiredLink : copy.turnedOffLink }),
      ]),
    );
  };
  editor.onVersion = (message) => {
    const version = message.version as { number: number } | undefined;
    if (version) announce(`Saved version ${version.number}.`);
  };

  new Input(editor, view, actions, {
    toolbar: () => toolbar,
    panels: () =>
      [
        outlineRail.hidden ? null : outlineRail,
        panel === null ? null : (panelHost.firstElementChild as HTMLElement | null),
        document.querySelector<HTMLElement>('.presenter'),
      ].filter((node): node is HTMLElement => node !== null),
  });

  on(window, 'resize', () => paint());
  on(view.tree, 'focusin', (event) => {
    const node = event.target;
    if (!(node instanceof HTMLElement)) return;
    const id = node.dataset.topicId;
    if (id) editor.focusId = id;
  });
  actions.onTopicSelected = (id) => {
    details.topicId = id;
    if (panel === 'details') {
      details.update();
      return;
    }
    // Beside the canvas there is room for the details, so a selection opens them.
    if (panel === null && viewportKind() !== 'phone') {
      details.open(id);
      setPanel('details');
    }
  };

  const focusParam = url.searchParams.get('focus');
  const topicParam = url.searchParams.get('topic');
  if (focusParam !== null && editor.doc.topics[focusParam]) editor.focusBranch = focusParam;
  paint();
  view.openCentred();
  if (topicParam !== null) {
    if (editor.doc.topics[topicParam]) {
      editor.focusId = topicParam;
      editor.selection.clear();
    } else {
      notify(copy.missingTopic, 'warning');
    }
  }
  view.update();
  view.focusTopic(editor.focusId);
  if (url.searchParams.get('comment') !== null && editor.doc.topics[editor.focusId]) {
    details.open(editor.focusId, 'Comments');
    setPanel('details');
  }
  void editor.loadMembers();
  editor.connect();
  if (editor.queue.length > 0) {
    editor.offline = true;
    offlineSwitch.setAttribute('aria-checked', 'true');
    paintConnection();
  }
  void activity.load();
}
