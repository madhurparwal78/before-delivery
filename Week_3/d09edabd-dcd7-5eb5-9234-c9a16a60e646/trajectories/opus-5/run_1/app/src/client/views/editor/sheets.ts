import { ApiFailure, firstFieldMessage, request } from '../../api.js';
import { copy, figures, mmss, mss, utcStamp } from '../../../shared/copy.js';
import { commandNames } from '../../../shared/copy.js';
import { parseMetresToMm } from '../../../shared/units.js';
import type {
  Debrief,
  NodeKind,
  PlaytestSession,
  Prop,
  Room,
  RoomVersion,
  TriggerNode,
} from '../../../shared/types.js';
import { button, clear, el, field } from '../../dom.js';
import { renderRoomThumbnail } from '../../stage/thumbnail.js';
import { controlsSession, hooks, isOwner, state } from './state.js';

function problemLine(): HTMLElement {
  return el('p', { class: 'field-error' });
}

/* ---------------------------------------------------------------- trigger graph */

export function triggerGraphSheet(body: HTMLElement): void {
  const list = el('ul', { class: 'list', role: 'list', 'aria-label': 'Trigger nodes' });
  const title = el('input', { type: 'text', 'aria-label': 'Node title' });
  const kind = el('select', { 'aria-label': 'Node kind' }, [
    el('option', { value: 'puzzle', text: 'puzzle' }),
    el('option', { value: 'lock', text: 'lock' }),
    el('option', { value: 'cue', text: 'cue' }),
    el('option', { value: 'exit', text: 'exit' }),
  ]);
  const prerequisites = el('div', { role: 'group', 'aria-label': 'Prerequisites' });
  const placement = el('select', { 'aria-label': 'Linked placement' });
  const answer = el('input', { type: 'text', 'aria-label': 'Answer' });
  const problem = problemLine();
  const addNode = button('Add node');
  const saveNode = button('Save node', { class: 'primary' });
  const deleteNode = button('Delete node');
  const holderLine = el('p', { class: 'field-error' });

  const paint = (): void => {
    clear(list);
    for (const node of state.nodes) {
      const card = el('li', { class: 'node-card' });
      const pick = button(node.title, {
        'aria-pressed': state.selectedNode === node.id ? 'true' : 'false',
      });
      pick.addEventListener('click', () => hooks.selectNode(node.id));
      card.append(pick, el('div', { class: 'wire', text: node.kind }));
      for (const needed of node.prerequisites) {
        const from = state.nodes.find((item) => item.id === needed);
        if (from) card.append(el('div', { class: 'wire', text: `${from.title} → ${node.title}` }));
      }
      list.append(card);
    }
    const selected = state.nodes.find((node) => node.id === state.selectedNode) ?? null;
    clear(prerequisites);
    for (const node of state.nodes) {
      if (selected !== null && node.id === selected.id) continue;
      const box = el('input', { type: 'checkbox', 'aria-label': node.title, value: node.id });
      box.checked = selected !== null && selected.prerequisites.includes(node.id);
      prerequisites.append(el('label', { class: 'check-row' }, [box, el('span', { text: node.title })]));
    }
    clear(placement);
    placement.append(el('option', { value: '', text: 'none' }));
    for (const item of state.placements) {
      placement.append(el('option', { value: item.id, text: item.label }));
    }
    const holder = selected ? state.holders.get(`node:${selected.id}`) : undefined;
    holderLine.textContent = holder === undefined ? '' : copy.nodeHeld(holder);
    const readOnly = holder !== undefined;
    for (const control of [title, kind, placement, answer, saveNode, deleteNode]) {
      (control as HTMLInputElement).disabled = readOnly;
    }
    for (const box of prerequisites.querySelectorAll('input')) box.disabled = readOnly;
    if (selected) {
      title.value = selected.title;
      kind.value = selected.kind;
      placement.value = selected.placementId ?? '';
      answer.value = selected.answer ?? '';
    } else {
      title.value = '';
      answer.value = '';
    }
  };

  const chosenPrerequisites = (): string[] =>
    [...prerequisites.querySelectorAll<HTMLInputElement>('input')]
      .filter((box) => box.checked)
      .map((box) => box.value);

  addNode.addEventListener('click', () => {
    if (!state.room) return;
    problem.textContent = '';
    void request<{ node: TriggerNode }>('POST', `/api/rooms/${state.room.id}/nodes`, {
      body: { title: 'New puzzle', kind: 'puzzle', prerequisites: [] },
    })
      .then(async (answerBody) => {
        await hooks.reloadRoom();
        hooks.selectNode(answerBody.node.id);
      })
      .catch((error: unknown) => {
        problem.textContent = firstFieldMessage(error) ?? copy.linkInvalid;
      });
  });

  saveNode.addEventListener('click', () => {
    const selected = state.nodes.find((node) => node.id === state.selectedNode);
    if (!selected || !state.room) return;
    problem.textContent = '';
    void request<{ node: TriggerNode }>(
      'PATCH',
      `/api/rooms/${state.room.id}/nodes/${selected.id}`,
      {
        body: {
          version: selected.version,
          title: title.value,
          kind: kind.value as NodeKind,
          prerequisites: chosenPrerequisites(),
          placementId: placement.value === '' ? null : placement.value,
          answer: answer.value === '' ? null : answer.value,
        },
      },
    )
      .then(() => hooks.reloadRoom())
      .catch((error: unknown) => {
        if (error instanceof ApiFailure && error.body.error === 'locked' && error.body.holder) {
          problem.textContent = copy.nodeHeld(error.body.holder.displayName);
          return;
        }
        problem.textContent = firstFieldMessage(error) ?? copy.linkInvalid;
      });
  });

  deleteNode.addEventListener('click', () => {
    const selected = state.nodes.find((node) => node.id === state.selectedNode);
    if (!selected || !state.room) return;
    void request<void>('DELETE', `/api/rooms/${state.room.id}/nodes/${selected.id}`)
      .then(async () => {
        hooks.selectNode(null);
        await hooks.reloadRoom();
      })
      .catch((error: unknown) => {
        problem.textContent = firstFieldMessage(error) ?? copy.linkInvalid;
      });
  });

  body.append(
    list,
    el('div', {}, [
      field('Node title', title),
      field('Node kind', kind),
      el('div', { class: 'field' }, [el('span', { text: 'Prerequisites' }), prerequisites]),
      field('Linked placement', placement),
      field('Answer', answer),
      holderLine,
      problem,
      el('div', { class: 'row' }, [addNode, saveNode, deleteNode]),
    ]),
  );
  paint();
  graphPainter = paint;
}

