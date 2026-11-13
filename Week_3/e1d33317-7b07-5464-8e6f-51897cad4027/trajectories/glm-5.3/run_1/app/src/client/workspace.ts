import { VNode, render } from './jsx/jsx-runtime.js';
import { api, ApiError, Score, Part, Collaborator, VoiceEvent, Hold, PresenceEntry, HistoryEntry, EngravedSystem, Bank, clearToken } from './api.js';
import { roleWord } from './join.js';
import { dialogs } from './dialogs.js';
import { ScoreEditor } from './editor.js';
import { HelixView } from './helix.js';
import { HelixPeel } from './helixpeel.js';
import { announce } from './liveregions.js';
import { Playback } from './playback.js';

export interface WorkspaceProps {
  scoreId: string;
  initialMe: { collaborator: Collaborator; score: { id: string; title: string } } | null;
  onNeedMe: () => Promise<{ collaborator: Collaborator; score: { id: string; title: string } }>;
  onOpenPart: (partId: string) => void;
  onInvalidSeat: () => void;
}

interface QueueItem {
  ops: Record<string, unknown>[];
  at?: number;
  /** Pending announcements, keyed by the element id they describe. */
  notices?: { id: { lamport: number; site: string }; text: string }[];
}

const DURATION_KEYS: Record<string, string> = { '7': 'whole', '6': 'half', '5': 'quarter', '4': 'eighth', '3': '16th', '2': '32nd' };
const DURATION_STEP = ['whole', 'half', 'quarter', 'eighth', '16th', '32nd'];

