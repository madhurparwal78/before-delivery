import { OUTAGE_TEXT, api } from '../api.js';
import { anyDialogOpen, openDialog } from '../dialog.js';
import { clear, el, focusHeading } from '../dom.js';
import { HEADING, clearAlerts, heading, navigate, showAlert } from '../shell.js';
import { button, field, select, statusRegion, textArea } from '../widgets.js';
import { createScene } from '../room/scene.js';
import type { RoomScene } from '../room/scene.js';
import { createSheet } from '../room/sheet.js';
import { createRipple } from '../room/ripple.js';
import { scheduleGatheringButton } from './communities.js';
import type {
  ChatMessage,
  CommunitySummary,
  Friend,
  Me,
  MirrorPerson,
  SafetyState,
  SessionDetail,
  VoteView
} from '../types.js';
import type { Page, PageContext } from '../main.js';

const CHAT_REACH = 6;
const HOLD_REPEAT_MS = 250;
const RECONNECT_MS = 2000;
const DIRECTIONS = ['north', 'east', 'south', 'west'] as const;
const RANK_OPTIONS = [
  { label: 'Show all', value: '' },
  { label: 'Feather', value: 'Feather' },
  { label: 'Linen', value: 'Linen' },
  { label: 'Cedar', value: 'Cedar' },
  { label: 'Granite', value: 'Granite' }
];
const CATEGORIES = ['harassment', 'hateful-content', 'impersonation', 'other'];
const FALLBACK_3D = '3D view unavailable. Everything else still works.';

const chebyshev = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

export async function renderRoom(ctx: PageContext): Promise<Page> {
  const sessionId = ctx.params['id'] ?? '';
  const me = ctx.me;
  if (me === null) return {};
  const first = await api.get<SessionDetail>(`/api/sessions/${sessionId}`);
  if (!first.ok || first.data === null) {
    heading(ctx.main, HEADING.unavailableSession);
    return {};
  }
  if (first.data.people === undefined) {
    renderOutside(ctx, first.data);
    return {};
  }
  return renderInside(ctx, me, first.data);
}

function renderOutside(ctx: PageContext, detail: SessionDetail): void {
  heading(ctx.main, detail.roomName);
  const result = statusRegion('Session result');
  const join = button('Join session', 'primary');
  join.addEventListener('click', () => {
    result.textContent = 'Opening...';
    void api.post(`/api/sessions/${detail.id}/join`).then((response) => {
      if (response.ok) {
        navigate(`/sessions/${detail.id}`);
        return;
      }
      if (response.status === 503) {
        result.textContent = '';
        showAlert(response.error ?? OUTAGE_TEXT.valkey);
        return;
      }
      result.textContent = response.error ?? '';
    });
  });
  ctx.main.append(
    el('section', { class: 'panel' }, [
      el('p', {
        text: `${detail.roomName} hosted by ${detail.hostName} \u2014 ${detail.count} of ${detail.capacity} inside`
      }),
      join,
      result
    ])
  );
}