let graphPainter: (() => void) | null = null;

export function repaintGraph(): void {
  graphPainter?.();
}

export function forgetGraph(): void {
  graphPainter = null;
}

/* ---------------------------------------------------------------- prop library */

export function propLibrarySheet(body: HTMLElement, focusFile: boolean): void {
  const file = el('input', { type: 'file', 'aria-label': 'glTF file', accept: '.glb,.gltf' });
  const name = el('input', { type: 'text', 'aria-label': 'Prop name' });
  const width = el('input', { type: 'text', 'aria-label': 'Width (m)' });
  const depth = el('input', { type: 'text', 'aria-label': 'Depth (m)' });
  const height = el('input', { type: 'text', 'aria-label': 'Height (m)' });
  const upload = button('Upload', { class: 'primary' });
  const problem = problemLine();
  const list = el('ul', { class: 'card-grid', role: 'list', 'aria-label': 'Props' });
  const empty = el('p', { class: 'subtitle' });

  const paint = (pending: string | null): void => {
    clear(list);
    if (pending !== null) {
      list.append(
        el('li', { class: 'card' }, [
          el('div', { class: 'thumb placeholder' }),
          el('div', { class: 'strip' }, [el('div', { class: 'name', text: pending })]),
        ]),
      );
    }
    empty.textContent = state.props.length === 0 && pending === null ? copy.emptyLibrary : '';
    for (const prop of state.props) {
      const place = button(`Place ${prop.name}`);
      place.textContent = `Place ${prop.name}`;
      place.addEventListener('click', () => void placeProp(prop));
      const remove = button(`Delete ${prop.name}`);
      remove.textContent = `Delete ${prop.name}`;
      remove.addEventListener('click', () => {
        void request<void>('DELETE', `/api/props/${prop.id}`)
          .then(() => refreshProps(null))
          .catch((error: unknown) => {
            problem.textContent =
              error instanceof ApiFailure && error.body.error === 'prop_in_use'
                ? 'This prop is still placed in a room.'
                : copy.uploadFailure;
          });
      });
      const card = el('li', { class: 'card', 'data-prop-id': prop.id }, [
        el('div', { class: 'thumb placeholder' }),
        el('div', { class: 'strip' }, [
          el('div', { class: 'name', text: prop.name }),
          el('div', { class: 'row' }, [place, remove]),
        ]),
      ]);
      list.append(card);
    }
  };

  const refreshProps = async (focusPropId: string | null): Promise<void> => {
    const answer = await request<{ props: Prop[] }>('GET', '/api/props');
    state.props = answer.props;
    paint(null);
    if (focusPropId !== null) {
      const card = list.querySelector<HTMLElement>(`[data-prop-id="${focusPropId}"] button`);
      card?.focus();
    }
  };

  const placeProp = async (prop: Prop): Promise<void> => {
    if (!state.room) return;
    const body2 = {
      kind: 'prop',
      label: prop.name,
      propId: prop.id,
      xMm: Math.round(state.room.widthMm / 2),
      yMm: 0,
      zMm: Math.round(state.room.depthMm / 2),
      rotationDeg: 0,
    };
    try {
      await request<unknown>('POST', `/api/rooms/${state.room.id}/placements`, { body: body2 });
      await hooks.reloadRoom();
      hooks.closeDialog();
    } catch (error) {
      problem.textContent = firstFieldMessage(error) ?? copy.uploadFailure;
    }
  };

  upload.addEventListener('click', () => {
    problem.textContent = '';
    const chosen = file.files?.[0];
    if (!chosen) {
      problem.textContent = copy.uploadFailure;
      return;
    }
    const form = new FormData();
    form.set('file', chosen);
    form.set('name', name.value);
    form.set('widthMm', String(parseMetresToMm(width.value) ?? 0));
    form.set('depthMm', String(parseMetresToMm(depth.value) ?? 0));
    form.set('heightMm', String(parseMetresToMm(height.value) ?? 0));
    hooks.announce(copy.uploadPending(chosen.name));
    paint(chosen.name);
    void request<{ prop: Prop }>('POST', '/api/props', { raw: form })
      .then(async (answer) => {
        hooks.announce(copy.uploadSuccess(answer.prop.name));
        await refreshProps(answer.prop.id);
      })
      .catch(() => {
        hooks.announce(copy.uploadFailure);
        problem.textContent = copy.uploadFailure;
        paint(null);
      });
  });

  body.append(
    el('div', {}, [
      field('glTF file', file),
      field('Prop name', name),
      field('Width (m)', width),
      field('Depth (m)', depth),
      field('Height (m)', height),
      problem,
      upload,
    ]),
    empty,
    list,
  );
  paint(null);
  void refreshProps(null);
  if (focusFile) window.setTimeout(() => file.focus(), 0);
}

