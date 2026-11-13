import { api } from '../api.js';
import { el, prefersReducedMotion } from '../dom.js';
import { chatForViewport } from '../chat.js';
import { realtime } from '../realtime.js';
import { type AppContext, type Screen } from './shared.js';
import { GameView } from '../scene/gameview.js';
import { EMOTES, type EmoteName, type Snapshot } from '../../shared/types.js';
import { MAX_HEALTH } from '../../shared/constants.js';
import type { MessageKey } from '../../shared/i18n/index.js';

const MOVE_STEP_METRES = 2;
const HOLD_INTERVAL_MS = 250;

export async function renderPlay(
  ctx: AppContext,
  host: HTMLElement,
  sessionId: string,
): Promise<Screen> {
  const view = new GameView({ label: ctx.t('app.gameView') });
  const chat = chatForViewport(ctx, `session-${sessionId}`);

  const healthMeter = el('div', {
    class: 'meter health',
    role: 'meter',
    'aria-label': ctx.t('meter.health'),
    'aria-valuemin': '0',
    'aria-valuemax': String(MAX_HEALTH),
    'aria-valuenow': String(MAX_HEALTH),
  });
  const objective = el('div', {
    class: 'live-region objective',
    role: 'status',
    'aria-live': 'polite',
    'aria-label': ctx.t('status.objective'),
  });
  const roster = el('ul', {
    class: 'session-members',
    role: 'list',
    'aria-label': ctx.t('list.sessionMembers'),
  });
  const events = el('ul', {
    class: 'session-events',
    role: 'log',
    'aria-label': ctx.t('log.sessionEvents'),
  });

  const emotesButton = el('button', {
    type: 'button',
    class: 'button',
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
  }, [ctx.t('btn.emotes')]) as HTMLButtonElement;
  const emotesMenu = el('div', {
    class: 'emote-menu',
    role: 'menu',
    'aria-label': ctx.t('menu.emotes'),
  });
  emotesMenu.hidden = true;

  const skipButton = el('button', { type: 'button', class: 'button skip' }, [
    ctx.t('btn.skip'),
  ]) as HTMLButtonElement;

  host.append(
    el('div', { class: 'play-layout' }, [
      view.element,
      el('div', { class: 'play-hud' }, [
        el('div', { class: 'hud-left' }, [healthMeter, objective, skipButton]),
        el('div', { class: 'hud-right' }, [
          roster,
          el('div', { class: 'emote-host' }, [emotesButton, emotesMenu]),
        ]),
        el('div', { class: 'hud-bottom' }, [events, chat.element]),
      ]),
      view.webglAvailable ? null : el('p', { class: 'notice', text: ctx.t('scene.noWebgl') }),
    ]),
  );

  const sendEmote = (emote: EmoteName): void => {
    realtime.emote(sessionId, emote);
  };

  const closeMenu = (focusButton: boolean): void => {
    emotesMenu.hidden = true;
    emotesButton.setAttribute('aria-expanded', 'false');
    if (focusButton) emotesButton.focus();
  };

  const menuItems: HTMLElement[] = EMOTES.map((emote, index) => {
    const item = el('button', {
      type: 'button',
      role: 'menuitem',
      class: 'menuitem',
      tabindex: '-1',
    }, [ctx.t(`emote.${emote}` as MessageKey)]);
    item.addEventListener('click', () => {
      sendEmote(emote);
      closeMenu(true);
    });
    item.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        event.preventDefault();
        menuItems[(index + 1) % menuItems.length].focus();
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        event.preventDefault();
        menuItems[(index - 1 + menuItems.length) % menuItems.length].focus();
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        sendEmote(emote);
        closeMenu(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu(true);
      }
    });
    emotesMenu.append(item);
    return item;
  });

  const openMenu = (): void => {
    emotesMenu.hidden = false;
    emotesButton.setAttribute('aria-expanded', 'true');
    menuItems[0].focus();
  };
  emotesButton.addEventListener('click', () => {
    if (emotesMenu.hidden) openMenu();
    else closeMenu(true);
  });

  // --- flythrough ------------------------------------------------------------
  void view.playFlythrough(prefersReducedMotion());
  skipButton.addEventListener('click', () => view.endFlythrough());

  // --- snapshots -------------------------------------------------------------
  const shownRoster = new Map<string, { item: HTMLElement; seat: HTMLElement }>();

  const applySnapshot = (snapshot: Snapshot): void => {
    document.title = ctx.t('title.pattern', {
      screen: ctx.t(`story.${snapshot.story_id}` as MessageKey),
    });
    view.update(snapshot, ctx.account?.id ?? '');
    const mine = snapshot.members.find((member) => member.account_id === ctx.account?.id);
    if (mine !== undefined) {
      healthMeter.setAttribute('aria-valuenow', String(mine.health));
      healthMeter.textContent = String(Math.round(mine.health));
    }
    const collected = snapshot.motes.filter((mote) => mote.collected_by !== null).length;
    objective.textContent = snapshot.gate_open
      ? ctx.t('objective.gateOpen')
      : ctx.t('objective.motes', { collected });

    for (const [accountId, row] of shownRoster) {
      if (!snapshot.members.some((member) => member.account_id === accountId)) {
        row.item.remove();
        shownRoster.delete(accountId);
      }
    }
    for (const member of snapshot.members) {
      const existing = shownRoster.get(member.account_id);
      const seatText =
        member.status === 'dropped'
          ? ctx.t('roster.seatHeld', { seconds: member.grace_remaining_seconds ?? 0 })
          : '';
      if (existing !== undefined) {
        existing.seat.textContent = seatText;
        continue;
      }
      const seat = el('span', { class: 'seat-held', text: seatText });
      const item = el('li', {}, [el('span', { text: member.display_name }), seat]);
      roster.append(item);
      shownRoster.set(member.account_id, { item, seat });
    }
  };

  const offSnapshot = realtime.onSnapshot((snapshot) => {
    if (snapshot.id !== sessionId) return;
    applySnapshot(snapshot);
    if (snapshot.status === 'complete') {
      ctx.navigate(`/stories/${snapshot.story_id}/chapters/${snapshot.chapter}/complete`);
    }
  });

  const offEvent = realtime.onEvent((event) => {
    if (event.stream !== `session:${sessionId}`) return;
    const payload = event.event as Record<string, unknown> & { kind: string };
    const name = String(payload.display_name ?? '');
    let line: string | null = null;
    if (payload.kind === 'pickup') {
      line = ctx.t('event.pickup', { name, collected: Number(payload.collected ?? 0) });
    } else if (payload.kind === 'emote') {
      line = ctx.t('event.emote', {
        name,
        emote: ctx.t(`emote.${String(payload.emote)}` as MessageKey),
      });
    } else if (payload.kind === 'checkpoint') {
      line = ctx.t('event.checkpoint');
    } else if (payload.kind === 'knocked_out') {
      line = ctx.t('event.knockedOut', { name });
    } else if (payload.kind === 'session_complete') {
      ctx.navigate(`/stories/${String(payload.story_id)}/chapters/${Number(payload.chapter)}/complete`);
      return;
    }
    if (line !== null) events.append(el('li', { text: line }));
  });

  const offJoin = realtime.onJoin((message) => {
    if (message.type === 'joined') return;
    if (message.event.kind === 'session_complete') {
      ctx.navigate(
        `/stories/${String(message.event.story_id)}/chapters/${Number(message.event.chapter)}/complete`,
      );
      return;
    }
    ctx.announce(
      message.event.kind === 'not_a_member'
        ? ctx.t('fb.seatReleased')
        : ctx.t('fb.sessionEnded'),
    );
    void (async () => {
      const { party } = await api.get<{ party: { id: string } | null }>('/api/parties/current');
      ctx.navigate(party === null ? '/stories' : `/party/${party.id}`);
    })();
  });

  realtime.joinSession(sessionId);
  try {
    const { session } = await api.get<{ session: Snapshot }>(`/api/sessions/${sessionId}`);
    applySnapshot(session);
  } catch {
    ctx.announce(ctx.t('fb.sessionEnded'));
  }

  // --- controls --------------------------------------------------------------
  const held = new Set<string>();
  let holdTimer: number | null = null;

  const stepHeld = (): void => {
    const direction = { x: 0, z: 0 };
    if (held.has('w') || held.has('arrowup')) direction.z -= 1;
    if (held.has('s') || held.has('arrowdown')) direction.z += 1;
    if (held.has('a') || held.has('arrowleft')) direction.x -= 1;
    if (held.has('d') || held.has('arrowright')) direction.x += 1;
    if (direction.x === 0 && direction.z === 0) return;
    const current = view.heroPosition();
    realtime.moveTo(
      sessionId,
      Math.max(-20, Math.min(20, current.x + direction.x * MOVE_STEP_METRES)),
      Math.max(-20, Math.min(20, current.z + direction.z * MOVE_STEP_METRES)),
    );
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
    const key = event.key.toLowerCase();

    if (!typing && key >= '1' && key <= '6') {
      event.preventDefault();
      sendEmote(EMOTES[Number(key) - 1]);
      return;
    }
    if (!typing && key === 'e') {
      event.preventDefault();
      openMenu();
      return;
    }
    if (!typing && key === ' ') {
      event.preventDefault();
      realtime.swing(sessionId);
      return;
    }
    if (key === 'escape') {
      view.endFlythrough();
      return;
    }
    if (typing) return;
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
      event.preventDefault();
      if (!held.has(key)) {
        held.add(key);
        stepHeld();
      }
      if (holdTimer === null) holdTimer = window.setInterval(stepHeld, HOLD_INTERVAL_MS);
    }
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    held.delete(event.key.toLowerCase());
    if (held.size === 0 && holdTimer !== null) {
      window.clearInterval(holdTimer);
      holdTimer = null;
    }
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  view.element.addEventListener('pointerdown', (event) => {
    const ground = view.groundAt(event);
    if (ground === null) return;
    realtime.moveTo(sessionId, ground.x, ground.z);
  });

  return {
    destroy: (): void => {
      offSnapshot();
      offEvent();
      offJoin();
      chat.destroy();
      view.destroy();
      realtime.leaveSession();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      if (holdTimer !== null) window.clearInterval(holdTimer);
    },
  };
}