async function renderInside(ctx: PageContext, me: Me, detail: SessionDetail): Promise<Page> {
  const sessionId = detail.id;
  heading(ctx.main, detail.roomName);
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const phoneQuery = window.matchMedia('(max-width: 599px)');
  const reduced = (): boolean => motionQuery.matches;

  const region = el('section', {
    role: 'region',
    'aria-label': 'Room',
    class: 'room',
    'data-room-version': String(detail.roomVersion),
    'data-motion': reduced() ? 'reduced' : 'animated',
    'data-ripple': 'none',
    'data-ripple-radius': '0'
  });
  const versionText = el('p', { class: 'version', text: `Room version ${detail.roomVersion}` });
  const canvas = el('canvas', { role: 'img', 'aria-label': 'Room view', class: 'view' });
  const canvasHolder = el('div', { class: 'canvas-holder' }, [canvas]);
  const peopleList = el('ul', { 'aria-label': 'People here', class: 'rows mirror' });
  const featureList = el('ul', { 'aria-label': 'Room features', class: 'rows mirror' });
  const chatLog = el('div', { role: 'log', 'aria-label': 'Nearby chat', class: 'log' });
  const chatInput = field('Say something nearby', 'text');
  const sendButton = button('Send', 'primary');
  const chatResult = statusRegion('Chat result');
  const chatPanel = el('div', { class: 'chat' }, [chatLog, chatInput.wrap, sendButton, chatResult]);
  const announcements = el('div', {
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Room announcements',
    class: 'announcements'
  });
  const safetyResult = statusRegion('Safety result');
  const gatheringResult = statusRegion('Gathering result');
  const voteResult = statusRegion('Vote result');
  const voteHolder = el('div', {});
  const hostControls = el('div', { class: 'row' });
  const communityControls = el('div', { class: 'row' });

  const directionButtons = DIRECTIONS.map((direction) => {
    const label = `Step ${direction}`;
    const node = button(label, 'plain');
    node.classList.add('tap');
    return { direction, node };
  });
  const sitButton = button('Sit or stand', 'plain');
  sitButton.classList.add('tap');
  const leaveButton = button('Leave session', 'danger');
  const hideSelect = select('Hide avatars above', RANK_OPTIONS, me.hideAbove ?? '');
  const controls = el('div', { class: 'controls' }, [
    ...directionButtons.map((entry) => entry.node),
    sitButton
  ]);
  const sheetButton = button('People and chat', 'plain');
  const sheet = createSheet(sheetButton, reduced);

  const left = el('div', { class: 'col-left' });
  const centre = el('div', { class: 'col-centre' }, [
    canvasHolder,
    controls,
    sheetButton,
    el('div', { class: 'row' }, [hideSelect.wrap]),
    hostControls,
    communityControls,
    el('div', { class: 'row' }, [leaveButton]),
    safetyResult,
    gatheringResult,
    voteHolder
  ]);
  const right = el('div', { class: 'col-right' });
  const grid = el('div', { class: 'room-grid' }, [left, centre, right]);
  region.append(versionText, grid, sheet.root, announcements);
  ctx.main.append(region);

  const place = (): void => {
    if (phoneQuery.matches) {
      sheet.root.append(peopleList, featureList, chatPanel);
      sheetButton.hidden = false;
      return;
    }
    left.append(peopleList, featureList);
    right.append(chatPanel);
    sheetButton.hidden = true;
    sheet.close();
  };
  place();
  phoneQuery.addEventListener('change', place);

  const scene: RoomScene | null = createScene(canvas, reduced());
  if (scene === null) {
    canvas.remove();
    canvasHolder.append(el('p', { role: 'status', class: 'status', text: FALLBACK_3D }));
  }
  motionQuery.addEventListener('change', () => {
    region.setAttribute('data-motion', reduced() ? 'reduced' : 'animated');
    scene?.setReducedMotion(reduced());
  });

  const people = new Map<string, MirrorPerson>();
  let nearby = new Set<string>();
  let hostId = detail.hostId;
  let safety: SafetyState = { blocked: [], muted: [] };
  let currentVote: VoteView | null = null;
  let currentVoteName = '';
  let seenMessages = new Set<string>();
  let lastAnnouncement = '';
  let lastAnnouncedAt = Number.NEGATIVE_INFINITY;
  let outage = false;
  let stopped = false;
  let focusBeforeChat: HTMLElement | null = null;

  const announce = (text: string): void => {
    const now = Date.now();
    if (text === lastAnnouncement && now - lastAnnouncedAt < 2000) return;
    lastAnnouncement = text;
    lastAnnouncedAt = now;
    announcements.append(el('p', { text }));
    while (announcements.children.length > 20) announcements.firstElementChild?.remove();
  };

  const ownTile = (): { x: number; y: number } | null => {
    const own = people.get(me.personId);
    return own === undefined ? null : { x: own.x, y: own.y };
  };

  const ripple = createRipple((radius, mode) => {
    region.setAttribute('data-ripple', mode);
    region.setAttribute('data-ripple-radius', String(radius));
    scene?.setRipple(radius, mode, ownTile());
  }, reduced);

  const nameOf = (personId: string): string => people.get(personId)?.displayName ?? 'Someone';

  const drawPeople = (): void => {
    const focused = document.activeElement;
    clear(peopleList);
    const sorted = [...people.values()].sort((a, b) =>
      a.displayName === b.displayName ? a.personId.localeCompare(b.personId) : a.displayName.localeCompare(b.displayName)
    );
    for (const person of sorted) {
      const item = el('li', {
        'data-person-id': person.personId,
        'data-display-name': person.displayName,
        'data-tile-x': String(person.x),
        'data-tile-y': String(person.y),
        'data-facing': person.facing,
        'data-seated': person.seated ? 'true' : 'false',
        'data-avatar': person.avatar,
        'data-host': person.host ? 'true' : 'false'
      });
      item.append(
        el('span', {
          text: `${person.displayName} \u2014 (${person.x}, ${person.y}) facing ${person.facing}${person.seated ? ', seated' : ''}${person.host ? ', host' : ''}`
        })
      );
      if (person.personId !== me.personId) {
        const actions = button(`Actions for ${person.displayName}`);
        actions.addEventListener('click', () => openPersonActions(person.personId, actions));
        item.append(actions);
      }
      peopleList.append(item);
    }
    if (focused !== null && focused !== document.body && !focused.isConnected) focusHeading();
  };

  const drawFeatures = (): void => {
    clear(featureList);
    for (const feature of detail.features ?? []) {
      const occupied =
        feature.kind === 'seat'
          ? ([...people.values()].find((person) => person.seated && person.x === feature.x && person.y === feature.y)
              ?.personId ?? '')
          : '';
      featureList.append(
        el('li', {
          'data-feature-id': feature.id,
          'data-kind': feature.kind,
          'data-tile-x': String(feature.x),
          'data-tile-y': String(feature.y),
          'data-occupied-by': occupied
        }, [el('span', { text: `${feature.kind} at (${feature.x}, ${feature.y})` })])
      );
    }
  };

  const refreshNearby = (announceNew: boolean): void => {
    const own = ownTile();
    const next = new Set<string>();
    if (own !== null) {
      for (const person of people.values()) {
        if (person.personId === me.personId) continue;
        if (chebyshev(own, person) <= CHAT_REACH) next.add(person.personId);
      }
    }
    if (announceNew) {
      for (const personId of next) {
        if (!nearby.has(personId)) announce(`${nameOf(personId)} is nearby.`);
      }
    }
    nearby = next;
  };

  const drawScene = (): void => {
    scene?.setPeople([...people.values()], me.personId);
  };

  const applyDetail = (next: SessionDetail): void => {
    detail = next;
    hostId = next.hostId;
    region.setAttribute('data-room-version', String(next.roomVersion));
    versionText.textContent = `Room version ${next.roomVersion}`;
    people.clear();
    for (const person of next.people ?? []) people.set(person.personId, person);
    drawPeople();
    drawFeatures();
    if (next.layout !== undefined) {
      scene?.setLayout(next.layout, `/api/assets/${next.roomId}/versions/${next.roomVersion}/file`);
    }
    drawScene();
    refreshNearby(false);
    drawHostControls();
  };

  const applyPerson = (person: MirrorPerson): void => {
    people.set(person.personId, person);
    drawPeople();
    drawFeatures();
    drawScene();
    refreshNearby(true);
  };

  const removePerson = (personId: string): void => {
    people.delete(personId);
    drawPeople();
    drawFeatures();
    drawScene();
    nearby.delete(personId);
  };

  const drawHostControls = (): void => {
    clear(hostControls);
    if (hostId !== me.personId) return;
    void api.get<{ friends: Friend[] }>('/api/friends').then((response) => {
      clear(hostControls);
      if (hostId !== me.personId) return;
      const invite = select(
        'Invite a friend',
        (response.data?.friends ?? []).map((friend) => ({ label: friend.displayName, value: friend.personId }))
      );
      const send = button('Invite');
      send.addEventListener('click', () => {
        void api
          .post(`/api/sessions/${sessionId}/invitees`, { personId: invite.input.value })
          .then((invited) => {
            if (!invited.ok) safetyResult.textContent = invited.error ?? '';
          });
      });
      hostControls.append(invite.wrap, send);
    });
  };

  const drawCommunityControls = async (): Promise<void> => {
    clear(communityControls);
    if (detail.communityId === null) return;
    const response = await api.get<{ communities: CommunitySummary[] }>('/api/communities');
    const mine = (response.data?.communities ?? []).find((entry) => entry.id === detail.communityId);
    if (mine === undefined || mine.role === 'member') return;
    communityControls.append(
      scheduleGatheringButton(detail.communityId, gatheringResult, () => undefined)
    );
  };

  const refreshSafety = async (): Promise<void> => {
    const response = await api.get<SafetyState>('/api/safety');
    safety = response.data ?? { blocked: [], muted: [] };
  };

  const refreshDetail = async (): Promise<void> => {
    const response = await api.get<SessionDetail>(`/api/sessions/${sessionId}`);
    if (response.ok && response.data !== null && response.data.people !== undefined) applyDetail(response.data);
  };

  const drawVote = (): void => {
    clear(voteHolder);
    if (currentVote === null) return;
    const voteRegion = el('section', {
      role: 'region',
      'aria-label': 'Removal vote',
      class: 'panel',
      'data-vote-status': currentVote.status
    });
    voteRegion.append(el('p', { text: `Vote on removing ${currentVoteName}.` }));
    if (currentVote.status === 'open') {
      const yes = button('Vote yes', 'primary');
      const no = button('Vote no');
      const cast = (choice: 'yes' | 'no'): void => {
        voteResult.textContent = 'Saving...';
        void api
          .post<VoteView>(`/api/sessions/${sessionId}/votes/${currentVote?.id ?? ''}/ballots`, { choice })
          .then((response) => {
            if (response.ok && response.data !== null) {
              voteResult.textContent = 'Vote counted.';
              currentVote = response.data;
              drawVote();
              return;
            }
            if (response.status === 503) {
              voteResult.textContent = '';
              showAlert(response.error ?? OUTAGE_TEXT.valkey);
              return;
            }
            voteResult.textContent = response.error ?? '';
          });
      };
      yes.addEventListener('click', () => cast('yes'));
      no.addEventListener('click', () => cast('no'));
      voteRegion.append(yes, no);
    }
    voteRegion.append(voteResult);
    voteHolder.append(voteRegion);
  };

  function openReport(personId: string, opener: HTMLElement | null): void {
    openDialog(
      'Report someone',
      (close) => {
        const category = select(
          'Category',
          CATEGORIES.map((entry) => ({ label: entry, value: entry }))
        );
        const details = textArea('Details');
        const send = button('Send report', 'primary');
        const cancel = button('Cancel');
        const result = statusRegion('Report result');
        send.addEventListener('click', () => {
          result.textContent = 'Sending...';
          void api
            .post('/api/reports', {
              personId,
              sessionId,
              category: category.input.value,
              details: details.input.value
            })
            .then((response) => {
              result.textContent = response.ok ? 'Report sent.' : (response.error ?? '');
            });
        });
        cancel.addEventListener('click', () => close());
        return [el('h2', { text: 'Report someone' }), category.wrap, details.wrap, send, cancel, result];
      },
      opener
    );
  }

  function openPersonActions(personId: string, opener: HTMLElement | null): void {
    openDialog(
      'Person actions',
      (close) => {
        const blocked = safety.blocked.includes(personId);
        const muted = safety.muted.includes(personId);
        const blockButton = button(blocked ? 'Unblock' : 'Block', 'danger');
        blockButton.addEventListener('click', () => {
          safetyResult.textContent = 'Saving...';
          const call = blocked ? api.remove(`/api/blocks/${personId}`) : api.post(`/api/blocks/${personId}`);
          void call.then(async (response) => {
            safetyResult.textContent = response.ok ? (blocked ? 'Unblocked.' : 'Blocked.') : (response.error ?? '');
            await refreshSafety();
            await refreshDetail();
          });
          close();
        });
        const muteButton = button(muted ? 'Unmute' : 'Mute');
        muteButton.addEventListener('click', () => {
          safetyResult.textContent = 'Saving...';
          const call = muted ? api.remove(`/api/mutes/${personId}`) : api.post(`/api/mutes/${personId}`);
          void call.then(async (response) => {
            safetyResult.textContent = response.ok ? (muted ? 'Unmuted.' : 'Muted.') : (response.error ?? '');
            await refreshSafety();
          });
          close();
        });
        const voteButton = button('Start removal vote', 'danger');
        voteButton.addEventListener('click', () => {
          safetyResult.textContent = 'Saving...';
          void api.post<VoteView>(`/api/sessions/${sessionId}/votes`, { personId }).then((response) => {
            if (response.ok && response.data !== null) {
              safetyResult.textContent = 'Vote counted.';
              currentVote = response.data;
              currentVoteName = nameOf(personId);
              drawVote();
              return;
            }
            if (response.status === 503) {
              safetyResult.textContent = '';
              showAlert(response.error ?? OUTAGE_TEXT.valkey);
              return;
            }
            safetyResult.textContent = response.error ?? '';
            voteResult.textContent = response.error ?? '';
          });
          close();
        });
        const reportButton = button('Report');
        reportButton.addEventListener('click', () => {
          close();
          openReport(personId, opener);
        });
        const closeButton = button('Close');
        closeButton.addEventListener('click', () => close());
        return [
          el('h2', { text: `Actions for ${nameOf(personId)}` }),
          blockButton,
          muteButton,
          voteButton,
          reportButton,
          closeButton
        ];
      },
      opener
    );
  }

  const appendMessage = (message: ChatMessage): void => {
    if (seenMessages.has(message.id)) return;
    seenMessages.add(message.id);
    chatLog.append(el('p', { text: `${message.fromName}: ${message.text}` }));
  };

  let commandChain: Promise<void> = Promise.resolve();
  const inOrder = (task: () => Promise<void>): Promise<void> => {
    commandChain = commandChain.then(task, task);
    return commandChain;
  };

  const step = async (direction: string): Promise<void> => {
    const response = await api.post<{ result: string; x: number; y: number; facing: string }>(
      `/api/sessions/${sessionId}/step`,
      { direction }
    );
    if (!response.ok || response.data === null) {
      if (response.status === 503) showAlert(response.error ?? OUTAGE_TEXT.valkey);
      else announce(response.error ?? '');
      return;
    }
    if (response.data.result === 'left') {
      stopped = true;
      navigate('/sessions');
      return;
    }
    const own = people.get(me.personId);
    if (own !== undefined) {
      applyPerson({ ...own, x: response.data.x, y: response.data.y, facing: response.data.facing });
    }
  };

  const sitOrStand = async (): Promise<void> => {
    const own = people.get(me.personId);
    const seated = own?.seated === true;
    const response = await api.post<{ result: string; x: number; y: number; facing: string }>(
      `/api/sessions/${sessionId}/${seated ? 'stand' : 'sit'}`
    );
    if (!response.ok || response.data === null) {
      if (response.status === 503) showAlert(response.error ?? OUTAGE_TEXT.valkey);
      else announce(response.error ?? '');
      return;
    }
    if (own !== undefined) {
      applyPerson({
        ...own,
        x: response.data.x,
        y: response.data.y,
        facing: response.data.facing,
        seated: !seated
      });
    }
  };

  const sendChat = async (): Promise<void> => {
    const text = chatInput.input.value;
    chatResult.textContent = 'Sending...';
    const response = await api.post<{ id: string; heardBy: number }>(`/api/sessions/${sessionId}/chat`, { text });
    if (!response.ok || response.data === null) {
      if (response.status === 503) {
        chatResult.textContent = '';
        showAlert(response.error ?? OUTAGE_TEXT.valkey);
        return;
      }
      chatResult.textContent = response.error ?? '';
      return;
    }
    chatResult.textContent = `Heard by ${response.data.heardBy}.`;
    chatInput.input.value = '';
    ripple.start();
  };

  for (const entry of directionButtons) {
    let repeat: number | null = null;
    let fromPointer = false;
    const stopRepeat = (): void => {
      if (repeat !== null) window.clearTimeout(repeat);
      repeat = null;
    };
    const again = (): void => {
      void inOrder(() => step(entry.direction));
      repeat = window.setTimeout(again, HOLD_REPEAT_MS);
    };
    entry.node.addEventListener('pointerdown', () => {
      fromPointer = true;
      void inOrder(() => step(entry.direction));
      repeat = window.setTimeout(again, HOLD_REPEAT_MS);
    });
    for (const name of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
      entry.node.addEventListener(name, stopRepeat);
    }
    window.addEventListener('pointerup', stopRepeat);
    entry.node.addEventListener('click', () => {
      if (fromPointer) {
        fromPointer = false;
        return;
      }
      void inOrder(() => step(entry.direction));
    });
  }

  sitButton.addEventListener('click', () => void inOrder(sitOrStand));
  sendButton.addEventListener('click', () => void sendChat());
  chatInput.input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void sendChat();
      return;
    }
    if (event.key === 'Escape' && !sheet.root.contains(chatInput.input)) {
      event.preventDefault();
      if (focusBeforeChat !== null && focusBeforeChat.isConnected) focusBeforeChat.focus();
      else region.focus();
    }
  });
  leaveButton.addEventListener('click', () => {
    void api.post(`/api/sessions/${sessionId}/leave`).then(() => {
      stopped = true;
      navigate('/sessions');
    });
  });
  hideSelect.input.addEventListener('change', () => {
    const value = hideSelect.input.value;
    safetyResult.textContent = 'Saving...';
    void api.put('/api/me/hide-above', { rank: value === '' ? null : value }).then(async (response) => {
      safetyResult.textContent = response.ok
        ? value === ''
          ? 'All avatars are shown.'
          : `Avatars above ${value} are hidden.`
        : (response.error ?? '');
      await refreshDetail();
    });
  });

  const nearestPerson = (): string | null => {
    const own = ownTile();
    if (own === null) return null;
    const others = [...people.values()].filter((person) => person.personId !== me.personId);
    if (others.length === 0) return null;
    others.sort((a, b) => {
      const distance = chebyshev(own, a) - chebyshev(own, b);
      if (distance !== 0) return distance;
      if (a.displayName !== b.displayName) return a.displayName.localeCompare(b.displayName);
      return a.personId.localeCompare(b.personId);
    });
    return others[0]?.personId ?? null;
  };

  const announceNearby = (): void => {
    const own = ownTile();
    const names = [...people.values()]
      .filter((person) => person.personId !== me.personId && own !== null && chebyshev(own, person) <= CHAT_REACH)
      .sort((a, b) => {
        if (own === null) return 0;
        const distance = chebyshev(own, a) - chebyshev(own, b);
        return distance !== 0 ? distance : a.displayName.localeCompare(b.displayName);
      })
      .map((person) => person.displayName);
    announce(names.length === 0 ? 'Nobody is nearby.' : `Nearby: ${names.join(', ')}.`);
  };

  document.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement | null;
    const inField =
      target !== null &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
    if (inField || anyDialogOpen()) return;
    const key = event.key.toLowerCase();
    if (event.key.startsWith('Arrow')) {
      const direction = event.key === 'ArrowUp' ? 'north' : event.key === 'ArrowDown' ? 'south' : event.key === 'ArrowLeft' ? 'west' : 'east';
      event.preventDefault();
      void inOrder(() => step(direction));
      return;
    }
    if (key === 's') {
      event.preventDefault();
      void inOrder(sitOrStand);
      return;
    }
    if (key === 't') {
      event.preventDefault();
      focusBeforeChat = target;
      if (phoneQuery.matches && !sheet.isOpen()) sheet.open();
      chatInput.input.focus();
      return;
    }
    if (key === 'n') {
      event.preventDefault();
      announceNearby();
      return;
    }
    if (key === 'm') {
      event.preventDefault();
      const nearest = nearestPerson();
      if (nearest === null) {
        announce('Nobody is nearby.');
        return;
      }
      openPersonActions(nearest, target);
    }
  });

  let socket: WebSocket | null = null;
  let retry: number | null = null;

  const handleFrame = (raw: string): void => {
    const frame = JSON.parse(raw) as Record<string, unknown>;
    const type = String(frame['type']);
    if (type === 'room') {
      applyDetail(frame['session'] as SessionDetail);
      return;
    }
    if (type === 'person-arrived') {
      const person = frame['person'] as MirrorPerson;
      if (person.personId !== me.personId) announce(`${person.displayName} arrived.`);
      applyPerson(person);
      return;
    }
    if (type === 'person-moved') {
      applyPerson(frame['person'] as MirrorPerson);
      return;
    }
    if (type === 'person-left') {
      const personId = String(frame['personId']);
      if (personId !== me.personId) announce(`${String(frame['displayName'])} left.`);
      removePerson(personId);
      return;
    }
    if (type === 'host-changed') {
      hostId = String(frame['personId']);
      announce(`${String(frame['displayName'])} is now the host.`);
      for (const person of people.values()) person.host = person.personId === hostId;
      drawPeople();
      drawHostControls();
      return;
    }
    if (type === 'chat') {
      appendMessage(frame['message'] as ChatMessage);
      return;
    }
    if (type === 'vote') {
      const vote = frame['vote'] as VoteView & { targetName: string };
      currentVote = vote;
      currentVoteName = vote.targetName;
      drawVote();
      if (vote.status === 'passed') announce(`${vote.targetName} was removed by a vote.`);
      if (vote.status === 'failed') announce('The vote did not pass.');
      return;
    }
    if (type === 'session-ended') {
      stopped = true;
      navigate('/sessions');
    }
  };

  const connect = (): void => {
    if (stopped) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${protocol}//${window.location.host}/ws/sessions/${sessionId}`);
    socket.addEventListener('open', () => {
      if (!outage) return;
      outage = false;
      clearAlerts();
      announce('Live room restored.');
      void refreshDetail();
    });
    socket.addEventListener('message', (event) => handleFrame(String(event.data)));
    socket.addEventListener('close', () => {
      if (stopped) return;
      outage = true;
      showAlert(OUTAGE_TEXT.valkey);
      if (retry !== null) window.clearTimeout(retry);
      retry = window.setTimeout(connect, RECONNECT_MS);
    });
  };

  applyDetail(detail);
  await refreshSafety();
  await drawCommunityControls();
  const history = await api.get<{ messages: ChatMessage[] }>(`/api/sessions/${sessionId}/chat`);
  for (const message of history.data?.messages ?? []) appendMessage(message);
  const votes = await api.get<{ votes: VoteView[] }>(`/api/sessions/${sessionId}/votes`);
  const latest = (votes.data?.votes ?? []).at(-1) ?? null;
  if (latest !== null) {
    currentVote = latest;
    currentVoteName = nameOf(latest.targetId);
    drawVote();
  }
  connect();

  return {
    onPersonEvent: (event) => {
      if (event.type === 'safety-changed') {
        void refreshSafety().then(() => refreshDetail());
        return;
      }
      if (event.type === 'removed-from-session' || event.type === 'suspended') {
        stopped = true;
        socket?.close();
        return;
      }
      if (event.type === 'removed-from-community' && event.communityId === detail.communityId) {
        void drawCommunityControls();
        return;
      }
      if (event.type === 'role-changed') {
        void drawCommunityControls().then(() => {
          if (document.activeElement === document.body) focusHeading();
        });
      }
    }
  };
}
