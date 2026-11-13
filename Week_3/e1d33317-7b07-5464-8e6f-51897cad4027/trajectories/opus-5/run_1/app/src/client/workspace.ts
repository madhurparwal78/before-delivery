import { formatBeat } from '../shared/music.js';
import type { EngravedSystem, Part } from '../shared/types.js';
import { request } from './api.js';
import {
  openAddMeasuresDialog,
  openAddStaffDialog,
  openExpressionTextDialog,
  openExtractDialog,
} from './dialogs.js';
import { button, clear, el, initials, isPhone, prefersReducedMotion } from './dom.js';
import { Editor } from './editor.js';
import { fetchSystems, systemGroup } from './engraving.js';
import { createHelix, webglAvailable, type HelixHandle } from './helix.js';
import { Playback } from './playback.js';
import { Regions } from './regions.js';
import type { ScoreState } from './score-state.js';
import {
  TAB_NAMES,
  buildPanel,
  requestHolds,
  roleWord,
  statusChip,
  type TabName,
  type ToolsContext,
} from './tools.js';

const NOTE_PAD_KEYS: { label: string; key: string; shift?: boolean }[] = [
  { label: 'C', key: 'c' },
  { label: 'D', key: 'd' },
  { label: 'E', key: 'e' },
  { label: 'F', key: 'f' },
  { label: 'G', key: 'g' },
  { label: 'A', key: 'a' },
  { label: 'B', key: 'b' },
  { label: 'Rest', key: 'r' },
];

const LIVE_PAUSED = 'Live sync paused. Your edits are saved and reach others within 10 seconds.';