export function Workspace(props: WorkspaceProps): VNode {
  let me: { collaborator: Collaborator; score: { id: string; title: string } } | null = props.initialMe;
  let score: Score | null = null;
  let parts: Part[] = [];
  let collaborators: Collaborator[] = [];
  let holds: Hold[] = [];
  let presence: PresenceEntry[] = [];
  let banks: Bank[] = [];
  let voiceEvents: VoiceEvent[] = [];
  let systems: EngravedSystem[] = [];
  let engravingCursor: string | null = null;
  let view: 'helix' | 'pages' = 'pages';
  let helixAvailable = false;
  let live = true;
  let activeTab = 'parts';
  let selectedStaves: string[] = [];
  let entryStaffId: string | null = null;
  let entryVoice = 1;
  let caretIndex = -1;
  let chosenDuration = 'quarter';
  let chosenDots = 0;
  let playing = false;
  let playMeasure = 1;
  let playBeat = 1;
  let historyEntries: HistoryEntry[] = [];
  let historyCursor: string | null = null;
  let historyFilter = '';
  let pendingNewCount = 0;
  let queue: QueueItem[] = [];
  let queueCountdown = 0;
  let queueTimer: ReturnType<typeof setInterval> | null = null;
  let ws: WebSocket | null = null;
  let connectionId: string | null = null;
  let lastSeq = 0;
  let lamport = 0;
  let pendingFetch = false;
  let lastHeartbeatCursor: { staffId: string; measure: number; beat: number } | null = null;
  let reducedMotion = false;
  let narrow = false;
  let medium = false;
  let sheetOpen = false;
  let toolsCollapsed = false;
  const editorRef: { current: ScoreEditor | null } = { current: null };
  const helixRef: { current: HelixView | null } = { current: null };
  const peelRef: { current: HelixPeel | null } = { current: null };
  const playbackRef: { current: Playback | null } = { current: null };

  reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  try {
    helixAvailable = Boolean(document.createElement('canvas').getContext('webgl'));
  } catch {
    helixAvailable = false;
  }

  function isComposer(): boolean {
    return me?.collaborator.role === 'composer';
  }

  function isCopyist(): boolean {
    return me?.collaborator.role === 'copyist';
  }

  function canEditLayout(): boolean {
    return isComposer() || isCopyist();
  }

  function editableStaffIds(): string[] {
    if (!me) return [];
    if (me.collaborator.role === 'player') return me.collaborator.staffIds;
    return score?.staves.map((s) => s.id) ?? [];
  }

  // ---- data loading ----

  async function loadScore(): Promise<void> {
    try {
      const res = await api.get<{ score: Score }>(`/api/scores/${props.scoreId}`);
      score = res.score;
      parts = res.score.parts;
      if (!entryStaffId && score.staves.length > 0) {
        const editable = score.staves.find((s) => editableStaffIds().includes(s.id));
        entryStaffId = editable?.id ?? score.staves[0].id;
        selectedStaves = [entryStaffId];
      }
      rerender();
      void loadVoice();
      void loadEngraving(true);
    } catch (err) {
      handleFatal(err);
    }
  }

  async function loadVoice(): Promise<void> {
    if (!entryStaffId) return;
    try {
      const res = await api.get<{ events: VoiceEvent[] }>(
        `/api/scores/${props.scoreId}/staves/${entryStaffId}/voices/${entryVoice}`,
      );
      voiceEvents = res.events;
      editorRef.current?.setEvents(voiceEvents);
      rerender();
    } catch {
      // the staff may have vanished; the next score refresh handles it
    }
  }

  async function loadEngraving(reset: boolean): Promise<void> {
    try {
      const query = new URLSearchParams({ view: 'score', limit: '8' });
      const res = await api.get<{ systems: EngravedSystem[]; nextCursor: string | null; lamport: number }>(
        `/api/scores/${props.scoreId}/engraving?${query}`,
      );
      systems = res.systems;
      engravingCursor = res.nextCursor;
      lamport = res.lamport;
      if (reset) rerender();
    } catch {
      // keep the previous systems
    }
  }

  async function loadMoreSystems(): Promise<void> {
    if (!engravingCursor) return;
    const query = new URLSearchParams({ view: 'score', limit: '8', cursor: engravingCursor });
    const res = await api.get<{ systems: EngravedSystem[]; nextCursor: string | null }>(
      `/api/scores/${props.scoreId}/engraving?${query}`,
    );
    systems = [...systems, ...res.systems];
    engravingCursor = res.nextCursor;
    rerender();
  }

  async function loadCollaborators(): Promise<void> {
    const res = await api.get<{ collaborators: Collaborator[] }>(`/api/scores/${props.scoreId}/collaborators`);
    collaborators = res.collaborators;
    rerender();
  }

  async function loadHolds(): Promise<void> {
    const res = await api.get<{ holds: Hold[] }>(`/api/scores/${props.scoreId}/holds`);
    holds = res.holds;
    rerender();
  }

  async function loadPresence(): Promise<void> {
    const res = await api.get<{ entries: PresenceEntry[] }>(`/api/scores/${props.scoreId}/presence`);
    presence = res.entries;
    rerender();
  }

  async function loadBanks(): Promise<void> {
    const res = await api.get<{ banks: Bank[] }>(`/api/scores/${props.scoreId}/banks`);
    banks = res.banks;
    rerender();
  }

  async function loadHistory(reset: boolean): Promise<void> {
    const params = new URLSearchParams();
    if (historyFilter === 'type=insert') params.set('type', 'insert');
    else if (historyFilter === 'type=delete') params.set('type', 'delete');
    else if (historyFilter.startsWith('field=')) params.set('field', historyFilter.slice(6));
    if (reset) {
      const res = await api.get<{ entries: HistoryEntry[]; nextCursor: string | null }>(
        `/api/scores/${props.scoreId}/history?limit=50&${params}`,
      );
      historyEntries = res.entries;
      historyCursor = res.nextCursor;
      pendingNewCount = 0;
    } else {
      if (!historyCursor) return;
      params.set('before', historyCursor);
      const res = await api.get<{ entries: HistoryEntry[]; nextCursor: string | null }>(
        `/api/scores/${props.scoreId}/history?limit=50&${params}`,
      );
      historyEntries = [...historyEntries, ...res.entries];
      historyCursor = res.nextCursor;
      announce('History', res.entries.length > 0 ? `Loaded ${res.entries.length} older changes.` : 'No older changes.');
    }
    rerender();
  }

  function handleFatal(err: unknown): void {
    if (err instanceof ApiError && err.status === 401) {
      clearToken();
      props.onInvalidSeat();
      return;
    }
    if (err instanceof ApiError && err.status === 404) {
      clearToken();
      props.onInvalidSeat();
      return;
    }
  }

  // ---- live session ----

  function connectWebSocket(): void {
    const token = sessionStorage.getItem('fairline-seat') ?? localStorage.getItem('fairline-seat');
    if (!token) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${proto}//${location.host}/api/scores/${props.scoreId}/live?token=${encodeURIComponent(token)}`);
    ws = socket;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse((event as MessageEvent).data) as Record<string, unknown>;
      void handleSocketMessage(message);
    });
    socket.addEventListener('close', () => {
      setTimeout(connectWebSocket, 3000);
    });
  }

  async function handleSocketMessage(message: Record<string, unknown>): Promise<void> {
    const type = message['type'] as string;
    if (type === 'welcome') {
      connectionId = message['connectionId'] as string;
      lastSeq = message['lastSeq'] as number;
      if (message['live'] === false) setLive(false);
      else setLive(true);
      rerender();
    } else if (type === 'ops') {
      const entries = message['entries'] as { seq: number; op: Record<string, unknown>; author: { id: string; name: string; role: string } }[];
      for (const entry of entries) {
        if (entry.seq > lastSeq) lastSeq = entry.seq;
        if (entry.author.id !== me?.collaborator.id) {
          announce('Score changes', opSummary(entry.op));
        }
      }
      await syncFromServer();
    } else if (type === 'presence') {
      presence = message['entries'] as PresenceEntry[];
      rerender();
    } else if (type === 'holds') {
      holds = message['holds'] as Hold[];
      rerender();
    } else if (type === 'part') {
      const part = message['part'] as Part;
      parts = parts.map((p) => (p.id === part.id ? part : p));
      announce('Parts', partStatusAnnouncement(part));
      peelRef.current?.setChipStatus(`${part.name} PDF status: ${part.stale ? `${partStatusWord(part.status)} · Score changed since this PDF` : partStatusWord(part.status)}`);
      rerender();
    } else if (type === 'bank') {
      const bank = message['bank'] as Bank;
      banks = [bank, ...banks];
      rerender();
    } else if (type === 'score') {
      score = message['score'] as Score;
      parts = score.parts;
      rerender();
      await loadVoice();
      await loadEngraving(true);
    } else if (type === 'live') {
      setLive(message['live'] === true);
      if (message['live'] === true) {
        await catchUp();
      }
      rerender();
    } else if (type === 'removed') {
      clearToken();
      props.onInvalidSeat();
    }
  }

  function setLive(value: boolean): void {
    if (live === value) return;
    live = value;
    if (!value) announce('Live sync', 'Live sync paused. Your edits are saved and reach others within 10 seconds.');
    else announce('Live sync', 'Live sync restored.');
    if (value && pendingFetch) {
      pendingFetch = false;
      void catchUp();
    }
  }

  async function catchUp(): Promise<void> {
    try {
      const res = await api.get<{ ops: { seq: number; op: Record<string, unknown> }[]; lastSeq: number; lamport: number }>(
        `/api/scores/${props.scoreId}/ops?afterSeq=${lastSeq}`,
      );
      for (const op of res.ops) {
        if (op.seq > lastSeq) lastSeq = op.seq;
      }
      await syncFromServer();
    } catch {
      // retried by the next tick
    }
  }

  async function syncFromServer(): Promise<void> {
    await loadVoice();
    await loadScore();
  }

  function startHeartbeat(): void {
    setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'heartbeat', cursor: lastHeartbeatCursor, seen: lamport }));
      }
      if (!live && !pendingFetch) {
        pendingFetch = true;
        void catchUp();
      }
    }, 5000);
  }

  // ---- operations queue ----

  function enqueueOp(op: Record<string, unknown>): void {
    lamport += 1;
    op['id'] = { lamport, site: me!.collaborator.id };
    const last = queue[queue.length - 1] as (QueueItem & { at: number }) | undefined;
    if (last && Date.now() - last.at < 250) {
      last.ops.push(op);
    } else {
      queue.push({ at: Date.now(), ops: [op] } as QueueItem & { at: number });
    }
    if (!queueTimer) flushQueue();
  }

  async function flushQueue(): Promise<void> {
    if (queue.length === 0) {
      queueTimer = null;
      return;
    }
    const batch = queue.shift()!;
    try {
      const res = await api.post<{ applied: unknown[]; duplicates: unknown[]; lamport: number; lastSeq: number }>(
        `/api/scores/${props.scoreId}/ops`,
        { ops: batch.ops, seen: lamport },
      );
      lastSeq = res.lastSeq;
      if (res.duplicates.length === 0) announce('Sync queue', 'All queued edits sent.');
      queueTimer = setTimeout(() => void flushQueue(), 30) as unknown as ReturnType<typeof setTimeout>;
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        queue.unshift(batch);
        const retryAfter = err.body.retryAfterSeconds ?? 1;
        queueCountdown = retryAfter;
        const queuedCount = queue.reduce((n, q) => n + q.ops.length, 0);
        announce('Sync queue', `Waiting ${queueCountdown} s to send ${queuedCount} queued edits.`);
        rerender();
        queueTimer = setInterval(() => {
          queueCountdown -= 1;
          if (queueCountdown <= 0) {
            if (queueTimer) clearInterval(queueTimer);
            queueTimer = null;
            const count = queue.reduce((n, q) => n + q.ops.length, 0);
            announce('Sync queue', `Waiting 0 s to send ${count} queued edits.`);
            void flushQueue();
          } else {
            const count = queue.reduce((n, q) => n + q.ops.length, 0);
            announce('Sync queue', `Waiting ${queueCountdown} s to send ${count} queued edits.`);
          }
        }, 1000) as unknown as ReturnType<typeof setTimeout>;
      } else if (err instanceof ApiError && (err.status === 403 || err.status === 422)) {
        announce('Entry', `That edit was refused: ${err.body.message}`);
        queueTimer = null;
        await loadVoice();
      } else {
        queue.unshift(batch);
        announce('Sync queue', `Offline — ${queue.reduce((n, q) => n + q.ops.length, 0)} edits queued. Retrying.`);
        queueTimer = setTimeout(() => void flushQueue(), 3000) as unknown as ReturnType<typeof setTimeout>;
      }
    }
  }

  function opSummary(op: Record<string, unknown>): string {
    const type = op['type'] as string;
    if (type === 'insert') {
      const event = op['event'] as { kind: string; pitch?: { step: string; alter: number; octave: number } | null; duration: string; dots: number };
      return event.kind === 'note' ? 'Note added.' : 'Rest added.';
    }
    if (type === 'delete') return 'Note deleted.';
    const field = op['field'] as string;
    return `Changed ${field}.`;
  }

  // ---- holds ----

  async function holdSelected(): Promise<void> {
    if (selectedStaves.length === 0) return;
    try {
      if (!connectionId) {
        announce('Holds', 'Reconnecting — try the hold again in a moment.');
        return;
      }
      const res = await api.post<{ holds: Hold[] }>(`/api/scores/${props.scoreId}/holds`, {
        staffIds: selectedStaves,
        connectionId,
      });
      holds = res.holds;
      announce('Holds', `Holding ${staffNames(selectedStaves)}.`);
      rerender();
    } catch (err) {
      if (err instanceof ApiError && err.status === 423) {
        const holder = err.body.heldBy;
        announce('Holds', `${holder?.name ?? 'Someone'} is holding ${staffNames(err.body.staffIds ?? [])}. Your notes still save.`);
      } else if (err instanceof ApiError && err.status === 409) {
        announce('Holds', 'Reconnecting — try the hold again in a moment.');
      } else if (err instanceof ApiError) {
        announce('Holds', err.body.message);
      }
    }
  }

  async function releaseHolds(): Promise<void> {
    const mine = holds.filter((h) => h.holder.id === me?.collaborator.id).map((h) => h.staffId);
    if (mine.length === 0) return;
    await api.del(`/api/scores/${props.scoreId}/holds?staffIds=${mine.join(',')}`);
    announce('Holds', `Released ${staffNames(mine)}.`);
    await loadHolds();
  }

  function staffNames(ids: string[]): string {
    return ids.map((id) => score?.staves.find((s) => s.id === id)?.name ?? id).join(', ');
  }

  // ---- rendering ----

  function rerender(): void {
    const host = document.getElementById('workspace-host');
    if (!host) return;
    const hadEditorFocus = document.activeElement?.getAttribute('aria-label') === 'Score editor';
    host.replaceChildren(render(body()));
    editorRef.current?.attach();
    editorRef.current?.bindClick();
    helixRef.current?.attach();
    if (hadEditorFocus) {
      const editor = document.querySelector<HTMLElement>('[aria-label="Score editor"]');
      editor?.focus();
    }
  }

  function partStatusWord(status: Part['status']): string {
    switch (status) {
      case 'draft': return 'Draft';
      case 'engraving': return 'Engraving';
      case 'rendering': return 'Rendering';
      case 'ready': return 'Ready';
      case 'pdf_pending': return 'PDF pending';
    }
  }

  function chipClass(part: Part): string {
    if (part.status === 'ready') return 'ready';
    if (part.status === 'pdf_pending') return 'pending';
    if (part.lastError) return 'error';
    return '';
  }

  function partStatusAnnouncement(part: Part): string {
    if (part.status === 'ready') return `${part.name} PDF ready.`;
    if (part.status === 'engraving') return `Engraving ${part.name}…`;
    if (part.status === 'rendering') return `Rendering ${part.name} PDF…`;
    if (part.status === 'pdf_pending') {
      return `${part.name} PDF pending: the renderer is unavailable. The preview pages are ready.`;
    }
    return `${part.name} is a draft.`;
  }

  function body(): VNode {
    const children: (VNode | string | null)[] = [topRail()];
    if (!live) {
      children.push({
        type: 'div',
        props: { class: 'sync-banner', role: 'status' },
        children: ['Live sync paused. Your edits are saved and reach others within 10 seconds.'],
      });
    }
    children.push(mainArea());
    if (narrow) {
      // on small screens the note pad sits above the bottom-sheet handle
      children.push(notePadIfNarrow());
    }
    children.push(toolsRail());
    return { type: '#fragment', props: {}, children };
  }

  function notePadIfNarrow(): VNode | null {
    if (!narrow) return null;
    return {
      type: 'div',
      props: { class: 'note-pad', role: 'toolbar', 'aria-label': 'Note pad' },
      children: notePadButtons(),
    };
  }

  function topRail(): VNode {
    const viewRadios: (VNode | null)[] = [];
    if (helixAvailable && !narrow) {
      viewRadios.push({
        type: 'div',
        props: { class: `view-switch`, role: 'radiogroup', 'aria-label': 'View' },
        children: [
          {
            type: 'label',
            props: { class: view === 'helix' ? 'checked' : '' },
            children: [
              {
                type: 'input',
                props: {
                  type: 'radio',
                  name: 'view',
                  value: 'helix',
                  checked: view === 'helix',
                  onchange: () => {
                    view = 'helix';
                    announce('View', 'Helix view.');
                    rerender();
                  },
                },
              },
              ['Helix'],
            ],
          },
          {
            type: 'label',
            props: { class: view === 'pages' ? 'checked' : '' },
            children: [
              {
                type: 'input',
                props: {
                  type: 'radio',
                  name: 'view',
                  value: 'pages',
                  checked: view === 'pages',
                  onchange: () => {
                    view = 'pages';
                    announce('View', 'Pages view.');
                    rerender();
                  },
                },
              },
              ['Pages'],
            ],
          },
        ],
      });
    }

    const composerButtons: (VNode | null)[] = isComposer()
      ? [
          {
            type: 'button',
            props: { class: 'rail-btn', onclick: () => openDialog('add-staff') },
            children: ['Add staff'],
          },
          {
            type: 'button',
            props: { class: 'rail-btn', onclick: () => openDialog('add-measures') },
            children: ['Add measures'],
          },
        ]
      : [];

    return {
      type: 'header',
      props: { class: 'top-rail night-surface' },
      children: [
        { type: 'h1', props: {}, children: [score?.title ?? 'Fairline'] },
        {
          type: 'div',
          props: { class: 'rail-group' },
          children: [
            {
              type: 'button',
              props: {
                class: 'rail-btn',
                'aria-label': playing ? 'Stop' : 'Play',
                onclick: () => togglePlay(),
              },
              children: [playing ? 'Stop' : 'Play'],
            },
            {
              type: 'span',
              props: { class: 'transport-readout', role: 'timer', 'aria-label': 'Playback position' },
              children: [`Measure ${playMeasure} · Beat ${playBeat}`],
            },
          ],
        },
        viewRadios,
        {
          type: 'button',
          props: { class: 'rail-btn', onclick: () => openDialog('extract', { partId: entryPartOf(entryStaffId) }) },
          children: ['Extract part…'],
        },
        ...composerButtons,
        {
          type: 'ul',
          props: { class: 'rail-group', 'aria-label': 'Collaborators here', role: 'list', style: 'list-style:none;display:flex;gap:6px;' },
          children: presence.map((entry) => ({
            type: 'li',
            props: { class: 'presence-chip' },
            children: [`${entry.name} · ${roleWord(entry.role)}`],
          })),
        },
        { type: 'span', props: { class: 'rail-spacer' } },
        {
          type: 'span',
          props: { class: `sync-chip ${live ? '' : 'paused'}`, role: 'status', 'aria-label': 'Live sync' },
          children: [live ? 'Live' : 'Live sync paused. Your edits are saved and reach others within 10 seconds.'],
        },
      ],
    };
  }

  function entryPartOf(staffId: string | null): string | undefined {
    if (!staffId) return undefined;
    const staff = score?.staves.find((s) => s.id === staffId);
    return staff?.partId;
  }

  function togglePlay(): void {
    if (playing) {
      playbackRef.current?.stop();
      playing = false;
      rerender();
      return;
    }
    playing = true;
    rerender();
    playbackRef.current = new Playback({
      score: score!,
      voiceProvider: (staffId, voice) => api.get<{ events: VoiceEvent[] }>(`/api/scores/${props.scoreId}/staves/${staffId}/voices/${voice}`),
      bankProvider: () => banks,
      selfStaffIds: me?.collaborator.staffIds ?? [],
      role: me?.collaborator.role ?? 'player',
      startMeasure: caretIndex >= 0 && voiceEvents[caretIndex] ? voiceEvents[caretIndex].measure : 1,
      onPosition: (measure, beat) => {
        playMeasure = measure;
        playBeat = beat;
        const readout = document.querySelector('[aria-label="Playback position"]');
        if (readout) readout.textContent = `Measure ${measure} · Beat ${beat}`;
      },
      onEnd: () => {
        playing = false;
        rerender();
      },
    });
    playbackRef.current.start();
  }

  function mainArea(): VNode {
    if (view === 'helix' && helixAvailable && !narrow) {
      const helix = new HelixView({ systems, reducedMotion, title: score?.title ?? '', onExtract: () => openDialog('extract', { partId: entryPartOf(entryStaffId) }) });
      helixRef.current = helix;
      return {
        type: 'div',
        props: { class: 'workspace' },
        children: [
          {
            type: 'main',
            props: { class: 'paper-column', style: 'padding:0;' },
            children: [helix.node()],
          },
        ],
      };
    }
    if (narrow) {
      return {
        type: 'div',
        props: { class: 'workspace', style: 'flex-direction:column;' },
        children: [
          {
            type: 'main',
            props: { class: 'system-strip', role: 'region', 'aria-label': 'System strip' },
            children: systems.map((sys) => ({
              type: 'div',
              props: { role: 'group', 'aria-label': `System ${sys.index}, measures ${sys.firstMeasure}–${sys.lastMeasure}` },
              children: [{ type: 'div', props: { dangerouslySetInnerHTML: { __html: sys.svg } } }],
            })),
          },
        ],
      };
    }
    const editor = new ScoreEditor({
      systems,
      events: voiceEvents,
      entryStaffId,
      entryVoice,
      selectedStaves,
      onCaretMove: (index) => {
        caretIndex = index;
        const ev = voiceEvents[index];
        if (ev) lastHeartbeatCursor = { staffId: entryStaffId!, measure: ev.measure, beat: ev.beat };
      },
      onNoteClick: (index) => {
        caretIndex = index;
        rerender();
      },
    });
    editorRef.current = editor;
    return {
      type: 'div',
      props: { class: 'workspace' },
      children: [
        {
          type: 'aside',
          props: { class: 'staves-list', role: 'listbox', 'aria-label': 'Staves', 'aria-multiselectable': 'true' },
          children: stavesOptions(),
        },
        {
          type: 'main',
          props: { class: 'paper-column' },
          children: [
            {
              type: 'div',
              props: { class: 'score-page' },
              children: [editor.node()],
            },
            engravingCursor
              ? {
                  type: 'button',
                  props: { class: 'rail-btn', style: 'align-self:center;margin:6px;', onclick: () => void loadMoreSystems() },
                  children: ['More systems'],
                }
              : null,
          ],
        },
      ],
    };
  }

  function notePadButtons(): (VNode | string | null)[] {
    const press = (fn: () => void) => () => fn();
    return [
      ...['C', 'D', 'E', 'F', 'G', 'A', 'B'].map((letter) => ({
        type: 'button',
        props: { onclick: press(() => insertPitch(letter)) },
        children: [letter],
      })),
      { type: 'button', props: { onclick: press(() => insertRest()) }, children: ['Rest'] },
      { type: 'button', props: { onclick: press(() => stepDuration(-1)) }, children: ['Shorter'] },
      { type: 'button', props: { onclick: press(() => stepDuration(1)) }, children: ['Longer'] },
      { type: 'button', props: { onclick: press(() => deleteCurrent()) }, children: ['Delete'] },
      { type: 'button', props: { onclick: press(() => openDialog('text', { targetIndex: caretIndex })) }, children: ['Add text'] },
    ];
  }

  function stavesOptions(): (VNode | string | null)[] {
    return (score?.staves ?? []).map((staff) => {
      const selected = selectedStaves.includes(staff.id);
      const isEntry = entryStaffId === staff.id;
      const heldBy = holds.find((h) => h.staffId === staff.id);
      return {
        type: 'button',
        props: {
          class: `staff-option ${selected ? 'selected' : ''} ${isEntry ? 'entry' : ''} ${heldBy ? 'held' : ''}`,
          role: 'option',
          'aria-selected': selected ? 'true' : 'false',
          onclick: () => {
            entryStaffId = staff.id;
            selectedStaves = [staff.id];
            announce('Entry', `Entering on ${staff.name}, voice ${entryVoice}.`);
            void loadVoice();
            rerender();
          },
        },
        children: [staff.name],
      };
    });
  }

  function toolsRail(): VNode {
    const tabs = ['Parts', 'History', 'Holds', 'Sample banks', 'People'];
    if (medium || narrow) {
      // the tools rail becomes a bottom sheet at 768–1024 px wide
      const handleLabel = tabs.find((t) => t.toLowerCase().replace(' ', '-') === activeTab) ?? 'Parts';
      return {
        type: '#fragment',
        props: {},
        children: [
          {
            type: 'button',
            props: {
              class: 'bottom-sheet-handle',
              'aria-label': `Score tools: ${handleLabel}. ${sheetOpen ? 'Close' : 'Open'}`,
              'aria-expanded': sheetOpen ? 'true' : 'false',
              onclick: () => {
                sheetOpen = !sheetOpen;
                rerender();
              },
            },
            children: [`${handleLabel} ${sheetOpen ? '— close' : '— open'}`],
          },
          sheetOpen
            ? {
                type: 'div',
                props: { class: 'bottom-sheet', role: 'complementary', 'aria-label': 'Score tools' },
                children: [
                  narrow
                    ? {
                        type: 'div',
                        props: { style: 'margin-bottom:12px;' },
                        children: [
                          { type: 'p', props: { style: 'font-size:12.5px;color:#a89c8a;margin-bottom:6px;' }, children: ['Staves'] },
                          {
                            type: 'div',
                            props: { role: 'listbox', 'aria-label': 'Staves', 'aria-multiselectable': 'true' },
                            children: stavesOptions(),
                          },
                        ],
                      }
                    : null,
                  {
                    type: 'div',
                    props: { class: 'tab-row', role: 'tablist', 'aria-label': 'Score tools' },
                    children: tabs.map((name) => ({
                      type: 'button',
                      props: {
                        role: 'tab',
                        'aria-selected': activeTab === name.toLowerCase().replace(' ', '-') ? 'true' : 'false',
                        onclick: () => {
                          activeTab = name.toLowerCase().replace(' ', '-');
                          rerender();
                        },
                      },
                      children: [name],
                    })),
                  },
                  { type: 'div', props: { class: 'tools-body', style: 'padding:0;' }, children: [tabPanel()] },
                ],
              }
            : null,
        ],
      };
    }
    return {
      type: 'aside',
      props: {
        class: `tools-rail night-surface ${toolsCollapsed ? 'collapsed' : ''}`,
        'aria-label': 'Score tools',
        role: 'complementary',
      },
      children: [
        {
          type: 'div',
          props: { class: 'tools-head' },
          children: [
            { type: 'span', props: {}, children: [] },
            {
              type: 'button',
              props: {
                class: 'rail-btn',
                'aria-label': toolsCollapsed ? 'Show tools' : 'Hide tools',
                onclick: () => {
                  toolsCollapsed = !toolsCollapsed;
                  rerender();
                },
              },
              children: [toolsCollapsed ? 'Show tools' : 'Hide tools'],
            },
          ],
        },
        {
          type: 'div',
          props: { class: 'tab-row', role: 'tablist', 'aria-label': 'Score tools' },
          children: tabs.map((name) => ({
            type: 'button',
            props: {
              role: 'tab',
              'aria-selected': activeTab === name.toLowerCase().replace(' ', '-') ? 'true' : 'false',
              onclick: () => {
                activeTab = name.toLowerCase().replace(' ', '-');
                rerender();
              },
            },
            children: [name],
          })),
        },
        { type: 'div', props: { class: 'tools-body' }, children: [tabPanel()] },
      ],
    };
  }

  function tabPanel(): VNode {
    switch (activeTab) {
      case 'parts': return partsPanel();
      case 'history': return historyPanel();
      case 'holds': return holdsPanel();
      case 'sample-banks': return banksPanel();
      case 'people': return peoplePanel();
      default: return partsPanel();
    }
  }

  function partsPanel(): VNode {
    return {
      type: 'div',
      props: {},
      children: [
        {
          type: 'ul',
          props: { class: 'panel-list', 'aria-label': 'Parts', role: 'list' },
          children: parts.map((part) => ({
            type: 'li',
            props: {},
            children: [
              { type: 'span', props: {}, children: [part.name] },
              {
                type: 'span',
                props: { class: `status-chip ${chipClass(part)}`, role: 'status' },
                children: [`${part.name} PDF status: ${part.stale ? `${partStatusWord(part.status)} · Score changed since this PDF` : partStatusWord(part.status)}`],
              },
              {
                type: 'button',
                props: { class: 'rail-btn small', onclick: () => props.onOpenPart(part.id) },
                children: [`Open ${part.name}`],
              },
              part.status === 'ready'
                ? {
                    type: 'a',
                    props: {
                      class: 'panel-link',
                      href: `/api/scores/${props.scoreId}/parts/${part.id}/pdf?token=${encodeURIComponent(sessionStorage.getItem('fairline-seat') ?? localStorage.getItem('fairline-seat') ?? '')}`,
                      download: '',
                    },
                    children: [`Download ${part.name} PDF`],
                  }
                : null,
            ],
          })),
        },
      ],
    };
  }

  function historyPanel(): VNode {
    const options = [
      ['All changes', ''],
      ['Notes added', 'type=insert'],
      ['Notes deleted', 'type=delete'],
      ['Pitch and spelling', 'field=pitch'],
      ['Ties', 'field=tie'],
      ['Dynamics', 'field=dynamic,dynamicPlacement'],
      ['Text', 'field=text'],
    ];
    return {
      type: 'div',
      props: {},
      children: [
        {
          type: 'div',
          props: { class: 'field-row' },
          children: [
            { type: 'label', props: { for: 'history-show' }, children: ['Show'] },
            {
              type: 'select',
              props: {
                id: 'history-show',
                'aria-label': 'Show',
                onchange: (e: Event) => {
                  historyFilter = (e.target as HTMLSelectElement).value;
                  void loadHistory(true);
                },
              },
              children: options.map(([label, value]) => ({
                type: 'option',
                props: { value: value ?? '', selected: historyFilter === value },
                children: [label],
              })),
            },
          ],
        },
        pendingNewCount > 0
          ? {
              type: 'button',
              props: {
                class: 'newer-changes',
                onclick: () => void loadHistory(true),
              },
              children: [`Show ${pendingNewCount} new changes`],
            }
          : null,
        {
          type: 'div',
          props: { class: 'history-feed', role: 'feed', 'aria-label': 'Operation history' },
          children: historyEntries.map((entry) => ({
            type: 'article',
            props: {},
            children: [
              `${entry.author.name} · ${entry.summary} · ${entry.staffName}, measure ${entry.measure}, beat ${entry.beat} · `,
              {
                type: 'time',
                props: {},
                children: [formatUtcTime(entry.at)],
              },
            ],
          })),
        },
        {
          type: 'button',
          props: {
            class: 'rail-btn',
            onclick: () => void loadHistory(false),
          },
          children: ['Load older changes'],
        },
      ],
    };
  }

  function holdsPanel(): VNode {
    const mine = holds.filter((h) => h.holder.id === me?.collaborator.id);
    return {
      type: 'div',
      props: {},
      children: [
        {
          type: 'div',
          props: { style: 'display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;' },
          children: [
            { type: 'button', props: { class: 'rail-btn', onclick: () => void holdSelected() }, children: ['Hold selected staves'] },
            { type: 'button', props: { class: 'rail-btn', onclick: () => void releaseHolds() }, children: ['Release my holds'] },
            { type: 'button', props: { class: 'rail-btn', onclick: () => openDialog('staff-settings') }, children: ['Staff settings'] },
          ],
        },
        mine.length > 0
          ? {
              type: 'p',
              props: { class: 'hold-bracket' },
              children: [`⌐ You hold ${staffNames(mine.map((h) => h.staffId))}`],
            }
          : null,
        {
          type: 'ul',
          props: { class: 'panel-list', 'aria-label': 'Current holds', role: 'list' },
          children: holds.map((hold) => ({
            type: 'li',
            props: {},
            children: [`${score?.staves.find((s) => s.id === hold.staffId)?.name ?? hold.staffId} — ${hold.holder.name}`],
          })),
        },
      ],
    };
  }

  function banksPanel(): VNode {
    const fileInputRef: { current: HTMLInputElement | null } = { current: null };
    return {
      type: 'div',
      props: {},
      children: [
        isComposer()
          ? {
              type: 'form',
              props: {
                onsubmit: (e: Event) => {
                  e.preventDefault();
                  void uploadBank(fileInputRef.current?.files?.[0] ?? null);
                },
              },
              children: [
                {
                  type: 'div',
                  props: { class: 'field-row' },
                  children: [
                    { type: 'label', props: { for: 'bank-staff' }, children: ['Staff for bank'] },
                    {
                      type: 'select',
                      props: { id: 'bank-staff', 'aria-label': 'Staff for bank' },
                      children: (score?.staves ?? []).map((s) => ({
                        type: 'option',
                        props: { value: s.id },
                        children: [s.name],
                      })),
                    },
                  ],
                },
                {
                  type: 'div',
                  props: { class: 'field-row' },
                  children: [
                    { type: 'label', props: { for: 'bank-root' }, children: ['Root pitch'] },
                    { type: 'input', props: { id: 'bank-root', 'aria-label': 'Root pitch', value: 'A4' } },
                  ],
                },
                {
                  type: 'div',
                  props: { class: 'field-row' },
                  children: [
                    { type: 'label', props: { for: 'bank-file' }, children: ['Sample bank file'] },
                    { type: 'input', props: { id: 'bank-file', type: 'file', 'aria-label': 'Sample bank file' } },
                  ],
                },
                { type: 'button', props: { class: 'rail-btn', type: 'submit' }, children: ['Upload sample bank'] },
              ],
            }
          : null,
        {
          type: 'ul',
          props: { class: 'panel-list', 'aria-label': 'Sample banks', role: 'list' },
          children: banks.map((bank) => ({
            type: 'li',
            props: {},
            children: [
              `${bank.fileName} · ${score?.staves.find((s) => s.id === bank.staffId)?.name ?? bank.staffId} · ${bank.status === 'loaded' ? 'Loaded' : 'Uploading…'}`,
            ],
          })),
        },
      ],
    };
  }

  async function uploadBank(file: File | null): Promise<void> {
    if (!file) return;
    const staffId = (document.getElementById('bank-staff') as HTMLSelectElement | null)?.value ?? score?.staves[0]?.id;
    const root = (document.getElementById('bank-root') as HTMLInputElement | null)?.value ?? 'A4';
    announce('Sample banks', `Uploading ${file.name}…`);
    rerender();
    try {
      const buffer = await file.arrayBuffer();
      const res = await fetch(
        `/api/scores/${props.scoreId}/banks?fileName=${encodeURIComponent(file.name)}&staffId=${encodeURIComponent(staffId ?? '')}&root=${encodeURIComponent(root)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            Authorization: `Bearer ${sessionStorage.getItem('fairline-seat') ?? localStorage.getItem('fairline-seat')}`,
          },
          body: buffer,
        },
      );
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        announce('Sample banks', `${file.name} was refused: ${body.message ?? 'Upload failed.'}`);
        rerender();
        return;
      }
      await loadBanks();
      announce('Sample banks', `${file.name} loaded.`);
      rerender();
    } catch {
      announce('Sample banks', `${file.name} was refused: Upload failed.`);
      rerender();
    }
  }

  function peoplePanel(): VNode {
    return {
      type: 'div',
      props: {},
      children: [
        isComposer()
          ? {
              type: 'button',
              props: { class: 'rail-btn', style: 'margin-bottom:12px;', onclick: () => openDialog('invite') },
              children: ['Invite collaborator'],
            }
          : null,
        {
          type: 'ul',
          props: { class: 'panel-list', 'aria-label': 'People', role: 'list' },
          children: collaborators.map((collab) => {
            const statusWord = collab.status === 'invited' ? 'Invited' : collab.status === 'active' ? 'Active' : 'Removed';
            return {
              type: 'li',
              props: {},
              children: [
                `${collab.name} · ${roleWord(collab.role)} · ${statusWord}`,
                isComposer() && collab.status === 'active' && collab.role === 'player'
                  ? {
                      type: 'button',
                      props: { class: 'rail-btn small', onclick: () => openDialog('staves-for', { collaborator: collab }) },
                      children: [`Change staves for ${collab.name}`],
                    }
                  : null,
                isComposer() && collab.role !== 'composer' && collab.status !== 'removed'
                  ? {
                      type: 'button',
                      props: { class: 'rail-btn small', onclick: () => openDialog('remove', { collaborator: collab }) },
                      children: [`Remove ${collab.name}`],
                    }
                  : null,
              ],
            };
          }),
        },
      ],
    };
  }

  // ---- dialogs ----

  function openDialog(name: string, params?: Record<string, unknown>): void {
    const opener = document.activeElement as HTMLElement | null;
    const handle = dialogs({
      name,
      params: {
        ...(params ?? {}),
        score,
        parts,
        me: me?.collaborator ?? null,
        entryStaffId,
        selectedStaves,
        canEditLayout: canEditLayout(),
        onAnnounce: (region: string, text: string) => announce(region, text),
        onExtractPart: (partId: string) => void extractPart(partId),
        onAddStaff: (payload: { name: string; clef: string; transpose: { diatonic: number; chromatic: number }; partId: string | null }) => void addStaff(payload),
        onAddMeasures: (payload: { count: number; timeSignature: { beats: number; beatType: number } | null }) => void addMeasures(payload),
        onSaveStaff: (payload: { name: string; clef: string; transpose: { diatonic: number; chromatic: number } }) => void saveStaff(payload),
        onInvite: (payload: { name: string; role: string; staffIds: string[] }) => void createInvite(payload),
        onRemoveCollaborator: (collaboratorId: string) => void removeCollaborator(collaboratorId),
        onChangeStaves: (collaboratorId: string, staffIds: string[]) => void changeStaves(collaboratorId, staffIds),
        onSetText: (text: string) => void setText(text),
        onSaved: () => rerender(),
      },
    });
    handle?.open(opener);
  }

  async function extractPart(partId: string): Promise<void> {
    const part = parts.find((p) => p.id === partId);
    if (!part) return;
    announce('Parts', `Engraving ${part.name}…`);
    rerender();
    try {
      await api.post(`/api/scores/${props.scoreId}/parts/${partId}/extract`, {});
      announce('Parts', `Rendering ${part.name} PDF…`);
      // in Helix view the peel plays while the server engraves
      if (view === 'helix' && helixAvailable && !narrow) {
        startPeel(part);
      }
      // status arrives through the live part message
    } catch (err) {
      if (err instanceof ApiError) announce('Parts', err.body.message);
    }
    rerender();
  }

  function startPeel(part: Part): void {
    const host = document.querySelector('.paper-column');
    if (!host) return;
    const peel = new HelixPeel({
      partName: part.name,
      scoreTitle: score?.title ?? '',
      partId: part.id,
      reducedMotion,
      onSettled: () => undefined,
      onStatusChip: () => undefined,
    });
    peelRef.current = peel;
    host.appendChild(render(peel.node()) as HTMLElement);
  }

  async function addStaff(payload: { name: string; clef: string; transpose: { diatonic: number; chromatic: number }; partId: string | null }): Promise<void> {
    try {
      await api.post(`/api/scores/${props.scoreId}/staves`, payload);
      announce('Score changes', `${payload.name} added.`);
      await loadScore();
    } catch (err) {
      if (err instanceof ApiError) announce('Score changes', err.body.message);
    }
  }

  async function addMeasures(payload: { count: number; timeSignature: { beats: number; beatType: number } | null }): Promise<void> {
    try {
      const res = await api.post<{ measureCount: number }>(`/api/scores/${props.scoreId}/measures`, payload);
      if (score) score.measureCount = res.measureCount;
      announce('Score changes', `${payload.count} measures added. The score now has ${res.measureCount} measures.`);
      await loadScore();
    } catch (err) {
      if (err instanceof ApiError) announce('Score changes', err.body.message);
    }
  }

  async function saveStaff(payload: { name: string; clef: string; transpose: { diatonic: number; chromatic: number } }): Promise<void> {
    if (!entryStaffId) return;
    try {
      await api.patch(`/api/scores/${props.scoreId}/staves/${entryStaffId}`, payload);
      announce('Score changes', `${payload.name} saved.`);
      await loadScore();
    } catch (err) {
      if (err instanceof ApiError) announce('Score changes', err.body.message);
    }
  }

  async function createInvite(payload: { name: string; role: string; staffIds: string[] }): Promise<void> {
    try {
      await api.post(`/api/scores/${props.scoreId}/invites`, payload);
      announce('Team', `Invite created for ${payload.name}.`);
      await loadCollaborators();
    } catch (err) {
      if (err instanceof ApiError) announce('Team', err.body.message);
    }
  }

  async function removeCollaborator(collaboratorId: string): Promise<void> {
    try {
      const target = collaborators.find((c) => c.id === collaboratorId);
      await api.del(`/api/scores/${props.scoreId}/collaborators/${collaboratorId}`);
      announce('Team', `${target?.name ?? 'They'} removed.`);
      await loadCollaborators();
    } catch (err) {
      if (err instanceof ApiError) announce('Team', err.body.message);
    }
  }

  async function changeStaves(collaboratorId: string, staffIds: string[]): Promise<void> {
    try {
      const target = collaborators.find((c) => c.id === collaboratorId);
      await api.patch(`/api/scores/${props.scoreId}/collaborators/${collaboratorId}`, { staffIds });
      announce('Team', `Staves updated for ${target?.name ?? 'them'}.`);
      await loadCollaborators();
    } catch (err) {
      if (err instanceof ApiError) announce('Team', err.body.message);
    }
  }

  async function setText(text: string): Promise<void> {
    const target = voiceEvents[caretIndex];
    if (!target || target.kind !== 'note') return;
    enqueueOp({
      type: 'set',
      staffId: entryStaffId,
      voice: entryVoice,
      target: target.id,
      field: 'text',
      value: text,
    });
    announce('Text', 'Text saved.');
    await loadVoice();
  }

  // ---- note entry ----

  function insertPitch(letter: string): void {
    const target = previousNoteForOctave();
    const pitch = nearestPitchOfLetter(letter, target);
    insertEvent({ kind: 'note', pitch, duration: chosenDuration, dots: chosenDots });
  }

  function insertRest(): void {
    insertEvent({ kind: 'rest', duration: chosenDuration, dots: chosenDots });
  }

  function previousNoteForOctave(): VoiceEvent | null {
    for (let i = Math.min(caretIndex, voiceEvents.length - 1); i >= 0; i--) {
      if (voiceEvents[i].kind === 'note') return voiceEvents[i];
    }
    return null;
  }

  function nearestPitchOfLetter(letter: string, previous: VoiceEvent | null): { step: string; alter: number; octave: number } {
    const staff = score?.staves.find((s) => s.id === entryStaffId);
    const clef = staff?.clef ?? 'treble';
    const reference = previous?.pitch ?? middleLine(clef);
    let best = { step: letter, alter: 0, octave: 4 };
    let bestDist = Infinity;
    for (let octave = 0; octave <= 9; octave++) {
      const candidate = { step: letter, alter: 0, octave };
      const dist = Math.abs(diatonic(candidate) - diatonic(reference));
      if (dist < bestDist) {
        bestDist = dist;
        best = candidate;
      }
    }
    return best;
  }

  function middleLine(clef: string): { step: string; alter: number; octave: number } {
    switch (clef) {
      case 'treble':
      case 'percussion': return { step: 'B', alter: 0, octave: 4 };
      case 'alto': return { step: 'C', alter: 0, octave: 4 };
      case 'tenor': return { step: 'A', alter: 0, octave: 3 };
      default: return { step: 'D', alter: 0, octave: 3 };
    }
  }

  function diatonic(p: { step: string; octave: number }): number {
    const order = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
    return p.octave * 7 + order.indexOf(p.step);
  }


  function insertEvent(event: { kind: string; pitch?: { step: string; alter: number; octave: number }; duration: string; dots: number }): void {
    const after = caretIndex >= 0 && voiceEvents[caretIndex] ? voiceEvents[caretIndex].id : null;
    enqueueOp({
      type: 'insert',
      staffId: entryStaffId,
      voice: entryVoice,
      after,
      event,
    });
    // optimistic local append
    const optimistic: VoiceEvent = {
      id: { lamport, site: me!.collaborator.id },
      kind: event.kind as 'note' | 'rest',
      pitch: event.pitch ?? null,
      duration: event.duration,
      dots: event.dots,
      ticks: durationTicks(event.duration, event.dots),
      tie: false,
      dynamic: null,
      dynamicPlacement: 'below',
      text: null,
      measure: 0,
      beat: 0,
      pieces: [],
    };
    voiceEvents = [...voiceEvents.slice(0, caretIndex + 1), optimistic, ...voiceEvents.slice(caretIndex + 1)];
    caretIndex += 1;
    const insertedId = optimistic.id;
    editorRef.current?.setEvents(voiceEvents);
    // the position arrives with the next voice load; announce then
    rerender();
    void loadVoice().then(() => {
      const ev = voiceEvents.find((candidate) => candidate.id.lamport === insertedId.lamport && candidate.id.site === insertedId.site);
      if (ev) {
        const durationWord = formatDurationWord(ev.duration, ev.dots, ev.kind === 'rest');
        const base =
          ev.kind === 'note' && ev.pitch
            ? `${formatPitchText(ev.pitch)} ${durationWord}, measure ${ev.measure}, beat ${ev.beat}.`
            : `${durationWord} rest, measure ${ev.measure}, beat ${ev.beat}.`;
        const crossed = ev.pieces.length > 1;
        const extra = crossed ? ` Tied across the barline into measure ${ev.pieces[ev.pieces.length - 1].measure}.` : '';
        announce('Entry', base + extra);
      }
    });
  }

  function deleteCurrent(): void {
    const target = voiceEvents[caretIndex];
    if (!target) return;
    const durationWord = formatDurationWord(target.duration, target.dots, target.kind === 'rest');
    enqueueOp({
      type: 'delete',
      staffId: entryStaffId,
      voice: entryVoice,
      target: target.id,
    });
    voiceEvents = voiceEvents.filter((_, i) => i !== caretIndex);
    caretIndex -= 1;
    editorRef.current?.setEvents(voiceEvents);
    announce(
      'Entry',
      target.kind === 'note' && target.pitch
        ? `Deleted ${formatPitchText(target.pitch)} ${durationWord}.`
        : `Deleted ${durationWord} rest.`,
    );
    void loadVoice();
    rerender();
  }

  function moveCurrentSemitone(semitones: number): void {
    const target = voiceEvents[caretIndex];
    if (!target || target.kind !== 'note' || !target.pitch) return;
    const next = semitoneMove(target.pitch, semitones);
    enqueueOp({
      type: 'set',
      staffId: entryStaffId,
      voice: entryVoice,
      target: target.id,
      field: 'pitch',
      value: next,
    });
    target.pitch = next;
    editorRef.current?.setEvents(voiceEvents);
    announce('Entry', `Now ${formatPitchText(next)}.`);
    void loadVoice();
  }

  function moveCurrentOctave(octaves: number): void {
    const target = voiceEvents[caretIndex];
    if (!target || target.kind !== 'note' || !target.pitch) return;
    const next = { ...target.pitch, octave: target.pitch.octave + octaves };
    enqueueOp({
      type: 'set',
      staffId: entryStaffId,
      voice: entryVoice,
      target: target.id,
      field: 'pitch',
      value: next,
    });
    target.pitch = next;
    editorRef.current?.setEvents(voiceEvents);
    announce('Entry', `Now ${formatPitchText(next)}.`);
    void loadVoice();
  }

  function respellCurrent(): void {
    const target = voiceEvents[caretIndex];
    if (!target || target.kind !== 'note' || !target.pitch) return;
    const next = respell(target.pitch);
    enqueueOp({
      type: 'set',
      staffId: entryStaffId,
      voice: entryVoice,
      target: target.id,
      field: 'pitch',
      value: next,
    });
    target.pitch = next;
    editorRef.current?.setEvents(voiceEvents);
    announce('Entry', `Respelled as ${formatPitchText(next)}.`);
    void loadVoice();
  }

  function toggleTie(): void {
    const target = voiceEvents[caretIndex];
    if (!target || target.kind !== 'note') return;
    const value = !target.tie;
    enqueueOp({
      type: 'set',
      staffId: entryStaffId,
      voice: entryVoice,
      target: target.id,
      field: 'tie',
      value,
    });
    target.tie = value;
    editorRef.current?.setEvents(voiceEvents);
    announce('Entry', value ? 'Tie added.' : 'Tie removed.');
    void loadVoice();
  }

  function cycleDynamic(): void {
    const target = voiceEvents[caretIndex];
    if (!target || target.kind !== 'note') return;
    const cycle = [null, 'pp', 'p', 'mp', 'mf', 'f', 'ff'];
    const index = cycle.indexOf(target.dynamic);
    const next = cycle[(index + 1) % cycle.length];
    enqueueOp({
      type: 'set',
      staffId: entryStaffId,
      voice: entryVoice,
      target: target.id,
      field: 'dynamic',
      value: next,
    });
    target.dynamic = next;
    editorRef.current?.setEvents(voiceEvents);
    announce('Entry', next ? `Dynamic ${next}.` : 'Dynamic removed.');
    void loadVoice();
  }

  function flipDynamicPlacement(): void {
    const target = voiceEvents[caretIndex];
    if (!target || target.kind !== 'note') return;
    const next = (target.dynamicPlacement ?? 'below') === 'below' ? 'above' : 'below';
    enqueueOp({
      type: 'set',
      staffId: entryStaffId,
      voice: entryVoice,
      target: target.id,
      field: 'dynamicPlacement',
      value: next,
    });
    target.dynamicPlacement = next;
    editorRef.current?.setEvents(voiceEvents);
    announce('Entry', next === 'above' ? 'Dynamic above the staff.' : 'Dynamic below the staff.');
    void loadVoice();
  }

  function stepDuration(delta: number): void {
    const index = DURATION_STEP.indexOf(chosenDuration);
    const next = DURATION_STEP[Math.max(0, Math.min(DURATION_STEP.length - 1, index - delta))];
    if (next === chosenDuration) return;
    chosenDuration = next;
    announce('Entry', `${formatDurationWord(chosenDuration, 0, true)} selected.`);
    rerender();
  }

  // ---- keyboard ----

  function handleKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      (target as HTMLElement).isContentEditable
    ) {
      return;
    }
    if (document.querySelector('.dialog')) {
      // dialogs handle their own keys
      if (event.key === 'Escape') return;
      return;
    }

    const inEditor = target.getAttribute('aria-label') === 'Score editor' || target.closest?.('.score-page');
    const mod = event.ctrlKey || event.metaKey;

    // workspace shortcuts work wherever focus is
    const shortcutKey = event.key.length === 1 ? event.key.toUpperCase() : event.key;
    if (event.shiftKey && !mod && shortcutKey === 'P') {
      event.preventDefault();
      togglePlay();
      return;
    }
    if (event.shiftKey && !mod && shortcutKey === 'E') {
      event.preventDefault();
      openDialog('extract', { partId: entryPartOf(entryStaffId) });
      return;
    }
    if (event.shiftKey && !mod && shortcutKey === 'H') {
      event.preventDefault();
      void holdSelected();
      return;
    }
    if (!inEditor) return;

    if (event.shiftKey) {
      if (shortcutKey === 'D') {
        event.preventDefault();
        cycleDynamic();
        return;
      }
      if (shortcutKey === 'F') {
        event.preventDefault();
        flipDynamicPlacement();
        return;
      }
      return; // other Shift+letter keys do nothing
    }
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      if (score) {
        const index = score.staves.findIndex((s) => s.id === entryStaffId);
        const nextIndex = event.key === 'ArrowUp' ? Math.max(0, index - 1) : Math.min(score.staves.length - 1, index + 1);
        const nextStaff = score.staves[nextIndex];
        if (nextStaff) {
          entryStaffId = nextStaff.id;
          selectedStaves = [nextStaff.id];
          announce('Entry', `Entering on ${nextStaff.name}, voice ${entryVoice}.`);
          void loadVoice();
          rerender();
        }
      }
      return;
    }
    if (mod && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      moveCurrentOctave(event.key === 'ArrowUp' ? 1 : -1);
      return;
    }
    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        moveCurrentSemitone(1);
        return;
      case 'ArrowDown':
        event.preventDefault();
        moveCurrentSemitone(-1);
        return;
      case 'ArrowLeft':
        event.preventDefault();
        caretIndex = Math.max(-1, caretIndex - 1);
        editorRef.current?.setCaret(caretIndex);
        return;
      case 'ArrowRight':
        event.preventDefault();
        caretIndex = Math.min(voiceEvents.length - 1, caretIndex + 1);
        editorRef.current?.setCaret(caretIndex);
        return;
      case 'Home':
        event.preventDefault();
        caretIndex = -1;
        editorRef.current?.setCaret(caretIndex);
        return;
      case 'End':
        event.preventDefault();
        caretIndex = voiceEvents.length - 1;
        editorRef.current?.setCaret(caretIndex);
        return;
      case 'v':
      case 'V':
        entryVoice = entryVoice === 1 ? 2 : 1;
        announce('Entry', `Entering on ${staffNames([entryStaffId!])}, voice ${entryVoice}.`);
        void loadVoice();
        return;
      case 'j':
      case 'J':
        event.preventDefault();
        respellCurrent();
        return;
      case 't':
      case 'T':
        event.preventDefault();
        toggleTie();
        return;
      case 'x':
      case 'X':
        event.preventDefault();
        openDialog('text', { targetIndex: caretIndex });
        return;
      case 'r':
      case 'R':
        event.preventDefault();
        insertRest();
        return;
      case '.':
        event.preventDefault();
        chosenDots = chosenDots === 0 ? 1 : chosenDots === 1 ? 2 : 0;
        announce('Entry', chosenDots === 1 ? 'Dot on.' : chosenDots === 2 ? 'Dot on.' : 'Dot off.');
        return;
      case 'Backspace':
        event.preventDefault();
        deleteCurrent();
        return;
      case ' ':
        event.preventDefault();
        togglePlay();
        return;
    }
    if (DURATION_KEYS[event.key]) {
      event.preventDefault();
      chosenDuration = DURATION_KEYS[event.key];
      announce('Entry', `${formatDurationWord(chosenDuration, 0, true)} selected.`);
      return;
    }
    const letter = event.key.toUpperCase();
    if (letter >= 'A' && letter <= 'G' && event.key.length === 1 && !event.shiftKey) {
      event.preventDefault();
      insertPitch(letter);
    }
  }

  // ---- helpers ----

  function formatPitchText(p: { step: string; alter: number; octave: number }): string {
    const sign = p.alter === 2 ? '𝄪' : p.alter === 1 ? '♯' : p.alter === -1 ? '♭' : p.alter === -2 ? '𝄫' : '';
    return `${p.step}${sign} ${p.octave}`;
  }

  function durationTicks(duration: string, dots: number): number {
    const base: Record<string, number> = { whole: 1920, half: 960, quarter: 480, eighth: 240, '16th': 120, '32nd': 60 };
    const b = base[duration] ?? 480;
    return dots === 2 ? b * 1.75 : dots === 1 ? b * 1.5 : b;
  }

  function formatDurationWord(duration: string, dots: number, capitalise = false): string {
    const words: Record<string, string> = {
      whole: 'whole',
      half: 'half',
      quarter: 'quarter',
      eighth: 'eighth',
      '16th': 'sixteenth',
      '32nd': 'thirty-second',
    };
    const word = words[duration] ?? duration;
    const prefix = dots === 2 ? 'double-dotted ' : dots === 1 ? 'dotted ' : '';
    const text = prefix + word;
    return capitalise ? text.replace(/^./, (c) => c.toUpperCase()) : text;
  }

  function semitoneMove(p: { step: string; alter: number; octave: number }, semitones: number): { step: string; alter: number; octave: number } {
    const semis: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    const letters = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
    const midi = (p.octave + 1) * 12 + semis[p.step] + p.alter + semitones;
    const midiClass = ((midi % 12) + 12) % 12;
    const octave = Math.floor(midi / 12) - 1;
    const natural = letters.find((l) => semis[l] === midiClass);
    if (natural) return { step: natural, alter: 0, octave };
    if (semitones > 0) {
      const belowClass = (midiClass - 1 + 12) % 12;
      const below = letters.find((l) => semis[l] === belowClass) ?? 'C';
      return { step: below, alter: 1, octave };
    }
    const aboveClass = (midiClass + 1) % 12;
    const above = letters.find((l) => semis[l] === aboveClass) ?? 'B';
    return { step: above, alter: -1, octave };
  }

  function respell(p: { step: string; alter: number; octave: number }): { step: string; alter: number; octave: number } {
    const semis: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    const letters = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
    const midi = (p.octave + 1) * 12 + semis[p.step] + p.alter;
    const options: { step: string; alter: number; octave: number }[] = [];
    for (const letter of letters) {
      for (const alter of [-2, -1, 0, 1, 2]) {
        for (let octave = 0; octave <= 9; octave++) {
          if ((octave + 1) * 12 + semis[letter] + alter === midi) {
            options.push({ step: letter, alter, octave });
          }
        }
      }
    }
    options.sort((a, b) => diatonic(a) - diatonic(b) || a.alter - b.alter);
    const i = options.findIndex((o) => o.step === p.step && o.alter === p.alter && o.octave === p.octave);
    return options[(i + 1) % options.length] ?? p;
  }

  function formatUtcTime(iso: string): string {
    const date = new Date(iso);
    const hh = String(date.getUTCHours()).padStart(2, '0');
    const mm = String(date.getUTCMinutes()).padStart(2, '0');
    const ss = String(date.getUTCSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }

  // ---- boot ----

  function updateLayoutClasses(): void {
    const width = window.innerWidth;
    narrow = width < 768;
    medium = width >= 768 && width < 1024;
  }

  const node: VNode = {
    type: 'div',
    props: { id: 'workspace-host', style: 'display:flex;flex-direction:column;min-height:100%;' },
    children: [body()],
  };

  setTimeout(() => {
    updateLayoutClasses();
    window.addEventListener('resize', () => {
      updateLayoutClasses();
      rerender();
    });
    document.addEventListener('keydown', handleKeydown);
    if (!me) {
      void props
        .onNeedMe()
        .then((res) => {
          me = res;
          rerender();
          void loadScore();
          void loadCollaborators();
          void loadHolds();
          void loadPresence();
          void loadBanks();
          void loadHistory(true);
          connectWebSocket();
          startHeartbeat();
        })
        .catch((err) => handleFatal(err));
    } else {
      void loadScore();
      void loadCollaborators();
      void loadHolds();
      void loadPresence();
      void loadBanks();
      void loadHistory(true);
      connectWebSocket();
      startHeartbeat();
    }
  }, 0);

  return node;
}
