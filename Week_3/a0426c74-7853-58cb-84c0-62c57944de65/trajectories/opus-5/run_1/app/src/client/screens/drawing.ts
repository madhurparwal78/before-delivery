import { fmtDisplay } from '../../shared/numbers.js';
import { READY_PROMPT, TEXT_STAGES } from '../../shared/commands.js';
import { aidToggle, stoppedFollowing } from '../../shared/announce.js';
import { entityBox, vec, type Vec } from '../../shared/geometry.js';
import { findEntity, findLayer } from '../../shared/model.js';
import type { Operation } from '../../shared/operations.js';
import { resolvePointerPoint } from '../../shared/snap.js';
import type { VersionSnapshot } from '../../shared/snapshot.js';
import { sheetSvg } from '../../shared/svgtext.js';
import { pinchView, type GestureStart, LONG_PRESS_MS, TAP_MOVE_PX, TAP_MS, wheelZoom } from '../../shared/gestures.js';
import { api, RequestFailed } from '../api.js';
import { button, clear, el, layoutKind, on, panel, reducedMotion } from '../dom.js';
import { announce, announcerRegion, toast, toastStack } from '../toasts.js';
import { store, type DrawingPayload, type ExportJobPayload } from '../store.js';
import { buildCanvas, canvas, gripsFor } from '../drawing/canvas.js';
import { createEngine, pickAt, type CommandEngine } from '../drawing/commands.js';
import {
  entitiesGrid,
  issuesPanel,
  layersPanel,
  markupsPanel,
  parametersPanel,
  propertiesPanel,
  setPanelHooks,
  xrefsPanel,
} from '../drawing/panels.js';
import { compareView, versionsPanel } from '../drawing/versions.js';

const PANEL_NAMES = ['Entities', 'Layers', 'Properties', 'Parameters', 'Xrefs', 'Versions', 'Issues', 'Markups'] as const;
const PHONE_PANELS = ['Issues', 'Markups', 'Versions'] as const;

function opId(): string {
  return `op-${Math.random().toString(36).slice(2, 10)}`;
}

export interface DrawingScreenOptions {
  versionId?: string;
  readOnly?: boolean;
  linkOnly?: boolean;
}

