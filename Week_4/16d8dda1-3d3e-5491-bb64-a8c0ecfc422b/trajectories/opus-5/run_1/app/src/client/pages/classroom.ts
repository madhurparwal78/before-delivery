import type { ChatMessageJson, LiveEvent, SessionSnapshot } from '../../shared/types.js';
import { compareSeatIds } from '../../shared/rules.js';
import { api } from '../api.js';
import { button, element, setAttributes } from '../dom.js';
import { makeDialog } from '../dialog.js';
import { internalLink } from '../shell.js';
import { createAnnouncer } from '../classroom/announce.js';
import { createMirror } from '../classroom/mirror.js';
import { answerPollByNumber, createPanels } from '../classroom/panels.js';
import type { RoomScene } from '../classroom/scene.js';

type Mode = 'phone' | 'tablet' | 'desktop';

const WALK = 640;
const STAGGER = 120;

function modeFor(width: number): Mode {
  if (width < 600) return 'phone';
  if (width < 1024) return 'tablet';
  return 'desktop';
}

function nearestSeat(
  seats: SessionSnapshot['seats'],
  from: string | null,
  direction: 'left' | 'right' | 'up' | 'down'
): string | null {
  const here = seats.find((seat) => seat.seatId === from);
  if (here === undefined) return seats[0]?.seatId ?? null;
  const towards = seats.filter((seat) => {
    if (seat.seatId === here.seatId) return false;
    if (direction === 'left') return seat.column < here.column;
    if (direction === 'right') return seat.column > here.column;
    if (direction === 'up') return seat.row < here.row;
    return seat.row > here.row;
  });
  if (towards.length === 0) return null;
  const inLine = towards.filter((seat) =>
    direction === 'left' || direction === 'right' ? seat.row === here.row : seat.column === here.column
  );
  const field = inLine.length > 0 ? inLine : towards;
  const sorted = [...field].sort((a, b) => {
    const distanceA = Math.hypot(a.column - here.column, a.row - here.row);
    const distanceB = Math.hypot(b.column - here.column, b.row - here.row);
    if (Math.abs(distanceA - distanceB) > 0.0001) return distanceA - distanceB;
    return compareSeatIds(a.seatId, b.seatId);
  });
  return sorted[0]?.seatId ?? null;
}