/* ---------------------------------------------------------------- versions */

let versionCards: Map<string, HTMLElement> | null = null;
let versionList: HTMLElement | null = null;

export function forgetVersions(): void {
  versionCards = null;
  versionList = null;
}

function versionCard(version: RoomVersion): HTMLElement {
  const card = el('li', { class: 'version-card', 'data-version-id': version.id });
  fillVersionCard(card, version);
  return card;
}

function fillVersionCard(card: HTMLElement, version: RoomVersion): void {
  const focused = document.activeElement;
  const focusedLabel = focused instanceof HTMLElement ? focused.getAttribute('aria-label') : null;
  clear(card);
  const copyLink = button('Copy build pack link');
  copyLink.textContent = 'Copy build pack link';
  copyLink.disabled = version.packUrl === null;
  copyLink.addEventListener('click', () => {
    if (version.packUrl === null) return;
    void navigator.clipboard?.writeText(version.packUrl).catch(() => undefined);
    hooks.announce(copy.linkCopied);
  });
  const controls = [copyLink];
  if (isOwner()) {
    const regenerate = button('Regenerate link');
    regenerate.textContent = 'Regenerate link';
    regenerate.addEventListener('click', () => {
      void request<{ packUrl: string }>('POST', `/api/versions/${version.id}/link`)
        .then(() => hooks.announce(copy.linkRegenerated))
        .catch(() => hooks.announce(copy.linkInvalid));
    });
    const revoke = button('Revoke link');
    revoke.textContent = 'Revoke link';
    revoke.disabled = version.packUrl === null;
    revoke.addEventListener('click', () => {
      void request<void>('DELETE', `/api/versions/${version.id}/link`)
        .then(() => hooks.announce(copy.linkRevoked))
        .catch(() => hooks.announce(copy.linkInvalid));
    });
    controls.push(regenerate, revoke);
  }
  card.append(
    el('div', { text: `Version ${version.number} — ${version.label}` }),
    el('div', { text: copy.versionStateWord(version.state) }),
    el('div', { class: 'mono', text: `${utcStamp(version.frozenAt)} UTC` }),
    el('div', { class: 'figures', text: figures.card(version.stats) }),
    el('div', { class: 'row' }, controls),
  );
  if (focusedLabel !== null && card.contains(focused)) {
    const again = card.querySelector<HTMLElement>(`[aria-label="${focusedLabel}"]`);
    again?.focus();
  }
}