export function renderWorkspace(
  state: ScoreState,
  navigate: (path: string) => void,
): HTMLElement {
  const reduced = prefersReducedMotion();
  const regions = new Regions(['Playback']);
  const liveChip = el('div', {
    class: 'live-chip',
    role: 'status',
    'aria-label': 'Live sync',
    'data-live': 'live',
  }, ['Live']);
  const editor = new Editor(state, regions);
  const playback = new Playback(state, regions);

  // ---------- top rail ----------
  const title = el('h1', {}, [state.head.title]);
  const playButton = button('Play', {});
  const readout = el('div', {
    class: 'position-readout',
    role: 'timer',
    'aria-label': 'Playback position',
  }, ['Measure 1 \u00b7 Beat 1']);
  const helixRadio = button('Helix', { role: 'radio', 'aria-checked': 'false' });
  const pagesRadio = button('Pages', { role: 'radio', 'aria-checked': 'true' });
  const viewSwitch = el(
    'div',
    { class: 'view-switch', role: 'radiogroup', 'aria-label': 'View' },
    isPhone() ? [pagesRadio] : [helixRadio, pagesRadio],
  );
  const extractButton = button('Extract part\u2026');
  const presence = el('ul', {
    class: 'presence-list',
    role: 'list',
    'aria-label': 'Collaborators here',
  });
  const rail = el('header', { class: 'top-rail' }, [
    title,
    el('div', { class: 'transport' }, [playButton, readout]),
    viewSwitch,
    extractButton,
  ]);
  if (state.me.role === 'composer') {
    rail.append(
      button('Add staff', {}, () => openAddStaffDialog(state, regions)),
      button('Add measures', {}, () => openAddMeasuresDialog(state, regions)),
    );
  }
  rail.append(el('div', { class: 'rail-spacer' }), presence, liveChip);

  // ---------- staves list ----------
  const stavesList = el('ul', {
    class: 'staves-list',
    role: 'listbox',
    'aria-label': 'Staves',
    'aria-multiselectable': 'true',
  });
  const selected = new Set<string>();
  let focusedStaff = 0;

  const paintStaves = (): void => {
    clear(stavesList);
    state.head.staves.forEach((staff, index) => {
      const hold = state.holderOf(staff.id);
      const option = el(
        'li',
        {
          role: 'option',
          'aria-selected': selected.has(staff.id) ? 'true' : 'false',
          'data-entry': staff.id === editor.entryStaffId ? 'true' : 'false',
          'data-staff': staff.id,
          'aria-label': staff.name,
          tabindex: index === focusedStaff ? '0' : '-1',
        },
        [staff.name],
      );
      if (hold) {
        option.append(
          el('span', { class: 'hold-mark', 'aria-hidden': 'true', title: hold.holder.name }, [
            initials(hold.holder.name),
          ]),
        );
      }
      option.addEventListener('click', () => {
        focusedStaff = index;
        editor.setEntryStaff(staff.id);
        selected.clear();
        selected.add(staff.id);
        paintStaves();
        stavesList.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
      });
      stavesList.append(option);
    });
  };

  stavesList.addEventListener('keydown', (event) => {
    const staves = state.head.staves;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = Math.min(
        staves.length - 1,
        Math.max(0, focusedStaff + (event.key === 'ArrowDown' ? 1 : -1)),
      );
      if (event.shiftKey) {
        selected.add(staves[focusedStaff]!.id);
        selected.add(staves[next]!.id);
      }
      focusedStaff = next;
      paintStaves();
      stavesList.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
      return;
    }
    if (event.key === ' ') {
      event.preventDefault();
      const staffId = staves[focusedStaff]!.id;
      if (selected.has(staffId)) selected.delete(staffId);
      else selected.add(staffId);
      paintStaves();
      stavesList.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      editor.setEntryStaff(staves[focusedStaff]!.id);
      paintStaves();
    }
  });

  // ---------- centre ----------
  const scoreEditor = el('div', {
    class: 'paper-column',
    role: 'application',
    'aria-label': 'Score editor',
    tabindex: '0',
  });
  const strip = el('div', { class: 'system-strip', role: 'region', 'aria-label': 'System strip' });
  const helixWrap = el('div', { class: 'helix-wrap' });
  const peelPage = el('div', { class: 'peel-page' });
  const centre = el('div', { class: 'centre' }, [stavesList, scoreEditor]);

  let systems: EngravedSystem[] = [];
  let helix: HelixHandle | null = null;
  const hasWebgl = webglAvailable();
  let currentView: 'Pages' | 'Helix' = 'Pages';

  const paintSystems = (): void => {
    clear(scoreEditor);
    if (currentView === 'Helix' && !isPhone()) {
      clear(helixWrap);
      if (helix === null) {
        helix = createHelix(reduced);
        helix.canvas.setAttribute('role', 'img');
        helix.canvas.setAttribute('aria-label', `Helix view of ${state.head.title}`);
      }
      helixWrap.append(helix.canvas, peelPage);
      const hidden = el('div', { class: 'visually-hidden' });
      for (const system of systems) hidden.append(systemGroup(system));
      scoreEditor.append(helixWrap, hidden);
      void helix.setSystems(systems);
      return;
    }
    if (isPhone()) {
      clear(strip);
      for (const system of systems) strip.append(systemGroup(system));
      scoreEditor.append(strip);
      return;
    }
    for (const system of systems) {
      const group = systemGroup(system);
      if (incoming) group.classList.add('incoming');
      scoreEditor.append(group);
    }
    incoming = false;
    paintCaret();
  };

  let incoming = false;

  const reload = async (): Promise<void> => {
    const engraved = await fetchSystems(state.scoreId, 'score', null);
    systems = engraved.systems;
    paintSystems();
  };

  const chooseView = (next: 'Pages' | 'Helix'): void => {
    if (next === 'Helix' && !hasWebgl) {
      regions.say('View', '3D view unavailable \u2014 showing pages.');
      return;
    }
    currentView = next;
    helixRadio.setAttribute('aria-checked', String(next === 'Helix'));
    pagesRadio.setAttribute('aria-checked', String(next === 'Pages'));
    paintSystems();
  };
  helixRadio.addEventListener('click', () => chooseView('Helix'));
  pagesRadio.addEventListener('click', () => chooseView('Pages'));
  if (!hasWebgl) {
    helixRadio.disabled = true;
    regions.say('View', '3D view unavailable \u2014 showing pages.');
  }
  viewSwitch.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    chooseView(currentView === 'Pages' ? 'Helix' : 'Pages');
  });

  // ---------- tools ----------
  let activeTab: TabName = 'Parts';
  const tabList = el('div', { role: 'tablist', 'aria-label': 'Score tools', class: 'tab-list' });
  const tabPanel = el('div', { class: 'tab-panel', role: 'tabpanel' });
  const tools = el('aside', {
    class: 'tools night',
    role: 'complementary',
    'aria-label': 'Score tools',
    'data-open': 'true',
  });
  const toggleTools = button('Hide tools');
  const body = el('div', { class: 'workspace-body', 'data-tools': 'open' }, [centre, tools]);

  const context: ToolsContext = {
    state,
    regions,
    selectedStaffIds: () => (selected.size > 0 ? [...selected] : [editor.entryStaffId]),
    openPart: (partId) => navigate(`/score/${state.scoreId}/parts/${partId}`),
    extractPart: async (partId) => {
      await request(`/api/scores/${state.scoreId}/parts/${partId}/extract`, { method: 'POST' });
      if (currentView === 'Helix') await peelFor(partId);
    },
  };

  const paintTabs = (): void => {
    clear(tabList);
    for (const name of TAB_NAMES) {
      const tab = button(name, {
        role: 'tab',
        'aria-selected': name === activeTab ? 'true' : 'false',
        tabindex: name === activeTab ? '0' : '-1',
      });
      tab.addEventListener('click', () => {
        activeTab = name;
        paintTabs();
        clear(tabPanel);
        tabPanel.append(buildPanel(name, context));
        tabPanel.setAttribute('aria-label', name);
      });
      tabList.append(tab);
    }
  };
  tabList.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const here = TAB_NAMES.indexOf(activeTab);
    const next = TAB_NAMES[(here + (event.key === 'ArrowRight' ? 1 : TAB_NAMES.length - 1)) % TAB_NAMES.length]!;
    activeTab = next;
    paintTabs();
    clear(tabPanel);
    tabPanel.append(buildPanel(next, context));
    tabPanel.setAttribute('aria-label', next);
    tabList.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
  });
  paintTabs();
  tabPanel.append(buildPanel(activeTab, context));
  tabPanel.setAttribute('aria-label', activeTab);
  toggleTools.addEventListener('click', () => {
    const open = tools.dataset.open === 'true';
    tools.dataset.open = open ? 'false' : 'true';
    body.dataset.tools = open ? 'closed' : 'open';
    toggleTools.textContent = open ? 'Show tools' : 'Hide tools';
  });
  tools.append(el('div', { class: 'tools-head' }, [toggleTools]), tabList, tabPanel);

  // ---------- bottom sheet and note pad ----------
  const sheetBody = el('div', { class: 'sheet-body' });
  const sheetHandle = button(activeTab, { class: 'sheet-handle' });
  const sheet = el('div', { class: 'bottom-sheet', 'data-open': 'false' }, [
    sheetHandle,
    sheetBody,
  ]);
  sheetHandle.addEventListener('click', () => {
    const open = sheet.dataset.open === 'true';
    sheet.dataset.open = open ? 'false' : 'true';
    if (!open) {
      clear(sheetBody);
      if (isPhone()) sheetBody.append(stavesListClone());
      sheetBody.append(tabList, tabPanel);
      sheetBody.querySelector<HTMLElement>('button')?.focus();
    }
  });
  const stavesListClone = (): HTMLElement => {
    const section = el('div', {}, [el('h2', {}, ['Staves'])]);
    section.append(stavesList);
    return section;
  };

  const notePad = el('div', { class: 'note-pad', role: 'toolbar', 'aria-label': 'Note pad' });
  const press = (key: string, shift = false): void => {
    editor.handleKey(
      new KeyboardEvent('keydown', { key, shiftKey: shift, bubbles: false }),
    );
  };
  for (const pad of NOTE_PAD_KEYS) {
    notePad.append(button(pad.label, {}, () => press(pad.key)));
  }
  notePad.append(
    button('Shorter', {}, () => stepDuration(1)),
    button('Longer', {}, () => stepDuration(-1)),
    button('Delete', {}, () => press('Backspace')),
    button('Add text', {}, () => press('x')),
  );
  const DURATION_STEPS = ['whole', 'half', 'quarter', 'eighth', '16th', '32nd'] as const;
  const stepDuration = (direction: 1 | -1): void => {
    const here = DURATION_STEPS.indexOf(editor.duration);
    const next = DURATION_STEPS[Math.min(DURATION_STEPS.length - 1, Math.max(0, here + direction))]!;
    press(String(7 - DURATION_STEPS.indexOf(next)));
  };

  // ---------- editor wiring ----------
  editor.onChange = () => {
    paintStaves();
    paintCaret();
  };

  /** The caret: the one vermilion mark that shows where the next note lands. */
  const paintCaret = (): void => {
    for (const mark of scoreEditor.querySelectorAll('.caret-mark')) mark.remove();
    const { measure, beat } = editor.caretPosition();
    const system = systems.find(
      (candidate) => candidate.firstMeasure <= measure && candidate.lastMeasure >= measure,
    );
    if (!system) return;
    const group = scoreEditor.querySelector<HTMLElement>(`.system[data-system="${system.index}"]`);
    if (!group) return;
    const span = system.lastMeasure - system.firstMeasure + 1;
    const beats = state.meter.signatureAt(measure).beats;
    const mark = el('div', { class: 'caret-mark' });
    mark.style.left = `${((measure - system.firstMeasure + (beat - 1) / beats) / span) * 100}%`;
    group.append(mark);
  };
  editor.onTextRequest = (event) => {
    openExpressionTextDialog(event, (text) => editor.saveText(event, text));
  };
  editor.onPlayToggle = () => void togglePlay();
  state.onRefused = (message) => {
    regions.say('Entry', `That edit was refused: ${message}`);
  };

  scoreEditor.addEventListener('pointerdown', (event) => {
    const group = (event.target as Element).closest<SVGGElement>('g[data-lamport]');
    if (!group) return;
    const staffId = group.dataset.staff!;
    const voice = Number(group.dataset.voice) as 1 | 2;
    if (staffId !== editor.entryStaffId || voice !== editor.voice) {
      editor.voice = voice;
      editor.setEntryStaff(staffId);
    }
    editor.setCaretToEvent({
      lamport: Number(group.dataset.lamport),
      site: group.dataset.site!,
    });
    scoreEditor.focus();
  });

  scoreEditor.addEventListener('keydown', (event) => {
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
    }
    if (editor.handleKey(event)) {
      event.preventDefault();
      event.stopPropagation();
      void refresh();
    }
  });

  let refreshTimer: number | null = null;
  const refresh = async (): Promise<void> => {
    if (refreshTimer !== null) return;
    refreshTimer = window.setTimeout(() => {
      refreshTimer = null;
      void reload();
    }, 220);
  };

  // ---------- workspace shortcuts ----------
  const root = el('div', { class: 'workspace' }, [rail, body, sheet, notePad, regions.root]);
  root.addEventListener('keydown', (event) => {
    if (!event.shiftKey) return;
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select')) return;
    if (document.querySelector('.scrim') !== null) return;
    const key = event.key.toLowerCase();
    if (key === 'p') {
      event.preventDefault();
      void togglePlay();
    } else if (key === 'e') {
      event.preventDefault();
      openExtract();
    } else if (key === 'h') {
      event.preventDefault();
      void requestHolds(context);
    }
  });

  const openExtract = (): void => {
    const staff = state.staff(editor.entryStaffId);
    openExtractDialog(state, regions, staff.partId, context.extractPart);
  };
  extractButton.addEventListener('click', openExtract);

  // ---------- playback ----------
  const togglePlay = async (): Promise<void> => {
    await playback.toggle(editor.caretPosition().measure);
  };
  playButton.addEventListener('click', () => void togglePlay());
  playback.onPlayingChange = (playing) => {
    playButton.textContent = playing ? 'Stop' : 'Play';
  };
  playback.onPosition = (measure, beat) => {
    readout.textContent = `Measure ${measure} \u00b7 Beat ${formatBeat(Math.floor(beat * 100) / 100)}`;
    const system = systems.find(
      (candidate) => candidate.firstMeasure <= measure && candidate.lastMeasure >= measure,
    );
    helix?.setPlayhead(system?.index ?? null);
    paintPlayhead(measure);
  };

  const paintPlayhead = (measure: number): void => {
    for (const mark of scoreEditor.querySelectorAll('.playhead')) mark.remove();
    const group = scoreEditor.querySelector<HTMLElement>(
      `.system[data-first="${
        systems.find((s) => s.firstMeasure <= measure && s.lastMeasure >= measure)?.firstMeasure ?? -1
      }"]`,
    );
    if (!group) return;
    const system = systems.find((s) => s.firstMeasure <= measure && s.lastMeasure >= measure)!;
    const span = system.lastMeasure - system.firstMeasure + 1;
    const fraction = (measure - system.firstMeasure) / span;
    const mark = el('div', { class: 'playhead', 'data-static': reduced ? 'true' : 'false' });
    mark.style.left = `${fraction * 100}%`;
    if (reduced) mark.style.width = `${(1 / span) * 100}%`;
    group.append(mark);
  };

  // ---------- peel ----------
  const peelFor = async (partId: string): Promise<void> => {
    const part = state.head.parts.find((candidate) => candidate.id === partId)!;
    helixWrap.dataset.peeled = 'true';
    await helix?.peel(part.staffIds.length);
    const engraved = await fetchSystems(state.scoreId, 'part', partId);
    clear(peelPage);
    const page = el('div', { class: 'part-page' });
    for (const system of engraved.systems) page.append(systemGroup(system));
    const chipHolder = el('span', {});
    const paintChip = (): void => {
      clear(chipHolder);
      chipHolder.append(statusChip(state.parts.find((candidate) => candidate.id === partId)!));
    };
    paintChip();
    peeledChip = paintChip;
    const back = button('Back to score', {}, () => {
      helixWrap.dataset.peeled = 'false';
      peeledChip = null;
      helix?.windBack();
    });
    peelPage.append(el('div', {}, [chipHolder, back]), page);
  };

  let peeledChip: (() => void) | null = null;

  // ---------- live regions and subscriptions ----------
  const paintPresence = (): void => {
    clear(presence);
    for (const entry of state.presence) {
      presence.append(el('li', {}, [`${entry.name} \u00b7 ${roleWord(entry.role)}`]));
    }
    for (const mark of scoreEditor.querySelectorAll('.cursor-mark')) mark.remove();
    for (const entry of state.presence) {
      if (entry.cursor === null || entry.collaboratorId === state.me.id) continue;
      const system = systems.find(
        (candidate) =>
          candidate.firstMeasure <= entry.cursor!.measure &&
          candidate.lastMeasure >= entry.cursor!.measure,
      );
      if (!system) continue;
      const group = scoreEditor.querySelector<HTMLElement>(`.system[data-system="${system.index}"]`);
      if (!group) continue;
      const span = system.lastMeasure - system.firstMeasure + 1;
      const mark = el('div', { class: 'cursor-mark' }, [initials(entry.name)]);
      mark.style.left = `${((entry.cursor.measure - system.firstMeasure) / span) * 100}%`;
      mark.style.top = '2px';
      group.append(mark);
    }
  };

  const paintLive = (): void => {
    if (state.live) {
      if (liveChip.dataset.live === 'paused') {
        liveChip.textContent = 'Live sync restored.';
        window.setTimeout(() => {
          liveChip.textContent = 'Live';
        }, 3000);
      } else {
        liveChip.textContent = 'Live';
      }
      liveChip.dataset.live = 'live';
      return;
    }
    liveChip.dataset.live = 'paused';
    liveChip.textContent = LIVE_PAUSED;
  };

  const paintQueue = (): void => {
    const queue = state.queueState;
    if (queue.offline && queue.pending > 0) {
      regions.say('Sync queue', `Offline \u2014 ${queue.pending} edits queued. Retrying.`);
      return;
    }
    if (queue.waitingSeconds > 0) {
      regions.say(
        'Sync queue',
        `Waiting ${queue.waitingSeconds} s to send ${queue.pending} queued edits.`,
      );
      return;
    }
    if (queue.pending === 0) regions.say('Sync queue', 'All queued edits sent.');
  };

  const announced = new Map<string, string>();
  const paintParts = (): void => {
    for (const part of state.parts) {
      const was = announced.get(part.id);
      const now = `${part.status}:${part.lastError ?? ''}`;
      announced.set(part.id, now);
      if (was === undefined || was === now) continue;
      const message = partMessage(part);
      if (message !== '') regions.say('Parts', message);
    }
  };

  state.on('presence', paintPresence);
  state.on('holds', paintStaves);
  state.on('live', paintLive);
  state.on('queue', paintQueue);
  state.on('parts', paintParts);
  state.on('parts', () => peeledChip?.());
  state.on('voices', () => void refresh());
  state.on('ops-received', () => {
    incoming = true;
  });
  state.on('score', () => {
    title.textContent = state.head.title;
    paintStaves();
    void reload();
  });
  state.on('removed', () => {
    navigate('/seat-not-valid');
  });

  paintStaves();
  paintPresence();
  paintLive();
  void reload();
  window.setTimeout(() => scoreEditor.focus(), 0);
  window.addEventListener('resize', () => paintSystems());
  return root;
}

export function partMessage(part: Part): string {
  switch (part.status) {
    case 'engraving':
      return `Engraving ${part.name}\u2026`;
    case 'rendering':
      return `Rendering ${part.name} PDF\u2026`;
    case 'ready':
      return `${part.name} PDF ready.`;
    case 'pdf_pending':
      return `${part.name} PDF pending: the renderer is unavailable. The preview pages are ready.`;
    case 'draft':
      return part.lastError === 'storage_unavailable'
        ? `${part.name} could not be engraved: storage is unavailable. Try again later.`
        : '';
  }
}
