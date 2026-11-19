import type { Files, Pen, ShelfEntry, Version } from '../../shared/api';
import { copy } from '../../shared/copy';
import { api, ApiFailure } from '../api';
import { penSettingsDialog } from '../components/pensettings';
import { separator } from '../components/separator';
import { shareDialog } from '../components/sharedialog';
import { siteHeader, verifyBanner, watchVerification } from '../components/shell';
import { tablist } from '../components/tabs';
import { h, replace, say, status } from '../dom';
import { formatTime } from '../format';
import { band, mountPage, onBandChange } from '../layout';
import { ConsolePanel, PreviewHost } from '../preview';
import { goto, onLeave } from '../router';
import { config, live, me } from '../store';

type Layout = 'side-by-side' | 'stacked' | 'preview-first';
type Arrangement = Layout | 'medium' | 'narrow';

const LAYOUTS: readonly { value: Layout; label: string }[] = [
  { value: 'side-by-side', label: 'Side by side' },
  { value: 'stacked', label: 'Stacked' },
  { value: 'preview-first', label: 'Preview first' },
];

const PANE_NAMES = [
  { key: 'html', label: 'HTML' },
  { key: 'css', label: 'CSS' },
  { key: 'js', label: 'JS' },
] as const;

interface Draft {
  files: Files;
  libraries: string[];
  base: number;
  time: string;
}

const draftKey = (penId: string): string => `ashlar.draft.${penId}`;
const sameFiles = (a: Files, b: Files): boolean =>
  a.html === b.html && a.css === b.css && a.js === b.js;
const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

const storedLayout = (): Layout => {
  const value = window.localStorage.getItem('ashlar.layout');
  return LAYOUTS.some((layout) => layout.value === value) ? (value as Layout) : 'side-by-side';
};

interface Shares {
  main: number;
  htmlCss: number;
  cssJs: number;
}

const storedShares = (): Shares => {
  const raw = window.localStorage.getItem('ashlar.shares');
  if (!raw) return { main: 47, htmlCss: 50, cssJs: 50 };
  return JSON.parse(raw) as Shares;
};