/** Every version event updates the open sheet in place, with no reload. */
export function applyVersionEvent(version: RoomVersion): void {
  state.versions = [
    version,
    ...state.versions.filter((item) => item.id !== version.id),
  ].sort((a, b) => b.number - a.number);
  if (versionCards === null || versionList === null) return;
  const existing = versionCards.get(version.id);
  if (existing) {
    fillVersionCard(existing, version);
    return;
  }
  const card = versionCard(version);
  versionCards.set(version.id, card);
  versionList.prepend(card);
}

export function versionsSheet(body: HTMLElement, focusLabel: boolean): void {
  const label = el('input', { type: 'text', 'aria-label': 'Version label' });
  const freeze = button('Freeze version', { class: 'primary' });
  freeze.textContent = 'Freeze version';
  const problem = problemLine();
  const list = el('ul', { class: 'list', role: 'list', 'aria-label': 'Version cards' });
  versionCards = new Map();
  versionList = list;

  const paint = (): void => {
    clear(list);
    versionCards = new Map();
    for (const version of state.versions) {
      const card = versionCard(version);
      versionCards.set(version.id, card);
      list.append(card);
    }
  };

  freeze.addEventListener('click', () => {
    if (!state.room) return;
    problem.textContent = '';
    hooks.announce(copy.freezePending);
    void request<{ version: RoomVersion }>('POST', `/api/rooms/${state.room.id}/versions`, {
      body: { label: label.value },
    })
      .then((answer) => {
        hooks.announce(copy.freezeSuccess(answer.version.number));
        const superseded = state.versions.find(
          (item) => item.state === 'frozen' && item.id !== answer.version.id,
        );
        if (superseded) {
          applyVersionEvent({
            ...superseded,
            state: 'superseded',
            supersededBy: answer.version.number,
          });
        }
        applyVersionEvent(answer.version);
        const card = list.querySelector<HTMLElement>(
          `[data-version-id="${answer.version.id}"] [aria-label="Copy build pack link"]`,
        );
        card?.focus();
      })
      .catch((error: unknown) => {
        hooks.announce(copy.freezeFailure);
        problem.textContent = firstFieldMessage(error) ?? copy.freezeFailure;
      });
  });

  if (isOwner()) {
    body.append(el('div', {}, [field('Version label', label), problem, freeze]));
  }
  body.append(list);
  paint();
  if (state.room) {
    void request<{ versions: RoomVersion[] }>('GET', `/api/rooms/${state.room.id}/versions`)
      .then((answer) => {
        state.versions = answer.versions;
        paint();
      })
      .catch(() => undefined);
  }
  if (focusLabel) window.setTimeout(() => label.focus(), 0);
}

/* ---------------------------------------------------------------- playtests */

let playtestPainter: (() => void) | null = null;
let playtestTicker: number | null = null;

export function repaintPlaytests(): void {
  playtestPainter?.();
}

export function forgetPlaytests(): void {
  playtestPainter = null;
  if (playtestTicker !== null) {
    window.clearInterval(playtestTicker);
    playtestTicker = null;
  }
}

interface SessionTicker {
  clock: HTMLElement;
  cooldown: HTMLElement | null;
  served: number;
  cooldownServed: number;
  at: number;
  running: boolean;
}