export async function drawingScreen(root: HTMLElement, drawingId: string, options: DrawingScreenOptions = {}): Promise<void> {
  const payload = await api.get<DrawingPayload>(`/api/drawings/${drawingId}`);
  const me = await api.get<{ username: string }>('/api/me');
  store.load(payload, me.username);
  store.layout = layoutKind();
  store.versionView = options.readOnly === true;
  await store.refreshIssues();

  const handles = buildCanvas();
  const commandInput = el('input', { type: 'text', 'aria-label': 'Command', class: 'command-input', autocomplete: 'off' });
  const promptNode = el('output', { role: 'status', 'aria-label': 'Command prompt', 'aria-live': 'polite', class: 'command-prompt' }, [
    READY_PROMPT,
  ]);
  const aidsGroup = el('div', { role: 'group', 'aria-label': 'Drafting aids', class: 'aids' });
  const storageNotice = el('div', { role: 'status', 'aria-label': 'Storage notice', 'aria-live': 'polite', class: 'surface storage-notice' });
  const xrefNotice = el('div', { role: 'status', 'aria-label': 'Xref notice', 'aria-live': 'polite', class: 'xref-notice' });
  const connection = el('div', { role: 'status', 'aria-label': 'Connection', 'aria-live': 'polite', class: 'chip connection' });
  const peopleList = el('ul', { role: 'list', 'aria-label': 'People here', class: 'people' });
  const zoomChip = el('div', { class: 'chip zoom-chip' });
  const offlineSwitch = el('button', { type: 'button', role: 'switch', 'aria-checked': 'false', 'aria-label': 'Work offline' }, [
    'Work offline',
  ]);
  const layoutTabs = el('div', { role: 'tablist', 'aria-label': 'Layouts', class: 'layout-tabs' });
  const sheetStage = el('div', { class: 'sheet-stage', hidden: true });
  const compareHost = el('div', { class: 'compare-host' });

  const focusCommand = (): void => {
    commandInput.focus();
  };

  const setPrompt = (text: string): void => {
    promptNode.textContent = text;
  };

  let engine: CommandEngine;

  const submitOps = async (command: string, ops: Operation[]): Promise<void> => {
    try {
      await store.submit(command, ops);
    } catch (error) {
      if (error instanceof RequestFailed) {
        toast(error.body.message);
        setPrompt(error.body.message);
        focusCommand();
      }
    }
    handles.render();
  };

  const refreshAll = (): void => {
    void store.refreshIssues();
    void refreshMarkups();
    store.emit({ kind: 'versions' });
  };

  const refreshMarkups = async (): Promise<void> => {
    const sheet = store.sheets[0];
    if (!sheet) return;
    const version = [...sheet.versions].sort((a, b) => b.number - a.number)[0];
    if (!version) return;
    const response = await api.get<{ markups: typeof store.markups }>(`/api/versions/${version.id}/markups`);
    store.markups = response.markups;
    store.emit({ kind: 'markups' });
  };

  setPanelHooks({ submit: submitOps, refresh: refreshAll, openCompare: () => openCompare() });

  const openCompare = (): void => {
    const sheet = store.sheets[0];
    clear(compareHost);
    if (!sheet) {
      toast('Publish a version first.');
      return;
    }
    compareHost.append(compareView({ sheetId: sheet.id, versions: sheet.versions }));
  };

  const panels = new Map<string, { wrapper: HTMLElement; header: HTMLButtonElement; body: HTMLElement }>();
  const buildPanel = (name: string, body: HTMLElement, role: 'region' | 'grid'): void => {
    const wrapper = panel(name, body, role);
    const header = wrapper.querySelector('button');
    if (!(header instanceof HTMLButtonElement)) return;
    panels.set(name, { wrapper, header, body });
  };

  const entitiesBody = entitiesGrid();
  const layersBody = layersPanel();
  const propertiesBody = propertiesPanel();
  const parametersBody = parametersPanel();
  const xrefsBody = xrefsPanel();
  const versionsBody = versionsPanel(
    {
      refresh: refreshAll,
      restore: (versionId) => void submitOps('RESTORE', [{ op_id: opId(), type: 'version_restore', version: versionId }]),
      openCompare: () => openCompare(),
    },
    options.versionId,
  );
  const issuesBody = issuesPanel();
  const markupsBody = markupsPanel();

  buildPanel('Entities', entitiesBody, 'grid');
  buildPanel('Layers', layersBody, 'region');
  buildPanel('Properties', propertiesBody, 'region');
  buildPanel('Parameters', parametersBody, 'region');
  buildPanel('Xrefs', xrefsBody, 'region');
  buildPanel('Versions', versionsBody, 'region');
  buildPanel('Issues', issuesBody, 'region');
  buildPanel('Markups', markupsBody, 'region');

  // Layout containers
  const leftPane = el('div', { class: 'pane pane-left' });
  const centrePane = el('div', { class: 'pane pane-centre' });
  const rightPane = el('div', { class: 'pane pane-right' });
  const panelStrip = el('div', { class: 'panel-strip' });
  const panelTabs = el('div', { role: 'tablist', 'aria-label': 'Panels', class: 'panel-tabs' });
  const panelsButton = button('Panels', { class: 'chip panels-button' });
  const commandBar = el('div', { class: 'command-bar' }, [commandInput, promptNode, aidsGroup]);

  const corners = el('div', { class: 'corners' });
  const cornerTopLeft = el('div', { class: 'corner top-left' });
  const cornerTopRight = el('div', { class: 'corner top-right' });
  const cornerBottomLeft = el('div', { class: 'corner bottom-left' });
  const cornerBottomRight = el('div', { class: 'corner bottom-right' });
  corners.append(cornerTopLeft, cornerTopRight, cornerBottomLeft, cornerBottomRight);

  const publishButton = button('Publish sheet');
  const compareButton = button('Compare');
  const exportButton = button('Export');
  const importButton = button('Import');
  const underlayButton = button('Add underlay');
  const newSheetButton = button('New sheet');

  cornerTopLeft.append(el('span', { class: 'drawing-name' }, [store.name]), layoutTabs, newSheetButton);
  cornerTopRight.append(peopleList, publishButton, compareButton, exportButton, importButton, underlayButton);
  cornerBottomLeft.append(offlineSwitch, connection);
  cornerBottomRight.append(zoomChip);
  if (store.layout === 'phone') cornerTopRight.append(panelsButton);

  const findSearch = el('search', { 'aria-label': 'Find', class: 'find' });
  const findInput = el('input', { type: 'search', 'aria-label': 'Find text', class: 'find-input' });
  const findCount = el('output', { role: 'status', 'aria-label': 'Find count', 'aria-live': 'polite' });
  const findNext = button('Next match');
  findSearch.append(findInput, findCount, findNext);
  findSearch.hidden = true;

  handles.root.append(corners, xrefNotice, findSearch, sheetStage);
  centrePane.append(handles.root, storageNotice, commandBar, compareHost);

  const screen = el('main', { class: 'drawing-screen', 'data-layout': store.layout });
  root.append(screen);
  screen.append(toastStack(), announcerRegion());

  const placePanels = (): void => {
    store.layout = layoutKind();
    screen.setAttribute('data-layout', store.layout);
    clear(leftPane);
    clear(rightPane);
    clear(panelStrip);
    clear(panelTabs);
    clear(screen);
    screen.append(toastStack(), announcerRegion());
    if (store.layout === 'desk') {
      for (const name of ['Entities', 'Layers']) {
        const entry = panels.get(name);
        if (entry) leftPane.append(entry.wrapper);
      }
      for (const name of ['Properties', 'Parameters', 'Xrefs', 'Versions', 'Issues', 'Markups']) {
        const entry = panels.get(name);
        if (entry) rightPane.append(entry.wrapper);
      }
      screen.append(leftPane, centrePane, rightPane);
      for (const entry of panels.values()) openPanel(entry, true);
      return;
    }
    if (store.layout === 'tablet') {
      PANEL_NAMES.forEach((name, index) => {
        const tab = el('button', {
          type: 'button',
          role: 'tab',
          'aria-selected': index === 0 ? 'true' : 'false',
          'data-panel-tab': name,
        }, [name]);
        on(tab, 'click', () => {
          for (const node of panelTabs.querySelectorAll('[role="tab"]')) node.setAttribute('aria-selected', 'false');
          tab.setAttribute('aria-selected', 'true');
          for (const [other, entry] of panels) openPanel(entry, other === name);
        });
        panelTabs.append(tab);
      });
      for (const name of PANEL_NAMES) {
        const entry = panels.get(name);
        if (entry) panelStrip.append(entry.wrapper);
      }
      screen.append(centrePane, panelTabs, panelStrip);
      for (const [name, entry] of panels) openPanel(entry, name === 'Entities');
      return;
    }
    screen.append(centrePane, phoneSheet);
    for (const entry of panels.values()) openPanel(entry, false);
  };

  const openPanel = (entry: { wrapper: HTMLElement; header: HTMLButtonElement; body: HTMLElement }, open: boolean): void => {
    entry.header.setAttribute('aria-expanded', open ? 'true' : 'false');
    const body = entry.wrapper.querySelector('.panel-body');
    if (body instanceof HTMLElement) body.hidden = !open;
  };

  // Phone bottom sheet
  const phoneSheet = el('dialog', { 'aria-label': 'Panel', class: 'bottom-sheet surface' });
  const phoneTabs = el('div', { role: 'tablist', 'aria-label': 'Panel tabs' });
  const phoneBody = el('div', { class: 'bottom-sheet-body' });
  phoneSheet.append(phoneTabs, phoneBody);
  const showPhonePanel = (name: string): void => {
    clear(phoneBody);
    for (const node of phoneTabs.querySelectorAll('[role="tab"]')) {
      node.setAttribute('aria-selected', node.getAttribute('data-panel-tab') === name ? 'true' : 'false');
    }
    const entry = panels.get(name);
    if (entry) {
      phoneBody.append(entry.wrapper);
      openPanel(entry, true);
    }
  };
  for (const name of PHONE_PANELS) {
    const tab = el('button', { type: 'button', role: 'tab', 'aria-selected': 'false', 'data-panel-tab': name }, [name]);
    on(tab, 'click', () => showPhonePanel(name));
    phoneTabs.append(tab);
  }
  on(panelsButton, 'click', () => {
    phoneSheet.showModal();
    showPhonePanel('Issues');
  });

  placePanels();
  on(window, 'resize', () => {
    placePanels();
    handles.render();
  });

  // Drafting aids
  const aidButtons = new Map<'Snap' | 'Ortho' | 'Grid' | 'Polar', HTMLButtonElement>();
  const setAid = (name: 'Snap' | 'Ortho' | 'Grid' | 'Polar', on1: boolean): void => {
    const key = name.toLowerCase() as 'snap' | 'ortho' | 'grid' | 'polar';
    store.aids[key] = on1;
    if (on1 && key === 'ortho') store.aids.polar = false;
    if (on1 && key === 'polar') store.aids.ortho = false;
    for (const [other, node] of aidButtons) {
      const otherKey = other.toLowerCase() as 'snap' | 'ortho' | 'grid' | 'polar';
      node.setAttribute('aria-pressed', store.aids[otherKey] ? 'true' : 'false');
    }
    announce(aidToggle(name, on1));
  };
  for (const name of ['Snap', 'Ortho', 'Grid', 'Polar'] as const) {
    const node = button(name, { 'aria-pressed': store.aids[name.toLowerCase() as 'snap'] ? 'true' : 'false' });
    on(node, 'click', () => setAid(name, node.getAttribute('aria-pressed') !== 'true'));
    aidButtons.set(name, node);
    aidsGroup.append(node);
  }

  // Sheets and layouts
  let activeLayout = 'Model';
  const sheetSnapshot = (sheetId: string): VersionSnapshot | null => {
    const sheet = store.sheets.find((candidate) => candidate.id === sheetId);
    if (!sheet) return null;
    return {
      sheet: {
        id: sheet.id,
        name: sheet.name,
        size: sheet.size,
        number: sheet.number,
        attributes: sheet.attributes,
        viewports: sheet.viewports,
        creator: sheet.creator,
      },
      model: {
        layers: store.model.layers,
        entities: store.model.entities,
        blocks: store.model.blocks,
        xrefs: store.xrefs,
      },
    };
  };

  const showLayout = (name: string): void => {
    activeLayout = name;
    for (const tab of layoutTabs.querySelectorAll('[role="tab"]')) {
      tab.setAttribute('aria-selected', tab.getAttribute('data-layout-tab') === name ? 'true' : 'false');
    }
    clear(sheetStage);
    if (name === 'Model') {
      sheetStage.hidden = true;
      handles.svgRoot.style.visibility = 'visible';
      return;
    }
    const sheet = store.sheets.find((candidate) => candidate.name === name);
    if (!sheet) return;
    const snapshot = sheetSnapshot(sheet.id);
    if (!snapshot) return;
    sheetStage.hidden = false;
    sheetStage.innerHTML = sheetSvg(snapshot);
    handles.svgRoot.style.visibility = 'hidden';
  };

  const drawLayoutTabs = (): void => {
    clear(layoutTabs);
    const names = ['Model', ...store.sheets.map((sheet) => sheet.name)];
    for (const name of names) {
      const tab = el('button', {
        type: 'button',
        role: 'tab',
        'data-layout-tab': name,
        'aria-selected': name === activeLayout ? 'true' : 'false',
      }, [name]);
      on(tab, 'click', () => showLayout(name));
      layoutTabs.append(tab);
    }
  };
  drawLayoutTabs();

  on(newSheetButton, 'click', () => {
    void api
      .post<{ id: string; name: string }>(`/api/drawings/${store.id}/sheets`, {
        name: `Sheet ${store.sheets.length + 1}`,
        size: 'A3',
      })
      .then(async () => {
        await store.refreshDrawing();
        drawLayoutTabs();
      })
      .catch((error: unknown) => {
        if (error instanceof RequestFailed) toast(error.body.message);
      });
  });

  on(publishButton, 'click', () => {
    const sheet = store.sheets.find((candidate) => candidate.name === activeLayout) ?? store.sheets[0];
    if (!sheet) {
      toast('Add a sheet first.');
      return;
    }
    storageNotice.textContent = 'Publishing\u2026';
    announce('Publishing\u2026');
    void api
      .post<{ number: number }>(`/api/sheets/${sheet.id}/versions`, {})
      .then(async (version) => {
        storageNotice.textContent = `Published version ${version.number}.`;
        announce(`Published version ${version.number}.`);
        await store.refreshDrawing();
        drawLayoutTabs();
        store.emit({ kind: 'versions' });
      })
      .catch((error: unknown) => {
        if (error instanceof RequestFailed) {
          storageNotice.textContent = error.body.message;
          announce(error.body.message);
        }
      });
  });

  on(compareButton, 'click', () => openCompare());

  // Export dialog
  const exportDialog = el('dialog', { 'aria-label': 'Export', class: 'surface' });
  const exportProgress = el('progress', { role: 'progressbar', 'aria-label': 'Export', max: '100', value: '0' });
  const exportRetry = button('Retry export');
  const exportLink = el('a', { href: '#', class: 'download-link' }, ['Download export']);
  const formatText = el('input', { type: 'radio', name: 'export-format', 'aria-label': 'Plotfold text', value: 'plot.txt', checked: true });
  const formatSvg = el('input', { type: 'radio', name: 'export-format', 'aria-label': 'SVG', value: 'svg' });
  const startExport = button('Start export', { class: 'primary' });
  exportDialog.append(
    el('h2', {}, ['Export']),
    formatText,
    formatSvg,
    startExport,
    exportProgress,
    exportRetry,
    exportLink,
  );
  exportLink.hidden = true;
  exportRetry.hidden = true;
  document.body.append(exportDialog);

  let exportId: string | null = null;
  const showExport = (job: ExportJobPayload): void => {
    exportId = job.id;
    exportProgress.setAttribute('value', String(job.progress));
    exportProgress.setAttribute('aria-valuenow', String(job.progress));
    if (job.state === 'ready' && job.download_url) {
      exportLink.hidden = false;
      exportLink.setAttribute('href', job.download_url);
      storageNotice.textContent = 'Export ready.';
      announce('Export ready.');
      exportRetry.hidden = true;
      return;
    }
    if (job.state === 'failed') {
      exportRetry.hidden = false;
      storageNotice.textContent = 'Export failed: file storage is unavailable.';
      announce('Export failed: file storage is unavailable.');
    }
  };

  on(exportButton, 'click', () => {
    exportDialog.showModal();
    startExport.focus();
  });
  on(startExport, 'click', () => {
    const format = formatSvg.checked ? 'svg' : 'plot.txt';
    exportLink.hidden = true;
    exportRetry.hidden = true;
    void api
      .post<ExportJobPayload>(`/api/drawings/${store.id}/exports`, { format })
      .then((job) => {
        storageNotice.textContent = 'Export started.';
        announce('Export started.');
        showExport(job);
      })
      .catch((error: unknown) => {
        if (error instanceof RequestFailed) toast(error.body.message);
      });
  });
  on(exportRetry, 'click', () => {
    if (!exportId) return;
    void api
      .post<ExportJobPayload>(`/api/exports/${exportId}/retry`, {})
      .then((job) => showExport(job))
      .catch((error: unknown) => {
        if (error instanceof RequestFailed) toast(error.body.message);
      });
  });

  // Import dialog
  const importDialog = el('dialog', { 'aria-label': 'Import preview', class: 'surface' });
  const importErrors = el('ul', { role: 'list', 'aria-label': 'Import errors' });
  const importSummary = el('p', { class: 'import-summary' });
  const importMerge = button('Merge', { class: 'primary' });
  const importCancel = button('Cancel');
  const importFile = el('input', { type: 'file', 'aria-label': 'Drawing file' });
  importDialog.append(el('h2', {}, ['Import preview']), importFile, importSummary, importErrors, importMerge, importCancel);
  document.body.append(importDialog);
  let pendingImport: { import_id: string; adds: { entities: number } } | null = null;

  on(importButton, 'click', () => {
    clear(importErrors);
    importSummary.textContent = '';
    pendingImport = null;
    importDialog.showModal();
    importFile.focus();
  });
  on(importCancel, 'click', () => {
    importDialog.close();
    focusCommand();
  });
  on(importFile, 'change', () => {
    const file = importFile.files?.[0];
    if (!file) return;
    storageNotice.textContent = 'Reading file\u2026';
    announce('Reading file\u2026');
    void file.arrayBuffer().then((buffer) => {
      api
        .upload<{ import_id: string; adds: { entities: number; layers: number; blocks: number }; renames: { from: string; to: string }[] }>(
          `/api/drawings/${store.id}/imports`,
          buffer,
        )
        .then((preview) => {
          clear(importErrors);
          pendingImport = preview;
          importSummary.textContent = `Adds ${preview.adds.entities} entities, ${preview.adds.layers} layers, ${preview.adds.blocks} blocks.`;
          for (const rename of preview.renames) {
            importErrors.append(el('li', {}, [`${rename.from} renamed ${rename.to}`]));
          }
        })
        .catch((error: unknown) => {
          if (!(error instanceof RequestFailed)) return;
          clear(importErrors);
          for (const line of error.body.lines ?? []) importErrors.append(el('li', {}, [line]));
          if ((error.body.lines ?? []).length === 0) {
            storageNotice.textContent = error.body.message;
            announce(error.body.message);
          }
        });
    });
  });
  on(importMerge, 'click', () => {
    if (!pendingImport) return;
    const count = pendingImport.adds.entities;
    void submitOps('IMPORT', [{ op_id: opId(), type: 'import_merge', import_id: pendingImport.import_id }]).then(() => {
      storageNotice.textContent = `Imported ${count} entities.`;
      announce(`Imported ${count} entities.`);
      importDialog.close();
      focusCommand();
    });
  });

  // Underlay dialog
  const underlayDialog = el('dialog', { 'aria-label': 'Add underlay', class: 'surface' });
  const underlayFile = el('input', { type: 'file', 'aria-label': 'Image file' });
  const firstCorner = el('input', { type: 'text', 'aria-label': 'First corner', value: '0,0' });
  const oppositeCorner = el('input', { type: 'text', 'aria-label': 'Opposite corner', value: '10,10' });
  const attachButton = button('Attach', { class: 'primary' });
  underlayDialog.append(el('h2', {}, ['Add underlay']), underlayFile, firstCorner, oppositeCorner, attachButton);
  document.body.append(underlayDialog);
  on(underlayButton, 'click', () => {
    underlayDialog.showModal();
    underlayFile.focus();
  });
  on(attachButton, 'click', () => {
    const file = underlayFile.files?.[0];
    if (!file) return;
    const [x1, y1] = firstCorner.value.split(',').map(Number);
    const [x2, y2] = oppositeCorner.value.split(',').map(Number);
    storageNotice.textContent = 'Uploading\u2026';
    announce('Uploading\u2026');
    void file.arrayBuffer().then((buffer) => {
      api
        .upload(`/api/drawings/${store.id}/underlays?x1=${x1}&y1=${y1}&x2=${x2}&y2=${y2}`, buffer)
        .then(async () => {
          storageNotice.textContent = 'Underlay attached.';
          announce('Underlay attached.');
          await store.refreshDrawing();
          handles.render();
          underlayDialog.close();
          focusCommand();
        })
        .catch((error: unknown) => {
          if (error instanceof RequestFailed) {
            storageNotice.textContent = error.body.message;
            announce(error.body.message);
          }
        });
    });
  });

  // New issue dialog
  const issueDialog = el('dialog', { 'aria-label': 'New issue', class: 'surface' });
  const issueTitle = el('input', { type: 'text', 'aria-label': 'Issue title' });
  const pinIssue = button('Pin issue', { class: 'primary' });
  issueDialog.append(el('h2', {}, ['New issue']), issueTitle, pinIssue);
  document.body.append(issueDialog);
  let issuePoint: Vec = vec(0, 0);
  const openIssueDialog = (point: Vec): void => {
    issuePoint = point;
    issueDialog.showModal();
    issueTitle.focus();
  };
  on(pinIssue, 'click', () => {
    const sheet = store.sheets[0];
    const version = sheet ? [...sheet.versions].sort((a, b) => b.number - a.number)[0] : null;
    if (!version) {
      toast('Publish a version first.');
      return;
    }
    void api
      .post(`/api/versions/${version.id}/issues`, { title: issueTitle.value, x: issuePoint.x, y: issuePoint.y })
      .then(async () => {
        issueDialog.close();
        await store.refreshIssues();
        handles.render();
        const pin = handles.root.querySelector('[data-issue-pin]');
        if (pin && !reducedMotion()) {
          pin.animate([{ transform: 'scale(0.8)' }, { transform: 'scale(1)' }], {
            duration: 200,
            easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)',
            id: 'sheet-pin',
          });
        }
      })
      .catch((error: unknown) => {
        if (error instanceof RequestFailed) toast(error.body.message);
      });
  });

  // Find
  const findMatches = (): string[] => {
    const wanted = findInput.value.trim().toLowerCase();
    if (!wanted) return [];
    const matches: string[] = [];
    for (const entity of store.model.entities) {
      const layer = findLayer(store.model, entity.layer);
      if (layer && (!layer.on || layer.frozen)) continue;
      const block = entity.type === 'insert' ? entity.block.toLowerCase() : '';
      if (entity.handle.toLowerCase() === wanted || entity.layer.toLowerCase() === wanted || block === wanted) {
        matches.push(entity.handle);
      }
    }
    return matches.sort((a, b) => Number(a.replace(/^[A-Z]+/, '')) - Number(b.replace(/^[A-Z]+/, '')));
  };
  let findIndex = -1;
  const showFindCount = (): void => {
    const matches = findMatches();
    if (matches.length === 0) {
      findCount.textContent = 'No matches.';
      return;
    }
    findCount.textContent = `${Math.max(1, findIndex + 1)} of ${matches.length}`;
  };
  const openFind = (): void => {
    findSearch.hidden = false;
    findIndex = -1;
    findInput.focus();
    showFindCount();
  };
  on(findInput, 'input', () => {
    findIndex = -1;
    showFindCount();
  });
  const nextMatch = (): void => {
    const matches = findMatches();
    if (matches.length === 0) {
      showFindCount();
      return;
    }
    findIndex = (findIndex + 1) % matches.length;
    const handle = matches[findIndex];
    store.selection.clear();
    store.selection.add(handle);
    const entity = findEntity(store.model, handle);
    if (entity) canvas().panTo(entityBox(store.model, entity), 48);
    showFindCount();
    handles.render();
  };
  on(findNext, 'click', nextMatch);
  on(findInput, 'keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      nextMatch();
    }
  });

  // Command engine
  engine = createEngine({
    setPrompt,
    announce,
    toast,
    focusCommand,
    openLayers: () => {
      const entry = panels.get('Layers');
      if (!entry) return;
      openPanel(entry, true);
      entry.body.querySelector<HTMLElement>('[aria-label="Layer list"]')?.focus();
      const grid = entry.body.querySelector<HTMLElement>('[role="grid"][aria-label="Layer list"]');
      grid?.setAttribute('tabindex', '0');
      grid?.focus();
    },
    openParameters: () => {
      const entry = panels.get('Parameters');
      if (!entry) return;
      openPanel(entry, true);
      const grid = entry.body.querySelector<HTMLElement>('[role="grid"][aria-label="Parameter list"]');
      grid?.setAttribute('tabindex', '0');
      grid?.focus();
    },
    openFind,
    zoomAll: () => handles.zoomAll(),
    render: () => handles.render(),
    attachXref: async (drawingName, xrefName, point, scale, rotation) => {
      try {
        const folder = await api.get<{ drawings: { id: string; name: string }[] }>(
          `/api/folders/${store.folderId}/drawings`,
        );
        const source = folder.drawings.find((candidate) => candidate.name === drawingName);
        if (!source) {
          setPrompt(`No drawing named ${drawingName} in this folder.`);
          return;
        }
        await submitOps('XATTACH', [
          {
            op_id: opId(),
            type: 'xref_attach',
            name: xrefName,
            source: source.id,
            x: point.x,
            y: point.y,
            scale,
            rotation,
          },
        ]);
        await store.refreshDrawing();
        handles.render();
      } catch (error) {
        if (error instanceof RequestFailed) setPrompt(error.body.message);
      }
    },
  });

  // Command input events
  on(commandInput, 'keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const text = commandInput.value;
      commandInput.value = '';
      if (text.trim() === '' && !engine.running() && store.selection.size === 0) {
        engine.submitText('', false);
        return;
      }
      engine.submitText(text, false);
      return;
    }
    if (event.key === ' ') {
      const slot = engine.slot();
      const text = commandInput.value;
      if (slot && text.trim() !== '' && TEXT_STAGES.includes(slot.prompt)) return;
      event.preventDefault();
      commandInput.value = '';
      engine.submitText(text, true);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      commandInput.value = '';
      engine.escape();
      return;
    }
    if ((event.key === 'u' || event.key === 'U') && commandInput.value === '') {
      if (!engine.running()) {
        event.preventDefault();
        void runUndo();
        return;
      }
      event.preventDefault();
      engine.stepBack();
      commandInput.value = '';
    }
  });

  const runUndo = async (): Promise<void> => {
    try {
      const outcome = await store.undo();
      if (!outcome) {
        announce('Nothing to undo.');
        return;
      }
      await store.refreshDrawing();
      handles.render();
      announce(`Undo: ${outcome.command}`);
    } catch (error) {
      if (error instanceof RequestFailed) {
        if (error.body.error === 'nothing_to_undo') announce('Nothing to undo.');
        else {
          toast(error.body.message);
          announce(error.body.message);
        }
      }
    }
  };

  const runRedo = async (): Promise<void> => {
    try {
      const outcome = await store.redo();
      if (!outcome) return;
      await store.refreshDrawing();
      handles.render();
      announce(`Redo: ${outcome.command}`);
    } catch (error) {
      if (error instanceof RequestFailed) {
        if (error.body.error === 'nothing_to_redo') announce('Nothing to redo.');
        else toast(error.body.message);
      }
    }
  };

  // Pointer handling
  let dragStart: { point: Vec; screenX: number; screenY: number } | null = null;
  let dragGrip: { handle: string; kind: string; index: number } | null = null;
  let panning = false;
  let spaceHeld = false;

  const resolvePointer = (world: Vec): Vec => {
    const entities = [
      ...store.model.entities.filter((entity) => {
        const layer = findLayer(store.model, entity.layer);
        return !layer || (layer.on && !layer.frozen);
      }),
      ...store.xrefEntities().map((item) => item.entity),
    ];
    const outcome = resolvePointerPoint(entities, world, store.lastPoint, store.aids, store.view.zoom);
    store.snap = { kind: outcome.kind, x: outcome.point.x, y: outcome.point.y };
    return outcome.point;
  };

  on(handles.root, 'pointermove', (event: PointerEvent) => {
    if (event.pointerType === 'touch') return;
    const world = handles.worldAt(event);
    const point = resolvePointer(world);
    store.sendPointer(point);
    if (dragGrip) {
      handles.setPreview([point]);
    } else if (dragStart && !panning) {
      const kind = event.clientX >= dragStart.screenX ? 'window' : 'crossing';
      handles.setWindow(
        {
          minX: Math.min(dragStart.point.x, world.x),
          maxX: Math.max(dragStart.point.x, world.x),
          minY: Math.min(dragStart.point.y, world.y),
          maxY: Math.max(dragStart.point.y, world.y),
        },
        kind,
      );
    } else if (panning && dragStart) {
      store.view.panX += event.clientX - dragStart.screenX;
      store.view.panY += event.clientY - dragStart.screenY;
      dragStart = { point: world, screenX: event.clientX, screenY: event.clientY };
      store.following = null;
    }
    handles.render();
  });

  on(handles.root, 'pointerdown', (event: PointerEvent) => {
    if (event.pointerType === 'touch') return;
    const world = handles.worldAt(event);
    const gripNode = (event.target as Element).closest('[data-grip]');
    if (gripNode) {
      dragGrip = {
        handle: gripNode.getAttribute('data-entity-id') ?? '',
        kind: gripNode.getAttribute('data-grip') ?? '',
        index: Number(gripNode.getAttribute('data-grip-index') ?? '0'),
      };
      dragStart = { point: world, screenX: event.clientX, screenY: event.clientY };
      return;
    }
    if (event.button === 1 || spaceHeld) {
      panning = true;
      dragStart = { point: world, screenX: event.clientX, screenY: event.clientY };
      return;
    }
    dragStart = { point: world, screenX: event.clientX, screenY: event.clientY };
  });

  const applyGripDrag = (point: Vec): void => {
    if (!dragGrip) return;
    const entity = findEntity(store.model, dragGrip.handle);
    if (!entity) return;
    const clone = structuredClone(entity);
    const grip = gripsFor(entity)[dragGrip.index];
    if (!grip) return;
    const ops: Operation[] = [];
    if (clone.type === 'line') {
      if (grip.kind === 'end' && dragGrip.index === 0) {
        ops.push({ op_id: opId(), type: 'modify', handle: clone.handle, set: { x1: point.x, y1: point.y } });
      } else if (grip.kind === 'end') {
        ops.push({ op_id: opId(), type: 'modify', handle: clone.handle, set: { x2: point.x, y2: point.y } });
      } else {
        const mid = vec((clone.x1 + clone.x2) / 2, (clone.y1 + clone.y2) / 2);
        ops.push({ op_id: opId(), type: 'move', handles: [clone.handle], dx: point.x - mid.x, dy: point.y - mid.y });
      }
    } else if (clone.type === 'circle') {
      if (grip.kind === 'centre') {
        ops.push({ op_id: opId(), type: 'move', handles: [clone.handle], dx: point.x - clone.cx, dy: point.y - clone.cy });
      } else {
        ops.push({
          op_id: opId(),
          type: 'modify',
          handle: clone.handle,
          set: { r: Math.hypot(point.x - clone.cx, point.y - clone.cy) },
        });
      }
    } else if (clone.type === 'arc') {
      if (grip.kind === 'centre') {
        ops.push({ op_id: opId(), type: 'move', handles: [clone.handle], dx: point.x - clone.cx, dy: point.y - clone.cy });
      } else {
        const angle = (Math.atan2(point.y - clone.cy, point.x - clone.cx) * 180) / Math.PI;
        const normalised = ((angle % 360) + 360) % 360;
        ops.push({
          op_id: opId(),
          type: 'modify',
          handle: clone.handle,
          set: dragGrip.index === 1 ? { start: normalised } : { end: normalised },
        });
      }
    } else if (clone.type === 'pline') {
      const points = clone.points.map(([x, y], index) =>
        index === dragGrip?.index ? ([point.x, point.y] as [number, number]) : ([x, y] as [number, number]),
      );
      ops.push({ op_id: opId(), type: 'modify', handle: clone.handle, set: { points } });
    }
    void submitOps('GRIP', ops);
  };

  on(window, 'pointerup', (event: PointerEvent) => {
    if (event.pointerType === 'touch') return;
    const world = handles.worldAt(event);
    if (dragGrip) {
      const point = resolvePointer(world);
      applyGripDrag(point);
      dragGrip = null;
      dragStart = null;
      handles.setPreview(null);
      handles.render();
      return;
    }
    if (panning) {
      panning = false;
      dragStart = null;
      return;
    }
    if (!dragStart) return;
    const moved = Math.hypot(event.clientX - dragStart.screenX, event.clientY - dragStart.screenY);
    if (moved > 4) {
      const box = {
        minX: Math.min(dragStart.point.x, world.x),
        maxX: Math.max(dragStart.point.x, world.x),
        minY: Math.min(dragStart.point.y, world.y),
        maxY: Math.max(dragStart.point.y, world.y),
      };
      const crossing = event.clientX < dragStart.screenX;
      for (const entity of store.model.entities) {
        const layer = findLayer(store.model, entity.layer);
        if (layer && (!layer.on || layer.frozen || layer.locked)) continue;
        const entityBounds = entityBox(store.model, entity);
        const inside =
          entityBounds.minX >= box.minX && entityBounds.maxX <= box.maxX && entityBounds.minY >= box.minY && entityBounds.maxY <= box.maxY;
        const touches =
          entityBounds.minX <= box.maxX && box.minX <= entityBounds.maxX && entityBounds.minY <= box.maxY && box.minY <= entityBounds.maxY;
        const hit = crossing ? touches : inside;
        if (!hit) continue;
        if (event.shiftKey) store.selection.delete(entity.handle);
        else store.selection.add(entity.handle);
      }
      handles.setWindow(null, null);
      dragStart = null;
      store.emit({ kind: 'selection' });
      handles.render();
      return;
    }
    dragStart = null;
    const point = resolvePointer(world);
    if (engine.running()) {
      engine.enterPoint(point);
      handles.render();
      return;
    }
    const found = pickAt(point);
    if (found) {
      if (event.shiftKey || store.selection.has(found.handle)) store.selection.delete(found.handle);
      else store.selection.add(found.handle);
    } else if (!event.shiftKey) {
      store.selection.clear();
    }
    store.emit({ kind: 'selection' });
    handles.render();
  });

  on(handles.root, 'wheel', (event: WheelEvent) => {
    event.preventDefault();
    const rect = handles.root.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    const world = handles.worldAt(event);
    store.view.zoom = wheelZoom(store.view.zoom, event.deltaY < 0 ? 'in' : 'out');
    store.view.panX = screenX - world.x * store.view.zoom;
    store.view.panY = screenY + world.y * store.view.zoom;
    store.following = null;
    handles.render();
  }, { passive: false });

  // Touch gestures on a phone
  const touches = new Map<number, { x: number; y: number }>();
  let gesture: GestureStart | null = null;
  let touchStart: { x: number; y: number; at: number } | null = null;
  let longPressTimer = 0;
  const sheetMenu = el('div', { role: 'menu', 'aria-label': 'Sheet actions', class: 'surface sheet-menu' });
  sheetMenu.hidden = true;
  handles.root.append(sheetMenu);
  let measureFrom: Vec | null = null;

  const closeMenu = (): void => {
    sheetMenu.hidden = true;
    clear(sheetMenu);
  };

  const openSheetMenu = (point: Vec): void => {
    clear(sheetMenu);
    sheetMenu.hidden = false;
    const item = (label: string, action: () => void): HTMLElement => {
      const node = el('button', { type: 'button', role: 'menuitem' }, [label]);
      on(node, 'click', () => {
        closeMenu();
        action();
      });
      return node;
    };
    sheetMenu.append(
      item('Pin issue here', () => openIssueDialog(point)),
      item('Measure from here', () => {
        measureFrom = point;
        setPrompt('DIST: second point');
      }),
      item('Show versions', () => {
        phoneSheet.showModal();
        showPhonePanel('Versions');
      }),
    );
    (sheetMenu.querySelector('[role="menuitem"]') as HTMLElement | null)?.focus();
  };

  on(handles.root, 'touchstart', (event: TouchEvent) => {
    for (const touch of Array.from(event.changedTouches)) {
      touches.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
    }
    if (touches.size === 2) {
      const [first, second] = [...touches.values()];
      gesture = {
        distance: Math.hypot(first.x - second.x, first.y - second.y),
        midX: (first.x + second.x) / 2,
        midY: (first.y + second.y) / 2,
        zoom: store.view.zoom,
        panX: store.view.panX,
        panY: store.view.panY,
      };
      window.clearTimeout(longPressTimer);
      return;
    }
    if (touches.size === 1) {
      const touch = event.changedTouches[0];
      touchStart = { x: touch.clientX, y: touch.clientY, at: Date.now() };
      longPressTimer = window.setTimeout(() => {
        if (!touchStart) return;
        openSheetMenu(handles.worldAt({ clientX: touchStart.x, clientY: touchStart.y }));
        touchStart = null;
      }, LONG_PRESS_MS);
    }
  }, { passive: true });

  on(handles.root, 'touchmove', (event: TouchEvent) => {
    for (const touch of Array.from(event.changedTouches)) {
      touches.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
    }
    if (gesture && touches.size >= 2) {
      const [first, second] = [...touches.values()];
      const view = pinchView(
        gesture,
        Math.hypot(first.x - second.x, first.y - second.y),
        (first.x + second.x) / 2,
        (first.y + second.y) / 2,
      );
      store.view.zoom = view.zoom;
      store.view.panX = view.panX;
      store.view.panY = view.panY;
      store.following = null;
      handles.render();
      return;
    }
    if (touchStart) {
      const touch = event.changedTouches[0];
      if (Math.hypot(touch.clientX - touchStart.x, touch.clientY - touchStart.y) > TAP_MOVE_PX) {
        window.clearTimeout(longPressTimer);
      }
    }
  }, { passive: true });

  on(handles.root, 'touchend', (event: TouchEvent) => {
    window.clearTimeout(longPressTimer);
    for (const touch of Array.from(event.changedTouches)) touches.delete(touch.identifier);
    if (touches.size < 2) gesture = null;
    if (!touchStart) return;
    const touch = event.changedTouches[0];
    const moved = Math.hypot(touch.clientX - touchStart.x, touch.clientY - touchStart.y);
    const elapsed = Date.now() - touchStart.at;
    const point = handles.worldAt({ clientX: touch.clientX, clientY: touch.clientY });
    touchStart = null;
    if (moved >= TAP_MOVE_PX || elapsed > TAP_MS) return;
    if (measureFrom) {
      const distance = Math.hypot(point.x - measureFrom.x, point.y - measureFrom.y);
      const angle = ((Math.atan2(point.y - measureFrom.y, point.x - measureFrom.x) * 180) / Math.PI + 360) % 360;
      setPrompt(`DIST: ${fmtDisplay(distance)} units, angle ${fmtDisplay(angle)} degrees`);
      measureFrom = null;
      return;
    }
    openIssueDialog(point);
  }, { passive: true });

  // Keyboard map
  const stops = (): HTMLElement[] => {
    const list: HTMLElement[] = [commandInput, handles.root];
    if (store.layout === 'phone') {
      if (phoneSheet.open) list.push(phoneSheet);
      return list;
    }
    for (const name of PANEL_NAMES) {
      const entry = panels.get(name);
      if (!entry) continue;
      if (entry.header.getAttribute('aria-expanded') !== 'true') continue;
      list.push(entry.body);
    }
    return list;
  };

  const cycleStops = (step: number): void => {
    const list = stops();
    const active = document.activeElement as HTMLElement | null;
    let index = list.findIndex((node) => node === active || (active !== null && node.contains(active)));
    if (index < 0) index = 0;
    const next = list[(index + step + list.length) % list.length];
    next.setAttribute('tabindex', next === commandInput ? '0' : '0');
    next.focus();
  };

  const nudge = (dx: number, dy: number): void => {
    if (store.selection.size === 0) return;
    void submitOps('NUDGE', [{ op_id: opId(), type: 'move', handles: [...store.selection], dx, dy }]);
  };

  on(document, 'keydown', (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    const inField =
      target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
    const inCommand = target === commandInput;

    if (event.key === ' ' && !inField) spaceHeld = true;

    if (event.key === 'F3' || event.key === 'F8' || event.key === 'F9' || event.key === 'F10') {
      event.preventDefault();
      const name = event.key === 'F3' ? 'Snap' : event.key === 'F8' ? 'Ortho' : event.key === 'F9' ? 'Grid' : 'Polar';
      const key = name.toLowerCase() as 'snap';
      setAid(name as 'Snap', !store.aids[key]);
      return;
    }
    if (event.key === 'F6') {
      event.preventDefault();
      cycleStops(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key.toLowerCase() === 'z' && (event.ctrlKey || event.metaKey)) {
      if (inField && !(inCommand && commandInput.value === '')) return;
      event.preventDefault();
      if (event.shiftKey) void runRedo();
      else void runUndo();
      return;
    }
    if (event.key === 'Delete' && !inField && store.selection.size > 0) {
      event.preventDefault();
      const handles2 = [...store.selection];
      store.selection.clear();
      void submitOps('ERASE', [{ op_id: opId(), type: 'delete', handles: handles2 }]).then(() => {
        announce(`Erased ${handles2.length === 1 ? '1 entity' : `${handles2.length} entities`}`);
        focusCommand();
      });
      return;
    }
    if (event.key === 'Escape') {
      const dialog = target?.closest('dialog');
      if (dialog instanceof HTMLDialogElement) {
        event.preventDefault();
        dialog.close();
        focusCommand();
        return;
      }
      if (!sheetMenu.hidden) {
        event.preventDefault();
        closeMenu();
        focusCommand();
        return;
      }
      if (!findSearch.hidden && (target === findInput || findSearch.contains(target as Node))) {
        event.preventDefault();
        findSearch.hidden = true;
        focusCommand();
        return;
      }
      if (!inCommand) {
        event.preventDefault();
        focusCommand();
      }
      return;
    }
    if (
      ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key) &&
      (target === handles.root || handles.root.contains(target as Node)) &&
      store.selection.size > 0 &&
      !inField
    ) {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      if (event.key === 'ArrowUp') nudge(0, step);
      if (event.key === 'ArrowDown') nudge(0, -step);
      if (event.key === 'ArrowLeft') nudge(-step, 0);
      if (event.key === 'ArrowRight') nudge(step, 0);
      return;
    }
    if (!inField && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      commandInput.focus();
      if (event.key !== ' ') {
        commandInput.value += event.key;
        event.preventDefault();
      }
    }
  });

  on(document, 'keyup', (event: KeyboardEvent) => {
    if (event.key === ' ') spaceHeld = false;
  });

  // Offline switch and connection
  const showConnection = (): void => {
    const waiting = store.queue.reduce((total, group) => total + group.ops.length, 0);
    if (store.offline) {
      connection.textContent = `You're working offline. ${waiting === 1 ? '1 change' : `${waiting} changes`} waiting.`;
      return;
    }
    if (store.lastFlush) {
      const { sent, conflicts } = store.lastFlush;
      connection.textContent = `Back online: ${sent === 1 ? '1 change' : `${sent} changes`} sent, ${
        conflicts === 1 ? '1 conflict' : `${conflicts} conflicts`
      }.`;
      return;
    }
    connection.textContent = store.connection === 'live' ? 'Live' : 'Reconnecting\u2026';
  };

  on(offlineSwitch, 'click', () => {
    const next = offlineSwitch.getAttribute('aria-checked') !== 'true';
    offlineSwitch.setAttribute('aria-checked', next ? 'true' : 'false');
    store.lastFlush = null;
    store.setOffline(next);
    showConnection();
  });
  offlineSwitch.setAttribute('aria-checked', store.offline ? 'true' : 'false');

  // Presence
  const drawPeople = (): void => {
    clear(peopleList);
    for (const person of store.presence) {
      const item = el('li', { 'data-person': person.username, 'data-colour': String(person.colour) }, [person.username]);
      if (person.username !== store.username) {
        const follow = button(`Follow ${person.username}`);
        on(follow, 'click', () => {
          store.following = person.username;
          const target = store.presence.find((candidate) => candidate.username === person.username);
          if (target) {
            store.view = { zoom: target.zoom, panX: target.pan_x, panY: target.pan_y };
            handles.render();
          }
        });
        item.append(follow);
      }
      peopleList.append(item);
    }
  };

  // Store events
  store.on((event) => {
    switch (event.kind) {
      case 'model':
        zoomChip.textContent = `Zoom ${fmtDisplay(store.view.zoom)}`;
        handles.render();
        if (activeLayout !== 'Model') showLayout(activeLayout);
        break;
      case 'presence': {
        drawPeople();
        if (store.following) {
          const target = store.presence.find((candidate) => candidate.username === store.following);
          if (target) {
            store.view = { zoom: target.zoom, panX: target.pan_x, panY: target.pan_y };
          } else {
            announce(stoppedFollowing(store.following));
            store.following = null;
          }
        }
        handles.render();
        break;
      }
      case 'connection':
        showConnection();
        break;
      case 'notice':
        toast(event.text);
        break;
      case 'announce':
        announce(event.text);
        break;
      case 'rollback':
        focusCommand();
        break;
      case 'xref':
        clear(xrefNotice);
        xrefNotice.append(
          el('span', {}, [`${event.name} has a new version. Reload?`]),
          (() => {
            const reload = button('Reload');
            on(reload, 'click', () => {
              void submitOps('XRELOAD', [{ op_id: opId(), type: 'xref_reload', name: event.name }]).then(async () => {
                await store.refreshDrawing();
                clear(xrefNotice);
                handles.render();
              });
            });
            return reload;
          })(),
        );
        break;
      case 'role': {
        handles.root.focus();
        if (!event.role) {
          clear(root);
          root.append(el('main', { class: 'surface not-available' }, [el('p', {}, ['You no longer have access to this drawing.'])]));
          store.disconnect();
        }
        break;
      }
      case 'export':
        showExport(event.job);
        break;
      case 'versions':
        void store.refreshDrawing().then(() => drawLayoutTabs());
        break;
      default:
        break;
    }
  });

  if (options.versionId) {
    const version = await api.get<{ number: number; snapshot: VersionSnapshot }>(`/api/versions/${options.versionId}`);
    screen.setAttribute('data-version-view', String(version.number));
    sheetStage.hidden = false;
    sheetStage.innerHTML = sheetSvg(version.snapshot);
    handles.svgRoot.style.visibility = 'hidden';
  }

  store.connect();
  showConnection();
  drawPeople();
  if (!payload.start_view) handles.zoomAll();
  handles.render();
  focusCommand();
  setPrompt(READY_PROMPT);
}