export function classroomPage(sessionId: string): HTMLElement {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const announcer = createAnnouncer();
  const mirror = createMirror();

  let snapshot: SessionSnapshot | null = null;
  let announceBase: SessionSnapshot | null = null;
  let cursorSeat: string | null = null;
  let chatTable: string | null = null;
  let chatMessages: ChatMessageJson[] = [];
  let scene: RoomScene | null = null;
  let breakoutBase: { remaining: number; at: number } | null = null;
  let returningUntil = 0;
  let focusBeforeChat: HTMLElement | null = null;
  let mode = modeFor(window.innerWidth);
  let socket: WebSocket | null = null;
  let closed = false;

  const heading = element('h1', {}, ['']);
  const liveMark = element('span', { class: 'live-mark', hidden: true }, ['Live']);
  const pausedBanner = element('div', { role: 'alert', class: 'paused-banner', hidden: true }, [
    'Live updates are paused. Your class will resume on its own.'
  ]);
  const webglFallback = element('div', { role: 'status', class: 'webgl-fallback', hidden: true }, [
    '3D view unavailable. The class still works.'
  ]);
  const endedNote = element('p', { class: 'ended-note', hidden: true }, [
    'This class has ended. ',
    internalLink('Review the slides', `/review/${sessionId}`)
  ]);

  const openClass = button('Open class', { class: 'primary', 'data-focus-key': 'open-class' });
  const startClass = button('Start class', { class: 'primary', 'data-focus-key': 'start-class' });
  const endClass = button('End class', { 'data-focus-key': 'end-class' });
  const previousSlide = button('Previous slide', { 'data-focus-key': 'previous-slide' });
  const nextSlide = button('Next slide', { 'data-focus-key': 'next-slide' });
  const lockSwitch = element('button', { type: 'button', role: 'switch', 'aria-checked': 'false', 'data-focus-key': 'lock' }, [
    'Lock class'
  ]);
  const teacherBar = element('div', { class: 'teacher-bar' }, [
    openClass,
    startClass,
    endClass,
    previousSlide,
    nextSlide,
    lockSwitch
  ]);

  const panels = createPanels({
    snapshot: () => snapshot as SessionSnapshot,
    isOwner: () => snapshot?.you.role === 'teacher',
    act: (control, run) => {
      void (async () => {
        control.disabled = true;
        control.setAttribute('aria-busy', 'true');
        const error = await run();
        control.disabled = false;
        control.removeAttribute('aria-busy');
        if (error !== null) announcer.say(error);
        draw();
      })();
    },
    chatMessages: () => chatMessages,
    chatTable: () => chatTable,
    setChatTable: (tableId) => {
      chatTable = tableId;
      void loadChat();
    },
    sendChat: async (text) => {
      if (chatTable === null) return 'Chat opens when breakouts start.';
      const answer = await api.post(`/api/sessions/${sessionId}/tables/${chatTable}/chat`, { text });
      return answer.error;
    },
    takeSeat: (seatId) => void takeSeat(seatId)
  });

  const rail = element('div', { class: 'rail' });
  const sheetClose = button('Close panel', { class: 'quiet' });
  const sheet = makeDialog('Class panel', [sheetClose, rail], 'sheet');
  const sheetOpen = button('Class panel', { class: 'primary sheet-opener' });
  sheetOpen.addEventListener('click', () => sheet.open(sheetOpen));
  sheetClose.addEventListener('click', () => sheet.close());

  const tabNames = ['Seats', 'Hands', 'Poll', 'Chat'] as const;
  const tabs = tabNames.map((name) =>
    element('button', { type: 'button', role: 'tab', 'aria-selected': 'false', tabindex: '-1', class: 'tab' }, [name])
  );
  const tabList = element('div', { role: 'tablist', 'aria-label': 'Class panels', class: 'tab-bar' }, tabs);
  const tabWrappers = tabNames.map((name) =>
    element('div', { role: 'tabpanel', 'aria-label': name, class: 'tab-panel' })
  );
  const tabPanels = element('div', { class: 'tab-panels' }, tabWrappers);
  let selectedTab = 0;

  const panelFor = (index: number): HTMLElement =>
    [panels.seats.root, panels.hands.root, panels.poll.root, panels.chat.root][index] as HTMLElement;

  const selectTab = (index: number, focus = true): void => {
    selectedTab = index;
    tabs.forEach((tab, position) => {
      setAttributes(tab, { 'aria-selected': position === index ? 'true' : 'false', tabindex: position === index ? '0' : '-1' });
    });
    tabWrappers.forEach((wrapper, position) => {
      wrapper.hidden = position !== index;
    });
    if (focus) tabs[index]?.focus();
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectTab(index, false));
    tab.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        const next = (index + (event.key === 'ArrowRight' ? 1 : tabNames.length - 1)) % tabNames.length;
        selectTab(next);
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectTab(index);
      }
    });
  });

  const room = element('div', { class: 'room-area' }, [mirror.region, webglFallback]);
  const layout = element('div', { class: 'classroom-layout' });
  const root = element('main', { class: 'page classroom-page' }, [
    element('div', { class: 'classroom-head' }, [heading, liveMark]),
    pausedBanner,
    endedNote,
    layout,
    announcer.region,
    sheet.root,
    ...panels.dialogs
  ]);

  const applyMode = (): void => {
    mode = modeFor(window.innerWidth);
    root.dataset.mode = mode;
    layout.replaceChildren();
    for (let index = 0; index < tabNames.length; index += 1) panelFor(index).hidden = false;
    if (mode === 'phone') {
      tabWrappers.forEach((wrapper, index) => wrapper.replaceChildren(panelFor(index)));
      layout.append(room, teacherBar, panels.breakout.root, tabList, tabPanels);
      selectTab(selectedTab, false);
      sheet.close();
      return;
    }
    panels.seats.root.remove();
    rail.replaceChildren(panels.hands.root, panels.poll.root, panels.breakout.root, panels.chat.root);
    room.prepend(teacherBar);
    if (mode === 'tablet') {
      layout.append(room, sheetOpen);
      return;
    }
    layout.append(room, element('div', { class: 'rail-box' }, [rail]));
    sheet.close();
  };

  const draw = (): void => {
    if (snapshot === null) return;
    const inPlay = snapshot.state === 'live' || snapshot.state === 'breakouts';
    heading.textContent = snapshot.classTitle;
    document.title = `${snapshot.classTitle} - Slatehall`;
    liveMark.hidden = !inPlay;
    pausedBanner.hidden = snapshot.live;
    endedNote.hidden = !(snapshot.state === 'ended' && snapshot.you.role === 'learner');

    const owner = snapshot.you.role === 'teacher';
    const teaching = snapshot.you.role !== 'learner';
    teacherBar.hidden = !teaching;
    openClass.hidden = !owner || snapshot.state !== 'scheduled';
    startClass.hidden = !owner || snapshot.state !== 'open';
    endClass.hidden = !owner || !(snapshot.state === 'open' || inPlay);
    previousSlide.hidden = !teaching || !inPlay;
    nextSlide.hidden = !teaching || !inPlay;
    lockSwitch.hidden = !owner || !inPlay;
    setAttributes(lockSwitch, { 'aria-checked': snapshot.locked ? 'true' : 'false' });

    if (cursorSeat === null || !snapshot.seats.some((seat) => seat.seatId === cursorSeat)) {
      const own = snapshot.seats.find((seat) => seat.learnerId === snapshot?.you.learnerId);
      cursorSeat = own?.seatId ?? [...snapshot.seats].sort((a, b) => compareSeatIds(a.seatId, b.seatId))[0]?.seatId ?? null;
    }

    mirror.update(snapshot, cursorSeat);
    mirror.setMotion(reduced);
    panels.update();

    const ownSeat = snapshot.seats.find((seat) => seat.learnerId === snapshot?.you.learnerId)?.seatId ?? null;
    scene?.update(snapshot, { reduced, viewerSeat: ownSeat, teaching });
  };

  const loadChat = async (): Promise<void> => {
    if (chatTable === null) {
      chatMessages = [];
      panels.chat.update();
      return;
    }
    const answer = await api.get<{ messages: ChatMessageJson[] }>(
      `/api/sessions/${sessionId}/tables/${chatTable}/chat`
    );
    chatMessages = answer.error === null ? answer.body.messages : [];
    panels.chat.update();
  };

  const takeSeat = async (seatId: string): Promise<void> => {
    const answer = await api.post<SessionSnapshot>(`/api/sessions/${sessionId}/seat`, { seatId });
    if (answer.error !== null) {
      announcer.say(answer.error);
      return;
    }
    apply(answer.body);
  };

  const apply = (next: SessionSnapshot): void => {
    snapshot = next;
    if (next.breakout === null) {
      breakoutBase = null;
    } else {
      breakoutBase = { remaining: next.breakout.remainingSeconds, at: Date.now() };
    }
    const own = next.seats.find((seat) => seat.learnerId === next.you.learnerId);
    const wantedTable =
      next.you.role === 'teacher' ? chatTable ?? next.tables[0]?.tableId ?? null : own?.breakoutTable ?? chatTable;
    if (wantedTable !== chatTable) {
      chatTable = wantedTable;
      void loadChat();
    }
    draw();
  };

  /* DP-25: the walk home takes table by table, and the mirror says so while it runs. */
  const startReturn = (tables: number): void => {
    if (reduced) return;
    const span = Math.max(0, tables - 1) * STAGGER + WALK;
    returningUntil = Date.now() + span;
    mirror.setReturning(true);
    window.setTimeout(() => {
      if (Date.now() >= returningUntil) mirror.setReturning(false);
    }, span);
  };

  const onMessage = (payload: { event: LiveEvent; snapshot: SessionSnapshot; message?: ChatMessageJson & { tableId: string } }): void => {
    const before = announceBase;
    if (payload.event === 'breakouts-ended') startReturn(before?.breakout?.tables.length ?? 1);
    if (payload.message !== undefined && payload.message.tableId === chatTable) {
      chatMessages = [...chatMessages, payload.message];
    }
    apply(payload.snapshot);
    announcer.fromChange(payload.event, before, payload.snapshot);
    announceBase = payload.snapshot;
  };

  const connect = (): void => {
    if (closed) return;
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/sessions/${sessionId}`;
    socket = new WebSocket(url);
    socket.addEventListener('message', (event) => {
      onMessage(JSON.parse(String(event.data)) as Parameters<typeof onMessage>[0]);
    });
    socket.addEventListener('close', () => {
      socket = null;
      if (!closed) window.setTimeout(connect, 1_000);
    });
  };

  const act = (control: HTMLButtonElement, run: () => Promise<string | null>): void => {
    void (async () => {
      control.disabled = true;
      control.setAttribute('aria-busy', 'true');
      const error = await run();
      control.disabled = false;
      control.removeAttribute('aria-busy');
      if (error !== null) announcer.say(error);
    })();
  };

  openClass.addEventListener('click', () =>
    act(openClass, async () => {
      const answer = await api.post<SessionSnapshot>(`/api/sessions/${sessionId}/open`);
      if (answer.error === null) apply(answer.body);
      return answer.error;
    })
  );
  startClass.addEventListener('click', () =>
    act(startClass, async () => {
      const answer = await api.post<SessionSnapshot>(`/api/sessions/${sessionId}/start`);
      if (answer.error === null) apply(answer.body);
      return answer.error;
    })
  );
  endClass.addEventListener('click', () =>
    act(endClass, async () => {
      const answer = await api.post<SessionSnapshot>(`/api/sessions/${sessionId}/end`);
      if (answer.error === null) apply(answer.body);
      return answer.error;
    })
  );

  const moveSlide = (step: number): void => {
    if (snapshot === null) return;
    const wanted = snapshot.slide.current + step;
    const control = step > 0 ? nextSlide : previousSlide;
    act(control, async () => {
      const answer = await api.post<SessionSnapshot>(`/api/sessions/${sessionId}/slide`, { slide: wanted });
      if (answer.error === null) apply(answer.body);
      return answer.error;
    });
  };
  previousSlide.addEventListener('click', () => moveSlide(-1));
  nextSlide.addEventListener('click', () => moveSlide(1));
  lockSwitch.addEventListener('click', () =>
    act(lockSwitch, async () => {
      const answer = await api.post<SessionSnapshot>(`/api/sessions/${sessionId}/lock`, {
        locked: lockSwitch.getAttribute('aria-checked') !== 'true'
      });
      if (answer.error === null) apply(answer.body);
      return answer.error;
    })
  );

  const pressControl = (key: string): void => {
    root.querySelector<HTMLButtonElement>(`[data-focus-key="${key}"]`)?.click();
  };

  const inTextField = (target: EventTarget | null): boolean =>
    target instanceof HTMLElement &&
    (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable);

  const focusChat = (): void => {
    focusBeforeChat = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (mode === 'phone') selectTab(3, false);
    if (mode === 'tablet' && !sheet.isOpen()) sheet.open(sheetOpen);
    panels.chatField.focus();
  };

  panels.chatField.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      focusBeforeChat?.focus();
    }
  });

  const onKeyDown = (event: KeyboardEvent): void => {
    if (snapshot === null || inTextField(event.target)) return;
    if (event.target instanceof HTMLElement && event.target.closest('[role="dialog"]') !== null) return;
    const learner = snapshot.you.role === 'learner';
    const teaching = !learner;
    const key = event.key;

    const directions: Record<string, 'left' | 'right' | 'up' | 'down'> = {
      ArrowLeft: 'left',
      ArrowRight: 'right',
      ArrowUp: 'up',
      ArrowDown: 'down'
    };
    const direction = directions[key];
    if (direction !== undefined) {
      if (event.target instanceof HTMLElement && event.target.getAttribute('role') === 'tab') return;
      event.preventDefault();
      const next = nearestSeat(snapshot.seats, cursorSeat, direction);
      if (next !== null) {
        cursorSeat = next;
        mirror.update(snapshot, cursorSeat);
      }
      return;
    }
    if (key === 'Enter' && learner && cursorSeat !== null) {
      event.preventDefault();
      void takeSeat(cursorSeat);
      return;
    }
    if ((key === 'h' || key === 'H') && learner) {
      event.preventDefault();
      pressControl('raise-hand');
      return;
    }
    if (key === 'c' || key === 'C') {
      event.preventDefault();
      focusChat();
      return;
    }
    if (/^[1-6]$/.test(key) && learner) {
      event.preventDefault();
      answerPollByNumber(panels, Number(key));
      return;
    }
    if (teaching && (key === 'PageDown' || key === 'PageUp')) {
      event.preventDefault();
      moveSlide(key === 'PageDown' ? 1 : -1);
      return;
    }
    if (teaching && (key === 't' || key === 'T')) {
      event.preventDefault();
      pressControl('take-next');
      return;
    }
    if (teaching && (key === 's' || key === 'S')) {
      event.preventDefault();
      const seat = snapshot.seats.find((item) => item.seatId === cursorSeat);
      if (seat?.learnerId == null) return;
      pressControl(`spotlight-${seat.learnerId}`);
    }
  };
  document.addEventListener('keydown', onKeyDown);

  mirror.canvas.addEventListener('click', (event) => {
    if (snapshot === null || snapshot.you.role !== 'learner') return;
    const seatId = mirror.seatAt({ x: event.clientX, y: event.clientY });
    if (seatId === null) return;
    cursorSeat = seatId;
    void takeSeat(seatId);
  });

  const onResize = (): void => {
    if (modeFor(window.innerWidth) !== mode) applyMode();
  };
  window.addEventListener('resize', onResize);

  const ticker = window.setInterval(() => {
    if (breakoutBase === null) {
      panels.tickTimer(null, false);
      return;
    }
    const elapsed = (Date.now() - breakoutBase.at) / 1_000;
    const left = Math.max(0, Math.round(breakoutBase.remaining - elapsed));
    panels.tickTimer(left, snapshot?.breakout?.warning === true);
    mirror.tickTables(left);
    scene?.tickRings(left);
  }, 250);

  root.addEventListener('slatehall:leave', () => {
    closed = true;
    window.clearInterval(ticker);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('keydown', onKeyDown);
    socket?.close();
    scene?.dispose();
  });

  applyMode();

  void (async () => {
    const answer = await api.get<SessionSnapshot>(`/api/sessions/${sessionId}`);
    if (answer.status === 404) {
      root.replaceChildren(
        element('h1', {}, ['Page not found']),
        element('p', {}, ["We couldn't find that page."])
      );
      return;
    }
    if (answer.error !== null) {
      announcer.say(answer.error);
      heading.textContent = 'Classroom';
      return;
    }
    announceBase = answer.body;
    apply(answer.body);
    const { createScene } = await import('../classroom/scene.js');
    scene = createScene(mirror.canvas);
    mirror.setWebgl(scene !== null);
    webglFallback.hidden = scene !== null;
    if (scene === null) mirror.canvas.hidden = true;
    if (snapshot !== null) draw();
    connect();
  })();

  return root;
}