export function playtestsSheet(body: HTMLElement): void {
  const startTime = el('input', {
    type: 'datetime-local',
    role: 'textbox',
    'aria-label': 'Start time',
  });
  const schedule = button('Schedule playtest', { class: 'primary' });
  schedule.textContent = 'Schedule playtest';
  schedule.disabled = true;
  const problem = problemLine();
  const cards = el('div', {});

  startTime.addEventListener('input', () => {
    schedule.disabled = startTime.value === '';
  });

  schedule.addEventListener('click', () => {
    if (!state.room) return;
    problem.textContent = '';
    const when = new Date(startTime.value);
    void request<{ session: PlaytestSession }>('POST', '/api/playtests', {
      body: { roomId: state.room.id, startsAt: when.toISOString() },
    })
      .then(() => refresh())
      .catch((error: unknown) => {
        problem.textContent = firstFieldMessage(error) ?? copy.linkInvalid;
      });
  });

  const move = (session: PlaytestSession, path: string): void => {
    void request<{ session: PlaytestSession }>('POST', `/api/playtests/${session.id}/${path}`)
      .then(() => {
        if (path === 'start') hooks.announce(copy.playtestStarted);
        return refresh();
      })
      .catch((error: unknown) => {
        problem.textContent =
          error instanceof ApiFailure && error.body.error === 'room_busy'
            ? copy.roomBusy
            : copy.linkInvalid;
      });
  };

  const tickers: SessionTicker[] = [];

  const sessionCard = (session: PlaytestSession): HTMLElement => {
    const clock = el('div', { class: 'mono', text: mmss(session.remainingSeconds) });
    const card = el('div', { class: 'version-card' }, [
      el('div', { text: `${session.roomName} — ${session.state}` }),
      el('div', { text: `${utcStamp(session.startsAt)} UTC` }),
      clock,
    ]);
    const ticker: SessionTicker = {
      clock,
      cooldown: null,
      served: session.remainingSeconds,
      cooldownServed: session.hintCooldownSeconds,
      at: performance.now(),
      running: session.state === 'running',
    };
    tickers.push(ticker);
    const controls = el('div', { class: 'row' });
    if (controlsSession(session)) {
      if (session.state === 'scheduled') {
        const open = button('Open lobby');
        open.textContent = 'Open lobby';
        open.addEventListener('click', () => move(session, 'open'));
        controls.append(open);
      }
      if (session.state === 'lobby') {
        const start = button('Start', { class: 'primary' });
        start.textContent = 'Start';
        start.addEventListener('click', () => move(session, 'start'));
        controls.append(start);
      }
      if (session.state === 'running') {
        const end = button('End');
        end.textContent = 'End';
        end.addEventListener('click', () => move(session, 'end'));
        controls.append(end);
      }
      if (session.state === 'scheduled' || session.state === 'lobby') {
        const cancel = button('Cancel playtest');
        cancel.textContent = 'Cancel playtest';
        cancel.addEventListener('click', () => move(session, 'cancel'));
        controls.append(cancel);
      }
    }
    card.append(controls);

    if (['scheduled', 'lobby', 'running'].includes(session.state) && controlsSession(session)) {
      const email = el('input', { type: 'email', 'aria-label': 'Tester email' });
      const send = button('Send invite');
      send.textContent = 'Send invite';
      send.addEventListener('click', () => {
        problem.textContent = '';
        void request<{ invite: { email: string; emailStatus: string } }>(
          'POST',
          `/api/playtests/${session.id}/invites`,
          { body: { email: email.value } },
        )
          .then((answer) => {
            const status = answer.invite.emailStatus;
            hooks.announce(
              status === 'sent'
                ? copy.inviteSent(answer.invite.email)
                : status === 'queued'
                  ? copy.inviteQueued(answer.invite.email)
                  : copy.inviteFailed(answer.invite.email),
            );
            email.value = '';
            return refresh();
          })
          .catch((error: unknown) => {
            problem.textContent = firstFieldMessage(error) ?? copy.linkInvalid;
          });
      });
      card.append(el('div', { class: 'row' }, [email, send]));
    }

    const rows = session.testers.map((tester) => {
      const revoke = button(`Revoke ${tester.email}`);
      revoke.textContent = 'Revoke';
      revoke.addEventListener('click', () => {
        void request<void>('DELETE', `/api/playtests/${session.id}/invites/${tester.inviteId}`)
          .then(() => refresh())
          .catch(() => undefined);
      });
      const resend = button(`Resend ${tester.email}`);
      resend.textContent = 'Resend';
      resend.addEventListener('click', () => {
        void request<unknown>(
          'POST',
          `/api/playtests/${session.id}/invites/${tester.inviteId}/resend`,
        )
          .then(() => refresh())
          .catch(() => undefined);
      });
      return el('tr', {}, [
        el('td', { text: tester.email }),
        el('td', { text: tester.displayName ?? '' }),
        el('td', { text: tester.joined ? 'joined' : '' }),
        el('td', { text: copy.emailStatusWord(tester.emailStatus) }),
        el('td', {}, [revoke]),
        el('td', {}, [resend]),
      ]);
    });
    card.append(
      el('table', { 'aria-label': 'Roster' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { scope: 'col', text: 'Email' }),
            el('th', { scope: 'col', text: 'Name' }),
            el('th', { scope: 'col', text: 'Joined' }),
            el('th', { scope: 'col', text: 'Email status' }),
            el('th', { scope: 'col', text: 'Revoke' }),
            el('th', { scope: 'col', text: 'Resend' }),
          ]),
        ]),
        el('tbody', {}, rows),
      ]),
    );

    if (session.state === 'running' && controlsSession(session)) {
      const hint = el('input', { type: 'text', 'aria-label': 'Hint' });
      const send = button('Send hint', { class: 'primary' });
      send.textContent = 'Send hint';
      const cooldown = el('span', {
        text:
          session.hintCooldownSeconds > 0
            ? copy.nextHintIn(session.hintCooldownSeconds)
            : copy.hintReady,
      });
      ticker.cooldown = cooldown;
      send.addEventListener('click', () => {
        void request<unknown>('POST', `/api/playtests/${session.id}/hints`, {
          body: { text: hint.value },
        })
          .then(() => {
            hint.value = '';
            return refresh();
          })
          .catch((error: unknown) => {
            if (
              error instanceof ApiFailure &&
              error.body.error === 'hint_cooldown' &&
              error.body.retryAfterSeconds !== undefined
            ) {
              const text = copy.nextHintIn(error.body.retryAfterSeconds);
              cooldown.textContent = text;
              hooks.announce(text);
              return;
            }
            problem.textContent = firstFieldMessage(error) ?? copy.linkInvalid;
          });
      });
      card.append(el('div', { class: 'row' }, [hint, send, cooldown]));
    }
    return card;
  };

  const paint = (): void => {
    clear(cards);
    tickers.length = 0;
    for (const session of state.sessions) cards.append(sessionCard(session));
  };

  const refresh = async (): Promise<void> => {
    if (!state.room) return;
    const answer = await request<{ sessions: PlaytestSession[] }>(
      'GET',
      `/api/rooms/${state.room.id}/playtests`,
    );
    state.sessions = answer.sessions;
    paint();
    hooks.paint();
  };

  if (isOwner()) {
    body.append(el('div', {}, [field('Start time', startTime), problem, schedule]));
  } else {
    body.append(problem);
  }
  body.append(cards);
  paint();
  void refresh();
  playtestPainter = paint;
  if (playtestTicker !== null) window.clearInterval(playtestTicker);
  playtestTicker = window.setInterval(() => {
    for (const ticker of tickers) {
      const elapsed = Math.floor((performance.now() - ticker.at) / 1000);
      const left = ticker.running ? Math.max(0, ticker.served - elapsed) : ticker.served;
      ticker.clock.textContent = mmss(left);
      if (ticker.cooldown !== null) {
        const cooling = Math.max(0, ticker.cooldownServed - elapsed);
        ticker.cooldown.textContent = cooling > 0 ? copy.nextHintIn(cooling) : copy.hintReady;
      }
    }
  }, 1000);
}

