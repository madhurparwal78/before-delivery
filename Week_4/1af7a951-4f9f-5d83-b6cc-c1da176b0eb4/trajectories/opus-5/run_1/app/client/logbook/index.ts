import {
  api,
  type Entry,
  type NightStatus,
  type Session,
  type SignCategory,
} from '../api.js';
import {
  CATEGORY_LABELS,
  COPY,
  DRILL_PROMPTS,
  drillLoggedCopy,
  heldNightCopy,
  nightLine,
} from '../copy.js';
import { Dialog } from '../dialog.js';
import { h, setHidden, setText } from '../dom.js';
import { announce, statusRegion } from '../live.js';
import { DreamscapeView, type LayoutMode } from './dreamscape.js';
import { Journal, textOffsetsOfSelection } from './journal.js';
import {
  keptEntriesOf,
  putKeptEntry,
  putKeptMemo,
  rejectKeptEntry,
  removeKeptEntry,
  removeKeptMemo,
  keptMemo,
  type KeptEntry,
} from './keep.js';
import { sendKeptEntry, setSyncListeners, syncAttempt } from './sync.js';

const NIGHT_REFRESH_MS = 60_000;

function layoutMode(): LayoutMode {
  const width = window.innerWidth;
  if (width < 768) return 'phone';
  if (width < 1200) return 'tablet';
  return 'desktop';
}

function goToSignIn(): void {
  location.assign('/signin?next=%2Flogbook');
}

