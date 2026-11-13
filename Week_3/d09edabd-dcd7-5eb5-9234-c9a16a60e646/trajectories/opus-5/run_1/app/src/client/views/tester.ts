import { ApiFailure, request } from '../api.js';
import { copy } from '../../shared/copy.js';
import { lengthText } from '../../shared/units.js';
import type { TesterView, Units } from '../../shared/types.js';
import { ServerClock } from '../clock.js';
import { LiveStream } from '../live.js';
import { button, clear, el, iconButton, isPhone, trapTab } from '../dom.js';
import { icons } from '../icons.js';
import { RoomStage } from '../stage/stage.js';
import { editorUnits, setEditorUnits } from '../units.js';

interface Sheet {
  element: HTMLElement;
  scrim: HTMLElement;
  opener: HTMLElement | null;
}

export function testerView(root: HTMLElement, token: string): void {
  document.body.className = 'fixed';
  const stage = new RoomStage();
  root.append(stage.element);

  const status = el('p', {
    role: 'status',
    'aria-label': 'Playtest status',
    class: 'visually-hidden',
  });
  const announce = (text: string): void => {
    status.textContent = text;
  };

  const roomName = el('span', {});
  const stateWord = el('span', {});
  const clockText = el('span', { class: 'mono', role: 'timer', 'aria-label': 'Playtest clock' });
  const pill = el('div', { class: 'cluster panel top-centre tester-pill' }, [
    roomName,
    stateWord,
    clockText,
  ]);
  const clock = new ServerClock((text) => {
    clockText.textContent = text;
  });

  const heading = el('h1', { class: 'visually-hidden' });
  const waiting = el('p', { class: 'empty-line' });

  const displayName = el('input', { type: 'text', 'aria-label': 'Display name' });
  const joinButton = button('Join', { class: isPhone() ? 'raised' : 'play-button' });
  const puzzlesButton = iconButton('Puzzles', icons.list);
  const hintsButton = iconButton('Hints', icons.lightbulb);
  const unitsButton = button(editorUnits() === 'ft' ? 'ft' : 'm', {
    'aria-label': 'Units',
    'aria-pressed': editorUnits() === 'ft' ? 'true' : 'false',
  });
  const helpButton = iconButton('Help', icons.help);

  const transport = el(
    'div',
    {
      role: 'toolbar',
      'aria-label': 'Transport',
      class: isPhone() ? 'tabbar' : 'cluster bottom-centre transport',
    },
    isPhone()
      ? [puzzlesButton, hintsButton, el('span', {}), unitsButton, helpButton]
      : [puzzlesButton, hintsButton, joinButton, unitsButton, helpButton],
  );
  if (isPhone()) transport.append(joinButton);

  const nameHolder = el('div', { class: 'cluster panel tester-name' }, [displayName]);
  root.append(pill, transport, nameHolder, status, heading, waiting);

  let view: TesterView | null = null;
  let units: Units = editorUnits();
  let openSheet: Sheet | null = null;

  const closeSheet = (): void => {
    if (!openSheet) return;
    openSheet.element.remove();
    openSheet.scrim.remove();
    const opener = openSheet.opener;
    openSheet = null;
    opener?.focus();
  };

  const showSheet = (name: string, build: (body: HTMLElement) => void, opener: HTMLElement): void => {
    closeSheet();
    const scrim = el('div', { class: 'scrim' });
    const body = el('div', { class: 'sheet centred', role: 'dialog', 'aria-modal': 'true', 'aria-label': name });
    const close = button('Close', {}, [document.createTextNode('✕')]);
    close.addEventListener('click', closeSheet);
    body.append(el('div', { class: 'sheet-header' }, [el('h2', { text: name }), close]));
    build(body);
    body.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeSheet();
        return;
      }
      trapTab(body, event);
    });
    scrim.addEventListener('click', closeSheet);
    root.append(scrim, body);
    openSheet = { element: body, scrim, opener };
    const first = body.querySelector<HTMLElement>('input, button, a');
    first?.focus();
  };

  const solve = (nodeId: string, answer: string | null): void => {
    void request<{ nodes: TesterView['nodes']; session: TesterView['session'] }>(
      'POST',
      `/api/play/${token}/solves`,
      { body: { nodeId, answer } },
    )
      .then((answerBody) => {
        if (view) {
          view = { ...view, nodes: answerBody.nodes, session: answerBody.session };
          const node = answerBody.nodes.find((item) => item.id === nodeId);
          if (node) announce(copy.solveSuccess(node.title));
          drawPuzzles();
          paint();
        }
      })
      .catch((error: unknown) => {
        if (!(error instanceof ApiFailure)) return;
        if (error.body.error === 'prerequisites_unsolved') {
          announce(copy.prerequisitesUnsolved);
          return;
        }
        if (error.body.errors?.answer !== undefined) {
          announce(copy.wrongAnswer);
          return;
        }
        announce(copy.linkInvalid);
      });
  };

  let puzzlesBody: HTMLElement | null = null;
  const drawPuzzles = (): void => {
    if (!puzzlesBody || !view) return;
    clear(puzzlesBody);
    const list = el('ul', { class: 'list', role: 'list' });
    for (const node of view.nodes) {
      const state = node.solved ? 'solved' : node.available ? 'available' : 'waiting';
      const row = el('li', { class: 'node-card' }, [
        el('div', { text: `${node.title} — ${state}` }),
      ]);
      if (!node.solved && node.available && (node.kind === 'puzzle' || node.kind === 'exit')) {
        const answer = node.needsAnswer
          ? el('input', { type: 'text', 'aria-label': `Answer for ${node.title}` })
          : null;
        if (answer) row.append(answer);
        const solveButton = button(`Solve ${node.title}`, { class: 'primary' });
        solveButton.textContent = `Solve ${node.title}`;
        solveButton.addEventListener('click', () => solve(node.id, answer ? answer.value : null));
        row.append(solveButton);
      }
      list.append(row);
    }
    puzzlesBody.append(list);
  };

  puzzlesButton.addEventListener('click', () => {
    showSheet(
      'Puzzles',
      (body) => {
        puzzlesBody = el('div', {});
        body.append(puzzlesBody);
        drawPuzzles();
      },
      puzzlesButton,
    );
  });

  hintsButton.addEventListener('click', () => {
    showSheet(
      'Hints',
      (body) => {
        const list = el('ul', { class: 'list', role: 'list' });
        for (const hint of view?.hints ?? []) list.append(el('li', { text: hint.text }));
        body.append(list);
      },
      hintsButton,
    );
  });

  helpButton.addEventListener('click', () => {
    showSheet(
      'Help',
      (body) => {
        body.append(
          el('p', { text: 'Walk with W, A, S, D or the arrow keys. Drag to look around.' }),
          el('p', { text: 'Open Puzzles to solve what is available. Hints arrive from the game master.' }),
        );
      },
      helpButton,
    );
  });

  unitsButton.addEventListener('click', () => {
    units = units === 'ft' ? 'm' : 'ft';
    setEditorUnits(units);
    unitsButton.textContent = units === 'ft' ? 'ft' : 'm';
    unitsButton.setAttribute('aria-pressed', units === 'ft' ? 'true' : 'false');
    paint();
  });

  joinButton.addEventListener('click', () => {
    void request<TesterView>('POST', `/api/play/${token}/join`, {
      body: { displayName: displayName.value },
    })
      .then((answer) => {
        view = answer;
        paint();
      })
      .catch(() => announce(copy.linkInvalid));
  });

  const paint = (): void => {
    if (!view) return;
    roomName.textContent = view.room.name;
    stateWord.textContent = view.session.state;
    clock.sync(view.session.remainingSeconds, view.session.state === 'running');
    stage.setRoom(view.room, view.room.placements);
    const joined = view.me.joined;
    joinButton.disabled = joined;
    joinButton.textContent = joined ? 'Joined' : 'Join';
    joinButton.setAttribute('aria-label', joined ? 'Joined' : 'Join');
    nameHolder.style.display = joined ? 'none' : '';
    if (view.session.state === 'lobby') waiting.textContent = copy.lobby;
    else if (view.session.state === 'scheduled') {
      waiting.textContent = copy.scheduled(view.session.startsAt);
    } else waiting.textContent = '';
    heading.textContent = '';
    if (view.session.state === 'running' && joined) stage.setPlayer(walker.x, walker.z, walker.heading);
    const size = view.room;
    pill.title = `${lengthText(size.widthMm, units)} x ${lengthText(size.depthMm, units)}`;
  };

  const showEnded = (): void => {
    clear(root);
    document.body.className = 'scrolls';
    root.append(
      el('div', { class: 'pack-column' }, [el('h1', { text: copy.playtestEnded }), status]),
    );
    announce(copy.playtestEnded);
  };

  const walker = { x: 0, z: 0, heading: 0 };

  void request<TesterView>('GET', `/api/play/${token}`)
    .then((answer) => {
      view = answer;
      walker.x = answer.room.widthMm / 2000;
      walker.z = 0.8;
      stage.setPlayer(walker.x, walker.z, 0);
      stage.announce('Player height');
      paint();
      drawPuzzles();
    })
    .catch((error: unknown) => {
      clear(root);
      document.body.className = 'scrolls';
      const message =
        error instanceof ApiFailure && error.body.error === 'invite_expired'
          ? copy.inviteExpired
          : copy.linkInvalid;
      root.append(
        el('div', { class: 'pack-column' }, [
          el('h1', { text: copy.playtestEnded }),
          el('p', { text: message }),
        ]),
      );
    });

  const stream = new LiveStream(`/api/play/${token}/events`);
  stream.on('session', (data) => {
    const payload = data as { session: TesterView['session'] };
    if (!view) return;
    view = { ...view, session: payload.session };
    if (payload.session.state === 'ended') {
      stream.close();
      showEnded();
      return;
    }
    paint();
  });
  stream.on('hint', (data) => {
    const payload = data as { text: string; sentAt: string };
    if (view) view = { ...view, hints: [...view.hints, payload] };
    announce(copy.hintReceived(payload.text));
  });
  stream.on('solve', () => {
    void request<TesterView>('GET', `/api/play/${token}`)
      .then((answer) => {
        view = answer;
        drawPuzzles();
        paint();
      })
      .catch(() => undefined);
  });

  window.setInterval(() => {
    if (!view || view.session.state !== 'running') return;
    void request<TesterView>('GET', `/api/play/${token}`)
      .then((answer) => {
        view = answer;
        clock.sync(answer.session.remainingSeconds, answer.session.state === 'running');
      })
      .catch(() => undefined);
  }, 15_000);

  const pressed = new Set<string>();
  let moved = false;
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeSheet();
      return;
    }
    pressed.add(event.key.toLowerCase());
  });
  window.addEventListener('keyup', (event) => pressed.delete(event.key.toLowerCase()));

  const step = (): void => {
    if (view && view.session.state === 'running' && view.me.joined) {
      const forward = pressed.has('w') || pressed.has('arrowup');
      const back = pressed.has('s') || pressed.has('arrowdown');
      const left = pressed.has('a') || pressed.has('arrowleft');
      const right = pressed.has('d') || pressed.has('arrowright');
      const speed = 0.05;
      if (forward || back || left || right) {
        const heading = (walker.heading * Math.PI) / 180;
        if (forward) {
          walker.x += Math.sin(heading) * speed;
          walker.z += Math.cos(heading) * speed;
        }
        if (back) {
          walker.x -= Math.sin(heading) * speed;
          walker.z -= Math.cos(heading) * speed;
        }
        if (left) walker.heading = (walker.heading - 2 + 360) % 360;
        if (right) walker.heading = (walker.heading + 2) % 360;
        walker.x = Math.min(Math.max(walker.x, 0.2), view.room.widthMm / 1000 - 0.2);
        walker.z = Math.min(Math.max(walker.z, 0.2), view.room.depthMm / 1000 - 0.2);
        stage.setPlayer(walker.x, walker.z, walker.heading);
        moved = true;
        pushNearby();
        nearPuzzle();
      }
    }
    window.requestAnimationFrame(step);
  };
  window.requestAnimationFrame(step);

  /** A tester's push is local to their own screen and never changes the room. */
  const pushNearby = (): void => {
    if (!view) return;
    for (const placement of view.room.placements) {
      if (placement.kind !== 'box' && placement.kind !== 'cylinder') continue;
      const dx = walker.x - placement.xMm / 1000;
      const dz = walker.z - placement.zMm / 1000;
      const reachX = placement.widthMm / 2000 + 0.3;
      const reachZ = placement.depthMm / 2000 + 0.3;
      if (Math.abs(dx) > reachX || Math.abs(dz) > reachZ) continue;
      const pushed = {
        ...placement,
        xMm: Math.round(placement.xMm - Math.sign(dx) * (reachX - Math.abs(dx)) * 1000),
        zMm: Math.round(placement.zMm - Math.sign(dz) * (reachZ - Math.abs(dz)) * 1000),
      };
      view = {
        ...view,
        room: {
          ...view.room,
          placements: view.room.placements.map((item) =>
            item.id === pushed.id ? pushed : item,
          ),
        },
      };
      stage.updatePlacement(pushed);
    }
  };

  let pointerStart: { x: number; y: number; walking: boolean } | null = null;
  stage.element.addEventListener('pointerdown', (event) => {
    const phone = isPhone();
    pointerStart = {
      x: event.clientX,
      y: event.clientY,
      walking: phone && event.clientX < window.innerWidth / 2,
    };
  });
  stage.element.addEventListener('pointermove', (event) => {
    if (pointerStart === null || !view || view.session.state !== 'running') return;
    const dx = event.clientX - pointerStart.x;
    const dy = event.clientY - pointerStart.y;
    pointerStart = { ...pointerStart, x: event.clientX, y: event.clientY };
    if (pointerStart.walking) {
      const heading = (walker.heading * Math.PI) / 180;
      walker.x -= (Math.sin(heading) * dy) / 200;
      walker.z -= (Math.cos(heading) * dy) / 200;
      walker.heading = (((walker.heading + dx * 0.5) % 360) + 360) % 360;
    } else {
      walker.heading = (((walker.heading + dx * 0.5) % 360) + 360) % 360;
    }
    walker.x = Math.min(Math.max(walker.x, 0.2), view.room.widthMm / 1000 - 0.2);
    walker.z = Math.min(Math.max(walker.z, 0.2), view.room.depthMm / 1000 - 0.2);
    stage.setPlayer(walker.x, walker.z, walker.heading);
    moved = true;
    pushNearby();
    nearPuzzle();
  });
  const endDrag = (): void => {
    pointerStart = null;
  };
  stage.element.addEventListener('pointerup', endDrag);
  stage.element.addEventListener('pointercancel', endDrag);

  const nearPuzzle = (): void => {
    if (!view || openSheet !== null) return;
    for (const node of view.nodes) {
      if (!node.available || node.placementId === null) continue;
      const placement = view.room.placements.find((item) => item.id === node.placementId);
      if (!placement) continue;
      const dx = placement.xMm / 1000 - walker.x;
      const dz = placement.zMm / 1000 - walker.z;
      if (Math.hypot(dx, dz) <= 1.5) {
        puzzlesButton.click();
        return;
      }
    }
  };

  window.setInterval(() => {
    if (!moved || !view || view.session.state !== 'running' || !view.me.joined) return;
    moved = false;
    void request<void>('POST', `/api/play/${token}/position`, {
      body: {
        xMm: Math.round(walker.x * 1000),
        zMm: Math.round(walker.z * 1000),
        headingDeg: Math.round(walker.heading),
      },
    }).catch(() => undefined);
  }, 2000);

  stream.on('tester', (data) => {
    const payload = data as { displayName: string; xMm: number; zMm: number; headingDeg: number };
    stage.setTesters([payload]);
  });
}