/* ---------------------------------------------------------------- debrief */

export function debriefSheet(body: HTMLElement, sessionId: string): void {
  body.append(el('h2', { text: copy.playtestEnded }));
  const holder = el('div', {});
  body.append(holder);
  void request<Debrief>('GET', `/api/playtests/${sessionId}/debrief`)
    .then((debrief) => {
      clear(holder);
      const outcome =
        debrief.outcome === 'escaped'
          ? copy.outcomeEscaped(debrief.elapsedSeconds)
          : debrief.outcome === 'timed_out'
            ? copy.outcomeTimedOut
            : copy.outcomeStopped(debrief.elapsedSeconds);
      holder.append(
        el('p', { text: outcome }),
        el('p', { text: figures.card(debrief.stats) }),
        el('table', { 'aria-label': 'Puzzle times' }, [
          el('thead', {}, [
            el('tr', {}, [
              el('th', { scope: 'col', text: 'Puzzle' }),
              el('th', { scope: 'col', text: 'Solved at' }),
              el('th', { scope: 'col', text: 'Waiting' }),
            ]),
          ]),
          el(
            'tbody',
            {},
            debrief.puzzles.map((puzzle) =>
              el('tr', {}, [
                el('td', { text: puzzle.title }),
                el('td', {
                  text: puzzle.solvedAtSeconds === null ? 'not solved' : mmss(puzzle.solvedAtSeconds),
                }),
                el('td', {
                  text: puzzle.waitSeconds === null ? '' : mss(puzzle.waitSeconds),
                }),
              ]),
            ),
          ),
        ]),
        el('p', { text: `Hints used: ${debrief.hintsUsed}` }),
        el('p', {
          text:
            debrief.chokePoint === null
              ? 'Choke point: none'
              : `Choke point: ${debrief.chokePoint.title} (${mss(debrief.chokePoint.waitSeconds)} waiting)`,
        }),
        el('p', { text: copy.debriefEmail(copy.emailStatusWord(debrief.emailStatus)) }),
      );
    })
    .catch(() => {
      clear(holder);
      holder.append(el('p', { text: copy.linkInvalid }));
    });
}