export function logbookScreen(session: Session): Node {
  let night: NightStatus | null = null;
  let entries: Entry[] = [];
  let pendingMemo: { blob: Blob; durationMs: number } | null = null;
  let recorder: MediaRecorder | null = null;
  let drillStep = 1;
  let drillTarget: SignCategory | null = null;

  const nightLineNode = h('p', { class: 'night-line' });
  const bedtimeNode = h('p', {});
  const wakeNode = h('p', {});
  const captureNode = h('p', { class: 'capture' });
  const settingsButton = h('button', { type: 'button', class: 'ghost', text: 'Night settings' });
  const tonight = h('section', { role: 'region', 'aria-label': 'Tonight', class: 'tonight' }, [
    nightLineNode,
    bedtimeNode,
    wakeNode,
    captureNode,
    settingsButton,
  ]);

  const connection = statusRegion('Connection', 'connection');
  const practice = statusRegion('Practice');
  const sync = statusRegion('Sync');

  const journal = new Journal({
    save: () => {
      void saveEntry();
    },
    tag: (entryId, button) => {
      openTagDialog(entryId, button);
    },
    share: (entryId, next, button) => {
      void toggleShare(entryId, next, button);
    },
    edit: (keptId) => {
      void editKept(keptId);
    },
    discard: (keptId) => {
      void discardKept(keptId);
    },
    recordMemo: (button) => {
      void toggleRecording(button);
    },
    memoError: () => {
      announce(sync, COPY.memoPlaybackFailed);
    },
  });

  const dreamscape = new DreamscapeView((target, opener) => {
    openDrill(target, opener);
  });
  dreamscape.afterSettle = () => {
    void refreshSigns();
  };

  const column = h('div', { class: 'column' }, [tonight, connection, journal.region, practice, sync]);
  const workspace = h('div', { class: 'workspace' }, [column, dreamscape.region]);
  const dialogs = h('div', { class: 'dialogs' });
  column.append(dialogs);

  // Night settings dialog
  const zoneSelect = h('select', { 'aria-label': 'Home time zone', id: 'settings-zone' });
  const bedtimeInput = h('input', {
    type: 'text',
    'aria-label': 'Usual bedtime',
    id: 'settings-bedtime',
  });
  const zoneError = h('p', { class: 'field-error' });
  const bedtimeError = h('p', { class: 'field-error' });
  const saveSettings = h('button', { type: 'button', class: 'primary', text: 'Save settings' });
  const cancelSettings = h('button', { type: 'button', class: 'ghost', text: 'Cancel' });
  const settingsDialog = new Dialog({ label: 'Night settings', className: 'panel' });
  settingsDialog.element.append(
    h('h2', { text: 'Night settings' }),
    h('div', { class: 'field' }, [
      h('label', { for: 'settings-zone', text: 'Home time zone' }),
      zoneSelect,
      zoneError,
    ]),
    h('div', { class: 'field' }, [
      h('label', { for: 'settings-bedtime', text: 'Usual bedtime' }),
      bedtimeInput,
      bedtimeError,
    ]),
    h('div', { class: 'row' }, [saveSettings, cancelSettings]),
  );
  dialogs.append(settingsDialog.element);
  cancelSettings.addEventListener('click', () => {
    settingsDialog.close();
  });
  settingsButton.addEventListener('click', () => {
    zoneError.textContent = '';
    bedtimeError.textContent = '';
    if (night !== null) {
      zoneSelect.value = night.home_tz;
      bedtimeInput.value = night.bedtime;
    }
    settingsDialog.open(settingsButton, zoneSelect);
  });
  saveSettings.addEventListener('click', () => {
    void (async () => {
      saveSettings.disabled = true;
      zoneError.textContent = '';
      bedtimeError.textContent = '';
      const result = await api.settings({ home_tz: zoneSelect.value, bedtime: bedtimeInput.value });
      saveSettings.disabled = false;
      if (result.ok && result.body !== null) {
        settingsDialog.close();
        announce(
          practice,
          result.body.night_held
            ? heldNightCopy(result.body.night_number)
            : COPY.settingsSaved,
        );
        await refreshNight();
        return;
      }
      if (result.status === 401) {
        goToSignIn();
        return;
      }
      const fields = result.fieldErrors ?? {};
      if (fields['home_tz'] !== undefined) setText(zoneError, fields['home_tz']);
      if (fields['bedtime'] !== undefined) setText(bedtimeError, fields['bedtime']);
    })();
  });

  // Tag dialog
  const phraseNode = h('p', { class: 'phrase' });
  const categoryGroup = h('div', {
    role: 'radiogroup',
    'aria-label': 'Category',
    class: 'radios',
  });
  const categoryRadios: HTMLInputElement[] = [];
  for (const category of ['inner_awareness', 'action', 'form', 'context'] as const) {
    const radio = h('input', {
      type: 'radio',
      name: 'sign-category',
      value: category,
      id: `category-${category}`,
      checked: category === 'inner_awareness',
    });
    categoryRadios.push(radio);
    categoryGroup.append(
      h('span', { class: 'radio' }, [
        radio,
        h('label', { for: `category-${category}`, text: CATEGORY_LABELS[category] }),
      ]),
    );
  }
  const confirmTag = h('button', { type: 'button', class: 'primary', text: 'Confirm tag' });
  const cancelTag = h('button', { type: 'button', class: 'ghost', text: 'Cancel' });
  const tagDialog = new Dialog({ label: 'Tag dream sign', className: 'panel' });
  tagDialog.element.append(
    h('h2', { text: 'Tag dream sign' }),
    phraseNode,
    categoryGroup,
    h('div', { class: 'row' }, [confirmTag, cancelTag]),
  );
  dialogs.append(tagDialog.element);
  cancelTag.addEventListener('click', () => {
    tagDialog.close();
  });
  tagDialog.element.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    confirmTag.click();
  });

  // Drill dialog
  const drillText = h('p', { class: 'drill-text' });
  const drillStepNode = h('p', { class: 'drill-step' });
  const drillNext = h('button', { type: 'button', class: 'primary', text: 'Next' });
  const drillLog = h('button', { type: 'button', class: 'primary', text: 'Log reality check' });
  const drillClose = h('button', { type: 'button', class: 'ghost', text: 'Close drill' });
  const drillDialog = new Dialog({ label: 'Reality check drill', className: 'panel' });
  drillDialog.element.append(
    h('h2', { text: 'Reality check drill' }),
    drillText,
    drillStepNode,
    h('div', { class: 'row' }, [drillNext, drillLog, drillClose]),
  );
  dialogs.append(drillDialog.element);
  drillClose.addEventListener('click', () => {
    drillDialog.close();
  });
  drillNext.addEventListener('click', () => {
    if (drillStep < 3) drillStep += 1;
    renderDrill();
  });
  drillLog.addEventListener('click', () => {
    void logDrill();
  });

  function renderDrill(): void {
    const target = drillTarget;
    if (target === null) return;
    setText(
      drillText,
      drillStep === 1 ? DRILL_PROMPTS[target] : drillStep === 2 ? COPY.drillStep2 : COPY.drillStep3,
    );
    setText(drillStepNode, `Step ${drillStep} of 3`);
    setHidden(drillNext, drillStep === 3);
    setHidden(drillLog, drillStep !== 3);
  }

  function openDrill(target: SignCategory, opener: HTMLElement): void {
    drillTarget = target;
    drillStep = 1;
    renderDrill();
    drillDialog.open(opener, drillNext);
  }

  async function logDrill(): Promise<void> {
    const target = drillTarget;
    if (target === null) return;
    drillLog.disabled = true;
    const result = await api.realityCheck(crypto.randomUUID(), target);
    drillLog.disabled = false;
    if (result.status === 401) {
      goToSignIn();
      return;
    }
    if (result.ok && result.body !== null) {
      announce(practice, drillLoggedCopy(result.body.night_count));
    }
    drillDialog.close();
  }

  function openTagDialog(entryId: string, button: HTMLButtonElement): void {
    const body = journal.entryTextNode(entryId);
    if (body === null) return;
    const offsets = textOffsetsOfSelection(body);
    if (offsets === null) {
      dreamscape.announceSigns(COPY.noSelection);
      return;
    }
    const text = body.dataset['text'] ?? '';
    const phrase = text.slice(offsets.start, offsets.end);
    const selection = window.getSelection();
    const rect =
      selection !== null && selection.rangeCount > 0
        ? selection.getRangeAt(0).getBoundingClientRect()
        : null;
    setText(phraseNode, `Phrase: "${phrase}"`);
    const first = categoryRadios[0];
    for (const radio of categoryRadios) radio.checked = radio === first;
    const confirm = (): void => {
      const chosen = categoryRadios.find((radio) => radio.checked)?.value;
      const category: SignCategory =
        chosen === 'action' || chosen === 'form' || chosen === 'context' ? chosen : 'inner_awareness';
      tagDialog.close();
      void tagSign(entryId, offsets.start, offsets.end, phrase, category, rect);
    };
    confirmTag.onclick = confirm;
    tagDialog.open(button, first);
  }

  async function tagSign(
    entryId: string,
    start: number,
    end: number,
    phrase: string,
    category: SignCategory,
    rect: DOMRect | null,
  ): Promise<void> {
    journal.markRange(entryId, start, end);
    const pending = api.tagSign(entryId, start, end, category).then((result) => {
      if (result.ok && result.body !== null) {
        return { ok: true, category, tallies: result.body.tallies };
      }
      if (result.status === 401) goToSignIn();
      journal.clearPending(entryId);
      dreamscape.announceSigns(
        result.errorCode === 'sign_overlap' ? COPY.signOverlap : COPY.signRefused,
      );
      return { ok: false, category, tallies: null };
    });
    dreamscape.startCondensation(category, phrase, rect, pending);
  }

  async function refreshSigns(): Promise<void> {
    const [entriesResult, dreamscapeResult] = await Promise.all([
      api.entries(),
      api.dreamscape(),
    ]);
    if (entriesResult.body !== null) entries = entriesResult.body.entries;
    if (dreamscapeResult.body !== null) dreamscape.setData(dreamscapeResult.body);
    renderJournal();
  }

  async function toggleShare(
    entryId: string,
    next: boolean,
    button: HTMLButtonElement,
  ): Promise<void> {
    button.disabled = true;
    const result = await api.share(entryId, next);
    button.disabled = false;
    if (result.status === 401) {
      goToSignIn();
      return;
    }
    if (result.ok && result.body !== null) {
      entries = entries.map((entry) =>
        entry.id === result.body?.entry.id ? result.body.entry : entry,
      );
      renderJournal();
      announce(practice, next ? COPY.sharedWithCoach : COPY.noLongerShared);
    }
  }

  async function toggleRecording(button: HTMLButtonElement): Promise<void> {
    if (recorder !== null) {
      recorder.stop();
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
    if (stream === null) return;
    const made = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    const startedAt = Date.now();
    made.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });
    made.addEventListener('stop', () => {
      const type = made.mimeType === '' ? 'audio/webm' : made.mimeType;
      pendingMemo = {
        blob: new Blob(chunks, { type }),
        durationMs: Math.max(1, Date.now() - startedAt),
      };
      for (const track of stream.getTracks()) track.stop();
      recorder = null;
      setText(button, 'Record voice memo');
    });
    recorder = made;
    made.start();
    setText(button, 'Stop recording');
  }

  async function saveEntry(): Promise<void> {
    const fields = journal.fields();
    const id = crypto.randomUUID();
    const kept: KeptEntry = {
      id,
      enrollmentId: session.id,
      title: fields.title,
      text: fields.text,
      dreamsRecalled: fields.dreamsRecalled,
      lucid: fields.lucid,
      wbtb: fields.wbtb,
      technique: fields.technique,
      techniqueMinutes: fields.techniqueMinutes,
      rejectedReason: null,
      writtenAt: Date.now(),
      nightKey: night?.night_key ?? '',
      hasMemo: pendingMemo !== null,
    };
    putKeptEntry(kept);
    if (pendingMemo !== null) {
      await putKeptMemo({
        entryId: id,
        enrollmentId: session.id,
        blob: pendingMemo.blob,
        durationMs: pendingMemo.durationMs,
      });
      pendingMemo = null;
    }
    journal.resetForm();
    renderJournal();
    if (!navigator.onLine) return;
    await sendKeptEntry(kept);
    await refreshNight();
  }

  async function editKept(keptId: string): Promise<void> {
    const kept = keptEntriesOf(session.id).find((entry) => entry.id === keptId);
    if (kept === undefined) return;
    const memo = await keptMemo(keptId);
    if (memo !== null) {
      pendingMemo = { blob: memo.blob, durationMs: memo.durationMs };
      await removeKeptMemo(keptId);
    }
    removeKeptEntry(keptId);
    journal.fillFrom(kept);
    renderJournal();
  }

  async function discardKept(keptId: string): Promise<void> {
    removeKeptEntry(keptId);
    await removeKeptMemo(keptId);
    renderJournal();
    journal.focusTitle();
  }

  function renderTonight(): void {
    if (night === null) return;
    if (night.night_number >= 1) {
      setText(nightLineNode, nightLine(night.night_number, night.night_key));
    } else {
      setText(nightLineNode, `Your first night is ${night.first_night ?? ''}.`);
    }
    setText(bedtimeNode, `Bedtime ${night.bedtime}`);
    setText(wakeNode, `Wake alarm ${night.wake_alarm}`);
    setText(
      captureNode,
      night.capture_window === 'open' ? COPY.captureOpen : COPY.captureClosed,
    );
    journal.setTechniqueUnlocked(night.technique_unlocked);
  }

  function renderJournal(): void {
    journal.render(entries, keptEntriesOf(session.id), night, night?.home_tz ?? 'UTC');
  }

  async function refreshNight(): Promise<void> {
    const result = await api.night();
    if (result.status === 401) {
      goToSignIn();
      return;
    }
    if (result.body === null) return;
    night = result.body;
    renderTonight();
    renderJournal();
  }

  let layout: LayoutMode | null = null;

  function applyLayout(): void {
    const mode = layoutMode();
    if (mode === layout) return;
    layout = mode;
    workspace.setAttribute('data-layout', mode);
    dreamscape.applyLayout(mode);
    if (mode === 'desktop') workspace.replaceChildren(column, dreamscape.region);
    else workspace.replaceChildren(dreamscape.region, column);
  }

  setSyncListeners({
    syncAnnounce: (text) => {
      announce(sync, text, true);
    },
    memoAnnounce: (text) => {
      announce(sync, text);
    },
    entrySaved: (entry) => {
      entries = [entry, ...entries.filter((candidate) => candidate.id !== entry.id)];
      renderJournal();
    },
    entriesChanged: async () => {
      const result = await api.entries();
      if (result.body !== null) {
        entries = result.body.entries;
        renderJournal();
      }
    },
    entryRejected: (keptId, reason) => {
      rejectKeptEntry(keptId, reason);
      renderJournal();
    },
    unauthorized: goToSignIn,
  });

  function setOffline(offline: boolean): void {
    announce(connection, offline ? COPY.offlineBanner : '');
  }

  window.addEventListener('online', () => {
    setOffline(false);
    void (async () => {
      await refreshNight();
      await syncAttempt(session.id);
    })();
  });
  window.addEventListener('offline', () => {
    setOffline(true);
  });
  window.addEventListener('resize', applyLayout);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && navigator.onLine) void refreshNight();
  });
  const timer = window.setInterval(() => {
    if (!document.hidden && navigator.onLine) void refreshNight();
  }, NIGHT_REFRESH_MS);
  window.addEventListener('beforeunload', () => {
    window.clearInterval(timer);
  });

  applyLayout();
  setOffline(!navigator.onLine);
  renderJournal();

  void (async () => {
    if (!navigator.onLine) return;
    const zones = await api.timeZones();
    for (const zone of zones.body?.zones ?? []) {
      zoneSelect.append(h('option', { value: zone, text: zone }));
    }
    await refreshNight();
    const [entriesResult, dreamscapeResult] = await Promise.all([api.entries(), api.dreamscape()]);
    if (entriesResult.status === 401) {
      goToSignIn();
      return;
    }
    if (entriesResult.body !== null) entries = entriesResult.body.entries;
    if (dreamscapeResult.body !== null) dreamscape.setData(dreamscapeResult.body);
    renderJournal();
    if (navigator.onLine) await syncAttempt(session.id);
  })();

  return workspace;
}