export const editorPage = async (params: Record<string, string>): Promise<void> => {
  const penId = params.id!;
  let pen = await api.get<Pen>(`/api/pens/${penId}`);
  let shelfEntries: ShelfEntry[] = [];

  let files: Files = pen.version?.files ?? { html: '', css: '', js: '' };
  let libraries: string[] = [...(pen.version?.libraries ?? [])];
  const loaded: { files: Files; libraries: string[] } = {
    files: { ...files },
    libraries: [...libraries],
  };
  let baseVersion = pen.head;
  let dirty = false;
  let layout = storedLayout();
  const shares = storedShares();
  const forkKey = `fork-${penId}-${Math.random().toString(36).slice(2)}`;

  // Toolbar
  const titleBox = h('input', { type: 'text', 'aria-label': 'Pen title', class: 'title-box' });
  const titleNote = h('span', { class: 'note' });
  const versionLabel = h('span', { class: 'version-label tabular' });
  const saveButton = h('button', { type: 'button', class: 'action accent', text: 'Save' });
  const likeButton = h('button', { type: 'button', class: 'ghost', text: 'Like', 'aria-pressed': 'false' });
  const forkButton = h('button', { type: 'button', class: 'ghost', text: 'Fork' });
  const shareButton = h('button', { type: 'button', class: 'ghost', text: 'Share' });
  const historyLink = h('a', { href: `/pen/${penId}/history`, class: 'ghost', text: 'History' });
  const exportButton = h('button', { type: 'button', class: 'ghost', text: 'Export' });
  const settingsButton = h('button', { type: 'button', class: 'ghost', text: 'Pen settings' });

  const layoutRadios = LAYOUTS.map((option) =>
    h('input', { type: 'radio', name: 'layout', value: option.value, class: 'radio' }),
  );
  const layoutGroup = h(
    'div',
    { role: 'radiogroup', 'aria-label': 'Layout', class: 'radios layout-radios' },
    LAYOUTS.map((option, index) =>
      h('label', { class: 'radio-row' }, [layoutRadios[index]!, h('span', { text: option.label })]),
    ),
  );

  const saveStatus = status('Save status');
  const likesStatus = status('Likes');
  const forksStatus = status('Forks');
  const exportStatus = status('Export status');
  const previewStatus = status('Preview status');
  const forkCredit = h('div', { class: 'fork-credit muted' });

  // Panes
  const textareas = PANE_NAMES.map((pane) =>
    h('textarea', {
      'aria-label': `${pane.label} code`,
      class: 'code-pane mono',
      spellcheck: 'false',
      wrap: 'off',
    }),
  );
  const paneSections = PANE_NAMES.map((pane, index) =>
    h('section', { class: `pane pane-${pane.key}` }, [
      h('h2', { class: 'pane-heading', text: pane.label }),
      textareas[index]!,
    ]),
  );

  // Stage
  const previewRegion = h('div', { role: 'region', 'aria-label': 'Preview', class: 'preview-region' });
  const stage = h('div', { class: 'stage' }, [previewRegion]);
  const stageWrap = h('div', { class: 'stage-wrap' }, [stage]);

  const consolePanel = new ConsolePanel();
  const consoleBand = h('div', { class: 'console-band' }, [
    h('div', { class: 'console-head' }, [consolePanel.toggle, consolePanel.clearButton]),
    consolePanel.log,
  ]);

  const draftHolder = h('div', { class: 'draft-holder' });
  const alertHolder = h('div', { class: 'alert-holder' });
  const panesHolder = h('div', { class: 'panes' });
  const bodyHolder = h('div', { class: 'column-body' }, [draftHolder, alertHolder, panesHolder]);

  const preview = new PreviewHost({
    region: previewRegion,
    statusRegion: previewStatus,
    consolePanel,
  });

  // Separators
  const pairShare = (first: HTMLElement, second: HTMLElement, event: PointerEvent, axis: 'x' | 'y'): number => {
    const start = first.getBoundingClientRect();
    const end = second.getBoundingClientRect();
    if (axis === 'y') return ((event.clientY - start.top) / (end.bottom - start.top)) * 100;
    return ((event.clientX - start.left) / (end.right - start.left)) * 100;
  };

  const sepMain = separator({
    label: 'Resize preview and code',
    initial: shares.main,
    share: (event) => {
      const rect = splitRoot.getBoundingClientRect();
      const current = arrangement();
      if (current === 'side-by-side') return ((event.clientX - rect.left) / rect.width) * 100;
      if (current === 'stacked') return ((rect.bottom - event.clientY) / rect.height) * 100;
      return ((event.clientY - rect.top) / rect.height) * 100;
    },
    onChange: (value) => {
      shares.main = value;
      applyShares();
    },
  });
  const sepHtmlCss = separator({
    label: 'Resize HTML and CSS',
    initial: shares.htmlCss,
    share: (event) =>
      pairShare(paneSections[0]!, paneSections[1]!, event, paneAxis()),
    onChange: (value) => {
      shares.htmlCss = value;
      applyShares();
    },
  });
  const sepCssJs = separator({
    label: 'Resize CSS and JS',
    initial: shares.cssJs,
    share: (event) => pairShare(paneSections[1]!, paneSections[2]!, event, paneAxis()),
    onChange: (value) => {
      shares.cssJs = value;
      applyShares();
    },
  });

  const splitRoot = h('div', { class: 'split' });
  const head = h('div', { class: 'column-head' });
  const root = h('div', { class: 'shell editor' }, [siteHeader(), splitRoot, consoleBand]);

  const arrangement = (): Arrangement => {
    const current = band();
    if (current === 'narrow') return 'narrow';
    if (current === 'medium') return 'medium';
    return layout;
  };
  const paneAxis = (): 'x' | 'y' => {
    const current = arrangement();
    return current === 'stacked' || current === 'preview-first' ? 'x' : 'y';
  };

  const applyShares = (): void => {
    window.localStorage.setItem('ashlar.shares', JSON.stringify(shares));
    const grow = (value: number): number => value / (100 - value);
    root.style.setProperty('--stage-share', `${shares.main}%`);
    root.style.setProperty('--html-grow', String(grow(shares.htmlCss)));
    root.style.setProperty('--css-grow', '1');
    root.style.setProperty('--js-grow', String(1 / grow(shares.cssJs)));
  };

  const banner = verifyBanner();

  const settings = penSettingsDialog({
    pen: () => pen,
    libraries: () => libraries,
    shelf: () => shelfEntries,
    onLibraries: (next) => {
      libraries = next;
      markDirty();
      schedulePreview();
    },
    onPen: (next) => {
      pen = next;
      paintPen();
    },
    onDeleted: () => goto('/dashboard'),
    trigger: settingsButton,
  });
  const share = shareDialog({ pen: () => pen, trigger: shareButton });

  replace(head, [
    h('div', { class: 'toolbar' }, [
      titleBox,
      versionLabel,
      saveButton,
      likeButton,
      forkButton,
      shareButton,
      historyLink,
      exportButton,
      settingsButton,
      layoutGroup,
    ]),
    titleNote,
    forkCredit,
    h('div', { class: 'statuses' }, [
      likesStatus,
      forksStatus,
      saveStatus,
      exportStatus,
      previewStatus,
    ]),
    banner,
    settings.element,
    share.element,
  ]);

  /** The arrangement is rebuilt when the band changes, keeping every pane and its text. */
  const arrange = (): void => {
    const current = arrangement();
    root.dataset.arrangement = current;
    layoutGroup.hidden = current === 'medium' || current === 'narrow';
    if (layoutGroup.hidden) layoutGroup.setAttribute('inert', '');
    else layoutGroup.removeAttribute('inert');

    sepMain.setOrientation(current === 'side-by-side' ? 'vertical' : 'horizontal');
    const paneOrientation = paneAxis() === 'x' ? 'vertical' : 'horizontal';
    sepHtmlCss.setOrientation(paneOrientation);
    sepCssJs.setOrientation(paneOrientation);

    if (current === 'narrow') {
      const tabs = tablist(
        'Panes',
        [
          { name: 'HTML', panel: h('div', { class: 'tab-pane' }, [draftHolder, alertHolder, paneSections[0]!]) },
          { name: 'CSS', panel: h('div', { class: 'tab-pane' }, [paneSections[1]!]) },
          { name: 'JS', panel: h('div', { class: 'tab-pane' }, [paneSections[2]!]) },
          { name: 'Result', panel: h('div', { class: 'tab-pane' }, [stageWrap]) },
          { name: 'Console', panel: h('div', { class: 'tab-pane' }, [consoleBand]) },
        ],
        0,
      );
      const consoleTab = tabs.list.children[4] as HTMLElement;
      consoleTab.appendChild(consolePanel.addBadge());
      replace(splitRoot, [head, tabs.list, tabs.panels]);
      return;
    }

    replace(panesHolder, [
      paneSections[0]!,
      sepHtmlCss.element,
      paneSections[1]!,
      sepCssJs.element,
      paneSections[2]!,
    ]);
    replace(bodyHolder, [draftHolder, alertHolder, panesHolder]);
    replace(splitRoot, [head, stageWrap, sepMain.element, bodyHolder]);
    if (!root.contains(consoleBand)) root.appendChild(consoleBand);
  };

  const paintPen = (): void => {
    titleBox.value = pen.title;
    versionLabel.textContent = copy.versionLabel(pen.head);
    likeButton.setAttribute('aria-pressed', pen.liked ? 'true' : 'false');
    say(likesStatus, copy.likes(pen.likes));
    say(forksStatus, copy.forks(pen.forks));
    const source = pen.forked_from;
    if (source === null) replace(forkCredit, []);
    else if ('removed' in source) replace(forkCredit, [copy.forkCreditRemoved]);
    else if ('hidden' in source) replace(forkCredit, [copy.forkCreditHidden]);
    else
      replace(forkCredit, [
        h('a', {
          href: `/pen/${source.pen_id}`,
          text: copy.forkCredit(source.title, source.owner),
        }),
      ]);
    likeButton.hidden = me() === null;
    forkButton.hidden = me() === null;
  };

  const readPanes = (): void => {
    files = {
      html: textareas[0]!.value,
      css: textareas[1]!.value,
      js: textareas[2]!.value,
    };
  };

  const writePanes = (): void => {
    textareas[0]!.value = files.html;
    textareas[1]!.value = files.css;
    textareas[2]!.value = files.js;
  };

  const markDirty = (): void => {
    dirty = !sameFiles(files, loaded.files) || !sameList(libraries, loaded.libraries);
  };

  let previewTimer = 0;
  const renderPreview = (): void => {
    void preview.show({ files, libraries }).catch(() => undefined);
  };
  /** The preview re-renders exactly the configured delay after the last edit, never earlier. */
  const schedulePreview = (): void => {
    window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(renderPreview, config().preview_delay_ms);
  };

  const onEdit = (): void => {
    readPanes();
    markDirty();
    schedulePreview();
  };

  const saveDraft = (): void => {
    if (!dirty) return;
    const draft: Draft = {
      files,
      libraries,
      base: baseVersion,
      time: new Date().toISOString(),
    };
    window.localStorage.setItem(draftKey(penId), JSON.stringify(draft));
  };
  const clearDraft = (): void => window.localStorage.removeItem(draftKey(penId));

  const closeConflict = (): void => replace(alertHolder, []);

  const openConflict = (head: number): void => {
    baseVersion = head;
    say(saveStatus, '');
    const keep = h('button', { type: 'button', class: 'action accent', text: 'Keep mine as next version' });
    const latest = h('button', { type: 'button', class: 'ghost', text: 'Load latest' });
    replace(alertHolder, [
      h('div', { role: 'alert', class: 'panel panel-error conflict' }, [
        h('p', { text: copy.conflict(head) }),
        keep,
        latest,
      ]),
    ]);
    keep.addEventListener('click', () => void save());
    latest.addEventListener('click', () => void loadLatest());
    keep.focus();
  };

  const loadLatest = async (): Promise<void> => {
    const fresh = await api.get<Pen>(`/api/pens/${penId}`);
    pen = fresh;
    files = fresh.version?.files ?? { html: '', css: '', js: '' };
    libraries = [...(fresh.version?.libraries ?? [])];
    loaded.files = { ...files };
    loaded.libraries = [...libraries];
    baseVersion = fresh.head;
    dirty = false;
    clearDraft();
    writePanes();
    paintPen();
    closeConflict();
    replace(draftHolder, []);
    say(saveStatus, copy.loadedLatest(fresh.head));
    renderPreview();
  };

  const save = async (): Promise<void> => {
    readPanes();
    say(saveStatus, copy.savePending);
    try {
      const version = await api.post<Version>(`/api/pens/${penId}/versions`, {
        base_version: baseVersion,
        files,
        libraries,
      });
      baseVersion = version.number;
      pen = { ...pen, head: version.number, version };
      loaded.files = { ...files };
      loaded.libraries = [...libraries];
      dirty = false;
      clearDraft();
      closeConflict();
      replace(draftHolder, []);
      versionLabel.textContent = copy.versionLabel(version.number);
      say(saveStatus, copy.saved(version.number));
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      if (error.code === 'version_conflict' && error.head !== null) {
        openConflict(error.head);
        return;
      }
      if (error.code === 'unverified') {
        say(saveStatus, copy.unverified(me()?.email ?? ''));
        return;
      }
      if (error.code === 'validation') {
        const message = Object.values(error.fields)[0];
        say(saveStatus, message ?? error.message);
        return;
      }
      if (error.code === 'storage_unavailable') {
        say(saveStatus, copy.saveStorageDown);
        return;
      }
      throw error;
    }
  };

  const exportVersion = async (): Promise<void> => {
    try {
      const response = await api.raw('GET', `/api/pens/${penId}/export`);
      if (!response.ok) {
        const body = (await response.json()) as { error: string };
        say(
          exportStatus,
          body.error === 'nothing_to_export' ? copy.nothingToExport : copy.exportStorageDown,
        );
        exportButton.focus();
        return;
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = h('a', { href: url, download: `${penId}-v${pen.head}.zip` });
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      say(exportStatus, copy.exported(pen.head));
    } catch {
      say(exportStatus, copy.exportStorageDown);
      exportButton.focus();
    }
  };

  const toggleLike = async (): Promise<void> => {
    const liked = likeButton.getAttribute('aria-pressed') === 'true';
    try {
      const result = liked
        ? await api.delete<{ liked: boolean; likes: number }>(`/api/pens/${penId}/like`)
        : await api.put<{ liked: boolean; likes: number }>(`/api/pens/${penId}/like`);
      pen = { ...pen, liked: result.liked, likes: result.likes };
      likeButton.setAttribute('aria-pressed', result.liked ? 'true' : 'false');
      say(likesStatus, copy.likes(result.likes));
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'unverified') {
        say(likesStatus, copy.unverified(me()?.email ?? ''));
        return;
      }
      throw error;
    }
  };

  const doFork = async (): Promise<void> => {
    forkButton.disabled = true;
    try {
      const fork = await api.post<Pen>(`/api/pens/${penId}/fork`, {}, { 'Idempotency-Key': forkKey });
      goto(`/pen/${fork.id}`);
    } catch (error) {
      forkButton.disabled = false;
      if (error instanceof ApiFailure && error.code === 'unverified') {
        say(forksStatus, copy.unverified(me()?.email ?? ''));
        return;
      }
      throw error;
    }
  };

  // Code pane keyboard
  textareas.forEach((area) => {
    let leaving = false;
    area.addEventListener('input', onEdit);
    area.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        leaving = true;
        event.preventDefault();
        return;
      }
      if (event.key === 'Tab') {
        if (leaving) {
          leaving = false;
          return;
        }
        event.preventDefault();
        indent(area, event.shiftKey);
        onEdit();
        return;
      }
      leaving = false;
    });
  });

  titleBox.addEventListener('change', async () => {
    try {
      pen = await api.patch<Pen>(`/api/pens/${penId}`, { title: titleBox.value });
      titleNote.textContent = '';
      paintPen();
    } catch (error) {
      if (error instanceof ApiFailure && error.fields.title) {
        titleNote.textContent = error.fields.title;
        return;
      }
      throw error;
    }
  });

  saveButton.addEventListener('click', () => void save());
  likeButton.addEventListener('click', () => void toggleLike());
  forkButton.addEventListener('click', () => void doFork());
  shareButton.addEventListener('click', () => share.open());
  exportButton.addEventListener('click', () => void exportVersion());
  settingsButton.addEventListener('click', () => settings.open());

  layoutRadios.forEach((radio, index) => {
    radio.addEventListener('change', () => {
      layout = LAYOUTS[index]!.value;
      window.localStorage.setItem('ashlar.layout', layout);
      arrange();
    });
  });

  consolePanel.toggle.addEventListener('click', () => {
    const open = consolePanel.toggle.getAttribute('aria-expanded') === 'true';
    consolePanel.toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
    consolePanel.log.hidden = open;
    consolePanel.clearButton.hidden = open;
  });

  const onSaveKey = (event: KeyboardEvent): void => {
    if (!root.isConnected) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void save();
    }
  };
  document.addEventListener('keydown', onSaveKey);
  onLeave(() => document.removeEventListener('keydown', onSaveKey));

  layoutRadios.forEach((radio, index) => {
    radio.checked = LAYOUTS[index]!.value === layout;
  });
  writePanes();
  paintPen();
  applyShares();
  arrange();
  mountPage(root);
  onBandChange(() => arrange());

  const restored = window.sessionStorage.getItem('ashlar.restored');
  if (restored) {
    window.sessionStorage.removeItem('ashlar.restored');
    const parsed = JSON.parse(restored) as { from: number; to: number };
    say(saveStatus, copy.restoredLanding(parsed.from, parsed.to));
  }

  const draftRaw = window.localStorage.getItem(draftKey(penId));
  if (draftRaw) {
    const draft = JSON.parse(draftRaw) as Draft;
    if (!sameFiles(draft.files, loaded.files) || !sameList(draft.libraries, loaded.libraries)) {
      const restore = h('button', { type: 'button', class: 'action accent', text: 'Restore draft' });
      const discard = h('button', { type: 'button', class: 'ghost', text: 'Discard draft' });
      const region = h(
        'section',
        { role: 'region', 'aria-label': 'Unsaved draft', class: 'panel panel-empty' },
        [h('p', { text: copy.draftOffered(formatTime(draft.time)) }), restore, discard],
      );
      const finish = (): void => {
        replace(draftHolder, []);
        textareas[0]!.focus();
      };
      restore.addEventListener('click', () => {
        files = draft.files;
        libraries = [...draft.libraries];
        writePanes();
        markDirty();
        schedulePreview();
        finish();
      });
      discard.addEventListener('click', () => {
        clearDraft();
        finish();
      });
      replace(draftHolder, [region]);
    }
  }

  renderPreview();
  const draftTimer = window.setInterval(saveDraft, config().draft_interval_ms);

  const stream = live([penId], {
    counts: (event) => {
      pen = { ...pen, likes: event.likes, forks: event.forks };
      say(likesStatus, copy.likes(event.likes));
      say(forksStatus, copy.forks(event.forks));
    },
    account: watchVerification(banner),
  });
  onLeave(() => {
    window.clearInterval(draftTimer);
    window.clearTimeout(previewTimer);
    stream.close();
  });

  shelfEntries = (await api.get<{ libraries: ShelfEntry[] }>('/api/shelf')).libraries;
};

/** Tab indents by two spaces, Shift+Tab removes up to two leading spaces. */
const indent = (area: HTMLTextAreaElement, outdent: boolean): void => {
  const value = area.value;
  const start = area.selectionStart;
  const end = area.selectionEnd;

  if (!outdent && start === end) {
    area.value = `${value.slice(0, start)}  ${value.slice(end)}`;
    area.selectionStart = start + 2;
    area.selectionEnd = start + 2;
    return;
  }

  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = value.indexOf('\n', end) === -1 ? value.length : value.indexOf('\n', end);
  const block = value.slice(lineStart, lineEnd);
  const lines = block.split('\n');
  const changed = lines.map((line) =>
    outdent ? line.replace(/^ {1,2}/, '') : `  ${line}`,
  );
  const replacement = changed.join('\n');
  area.value = value.slice(0, lineStart) + replacement + value.slice(lineEnd);
  area.selectionStart = lineStart;
  area.selectionEnd = lineStart + replacement.length;
};