/* ---------------------------------------------------------------- shortcuts */

const shortcutRows: [string, string][] = [
  ['G / R / S', 'Move / Rotate / Scale mode'],
  ['] / [', 'select the next / previous placement'],
  ['Arrow keys', 'nudge the selected placement, or turn the camera'],
  ['Delete', 'delete the selected placement'],
  ['N / Shift+N', 'next / previous trigger node'],
  ['P', 'start or stop a playtest'],
  ['T', 'open or close the Trigger graph sheet'],
  ['L', 'open the Prop library sheet'],
  ['?', 'open the Keyboard shortcuts sheet'],
  ['D', 'drop the selected placement to the floor'],
  ['Escape', 'close the topmost dialog, or clear the selection'],
  ['Ctrl+Z', 'undo your own latest change'],
  ['Ctrl+K', 'open the Command palette'],
  ['Alt+Arrow Up / Down', 'move a Scene item up or down'],
];

export function shortcutsSheet(body: HTMLElement): void {
  body.append(
    el('table', { 'aria-label': 'Keyboard shortcuts' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: 'Key' }),
          el('th', { scope: 'col', text: 'Effect' }),
        ]),
      ]),
      el(
        'tbody',
        {},
        shortcutRows.map(([key, effect]) =>
          el('tr', {}, [el('td', { class: 'mono', text: key }), el('td', { text: effect })]),
        ),
      ),
    ]),
  );
}

/* ---------------------------------------------------------------- new room */

export function newRoomSheet(body: HTMLElement): void {
  const name = el('input', { type: 'text', 'aria-label': 'Room name' });
  const width = el('input', { type: 'text', 'aria-label': 'Width (m)', value: '4.000' });
  const depth = el('input', { type: 'text', 'aria-label': 'Depth (m)', value: '3.500' });
  const height = el('input', { type: 'text', 'aria-label': 'Height (m)', value: '2.700' });
  const problem = problemLine();
  const create = button('Create room', { class: 'primary' });
  create.textContent = 'Create room';
  create.addEventListener('click', () => {
    problem.textContent = '';
    void request<{ room: Room }>('POST', '/api/rooms', {
      body: {
        name: name.value,
        widthMm: parseMetresToMm(width.value) ?? 0,
        depthMm: parseMetresToMm(depth.value) ?? 0,
        heightMm: parseMetresToMm(height.value) ?? 0,
      },
    })
      .then(async (answer) => {
        hooks.closeDialog();
        await hooks.reloadRooms();
        await hooks.openRoom(answer.room.id, false);
      })
      .catch((error: unknown) => {
        if (error instanceof ApiFailure && error.body.error === 'name_taken') {
          problem.textContent = 'That room name is taken.';
          return;
        }
        problem.textContent = firstFieldMessage(error) ?? copy.linkInvalid;
      });
  });
  body.append(
    field('Room name', name),
    field('Width (m)', width),
    field('Depth (m)', depth),
    field('Height (m)', height),
    problem,
    create,
  );
}

/* ---------------------------------------------------------------- command palette */

export function commandPalette(body: HTMLElement): void {
  const input = el('input', {
    type: 'text',
    role: 'combobox',
    'aria-label': 'Command',
    'aria-expanded': 'true',
    autocomplete: 'off',
  });
  const list = el('ul', { role: 'listbox', 'aria-label': 'Commands', class: 'list' });
  let mode: 'commands' | 'versions' = 'commands';
  let active = 0;

  const entries = (): { name: string; available: boolean; run: () => void }[] => {
    if (mode === 'versions') {
      return state.versions.map((version) => ({
        name: `Version ${version.number} — ${version.label}`,
        available: true,
        run: () => {
          if (!state.room) return;
          void request<{ revision: number; room: Room }>(
            'POST',
            `/api/rooms/${state.room.id}/restore`,
            { body: { versionId: version.id } },
          )
            .then(async (answer) => {
              hooks.closeDialog();
              await hooks.reloadRoom();
              hooks.announce(copy.restoreDone(version.number, answer.revision));
            })
            .catch(() => hooks.announce(copy.linkInvalid));
        },
      }));
    }
    return commandNames.map((name) => ({
      name,
      available: name === 'Start playtest' ? state.liveAvailable : true,
      run: () => {
        if (name === 'Start playtest') {
          hooks.closeDialog();
          hooks.startStop();
          return;
        }
        if (name === 'Freeze version...') {
          hooks.closeDialog();
          hooks.openVersions(null, true);
          return;
        }
        if (name === 'Restore version...') {
          mode = 'versions';
          input.value = '';
          active = 0;
          void loadVersions().then(paint);
          return;
        }
        if (name === 'Open Versions') {
          hooks.closeDialog();
          hooks.openVersions(null, false);
          return;
        }
        if (name === 'Open Prop library') {
          hooks.closeDialog();
          hooks.openLibrary(null, false);
          return;
        }
        if (name === 'Open Trigger graph') {
          hooks.closeDialog();
          hooks.openGraph(null);
          return;
        }
        hooks.closeDialog();
        hooks.openShortcuts(null);
      },
    }));
  };

  const loadVersions = async (): Promise<void> => {
    if (!state.room) return;
    const answer = await request<{ versions: RoomVersion[] }>(
      'GET',
      `/api/rooms/${state.room.id}/versions`,
    );
    state.versions = answer.versions;
  };

  const matching = (): { name: string; available: boolean; run: () => void }[] => {
    const typed = input.value.trim().toLowerCase();
    return entries().filter((entry) => entry.name.toLowerCase().includes(typed));
  };

  const paint = (): void => {
    clear(list);
    const items = matching();
    if (active >= items.length) active = 0;
    items.forEach((entry, index) => {
      const option = el('li', {
        role: 'option',
        'aria-selected': index === active ? 'true' : 'false',
        text: entry.name,
      });
      if (!entry.available) {
        option.setAttribute('aria-disabled', 'true');
        option.setAttribute('aria-description', copy.needsLive);
      }
      option.addEventListener('click', () => {
        if (!entry.available) return;
        entry.run();
      });
      list.append(option);
    });
  };

  input.addEventListener('input', () => {
    active = 0;
    paint();
  });
  input.addEventListener('keydown', (event) => {
    const items = matching();
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      active = items.length === 0 ? 0 : (active + 1) % items.length;
      paint();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      active = items.length === 0 ? 0 : (active - 1 + items.length) % items.length;
      paint();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const entry = items[active];
      if (entry && entry.available) entry.run();
    }
  });

  body.append(input, list);
  paint();
}

/* ---------------------------------------------------------------- prop locked */

export function propLockedSheet(
  body: HTMLElement,
  holder: string,
  label: string,
  onCancel: () => void,
  onTakeOver: () => void,
): void {
  const cancel = button('Cancel');
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', onCancel);
  const takeOver = button('Take over', { class: 'primary' });
  takeOver.textContent = 'Take over';
  takeOver.addEventListener('click', onTakeOver);
  body.append(
    el('p', { text: copy.propLockedDialog(holder, label) }),
    el('div', { class: 'row' }, [cancel, takeOver]),
  );
  window.setTimeout(() => cancel.focus(), 0);
}

/* ---------------------------------------------------------------- room cards */

export function roomCardThumb(room: Room): HTMLElement {
  if (room.thumbnailUrl !== null) {
    return el('img', { class: 'thumb', src: room.thumbnailUrl, alt: '' });
  }
  const detail = state.roomDetails.get(room.id);
  if (!detail) return el('div', { class: 'thumb placeholder' });
  const canvas = renderRoomThumbnail(room, detail.placements);
  canvas.className = 'thumb';
  return canvas;
}
